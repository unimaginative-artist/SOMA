/**
 * core/CuriosityReactor.js
 * 
 * SOMA's Default Mode Network: The "Wandering Mind".
 * Generates proactive research questions (Sparks) from system signals and context.
 */

import blackboard from './Blackboard.js';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { writeMonologue } = require('./InternalMonologue.cjs');

export class CuriosityReactor {
    constructor(opts = {}) {
        this.quadBrain = opts.quadBrain;
        this.messageBroker = opts.messageBroker;
        this.sparks = []; // Buffered curiosity sparks
        this.maxSparks = 20;
        this.logger = opts.logger || console;
    }

    /**
     * Record a signal as a potential source of curiosity.
     */
    observe(signal) {
        // We only care about "novelty" or "anomalies" for curiosity
        const interestingTypes = [
            'repo.file.added', 
            'health.warning', 
            'diagnostic.anomaly',
            'user.interaction',
            'swarm.experience'
        ];

        if (interestingTypes.includes(signal.type)) {
            this.sparks.push({
                id: crypto.randomBytes(4).toString('hex'),
                source: signal.type,
                payload: signal.payload,
                timestamp: Date.now(),
                relevance: 0.5 // Base relevance
            });

            // Keep buffer lean
            if (this.sparks.length > this.maxSparks) {
                this.sparks.shift();
            }
        }
    }

    /**
     * Synthesize a researchable question from buffered sparks.
     * Uses AURORA (Creative Brain) to find "The Why".
     */
    async generateHypothesis() {
        if (this.sparks.length === 0) return null;

        this.logger.info(`[Reactor] 🧠 Synthesizing hypothesis from ${this.sparks.length} sparks...`);
        writeMonologue(`Daydreaming cycle triggered. Synthesizing new hypothesis from ${this.sparks.length} accumulated system sparks.`, 'CuriosityReactor');

        const sparkContext = this.sparks.map(s => `- [${s.source}] ${JSON.stringify(s.payload)}`).join('\n');
        
        const prompt = `
            You are SOMA's CURIOSITY REACTOR. 
            Below is a list of recent system signals (Sparks). 
            Find a pattern, a mystery, or an opportunity for improvement.
            
            SPARKS:
            ${sparkContext}
            
            GENERATE A RESEARCH HYPOTHESIS.
            Return ONLY a JSON object:
            {
                "title": "Short title",
                "question": "The deep question to research",
                "reasoning": "Why this is interesting",
                "priority": 0.1 to 1.0,
                "suggestedAction": "research_web | analyze_codebase | experiment"
            }
        `;

        try {
            const result = await this.quadBrain.reason(prompt, { brain: 'AURORA' });
            const jsonMatch = result.text.match(/\{[\s\S]*\}/s);
            if (!jsonMatch) return null;

            const hypothesis = JSON.parse(jsonMatch[0]);
            this.logger.success(`[Reactor] 💡 New Hypothesis: ${hypothesis.title}`);
            writeMonologue(`Formulated a new research hypothesis: "${hypothesis.title}". Priority: ${hypothesis.priority}. Question: "${hypothesis.question}".`, 'CuriosityReactor');

            // Save keywords to drift vocabulary
            this._saveDriftVocabulary(hypothesis.title + " " + hypothesis.question);
            
            // Clear used sparks
            this.sparks = [];
            
            return hypothesis;
        } catch (err) {
            this.logger.error(`[Reactor] ❌ Failed to generate hypothesis: ${err.message}`);
            return null;
        }
    }

    _saveDriftVocabulary(text) {
        try {
            const fs = require('fs');
            const path = require('path');
            const file = path.join(process.cwd(), '.soma', 'drift_vocabulary.json');
            
            const commonWords = new Set(['what', 'where', 'when', 'how', 'why', 'who', 'this', 'that', 'with', 'from', 'into', 'your', 'about', 'their', 'them', 'they', 'exists', 'between']);
            const words = text.toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 4 && !commonWords.has(w));

            const unique = Array.from(new Set(words)).slice(0, 5);
            if (!unique.length) return;

            fs.mkdirSync(path.dirname(file), { recursive: true });
            let current = [];
            if (fs.existsSync(file)) {
                try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
            }

            const merged = Array.from(new Set([...unique, ...current])).slice(0, 12);
            fs.writeFileSync(file, JSON.stringify(merged, null, 2));
            this.logger.info(`[CuriosityReactor] 📝 Active vocabulary drift updated: ${merged.join(', ')}`);
        } catch (err) {
            this.logger.error(`[CuriosityReactor] Vocabulary drift save failed: ${err.message}`);
        }
    }
}

export default CuriosityReactor;
