/**
 * AutoHealDaemon.js
 * 
 * SOMA's Autonomous SRE (Site Reliability Engineer).
 * Monitors unit tests and background daemon health. When a crash or test failure occurs,
 * it triggers the Engineering Swarm to autonomously write a patch and verify it.
 * Upon success, it notifies the user via Axis.
 */

import BaseDaemon from './BaseDaemon.js';
import { exec } from 'child_process';
import axisStore from '../server/axis/AxisStore.js';
import messageBroker from '../core/MessageBroker.cjs';

export class AutoHealDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({
            name: 'AutoHealDaemon',
            intervalMs: config.intervalMs || 60000, // Check every 60 seconds
            ...config
        });
        this.system = config.system;
        this.isHealing = false;
    }

    async onTick() {
        if (this.isHealing) return;

        // Run the unit test suite
        exec('node test_error.cjs', async (error, stdout, stderr) => {
            // Only trigger on actual process failure (non-zero exit) — not on the word "error" in filenames
            if (!error) return;
            const output = stdout + stderr;
            this.logger.warn(`[AutoHeal] 🚨 Test failure detected in test_error.cjs:\n${output.slice(0, 200)}...`);
            await this._triggerSwarmHealing('test_error.cjs', output);
        });
    }

    async _triggerSwarmHealing(source, errorOutput) {
        this.isHealing = true;
        const swarm = this.system?.engineeringSwarm;
        
        if (!swarm) {
            this.logger.error('[AutoHeal] Engineering Swarm is offline. Cannot self-heal.');
            this.isHealing = false;
            return;
        }

        // Send a preliminary Whisper to Axis
        this._notifyAxis(`🚨 **Anomaly Detected:** Test failure in \`${source}\`. Dispatching Engineering Swarm for autonomous repair. \n\`\`\`\n${errorOutput.slice(0, 150)}...\n\`\`\``);

        try {
            // Attempt to determine the failing file from the stack trace
            let targetFile = source; // Default to the test file itself
            const match = errorOutput.match(/at Object\.<anonymous> \((.*?):(\d+):(\d+)\)/);
            if (match && match[1]) {
                targetFile = match[1]; // Extract the actual file that crashed
            } else {
                // Heuristic: If it mentions a specific file, try to extract it
                const fileMatch = errorOutput.match(/([a-zA-Z0-9_/\\]+\.(?:js|cjs|mjs|ts|jsx))/);
                if (fileMatch) targetFile = fileMatch[1];
            }

            this.logger.info(`[AutoHeal] Directing Swarm to patch: ${targetFile} (via Ghost Staging)`);

            const staging = this.system?.stagingArbiter;
            if (!staging) {
                // Fallback to direct patch if staging is missing
                const result = await swarm.modifyCode(
                    targetFile, 
                    `The test suite failed with the following error:\n${errorOutput}\n\nDiagnose the root cause and write a patch to fix the error so the test passes.`
                );
                if (result.success) {
                    this._notifyAxis(`✅ **Direct Healing Complete:** Engineering Swarm patched \`${targetFile}\` directly (Staging offline).`);
                }
                return;
            }

            // ── GHOST STAGING FLOW ──
            const problem = `The test suite failed with the following error:\n${errorOutput}\n\nDiagnose the root cause and write a patch to fix the error so the test passes.`;
            const proposal = await staging.proposeAndVerify(targetFile, problem, 'node test_error.cjs');

            if (proposal.success) {
                this._notifyAxis(`🌀 **Ghost Staging Verified:** Fix for \`${targetFile}\` passed verification in the sandbox. Committing to live brain...`);
                await staging.commitFix(proposal);
                this._notifyAxis(`✅ **Self-Healing Complete:** Verified patch physically implemented. All tests are now green.`);
            } else {
                this._notifyAxis(`❌ **Ghost Staging Failed:** Engineering Swarm proposed a fix, but it failed verification in the sandbox. \n\`\`\`\n${proposal.error}\n\`\`\``);
            }
        } catch (e) {
            this.logger.error(`[AutoHeal] Healing process crashed: ${e.message}`);
            this._notifyAxis(`❌ **Critical Failure:** AutoHeal sequence crashed. ${e.message}`);
        } finally {
            this.isHealing = false;
        }
    }

    _notifyAxis(content) {
        try {
            // Find the first available channel (usually 'general' or 'system')
            const channels = axisStore.db.prepare('SELECT id FROM channels LIMIT 1').all();
            if (channels.length > 0) {
                axisStore.addMessage({
                    channelId: channels[0].id,
                    workspaceId: 'system',
                    senderId: 'soma_sre',
                    senderName: 'SOMA SRE',
                    senderColor: 'emerald',
                    content: content,
                    isSoma: true
                });
            }
        } catch (e) {
            this.logger.error(`[AutoHeal] Failed to notify Axis: ${e.message}`);
        }
    }
}

export default AutoHealDaemon;
