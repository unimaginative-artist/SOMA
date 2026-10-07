/**
 * PositionGuardian - Server-Side Position Monitor
 *
 * Runs independently of the frontend. If the browser crashes,
 * this keeps watching positions and enforcing stops.
 *
 * Core loop (every 5 seconds):
 * 1. Fetch real broker positions from Alpaca
 * 2. Check stop-loss / take-profit triggers via RiskManager
 * 3. Auto-close positions that hit triggers
 * 4. Check portfolio-level drawdown, halt trading if breached
 * 5. Broadcast position state to dashboard via WebSocket
 */

import { EventEmitter } from 'events';

class PositionGuardian extends EventEmitter {
    constructor({ alpacaService, riskManager, guardrails, tradeLogger = null, dashboardClients = null }) {
        super();
        this.alpaca = alpacaService;
        this.riskManager = riskManager;
        this.guardrails = guardrails;
        this.tradeLogger = tradeLogger;
        this.dashboardClients = dashboardClients;

        this.intervalId = null;
        this.pollIntervalMs = 5000; // 5 seconds
        this.isRunning = false;

        // Backoff state — prevents event loop starvation when broker is unreachable
        this.consecutiveErrors = 0;
        this.maxBackoffMs = 60000; // Cap at 60s between retries

        // Cached state for API responses
        this.lastPositions = [];
        this.lastCheck = null;
        this.triggeredActions = [];
        this.orphanedPositions = [];
        this._lastSnapshotDate = null; // Track daily snapshot to avoid duplicates
    }

    /**
     * Start the guardian loop
     */
    start() {
        if (this.isRunning) {
            console.log('[Guardian] Already running');
            return;
        }

        this.isRunning = true;
        console.log(`[Guardian] Starting position monitor (polling every ${this.pollIntervalMs / 1000}s)`);

        // Run immediately on start, then schedule next tick with dynamic interval
        this._scheduleNextTick();

        this.emit('guardian:started');
    }

    /**
     * Stop the guardian loop
     */
    stop() {
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }
        this.consecutiveErrors = 0;
        this.isRunning = false;
        console.log('[Guardian] Stopped');
        this.emit('guardian:stopped');
    }

    /**
     * Schedule next tick with exponential backoff on errors
     */
    _scheduleNextTick() {
        if (!this.isRunning) return;

        const delay = this.consecutiveErrors > 0
            ? Math.min(this.maxBackoffMs, this.pollIntervalMs * Math.pow(2, this.consecutiveErrors))
            : this.pollIntervalMs;

        this.intervalId = setTimeout(async () => {
            try {
                await this._tick();
                this.consecutiveErrors = 0; // Reset on success
            } catch (err) {
                this.consecutiveErrors++;
                if (this.consecutiveErrors <= 3 || this.consecutiveErrors % 10 === 0) {
                    console.error(`[Guardian] Tick error (attempt ${this.consecutiveErrors}, next in ${Math.min(this.maxBackoffMs, this.pollIntervalMs * Math.pow(2, this.consecutiveErrors)) / 1000}s):`, err.message);
                }
            }
            this._scheduleNextTick();
        }, delay);
    }

    /**
     * Single monitoring tick
     */
    async _tick() {
        if (!this.alpaca.isConnected) return;

        try {
            // 1. Fetch real broker positions
            const positions = await this.alpaca.getPositions();
            this.lastPositions = positions;
            this.lastCheck = new Date().toISOString();

            // 2. Update RiskManager portfolio state from real broker data
            const account = await this.alpaca.client.getAccount();
            const totalValue = parseFloat(account.portfolio_value) || 0;
            const cash = parseFloat(account.cash) || 0;
            const equity = parseFloat(account.equity) || 0;
            const lastEquity = parseFloat(account.last_equity) || totalValue;
            const dailyPnL = equity - lastEquity;

            const positionMap = new Map();
            let unrealizedPnL = 0;
            for (const pos of positions) {
                positionMap.set(pos.symbol, {
                    symbol: pos.symbol,
                    shares: pos.qty,
                    currentPrice: pos.current_price,
                    value: pos.market_value,
                    sector: pos.sector || 'Unknown',
                    side: pos.side
                });
                unrealizedPnL += pos.unrealized_pl;
            }

            this.riskManager.updatePortfolio({
                totalValue,
                cash,
                positions: positionMap,
                unrealizedPnL,
                dailyPnL
            });

            // 3. Check stop-loss / take-profit triggers for each position
            for (const pos of positions) {
                const triggers = this.riskManager.checkExitTriggers(pos.symbol, pos.current_price);

                for (const trigger of triggers) {
                    console.log(`[Guardian] TRIGGER: ${trigger.type} for ${pos.symbol} @ $${pos.current_price}`);

                    try {
                        await this.alpaca.closePosition(pos.symbol);
                        console.log(`[Guardian] Closed ${pos.symbol} (${trigger.type})`);

                        // Record the PnL
                        this.riskManager.recordTradeResult({
                            symbol: pos.symbol,
                            pnl: pos.unrealized_pl
                        });

                        // Track loss for guardrails
                        if (pos.unrealized_pl < 0) {
                            this.guardrails.recordLoss(Math.abs(pos.unrealized_pl));
                        }

                        // Log trade exit to SQLite
                        if (this.tradeLogger) {
                            try {
                                this.tradeLogger.logTradeExit(pos.symbol, {
                                    exitPrice: pos.current_price,
                                    pnl: pos.unrealized_pl,
                                    pnlPct: pos.unrealized_plpc ? pos.unrealized_plpc * 100 : null,
                                    reason: trigger.type.toLowerCase()
                                });
                            } catch (logErr) {
                                console.warn(`[Guardian] Trade exit log failed for ${pos.symbol}:`, logErr.message);
                            }
                        }

                        this.triggeredActions.push({
                            timestamp: new Date().toISOString(),
                            type: trigger.type,
                            symbol: pos.symbol,
                            price: pos.current_price,
                            pnl: pos.unrealized_pl,
                            status: 'closed'
                        });

                        // Remove the trigger after execution
                        if (trigger.type === 'STOP_LOSS') {
                            this.riskManager.stopLosses.delete(pos.symbol);
                        } else if (trigger.type === 'TAKE_PROFIT') {
                            this.riskManager.takeProfits.delete(pos.symbol);
                        }

                        this.emit('guardian:position_closed', {
                            symbol: pos.symbol,
                            trigger: trigger.type,
                            pnl: pos.unrealized_pl
                        });
                    } catch (closeErr) {
                        console.error(`[Guardian] Failed to close ${pos.symbol}:`, closeErr.message);
                        this.triggeredActions.push({
                            timestamp: new Date().toISOString(),
                            type: trigger.type,
                            symbol: pos.symbol,
                            price: pos.current_price,
                            status: 'failed',
                            error: closeErr.message
                        });
                    }
                }
            }

            // 4. Portfolio-level drawdown check
            const riskSummary = this.riskManager.getRiskSummary();
            if (riskSummary.portfolio.currentDrawdown > this.riskManager.limits.maxDrawdown) {
                console.error(`[Guardian] DRAWDOWN BREACH: ${(riskSummary.portfolio.currentDrawdown * 100).toFixed(1)}% > ${(this.riskManager.limits.maxDrawdown * 100).toFixed(1)}%`);
                console.error('[Guardian] Closing ALL positions and halting trading');

                try {
                    await this.alpaca.closeAllPositions();
                    await this.riskManager.haltTrading('Max drawdown exceeded - all positions closed by Guardian');
                    this.emit('guardian:drawdown_halt', riskSummary);
                } catch (haltErr) {
                    console.error('[Guardian] Emergency close failed:', haltErr.message);
                }
            }

            // 5. Broadcast to dashboard
            this._broadcast({
                type: 'guardian:update',
                payload: {
                    positions,
                    riskSummary,
                    lastCheck: this.lastCheck,
                    activeStops: this.riskManager.stopLosses.size,
                    activeTakeProfits: this.riskManager.takeProfits.size,
                    isHalted: this.riskManager.riskState.isHalted,
                    recentActions: this.triggeredActions.slice(-10)
                }
            });

            // Save risk state periodically
            await this.riskManager.saveRiskState();

            // Save daily equity snapshot (once per day). When SOMA's own paper
            // engines are running, snapshot THEIR equity — the Alpaca account is
            // a separate untouched pool whose frozen equity made the snapshot
            // table useless (equity pinned at 100354.91, daily_pnl 0, Jun 2026).
            if (this.tradeLogger) {
                const today = new Date().toISOString().split('T')[0];
                if (today !== this._lastSnapshotDate) {
                    try {
                        let snapEquity = equity;
                        let snapCash = cash;
                        let snapPositions = positions.length;
                        let snapDailyPnl = dailyPnL;

                        const registry = global.SOMA_AUTONOMOUS_REGISTRY;
                        if (registry && registry.size) {
                            let paperEquity = 0;
                            let paperPositions = 0;
                            let anyPaper = false;
                            for (const trader of registry.values()) {
                                if (trader?.paperMode && trader._paperPortfolio) {
                                    anyPaper = true;
                                    paperEquity += Number(trader._paperPortfolio.balance) || 0;
                                    paperPositions += Object.keys(trader._paperPortfolio.positions || {}).length;
                                }
                            }
                            if (anyPaper) {
                                snapEquity = Number(paperEquity.toFixed(2));
                                snapCash = snapEquity;
                                snapPositions = paperPositions;
                                const curve = this.tradeLogger.getEquityCurve?.(7) || [];
                                const prevEquity = curve.length
                                    ? Number(curve[curve.length - 1]?.equity)
                                    : NaN;
                                snapDailyPnl = Number.isFinite(prevEquity)
                                    ? Number((snapEquity - prevEquity).toFixed(2))
                                    : 0;
                            }
                        }

                        this.tradeLogger.saveDailySnapshot({
                            equity: snapEquity,
                            cash: snapCash,
                            positionsCount: snapPositions,
                            dailyPnl: snapDailyPnl,
                            maxDrawdownPct: riskSummary.portfolio?.currentDrawdown
                                ? riskSummary.portfolio.currentDrawdown * 100 : 0
                        });
                        this._lastSnapshotDate = today;
                    } catch (snapErr) {
                        console.warn('[Guardian] Daily snapshot failed:', snapErr.message);
                    }
                }
            }

        } catch (err) {
            // Don't crash on transient errors (network blips, etc.)
            if (!err.message.includes('Not connected')) {
                console.error('[Guardian] Tick error:', err.message);
            }
        }
    }

    /**
     * Reconcile broker positions with saved risk state on startup
     */
    async reconcile() {
        if (!this.alpaca.isConnected) {
            return { status: 'skipped', reason: 'Not connected to broker' };
        }

        console.log('[Guardian] Reconciling broker positions with saved risk state...');

        try {
            const brokerPositions = await this.alpaca.getPositions();
            const savedStops = Array.from(this.riskManager.stopLosses.entries());
            const savedTakeProfits = Array.from(this.riskManager.takeProfits.entries());

            // Find orphaned positions (in broker but no stop/TP set)
            this.orphanedPositions = [];
            for (const pos of brokerPositions) {
                const hasStop = this.riskManager.stopLosses.has(pos.symbol);
                const hasTP = this.riskManager.takeProfits.has(pos.symbol);

                if (!hasStop && !hasTP) {
                    this.orphanedPositions.push({
                        symbol: pos.symbol,
                        qty: pos.qty,
                        current_price: pos.current_price,
                        unrealized_pl: pos.unrealized_pl,
                        warning: 'No stop-loss or take-profit set'
                    });
                    console.warn(`[Guardian] ORPHANED: ${pos.symbol} (${pos.qty} shares) - no risk rules`);
                }
            }

            // Find stale stops (stop set but position no longer exists)
            const staleStops = [];
            const brokerSymbols = new Set(brokerPositions.map(p => p.symbol));
            for (const [symbol] of savedStops) {
                if (!brokerSymbols.has(symbol)) {
                    staleStops.push(symbol);
                    this.riskManager.stopLosses.delete(symbol);
                    console.log(`[Guardian] Cleaned stale stop for ${symbol} (no position)`);
                }
            }
            for (const [symbol] of savedTakeProfits) {
                if (!brokerSymbols.has(symbol)) {
                    this.riskManager.takeProfits.delete(symbol);
                    console.log(`[Guardian] Cleaned stale take-profit for ${symbol} (no position)`);
                }
            }

            const result = {
                status: 'reconciled',
                brokerPositions: brokerPositions.length,
                activeStops: this.riskManager.stopLosses.size,
                activeTakeProfits: this.riskManager.takeProfits.size,
                orphanedPositions: this.orphanedPositions.length,
                staleStosCleaned: staleStops.length,
                orphans: this.orphanedPositions
            };

            console.log(`[Guardian] Reconciliation complete: ${brokerPositions.length} positions, ${this.orphanedPositions.length} orphaned`);
            this.emit('guardian:reconciled', result);

            return result;
        } catch (err) {
            console.error('[Guardian] Reconciliation failed:', err.message);
            return { status: 'failed', error: err.message };
        }
    }

    /**
     * Broadcast data to dashboard WebSocket clients
     */
    _broadcast(message) {
        if (!this.dashboardClients || this.dashboardClients.size === 0) return;

        const data = JSON.stringify(message);
        this.dashboardClients.forEach(client => {
            if (client.readyState === 1) {
                try { client.send(data); } catch (e) { /* client disconnected */ }
            }
        });
    }

    /**
     * Get current guardian status (for REST API)
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            pollIntervalMs: this.pollIntervalMs,
            lastCheck: this.lastCheck,
            positions: this.lastPositions,
            activeStops: Array.from(this.riskManager.stopLosses.entries()).map(([symbol, stop]) => ({
                symbol,
                stopPrice: stop.stopPrice,
                stopPercent: stop.stopPercent,
                setAt: new Date(stop.setAt).toISOString()
            })),
            activeTakeProfits: Array.from(this.riskManager.takeProfits.entries()).map(([symbol, tp]) => ({
                symbol,
                targetPrice: tp.targetPrice,
                targetPercent: tp.targetPercent,
                setAt: new Date(tp.setAt).toISOString()
            })),
            orphanedPositions: this.orphanedPositions,
            recentActions: this.triggeredActions.slice(-20),
            riskSummary: this.riskManager.getRiskSummary(),
            guardrailsStatus: this.guardrails.getStatus()
        };
    }
}

export default PositionGuardian;
