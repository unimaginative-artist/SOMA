/**
 * TaskManifestArbiter.js
 * 
 * Inspired by 'claw-code' orchestration.
 * Manages persistent, multi-step goal execution via structured manifests.
 * Ensures complex coding tasks can survive a system reboot without losing state.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class TaskManifestArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'TaskManifestArbiter',
            role: ArbiterRole.ARCHITECT,
            capabilities: [
                ArbiterCapability.ORCHESTRATOR,
                ArbiterCapability.PERSISTENT_MEMORY
            ]
        });

        this.manifestDir = path.join(process.cwd(), '.soma', 'manifests');
        this.activeManifests = new Map(); // id -> manifest object
        this.messageBroker = opts.messageBroker || null;
    }

    async onInitialize() {
        await fs.mkdir(this.manifestDir, { recursive: true });
        await this._loadSavedManifests();
        
        if (this.messageBroker) {
            this.messageBroker.registerArbiter(this.name, {
                instance: this,
                type: 'orchestrator',
                role: 'planner'
            });
        }
        
        this.auditLogger.info(`[ManifestArbiter] 📋 Loaded ${this.activeManifests.size} active manifest(s).`);
        this._resumePendingManifests();
    }

    async _loadSavedManifests() {
        try {
            const files = await fs.readdir(this.manifestDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const content = await fs.readFile(path.join(this.manifestDir, file), 'utf8');
                    const manifest = JSON.parse(content);
                    if (manifest.status === 'running' || manifest.status === 'pending') {
                        this.activeManifests.set(manifest.id, manifest);
                    }
                }
            }
        } catch (e) {
            this.auditLogger.warn(`[ManifestArbiter] Could not load saved manifests: ${e.message}`);
        }
    }

    async _saveManifest(manifest) {
        const filePath = path.join(this.manifestDir, `${manifest.id}.json`);
        await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
    }

    /**
     * Creates a new manifest for a multi-step task.
     * @param {string} title 
     * @param {Array} steps - [{ name: "step 1", target: "EngineeringSwarmArbiter", payload: {} }]
     */
    async createManifest(title, steps) {
        const id = `manifest_${crypto.randomBytes(4).toString('hex')}`;
        const manifest = {
            id,
            title,
            status: 'pending',
            createdAt: Date.now(),
            currentStepIndex: 0,
            steps: steps.map(s => ({
                ...s,
                status: 'pending',
                result: null
            }))
        };

        this.activeManifests.set(id, manifest);
        await this._saveManifest(manifest);
        this.auditLogger.success(`[ManifestArbiter] 📝 Created new manifest: ${title} (${id})`);
        
        // Start automatically
        this.executeManifest(id).catch(e => console.error(e));
        return id;
    }

    async executeManifest(id) {
        const manifest = this.activeManifests.get(id);
        if (!manifest) return;

        manifest.status = 'running';
        await this._saveManifest(manifest);
        this.auditLogger.info(`[ManifestArbiter] ▶️ Executing manifest: ${manifest.title}`);

        for (let i = manifest.currentStepIndex; i < manifest.steps.length; i++) {
            const step = manifest.steps[i];
            step.status = 'running';
            manifest.currentStepIndex = i;
            await this._saveManifest(manifest);

            this.auditLogger.info(`[ManifestArbiter] ⏳ Step ${i + 1}/${manifest.steps.length}: ${step.name}`);

            try {
                // Delegate to the target Arbiter via MessageBroker
                if (this.messageBroker) {
                    const response = await this.messageBroker.sendMessage({
                        from: this.name,
                        to: step.target,
                        type: step.type || 'goal_assigned',
                        payload: step.payload
                    });

                    // We wait for the target to complete the task.
                    // For long-running tasks, we might need a webhook/callback pattern.
                    // But for this simple implementation, we assume the response is the final result.
                    step.status = 'completed';
                    step.result = response;
                } else {
                    step.status = 'skipped';
                    step.result = 'No message broker available';
                }
            } catch (err) {
                step.status = 'failed';
                step.error = err.message;
                manifest.status = 'failed';
                await this._saveManifest(manifest);
                this.auditLogger.error(`[ManifestArbiter] ❌ Manifest failed at step ${i + 1}: ${err.message}`);
                return;
            }

            await this._saveManifest(manifest);
            this.auditLogger.success(`[ManifestArbiter] ✅ Step ${i + 1} completed.`);
        }

        manifest.status = 'completed';
        await this._saveManifest(manifest);
        this.activeManifests.delete(id);
        this.auditLogger.success(`[ManifestArbiter] 🎉 Manifest complete: ${manifest.title}`);
    }

    _resumePendingManifests() {
        for (const [id, manifest] of this.activeManifests.entries()) {
            if (manifest.status === 'running' || manifest.status === 'pending') {
                this.auditLogger.info(`[ManifestArbiter] 🔄 Resuming interrupted manifest: ${manifest.title}`);
                this.executeManifest(id).catch(e => console.error(e));
            }
        }
    }
}

export default TaskManifestArbiter;
