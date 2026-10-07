// core/SystemSupervisor.js
// Implements the Supervisor Pattern (Erlang-style) for SOMA components.
// Ensures critical children (Kevin, LocalModel, etc.) are immortal.

import { EventEmitter } from 'events';
import { logger } from './Logger.js';

export class SystemSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'SystemSupervisor';
    this.children = new Map(); // { name: { manager, restartCount, maxRestarts, status } }
    this.strategies = {
      ONE_FOR_ONE: 'one_for_one', // Restart only the failed child
      ALL_FOR_ONE: 'all_for_one'  // Restart all if one fails (not used yet)
    };
    this.config = {
      strategy: options.strategy || 'one_for_one',
      maxRestarts: options.maxRestarts || 5,
      windowMs: options.windowMs || 60000 // 5 restarts in 1 minute = permanent fail
    };
  }

  /**
   * Register a child manager to be supervised.
   * Manager must have: start(), stop(), and emit 'exit'/'error'/'status'.
   */
  register(name, manager, opts = {}) {
    if (this.children.has(name)) {
      logger.warn(`[Supervisor] Child ${name} already registered.`);
      return;
    }

    const child = {
      name,
      manager,
      restartCount: 0,
      lastRestart: 0,
      status: 'stopped',
      options: { ...this.config, ...opts }
    };

    // Hook into manager events to detect failures
    // Assuming managers emit 'status' updates or we wrap their process
    if (manager.on) {
        manager.on('status', (status) => {
            child.status = status;
            this.emit('child_status', { name, status });
        });
        
        manager.on('error', (err) => {
            logger.error(`[Supervisor] Error in child ${name}: ${err}`);
            this._handleFailure(name, err);
        });

        // If manager exposes the raw process, hook exit
        // (KEVINManager exposes .process after start)
    }

    this.children.set(name, child);
    logger.info(`[Supervisor] Registered ${name} for supervision.`);
  }

  async start(name) {
    const child = this.children.get(name);
    if (!child) return;

    try {
        await child.manager.start();
        child.status = 'running';
        
        // Hook process exit if available now
        if (child.manager.process) {
            child.manager.process.on('exit', (code) => {
                if (child.status === 'running' && code !== 0 && code !== null) {
                    this._handleFailure(name, `Process exited with code ${code}`);
                }
            });
        }
    } catch (e) {
        this._handleFailure(name, e.message);
    }
  }

  async stop(name) {
    const child = this.children.get(name);
    if (!child) return;
    
    // Mark as intentionally stopped so we don't restart it
    child.status = 'stopping';
    await child.manager.stop();
    child.status = 'stopped';
  }

  async _handleFailure(name, reason) {
    const child = this.children.get(name);
    if (!child || child.status === 'stopping' || child.status === 'stopped') return;

    logger.warn(`[Supervisor] 🚨 Child ${name} failed: ${reason}. Evaluating restart strategy...`);

    const now = Date.now();
    // Reset counter if window passed
    if (now - child.lastRestart > child.options.windowMs) {
        child.restartCount = 0;
    }

    if (child.restartCount < child.options.maxRestarts) {
        child.restartCount++;
        child.lastRestart = now;
        logger.info(`[Supervisor] ♻️ Restarting ${name} (Attempt ${child.restartCount}/${child.options.maxRestarts})...`);
        
        // Wait a beat before restart to prevent tight loops
        setTimeout(async () => {
            try {
                // Ensure it's dead
                try { await child.manager.stop(); } catch (e) {} 
                // Bring it back
                await this.start(name);
                logger.success(`[Supervisor] ${name} successfully resurrected.`);
            } catch (e) {
                logger.error(`[Supervisor] Resurrection failed for ${name}: ${e.message}`);
            }
        }, 1000);
    } else {
        logger.error(`[Supervisor] 💀 Child ${name} exceeded max restarts. Giving up.`);
        child.status = 'crashed';
        this.emit('child_crashed', { name, reason });
    }
  }

  getStatus() {
      const status = {};
      for (const [name, child] of this.children) {
          status[name] = {
              status: child.status,
              restarts: child.restartCount
          };
      }
      return status;
  }
}
