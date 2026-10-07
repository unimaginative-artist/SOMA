import { randomUUID } from 'node:crypto';

const PRIORITY = Object.freeze({
    idle: 10,
    research: 20,
    scheduled: 30,
    background: 30,
    goal: 50,
    restoration: 80,
    interactive: 90,
    human: 100,
});

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeInferencePriority(value = 'background') {
    const key = String(value || '').trim().toLowerCase();
    if (['human', 'foreground', 'user', 'chat', 'discord'].includes(key)) return 'human';
    if (['interactive', 'authorized_interactive', 'operator'].includes(key)) return 'interactive';
    if (['restore', 'restoration', 'health_probe'].includes(key)) return 'restoration';
    if (['goal', 'goal_driven', 'directed'].includes(key)) return 'goal';
    if (['research'].includes(key)) return 'research';
    if (['idle', 'curiosity'].includes(key)) return 'idle';
    return 'background';
}

function schedulerError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

/**
 * Admission control for scarce inference resources.
 *
 * This scheduler is intentionally independent of any model provider. Callers
 * supply a resource key (for example `gpu:local-models`) and perform the real
 * request inside the admitted handler. Foreground requests may cancel lower
 * priority, explicitly preemptible inference, but never skip the concurrency
 * limit or publish a late result after cancellation.
 */
export class InferenceScheduler {
    constructor({
        defaultLimit = 1,
        resourceLimits = {},
        maxQueue = 64,
        defaultTimeoutMs = 120_000,
        eventLimit = 200,
        preemptForeground = true,
        clock = () => Date.now(),
    } = {}) {
        this.defaultLimit = Math.max(1, Math.floor(positiveNumber(defaultLimit, 1)));
        this.resourceLimits = new Map(Object.entries(resourceLimits).map(([key, limit]) => [key, Math.max(1, Math.floor(positiveNumber(limit, 1)))]));
        this.maxQueue = Math.max(1, Math.floor(positiveNumber(maxQueue, 64)));
        this.defaultTimeoutMs = Math.max(50, positiveNumber(defaultTimeoutMs, 120_000));
        this.eventLimit = Math.max(10, Math.floor(positiveNumber(eventLimit, 200)));
        this.preemptForeground = preemptForeground !== false;
        this.clock = clock;
        this.resources = new Map();
        this.sequence = 0;
        this.stats = {
            submitted: 0,
            started: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            expired: 0,
            preempted: 0,
            rejected: 0,
            peakQueued: 0,
            totalWaitMs: 0,
        };
        this.events = [];
    }

    setResourceLimit(resource, limit) {
        const key = String(resource || 'default');
        this.resourceLimits.set(key, Math.max(1, Math.floor(positiveNumber(limit, 1))));
        this._drain(key);
    }

    _state(resource) {
        const key = String(resource || 'default');
        if (!this.resources.has(key)) this.resources.set(key, { active: new Map(), queue: [] });
        return this.resources.get(key);
    }

    _limit(resource) {
        return this.resourceLimits.get(resource) || this.defaultLimit;
    }

    _record(type, job, details = {}) {
        this.events.push({
            at: new Date(this.clock()).toISOString(),
            type,
            traceId: job?.traceId || null,
            requestId: job?.requestId || null,
            resource: job?.resource || null,
            priority: job?.priority || null,
            source: job?.source || null,
            model: job?.model || null,
            ...details,
        });
        if (this.events.length > this.eventLimit) this.events.splice(0, this.events.length - this.eventLimit);
    }

    _detach(job) {
        if (job?.externalSignal && job?.externalAbort) {
            job.externalSignal.removeEventListener('abort', job.externalAbort);
        }
        if (job?.deadlineTimer) clearTimeout(job.deadlineTimer);
        job.deadlineTimer = null;
    }

    _settle(job, method, value) {
        if (job.settled) return;
        job.settled = true;
        if (method === 'resolve') job.resolve(value);
        else job.reject(value);
    }

    _cancel(job, error, { preempted = false, expired = false } = {}) {
        const state = this._state(job.resource);
        const queuedIndex = state.queue.indexOf(job);
        if (queuedIndex >= 0) state.queue.splice(queuedIndex, 1);
        if (!job.controller.signal.aborted) job.controller.abort(error);
        this._settle(job, 'reject', error);
        this.stats.cancelled++;
        if (preempted) this.stats.preempted++;
        if (expired) this.stats.expired++;
        this._record(preempted ? 'preempted' : expired ? 'expired' : 'cancelled', job, { reason: error.message });
        if (!state.active.has(job.requestId)) this._detach(job);
    }

    _makeRoomFor(job, state) {
        if (state.queue.length < this.maxQueue) return true;
        const lowest = [...state.queue].sort((a, b) => a.rank - b.rank || b.sequence - a.sequence)[0];
        if (lowest && job.rank > lowest.rank) {
            this._cancel(lowest, schedulerError('Inference request displaced by a higher-priority request', 'INFERENCE_DISPLACED', {
                byTraceId: job.traceId,
            }), { preempted: true });
            return true;
        }
        this.stats.rejected++;
        this._record('rejected', job, { reason: 'queue_full' });
        return false;
    }

    _preemptFor(job, state) {
        if (!this.preemptForeground || job.rank < PRIORITY.human) return;
        for (const active of state.active.values()) {
            if (!active.preemptible || active.rank >= job.rank || active.controller.signal.aborted) continue;
            this._cancel(active, schedulerError('Background inference preempted by a foreground request', 'INFERENCE_PREEMPTED', {
                byTraceId: job.traceId,
            }), { preempted: true });
        }
    }

    schedule(options = {}, handler) {
        if (typeof options === 'string') options = { priority: options };
        if (typeof handler !== 'function') throw new TypeError('InferenceScheduler.schedule requires a handler');

        const submittedAt = this.clock();
        const priority = normalizeInferencePriority(options.priority);
        const timeoutMs = positiveNumber(options.timeoutMs, this.defaultTimeoutMs);
        const deadlineAt = positiveNumber(options.deadlineAt, submittedAt + timeoutMs);
        const job = {
            requestId: String(options.requestId || randomUUID()),
            traceId: String(options.traceId || options.requestId || `infer:${randomUUID()}`),
            resource: String(options.resource || 'default'),
            priority,
            rank: PRIORITY[priority],
            source: String(options.source || 'unknown'),
            model: options.model ? String(options.model) : null,
            endpoint: options.endpoint ? String(options.endpoint) : null,
            preemptible: options.preemptible ?? (PRIORITY[priority] < PRIORITY.interactive),
            submittedAt,
            deadlineAt,
            sequence: ++this.sequence,
            controller: new AbortController(),
            externalSignal: options.signal || null,
            handler,
            settled: false,
            startedAt: null,
            resolve: null,
            reject: null,
        };
        this.stats.submitted++;

        const promise = new Promise((resolve, reject) => {
            job.resolve = resolve;
            job.reject = reject;
        });
        promise.traceId = job.traceId;
        promise.requestId = job.requestId;

        if (job.externalSignal?.aborted) {
            this._cancel(job, job.externalSignal.reason instanceof Error
                ? job.externalSignal.reason
                : schedulerError('Inference request aborted before admission', 'INFERENCE_ABORTED'));
            return promise;
        }
        if (job.externalSignal?.addEventListener) {
            job.externalAbort = () => this._cancel(job, job.externalSignal.reason instanceof Error
                ? job.externalSignal.reason
                : schedulerError('Inference request aborted', 'INFERENCE_ABORTED'));
            job.externalSignal.addEventListener('abort', job.externalAbort, { once: true });
        }
        job.deadlineTimer = setTimeout(() => this._cancel(job,
            schedulerError('Inference request deadline exceeded', 'INFERENCE_DEADLINE_EXCEEDED', { deadlineAt }),
            { expired: true }), Math.max(1, deadlineAt - submittedAt));
        job.deadlineTimer.unref?.();

        const state = this._state(job.resource);
        if (!this._makeRoomFor(job, state)) {
            this._settle(job, 'reject', schedulerError(`Inference queue is full for ${job.resource}`, 'INFERENCE_QUEUE_FULL', {
                resource: job.resource,
                maxQueue: this.maxQueue,
            }));
            this._detach(job);
            return promise;
        }

        state.queue.push(job);
        state.queue.sort((a, b) => b.rank - a.rank || a.sequence - b.sequence);
        this.stats.peakQueued = Math.max(this.stats.peakQueued, state.queue.length);
        this._record('queued', job, { queueDepth: state.queue.length });
        this._preemptFor(job, state);
        this._drain(job.resource);
        return promise;
    }

    _drain(resource) {
        const state = this._state(resource);
        const limit = this._limit(resource);
        while (state.active.size < limit && state.queue.length) {
            const job = state.queue.shift();
            if (job.settled || job.controller.signal.aborted) continue;
            if (job.deadlineAt <= this.clock()) {
                this._cancel(job, schedulerError('Inference request expired before admission', 'INFERENCE_DEADLINE_EXCEEDED'), { expired: true });
                continue;
            }

            job.startedAt = this.clock();
            state.active.set(job.requestId, job);
            this.stats.started++;
            this.stats.totalWaitMs += Math.max(0, job.startedAt - job.submittedAt);
            this._record('started', job, { waitMs: job.startedAt - job.submittedAt });

            Promise.resolve()
                .then(() => job.handler({
                    signal: job.controller.signal,
                    traceId: job.traceId,
                    requestId: job.requestId,
                    resource: job.resource,
                    priority: job.priority,
                    queuedAt: job.submittedAt,
                    startedAt: job.startedAt,
                    deadlineAt: job.deadlineAt,
                }))
                .then(value => {
                    if (job.controller.signal.aborted) return;
                    this.stats.completed++;
                    this._record('completed', job, { durationMs: this.clock() - job.startedAt });
                    this._settle(job, 'resolve', value);
                })
                .catch(error => {
                    if (!job.settled) {
                        this.stats.failed++;
                        this._record('failed', job, { reason: error.message, code: error.code || null });
                        this._settle(job, 'reject', error);
                    }
                })
                .finally(() => {
                    state.active.delete(job.requestId);
                    this._detach(job);
                    this._drain(resource);
                });
        }
    }

    getStatus() {
        const resources = {};
        for (const [resource, state] of this.resources) {
            resources[resource] = {
                limit: this._limit(resource),
                active: [...state.active.values()].map(job => ({
                    requestId: job.requestId,
                    traceId: job.traceId,
                    priority: job.priority,
                    source: job.source,
                    model: job.model,
                    endpoint: job.endpoint,
                    startedAt: job.startedAt,
                    deadlineAt: job.deadlineAt,
                })),
                queued: state.queue.map(job => ({
                    requestId: job.requestId,
                    traceId: job.traceId,
                    priority: job.priority,
                    source: job.source,
                    model: job.model,
                    endpoint: job.endpoint,
                    submittedAt: job.submittedAt,
                    deadlineAt: job.deadlineAt,
                })),
            };
        }
        return {
            maxQueue: this.maxQueue,
            defaultLimit: this.defaultLimit,
            stats: {
                ...this.stats,
                averageWaitMs: this.stats.started ? Math.round(this.stats.totalWaitMs / this.stats.started) : 0,
            },
            resources,
            recentEvents: this.events.slice(-50),
        };
    }
}

const inferenceScheduler = new InferenceScheduler({
    defaultLimit: Number(process.env.SOMA_INFERENCE_RESOURCE_LIMIT || 1),
    maxQueue: Number(process.env.SOMA_INFERENCE_MAX_QUEUE || 64),
    defaultTimeoutMs: Number(process.env.SOMA_INFERENCE_DEFAULT_TIMEOUT_MS || 120_000),
    resourceLimits: {
        'gpu:local-models': Number(process.env.SOMA_LOCAL_INFERENCE_CONCURRENCY || 1),
        'cloud:deepseek': Number(process.env.SOMA_DEEPSEEK_INFERENCE_CONCURRENCY || 4),
    },
});

export default inferenceScheduler;
