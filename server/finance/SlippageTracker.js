/**
 * SlippageTracker - Monitors execution quality
 *
 * Records expected vs actual fill price for every trade.
 * Warns on excessive slippage (>0.5%).
 * Provides aggregate stats for the dashboard.
 */

import paperExecutionSimulator from './PaperExecutionSimulator.js';

class SlippageTracker {
    constructor() {
        this.trades = [];       // All recorded trades
        this.maxHistory = 1000; // Keep last 1000 trades
        this.warningThreshold = 0.005; // 0.5%
    }

    /**
     * Record a trade execution
     * @param {object} trade
     * @param {string} trade.symbol
     * @param {string} trade.side - 'buy' or 'sell'
     * @param {number} trade.qty
     * @param {number} trade.expectedPrice - Price at time of decision
     * @param {number} trade.filledPrice - Actual fill price from broker
     * @param {string} trade.orderId
     * @param {string} [trade.strategy] - Which strategy placed this trade
     */
    record(trade) {
        const { symbol, side, qty, expectedPrice, filledPrice, orderId, strategy, venue } = trade;

        if (!expectedPrice || !filledPrice) return; // Can't compute without both prices

        // Slippage = |filled - expected| / expected
        const slippage = Math.abs(filledPrice - expectedPrice) / expectedPrice;
        const slippageBps = slippage * 10000; // Basis points
        const slippageDollars = Math.abs(filledPrice - expectedPrice) * qty;

        // Direction: positive slippage = worse fill (paid more for buy, received less for sell)
        const isBuy = side === 'buy';
        const isAdverse = isBuy ? filledPrice > expectedPrice : filledPrice < expectedPrice;

        const record = {
            timestamp: new Date().toISOString(),
            symbol,
            side,
            qty,
            expectedPrice,
            filledPrice,
            slippage,
            slippageBps: Math.round(slippageBps),
            slippageDollars,
            isAdverse,
            orderId,
            strategy: strategy || 'manual',
            venue: venue || 'unknown'
        };

        this.trades.push(record);
        if (this.trades.length > this.maxHistory) {
            this.trades.shift();
        }

        // Warn on high slippage
        if (slippage > this.warningThreshold) {
            console.warn(`[Slippage] HIGH: ${symbol} ${side} - Expected $${expectedPrice.toFixed(2)}, Got $${filledPrice.toFixed(2)} (${(slippage * 100).toFixed(3)}%, $${slippageDollars.toFixed(2)} impact)`);
        }

        return record;
    }

    /**
     * Get aggregate slippage statistics
     */
    getStats() {
        if (this.trades.length === 0) {
            return {
                totalTrades: 0,
                avgSlippageBps: 0,
                avgSlippagePercent: '0.000%',
                maxSlippageBps: 0,
                totalSlippageDollars: 0,
                adverseRate: '0%',
                highSlippageCount: 0,
                recentTrades: []
            };
        }

        const slippages = this.trades.map(t => t.slippageBps);
        const avgBps = slippages.reduce((a, b) => a + b, 0) / slippages.length;
        const maxBps = Math.max(...slippages);
        const totalDollars = this.trades.reduce((sum, t) => sum + t.slippageDollars, 0);
        const adverseCount = this.trades.filter(t => t.isAdverse).length;
        const highSlippageCount = this.trades.filter(t => t.slippage > this.warningThreshold).length;

        return {
            totalTrades: this.trades.length,
            avgSlippageBps: Math.round(avgBps),
            avgSlippagePercent: (avgBps / 100).toFixed(3) + '%',
            maxSlippageBps: Math.round(maxBps),
            totalSlippageDollars: totalDollars.toFixed(2),
            adverseRate: (adverseCount / this.trades.length * 100).toFixed(1) + '%',
            highSlippageCount,
            recentTrades: this.trades.slice(-10).reverse()
        };
    }

    /**
     * Compare real live fills against the paper engine's cost model. This is how
     * we find out whether paper was lying BEFORE it costs real money: if live
     * slippage runs consistently above what the paper model charges, every paper
     * stat (and the promotion decision built on it) was too optimistic.
     */
    calibrationVsPaperModel() {
        const live = this.trades.filter(t => t.venue === 'live');
        if (live.length === 0) {
            return { liveTrades: 0, message: 'No live fills recorded yet — populates once Tiny Live starts.' };
        }
        const realizedAvgBps = live.reduce((sum, t) => sum + t.slippageBps, 0) / live.length;
        let predictedSumBps = 0;
        for (const t of live) {
            const est = paperExecutionSimulator.estimateCostPct({ referencePrice: t.expectedPrice, qty: t.qty });
            // Compare fill-price slippage only (fees are charged separately, not in the fill)
            predictedSumBps += (est.halfSpreadPct + est.impactPct) * 10000;
        }
        const predictedAvgBps = predictedSumBps / live.length;
        const gapBps = realizedAvgBps - predictedAvgBps;
        return {
            liveTrades: live.length,
            realizedAvgSlippageBps: Math.round(realizedAvgBps),
            paperModelPredictedBps: Math.round(predictedAvgBps),
            gapBps: Math.round(gapBps),
            verdict: Math.abs(gapBps) <= 5
                ? 'paper_model_accurate'
                : gapBps > 0
                    ? 'paper_model_too_optimistic — recalibrate baseSpreadBps up before trusting paper stats'
                    : 'paper_model_conservative — live fills are better than paper assumed'
        };
    }

    /**
     * Get stats by symbol
     */
    getStatsBySymbol(symbol) {
    if (symbol == null || symbol === '') {
      console.warn('[SlippageTracker] getStatsBySymbol called with invalid symbol:', JSON.stringify(symbol));
      return null;
    }
    const filtered = this.trades.filter(t => String(t.symbol).toUpperCase() === String(symbol).toUpperCase());
    if (filtered.length === 0) return null;
    const totalSlipPct = filtered.reduce((sum, t) => sum + (t.slipPct || 0), 0);
    const count = filtered.length;
    const avgSlipPct = totalSlipPct / count;
    const maxSlip = Math.max(...filtered.map(t => t.slipPct || 0));
    const minSlip = Math.min(...filtered.map(t => t.slipPct || 0));
    const totalBaseVolume = filtered.reduce((sum, t) => sum + (t.baseVolume || 0), 0);
    const totalQuoteVolume = filtered.reduce((sum, t) => sum + (t.quoteVolume || 0), 0);
    return { symbol, count, avgSlipPct, maxSlip, minSlip, totalBaseVolume, totalQuoteVolume };
  }

    /**
     * Get stats by strategy
     */
    getStatsByStrategy(strategy) {
        const stratTrades = this.trades.filter(t => t.strategy === strategy);
        if (stratTrades.length === 0) return null;

        const slippages = stratTrades.map(t => t.slippageBps);
        const avg = slippages.reduce((a, b) => a + b, 0) / slippages.length;

        return {
            strategy,
            trades: stratTrades.length,
            avgSlippageBps: Math.round(avg),
            totalImpact: stratTrades.reduce((sum, t) => sum + t.slippageDollars, 0).toFixed(2)
        };
    }
}

// Singleton
const slippageTracker = new SlippageTracker();
export default slippageTracker;
