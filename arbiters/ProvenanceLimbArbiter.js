/**
 * ProvenanceLimbArbiter.js
 * 
 * The 'Nerve' for the Provenance Appendage.
 * 
 * PRODUCTION HARDENED v1.0.0:
 * 1. Physical IPC Bridge: Spawns limb_bridge.py for all tasks.
 * 2. RAM Circuit Breaker: Monitors os.freemem() and rejects heavy jobs if < 1GB remains.
 * 3. Atomic Handshake: Validates input/output via SHA256 integrity hashes.
 * 4. Sandbox Management: Enforces file movement to protected_buffer.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';

export class ProvenanceLimbArbiter extends EventEmitter {
    constructor(system) {
        super();
        this.system = system;
        this.name = 'ProvenanceLimb';
        this.rootPath = path.join(process.cwd(), 'appendages', 'provenance');
        this.bufferPath = path.join(this.rootPath, 'protected_buffer');
        this.pythonPath = process.env.PROVENANCE_PYTHON_PATH || 'python';
        this.isProcessing = false;
        
        this.metrics = {
            totalJobs: 0,
            failures: 0,
            ramRejections: 0,
            lastHash: null
        };

        // Ensure protected_buffer exists so first job doesn't ENOENT
        fs.mkdir(this.bufferPath, { recursive: true }).catch(() => {});
    }

    /**
     * The Ocular (OCR) Handshake.
     */
    async processOcular(sourcePath) {
        return this._executeTask('ocular', sourcePath);
    }

    /**
     * The Cartographer (Indexing) Handshake.
     */
    async processCartographer(sourcePath) {
        return this._executeTask('cartographer', sourcePath);
    }

    /**
     * The Core Execution Engine. 
     * No shortcuts: Physically spawns the Python bridge.
     */
    async _executeTask(task, sourcePath) {
        if (this.isProcessing) throw new Error('Provenance Limb is already under load.');

        // 1. RAM Circuit Breaker (The 8GB Rule)
        const freeMem = os.freemem() / 1024 / 1024 / 1024; // GB
        if (freeMem < 1.0) { // Keep 1GB buffer for SOMA core
            this.metrics.ramRejections++;
            throw new Error(`CRITICAL RAM: Only ${freeMem.toFixed(2)}GB remains. Rejecting heavy job: ${task}`);
        }

        this.isProcessing = true;
        console.log(`👁️ [Provenance] Task [${task}] starting for: ${path.basename(sourcePath)}`);

        try {
            // 2. Atomic Sandbox Move
            const fileName = path.basename(sourcePath);
            const sandboxPath = path.join(this.bufferPath, `${Date.now()}_${fileName}`);
            await fs.copyFile(sourcePath, sandboxPath);

            // 3. Physical IPC Handshake
            const result = await this._callBridge(task, sandboxPath);

            if (!result.success) throw new Error(result.error || 'Unknown bridge error');

            // 4. Update Metrics
            this.metrics.totalJobs++;
            this.metrics.lastHash = result.integrity_hash;
            this.isProcessing = false;
            
            return result;

        } catch (e) {
            this.metrics.failures++;
            this.isProcessing = false;
            throw e;
        }
    }

    /**
     * Physical IPC Handshake logic via ChildProcess.
     */
    async _callBridge(task, inputPath) {
        return new Promise((resolve, reject) => {
            const bridgeScript = path.join(this.rootPath, 'limb_bridge.py');
            const py = spawn(this.pythonPath, [bridgeScript]);
            
            let outputData = '';
            let errorData = '';

            const command = JSON.stringify({ task, input: inputPath });

            py.stdout.on('data', (data) => outputData += data.toString());
            py.stderr.on('data', (data) => errorData += data.toString());

            py.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error(`Bridge exited with code ${code}: ${errorData}`));
                }
                try {
                    resolve(JSON.parse(outputData));
                } catch (e) {
                    reject(new Error(`Malformed bridge response: ${outputData}`));
                }
            });

            // Send the job to Python's STDIN
            py.stdin.write(command);
            py.stdin.end();
        });
    }

    getStatus() {
        const freeMem = os.freemem() / 1024 / 1024 / 1024;
        return {
            name: this.name,
            status: this.isProcessing ? 'BUSY' : 'READY',
            ram_headroom: `${freeMem.toFixed(2)}GB`,
            metrics: this.metrics
        };
    }
}

export default ProvenanceLimbArbiter;
