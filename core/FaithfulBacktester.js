/**
 * FaithfulBacktester.js — replays SOMA's ACTUAL strategy logic, not generic momentum.
 *
 * The old backtestBars ran a generic SMA-crossover strategy, so its results had
 * no relationship to how full_aggression / btc_native really trade (backtest said
 * ETH -$241/33%, paper said +$26/56%). This runs the REAL deterministic decision
 * core bar-by-bar:
 *   - regime detection (the same SMA-slope / ATR / drawdown / ADX logic the live
 *     MarketRegimeDetector uses)
 *   - REGIME-MATCHED entry: the exact _meanReversionSignal (Bollinger ±2σ + RSI14
 *     + volume spike) in RANGING, technical momentum in TRENDING
 *   - the real preset params (minConfidence gate, stop/TP/trailing, and the
 *     BTC_NATIVE "skip RANGING" filter)
 *   - the same paper friction the live paper engine charges
 *
 * FIDELITY CEILING (honest): the live TRENDING path also blends an LLM
 * sentiment/recommendation layer that cannot be replayed on historical data — so
 * this is faithful for the deterministic RANGING/mean-reversion core and a
 * technical proxy for TRENDING. Calibrate against real paper: if a strategy's
 * backtest lands near its paper result, it's real; if not, the LLM layer matters.
 */

import fs from 'fs/promises';
import path from 'path';
import paperExecutionSimulator from '../server/finance/PaperExecutionSimulator.js';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'data', 'trading', 'historical-cache');

// Real preset params (mirrors autonomousTrader PRESET_CONFIGS + STRATEGY_PROFILES).
const PRESETS = {
    full_aggression: { minConfidence: 0.50, maxPositionPct: 0.18, takeProfitPct: 0.10, stopLossPct: 0.035, trailingStopPct: 0.03, skipRanging: false },
    btc_native:      { minConfidence: 0.75, maxPositionPct: 0.15, takeProfitPct: 0.08, stopLossPct: 0.03,  trailingStopPct: 0.03, skipRanging: true },
    boring_algo:     { minConfidence: 0.65, maxPositionPct: 0.08, takeProfitPct: 0.04, stopLossPct: 0.02,  trailingStopPct: 0.02, skipRanging: false },
};

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function sma(arr, n) { const s = arr.slice(-n); return s.reduce((a, b) => a + b, 0) / s.length; }

function atr(highs, lows, closes, n) {
    const trs = [];
    for (let i = 1; i < highs.length; i++) {
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    const r = trs.slice(-n); return r.reduce((a, b) => a + b, 0) / r.length;
}
function dm(highs, lows, n, plus) {
    let sum = 0;
    for (let i = Math.max(1, highs.length - n); i < highs.length; i++) {
        const up = highs[i] - highs[i - 1], down = lows[i - 1] - lows[i];
        if (plus) { if (up > down && up > 0) sum += up; } else { if (down > up && down > 0) sum += down; }
    }
    return sum / n;
}

// Same classification as MarketRegimeDetector._classifySymbol.
function detectRegime(bars) {
    if (bars.length < 30) return 'RANGING';
    const closes = bars.map(b => num(b.close));
    const highs = bars.map(b => num(b.high, b.close));
    const lows = bars.map(b => num(b.low, b.close));
    const latest = closes[closes.length - 1];
    const sma20 = sma(closes, 20);
    const sma20Prev = sma(closes.slice(0, -3), 20);
    const slope = sma20Prev > 0 ? (sma20 - sma20Prev) / sma20Prev : 0;
    const a = atr(highs, lows, closes, 14);
    const atrRatio = latest > 0 ? a / latest : 0;
    const peak = Math.max(...closes.slice(-10));
    const dd = peak > 0 ? (peak - latest) / peak : 0;
    const dp = dm(highs, lows, 14, true), dmn = dm(highs, lows, 14, false);
    const adx = (dp + dmn) > 0 ? Math.abs(dp - dmn) / (dp + dmn) : 0;
    if (dd > 0.08) return 'CRASH';
    if (atrRatio > 0.025) return 'VOLATILE';
    if (slope > 0.005 && latest > sma20 && adx > 0.25) return 'TRENDING_UP';
    if (slope < -0.005 && latest < sma20 && adx > 0.25) return 'TRENDING_DOWN';
    return 'RANGING';
}

// Exact copy of autonomousTrader._meanReversionSignal.
function meanReversionSignal(bars, price) {
    if (!bars || bars.length < 20) return { action: 'HOLD', confidence: 0 };
    const window = bars.slice(-20).map(b => num(b.close));
    const s = window.reduce((a, c) => a + c, 0) / window.length;
    const std = Math.sqrt(window.reduce((a, c) => a + (c - s) ** 2, 0) / window.length);
    const upper = s + 2 * std, lower = s - 2 * std;
    const vols = bars.slice(-20).map(b => num(b.volume || b.v)).filter(Boolean);
    const avgVol = vols.length ? vols.reduce((a, v) => a + v, 0) / vols.length : 0;
    const curVol = num(bars[bars.length - 1].volume || bars[bars.length - 1].v);
    const volSpike = avgVol > 0 && curVol > avgVol * 1.3;
    let gains = 0, losses = 0;
    for (let i = bars.length - 14; i < bars.length; i++) { const ch = num(bars[i].close) - num(bars[i - 1].close); if (ch > 0) gains += ch; else losses += Math.abs(ch); }
    const avgGain = gains / 14, avgLoss = losses / 14;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    if (price <= lower || rsi < 35) {
        let conf = Math.min(0.9, 0.58 + (35 - Math.min(rsi, 35)) / 100 + Math.max(0, (lower - price) / (std || 1)) * 0.08);
        if (volSpike) conf = Math.min(0.95, conf + 0.10);
        return { action: 'BUY', confidence: conf };
    }
    if (price >= upper || rsi > 65) {
        let conf = Math.min(0.9, 0.58 + (Math.max(rsi, 65) - 65) / 100 + Math.max(0, (price - upper) / (std || 1)) * 0.08);
        if (volSpike) conf = Math.min(0.95, conf + 0.10);
        return { action: 'SELL', confidence: conf };
    }
    return { action: 'HOLD', confidence: 0 };
}

// Technical momentum for TRENDING (proxy for the live LLM-blended recommendation).
function momentumSignal(bars, price, regime) {
    const closes = bars.map(b => num(b.close));
    const fast = sma(closes, 8), slow = sma(closes, 21);
    const mom = slow > 0 ? (fast - slow) / slow : 0;
    if (regime === 'TRENDING_UP' && mom > 0.0015) return { action: 'BUY', confidence: Math.min(0.9, 0.55 + mom * 20) };
    if (regime === 'TRENDING_DOWN' && mom < -0.0015) return { action: 'SELL', confidence: Math.min(0.9, 0.55 + Math.abs(mom) * 20) };
    return { action: 'HOLD', confidence: 0 };
}

async function loadBars(symbol, timeframes = ['1H', '5Min', '1D']) {
    const aliases = [symbol, symbol.replace('-USD', ''), `${symbol}-USD`];
    for (const tf of timeframes) for (const a of aliases) {
        try {
            const raw = JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${a}_${tf}.json`), 'utf8'));
            const bars = Array.isArray(raw.bars) ? raw.bars : (Array.isArray(raw) ? raw : []);
            if (bars.length >= 100) return { bars, timeframe: tf };
        } catch {}
    }
    return null;
}

export async function faithfulBacktest({ symbol, presetName, initialCapital = 3300, warmup = 50 }) {
    const preset = PRESETS[presetName];
    if (!preset) return { success: false, reason: `unknown preset ${presetName}` };
    const loaded = await loadBars(symbol);
    if (!loaded) return { success: false, reason: `no bars for ${symbol}` };
    const { bars, timeframe } = loaded;

    let cash = initialCapital, position = null;
    const trades = [];
    for (let i = warmup; i < bars.length; i++) {
        const window = bars.slice(0, i + 1);
        const price = num(window[window.length - 1].close);
        if (price <= 0) continue;
        const regime = detectRegime(window);

        if (position) {
            position.peak = Math.max(position.peak, price);
            position.trough = Math.min(position.trough, price);
            const dir = position.side === 'long' ? 1 : -1;
            const pnlPct = dir * (price - position.entry) / position.entry;
            const trailPct = position.side === 'long' ? (price - position.peak) / position.peak : (position.trough - price) / position.trough;
            let exit = null;
            if (pnlPct >= preset.takeProfitPct) exit = 'take_profit';
            else if (pnlPct <= -preset.stopLossPct) exit = 'stop_loss';
            else if (trailPct <= -preset.trailingStopPct) exit = 'trailing_stop';
            if (exit) {
                const cost = paperExecutionSimulator.estimateCostPct({ referencePrice: price, qty: position.qty, bars: window.slice(-30) });
                const gross = position.qty * price * (1 - cost.perSidePct);
                const pnl = position.side === 'long' ? gross - position.cost : position.cost - gross + (position.cost - position.qty * position.entry) * 0; // long-only accounting below handles it
                // Unified long/short PnL:
                const realized = dir * (position.qty * (price - position.entry)) - (position.qty * price * cost.perSidePct) - position.entryFriction;
                cash += realized;
                trades.push({ side: position.side, entry: position.entry, exit: price, pnl: Number(realized.toFixed(4)), reason: exit, regime: position.regime });
                position = null;
            }
            continue;
        }

        // Entry — regime-matched, real preset gate + BTC_NATIVE ranging filter.
        const isRanging = regime === 'RANGING';
        if (preset.skipRanging && isRanging) continue;
        const sig = isRanging ? meanReversionSignal(window, price) : momentumSignal(window, price, regime);
        if (sig.action === 'HOLD' || sig.confidence < preset.minConfidence) continue;

        const spend = Math.min(cash * preset.maxPositionPct, cash);
        if (spend < 10) continue;
        const cost = paperExecutionSimulator.estimateCostPct({ referencePrice: price, qty: spend / price, bars: window.slice(-30) });
        const qty = spend / price;
        position = {
            side: sig.action === 'BUY' ? 'long' : 'short',
            entry: price, qty, cost: spend, peak: price, trough: price, regime,
            entryFriction: spend * cost.perSidePct
        };
    }

    const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
    const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    return {
        success: true, symbol, presetName, timeframe, bars: bars.length,
        trades: trades.length,
        totalPnl: Number(totalPnl.toFixed(2)),
        winRate: trades.length ? Number((wins.length / trades.length * 100).toFixed(1)) : 0,
        profitFactor: gl > 0 ? Number((gw / gl).toFixed(2)) : (gw > 0 ? Infinity : 0),
        byRegime: ['RANGING', 'TRENDING_UP', 'TRENDING_DOWN', 'VOLATILE'].map(r => {
            const rt = trades.filter(t => t.regime === r);
            return rt.length ? { regime: r, trades: rt.length, pnl: Number(rt.reduce((a, t) => a + t.pnl, 0).toFixed(2)) } : null;
        }).filter(Boolean)
    };
}

export default faithfulBacktest;
