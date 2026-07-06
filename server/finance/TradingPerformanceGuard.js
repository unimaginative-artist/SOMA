import tradeLogger from './TradeLogger.js';

const DEFAULT_POLICY = Object.freeze({
    pairMinTrades: 30,
    strategyMinTrades: 100,
    minPairWinRate: 35,
    minStrategyWinRate: 38,
    minPairProfitFactor: 0.75,
    minStrategyProfitFactor: 0.8,
    maxPairLossUsd: -25,
    maxStrategyLossUsd: -100
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
    constructor() {
        this.policy = { ...DEFAULT_POLICY };
        this._lastReport = null;
    }

    configure(policy = {}) {
        this.policy = { ...this.policy, ...policy };
        return this.policy;
    }

    _ensureDb() {
        if (!tradeLogger.db) tradeLogger.initialize();
        return tradeLogger.db;
    }

    _closedTrades() {
        try {
            this._ensureDb();
            return tradeLogger.getClosedTrades();
        } catch {
            return [];
        }
    }

    evaluate({ symbol = null, strategyId = null, policy = {} } = {}) {
        const activePolicy = { ...this.policy, ...policy };
        const requestedStrategy = normalizeStrategyId(strategyId);
        const normalizedSymbol = String(symbol || '').toUpperCase();
        const trades = this._closedTrades();

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

        if (pair.trades >= activePolicy.pairMinTrades) {
            if (pair.totalPnl <= activePolicy.maxPairLossUsd) {
                reasons.push(`strategy-symbol PnL ${pair.totalPnl} <= ${activePolicy.maxPairLossUsd}`);
            }
            if (pair.winRate < activePolicy.minPairWinRate) {
                reasons.push(`strategy-symbol win rate ${pair.winRate}% < ${activePolicy.minPairWinRate}%`);
            }
            if (pair.profitFactor < activePolicy.minPairProfitFactor) {
                reasons.push(`strategy-symbol profit factor ${pair.profitFactor} < ${activePolicy.minPairProfitFactor}`);
            }
        }

        if (strategy.trades >= activePolicy.strategyMinTrades) {
            if (strategy.totalPnl <= activePolicy.maxStrategyLossUsd) {
                reasons.push(`strategy PnL ${strategy.totalPnl} <= ${activePolicy.maxStrategyLossUsd}`);
            }
            if (strategy.winRate < activePolicy.minStrategyWinRate) {
                reasons.push(`strategy win rate ${strategy.winRate}% < ${activePolicy.minStrategyWinRate}%`);
            }
            if (strategy.profitFactor < activePolicy.minStrategyProfitFactor) {
                reasons.push(`strategy profit factor ${strategy.profitFactor} < ${activePolicy.minStrategyProfitFactor}`);
            }
        }

        const allowed = reasons.length === 0;
        return {
            allowed,
            action: allowed ? 'allow' : 'quarantine',
            symbol: normalizedSymbol || null,
            strategyId: requestedStrategy,
            reasons,
            stats: { pair, strategy, symbol: symbolStats },
            policy: activePolicy,
            evaluatedAt: new Date().toISOString()
        };
    }

    report({ limit = 20 } = {}) {
        const trades = this._closedTrades();
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

        const quarantined = pairRows
            .map(row => this.evaluate({ symbol: row.symbol, strategyId: row.strategyId }))
            .filter(result => !result.allowed);

        this._lastReport = {
            success: true,
            policy: this.policy,
            generatedAt: new Date().toISOString(),
            summary: summarizeTrades(trades),
            worstStrategies: strategyRows,
            worstPairs: pairRows,
            worstSymbols: symbolRows,
            quarantined
        };
        return this._lastReport;
    }

    getStatus() {
        return this._lastReport || this.report({ limit: 12 });
    }
}

const tradingPerformanceGuard = new TradingPerformanceGuard();

export { DEFAULT_POLICY, TradingPerformanceGuard, normalizeStrategyId };
export default tradingPerformanceGuard;
