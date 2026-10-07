import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const VALID_STATUS = new Set(['observed', 'proposed', 'queued', 'executing', 'verified', 'failed', 'unknown']);

/** Canonical operational state. Memories may describe; only this store asserts current truth. */
export class SomaStateGateway {
    constructor({ statePath = 'SOMA/canonical-state.json', eventPath = 'SOMA/canonical-state-events.jsonl' } = {}) {
        this.statePath = path.resolve(statePath);
        this.eventPath = path.resolve(eventPath);
        this.state = { schemaVersion: 1, revision: 0, updatedAt: null, records: {} };
        this._writeChain = Promise.resolve();
    }

    async initialize() {
        try {
            const saved = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (saved?.schemaVersion === 1 && saved.records) this.state = saved;
        } catch { /* first boot or invalid legacy state */ }
        return this;
    }

    get(namespace, key) {
        return this.state.records[`${namespace}.${key}`] || null;
    }

    list(namespace) {
        const prefix = `${namespace}.`;
        return Object.fromEntries(Object.entries(this.state.records).filter(([key]) => key.startsWith(prefix)));
    }

    async publish(namespace, key, value, metadata = {}) {
        const recordKey = `${String(namespace).trim()}.${String(key).trim()}`;
        const owner = String(metadata.owner || '').trim();
        if (!owner) throw new TypeError('Canonical state writes require an owner');
        const status = metadata.status || 'observed';
        if (!VALID_STATUS.has(status)) throw new TypeError(`Invalid canonical state status: ${status}`);
        const previous = this.state.records[recordKey];
        if (previous && previous.owner !== owner && metadata.allowOwnerTransfer !== true) {
            const error = new Error(`State ownership conflict for ${recordKey}: ${previous.owner} owns it, not ${owner}`);
            error.code = 'SOMA_STATE_OWNER_CONFLICT';
            throw error;
        }
        if (status === 'verified' && !metadata.evidence) {
            throw new Error(`Verified state requires evidence: ${recordKey}`);
        }

        const record = {
            id: crypto.randomUUID(),
            namespace: String(namespace), key: String(key), value,
            owner,
            source: metadata.source || owner,
            status,
            confidence: Math.max(0, Math.min(1, Number(metadata.confidence ?? (status === 'verified' ? 1 : 0.5)))),
            evidence: metadata.evidence || null,
            scope: metadata.scope || 'operational',
            updatedAt: Date.now(),
            previousId: previous?.id || null
        };
        this.state.records[recordKey] = record;
        this.state.revision++;
        this.state.updatedAt = record.updatedAt;
        await this._persist({ type: 'state_published', recordKey, record });
        return record;
    }

    snapshot({ includeValues = true } = {}) {
        const records = Object.fromEntries(Object.entries(this.state.records).map(([key, record]) => [key,
            includeValues ? { ...record } : { owner: record.owner, status: record.status, confidence: record.confidence, updatedAt: record.updatedAt }
        ]));
        return { schemaVersion: 1, revision: this.state.revision, updatedAt: this.state.updatedAt, records };
    }

    async _persist(event) {
        this._writeChain = this._writeChain.then(async () => {
            await fs.mkdir(path.dirname(this.statePath), { recursive: true });
            const temporary = `${this.statePath}.tmp`;
            await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), 'utf8');
            await fs.rename(temporary, this.statePath);
            await fs.appendFile(this.eventPath, `${JSON.stringify({ at: Date.now(), revision: this.state.revision, ...event })}\n`, 'utf8');
        });
        return this._writeChain;
    }
}

export default SomaStateGateway;
