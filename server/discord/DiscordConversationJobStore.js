import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class DiscordConversationJobStore {
    constructor({
        statePath = path.join(process.cwd(), 'SOMA', 'discord-conversation-jobs.json'),
        leaseMs = 90_000,
        maxAttempts = 3,
        maxPending = 50,
        jobTtlMs = 15 * 60_000,
        ownerId = `${process.pid}:${crypto.randomUUID()}`
    } = {}) {
        this.statePath = statePath;
        this.leaseMs = leaseMs;
        this.maxAttempts = maxAttempts;
        this.maxPending = Math.max(1, Number(maxPending) || 50);
        this.jobTtlMs = Math.max(60_000, Number(jobTtlMs) || 15 * 60_000);
        this.ownerId = ownerId;
    }

    _read() {
        try { return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
        catch { return { version: 1, jobs: {} }; }
    }

    _write(state) {
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        const temporary = `${this.statePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
        fs.renameSync(temporary, this.statePath);
    }

    receive(job) {
        const state = this._read();
        const id = String(job.id || '').trim();
        if (!id) throw new TypeError('Discord message id is required');
        if (!state.jobs[id]) {
            const active = Object.values(state.jobs).filter(item => ['received', 'processing', 'delivery_intent', 'retryable'].includes(item.status));
            if (active.length >= this.maxPending) throw new Error(`Discord conversation queue is full (${this.maxPending})`);
            const receivedAt = new Date().toISOString();
            state.jobs[id] = {
                ...job, id, status: 'received', attempts: 0, receivedAt,
                expiresAt: new Date(Date.now() + this.jobTtlMs).toISOString(),
                progress: null
            };
            this._write(state);
        }
        return state.jobs[id];
    }

    claim(id, now = Date.now()) {
        const state = this._read();
        const job = state.jobs[id];
        if (!job || job.status === 'posted' || job.status === 'completed') return null;
        const heldByCurrentProcess = job.leaseOwner === this.ownerId;
        if (job.status === 'processing' && heldByCurrentProcess && Date.parse(job.leaseUntil || '') > now) return null;
        if ((job.attempts || 0) >= this.maxAttempts) return null;
        Object.assign(job, {
            status: 'processing', leaseOwner: this.ownerId,
            leaseUntil: new Date(now + this.leaseMs).toISOString(),
            attempts: (job.attempts || 0) + 1, startedAt: new Date(now).toISOString()
        });
        this._write(state);
        return job;
    }

    markDeliveryIntent(id, details = {}) { return this._update(id, { ...details, status: 'delivery_intent', deliveryIntentAt: new Date().toISOString() }); }
    heartbeat(id, now = Date.now()) {
        const state = this._read();
        const job = state.jobs[id];
        if (!job || job.leaseOwner !== this.ownerId || job.status !== 'processing') return null;
        job.leaseUntil = new Date(now + this.leaseMs).toISOString();
        job.lastHeartbeatAt = new Date(now).toISOString();
        this._write(state);
        return job;
    }
    progress(id, update = {}) {
        const state = this._read();
        const job = state.jobs[id];
        if (!job || ['posted', 'failed', 'cancelled', 'expired'].includes(job.status)) return null;
        job.progress = { ...(job.progress || {}), ...update, at: new Date().toISOString() };
        job.progressHistory = [...(job.progressHistory || []), job.progress].slice(-24);
        if (job.leaseOwner === this.ownerId) job.leaseUntil = new Date(Date.now() + this.leaseMs).toISOString();
        this._write(state);
        return job;
    }
    cancel(id, reason = 'operator_requested') {
        return this._update(id, {
            status: 'cancelled', cancelReason: String(reason), cancelledAt: new Date().toISOString(), leaseUntil: null
        });
    }
    markDeliveryProgress(id, deliveredMessageId) {
        const state = this._read();
        const job = state.jobs[id];
        if (!job) return null;
        const deliveredMessageIds = [...new Set([...(job.deliveredMessageIds || []), deliveredMessageId].filter(Boolean))];
        Object.assign(job, { status: 'delivery_intent', deliveredMessageIds, lastDeliveryAt: new Date().toISOString() });
        this._write(state);
        return job;
    }
    complete(id, details = {}) { return this._update(id, { ...details, status: 'posted', postedAt: new Date().toISOString(), leaseUntil: null }); }
    fail(id, error, { retryable = true } = {}) { return this._update(id, { status: retryable ? 'retryable' : 'failed', error: String(error || 'unknown'), failedAt: new Date().toISOString(), leaseUntil: null }); }

    _update(id, changes) {
        const state = this._read();
        if (!state.jobs[id]) return null;
        Object.assign(state.jobs[id], changes);
        const ordered = Object.values(state.jobs).sort((a, b) => Date.parse(b.receivedAt || 0) - Date.parse(a.receivedAt || 0)).slice(0, 500);
        state.jobs = Object.fromEntries(ordered.map(job => [job.id, job]));
        this._write(state);
        return state.jobs[id];
    }

    pending() {
        const state = this._read();
        let changed = false;
        for (const job of Object.values(state.jobs)) {
            if (['received', 'processing', 'retryable'].includes(job.status)
                && Date.parse(job.expiresAt || '') <= Date.now()) {
                job.status = 'expired';
                job.expiredAt = new Date().toISOString();
                job.leaseUntil = null;
                changed = true;
            }
        }
        if (changed) this._write(state);
        return Object.values(state.jobs).filter(job =>
            ['received', 'processing', 'delivery_intent', 'retryable'].includes(job.status)
            && (job.attempts || 0) < this.maxAttempts
            && (job.leaseOwner !== this.ownerId || Date.parse(job.leaseUntil || '') <= Date.now())
        );
    }

    summary() {
        const jobs = Object.values(this._read().jobs);
        return {
            total: jobs.length,
            pending: jobs.filter(job => ['received', 'processing', 'delivery_intent', 'retryable'].includes(job.status)).length,
            posted: jobs.filter(job => job.status === 'posted').length,
            failed: jobs.filter(job => job.status === 'failed').length,
            retryable: jobs.filter(job => job.status === 'retryable').length
        };
    }
}

export default DiscordConversationJobStore;
