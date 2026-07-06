import fs from 'fs/promises';
import path from 'path';
import paperExecutionSimulator from './PaperExecutionSimulator.js';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'data', 'trading', 'historical-cache');
const REPORT_PATH = path.join(ROOT, 'data', 'trading', 'compiled-backtest-report.json');

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeSymbol(value = '') {
    return String(value || '').trim().toUpperCase();
}

function historicalName(symbol, timeframe) {
    return `${normalizeSymbol(symbol).replace(/\//g, '-')}_${timeframe}.json`;
}

function symbolAliases(symbol) {
    const normalized = normalizeSymbol(symbol);
    const aliases = new Set([normalized]);
    if (['BTC', 'ETH', 'SOL'].includes(normalized)) aliases.add(`${normalized}-USD`);
    if (normalized.endsWith('-USD')) aliases.add(normalized.replace(/-USD$/i, ''));
    return Array.from(aliases);
}

function sma(values, end, window) {
    if (end < window) return null;
    let sum = 0;
    for (let i = end - window; i < end; i++) sum += finite(values[i]?.close, NaN);
    return Number.isFinite(sum) ? sum / window : null;
}

function averageRangePct(bars, end, window) {
    if (end < window) return 0;
    let sum = 0;
    let count = 0;
    for (let i = end - window; i < end; i++) {
        const close = finite(bars[i]?.close, 0);
        if (close <= 0) continue;
        sum += (finite(bars[i]?.high, close) - finite(bars[i]?.low, close)) / close;
        count++;
    }
    return count ? sum / count : 0;
}

function summarizeTrades(trades, initialCapital) {
    const wins = trades.filter(trade => trade.pnl > 0);
    const losses = trades.filter(trade => trade.pnl <= 0);
    const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
    const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
    let equity = initialCapital;
    let peak = initialCapital;
    let maxDrawdown = 0;
    for (const trade of trades) {
        equity += trade.pnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
    }
    return {
        trades: trades.length,
        wins: wins.length,
        losses: losses.length,
        totalPnl: Number(totalPnl.toFixed(2)),
        pnlPct: Number(((totalPnl / Math.max(1, initialCapital)) * 100).toFixed(3)),
        winRate: trades.length ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
        profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : (grossProfit > 0 ? Infinity : 0),
        avgPnl: trades.length ? Number((totalPnl / trades.length).toFixed(4)) : 0,
        maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3))
    };
}

function backtestBars({ bars, candidate, initialCapital = 10000 }) {
    const dsl = candidate.compiledStrategy?.dsl || {};
    const exit = dsl.exit || {};
    const sizing = dsl.sizing || {};
    const stopLossPct = finite(exit.stopLossPct, 0.018);
    const takeProfitPct = finite(exit.takeProfitPct, 0.045);
    const trailingStopPct = finite(exit.trailingStopPct, 0.014);
    const maxPositionPct = finite(sizing.maxPositionPct, 0.03);
    const maxTradeValue = finite(sizing.maxPaperTradeValue, 1000);
    const aggressive = String(candidate.strategyId || '').includes('aggression');
    const fastWindow = aggressive ? 8 : 12;
    const slowWindow = aggressive ? 24 : 34;
    const minMomentum = aggressive ? 0.0015 : 0.0025;

    let cash = initialCapital;
    let position = null;
    const trades = [];

    for (let i = slowWindow; i < bars.length; i++) {
        const price = finite(bars[i]?.close, 0);
        if (price <= 0) continue;
        const fast = sma(bars, i, fastWindow);
        const slow = sma(bars, i, slowWindow);
        if (!fast || !slow || slow <= 0) continue;
        const momentum = (fast - slow) / slow;
        const rangePct = averageRangePct(bars, i, 12);

        if (position) {
            position.highest = Math.max(position.highest, price);
            const pnlPct = (price - position.entryPrice) / position.entryPrice;
            const trailPct = (price - position.highest) / position.highest;
            const exitReason =
                pnlPct >= takeProfitPct ? 'take_profit' :
                pnlPct <= -stopLossPct ? 'stop_loss' :
                trailPct <= -trailingStopPct ? 'trailing_stop' :
                momentum < -0.0005 ? 'momentum_flip' :
                null;

            if (exitReason) {
                // Exit pays the same per-side friction the paper engine charges
                const exitCost = paperExecutionSimulator.estimateCostPct({
                    referencePrice: price, qty: position.qty, bars: bars.slice(Math.max(0, i - 30), i)
                });
                const gross = position.qty * price * (1 - exitCost.perSidePct);
                cash += gross;
                const pnl = gross - position.cost;
                trades.push({
                    entryTime: position.entryTime,
                    exitTime: bars[i].timestamp || null,
                    entryPrice: position.entryPrice,
                    exitPrice: price,
                    pnl: Number(pnl.toFixed(4)),
                    pnlPct: Number((pnlPct * 100).toFixed(3)),
                    exitReason
                });
                position = null;
            }
            continue;
        }

        const volatilityOk = !dsl.signalSet?.includes('volatility_guard') || rangePct < 0.035;
        if (momentum > minMomentum && volatilityOk && cash > 10) {
            const spend = Math.min(cash * maxPositionPct, maxTradeValue, cash);
            // Entry fills adversely by the same per-side friction as paper
            const entryCost = paperExecutionSimulator.estimateCostPct({
                referencePrice: price, qty: spend / price, bars: bars.slice(Math.max(0, i - 30), i)
            });
            const qty = spend / (price * (1 + entryCost.perSidePct));
            cash -= spend;
            position = {
                qty,
                cost: spend,
                entryPrice: price,
                highest: price,
                entryTime: bars[i].timestamp || null
            };
        }
    }

    if (position) {
        const price = finite(bars[bars.length - 1]?.close, position.entryPrice);
        const exitCost = paperExecutionSimulator.estimateCostPct({
            referencePrice: price, qty: position.qty, bars: bars.slice(-30)
        });
        const gross = position.qty * price * (1 - exitCost.perSidePct);
        cash += gross;
        const pnl = gross - position.cost;
        trades.push({
            entryTime: position.entryTime,
            exitTime: bars[bars.length - 1]?.timestamp || null,
            entryPrice: position.entryPrice,
            exitPrice: price,
            pnl: Number(pnl.toFixed(4)),
            pnlPct: Number((((price - position.entryPrice) / position.entryPrice) * 100).toFixed(3)),
            exitReason: 'end_of_data'
        });
    }

    // Friction check: the profit target must clear the round-trip cost with room
    // to spare, or the strategy's "edge" is just noise inside the cost band.
    const typicalPrice = finite(bars[Math.floor(bars.length / 2)]?.close, finite(bars[0]?.close, 1));
    const typicalSpend = Math.min(initialCapital * maxPositionPct, maxTradeValue);
    const friction = paperExecutionSimulator.estimateCostPct({
        referencePrice: typicalPrice,
        qty: typicalPrice > 0 ? typicalSpend / typicalPrice : 0,
        bars: bars.slice(-60)
    });
    const frictionCheck = {
        takeProfitPct: Number(takeProfitPct.toFixed(5)),
        roundTripCostPct: Number(friction.roundTripPct.toFixed(5)),
        requiredTakeProfitPct: Number((friction.roundTripPct * 3).toFixed(5)),
        passed: takeProfitPct >= friction.roundTripPct * 3
    };

    return {
        initialCapital,
        finalCapital: Number(cash.toFixed(2)),
        ...summarizeTrades(trades, initialCapital),
        frictionCheck,
        sampleTrades: trades.slice(-5)
    };
}

export class CompiledStrategyBacktester {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || CACHE_DIR;
        this.reportPath = options.reportPath || REPORT_PATH;
        this.initialCapital = finite(options.initialCapital, 10000);
    }

    async loadBars(symbol, timeframe = '5Min') {
        const candidates = symbolAliases(symbol).map(alias => path.join(this.cacheDir, historicalName(alias, timeframe)));
        for (const file of candidates) {
            try {
                const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
                if (Array.isArray(parsed?.bars) && parsed.bars.length) {
                    return { file, bars: parsed.bars, symbol: parsed.symbol || symbol, timeframe: parsed.timeframe || timeframe };
                }
            } catch {}
        }
        return null;
    }

    async runCandidates(candidates = [], { limit = 10, timeframe = '5Min' } = {}) {
        const results = [];
        const timeframes = Array.isArray(timeframe)
            ? timeframe
            : Array.from(new Set([timeframe, '1D'].filter(Boolean)));
        for (const candidate of candidates.slice(0, Math.max(1, Number(limit) || 10))) {
            let loaded = null;
            for (const frame of timeframes) {
                loaded = await this.loadBars(candidate.symbol, frame);
                if (loaded?.bars?.length >= 60) break;
            }
            if (!loaded || loaded.bars.length < 60) {
                results.push({
                    key: candidate.key,
                    strategyId: candidate.strategyId,
                    symbol: candidate.symbol,
                    status: 'no_historical_data',
                    timeframe: timeframes.join(',')
                });
                continue;
            }
            // 70/30 walk-forward split: verdict requires the strategy to also make
            // money on data it never saw. Holdout keeps 40 warmup bars for the SMA
            // windows; trades landing in the overlap are a small, acceptable bleed.
            const split = Math.floor(loaded.bars.length * 0.7);
            const backtest = backtestBars({ bars: loaded.bars.slice(0, split), candidate, initialCapital: this.initialCapital });
            const holdout = backtestBars({ bars: loaded.bars.slice(Math.max(0, split - 40)), candidate, initialCapital: this.initialCapital });
            const frictionPassed = backtest.frictionCheck?.passed !== false;
            const inSampleSupported = backtest.trades >= 5
                && backtest.totalPnl > 0
                && backtest.winRate >= 50
                && backtest.profitFactor >= 1.4;
            const holdoutSupported = holdout.trades >= 3 && holdout.totalPnl > 0;
            results.push({
                key: candidate.key,
                strategyId: candidate.strategyId,
                symbol: candidate.symbol,
                status: 'backtested',
                timeframe: loaded.timeframe,
                bars: loaded.bars.length,
                historicalFile: path.relative(ROOT, loaded.file).replace(/\\/g, '/'),
                simulation: candidate.simulation,
                backtest,
                holdout: {
                    trades: holdout.trades,
                    totalPnl: holdout.totalPnl,
                    winRate: holdout.winRate,
                    profitFactor: holdout.profitFactor,
                    maxDrawdownPct: holdout.maxDrawdownPct,
                    supported: holdoutSupported
                },
                verdict: !frictionPassed
                    ? 'target_inside_friction'
                    : (inSampleSupported && holdoutSupported ? 'backtest_supported' : 'backtest_weak_or_failed')
            });
        }
        return results;
    }

    async runFromSimToLiveReport(reportPath = path.join(ROOT, 'data', 'trading', 'sim-to-live-report.json'), options = {}) {
        const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        const results = await this.runCandidates(report.paperQueue || [], options);
        const output = {
            success: true,
            generatedAt: new Date().toISOString(),
            sourceReportPath: path.relative(ROOT, reportPath).replace(/\\/g, '/'),
            summary: {
                candidates: results.length,
                backtested: results.filter(row => row.status === 'backtested').length,
                supported: results.filter(row => row.verdict === 'backtest_supported').length,
                weakOrFailed: results.filter(row => row.verdict === 'backtest_weak_or_failed').length,
                missingData: results.filter(row => row.status === 'no_historical_data').length
            },
            results
        };
        await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
        await fs.writeFile(this.reportPath, JSON.stringify(output, null, 2), 'utf8');
        return output;
    }
}

export default new CompiledStrategyBacktester();

if (process.argv[1] && process.argv[1].endsWith('CompiledStrategyBacktester.js')) {
    const limit = Number(process.argv[2] || 10);
    new CompiledStrategyBacktester()
        .runFromSimToLiveReport(undefined, { limit })
        .then(report => console.log(JSON.stringify(report.summary, null, 2)))
        .catch(error => {
            console.error(error);
            process.exitCode = 1;
        });
}
