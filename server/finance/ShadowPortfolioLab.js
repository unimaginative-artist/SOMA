import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { conservativeReturnInterval } from './TradingResearchValidator.js';
import { backtestBars } from './CompiledStrategyBacktester.js';
import { barTimestampMs } from './TradingDataFreshness.js';

function candidateFingerprint(candidate) {
    return crypto.createHash('sha256').update(JSON.stringify({
        symbol: candidate.symbol, strategyId: candidate.strategyId,
        economicsVersion: candidate.economicsVersion,
        compiledEconomicsVersion: candidate.compiledStrategy?.economicsVersion,
        dsl: candidate.compiledStrategy?.dsl
    })).digest('hex');
}

export class ShadowPortfolioLab {
    constructor({ statePath = path.join(process.cwd(), 'data', 'trading', 'shadow-portfolios.json'), now = Date.now } = {}) {
        this.statePath = statePath;
        this.now = now;
        this.state = { schemaVersion: 1, candidates: {} };
        try { this.state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
    }

    register(candidate = {}, { initialBarTimestamp = null, historyStartTimestamp = null } = {}) {
        const id = String(candidate.id || candidate.strategyId || '');
        if (!id) throw new Error('Shadow candidate id is required');
        if (!this.state.candidates[id]) {
            const enrolledAtMs = this.now();
            this.state.candidates[id] = {
                id, strategyId: candidate.strategyId, symbol: candidate.symbol,
                candidate: structuredClone(candidate),
                candidateFingerprint: candidateFingerprint(candidate),
                replayVersion: 3,
                enrolledAtMs,
                prospectiveStartTimestamp: Math.max(enrolledAtMs, barTimestampMs({ timestamp: initialBarTimestamp }) || 0),
                historyStartTimestamp: Number(historyStartTimestamp) || null,
                paperOnly: true, createdAt: new Date().toISOString(), closedTrades: [],
                lastEvaluatedBar: Number(initialBarTimestamp) || null,
                recordedTradeKeys: []
            };
            this._save();
        }
        return this.status(id);
    }

    /**
     * Replay only candles that arrived after a candidate was registered. This
     * is prospective shadow evidence, not a relabelled historical backtest.
     */
    replayCandidate(candidate = {}, bars = []) {
        const id = String(candidate.id || candidate.strategyId || '');
        const ordered = [...bars].sort((a, b) => barTimestampMs(a) - barTimestampMs(b));
        const latestTimestamp = barTimestampMs(ordered.at(-1));
        const portfolio = this.state.candidates[id];
        if (!portfolio) return this.register(candidate, { initialBarTimestamp: latestTimestamp, historyStartTimestamp: barTimestampMs(ordered[0]) });
        if (portfolio.replayVersion !== 3) {
            // Old replay liquidated every batch and used $1 as the notional.
            // Version 2 also admitted backfilled, already-completed candles.
            // Preserve observations for audit, exclude them from readiness.
            portfolio.legacyClosedTrades = [
                ...(portfolio.legacyClosedTrades || []), ...(portfolio.closedTrades || [])
            ].slice(-2000);
            portfolio.closedTrades = [];
            portfolio.recordedTradeKeys = [];
            portfolio.replayVersion = 3;
            portfolio.enrolledAtMs = this.now();
            portfolio.candidate = structuredClone(candidate);
            portfolio.candidateFingerprint = candidateFingerprint(candidate);
            portfolio.prospectiveStartTimestamp = Math.max(portfolio.enrolledAtMs, latestTimestamp || 0);
            portfolio.historyStartTimestamp = barTimestampMs(ordered[0]) || null;
            portfolio.lastEvaluatedBar = latestTimestamp || null;
            portfolio.migratedAt = new Date().toISOString();
            this._save();
            return this.status(id);
        }
        if (portfolio.candidateFingerprint !== candidateFingerprint(candidate)) {
            portfolio.replayBlockedReason = 'candidate_definition_changed';
            this._save();
            return this.status(id);
        }
        if (!portfolio.lastEvaluatedBar) {
            portfolio.lastEvaluatedBar = latestTimestamp || null;
            portfolio.prospectiveStartTimestamp = Math.max(Number(portfolio.enrolledAtMs) || this.now(), latestTimestamp || 0);
            portfolio.historyStartTimestamp = barTimestampMs(ordered[0]) || null;
            this._save();
            return this.status(id);
        }
        if (!latestTimestamp || latestTimestamp <= Number(portfolio.lastEvaluatedBar)) return this.status(id);

        // Replay the frozen prospective interval, not a fresh flat portfolio
        // every polling batch. This reconstructs positions across batch bounds.
        if (!portfolio.historyStartTimestamp) portfolio.historyStartTimestamp = barTimestampMs(ordered[0]);
        const replayBars = ordered.filter(bar => barTimestampMs(bar) >= portfolio.historyStartTimestamp);
        if (barTimestampMs(replayBars[0]) !== portfolio.historyStartTimestamp) {
            portfolio.replayBlockedReason = 'prospective_history_missing';
            this._save();
            return this.status(id);
        }
        const firstNewIndex = replayBars.findIndex(bar => barTimestampMs(bar) > Number(portfolio.prospectiveStartTimestamp));
        if (firstNewIndex < 0) return this.status(id);
        const result = backtestBars({
            bars: replayBars, candidate: portfolio.candidate, includeTrades: true,
            tradeStartIndex: firstNewIndex
        });
        const known = new Set(portfolio.recordedTradeKeys || []);
        for (const trade of result.tradeLedger || []) {
            // Mark-to-market at a dataset boundary is not an executed exit.
            if (trade.exitReason === 'end_of_data') continue;
            const key = `${trade.entryTime || trade.entryTimestamp || ''}:${trade.exitTime || trade.exitTimestamp || ''}:${trade.side}:${trade.entryPrice}:${trade.exitPrice}`;
            if (known.has(key)) continue;
            known.add(key);
            const notional = Number(trade.entryNotional || (trade.entryPrice * trade.qty));
            if (!(notional > 0) || !Number.isFinite(notional) || !Number.isFinite(trade.netReturn)) continue;
            portfolio.closedTrades.push({
                timestamp: trade.exitTime || trade.exitTimestamp || new Date().toISOString(),
                pnl: Number(trade.pnl), notional, return: trade.netReturn,
                source: 'prospective_shadow_replay', key
            });
        }
        portfolio.closedTrades = portfolio.closedTrades.filter(trade => Number.isFinite(Number(trade.pnl))).slice(-2000);
        portfolio.recordedTradeKeys = Array.from(known).slice(-4000);
        portfolio.lastEvaluatedBar = latestTimestamp;
        portfolio.lastReplayAt = new Date().toISOString();
        portfolio.replayBlockedReason = null;
        this._save();
        return this.status(id);
    }

    recordClosedTrade(id, trade = {}) {
        const portfolio = this.state.candidates[id];
        if (!portfolio) throw new Error(`Unknown shadow portfolio: ${id}`);
        const pnl = Number(trade.pnl);
        const notional = Math.max(1, Number(trade.notional || 1));
        if (!Number.isFinite(pnl)) throw new Error('Shadow trade pnl must be finite');
        portfolio.closedTrades.push({
            timestamp: trade.timestamp || new Date().toISOString(), pnl, notional,
            return: pnl / notional, source: trade.source || 'paper_shadow_fill'
        });
        portfolio.closedTrades = portfolio.closedTrades.slice(-2000);
        this._save();
        return this.status(id);
    }

    status(id) {
        const portfolio = this.state.candidates[id];
        if (!portfolio) return null;
        const trades = portfolio.replayVersion === 3 ? (portfolio.closedTrades || []) : [];
        const wins = trades.filter(trade => trade.pnl > 0);
        const losses = trades.filter(trade => trade.pnl <= 0);
        const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
        const recentReturns = trades.slice(-250).map(trade => Number(trade.return)).filter(Number.isFinite);
        const meanReturn = recentReturns.length ? recentReturns.reduce((sum, value) => sum + value, 0) / recentReturns.length : 0;
        const returnVolatility = recentReturns.length > 1
            ? Math.sqrt(recentReturns.reduce((sum, value) => sum + Math.pow(value - meanReturn, 2), 0) / (recentReturns.length - 1))
            : 0;
        return {
            id, strategyId: portfolio.strategyId, symbol: portfolio.symbol, paperOnly: true,
            closedTrades: trades.length, netPnl: trades.reduce((sum, trade) => sum + trade.pnl, 0),
            winRate: trades.length ? wins.length / trades.length : 0,
            profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
            returnInterval: conservativeReturnInterval(trades.map(trade => trade.return)),
            recentReturns,
            returnVolatility,
            prospectiveClosedTrades: trades.filter(trade => trade.source === 'prospective_shadow_replay' || trade.source === 'paper_shadow_fill').length,
            enrolledAtMs: portfolio.enrolledAtMs || null,
            prospectiveStartTimestamp: portfolio.prospectiveStartTimestamp || null,
            candidateFingerprint: portfolio.candidateFingerprint || null,
            lastEvaluatedBar: portfolio.lastEvaluatedBar || null,
            lastReplayAt: portfolio.lastReplayAt || null,
            replayVersion: portfolio.replayVersion || 1,
            replayBlockedReason: portfolio.replayBlockedReason || null,
            legacyExcludedTrades: portfolio.legacyClosedTrades?.length || (portfolio.replayVersion !== 3 ? portfolio.closedTrades?.length : 0) || 0
        };
    }

    listStatuses() {
        return Object.keys(this.state.candidates || {}).map(id => this.status(id)).filter(Boolean);
    }

    frozenCandidates() {
        return Object.values(this.state.candidates || {}).map(row => structuredClone(row.candidate)).filter(Boolean);
    }

    _save() {
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        const temporary = `${this.statePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2));
        fs.renameSync(temporary, this.statePath);
    }
}

const shadowPortfolioLab = new ShadowPortfolioLab();
export default shadowPortfolioLab;
