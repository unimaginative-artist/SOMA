/**
 * TradeLogger - SQLite-backed trade persistence
 *
 * Records every trade entry/exit with:
 * - Fill prices and slippage
 * - P&L (realized)
 * - Strategy that generated the trade
 * - Market regime at time of trade
 * - Daily equity snapshots for equity curve
 *
 * Uses better-sqlite3 for synchronous, high-performance writes.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import marketEvidenceStore from './MarketEvidenceStore.js';

class TradeLogger {
    constructor(dbPath = null, options = {}) {
        const dataDir = path.join(process.cwd(), 'data', 'trading');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.dbPath = dbPath || path.join(dataDir, 'trades.db');
        this.recordEvidence = options.recordEvidence !== false;
        this.db = null;
        this._stmts = {};
        this.telemetryRetention = {
            lifecycleRows: Math.max(1000, Number(options.lifecycleRetentionRows || process.env.SOMA_TRADING_LIFECYCLE_ROWS || 100000)),
            learningRows: Math.max(1000, Number(options.learningRetentionRows || process.env.SOMA_TRADING_LEARNING_ROWS || 50000))
        };
        this.telemetryDedupeWindowMs = Math.max(0, Number(options.telemetryDedupeWindowMs ?? 60000));
        this._telemetryFingerprints = new Map();
        this._telemetryWrites = 0;
    }

    /**
     * Initialize database and create tables
     */
    initialize() {
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL'); // Better concurrent read performance
        this.db.pragma('synchronous = NORMAL');

        // Create trades table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                qty REAL NOT NULL,
                entry_price REAL,
                exit_price REAL,
                filled_price REAL,
                expected_price REAL,
                slippage_pct REAL,
                pnl REAL,
                pnl_pct REAL,
                strategy TEXT DEFAULT 'manual',
                strategy_version TEXT,
                candidate_key TEXT,
                attribution_json TEXT,
                regime TEXT,
                status TEXT DEFAULT 'open',
                entry_time TEXT,
                exit_time TEXT,
                exit_reason TEXT,
                signal_scores_json TEXT,
                entry_fee REAL DEFAULT 0,
                exit_fee REAL DEFAULT 0,
                modeled_execution_cost REAL DEFAULT 0,
                modeled_funding_reserve REAL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);

        // Migration: add signal_scores_json to existing DBs
        try {
            this.db.exec(`ALTER TABLE trades ADD COLUMN signal_scores_json TEXT`);
        } catch { /* column already exists */ }
        try {
            this.db.exec(`ALTER TABLE trades ADD COLUMN entry_fee REAL DEFAULT 0`);
        } catch { /* column already exists */ }
        try {
            this.db.exec(`ALTER TABLE trades ADD COLUMN exit_fee REAL DEFAULT 0`);
        } catch { /* column already exists */ }
        for (const column of ['modeled_execution_cost', 'modeled_funding_reserve']) {
            try { this.db.exec(`ALTER TABLE trades ADD COLUMN ${column} REAL DEFAULT 0`); }
            catch { /* column already exists */ }
        }
        try { this.db.exec(`ALTER TABLE trades ADD COLUMN strategy_version TEXT`); } catch {}
        try { this.db.exec(`ALTER TABLE trades ADD COLUMN candidate_key TEXT`); } catch {}
        try { this.db.exec(`ALTER TABLE trades ADD COLUMN attribution_json TEXT`); } catch {}

        // Create daily snapshots table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS daily_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT UNIQUE NOT NULL,
                equity REAL NOT NULL,
                cash REAL,
                positions_count INTEGER,
                daily_pnl REAL,
                daily_trades INTEGER,
                cumulative_pnl REAL,
                max_drawdown_pct REAL,
                win_rate REAL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);

        // Create indexes
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
            CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
            CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
            CREATE INDEX IF NOT EXISTS idx_trades_entry_time ON trades(entry_time);
            CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(date);
        `);

        // Create learning events table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS learning_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                description TEXT,
                strategy TEXT,
                metric_name TEXT,
                old_value REAL,
                new_value REAL,
                trigger_reason TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_learning_events_type ON learning_events(event_type);
            CREATE INDEX IF NOT EXISTS idx_learning_events_created ON learning_events(created_at);
        `);

        // Create lifecycle journal table for replayable autonomous decisions
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS trade_lifecycle_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lifecycle_id TEXT,
                trade_id INTEGER,
                order_id TEXT,
                symbol TEXT,
                stage TEXT NOT NULL,
                actor TEXT DEFAULT 'SOMA',
                status TEXT DEFAULT 'info',
                payload TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_lifecycle_id ON trade_lifecycle_events(lifecycle_id);
            CREATE INDEX IF NOT EXISTS idx_lifecycle_symbol ON trade_lifecycle_events(symbol);
            CREATE INDEX IF NOT EXISTS idx_lifecycle_stage ON trade_lifecycle_events(stage);
            CREATE INDEX IF NOT EXISTS idx_lifecycle_created ON trade_lifecycle_events(created_at);
            CREATE INDEX IF NOT EXISTS idx_lifecycle_stage_created ON trade_lifecycle_events(stage, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_learning_type_created ON learning_events(event_type, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_trades_status_exit ON trades(status, exit_time DESC);
            CREATE INDEX IF NOT EXISTS idx_trades_strategy_symbol_status_exit ON trades(strategy, symbol, status, exit_time DESC);
            CREATE INDEX IF NOT EXISTS idx_trades_identity_status_exit ON trades(symbol, strategy, strategy_version, status, exit_time DESC);
        `);

        // Prepare statements for performance
        this._stmts.insertTrade = this.db.prepare(`
            INSERT INTO trades (order_id, symbol, side, qty, entry_price, filled_price, expected_price, slippage_pct, strategy, strategy_version, candidate_key, attribution_json, regime, status, entry_time, signal_scores_json, entry_fee)
            VALUES (@order_id, @symbol, @side, @qty, @entry_price, @filled_price, @expected_price, @slippage_pct, @strategy, @strategy_version, @candidate_key, @attribution_json, @regime, 'open', @entry_time, @signal_scores_json, @entry_fee)
        `);

        this._stmts.updateSignalScores = this.db.prepare(`
            UPDATE trades SET signal_scores_json = @signal_scores_json WHERE id = @id AND signal_scores_json IS NULL
        `);

        this._stmts.closeTrade = this.db.prepare(`
            UPDATE trades SET
                exit_price = @exit_price,
                pnl = @pnl,
                pnl_pct = @pnl_pct,
                status = 'closed',
                exit_time = @exit_time,
                exit_reason = @exit_reason,
                exit_fee = @exit_fee,
                modeled_execution_cost = @modeled_execution_cost,
                modeled_funding_reserve = @modeled_funding_reserve
            WHERE id = @id AND status = 'open'
        `);

        this._stmts.reconcileStaleTrade = this.db.prepare(`
            UPDATE trades SET status = 'reconciled', exit_time = @exit_time,
                exit_reason = @exit_reason
            WHERE id = @id AND status = 'open'
        `);

        this._stmts.insertSnapshot = this.db.prepare(`
            INSERT OR REPLACE INTO daily_snapshots (date, equity, cash, positions_count, daily_pnl, daily_trades, cumulative_pnl, max_drawdown_pct, win_rate)
            VALUES (@date, @equity, @cash, @positions_count, @daily_pnl, @daily_trades, @cumulative_pnl, @max_drawdown_pct, @win_rate)
        `);

        this._stmts.insertLifecycleEvent = this.db.prepare(`
            INSERT INTO trade_lifecycle_events (lifecycle_id, trade_id, order_id, symbol, stage, actor, status, payload)
            VALUES (@lifecycle_id, @trade_id, @order_id, @symbol, @stage, @actor, @status, @payload)
        `);
        this._stmts.insertLearningEvent = this.db.prepare(`
            INSERT INTO learning_events (event_type, description, strategy, metric_name, old_value, new_value, trigger_reason)
            VALUES (@event_type, @description, @strategy, @metric_name, @old_value, @new_value, @trigger_reason)
        `);

        console.log('[TradeLogger] SQLite initialized at', this.dbPath);
    }

    /**
     * Log a trade entry
     */
    logTradeEntry(trade) {
        if (!this.db) return null;

        const result = this._stmts.insertTrade.run({
            order_id: trade.orderId || null,
            symbol: trade.symbol,
            side: trade.side,
            qty: trade.qty,
            entry_price: trade.entryPrice || trade.filledPrice || 0,
            filled_price: trade.filledPrice || null,
            expected_price: trade.expectedPrice || null,
            slippage_pct: trade.slippagePct || null,
            strategy: trade.strategy || 'manual',
            strategy_version: trade.attribution?.strategyVersion || trade.strategyVersion || null,
            candidate_key: trade.attribution?.candidateKey || trade.candidateKey || null,
            attribution_json: trade.attribution ? JSON.stringify(trade.attribution) : null,
            regime: trade.regime || null,
            entry_time: new Date().toISOString(),
            signal_scores_json: trade.signalScores ? JSON.stringify(trade.signalScores) : null,
            entry_fee: Number(trade.entryFee ?? trade.fee ?? 0) || 0
        });

        try {
            if (!this.recordEvidence) return result.lastInsertRowid;
            const evidenceType = trade.evidenceType || 'paper_trade';
            marketEvidenceStore.append(evidenceType, {
                tradeId: result.lastInsertRowid,
                orderId: trade.orderId || null,
                symbol: trade.symbol,
                side: trade.side,
                qty: trade.qty,
                entryPrice: trade.entryPrice || trade.filledPrice || 0,
                filledPrice: trade.filledPrice || null,
                expectedPrice: trade.expectedPrice || null,
                slippagePct: trade.slippagePct || null,
                entryFee: Number(trade.entryFee ?? trade.fee ?? 0) || 0,
                strategy: trade.strategy || 'manual',
                attribution: trade.attribution || null,
                regime: trade.regime || null,
                mode: trade.mode || (evidenceType === 'paper_trade' ? 'paper' : 'broker'),
                broker: trade.broker || null,
                status: 'open'
            }, {
                source: 'TradeLogger',
                symbol: trade.symbol,
                strategyId: trade.attribution?.strategyId || trade.strategy || 'manual',
                parentEvidenceIds: trade.attribution?.candidateId ? [trade.attribution.candidateId] : []
            });
        } catch {
            // Evidence logging is auxiliary; trade persistence remains authoritative.
        }

        return result.lastInsertRowid;
    }

    /**
     * Log a trade exit (close an open trade)
     */
    logTradeExit(tradeIdOrSymbol, exitData) {
        if (!this.db) return false;

        let tradeId = tradeIdOrSymbol;
        let openTrade = null;

        // If passed a symbol, find the most recent open trade for it
        if (typeof tradeIdOrSymbol === 'string' && isNaN(tradeIdOrSymbol)) {
            openTrade = this.db.prepare(
                `SELECT id, entry_price, qty, side, entry_fee FROM trades WHERE symbol = ? AND status = 'open' ORDER BY id DESC LIMIT 1`
            ).get(tradeIdOrSymbol);

            if (!openTrade) {
                console.warn(`[TradeLogger] No open trade found for ${tradeIdOrSymbol}`);
                return false;
            }
            tradeId = openTrade.id;
        } else {
            openTrade = this.db.prepare(
                `SELECT id, entry_price, qty, side, entry_fee FROM trades WHERE id = ? AND status = 'open'`
            ).get(tradeId);
            if (!openTrade) {
                return this.db.prepare(`SELECT status FROM trades WHERE id = ?`).get(tradeId)?.status === 'closed';
            }
        }

        // Numeric trade IDs are the normal runtime path, so fee-aware automatic
        // calculation must work for both an ID and a symbol lookup.
        if (openTrade && exitData.exitPrice && exitData.pnl == null) {
            const multiplier = openTrade.side === 'buy' ? 1 : -1;
            const entryFee = Number(openTrade.entry_fee || 0);
            const exitFee = Number(exitData.exitFee ?? exitData.fee ?? 0) || 0;
            exitData.pnl = (exitData.exitPrice - openTrade.entry_price) * openTrade.qty * multiplier - entryFee - exitFee;
            exitData.pnlPct = exitData.pnl / (openTrade.entry_price * openTrade.qty);
        }

        const closedAt = new Date().toISOString();
        const update = this._stmts.closeTrade.run({
            id: tradeId,
            exit_price: exitData.exitPrice || 0,
            pnl: exitData.pnl || 0,
            pnl_pct: exitData.pnlPct || 0,
            exit_time: closedAt,
            exit_reason: exitData.reason || 'manual',
            exit_fee: Number(exitData.exitFee ?? exitData.fee ?? 0) || 0,
            modeled_execution_cost: Number(exitData.modeledExecutionCost ?? 0) || 0,
            modeled_funding_reserve: Number(exitData.modeledFundingReserve ?? 0) || 0
        });
        if (update.changes !== 1) return false;

        try {
            if (!this.recordEvidence) return true;
            const closedTrade = this.db.prepare(`SELECT * FROM trades WHERE id = ?`).get(tradeId);
            marketEvidenceStore.append('performance', {
                tradeId,
                orderId: closedTrade?.order_id || null,
                symbol: closedTrade?.symbol || (typeof tradeIdOrSymbol === 'string' ? tradeIdOrSymbol : null),
                strategy: closedTrade?.strategy || exitData.strategy || 'manual',
                exitPrice: exitData.exitPrice || 0,
                pnl: exitData.pnl || 0,
                pnlPct: exitData.pnlPct || 0,
                exitFee: Number(exitData.exitFee ?? exitData.fee ?? 0) || 0,
                exitReason: exitData.reason || 'manual',
                status: 'closed',
                closedAt
            }, {
                source: 'TradeLogger',
                symbol: closedTrade?.symbol || (typeof tradeIdOrSymbol === 'string' ? tradeIdOrSymbol : null),
                strategyId: closedTrade?.strategy || exitData.strategy || 'manual'
            });
        } catch {
            // Non-blocking evidence mirror.
        }
        return true;
    }

    /**
     * Save daily equity snapshot
     */
    saveDailySnapshot(snapshot) {
        if (!this.db) return;

        const today = new Date().toISOString().split('T')[0];
        const stats = this.getStats();
        // daily_trades means trades closed TODAY — it was storing the all-time
        // count, which made the snapshot table's per-day columns meaningless.
        const todayTrades = this.getClosedTrades(1).length;

        this._stmts.insertSnapshot.run({
            date: snapshot.date || today,
            equity: snapshot.equity || 0,
            cash: snapshot.cash || 0,
            positions_count: snapshot.positionsCount || 0,
            daily_pnl: snapshot.dailyPnl || 0,
            daily_trades: todayTrades,
            cumulative_pnl: stats.totalPnl || 0,
            max_drawdown_pct: snapshot.maxDrawdownPct || 0,
            win_rate: stats.winRate || 0
        });
    }

    /**
     * Get all closed trades (for performance calculation)
     */
    getClosedTrades(days = null, { since = null } = {}) {
        if (!this.db) return [];

        let query = `SELECT * FROM trades WHERE status = 'closed'`;
        const params = [];

        if (days) {
            query += ` AND exit_time >= datetime('now', ?)`;
            params.push(`-${days} days`);
        }

        // Era cutoff: exclude trades earned under known-bad conditions (e.g. the
        // pre-2026-07-03 poisoned regime data) from stats used for promotion.
        if (since) {
            query += ` AND exit_time >= ?`;
            params.push(since);
        }

        query += ` ORDER BY exit_time ASC`;
        return this.db.prepare(query).all(...params);
    }

    /**
     * Get open trades
     */
    getOpenTrades() {
        if (!this.db) return [];
        return this.db.prepare(`SELECT * FROM trades WHERE status = 'open' ORDER BY entry_time DESC`).all();
    }

    /**
     * Mark orphaned database rows without inventing an exit price or P&L. These
     * rows remain auditable but are excluded from closed-trade performance.
     */
    reconcileStaleOpenTrades({ activeOrderIds = [], maxAgeMs = 12 * 60 * 60 * 1000, now = Date.now() } = {}) {
        if (!this.db) return { reconciled: [], retained: [] };
        const active = new Set(activeOrderIds.map(String));
        const reconciled = [];
        const retained = [];
        for (const trade of this.getOpenTrades()) {
            const ageMs = now - new Date(trade.entry_time || trade.created_at || 0).getTime();
            if (active.has(String(trade.order_id || '')) || !Number.isFinite(ageMs) || ageMs < maxAgeMs) {
                retained.push(trade.id);
                continue;
            }
            this._stmts.reconcileStaleTrade.run({
                id: trade.id,
                exit_time: new Date(now).toISOString(),
                exit_reason: 'RUNTIME_POSITION_MISSING'
            });
            reconciled.push(trade.id);
        }
        return { reconciled, retained };
    }

    /**
     * Get aggregate stats
     */
    getStats(days = null, { since = null } = {}) {
        if (!this.db) return this._emptyStats();

        const trades = this.getClosedTrades(days, { since });
        if (trades.length === 0) return this._emptyStats();

        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const totalProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
        const totalLoss = losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0);

        return {
            totalTrades: trades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: trades.length > 0 ? (wins.length / trades.length * 100) : 0,
            totalPnl,
            totalProfit,
            totalLoss,
            avgWin: wins.length > 0 ? totalProfit / wins.length : 0,
            avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
            profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
            largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0,
            largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0,
            avgSlippage: trades.filter(t => t.slippage_pct != null).length > 0
                ? trades.filter(t => t.slippage_pct != null).reduce((sum, t) => sum + t.slippage_pct, 0) / trades.filter(t => t.slippage_pct != null).length
                : 0
        };
    }

    /**
     * Get stats by strategy
     */
    getStatsByStrategy() {
        if (!this.db) return [];

        return this.db.prepare(`
            SELECT
                strategy,
                COUNT(*) as total_trades,
                SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END) as losses,
                ROUND(SUM(pnl), 2) as total_pnl,
                ROUND(AVG(pnl), 2) as avg_pnl,
                ROUND(AVG(CASE WHEN pnl > 0 THEN pnl END), 2) as avg_win,
                ROUND(AVG(CASE WHEN pnl <= 0 THEN pnl END), 2) as avg_loss
            FROM trades
            WHERE status = 'closed'
            GROUP BY strategy
            ORDER BY total_pnl DESC
        `).all();
    }

    /**
     * Get daily equity curve
     */
    getEquityCurve(days = 30) {
        if (!this.db) return [];

        return this.db.prepare(`
            SELECT * FROM daily_snapshots
            WHERE date >= date('now', ?)
            ORDER BY date ASC
        `).all(`-${days} days`);
    }

    /**
     * Update signal scores on an already-logged trade (use when scores not available at entry time)
     */
    updateTradeSignalScores(tradeId, signalScores) {
        if (!this.db || !tradeId || !signalScores) return;
        this._stmts.updateSignalScores.run({
            id: tradeId,
            signal_scores_json: JSON.stringify(signalScores)
        });
    }

    /**
     * Get closed trades that have signal scores, with id > afterId, for bulk weight updates
     */
    getClosedTradesWithSignalScores(afterId = 0) {
        if (!this.db) return [];
        return this.db.prepare(`
            SELECT id, side, pnl, entry_price, qty, pnl_pct, signal_scores_json FROM trades
            WHERE status = 'closed' AND signal_scores_json IS NOT NULL AND id > ?
            ORDER BY exit_time ASC, id ASC
        `).all(afterId).map(row => ({
            id: row.id,
            side: row.side,
            // Historic callers mixed percent and fractional pnl_pct units.
            // Dollar P&L and entry notional are the authoritative net return.
            netReturn: row.entry_price > 0 && row.qty > 0 && Number.isFinite(row.pnl)
                ? row.pnl / (row.entry_price * row.qty) : null,
            pnl_pct: row.pnl_pct,
            signalScores: (() => { try { return JSON.parse(row.signal_scores_json); } catch { return null; } })()
        }));
    }

    /**
     * Get recent trades
     */
    getRecentTrades(limit = 20) {
        if (!this.db) return [];

        return this.db.prepare(`
            SELECT * FROM trades
            ORDER BY COALESCE(exit_time, entry_time) DESC
            LIMIT ?
        `).all(limit);
    }

    // ═══════════════════════════════════════════════════════════
    // LEARNING EVENTS
    // ═══════════════════════════════════════════════════════════

    /**
     * Log a learning event (strategy adjustment, parameter change, etc.)
     */
    logLearningEvent({ eventType, description, strategy = null, metricName = null, oldValue = null, newValue = null, triggerReason = null }) {
        if (!this.db) return null;

        try {
            const fingerprint = this._telemetryFingerprint('learning', { eventType, description, strategy, metricName, oldValue, newValue, triggerReason });
            if (this._isDuplicateTelemetry(fingerprint)) return null;
            const result = this._stmts.insertLearningEvent.run({
                event_type: eventType,
                description,
                strategy,
                metric_name: metricName,
                old_value: oldValue,
                new_value: newValue,
                trigger_reason: triggerReason
            });
            this._afterTelemetryWrite();
            return result.lastInsertRowid;
        } catch (err) {
            console.warn('[TradeLogger] Failed to log learning event:', err.message);
            return null;
        }
    }

    /**
     * Get recent learning events
     */
    getLearningEvents(limit = 10) {
        if (!this.db) return [];
        return this.db.prepare(`
            SELECT * FROM learning_events ORDER BY created_at DESC LIMIT ?
        `).all(limit);
    }

    /**
     * Get learning events by type
     */
    getLearningEventsByType(eventType, limit = 20) {
        if (!this.db) return [];
        return this.db.prepare(`
            SELECT * FROM learning_events WHERE event_type = ? ORDER BY created_at DESC LIMIT ?
        `).all(eventType, limit);
    }

    /**
     * Log a lifecycle event for audit replay: data, signal, guardrail, order, fill, close.
     */
    logLifecycleEvent({ lifecycleId = null, tradeId = null, orderId = null, symbol = null, stage, actor = 'SOMA', status = 'info', payload = {} }) {
        if (!this.db || !stage) return null;

        try {
            const durableStages = new Set(['order', 'order_submit', 'fill', 'entry', 'close', 'exit', 'reconcile', 'auto_promotion']);
            const fingerprint = this._telemetryFingerprint('lifecycle', { lifecycleId, tradeId, orderId, symbol, stage, actor, status, payload });
            if (!durableStages.has(String(stage).toLowerCase()) && this._isDuplicateTelemetry(fingerprint)) return null;
            const result = this._stmts.insertLifecycleEvent.run({
                lifecycle_id: lifecycleId,
                trade_id: tradeId,
                order_id: orderId,
                symbol,
                stage,
                actor,
                status,
                payload: JSON.stringify(payload || {})
            });
            this._afterTelemetryWrite();
            return result.lastInsertRowid;
        } catch (err) {
            console.warn('[TradeLogger] Failed to log lifecycle event:', err.message);
            return null;
        }
    }

    _telemetryFingerprint(kind, value) {
        return crypto.createHash('sha1').update(`${kind}:${JSON.stringify(value)}`).digest('hex');
    }

    _isDuplicateTelemetry(fingerprint, now = Date.now()) {
        if (!this.telemetryDedupeWindowMs) return false;
        const previous = this._telemetryFingerprints.get(fingerprint) || 0;
        this._telemetryFingerprints.set(fingerprint, now);
        if (this._telemetryFingerprints.size > 5000) {
            const cutoff = now - this.telemetryDedupeWindowMs;
            for (const [key, seenAt] of this._telemetryFingerprints) {
                if (seenAt < cutoff) this._telemetryFingerprints.delete(key);
            }
        }
        return now - previous < this.telemetryDedupeWindowMs;
    }

    _afterTelemetryWrite() {
        this._telemetryWrites++;
        if (this._telemetryWrites % 500 === 0) this.maintainTelemetry();
    }

    /** Keep the audit ledger replayable without allowing heartbeat noise to grow forever. */
    maintainTelemetry({ force = false } = {}) {
        if (!this.db) return { lifecycleDeleted: 0, learningDeleted: 0 };
        const prune = this.db.transaction(() => {
            const beforeLifecycle = this.db.prepare('SELECT COUNT(*) AS count FROM trade_lifecycle_events').get().count;
            const beforeLearning = this.db.prepare('SELECT COUNT(*) AS count FROM learning_events').get().count;
            this.db.prepare(`DELETE FROM trade_lifecycle_events WHERE id < COALESCE((SELECT id FROM trade_lifecycle_events ORDER BY id DESC LIMIT 1 OFFSET ?), 0)`)
                .run(this.telemetryRetention.lifecycleRows - 1);
            this.db.prepare(`DELETE FROM learning_events WHERE id < COALESCE((SELECT id FROM learning_events ORDER BY id DESC LIMIT 1 OFFSET ?), 0)`)
                .run(this.telemetryRetention.learningRows - 1);
            const afterLifecycle = this.db.prepare('SELECT COUNT(*) AS count FROM trade_lifecycle_events').get().count;
            const afterLearning = this.db.prepare('SELECT COUNT(*) AS count FROM learning_events').get().count;
            return { lifecycleDeleted: beforeLifecycle - afterLifecycle, learningDeleted: beforeLearning - afterLearning };
        });
        const result = prune();
        this.db.pragma('optimize');
        if (force) this.db.pragma('wal_checkpoint(TRUNCATE)');
        return result;
    }

    /**
     * Get recent lifecycle events for Mission Control audit and replay.
     */
    getLifecycleEvents({ limit = 100, lifecycleId = null } = {}) {
        if (!this.db) return [];
        const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
        const rows = lifecycleId
            ? this.db.prepare(`
                SELECT * FROM trade_lifecycle_events
                WHERE lifecycle_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?
            `).all(lifecycleId, safeLimit)
            : this.db.prepare(`
                SELECT * FROM trade_lifecycle_events
                ORDER BY created_at DESC, id DESC
                LIMIT ?
            `).all(safeLimit);

        return rows.map(row => {
            let payload = {};
            try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch {}
            return { ...row, payload };
        });
    }

    _emptyStats() {
        return {
            totalTrades: 0, wins: 0, losses: 0, winRate: 0,
            totalPnl: 0, totalProfit: 0, totalLoss: 0,
            avgWin: 0, avgLoss: 0, profitFactor: 0,
            largestWin: 0, largestLoss: 0, avgSlippage: 0
        };
    }

    /**
     * Close database connection
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

// Singleton
const tradeLogger = new TradeLogger();
export { TradeLogger };
export default tradeLogger;
