// ═══════════════════════════════════════════════════════════════════════════
// ComputeScheduler.js — the CPU scheduler for SOMA's mind.
//
// Every model call (DeepSeek today, any provider tomorrow) routes through here.
// It arbitrates a scarce shared resource — provider concurrency / rate limit —
// between foreground human work and background autonomous cognition, the way an
// OS scheduler arbitrates the CPU.
//
// The problem it fixes: autonomous swarms (discovery, distillation, curiosity)
// fire 15+ concurrent calls and rate-limit the account, so the user's chat call
// gets stuck behind them (measured: same greeting 7s idle vs 55s under load).
//
// Guarantees:
//   • HUMAN calls never queue and always have reserved headroom — background can
//     never consume the last `humanReserved` slots.
//   • Background is capped at (globalMax - humanReserved) and drains in priority
//     order: GOAL-driven work before IDLE curiosity.
//   • Bounded everywhere: nothing waits forever; the queue drains on every release.
// ═══════════════════════════════════════════════════════════════════════════

const CLASSES = ['human', 'goal', 'idle'];

function normalizePriority(p) {
    const s = String(p || '').toLowerCase();
    if (s === 'human' || s === 'foreground' || s === 'user' || s === 'chat') return 'human';
    if (s === 'goal' || s === 'goal_driven' || s === 'directed') return 'goal';
    return 'idle'; // 'background', 'idle', anything else
}

export class ComputeScheduler {
    constructor({ globalMax, humanReserved } = {}) {
        this.globalMax = Math.max(2, Number(process.env.SOMA_COMPUTE_MAX || globalMax || 6));
        // Slots that background work may NEVER occupy — always free for humans.
        this.humanReserved = Math.min(this.globalMax - 1,
            Math.max(1, Number(process.env.SOMA_COMPUTE_HUMAN_RESERVED || humanReserved || 2)));

        this._inFlight = { human: 0, goal: 0, idle: 0 };
        this._queues = { goal: [], idle: [] }; // human never queues
        this._stats = {
            scheduled: { human: 0, goal: 0, idle: 0 },
            completed: { human: 0, goal: 0, idle: 0 },
            peakInFlight: 0,
            peakQueued: 0,
            totalWaitMs: { goal: 0, idle: 0 },
        };
    }

    get totalInFlight() { return this._inFlight.human + this._inFlight.goal + this._inFlight.idle; }
    get backgroundInFlight() { return this._inFlight.goal + this._inFlight.idle; }
    get backgroundLimit() { return Math.max(0, this.globalMax - this.humanReserved); }

    _canAdmitBackground() {
        return this.backgroundInFlight < this.backgroundLimit && this.totalInFlight < this.globalMax;
    }

    /**
     * Run `fn` under scheduling for the given priority class.
     * @param {'human'|'goal'|'idle'|'background'} priority
     * @param {() => Promise<any>} fn
     */
    async schedule(priority, fn) {
        const cls = normalizePriority(priority);
        this._stats.scheduled[cls]++;
        const waitStart = Date.now();
        await this._acquire(cls);
        if (cls !== 'human') this._stats.totalWaitMs[cls] += Date.now() - waitStart;
        this._stats.peakInFlight = Math.max(this._stats.peakInFlight, this.totalInFlight);
        try {
            return await fn();
        } finally {
            this._release(cls);
            this._stats.completed[cls]++;
        }
    }

    _acquire(cls) {
        // Humans never wait — they're the reason headroom exists. Counted so
        // background yields, but admitted immediately.
        if (cls === 'human') { this._inFlight.human++; return Promise.resolve(); }
        if (this._canAdmitBackground()) { this._inFlight[cls]++; return Promise.resolve(); }
        return new Promise(resolve => {
            this._queues[cls].push(resolve);
            this._stats.peakQueued = Math.max(this._stats.peakQueued, this._queues.goal.length + this._queues.idle.length);
        });
    }

    _release(cls) {
        this._inFlight[cls] = Math.max(0, this._inFlight[cls] - 1);
        // Drain background waiters in priority order (goal before idle). Increment
        // in-flight at admit time (here) so counting stays race-free.
        for (const q of ['goal', 'idle']) {
            while (this._queues[q].length && this._canAdmitBackground()) {
                this._inFlight[q]++;
                const resolve = this._queues[q].shift();
                resolve();
            }
        }
    }

    getStatus() {
        return {
            globalMax: this.globalMax,
            humanReserved: this.humanReserved,
            backgroundLimit: this.backgroundLimit,
            inFlight: { ...this._inFlight },
            totalInFlight: this.totalInFlight,
            queued: { goal: this._queues.goal.length, idle: this._queues.idle.length },
            stats: {
                scheduled: { ...this._stats.scheduled },
                completed: { ...this._stats.completed },
                peakInFlight: this._stats.peakInFlight,
                peakQueued: this._stats.peakQueued,
                avgWaitMs: {
                    goal: this._stats.completed.goal ? Math.round(this._stats.totalWaitMs.goal / this._stats.completed.goal) : 0,
                    idle: this._stats.completed.idle ? Math.round(this._stats.totalWaitMs.idle / this._stats.completed.idle) : 0,
                },
            },
        };
    }
}

const computeScheduler = new ComputeScheduler();
export default computeScheduler;
