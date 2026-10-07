/**
 * arbiters/DiscoverySwarm.js
 * 
 * Capability invention layer.
 * Creates new tools and arbiters autonomously based on system gaps.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import CapabilityRegistry from '../core/CapabilityRegistry.js';

export class DiscoverySwarm extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'DiscoverySwarm',
            role: ArbiterRole.SCOUT,
            capabilities: [ArbiterCapability.PATTERN_RECOGNITION, ArbiterCapability.CODE_GENERATION]
        });

        this.engineering = opts.engineering || null;
        this.quadBrain = opts.quadBrain || null;
    }

    /**
     * Observe the system context and generate ideas for new capabilities
     */
    async generateIdeas(context) {
        if (!this.quadBrain) throw new Error("Brain not available for discovery");

        this.auditLogger.info("🔎 Scanning for capability gaps...");
        const prompt = `You are the DISCOVERY SWARM. Analyze the current system context:
        ${JSON.stringify(context, null, 2)}
        
        Identify 3 new tools or arbiters that would significantly expand SOMA's capabilities.
        
        Return ONLY JSON:
        { 
          "ideas": [
            { "name": "...", "description": "...", "priority": 0.9, "type": "tool|arbiter" }
          ]
        }`;

        const result = await this.quadBrain.reason(prompt, { brain: 'AURORA' });
        try {
            const jsonMatch = result.text.match(/\{[\s\S]*\}/s);
            if (!jsonMatch) return [];
            return JSON.parse(jsonMatch[0]).ideas;
        } catch (e) {
            this.auditLogger.error(`[Discovery] Failed to parse ideas: ${e.message}`);
            return [];
        }
    }

    /**
     * Prototype a new idea using the engineering swarm
     */
    async prototype(idea) {
        if (!this.engineering) throw new Error("Engineering swarm not available for prototyping");

        this.auditLogger.info(`🧪 Prototyping new ${idea.type}: ${idea.name}`);
        
        const folder = idea.type === 'arbiter' ? 'arbiters/' : 'tools/';
        const filename = `${idea.name}.js`;
        
        const result = await this.engineering.modifyCode(
            folder + filename,
            `Create a new ${idea.type} named ${idea.name} that ${idea.description}. Follow SOMA architectural patterns.`
        );

        if (result.success) {
            CapabilityRegistry.register(idea.name, {
                type: idea.type,
                description: idea.description,
                path: folder + filename
            });
        }

        return result;
    }
}

export default DiscoverySwarm;
