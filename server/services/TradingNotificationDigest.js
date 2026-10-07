import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class TradingNotificationDigest {
    constructor({ statePath = path.join(process.cwd(), '.soma', 'trading-notification-digest.json'), now = () => Date.now() } = {}) {
        this.statePath = statePath;
        this.now = now;
    }

    _read() {
        try { return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
        catch { return { version: 1, pending: {}, recent: {} }; }
    }

    _write(state) {
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        const temporary = `${this.statePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
        fs.renameSync(temporary, this.statePath);
    }

    keyFor(event = {}) {
        if (event.dedupeKey) return String(event.dedupeKey);
        return crypto.createHash('sha256').update(`${event.eventType || 'event'}|${event.title || ''}|${event.description || ''}`).digest('hex').slice(0, 24);
    }

    isDuplicate(event, cooldownMs = 6 * 60 * 60_000) {
        const at = Number(this._read().recent[this.keyFor(event)] || 0);
        return at > 0 && this.now() - at < cooldownMs;
    }

    markDelivered(event) {
        const state = this._read();
        state.recent[this.keyFor(event)] = this.now();
        const cutoff = this.now() - 7 * 24 * 60 * 60_000;
        state.recent = Object.fromEntries(Object.entries(state.recent).filter(([, at]) => Number(at) >= cutoff));
        this._write(state);
    }

    queue(event = {}) {
        const state = this._read();
        const key = this.keyFor(event);
        const existing = state.pending[key];
        state.pending[key] = {
            key,
            eventType: event.eventType || 'routine',
            title: String(event.title || 'Trading update'),
            description: String(event.description || ''),
            count: (existing?.count || 0) + 1,
            firstAt: existing?.firstAt || new Date(this.now()).toISOString(),
            lastAt: new Date(this.now()).toISOString(),
            data: event.data || existing?.data || null
        };
        this._write(state);
        return state.pending[key];
    }

    peek() {
        return Object.values(this._read().pending).sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
    }

    consume(keys = []) {
        const state = this._read();
        for (const key of keys) {
            if (state.pending[key]) {
                state.recent[key] = this.now();
                delete state.pending[key];
            }
        }
        this._write(state);
    }

    summary() {
        const events = this.peek();
        return {
            pendingEvents: events.length,
            pendingOccurrences: events.reduce((sum, event) => sum + event.count, 0),
            oldestAt: events[0]?.firstAt || null
        };
    }
}

export default TradingNotificationDigest;
