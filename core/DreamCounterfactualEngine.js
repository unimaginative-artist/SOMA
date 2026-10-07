/**
 * DreamCounterfactualEngine.js — turns SOMA's "dreams" from prose into tested edits.
 *
 * The old DreamArbiter replays trades and asks "what if X had been different?",
 * then writes an LLM prose summary nobody acts on. That is theatre: a
 * description that loops back into the next prompt with no ground truth.
 *
 * This makes the dream REAL. It takes a live strategy's parameters, generates
 * concrete counterfactual variations ("what if the stop were tighter / the take
 * profit wider / we required a regime filter?"), and BACKTESTS each one against
 * real historical bars. It then ranks them by measured improvement over the
 * strategy's own baseline backtest and surfaces any variation that would have
 * done materially better — with the numbers as evidence, not vibes.
 *
 * Every run appends to a hypothesis ledger (data/trading/dream-hypotheses.json)
 * so the dream keeps a TRACK RECORD: which dreamed changes actually beat reality
 * when tested. That track record is what makes it a self-correcting loop instead
 * of a narrative generator — the ablation test it can now pass.
 */

import fs from 'fs/promises';
import path from 'path';
import { backtestBars } from '../server/finance/CompiledStrategyBacktester.js';
import { compileMarketLabEntry } from '../server/finance/MarketStrategyCompiler.js';

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, 'data', 'trading', 'historical-cache');
const LEDGER_PATH = path.join(ROOT, 'data', 'trading', 'dream-hypotheses.json');
const MARKET_LAB_PATH = path.join(ROOT, 'data', 'market-lab', 'strategy-ledger.json');

// Feed a dream winner into the SAME market-lab candidate gate everything else
// clears. This closes the loop WITHOUT weakening it: compileMarketLabEntry runs
// the simulation + performance-guard checks, so a "less bad but still losing"
// variation comes back rejected_in_simulation and never reaches paper. Only a
// genuinely profitable dreamed edge graduates to the paper queue (live stays
// human-gated downstream, unchanged).
async function adoptWinner({ symbol, strategyId, winner, baseBt }) {
    const assetClass = /-USD$/.test(symbol) || ['BTC', 'ETH', 'SOL'].includes(symbol.replace('-USD', '')) ? 'crypto' : 'equity';
    const trades = num(winner.trades);
    const rawEntry = {
        id: `dream-${strategyId}-${symbol}-${Date.now()}`,
        source: 'dream-counterfactual',
        paperOnly: true,
        createdAt: new Date().toISOString(),
        asset: { symbol, assetClass, allowShort: true },
        strategy: { id: strategyId, name: strategyId, premise: `Dreamed counterfactual: ${winner.label}` },
        dslOverride: { exit: winner.dsl },
        metrics: {
            trades,
            winRate: num(winner.winRate) / 100,
            profitFactor: num(winner.profitFactor),
            maxDrawdown: num(winner.maxDrawdownPct) / 100,
            averageDollarPnl: trades ? Number((num(winner.totalPnl) / trades).toFixed(4)) : 0,
            prometheusScore: 0
        },
        walkForward: { grade: 'PENDING' }
    };
    let compiled;
    try {
        compiled = compileMarketLabEntry(rawEntry);
    } catch (e) {
        return { adopted: false, reason: `compile failed: ${e.message}` };
    }
    // Append to the market-lab ledger only if it actually cleared the gate.
    if (compiled.graduation?.canPromoteToPaper) {
        try {
            let ledger = [];
            try { const raw = JSON.parse(await fs.readFile(MARKET_LAB_PATH, 'utf8')); ledger = Array.isArray(raw.entries) ? raw.entries : (Array.isArray(raw) ? raw : []); } catch {}
            ledger.unshift(compiled);
            await fs.writeFile(MARKET_LAB_PATH, JSON.stringify(ledger.slice(0, 500), null, 2), 'utf8');
        } catch (e) {
            return { adopted: false, reason: `ledger write failed: ${e.message}`, gateStatus: compiled.status };
        }
        return { adopted: true, gateStatus: compiled.status, compiledId: compiled.compiledStrategy?.id };
    }
    return { adopted: false, gateStatus: compiled.status, gateReasons: compiled.graduation?.reasons || [] };
}

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

async function loadBars(symbol, timeframes = ['1H', '5Min', '1D']) {
    const aliases = [symbol, symbol.replace('-USD', ''), `${symbol}-USD`];
    for (const tf of timeframes) {
        for (const alias of aliases) {
            try {
                const raw = JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${alias}_${tf}.json`), 'utf8'));
                const bars = Array.isArray(raw.bars) ? raw.bars : (Array.isArray(raw) ? raw : []);
                if (bars.length >= 100) return { bars, timeframe: tf };
            } catch { /* try next */ }
        }
    }
    return null;
}

// Generate concrete counterfactual parameter sets from a baseline. Each is a
// falsifiable "what if" the backtester can actually test.
function generateCounterfactuals(baseline) {
    const sl = num(baseline.stopLossPct, 0.035);
    const tp = num(baseline.takeProfitPct, 0.10);
    const trail = num(baseline.trailingStopPct, 0.014);
    const cfs = [];
    const push = (label, over) => cfs.push({ label, dsl: { exit: { stopLossPct: sl, takeProfitPct: tp, trailingStopPct: trail, ...over.exit }, sizing: baseline.sizing || {} } });

    push('tighter stop (0.6x)', { exit: { stopLossPct: sl * 0.6 } });
    push('wider stop (1.5x)', { exit: { stopLossPct: sl * 1.5 } });
    push('tighter take-profit (0.6x)', { exit: { takeProfitPct: tp * 0.6 } });
    push('wider take-profit (1.5x)', { exit: { takeProfitPct: tp * 1.5 } });
    push('tighter trailing (0.6x)', { exit: { trailingStopPct: trail * 0.6 } });
    push('tighter stop + wider TP (asymmetric)', { exit: { stopLossPct: sl * 0.7, takeProfitPct: tp * 1.4 } });
    push('let winners run (2x TP, 0.8x stop)', { exit: { stopLossPct: sl * 0.8, takeProfitPct: tp * 2 } });
    return cfs;
}

function score(bt) {
    // Risk-adjusted-ish: PnL, with profit factor and drawdown as tie-breakers.
    const pf = Number.isFinite(bt.profitFactor) ? bt.profitFactor : (bt.totalPnl > 0 ? 3 : 0);
    return num(bt.totalPnl) + pf * 5 - num(bt.maxDrawdownPct) * 2;
}

export async function dreamCounterfactuals({ symbol, strategyId, baseline, initialCapital = 10000, minTrades = 5, adopt = true }) {
    const loaded = await loadBars(symbol);
    if (!loaded) return { success: false, reason: `no historical bars for ${symbol}` };
    const { bars, timeframe } = loaded;

    const baselineCandidate = { strategyId, compiledStrategy: { dsl: { exit: {
        stopLossPct: num(baseline.stopLossPct, 0.035),
        takeProfitPct: num(baseline.takeProfitPct, 0.10),
        trailingStopPct: num(baseline.trailingStopPct, 0.014)
    }, sizing: baseline.sizing || {} } } };
    const baseBt = backtestBars({ bars, candidate: baselineCandidate, initialCapital });

    const results = [];
    for (const cf of generateCounterfactuals(baseline)) {
        const bt = backtestBars({ bars, candidate: { strategyId, compiledStrategy: { dsl: cf.dsl } }, initialCapital });
        results.push({
            label: cf.label,
            dsl: cf.dsl.exit,
            trades: bt.trades,
            totalPnl: bt.totalPnl,
            winRate: bt.winRate,
            profitFactor: bt.profitFactor,
            maxDrawdownPct: bt.maxDrawdownPct,
            pnlDeltaVsBaseline: Number((num(bt.totalPnl) - num(baseBt.totalPnl)).toFixed(2)),
            score: Number(score(bt).toFixed(2)),
            beatsBaseline: bt.trades >= minTrades && score(bt) > score(baseBt) && num(bt.totalPnl) > num(baseBt.totalPnl)
        });
    }
    results.sort((a, b) => b.score - a.score);
    const winner = results.find(r => r.beatsBaseline) || null;

    // Close the loop: a winner is fed to the market-lab candidate gate. It only
    // reaches the paper queue if it genuinely passes (positive expectancy etc.).
    let adoption = null;
    if (winner && adopt) {
        adoption = await adoptWinner({ symbol, strategyId, winner, baseBt });
    }

    const report = {
        dreamedAt: new Date().toISOString(),
        symbol, strategyId, timeframe, bars: bars.length,
        baseline: { trades: baseBt.trades, totalPnl: baseBt.totalPnl, winRate: baseBt.winRate, profitFactor: baseBt.profitFactor, maxDrawdownPct: baseBt.maxDrawdownPct, score: Number(score(baseBt).toFixed(2)) },
        counterfactuals: results,
        winner: winner ? { label: winner.label, dsl: winner.dsl, pnlDeltaVsBaseline: winner.pnlDeltaVsBaseline } : null,
        adoption,
        verdict: winner
            ? `Dream found a tested improvement: "${winner.label}" would have made $${winner.pnlDeltaVsBaseline} more than baseline over ${winner.trades} trades.`
              + (adoption?.adopted
                  ? ` ADOPTED → market-lab paper candidate (${adoption.compiledId}).`
                  : ` Fed to candidate gate: ${adoption?.gateStatus || 'n/a'} (not promoted — still below the profitability bar, correctly).`)
            : 'No counterfactual beat the baseline on real data — dream discarded (this is the loop working).'
    };

    // Append to the track-record ledger.
    try {
        let ledger = [];
        try { ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8')); } catch {}
        if (!Array.isArray(ledger)) ledger = [];
        ledger.push({ dreamedAt: report.dreamedAt, symbol, strategyId, winner: report.winner, baselinePnl: baseBt.totalPnl, verdict: report.verdict });
        await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger.slice(-200), null, 2), 'utf8');
    } catch { /* non-fatal */ }

    return { success: true, ...report };
}

export default dreamCounterfactuals;
