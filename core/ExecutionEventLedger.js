import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SECRET_KEY = /(?:api[_-]?key|authorization|cookie|credential|password|secret|token)/i;

function safeSessionName(sessionId) {
    const raw = String(sessionId || '').trim();
    if (!raw) throw new TypeError('Execution session id is required');
    const prefix = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 72) || 'session';
    const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
    return `${prefix}-${digest}`;
}

export function canonicalExecutionValue(value) {
    const seen = new WeakSet();
    const normalize = current => {
        if (current === undefined) return { __type: 'undefined' };
        if (typeof current === 'bigint') return { __type: 'bigint', value: String(current) };
        if (typeof current === 'number' && !Number.isFinite(current)) return { __type: 'number', value: String(current) };
        if (!current || typeof current !== 'object') return current;
        if (seen.has(current)) return { __type: 'circular' };
        seen.add(current);
        if (Array.isArray(current)) return current.map(normalize);
        return Object.keys(current).sort().reduce((result, key) => {
            result[key] = normalize(current[key]);
            return result;
        }, {});
    };
    return JSON.stringify(normalize(value));
}

export function executionValueHash(value) {
    return crypto.createHash('sha256').update(canonicalExecutionValue(value)).digest('hex');
}

export function sanitizeExecutionValue(value, options = {}, state = { depth: 0, seen: new WeakSet() }) {
    const maxDepth = Number(options.maxDepth || 10);
    const maxStringLength = Number(options.maxStringLength || 32_000);
    const maxArrayLength = Number(options.maxArrayLength || 250);
    const maxObjectKeys = Number(options.maxObjectKeys || 250);
    if (value === undefined) return null;
    if (typeof value === 'string') return value.length > maxStringLength
        ? `${value.slice(0, maxStringLength)}\n...[truncated ${value.length - maxStringLength} chars]`
        : value;
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (state.depth >= maxDepth) return '[Max depth]';
    if (state.seen.has(value)) return '[Circular]';
    state.seen.add(value);
    const childState = { depth: state.depth + 1, seen: state.seen };
    if (Array.isArray(value)) {
        const result = value.slice(0, maxArrayLength).map(item => sanitizeExecutionValue(item, options, childState));
        if (value.length > maxArrayLength) result.push(`[Truncated ${value.length - maxArrayLength} items]`);
        return result;
    }
    const result = {};
    for (const key of Object.keys(value).slice(0, maxObjectKeys)) {
        result[key] = SECRET_KEY.test(key)
            ? '[REDACTED]'
            : sanitizeExecutionValue(value[key], options, childState);
    }
    if (Object.keys(value).length > maxObjectKeys) result.__truncatedKeys = Object.keys(value).length - maxObjectKeys;
    return result;
}

/**
 * Append-only, model-provider-neutral execution log. It observes decisions and
 * effects but never participates in cognitive selection or prompt assembly.
 */
export class ExecutionEventLedger {
    constructor({ root = process.cwd(), directory = null, now = () => Date.now(), sanitize = {} } = {}) {
        this.root = path.resolve(root);
        this.directory = path.resolve(directory || path.join(this.root, 'data', 'agent-execution', 'sessions'));
        this.now = now;
        this.sanitizeOptions = sanitize;
        this.sequences = new Map();
        this.writeQueues = new Map();
        this.started = new Set();
        this.startPromises = new Map();
    }

    sessionPath(sessionId) {
        return path.join(this.directory, `${safeSessionName(sessionId)}.jsonl`);
    }

    async startSession(sessionId, details = {}) {
        const key = String(sessionId);
        if (this.startPromises.has(key)) return this.startPromises.get(key);
        if (this.started.has(key)) return key;
        const starting = (async () => {
            this.started.add(key);
            try {
                await fs.access(this.sessionPath(key));
            } catch {
                await this.append(key, 'session/start', details, { force: true });
            }
            return key;
        })();
        this.startPromises.set(key, starting);
        try { return await starting; }
        catch (error) {
            this.started.delete(key);
            throw error;
        } finally {
            this.startPromises.delete(key);
        }
    }

    async append(sessionId, type, data = {}, options = {}) {
        const key = String(sessionId);
        if (!options.force && (this.startPromises.has(key) || !this.started.has(key))) await this.startSession(key);
        const sequence = (this.sequences.get(key) || 0) + 1;
        this.sequences.set(key, sequence);
        const timestamp = this.now();
        const event = Object.freeze({
            id: crypto.randomUUID(),
            sessionId: key,
            sequence,
            type: String(type || 'event'),
            timestamp,
            isoTime: new Date(timestamp).toISOString(),
            data: sanitizeExecutionValue(data, this.sanitizeOptions)
        });
        const filePath = this.sessionPath(key);
        const previous = this.writeQueues.get(key) || Promise.resolve();
        const write = previous.then(async () => {
            await fs.mkdir(this.directory, { recursive: true });
            await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
        });
        this.writeQueues.set(key, write.catch(() => {}));
        await write;
        return event;
    }

    async endSession(sessionId, details = {}) {
        const key = String(sessionId);
        if (!this.started.has(key)) await this.startSession(key);
        const event = await this.append(key, 'session/end', details);
        this.started.delete(key);
        this.sequences.delete(key);
        this.writeQueues.delete(key);
        return event;
    }

    async readSession(sessionId) {
        try {
            const raw = await fs.readFile(this.sessionPath(sessionId), 'utf8');
            return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    }

    async listSessions({ limit = 100 } = {}) {
        try {
            const entries = await fs.readdir(this.directory, { withFileTypes: true });
            const files = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl')).map(async entry => {
                const filePath = path.join(this.directory, entry.name);
                const stats = await fs.stat(filePath);
                let header = null;
                let handle;
                try {
                    handle = await fs.open(filePath, 'r');
                    const buffer = Buffer.alloc(Math.min(16_384, Math.max(1, stats.size)));
                    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
                    const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/, 1)[0];
                    if (firstLine) header = JSON.parse(firstLine);
                } catch { /* a damaged session remains discoverable by filename */ }
                finally { await handle?.close().catch(() => {}); }
                return {
                    sessionId: header?.sessionId || null,
                    kind: header?.data?.kind || null,
                    actor: header?.data?.actor || null,
                    profileId: header?.data?.profileId || null,
                    goalId: header?.data?.goalId || null,
                    file: entry.name,
                    path: filePath,
                    updatedAt: stats.mtimeMs,
                    size: stats.size
                };
            }));
            return files.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Number(limit) || 100));
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    }
}

export default ExecutionEventLedger;
