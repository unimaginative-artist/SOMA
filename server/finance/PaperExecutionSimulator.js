import { ALPACA_CRYPTO_FEES, TRADING_ECONOMICS_VERSION } from './TradingResearchPolicy.js';

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

export class PaperExecutionSimulator {
    constructor(config = {}) {
        const legacyFee = Number.isFinite(Number(config.feeBps)) ? Number(config.feeBps) : null;
        this.config = {
            baseSpreadBps: 6,
            volatilitySpreadMultiplier: 10,
            makerFeeBps: legacyFee ?? ALPACA_CRYPTO_FEES.makerBps,
            takerFeeBps: legacyFee ?? ALPACA_CRYPTO_FEES.takerBps,
            makerAdverseSelectionBps: 3,
            partialFillThreshold: 750,
            rejectProbability: 0.003,
            latencyMsMin: 40,
            latencyMsMax: 850,
            ...config
        };
    }

    estimateVolatility(bars = []) {
        if (!Array.isArray(bars) || bars.length < 3) return 0.01;
        const closes = bars.slice(-30).map(bar => Number(bar.close)).filter(Number.isFinite);
        if (closes.length < 3) return 0.01;
        const returns = [];
        for (let i = 1; i < closes.length; i++) {
            if (closes[i - 1] > 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
        const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
        const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, returns.length);
        return clamp(Math.sqrt(variance), 0.001, 0.18);
    }

    estimateObservedSpreadBps(bars = []) {
        const observed = (Array.isArray(bars) ? bars : []).slice(-60).map(bar => {
            const explicit = Number(bar?.spreadBps);
            if (Number.isFinite(explicit) && explicit >= 0) return explicit;
            const bid = Number(bar?.bid ?? bar?.bidPrice);
            const ask = Number(bar?.ask ?? bar?.askPrice);
            const mid = (bid + ask) / 2;
            return bid > 0 && ask >= bid && mid > 0 ? ((ask - bid) / mid) * 10000 : null;
        }).filter(Number.isFinite).sort((left, right) => left - right);
        if (!observed.length) return null;
        const middle = Math.floor(observed.length / 2);
        return observed.length % 2 ? observed[middle] : (observed[middle - 1] + observed[middle]) / 2;
    }

    /**
     * Deterministic per-side cost estimate using the exact same spread/impact/fee
     * model as simulateFill (no randomness, no rejects). Lets the backtester and
     * candidate screening charge identical friction to what paper fills pay —
     * the sim/paper divergence (sim 60% WR vs paper 24%, Jul 2026) came partly
     * from the backtester filling at raw close prices with zero spread.
     */
    estimateCostPct({ referencePrice, qty, bars = [], liquidity = 'taker' }) {
        const price = Number(referencePrice);
        const quantity = Number(qty);
        const volatility = this.estimateVolatility(bars);
        const notional = Number.isFinite(price) && Number.isFinite(quantity) && price > 0 && quantity > 0
            ? price * quantity : 0;
        const observedSpreadBps = this.estimateObservedSpreadBps(bars);
        const modeledSpreadBps = this.config.baseSpreadBps + volatility * this.config.volatilitySpreadMultiplier * 100;
        // Never let sparse quote observations make the simulator more generous
        // than its conservative volatility model.
        const spreadBps = observedSpreadBps == null ? modeledSpreadBps : Math.max(observedSpreadBps, modeledSpreadBps);
        const maker = String(liquidity).toLowerCase() === 'maker';
        const halfSpreadPct = maker ? 0 : (spreadBps / 10000) / 2;
        const impactPct = !maker && price > 0
            ? Math.min(0.01, Math.sqrt(notional) / 100000) * (1 + volatility * 5)
            : 0;
        const adverseSelectionPct = maker ? this.config.makerAdverseSelectionBps / 10000 : 0;
        const feeBps = maker ? this.config.makerFeeBps : this.config.takerFeeBps;
        const feePct = feeBps / 10000;
        const perSidePct = halfSpreadPct + impactPct + adverseSelectionPct + feePct;
        return {
            economicsVersion: TRADING_ECONOMICS_VERSION,
            liquidity: maker ? 'maker' : 'taker',
            feeBps,
            perSidePct,
            roundTripPct: perSidePct * 2,
            halfSpreadPct,
            impactPct,
            adverseSelectionPct,
            feePct,
            spreadBps,
            observedSpreadBps,
            spreadSource: observedSpreadBps == null ? 'conservative_model' : 'observed_floor_plus_model',
            volatility
        };
    }

    simulateFill({
        symbol, side, qty, referencePrice, bars = [], orderId = null,
        allowPartialFill = true, orderType = 'market', limitPrice = null, bar = null
    }) {
        const price = Number(referencePrice);
        const quantity = Number(qty);
        if (!symbol || !['buy', 'sell'].includes(side) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
            return { accepted: false, status: 'rejected', reason: 'invalid_order' };
        }

        const normalizedOrderType = String(orderType || 'market').toLowerCase();
        const maker = normalizedOrderType === 'limit';
        if (maker) {
            const limit = Number(limitPrice);
            const low = Number(bar?.low);
            const high = Number(bar?.high);
            if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(low) || !Number.isFinite(high)) {
                return { accepted: false, status: 'not_filled', reason: 'limit_fill_requires_price_bar' };
            }
            const crossed = side === 'buy' ? low <= limit : high >= limit;
            if (!crossed) {
                return { accepted: false, status: 'not_filled', reason: 'missed_limit_fill', symbol, side, limitPrice: limit };
            }
        }
        const volatility = this.estimateVolatility(bars);
        const notional = price * quantity;
        const seedBase = Math.abs(Math.sin((Date.now() % 100000) + symbol.length * 13 + quantity * 7));
        if (seedBase < this.config.rejectProbability) {
            return { accepted: false, status: 'rejected', reason: 'simulated_broker_reject', volatility };
        }

        const observedSpreadBps = this.estimateObservedSpreadBps(bars);
        const modeledSpreadBps = this.config.baseSpreadBps + volatility * this.config.volatilitySpreadMultiplier * 100;
        const spreadBps = observedSpreadBps == null ? modeledSpreadBps : Math.max(observedSpreadBps, modeledSpreadBps);
        const halfSpread = maker ? 0 : price * (spreadBps / 10000) / 2;
        const impact = maker ? 0 : price * Math.min(0.01, Math.sqrt(notional) / 100000) * (1 + volatility * 5);
        const sideSign = side === 'buy' ? 1 : -1;
        const filledPrice = maker ? Number(limitPrice) : price + sideSign * (halfSpread + impact);
        let filledQty = quantity;
        let status = 'filled';
        if (allowPartialFill && notional > this.config.partialFillThreshold) {
            const fillRatio = clamp(0.72 + seedBase * 0.28, 0.5, 1);
            filledQty = Number((quantity * fillRatio).toFixed(symbol.includes('-') ? 6 : 4));
            status = filledQty < quantity ? 'partial_filled' : 'filled';
        }

        // Fees apply to what actually filled, not the requested size.
        const feeBps = maker ? this.config.makerFeeBps : this.config.takerFeeBps;
        const fee = filledPrice * filledQty * (feeBps / 10000);

        const latencyMs = Math.round(this.config.latencyMsMin + seedBase * (this.config.latencyMsMax - this.config.latencyMsMin));
        const slippagePct = side === 'buy'
            ? ((filledPrice - price) / price) * 100
            : ((price - filledPrice) / price) * 100;

        return {
            accepted: true,
            orderId: orderId || `paper_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            status,
            symbol,
            side,
            requestedQty: quantity,
            filledQty,
            referencePrice: price,
            filledPrice,
            fee,
            feeBps,
            liquidity: maker ? 'maker' : 'taker',
            economicsVersion: TRADING_ECONOMICS_VERSION,
            spreadBps,
            observedSpreadBps,
            spreadSource: observedSpreadBps == null ? 'conservative_model' : 'observed_floor_plus_model',
            slippagePct,
            latencyMs,
            volatility
        };
    }
}

const paperExecutionSimulator = new PaperExecutionSimulator();
export default paperExecutionSimulator;
