import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJson, readJsonWithRecovery } from './AtomicJsonStore.cjs';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'blocked', 'cancelled', 'incomplete']);

function sanitizeId(id) {
    return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
}

export class ExecutionJobStore {
    constructor({ root = process.cwd(), jobsDir = null, outboxDir = null, eventsDir = null, logger = console } = {}) {
        this.root = path.resolve(root);
        this.jobsDir = jobsDir ? path.resolve(jobsDir) : path.join(this.root, 'data', 'execution-jobs');
        this.outboxDir = outboxDir ? path.resolve(outboxDir) : path.join(this.root, 'data', 'execution-outbox');
        this.eventsDir = eventsDir ? path.resolve(eventsDir) : path.join(this.root, 'data', 'execution-events');
        this.logger = logger;
        this._activeJobIds = new Set();
        this._ensureDirectories();
    }

    _ensureDirectories() {
        try {
            if (!fs.existsSync(this.jobsDir)) fs.mkdirSync(this.jobsDir, { recursive: true });
            if (!fs.existsSync(this.outboxDir)) fs.mkdirSync(this.outboxDir, { recursive: true });
            if (!fs.existsSync(this.eventsDir)) fs.mkdirSync(this.eventsDir, { recursive: true });
        } catch (e) {
            this.logger.warn?.(`[ExecutionJobStore] Failed to ensure directories: ${e.message}`);
        }
    }

    _jobPath(jobId) {
        return path.join(this.jobsDir, `${sanitizeId(jobId)}.json`);
    }

    _outboxPath(outboxId) {
        return path.join(this.outboxDir, `${sanitizeId(outboxId)}.json`);
    }

    _eventsPath(jobId) {
        return path.join(this.eventsDir, `${sanitizeId(jobId)}.jsonl`);
    }

    createJob({
        jobId = crypto.randomUUID(),
        goalId = null,
        task = '',
        mode = 'inspect',
        source = 'api_execute',
        metadata = {}
    } = {}) {
        const id = sanitizeId(jobId || crypto.randomUUID());
        const now = Date.now();
        const safeMode = ['inspect', 'modify', 'general', 'paper_backtest', 'image_generation'].includes(mode) ? mode : 'inspect';

        const record = {
            jobId: id,
            goalId: goalId || (metadata?.goalId ? String(metadata.goalId) : null),
            status: 'queued',
            task: String(task || '').trim(),
            mode: safeMode,
            source,
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null,
            heartbeatAt: null,
            durationMs: null,
            iterations: 0,
            totalIterations: 0,
            summary: '',
            result: '',
            evidence: [],
            toolsUsed: [],
            toolResults: [],
            verification: {
                passed: false,
                checks: []
            },
            errors: [],
            nextStep: null,
            reporting: {
                websocket: 'pending',
                sse: 'pending',
                notifier: 'pending',
                discord: 'pending'
            },
            events: [
                {
                    type: 'task_created',
                    timestamp: now,
                    jobId: id,
                    mode: safeMode,
                    task: String(task || '').trim()
                }
            ],
            metadata: { ...(metadata || {}) }
        };

        const filePath = this._jobPath(id);
        atomicWriteJson(filePath, record, { backup: false });

        // Also append initial event to event log file
        this._appendEventLog(id, record.events[0]);

        return record;
    }

    getJob(jobId) {
        if (!jobId) return null;
        const filePath = this._jobPath(jobId);
        try {
            const loaded = readJsonWithRecovery(filePath, null);
            return loaded?.value || null;
        } catch {
            return null;
        }
    }

    updateJob(jobId, updates = {}) {
        const current = this.getJob(jobId);
        if (!current) {
            throw new Error(`Job ${jobId} not found`);
        }

        const now = Date.now();
        const updated = {
            ...current,
            ...updates,
            jobId: current.jobId,
            createdAt: current.createdAt,
            updatedAt: now
        };

        // Track lifecycle statuses & heartbeats
        const newStatus = updates.status || current.status;

        if (newStatus === 'running' || newStatus === 'executing' || updates.status === 'planning' || updates.status === 'verifying') {
            updated.heartbeatAt = updates.heartbeatAt || now;
            this._activeJobIds.add(current.jobId);
            if (!current.startedAt) {
                updated.startedAt = updates.startedAt || now;
            }
        }

        if (TERMINAL_STATUSES.has(newStatus)) {
            this._activeJobIds.delete(current.jobId);
            if (!updated.completedAt) updated.completedAt = updates.completedAt || now;
            if (updated.startedAt && !updated.durationMs) {
                updated.durationMs = updated.completedAt - updated.startedAt;
            }
        }

        // Keep toolsUsed unique
        if (Array.isArray(updates.toolsUsed)) {
            updated.toolsUsed = Array.from(new Set([...(current.toolsUsed || []), ...updates.toolsUsed]));
        }

        // Callers provide the current snapshot, not a delta. Appending a full
        // snapshot on every step made inspection receipts grow quadratically.
        if (Array.isArray(updates.toolResults)) {
            updated.toolResults = updates.toolResults;
        }

        const filePath = this._jobPath(jobId);
        atomicWriteJson(filePath, updated, { backup: true });
        return updated;
    }

    touchHeartbeat(jobId) {
        return this.updateJob(jobId, { heartbeatAt: Date.now() });
    }

    appendEvent(jobId, event = {}) {
        const current = this.getJob(jobId);
        if (!current) return null;

        const now = Date.now();
        const eventEntry = {
            type: event.type || 'generic_event',
            timestamp: event.timestamp || now,
            ...event
        };

        // Update events in the job object (bounded to last 150 events in JSON to avoid unbounded file growth)
        const events = [...(current.events || []), eventEntry].slice(-150);
        this.updateJob(jobId, { events, heartbeatAt: now });

        // Append to append-only event stream file
        this._appendEventLog(jobId, eventEntry);
        return eventEntry;
    }

    _appendEventLog(jobId, eventEntry) {
        try {
            const eventsPath = this._eventsPath(jobId);
            const line = JSON.stringify(eventEntry) + '\n';
            fs.appendFileSync(eventsPath, line, 'utf8');
        } catch (e) {
            this.logger.warn?.(`[ExecutionJobStore] Failed to append event log for ${jobId}: ${e.message}`);
        }
    }

    getEvents(jobId) {
        const eventsPath = this._eventsPath(jobId);
        if (!fs.existsSync(eventsPath)) {
            const job = this.getJob(jobId);
            return job?.events || [];
        }
        try {
            const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(l => l.trim());
            return lines.map(line => {
                try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean);
        } catch {
            const job = this.getJob(jobId);
            return job?.events || [];
        }
    }

    listJobs({ limit = 50, status = null } = {}) {
        try {
            if (!fs.existsSync(this.jobsDir)) return [];
            const files = fs.readdirSync(this.jobsDir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp') && !f.endsWith('.bak'));
            const jobs = [];
            for (const file of files) {
                try {
                    const loaded = readJsonWithRecovery(path.join(this.jobsDir, file), null);
                    if (loaded?.value) {
                        if (!status || loaded.value.status === status) {
                            jobs.push(loaded.value);
                        }
                    }
                } catch {
                    // skip corrupted unrecoverable files
                }
            }
            return jobs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
        } catch {
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OUTBOX NOTIFICATIONS
    // ─────────────────────────────────────────────────────────────────────────

    queueNotification(jobId, eventType, payload = {}) {
        const safeJobId = sanitizeId(jobId);
        const outboxId = `${safeJobId}_${eventType}`;
        const filePath = this._outboxPath(outboxId);

        // Idempotency: check if already delivered
        let existing = null;
        try {
            const loaded = readJsonWithRecovery(filePath, null);
            existing = loaded?.value;
        } catch {}

        if (existing && existing.status === 'delivered') {
            return existing;
        }

        const now = Date.now();
        const entry = {
            id: outboxId,
            jobId: safeJobId,
            eventType,
            payload,
            status: 'pending',
            attempts: existing ? (existing.attempts || 0) : 0,
            maxAttempts: 5,
            createdAt: existing ? (existing.createdAt || now) : now,
            lastAttemptAt: null,
            deliveredAt: null,
            lastError: null
        };

        atomicWriteJson(filePath, entry, { backup: false });
        return entry;
    }

    getOutboxEntries({ status = 'pending' } = {}) {
        try {
            if (!fs.existsSync(this.outboxDir)) return [];
            const files = fs.readdirSync(this.outboxDir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp') && !f.endsWith('.bak'));
            const entries = [];
            for (const file of files) {
                try {
                    const loaded = readJsonWithRecovery(path.join(this.outboxDir, file), null);
                    if (loaded?.value) {
                        if (!status || loaded.value.status === status) {
                            entries.push(loaded.value);
                        }
                    }
                } catch {}
            }
            return entries.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        } catch {
            return [];
        }
    }

    async dispatchOutboxEntry(entry, system = {}) {
        const filePath = this._outboxPath(entry.id);
        const now = Date.now();
        entry.lastAttemptAt = now;
        entry.attempts = (entry.attempts || 0) + 1;

        let delivered = false;
        let lastError = null;
        let channelAttempted = false;

        let wsStatus = 'not_configured';
        let sseStatus = 'not_configured';
        let notifStatus = 'not_configured';
        let discordStatus = 'not_configured';

        try {
            // Channel 1: MessageBroker (SSE / EventBus)
            if (system.messageBroker?.publish) {
                channelAttempted = true;
                try {
                    await system.messageBroker.publish(`soma.execution.${entry.eventType}`, {
                        jobId: entry.jobId,
                        eventType: entry.eventType,
                        ...entry.payload,
                        timestamp: now
                    });
                    delivered = true;
                    sseStatus = 'delivered';
                } catch (err) {
                    lastError = err.message;
                    sseStatus = 'failed';
                    this.logger.warn?.(`[ExecutionJobStore] messageBroker error: ${err.message}`);
                }
            }

            // Channel 2: WebSocket broadcast
            if (typeof system.wsBroadcast === 'function') {
                channelAttempted = true;
                try {
                    system.wsBroadcast({
                        type: `execution:${entry.eventType}`,
                        jobId: entry.jobId,
                        payload: entry.payload
                    });
                    delivered = true;
                    wsStatus = 'delivered';
                } catch (err) {
                    lastError = lastError || err.message;
                    wsStatus = 'failed';
                }
            } else if (system.ws?.clients instanceof Set && system.ws.clients.size > 0) {
                channelAttempted = true;
                try {
                    const message = JSON.stringify({
                        type: `execution:${entry.eventType}`,
                        jobId: entry.jobId,
                        payload: entry.payload
                    });
                    for (const client of system.ws.clients) {
                        if (client.readyState === 1) client.send(message);
                    }
                    delivered = true;
                    wsStatus = 'delivered';
                } catch (err) {
                    lastError = lastError || err.message;
                    wsStatus = 'failed';
                }
            } else if (system.ws) {
                wsStatus = 'disconnected';
            }

            // Channel 3: NotificationService on completion / failure
            if (['execution_complete', 'execution_failed', 'execution_blocked', 'execution_incomplete'].includes(entry.eventType)) {
                const notifService = system.notificationService || system.notifications;
                if (notifService?.sendAlert) {
                    channelAttempted = true;
                    try {
                        const statusEmoji = entry.eventType === 'execution_complete' ? '✅' : entry.eventType === 'execution_blocked' ? '⚠️' : '❌';
                        const title = `${statusEmoji} Task ${entry.eventType.replace('execution_', '').toUpperCase()}: ${entry.payload.summary || entry.payload.task || entry.jobId}`.slice(0, 100);
                        const desc = `Job ID: ${entry.jobId}\nStatus: ${entry.payload.status || entry.eventType}\nResult: ${entry.payload.summary || entry.payload.result || 'No summary'}`;
                        await notifService.sendAlert(title, desc, {
                            eventType: 'task_execution',
                            dedupeKey: `${entry.jobId}_${entry.eventType}`
                        });
                        delivered = true;
                        notifStatus = 'delivered';
                    } catch (err) {
                        lastError = err.message;
                        notifStatus = 'failed';
                        this.logger.warn?.(`[ExecutionJobStore] notificationService error: ${err.message}`);
                    }
                }
            }

            // Channel 4: Discord
            if (system.discordBot || system.discord) {
                discordStatus = system.discordBot?.isReady?.() ? 'delivered' : 'not_configured';
            }

            // If no channels were configured, mark delivered so standalone/test callers don't block
            if (!channelAttempted) {
                delivered = true;
                wsStatus = 'delivered';
                notifStatus = 'delivered';
            }
        } catch (err) {
            lastError = err.message;
            delivered = false;
        }

        if (delivered) {
            entry.status = 'delivered';
            entry.deliveredAt = now;
            entry.lastError = null;
        } else {
            entry.status = entry.attempts >= entry.maxAttempts ? 'failed' : 'pending';
            entry.lastError = lastError;
        }

        atomicWriteJson(filePath, entry, { backup: false });

        // Update reporting state on the job record without mutating its execution status
        try {
            const job = this.getJob(entry.jobId);
            if (job) {
                const reporting = {
                    ...(job.reporting || {}),
                    websocket: wsStatus !== 'not_configured' ? wsStatus : (job.reporting?.websocket || 'not_configured'),
                    sse: sseStatus !== 'not_configured' ? sseStatus : (job.reporting?.sse || 'not_configured'),
                    notifier: notifStatus !== 'not_configured' ? notifStatus : (job.reporting?.notifier || 'not_configured'),
                    discord: discordStatus !== 'not_configured' ? discordStatus : (job.reporting?.discord || 'not_configured')
                };
                this.updateJob(entry.jobId, { reporting });
                this.appendEvent(entry.jobId, {
                    type: 'report_delivered',
                    channel: wsStatus === 'delivered' ? 'websocket' : notifStatus === 'delivered' ? 'notifier' : 'outbox',
                    status: entry.status,
                    error: lastError
                });
            }
        } catch {}

        return { delivered, error: lastError };
    }

    async flushOutbox(system = {}) {
        const pending = this.getOutboxEntries({ status: 'pending' });
        const results = [];
        for (const entry of pending) {
            try {
                const res = await this.dispatchOutboxEntry(entry, system);
                results.push({ id: entry.id, ...res });
            } catch (err) {
                results.push({ id: entry.id, delivered: false, error: err.message });
            }
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CRASH / RESTART / HEARTBEAT RECOVERY
    // ─────────────────────────────────────────────────────────────────────────

    recoverStaleJobs({ maxHeartbeatAgeMs = 300_000 } = {}) {
        try {
            if (!fs.existsSync(this.jobsDir)) return 0;
            const files = fs.readdirSync(this.jobsDir).filter(f => f.endsWith('.json') && !f.endsWith('.tmp') && !f.endsWith('.bak'));
            let count = 0;
            const now = Date.now();

            for (const file of files) {
                try {
                    const filePath = path.join(this.jobsDir, file);
                    const loaded = readJsonWithRecovery(filePath, null);
                    const job = loaded?.value;
                    if (!job) continue;

                    const isActiveInMemory = this._activeJobIds.has(job.jobId);
                    const isPendingState = ['running', 'queued', 'executing', 'planning', 'verifying'].includes(job.status);
                    const heartbeatTime = job.heartbeatAt || job.updatedAt || job.startedAt || job.createdAt || 0;
                    const heartbeatExpired = (now - heartbeatTime) > maxHeartbeatAgeMs;

                    if (isPendingState && (!isActiveInMemory || heartbeatExpired)) {
                        const updated = {
                            ...job,
                            status: 'incomplete',
                            updatedAt: now,
                            completedAt: now,
                            durationMs: job.startedAt ? now - job.startedAt : null,
                            errors: [
                                {
                                    type: 'stale_job_recovery',
                                    message: 'Execution heartbeat expired: interrupted by process restart or crash.'
                                },
                                'Execution was interrupted by process restart or crash.'
                            ],
                            nextStep: 'Resume manually or retry if the task is idempotent.'
                        };
                        atomicWriteJson(filePath, updated, { backup: true });
                        this.appendEvent(job.jobId, {
                            type: 'stale_job_recovered',
                            timestamp: now,
                            reason: heartbeatExpired ? 'heartbeat_expired' : 'interrupted_by_restart'
                        });
                        this.queueNotification(job.jobId, 'execution_incomplete', {
                            jobId: job.jobId,
                            status: 'incomplete',
                            task: job.task,
                            reason: 'interrupted_by_restart'
                        });
                        count++;
                        this.logger.log?.(`[ExecutionJobStore] ⚠️ Recovered stale job ${job.jobId} -> status: incomplete`);
                    }
                } catch (e) {
                    this.logger.warn?.(`[ExecutionJobStore] Error recovering file ${file}: ${e.message}`);
                }
            }
            return count;
        } catch (e) {
            this.logger.warn?.(`[ExecutionJobStore] Failed to recover stale jobs: ${e.message}`);
            return 0;
        }
    }
}

export const globalJobStore = new ExecutionJobStore();
export default ExecutionJobStore;
