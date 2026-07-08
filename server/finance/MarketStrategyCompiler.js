import crypto from 'crypto';
import tradingPerformanceGuard, { normalizeStrategyId } from './TradingPerformanceGuard.js';

const DEFAULT_COMPILER_POLICY = Object.freeze({
    minTrades: 100,
    minWinRate: 0.55,
    minProfitFactor: 1.2,
    maxDrawdown: 0.18,
    minAverageDollarPnl: 0,
    minPrometheusScore: 0.62,
    paperOnly: true
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeSymbol(value) {
    return String(value || '').trim().toUpperCase();
}

function metricWinRate(metrics = {}) {
    const raw = finite(metrics.winRate, 0);
    return raw > 1 ? raw / 100 : raw;
}

function stableHash(value) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex')
        .slice(0, 16);
}

function inferSignalSet(strategyId, assetClass) {
    const id = normalizeStrategyId(strategyId);
    if (id.includes('scalp')) return ['micro_mean_reversion', 'micro_breakout', 'spread_guard'];
    if (id.includes('yield')) return ['low_volatility_filter', 'trend_guard', 'carry_proxy'];
    if (id.includes('swarm')) return ['trend', 'mean_reversion', 'breakout', 'volatility_guard'];
    if (id.includes('vortex')) return ['volatility_regime', 'asymmetric_exit', 'breakout'];
    if (assetClass === 'crypto') return ['trend', 'volatility_guard', 'liquidity_guard'];
    return ['trend', 'momentum', 'risk_guard'];
}

function buildCompiledStrategy(entry, policy) {
    const strategyId = normalizeStrategyId(entry.strategy?.id || entry.strategyId || entry.strategy?.name);
    const symbol = normalizeSymbol(entry.asset?.symbol || entry.symbol);
    const assetClass = entry.asset?.assetClass || entry.assetClass || entry.asset?.type || 'unknown';
    const source = {
        sourceEntryId: entry.id || null,
        strategyId,
        symbol,
        assetClass,
        metrics: entry.metrics || {},
        paperAccount: entry.paperAccount || {},
        prometheusScore: finite(entry.prometheusScore ?? entry.metrics?.prometheusScore, 0)
    };
    const hash = stableHash(source);

    return {
        id: `compiled-${hash}`,
        version: 1,
        strategyId,
        strategyName: entry.strategy?.name || strategyId,
        symbol,
        assetClass,
        sourceEntryId: source.sourceEntryId,
        source: 'market_strategy_compiler',
        paperOnly: true,
        premise: entry.strategy?.premise || null,
        dsl: {
            signalSet: inferSignalSet(strategyId, assetClass),
            entry: {
                type: 'threshold_consensus',
                minConfidence: Number(Math.max(0.55, Math.min(0.8, policy.minWinRate + 0.05)).toFixed(3)),
                direction: entry.asset?.allowShort ? 'long_or_short' : 'long_only'
            },
            exit: {
                type: 'bounded_dynamic_exit',
                // Honor caller-provided exit params (e.g. a DreamCounterfactual winner
                // whose specific stop/TP beat the baseline on real bars) — otherwise the
                // discovered edge would be silently overwritten by asset-class defaults.
                stopLossPct: finite(entry.dslOverride?.exit?.stopLossPct, assetClass === 'crypto' ? 0.018 : 0.012),
                takeProfitPct: finite(entry.dslOverride?.exit?.takeProfitPct, assetClass === 'crypto' ? 0.045 : 0.028),
                trailingStopPct: finite(entry.dslOverride?.exit?.trailingStopPct, assetClass === 'crypto' ? 0.014 : 0.009),
                maxPositionAgeMs: assetClass === 'crypto' ? 4 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
            },
            sizing: {
                type: 'risk_budget',
                maxPositionPct: assetClass === 'crypto' ? 0.03 : 0.05,
                maxPaperTradeValue: 1000,
                liveTradingEnabled: false
            },
            risk: {
                paperOnly: true,
                maxDrawdown: policy.maxDrawdown,
                minTrades: policy.minTrades,
                minProfitFactor: policy.minProfitFactor,
                minWinRate: policy.minWinRate
            },
            allowedSymbols: [symbol],
            allowedAssetClasses: [assetClass]
        },
        compiledAt: new Date().toISOString()
    };
}

function evaluateSimulation(entry, policy) {
    const metrics = entry.metrics || {};
    const paperAccount = entry.paperAccount || {};
    const trades = finite(metrics.trades, 0);
    const winRate = metricWinRate(metrics);
    const profitFactor = finite(metrics.profitFactor, 0);
    const maxDrawdown = finite(metrics.maxDrawdown, 1);
    const averageDollarPnl = finite(paperAccount.averageDollarPnl ?? metrics.averageDollarPnl, 0);
    const prometheusScore = finite(entry.prometheusScore ?? metrics.prometheusScore, 0);
    const reasons = [];

    if (trades < policy.minTrades) reasons.push(`simulation trades ${trades} < ${policy.minTrades}`);
    if (winRate < policy.minWinRate) reasons.push(`simulation win rate ${(winRate * 100).toFixed(1)}% < ${(policy.minWinRate * 100).toFixed(1)}%`);
    if (profitFactor < policy.minProfitFactor) reasons.push(`simulation profit factor ${profitFactor} < ${policy.minProfitFactor}`);
    if (maxDrawdown > policy.maxDrawdown) reasons.push(`simulation max drawdown ${(maxDrawdown * 100).toFixed(1)}% > ${(policy.maxDrawdown * 100).toFixed(1)}%`);
    if (averageDollarPnl <= policy.minAverageDollarPnl) reasons.push(`simulation average P&L ${averageDollarPnl} <= ${policy.minAverageDollarPnl}`);
    if (prometheusScore < policy.minPrometheusScore) reasons.push(`Prometheus score ${prometheusScore} < ${policy.minPrometheusScore}`);
    if (entry.walkForward?.grade === 'OVERFITTED') reasons.push('walk-forward validation marked strategy overfitted');

    return {
        passed: reasons.length === 0,
        reasons,
        metrics: {
            trades,
            winRate: Number(winRate.toFixed(4)),
            profitFactor,
            maxDrawdown,
            averageDollarPnl,
            prometheusScore
        }
    };
}

function compileMarketLabEntry(entry = {}, options = {}) {
    const policy = { ...DEFAULT_COMPILER_POLICY, ...(options.policy || {}) };
    const compiledStrategy = buildCompiledStrategy(entry, policy);
    const simulation = evaluateSimulation(entry, policy);
    const symbolBound = !!compiledStrategy.symbol && compiledStrategy.dsl.allowedSymbols.length === 1;
    const performanceGuard = tradingPerformanceGuard.evaluate({
        symbol: compiledStrategy.symbol,
        strategyId: compiledStrategy.strategyId,
        policy: options.performancePolicy || {}
    });

    const reasons = [];
    if (!symbolBound) reasons.push('compiled strategy is not bound to exactly one symbol');
    if (!simulation.passed) reasons.push(...simulation.reasons);
    if (!performanceGuard.allowed) reasons.push(...performanceGuard.reasons.map(reason => `paper evidence quarantine: ${reason}`));

    let status = 'candidate';
    if (!simulation.passed || !symbolBound) status = 'rejected_in_simulation';
    else if (!performanceGuard.allowed) status = 'blocked_by_live_paper';
    else status = 'ready_for_paper';

    return {
        ...entry,
        status,
        compiledStrategy,
        performanceGuard,
        validation: {
            schemaValid: symbolBound,
            symbolBound,
            simulation,
            performanceGuard: {
                allowed: performanceGuard.allowed,
                action: performanceGuard.action,
                reasons: performanceGuard.reasons,
                stats: performanceGuard.stats,
                evaluatedAt: performanceGuard.evaluatedAt
            }
        },
        graduation: {
            status,
            canPromoteToPaper: status === 'ready_for_paper',
            canPromoteToLive: false,
            reasons,
            paperOnly: true,
            decidedAt: new Date().toISOString()
        }
    };
}

function compileMarketLabLedger(entries = [], options = {}) {
    const compiled = (Array.isArray(entries) ? entries : []).map(entry => compileMarketLabEntry(entry, options));
    const byStatus = compiled.reduce((acc, entry) => {
        const key = entry.graduation?.status || entry.status || 'candidate';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const ready = compiled.filter(entry => entry.graduation?.canPromoteToPaper);
    const blocked = compiled.filter(entry => entry.status === 'blocked_by_live_paper');
    return {
        entries: compiled,
        summary: {
            total: compiled.length,
            byStatus,
            readyForPaper: ready.length,
            blockedByLivePaper: blocked.length,
            rejectedInSimulation: byStatus.rejected_in_simulation || 0,
            bestReady: [...ready].sort((a, b) => (b.prometheusScore || 0) - (a.prometheusScore || 0))[0] || null,
            generatedAt: new Date().toISOString(),
            paperOnly: true
        }
    };
}

export {
    DEFAULT_COMPILER_POLICY,
    compileMarketLabEntry,
    compileMarketLabLedger,
    normalizeSymbol
};
