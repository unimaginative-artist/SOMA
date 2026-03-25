// ═══════════════════════════════════════════════════════════════════════════
// arbiters/DriveArbiter.cjs — SOMA's intrinsic motivation engine
//
// Ports MAX's DriveSystem as a SOMA arbiter.
// Tension builds when the system is idle → triggers GoalPlannerArbiter.
// Tension releases when goals execute/complete.
//
// Publishes:
//   system.drive.tension    — periodic status { tension, satisfaction, isUrgent }
//   system.drive.urgent     — when tension crosses 70% (once per crossing)
//
// Sends to GoalPlannerArbiter:
//   planning_pulse          — when tension >= planningThreshold (0.40)
//
// Subscribes:
//   system/all              — filters goal_completed, goal_failed, goal_started
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker   = require('../core/MessageBroker.cjs');

class DriveArbiter extends BaseArbiter {
    static role         = 'drive';
    static capabilities = ['intrinsic-motivation', 'tension-tracking', 'autonomous-trigger'];

    constructor(config = {}) {
        super({ name: 'DriveArbiter', ...config });

        // ── Tension state ─────────────────────────────────────────────
        this.tension        = 0.0;
        this.satisfaction   = 0.0;
        this.lastActionAt   = Date.now();
        this.goalsCompleted = 0;
        this.tasksWorked    = 0;

        // ── Config (mirrors MAX DriveSystem defaults) ─────────────────
        this.cfg = {
            tensionBuildRate:       config.tensionBuildRate       ?? 0.04,  // +4% per idle tick
            tensionDecayOnWork:     config.tensionDecayOnWork     ?? 0.15,  // -15% on task step
            tensionDecayOnComplete: config.tensionDecayOnComplete ?? 0.50,  // -50% on goal complete
            satisfactionDecayRate:  config.satisfactionDecayRate  ?? 0.02,
            urgencyThreshold:       config.urgencyThreshold       ?? 0.70,  // 🔴 high alert level
            planningThreshold:      config.planningThreshold      ?? 0.40,  // trigger GoalPlanner
            idleTickIntervalMs:     config.idleTickIntervalMs     ?? 2 * 60 * 1000, // 2 min idle tick
            publishIntervalMs:      config.publishIntervalMs      ?? 5 * 60 * 1000, // 5 min status broadcast
        };

        this._idleTimer    = null;
        this._publishTimer = null;
        this._wasUrgent    = false;
        this._lastPlanningPulseAt = 0;
        this._planningPulseMinGapMs = 5 * 60 * 1000; // at most one pulse per 5 min
    }

    async onInitialize() {
        // ── Subscribe to broadcast goal lifecycle events ──────────────
        messageBroker.subscribe('system/all', (envelope) => {
            const type    = envelope?.type    || envelope?.payload?.type;
            const payload = envelope?.payload || {};

            if (type === 'goal_completed') {
                this._onGoalComplete(payload?.goal?.title || payload?.title || 'goal');
            } else if (type === 'goal_started') {
                this._onTaskExecuted(payload?.goal?.title || payload?.title || 'task');
            } else if (type === 'goal_failed') {
                // Failed goals add slight frustration tension
                this.tension = Math.min(1.0, this.tension + 0.05);
            }
        });

        // ── Own idle tick (no HeartbeatArbiter dependency) ───────────
        this._idleTimer = setInterval(() => this._onIdleTick(), this.cfg.idleTickIntervalMs);

        // ── Periodic status broadcast ─────────────────────────────────
        this._publishTimer = setInterval(() => this._publishStatus(), this.cfg.publishIntervalMs);

        this._publishStatus();
        this.logger.info(`[DriveArbiter] ⚡ Drive system online — tension: ${(this.tension * 100).toFixed(0)}%`);
        return { success: true };
    }

    async onShutdown() {
        if (this._idleTimer)    clearInterval(this._idleTimer);
        if (this._publishTimer) clearInterval(this._publishTimer);
        return await super.onShutdown();
    }

    // ── Tension mechanics ─────────────────────────────────────────────

    _onIdleTick() {
        this.tension      = Math.min(1.0, this.tension + this.cfg.tensionBuildRate);
        this.satisfaction = Math.max(0.0, this.satisfaction - this.cfg.satisfactionDecayRate);

        // Crossed urgency threshold — emit once per crossing
        if (this.tension >= this.cfg.urgencyThreshold && !this._wasUrgent) {
            this._wasUrgent = true;
            this.logger.info(`[DriveArbiter] 🔴 URGENT — tension ${(this.tension * 100).toFixed(0)}%`);
            messageBroker.publish('system.drive.urgent', { tension: this.tension }).catch(() => {});
        } else if (this.tension < this.cfg.urgencyThreshold) {
            this._wasUrgent = false;
        }

        // Crossed planning threshold → wake up GoalPlannerArbiter
        if (this.tension >= this.cfg.planningThreshold) {
            const now = Date.now();
            if (now - this._lastPlanningPulseAt >= this._planningPulseMinGapMs) {
                this._lastPlanningPulseAt = now;
                messageBroker.sendMessage({
                    from:    'DriveArbiter',
                    to:      'GoalPlannerArbiter',
                    type:    'planning_pulse',
                    payload: {
                        tension:     this.tension,
                        isUrgent:    this.tension >= this.cfg.urgencyThreshold,
                        idleMinutes: Math.round((now - this.lastActionAt) / 60000),
                        source:      'drive_arbiter'
                    }
                }).catch(() => {});
            }
        }
    }

    _onTaskExecuted(label) {
        this.tension      = Math.max(0.0, this.tension - this.cfg.tensionDecayOnWork);
        this.lastActionAt = Date.now();
        this.tasksWorked++;
        this._publishStatus();
    }

    _onGoalComplete(label) {
        const prevTension = this.tension;
        this.tension      = Math.max(0.0, this.tension - this.cfg.tensionDecayOnComplete);
        this.satisfaction = Math.min(1.0, this.satisfaction + 0.6);
        this.lastActionAt = Date.now();
        this.goalsCompleted++;
        this.logger.info(
            `[DriveArbiter] 🏆 "${label}" done — ` +
            `tension ${(prevTension * 100).toFixed(0)}% → ${(this.tension * 100).toFixed(0)}% | ` +
            `satisfaction ${(this.satisfaction * 100).toFixed(0)}%`
        );
        this._publishStatus();
    }

    _publishStatus() {
        messageBroker.publish('system.drive.tension', this.getStatus()).catch(() => {});
    }

    // ── Query / command handler ───────────────────────────────────────

    async onHandleMessage(message) {
        const { type, payload } = message;

        switch (type) {
            case 'query_drive_status':
                return { success: true, ...this.getStatus() };

            case 'reset_tension':
                this.tension      = 0.0;
                this.satisfaction = 0.0;
                this._wasUrgent   = false;
                this._publishStatus();
                return { success: true, message: 'Drive reset' };

            case 'set_tension':
                if (typeof payload?.tension === 'number') {
                    this.tension = Math.max(0.0, Math.min(1.0, payload.tension));
                    this._publishStatus();
                    return { success: true, tension: this.tension };
                }
                return { success: false, error: 'payload.tension must be a number 0–1' };

            default:
                return { success: true };
        }
    }

    getStatus() {
        return {
            tension:        parseFloat(this.tension.toFixed(3)),
            satisfaction:   parseFloat(this.satisfaction.toFixed(3)),
            isUrgent:       this.tension >= this.cfg.urgencyThreshold,
            needsWork:      this.tension >= this.cfg.planningThreshold,
            goalsCompleted: this.goalsCompleted,
            tasksWorked:    this.tasksWorked,
            idleMinutes:    Math.round((Date.now() - this.lastActionAt) / 60000)
        };
    }
}

module.exports = DriveArbiter;
