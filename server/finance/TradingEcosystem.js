import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import tradeLogger from './TradeLogger.js';
import marketData from './marketDataService.js';
import marketEvidenceStore from './MarketEvidenceStore.js';
import { backtestBars } from './CompiledStrategyBacktester.js';
import { HighFrequencyGridEngine } from './HighFrequencyGridEngine.js';
import { completedDecisionBars } from './TradingDataFreshness.js';
import { ECOSYSTEM_VERSION, ECOSYSTEM_LANES, ECOSYSTEM_SYMBOLS, ecosystemCandidate, ecosystemLane, ecosystemSymbol, ecosystemPaperConfig } from './TradingEcosystemCatalog.js';

export function summarizeEcosystemTrades(rows = []) {
    const pnl = rows.map(row => Number(row.pnl) || 0);
    const wins = pnl.filter(value => value > 0);
    const losses = pnl.filter(value => value < 0);
    const grossWins = wins.reduce((a, b) => a + b, 0);
    const grossLosses = -losses.reduce((a, b) => a + b, 0);
    return { trades: rows.length, wins: wins.length, netPnl: pnl.reduce((a, b) => a + b, 0),
        winRatePct: rows.length ? wins.length / rows.length * 100 : null,
        profitFactor: grossLosses ? grossWins / grossLosses : null,
        recordedFees: rows.reduce((sum, row) => sum + Number(row.entry_fee || row.entryFee || 0) + Number(row.exit_fee || row.exitFee || 0), 0) };
}

export class TradingEcosystem {
    constructor({ statePath = path.join(process.cwd(), 'data/trading/ecosystem-research.json'), ledger = tradeLogger,
        data = marketData, evidence = marketEvidenceStore } = {}) {
        this.statePath = statePath;
        this.ledger = ledger;
        this.data = data;
        this.evidence = evidence;
        this.execution = null;
        this.startLocks = new Set();
        this.researchJob = null;
        try { this.reports = JSON.parse(fs.readFileSync(statePath, 'utf8')).reports || []; }
        catch { this.reports = []; }
    }

    bindExecution(execution) { this.execution = execution; }
    // Legacy learning/A-B configs were trained under different execution
    // semantics. Record their feedback, but never silently import those knobs
    // into a catalog baseline. A revised recipe is an explicit new experiment.
    candidate(lane, symbol) { return ecosystemCandidate(lane, symbol); }
    sessions() { return (this.execution?.sessions?.() || []).map(session => ({
        symbol: session.symbol, preset: session.preset, paperMode: session.paperMode, isRunning: session.isRunning,
        config: { ecosystemLane: session.config?.ecosystemLane, entriesPaused: session.config?.entriesPaused,
            missionRunId: session.config?.missionRunId,
            strategyVersion: session.config?.strategyVersion, maxPaperTradeValue: session.config?.maxPaperTradeValue,
            maxPositionAgeMs: session.config?.maxPositionAgeMs },
        stats: session.stats, lastSignal: session.lastSignal, lastBlockReason: session.lastBlockReason,
        openPositions: session.openPositions || []
    })); }

    closedRows() {
        return this.ledger.db?.prepare("SELECT id,symbol,strategy,strategy_version,pnl,entry_fee,exit_fee,entry_time,exit_time FROM trades WHERE status='closed' ORDER BY exit_time,id").all() || [];
    }

    status() {
        const rows = this.closedRows();
        const sessions = this.sessions().map(session => ({ ...session,
            forward: summarizeEcosystemTrades(rows.filter(row => row.symbol === session.symbol
                && row.strategy_version === session.config?.strategyVersion)) }));
        return { version: ECOSYSTEM_VERSION, paperOnly: true, liveEnabled: false,
            mission: this.execution?.missionStatus?.() || null,
            evidencePolicy: 'Historical simulations are not forward paper trades or live qualification.',
            symbols: ECOSYSTEM_SYMBOLS, executionReady: Boolean(this.execution),
            researchJob: this.researchJob, reports: this.reports.slice(0, 12),
            lanes: ECOSYSTEM_LANES.map(lane => {
                const experiments = ECOSYSTEM_SYMBOLS.map(symbol => {
                    const candidate = this.candidate(lane.id, symbol);
                    return { symbol, version: candidate.id, candidateKey: candidate.key,
                        forward: summarizeEcosystemTrades(rows.filter(row => row.symbol === symbol && row.strategy_version === candidate.id)),
                        research: this.reports.find(report => report.candidateKey === candidate.key) || null };
                });
                return { ...lane, experiments, sessions: sessions.filter(session =>
                    (session.config?.ecosystemLane || (session.preset === 'scalping_confluence' ? 'fast' : 'holding')) === lane.id),
                    historical: summarizeEcosystemTrades(rows.filter(row => row.strategy === lane.strategyId)) };
            }) };
    }

    async startPaper(laneId, symbolInput) {
        const symbol = ecosystemSymbol(symbolInput);
        const candidate = this.candidate(laneId, symbol);
        const config = ecosystemPaperConfig(candidate); // Rejects grid before touching execution.
        if (!this.execution) throw new Error('Shared paper executor is not ready');
        if (this.startLocks.has(symbol)) throw new Error(`${symbol} is already starting`);
        const occupied = this.sessions().find(session => session.symbol === symbol && (session.isRunning || session.openPositions?.length));
        if (occupied) throw new Error(`${symbol} is already owned by ${occupied.config?.ecosystemLane || 'holding'}; pause it and let positions close first`);
        this.startLocks.add(symbol);
        try { return await this.execution.start({ symbol, preset: candidate.strategyId, config }); }
        finally { this.startLocks.delete(symbol); }
    }

    async pausePaper(symbolInput) {
        if (!this.execution) throw new Error('Shared paper executor is not ready');
        const symbol = ecosystemSymbol(symbolInput);
        if (this.startLocks.has(symbol)) throw new Error(`${symbol} is still starting; retry pause shortly`);
        return this.execution.pause(symbol);
    }

    async research(laneId, symbolInput) {
        const symbol = ecosystemSymbol(symbolInput);
        const lane = ecosystemLane(laneId);
        if (this.researchJob?.running) throw new Error('A catalog research comparison is already running');
        const candidate = this.candidate(laneId, symbol); // Frozen for this entire run.
        const id = crypto.randomUUID();
        this.researchJob = { id, running: true, lane: laneId, symbol, startedAt: new Date().toISOString() };
        try {
            // Read-only native venue request; never manufacture synthetic fallback history.
            const raw = await this.data.getAlpacaCryptoBars(symbol, lane.timeframe, 1000);
            const bars = completedDecisionBars(raw, { timeframe: lane.timeframe });
            if (bars.length < 200 || bars.some(bar => bar.isMock || bar.source !== 'alpaca_crypto_us')) throw new Error('Need at least 200 real, completed Alpaca candles');
            const split = Math.floor(bars.length * 0.7);
            const summarizeRun = result => {
                const { tradeLedger = [], ...metrics } = result;
                return { ...metrics, observedCloses: tradeLedger.filter(trade => trade.exitReason !== 'end_of_data').length,
                    boundaryLiquidations: tradeLedger.filter(trade => trade.exitReason === 'end_of_data').length };
            };
            let development, evaluation;
            if (lane.researchOnly) {
                const replay = window => {
                    const grid = new HighFrequencyGridEngine({ symbol, ...candidate.compiledStrategy.dsl.grid });
                    for (const bar of window) grid.processTick(bar.close);
                    return grid.getMetrics();
                };
                development = replay(bars.slice(0, split));
                evaluation = replay(bars.slice(split));
            } else {
                development = summarizeRun(backtestBars({ bars: bars.slice(0, split), candidate, includeTrades: true }));
                evaluation = summarizeRun(backtestBars({ bars, candidate, tradeStartIndex: split, includeTrades: true }));
            }
            const report = { id, lane: laneId, symbol, candidateKey: candidate.key, strategyVersion: candidate.id,
                candidate, createdAt: new Date().toISOString(), source: 'alpaca_crypto_us', timeframe: lane.timeframe,
                bars: bars.length, firstBar: bars[0].timestamp, splitBar: bars[split].timestamp, lastBar: bars.at(-1).timestamp,
                evaluationKind: 'historical_70_30_split_not_prospective', paperOnly: true, liveEligible: false,
                researchOnly: lane.researchOnly, development, evaluation,
                baselines: { noTradePnl: 0, evaluationBuyAndHoldReturnPct: (bars.at(-1).close / bars[split].open - 1) * 100,
                    passiveBaselineNote: 'Price-only return; excludes fees. Not position-size matched.' },
                limitations: lane.researchOnly
                    ? ['Idealized price-touch fills; not a qualified execution model', 'Includes open inventory in equity', 'No execution or promotion allowed']
                    : ['Historical slice may have been inspected before; not an untouched forward test', 'End-of-data liquidations are labelled, not counted as forward closes', 'Uses shared signal logic and cost model; live quote timing remains different'],
                graduation: { canPromoteToLive: false, qualified: false, reason: 'Prospective paper evidence and existing promotion gates still required' } };
            const reports = [report, ...this.reports].slice(0, 40);
            fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
            const temporary = `${this.statePath}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify({ version: ECOSYSTEM_VERSION, reports }, null, 2));
            fs.renameSync(temporary, this.statePath);
            this.reports = reports;
            try { this.evidence.append('simulation', report, { source: 'TradingEcosystem', symbol, strategyId: candidate.strategyId }); }
            catch { /* Report on disk remains authoritative; never promote on evidence-write failure. */ }
            this.researchJob = { ...this.researchJob, running: false, reportId: id, completedAt: new Date().toISOString() };
            return report;
        } catch (error) {
            this.researchJob = { ...this.researchJob, running: false, error: error.message };
            throw error;
        }
    }
}

export default new TradingEcosystem();
