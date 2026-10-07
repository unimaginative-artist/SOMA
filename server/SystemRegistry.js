/**
 * server/SystemRegistry.js
 *
 * Tracks the load/ready state of every SOMA arbiter/system.
 * Lets the UI (and /api/ready endpoint) show what's loaded vs still initializing.
 *
 * Usage:
 *   import { registry } from '../server/SystemRegistry.js';
 *   registry.markLoading('QuadBrain');
 *   registry.markReady('QuadBrain');
 *   registry.markFailed('QuadBrain', new Error('...'));
 */

export class SystemRegistry {
    constructor() {
        this._state = new Map();
    }

    markLoading(name) {
        this._state.set(name, { status: 'loading', ts: Date.now() });
    }

    markReady(name) {
        this._state.set(name, { status: 'ready', ts: Date.now() });
    }

    markFailed(name, err) {
        this._state.set(name, {
            status: 'failed',
            error: err?.message ?? String(err),
            ts: Date.now()
        });
    }

    isReady(name) {
        return this._state.get(name)?.status === 'ready';
    }

    getAll() {
        return Object.fromEntries(this._state);
    }

    get summary() {
        let ready = 0, loading = 0, failed = 0;
        for (const v of this._state.values()) {
            if (v.status === 'ready') ready++;
            else if (v.status === 'loading') loading++;
            else if (v.status === 'failed') failed++;
        }
        return { total: this._state.size, ready, loading, failed };
    }

    get allReady() {
        if (this._state.size === 0) return false;
        return [...this._state.values()].every(v => v.status === 'ready');
    }
}

// Singleton — import this from anywhere in SOMA
export const registry = new SystemRegistry();

export default registry;
