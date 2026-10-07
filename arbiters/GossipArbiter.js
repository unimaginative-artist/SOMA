import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import crypto from 'node:crypto';

/**
 * GossipArbiter - "The Protective Nervous System"
 * 
 * Propagates validated patterns and threat signals across the network.
 * Implements "Gossip as a Protective Nervous System".
 */
export class GossipArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'GossipArbiter',
            role: ArbiterRole.CONDUCTOR,
            capabilities: [
                'network_access',
                'pattern-recognition'
            ],
            ...config
        });

        this.knownThreats = new Set();
        this.validatedPatterns = new Map();
    }

    async onInitialize() {
        this.auditLogger.info('📡 Gossip protocols active. Ripple-learning enabled.');
        
        if (this.messageBroker) {
            // Listen for local threat discoveries
            this.messageBroker.subscribe('security:threat_discovered', this.handleLocalThreat.bind(this));
            
            // Listen for network ripples (Gossip from other potential nodes)
            this.messageBroker.subscribe('network:gossip', this.handleNetworkRipple.bind(this));
        }
    }

    /**
     * Local discovery -> Ripple outward
     */
    async handleLocalThreat(data) {
        if (this.knownThreats.has(data.signature)) return;

        this.auditLogger.info(`📢 Gossiping local threat pattern: ${data.signature}`);
        this.knownThreats.add(data.signature);

        // 1. Ripple locally (other local arbiters)
        this.messageBroker.publish('network:gossip', {
            type: 'THREAT_PATTERN',
            signature: data.signature,
            severity: data.severity,
            origin: this.name,
            timestamp: Date.now()
        });

        // 2. Ripple GLOBALLY (Viral Spread to other SOMA nodes via GMN)
        this.messageBroker.publish('gmn.publication', {
            type: 'THREAT_RIPPLE',
            id: crypto.randomUUID(),
            sourceAddress: this.name,
            signature: data.signature,
            severity: data.severity
        });
    }

    /**
     * Network discovery -> Protect local node
     */
    async handleNetworkRipple(data) {
        if (data.origin === this.name) return; // Ignore own echoes

        this.auditLogger.info(`👂 Received Gossip Ripple: ${data.type} from ${data.origin}`);

        if (data.type === 'THREAT_PATTERN') {
            this.knownThreats.add(data.signature);
            // Alert the Security Council to update their Voight-Kampff heuristics
            this.messageBroker.publish('security:update_heuristics', {
                pattern: data.signature,
                source: 'GOSSIP_NETWORK'
            });
        }
    }

    /**
     * Share Wisdom (Causal Rules)
     */
    async rippleWisdom(pattern, logic) {
        this.messageBroker.publish('network:gossip', {
            type: 'WISDOM_PATTERN',
            pattern,
            logic,
            origin: this.name
        });
    }
}

export default GossipArbiter;
