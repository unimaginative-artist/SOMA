import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExecutionJobStore } from '../core/ExecutionJobStore.js';
import { handleExecuteRoute, handleGetJobRoute, handleListJobsRoute } from '../server/routes/executeRoute.js';

async function createTempJobStore() {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-jobs-test-'));
    const jobsDir = path.join(tmpRoot, 'data', 'execution-jobs');
    const outboxDir = path.join(tmpRoot, 'data', 'execution-outbox');
    const store = new ExecutionJobStore({ root: tmpRoot, jobsDir, outboxDir });
    return { tmpRoot, store, jobsDir, outboxDir };
}

test('busy writer does not block a complex authenticated read-only API inspection', async t => {
    const { tmpRoot, store } = await createTempJobStore();
    t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
    let writerCalled = false;
    let forkCalled = false;
    const executor = {
        _executionActive: true,
        async execute() { writerCalled = true; throw new Error('busy writer must not execute this inspection'); },
        forkReadOnlyInspection() {
            forkCalled = true;
            return { async execute(goal) {
                assert.equal(goal.metadata.executionMode, 'inspect');
                return { state: 'completed', done: true, summary: 'MAX source inspected',
                    evidence: [{ path: 'core/example.js', receiptId: 'read-1' }],
                    toolsUsed: ['read_file', 'record_observation'], verification: { passed: true } };
            } };
        }
    };
    let statusCode;
    let body;
    await handleExecuteRoute({ body: { task: 'Analyze the MAX architecture and report weaknesses', mode: 'inspect', sync: true } },
        { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } },
        { agenticExecutor: executor, executionJobStore: store });
    assert.equal(statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(forkCalled, true);
    assert.equal(writerCalled, false);
    assert.deepEqual(body.toolsUsed, ['read_file', 'record_observation']);
});

test('Requirement 1 & 2: Task submission returns jobId immediately in queued status', async t => {
    const { tmpRoot, store } = await createTempJobStore();
    t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

    let executorStarted = false;
    let finishExecution;
    const executionPromise = new Promise(resolve => { finishExecution = resolve; });

    const mockExecutor = {
        async execute(goal) {
            executorStarted = true;
            await executionPromise;
            return {
                success: true,
                state: 'completed',
                stopReason: 'inspection_verified',
                summary: 'Completed inspection of references',
                result: 'Completed inspection of references',
                evidence: ['core/SomaAgenticExecutor.js:42'],
                toolsUsed: ['search_code', 'record_observation'],
                iterations: 1,
                verification: { passed: true }
            };
        }
    };

    const mockSystem = {
        agenticExecutor: mockExecutor,
        executionJobStore: store
    };

    const req = {
        body: { task: 'Inspect the codebase for memory leaks', mode: 'inspect', async: true },
        signal: new AbortController().signal
    };

    let statusCode = null;
    let jsonResponse = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(data) { jsonResponse = data; return this; }
    };

    await handleExecuteRoute(req, res, mockSystem);

    // Assert immediate return
    assert.equal(statusCode, 202);
    assert.ok(jsonResponse);
    assert.equal(jsonResponse.success, false); // accepted is not completed
    assert.equal(jsonResponse.accepted, true);
    assert.ok(jsonResponse.jobId);
    assert.equal(jsonResponse.status, 'queued');
    assert.equal(jsonResponse.task, 'Inspect the codebase for memory leaks');
    assert.equal(jsonResponse.mode, 'inspect');
    assert.ok(jsonResponse.createdAt);
    assert.equal(jsonResponse.pollUrl, `/api/execute/${jsonResponse.jobId}`);

    // Verify persisted on disk in queued status immediately
    const jobRecord = store.getJob(jsonResponse.jobId);
    assert.ok(jobRecord);
    assert.equal(jobRecord.jobId, jsonResponse.jobId);
    assert.equal(jobRecord.status, 'queued');

    // Unblock the background executor
    finishExecution();
    // Allow background event loop to finish
    await new Promise(resolve => setTimeout(resolve, 50));
});

test('Requirement 3 & 4: Execution transitions to running and then to completed with full evidence', async t => {
    const { tmpRoot, store } = await createTempJobStore();
    t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

    let finishExecution;
    const executionPromise = new Promise(resolve => { finishExecution = resolve; });

    const mockExecutor = {
        async execute(goal) {
            // Verify status was updated to running
            const currentJob = store.getJob(goal.id);
            assert.equal(currentJob.status, 'running');
            assert.ok(currentJob.startedAt);

            await executionPromise;
            return {
                success: true,
                state: 'completed',
                stopReason: 'inspection_verified',
                summary: 'Found 3 memory leaks',
                result: 'Found 3 memory leaks',
                evidence: ['leak1.js:10', 'leak2.js:20', 'leak3.js:30'],
                toolsUsed: ['search_code', 'record_observation'],
                iterations: 3,
                totalIterations: 3,
                verification: { passed: true }
            };
        }
    };

    const mockSystem = {
        agenticExecutor: mockExecutor,
        executionJobStore: store
    };

    const req = {
        body: { task: 'Find all memory leaks', mode: 'inspect', async: true },
        signal: new AbortController().signal
    };

    let statusCode = null;
    let jsonResponse = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(data) { jsonResponse = data; return this; }
    };

    await handleExecuteRoute(req, res, mockSystem);
    const jobId = jsonResponse.jobId;

    // Allow background runner to start and reach executor
    await new Promise(resolve => setTimeout(resolve, 20));

    // Finish execution
    finishExecution();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Check final job record on disk
    const completedJob = store.getJob(jobId);
    assert.ok(completedJob);
    assert.equal(completedJob.status, 'completed');
    assert.equal(completedJob.stopReason, 'inspection_verified');
    assert.equal(completedJob.summary, 'Found 3 memory leaks');
    assert.deepEqual(completedJob.evidence, ['leak1.js:10', 'leak2.js:20', 'leak3.js:30']);
    assert.deepEqual(completedJob.toolsUsed, ['search_code', 'record_observation']);
    assert.equal(completedJob.verification?.passed, true);
    assert.ok(completedJob.durationMs >= 0);
    assert.ok(completedJob.completedAt >= completedJob.startedAt);
});

test('Requirement 5: Status polling GET /api/execute/:jobId returns current job record', async t => {
    const { tmpRoot, store } = await createTempJobStore();
    t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

    const job = store.createJob({
        jobId: 'poll-test-uuid-123',
        task: 'Check status polling',
        mode: 'inspect'
    });
    store.updateJob('poll-test-uuid-123', {
        status: 'completed',
        summary: 'Polling test passed',
        result: 'Polling test passed',
        verification: { passed: true }
    });

    const mockSystem = { executionJobStore: store };

    // Test successful lookup
    let code = 200;
    let body = null;
    const res = {
        status(c) { code = c; return this; },
        json(d) { body = d; return this; }
    };
    await handleGetJobRoute({ params: { jobId: 'poll-test-uuid-123' } }, res, mockSystem);
    assert.equal(code, 200);
    assert.equal(body.success, true);
    assert.equal(body.job.jobId, 'poll-test-uuid-123');
    assert.equal(body.job.status, 'completed');
    assert.equal(body.job.summary, 'Polling test passed');

    // Test non-existent job lookup
    code = 200;
    body = null;
    await handleGetJobRoute({ params: { jobId: 'non-existent-uuid' } }, res, mockSystem);
    assert.equal(code, 404);
    assert.equal(body.success, false);
    assert.ok(body.error.includes('not found'));

    // Test list jobs endpoint
    code = 200;
    body = null;
    await handleListJobsRoute({ query: {} }, res, mockSystem);
    assert.equal(code, 200);
    assert.equal(body.success, true);
    assert.ok(body.jobs.some(j => j.jobId === 'poll-test-uuid-123'));
});

test('Requirement 6: Outbox pattern queues notifications with jobId+eventType idempotency', async t => {
    const { tmpRoot, store } = await createTempJobStore();
    t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

    const jobId = 'outbox-test-job-456';
    store.createJob({ jobId, task: 'Test outbox delivery' });

    // Queue started event
    const startEntry = store.queueNotification(jobId, 'execution_started', { status: 'running' });
    assert.equal(startEntry.id, `${jobId}_execution_started`);
    assert.equal(startEntry.status, 'pending');

    // Queue complete event
    const completeEntry = store.queueNotification(jobId, 'execution_complete', { status: 'completed', summary: 'All good' });
    assert.equal(completeEntry.id, `${jobId}_execution_complete`);

    // Verify pending entries
    const pending = store.getOutboxEntries({ status: 'pending' });
    assert.equal(pending.length, 2);

    // Dispatch outbox with simulated delivery channels
    const deliveredEvents = [];
    const mockSystem = {
        messageBroker: {
            async publish(channel, payload) {
                deliveredEvents.push({ channel, payload });
            }
        },
        wsBroadcast(msg) {
            deliveredEvents.push(msg);
        }
    };

    await store.flushOutbox(mockSystem);

    // Verify all delivered
    const remainingPending = store.getOutboxEntries({ status: 'pending' });
    assert.equal(remainingPending.length, 0);

    // Idempotency: queueing execution_complete again should return already-delivered entry and NOT duplicate
    const duplicateAttempt = store.queueNotification(jobId, 'execution_complete', { status: 'completed', summary: 'Duplicate' });
    assert.equal(duplicateAttempt.status, 'delivered');

    assert.ok(deliveredEvents.some(e => e.channel === 'soma.execution.execution_complete'));
    assert.ok(deliveredEvents.some(e => e.type === 'execution:execution_complete'));
});

test('Requirement 6: Notification failure does NOT fail the completed task result', async t => {
    const { tmpRoot, store } = await createTempJobStore();
    t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

    const mockExecutor = {
        async execute(goal) {
            return {
                success: true,
                state: 'completed',
                stopReason: 'inspection_verified',
                summary: 'Task succeeded perfectly',
                result: 'Task succeeded perfectly',
                verification: { passed: true }
            };
        }
    };

    // System where notification channel throws error
    const mockSystem = {
        agenticExecutor: mockExecutor,
        executionJobStore: store,
        notificationService: {
            async sendAlert() {
                throw new Error('Discord API 500: Outage on notification server');
            }
        },
        messageBroker: {
            async publish() {
                throw new Error('Broker socket closed');
            }
        }
    };

    const req = {
        body: { task: 'Task with flaky notification channel', mode: 'inspect' },
        signal: new AbortController().signal
    };

    let statusCode = null;
    let jsonResponse = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(data) { jsonResponse = data; return this; }
    };

    await handleExecuteRoute(req, res, mockSystem);
    const jobId = jsonResponse.jobId;

    // Allow background runner to finish
    await new Promise(resolve => setTimeout(resolve, 80));

    // CRUCIAL: The job itself MUST be completed and NOT marked failed!
    const finalJob = store.getJob(jobId);
    assert.equal(finalJob.status, 'completed');
    assert.equal(finalJob.summary, 'Task succeeded perfectly');
    assert.equal(finalJob.verification?.passed, true);

    // The outbox entry recorded the attempt/error for retry
    const outboxEntries = store.getOutboxEntries({ status: 'pending' });
    assert.ok(outboxEntries.some(e => e.jobId === jobId));
});

test('Requirement 7: Stale running jobs from previous process recover to incomplete status', async t => {
    const { tmpRoot, store } = await createTempJobStore();
    t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

    // Create a job simulating a process that crashed while running
    const staleJob = store.createJob({
        jobId: 'stale-crashed-job-789',
        task: 'Long running task that was running when power was cut',
        mode: 'inspect'
    });
    store.updateJob('stale-crashed-job-789', {
        status: 'running',
        startedAt: Date.now() - 30000
    });

    // Verify it is currently in 'running' state
    assert.equal(store.getJob('stale-crashed-job-789').status, 'running');

    // Create a new fresh store instance simulating server reboot
    const newStoreAfterReboot = new ExecutionJobStore({
        root: tmpRoot,
        jobsDir: path.join(tmpRoot, 'data', 'execution-jobs'),
        outboxDir: path.join(tmpRoot, 'data', 'execution-outbox')
    });

    // Run recovery
    const recoveredCount = newStoreAfterReboot.recoverStaleJobs();
    assert.equal(recoveredCount, 1);

    // Verify job transitioned to incomplete with reason
    const recoveredJob = newStoreAfterReboot.getJob('stale-crashed-job-789');
    assert.equal(recoveredJob.status, 'incomplete');
    assert.ok(recoveredJob.errors.some(e => (typeof e === 'string' ? e : e?.message || '').includes('interrupted by process restart')));
    assert.ok(recoveredJob.completedAt);
    assert.ok(recoveredJob.nextStep);

    // Verify an incomplete notification was queued in the outbox
    const pendingOutbox = newStoreAfterReboot.getOutboxEntries({ status: 'pending' });
    assert.ok(pendingOutbox.some(e => e.jobId === 'stale-crashed-job-789' && e.eventType === 'execution_incomplete'));
});
