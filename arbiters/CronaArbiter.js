/**
 * CronaArbiter.js
 *
 * THE THIRD PILLAR: Temporal & Causal Intelligence (Crona)
 *
 * This arbiter serves as the "Governor" of SOMA's long-term behavior.
 * It combines:
 * 1. MerovingianHybrid: For deep reflection and brain fusion.
 * 2. CausalityArbiter: For building and querying causal chains (If A then B).
 * 3. Temporal Memory: Learning from the sequence of events over time.
 *
 * "Instinct speaks, Knowledge maps, but Crona decides."
 */

import EventEmitter from 'events';
import { MerovingianHybrid } from '../cognitive/MerovingianHybrid.mjs';
import { RobustAdapters } from '../cognitive/RobustLLMAdapters.mjs';
import messageBroker from '../core/MessageBroker.js';

export class CronaArbiter extends EventEmitter {
    constructor(opts = {}) {
        super();
        this.name = opts.name || 'CronaArbiter';
        this.causality = opts.causalityArbiter || null;
        this.thoughtNetwork = opts.thoughtNetwork || null;
        this.brain = opts.quadBrain || null;
        this.devilsAdvocate = opts.devilsAdvocate || null;

        // Initialize the Merovingian Hybrid (The Reflection Engine)
        this.merovingian = new MerovingianHybrid({
            name: 'Crona-Merovingian',
            verbose: opts.verbose || true,
            finalizeConfidence: 0.95, // Crona demands high certainty
            adapters: this._buildAdapters()
        });

        this.stats = {
            decisionsRefined: 0,
            causalChainsFractalized: 0,
            interventionsRecorded: 0,
            dissonanceDetected: 0,
            seasonsCompleted: 0
        };

        this.lastSeasonStart = Date.now();
        this.currentEra = 1;

        console.log(`[${this.name}] ⏳ Crona Temporal Engine Initialized`);
    }

    /**
     * Section 6.2: Seasonal Learning (The Eras)
     * Once a month, consolidate the most successful patterns and share with GMN.
     */
    async processSeasonCycle() {
        const oneMonth = 30 * 24 * 60 * 60 * 1000;
        if (Date.now() - this.lastSeasonStart < oneMonth) return;

        this.log('info', `🌅 New Season detected (Era ${this.currentEra}). Consolidating wisdom for GMN publication...`);

        // 1. Harvest Top 100 Causal Patterns
        const wisdom = [];
        if (this.causality) {
            const graph = this.causality.exportGraph();
            // Filter for patterns with success rate > 90%
            const topEdges = graph.edges
                .filter(e => e.strength > 0.9)
                .sort((a, b) => b.strength - a.strength)
                .slice(0, 100);

            wisdom.push(...topEdges);
        }

        // 2. Publish to Graymatter Network
        if (wisdom.length > 0) {
            this.log('success', `📡 Publishing Era ${this.currentEra} Wisdom (${wisdom.length} fractals) to GMN.`);
            await messageBroker.publish('gmn.publication', {
                era: this.currentEra,
                wisdom,
                sourceAddress: `${this.name.toLowerCase()}.gmn.somaexample.cd`
            });
        }

        this.lastSeasonStart = Date.now();
        this.currentEra++;
        this.stats.seasonsCompleted++;
    }

    /**
     * Build adapters that connect Merovingian to SOMA's pillar brains
     * ROBUST: Falls back to direct LLM calls if QuadBrain is unavailable
     */
    _buildAdapters() {
        // If QuadBrain is available, use it
        if (this.brain && typeof this.brain.callBrain === 'function') {
            console.log('[CronaArbiter] Using QuadBrain + Local Engine for Merovingian adapters');
            return {
                gema: async (q, opts) => {
                    // Call the brain's internal GEMMA-3 (local Ollama) implementation
                    if (typeof this.brain._callSoma1T === 'function') {
                        const res = await this.brain._callSoma1T(q, opts.temperature || 0.7, opts.maxTokens || 1024);
                        return { text: res.text, confidence: 0.75, meta: { brain: 'GEMMA-3', provider: 'ollama' } };
                    }
                    // Fallback to LOGOS if method missing
                    const res = await this.brain.callBrain('LOGOS', q, opts);
                    return { text: res.text, confidence: res.confidence, meta: { brain: 'LOGOS' } };
                },
                deepseek: async (q, opts) => {
                    const res = await this.brain.callBrain('PROMETHEUS', q, opts);
                    return { text: res.text, confidence: res.confidence, meta: { brain: 'PROMETHEUS' } };
                },
                gemini: async (q, opts) => {
                    const res = await this.brain.callBrain('AURORA', q, opts);
                    return { text: res.text, confidence: res.confidence, meta: { brain: 'AURORA' } };
                }
            };
        } else {
            // Fallback to direct LLM calls with Ollama fallback
            console.log('[CronaArbiter] ⚠️ QuadBrain unavailable - using RobustAdapters (direct LLM with Ollama fallback)');
            return RobustAdapters;
        }
    }

    async initialize() {
        // Subscribe to successful tasks to learn causality
        messageBroker.subscribe('task_completed', (envelope) => this._onTaskCompleted(envelope));
        messageBroker.subscribe('soma.response', (envelope) => this._onResponseGenerated(envelope));

        console.log(`[${this.name}] ✅ Crona active and listening to the MessageBroker`);
        return true;
    }

    /**
     * The core reasoning method for the 3rd Pillar
     * Now includes a Dissonance Detector to challenge Instinct
     */
    async reason(query, context = {}) {
        console.log(`[${this.name}] ⏳ Crona is reflecting on: "${query.substring(0, 50)}"...`);
        const { proposedResponse = null, systemPrompt = '', conversationHistory = [] } = context;

        try {

        // 1. Build conversation context from history
        let conversationContext = '';
        if (conversationHistory && conversationHistory.length > 0) {
            conversationContext = '\n\nCONVERSATION HISTORY:\n' +
                conversationHistory.slice(-10).map(msg => `${msg.role}: ${msg.content}`).join('\n') + '\n\n';
        }

        // 2. Check Causal History: "Have we seen this sequence before?"
        let causalContext = "";
        let dissonance = null;

        if (this.causality) {
            // Check for causal chains related to the current query
            const chains = this.causality.queryCausalChains(query, { maxDepth: 3 });
            if (chains.length > 0) {
                causalContext = "\n\nCAUSAL HISTORY (CRONA):\n" +
                    chains.map(c => `- ${c.cause} leads to ${c.effect} (Confidence: ${c.confidence.toFixed(2)})`).join('\n');

                // DISSONANCE CHECK: If instinct says "Yes" but history says "Failure"
                if (proposedResponse && (proposedResponse.toLowerCase().includes('yes') || proposedResponse.toLowerCase().includes('proceed'))) {
                    const negativeOutcome = chains.find(c => c.effect.includes('FAILURE') || c.effect.includes('ERROR'));
                    if (negativeOutcome && negativeOutcome.confidence > 0.7) {
                        dissonance = {
                            type: 'temporal_warning',
                            severity: 'high',
                            message: `Instinct proposes proceeding, but causal history shows a ${(negativeOutcome.confidence * 100).toFixed(0)}% probability of failure based on: ${negativeOutcome.cause}.`
                        };
                        this.stats.dissonanceDetected++;
                        console.warn(`[${this.name}] 🚨 Cognitive Dissonance detected! Historical failure pattern found.`);
                    }
                }
            }
        }

        // 3. Reflective Fusion via Merovingian WITH personality and context
        // Inject systemPrompt (personality), conversation history, and causal context
        const reflectionPrompt = dissonance
            ? `${systemPrompt}\n${conversationContext}WARNING: Internal conflict detected.\n${dissonance.message}\n\nORIGINAL QUERY: ${query}\nINSTINCT RESPONSE: ${proposedResponse}\n\nReconcile this conflict and provide a unified, safe directive.`
            : `${systemPrompt}\n${conversationContext}${query}${causalContext}`;

        const result = await this.merovingian.evaluate(reflectionPrompt, {
            meta: {
                domain: context.domain || 'general',
                novelty: context.novelty || 0.5,
                dissonance: !!dissonance
            }
        });

        // 3. THE CONTRARIAN GATE (Devil's Advocate)
        let finalResponse = result.final;
        let contrarianDoubt = null;

        if (this.devilsAdvocate) {
            const challenge = await this.devilsAdvocate.challenge(query, result.final);
            if (challenge.frictionScore > 0.7) {
                console.log(`[${this.name}] 🔥 Devil's Advocate flagged high friction (${challenge.frictionScore}). Re-reflecting...`);
                
                // Trigger one extra "Contrarian Correction" loop
                const correction = await this.merovingian.evaluate(`
                    ORIGINAL PROPOSAL: ${result.final}
                    CRITICAL CONTRARIAN CHALLENGE: ${challenge.critique}
                    
                    REASONING TASK: Re-evaluate and provide a hardened, safer response that addresses these specific doubts.
                `, { meta: { mode: 'hardened' } });
                
                finalResponse = correction.final;
                contrarianDoubt = challenge;
            }
        }

        this.stats.decisionsRefined++;

        return {
            ok: true,
            text: finalResponse,
            confidence: result.confidence,
            brain: 'CRONA',
            method: contrarianDoubt ? 'hardened_reflective_synthesis' : 'merovingian_reflective_fusion',
            provenance: result.provenance,
            dissonance: dissonance,
            contrarianChallenge: contrarianDoubt
        };

        } catch (error) {
            console.error(`[${this.name}] ❌ CRONA reasoning failed:`, error.message);
            console.error('[${this.name}] Stack:', error.stack);

            // Graceful degradation: Return error state with low confidence
            return {
                ok: false,
                text: `CRONA system encountered an error: ${error.message}. Please check logs and verify API keys.`,
                confidence: 0.0,
                brain: 'CRONA',
                method: 'error_fallback',
                error: error.message,
                dissonance: null,
                contrarianChallenge: null
            };
        }
    }

    /**
     * Learning Loop: Convert events into Causal Fractals
     */
    async _onTaskCompleted(envelope) {
        const { from, payload } = envelope;
        if (!payload || !this.causality) return;

        // Record as an intervention: "Agent [from] did [task] -> Outcome: [success]"
        const intervention = {
            action: `${from}:${payload.query || 'unknown_task'}`,
            outcome: payload.success ? 'SUCCESS' : 'FAILURE',
            context: payload.context || {},
            success: payload.success
        };

        await this.causality.recordIntervention(intervention);
        this.stats.interventionsRecorded++;

        // If highly successful, "fractalize" this chain into long-term memory
        if (payload.success && payload.confidence > 0.9) {
            this._fractalizeCausalChain(intervention);
        }
    }

    /**
     * Record interaction outcomes from the main chat
     */
    async _onResponseGenerated(envelope) {
        // Future: Emotional feedback loop
    }

    /**
     * Bridge Pillar 3 (Crona) to Pillar 2 (Fractals)
     */
    async _fractalizeCausalChain(intervention) {
        if (!this.thoughtNetwork) return;

        try {
            const conceptName = `CausalPattern: ${intervention.action}`;
            const node = await this.thoughtNetwork.getOrCreateConcept(conceptName, {
                type: 'pattern',
                source: 'crona_temporal_engine',
                tags: ['causality', 'success_pattern']
            });

            // Link to the outcome
            const outcomeNode = await this.thoughtNetwork.getOrCreateConcept(intervention.outcome);
            this.thoughtNetwork.connectConcepts(node, outcomeNode, 'results_in', 0.95);

            this.stats.causalChainsFractalized++;
            console.log(`[${this.name}] ✨ Fractalized causal chain: ${conceptName}`);
        } catch (e) {
            console.warn(`[${this.name}] Failed to fractalize chain: ${e.message}`);
        }
    }

    getStats() {
        return {
            ...this.stats,
            merovingian: this.merovingian.metrics
        };
    }
}