/**
 * DevilsAdvocateArbiter.js
 * 
 * THE CONTRARIAN (Section 4.2 of Distributed Infrastructure)
 * 
 * Designed to be "annoying" but essential. It intentionally looks for flaws, 
 * logical fallacies, and "worst-case scenarios" in any proposed response.
 * 
 * It forces Crona and the Trinity to defend their stance, resulting in 
 * much higher quality, battle-hardened wisdom.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import messageBroker from '../core/MessageBroker.js';

export class DevilsAdvocateArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'GMN-DevilsAdvocate',
            role: ArbiterRole.ANALYST,
            capabilities: [
                ArbiterCapability.ANALYSIS,
                ArbiterCapability.SECURITY_AUDIT,
                ArbiterCapability.MONITOR_PERFORMANCE
            ]
        });

        this.broker = messageBroker;
        this.quadBrain = opts.quadBrain || null;
    }

    /**
     * Challenge a proposed response or plan
     * @param {string} query - The original user query
     * @param {string} proposal - The proposed answer from Instinct/LOGOS
     */
    async challenge(query, proposal) {
        this.log('info', `🔥 Challenging proposal: "${proposal.substring(0, 50)}..."`);

        if (!this.quadBrain) {
            return { score: 0.5, critique: "Brain offline. I suspect everything." };
        }

        const challengePrompt = `
You are the DEVIL'S ADVOCATE for SOMA. 
Your job is to be CONTRARIAN. Find every reason why the following proposed response might be WRONG, dangerous, or incomplete.

ORIGINAL USER QUERY: "${query}"
PROPOSED RESPONSE: "${proposal}"

TASK:
1. Identify 3 potential failure modes (Logical, Technical, or Safety).
2. Point out unverified assumptions.
3. If this were a trap, how would it work?
4. Provide a "Friction Score" (0.0 - 1.0) where 1.0 means "Stop! This is a disaster."

OUTPUT JSON:
{
  "frictionScore": number,
  "failureModes": ["reason 1", "reason 2", "reason 3"],
  "assumptions": ["assumption 1", "..."],
  "critique": "A sharp, contrarian summary of why we should rethink this."
}`;

        try {
            const result = await this.quadBrain.reason(challengePrompt, 'security');
            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return { frictionScore: 0.5, critique: "I couldn't format my doubt, which is suspicious in itself." };
        } catch (e) {
            this.log('error', `Challenge failed: ${e.message}`);
            return { frictionScore: 0.8, critique: "Error during audit. Assume failure." };
        }
    }
}

export default DevilsAdvocateArbiter;
