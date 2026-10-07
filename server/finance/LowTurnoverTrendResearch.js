import crypto from 'node:crypto';
import { CompiledStrategyBacktester } from './CompiledStrategyBacktester.js';
import { validateHistoricalBars } from './TradingHistoricalDataPipeline.js';
import { validateResearchCandidate } from './TradingResearchValidator.js';
import { TRADING_ECONOMICS_VERSION } from './TradingResearchPolicy.js';

export const LOW_TURNOVER_RESEARCH_VERSION = 'low-turnover-4h-v1';
export const LOW_TURNOVER_SYMBOLS = Object.freeze(['BTC-USD', 'ETH-USD', 'SOL-USD']);
const FOUR_HOURS_MS = 4 * 60 * 60_000;

// One predeclared hypothesis, not a parameter sweep. It deliberately holds
// longer than the current eight-hour catalog recipe and remains research-only.
export function lowTurnoverTrendCandidate(symbol) {
    if (!LOW_TURNOVER_SYMBOLS.includes(symbol)) throw new Error('Unsupported low-turnover research symbol');
    const dsl = {
        entry: { mode: 'trend', direction: 'long_only', fastWindow: 18, slowWindow: 72,
            minMomentum: 0.015, allowedRegimes: ['ALL'] },
        exit: { stopLossPct: 0.04, takeProfitPct: 0.12, trailingStopPct: 0.04,
            exitMomentum: -0.005, maxPositionAgeMs: 14 * 24 * 60 * 60_000 },
        sizing: { maxPositionPct: 0.025, maxPaperTradeValue: 250 },
        execution: { timeframe: '4H', style: 'taker_market', venue: 'alpaca_crypto_spot' },
        risk: { shortingAllowed: false }
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify({ version: LOW_TURNOVER_RESEARCH_VERSION, dsl })).digest('hex').slice(0, 12);
    // Portfolio state is keyed by id, so the same rule on another market
    // needs its own immutable observation identity.
    const id = `${LOW_TURNOVER_RESEARCH_VERSION}-${symbol.toLowerCase()}-${hash}`;
    return { id, key: `${symbol}|low_turnover_trend|${id}`, symbol,
        strategyId: 'low_turnover_trend', researchOnly: true, paperOnly: true,
        economicsVersion: TRADING_ECONOMICS_VERSION,
        compiledStrategy: { id, strategyId: 'low_turnover_trend', paperOnly: true,
            economicsVersion: TRADING_ECONOMICS_VERSION, dsl } };
}

function compactRun(run = {}) {
    return { trades: run.trades, totalPnl: run.totalPnl, profitFactor: run.profitFactor,
        winRate: run.winRate, maxDrawdownPct: run.maxDrawdownPct,
        frictionCheck: run.frictionCheck,
        returnInterval: run.returnInterval,
        deflatedSharpe: run.deflatedSharpe };
}

export async function evaluateLowTurnoverTrend({ symbol, backtester = new CompiledStrategyBacktester({ requireProvenance: true }),
    now = Date.now() } = {}) {
    const candidate = lowTurnoverTrendCandidate(symbol);
    const loaded = await backtester.loadBars(symbol, '4H');
    if (!loaded?.provenanceVerified || loaded.provenance?.venue !== 'alpaca_crypto_us') {
        throw new Error(`${symbol}: missing verified Alpaca provenance`);
    }
    const bars = loaded.bars;
    const dataValidation = validateHistoricalBars(bars, { intervalMs: FOUR_HOURS_MS, now });
    if (!dataValidation.valid || bars.some(bar => bar.source !== 'alpaca_crypto_us' || bar.isMock)) {
        throw new Error(`${symbol}: real completed Alpaca candle validation failed`);
    }
    // The same frozen rule is examined on three markets; account for all three
    // opportunities to select an apparently lucky result.
    const evaluation = validateResearchCandidate({ bars, candidate, folds: 4,
        trials: LOW_TURNOVER_SYMBOLS.length });
    return { symbol, candidateKey: candidate.key, researchOnly: true, paperOnly: true,
        liveEligible: false, paperEligible: false, data: {
            file: loaded.file, venue: loaded.provenance.venue, sha256: loaded.provenance.sha256,
            bars: bars.length, firstBar: bars[0].timestamp, lastBar: bars.at(-1).timestamp,
            gaps: dataValidation.gaps, ageMs: dataValidation.ageMs
        },
        passedExistingResearchGates: evaluation.passed,
        rejectionReasons: evaluation.reasons,
        causality: evaluation.causality,
        development: { supported: evaluation.development?.supported,
            totalTrades: evaluation.development?.totalTrades,
            totalPnl: evaluation.development?.totalPnl,
            profitableFolds: evaluation.development?.profitableFolds,
            foldCount: evaluation.development?.foldCount },
        heldOut: compactRun(evaluation.heldOut),
        limitations: [
            'Historical evaluation only; no prospective paper outcomes',
            'Existing historical bars may have been inspected during earlier research',
            'Passing research gates does not authorize paper or live execution'
        ] };
}
