function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

class PaperExecutionSimulator {
    constructor(config = {}) {
        this.config = {
            baseSpreadBps: 6,
            volatilitySpreadMultiplier: 10,
            feeBps: 2,
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

    /**
     * Deterministic per-side cost estimate using the exact same spread/impact/fee
     * model as simulateFill (no randomness, no rejects). Lets the backtester and
     * candidate screening charge identical friction to what paper fills pay —
     * the sim/paper divergence (sim 60% WR vs paper 24%, Jul 2026) came partly
     * from the backtester filling at raw close prices with zero spread.
     */
    estimateCostPct({ referencePrice, qty, bars = [] }) {
        const price = Number(referencePrice);
        const quantity = Number(qty);
        const volatility = this.estimateVolatility(bars);
        const notional = Number.isFinite(price) && Number.isFinite(quantity) && price > 0 && quantity > 0
            ? price * quantity : 0;
        const spreadBps = this.config.baseSpreadBps + volatility * this.config.volatilitySpreadMultiplier * 100;
        const halfSpreadPct = (spreadBps / 10000) / 2;
        const impactPct = price > 0
            ? Math.min(0.01, Math.sqrt(notional) / 100000) * (1 + volatility * 5)
            : 0;
        const feePct = this.config.feeBps / 10000;
        const perSidePct = halfSpreadPct + impactPct + feePct;
        return {
            perSidePct,
            roundTripPct: perSidePct * 2,
            halfSpreadPct,
            impactPct,
            feePct,
            spreadBps,
            volatility
        };
    }

    simulateFill({ symbol, side, qty, referencePrice, bars = [], orderId = null }) {
        const price = Number(referencePrice);
        const quantity = Number(qty);
        if (!symbol || !['buy', 'sell'].includes(side) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
            return { accepted: false, status: 'rejected', reason: 'invalid_order' };
        }

        const volatility = this.estimateVolatility(bars);
        const notional = price * quantity;
        const seedBase = Math.abs(Math.sin((Date.now() % 100000) + symbol.length * 13 + quantity * 7));
        if (seedBase < this.config.rejectProbability) {
            return { accepted: false, status: 'rejected', reason: 'simulated_broker_reject', volatility };
        }

        const spreadBps = this.config.baseSpreadBps + volatility * this.config.volatilitySpreadMultiplier * 100;
        const halfSpread = price * (spreadBps / 10000) / 2;
        const impact = price * Math.min(0.01, Math.sqrt(notional) / 100000) * (1 + volatility * 5);
        const sideSign = side === 'buy' ? 1 : -1;
        const filledPrice = price + sideSign * (halfSpread + impact);
        const fee = notional * (this.config.feeBps / 10000);

        let filledQty = quantity;
        let status = 'filled';
        if (notional > this.config.partialFillThreshold) {
            const fillRatio = clamp(0.72 + seedBase * 0.28, 0.5, 1);
            filledQty = Number((quantity * fillRatio).toFixed(symbol.includes('-') ? 6 : 4));
            status = filledQty < quantity ? 'partial_filled' : 'filled';
        }

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
            spreadBps,
            slippagePct,
            latencyMs,
            volatility
        };
    }
}

const paperExecutionSimulator = new PaperExecutionSimulator();
export default paperExecutionSimulator;
