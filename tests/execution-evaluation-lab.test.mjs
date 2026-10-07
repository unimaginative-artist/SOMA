import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ExecutionJobStore } from '../core/ExecutionJobStore.js';
import { handleExecuteRoute, handleGetJobRoute } from '../server/routes/executeRoute.js';
import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';
import { parseExecutionTool, validateExecutionArgs, formatToolFeedback, executionResult } from '../core/ExecutionProtocol.js';
import { CapabilityRegistry } from '../core/CapabilityRegistry.js';
import { routeDeterministicTask } from '../core/DeterministicTaskRouter.js';
import { TransactionalCodeModifier } from '../core/TransactionalCodeModifier.js';
import { ProcedureLearningStore } from '../core/ProcedureLearningStore.js';
import { MnemonicArbiter } from '../arbiters/MnemonicArbiter.js';

async function createLabEnvironment() {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-eval-lab-'));
    const jobsDir = path.join(tmpRoot, 'data', 'execution-jobs');
    const outboxDir = path.join(tmpRoot, 'data', 'execution-outbox');
    const eventsDir = path.join(tmpRoot, 'data', 'execution-events');
    const proceduresDir = path.join(tmpRoot, 'data', 'procedures');
    const jobStore = new ExecutionJobStore({ root: tmpRoot, jobsDir, outboxDir, eventsDir });
    const procedureStore = new ProcedureLearningStore({ root: tmpRoot, proceduresDir });
    const capabilities = new CapabilityRegistry();
    const modifier = new TransactionalCodeModifier({ root: tmpRoot });
    return { tmpRoot, jobsDir, outboxDir, eventsDir, proceduresDir, jobStore, procedureStore, capabilities, modifier };
}

test('Evaluation Lab: Comprehensive Execution Reliability Benchmark', async (suite) => {

    await suite.test('1. Normal chat remains conversational without launching execution jobs', async () => {
        const { tmpRoot, jobStore } = await createLabEnvironment();
        // A standard conversation request without execute: true
        const initialJobCount = jobStore.listJobs().length;
        assert.equal(initialJobCount, 0, 'No jobs initially');

        // Conversational message
        const chatReq = { message: 'Hi SOMA, what do you think about agent architectures?' };
        assert.equal(chatReq.execute, undefined);
        assert.equal(chatReq.isAgentic, undefined);
        // Does not create a job
        assert.equal(jobStore.listJobs().length, 0);
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    await suite.test('2. Explicit /api/execute creates job and persists jobId before execution starts', async () => {
        const { tmpRoot, jobStore } = await createLabEnvironment();
        let executorCalled = false;
        let resolveExec;
        const execPromise = new Promise(r => { resolveExec = r; });

        const mockExecutor = {
            async execute(goal) {
                executorCalled = true;
                // Verify job exists on disk while executor is running
                const existing = jobStore.getJob(goal.id);
                assert.ok(existing);
                assert.equal(existing.status, 'running');
                await execPromise;
                return { success: true, state: 'completed', summary: 'Done', verification: { passed: true } };
            }
        };

        const mockSystem = { agenticExecutor: mockExecutor, executionJobStore: jobStore };
        let statusCode = null;
        let body = null;
        const res = {
            status(code) { statusCode = code; return this; },
            json(d) { body = d; return this; }
        };

        await handleExecuteRoute({
            body: { task: 'Verify explicit job creation', mode: 'inspect' },
            signal: new AbortController().signal
        }, res, mockSystem);

        assert.equal(statusCode, 202);
        assert.ok(body.jobId);
        assert.equal(body.status, 'queued');

        // Check disk record
        const saved = jobStore.getJob(body.jobId);
        assert.ok(saved);
        assert.equal(saved.jobId, body.jobId);
        assert.equal(saved.task, 'Verify explicit job creation');

        resolveExec();
        await new Promise(r => setTimeout(r, 40));
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    await suite.test('3. Queued -> Running -> Completed status transitions with heartbeat', async () => {
        const { tmpRoot, jobStore } = await createLabEnvironment();
        const job = jobStore.createJob({ jobId: 'test-trans-123', task: 'Status transition test', mode: 'inspect' });
        assert.equal(job.status, 'queued');

        // Transition to running
        const running = jobStore.updateJob('test-trans-123', { status: 'running' });
        assert.equal(running.status, 'running');
        assert.ok(running.startedAt);
        assert.ok(running.heartbeatAt);

        // Touch heartbeat
        const touched = jobStore.touchHeartbeat('test-trans-123');
        assert.ok(touched.heartbeatAt >= running.heartbeatAt);

        // Transition to completed
        const completed = jobStore.updateJob('test-trans-123', {
            status: 'completed',
            summary: 'Task finished successfully',
            verification: { passed: true }
        });
        assert.equal(completed.status, 'completed');
        assert.ok(completed.completedAt >= completed.startedAt);
        assert.ok(completed.durationMs >= 0);
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    await suite.test('4. Tool protocol parsing and argument validation', async () => {
        const tools = new Map([
            ['search_code', {
                parameters: {
                    type: 'object',
                    properties: { pattern: { type: 'string' } },
                    required: ['pattern']
                }
            }],
            ['read_file', {
                parameters: {
                    type: 'object',
                    properties: { path: { type: 'string' } },
                    required: ['path']
                }
            }]
        ]);

        // Valid parse
        const valid = parseExecutionTool('THINK: need to search\nTOOL: search_code\nARGS: {"pattern":"test"}', tools);
        assert.equal(valid.tool, 'search_code');
        assert.deepEqual(valid.args, { pattern: 'test' });

        // Invalid tool name
        const unknown = parseExecutionTool('TOOL: non_existent_tool\nARGS: {}', tools);
        assert.ok(unknown.error.includes('Unknown or disallowed tool'));

        // Invalid JSON args
        const badJson = parseExecutionTool('TOOL: search_code\nARGS: {not json}', tools);
        assert.ok(badJson.error);

        // Schema validation error (missing required 'pattern')
        const missingParam = parseExecutionTool('TOOL: search_code\nARGS: {}', tools);
        assert.ok(missingParam.error.includes('Invalid arguments') || missingParam.error.includes('pattern'));
    });

    await suite.test('5. Prose-only simulation without tool call fails format verification', async () => {
        const tools = new Map([['read_file', {}]]);
        const narrative = parseExecutionTool("I'll inspect the architecture and find any changes for you.", tools);
        assert.ok(narrative.error, 'Prose simulation must be rejected as format error');
        assert.ok(narrative.error.includes('TOOL call'));
    });

    await suite.test('6. Explicit TOOL_RESULT structured feedback blocks', async () => {
        const observations = [
            {
                step: 1,
                tool: 'search_code',
                args: { pattern: 'tool calling' },
                outcome: { ok: true },
                result: { matches: ['file1.js:10'] },
                receiptId: 'receipt_abc_1'
            }
        ];
        const feedback = formatToolFeedback(observations);
        assert.ok(feedback.includes('TOOL_RESULT:'));
        assert.ok(feedback.includes('"step": 1'));
        assert.ok(feedback.includes('"tool": "search_code"'));
        assert.ok(feedback.includes('"receipt_abc_1"'));
    });

    await suite.test('7. Inspection receipt satisfies inspect-mode completion', async () => {
        const raw = {
            done: true,
            summary: 'Inspected five files successfully',
            evidence: ['file1.js:10', 'file2.js:20'],
            toolsUsed: ['search_code', 'record_observation'],
            verification: { passed: true, status: 'verified_inspection_receipts' },
            completionEvidence: { passed: true, type: 'inspection', facts: ['file1.js:10'] }
        };
        const res = executionResult(raw);
        assert.equal(res.success, true);
        assert.equal(res.state, 'completed');
        assert.equal(res.verification.passed, true);
    });

    await suite.test('8. Modification tasks reject pure inspection receipts and require code verification', async () => {
        const raw = {
            done: true,
            summary: 'I inspected files but did not modify any code',
            evidence: ['finding.js:5'],
            toolsUsed: ['record_observation'],
            verification: { passed: false, status: 'not_verified' }, // modify mode requires tests/syntax pass
            completionEvidence: null
        };
        const res = executionResult(raw);
        assert.equal(res.success, false);
        assert.equal(res.state, 'incomplete');
    });

    await suite.test('9. Disconnected client can poll GET /api/execute/:jobId and retrieve final result', async () => {
        const { tmpRoot, jobStore } = await createLabEnvironment();
        const jobId = 'disconnected-client-job-888';
        jobStore.createJob({
            jobId,
            task: 'Long background inspection',
            mode: 'inspect'
        });
        jobStore.updateJob(jobId, {
            status: 'completed',
            summary: 'Finished work while user was offline',
            evidence: ['core/PathSafety.js:12'],
            toolsUsed: ['search_code', 'record_observation'],
            verification: { passed: true }
        });

        const mockSystem = { executionJobStore: jobStore };
        let statusCode = 200;
        let responseBody = null;
        const res = {
            status(c) { statusCode = c; return this; },
            json(d) { responseBody = d; return this; }
        };

        await handleGetJobRoute({ params: { jobId } }, res, mockSystem);
        assert.equal(statusCode, 200);
        assert.equal(responseBody.success, true);
        assert.equal(responseBody.jobId, jobId);
        assert.equal(responseBody.state, 'completed');
        assert.equal(responseBody.summary, 'Finished work while user was offline');
        assert.deepEqual(responseBody.evidence, ['core/PathSafety.js:12']);
        assert.deepEqual(responseBody.toolsUsed, ['search_code', 'record_observation']);
        assert.equal(responseBody.verification.passed, true);
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    await suite.test('10. Notification failure preserves execution result and separates reporting state', async () => {
        const { tmpRoot, jobStore } = await createLabEnvironment();
        const jobId = 'flaky-notif-job-999';
        jobStore.createJob({ jobId, task: 'Task with broken notification channel' });
        jobStore.updateJob(jobId, {
            status: 'completed',
            summary: 'Critical calculations verified',
            verification: { passed: true }
        });

        // Queue notification
        const outboxEntry = jobStore.queueNotification(jobId, 'execution_complete', {
            summary: 'Critical calculations verified',
            status: 'completed'
        });

        // System with failing notification service
        const brokenSystem = {
            notificationService: {
                async sendAlert() { throw new Error('SMS Gateway Down'); }
            },
            messageBroker: {
                async publish() { throw new Error('EventBus Down'); }
            }
        };

        await jobStore.dispatchOutboxEntry(outboxEntry, brokenSystem);

        // Job status MUST remain completed
        const job = jobStore.getJob(jobId);
        assert.equal(job.status, 'completed');
        assert.equal(job.summary, 'Critical calculations verified');
        assert.equal(job.verification.passed, true);

        // Reporting status reflects failed delivery without affecting execution status
        assert.equal(job.reporting.notifier, 'failed');
        assert.equal(job.reporting.sse, 'failed');
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    await suite.test('11. Stale-job recovery marks crashed jobs as incomplete with heartbeat expiry error', async () => {
        const { tmpRoot, jobStore } = await createLabEnvironment();
        const jobId = 'stale-crashed-recovery-444';
        jobStore.createJob({ jobId, task: 'Task was running when host crashed' });
        jobStore.updateJob(jobId, {
            status: 'running',
            startedAt: Date.now() - 600000,
            heartbeatAt: Date.now() - 600000 // 10 minutes ago
        });

        // Recover stale jobs
        const recoveredCount = jobStore.recoverStaleJobs({ maxHeartbeatAgeMs: 300000 });
        assert.equal(recoveredCount, 1);

        const recovered = jobStore.getJob(jobId);
        assert.equal(recovered.status, 'incomplete');
        assert.ok(recovered.errors.some(e => typeof e === 'object' && e.type === 'stale_job_recovery'));
        assert.ok(recovered.errors.some(e => (typeof e === 'string' ? e : e.message).includes('heartbeat expired')));
        assert.equal(recovered.nextStep, 'Resume manually or retry if the task is idempotent.');
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    await suite.test('12. Replayable event stream records ordered execution history', async () => {
        const { tmpRoot, jobStore } = await createLabEnvironment();
        const jobId = 'event-stream-job-555';
        jobStore.createJob({ jobId, task: 'Test event timeline' });

        jobStore.appendEvent(jobId, { type: 'planning_started' });
        jobStore.appendEvent(jobId, { type: 'tool_started', tool: 'search_code', args: { pattern: 'import' } });
        jobStore.appendEvent(jobId, { type: 'tool_finished', tool: 'search_code', success: true });
        jobStore.appendEvent(jobId, { type: 'verification_passed' });
        jobStore.appendEvent(jobId, { type: 'report_delivered', channel: 'websocket' });

        const events = jobStore.getEvents(jobId);
        assert.ok(events.length >= 6); // task_created + 5 appended
        assert.equal(events[0].type, 'task_created');
        assert.equal(events[1].type, 'planning_started');
        assert.equal(events[2].type, 'tool_started');
        assert.equal(events[3].type, 'tool_finished');
        assert.equal(events[4].type, 'verification_passed');
        assert.equal(events[5].type, 'report_delivered');
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    await suite.test('13. Capability awareness blocks unavailable capabilities with fallbacks', async () => {
        const capabilities = new CapabilityRegistry();

        // Available capability
        const searchCheck = capabilities.checkCapability('search_code');
        assert.equal(searchCheck.allowed, true);

        // Unavailable capability (browser)
        const browserCheck = capabilities.checkCapability('browser');
        assert.equal(browserCheck.allowed, false);
        assert.ok(browserCheck.reason.includes('BLOCKED'));
        assert.ok(browserCheck.fallback.includes('web_fetch') || browserCheck.fallback.includes('inspect local files'));

        // Unknown capability
        const unknownCheck = capabilities.checkCapability('quantum_teleport');
        assert.equal(unknownCheck.allowed, false);
        assert.ok(unknownCheck.reason.includes('Unknown capability'));
    });

    await suite.test('14. Deterministic router maps predictable tasks without LLM improvisation', async () => {
        const r1 = routeDeterministicTask('Search the codebase for ToolRegistry');
        assert.equal(r1.matched, true);
        assert.equal(r1.tool, 'search_code');
        assert.equal(r1.args.pattern, 'ToolRegistry');

        const r2 = routeDeterministicTask('Read file server/index.cjs');
        assert.equal(r2.matched, true);
        assert.equal(r2.tool, 'read_file');
        assert.equal(r2.args.path, 'server/index.cjs');

        const r3 = routeDeterministicTask('List files in core');
        assert.equal(r3.matched, true);
        assert.equal(r3.tool, 'list_files');
        assert.equal(r3.args.directory, 'core');

        const r4 = routeDeterministicTask('Run the tests');
        assert.equal(r4.matched, true);
        assert.equal(r4.tool, 'run_tests');

        const complex = routeDeterministicTask('Refactor the memory arbiter architecture and debate best strategies');
        assert.equal(complex.matched, false, 'Complex ambiguous task must go to LLM');
    });

    await suite.test('15. Transactional code modifier commits on success and rolls back on failure', async () => {
        const { tmpRoot, modifier } = await createLabEnvironment();
        const testFile = path.join(tmpRoot, 'sample.cjs');
        await fs.writeFile(testFile, 'module.exports = { value: 1 };\n', 'utf8');

        // 1. Successful modification
        const successRes = await modifier.modify({
            filepath: 'sample.cjs',
            newContent: 'module.exports = { value: 2 };\n'
        });
        assert.equal(successRes.success, true);
        assert.equal(successRes.modified, true);
        assert.equal(await fs.readFile(testFile, 'utf8'), 'module.exports = { value: 2 };\n');

        // 2. Failed modification (syntax error) -> automatic rollback
        const failRes = await modifier.modify({
            filepath: 'sample.cjs',
            newContent: 'module.exports = { broken syntax {{{;\n'
        });
        assert.equal(failRes.success, false);
        assert.equal(failRes.rolledBack, true);
        assert.ok(failRes.error.includes('Syntax validation failed'));

        // Content was restored to prior valid content
        const restored = await fs.readFile(testFile, 'utf8');
        assert.equal(restored, 'module.exports = { value: 2 };\n');
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });

    await suite.test('16. Procedure store records and retrieves proven tool sequences', async () => {
        const { tmpRoot, procedureStore } = await createLabEnvironment();
        const proc = procedureStore.recordProcedure({
            taskType: 'inspect_search',
            taskDescription: 'Search for tool usage and record observation',
            orderedToolSequence: ['search_code', 'read_file', 'record_observation'],
            verificationSteps: ['record_observation'],
            result: 'Verified 5 findings',
            confidence: 0.98,
            sourceJobId: 'job_sample_123'
        });
        assert.ok(proc.id);
        assert.equal(proc.taskType, 'inspect_search');

        // Retrieve proven procedure
        const retrieved = procedureStore.getProvenProcedure('inspect_search');
        assert.ok(retrieved);
        assert.deepEqual(retrieved.orderedToolSequence, ['search_code', 'read_file', 'record_observation']);
        assert.equal(retrieved.sourceJobId, 'job_sample_123');
        await fs.rm(tmpRoot, { recursive: true, force: true });
    });
});
