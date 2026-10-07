import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * TrustRegistry - "The Social Reputation Ledger"
 * 
 * Measures the honesty, utility, and reliability of all arbiters and external nodes.
 * Implements "Trust as a First-Class Resource".
 */
export class TrustRegistry extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'TrustRegistry',
            role: ArbiterRole.GUARDIAN,
            capabilities: [
                'analysis',
                'monitor-performance'
            ],
            ...config
        });

        this.registryPath = path.join(process.cwd(), '.soma', 'trust_ledger.json');
        this.scores = new Map(); // arbiterId -> score (0.0 to 1.0)
        this.history = [];
    }

    async onInitialize() {
        await this.loadLedger();
        this.auditLogger.info('⚖️ Trust Registry online. Reliability monitoring active.');
        
        // Listen for performance/error events to adjust trust
        if (this.messageBroker) {
            this.messageBroker.subscribe('system_error', (data) => this.slash(data.source, 0.05, 'System Error'));
            this.messageBroker.subscribe('soma.critique', (data) => {
                if (!data.passed) this.slash('SomaBrain', 0.02, `Failed Critique: ${data.score}`);
                else this.reward('SomaBrain', 0.01, 'High Quality Response');
            });
        }

        // Start Trust Decay: Trust is earned, not owned.
        // Everyone loses 0.01 trust every hour. You must be "useful" to stay trusted.
        this.decayTimer = setInterval(() => this.applyDecay(), 3600000);
        this.decayTimer.unref?.();
    }

    applyDecay() {
        this.auditLogger.info('📉 Applying trust decay to all entities...');
        for (const [id, score] of this.scores.entries()) {
            if (score > 0.5) { // Only decay highly trusted entities
                const next = Math.max(0.5, score - 0.01);
                this.scores.set(id, next);
            }
        }
        this.saveLedger();
    }

    async loadLedger() {
        try {
            const data = await fs.readFile(this.registryPath, 'utf8');
            const saved = JSON.parse(data);
            Object.entries(saved).forEach(([id, score]) => this.scores.set(id, score));
        } catch (e) {
            this.auditLogger.warn('No trust ledger found. Initializing fresh scores.');
        }
    }

    async saveLedger() {
        try {
            const data = Object.fromEntries(this.scores);
            await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
            await fs.writeFile(this.registryPath, JSON.stringify(data, null, 2));
        } catch (e) {}
    }

    getScore(id) {
        // Nullish fallback is security-critical: a deliberately slashed score of
        // exactly zero must never be mistaken for an unknown, trusted entity.
        return this.scores.get(id) ?? 0.8; // Default trust 0.8
    }

    /**
     * Reward good behavior
     */
    reward(id, amount, reason) {
        const current = this.getScore(id);
        const next = Math.min(1.0, current + amount);
        this.scores.set(id, next);
        this._checkThresholds(id, next, reason);
    }

    /**
     * Slash bad behavior (Truth Decay, Manipulation, Hallucination)
     */
    slash(id, amount, reason) {
        const current = this.getScore(id);
        const next = Math.max(0.0, current - amount);
        this.scores.set(id, next);
        
        this.auditLogger.warn(`🚨 TRUST SLASHED: ${id} down to ${next.toFixed(2)} | Reason: ${reason}`);
        this._checkThresholds(id, next, reason);
        this.saveLedger();
    }

    _checkThresholds(id, score, reason) {
        if (score < 0.4 && score >= 0.2) {
            this.messageBroker.publish('security:quarantine', { target: id, level: 'CAUTION', reason });
        } else if (score < 0.2) {
            this.messageBroker.publish('security:quarantine', { target: id, level: 'ISOLATED', reason });
            this.auditLogger.error(`‼️ CRITICAL: ${id} has been ISOLATED due to trust collapse.`);
        }
    }

    getDiagnostics() {
        return {
            ledger: Object.fromEntries(this.scores),
            quarantined: Array.from(this.scores.entries()).filter(([id, s]) => s < 0.4).map(e => e[0])
        };
    }

    async shutdown() {
        if (this.decayTimer) clearInterval(this.decayTimer);
        return super.shutdown();
    }
}

export default TrustRegistry;
