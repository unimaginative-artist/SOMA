/**
 * SimulationLearningEngine - SOMA Learns From Paper Trading
 *
 * This is the feedback loop that closes the gap between "paper trading runs"
 * and "SOMA gets smarter." Every N trades (or on a timer), it:
 *
 * 1. Reads closed trades from TradeLogger (SQLite)
 * 2. Calculates per-strategy and per-exit-reason performance
 * 3. Adjusts ScalpingEngine parameters (RSI thresholds, stop multiplier, etc.)
 * 4. Logs every adjustment as a learning event (persistent, visible in dashboard)
 * 5. Saves learning state to disk so it survives restarts
 *
 * Philosophy: Conservative adjustments. Never change a parameter by more than
 * 15% per cycle. Require statistical significance (min 20 trades) before acting.
 */

import tradeLogger from './TradeLogger.js';
import scalpingEngine from './scalpingEngine.js';
import performanceCalculator from './PerformanceCalculator.js';
import { signalLibrary } from './SignalLibrary.js';
import fs from 'fs';
import path from 'path';

class SimulationLearningEngine {
    constructor() {
        this.stateFile = path.join(process.cwd(), 'data', 'trading', 'learning-state.json');
        this.cycleIntervalMs = 5 * 60 * 1000; // Learn every 5 minutes
        this.minTradesForLearning = 20;        // Don't adjust with fewer trades
        this.minNewTradesForTuning = 25;       // Parameter changes need fresh evidence, not re-reads of old trades
        this.maxAdjustmentPct = 0.15;          // Max 15% change per cycle
        this.intervalId = null;

        // Learning state (persisted to disk)
        this.state = {
            totalCycles: 0,
            lastCycleAt: null,
            tradesAnalyzedTotal: 0,
            adjustments: [],
            currentConfig: null, // Snapshot of current scalping config
            performanceTrend: [], // Rolling window of per-cycle metrics
            lastProcessedTradeId: 0 // For incremental signal weight updates
        };

        this._loadState();
    }

    /**
     * Start the periodic learning loop
     */
    start() {
        if (this.intervalId) return;

        console.log('[SimLearning] Starting learning engine (cycle every 5min)');
        this.intervalId = setInterval(() => {
            this.runLearningCycle().catch(err => {
                console.error('[SimLearning] Cycle error:', err.message);
            });
        }, this.cycleIntervalMs);

        // Run first cycle after 30s to let trades accumulate
        setTimeout(() => {
            this.runLearningCycle().catch(err => {
                console.error('[SimLearning] Initial cycle error:', err.message);
            });
        }, 30000);
    }

    /**
     * Stop the learning loop
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log('[SimLearning] Stopped');
    }

    /**
     * Run a single learning cycle
     */
    async runLearningCycle() {
        const closedTrades = tradeLogger.getClosedTrades();
        if (closedTrades.length < this.minTradesForLearning) {
            return { skipped: true, reason: `Only ${closedTrades.length} trades (need ${this.minTradesForLearning})` };
        }

        console.log(`[SimLearning] Running learning cycle (${closedTrades.length} trades)...`);

        const adjustments = [];
        const config = scalpingEngine.config;

        // Parameter tuning requires FRESH closed trades since the last tuning pass.
        // Without this, the same 30 trades get re-analyzed every 5 minutes and
        // parameters drift on zero new information (observed Jul 2026: identical
        // 30-trade window re-evaluated for hours).
        const maxTradeId = closedTrades.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
        const newSinceTune = closedTrades.filter(t => (Number(t.id) || 0) > (this.state.lastTunedTradeId || 0)).length;
        const tuningAllowed = newSinceTune >= this.minNewTradesForTuning;

        // ─── Analysis 1: Exit Reason Breakdown ───
        const exitReasons = this._analyzeExitReasons(closedTrades);

        // If too many stops are hitting, widen the stop
        if (tuningAllowed && exitReasons.stopPct > 60 && closedTrades.length >= this.minTradesForLearning) {
            const oldVal = config.stopLossATRMultiplier;
            const newVal = Math.min(3.0, oldVal * (1 + this.maxAdjustmentPct * 0.5));
            if (newVal !== oldVal) {
                config.stopLossATRMultiplier = parseFloat(newVal.toFixed(2));
                adjustments.push(this._logAdjustment(
                    'stopLossATRMultiplier', oldVal, newVal,
                    `${exitReasons.stopPct.toFixed(0)}% of exits are stops — widening stop multiplier`,
                    'scalping_confluence'
                ));
            }
        }

        // If too many timeouts, tighten take-profit or increase signal quality
        if (tuningAllowed && exitReasons.timeoutPct > 40 && closedTrades.length >= this.minTradesForLearning) {
            const oldVal = config.requiredSignals;
            const newVal = Math.min(3, oldVal + 1);
            if (newVal !== oldVal) {
                config.requiredSignals = newVal;
                adjustments.push(this._logAdjustment(
                    'requiredSignals', oldVal, newVal,
                    `${exitReasons.timeoutPct.toFixed(0)}% of exits are timeouts — requiring more confluence`,
                    'scalping_confluence'
                ));
            }
        }

        // ─── Analysis 2: Win Rate Adaptation ───
        const stats = tradeLogger.getStats();

        // If win rate is strong, allow slightly more aggressive trading
        if (tuningAllowed && stats.winRate > 60 && closedTrades.length >= 50) {
            // Lower RSI threshold slightly (allow more entries)
            const oldRsi = config.rsiOversold;
            const newRsi = Math.max(25, oldRsi - 2);
            if (newRsi !== oldRsi) {
                config.rsiOversold = newRsi;
                adjustments.push(this._logAdjustment(
                    'rsiOversold', oldRsi, newRsi,
                    `Win rate ${stats.winRate.toFixed(1)}% — allowing slightly more aggressive RSI entries`,
                    'scalping_confluence'
                ));
            }

            // Increase max positions slightly
            const oldMax = config.maxPositions;
            const newMax = Math.min(8, oldMax + 1);
            if (newMax !== oldMax) {
                config.maxPositions = newMax;
                adjustments.push(this._logAdjustment(
                    'maxPositions', oldMax, newMax,
                    `Strong performance — increasing max concurrent positions`,
                    'scalping_confluence'
                ));
            }
        }

        // If win rate is poor, tighten entry criteria
        if (tuningAllowed && stats.winRate < 40 && closedTrades.length >= 30) {
            const oldRsi = config.rsiOversold;
            const newRsi = Math.min(40, oldRsi + 2);
            if (newRsi !== oldRsi) {
                config.rsiOversold = newRsi;
                adjustments.push(this._logAdjustment(
                    'rsiOversold', oldRsi, newRsi,
                    `Win rate ${stats.winRate.toFixed(1)}% — tightening RSI entry threshold`,
                    'scalping_confluence'
                ));
            }

            // Reduce max positions
            const oldMax = config.maxPositions;
            const newMax = Math.max(2, oldMax - 1);
            if (newMax !== oldMax) {
                config.maxPositions = newMax;
                adjustments.push(this._logAdjustment(
                    'maxPositions', oldMax, newMax,
                    `Poor performance — reducing concurrent positions`,
                    'scalping_confluence'
                ));
            }

            // Increase cooldown to avoid overtrading
            const oldCool = config.cooldownMs;
            const newCool = Math.min(10000, oldCool + 1000);
            if (newCool !== oldCool) {
                config.cooldownMs = newCool;
                adjustments.push(this._logAdjustment(
                    'cooldownMs', oldCool, newCool,
                    `Increasing cooldown to reduce overtrading`,
                    'scalping_confluence'
                ));
            }
        }

        // ─── Analysis 3: Risk/Reward Adaptation ───
        if (tuningAllowed && stats.avgWin > 0 && stats.avgLoss > 0) {
            const rrRatio = stats.avgWin / stats.avgLoss;

            // If risk/reward is poor, adjust profit targets
            if (rrRatio < 1.0 && closedTrades.length >= 30) {
                const oldMin = config.minProfitTarget;
                const newMin = Math.min(0.15, oldMin * 1.1);
                if (newMin !== oldMin) {
                    config.minProfitTarget = parseFloat(newMin.toFixed(3));
                    adjustments.push(this._logAdjustment(
                        'minProfitTarget', oldMin, newMin,
                        `R:R ratio ${rrRatio.toFixed(2)} < 1.0 — raising minimum profit target`,
                        'scalping_confluence'
                    ));
                }
            }
        }

        // ─── Analysis 4: Max Daily Loss Adaptation ───
        // If daily losses are consistently hitting the cap, it might be too tight
        // or the strategy needs to cool down
        if (tuningAllowed && stats.totalPnl < -config.maxDailyLoss * 0.8 && closedTrades.length >= 20) {
            const oldDailyMax = config.maxDailyTrades;
            const newDailyMax = Math.max(50, oldDailyMax - 25);
            if (newDailyMax !== oldDailyMax) {
                config.maxDailyTrades = newDailyMax;
                adjustments.push(this._logAdjustment(
                    'maxDailyTrades', oldDailyMax, newDailyMax,
                    `Approaching daily loss limit — reducing max daily trades`,
                    'scalping_confluence'
                ));
            }
        }

        // ─── Analysis 5: Bulk Signal Weight Update ───
        // Process any closed trades with signal scores that haven't been fed back yet.
        // This catches trades that closed after a restart (signal scores survived in DB).
        const signalWeightUpdates = this._updateSignalWeightsFromDB();
        if (signalWeightUpdates > 0) {
            adjustments.push(this._logAdjustment(
                'signalWeights', 0, signalWeightUpdates,
                `Bulk signal weight update: ${signalWeightUpdates} new trade outcomes fed back`,
                'signal_ensemble'
            ));
            signalLibrary.saveWeights();
        }

        // ─── Record Cycle ───
        // Mark the tuning evidence consumed (even on a "no change needed" verdict)
        // so the next tuning pass waits for genuinely new trades.
        if (tuningAllowed) this.state.lastTunedTradeId = maxTradeId;
        this.state.totalCycles++;
        this.state.lastCycleAt = new Date().toISOString();
        this.state.tradesAnalyzedTotal = closedTrades.length;
        this.state.currentConfig = { ...config };
        this.state.adjustments = adjustments;

        // Track performance trend (last 50 cycles)
        this.state.performanceTrend.push({
            cycle: this.state.totalCycles,
            timestamp: this.state.lastCycleAt,
            trades: closedTrades.length,
            winRate: stats.winRate,
            totalPnl: stats.totalPnl,
            profitFactor: stats.profitFactor === Infinity ? 999 : stats.profitFactor,
            adjustmentsMade: adjustments.length
        });
        if (this.state.performanceTrend.length > 50) {
            this.state.performanceTrend = this.state.performanceTrend.slice(-50);
        }

        this._saveState();

        if (adjustments.length > 0) {
            console.log(`[SimLearning] Cycle complete: ${adjustments.length} adjustments made`);
        } else {
            console.log(`[SimLearning] Cycle complete: no adjustments needed`);
        }

        return {
            skipped: false,
            cycle: this.state.totalCycles,
            tradesAnalyzed: closedTrades.length,
            adjustments,
            currentConfig: { ...config }
        };
    }

    /**
     * Feed closed trades with stored signal scores back into SignalLibrary.
     * Processes only trades with id > lastProcessedTradeId (incremental).
     * Returns count of trades processed.
     */
    _updateSignalWeightsFromDB() {
        try {
            const newTrades = tradeLogger.getClosedTradesWithSignalScores(this.state.lastProcessedTradeId);
            if (!newTrades.length) return 0;

            for (const trade of newTrades) {
                const pnlPct = (trade.pnl_pct || 0) / 100; // DB stores as %, convert to fraction
                signalLibrary.recordOutcome(trade.signalScores, pnlPct);
                this.state.lastProcessedTradeId = Math.max(this.state.lastProcessedTradeId, trade.id);
            }

            console.log(`[SimLearning] Signal weights updated from ${newTrades.length} DB trade(s) (lastId: ${this.state.lastProcessedTradeId})`);
            return newTrades.length;
        } catch (err) {
            console.warn('[SimLearning] Signal weight DB update failed:', err.message);
            return 0;
        }
    }

    /**
     * Analyze exit reasons to understand what's going wrong
     */
    _analyzeExitReasons(trades) {
        const reasons = { stop: 0, target: 0, timeout: 0, other: 0 };
        for (const t of trades) {
            const reason = (t.exit_reason || '').toLowerCase();
            if (reason.includes('stop')) reasons.stop++;
            else if (reason.includes('target')) reasons.target++;
            else if (reason.includes('timeout') || reason.includes('time')) reasons.timeout++;
            else reasons.other++;
        }
        const total = trades.length || 1;
        return {
            stopPct: (reasons.stop / total) * 100,
            targetPct: (reasons.target / total) * 100,
            timeoutPct: (reasons.timeout / total) * 100,
            otherPct: (reasons.other / total) * 100,
            raw: reasons
        };
    }

    /**
     * Log a parameter adjustment both in-memory and to SQLite
     */
    _logAdjustment(metricName, oldValue, newValue, description, strategy) {
        const adjustment = {
            metricName,
            oldValue,
            newValue,
            description,
            strategy,
            timestamp: new Date().toISOString()
        };

        // Persist to learning_events table
        tradeLogger.logLearningEvent({
            eventType: 'PARAMETER_ADJUSTMENT',
            description,
            strategy,
            metricName,
            oldValue,
            newValue,
            triggerReason: `cycle_${this.state.totalCycles + 1}`
        });

        console.log(`[SimLearning] ADJUST ${metricName}: ${oldValue} → ${newValue} (${description})`);
        return adjustment;
    }

    /**
     * Get the full performance report (for the paper→live gate)
     */
    getPerformanceReport() {
        const closedTrades = tradeLogger.getClosedTrades(30); // Last 30 days
        const equityCurve = tradeLogger.getEquityCurve(30);
        const report = performanceCalculator.calculateReport(closedTrades, equityCurve);
        return report;
    }

    /**
     * Get current learning state (for API)
     */
    getState() {
        return {
            isRunning: !!this.intervalId,
            ...this.state,
            scalpingConfig: { ...scalpingEngine.config }
        };
    }

    /**
     * Force a learning cycle (manual trigger from API)
     */
    async forceCycle() {
        return await this.runLearningCycle();
    }

    /**
     * Learn from a Market Lab simulation result.
     *
     * Applies the same parameter adaptation logic as runLearningCycle() but
     * sourced from backtest aggregate stats rather than live TradeLogger data.
     * Adjustments are scaled to SIM_WEIGHT (40%) so they don't overwrite
     * live experience — simulations are advisory, not authoritative.
     *
     * @param {object} entry - Market Lab entry (from runMarketBacktest)
     *   entry.strategy.id      — strategy id (for log tagging)
     *   entry.metrics.winRate  — 0–1
     *   entry.metrics.maxDrawdown — 0–1
     *   entry.metrics.sharpe
     *   entry.metrics.profitFactor
     *   entry.metrics.trades   — total trade count
     *   entry.metrics.averageTrialPnl — avg pct return per trial
     */
    learnFromSimulation(entry) {
        const SIM_WEIGHT = 0.40; // Sim adjustments are 40% as strong as live
        const MIN_SIM_TRADES = 30;

        const metrics = entry?.metrics;
        const strategyId = entry?.strategy?.id || 'sim_unknown';
        if (!metrics || metrics.trades < MIN_SIM_TRADES) return { skipped: true, reason: 'too few sim trades' };

        const winRate = metrics.winRate * 100; // normalise to 0–100 range for comparison
        const adjustments = [];
        const config = scalpingEngine.config;

        // ─── Win rate adaptation ───
        if (winRate > 60 && metrics.trades >= 50) {
            // Sim shows strong win rate → allow slightly more aggressive entries
            const oldRsi = config.rsiOversold;
            const delta = Math.round(2 * SIM_WEIGHT); // ~1 point nudge
            const newRsi = Math.max(25, oldRsi - delta);
            if (newRsi !== oldRsi) {
                config.rsiOversold = newRsi;
                adjustments.push(this._logAdjustment(
                    'rsiOversold', oldRsi, newRsi,
                    `[SIM:${strategyId}] Win rate ${winRate.toFixed(1)}% — sim nudging RSI threshold`,
                    `sim_${strategyId}`
                ));
            }
        }

        if (winRate < 40 && metrics.trades >= 30) {
            // Sim shows poor win rate → tighten entries
            const oldRsi = config.rsiOversold;
            const delta = Math.round(2 * SIM_WEIGHT);
            const newRsi = Math.min(40, oldRsi + delta);
            if (newRsi !== oldRsi) {
                config.rsiOversold = newRsi;
                adjustments.push(this._logAdjustment(
                    'rsiOversold', oldRsi, newRsi,
                    `[SIM:${strategyId}] Win rate ${winRate.toFixed(1)}% — sim tightening RSI threshold`,
                    `sim_${strategyId}`
                ));
            }
        }

        // ─── Drawdown adaptation ───
        if (metrics.maxDrawdown > 0.15) {
            // Sim drawdown is high → widen stop to reduce premature exits
            const oldVal = config.stopLossATRMultiplier;
            const bump = parseFloat((this.maxAdjustmentPct * 0.5 * SIM_WEIGHT).toFixed(3));
            const newVal = parseFloat(Math.min(3.0, oldVal * (1 + bump)).toFixed(2));
            if (newVal !== oldVal) {
                config.stopLossATRMultiplier = newVal;
                adjustments.push(this._logAdjustment(
                    'stopLossATRMultiplier', oldVal, newVal,
                    `[SIM:${strategyId}] ${(metrics.maxDrawdown * 100).toFixed(1)}% drawdown in sim — widening stop`,
                    `sim_${strategyId}`
                ));
            }
        }

        // ─── Profit factor adaptation ───
        if (metrics.profitFactor > 0 && metrics.profitFactor < 1.0 && metrics.trades >= 40) {
            const oldMin = config.minProfitTarget;
            const bump = parseFloat((oldMin * 0.05 * SIM_WEIGHT).toFixed(4));
            const newMin = parseFloat(Math.min(0.15, oldMin + bump).toFixed(3));
            if (newMin !== oldMin) {
                config.minProfitTarget = newMin;
                adjustments.push(this._logAdjustment(
                    'minProfitTarget', oldMin, newMin,
                    `[SIM:${strategyId}] Profit factor ${metrics.profitFactor.toFixed(2)} < 1.0 — raising sim-advised profit target`,
                    `sim_${strategyId}`
                ));
            }
        }

        if (adjustments.length > 0) {
            console.log(`[SimLearning] Sim-learning from ${strategyId}: ${adjustments.length} advisory adjustment(s)`);
            this.state.currentConfig = { ...config };
            this._saveState();
        }

        return { skipped: false, strategyId, simTrades: metrics.trades, adjustments };
    }

    // ─── Persistence ───

    _loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
                this.state = { ...this.state, ...data };

                // Restore scalping config if we have a saved one
                if (data.currentConfig && scalpingEngine) {
                    const saved = data.currentConfig;
                    const config = scalpingEngine.config;
                    // Only restore tunable parameters (don't overwrite structural config)
                    if (saved.rsiOversold) config.rsiOversold = saved.rsiOversold;
                    if (saved.rsiBuyZone) config.rsiBuyZone = saved.rsiBuyZone;
                    if (saved.requiredSignals) config.requiredSignals = saved.requiredSignals;
                    if (saved.stopLossATRMultiplier) config.stopLossATRMultiplier = saved.stopLossATRMultiplier;
                    if (saved.maxPositions) config.maxPositions = saved.maxPositions;
                    if (saved.cooldownMs) config.cooldownMs = saved.cooldownMs;
                    if (saved.minProfitTarget) config.minProfitTarget = saved.minProfitTarget;
                    if (saved.maxDailyTrades) config.maxDailyTrades = saved.maxDailyTrades;
                    console.log('[SimLearning] Restored learned config from disk');
                }
            }
        } catch (err) {
            console.warn('[SimLearning] Failed to load state:', err.message);
        }
    }

    _saveState() {
        try {
            const dir = path.dirname(this.stateFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.warn('[SimLearning] Failed to save state:', err.message);
        }
    }
}

// Singleton
const simulationLearningEngine = new SimulationLearningEngine();
export default simulationLearningEngine;
