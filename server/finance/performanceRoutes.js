/**
 * Performance & Learning API Routes
 * Real data from TradeLogger (SQLite) + PerformanceCalculator
 */

import express from 'express';
import tradeLogger from './TradeLogger.js';
import performanceCalculator from './PerformanceCalculator.js';
import scalpingEngine from './scalpingEngine.js';
import simulationLearningEngine from './SimulationLearningEngine.js';

const router = express.Router();

/**
 * GET /api/performance/summary
 * Get overall performance summary with real trade data
 */
router.get('/summary', (req, res) => {
    try {
        const { days } = req.query;
        const daysFilter = days ? parseInt(days) : null;

        // Get real stats from SQLite (closed trades)
        const stats = tradeLogger.getStats(daysFilter);
        const strategyStats = tradeLogger.getStatsByStrategy();

        // Sharpe/Sortino: calculate when we have enough closed trades
        let sharpeRatio = null, sortinoRatio = null, maxDrawdownPct = null;
        if ((stats.totalTrades || 0) >= 5) {
            try {
                const closedTrades = tradeLogger.getClosedTrades(daysFilter || 30);
                const equityCurve = tradeLogger.getEquityCurve(daysFilter || 30);
                const report = performanceCalculator.calculateReport(closedTrades, equityCurve);
                sharpeRatio = report.metrics?.sharpeRatio ?? null;
                sortinoRatio = report.metrics?.sortinoRatio ?? null;
                maxDrawdownPct = report.metrics?.maxDrawdownPct ?? null;
            } catch { /* non-fatal */ }
        }

        // Get open trades so the dashboard shows live activity
        const openTrades = tradeLogger.getOpenTrades();
        const openByStrategy = {};
        for (const t of openTrades) {
            const key = t.strategy || 'manual';
            if (!openByStrategy[key]) openByStrategy[key] = { count: 0, symbols: new Set() };
            openByStrategy[key].count++;
            openByStrategy[key].symbols.add(t.symbol);
        }

        // Build agent leaderboard — merge closed stats + open position counts
        const agentLeaderboard = strategyStats.map(s => ({
            agent_name: formatStrategyName(s.strategy),
            total_trades: s.total_trades,
            wins: s.wins,
            losses: s.losses,
            total_pnl: s.total_pnl,
            avg_pnl: s.avg_pnl,
            avg_win: s.avg_win,
            avg_loss: s.avg_loss
        }));

        // Add agents that only have open positions (no closed trades yet)
        for (const [strategy, info] of Object.entries(openByStrategy)) {
            const alreadyListed = agentLeaderboard.some(
                a => a.agent_name === formatStrategyName(strategy)
            );
            if (!alreadyListed) {
                agentLeaderboard.push({
                    agent_name: formatStrategyName(strategy),
                    total_trades: 0,
                    open_positions: info.count,
                    wins: 0,
                    losses: 0,
                    total_pnl: 0,
                    avg_pnl: 0,
                    avg_win: 0,
                    avg_loss: 0,
                    symbols: [...info.symbols]
                });
            }
        }

        res.json({
            success: true,
            summary: {
                total_pnl: parseFloat((stats.totalPnl || 0).toFixed(2)),
                win_rate: parseFloat((stats.winRate || 0).toFixed(1)),
                total_trades: stats.totalTrades,
                total_wins: stats.wins,
                total_losses: stats.losses,
                // Open trade data so the dashboard shows live activity
                open_trades: openTrades.length,
                open_positions: openTrades.map(t => ({
                    symbol: t.symbol,
                    side: t.side,
                    qty: t.qty,
                    entry_price: t.entry_price,
                    strategy: t.strategy,
                    entry_time: t.entry_time
                })),
                profit_factor: stats.profitFactor === Infinity ? 999 :
                    parseFloat((stats.profitFactor || 0).toFixed(2)),
                avg_win: parseFloat((stats.avgWin || 0).toFixed(2)),
                avg_loss: parseFloat((stats.avgLoss || 0).toFixed(2)),
                largest_win: parseFloat((stats.largestWin || 0).toFixed(2)),
                largest_loss: parseFloat((stats.largestLoss || 0).toFixed(2)),
                avg_slippage: parseFloat((stats.avgSlippage || 0).toFixed(4)),
                sharpe_ratio: sharpeRatio,
                sortino_ratio: sortinoRatio,
                max_drawdown_pct: maxDrawdownPct,
                agent_leaderboard: agentLeaderboard
            }
        });
    } catch (error) {
        console.error('[Performance API] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/performance/report
 * Full 30-day go/no-go report with Sharpe, Sortino, drawdown
 */
router.get('/report', (req, res) => {
    try {
        const { days = 30 } = req.query;
        const daysFilter = parseInt(days);

        const trades = tradeLogger.getClosedTrades(daysFilter);
        const equityCurve = tradeLogger.getEquityCurve(daysFilter);

        const report = performanceCalculator.calculateReport(trades, equityCurve);

        res.json({
            success: true,
            report
        });
    } catch (error) {
        console.error('[Performance API] Report error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/performance/equity-curve
 * Get daily equity curve for charting
 */
router.get('/equity-curve', (req, res) => {
    try {
        const { days = 30 } = req.query;
        const curve = tradeLogger.getEquityCurve(parseInt(days));

        res.json({
            success: true,
            curve,
            count: curve.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/performance/trades
 * Get recent trades
 */
router.get('/trades', (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const trades = tradeLogger.getRecentTrades(parseInt(limit));

        res.json({
            success: true,
            trades,
            count: trades.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/performance/open-trades
 * Get currently open trades
 */
router.get('/open-trades', (req, res) => {
    try {
        const trades = tradeLogger.getOpenTrades();
        res.json({ success: true, trades, count: trades.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/learning/events
 * Get learning events derived from real performance data
 */
router.get('/events', (req, res) => {
    try {
        const { limit = 5 } = req.query;
        const events = generateLearningEvents(parseInt(limit));

        res.json({
            success: true,
            events
        });
    } catch (error) {
        console.error('[Learning API] Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/learning/reset
 * Reset learning statistics (clears scalping engine stats, not trade history)
 */
router.post('/reset', (req, res) => {
    try {
        // Reset in-memory scalping engine stats
        scalpingEngine.stats = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalProfit: 0,
            totalLoss: 0,
            dailyPnL: 0,
            lastTradeTime: 0,
            signalsChecked: 0,
            signalsRejected: 0
        };

        // Log the reset as a learning event
        tradeLogger.logLearningEvent({
            eventType: 'STATS_RESET',
            description: 'Scalping engine stats reset by user. Trade history preserved.',
            triggerReason: 'manual_reset'
        });

        res.json({
            success: true,
            message: 'Scalping stats reset. Trade history preserved in SQLite.'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Generate learning events - merges persistent events from SQLite with live analysis
 */
function generateLearningEvents(limit) {
    const events = [];

    // 1. Pull persistent learning events from SQLite (real adjustments SOMA has made)
    const persistedEvents = tradeLogger.getLearningEvents(limit);
    for (const pe of persistedEvents) {
        events.push({
            event_type: pe.event_type,
            description: pe.description,
            strategy: pe.strategy,
            metric_name: pe.metric_name,
            old_value: pe.old_value,
            new_value: pe.new_value,
            timestamp: pe.created_at
        });
    }

    // 2. Supplement with live analysis if we don't have enough persisted events
    if (events.length < limit) {
        const stats = tradeLogger.getStats();
        const recentTrades = tradeLogger.getRecentTrades(10);

        if (stats.totalTrades === 0 && events.length === 0) {
            // Check for open positions — the engine IS trading, just no closes yet
            const openTrades = tradeLogger.getOpenTrades();
            if (openTrades.length > 0) {
                const symbols = [...new Set(openTrades.map(t => t.symbol))];
                const strategies = [...new Set(openTrades.map(t => t.strategy).filter(Boolean))];
                const totalQty = openTrades.reduce((sum, t) => sum + (t.qty || 0), 0);

                events.push({
                    event_type: 'ACTIVE_TRADING',
                    description: `${openTrades.length} open positions across ${symbols.join(', ')} — awaiting first close for P&L tracking`,
                    timestamp: new Date().toISOString()
                });

                if (strategies.length > 0) {
                    events.push({
                        event_type: 'STRATEGY_DEPLOYED',
                        description: `Active strategies: ${strategies.map(s => formatStrategyName(s)).join(', ')}`,
                        timestamp: new Date().toISOString()
                    });
                }

                events.push({
                    event_type: 'DATA_COLLECTION',
                    description: `Collecting market data. Learning begins after first closed trades.`,
                    timestamp: new Date().toISOString()
                });

                return events.slice(0, limit);
            }

            events.push({
                event_type: 'INITIALIZATION',
                description: 'No trades recorded yet. Execute trades to begin tracking performance.',
                timestamp: new Date().toISOString()
            });
            return events.slice(0, limit);
        }

        // Win rate analysis
        if (stats.winRate > 60) {
            events.push({
                event_type: 'PATTERN_LEARNED',
                description: `Win rate at ${stats.winRate.toFixed(1)}% across ${stats.totalTrades} trades - strong signal detection`,
                timestamp: new Date().toISOString()
            });
        } else if (stats.winRate < 40 && stats.totalTrades >= 10) {
            events.push({
                event_type: 'STRATEGY_REVIEW',
                description: `Win rate at ${stats.winRate.toFixed(1)}% - strategy needs review before continued trading`,
                timestamp: new Date().toISOString()
            });
        }

        // Milestone tracking
        const milestones = [10, 25, 50, 100, 250, 500, 1000];
        for (const m of milestones) {
            if (stats.totalTrades >= m && stats.totalTrades < m + 10) {
                events.push({
                    event_type: 'MILESTONE',
                    description: `Reached ${m}+ trades - ${m >= 50 ? 'statistically significant sample' : 'building sample size'}`,
                    timestamp: new Date().toISOString()
                });
                break;
            }
        }

        // P&L trend
        if (stats.totalPnl > 0) {
            events.push({
                event_type: 'STRATEGY_OPTIMIZATION',
                description: `Net P&L: +$${stats.totalPnl.toFixed(2)} (PF: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)})`,
                timestamp: new Date().toISOString()
            });
        } else if (stats.totalPnl < 0) {
            events.push({
                event_type: 'RISK_ALERT',
                description: `Net P&L: -$${Math.abs(stats.totalPnl).toFixed(2)} - review risk parameters`,
                timestamp: new Date().toISOString()
            });
        }

        // Recent streak analysis
        if (recentTrades.length >= 3) {
            const recentClosed = recentTrades.filter(t => t.status === 'closed');
            const streak = [];
            for (const t of recentClosed) {
                if (streak.length === 0 || (t.pnl > 0) === (streak[0].pnl > 0)) {
                    streak.push(t);
                } else break;
            }
            if (streak.length >= 3) {
                const isWinStreak = streak[0].pnl > 0;
                events.push({
                    event_type: isWinStreak ? 'WIN_STREAK' : 'LOSS_STREAK',
                    description: `${streak.length}-trade ${isWinStreak ? 'winning' : 'losing'} streak detected`,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Strategy comparison
        const strategyStats = tradeLogger.getStatsByStrategy();
        if (strategyStats.length > 1) {
            const best = strategyStats[0];
            events.push({
                event_type: 'STRATEGY_COMPARISON',
                description: `Best strategy: ${formatStrategyName(best.strategy)} ($${best.total_pnl.toFixed(2)} across ${best.total_trades} trades)`,
                timestamp: new Date().toISOString()
            });
        }

        if (events.length === 0) {
            events.push({
                event_type: 'MONITORING',
                description: `Tracking ${stats.totalTrades} trades. WR: ${stats.winRate.toFixed(1)}%, P&L: $${stats.totalPnl.toFixed(2)}`,
                timestamp: new Date().toISOString()
            });
        }
    }

    return events.slice(0, limit);
}

/**
 * GET /api/learning/state
 * Get the current learning engine state (config, trend, adjustments)
 */
router.get('/state', (req, res) => {
    try {
        const state = simulationLearningEngine.getState();
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/learning/cycle
 * Force a learning cycle (manual trigger)
 */
router.post('/cycle', async (req, res) => {
    try {
        const result = await simulationLearningEngine.forceCycle();
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/learning/report
 * Get the paper→live readiness report
 */
router.get('/report', (req, res) => {
    try {
        const report = simulationLearningEngine.getPerformanceReport();
        res.json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/trading/regime
 * Get current market regime from MarketRegimeDetector (if loaded)
 */
router.get('/regime', async (req, res) => {
    try {
        const detector = global.SOMA_TRADING?.regimeDetector;
        if (!detector) {
            return res.json({
                success: true,
                loaded: false,
                regime: { type: 'NOT_LOADED', confidence: 0 },
                message: 'MarketRegimeDetector not loaded (enable SOMA_LOAD_EXTENDED)'
            });
        }

        const { symbol } = req.query;
        let regime = null;

        // If a symbol is provided and detectRegime exists, run live detection
        if (symbol && typeof detector.detectRegime === 'function') {
            try {
                regime = await detector.detectRegime(symbol);
            } catch (e) {
                // Fall back to cached regime
                regime = {
                    type: detector.currentRegime || 'UNKNOWN',
                    confidence: detector.confidence || 0
                };
            }
        } else {
            // Return cached regime state
            regime = {
                type: detector.currentRegime || 'UNKNOWN',
                confidence: detector.confidence || 0
            };
        }

        // Get strategy adjustments if available
        const adjustments = typeof detector.getStrategyAdjustments === 'function'
            ? detector.getStrategyAdjustments()
            : null;

        res.json({
            success: true,
            loaded: true,
            regime,
            adjustments,
            timestamp: Date.now()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/trading/position-size
 * Get position sizing recommendation from AdaptivePositionSizer (if loaded)
 */
router.get('/position-size', (req, res) => {
    try {
        const sizer = global.SOMA_TRADING?.positionSizer;
        if (!sizer) {
            return res.json({
                success: true,
                loaded: false,
                sizing: { positionSize: 100 },
                message: 'AdaptivePositionSizer not loaded (enable SOMA_LOAD_EXTENDED + SOMA_LOAD_HEAVY)'
            });
        }

        const { confidence = 0.5, winRate, volatility = 0.5, accountBalance = 10000 } = req.query;

        // Use live win rate from scalping engine if not provided
        let effectiveWinRate = parseFloat(winRate || 0.5);
        if (!winRate) {
            const stats = scalpingEngine.getStats();
            const totalTrades = stats.totalTrades || 0;
            effectiveWinRate = totalTrades > 0 ? stats.winningTrades / totalTrades : 0.5;
        }

        const sizing = sizer.calculatePositionSize({
            confidence: parseFloat(confidence),
            historicalWinRate: effectiveWinRate,
            volatility: parseFloat(volatility),
            riskScore: 50
        }, parseFloat(accountBalance));

        res.json({
            success: true,
            loaded: true,
            sizing,
            sizerState: {
                consecutiveWins: sizer.consecutiveWins || 0,
                consecutiveLosses: sizer.consecutiveLosses || 0,
                currentDrawdown: sizer.currentDrawdown || 0,
                recentTrades: (sizer.recentTrades || []).length
            },
            timestamp: Date.now()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Format strategy name for display
 */
function formatStrategyName(strategy) {
    if (!strategy) return 'Unknown';
    return strategy
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

export default router;
