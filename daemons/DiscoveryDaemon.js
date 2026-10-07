/**
 * daemons/DiscoveryDaemon.js
 * 
 * Sensory neuron that triggers the DiscoverySwarm.
 */

import BaseDaemon from './BaseDaemon.js';

export class DiscoveryDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({
            ...config,
            interval: config.intervalMs || 86400000 // Daily discovery scan
        });
        this.discovery = config.discovery;
    }

    async tick() {
        if (!this.discovery) return;
        
        this.logger.info("[DiscoveryDaemon] Initiating autonomous capability scan...");
        try {
            const context = {
                timestamp: Date.now(),
                mode: 'autonomous_discovery'
            };
            
            const ideas = await this.discovery.generateIdeas(context);
            if (ideas && ideas.length > 0) {
                this.emitSignal('swarm.discovery.ideas', { ideas }, 'normal');
            }
        } catch (e) {
            this.logger.error(`[DiscoveryDaemon] Discovery failed: ${e.message}`);
        }
    }
}

export default DiscoveryDaemon;
