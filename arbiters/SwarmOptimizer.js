/**
 * arbiters/SwarmOptimizer.js
 * 
 * Self-improvement loop for the Engineering Swarm.
 * Allows the swarm to analyze its own performance and evolve.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

export class SwarmOptimizer extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'SwarmOptimizer',
            role: ArbiterRole.ANALYST,
            capabilities: [ArbiterCapability.ANALYSIS, ArbiterCapability.MONITOR_PERFORMANCE]
        });

        this.swarm = opts.swarm || null;
        this.history = [];
    }

    /**
     * Record a swarm event for later analysis
     */
    record(event) {
        this.history.push({
            ...event,
            timestamp: Date.now()
        });
        
        if (this.history.length > 100) {
            this.history.shift(); // Keep only recent history
        }
    }

    /**
     * Analyze recent swarm performance
     */
    async analyze() {
        const failures = this.history.filter(x => !x.success);
        const successes = this.history.filter(x => x.success);
        
        const avgDuration = successes.length > 0 
            ? successes.reduce((sum, x) => sum + parseFloat(x.duration || 0), 0) / successes.length 
            : 0;

        return {
            totalRuns: this.history.length,
            successCount: successes.length,
            failureCount: failures.length,
            successRate: this.history.length > 0 ? (successes.length / this.history.length) : 1,
            avgDuration: avgDuration.toFixed(2) + 's',
            recentFailures: failures.slice(-5)
        };
    }

    /**
     * Propose and apply an improvement to the swarm's own code
     */
    async improve() {
        if (!this.swarm || !this.quadBrain) {
            throw new Error("Swarm or Brain not available for optimization");
        }

        this.auditLogger.info("🔄 Starting Swarm Self-Improvement cycle...");
        const stats = await this.analyze();

        const prompt = `You are the SWARM OPTIMIZER. Analyze these performance stats:
        ${JSON.stringify(stats, null, 2)}
        
        Based on recent failures or bottlenecks, suggest a specific improvement to the EngineeringSwarmArbiter or related core components.
        
        Return JSON:
        { 
          "reasoning": "...", 
          "filepath": "arbiters/EngineeringSwarmArbiter.js", 
          "request": "Implement X to fix Y" 
        }`;

        const result = await this.quadBrain.reason(prompt, { brain: 'LOGOS' });
        try {
            const jsonMatch = result.text.match(/\{[\s\S]*\}/s);
            if (!jsonMatch) throw new Error("Optimizer produced no JSON");
            
            const plan = JSON.parse(jsonMatch[0]);
            this.auditLogger.info(`📈 Improvement proposed: ${plan.request}`);
            
            // Trigger the swarm to modify itself!
            return await this.swarm.modifyCode(plan.filepath, plan.request);
        } catch (e) {
            this.auditLogger.error(`[Optimizer] Failed to parse improvement plan: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
}

export default SwarmOptimizer;
