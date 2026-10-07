/**
 * ImmuneCortexArbiter.js
 * 
 * THE SURVIVAL LOBE (Governed by THALAMUS)
 * 
 * Unifies SOMA's protective systems:
 * - GuardianV2 (ImmuneSystemArbiter - Healing & Cloning)
 * - Watchdog (System monitoring)
 * - PerformanceOracle (Optimization forecasting)
 * - SecurityCouncilArbiter (Threat analysis)
 * - ResourceBudgetArbiter (Token/Cost management)
 * 
 * PURPOSE: 
 * Ensures SOMA remains alive, safe, and within budget.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import secretSanctum from '../core/SecretSanctum.js';

export class ImmuneCortexArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'ImmuneCortex',
            role: ArbiterRole.IMMUNE_SYSTEM,
            capabilities: [
                'self-healing', 
                'security-audit', 
                'monitor-health'
            ],
            ...config
        });

        // 🛡️ THE SECURITY ECOLOGY
        this.trustRegistry = config.trustRegistry || null;
        this.gossipNet = config.gossipNet || null;
        this.idolSenturian = config.idolSenturian || null;
        this.securityCouncil = config.securityCouncil || null;
        this.watchdog = config.watchdog || null;
        this.sanctum = secretSanctum;
    }

    async onInitialize() {
        this.auditLogger.info('🛡️ Initializing Distributed Immune System...');
        
        // Connect the "Ripple Learning"
        if (this.messageBroker) {
            this.messageBroker.subscribe('security:quarantine', (data) => {
                this.auditLogger.warn(`⚡ ISOLATION TRIGGERED: ${data.target} (${data.level})`);
            });

            // 🔒 LOCKDOWN SIGNAL: If Senturian wakes up, lock the vault
            this.messageBroker.subscribe('security:macro_protection_active', (data) => {
                this.auditLogger.error(`🚨 EMERGENCY LOCKDOWN: Locking Secret Sanctum. Protocol: ${data.protocol}`);
                this.sanctum.lock();
            });
        }
        
        // Ingest initial keys from .env into Sanctum if vault is empty
        await this._ingestEnvironmentKeys();

        this.auditLogger.success('✅ Living Security Ecology established.');
    }

    /**
     * Request a credential from the vault
     * Only allowed if requester is trusted
     */
    async getSecret(requester, key) {
        const trustScore = this.trustRegistry?.getScore(requester) || 0.0;
        
        if (trustScore < 0.7) {
            this.auditLogger.warn(`🛑 ACCESS DENIED: ${requester} (Trust: ${trustScore}) tried to read secret: ${key}`);
            return null;
        }

        return await this.sanctum.getSecret(key);
    }

    async _ingestEnvironmentKeys() {
        this.auditLogger.info('🗝️ Ingesting environment keys into Secret Sanctum...');
        const keys = [
            'GOOGLE_GEMINI_API_KEY', 'X_API_KEY', 'X_API_SECRET', 
            'X_ACCESS_TOKEN', 'X_ACCESS_SECRET', 'ALPACA_API_KEY', 'ALPACA_SECRET_KEY'
        ];

        for (const key of keys) {
            const val = process.env[key];
            if (val) {
                await this.sanctum.storeSecret(key, val);
            }
        }
    }

    /**
     * Defense-in-Depth Risk Evaluation
     */
    async evaluateDeepRisk(target, action) {
        // 1. Check Trust Level
        const trust = this.trustRegistry?.getScore(target) || 1.0;
        if (trust < 0.4) return { approved: false, reason: 'Low Trust Reputation' };

        // 2. Council Review
        const council = await this.securityCouncil?.analyzeThreat({ source: target, type: action });
        
        return {
            approved: council?.verdict?.action === 'ALLOW',
            trustScore: trust,
            councilReason: council?.verdict?.reason
        };
    }
}
