/**
 * daemons/OptimizationDaemon.js
 * 
 * Sensory neuron that triggers the SwarmOptimizer.
 */

import BaseDaemon from './BaseDaemon.js';

export class OptimizationDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({
            ...config,
            interval: config.intervalMs || 3600000 // Hourly optimization check
        });
        this.optimizer = config.optimizer;
    }

    async tick() {
        if (!this.optimizer) return;
        
        this.logger.info("[OptimizationDaemon] Checking for swarm optimization opportunities...");
        try {
            const result = await this.optimizer.analyze();
            if (result.successRate < 0.8 && result.totalRuns > 5) {
                this.emitSignal('swarm.optimization.needed', result, 'high');
                // Auto-trigger improvement if permitted
                // await this.optimizer.improve();
            } else {
                this.emitSignal('swarm.health.report', result, 'low');
            }
        } catch (e) {
            this.logger.error(`[OptimizationDaemon] Analysis failed: ${e.message}`);
        }
    }
}

export default OptimizationDaemon;
