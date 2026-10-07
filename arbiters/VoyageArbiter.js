/**
 * VoyageArbiter.js
 * 
 * SOMA's Physical Hands for the Poseidon Protocol.
 * Translates intent (chat) into physical voyage files on disk.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

export class VoyageArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'VoyageArbiter',
            role: ArbiterRole.ARCHITECT,
            capabilities: [
                ArbiterCapability.ORCHESTRATOR,
                ArbiterCapability.PERSISTENT_MEMORY
            ]
        });

        this.odyssey = opts.odyssey || null;
        this.trident = opts.trident || null;
    }

    async onInitialize() {
        if (!this.odyssey) {
            console.error(`[${this.name}] ❌ Odyssey Navigator not provided.`);
            return;
        }

        // 🔱 Listen for Voyage Initiation signals from the brain
        this.messageBroker.subscribe('voyage.initiate', async (envelope) => {
            const { title, milestones, voyageId } = envelope.payload;
            
            // Physical Probe for Arbiter Reception
            fs.appendFileSync(path.join(process.cwd(), 'HANDS_RECEIVED.txt'), `[${new Date().toISOString()}] Signal received: ${title}\n`);
            
            this.auditLogger.info(`[VoyageArbiter] 🔱 Physically charting voyage: ${title}`);
            
            try {
                this.odyssey.define(voyageId || `voyage-${Date.now()}`, title, milestones);
                this.auditLogger.success(`[VoyageArbiter] ✅ Voyage committed to disk.`);
            } catch (err) {
                this.auditLogger.error(`[VoyageArbiter] ❌ Physical commit failed: ${err.message}`);
            }
        });

        this.auditLogger.success(`[${this.name}] 🔱 Physical Navigation Hands (ONLINE)`);
    }
}

export default VoyageArbiter;
