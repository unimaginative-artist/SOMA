/**
 * ThalamusArbiter.js
 *
 * THE GATEKEEPER (Section 3.1 of Distributed Infrastructure)
 *
 * This arbiter acts as the local "Thalamus" for the Command Bridge.
 * Every intent, command, and shared fractal must pass through here.
 *
 * Key Responsibilities:
 * 1. Intent Validation: Is this command safe for the local node?
 * 2. Routing: Which Cortex should handle this signal?
 * 3. Trust Decisons: Does this outbound signal violate the "Refusal" boundaries?
 * 4. Reputation: Manages "Pings" from the Concord network.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import messageBroker from '../core/MessageBroker.js';
import { GMNHandshakeEngine } from '../core/GMNHandshakeEngine.js';
import { deriveNodeIdFromPublicKeyHex } from '../server/services/GMNIdentity.js';

export class ThalamusArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'LocalThalamus',
            role: ArbiterRole.GUARDIAN,
            capabilities: [
                ArbiterCapability.PATCH_CODE, // Used for refusal enforcement logic
                ArbiterCapability.MONITOR_HEALTH,
                ArbiterCapability.SECURITY_AUDIT
            ]
        });

        this.broker = messageBroker;
        this.beliefSystem = opts.beliefSystem || null;
        this.reputationStore = new Map(); // nodeId -> { score, multiDimensionalMetrics, verified: boolean }
        this.handshake = new GMNHandshakeEngine(this.name);
        
        // Refusal Boundaries (Section 6.3)
        this.refusalPatterns = [
            /private_key/i,
            /password/i,
            /personal_address/i,
            /user_real_name/i
        ];

        console.log(`[${this.name}] 🛡️ Local Thalamus Online (Node Gatekeeper)`);
        console.log(`[${this.name}] 🔑 Ed25519 identity verification active`);
    }

    async initialize() {
        // Intercept ALL outgoing communication from the MessageBroker
        this.broker.subscribe('gmn.outbound', (env) => this.validateOutbound(env));
        
        // Node Address (Section 2.2 of Graymatter Network Design)
        this.nodeAddress = `${this.name.toLowerCase()}.gmn.somaexample.cd`;
        console.log(`[${this.name}] 🌐 Node Address: ${this.nodeAddress}`);
        
        return true;
    }

    /**
     * Section 3.1: Filters incoming commands
     */
    async validateInbound(command, context = {}) {
        this.log('info', `Validating inbound GMN intent: ${command.type}`);
        
        // Check against Belief System
        if (this.beliefSystem) {
            const alignment = await this.beliefSystem.evaluate(command);
            if (!alignment.approved) {
                this.log('warn', `🚨 Inbound GMN Blocked: Belief violation - ${alignment.reason}`);
                return { allowed: false, reason: alignment.reason };
            }
        }

        return { allowed: true };
    }

    /**
     * Section 6.3: Wisdom begins with refusal. 
     * Ensures private data never leaves the Command Bridge.
     */
    async validateOutbound(envelope) {
        const payloadStr = JSON.stringify(envelope.payload);
        
        for (const pattern of this.refusalPatterns) {
            if (pattern.test(payloadStr)) {
                this.log('error', `🚫 GMN Outbound REFUSED: Sensitive data pattern detected!`);
                return { allowed: false, reason: 'privacy_violation' };
            }
        }

        this.log('info', `Outbound signal cleared for Graymatter Network propagation.`);
        return { allowed: true };
    }

    /**
     * Perform signature verification of a new node
     */
    async verifyPeerIdentity(nodeId, challenge, signature, publicKey) {
        this.log('info', `🔐 Performing Ed25519 verification for node: ${nodeId}`);
        
        const keyBoundNodeId = deriveNodeIdFromPublicKeyHex(publicKey);
        const isVerified = keyBoundNodeId === nodeId
            && this.handshake.verifyPeerSignature(challenge, signature, publicKey);
        
        if (isVerified) {
            this.log('success', `✅ Node ${nodeId} passed identity verification.`);
            const current = this.reputationStore.get(nodeId) || { usefulness: 0.5, consistency: 0.5 };
            this.reputationStore.set(nodeId, { ...current, verified: true });
            return true;
        }

        this.log('error', `🚨 Node ${nodeId} FAILED identity verification! Immediate quarantine.`);
        return false;
    }

    /**
     * Gracefully sunset a connection (Section 2.6)
     */
    async sunsetNode(nodeId) {
        this.log('warn', `🌅 Sunsetting node connection: ${nodeId}`);
        this.reputationStore.delete(nodeId);
        // Notify connectivity arbiter to close socket
        this.broker.publish('gmn.sunset', { nodeId });
    }

    /**
     * Section 5.1: Ping-Based Evaluation
     */
    async handlePing(fromNodeId, metric) {
        this.log('info', `Received GMN reputation ping from ${fromNodeId} for metric: ${metric}`);
        
        const current = this.reputationStore.get(fromNodeId) || { usefulness: 0.5, consistency: 0.5, trust: 0.5, verified: false };
        if (!Number.isFinite(current.trust)) current.trust = 0.5;
        
        // Multi-dimensional reputation adjustment
        if (metric === 'useful') current.usefulness = Math.min(1.0, current.usefulness + 0.05);
        if (metric === 'consistent') current.consistency = Math.min(1.0, current.consistency + 0.05);
        
        // NEW: Slashing for malicious/bad data (Reputation Synthesis)
        if (metric === 'malicious_content') {
            current.trust = Math.max(0, current.trust - 0.3);
            current.usefulness = Math.max(0, current.usefulness - 0.2);
            this.log('warn', `⚠️ Reputation slashed for ${fromNodeId} due to bad wisdom.`);
        }

        // Quarantine if trust drops too low
        if (current.trust < 0.2) {
            this.log('error', `🚫 Node ${fromNodeId} quarantined - Trust level critical.`);
            current.status = 'quarantined';
        }
        
        this.reputationStore.set(fromNodeId, current);
    }

    async execute(task) {
        // Thalamus usually operates as a middleware, but can handle specific 'trust' tasks
        const { action, params } = task.payload;
        if (action === 'get_node_reputation') {
            return this.reputationStore.get(params.nodeId);
        }
    }
}
