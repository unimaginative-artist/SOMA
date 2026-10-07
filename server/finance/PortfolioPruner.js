/**
 * PortfolioPruner.js — "do what works, cut what doesn't", automatically.
 *
 * We proved these strategies can't be backtest-optimized (their edge lives in an
 * un-replayable LLM layer), so REAL PAPER RESULTS are the only trustworthy signal.
 * This operationalizes that: on a timer it reads each active paper engine's real
 * closed-trade record (since the 2026-07-03 era cutoff) and STOPS any engine that
 * is a well-sampled, clear loser — exactly the manual SOL cut, now automatic.
 *
 * Guardrails: paper only (never live), requires a real sample before acting,
 * never cuts the last remaining engine, and audits every decision. It only
 * SUBTRACTS losers — capital naturally concentrates on the survivors — it does
 * not resize positions (that changes risk).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { recordPrunerQuarantine } from './TradingPrunerState.js';
import { buildTradingStrategyIdentity, tradingEvidenceFingerprint } from './TradingStrategyIdentity.js';

const DB_PATH = path.join(process.cwd(), 'data', 'trading', 'trades.db');
const AUDIT_PATH = path.join(process.cwd(), 'data', 'trading', 'pruner-audit.jsonl');
const INTENT_PATH = path.join(process.cwd(), 'data', 'trading', 'trading-intent.json');

// A trade era cutoff — everything before was on poisoned regime data (the 1Day bug).
const ERA_CUTOFF = process.env.PRUNER_ERA_CUTOFF || '2026-07-03 14:00';

const DEFAULTS = {
    minSample: 20,        // need this many real closed trades before judging
    maxWinRatePct: 35,    // below this AND negative P&L = a clear loser
    intervalMs: 2 * 60 * 60 * 1000, // check every 2h
    initialDelayMs: 3 * 60 * 1000,  // wait for engines to resume after boot
};

class PortfolioPruner {
    constructor() {
        this.intervalId = null;
        this.cfg = { ...DEFAULTS };
        this.lastRun = null;
    }

    start(cfg = {}) {
        if (this.intervalId) return;
        this.cfg = { ...DEFAULTS, ...cfg };
        console.log(`[PortfolioPruner] Started — auto-cuts clear paper losers every ${Math.round(this.cfg.intervalMs / 60000)}min`);
        this.intervalId = setInterval(() => this.prune().catch(e => console.warn('[PortfolioPruner]', e.message)), this.cfg.intervalMs);
        setTimeout(() => this.prune().catch(() => {}), this.cfg.initialDelayMs);
    }

    stop() { if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; } }

    _engagedStrategies() {
        try {
            const intent = JSON.parse(fs.readFileSync(INTENT_PATH, 'utf8'));
            return Object.entries(intent.engaged || {})
                .filter(([, v]) => v?.config?.paperMode !== false && v?.config?.forcePaper !== false) // paper only
                .map(([symbol, engaged]) => ({
                    ...buildTradingStrategyIdentity({
                        symbol,
                        strategyId: engaged?.config?.selectedStrategyId || engaged?.preset,
                        preset: engaged?.preset,
                        config: engaged?.config || {},
                        candidateKey: engaged?.config?.selectedCandidateKey,
                        compiledStrategyId: engaged?.config?.compiledStrategyId
                    }),
                    preset: engaged?.preset || null,
                    config: engaged?.config || {}
                }));
        } catch { return []; }
    }

    _statsFor(db, identity) {
        const rows = db.prepare(
            `SELECT id, pnl, exit_time FROM trades
             WHERE status='closed' AND symbol=? AND strategy=? AND strategy_version=? AND exit_time>=?
             ORDER BY id ASC`
        ).all(identity.symbol, identity.strategyId, identity.strategyVersion, ERA_CUTOFF);
        if (!rows.length) return { trades: 0 };
        const wins = rows.filter(r => Number(r.pnl) > 0).length;
        const pnl = rows.reduce((a, r) => a + Number(r.pnl || 0), 0);
        const stats = {
            trades: rows.length,
            wins,
            winRate: Number((wins / rows.length * 100).toFixed(1)),
            pnl: Number(pnl.toFixed(2)),
            firstTradeId: rows[0].id,
            lastTradeId: rows.at(-1).id,
            lastExitTime: rows.at(-1).exit_time
        };
        return { ...stats, evidenceFingerprint: tradingEvidenceFingerprint(stats) };
    }

    _audit(entry) {
        try { fs.appendFileSync(AUDIT_PATH, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch {}
    }

    async _stopEngine(symbol, reason) {
        const port = process.env.PORT || 3001;
        const res = await fetch(`http://127.0.0.1:${port}/api/autonomous/stop`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, reason: `portfolio_pruner: ${reason}` }), signal: AbortSignal.timeout(10000)
        });
        return res.ok;
    }

    async prune() {
        this.lastRun = new Date().toISOString();
        const strategies = this._engagedStrategies();
        if (strategies.length <= 1) return; // never cut the last engine

        let db;
        try { db = new Database(DB_PATH, { readonly: true }); } catch { return; }
        const evals = [];
        try {
            for (const identity of strategies) evals.push({ ...identity, ...this._statsFor(db, identity) });
        } finally { db.close(); }

        const losers = evals.filter(e =>
            e.trades >= this.cfg.minSample && e.winRate < this.cfg.maxWinRatePct && e.pnl < 0
        );
        // Never cut so many that fewer than one engine remains.
        const keepCount = evals.length - losers.length;
        const toCut = keepCount >= 1 ? losers : losers.slice(0, evals.length - 1);

        for (const l of toCut) {
            const reason = `auto-cut: ${l.trades} trades, ${l.winRate}% win rate, $${l.pnl} (below ${this.cfg.maxWinRatePct}% + negative)`;
            let stopped = false;
            try { stopped = await this._stopEngine(l.symbol, reason); } catch (e) { this._audit({ action: 'cut_failed', symbol: l.symbol, error: e.message, stats: l }); continue; }
            if (stopped) {
                try { recordPrunerQuarantine({ identity: l, reason, stats: l, evidenceFingerprint: l.evidenceFingerprint }); }
                catch (e) { this._audit({ action: 'quarantine_failed', symbol: l.symbol, error: e.message, stats: l }); }
            }
            this._audit({ action: stopped ? 'cut' : 'cut_no_ack', symbol: l.symbol, reason, stats: l });
            if (stopped) console.log(`[PortfolioPruner] ✂️ Cut ${l.symbol} — ${reason}`);
        }
        if (!toCut.length) this._audit({ action: 'no_cuts', evaluated: evals });
        return { evaluated: evals, cut: toCut.map(l => l.symbol) };
    }
}

const portfolioPruner = new PortfolioPruner();
export { PortfolioPruner };
export default portfolioPruner;
