/**
 * BeeAutonomicTuner.js
 *
 * Autonomic Self-Optimization & Edge-Enhancement Engine for SOMA BeeBots.
 * Empowers SOMA to autonomously adapt strategy parameters, conviction gates,
 * and directional risk controls based on rolling trade outcomes and HTF trends:
 *
 *  1. Anti-Revenge Cooldown:
 *     Enforces a 30-minute lockout on the same symbol & side after a STOP_LOSS.
 *
 *  2. Autonomic Drawdown & Streak Adaptation:
 *     - If a bee has >= 2 consecutive losses:
 *       * Escalates required conviction to Level 3 (Strong / Textbook only)
 *       * Halves risk budget per trade (2% -> 1%)
 *       * Stretches mean-reversion RSI bands (30/70 -> 24/76) to only catch extreme blowouts
 *     - When a bee recovers with 2+ consecutive wins:
 *       * Normalizes conviction bar back to Level 2 and restores standard 2% risk.
 *
 *  3. Higher-Timeframe (HTF) Trend Protection:
 *     - In a Bullish HTF (1H EMA12 > EMA26 and Supertrend Bullish):
 *       * Suppresses counter-trend SHORT fades unless in extreme blowout (RSI > 78)
 *       * Favor dip-buying with expanded take-profit
 *     - In a Bearish HTF (1H EMA12 < EMA26 and Supertrend Bearish):
 *       * Suppresses counter-trend LONG dip-buys unless in extreme crash exhaustion (RSI < 22)
 *       * Favor relief-rally shorting
 */

export class BeeAutonomicTuner {
    constructor(options = {}) {
        this.stopLossCooldownMs = options.stopLossCooldownMs || 30 * 60 * 1000; // 30 minutes
        this.cooldowns = new Map(); // key: `${symbol}_${side}` -> timestamp ms

        // Dynamic parameter state per bee
        this.tuning = {
            bizzy: {
                consecutiveLosses: 0,
                consecutiveWins: 0,
                minConviction: 2,
                riskPerTradePct: 0.02,
                status: 'NORMAL'
            },
            boozy: {
                consecutiveLosses: 0,
                consecutiveWins: 0,
                minConviction: 2,
                riskPerTradePct: 0.02,
                rsiOversold: 30,
                rsiOverbought: 70,
                status: 'NORMAL'
            },
            breezy: {
                consecutiveLosses: 0,
                consecutiveWins: 0,
                minConviction: 2,
                riskPerTradePct: 0.02,
                status: 'NORMAL'
            }
        };

        if (options.initialTuning) {
            this.loadState(options.initialTuning);
        }
    }

    /**
     * Load persisted tuning state
     */
    loadState(savedTuning = {}) {
        for (const [beeKey, params] of Object.entries(savedTuning)) {
            if (this.tuning[beeKey]) {
                this.tuning[beeKey] = { ...this.tuning[beeKey], ...params };
            }
        }
    }

    /**
     * Export tuning state for ledger persistence
     */
    getState() {
        return JSON.parse(JSON.stringify(this.tuning));
    }

    /**
     * Check if a symbol and side are in an active post-stop-loss cooldown
     */
    isUnderCooldown(symbol, side) {
        const key = `${symbol}_${side}`;
        const expiresAt = this.cooldowns.get(key);
        if (!expiresAt) return { active: false };

        const now = Date.now();
        if (now < expiresAt) {
            const remainingMins = Math.ceil((expiresAt - now) / 60000);
            return {
                active: true,
                remainingMins,
                reason: `Post-stop cooldown active on ${symbol} ${side} (${remainingMins}m remaining)`
            };
        }

        this.cooldowns.delete(key);
        return { active: false };
    }

    /**
     * Update autonomic tuning on every closed trade
     */
    registerClosedTrade(trade) {
        if (!trade || !trade.bee) return;
        const beeKey = trade.bee;
        const t = this.tuning[beeKey];
        if (!t) return;

        const isLoss = (trade.pnl || 0) < 0 || trade.exitReason === 'STOP_LOSS';

        if (trade.exitReason === 'STOP_LOSS') {
            // Engage anti-revenge cooldown on this symbol and side
            const key = `${trade.symbol}_${trade.side}`;
            this.cooldowns.set(key, Date.now() + this.stopLossCooldownMs);
        }

        if (isLoss) {
            t.consecutiveLosses += 1;
            t.consecutiveWins = 0;

            // Defensive tightening if taking repeated hits
            if (t.consecutiveLosses >= 2) {
                t.minConviction = 3; // Demand pristine conviction only
                t.riskPerTradePct = 0.01; // Cut risk in half
                t.status = 'DEFENSIVE';

                if (beeKey === 'boozy') {
                    // Widen mean-reversion bands so we only fade extreme blowouts
                    t.rsiOversold = 24;
                    t.rsiOverbought = 76;
                }
            }
        } else {
            t.consecutiveWins += 1;
            t.consecutiveLosses = 0;

            // Normalize parameters upon sustained performance
            if (t.consecutiveWins >= 2) {
                t.minConviction = Math.max(2, t.baseMinConviction ?? 2);
                t.riskPerTradePct = Math.min(0.02, t.baseRiskPerTradePct ?? 0.02);
                t.status = 'NORMAL';

                if (beeKey === 'boozy') {
                    t.rsiOversold = t.baseRsiOversold ?? 30;
                    t.rsiOverbought = t.baseRsiOverbought ?? 70;
                }
            }
        }
    }

    /**
     * Check Higher-Timeframe (HTF) trend alignment to prevent fighting momentum
     */
    checkHtfAlignment(beeKey, side, marketState) {
        const htf = marketState?.htfTrend || 'NEUTRAL';

        // Boozy: Mean-reversion checks
        if (beeKey === 'boozy') {
            const rsi = marketState?.rsi_14 ?? 50;
            const pctB = marketState?.bollinger?.percent_b ?? 0.5;

            if (htf === 'BULLISH' && side === 'SHORT') {
                // In a HTF bull trend, strictly disallow shorting unless an extreme blowoff top
                const isBlowoff = rsi >= 78 && pctB >= 1.05;
                if (!isBlowoff) {
                    return {
                        allowed: false,
                        reason: `HTF Bullish trend active on ${marketState.instId}: Counter-trend SHORT suppressed (RSI ${rsi} < 78 threshold)`
                    };
                }
            }

            if (htf === 'BEARISH' && side === 'LONG') {
                // In a HTF bear trend, strictly disallow long dip-buying unless extreme crash exhaustion
                const isExhaustion = rsi <= 22 && pctB <= -0.05;
                if (!isExhaustion) {
                    return {
                        allowed: false,
                        reason: `HTF Bearish trend active on ${marketState.instId}: Counter-trend LONG suppressed (RSI ${rsi} > 22 threshold)`
                    };
                }
            }
        }

        // Breezy: Trend-following checks
        if (beeKey === 'breezy') {
            if (htf === 'BULLISH' && side === 'SHORT') {
                return {
                    allowed: false,
                    reason: `HTF Bullish trend active on ${marketState.instId}: Cannot take trend SHORT against HTF bull trend`
                };
            }
            if (htf === 'BEARISH' && side === 'LONG') {
                return {
                    allowed: false,
                    reason: `HTF Bearish trend active on ${marketState.instId}: Cannot take trend LONG against HTF bear trend`
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Get autonomic adjustments for a specific bee
     */
    getBeeAdjustments(beeKey) {
        return this.tuning[beeKey] || {
            consecutiveLosses: 0,
            consecutiveWins: 0,
            minConviction: 2,
            riskPerTradePct: 0.02,
            status: 'NORMAL'
        };
    }
}

export default new BeeAutonomicTuner();
