/**
 * core/DaemonManager.js
 *
 * Supervises all SOMA Perception Layer Daemons.
 * Responsibilities:
 * - Register, start, stop, restart daemons
 * - Health reporting for diagnostics
 * - Watchdog loop: auto-restarts crashed daemons every 15s
 *
 * Daemons are the sensory neurons of SOMA. A crashed daemon = silent blindness.
 * The watchdog ensures perception is never silently lost.
 */

import EventEmitter from 'events';

const WATCHDOG_INTERVAL_MS = 15_000;

export class DaemonManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.daemons          = new Map();   // name → daemon instance
        this._shouldBeRunning = new Set();   // names that should be active (watchdog target)
        this._watchdogHandle  = null;
        this._restartCounts   = new Map();   // name → count (circuit breaker)
        this.logger           = config.logger || console;
    }

    // ─── Register ────────────────────────────────────────────────────────────
    register(daemon) {
        if (!daemon || !daemon.name) {
            throw new Error('Invalid daemon registration');
        }
        if (this.daemons.has(daemon.name)) {
            this.logger.warn(`[DaemonManager] daemon already registered: ${daemon.name}`);
            return;
        }
        this.daemons.set(daemon.name, daemon);
        this._restartCounts.set(daemon.name, 0);
        this.logger.info(`[DaemonManager] registered ${daemon.name}`);
    }

    // ─── Start single ─────────────────────────────────────────────────────────
    async start(name) {
        const daemon = this.daemons.get(name);
        if (!daemon) throw new Error(`Daemon not found: ${name}`);

        await daemon.start();
        this._shouldBeRunning.add(name);
        this._restartCounts.set(name, 0); // reset crash counter on manual start
        this.emit('daemon.started', { name });
        this.logger.info(`[DaemonManager] started ${name}`);
    }

    // ─── Stop single ──────────────────────────────────────────────────────────
    async stop(name) {
        const daemon = this.daemons.get(name);
        if (!daemon) return;

        await daemon.stop();
        this._shouldBeRunning.delete(name); // remove from watchdog
        this.emit('daemon.stopped', { name });
        this.logger.info(`[DaemonManager] stopped ${name}`);
    }

    // ─── Start all + launch watchdog ─────────────────────────────────────────
    async startAll() {
        this.logger.info('[DaemonManager] starting all daemons...');
        for (const daemon of this.daemons.values()) {
            try {
                await daemon.start();
                this._shouldBeRunning.add(daemon.name);
            } catch (err) {
                this.logger.error(`[DaemonManager] failed to start ${daemon.name}: ${err.message}`);
            }
        }
        this.emit('daemon.all.started');
        this._startWatchdog();
        this.logger.info(`[DaemonManager] ✅ ${this._shouldBeRunning.size} daemon(s) running, watchdog active`);
    }

    // ─── Stop all + kill watchdog ─────────────────────────────────────────────
    async stopAll() {
        this._stopWatchdog();
        this.logger.info('[DaemonManager] stopping all daemons...');
        for (const daemon of this.daemons.values()) {
            try {
                await daemon.stop();
                this._shouldBeRunning.delete(daemon.name);
            } catch (err) {
                this.logger.error(`[DaemonManager] failed to stop ${daemon.name}: ${err.message}`);
            }
        }
        this.emit('daemon.all.stopped');
    }

    // ─── Restart single ───────────────────────────────────────────────────────
    async restart(name) {
        await this.stop(name);
        await this.start(name);
        this.emit('daemon.restarted', { name, reason: 'manual' });
    }

    // ─── Watchdog loop ────────────────────────────────────────────────────────
    // Detects crashed daemons (active === false but in _shouldBeRunning)
    // and restarts them. Circuit breaker: after 5 crashes, backs off for 10 min.
    _startWatchdog() {
        if (this._watchdogHandle) return;
        this._watchdogHandle = setInterval(async () => {
            for (const name of this._shouldBeRunning) {
                const daemon = this.daemons.get(name);
                if (!daemon || daemon.active) continue;

                const crashes = this._restartCounts.get(name) || 0;

                // Circuit breaker: >5 restarts → suppress for a while, then reset
                if (crashes > 5) {
                    if (crashes === 6) {
                        this.logger.error(`[DaemonManager] ⛔ ${name} crashed 5+ times — backing off 10 min`);
                        this._restartCounts.set(name, 7); // park at 7 to avoid repeated logging
                        setTimeout(() => {
                            this._restartCounts.set(name, 0); // reset after backoff
                        }, 10 * 60 * 1000);
                    }
                    continue;
                }

                this.logger.warn(`[DaemonManager] ⚠️  ${name} crashed (restart #${crashes + 1}) — auto-restarting`);
                this._restartCounts.set(name, crashes + 1);

                try {
                    await daemon.start();
                    this.emit('daemon.restarted', { name, reason: 'crash', attempt: crashes + 1 });
                    this.logger.info(`[DaemonManager] ✅ ${name} restarted successfully`);
                } catch (err) {
                    this.logger.error(`[DaemonManager] Failed to restart ${name}: ${err.message}`);
                }
            }
        }, WATCHDOG_INTERVAL_MS);
    }

    _stopWatchdog() {
        if (this._watchdogHandle) {
            clearInterval(this._watchdogHandle);
            this._watchdogHandle = null;
        }
    }

    // ─── Health report ────────────────────────────────────────────────────────
    health() {
        return [...this.daemons.values()].map(daemon => {
            const base = typeof daemon.health === 'function'
                ? daemon.health()
                : { name: daemon.name, active: daemon.active };
            return {
                ...base,
                shouldBeRunning: this._shouldBeRunning.has(daemon.name),
                restartCount:    this._restartCounts.get(daemon.name) || 0
            };
        });
    }

    list() {
        return [...this.daemons.keys()];
    }
}

export default DaemonManager;
