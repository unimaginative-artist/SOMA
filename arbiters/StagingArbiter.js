/**
 * StagingArbiter.js
 * 
 * SOMA's "Ghost Staging" layer.
 * Implements the vision of testing edited versions in isolation before 
 * implementation into the real SOMA.
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { ArbiterResult } from '../core/BaseArbiter.cjs';

export class StagingArbiter extends EventEmitter {
    constructor(system) {
        super();
        this.system = system;
        this.name = 'StagingArbiter';
        this.stagingDir = path.join(process.cwd(), '.soma', 'staging');
    }

    /**
     * Propose a fix in the sandbox.
     * @param {string} filePath - Path to the original file.
     * @param {string} problemDescription - Error or goal.
     * @param {string} testCmd - Command to run for verification.
     */
    async proposeAndVerify(filePath, problemDescription, testCmd) {
        console.log(`🌀 [Staging] Proposing fix for: ${filePath}`);
        
        const fileName = path.basename(filePath);
        const stagedPath = path.join(this.stagingDir, fileName);

        try {
            // 1. Isolate: Copy to staging
            await fs.copyFile(filePath, stagedPath);
            console.log(`🌀 [Staging] File isolated to: ${stagedPath}`);

            // 2. Patch: Direct the Engineering Swarm to the staged file
            const swarm = this.system.engineeringSwarm;
            if (!swarm) throw new Error("Engineering Swarm is offline.");

            const patchResult = await swarm.modifyCode(stagedPath, problemDescription);
            if (!patchResult.success) {
                return { success: false, error: `Swarm failed to patch staged file: ${patchResult.error}` };
            }

            console.log(`🌀 [Staging] Patch applied to sandbox version.`);

            // 3. Simulate: Run verification against the staged file
            // Replace the original path in the test command with the staged path
            const verifyCmd = testCmd.split(' ').map(arg => {
                if (arg === path.basename(filePath) || arg === filePath) return stagedPath;
                return arg;
            }).join(' ');

            console.log(`🌀 [Staging] Verifying fix: ${verifyCmd}`);

            const verifyResult = await this._runSimulatedTest(verifyCmd);

            if (verifyResult.success) {
                console.log(`✅ [Staging] Fix VERIFIED in sandbox. Ready for merge.`);
                return { 
                    success: true, 
                    stagedPath, 
                    originalPath: filePath,
                    verificationOutput: verifyResult.output 
                };
            } else {
                console.warn(`❌ [Staging] Fix FAILED in sandbox. Rejecting.`);
                return { 
                    success: false, 
                    error: "Staged fix did not pass verification.",
                    verificationOutput: verifyResult.output 
                };
            }

        } catch (e) {
            console.error(`❌ [Staging] Error in sandbox: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    /**
     * Commit the verified fix to the live brain.
     */
    async commitFix(proposal) {
        if (!proposal || !proposal.success) throw new Error("Invalid proposal for commit.");
        
        console.log(`💾 [Staging] Committing verified fix to live SOMA: ${proposal.originalPath}`);
        
        try {
            // Overwrite live file with verified staged file
            await fs.copyFile(proposal.stagedPath, proposal.originalPath);
            // Cleanup
            await fs.unlink(proposal.stagedPath);
            return { success: true };
        } catch (e) {
            console.error(`❌ [Staging] Commit failed: ${e.message}`);
            throw e;
        }
    }

    async _runSimulatedTest(cmd) {
        return new Promise((resolve) => {
            exec(cmd, (error, stdout, stderr) => {
                const output = stdout + stderr;
                const success = !error && !output.toLowerCase().includes('fail') && !output.toLowerCase().includes('error');
                resolve({ success, output });
            });
        });
    }
}

export default StagingArbiter;
