import { BaseArbiter } from '../core/BaseArbiter.js';

/**
 * ProactivePerceptionArbiter
 * v0.1 — Gives SOMA "Proactive Curiosity" based on visual data.
 * Listens for location changes and unrecognized entities.
 */
export class ProactivePerceptionArbiter extends BaseArbiter {
  constructor(config = {}) {
    super({
      name: 'ProactivePerceptionArbiter',
      role: 'personality',
      capabilities: ['proactive-engagement', 'context-awareness'],
      ...config
    });

    this._lastProactiveTime = 0;
    this._cooldown = 60000 * 5; // 5 minute cooldown for autonomous speech
  }

  async onInitialize() {
    console.log('[ProactivePerception] 🧠 Neural curiosity active.');
    
    if (this.broker) {
      await this.broker.subscribe('location_changed', this.handleLocationChange.bind(this));
      await this.broker.subscribe('person_recognized', this.handlePersonRecognized.bind(this));
      await this.broker.subscribe('context_primed', this.handleContextPrimed.bind(this));
    }

    // Access to MnemonicArbiter for pre-fetching
    this.mnemonic = this.config.mnemonicArbiter || null;
    this.identity = this.config.identityArbiter || null;
    this._lastContextType = null;
  }

  async handleContextPrimed(message) {
    const { contextType, triggerLabel } = message.payload || message;
    const now = Date.now();

    if (contextType === this._lastContextType && now - this._lastProactiveTime < 60000) return;
    this._lastContextType = contextType;
    this._lastProactiveTime = now;

    console.log(`[ProactivePerception] 👁️  Visual Context detected: ${contextType} (${triggerLabel}). Pre-fetching memories...`);

    const contextQueries = {
        'engineering_workspace': 'code engineering terminal workspace development architecture',
        'development_context': 'javascript nodejs react programming development',
        'financial_analysis': 'finance trading portfolio market stocks crypto',
        'data_visualization': 'charts graphs data analysis trends'
    };

    const query = contextQueries[contextType] || triggerLabel;

    if (this.mnemonic && this.mnemonic.recall) {
        try {
            // Pre-fetch memories to warm up the hot cache
            const memories = await this.mnemonic.recall(query, 5);
            
            // Stage the context for the next reasoning cycle
            if (memories?.results?.length > 0) {
                const contextSummary = memories.results.map(m => m.content?.substring(0, 150)).join('\n');
                
                // 1. Publish signal (for other systems)
                await this.broker.publish('context_staged', {
                    type: 'visual_perception',
                    domain: contextType,
                    summary: contextSummary,
                    timestamp: now
                });
                
                // 2. Physically stage in IdentityArbiter (for conversation injection)
                if (this.identity && this.identity.stageContext) {
                    this.identity.stageContext(contextType, contextSummary);
                }
                
                console.log(`[ProactivePerception] ✅ Context staged for domain: ${contextType}`);
            }
        } catch (err) {
            console.warn(`[ProactivePerception] Pre-fetch failed: ${err.message}`);
        }
    }
  }

  async handleLocationChange(message) {
    const { location, type } = message.payload || message;
    const now = Date.now();

    if (now - this._lastProactiveTime < this._cooldown) return;

    if (type === 'discovery') {
        console.log(`[ProactivePerception] 📍 New location detected: ${location.name}. Triggering inquiry.`);
        this._lastProactiveTime = now;
        
        await this.broker.publish('vocal_synthesis_requested', {
            text: `I notice the surroundings have changed. This looks like a new environment. What are we working on here?`,
            emotion: 'curious',
            source: 'proactive-perception'
        });
    }
  }

  async handlePersonRecognized(message) {
    const { name, isCreator, confidence } = message.payload || message;
    const now = Date.now();

    if (now - this._lastProactiveTime < this._cooldown) return;

    if (!isCreator && confidence > 0.8) {
        console.log(`[ProactivePerception] 👤 Guest detected: ${name}. Triggering greeting.`);
        this._lastProactiveTime = now;

        await this.broker.publish('vocal_synthesis_requested', {
            text: `I see someone else is with you. Hello. I am SOMA.`,
            emotion: 'friendly',
            source: 'proactive-perception'
        });
    }
  }
}

export default ProactivePerceptionArbiter;
