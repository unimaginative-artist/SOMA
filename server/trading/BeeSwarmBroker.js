/**
 * BeeSwarmBroker.js
 *
 * Central Nervous System (CNS) bridge for SOMA BeeBots.
 * Connects the System 1 reflex trading engine to SOMA's central MessageBroker.
 *
 * Responsibilities:
 *  - Broadcasts live bee executions, trade closures, and micro volatility shocks
 *  - Ingests top-down macro biases from AutonomousTrader (System 2 Strategic Council)
 *  - Ingests market regime shifts from MarketRegimeDetector
 *  - Honors enterprise-wide circuit breaker halts from RiskManager/Guardrails
 */

import messageBroker, { publish, subscribe } from '../../core/MessageBroker.js';

export const TOPICS = {
    HIVE_TRADE_OPEN: 'trading:hive:trade_opened',
    HIVE_TRADE_CLOSE: 'trading:hive:trade_closed',
    HIVE_VOLATILITY: 'trading:hive:volatility_alert',
    HIVE_HEARTBEAT: 'trading:hive:heartbeat',
    MACRO_BIAS: 'trading:macro:bias',
    REGIME_CHANGED: 'trading:regime:changed',
    GUARDRAILS_HALT: 'trading:guardrails:halt'
};

export class BeeSwarmBroker {
    constructor(options = {}) {
        this.broker = options.broker || messageBroker;
        this.publishFn = options.publish || publish;
        this.subscribeFn = options.subscribe || subscribe;

        this.latestMacroBias = {}; // symbol -> { bias: 'BULLISH'|'BEARISH'|'NEUTRAL', reason, timestamp }
        this.latestRegime = { regime: 'RANGING', confidence: 0.5 };
        this.isHalted = false;
        this.haltReason = null;

        this.unsubscribeFns = [];
        this._setupSubscriptions();
    }

    _setupSubscriptions() {
        try {
            // 1. Listen for macro bias from AutonomousTrader / Council
            const unsubMacro = this.subscribeFn(TOPICS.MACRO_BIAS, (envelope) => {
                const data = envelope?.data || envelope?.payload || envelope;
                if (data && data.symbol) {
                    this.latestMacroBias[data.symbol] = {
                        bias: data.bias || 'NEUTRAL',
                        timeframe: data.timeframe || '1D',
                        reason: data.reason || 'Council macro consensus',
                        timestamp: data.timestamp || new Date().toISOString()
                    };
                    console.log(`[BeeSwarmBroker] 📡 Ingested Macro Bias for ${data.symbol}: ${data.bias}`);
                }
            });
            if (typeof unsubMacro === 'function') this.unsubscribeFns.push(unsubMacro);

            // 2. Listen for regime updates from MarketRegimeDetector
            const unsubRegime = this.subscribeFn(TOPICS.REGIME_CHANGED, (envelope) => {
                const data = envelope?.data || envelope?.payload || envelope;
                if (data && data.regime) {
                    this.latestRegime = {
                        regime: data.regime,
                        confidence: data.confidence ?? 0.5,
                        symbol: data.symbol || 'SPY',
                        timestamp: data.timestamp || new Date().toISOString()
                    };
                    console.log(`[BeeSwarmBroker] 🧭 Ingested Regime Shift: ${data.regime} (conf: ${data.confidence})`);
                }
            });
            if (typeof unsubRegime === 'function') this.unsubscribeFns.push(unsubRegime);

            // 3. Listen for enterprise-wide risk halt
            const unsubHalt = this.subscribeFn(TOPICS.GUARDRAILS_HALT, (envelope) => {
                const data = envelope?.data || envelope?.payload || envelope;
                this.isHalted = true;
                this.haltReason = data?.reason || 'Enterprise risk threshold breached';
                console.warn(`[BeeSwarmBroker] 🚨 EMERGENCY HALT RECEIVED: ${this.haltReason}`);
            });
            if (typeof unsubHalt === 'function') this.unsubscribeFns.push(unsubHalt);

        } catch (err) {
            console.warn('[BeeSwarmBroker] Error setting up broker subscriptions:', err.message);
        }
    }

    /**
     * Broadcast newly opened trade across SOMA Central Nervous System
     */
    async publishTradeOpen(tradeData) {
        try {
            return await this.publishFn(TOPICS.HIVE_TRADE_OPEN, {
                event: 'TRADE_OPENED',
                timestamp: new Date().toISOString(),
                ...tradeData
            });
        } catch (err) {
            console.error('[BeeSwarmBroker] Failed to publish trade open:', err.message);
            return 0;
        }
    }

    /**
     * Broadcast closed trade receipt across SOMA Central Nervous System
     */
    async publishTradeClose(tradeReceipt) {
        try {
            return await this.publishFn(TOPICS.HIVE_TRADE_CLOSE, {
                event: 'TRADE_CLOSED',
                timestamp: new Date().toISOString(),
                ...tradeReceipt
            });
        } catch (err) {
            console.error('[BeeSwarmBroker] Failed to publish trade close:', err.message);
            return 0;
        }
    }

    /**
     * Broadcast micro-volatility or funding anomaly detected on OKX
     */
    async publishVolatilityAlert(alertData) {
        try {
            return await this.publishFn(TOPICS.HIVE_VOLATILITY, {
                event: 'MICRO_VOLATILITY_ALERT',
                source: 'SOMA_BEEBOTS_OKX',
                timestamp: new Date().toISOString(),
                ...alertData
            });
        } catch (err) {
            console.error('[BeeSwarmBroker] Failed to publish volatility alert:', err.message);
            return 0;
        }
    }

    /**
     * Broadcast heartbeat telemetry
     */
    async publishHeartbeat(summary) {
        try {
            return await this.publishFn(TOPICS.HIVE_HEARTBEAT, {
                timestamp: new Date().toISOString(),
                ...summary
            });
        } catch (err) {
            return 0;
        }
    }

    /**
     * Get macro bias for a specific symbol or base asset
     */
    getMacroBias(symbol) {
        if (!symbol) return null;
        const norm = symbol.toUpperCase().replace(/\//g, '-');
        if (this.latestMacroBias[norm]) return this.latestMacroBias[norm];
        // Check base asset (e.g. BTC from BTC-USDT-SWAP)
        const base = norm.split('-')[0];
        for (const [k, v] of Object.entries(this.latestMacroBias)) {
            if (k.startsWith(base)) return v;
        }
        return null;
    }

    destroy() {
        for (const unsub of this.unsubscribeFns) {
            try { unsub(); } catch (_) {}
        }
        this.unsubscribeFns = [];
    }
}
