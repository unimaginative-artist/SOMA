import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const TERMINAL = new Set(['completed', 'failed', 'blocked', 'incomplete', 'cancelled']);

function compactError(error) {
    return redactBacktestText(error?.message || error || 'unknown error').slice(0, 400);
}

export function redactBacktestText(value) {
    return String(value || '')
        .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/gi, '[redacted]')
        .replace(/\b((?:api[_ -]?key|secret(?:_key)?|access[_ -]?token)\s*[:=]\s*)\S+/gi, '$1[redacted]');
}

export function findChannelBeeBacktest(store, channelId, messageId = null) {
    const jobs = store?.listJobs?.({ limit: 100 }) || [];
    return jobs.find(job => job.metadata?.taskKind === 'bee_paper_backtest'
        && (messageId ? job.metadata?.sourceMessageId === messageId
            : job.metadata?.sourceChannelId === channelId && !TERMINAL.has(job.status))) || null;
}

export function queueBreezyBacktest({ store, registry, request, channelId, messageId, onTerminal = async () => {} }) {
    if (!store?.createJob || !store?.updateJob || !registry?.execute) throw new Error('Persistent job store or ToolRegistry unavailable');
    const existing = findChannelBeeBacktest(store, channelId, messageId);
    if (existing) return { job: existing, run: Promise.resolve(existing), duplicate: true };
    const experimentId = crypto.randomUUID();
    const job = store.createJob({
        jobId: crypto.randomUUID(), task: redactBacktestText(request), mode: 'paper_backtest', source: 'discord',
        metadata: {
            taskKind: 'bee_paper_backtest', experimentId,
            sourceMessageId: messageId, sourceChannelId: channelId,
            authorization: {
                authorized: true, mode: 'paper_backtest', modificationsAllowed: false,
                approvalRequiredFor: ['modify_active_strategy', 'live_trading', 'deployment', 'spend_money']
            },
            credential: { provider: 'none', credential: 'not_required', keyExposed: false }
        }
    });
    const run = (async () => {
        try {
            store.updateJob(job.jobId, { status: 'executing', summary: 'Running bounded paper-backtest research; active trading is unchanged.' });
            store.appendEvent(job.jobId, { type: 'tool_started', tool: 'bee_paper_backtest', experimentId });
            const result = await registry.execute('bee_paper_backtest', { jobId: job.jobId, experimentId }, {
                actor: 'DiscordOperator', authorityTier: 'frontier', sessionId: job.jobId,
                sessionKind: 'paper-backtest', goalId: job.jobId
            });
            store.appendEvent(job.jobId, { type: 'tool_finished', tool: 'bee_paper_backtest', success: true, experimentId });
            store.updateJob(job.jobId, { status: 'verifying' });
            const artifact = await fs.readFile(result.artifactPath);
            const digest = crypto.createHash('sha256').update(artifact).digest('hex');
            if (!result.verification?.passed || digest !== result.artifactSha256) throw new Error('Backtest artifact or checksum verification failed');
            const completed = store.updateJob(job.jobId, {
                status: 'completed', summary: result.summary, result: result.summary,
                evidence: [result.contractPath, result.artifactPath, result.stepsPath, result.artifactSha256],
                toolsUsed: ['bee_paper_backtest'], verification: { passed: true, checks: ['baseline_and_candidates', 'chronological_out_of_sample', 'artifact_readback', 'checksum'] },
                metadata: { ...store.getJob(job.jobId)?.metadata, experimentId, contractPath: result.contractPath, artifactPath: result.artifactPath, stepsPath: result.stepsPath, promotionEligible: false },
                nextStep: 'Review the proxy comparison. A faithful Laya/OKX replay requires historical decisions and funding data before any deployment decision.'
            });
            await onTerminal(completed, result).catch(() => {});
            return completed;
        } catch (error) {
            const reason = compactError(error);
            store.appendEvent(job.jobId, { type: 'tool_finished', tool: 'bee_paper_backtest', success: false, error: reason, experimentId });
            const failed = store.updateJob(job.jobId, {
                status: 'failed', stopReason: 'backtest_execution_failed', summary: `Paper backtest failed: ${reason}`,
                errors: [reason], verification: { passed: false, checks: [] },
                nextStep: 'Check the historical-cache provenance and backtest step receipt, then retry a bounded paper experiment. No active strategy was changed.'
            });
            await onTerminal(failed, null).catch(() => {});
            return failed;
        }
    })();
    return { job, run, duplicate: false };
}
