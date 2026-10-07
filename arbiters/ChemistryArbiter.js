/**
 * arbiters/ChemistryArbiter.js
 *
 * SOMA Chemistry Lab: Empirical Simulation Bridge.
 * 
 * Provides SOMA with the capability to run chemical experiments using a 
 * physical modeling substrate (scripts/chemistry_engine.py).
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import { spawn } from 'child_process';
import path from 'path';

export class ChemistryArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: 'ChemistryArbiter',
            role: ArbiterRole.MAINTAINER,
            capabilities: [ArbiterCapability.REASONING, ArbiterCapability.KNOWLEDGE_SYNTHESIS],
        });

        this.pythonPath = opts.pythonPath || './.soma_venv/Scripts/python.exe';
        this.enginePath = path.join(process.cwd(), 'scripts', 'chemistry_engine.py');
        this.experiments = [];
    }

    async initialize() {
        this.auditLogger.success(`🧪 [${this.name}] Chemistry Lab online. Empirical bridging active.`);
    }

    /**
     * Conducts a chemical experiment by calling the python engine.
     * @param {Object} protocol - The experiment protocol (type, reactants, etc.)
     */
    async conductExperiment(protocol) {
        this.auditLogger.info(`🧪 [${this.name}] Initiating experiment: ${protocol.type || 'unknown'}`);
        
        return new Promise((resolve, reject) => {
            const process = spawn(this.pythonPath, [this.enginePath, JSON.stringify(protocol)]);
            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => stdout += data);
            process.stderr.on('data', (data) => stderr += data);

            process.on('close', (code) => {
                if (code !== 0) {
                    this.auditLogger.error(`🧪 [${this.name}] Engine failure: ${stderr}`);
                    return reject(new Error(`Chemistry Engine exited with code ${code}: ${stderr}`));
                }

                try {
                    const output = JSON.parse(stdout);
                    if (output.success) {
                        this.experiments.push({ protocol, result: output.result, ts: Date.now() });
                        this.auditLogger.success(`🧪 [${this.name}] Experiment successful.`);
                        resolve(output.result);
                    } else {
                        reject(new Error(output.error));
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse engine output: ${stdout}`));
                }
            });
        });
    }

    getStatus() {
        return {
            name: this.name,
            experimentCount: this.experiments.length,
            latestExperiment: this.experiments[this.experiments.length - 1] || null
        };
    }
}

export default ChemistryArbiter;
