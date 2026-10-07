import { EventEmitter } from 'node:events';
import ecosystem, { summarizeEcosystemTrades } from './TradingEcosystem.js';

// Compatibility facade: the shared executor owns all orders and positions.
// No tick listener, broker API, or independent paper accounting lives here.
export class ScalpingEngine extends EventEmitter {
    constructor(runtime = ecosystem) {
        super();
        this.runtime = runtime;
        this.config = { minProfitTarget: 0.15, maxProfitTarget: 0.50, stopLossATRMultiplier: 1.2,
            positionSize: 100, maxPositions: 1, maxDailyTrades: 50, maxDailyLoss: 500,
            cooldownMs: 60000, minTickHistory: 36, rsiOversold: 35, rsiBuyZone: 45, requiredSignals: 2 };
    }

    get isActive() { return this.sessions().some(session => session.isRunning && !session.config?.entriesPaused); }
    sessions() { return this.runtime.sessions().filter(session => session.config?.ecosystemLane === 'fast'); }
    async start(symbols = ['ETH-USD']) {
        if (!Array.isArray(symbols) || !symbols.length || symbols.length > 3) throw new Error('Select one to three supported paper symbols');
        const results = [];
        for (const symbol of [...new Set(symbols)]) results.push(await this.runtime.startPaper('fast', symbol));
        return results;
    }
    async stop() {
        const results = [];
        for (const session of this.sessions()) results.push(await this.runtime.pausePaper(session.symbol));
        return results;
    }
    getStats() {
        const totals = summarizeEcosystemTrades(this.runtime.closedRows().filter(row => row.strategy === 'scalping_confluence'));
        const sessions = this.sessions();
        return { isActive: this.isActive, paperOnly: true, executionEngine: 'AutonomousTrader',
            totalTrades: totals.trades, winningTrades: totals.wins, losingTrades: totals.trades - totals.wins,
            netProfit: totals.netPnl, dailyPnL: null, winRate: totals.winRatePct == null ? null : `${totals.winRatePct.toFixed(1)}%`,
            profitFactor: totals.profitFactor, recordedFees: totals.recordedFees,
            signalsChecked: sessions.reduce((sum, session) => sum + (session.stats?.totalDecisions || 0), 0),
            openPositions: sessions.reduce((sum, session) => sum + (session.openPositions?.length || 0), 0),
            sessions: sessions.map(session => ({ symbol: session.symbol, running: session.isRunning, entriesPaused: Boolean(session.config?.entriesPaused) })),
            learningScope: 'Closed outcomes feed the shared learning records. Catalog recipes are frozen; legacy parameter tuners cannot alter them.' };
    }
}

export default new ScalpingEngine();
