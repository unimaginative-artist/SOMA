/**
 * DistillationArbiter.js - The "Nightly Training" Loop
 * 
 * Listens for the 'learning_ready' event from UniversalLearningPipeline
 * and runs a distillation batch using the QuadBrain to harden insights
 * into the permanent BeliefSystem.
 */

import { BaseArbiter } from '../core/BaseArbiter.cjs';

export default class DistillationArbiter extends BaseArbiter {
    constructor(config = {}) {
        super({
            name: 'DistillationArbiter',
            role: 'model_distillation',
            capabilities: ['distill_insights', 'harden_beliefs'],
            ...config
        });

        this.messageBroker = config.messageBroker;
        this.quadBrain = config.quadBrain;
        this.beliefSystem = config.beliefSystem;
        this.isDistilling = false;

        console.log(`[${this.name}] 🧪 Initialized`);
    }

    async initialize() {
        if (!this.messageBroker) {
            console.warn(`[${this.name}] Warning: No MessageBroker provided.`);
            return;
        }

        // Subscribe to the global learning_ready event
        this.messageBroker.subscribe('learning_ready', this.handleLearningReady.bind(this));
        
        console.log(`[${this.name}] ✅ Subscribed to 'learning_ready'`);
    }

    async handleLearningReady(envelope) {
        if (this.isDistilling) {
            console.log(`[${this.name}] ⏳ Already distilling a batch, skipping...`);
            return;
        }

        const payload = envelope?.payload || envelope || {};
        const rawExperiences = payload.experiences;
        const experiences = Array.isArray(rawExperiences)
            ? rawExperiences
            : Array.isArray(rawExperiences?.results)
                ? rawExperiences.results
                : Array.isArray(rawExperiences?.items)
                    ? rawExperiences.items
                    : rawExperiences && typeof rawExperiences === 'object'
                        ? Object.values(rawExperiences).filter(value => value && typeof value === 'object')
                        : [];
        const { outcomes, stats } = payload;
        
        const validExperiences = experiences.filter(exp => exp && (exp.action || exp.reward !== undefined || exp.outcome || exp.summary));
        if (validExperiences.length === 0) {
            return;
        }

        this.isDistilling = true;
        console.log(`[${this.name}] 🧠 Starting Distillation Batch on ${validExperiences.length} valid experiences...`);

        try {
            // Extract top experiences
            const topExperiences = validExperiences.slice(0, 10).map(exp => ({
                action: exp.action,
                reward: exp.reward,
                outcome: exp.outcome,
                agent: exp.agent
            }));

            const prompt = `You are SOMA's central Distillation Engine. 
You are analyzing a batch of recent experiences from the ExperienceReplayBuffer.
Your goal is to extract ONE generalized heuristic or belief that can be permanently added to your BeliefSystem.

Recent Experiences:
${JSON.stringify(topExperiences, null, 2)}

What is the core lesson learned? 
Format your output strictly as a concise, single declarative rule or belief. Do not include conversational remarks, questions, or asking for permission.`;

            if (this.quadBrain) {
                const response = await this.quadBrain.reason(prompt, {
                    task: 'distillation',
                    lobe: 'LOGOS',
                    forceBrain: 'NEMESIS'
                });

                if (response.text) {
                    const distilledBelief = response.text.trim();
                    console.log(`[${this.name}] 💡 Distilled Insight: ${distilledBelief}`);

                    if (this.beliefSystem && typeof this.beliefSystem.addBelief === 'function') {
                        await this.beliefSystem.addBelief({
                            core: distilledBelief,
                            confidence: 0.8,
                            domain: 'generalized_distillation'
                        });
                        console.log(`[${this.name}] 💾 Saved insight to BeliefSystem`);
                    } else if (this.beliefSystem && typeof this.beliefSystem.updateBelief === 'function') {
                        // Handle legacy BeliefSystem format if needed
                         await this.beliefSystem.updateBelief('distillation', distilledBelief);
                         console.log(`[${this.name}] 💾 Saved insight to BeliefSystem (legacy mode)`);
                    }
                }
            } else {
                console.warn(`[${this.name}] QuadBrain not connected! Skipping reasoning.`);
            }

        } catch (error) {
            console.error(`[${this.name}] ❌ Distillation failed:`, error.message);
        } finally {
            this.isDistilling = false;
        }
    }
}
