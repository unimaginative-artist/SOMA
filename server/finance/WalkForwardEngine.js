/**
 * WalkForwardEngine — Out-of-Sample Validation Harness
 *
 * Splits a price series into overlapping train/test windows and runs a strategy
 * function on each. Aggregates OOS results and computes a Walk-Forward Efficiency
 * ratio: WFE = oos_sharpe / is_sharpe.
 *
 *   WFE > 0.60  → strategy generalises well (not curve-fitted)
 *   WFE 0.30–0.60 → borderline, treat as candidate
 *   WFE < 0.30  → likely overfitted to in-sample data — reject
 *
 * Usage:
 *   const wfe = new WalkForwardEngine();
 *   const result = wfe.run(priceSeries, strategyFn, { trainBars: 180, testBars: 60 });
 *
 * strategyFn(series, i) should return: -1 (short), 0 (flat), 1 (long)
 */

const FEE = 0.0012; // round-trip fee per trade (0.12%)
const MIN_TRAIN_BARS = 90;
const MIN_TEST_BARS  = 20;

class WalkForwardEngine {
    /**
     * @param {number[]} series     - Close-price array (oldest first)
     * @param {Function} strategyFn - (series, i) => -1|0|1
     * @param {object}   config
     *   trainBars  {number}  bars used for in-sample (default 180)
     *   testBars   {number}  bars used for out-of-sample per window (default 60)
     *   stepBars   {number}  bars to advance window each step (default = testBars)
     *   minWindows {number}  abort if fewer than N OOS windows available (default 3)
     */
    run(series, strategyFn, config = {}) {
        const {
            trainBars  = 180,
            testBars   = 60,
            stepBars   = testBars,
            minWindows = 3
        } = config;

        if (series.length < MIN_TRAIN_BARS + MIN_TEST_BARS) {
            return { skipped: true, reason: `Series too short (${series.length} bars)` };
        }

        const windows = [];
        let start = 0;

        while (start + trainBars + testBars <= series.length) {
            const trainSlice = series.slice(start, start + trainBars);
            const testSlice  = series.slice(start + trainBars, start + trainBars + testBars);

            const isMetrics  = this._runStrategy(trainSlice, strategyFn);
            const oosMetrics = this._runStrategy(testSlice, strategyFn);

            windows.push({ start, trainBars, testBars, is: isMetrics, oos: oosMetrics });
            start += stepBars;
        }

        if (windows.length < minWindows) {
            return { skipped: true, reason: `Only ${windows.length} windows (need ${minWindows})` };
        }

        // Aggregate OOS results
        const oosReturns = windows.flatMap(w => w.oos.returns);
        const isReturns  = windows.flatMap(w => w.is.returns);
        const oosSharpe  = this._sharpe(oosReturns);
        const isSharpe   = this._sharpe(isReturns);

        const oosWins    = windows.reduce((s, w) => s + w.oos.wins, 0);
        const oosTrades  = windows.reduce((s, w) => s + w.oos.trades, 0);
        const oosWinRate = oosTrades > 0 ? oosWins / oosTrades : 0;

        const oosPnl     = oosReturns.reduce((s, r) => s + r, 0);
        const efficiency = isSharpe > 0 ? Math.min(1, Math.max(-1, oosSharpe / isSharpe)) : 0;

        const grade = efficiency >= 0.6 ? 'ROBUST'
                    : efficiency >= 0.3 ? 'CANDIDATE'
                    : 'OVERFITTED';

        return {
            skipped:      false,
            windows:      windows.length,
            trainBars,
            testBars,
            is:  { sharpe: parseFloat(isSharpe.toFixed(3)),  winRate: parseFloat((windows.reduce((s, w) => s + w.is.winRate, 0) / windows.length).toFixed(4)) },
            oos: { sharpe: parseFloat(oosSharpe.toFixed(3)), winRate: parseFloat(oosWinRate.toFixed(4)), totalPnl: parseFloat(oosPnl.toFixed(5)), trades: oosTrades },
            efficiency:   parseFloat(efficiency.toFixed(4)),
            grade,
            passes:       grade !== 'OVERFITTED' && oosSharpe > 0 && oosWinRate >= 0.45
        };
    }

    /**
     * Run a strategy on a price series, return per-trade returns + metrics.
     */
    _runStrategy(series, strategyFn) {
        const returns = [];
        let position = 0;
        let entry    = 0;
        let wins = 0, trades = 0;

        for (let i = 36; i < series.length; i++) {
            const signal = strategyFn(series, i);
            if (signal !== position) {
                if (position !== 0 && entry > 0) {
                    const ret = position * ((series[i] - entry) / entry) - FEE;
                    returns.push(ret);
                    trades++;
                    if (ret > 0) wins++;
                }
                if (signal !== 0) entry = series[i];
                position = signal;
            }
        }
        // Close open position at series end
        if (position !== 0 && entry > 0 && series.length > 0) {
            const ret = position * ((series[series.length - 1] - entry) / entry) - FEE;
            returns.push(ret);
            trades++;
            if (ret > 0) wins++;
        }

        return { returns, trades, wins, winRate: trades > 0 ? wins / trades : 0 };
    }

    _sharpe(returns) {
        if (returns.length < 2) return 0;
        const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / returns.length;
        const std = Math.sqrt(variance);
        return std > 0 ? (avg / std) * Math.sqrt(252) : 0;
    }
}

export default new WalkForwardEngine();
