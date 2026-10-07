/**
 * core/OdinOrchestrator.js
 *
 * SOMA ODIN (Over-Depth Intelligence Network) Harness.
 * Implements Recurrent-Depth Transformer (RDT) principles:
 * — Adaptive Computation Time (ACT): simple queries exit in 1 pass
 * — LTI Stability: thought loop terminates when response stops changing
 * — 300ms metabolic yield between passes (event-loop relief on 8GB RAM)
 *
 * Enhancements:
 * - _callBrain() helper: works when system IS QuadBrain OR when system has
 *   quadBrain as a property (BiotechArbiter, MaterialsScienceArbiter, etc.)
 * - Fast O(n) word-Jaccard similarity replaces O(n²) edit distance —
 *   stable on long responses without locking the event loop
 * - Confidence score surfaced in result
 */

import { EventEmitter } from 'events';

export class OdinOrchestrator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.name            = 'OdinOrchestrator';
        this.system          = config.system;
        this.confidenceTarget = config.confidenceTarget || 0.95;
        this.maxRecurrence   = config.maxRecurrence    || 3;
        this.lastDeltas      = [];
        this._callCount      = 0;
    }

    // ── Public: Recurrent reasoning ──────────────────────────────────────────

    /**
     * Run one or more passes of recurrent depth reasoning.
     * Returns { response, depth, stability, confidence }.
     */
    async reasonRecurrent(prompt, lobe = 'logos', complexity = 'standard') {
        if (complexity === 'simple') return this._directPass(prompt, lobe);

        console.log(`🌀 [ODIN] Recurrent Thinking [Lobe: ${lobe}, max: ${this.maxRecurrence}]`);

        let currentDepth = 1;
        let lastResponse = '';
        let stabilized   = false;

        while (currentDepth <= this.maxRecurrence && !stabilized) {
            const passPrompt = currentDepth === 1
                ? prompt
                : `ODIN RECURRENCE ${currentDepth}/${this.maxRecurrence}.
Previous Insight: ${lastResponse.substring(0, 2000)}
Task: Refine the above. Increase technical precision. Eliminate generic filler. If it is already optimal, repeat the key conclusion exactly to signal stability. 
IMPORTANT: NEVER use em-dashes (—).`;

            const brainResponse   = await this._callBrain(passPrompt, lobe);
            const currentResponse = brainResponse.text || brainResponse.response || '';

            const similarity = this._wordJaccard(lastResponse, currentResponse);
            console.log(`   Pass ${currentDepth}: similarity ${(similarity * 100).toFixed(1)}%`);

            if (similarity >= this.confidenceTarget || (currentDepth > 1 && currentResponse === lastResponse)) {
                console.log(`✅ [ODIN] Stabilized at depth ${currentDepth} (${(similarity * 100).toFixed(1)}%).`);
                stabilized = true;
            }

            lastResponse = currentResponse;
            currentDepth++;
            this._callCount++;

            // Metabolic yield — prevents event-loop starvation on constrained hardware
            await new Promise(r => setTimeout(r, 300));
        }

        return {
            response:   lastResponse,
            depth:      currentDepth - 1,
            stability:  stabilized ? 'stable' : 'forced_exit',
            confidence: this._wordJaccard(prompt, lastResponse), // rough measure
        };
    }

    // ── Private: brain routing ────────────────────────────────────────────────

    /**
     * Route a brain call regardless of how system was passed.
     * Handles two wiring patterns:
     *   A) new OdinOrchestrator({ system: this })       — inside QuadBrain
     *   B) new OdinOrchestrator({ system: config.system }) — inside BiotechArbiter etc.
     */
    async _callBrain(prompt, lobe) {
        const s = this.system;
        if (!s) throw new Error('OdinOrchestrator: system is null');

        // Pattern A: system IS QuadBrain (_callProviderCascade directly on it)
        if (typeof s._callProviderCascade === 'function') {
            return s._callProviderCascade(prompt, { activeLobe: lobe });
        }

        // Pattern B: system has quadBrain property
        if (s.quadBrain && typeof s.quadBrain._callProviderCascade === 'function') {
            return s.quadBrain._callProviderCascade(prompt, { activeLobe: lobe });
        }

        // Pattern C: bootstrap has the reasoning surface under another common brain key.
        const candidates = [
            s.brain,
            s.somArbiter,
            s.somaArbiter,
            s.arbiter,
            s.reasoningCore,
            s.cognitiveCore,
        ];
        for (const candidate of candidates) {
            if (candidate && typeof candidate._callProviderCascade === 'function') {
                return candidate._callProviderCascade(prompt, { activeLobe: lobe });
            }
            if (candidate && typeof candidate.reason === 'function') {
                return candidate.reason(prompt, { activeLobe: lobe, preferredBrain: lobe });
            }
        }

        // Pattern D: maps/registries sometimes hold the active QuadBrain under a named key.
        const registryCandidates = [
            s.arbiters?.get?.('quadBrain'),
            s.arbiters?.get?.('somArbiter'),
            s.arbiters?.get?.('SOMArbiter'),
            s.registry?.get?.('quadBrain'),
            s.registry?.get?.('somArbiter'),
        ].filter(Boolean);
        for (const candidate of registryCandidates) {
            if (typeof candidate._callProviderCascade === 'function') {
                return candidate._callProviderCascade(prompt, { activeLobe: lobe });
            }
            if (typeof candidate.reason === 'function') {
                return candidate.reason(prompt, { activeLobe: lobe, preferredBrain: lobe });
            }
        }

        throw new Error('OdinOrchestrator: no _callProviderCascade found on system or system.quadBrain');
    }

    async _directPass(prompt, lobe) {
        const raw = await this._callBrain(prompt, lobe);
        return {
            response:   raw.text || raw.response || '',
            depth:      0,
            stability:  'direct',
            confidence: 1.0,
        };
    }

    // ── Stability: word-level Jaccard (O(n), safe for long responses) ─────────

    /**
     * Compute word-set Jaccard similarity between two strings.
     * 0 = completely different, 1 = identical vocabulary.
     * Used to detect when recurrence has converged.
     */
    _wordJaccard(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1.0;

        const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
        const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));

        if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
        if (wordsA.size === 0 || wordsB.size === 0) return 0;

        let intersect = 0;
        for (const w of wordsA) {
            if (wordsB.has(w)) intersect++;
        }
        const union = wordsA.size + wordsB.size - intersect;
        return intersect / union;
    }
}

export default OdinOrchestrator;
