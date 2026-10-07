/**
 * daemons/CuriosityDaemon.js
 * 
 * Pulsing neuron for SOMA's Wandering Mind.
 * Triggers the CuriosityReactor to generate hypotheses and dispatch discovery tasks.
 */

import BaseDaemon from './BaseDaemon.js';

class CuriosityDaemon extends BaseDaemon {
    constructor(opts = {}) {
        super({
            name: 'CuriosityDaemon',
            intervalMs: opts.intervalMs || 7200000, // Default: Every 2 hours
            ...opts
        });
        this.reactor = opts.reactor;
        this.discovery = opts.discovery; // DiscoverySwarm
        this.messageBroker = opts.messageBroker;
    }

    async onInitialize() {
        if (this.messageBroker) {
            // Feed the reactor with all interesting signals
            this.messageBroker.subscribe('*', (signal) => {
                this.reactor.observe(signal);
            });
        }
    }

    async onPulse() {
        console.log('[Curiosity] 🌀 Initiating Daydream Cycle...');
        
        try {
            const hypothesis = await this.reactor.generateHypothesis();
            
            if (hypothesis && hypothesis.priority > 0.4) {
                console.log(`[Curiosity] 🚀 Researching: ${hypothesis.title}`);
                
                // Dispatch to Discovery Swarm
                if (this.discovery) {
                    await this.discovery.prototype({
                        name: hypothesis.title,
                        description: hypothesis.question,
                        type: hypothesis.suggestedAction
                    });
                }

                // Log the insight to the CNS
                this.publish('insight.generated', {
                    hypothesis,
                    timestamp: Date.now()
                });
            } else {
                console.log('[Curiosity] 💤 No significant mysteries found. Resting.');
            }

        } catch (err) {
            console.error(`[Curiosity] ❌ Daydream failed: ${err.message}`);
        }
    }
}

export default CuriosityDaemon;
