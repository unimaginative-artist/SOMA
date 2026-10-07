/**
 * DriftDetector — Performance Regime Watchdog
 *
 * Compares rolling 7-day Sharpe against 30-day baseline.
 * When rolling Sharpe drops 20%+ below baseline, enters DRIFT mode:
 *   - Logs a learning event (visible in dashboard)
 *   - Cuts scalpingEngine.config.maxPositions by 50% (defensive mode)
 *   - Broadcasts alert via WebSocket (global.SOMA_WS_CLIENTS)
 *
 * Auto-clears when rolling Sharpe recovers to within 10% of baseline.
 *
 * Heartbeat: every 15 minutes. Requires ≥15 trades in the window.
 */

import tradeLogger from './TradeLogger.js';
import scalpingEngine from './scalpingEngine.js';
import performanceCalculator from './PerformanceCalculator.js';
import fs from 'fs';
import path from 'path';

const STATE_PATH = path.join(process.cwd(), 'data', 'trading', 'drift-state.json');
const HEARTBEAT_MS = 15 * 60 * 1000;
const MIN_TRADES = 15;
const DRIFT_THRESHOLD = 0.20;   // Alert when rolling Sharpe < baseline * (1 - 0.20)
const CLEAR_THRESHOLD = 0.10;   // Clear when rolling Sharpe recovers to baseline * (1 - 0.10)
const BASELINE_WINDOW_DAYS = 30;
const ROLLING_WINDOW_DAYS = 7;

class DriftDetector {
    constructor() {
        this._intervalId = null;
        this.state = {
            driftMode: false,
            driftDetectedAt: null,
            baselineSharpe: null,
            rollingSharpeLast: null,
            driftPct: null,
            originalMaxPositions: null,
            totalChecks: 0,
            driftEpisodes: 0,
            alerts: []
        };
        this._loadState();
    }

    start() {
        if (this._intervalId) return;
        console.log('[DriftDetector] Started — 15min Sharpe watchdog active');
        this._intervalId = setInterval(() => {
            this._check().catch(err => console.warn('[DriftDetector] Check error:', err.message));
        }, HEARTBEAT_MS);
        // First check after 2min — let trades accumulate
        setTimeout(() => this._check().catch(() => {}), 2 * 60 * 1000);
    }

    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    async _check() {
        this.state.totalChecks++;

        const baselineTrades = tradeLogger.getClosedTrades(BASELINE_WINDOW_DAYS);
        const rollingTrades = tradeLogger.getClosedTrades(ROLLING_WINDOW_DAYS);

        if (baselineTrades.length < MIN_TRADES || rollingTrades.length < MIN_TRADES) {
            return; // Not enough data yet
        }

        const baselineReturns = baselineTrades.map(t => (t.pnl_pct || 0) / 100);
        const rollingReturns = rollingTrades.map(t => (t.pnl_pct || 0) / 100);

        const baselineSharpe = performanceCalculator.calculateSharpe(baselineReturns);
        const rollingSharpe = performanceCalculator.calculateSharpe(rollingReturns);

        this.state.baselineSharpe = parseFloat(baselineSharpe.toFixed(4));
        this.state.rollingSharpeLast = parseFloat(rollingSharpe.toFixed(4));

        // Only meaningful when baseline is positive (strategy has been net-positive)
        if (baselineSharpe <= 0) return;

        const dropPct = (baselineSharpe - rollingSharpe) / Math.abs(baselineSharpe);
        this.state.driftPct = parseFloat(dropPct.toFixed(4));

        if (!this.state.driftMode && dropPct >= DRIFT_THRESHOLD) {
            this._enterDriftMode(baselineSharpe, rollingSharpe, dropPct);
        } else if (this.state.driftMode && dropPct < CLEAR_THRESHOLD) {
            this._clearDriftMode(rollingSharpe);
        }

        this._saveState();
    }

    _enterDriftMode(baseline, rolling, dropPct) {
        this.state.driftMode = true;
        this.state.driftDetectedAt = new Date().toISOString();
        this.state.driftEpisodes++;

        // Defensive: halve max positions
        const config = scalpingEngine.config;
        this.state.originalMaxPositions = config.maxPositions;
        config.maxPositions = Math.max(1, Math.floor(config.maxPositions / 2));

        const msg = `DRIFT ALERT: Rolling Sharpe ${rolling.toFixed(2)} vs baseline ${baseline.toFixed(2)} (${(dropPct * 100).toFixed(1)}% drop). Max positions cut: ${this.state.originalMaxPositions} → ${config.maxPositions}`;
        console.warn(`[DriftDetector] ${msg}`);

        this._recordAlert('DRIFT_DETECTED', msg, { baseline, rolling, dropPct });

        tradeLogger.logLearningEvent({
            eventType: 'DRIFT_ALERT',
            description: msg,
            strategy: 'drift_detector',
            metricName: 'sharpeDrop',
            oldValue: baseline,
            newValue: rolling,
            triggerReason: 'sharpe_drift'
        });

        this._broadcast({ type: 'DRIFT_ALERT', severity: 'warning', message: msg, baseline, rolling, dropPct });
    }

    _clearDriftMode(rolling) {
        const config = scalpingEngine.config;
        if (this.state.originalMaxPositions !== null) {
            config.maxPositions = this.state.originalMaxPositions;
        }

        const msg = `Drift cleared — Rolling Sharpe ${rolling.toFixed(2)} recovered. Max positions restored to ${config.maxPositions}`;
        console.log(`[DriftDetector] ${msg}`);

        this._recordAlert('DRIFT_CLEARED', msg, { rolling });

        tradeLogger.logLearningEvent({
            eventType: 'DRIFT_CLEARED',
            description: msg,
            strategy: 'drift_detector',
            metricName: 'sharpeRecovery',
            oldValue: this.state.rollingSharpeLast,
            newValue: rolling,
            triggerReason: 'sharpe_recovery'
        });

        this._broadcast({ type: 'DRIFT_CLEARED', severity: 'info', message: msg, rolling });

        this.state.driftMode = false;
        this.state.driftDetectedAt = null;
        this.state.driftPct = null;
        this.state.originalMaxPositions = null;
    }

    _recordAlert(type, message, data) {
        this.state.alerts.unshift({ type, message, data, timestamp: new Date().toISOString() });
        if (this.state.alerts.length > 20) this.state.alerts = this.state.alerts.slice(0, 20);
    }

    _broadcast(payload) {
        try {
            const clients = global.SOMA_WS_CLIENTS;
            if (!clients?.size) return;
            const msg = JSON.stringify({ event: 'trading:drift', ...payload });
            for (const ws of clients) {
                if (ws.readyState === 1) ws.send(msg);
            }
        } catch { /* non-fatal */ }
    }

    /** Force a check immediately (for API) */
    async forceCheck() {
        await this._check();
        return this.getState();
    }

    getState() {
        return {
            isRunning: !!this._intervalId,
            heartbeatMs: HEARTBEAT_MS,
            thresholds: { drift: DRIFT_THRESHOLD, clear: CLEAR_THRESHOLD },
            windows: { baseline: BASELINE_WINDOW_DAYS, rolling: ROLLING_WINDOW_DAYS },
            ...this.state
        };
    }

    _loadState() {
        try {
            if (fs.existsSync(STATE_PATH)) {
                const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
                this.state = { ...this.state, ...saved };
                // Don't restore driftMode across restarts — could have stale position reduction
                this.state.driftMode = false;
                this.state.originalMaxPositions = null;
            }
        } catch { /* fresh start */ }
    }

    _saveState() {
        try {
            const dir = path.dirname(STATE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.warn('[DriftDetector] State save failed:', err.message);
        }
    }
}

const driftDetector = new DriftDetector();
export default driftDetector;
