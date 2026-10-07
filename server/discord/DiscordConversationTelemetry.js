import fs from 'node:fs';
import path from 'node:path';

export class DiscordConversationTelemetry {
    constructor({ statePath = path.join(process.cwd(), 'SOMA', 'discord-conversation-telemetry.json'), limit = 250 } = {}) {
        this.statePath = statePath;
        this.limit = limit;
    }

    _read() {
        try { return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
        catch { return { version: 1, events: [] }; }
    }

    _write(state) {
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        const temporary = `${this.statePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
        fs.renameSync(temporary, this.statePath);
    }

    record(event = {}) {
        const state = this._read();
        state.events.unshift({ at: new Date().toISOString(), ...event });
        state.events = state.events.slice(0, this.limit);
        this._write(state);
        return state.events[0];
    }

    summary() {
        const events = this._read().events || [];
        const completed = events.filter(event => Number.isFinite(event.latencyMs));
        const latencies = completed.map(event => event.latencyMs).sort((a, b) => a - b);
        const lanes = Object.fromEntries([...new Set(events.map(event => event.lane).filter(Boolean))].map(lane => [lane, events.filter(event => event.lane === lane).length]));
        return {
            samples: events.length,
            lanes,
            averageLatencyMs: completed.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / completed.length) : null,
            p95LatencyMs: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null,
            repairs: events.filter(event => event.repaired).length,
            fallbacks: events.filter(event => event.fallbackLane).length,
            deterministicRecoveries: events.filter(event => event.deterministicRecovery).length,
            failures: events.filter(event => event.success === false).length,
            last: events[0] || null
        };
    }
}

export default DiscordConversationTelemetry;
