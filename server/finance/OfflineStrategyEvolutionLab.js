import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { backtestBars, CompiledStrategyBacktester } from './CompiledStrategyBacktester.js';
import { compileMarketLabEntry } from './MarketStrategyCompiler.js';
import {
    ALPACA_CRYPTO_FEES,
    deflatedSharpeProbability,
    enforceVenueCompatibility,
    estimateFoldSelectionPbo,
    isAlpacaSpotCrypto,
    TRADING_ECONOMICS_VERSION
} from './TradingResearchPolicy.js';
import { enrichBarsWithCrossAssetContext } from './TradingContextFeatures.js';
import microstructurePipeline from './TradingMicrostructurePipeline.js';
import carryPipeline from './TradingCarryPipeline.js';

const ROOT = process.cwd();
const DEFAULT_REPORT_PATH = path.join(ROOT, 'data', 'market-lab', 'offline-evolution-latest.json');
const EXPERIMENT_LEDGER_PATH = path.join(ROOT, 'data', 'market-lab', 'evolution-experiments.jsonl');
const REGIME_FILTERS = Object.freeze([['ALL'], ['TRENDING'], ['NON_RANGING'], ['VOLATILE'], ['RANGING']]);
const RESEARCH_TIMEFRAMES = Object.freeze(['1H', '4H', '1D']);
const RESEARCH_SYMBOLS = Object.freeze(['BTC-USD', 'ETH-USD', 'SOL-USD', 'LTC-USD', 'LINK-USD', 'AVAX-USD']);
export const COMPOSITIONAL_ALPHA_MODES = Object.freeze([
    'trend', 'mean_reversion', 'rsi_reversion', 'breakout',
    'volume_momentum', 'volatility_breakout', 'trend_pullback',
    'range_reversion', 'ensemble', 'cross_asset_momentum',
    'market_breadth', 'carry_trend', 'microstructure_momentum', 'slow_trend'
]);

const PARAMS = Object.freeze({
    fastWindow: { min: 4, max: 48, step: 2 },
    slowWindow: { min: 12, max: 160, step: 4 },
    minMomentum: { min: 0.0002, max: 0.02, step: 0.0004 },
    exitMomentum: { min: -0.012, max: 0.004, step: 0.0004 },
    entryZ: { min: 0.5, max: 3.5, step: 0.15 },
    exitZ: { min: -0.75, max: 1.25, step: 0.1 },
    breakoutWindow: { min: 8, max: 120, step: 4 },
    breakoutBufferPct: { min: 0, max: 0.012, step: 0.0004 },
    minVolumeRatio: { min: 0.5, max: 2.5, step: 0.1 },
    minVolatilityPct: { min: 0.002, max: 0.04, step: 0.001 },
    confirmationCount: { min: 2, max: 4, step: 1 },
    breadthThreshold: { min: 0.5, max: 0.9, step: 0.05 },
    maxFundingRate: { min: -0.001, max: 0.001, step: 0.0001 },
    minOrderBookImbalance: { min: 0.05, max: 0.6, step: 0.05 },
    maxSpreadBps: { min: 5, max: 80, step: 5 },
    rsiPeriod: { min: 6, max: 30, step: 2 },
    rsiOversold: { min: 12, max: 42, step: 2 },
    rsiOverbought: { min: 58, max: 88, step: 2 },
    stopLossPct: { min: 0.003, max: 0.06, step: 0.002 },
    takeProfitPct: { min: 0.006, max: 0.15, step: 0.004 },
    trailingStopPct: { min: 0.003, max: 0.05, step: 0.002 },
    maxHoldBars: { min: 4, max: 168, step: 4 },
    maxPositionPct: { min: 0.01, max: 0.12, step: 0.005 }
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function timeframeMs(value = '1H') {
    const normalized = String(value || '1H').toUpperCase();
    const match = normalized.match(/^(\d+)(MIN|H|D)$/);
    if (!match) return 60 * 60 * 1000;
    const amount = Math.max(1, Number(match[1]));
    const unit = match[2] === 'MIN' ? 60_000 : match[2] === 'D' ? 86_400_000 : 3_600_000;
    return amount * unit;
}

function barTimestamp(bar = {}) {
    const raw = bar.timestamp ?? bar.t ?? bar.time;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

function seededRandom(seed = 'soma-offline-evolution') {
    let state = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0) || 1;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function behavioralKey(candidate = {}) {
    const dsl = candidate.compiledStrategy?.dsl || {};
    return crypto.createHash('sha1').update(JSON.stringify({
        strategyId: candidate.strategyId,
        symbol: candidate.symbol,
        entry: dsl.entry,
        exit: dsl.exit,
        sizing: dsl.sizing,
        execution: dsl.execution,
        economicsVersion: candidate.economicsVersion || candidate.compiledStrategy?.economicsVersion
    })).digest('hex');
}

function clamp(value, bounds) {
    return Math.max(bounds.min, Math.min(bounds.max, value));
}

function candidateParams(candidate = {}) {
    const dsl = candidate.compiledStrategy?.dsl || {};
    const aggressive = String(candidate.strategyId || '').includes('aggression');
    return {
        fastWindow: finite(dsl.entry?.fastWindow, aggressive ? 8 : 12),
        slowWindow: finite(dsl.entry?.slowWindow, aggressive ? 24 : 34),
        minMomentum: finite(dsl.entry?.minMomentum, aggressive ? 0.0015 : 0.0025),
        exitMomentum: finite(dsl.exit?.exitMomentum, -0.0005),
        entryZ: finite(dsl.entry?.entryZ, 1.5),
        exitZ: finite(dsl.exit?.exitZ, 0),
        breakoutWindow: finite(dsl.entry?.breakoutWindow, 24),
        breakoutBufferPct: finite(dsl.entry?.breakoutBufferPct, 0.001),
        minVolumeRatio: finite(dsl.entry?.minVolumeRatio, 1),
        minVolatilityPct: finite(dsl.entry?.minVolatilityPct, 0.008),
        confirmationCount: Math.round(finite(dsl.entry?.confirmationCount, 2)),
        breadthThreshold: finite(dsl.entry?.breadthThreshold, 0.65),
        maxFundingRate: finite(dsl.entry?.maxFundingRate, 0.0003),
        minOrderBookImbalance: finite(dsl.entry?.minOrderBookImbalance, 0.15),
        maxSpreadBps: finite(dsl.entry?.maxSpreadBps, 30),
        rsiPeriod: finite(dsl.entry?.rsiPeriod, 14),
        rsiOversold: finite(dsl.entry?.rsiOversold, 30),
        rsiOverbought: finite(dsl.entry?.rsiOverbought, 70),
        stopLossPct: finite(dsl.exit?.stopLossPct, 0.018),
        takeProfitPct: finite(dsl.exit?.takeProfitPct, 0.045),
        trailingStopPct: finite(dsl.exit?.trailingStopPct, 0.014),
        maxHoldBars: Math.max(4, Math.round(finite(dsl.exit?.maxPositionAgeMs, 24 * 60 * 60 * 1000) / timeframeMs(dsl.execution?.timeframe))),
        maxPositionPct: finite(dsl.sizing?.maxPositionPct, 0.03)
    };
}

function withParams(candidate, params, lineage = {}) {
    const next = clone(candidate);
    next.compiledStrategy = next.compiledStrategy || { dsl: {} };
    next.compiledStrategy.dsl = next.compiledStrategy.dsl || {};
    next.compiledStrategy.dsl.entry = { ...(next.compiledStrategy.dsl.entry || {}) };
    next.compiledStrategy.dsl.exit = { ...(next.compiledStrategy.dsl.exit || {}) };
    next.compiledStrategy.dsl.sizing = { ...(next.compiledStrategy.dsl.sizing || {}) };
    next.compiledStrategy.dsl.execution = { ...(next.compiledStrategy.dsl.execution || {}) };
    params.fastWindow = Math.round(params.fastWindow);
    params.slowWindow = Math.max(params.fastWindow + 4, Math.round(params.slowWindow));
    const strategyId = String(next.strategyId || '');
    const declaredMode = String(next.compiledStrategy.dsl.entry.mode || '');
    next.compiledStrategy.dsl.entry.mode = COMPOSITIONAL_ALPHA_MODES.includes(declaredMode)
        ? declaredMode
        : /full_aggression|vortex/.test(strategyId)
            ? 'breakout'
            : /boring_algo|daviddtech_keltner/.test(strategyId)
                ? 'rsi_reversion'
                : /micro_scalper|micro_compounder|yield_harvester/.test(strategyId)
                    ? 'mean_reversion'
                    : 'trend';
    for (const key of [
        'fastWindow', 'slowWindow', 'minMomentum', 'entryZ',
        'breakoutWindow', 'breakoutBufferPct', 'minVolumeRatio', 'minVolatilityPct', 'confirmationCount',
        'breadthThreshold', 'maxFundingRate', 'minOrderBookImbalance', 'maxSpreadBps',
        'rsiPeriod', 'rsiOversold', 'rsiOverbought'
    ]) {
        next.compiledStrategy.dsl.entry[key] = Number(params[key].toFixed(6));
    }
    for (const key of ['exitMomentum', 'exitZ', 'stopLossPct', 'takeProfitPct', 'trailingStopPct']) {
        next.compiledStrategy.dsl.exit[key] = Number(params[key].toFixed(6));
    }
    params.maxHoldBars = Math.round(params.maxHoldBars);
    const executionTimeframe = next.compiledStrategy.dsl.execution.timeframe || '1H';
    next.compiledStrategy.dsl.exit.maxPositionAgeMs = params.maxHoldBars * timeframeMs(executionTimeframe);
    next.compiledStrategy.dsl.sizing.maxPositionPct = Number(params.maxPositionPct.toFixed(6));
    next.compiledStrategy.dsl.sizing.maxPaperTradeValue = 250;
    next.compiledStrategy.dsl.execution.timeframe = executionTimeframe;
    next.compiledStrategy.dsl.execution.style = next.compiledStrategy.dsl.execution.style || 'taker_market';
    next.compiledStrategy.economicsVersion = TRADING_ECONOMICS_VERSION;
    next.economicsVersion = TRADING_ECONOMICS_VERSION;
    const fingerprint = crypto.createHash('sha1').update(JSON.stringify({
        strategyId: next.strategyId,
        symbol: next.symbol,
        direction: next.compiledStrategy.dsl.entry.direction || 'long_only',
        allowedRegimes: next.compiledStrategy.dsl.entry.allowedRegimes || ['ALL'],
        executionStyle: next.compiledStrategy.dsl.execution.style || 'taker_market',
        params,
        lineage
    })).digest('hex').slice(0, 14);
    next.id = `offline-evolved-${fingerprint}`;
    next.key = `${next.strategyId}:${next.symbol}:${fingerprint}`;
    next.compiledStrategy.id = `offline-compiled-${fingerprint}`;
    next.compiledStrategy.paperOnly = true;
    next.lineage = lineage;
    next.offlineOnly = true;
    return next;
}

export function mutateCandidate(parent, random = Math.random, mutationScale = 1) {
    const params = candidateParams(parent);
    const keys = Object.keys(PARAMS);
    const mutations = 1 + Math.floor(random() * Math.min(3, keys.length));
    const chosen = [...keys].sort(() => random() - 0.5).slice(0, mutations);
    for (const key of chosen) {
        const bounds = PARAMS[key];
        const magnitude = (1 + Math.floor(random() * 3)) * bounds.step * mutationScale;
        const direction = random() < 0.5 ? -1 : 1;
        params[key] = clamp(params[key] + direction * magnitude, bounds);
    }
    return withParams(parent, params, { type: 'mutation', parents: [parent.id || parent.key || null], changed: chosen });
}

export function crossoverCandidates(left, right, random = Math.random) {
    if (String(left.symbol || '').toUpperCase() !== String(right.symbol || '').toUpperCase()) {
        return mutateCandidate(left, random);
    }
    const a = candidateParams(left);
    const b = candidateParams(right);
    const params = {};
    for (const key of Object.keys(PARAMS)) {
        const blend = random();
        params[key] = clamp(a[key] * blend + b[key] * (1 - blend), PARAMS[key]);
    }
    const base = random() < 0.5 ? left : right;
    return withParams(base, params, { type: 'crossover', parents: [left.id || left.key || null, right.id || right.key || null] });
}

export function evaluateWalkForward({ bars = [], candidate, folds = 3, initialCapital = 10000 } = {}) {
    if (!candidate || bars.length < 120) {
        return { supported: false, reason: 'insufficient_historical_bars', folds: [], fitness: -Infinity };
    }
    const foldCount = Math.max(2, Math.min(5, Number(folds) || 3));
    const initialTrainRatio = 0.5;
    const validationSpan = (1 - initialTrainRatio) / foldCount;
    const results = [];
    for (let index = 0; index < foldCount; index++) {
        const validationStart = Math.floor(bars.length * (initialTrainRatio + validationSpan * index));
        const validationEnd = index === foldCount - 1
            ? bars.length
            : Math.floor(bars.length * (initialTrainRatio + validationSpan * (index + 1)));
        const warmupStart = Math.max(0, validationStart - 40);
        const validation = backtestBars({
            bars: bars.slice(warmupStart, validationEnd),
            candidate,
            initialCapital,
            tradeStartIndex: validationStart - warmupStart
        });
        results.push({
            index,
            validationStart,
            validationEnd,
            bars: validationEnd - validationStart,
            trades: validation.trades,
            totalPnl: validation.totalPnl,
            winRate: validation.winRate,
            profitFactor: validation.profitFactor,
            maxDrawdownPct: validation.maxDrawdownPct,
            frictionPassed: validation.frictionCheck?.passed !== false,
            economicsVersion: validation.frictionCheck?.economicsVersion || null,
            tradeReturns: validation.tradeReturns || [],
            segments: validation.segments || [],
            excessPnlVsNoTrade: validation.excessPnlVsNoTrade || 0,
            missedLimitFills: validation.missedLimitFills || 0
        });
    }
    const totalTrades = results.reduce((sum, fold) => sum + fold.trades, 0);
    const totalPnl = results.reduce((sum, fold) => sum + fold.totalPnl, 0);
    const profitableFolds = results.filter(fold => fold.totalPnl > 0).length;
    const frictionPassed = results.every(fold => fold.frictionPassed);
    const weightedWinRate = totalTrades
        ? results.reduce((sum, fold) => sum + fold.winRate * fold.trades, 0) / totalTrades
        : 0;
    const profitFactor = totalTrades
        ? results.reduce((sum, fold) => {
            const value = fold.profitFactor === Infinity ? 10 : Math.max(0, finite(fold.profitFactor, 0));
            return sum + Math.min(10, value) * fold.trades;
        }, 0) / totalTrades
        : 0;
    const maxDrawdownPct = Math.max(...results.map(fold => fold.maxDrawdownPct), 0);
    const tradeReturns = results.flatMap(fold => fold.tradeReturns || []);
    const expectancyPerTrade = totalTrades ? totalPnl / totalTrades : -Infinity;
    const worstFoldPnl = Math.min(...results.map(fold => fold.totalPnl));
    const foldPnlMean = totalPnl / foldCount;
    const foldPnlVariance = results.reduce((sum, fold) => sum + Math.pow(fold.totalPnl - foldPnlMean, 2), 0) / foldCount;
    const foldInstability = Math.sqrt(foldPnlVariance);
    const currentEconomics = results.every(fold => fold.economicsVersion === TRADING_ECONOMICS_VERSION);
    const fitness = frictionPassed
        ? (totalPnl / 10)
            + Math.max(-3, Math.min(3, expectancyPerTrade)) * 1.5
            + Math.min(3, profitFactor) * 0.6
            + Math.log1p(totalTrades) * 0.15
            + profitableFolds * 0.5
            + Math.min(0, worstFoldPnl) * 0.08
            - foldInstability * 0.02
            - maxDrawdownPct * 0.12
            - (foldCount - profitableFolds) * 1.25
            - Math.max(0, foldCount * 10 - totalTrades) * 0.2
        : -1000;
    // A handful of lucky fills is not enough evidence to call a genome credible.
    // Require at least ten validation trades per fold before it may advance to
    // independent paper validation. This still is not permission to trade live.
    const supported = currentEconomics
        && frictionPassed
        && totalTrades >= foldCount * 10
        && totalPnl > 0
        && profitableFolds >= Math.ceil(foldCount * 0.67)
        && profitFactor >= 1.2;
    return {
        supported,
        fitness: Number(fitness.toFixed(6)),
        totalTrades,
        totalPnl: Number(totalPnl.toFixed(4)),
        expectancyPerTrade: Number(expectancyPerTrade.toFixed(6)),
        worstFoldPnl: Number(worstFoldPnl.toFixed(4)),
        foldInstability: Number(foldInstability.toFixed(4)),
        winRate: Number(weightedWinRate.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(3)),
        maxDrawdownPct: Number(maxDrawdownPct.toFixed(3)),
        profitableFolds,
        foldCount,
        frictionPassed,
        currentEconomics,
        tradeReturns,
        segments: results.flatMap(fold => fold.segments || []),
        folds: results
    };
}

function normalizeBase(entry = {}) {
    if (entry.compiledStrategy?.dsl && entry.strategyId && entry.symbol) return enforceVenueCompatibility(clone(entry));
    const compiled = compileMarketLabEntry(entry);
    return enforceVenueCompatibility({
        ...compiled,
        id: compiled.id || compiled.compiledStrategy?.id,
        key: `${compiled.compiledStrategy?.strategyId}:${compiled.compiledStrategy?.symbol}`,
        strategyId: compiled.compiledStrategy?.strategyId,
        symbol: compiled.compiledStrategy?.symbol,
        assetClass: compiled.compiledStrategy?.assetClass,
        compiledStrategy: compiled.compiledStrategy
    });
}

export class OfflineStrategyEvolutionLab {
    constructor(options = {}) {
        this.backtester = options.backtester || new CompiledStrategyBacktester(options);
        this.reportPath = options.reportPath || DEFAULT_REPORT_PATH;
        this.initialCapital = finite(options.initialCapital, 10000);
        this.evaluationDispatcher = options.evaluationDispatcher || null;
    }

    async evolve({
        bases = [],
        populationSize = 128,
        generations = 8,
        folds = 3,
        seed = 'soma-evolution-v1',
        finalHoldoutStartTimestamp = null,
        trialCountOffset = 0,
        experimentRegistration = null,
        evaluationDispatcher = this.evaluationDispatcher
    } = {}) {
        const normalizedBases = bases.map(normalizeBase)
            .filter(candidate => candidate.strategyId && candidate.symbol && candidate.compiledStrategy?.dsl);
        // This experiment models Alpaca spot-crypto economics. Mixing equity,
        // futures, and crypto candidates under one cost/venue policy makes the
        // ranking meaningless, so use only venue-compatible genomes whenever
        // they are available. Equity-only fixture runs retain their old scope.
        const cryptoBases = normalizedBases.filter(candidate => isAlpacaSpotCrypto(candidate.symbol));
        let baseCandidates = cryptoBases.length ? cryptoBases : normalizedBases;
        if (!baseCandidates.length) throw new Error('No compiled base strategies were provided');
        if (cryptoBases.length) {
            const archetypes = Array.from(new Map(cryptoBases.map(candidate => [candidate.strategyId, candidate])).values());
            baseCandidates = archetypes.flatMap(base => RESEARCH_SYMBOLS.map(symbol => {
                const expanded = enforceVenueCompatibility(clone(base));
                expanded.symbol = symbol;
                expanded.compiledStrategy.symbol = symbol.replace(/-USD$/i, '');
                expanded.key = `${expanded.strategyId}:${symbol}:cross_market_seed`;
                return expanded;
            }));
        }
        const safePopulation = Math.max(8, Math.min(512, Number(populationSize) || 128));
        const safeGenerations = Math.max(1, Math.min(20, Number(generations) || 8));
        const random = seededRandom(seed);
        const barsBySegment = new Map();
        const segmentedCandidates = [];
        for (const candidate of baseCandidates) {
            const symbol = String(candidate.symbol).toUpperCase();
            const declaredTimeframe = candidate.compiledStrategy?.dsl?.execution?.timeframe;
            const requestedResearchFrames = Array.isArray(candidate.researchTimeframes)
                ? candidate.researchTimeframes.filter(frame => RESEARCH_TIMEFRAMES.includes(frame))
                : [];
            const timeframes = isAlpacaSpotCrypto(symbol)
                ? (requestedResearchFrames.length
                    ? requestedResearchFrames
                    : declaredTimeframe && RESEARCH_TIMEFRAMES.includes(declaredTimeframe)
                    ? [declaredTimeframe]
                    : RESEARCH_TIMEFRAMES)
                : [declaredTimeframe || '1H'];
            for (const timeframe of timeframes) {
                const segmentKey = `${symbol}:${timeframe}`;
                let loaded = barsBySegment.get(segmentKey);
                if (!loaded) loaded = await this.backtester.loadBars(symbol, timeframe);
                if (!loaded?.bars?.length || loaded.bars.length < 120) continue;
                const requestedHoldout = finite(finalHoldoutStartTimestamp, 0);
                const timestampIndex = requestedHoldout > 0
                    ? loaded.bars.findIndex(bar => barTimestamp(bar) >= requestedHoldout)
                    : -1;
                const finalHoldoutStart = requestedHoldout > 0
                    ? (timestampIndex >= 120 ? timestampIndex : loaded.bars.length)
                    : Math.floor(loaded.bars.length * 0.8);
                barsBySegment.set(segmentKey, {
                    ...loaded,
                    searchBars: loaded.bars.slice(0, finalHoldoutStart),
                    finalHoldoutStart
                });
                const segmented = clone(candidate);
                segmented.compiledStrategy.dsl.execution = {
                    ...(segmented.compiledStrategy.dsl.execution || {}),
                    timeframe
                };
                segmented.key = `${segmented.key || `${segmented.strategyId}:${symbol}`}:${timeframe}`;
                segmentedCandidates.push(segmented);
            }
        }
        // Context is attached only after every symbol/timeframe is loaded. Each
        // row may use context with the same completed timestamp, never future
        // bars. This keeps cross-asset features causal in replay and holdout.
        for (const [segmentKey, loaded] of barsBySegment.entries()) {
            const [symbol, timeframe] = segmentKey.split(':');
            const contextSeries = {};
            for (const [otherKey, other] of barsBySegment.entries()) {
                const [otherSymbol, otherTimeframe] = otherKey.split(':');
                if (otherTimeframe === timeframe) contextSeries[otherSymbol] = other.bars;
            }
            const withMicrostructure = await microstructurePipeline.enrichBars({
                symbol, bars: loaded.bars, timeframeMs: timeframeMs(timeframe)
            });
            const fundingSeries = await carryPipeline.load(symbol);
            const enriched = enrichBarsWithCrossAssetContext({
                bars: withMicrostructure, targetSymbol: symbol, contextSeries, fundingSeries
            });
            barsBySegment.set(segmentKey, {
                ...loaded,
                bars: enriched,
                searchBars: enriched.slice(0, loaded.finalHoldoutStart)
            });
        }
        if (!barsBySegment.size) throw new Error('No historical bars are available for the supplied base strategies');
        baseCandidates = segmentedCandidates;
        if (!baseCandidates.length) throw new Error('No venue-compatible strategies have matching historical bars');

        const seedCandidates = baseCandidates.flatMap(base => {
            const declaredDirection = base.compiledStrategy?.dsl?.entry?.direction || 'long_only';
            const directions = isAlpacaSpotCrypto(base.symbol)
                ? ['long_only']
                : declaredDirection === 'long_or_short'
                ? ['long_only', 'short_only', 'long_or_short']
                : [declaredDirection];
            return directions.flatMap(direction => COMPOSITIONAL_ALPHA_MODES.flatMap(mode => REGIME_FILTERS.flatMap(allowedRegimes =>
                ['taker_market'].map(executionStyle => {
                    const seed = clone(base);
                    seed.compiledStrategy.dsl.entry = { ...(seed.compiledStrategy.dsl.entry || {}), direction, allowedRegimes, mode };
                    seed.compiledStrategy.dsl.execution = {
                        ...(seed.compiledStrategy.dsl.execution || {}),
                        timeframe: seed.compiledStrategy.dsl.execution?.timeframe || '1H',
                        style: executionStyle,
                        makerOffsetBps: 3
                    };
                    return withParams(seed, candidateParams(seed), {
                        type: 'segmented_seed', direction, allowedRegimes, executionStyle
                    });
                })
            )));
        });
        // Deterministically shuffle seeds before truncating to the configured
        // population. Without this, the first symbol/timeframe in the ledger
        // consumed every population slot whenever seed count exceeded budget.
        for (let index = seedCandidates.length - 1; index > 0; index--) {
            const target = Math.floor(random() * (index + 1));
            [seedCandidates[index], seedCandidates[target]] = [seedCandidates[target], seedCandidates[index]];
        }
        let population = [];
        while (population.length < safePopulation) {
            const base = seedCandidates[population.length % seedCandidates.length];
            population.push(population.length < seedCandidates.length ? base : mutateCandidate(base, random, 1 + population.length / safePopulation));
        }
        const evaluated = [];
        for (let generation = 0; generation < safeGenerations; generation++) {
            const evaluationItems = population.map(candidate => {
                const timeframe = candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
                const loaded = barsBySegment.get(`${String(candidate.symbol).toUpperCase()}:${timeframe}`);
                return {
                    candidate,
                    bars: loaded?.searchBars || [],
                    datasetKey: `${String(candidate.symbol).toUpperCase()}:${timeframe}`,
                    historicalFile: loaded?.file ? path.relative(ROOT, loaded.file).replace(/\\/g, '/') : null
                };
            });
            const evaluations = evaluationDispatcher?.evaluateCandidates
                ? await evaluationDispatcher.evaluateCandidates({
                    items: evaluationItems,
                    folds,
                    initialCapital: this.initialCapital,
                    generation,
                    evaluator: item => item?.bars?.length
                        ? evaluateWalkForward({ bars: item.bars, candidate: item.candidate, folds, initialCapital: this.initialCapital })
                        : { supported: false, fitness: -Infinity, reason: 'no_historical_data' }
                })
                : evaluationItems.map(item => item.bars.length
                    ? evaluateWalkForward({ bars: item.bars, candidate: item.candidate, folds, initialCapital: this.initialCapital })
                    : { supported: false, fitness: -Infinity, reason: 'no_historical_data' });
            const ranked = evaluationItems.map((item, index) => ({
                candidate: item.candidate,
                evaluation: evaluations[index],
                generation,
                historicalFile: item.historicalFile
            })).sort((a, b) => b.evaluation.fitness - a.evaluation.fitness);
            evaluated.push(...ranked);
            const eliteCount = Math.max(2, Math.ceil(safePopulation * 0.15));
            const rankedFamilies = new Map();
            for (const row of ranked) {
                const entryDsl = row.candidate.compiledStrategy?.dsl?.entry || {};
                const executionDsl = row.candidate.compiledStrategy?.dsl?.execution || {};
                const regimes = (entryDsl.allowedRegimes || ['ALL']).join(',');
                const familyKey = `${String(row.candidate.symbol).toUpperCase()}:${executionDsl.timeframe || '1H'}:${entryDsl.mode || 'trend'}:${entryDsl.direction || 'long_only'}:${regimes}:${executionDsl.style || 'taker_market'}`;
                if (!rankedFamilies.has(familyKey)) rankedFamilies.set(familyKey, []);
                rankedFamilies.get(familyKey).push(row);
            }
            const perFamily = Math.max(1, Math.ceil(eliteCount / rankedFamilies.size));
            const diverseElites = Array.from(rankedFamilies.values()).flatMap(rows => rows.slice(0, perFamily));
            const elites = diverseElites
                .sort((a, b) => b.evaluation.fitness - a.evaluation.fitness)
                .slice(0, eliteCount)
                .map(row => row.candidate);
            const next = elites.map(clone);
            while (next.length < safePopulation) {
                const left = elites[Math.floor(random() * elites.length)];
                const sameSymbol = elites.filter(candidate => String(candidate.symbol).toUpperCase() === String(left.symbol).toUpperCase());
                const right = sameSymbol[Math.floor(random() * sameSymbol.length)] || left;
                const child = random() < 0.55
                    ? crossoverCandidates(left, right, random)
                    : mutateCandidate(left, random, Math.max(0.5, 1 - generation / safeGenerations));
                next.push(random() < 0.65 ? mutateCandidate(child, random, 0.75) : child);
            }
            population = next;
        }

        const unique = new Map();
        for (const row of evaluated) {
            // Lineage changes IDs, but not trading behavior. Deduplicate genomes
            // by their executable DSL so cloned elites cannot inflate evidence.
            const key = behavioralKey(row.candidate);
            const existing = unique.get(key);
            if (!existing || row.evaluation.fitness > existing.evaluation.fitness) unique.set(key, row);
        }
        const ranked = Array.from(unique.values()).sort((a, b) => b.evaluation.fitness - a.evaluation.fitness);
        const pbo = estimateFoldSelectionPbo(ranked);
        // The optimizer never sees the newest 20% while evolving. Evaluate only
        // the preselected top genomes on that untouched segment once, so the
        // final holdout does not become another optimization target.
        const finalistPool = [];
        const rankedByFamily = new Map();
        for (const row of ranked) {
            const symbol = String(row.candidate.symbol).toUpperCase();
            const mode = String(row.candidate.compiledStrategy?.dsl?.entry?.mode || 'trend');
            const direction = String(row.candidate.compiledStrategy?.dsl?.entry?.direction || 'long_only');
            const regimes = (row.candidate.compiledStrategy?.dsl?.entry?.allowedRegimes || ['ALL']).join(',');
            const style = row.candidate.compiledStrategy?.dsl?.execution?.style || 'taker_market';
            const timeframe = row.candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
            const familyKey = `${symbol}:${timeframe}:${mode}:${direction}:${regimes}:${style}`;
            if (!rankedByFamily.has(familyKey)) rankedByFamily.set(familyKey, []);
            rankedByFamily.get(familyKey).push(row);
        }
        // Preserve strategy-family diversity at the only point where the sealed
        // holdout is opened. Otherwise a large trend population can crowd every
        // mean-reversion candidate out before the independent quality gate.
        for (const rows of rankedByFamily.values()) finalistPool.push(...rows.slice(0, 25));
        finalistPool.sort((a, b) => b.evaluation.fitness - a.evaluation.fitness);
        const finalists = finalistPool.map(row => {
            const timeframe = row.candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
            const loaded = barsBySegment.get(`${String(row.candidate.symbol).toUpperCase()}:${timeframe}`);
            if (!loaded) return { ...row, finalHoldout: { supported: false, reason: 'no_historical_data' }, qualified: false };
            const warmupBars = Math.max(180, Math.round(candidateParams(row.candidate).slowWindow) + 20);
            const warmupStart = Math.max(0, loaded.finalHoldoutStart - warmupBars);
            const result = backtestBars({
                bars: loaded.bars.slice(warmupStart),
                candidate: row.candidate,
                initialCapital: this.initialCapital,
                tradeStartIndex: loaded.finalHoldoutStart - warmupStart
            });
            const dsr = deflatedSharpeProbability(result.tradeReturns || [], ranked.length + Math.max(0, Number(trialCountOffset) || 0));
            const meaningfulSegments = (result.segments || []).filter(segment => segment.trades >= 5);
            const segmentGatePassed = meaningfulSegments.length > 0
                && meaningfulSegments.every(segment => segment.totalPnl > 0 && segment.profitFactor >= 1);
            const executionStyle = row.candidate.compiledStrategy?.dsl?.execution?.style || 'taker_market';
            const executableNow = executionStyle === 'taker_market';
            const finalHoldout = {
                bars: loaded.bars.length - loaded.finalHoldoutStart,
                trades: result.trades,
                totalPnl: result.totalPnl,
                winRate: result.winRate,
                profitFactor: result.profitFactor,
                maxDrawdownPct: result.maxDrawdownPct,
                frictionPassed: result.frictionCheck?.passed !== false,
                economicsVersion: result.frictionCheck?.economicsVersion || null,
                noTradeBaselinePnl: 0,
                excessPnlVsNoTrade: result.excessPnlVsNoTrade,
                segments: result.segments || [],
                segmentGatePassed,
                deflatedSharpe: dsr,
                pbo,
                executionStyle,
                executableNow,
                missedLimitFills: result.missedLimitFills || 0,
                supported: result.trades >= 30
                    && result.totalPnl > 0
                    && result.excessPnlVsNoTrade > 0
                    && result.profitFactor >= 1.2
                    && segmentGatePassed
                    && dsr.probability >= 0.95
                    && pbo.probability <= 0.5
                    && executableNow
                    && result.frictionCheck?.economicsVersion === TRADING_ECONOMICS_VERSION
                    && result.frictionCheck?.passed !== false
            };
            return { ...row, finalHoldout, qualified: row.evaluation.supported && finalHoldout.supported };
        });
        const qualifiedFinalists = finalists.filter(row => row.qualified);
        const auditFamilies = new Map();
        for (const row of finalists) {
            const dsl = row.candidate.compiledStrategy?.dsl || {};
            const key = [
                String(row.candidate.symbol).toUpperCase(),
                dsl.execution?.timeframe || '1H',
                dsl.entry?.mode || 'trend',
                (dsl.entry?.allowedRegimes || ['ALL']).join(','),
                dsl.execution?.style || 'taker_market'
            ].join(':');
            if (!auditFamilies.has(key)) auditFamilies.set(key, []);
            auditFamilies.get(key).push(row);
        }
        const diverseTopCandidates = [];
        const selectedCandidateIds = new Set();
        const addCandidate = row => {
            const id = row?.candidate?.id || row?.candidate?.key;
            if (!row || selectedCandidateIds.has(id) || diverseTopCandidates.length >= 25) return false;
            selectedCandidateIds.add(id);
            diverseTopCandidates.push(row);
            return true;
        };
        // Exploration quotas keep a currently weaker timeframe or signal
        // family observable. Ranking still decides which members represent
        // each segment; quotas only prevent total starvation.
        for (const timeframe of RESEARCH_TIMEFRAMES) {
            let added = 0;
            for (const row of finalists) {
                if (row.candidate.compiledStrategy?.dsl?.execution?.timeframe === timeframe && addCandidate(row)) added++;
                if (added >= 5) break;
            }
        }
        for (const mode of COMPOSITIONAL_ALPHA_MODES) {
            let added = 0;
            for (const row of finalists) {
                if (row.candidate.compiledStrategy?.dsl?.entry?.mode === mode && addCandidate(row)) added++;
                if (added >= 2) break;
            }
        }
        const familyQueues = Array.from(auditFamilies.values());
        while (diverseTopCandidates.length < 25 && familyQueues.some(rows => rows.length)) {
            for (const rows of familyQueues) {
                if (rows.length && diverseTopCandidates.length < 25) addCandidate(rows.shift());
            }
        }
        const report = {
            success: true,
            mode: 'offline_evolution_only',
            paperOnly: true,
            generatedAt: new Date().toISOString(),
            seed,
            policy: {
                noAutomaticPaperOrLivePromotion: true,
                costsIncluded: true,
                economicsVersion: TRADING_ECONOMICS_VERSION,
                costModel: {
                    venue: 'alpaca_crypto_spot',
                    makerFeeBps: ALPACA_CRYPTO_FEES.makerBps,
                    takerFeeBps: ALPACA_CRYPTO_FEES.takerBps,
                    marketOrdersAreTaker: true,
                    missedMakerFillsModeled: true
                },
                noTradeBaselineRequired: true,
                alpacaCryptoLongOnly: true,
                experimentScope: cryptoBases.length ? 'alpaca_crypto_spot_only' : 'fixture_or_non_crypto_fallback',
                exactSegmentQualification: true,
                minimumFinalHoldoutTrades: 30,
                minimumDeflatedSharpeProbability: 0.95,
                maximumProbabilityBacktestOverfit: 0.5,
                chronologicalWalkForwardFolds: Math.max(2, Math.min(5, Number(folds) || 3)),
                requiresIndependentPaperValidation: true,
                finalHoldoutStartTimestamp: finite(finalHoldoutStartTimestamp, 0) || null
                , experimentRegistrationId: experimentRegistration?.id || null
            },
            summary: {
                bases: baseCandidates.length,
                populationSize: safePopulation,
                generations: safeGenerations,
                evaluations: evaluated.length,
                uniqueCandidates: ranked.length,
                supported: ranked.filter(row => row.evaluation.supported).length,
                finalHoldoutEvaluated: finalists.length,
                qualified: qualifiedFinalists.length
            },
            selectionDiagnostics: {
                pbo,
                trialsConsidered: ranked.length + Math.max(0, Number(trialCountOffset) || 0),
                currentRunUniqueTrials: ranked.length,
                experimentRegistrationId: experimentRegistration?.id || null
            },
            topCandidates: diverseTopCandidates.map(row => ({
                ...row,
                candidate: { ...row.candidate, offlineOnly: true, paperOnly: true },
                requiresIndependentPaperValidation: true
            })),
            qualifiedCandidates: qualifiedFinalists.slice(0, 10).map(row => ({
                ...row,
                candidate: { ...row.candidate, offlineOnly: true, paperOnly: true },
                requiresIndependentPaperValidation: true
            }))
        };
        await fs.mkdir(path.dirname(this.reportPath), { recursive: true });
        await fs.writeFile(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
        await fs.appendFile(EXPERIMENT_LEDGER_PATH, `${JSON.stringify({
            experimentId: `evolution-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            generatedAt: report.generatedAt,
            seed,
            economicsVersion: TRADING_ECONOMICS_VERSION,
            policy: report.policy,
            summary: report.summary,
            selectionDiagnostics: report.selectionDiagnostics,
            topCandidates: report.topCandidates.slice(0, 10).map(row => ({
                candidateId: row.candidate?.id,
                key: row.candidate?.key,
                segment: {
                    symbol: row.candidate?.symbol,
                    direction: row.candidate?.compiledStrategy?.dsl?.entry?.direction,
                    regimes: row.candidate?.compiledStrategy?.dsl?.entry?.allowedRegimes,
                    timeframe: row.candidate?.compiledStrategy?.dsl?.execution?.timeframe,
                    executionStyle: row.candidate?.compiledStrategy?.dsl?.execution?.style
                },
                development: row.evaluation,
                finalHoldout: row.finalHoldout,
                qualified: row.qualified
            }))
        })}\n`, 'utf8');
        return report;
    }

    async runFromExistingReports(options = {}) {
        const {
            simPath = path.join(ROOT, 'data', 'trading', 'sim-to-live-report.json'),
            ledgerPath = path.join(ROOT, 'data', 'market-lab', 'strategy-ledger.json'),
            previousEvolutionPath = this.reportPath,
            ...evolveOptions
        } = options;
        const bases = [];
        try {
            const report = JSON.parse(await fs.readFile(simPath, 'utf8'));
            bases.push(...(report.paperQueue || []));
            if (report.selectedIncumbent) bases.push(report.selectedIncumbent);
        } catch {}
        try {
            const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
            bases.push(...(Array.isArray(ledger?.entries) ? ledger.entries : Array.isArray(ledger) ? ledger : []));
        } catch {}
        const deduped = Array.from(new Map(bases.map(entry => {
            const normalized = normalizeBase(entry);
            return [`${normalized.strategyId}:${normalized.symbol}`, normalized];
        })).values());
        // Sim-to-live may truthfully empty its paper queue after invalidating an
        // incumbent. That must not erase the research universe itself. Recover
        // only executable crypto templates from the previous offline report;
        // their old scores are ignored and every genome is evaluated again.
        if (!deduped.some(candidate => isAlpacaSpotCrypto(candidate.symbol))) {
            try {
                const previous = JSON.parse(await fs.readFile(previousEvolutionPath, 'utf8'));
                const recovered = [
                    ...(previous.qualifiedCandidates || []),
                    ...(previous.topCandidates || [])
                ].map(row => normalizeBase(row?.candidate || row))
                    .filter(candidate => isAlpacaSpotCrypto(candidate.symbol));
                for (const candidate of recovered) {
                    const key = `${candidate.strategyId}:${candidate.symbol}`;
                    if (!deduped.some(existing => `${existing.strategyId}:${existing.symbol}` === key)) deduped.push(candidate);
                }
            } catch {}
        }
        // First-run recovery: research must remain possible even when every
        // mutable report is absent. This is a hypothesis seed, never a promoted
        // strategy; evolve() expands and validates it against sealed data.
        if (!deduped.some(candidate => isAlpacaSpotCrypto(candidate.symbol))) {
            deduped.push(normalizeBase({
                id: 'soma-crypto-research-bootstrap',
                strategyId: 'soma_crypto_research_bootstrap',
                symbol: 'BTC-USD',
                assetClass: 'crypto'
            }));
        }
        // Always seed every supported signal family for each liquid crypto
        // symbol. Previously the optimizer could only mutate whichever family
        // happened to survive in an old report, so a losing trend lineage kept
        // rediscovering variations of itself forever.
        const canonical = [];
        const templates = new Map();
        for (const candidate of deduped) {
            const symbol = String(candidate.symbol || '').toUpperCase();
            if (isAlpacaSpotCrypto(symbol) && !templates.has(symbol)) templates.set(symbol, candidate);
        }
        for (const [symbol, template] of templates) {
            for (const mode of ['trend', 'mean_reversion', 'rsi_reversion', 'breakout']) {
                const candidate = clone(template);
                candidate.strategyId = `soma_${mode}_research`;
                candidate.symbol = symbol;
                candidate.key = `${candidate.strategyId}:${symbol}:canonical`;
                candidate.id = `${candidate.strategyId}-${symbol}`;
                candidate.compiledStrategy = candidate.compiledStrategy || { dsl: {} };
                candidate.compiledStrategy.dsl = candidate.compiledStrategy.dsl || {};
                candidate.compiledStrategy.dsl.entry = {
                    ...(candidate.compiledStrategy.dsl.entry || {}), mode, direction: 'long_only'
                };
                candidate.compiledStrategy.dsl.execution = {
                    ...(candidate.compiledStrategy.dsl.execution || {})
                };
                candidate.researchTimeframes = [...RESEARCH_TIMEFRAMES];
                canonical.push(candidate);
            }
        }
        return this.evolve({ ...evolveOptions, bases: [...deduped, ...canonical] });
    }
}

export default new OfflineStrategyEvolutionLab();
