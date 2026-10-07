/**
 * daemons/BaseDaemon.js
 * 
 * Base class for all SOMA Perception Layer Daemons (Sensory Neurons).
 * Daemons observe the environment and emit structured signals into the CNS.
 */

import EventEmitter from 'events';
import messageBroker from '../core/MessageBroker.cjs';

export class BaseDaemon extends EventEmitter {
    constructor(config = {}) {
        super();

        this.name = config.name || this.constructor.name;
        this.active = false;

        // Support both interval and intervalMs
        this.interval = config.intervalMs || config.interval || 1000; 
        this.logger = config.logger || console;

        this._loopHandle = null;
    }

    /**
     * Start daemon
     */
    async start() {
        if (this.active) return;

        this.active = true;

        this.logger.info(`[Daemon] ${this.name} started`);

        if (this.tick) {
            this._startLoop();
        }
    }

    /**
     * Stop daemon
     */
    async stop() {
        this.active = false;

        if (this._loopHandle) {
            clearTimeout(this._loopHandle);
            this._loopHandle = null;
        }

        this.logger.info(`[Daemon] ${this.name} stopped`);
    }

    /**
     * Main daemon loop.
     * Supports two override patterns:
     *   onTick() — preferred (matches most daemon implementations)
     *   tick()   — legacy fallback (HealthDaemon etc.)
     */
    async _startLoop() {
        const run = async () => {
            if (!this.active) return;

            try {
                if (typeof this.onTick === 'function') {
                    await this.onTick();
                } else {
                    await this.tick();
                }
            } catch (err) {
                this.logger.error(`[Daemon Error] ${this.name}`, err);
            }

            this._loopHandle = setTimeout(run, this.interval);
        };

        run();
    }

    /**
     * Legacy tick override point — prefer onTick() in new daemons
     */
    async tick() {
        // override in child classes (or use onTick)
    }

    /**
     * Emit a structured signal into the CNS
     */
    emitSignal(type, payload = {}, priority = 'normal') {
        if (!this.active) return;

        const signal = {
            type,
            source: this.name,
            priority,
            timestamp: Date.now(),
            payload
        };

        try {
            messageBroker.emitSignal(type, payload, priority, this.name);
            // Also emit locally for the manager or tests
            this.emit('signal', signal);
        } catch (err) {
            this.logger.error(`[Daemon Signal Error] ${this.name}`, err);
        }
    }

    /**
     * Helper: sleep utility for daemons
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Health status for diagnostics systems
     */
    health() {
        return {
            name: this.name,
            active: this.active,
            interval: this.interval
        };
    }
}

export default BaseDaemon;
