/**
 * MlInternArbiter.js
 * 
 * The 'Recursive Researcher' for SOMA.
 * Inspired by HF ml-intern, but physically anchored to SOMA's CNS.
 * 
 * Logic:
 * 1. Researches latest ML breakthroughs via arXiv/HF.
 * 2. Translates papers into actionable Engineering Swarm goals.
 * 3. Oversees the creation of specialized Lobe models.
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export class MlInternArbiter extends EventEmitter {
    constructor(system) {
        super();
        this.system = system;
        this.name = 'MlIntern';
        this.rootPath = path.join(process.cwd(), 'appendages', 'ml_intern');
        this.pythonPath = path.join(process.cwd(), '.soma_venv', 'Scripts', 'python.exe');
        this.isBusy = false;
        this.findings = [];
    }

    /**
     * Autonomous Research: Find papers and implementation details for a topic.
     */
    async researchTopic(topic) {
        console.log(`🧪 [ML-INTERN] Starting autonomous research on: ${topic}`);
        if (this.isBusy) throw new Error('ML Intern is already researching');
        this.isBusy = true;
        
        try {
            // 1. Search arXiv
            const research = await this._dispatchPython('search_papers', { query: topic, limit: 5 });
            if (!research.success) throw new Error(`Research failed: ${research.error}`);

            // Store findings for status
            this.findings = [...(research.data || []), ...this.findings].slice(0, 10);
            
            // Push findings into the global learning pipeline
            if (this.system?.universalLearningPipeline) {
                for (const item of (research.data || [])) {
                    this.system.universalLearningPipeline.logInteraction({
                        agent: 'MlInternArbiter',
                        type: 'autonomous_research',
                        input: { query: topic },
                        output: { details: item, status: 'success' },
                        metadata: { tags: ['autonomous-learning', 'ml-intern', 'philosophy', 'reflection'] }
                    }).catch(() => {});
                }
            }
            
            // Remember findings in core memory
            if (this.system?.memory?.remember) {
                for (const item of (research.data || [])) {
                    this.system.memory.remember(`ML Intern found paper: ${item.title} - ${item.summary}`);
                }
            }

            this.emit('research_found', { topic, count: research.data.length });
            return research.data;
        } finally {
            this.isBusy = false;
        }
    }

    /**
     * Translate Research to Code: Send findings to Engineering Swarm.
     */
    async implementResearch(finding) {
        const swarm = this.system.engineeringSwarm;
        if (!swarm) throw new Error('Engineering Swarm is offline. Cannot implement research.');

        this.isBusy = true;
        console.log(`🛠️ [ML-INTERN] Implementing architecture: ${finding.title}`);

        const prompt = `Research Title: ${finding.title}\nSummary: ${finding.summary}\n\nTask: Based on this research, write a Python dataset generator script and a training configuration for our LoRA pipeline. Focus on high-precision implementation.`;
        
        try {
            const result = await swarm.modifyCode('scripts/auto_training_update.py', prompt);
            this.isBusy = false;
            return result;
        } catch (e) {
            this.isBusy = false;
            throw e;
        }
    }

    async _dispatchPython(task, payload) {
        return new Promise((resolve, reject) => {
            const script = path.join(this.rootPath, 'ml_researcher.py');
            const py = spawn(this.pythonPath, [script]);
            let settled = false;
            
            let output = '';
            let error = '';

            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                fn(value);
            };

            const timeout = setTimeout(() => {
                try { py.kill(); } catch {}
                finish(reject, new Error(`ML-Intern timed out during ${task}`));
            }, 60_000);

            py.stdout.on('data', d => output += d.toString());
            py.stderr.on('data', d => error += d.toString());
            py.on('error', e => finish(reject, e));

            py.on('close', code => {
                if (code !== 0) return finish(reject, new Error(`ML-Intern crashed: ${error}`));
                try {
                    finish(resolve, JSON.parse(output));
                } catch (e) {
                    finish(reject, new Error(`Malformed researcher response: ${output}`));
                }
            });

            py.stdin.write(JSON.stringify({ task, payload }));
            py.stdin.end();
        });
    }

    getStatus() {
        return {
            name: this.name,
            busy: this.isBusy,
            research_path: this.rootPath,
            latestFindings: this.findings
        };
    }
}

export default MlInternArbiter;
