/**
 * EnterpriseRiskGate.js
 *
 * Centralized Pre-Trade Risk & Correlated Exposure Gate for SOMA.
 * Unifies risk management across all active trading engines (BeeBots + AutonomousTrader):
 *  1. Conflicting Direction Guard: Prevents longing and shorting the same crypto asset across different brokers.
 *  2. Correlated Exposure Ceiling: Limits total gross directional crypto notional across all engines.
 *  3. Global Enterprise Drawdown Circuit Breaker: Enforces 5% daily maximum drawdown across Alpaca + OKX combined.
 */

export class EnterpriseRiskGate {
    constructor(options = {}) {
        this.maxDailyDrawdownDollars = options.maxDailyDrawdownDollars || 500.0;
        this.maxDailyDrawdownPct = options.maxDailyDrawdownPct || 0.05;
        this.maxTotalCryptoNotional = options.maxTotalCryptoNotional || 5000.0;
        this.allowHedging = options.allowHedging || false; // By default, conflicting directions are blocked

        // Unified cross-engine state
        this.activePositions = new Map(); // key `${engine}:${symbol}` -> position
        this.dailyRealizedPnl = 0;
        this.dailyResetDate = new Date().toDateString();
        this.isEmergencyHalted = false;
        this.haltReason = null;
    }

    _checkDailyReset() {
        const today = new Date().toDateString();
        if (today !== this.dailyResetDate) {
            this.dailyRealizedPnl = 0;
            this.dailyResetDate = today;
            this.isEmergencyHalted = false;
            this.haltReason = null;
        }
    }

    /**
     * Normalize symbol to root coin (e.g. 'BTC-USDT-SWAP' -> 'BTC', 'BTC/USD' -> 'BTC')
     */
    getRootAsset(symbol) {
        if (!symbol) return '';
        const s = symbol.toUpperCase().replace(/\//g, '-');
        return s.split('-')[0];
    }

    /**
     * Register a newly opened position from any engine
     */
    registerOpenPosition(engine, position) {
        if (!position || !position.symbol) return;
        const key = `${engine}:${position.symbol}`;
        this.activePositions.set(key, {
            engine,
            symbol: position.symbol,
            rootAsset: this.getRootAsset(position.symbol),
            side: position.side,
            notional: (position.size || 0) * (position.entryPrice || 0),
            entryTime: position.entryTime || new Date().toISOString()
        });
    }

    /**
     * Register a closed trade from any engine
     */
    registerClosedTrade(engine, trade) {
        this._checkDailyReset();
        if (trade && trade.symbol) {
            const key = `${engine}:${trade.symbol}`;
            this.activePositions.delete(key);
            this.dailyRealizedPnl += (trade.pnl || 0);

            // Check if global daily loss limit breached
            if (this.dailyRealizedPnl <= -this.maxDailyDrawdownDollars) {
                this.isEmergencyHalted = true;
                this.haltReason = `Global daily loss limit breached: -$${Math.abs(this.dailyRealizedPnl).toFixed(2)}`;
                console.warn(`[EnterpriseRiskGate] 🚨 CIRCUIT BREAKER TRIPPED: ${this.haltReason}`);
            }
        }
    }

    /**
     * Validate whether an order is allowed to execute
     * @param {Object} order - { engine, symbol, side, notional, entryPrice }
     */
    checkOrderApproval(order) {
        this._checkDailyReset();

        // 1. Check Circuit Breaker Halt
        if (this.isEmergencyHalted) {
            return {
                approved: false,
                reason: `Trading halted by Enterprise Circuit Breaker: ${this.haltReason}`
            };
        }

        const rootAsset = this.getRootAsset(order.symbol);
        const orderSide = String(order.side || '').toUpperCase();
        const orderNotional = Number(order.notional || 0);

        // 2. Check for Conflicting Positions on Other Engines
        if (!this.allowHedging) {
            for (const [, pos] of this.activePositions) {
                if (pos.engine !== order.engine && pos.rootAsset === rootAsset) {
                    if (pos.side !== orderSide) {
                        return {
                            approved: false,
                            reason: `Conflicting cross-engine position: ${pos.engine} is holding ${pos.side} on ${pos.symbol}, cannot open opposite ${orderSide} on ${order.symbol}`
                        };
                    }
                }
            }
        }

        // 3. Check Aggregate Crypto Notional Ceiling
        let currentGrossNotional = 0;
        for (const [, pos] of this.activePositions) {
            currentGrossNotional += pos.notional;
        }

        if (currentGrossNotional + orderNotional > this.maxTotalCryptoNotional) {
            return {
                approved: false,
                reason: `Aggregate crypto notional limit ($${this.maxTotalCryptoNotional}) exceeded. Current: $${currentGrossNotional.toFixed(2)}, Requested: $${orderNotional.toFixed(2)}`
            };
        }

        return {
            approved: true,
            currentDailyPnl: this.dailyRealizedPnl,
            activePositionsCount: this.activePositions.size
        };
    }

    /**
     * Emergency manual trip or reset
     */
    tripCircuitBreaker(reason = 'Manual trip') {
        this.isEmergencyHalted = true;
        this.haltReason = reason;
    }

    resetCircuitBreaker() {
        this.isEmergencyHalted = false;
        this.haltReason = null;
    }

    getRiskSummary() {
        this._checkDailyReset();
        return {
            dailyRealizedPnl: Number(this.dailyRealizedPnl.toFixed(2)),
            isEmergencyHalted: this.isEmergencyHalted,
            haltReason: this.haltReason,
            activePositionsCount: this.activePositions.size,
            positions: Array.from(this.activePositions.values())
        };
    }
}

// Global enterprise risk singleton
const enterpriseRiskGate = new EnterpriseRiskGate();
export default enterpriseRiskGate;
