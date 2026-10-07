/**
 * PerformanceCalculator - Risk-adjusted return metrics + go/no-go report
 *
 * Metrics:
 * - Sharpe Ratio (annualized, risk-free rate = 5%)
 * - Sortino Ratio (penalizes only downside volatility)
 * - Max Drawdown
 * - Profit Factor
 * - Win Rate
 * - Expectancy (avg $ per trade)
 *
 * 30-Day Report:
 * Produces a go/no-go recommendation for transitioning from paper to live.
 */

class PerformanceCalculator {
    constructor() {
        this.riskFreeRate = 0.05; // 5% annual risk-free rate
        this.tradingDaysPerYear = 252;
    }

    /**
     * Calculate Sharpe Ratio (annualized)
     * Sharpe = (mean_return - risk_free) / std_dev * sqrt(252)
     * @param {number[]} returns - Array of per-trade percentage returns
     * @returns {number}
     */
    // `annualization` scales the per-observation ratio to an annual figure. For
    // per-trade returns the correct factor is sqrt(trades per year), NOT the daily
    // sqrt(252) — callers with the real trade frequency pass it in; default stays daily.
    calculateSharpe(returns, annualization = Math.sqrt(this.tradingDaysPerYear)) {
        if (returns.length < 2) return 0;

        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const dailyRiskFree = this.riskFreeRate / this.tradingDaysPerYear;

        const excessReturns = returns.map(r => r - dailyRiskFree);
        const avgExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;

        const variance = excessReturns.reduce((sum, r) => sum + Math.pow(r - avgExcess, 2), 0) / excessReturns.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev === 0) return avgExcess > 0 ? Infinity : 0;
        return (avgExcess / stdDev) * annualization;
    }

    /**
     * Calculate Sortino Ratio (only penalizes downside deviation)
     * Sortino = (mean_return - risk_free) / downside_deviation * sqrt(252)
     * @param {number[]} returns - Array of per-trade percentage returns
     * @returns {number}
     */
    calculateSortino(returns, annualization = Math.sqrt(this.tradingDaysPerYear)) {
        if (returns.length < 2) return 0;

        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const dailyRiskFree = this.riskFreeRate / this.tradingDaysPerYear;

        // Downside deviation: only count negative excess returns
        const downsideReturns = returns
            .map(r => r - dailyRiskFree)
            .filter(r => r < 0);

        if (downsideReturns.length === 0) return avgReturn > 0 ? Infinity : 0;

        const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / returns.length;
        const downsideDev = Math.sqrt(downsideVariance);

        if (downsideDev === 0) return 0;
        return ((avgReturn - dailyRiskFree) / downsideDev) * annualization;
    }

    /**
     * Calculate max drawdown from equity curve
     * @param {number[]} equityCurve - Array of equity values
     * @returns {{ maxDrawdown: number, maxDrawdownPct: number, peakIdx: number, troughIdx: number }}
     */
    calculateMaxDrawdown(equityCurve) {
        if (equityCurve.length < 2) return { maxDrawdown: 0, maxDrawdownPct: 0, peakIdx: 0, troughIdx: 0 };

        let peak = equityCurve[0];
        let peakIdx = 0;
        let maxDrawdown = 0;
        let maxDrawdownPct = 0;
        let troughIdx = 0;
        let bestPeakIdx = 0;

        for (let i = 1; i < equityCurve.length; i++) {
            if (equityCurve[i] > peak) {
                peak = equityCurve[i];
                peakIdx = i;
            }

            const drawdown = peak - equityCurve[i];
            const drawdownPct = peak > 0 ? drawdown / peak : 0;

            if (drawdownPct > maxDrawdownPct) {
                maxDrawdownPct = drawdownPct;
                maxDrawdown = drawdown;
                troughIdx = i;
                bestPeakIdx = peakIdx;
            }
        }

        return {
            maxDrawdown,
            maxDrawdownPct: maxDrawdownPct * 100,
            peakIdx: bestPeakIdx,
            troughIdx
        };
    }

    /**
     * Calculate full performance report from trade data
     * @param {object[]} trades - Closed trades from TradeLogger
     * @param {object[]} equityCurve - Daily snapshots from TradeLogger
     * @returns {object} Complete performance report
     */
    calculateReport(trades, equityCurve = []) {
        if (trades.length === 0) {
            return {
                period: 0,
                trades: 0,
                metrics: this._emptyMetrics(),
                verdict: { ready: false, reason: 'No trades recorded yet' }
            };
        }

        // Basic stats
        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const totalProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
        const totalLoss = losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0);

        // Returns for ratio calculations
        const returns = trades
            .filter(t => t.pnl_pct != null)
            .map(t => t.pnl_pct / 100); // Convert percentage to decimal

        // Trading period — computed up front so we can annualize per-trade returns by
        // the REAL trade frequency instead of assuming one trade per day (the old code
        // annualized per-trade returns by sqrt(252), which produced absurd Sharpe values
        // like -71.8 on a small losing window).
        const firstTrade = new Date(trades[0].entry_time || trades[0].created_at);
        const lastTrade = new Date(trades[trades.length - 1].exit_time || trades[trades.length - 1].created_at);
        const periodDays = Math.max(1, Math.ceil((lastTrade - firstTrade) / (1000 * 60 * 60 * 24)));
        const tradesPerYear = returns.length > 0 ? returns.length * (365 / periodDays) : this.tradingDaysPerYear;
        const annualization = Math.sqrt(Math.max(1, tradesPerYear));

        // Equity curve for drawdown — REALIZED path synthesized from the actual closed
        // trades in chronological order. Daily snapshots were stale/flat and silently
        // reported 0% drawdown even on losing windows; the trade sequence is ground truth.
        let equityValues;
        {
            const ordered = [...trades].sort((a, b) =>
                new Date(a.exit_time || a.entry_time || a.created_at) - new Date(b.exit_time || b.entry_time || b.created_at));
            let runningEquity = (equityCurve.length > 0 && Number.isFinite(equityCurve[0]?.equity))
                ? equityCurve[0].equity : 10000;
            equityValues = [runningEquity];
            for (const trade of ordered) {
                runningEquity += trade.pnl || 0;
                equityValues.push(runningEquity);
            }
        }

        const sharpe = this.calculateSharpe(returns, annualization);
        const sortino = this.calculateSortino(returns, annualization);
        const drawdown = this.calculateMaxDrawdown(equityValues);

        const winRate = trades.length > 0 ? (wins.length / trades.length * 100) : 0;
        const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 0);
        const expectancy = trades.length > 0 ? totalPnl / trades.length : 0;
        const avgWin = wins.length > 0 ? totalProfit / wins.length : 0;
        const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;

        // (trading period `periodDays` computed above, before the ratio calculations)

        // Sharpe/Sortino are only meaningful with enough clean return samples and a
        // non-degenerate variance. On sparse, tightly-clustered paper returns the ratio
        // blows up into meaningless magnitudes (e.g. -111). Report null ("—") in those
        // cases rather than a precise-looking garbage number. Real strategies fall in
        // roughly [-10, 10]; anything beyond that is a computation artifact, not signal.
        const trustworthyRatio = (v) =>
            (returns.length >= 10 && Number.isFinite(v) && Math.abs(v) <= 10)
                ? parseFloat(v.toFixed(2))
                : null;
        const metrics = {
            sharpeRatio: trustworthyRatio(sharpe),
            sortinoRatio: trustworthyRatio(sortino),
            maxDrawdownPct: parseFloat(drawdown.maxDrawdownPct.toFixed(2)),
            maxDrawdownDollars: parseFloat(drawdown.maxDrawdown.toFixed(2)),
            winRate: parseFloat(winRate.toFixed(1)),
            profitFactor: isFinite(profitFactor) ? parseFloat(profitFactor.toFixed(2)) : 0,
            expectancy: parseFloat(expectancy.toFixed(2)),
            totalPnl: parseFloat(totalPnl.toFixed(2)),
            totalTrades: trades.length,
            wins: wins.length,
            losses: losses.length,
            avgWin: parseFloat(avgWin.toFixed(2)),
            avgLoss: parseFloat(avgLoss.toFixed(2)),
            largestWin: wins.length > 0 ? parseFloat(Math.max(...wins.map(t => t.pnl)).toFixed(2)) : 0,
            largestLoss: losses.length > 0 ? parseFloat(Math.min(...losses.map(t => t.pnl)).toFixed(2)) : 0
        };

        // Generate go/no-go verdict
        const verdict = this._generateVerdict(metrics, periodDays);

        return {
            period: periodDays,
            startDate: firstTrade.toISOString().split('T')[0],
            endDate: lastTrade.toISOString().split('T')[0],
            trades: trades.length,
            metrics,
            verdict,
            equityCurve: equityValues.length <= 100 ? equityValues :
                equityValues.filter((_, i) => i % Math.ceil(equityValues.length / 100) === 0)
        };
    }

    /**
     * Generate go/no-go recommendation
     */
    _generateVerdict(metrics, periodDays) {
        const issues = [];
        const strengths = [];
        let ready = true;

        // Minimum trading period
        if (periodDays < 30) {
            issues.push(`Only ${periodDays} days of data (minimum 30 required)`);
            ready = false;
        }

        // Minimum trade count
        if (metrics.totalTrades < 50) {
            issues.push(`Only ${metrics.totalTrades} trades (minimum 50 for statistical significance)`);
            ready = false;
        }

        // Sharpe ratio threshold (null = not enough clean data to trust a value)
        if (metrics.sharpeRatio == null) {
            issues.push('Sharpe ratio not yet reliable (too few clean return samples)');
            ready = false;
        } else if (metrics.sharpeRatio < 0.5) {
            issues.push(`Sharpe ratio ${metrics.sharpeRatio} is below 0.5 threshold`);
            ready = false;
        } else if (metrics.sharpeRatio >= 1.0) {
            strengths.push(`Strong Sharpe ratio: ${metrics.sharpeRatio}`);
        }

        // Max drawdown threshold
        if (metrics.maxDrawdownPct > 15) {
            issues.push(`Max drawdown ${metrics.maxDrawdownPct}% exceeds 15% limit`);
            ready = false;
        } else if (metrics.maxDrawdownPct < 5) {
            strengths.push(`Low drawdown: ${metrics.maxDrawdownPct}%`);
        }

        // Win rate threshold
        if (metrics.winRate < 45) {
            issues.push(`Win rate ${metrics.winRate}% is below 45% threshold`);
            ready = false;
        } else if (metrics.winRate > 55) {
            strengths.push(`Strong win rate: ${metrics.winRate}%`);
        }

        // Profit factor threshold
        if (metrics.profitFactor < 1.2) {
            issues.push(`Profit factor ${metrics.profitFactor} is below 1.2 threshold`);
            ready = false;
        } else if (metrics.profitFactor > 2.0) {
            strengths.push(`Excellent profit factor: ${metrics.profitFactor}`);
        }

        // Overall P&L
        if (metrics.totalPnl <= 0) {
            issues.push(`Net P&L is negative: $${metrics.totalPnl}`);
            ready = false;
        }

        // Determine recommendation
        let recommendation;
        if (ready && issues.length === 0) {
            recommendation = 'GO_LIVE';
        } else if (issues.length <= 2 && metrics.totalPnl > 0) {
            recommendation = 'CAUTION';
        } else {
            recommendation = 'DO_NOT_GO_LIVE';
        }

        return {
            ready,
            recommendation,
            issues,
            strengths,
            reason: ready
                ? `Strategy meets all thresholds after ${periodDays} days of paper trading`
                : `${issues.length} issue(s) must be resolved before live trading`
        };
    }

    _emptyMetrics() {
        return {
            sharpeRatio: 0, sortinoRatio: 0, maxDrawdownPct: 0,
            maxDrawdownDollars: 0, winRate: 0, profitFactor: 0,
            expectancy: 0, totalPnl: 0, totalTrades: 0,
            wins: 0, losses: 0, avgWin: 0, avgLoss: 0,
            largestWin: 0, largestLoss: 0
        };
    }
}

// Singleton
const performanceCalculator = new PerformanceCalculator();
export default performanceCalculator;
