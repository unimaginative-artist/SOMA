import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const clip = (value, max = 24_000) => String(value ?? '').slice(0, max);

function atomicJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, filePath);
}

function compact(value) {
    if (typeof value === 'string') return clip(value);
    if (Array.isArray(value)) return value.slice(0, 32).map(compact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key, compact(item)]));
}

/** Durable, phase-level journal for slow council work. */
export class CouncilRunStore {
    constructor({ statePath = path.resolve('data/large-council-runs.json'), limit = 100 } = {}) {
        this.statePath = statePath;
        this.limit = Math.max(10, Number(limit) || 100);
    }

    _read() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            return parsed?.version === 1 && parsed.runs ? parsed : { version: 1, runs: {} };
        } catch {
            return { version: 1, runs: {} };
        }
    }

    _write(state) {
        const ordered = Object.values(state.runs)
            .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))
            .slice(0, this.limit);
        state.runs = Object.fromEntries(ordered.map(run => [run.id, run]));
        atomicJson(this.statePath, state);
    }

    static questionDigest(question) {
        return createHash('sha256').update(String(question || '').trim()).digest('hex');
    }

    begin({ id = null, question, sessionId = null, models = {}, evidenceDigest = null } = {}) {
        const state = this._read();
        const runId = String(id || randomUUID());
        const digest = CouncilRunStore.questionDigest(question);
        const existing = state.runs[runId];
        if (existing) {
            if (existing.questionDigest !== digest) throw new Error(`Council run ${runId} belongs to a different question`);
            existing.resumeCount = Number(existing.resumeCount || 0) + 1;
            existing.updatedAt = new Date().toISOString();
            existing.status = existing.status === 'completed' ? 'completed' : 'running';
            existing.generation = Number(existing.generation || 0) + 1;
            this._write(state);
            return structuredClone(existing);
        }
        const now = new Date().toISOString();
        const run = {
            id: runId,
            question: clip(question, 12_000),
            questionDigest: digest,
            sessionId: sessionId ? clip(sessionId, 300) : null,
            models: compact(models),
            evidenceDigest,
            status: 'running',
            generation: 1,
            resumeCount: 0,
            phases: {},
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            error: null
        };
        state.runs[runId] = run;
        this._write(state);
        return structuredClone(run);
    }

    get(id) {
        const run = this._read().runs[String(id || '')];
        return run ? structuredClone(run) : null;
    }

    checkpoint(id, phase, payload, { expectedGeneration = null } = {}) {
        const state = this._read();
        const run = state.runs[String(id || '')];
        if (!run) throw new Error(`Unknown council run: ${id}`);
        if (expectedGeneration !== null && Number(run.generation) !== Number(expectedGeneration)) {
            throw new Error(`Stale council generation for ${id}`);
        }
        run.phases[String(phase)] = { completedAt: new Date().toISOString(), payload: compact(payload) };
        run.status = 'running';
        run.generation = Number(run.generation || 0) + 1;
        run.updatedAt = new Date().toISOString();
        run.error = null;
        this._write(state);
        return structuredClone(run);
    }

    complete(id, result) {
        return this._finish(id, 'completed', { result: compact(result), error: null });
    }

    fail(id, error, { retryable = true } = {}) {
        return this._finish(id, retryable ? 'interrupted' : 'failed', {
            error: clip(error?.message || error, 4000)
        });
    }

    _finish(id, status, changes) {
        const state = this._read();
        const run = state.runs[String(id || '')];
        if (!run) return null;
        Object.assign(run, changes, {
            status,
            generation: Number(run.generation || 0) + 1,
            updatedAt: new Date().toISOString(),
            completedAt: status === 'completed' ? new Date().toISOString() : run.completedAt
        });
        this._write(state);
        return structuredClone(run);
    }

    recoverable() {
        return Object.values(this._read().runs)
            .filter(run => ['running', 'interrupted'].includes(run.status))
            .map(run => structuredClone(run));
    }

    summary() {
        const runs = Object.values(this._read().runs);
        return {
            total: runs.length,
            running: runs.filter(run => run.status === 'running').length,
            interrupted: runs.filter(run => run.status === 'interrupted').length,
            completed: runs.filter(run => run.status === 'completed').length,
            failed: runs.filter(run => run.status === 'failed').length,
            latest: runs.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))[0] || null
        };
    }
}

export default CouncilRunStore;
