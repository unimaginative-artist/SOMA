/**
 * StrategyHuntDaemon.js
 *
 * Goal-seeking strategy evolution loop.
 * Rotates through SOMA's 6 strategy profiles using UCB1 (already in MissionControlRuntime)
 * until one consistently produces ≥$200/day.  When proven, surfaces a "Lock Strategy" button.
 *
 * Every 5 min: reads session P&L from running traders → tracks trial progress.
 * Every hour:  records UCB1 outcome → selects next best profile → applies it.
 *
 * The hunt is signal-read-only during a locked period; it keeps monitoring so it
 * can detect if the locked strategy degrades and warn the user.
 */

import fs from 'fs';
import path from 'path';
import BaseDaemon from './BaseDaemon.js';
import missionControlRuntime from '../server/finance/MissionControlRuntime.js';
// No import from autonomousRoutes — avoids circular dep.
// autonomousRoutes.js injects getAggregateStatus via setAggregateStatusFn() after setup.

const HUNT_STATE_PATH = path.join(process.cwd(), 'data', 'trading', 'strategy-hunt-state.json');

// Strategy profile display names for the UI
const PROFILE_LABELS = {
    standard_portfolio: 'Standard Portfolio',
    swarm_architecture: 'Swarm Architecture',
    micro_compounder:   'Micro Compounder',
    micro_scalper:      'Micro Scalper',
    full_aggression:    'Full Aggression',
    yield_harvester:    'Yield Harvester',
};

export class StrategyHuntDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({
            name: 'StrategyHuntDaemon',
            intervalMs: config.intervalMs || 5 * 60 * 1000, // evaluate every 5 min
            ...config,
        });

        this.targetDailyPct         = config.targetDailyPct         || 0.005; // 0.5% of capital per day
        this.trialWindowMs          = config.trialWindowMs           || 60 * 60 * 1000; // 1 hour per trial
        this.consecutiveWinsNeeded  = config.consecutiveWinsNeeded   || 2;
        this.degradeWarningPct      = config.degradeWarningPct       || -0.3; // warn if locked strat drops 30% below target
        // Trial rigor: a 1-hour trial with 2 trades is coin-flip noise. Trials
        // extend until they have a minimum sample (or hit the hard cap), and
        // "hit target" claims require that sample.
        this.minTrialTrades         = config.minTrialTrades          || 12;
        this.maxTrialWindowMs       = config.maxTrialWindowMs        || 6 * 60 * 60 * 1000; // hard cap 6h per trial

        // Injected by autonomousRoutes.js to avoid circular import
        this._getAggregateStatus = () => ({ isRunning: false, instances: [] });
        this._applyProfileToRunning = null; // injected: pushes config into running engines

        this._state = this._loadState();
    }

    setAggregateStatusFn(fn) {
        this._getAggregateStatus = fn;
    }

    setApplyProfileFn(fn) {
        this._applyProfileToRunning = fn;
    }

    get targetDailyPnlUsd() {
        const capital = missionControlRuntime.getStatus?.()?.paperCapital || 1000;
        return parseFloat((capital * this.targetDailyPct).toFixed(2));
    }

    // ─── Main tick ───────────────────────────────────────────────────────────

    async onTick() {
        const agg = this._getAggregateStatus();
        if (!agg.isRunning && this._state.currentTrial) {
            // Engine stopped mid-trial — pause trial clock without recording outcome
            this._saveState();
            return;
        }
        if (!agg.isRunning) return;

        const now           = Date.now();
        const sessionPnl    = this._getSessionPnlUsd(agg);
        const regime        = this._getCurrentRegime(agg);

        // Update running trial metrics
        const trial = this._state.currentTrial;
        if (trial) {
            trial.currentSessionPnl = sessionPnl;
            trial.trialPnlUsd       = sessionPnl - (trial.startSessionPnl || 0);
            trial.lastUpdate        = now;
        }

        // First boot with engine running — start initial trial
        if (!trial) {
            this._startNewTrial(sessionPnl, regime);
            this._saveState();
            return;
        }

        // Rotate when the window expired AND the trial has a meaningful sample,
        // or unconditionally at the hard cap (a strategy that can't produce
        // minTrialTrades in maxTrialWindowMs gets judged on what it did produce).
        const trialAge = now - (trial.startTime || now);
        const tradesDelta = Math.max(0, this._getClosedTradeCount(agg) - (trial.startTradeCount || 0));
        trial.trialTrades = tradesDelta;
        if ((trialAge >= this.trialWindowMs && tradesDelta >= this.minTrialTrades)
            || trialAge >= this.maxTrialWindowMs) {
            await this._evaluateAndRotate(sessionPnl, regime, tradesDelta);
        }

        // If locked, verify the locked strategy hasn't degraded
        if (this._state.lockedStrategy) {
            this._checkLockedDegradation(trial);
        }

        this._saveState();
    }

    // ─── Trial management ────────────────────────────────────────────────────

    async _evaluateAndRotate(currentSessionPnl, regime, tradesDelta = 0) {
        const trial         = this._state.currentTrial;
        const trialPnlUsd   = currentSessionPnl - (trial.startSessionPnl || 0);
        const trialMs       = Date.now() - (trial.startTime || Date.now());
        const trialHours    = Math.max(trialMs / 3600000, 0.01);
        const dailyProj     = (trialPnlUsd / trialHours) * 24;
        const capital       = trial.startCapital || 10000;
        const pnlPct        = trialPnlUsd / capital;
        const adequateSample = tradesDelta >= this.minTrialTrades;

        // Record outcome for UCB1 learning — but not from near-empty trials,
        // which would teach the bandit from coin-flip noise.
        if (tradesDelta >= 3) {
            missionControlRuntime.recordStrategyOutcome(trial.strategyId, pnlPct, regime, 'live');
        }

        // Push to history
        this._state.trialHistory.push({
            strategyId:    trial.strategyId,
            pnlUsd:        parseFloat(trialPnlUsd.toFixed(2)),
            dailyProj:     parseFloat(dailyProj.toFixed(2)),
            pnlPct:        parseFloat((pnlPct * 100).toFixed(3)),
            trades:        tradesDelta,
            adequateSample,
            regime:        regime || null,
            durationMs:    trialMs,
            endTime:       Date.now(),
        });
        if (this._state.trialHistory.length > 100) this._state.trialHistory.shift();

        // "Hit target" claims require a real sample — $0.06 over 2 trades in an
        // hour projects to nonsense and must never mark a strategy proven.
        const hitTarget = adequateSample && dailyProj >= this.targetDailyPnlUsd;

        if (hitTarget) {
            this._state.consecutiveWins++;
            this.logger.info(`[StrategyHunt] ✅ ${trial.strategyId} hit target: $${dailyProj.toFixed(0)}/day projected over ${tradesDelta} trades (${this._state.consecutiveWins}/${this.consecutiveWinsNeeded} wins)`);

            if (this._state.consecutiveWins >= this.consecutiveWinsNeeded) {
                this._markProven(trial.strategyId, dailyProj);
            }
        } else {
            this._state.consecutiveWins = 0;
            const sampleNote = adequateSample ? '' : ` [thin sample: ${tradesDelta}/${this.minTrialTrades} trades]`;
            this.logger.info(`[StrategyHunt] ⏭  ${trial.strategyId} → $${dailyProj.toFixed(0)}/day (target $${this.targetDailyPnlUsd})${sampleNote}`);
        }

        // Stay on locked strategy; still record outcomes but don't rotate
        if (this._state.lockedStrategy) {
            this._startNewTrial(currentSessionPnl, regime, this._state.lockedStrategy);
            return;
        }

        const nextId = missionControlRuntime.selectTradingStrategy(regime);
        this._startNewTrial(currentSessionPnl, regime, nextId);
    }

    _startNewTrial(startSessionPnl, regime, strategyId = null) {
        const id      = strategyId || missionControlRuntime.selectTradingStrategy(regime);
        const capital = missionControlRuntime.getStatus().paperCapital || 10000;

        this._state.currentTrial = {
            strategyId:       id,
            label:            PROFILE_LABELS[id] || id,
            startTime:        Date.now(),
            startSessionPnl:  startSessionPnl,
            currentSessionPnl: startSessionPnl,
            trialPnlUsd:      0,
            trialTrades:      0,
            startTradeCount:  this._getClosedTradeCount(this._getAggregateStatus()),
            startCapital:     capital,
            regime:           regime || null,
            lastUpdate:       Date.now(),
        };

        this._applyStrategy(id);
        this.logger.info(`[StrategyHunt] 🔬 Starting trial: ${id} (target $${this.targetDailyPnlUsd}/day)`);
    }

    _applyStrategy(strategyId) {
        const current = missionControlRuntime.state?.activeStrategy;
        if (current?.strategyId === strategyId && current?.source === 'hunt') return;

        if (missionControlRuntime.state) {
            missionControlRuntime.state.activeStrategy = {
                ...(missionControlRuntime.state.activeStrategy || {}),
                strategyId,
                source:    'hunt',
                label:     PROFILE_LABELS[strategyId] || strategyId,
                appliedAt: new Date().toISOString(),
            };
            missionControlRuntime._saveState();
        }

        // Hot-apply to running engines — without this, rotation only takes
        // effect on the next engine start (the trader snapshots its profile at boot).
        if (this._applyProfileToRunning) {
            try {
                const profile = missionControlRuntime.getActiveExecutionProfile({});
                const applied = this._applyProfileToRunning(profile);
                if (applied > 0) this.logger.info(`[StrategyHunt] ⚡ Hot-applied ${strategyId} to ${applied} running engine(s)`);
            } catch (err) {
                this.logger.warn(`[StrategyHunt] Hot-apply failed: ${err.message}`);
            }
        }
    }

    // ─── Proven / lock ───────────────────────────────────────────────────────

    _markProven(strategyId, avgDailyPnl) {
        const existing = this._state.provenStrategies.find(p => p.strategyId === strategyId);
        if (existing) {
            existing.avgDailyPnl = parseFloat(avgDailyPnl.toFixed(2));
            existing.provenAt    = new Date().toISOString();
        } else {
            this._state.provenStrategies.push({
                strategyId,
                label:       PROFILE_LABELS[strategyId] || strategyId,
                avgDailyPnl: parseFloat(avgDailyPnl.toFixed(2)),
                provenAt:    new Date().toISOString(),
            });
        }
        this.logger.info(`[StrategyHunt] 🏆 PROVEN: ${strategyId} — $${avgDailyPnl.toFixed(0)}/day`);
    }

    lockProvenStrategy(strategyId) {
        const proven = this._state.provenStrategies.find(p => p.strategyId === strategyId);
        if (!proven) return { success: false, error: 'Strategy not yet proven. Let the hunt run more trials.' };

        this._state.lockedStrategy         = strategyId;
        this._state.lockedStrategyLabel    = PROFILE_LABELS[strategyId] || strategyId;
        this._state.lockedAt               = new Date().toISOString();
        this._state.degradeWarning         = false;
        this._state.consecutiveWins        = 0;

        this._applyStrategy(strategyId);
        this._saveState();
        this.logger.info(`[StrategyHunt] 🔒 LOCKED: ${strategyId}`);
        return { success: true, strategyId, label: this._state.lockedStrategyLabel };
    }

    unlockStrategy() {
        const prev = this._state.lockedStrategy;
        this._state.lockedStrategy      = null;
        this._state.lockedStrategyLabel = null;
        this._state.lockedAt            = null;
        this._state.degradeWarning      = false;
        this._saveState();
        this.logger.info(`[StrategyHunt] 🔓 Unlocked. Resuming hunt from: ${prev || 'none'}`);
        return { success: true };
    }

    _checkLockedDegradation(trial) {
        if (!trial || !this._state.lockedStrategy) return;
        const trialMs    = Date.now() - (trial.startTime || Date.now());
        const trialHours = Math.max(trialMs / 3600000, 0.1);
        const dailyProj  = (trial.trialPnlUsd / trialHours) * 24;
        // Warn if projection has fallen more than `degradeWarningPct` below target
        const threshold  = this.targetDailyPnlUsd * (1 + this.degradeWarningPct);
        this._state.degradeWarning = (dailyProj < threshold && trialHours > 0.25);
    }

    // ─── Public state ────────────────────────────────────────────────────────

    getHuntState() {
        const trial    = this._state.currentTrial;
        const now      = Date.now();
        const trialAge = trial ? Math.max(0, now - (trial.startTime || now)) : 0;
        const trialPct = Math.min(1, trialAge / this.trialWindowMs);
        const trialHrs = Math.max(trialAge / 3600000, 0.001);
        const dailyProj = trial && trialAge > 120000
            ? parseFloat(((trial.trialPnlUsd / trialHrs) * 24).toFixed(2))
            : null;

        // UCB1 strategy leaderboard — live (real trade) ledger first; sim
        // reputation shown only as fallback for strategies with no live data.
        const ucbState  = missionControlRuntime._ucb?.strategies || {};
        const leaderboard = Object.entries(ucbState).map(([id, s]) => {
            const lt = s.live?.trials || 0;
            return {
                strategyId:  id,
                label:       PROFILE_LABELS[id] || id,
                trials:      lt || s.trials || 0,
                liveTrials:  lt,
                simTrials:   s.trials || 0,
                avgReward:   parseFloat(((lt >= 1 ? s.live.avgReward : s.avgReward) || 0).toFixed(4)),
                winRate:     lt > 0 ? parseFloat(((s.live.wins / lt) * 100).toFixed(1))
                             : (s.trials > 0 ? parseFloat(((s.wins / s.trials) * 100).toFixed(1)) : null),
                liveData:    lt > 0,
                proven:      this._state.provenStrategies.some(p => p.strategyId === id),
                locked:      this._state.lockedStrategy === id,
            };
        }).sort((a, b) => b.avgReward - a.avgReward);

        return {
            active:               true,
            huntRunning:          !!this._state.currentTrial,
            targetDailyPct:       this.targetDailyPct,
            targetDailyPnlUsd:    this.targetDailyPnlUsd,
            lockedStrategy:       this._state.lockedStrategy,
            lockedStrategyLabel:  this._state.lockedStrategyLabel,
            lockedAt:             this._state.lockedAt,
            degradeWarning:       this._state.degradeWarning || false,
            consecutiveWins:      this._state.consecutiveWins,
            winsNeeded:           this.consecutiveWinsNeeded,
            currentTrial: trial ? {
                ...trial,
                trialAgeMs:       trialAge,
                trialPct,
                dailyProj,
                minsRemaining:    Math.max(0, Math.round((this.trialWindowMs - trialAge) / 60000)),
                onTrack:          dailyProj !== null ? dailyProj >= this.targetDailyPnlUsd : null,
            } : null,
            provenStrategies:  this._state.provenStrategies,
            leaderboard,
            recentTrials:      this._state.trialHistory.slice(-8).reverse(),
            totalTrials:       this._state.trialHistory.length + (trial ? 1 : 0),
        };
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    _getSessionPnlUsd(agg) {
        if (Array.isArray(agg.instances) && agg.instances.length > 0) {
            return agg.instances.reduce((sum, inst) => sum + (inst.stats?.sessionPnL || 0), 0);
        }
        return agg.stats?.sessionPnL || 0;
    }

    /** Total closed trades across running engines (wins + losses per instance). */
    _getClosedTradeCount(agg) {
        const count = (stats) => (Number(stats?.wins) || 0) + (Number(stats?.losses) || 0);
        if (Array.isArray(agg?.instances) && agg.instances.length > 0) {
            return agg.instances.reduce((sum, inst) => sum + count(inst.stats), 0);
        }
        return count(agg?.stats);
    }

    _getCurrentRegime(agg) {
        if (Array.isArray(agg.instances) && agg.instances.length > 0) {
            return agg.instances[0]?.lastSignal?.regime || null;
        }
        return agg.lastSignal?.regime || null;
    }

    // ─── Persistence ─────────────────────────────────────────────────────────

    _loadState() {
        try {
            if (fs.existsSync(HUNT_STATE_PATH)) {
                return JSON.parse(fs.readFileSync(HUNT_STATE_PATH, 'utf8'));
            }
        } catch { /* fresh start */ }
        return {
            currentTrial:       null,
            trialHistory:       [],
            provenStrategies:   [],
            lockedStrategy:     null,
            lockedStrategyLabel: null,
            lockedAt:           null,
            degradeWarning:     false,
            consecutiveWins:    0,
        };
    }

    _saveState() {
        try {
            fs.mkdirSync(path.dirname(HUNT_STATE_PATH), { recursive: true });
            fs.writeFileSync(HUNT_STATE_PATH, JSON.stringify(this._state, null, 2));
        } catch { /* non-fatal */ }
    }
}

// Singleton — starts automatically; idles when engine not running
const strategyHuntDaemon = new StrategyHuntDaemon();
strategyHuntDaemon.start().catch(() => {});
export default strategyHuntDaemon;
