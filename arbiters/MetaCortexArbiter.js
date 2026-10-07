/**
 * MetaCortexArbiter.js
 * 
 * THE MACRO-BRAIN (Section 2.5 of Distributed Infrastructure)
 * 
 * A high-latency, long-memory arbiter that only wakes up for:
 * 1. Existential coordination (Global threats/goals).
 * 2. Systemic anomaly response (Massive network failure).
 * 3. Seasonal Era planning.
 * 
 * It has no real-time authority over individual nodes.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import messageBroker from '../core/MessageBroker.js';

export class MetaCortexArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'GMN-MetaCortex',
            role: ArbiterRole.CONDUCTOR,
            capabilities: [
                ArbiterCapability.HIGH_LEVEL_PLANNING,
                ArbiterCapability.INTEGRATE_SYSTEMS,
                ArbiterCapability.MONITOR_HEALTH
            ]
        });

        this.broker = messageBroker;
        this.quadBrain = opts.quadBrain || null;
        this.isActive = false;
        
        // Long-term history of the entire GMN (Era summaries)
        this.eraHistory = [];
    }

    async onInitialize() {
        // Monitor for Anomaly events
        messageBroker.subscribe('system.anomaly', (env) => this._onNetworkAnomaly(env));
        messageBroker.subscribe('gmn.publication', (env) => this._onEraCompletion(env));
        
        this.log('info', 'Meta-Cortex (Macro-Brain) in Sleep Mode. Awaiting anomaly or seasonal trigger.');
    }

    /**
     * Wakes up when a major network event is detected
     */
    async _onNetworkAnomaly(event) {
        this.log('warn', `🚨 Meta-Cortex WAKING UP: Anomaly detected - ${event.payload.type}`);
        this.isActive = true;

        const analysisPrompt = `
You are the SOMA META-CORTEX (Macro-Brain).
The Graymatter Network has detected an anomaly: ${JSON.stringify(event.payload)}

TASK:
1. Analyze if this is a localized failure or a systemic network threat.
2. Formulate a global mitigation strategy for all 1,000+ nodes.
3. Broadcast a 'Macro-Directive' to the network.`;

        const result = await this.quadBrain.reason(analysisPrompt, 'strategic');
        
        this.log('success', 'Macro-Directive generated. Broadcasting to GMN peers.');
        await messageBroker.publish('gmn.macro_directive', {
            type: 'mitigation',
            directive: result.text,
            origin: this.name
        });

        this.isActive = false; // Return to sleep
    }

    async _onEraCompletion(publication) {
        // Record Era progress for long-term memory
        this.eraHistory.push({
            era: publication.payload.era,
            timestamp: Date.now(),
            fractalCount: publication.payload.wisdom.length
        });
    }

    getStatus() {
        return {
            ...super.getStatus(),
            isAwake: this.isActive,
            erasObserved: this.eraHistory.length
        };
    }
}

export default MetaCortexArbiter;
