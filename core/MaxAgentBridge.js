/**
 * core/MaxAgentBridge.js
 *
 * Live HTTP bridge from SOMA to the running MAX instance.
 * MAX exposes a tool API at /api/tools/:tool/:action — this module wraps it so
 * SOMA can do real file edits, shell execution, and more without spawning processes.
 *
 * MAX must be running at MAX_URL (default: http://127.0.0.1:3100).
 * If MAX is offline, all calls throw — callers should catch and fall back.
 */

import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { mkdir, appendFile } from 'fs/promises';
import { spawn } from 'child_process';
import { createHash } from 'node:crypto';
import { redactObject } from './RedactionUtils.js';
import { SwarmCritiqueHarness } from './SwarmCritiqueHarness.js';

const DEFAULT_MAX_URL  = 'http://127.0.0.1:3100';
const DEFAULT_TIMEOUT  = 30_000;

function resolveDefaultMaxPath() {
    const candidates = [
        process.env.MAX_PATH,
        path.resolve(process.cwd(), '..', 'MAX'),
        path.join(process.env.USERPROFILE || '', 'Desktop', 'The Stack', 'MAX'),
        path.join(process.env.USERPROFILE || '', 'Desktop', 'MAX')
    ].filter(Boolean);

    return candidates.find(candidate => existsSync(candidate)) || candidates[candidates.length - 1];
}

function loadMaxApiKey(maxPath) {
    if (process.env.MAX_API_KEY) return process.env.MAX_API_KEY;

    const keyFile = path.join(maxPath || resolveDefaultMaxPath(), '.max', 'api-key.txt');
    if (!existsSync(keyFile)) return null;

    const key = readFileSync(keyFile, 'utf8').trim();
    return key || null;
}

export class MaxAgentBridge {
    constructor(config = {}) {
        this.maxUrl  = config.maxUrl  || process.env.MAX_URL  || DEFAULT_MAX_URL;
        this.timeout = config.timeout || DEFAULT_TIMEOUT;
        this.maxPath = config.maxPath || resolveDefaultMaxPath();
        this.apiKey  = config.apiKey  || loadMaxApiKey(this.maxPath);
        this.ledgerPath = config.ledgerPath || path.join(process.cwd(), 'data', 'maintenance', 'soma-max-bridge.jsonl');
        this._available = null;   // null = unchecked, true/false = known
        this._lastHealth = null;
        this._startedProcess = null;
        this.logger = config.logger || console;
        this.swarmHarness = new SwarmCritiqueHarness({ somaPath: process.cwd(), maxPath: this.maxPath, logger: this.logger });
    }

    // ─── Health check ──────────────────────────────────────────────────────

    async isAvailable() {
        try {
            const res = await this._fetch('GET', '/health');
            this._lastHealth = res || null;
            this._available = res?.ok === true
                || res?.ready === true
                || res?.status === 'healthy'
                || res?.success === true;
        } catch (error) {
            this._lastHealth = { error: error.message };
            this._available = false;
        }
        return this._available;
    }

    getLastHealth() {
        return this._lastHealth;
    }

    async ensureAvailable(opts = {}) {
        const startIfOffline = opts.startIfOffline !== false;
        const timeoutMs = opts.timeoutMs || 45_000;

        if (await this.isAvailable()) {
            return { available: true, alreadyRunning: true, health: this._lastHealth };
        }

        if (!startIfOffline) {
            return { available: false, started: false, health: this._lastHealth };
        }

        const started = await this.startLocalServer({
            timeoutMs,
            port: opts.port,
            mode: opts.mode || 'api'
        });
        return {
            available: started.available,
            alreadyRunning: false,
            started: true,
            pid: started.pid,
            command: started.command,
            health: this._lastHealth
        };
    }

    async startLocalServer(opts = {}) {
        if (await this.isAvailable()) {
            return { available: true, alreadyRunning: true, health: this._lastHealth };
        }

        if (!existsSync(this.maxPath)) {
            throw new Error(`MAX path does not exist: ${this.maxPath}`);
        }

        const port = opts.port || new URL(this.maxUrl).port || '3100';
        const args = ['launcher.mjs', '--mode', opts.mode || 'api', '--port', String(port)];
        const command = `${process.execPath} ${args.join(' ')}`;
        const child = spawn(process.execPath, args, {
            cwd: this.maxPath,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: {
                ...process.env,
                MAX_PORT: String(port)
            }
        });

        child.unref();
        this._startedProcess = { pid: child.pid, command, startedAt: Date.now() };
        await this._recordBridgeEvent({
            method: 'SPAWN',
            path: 'local-max-api',
            ok: true,
            pid: child.pid,
            command,
            maxPath: this.maxPath
        });

        const available = await this._pollAvailable(opts.timeoutMs || 45_000);
        if (!available) {
            throw new Error(`MAX did not become healthy within ${opts.timeoutMs || 45_000}ms`);
        }

        return { available: true, pid: child.pid, command, health: this._lastHealth };
    }

    async _pollAvailable(timeoutMs = 45_000, intervalMs = 1000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.isAvailable()) return true;
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        return false;
    }

    // ─── File tools ────────────────────────────────────────────────────────

    /** Read a file. Pass startLine/endLine for range reads. */
    async readFile(filePath, opts = {}) {
        return this._tool('file', 'read', {
            filePath,
            ...( opts.startLine != null ? { startLine: opts.startLine } : {} ),
            ...( opts.endLine   != null ? { endLine:   opts.endLine   } : {} ),
        });
    }

    /** Write a file (creates or overwrites). */
    async writeFile(filePath, content) {
        const targetDir = path.dirname(filePath);
        if (!existsSync(targetDir)) {
            return { success: false, error: `Directory does not exist: ${targetDir}`, hint: `Create the directory first or check path.` };
        }
        return this._tool('file', 'write', { filePath, content });
    }

    /**
     * Replace text in a file.
     * Surgical edit — only oldText→newText is changed.
     * Returns { success, error, hint } — check success before continuing.
     */
    async replaceInFile(filePath, oldText, newText) {
        if (!existsSync(filePath)) {
            return { success: false, error: `File does not exist: ${filePath}`, hint: `Verify the exact file path before replacing.` };
        }
        
        // Cache original content for rollback in case of partial or corrupted execution
        const originalContent = readFileSync(filePath, 'utf8');
        
        const result = await this._tool('file', 'replace', { filePath, oldText, newText });
        
        if (!result || !result.success) {
            // Rollback trigger - restore original content if the patch failed verification
            await this._tool('file', 'write', { filePath, content: originalContent });
        }
        
        return result;
    }

    /** List files in a directory. */
    async listFiles(dirPath) {
        return this._tool('file', 'list', { dir: dirPath });
    }

    /** Regex search across files. */
    async grepFiles(dir, pattern, opts = {}) {
        return this._tool('file', 'grep', {
            dir,
            pattern,
            ...(opts.filePattern  ? { filePattern:  opts.filePattern  } : {}),
            ...(opts.ignoreCase   ? { ignoreCase:   true               } : {}),
            ...(opts.maxResults   ? { maxResults:   opts.maxResults    } : {}),
        });
    }

    // ─── Shell tools ───────────────────────────────────────────────────────

    /** Run a shell command and wait for output. */
    async runShell(command, timeoutMs = 60_000) {
        return this._tool('shell', 'run', { command, timeoutMs });
    }

    /** Start a background process in MAX's shell manager. */
    async startProcess(command, name) {
        return this._tool('shell', 'start', { command, name });
    }

    // ─── Goal injection ────────────────────────────────────────────────────

    /**
     * Queue a goal into MAX's AgentLoop.
     * MAX will work on it autonomously.
     */
    async injectGoal(title, opts = {}) {
        const res = await this._fetchJSON('POST', '/api/goals', {
            title,
            description: opts.description || title,
            priority:    opts.priority    ?? 0.7,
            source: 'soma',
            requestId: opts.requestId,
            readOnly: opts.readOnly === true,
            repairContract: opts.repairContract || null,
        });
        if (!res?.accepted || !res?.id) throw new Error('MAX did not return a durable requested-job acceptance');
        if (['failed', 'cancelled'].includes(res.status)) throw Object.assign(new Error(`MAX request ${res.id} is already ${res.status}; inspect its receipt before retrying`), { goalId: res.id, code: 'REQUEST_TERMINAL' });
        if (res?.id) {
            this.logger.log?.(`[MaxAgentBridge] 🎯 Goal injected into MAX: "${title}" → ${res.id}`);
        }
        return res;
    }

    // ─── Chat dispatch ─────────────────────────────────────────────────────

    /**
     * Send a message to MAX and get a response.
     * Useful for SOMA to ask MAX to investigate or explain something.
     */
    async getGoal(id) {
        return this._fetch('GET', `/api/goals/${encodeURIComponent(id)}`);
    }

    async getClusterStatus() {
        return this._fetch('GET', '/api/swarm/status');
    }

    async controlCluster(action, body = {}) {
        if (!['pause', 'resume', 'refresh', 'cancel'].includes(action)) throw new Error('Unknown MAX cluster control');
        return this._fetch('POST', `/api/swarm/control/${action}`, body);
    }

    async delegateSomaImprovement(request, opts = {}) {
        if (!String(request || '').trim()) throw new Error('An improvement request is required');
        const timeoutMs = Math.max(1000, Math.min(120000, Number(opts.timeoutMs) || 60000));
        const idempotencyKey = opts.idempotencyKey || createHash('sha256').update(JSON.stringify([request, opts.files || [], opts.context || ''])).digest('hex');
        const result = await this._fetch('POST', '/api/swarm/soma-improvement', {
            request, title: opts.title, files: opts.files || [], context: opts.context || '', timeoutMs, idempotencyKey
        }, timeoutMs + 10000);
        const task = result?.task;
        const receipt = task?.receipt;
        const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
        const digest = receipt?.result && createHash('sha256').update(JSON.stringify(canonical(receipt.result))).digest('hex');
        // Coordinator verifies the worker HMAC; bind the returned evidence to
        // this task and keep all code promotion inside SOMA's governed pipeline.
        if (!result?.success || task?.status !== 'completed' || receipt?.taskId !== task?.id || receipt?.workerId !== result.workerId
            || receipt?.kind !== 'soma_improvement' || receipt?.resultHash !== digest
            || receipt?.governance?.promotionAllowed !== false || receipt?.governance?.requiresSomaPipeline !== true) {
            throw new Error('MAX returned an invalid or incomplete advisory receipt');
        }
        return result;
    }

    async checkSomaLink() {
        return this._fetch('GET', '/api/soma/check');
    }

    async debateDecision({ title, description, stakes = 'medium' }) {
        return this._fetchJSON('POST', '/api/debate', {
            title,
            description: description || title,
            stakes
        });
    }

    async chat(message, opts = {}) {
        return this._fetchJSON('POST', '/api/soma/chat', {
            message,
            persona:     opts.persona     || null,
            temperature: opts.temperature ?? 0.7,
            maxTokens:   opts.maxTokens   ?? 1024,
        });
    }

    // ─── Swarm Co-Working & Peer Critique ──────────────────────────────────

    /**
     * Delegate a cross-workspace task to MAX Agent0 on a designated feature branch.
     */
    async delegateSwarmTask({ title, subtask, branch, files = [], priority = 0.8 }) {
        if (!title) throw new Error("Swarm task title is required");
        const swarmBranch = branch || "swarm/task-" + Date.now().toString(36);
        const goalPayload = {
            description: subtask || title,
            priority,
            source: "soma_swarm",
            branch: swarmBranch,
            targetFiles: files
        };
        const res = await this.injectGoal("[SWARM] " + title, goalPayload);
        return {
            ok: true,
            branch: swarmBranch,
            goalId: res?.id,
            status: "delegated_to_max",
            acceptedAt: new Date().toISOString()
        };
    }

    /**
     * Critique a branch developed by MAX or SOMA
     */
    async critiqueBranch(branch, opts = {}) {
        return this.swarmHarness.critiqueBranch({
            branch,
            repoPath: opts.repoPath || this.maxPath,
            author: opts.author || "MAX",
            requirements: opts.requirements || []
        });
    }

    /**
     * Format a dual SOMA 🤝 MAX swarm receipt for Discord
     */
    formatSwarmReceipt(data) {
        return this.swarmHarness.formatDiscordReceipt(data);
    }

    // ─── Internal helpers ──────────────────────────────────────────────────

    async _tool(toolName, action, params) {
        const result = await this._fetchJSON('POST', `/api/tools/${toolName}/${action}`, params);
        if (!result) throw new Error(`MAX tool ${toolName}:${action} returned no response`);
        if (result.success === false) {
            throw new Error(`MAX tool ${toolName}:${action} failed: ${result.error || 'unknown error'}`);
        }
        return result;
    }

    async _fetchJSON(method, path, body = null) {
        const opts = {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            ...(body ? { body: JSON.stringify(body) } : {}),
        };
        return this._fetch(method, path, body);
    }

    async _fetch(method, requestPath, body = null, timeoutMs = this.timeout) {
        const started = Date.now();
        const base = String(this.maxUrl || DEFAULT_MAX_URL).replace(/\/$/, '');
        const target = `${base}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`;
        const headers = body ? { 'Content-Type': 'application/json' } : {};
        const authAttached = Boolean(this.apiKey && requestPath !== '/health');
        if (this.apiKey && requestPath !== '/health') {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }
        const options = {
            method,
            headers,
            signal: AbortSignal.timeout(timeoutMs),
            ...(body ? { body: JSON.stringify(body) } : {}),
        };
        try {
            const response = await fetch(target, options);
            const text = await response.text();
            let payload = null;
            if (text) {
                try { payload = JSON.parse(text); }
                catch { payload = { raw: text }; }
            }
            await this._recordBridgeEvent({
                method,
                path: requestPath,
                status: response.status,
                ok: response.ok,
                authAttached,
                durationMs: Date.now() - started,
                response: requestPath === '/health' ? payload : summarizePayload(payload)
            });
            if (!response.ok) {
                throw Object.assign(new Error(payload?.error || payload?.message || `MAX HTTP ${response.status}`), { status: response.status, code: payload?.code });
            }
            return payload || { ok: true };
        } catch (error) {
            await this._recordBridgeEvent({
                method,
                path: requestPath,
                ok: false,
                authAttached,
                durationMs: Date.now() - started,
                error: error.message
            });
            throw error;
        }
    }

    async _recordBridgeEvent(event) {
        try {
            await mkdir(path.dirname(this.ledgerPath), { recursive: true });
            const entry = redactObject({
                id: `max-bridge-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                timestamp: new Date().toISOString(),
                maxUrl: this.maxUrl,
                maxPath: this.maxPath,
                transport: 'http',
                ...event
            });
            await appendFile(this.ledgerPath, JSON.stringify(entry) + '\n', 'utf8');
        } catch {
            // Ledger failures must never break the bridge itself.
        }
    }

    /**
     * SOVEREIGN GATEWAY v1.0.0
     * Enables Owner (Master SOMA-ID) to remote into MAX for diagnostics via EdgeWorker tunnel.
     */
    async establishArchitectLink(remoteNodeId, masterKey, system) {
        this.logger.log?.(`🤝 [MAX_BRIDGE] Initiating Sovereign Handshake: ${remoteNodeId}`);
        
        // 1. Verify Owner's Master ID via Thalamus
        const thalamus = system?.thalamusArbiter;
        if (thalamus && typeof thalamus.verifyMasterKey === 'function') {
            if (!thalamus.verifyMasterKey(masterKey)) {
                this.logger.error?.('🛑 [MAX_BRIDGE] Handshake Rejected: Unauthorized ID.');
                return { success: false, reason: 'unauthorized' };
            }
        }

        // 2. Establish the P2P Edge Tunnel
        const edge = system?.edgeWorkerOrchestrator;
        if (edge && typeof edge.connectToNode === 'function') {
            try {
                await edge.connectToNode(remoteNodeId);
                this.logger.log?.('🌌 [MAX_BRIDGE] Sovereign Tunnel Established. Remote diagnostics ACTIVE.');
                return { success: true, mode: 'P2P_ARCHITECT' };
            } catch (e) {
                this.logger.error?.(`❌ [MAX_BRIDGE] Tunnel Failed: ${e.message}`);
                return { success: false, reason: 'tunnel_failure', error: e.message };
            }
        }

        return { success: false, reason: 'orchestrator_offline' };
    }
}

function summarizePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    return {
        success: payload.success,
        id: payload.id,
        path: payload.path,
        bytes: payload.bytes,
        error: payload.error,
        message: payload.message
    };
}

// Singleton — import and use directly
export default new MaxAgentBridge();
