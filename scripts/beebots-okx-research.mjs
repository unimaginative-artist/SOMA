// Read-only OKX historical research. This deterministic proxy does not include
// Laya decisions, order-book depth, or actual funding settlement.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { paperNetPnl } from '../server/trading/BeePaperExecutionCosts.js';

const instruments = { bizzy: 'BTC-USDT-SWAP', boozy: 'ETH-USDT-SWAP', breezy: 'SOL-USDT-SWAP' };
const candidates = {
    bizzy: [{ k1: 0.5, k2: 0.5, stopAtr: 1.5, targetAtr: 2.5 },
        { k1: 0.7, k2: 0.7, stopAtr: 2, targetAtr: 3 }],
    boozy: [{ rsiOversold: 30, rsiOverbought: 70, bollingerStdDev: 2, stopAtr: 1.5, targetAtr: 2 },
        { rsiOversold: 25, rsiOverbought: 75, bollingerStdDev: 2.2, stopAtr: 2, targetAtr: 2.5 }],
    breezy: [{ trendLookbackBars: 24, stopAtr: 1.5, targetAtr: 2.5 },
        { trendLookbackBars: 36, stopAtr: 2, targetAtr: 3 }]
};

export function parseCompletedCandles(rows) {
    return rows.filter(row => row[8] === '1').map(row => ({
        ts: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
        low: Number(row[3]), close: Number(row[4]), volume: Number(row[5])
    })).filter(bar => Number.isFinite(bar.ts) && [bar.open, bar.high, bar.low, bar.close]
        .every(value => Number.isFinite(value) && value > 0));
}

export async function fetchOkxHistory(instId, maxBars = 1200, fetchImpl = fetch) {
    const byTime = new Map();
    let after = null;
    for (let page = 0; page < Math.ceil(maxBars / 300) + 2 && byTime.size < maxBars; page++) {
        const url = new URL('https://www.okx.com/api/v5/market/history-candles');
        url.searchParams.set('instId', instId);
        url.searchParams.set('bar', '1H');
        url.searchParams.set('limit', '300');
        if (after != null) url.searchParams.set('after', String(after));
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`OKX ${instId} HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.code !== '0' || !Array.isArray(payload.data)) throw new Error(`OKX ${instId} rejected historical request`);
        const times = payload.data.map(row => Number(row[0])).filter(Number.isFinite);
        if (!times.length) break;
        const oldest = Math.min(...times);
        if (after != null && oldest >= after) throw new Error(`OKX ${instId} pagination did not advance`);
        for (const bar of parseCompletedCandles(payload.data)) byTime.set(bar.ts, bar);
        after = oldest;
        if (payload.data.length < 300) break;
    }
    const bars = [...byTime.values()].sort((a, b) => a.ts - b.ts).slice(-maxBars);
    if (bars.length < 300) throw new Error(`OKX ${instId} returned only ${bars.length} completed bars`);
    return bars;
}

function rsi(bars, end, length = 14) {
    let gains = 0, losses = 0;
    for (let i = end - length + 1; i <= end; i++) {
        const change = bars[i].close - bars[i - 1].close;
        gains += Math.max(0, change);
        losses += Math.max(0, -change);
    }
    return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
}

function signal(bee, bars, i, params) {
    const close = bars[i].close;
    if (bee === 'bizzy') {
        const lookback = bars.slice(i - 24, i);
        const range = Math.max(...lookback.map(b => b.high)) - Math.min(...lookback.map(b => b.low));
        const anchor = lookback[0].open;
        return close > anchor + params.k1 * range ? 'LONG'
            : close < anchor - params.k2 * range ? 'SHORT' : null;
    }
    if (bee === 'boozy') {
        const value = rsi(bars, i);
        const recent = bars.slice(i - 19, i + 1).map(b => b.close);
        const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
        const deviation = Math.sqrt(recent.reduce((sum, x) => sum + (x - mean) ** 2, 0) / recent.length);
        return value < params.rsiOversold && close < mean - params.bollingerStdDev * deviation ? 'LONG'
            : value > params.rsiOverbought && close > mean + params.bollingerStdDev * deviation ? 'SHORT' : null;
    }
    const previous = bars[i - params.trendLookbackBars].close;
    const change = (close - previous) / previous;
    return change > 0.02 ? 'LONG' : change < -0.02 ? 'SHORT' : null;
}

export function replay(bee, bars, params, start, end) {
    const trades = [];
    let equity = 333.33, peak = equity, maxDrawdown = 0;
    for (let i = Math.max(start, 40); i < end - 1;) {
        const side = signal(bee, bars, i - 1, params); // only completed prior bars
        if (!side) { i++; continue; }
        const entry = bars[i].open; // next bar open, never signal bar close
        const window = bars.slice(i - 14, i);
        const atr = window.reduce((sum, bar, idx) => sum + Math.max(bar.high - bar.low,
            Math.abs(bar.high - (window[idx - 1]?.close ?? bar.open)),
            Math.abs(bar.low - (window[idx - 1]?.close ?? bar.open))), 0) / window.length;
        const distance = Math.max(atr, entry * 0.002) * params.stopAtr;
        const target = Math.max(atr, entry * 0.002) * params.targetAtr;
        const size = Math.min(equity * 0.02 / (distance + entry * 0.0015), equity * 5 / entry);
        if (size <= 0) break;
        const stop = entry + (side === 'LONG' ? -distance : distance);
        const take = entry + (side === 'LONG' ? target : -target);
        let exitIndex = Math.min(end - 1, i + 24), exit = bars[exitIndex].close;
        for (let j = i; j <= exitIndex; j++) {
            const stopHit = side === 'LONG' ? bars[j].low <= stop : bars[j].high >= stop;
            const takeHit = side === 'LONG' ? bars[j].high >= take : bars[j].low <= take;
            if (stopHit || takeHit) {
                // If both happen in one bar, assume the adverse stop fires first.
                exitIndex = j;
                exit = stopHit ? stop : take;
                break;
            }
        }
        const costs = paperNetPnl({ side, entryPrice: entry, exitPrice: exit,
            size, heldMs: Math.max(0, bars[exitIndex].ts - bars[i].ts) });
        equity += costs.netPnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
        trades.push({ entryTs: bars[i].ts, exitTs: bars[exitIndex].ts,
            side, entry, exit, size, grossPnl: costs.grossPnl, netPnl: costs.netPnl,
            modeledCosts: costs.totalCosts });
        i = exitIndex + 1;
    }
    const wins = trades.filter(t => t.netPnl > 0);
    const grossWins = wins.reduce((sum, t) => sum + t.netPnl, 0);
    const grossLosses = -trades.filter(t => t.netPnl < 0).reduce((sum, t) => sum + t.netPnl, 0);
    return { trades, metrics: { trades: trades.length, totalPnl: equity - 333.33,
        winRate: trades.length ? wins.length / trades.length : 0,
        profitFactor: grossLosses ? grossWins / grossLosses : 0, maxDrawdown,
        modeledCosts: trades.reduce((sum, t) => sum + t.modeledCosts, 0) } };
}

export function evaluateResearch(bee, bars) {
    const split = Math.floor(bars.length * 0.7);
    const training = candidates[bee].map(params => ({ params,
        result: replay(bee, bars, params, 40, split) }));
    training.sort((a, b) => b.result.metrics.totalPnl - a.result.metrics.totalPnl);
    const frozen = training[0].params;
    const holdout = replay(bee, bars, frozen, split, bars.length);
    return { frozenParameters: frozen, trainEndTs: bars[split - 1].ts,
        holdoutStartTs: bars[split].ts, trainingCandidates: training.map(item => ({
            parameters: item.params, metrics: item.result.metrics })),
        holdout, eligibleForPromotion: false,
        limitation: 'Deterministic candle proxy omits Laya decisions, bid/ask spread history, order-book fills and historical funding; requires independent validation.' };
}

export async function runResearch(outputDir = path.join(process.cwd(), 'data', 'market-lab', 'beebots-research')) {
    fs.mkdirSync(outputDir, { recursive: true });
    const runId = `okx-research-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const summary = { runId, createdAt: new Date().toISOString(), source: 'OKX public history-candles',
        interval: '1H', paperOnly: true, promotionAuthorized: false, bees: {} };
    for (const [bee, instrument] of Object.entries(instruments)) {
        const bars = await fetchOkxHistory(instrument);
        const raw = JSON.stringify({ instrument, bars });
        const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
        const dataFile = `${runId}-${bee}-candles.json`;
        fs.writeFileSync(path.join(outputDir, dataFile), raw);
        summary.bees[bee] = { instrument, dataFile, sha256, completedBars: bars.length,
            firstTs: bars[0].ts, lastTs: bars.at(-1).ts, ...evaluateResearch(bee, bars) };
    }
    const summaryFile = path.join(outputDir, `${runId}.json`);
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    return summaryFile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { console.log(await runResearch()); }
    catch (error) { console.error(error); process.exitCode = 1; }
}
