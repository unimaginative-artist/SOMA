/**
 * PnLAttributor — Performance Decomposition Engine
 *
 * Decomposes realised P&L into:
 *   alpha       — returns not explained by the market (skill)
 *   beta        — market-correlated returns (riding the wave)
 *   rSquared    — how much of variance is market-driven (low = more alpha)
 *   execution   — slippage cost as % of gross P&L
 *   strategy    — per-strategy attribution breakdown
 *   factorTilt  — inferred tilt toward momentum / mean-reversion
 *
 * Uses OLS regression: trade_return ~ SPY_return
 * Alpha = annualised intercept, Beta = slope.
 *
 * Requires ≥10 closed trades and SPY price data.
 * Returns neutral values gracefully if data is insufficient.
 */

import tradeLogger from './TradeLogger.js';
import marketDataService from './marketDataService.js';

class PnLAttributor {
    /**
     * Run full attribution for the last `days` days.
     * @param {number} days
     * @returns {Promise<AttributionReport>}
     */
    async attribute(days = 30) {
        const trades = tradeLogger.getClosedTrades(days);
        if (trades.length < 5) {
            return this._emptyReport(days, `only ${trades.length} closed trades`);
        }

        // Fetch SPY daily returns for same window
        let spyReturns = [];
        try {
            const bars = await marketDataService.getBars('SPY', '1Day', days + 5);
            const closes = (bars || []).map(b => b.close || b.c).filter(v => v > 0);
            for (let i = 1; i < closes.length; i++) {
                spyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
            }
        } catch { /* SPY unavailable */ }

        // Map trades to daily P&L buckets (keyed by date string)
        const dailyPnl = this._tradesToDailyPnl(trades);
        const tradeReturnPcts = trades
            .map(t => (t.pnl_pct || 0) / 100)
            .filter(r => isFinite(r));

        // OLS regression if we have aligned SPY data
        let alpha = 0, beta = 0, rSquared = 0;
        if (spyReturns.length >= 10 && tradeReturnPcts.length >= 10) {
            const result = this._ols(tradeReturnPcts, spyReturns.slice(-tradeReturnPcts.length));
            alpha    = result.alpha;
            beta     = result.beta;
            rSquared = result.rSquared;
        }

        // Execution quality — slippage as % of gross P&L
        const grossPnl       = trades.reduce((s, t) => s + Math.abs(t.pnl || 0), 0);
        const totalSlippage  = trades.reduce((s, t) => s + Math.abs((t.slippage_pct || 0) * (t.entry_price || 0) * (t.qty || 0) / 100), 0);
        const executionScore = grossPnl > 0 ? Math.max(0, 1 - (totalSlippage / grossPnl)) : 1;

        // Per-strategy breakdown
        const strategyMap = {};
        for (const t of trades) {
            const key = t.strategy || 'unknown';
            if (!strategyMap[key]) strategyMap[key] = { trades: 0, wins: 0, totalPnl: 0, totalPnlPct: 0 };
            strategyMap[key].trades++;
            if ((t.pnl || 0) > 0) strategyMap[key].wins++;
            strategyMap[key].totalPnl    += t.pnl    || 0;
            strategyMap[key].totalPnlPct += (t.pnl_pct || 0);
        }
        const strategyBreakdown = Object.entries(strategyMap).map(([strategy, s]) => ({
            strategy,
            trades:   s.trades,
            winRate:  s.trades > 0 ? parseFloat((s.wins / s.trades * 100).toFixed(1)) : 0,
            totalPnl: parseFloat(s.totalPnl.toFixed(2)),
            avgPnlPct: parseFloat((s.totalPnlPct / (s.trades || 1)).toFixed(3))
        })).sort((a, b) => b.totalPnl - a.totalPnl);

        // Factor tilt: momentum vs mean-reversion
        // Momentum = consecutive winning trades cluster
        // Mean-reversion = win after loss, loss after win
        const factorTilt = this._detectFactorTilt(trades);

        // Win rate + profit factor
        const wins = trades.filter(t => (t.pnl || 0) > 0);
        const lossAmt = Math.abs(trades.filter(t => (t.pnl || 0) <= 0).reduce((s, t) => s + (t.pnl || 0), 0));
        const winAmt  = wins.reduce((s, t) => s + (t.pnl || 0), 0);

        return {
            days,
            trades:          trades.length,
            totalPnl:        parseFloat(trades.reduce((s, t) => s + (t.pnl || 0), 0).toFixed(2)),
            winRate:         parseFloat((wins.length / trades.length * 100).toFixed(1)),
            profitFactor:    lossAmt > 0 ? parseFloat((winAmt / lossAmt).toFixed(3)) : winAmt > 0 ? 999 : 0,
            regression: {
                alpha:      parseFloat((alpha * 252 * 100).toFixed(3)), // annualised %
                beta:       parseFloat(beta.toFixed(4)),
                rSquared:   parseFloat(rSquared.toFixed(4)),
                alphaSource: rSquared < 0.3 ? 'high-alpha (skill-driven)' : rSquared > 0.7 ? 'high-beta (market-driven)' : 'mixed'
            },
            execution: {
                score:       parseFloat(executionScore.toFixed(4)),
                grade:       executionScore > 0.90 ? 'EXCELLENT' : executionScore > 0.75 ? 'GOOD' : 'NEEDS_WORK',
                slippageCost: parseFloat(totalSlippage.toFixed(4))
            },
            factorTilt,
            strategyBreakdown,
            generatedAt: new Date().toISOString()
        };
    }

    _tradesToDailyPnl(trades) {
        const map = {};
        for (const t of trades) {
            const day = (t.exit_time || t.entry_time || '').slice(0, 10);
            if (!day) continue;
            map[day] = (map[day] || 0) + (t.pnl || 0);
        }
        return map;
    }

    /**
     * OLS: y ~ intercept + slope * x
     * Returns { alpha (intercept), beta (slope), rSquared }
     */
    _ols(y, x) {
        const n = Math.min(y.length, x.length);
        if (n < 5) return { alpha: 0, beta: 0, rSquared: 0 };
        const _y = y.slice(-n), _x = x.slice(-n);

        const avgX = _x.reduce((s, v) => s + v, 0) / n;
        const avgY = _y.reduce((s, v) => s + v, 0) / n;

        let ssXX = 0, ssXY = 0, ssYY = 0;
        for (let i = 0; i < n; i++) {
            const dx = _x[i] - avgX, dy = _y[i] - avgY;
            ssXX += dx * dx;
            ssXY += dx * dy;
            ssYY += dy * dy;
        }

        const slope     = ssXX === 0 ? 0 : ssXY / ssXX;
        const intercept = avgY - slope * avgX;
        const ssRes = _y.reduce((s, v, i) => s + Math.pow(v - (intercept + slope * _x[i]), 2), 0);
        const rSq   = ssYY === 0 ? 0 : Math.max(0, 1 - ssRes / ssYY);

        return { alpha: intercept, beta: slope, rSquared: rSq };
    }

    _detectFactorTilt(trades) {
        if (trades.length < 6) return { tilt: 'UNKNOWN', score: 0 };
        const outcomes = trades.map(t => (t.pnl || 0) > 0 ? 1 : -1);
        let momentumSignal = 0;
        for (let i = 1; i < outcomes.length; i++) {
            // Momentum: same sign as previous
            if (outcomes[i] === outcomes[i - 1]) momentumSignal++;
            else momentumSignal--;
        }
        const score = momentumSignal / (outcomes.length - 1);
        const tilt  = score > 0.2 ? 'MOMENTUM' : score < -0.2 ? 'MEAN_REVERSION' : 'NEUTRAL';
        return { tilt, score: parseFloat(score.toFixed(4)) };
    }

    _emptyReport(days, reason) {
        return {
            days, trades: 0, totalPnl: 0, winRate: 0, profitFactor: 0,
            regression: { alpha: 0, beta: 0, rSquared: 0, alphaSource: 'insufficient data' },
            execution: { score: 0, grade: 'INSUFFICIENT_DATA', slippageCost: 0 },
            factorTilt: { tilt: 'UNKNOWN', score: 0 },
            strategyBreakdown: [],
            reason,
            generatedAt: new Date().toISOString()
        };
    }
}

const pnlAttributor = new PnLAttributor();
export default pnlAttributor;
