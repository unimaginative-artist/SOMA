/**
 * CriticAlignmentService.js
 * 
 * Orchestrates the "Mirror Loop" for SOMA's self-correction.
 * Runs OperationMirror to detect cognitive dissonance and updates the CriticBrain.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const OperationMirror = require('../asi/core/OperationMirror.cjs');

export class CriticAlignmentService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.name = 'CriticAlignmentService';
        this.intervalMs = config.intervalMs || 3600000; // Run every hour by default
        this.llm = config.llm; // Must provide an LLM instance (Gemini/Nemesis)
        this.logger = config.logger || console;
        
        this.mirror = new OperationMirror({
            logger: this.logger,
            resultsPath: path.join(process.cwd(), 'asi/tests/validation-results.json'),
            outputPath: path.join(process.cwd(), 'asi/learning/critic-alignment-dataset.jsonl')
        });

        this.isRunning = false;
        this.timer = null;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[${this.name}] Service started. Schedule: every ${(this.intervalMs / 60000).toFixed(0)} mins`);
        
        // Run immediately on start if requested
        await this.runAlignmentCycle();

        this.timer = setInterval(() => this.runAlignmentCycle(), this.intervalMs);
    }

    async stop() {
        this.isRunning = false;
        if (this.timer) clearInterval(this.timer);
        console.log(`[${this.name}] Service stopped`);
    }

    async runAlignmentCycle() {
        if (!this.llm) {
            console.warn(`[${this.name}] Skipping alignment: No LLM configured`);
            return;
        }

        console.log(`[${this.name}] 🪞 Starting alignment cycle...`);
        try {
            const results = await this.mirror.run(this.llm);
            
            if (results && results.length > 0) {
                console.log(`[${this.name}] ✅ Generated ${results.length} new insights`);
                this.emit('alignment_complete', { count: results.length });
            } else {
                console.log(`[${this.name}] No dissonance found to align`);
            }
        } catch (error) {
            console.error(`[${this.name}] Alignment cycle failed: ${error.message}`);
        }
    }
}
