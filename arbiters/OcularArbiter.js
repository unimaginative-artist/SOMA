/**
 * OcularArbiter.js
 * 
 * The specialized 'Visual Verification' nerve for SOMA.
 * Manages the generation and caching of visual evidence (annotated document images).
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export class OcularArbiter extends EventEmitter {
    constructor(system) {
        super();
        this.system = system;
        this.name = 'Ocular';
        this.pythonPath = process.env.PROVENANCE_PYTHON_PATH || 'python';
        this.bridgeScript = path.join(process.cwd(), 'appendages', 'provenance', 'limb_bridge.py');
        this.isBusy = false;
    }

    /**
     * Perform a deep visual audit of a document.
     * Returns structural data + paths to annotated images.
     */
    async analyzeDocument(filePath) {
        if (this.isBusy) throw new Error("Ocular Vision is already under load.");
        
        console.log(`👁️ [Ocular] Starting deep visual audit: ${path.basename(filePath)}`);
        this.isBusy = true;

        try {
            const result = await this._callBridge('cartographer', filePath);
            this.isBusy = false;
            
            if (result.success) {
                this.emit('analysis_complete', { hash: result.ocular.hash, pages: result.ocular.pages.length });
                return result;
            } else {
                throw new Error(result.error);
            }
        } catch (e) {
            this.isBusy = false;
            console.error(`❌ [Ocular] Vision failed: ${e.message}`);
            throw e;
        }
    }

    async _callBridge(task, inputPath) {
        return new Promise((resolve, reject) => {
            const py = spawn(this.pythonPath, [this.bridgeScript]);
            
            let output = '';
            let error = '';

            const command = JSON.stringify({ task, input: inputPath });

            py.stdout.on('data', (d) => output += d.toString());
            py.stderr.on('data', (d) => error += d.toString());

            py.on('close', (code) => {
                if (code !== 0) return reject(new Error(`Ocular process crashed: ${error}`));
                try {
                    resolve(JSON.parse(output));
                } catch (e) {
                    reject(new Error(`Malformed Ocular response: ${output}`));
                }
            });

            py.stdin.write(command);
            py.stdin.end();
        });
    }

    getStatus() {
        return {
            name: this.name,
            busy: this.isBusy,
            engine: "Ocular-V4-Unified"
        };
    }
}

export default OcularArbiter;
