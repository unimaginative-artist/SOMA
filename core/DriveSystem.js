// ════════════════════════════════════════════════════════════════════════════
// DriveSystem.js
// ════════════════════════════════════════════════════════════════════════════
// The motivational engine that gives SOMA autonomous drive.
//
// Without this, SOMA has goals but no pressure to act on them:
//   - Doing nothing has zero cost  → stalling is always safe
//   - Completing a goal changes nothing internally → no reward loop
//   - Confidence threshold is too high → waits for certainty that never comes
//
// This system adds:
//   1. TENSION — builds every idle heartbeat cycle, forces action selection
//   2. GOAL URGENCY DECAY — older unacted goals get louder (priority boost)
//   3. EXECUTION REWARD — completing goals reduces tension, writes satisfaction
//   4. LOW ACTION THRESHOLD — act at 0.3 confidence, not 0.9
//
// Tension scale: 0.0 (calm) → 1.0 (urgent, will act on anything)
// ════════════════════════════════════════════════════════════════════════════

export class DriveSystem {
    constructor(config = {}) {
        this.tension       = 0.0;   // Current restlessness / drive pressure
        this.boredom       = 0.0;   // Curiosity drive (increases when idle)
        this.satisfaction  = 0.0;   // Last reward signal (decays over time)
        this.lastActionAt  = Date.now();
        this.goalsCompleted = 0;
        this.tasksWorked    = 0;
        this.ticksAtMaxTension = 0; // Tracks consecutive ticks spent heavily obsessed

        this.config = {
            // How fast tension builds when nothing happens (per idle tick)
            tensionBuildRate:       0.04,  // +4% per idle cycle (~2 min interval → full tension in ~50 min)
            boredomBuildRate:       0.05,  // +5% per idle cycle for Curiosity drive
            boredomDecayOnWander:   0.80,  // Drops 80% after a wander task

            // How much tension drops on different events
            tensionDecayOnWork:     0.15,  // Working a goal step: -15%
            tensionDecayOnComplete: 0.50,  // Completing a goal: -50%

            // Goal urgency: how many priority points per minute of age
            urgencyRatePerMinute:   1.5,   // +1.5 priority per minute unacted
            maxUrgencyBoost:        45,    // Cap at +45 (so a 2hr old goal at pri 50 → pri 95)

            // Action confidence threshold — lowered further as tension rises
            baseActionThreshold:    0.30,  // Act at 30% confidence by default
            minActionThreshold:     0.12,  // At maximum tension, act at 12%

            // Satisfaction half-life: reward signal fades over time
            satisfactionDecayRate:  0.02,  // -2% per idle tick

            ...config
        };
    }

    // ─── Called each heartbeat tick when NO task was executed ───────────────
    onIdleTick() {
        this.tension = Math.min(1.0, this.tension + this.config.tensionBuildRate);
        this.boredom = Math.min(1.0, this.boredom + this.config.boredomBuildRate);
        this.satisfaction = Math.max(0, this.satisfaction - this.config.satisfactionDecayRate);
        
        if (this.tension >= 0.95) {
            this.ticksAtMaxTension++;
        } else {
            this.ticksAtMaxTension = 0;
        }
    }

    // ─── Circuit Breaker Logic ──────────────────────────────────────────────
    isCircuitBreakerTripped() {
        return this.ticksAtMaxTension >= 10;
    }

    resetCircuitBreaker() {
        this.tension = 0.0;
        this.ticksAtMaxTension = 0;
        this.satisfaction = 1.0; // Artificial relief
    }

    // ─── Called when a wander task finishes ────────────────────────────────
    onWanderComplete() {
        this.boredom = Math.max(0, this.boredom - this.config.boredomDecayOnWander);
    }

    // ─── Called when a goal work step was executed ──────────────────────────
    onTaskExecuted(goal = null) {
        this.tension = Math.max(0, this.tension - this.config.tensionDecayOnWork);
        this.ticksAtMaxTension = 0;
        this.lastActionAt = Date.now();
        this.tasksWorked++;
    }

    // ─── Called when a goal fully completes — the reward signal ─────────────
    onGoalComplete(goal = null) {
        this.tension = Math.max(0, this.tension - this.config.tensionDecayOnComplete);
        this.ticksAtMaxTension = 0;
        this.satisfaction = Math.min(1.0, this.satisfaction + 0.6);
        this.lastActionAt = Date.now();
        this.goalsCompleted++;

        const title = goal?.title || 'unknown goal';
        console.log(`[DriveSystem] 🏆 Reward: "${title}" completed. Tension → ${(this.tension * 100).toFixed(0)}% | Satisfaction → ${(this.satisfaction * 100).toFixed(0)}%`);
    }

    // ─── Urgency boost for a goal based on how long it has waited ───────────
    getUrgencyBoost(goal) {
        if (!goal) return 0;
        const ageMs = Date.now() - (goal.createdAt || Date.now());
        const ageMinutes = ageMs / 60000;
        return Math.min(
            this.config.maxUrgencyBoost,
            Math.floor(ageMinutes * this.config.urgencyRatePerMinute)
        );
    }

    // ─── Effective confidence threshold (drops as tension rises) ────────────
    getActionThreshold() {
        const range = this.config.baseActionThreshold - this.config.minActionThreshold;
        return this.config.baseActionThreshold - (this.tension * range);
    }

    // ─── Is this goal's confidence good enough to act on? ───────────────────
    confidenceMet(confidence) {
        return (confidence ?? 1.0) >= this.getActionThreshold();
    }

    // ─── At high tension, act even on speculative / low-confidence tasks ────
    isUrgent() {
        return this.tension >= 0.70;
    }

    // ─── Status snapshot for health endpoints / dashboards ──────────────────
    getStatus() {
        const idleMs = Date.now() - this.lastActionAt;
        return {
            tension:          parseFloat(this.tension.toFixed(3)),
            boredom:          parseFloat(this.boredom.toFixed(3)),
            satisfaction:     parseFloat(this.satisfaction.toFixed(3)),
            actionThreshold:  parseFloat(this.getActionThreshold().toFixed(3)),
            isUrgent:         this.isUrgent(),
            goalsCompleted:   this.goalsCompleted,
            tasksWorked:      this.tasksWorked,
            idleMinutes:      Math.round(idleMs / 60000),
            lastActionAt:     new Date(this.lastActionAt).toISOString()
        };
    }
}
