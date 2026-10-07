/**
 * TemporalLoom.js
 * 
 * THE COGNITIVE STATE SYNCHRONIZER
 * 
 * Fixes Asynchronous Drift by implementing:
 * 1. Cognitive Epochs: Tracking versioned system state.
 * 2. Shared Resource Locks: Preventing race conditions between arbiters.
 * 3. Event Ordering: Ensuring plans are committed before reactions trigger.
 */

import { EventEmitter } from 'events';

export class TemporalLoom extends EventEmitter {
    constructor() {
        super();
        this.locks = new Map(); // resourceKey -> { owner, expiresAt }
        this.currentEpoch = 0;
        this.history = []; // Epoch history for rollback
    }

    /**
     * Increment the global system state version
     */
    nextEpoch(reason) {
        this.currentEpoch++;
        const epochData = {
            id: this.currentEpoch,
            timestamp: Date.now(),
            reason
        };
        this.history.push(epochData);
        if (this.history.length > 100) this.history.shift();
        
        this.emit('epoch_transition', epochData);
        return this.currentEpoch;
    }

    /**
     * Acquire a lock on a shared resource (file, memory bank, API)
     */
    async acquireLock(resource, owner, timeoutMs = 5000) {
        const existing = this.locks.get(resource);
        
        if (existing) {
            // Check if expired
            if (Date.now() > existing.expiresAt) {
                this.locks.delete(resource);
            } else {
                // Wait for release (simple poll-based wait for now)
                return new Promise((resolve, reject) => {
                    const start = Date.now();
                    const check = setInterval(() => {
                        if (!this.locks.has(resource)) {
                            clearInterval(check);
                            this.acquireLock(resource, owner, timeoutMs).then(resolve).catch(reject);
                        }
                        if (Date.now() - start > timeoutMs) {
                            clearInterval(check);
                            reject(new Error(`Lock acquisition timeout for ${resource}`));
                        }
                    }, 100);
                });
            }
        }

        const lock = {
            owner,
            expiresAt: Date.now() + timeoutMs
        };
        
        this.locks.set(resource, lock);
        console.log(`[TemporalLoom] 🔒 Resource LOCKED: ${resource} by ${owner}`);
        return true;
    }

    /**
     * Release a lock
     */
    releaseLock(resource, owner) {
        const lock = this.locks.get(resource);
        if (lock && lock.owner === owner) {
            this.locks.delete(resource);
            console.log(`[TemporalLoom] 🔓 Resource RELEASED: ${resource}`);
            return true;
        }
        return false;
    }

    /**
     * Check if a resource is currently locked
     */
    isLocked(resource) {
        const lock = this.locks.get(resource);
        if (!lock) return false;
        if (Date.now() > lock.expiresAt) {
            this.locks.delete(resource);
            return false;
        }
        return true;
    }
}

// Singleton instance for global sync
export const loom = new TemporalLoom();
