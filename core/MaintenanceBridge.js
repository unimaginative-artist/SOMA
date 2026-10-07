/**
 * core/MaintenanceBridge.js
 *
 * Communication bridge between SOMA and the external MAX maintenance repository.
 * Allows SOMA to "step outside" by delegating self-modification tasks to MAX.
 *
 * Primary path: MAX's live HTTP API at /api/tools/:tool/:action
 * Fallback path: spawn a new MAX process (old behavior, for when MAX is offline)
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { MaxAgentBridge } from './MaxAgentBridge.js';
import { redactObject } from './RedactionUtils.js';

function resolveDefaultMaxPath() {
    const candidates = [
        process.env.MAX_PATH,
        path.resolve(process.cwd(), '..', 'MAX'),
        path.join(process.env.USERPROFILE || '', 'Desktop', 'The Stack', 'MAX'),
        path.join(process.env.USERPROFILE || '', 'Desktop', 'MAX')
    ].filter(Boolean);

    return candidates.find(candidate => existsSync(candidate)) || candidates[candidates.length - 1];
}

export class MaintenanceBridge {
    constructor(config = {}) {
        this.maxPath  = config.maxPath  || resolveDefaultMaxPath();
        this.somaPath = config.somaPath || process.cwd();
        this.ledgerPath = config.ledgerPath || path.join(this.somaPath, 'data', 'maintenance', 'max-delegation.jsonl');
        this.logger   = config.logger   || console;
        this._bridge  = new MaxAgentBridge({ maxUrl: config.maxUrl, logger: this.logger });
    }

    /**
     * Delegate a self-modification task to the external MAX instance.
     *
     * Strategy:
     * MAX workers are advisory. The only executable destination is SOMA's
     * authoritative SelfModificationPipeline.
     *
     * @param {string} filepath  Path to the file in SOMA to modify (relative to somaPath)
     * @param {string} request   Natural-language description of the change
     */
    async delegateToExternalMax(filepath, request, options = {}) {
        const started = Date.now();
        this.logger.log?.(`🛰️ [MaintenanceBridge] Delegating to MAX: ${filepath}`);
        this.logger.log?.(`   Request: ${request}`);

        try {
            const online = await this._bridge.isAvailable();
            const absPath = path.isAbsolute(filepath) ? filepath : path.join(this.somaPath, filepath);
            const sourceSnapshot = await fs.readFile(absPath, 'utf8');
            const sourceHash = createHash('sha256').update(sourceSnapshot).digest('hex');
            let remoteAssist = null;

            if (online) {
                try {
                    remoteAssist = await this._bridge.delegateSomaImprovement(request, {
                        title: `[SOMA review] ${path.basename(filepath)}`,
                        context: `Target: ${filepath}\nSource SHA-256: ${sourceHash}\n\nCURRENT SOURCE\n${sourceSnapshot.slice(0, 24_000)}`
                    });
                    this.logger.log?.(`🧾 [MaintenanceBridge] Remote MAX receipt: ${remoteAssist?.task?.receipt?.resultHash || 'received'}`);
                } catch (error) {
                    this.logger.warn?.(`⚠️  [MaintenanceBridge] Remote MAX unavailable; Prime will continue: ${error.message}`);
                }

            }

            const pipeline = options.pipeline || options.system?.selfModPipeline || null;
            if (!pipeline?.propose) throw new Error('SelfModificationPipeline unavailable — external maintenance fails closed');
            const receipt = remoteAssist?.task?.receipt || null;
            const remoteProposal = receipt?.result?.text || '';
            const proposal = remoteProposal
                ? `${request}\n\nIndependent MAX advisory (verify against current source):\n${remoteProposal.slice(0, 12_000)}`
                : request;
            const governed = await pipeline.propose(filepath, proposal, 'External MAX-assisted self-surgery', {
                externalEvidence: { sourceHash, workerId: remoteAssist?.workerId || null, taskId: remoteAssist?.task?.id || null, receipt }
            });
            const evidence = {
                success: governed?.implemented === true,
                method: 'self_modification_pipeline',
                state: governed?.state,
                remoteWorkerId: remoteAssist?.workerId || null,
                remoteTaskId: remoteAssist?.task?.id || null,
                remoteReceiptHash: receipt?.resultHash || null
            };
            await this._recordDelegation({ filepath, request, online, durationMs: Date.now() - started, ...evidence });
            return evidence;
        } catch (error) {
            await this._recordDelegation({ filepath, request, success: false, durationMs: Date.now() - started, error: error.message });
            throw error;
        }
    }

    /**
     * Direct tool execution — ask MAX to read/write/run without going through AgentLoop.
     * Useful when you have a specific, well-defined operation.
     */
    async executeFile(action, params) {
        const online = await this._bridge.isAvailable();
        if (!online) throw new Error('MAX is offline — cannot execute file tool');
        return this._bridge._tool('file', action, params);
    }

    async executeShell(command, timeoutMs = 30_000) {
        const online = await this._bridge.isAvailable();
        if (!online) throw new Error('MAX is offline — cannot execute shell tool');
        return this._bridge.runShell(command, timeoutMs);
    }

    /**
     * Verify if the external maintenance was successful.
     * Checks the legacy file-based result (process-spawn path).
     */
    async checkMaintenanceStatus() {
        const statusPath = path.join(this.somaPath, '.soma', 'maintenance_result.json');
        try {
            const data = await fs.readFile(statusPath, 'utf8');
            return JSON.parse(data);
        } catch {
            return { status: 'pending' };
        }
    }

    // ─── Private: process-spawn fallback ──────────────────────────────────

    async _spawnFallback(filepath, request) {
        const taskManifest = {
            id:         `maintenance_${Date.now()}`,
            targetRepo: 'SOMA',
            targetPath: this.somaPath,
            file:       filepath,
            request,
            timestamp:  Date.now()
        };

        const manifestPath = path.join(this.somaPath, '.soma', 'external_maintenance_task.json');
        await fs.mkdir(path.dirname(manifestPath), { recursive: true });
        await fs.writeFile(manifestPath, JSON.stringify(taskManifest, null, 2));

        return new Promise((resolve, reject) => {
            const maxProcess = spawn('node', [
                'launcher.mjs',
                '--mode', 'maintenance',
                '--task-file', manifestPath
            ], {
                cwd:      this.maxPath,
                detached: true,
                stdio:    'inherit',
                shell:    true
            });

            maxProcess.on('error', (err) => {
                this.logger.error?.(`❌ [MaintenanceBridge] Spawn failed: ${err.message}`);
                reject(err);
            });

            maxProcess.unref();
            this.logger.log?.(`🚀 [MaintenanceBridge] External MAX process detached (PID: ${maxProcess.pid})`);
            resolve({ success: true, method: 'spawn', pid: maxProcess.pid, manifest: manifestPath });
        });
    }

    async _recordDelegation(event) {
        try {
            await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
            const entry = redactObject({
                id: `max-delegation-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                timestamp: new Date().toISOString(),
                maxPath: this.maxPath,
                somaPath: this.somaPath,
                maxUrl: this._bridge?.maxUrl || null,
                ...event
            });
            await fs.appendFile(this.ledgerPath, JSON.stringify(entry) + '\n', 'utf8');
        } catch {
            // Maintenance should keep running even if the evidence ledger is unavailable.
        }
    }
}

export default new MaintenanceBridge();
