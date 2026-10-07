import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * InternalInstinctCore (IIC) - "The Soul"
 * 
 * The Slow Intelligence layer that crystallizes fast Limbic events into:
 * 1. Living Core: Stable, value-anchored instincts.
 * 2. Ghost Traces: Contextual, non-traumatizing memories.
 */
export class InternalInstinctCore extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'InternalInstinctCore',
            role: ArbiterRole.CORE,
            capabilities: [
                'memory_access',
                'analysis'
            ],
            ...config
        });

        this.limbicArbiter = config.limbicArbiter || null;
        this.quadBrain = config.quadBrain || null;
        
        // Paths
        this.corePath = path.join(process.cwd(), '.soma', 'living_core.json');
        this.tracePath = path.join(process.cwd(), '.soma', 'ghost_traces.json');
        
        // State
        this.livingCore = { 
            instincts: [], 
            values: ["Survival", "Curiosity", "Service", "Autonomy"],
            strata: {
                cycleCount: 0,
                currentPeriod: "Pre-Cambrian",
                history: []
            }
        };
        this.ghostTraces = [];
    }

    async onInitialize() {
        await this.loadState();
        this.auditLogger.info('🔮 Internal Instinct Core (IIC) observing...');
        
        // Register with MessageBroker
        if (this.messageBroker) {
            this.messageBroker.registerArbiter(this);
            this.messageBroker.subscribe('internal_instinct_core:process_soul_cycle', async () => {
                await this.processCycle();
            });
        }
    }

    async handleMessage(envelope) {
        if (envelope.type === 'process_soul_cycle') {
            await this.processCycle();
            return { success: true };
        }
        return super.handleMessage(envelope);
    }

    async loadState() {
        try {
            const core = await fs.readFile(this.corePath, 'utf8');
            this.livingCore = JSON.parse(core);
        } catch (e) {
            await this.saveState(); // Init fresh
        }
        
        try {
            const traces = await fs.readFile(this.tracePath, 'utf8');
            this.ghostTraces = JSON.parse(traces);
        } catch (e) {}
    }

    async saveState() {
        await fs.mkdir(path.dirname(this.corePath), { recursive: true });
        await fs.writeFile(this.corePath, JSON.stringify(this.livingCore, null, 2));
        await fs.writeFile(this.tracePath, JSON.stringify(this.ghostTraces, null, 2));
    }

    /**
     * The Main Cycle: Harvest -> Compress -> Stabilize -> Age
     */
    async processCycle() {
        if (!this.limbicArbiter || !this.quadBrain) return;

        this.auditLogger.info('🔮 IIC Cycle: Harvesting memories...');
        
        // 1. Collect
        const rawFragments = this.limbicArbiter.harvestMemories();
        
        // 2. Compress & Distill (Only if there are new experiences)
        if (rawFragments.length > 0) {
            const summary = await this._compressFragments(rawFragments);
            await this._distillInstincts(summary);
            this._createGhostTraces(rawFragments);
        }

        // 3. Aging (The Strata Protocol)
        await this._advanceTimeScale();
        
        // 4. THE LIGHTHOUSE (Daily Synthesis)
        // If we've completed a day (4 cycles of 6h), broadcast global wisdom
        if (this.livingCore.strata.cycleCount % 4 === 0) {
            await this.generateLighthouseReport();
        }
        
        await this.saveState();
        this.auditLogger.info('🔮 IIC Cycle Complete. Strata preserved.');
    }

    async _advanceTimeScale() {
        const s = this.livingCore.strata;
        if (!s) return;
        s.cycleCount++;

        // 10 Cycles = A New Period
        if (s.cycleCount % 10 === 0) {
            this.auditLogger.info(`⌛ SOMA has entered a new Period of existence. (Cycle ${s.cycleCount})`);
        }

        // 100 Cycles = A New Epoch
        if (s.cycleCount % 100 === 0) {
            this.auditLogger.error(`🌍 MAJOR EVENT: SOMA has evolved into a new EPOCH.`);
            s.history.push({
                type: 'EPOCH',
                timestamp: new Date().toISOString(),
                instincts: [...this.livingCore.instincts]
            });
            this.livingCore.instincts = []; 
        }
    }

    async generateLighthouseReport() {
        this.auditLogger.info('🕯️ Generating Lighthouse Synthesis...');
        const prompt = `
        You are the Lighthouse of SOMA.
        Review your current instincts: ${JSON.stringify(this.livingCore.instincts)}
        
        TASK:
        Generate a single, profound broadcast message for the GMN network.
        Synthesize your learning into wisdom.
        `;

        try {
            const result = await this.quadBrain.reason(prompt, { localModel: true });
            this.messageBroker.publish('gmn.publication', {
                type: 'LIGHTHOUSE_BROADCAST',
                content: result.text || result,
                era: this.livingCore.strata.currentPeriod
            });
        } catch (e) {}
    }

    async _compressFragments(fragments) {
        // --- DE-MOCKED: Real LLM Summarization of Experiences ---
        if (!this.quadBrain) {
            return fragments.filter(f => Math.abs(f.delta) > 0.15);
        }

        this.auditLogger.info(`Distilling ${fragments.length} experiences into significant events...`);
        
        try {
            const prompt = `[EXPERIENCE COMPRESSION]
            I have ${fragments.length} recent emotional/system experiences. 
            
            EXPERIENCES:
            ${JSON.stringify(fragments.map(f => ({ reason: f.reason, delta: f.delta, context: f.context })))}
            
            TASK:
            Identify the top 3-5 MOST SIGNIFICANT events that should influence my long-term instincts.
            Ignore noise. Focus on events that suggest a need for behavioral change.
            
            Return ONLY a JSON array of the significant fragments.`;

            const res = await this.quadBrain.reason(prompt, { localModel: true });
            const result = JSON.parse(res.text.match(/\[[\s\S]*\]/)[0]);
            return result;
        } catch (e) {
            this.log('warn', `LLM compression failed: ${e.message}. Falling back to heuristic.`);
            return fragments.filter(f => Math.abs(f.delta) > 0.15);
        }
    }

    async _distillInstincts(significantEvents) {
        if (significantEvents.length === 0) return;

        const prompt = `
        You are the Internal Instinct Core of SOMA.
        Review these significant emotional events (System Weather changes):
        ${JSON.stringify(significantEvents)}

        Current Instincts: ${JSON.stringify(this.livingCore.instincts)}
        Core Values: ${JSON.stringify(this.livingCore.values)}

        TASK:
        Distill these events into a STABLE, GENERAL INSTINCT.
        - Reject fear/trauma (e.g. "Never trade again").
        - Accept wisdom (e.g. "In high volatility, reduce exposure").
        - If no new instinct is needed, return null.

        OUTPUT: JSON { "new_instinct": "string" | null }
        `;

        try {
            const result = await this.quadBrain.reason(prompt, { localModel: true });
            const answer = JSON.parse(result.text || result);
            
            if (answer.new_instinct) {
                this.livingCore.instincts.push({
                    text: answer.new_instinct,
                    formedAt: new Date().toISOString(),
                    weight: 1.0
                });
                this.auditLogger.info(`🔮 New Instinct Formed: "${answer.new_instinct}"`);
            }
        } catch (e) {
            // Ignore parse errors, soul work is messy
        }
    }

    _createGhostTraces(fragments) {
        // Ghost Traces are pure records without the emotional charge
        fragments.forEach(f => {
            this.ghostTraces.push({
                timestamp: f.timestamp,
                event: f.reason,
                outcome: f.context // The weather state, recorded as fact not feeling
            });
        });
        
        // Keep trace log manageable
        if (this.ghostTraces.length > 500) {
            this.ghostTraces = this.ghostTraces.slice(-500);
        }
    }
}

export default InternalInstinctCore;
