import tradeLogger from './TradeLogger.js';

export const TOXIC_STRATEGIES = Object.freeze(new Set([
    'full_aggression',
    'daviddtech_keltner',
    'paper_canary_full_aggression'
]));

const DEFAULT_POLICY = Object.freeze({
    provisionalPairMinTrades: 5,
    provisionalStrategyMinTrades: 5,
    pairMinTrades: 30,
    strategyMinTrades: 30,
    minPairWinRate: 40,
    minStrategyWinRate: 40,
    minPairProfitFactor: 1.0,
    minStrategyProfitFactor: 1.0,
    maxPairLossUsd: 0,
    maxStrategyLossUsd: 0,
    hardMaxStrategyLossUsd: -5.0
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeStrategyId(value) {
    return String(value || 'unknown')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'unknown';
}

function pct(value) {
    const n = finite(value, 0);
    return n <= 1 ? n * 100 : n;
}

function summarizeTrades(trades = []) {
    const closed = trades.filter(trade => trade?.status === 'closed');
    const wins = closed.filter(trade => finite(trade.pnl, 0) > 0);
    const losses = closed.filter(trade => finite(trade.pnl, 0) <= 0);
    const totalPnl = closed.reduce((sum, trade) => sum + finite(trade.pnl, 0), 0);
    const grossProfit = wins.reduce((sum, trade) => sum + finite(trade.pnl, 0), 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + finite(trade.pnl, 0), 0));
    return {
        trades: closed.length,
        wins: wins.length,
        losses: losses.length,
        totalPnl: Number(totalPnl.toFixed(2)),
        winRate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(2)) : 0,
        profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(3)) : (grossProfit > 0 ? Infinity : 0),
        grossProfit: Number(grossProfit.toFixed(2)),
        grossLoss: Number(grossLoss.toFixed(2)),
        avgPnl: closed.length ? Number((totalPnl / closed.length).toFixed(4)) : 0
    };
}

class TradingPerformanceGuard {
    constructor({ tradeSource = tradeLogger, limbicPolicy = null } = {}) {
        this.policy = { ...DEFAULT_POLICY };
        this._lastReport = null;
        this.tradeSource = tradeSource;
        this.limbicPolicy = limbicPolicy;
    }

    setLimbicPolicy(limbicPolicy) {
        this.limbicPolicy = limbicPolicy;
        return this;
    }

    configure(policy = {}) {
        this.policy = { ...this.policy, ...policy };
        return this.policy;
    }

    _ensureDb() {
        if (!this.tradeSource.db && this.tradeSource.initialize) this.tradeSource.initialize();
        return this.tradeSource.db;
    }

    _closedTrades({ since = null } = {}) {
        try {
            this._ensureDb();
            return this.tradeSource.getClosedTrades(null, { since });
        } catch {
            return [];
        }
    }

    evaluate({ symbol = null, strategyId = null, strategyVersion = null, paperOnly = false, policy = {}, since = null, limbicPolicy = null } = {}) {
        const activePolicy = { ...this.policy, ...policy };
        const requestedStrategy = normalizeStrategyId(strategyId);
        const normalizedSymbol = String(symbol || '').toUpperCase();

        // A repaired paper experiment collects its own evidence. Real-money
        // checks continue to include all historical strategy/symbol losses.
        const trades = this._closedTrades({ since }).filter(trade =>
            !paperOnly || !strategyVersion || trade.strategy_version === strategyVersion
        );

        const pairTrades = trades.filter(trade =>
            String(trade.symbol || '').toUpperCase() === normalizedSymbol
            && normalizeStrategyId(trade.strategy) === requestedStrategy
        );
        const strategyTrades = trades.filter(trade => normalizeStrategyId(trade.strategy) === requestedStrategy);
        const symbolTrades = trades.filter(trade => String(trade.symbol || '').toUpperCase() === normalizedSymbol);

        const pair = summarizeTrades(pairTrades);
        const strategy = summarizeTrades(strategyTrades);
        const symbolStats = summarizeTrades(symbolTrades);
        const reasons = [];
        const provisionalReasons = [];

        // Blacklist check: automatically quarantine toxic strategies
        if (TOXIC_STRATEGIES.has(requestedStrategy) || requestedStrategy.startsWith('paper_canary_full_aggression')) {
            reasons.push(`Strategy '${requestedStrategy}' is blacklisted due to catastrophic drawdown history.`);
        }

        // Hard drawdown circuit breaker: immediately quarantine any strategy losing > hardMaxStrategyLossUsd
        const hardLimit = activePolicy.hardMaxStrategyLossUsd ?? -5.0;
        if (strategy.trades >= 3 && strategy.totalPnl <= hardLimit) {
            reasons.push(`strategy cumulative PnL ${strategy.totalPnl} exceeds hard loss threshold ${hardLimit} USD`);
        }

        let limbicRisk = null;
        const activeLimbic = limbicPolicy || this.limbicPolicy;
        if (activeLimbic && typeof activeLimbic.getRiskAdjustmentFactor === 'function') {
            limbicRisk = activeLimbic.getRiskAdjustmentFactor();
            if (limbicRisk.riskFactor < 0.4) {
                provisionalReasons.push(`limbic risk factor ${limbicRisk.riskFactor} < 0.40 (alarm: ${limbicRisk.alarm}, cortisol: ${limbicRisk.cortisol})`);
            }
        }

        const assess = (label, stats, thresholds) => {
            const failures = [];
            if (stats.totalPnl <= thresholds.maxLossUsd) failures.push(`${label} PnL ${stats.totalPnl} <= ${thresholds.maxLossUsd}`);
            if (stats.winRate < thresholds.minWinRate) failures.push(`${label} win rate ${stats.winRate}% < ${thresholds.minWinRate}%`);
            if (stats.profitFactor < thresholds.minProfitFactor) failures.push(`${label} profit factor ${stats.profitFactor} < ${thresholds.minProfitFactor}`);
            return failures;
        };

        if (pair.trades >= activePolicy.pairMinTrades) {
            reasons.push(...assess('strategy-symbol', pair, {
                maxLossUsd: activePolicy.maxPairLossUsd,
                minWinRate: activePolicy.minPairWinRate,
                minProfitFactor: activePolicy.minPairProfitFactor
            }));
        } else if (pair.trades >= activePolicy.provisionalPairMinTrades) {
            const failures = assess('provisional strategy-symbol', pair, {
                maxLossUsd: activePolicy.maxPairLossUsd,
                minWinRate: activePolicy.minPairWinRate,
                minProfitFactor: activePolicy.minPairProfitFactor
            });
            // One noisy metric is not enough at small N; two independent failures are.
            if (failures.length >= 2) provisionalReasons.push(...failures);
        }

        if (strategy.trades >= activePolicy.strategyMinTrades) {
            reasons.push(...assess('strategy', strategy, {
                maxLossUsd: activePolicy.maxStrategyLossUsd,
                minWinRate: activePolicy.minStrategyWinRate,
                minProfitFactor: activePolicy.minStrategyProfitFactor
            }));
        } else if (strategy.trades >= activePolicy.provisionalStrategyMinTrades) {
            const failures = assess('provisional strategy', strategy, {
                maxLossUsd: activePolicy.maxStrategyLossUsd,
                minWinRate: activePolicy.minStrategyWinRate,
                minProfitFactor: activePolicy.minStrategyProfitFactor
            });
            if (failures.length >= 2) provisionalReasons.push(...failures);
        }

        const matureFailure = reasons.length > 0;
        const provisionalFailure = !matureFailure && provisionalReasons.length > 0;
        const allowed = !matureFailure && !provisionalFailure;
        const action = matureFailure ? 'quarantine' : provisionalFailure ? 'restrict_paper' : 'allow';
        return {
            allowed,
            action,
            evidenceState: matureFailure ? 'mature_failure' : provisionalFailure ? 'provisional_failure' : 'clear',
            symbol: normalizedSymbol || null,
            strategyId: requestedStrategy,
            reasons: matureFailure ? reasons : provisionalReasons,
            stats: { pair, strategy, symbol: symbolStats },
            policy: activePolicy,
            limbic: limbicRisk,
            evidenceWindow: { since, source: 'sqlite_closed_trades' },
            evaluatedAt: new Date().toISOString()
        };
    }

    report({ limit = 20, since = null } = {}) {
        const trades = this._closedTrades({ since });
        const byStrategy = new Map();
        const byPair = new Map();
        const bySymbol = new Map();

        for (const trade of trades) {
            const strategyId = normalizeStrategyId(trade.strategy);
            const symbol = String(trade.symbol || '').toUpperCase();
            const pairKey = `${strategyId}:${symbol}`;
            if (!byStrategy.has(strategyId)) byStrategy.set(strategyId, []);
            if (!byPair.has(pairKey)) byPair.set(pairKey, []);
            if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
            byStrategy.get(strategyId).push(trade);
            byPair.get(pairKey).push(trade);
            bySymbol.get(symbol).push(trade);
        }

        const strategyRows = Array.from(byStrategy.entries())
            .map(([strategyId, rows]) => ({ strategyId, ...summarizeTrades(rows) }))
            .sort((a, b) => a.totalPnl - b.totalPnl)
            .slice(0, limit);
        const pairRows = Array.from(byPair.entries())
            .map(([key, rows]) => {
                const [strategyId, symbol] = key.split(':');
                return { strategyId, symbol, ...summarizeTrades(rows) };
            })
            .sort((a, b) => a.totalPnl - b.totalPnl)
            .slice(0, limit);
        const symbolRows = Array.from(bySymbol.entries())
            .map(([symbol, rows]) => ({ symbol, ...summarizeTrades(rows) }))
            .sort((a, b) => a.totalPnl - b.totalPnl)
            .slice(0, limit);

        const restrictions = [
            ...strategyRows.map(row => this.evaluate({ strategyId: row.strategyId, since })),
            ...pairRows.map(row => this.evaluate({ symbol: row.symbol, strategyId: row.strategyId, since }))
        ].filter(result => !result.allowed);
        const seen = new Set();
        const quarantined = restrictions.filter(result => {
            const key = `${result.strategyId}:${result.symbol || '*'}:${result.action}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        this._lastReport = {
            success: true,
            policy: this.policy,
            generatedAt: new Date().toISOString(),
            evidenceWindow: { since, source: 'sqlite_closed_trades' },
            summary: summarizeTrades(trades),
            worstStrategies: strategyRows,
            worstPairs: pairRows,
            worstSymbols: symbolRows,
            quarantined
        };
        return this._lastReport;
    }

    evaluateTradeRisk({ symbol, strategyId, entryPrice, stopLoss, takeProfit, side = 'long', regime = null }) {
        const requestedStrategy = normalizeStrategyId(strategyId);
        if (TOXIC_STRATEGIES.has(requestedStrategy) || requestedStrategy.startsWith('paper_canary_full_aggression')) {
            return { allowed: false, action: 'quarantine', reason: `Strategy '${requestedStrategy}' is blacklisted.` };
        }

        const entry = Number(entryPrice);
        const stop = Number(stopLoss);
        const target = Number(takeProfit);

        if (!entry || !stop || !target || entry <= 0) {
            return { allowed: false, action: 'block', reason: 'Invalid or missing price levels (entry, stopLoss, takeProfit).' };
        }

        const isLong = side.toLowerCase() === 'long';
        const risk = isLong ? (entry - stop) : (stop - entry);
        const reward = isLong ? (target - entry) : (entry - target);

        if (risk <= 0) {
            return { allowed: false, action: 'block', reason: `Stop loss ${stop} is invalid for ${side} at entry ${entry}.` };
        }
        if (reward <= 0) {
            return { allowed: false, action: 'block', reason: `Take profit ${target} is invalid for ${side} at entry ${entry}.` };
        }

        const riskPct = (risk / entry) * 100;
        if (riskPct > 2.0) {
            return { allowed: false, action: 'block', reason: `Risk per trade ${riskPct.toFixed(2)}% exceeds max allowable 2.0%.` };
        }

        const riskRewardRatio = reward / risk;
        if (riskRewardRatio < 2.0) {
            return { allowed: false, action: 'block', reason: `Risk:Reward ratio ${riskRewardRatio.toFixed(2)} is below minimum required 2.0R.` };
        }

        if (regime) {
            const regimeType = regime.regime || regime;
            const adx = regime.adxProxy != null ? regime.adxProxy : 0;
            if (['RANGING', 'VOLATILE', 'CRASH'].includes(regimeType) || adx < 0.25) {
                return { allowed: false, action: 'block', reason: `Regime gate blocked: market is ${regimeType} (ADX: ${adx.toFixed(2)} < 0.25). Trend entry forbidden.` };
            }
        }

        return { allowed: true, riskPct: Number(riskPct.toFixed(2)), riskRewardRatio: Number(riskRewardRatio.toFixed(2)) };
    }

    getStatus() {
        return this._lastReport || this.report({ limit: 12 });
    }
}

const tradingPerformanceGuard = new TradingPerformanceGuard();

export { DEFAULT_POLICY, TradingPerformanceGuard, normalizeStrategyId };
export default tradingPerformanceGuard;
