import crypto from 'node:crypto';
import { ExecutionJobStore } from '../../core/ExecutionJobStore.js';
import { executionResult } from '../../core/ExecutionProtocol.js';
import { requireSelfModificationOperatorAuth } from '../loaders/authMiddleware.js';

// Every mount, including /chat?execute, uses the same operator boundary.
export function authorizeExecution(req, res, next) {
    return requireSelfModificationOperatorAuth(req, res, next);
}

function getJobStore(system) {
    if (system?.executionJobStore) return system.executionJobStore;
    const store = new ExecutionJobStore();
    if (system) system.executionJobStore = store;
    return store;
}

export async function handleExecuteRoute(req, res, system) {
    try {
        const { task, mode = 'inspect' } = req.body || {};
        if (!task || typeof task !== 'string' || !task.trim()) {
            return res.status(400).json({ success: false, error: 'task must be a non-empty string' });
        }
        if (task.length > 12000) return res.status(413).json({ success: false, error: 'task exceeds 12000 characters' });
        if (mode !== 'inspect') return res.status(400).json({ success: false, error: 'This endpoint supports inspect mode only. Use the existing governed engineering workflow for changes.' });
        const executor = system?.agenticExecutor;
        if (!executor || typeof executor.execute !== 'function') {
            return res.status(503).json({ success: false, error: 'SomaAgenticExecutor is not available' });
        }

        // Every request here is authenticated and inspect-only. A general
        // read-only inspection is just as safe to isolate as a simple read.
        const canForkInspection = executor._executionActive && typeof executor.forkReadOnlyInspection === 'function';
        if (executor._executionActive && !canForkInspection) return res.status(409).json(executionResult({ state: 'blocked', stopReason: 'executor_busy', error: 'Another execution is active.' }));
        const executionHost = canForkInspection ? executor.forkReadOnlyInspection() : executor;
        const safeMode = 'inspect';
        const jobId = crypto.randomUUID();
        const jobStore = getJobStore(system);

        const job = jobStore.createJob({
            jobId,
            task: task.trim(),
            mode: safeMode,
            source: 'api_execute',
            metadata: { operatorAuthenticated: Boolean(req.somaOperatorAuth) }
        });

        const goal = {
            id: jobId,
            title: task.trim().slice(0, 180),
            description: task.trim(),
            source: 'api_execute',
            priority: 90,
            successCriteria: [
                safeMode === 'inspect'
                    ? 'Inspect requested sources and record verified findings'
                    : safeMode === 'modify'
                        ? 'Produce verified code modifications with passing tests'
                        : 'Execute the requested task using tools',
                'Return evidence-backed completion results'
            ],
            metadata: {
                executionMode: safeMode,
                jobManaged: true,
                jobId
            }
        };

        const isSync = req.body?.sync === true ||
            req.query?.sync === 'true' ||
            process.env.SOMA_EXECUTE_SYNC === 'true';

        const runJob = async () => {
            try {
                jobStore.updateJob(jobId, { status: 'running' });
                jobStore.queueNotification(jobId, 'execution_started', {
                    jobId,
                    status: 'running',
                    task: job.task,
                    mode: safeMode
                });
                await jobStore.flushOutbox(system).catch(() => {});

                const raw = await executionHost.execute(goal, { signal: req.signal });
                const result = executionResult({ ...raw, done: raw.done ?? (raw.state === 'completed' && raw.success === true) });
                const passed = result.success === true;
                const terminalStatus = passed ? 'completed' : (result.state || 'failed');
                const eventType = terminalStatus === 'completed'
                    ? 'execution_complete'
                    : terminalStatus === 'blocked'
                        ? 'execution_blocked'
                        : 'execution_failed';

                const updated = jobStore.updateJob(jobId, {
                    status: terminalStatus,
                    stopReason: result.stopReason || (passed ? 'verified' : 'unverified'),
                    summary: result.summary || result.result || '',
                    result: result.result || result.summary || '',
                    evidence: result.evidence || [],
                    toolsUsed: result.toolsUsed || [],
                    iterations: result.iterations || 0,
                    totalIterations: result.totalIterations ?? result.iterations ?? 0,
                    continuationFile: result.continuationFile || null,
                    verification: result.verification || { passed },
                    errors: result.errors || [],
                    nextStep: result.nextStep || null
                });

                jobStore.queueNotification(jobId, eventType, {
                    jobId,
                    status: terminalStatus,
                    stopReason: updated.stopReason,
                    summary: updated.summary,
                    result: updated.result,
                    evidence: updated.evidence,
                    verification: updated.verification
                });
                await jobStore.flushOutbox(system).catch(() => {});
                return updated;
            } catch (error) {
                const updated = jobStore.updateJob(jobId, {
                    status: 'failed',
                    stopReason: 'execution_exception',
                    errors: [error.message],
                    summary: `Execution threw error: ${error.message}`,
                    result: `Execution threw error: ${error.message}`
                });
                jobStore.queueNotification(jobId, 'execution_failed', {
                    jobId,
                    status: 'failed',
                    error: error.message
                });
                await jobStore.flushOutbox(system).catch(() => {});
                return updated;
            }
        };

        if (isSync) {
            await runJob();
            const finalJob = jobStore.getJob(jobId);
            const passed = finalJob.status === 'completed' && finalJob.verification?.passed === true;
            const httpStatus = finalJob.status === 'failed' ? 500 : finalJob.status === 'blocked' ? 409 : 200;
            return res.status(httpStatus).json({
                success: passed,
                jobId: finalJob.jobId,
                state: finalJob.status,
                stopReason: finalJob.stopReason || (passed ? 'verified' : 'unverified'),
                summary: finalJob.summary,
                result: finalJob.result,
                evidence: finalJob.evidence,
                toolsUsed: finalJob.toolsUsed,
                iterations: finalJob.iterations,
                totalIterations: finalJob.totalIterations,
                continuationFile: finalJob.continuationFile,
                verification: finalJob.verification,
                errors: finalJob.errors,
                nextStep: finalJob.nextStep
            });
        }

        // Async mode: dispatch runner to background and return jobId immediately
        setImmediate(() => {
            runJob().catch(err => {
                console.error(`[ExecuteRoute] Background execution failed for ${jobId}:`, err);
            });
        });

        return res.status(202).json({
            success: false,
            accepted: true,
            jobId: job.jobId,
            status: 'queued',
            task: job.task,
            mode: job.mode,
            createdAt: job.createdAt,
            pollUrl: `/api/execute/${job.jobId}`
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function handleGetJobRoute(req, res, system) {
    try {
        const { jobId } = req.params;
        if (!jobId) {
            return res.status(400).json({ success: false, error: 'jobId is required' });
        }
        const jobStore = getJobStore(system);
        const job = jobStore.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: `Job ${jobId} not found` });
        }
        const passed = job.status === 'completed' && job.verification?.passed === true;
        return res.json({
            success: passed,
            jobId: job.jobId,
            state: job.status,
            status: job.status,
            stopReason: job.stopReason || null,
            iterations: job.iterations || 0,
            totalIterations: job.totalIterations || 0,
            continuationFile: job.continuationFile || null,
            task: job.task,
            mode: job.mode,
            summary: job.summary || job.result || '',
            result: job.result || job.summary || '',
            evidence: job.evidence || [],
            toolsUsed: job.toolsUsed || [],
            toolResults: job.toolResults || [],
            verification: job.verification || { passed },
            errors: job.errors || [],
            nextStep: job.nextStep || null,
            reporting: job.reporting || {
                websocket: 'pending',
                sse: 'pending',
                notifier: 'pending',
                discord: 'pending'
            },
            events: job.events || [],
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            durationMs: job.durationMs,
            job // Backwards compatibility for existing tests referencing body.job
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function handleListJobsRoute(req, res, system) {
    try {
        const jobStore = getJobStore(system);
        const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit || '50', 10)));
        const status = req.query?.status || null;
        const jobs = jobStore.listJobs({ limit, status });
        return res.json({ success: true, count: jobs.length, jobs });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export default handleExecuteRoute;
