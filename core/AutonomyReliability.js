import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_EVENTS = 1500;

async function atomicJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporary, filePath);
}

function ratio(numerator, denominator) { return denominator ? numerator / denominator : 0; }

/** Evidence-backed service levels for autonomy, recovery, and truthful completion. */
export class AutonomyReliability {
    constructor({ statePath = 'data/reality-loop/autonomy-reliability.json', now = () => Date.now() } = {}) {
        this.statePath = path.resolve(statePath);
        this.now = now;
        this.state = { schemaVersion: 1, events: [], updatedAt: null };
        this._writeChain = Promise.resolve();
    }

    async initialize() {
        try {
            const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (parsed?.schemaVersion === 1) this.state = parsed;
        } catch { /* first boot */ }
        this.state.events = Array.isArray(this.state.events) ? this.state.events.slice(-MAX_EVENTS) : [];
        return this;
    }

    async recordTransaction(transaction = {}) {
        const observed = transaction.observed || {};
        return this.record({
            type: 'transaction', id: transaction.id, at: transaction.finishedAt || this.now(),
            domain: transaction.classification?.domain || 'general', lane: transaction.classification?.lane || 'unknown',
            success: observed.success === true, verified: observed.verified === true,
            falseSuccess: transaction.classification?.lane !== 'inference' && observed.success === true && observed.verified !== true,
            failed: Boolean(transaction.error) || observed.success === false,
            durationMs: transaction.durationMs || 0,
            userDirected: transaction.input?.forceAgentic === true,
            signature: transaction.procedureCase?.patternId || null
        });
    }

    async recordGoal(goal = {}, receipt = null) {
        const receiptLifecycle = receipt?.lifecycle || receipt?.lifecycleState || null;
        const status = String(goal.status || receiptLifecycle || 'unknown');
        const verified = status === 'completed' && (
            receipt?.completionEvidence?.passed === true
            || receipt?.verified === true
            || receiptLifecycle === 'completed'
        );
        return this.record({
            type: 'goal', id: goal.id, at: Number(goal.completedAt || goal.updatedAt || this.now()),
            domain: goal.category || goal.type || 'general', status,
            success: status === 'completed', verified,
            failed: ['failed', 'broken', 'blocked', 'verification_failed', 'abandoned'].includes(status),
            falseSuccess: status === 'completed' && !verified,
            attempts: Number(receipt?.attempts || goal.attempts || goal.metrics?.attempts || 1),
            durationMs: Number(receipt?.durationMs || 0),
            userDirected: goal.metadata?.userDirected === true || ['user', 'discord', 'discord_admin'].includes(goal.source || goal.metadata?.source),
            signature: goal.metadata?.procedurePatternId || null
        });
    }

    async recordTrial(run = {}) {
        return this.record({
            type: 'capability_trial', id: run.id, at: Date.parse(run.updatedAt || run.createdAt) || this.now(),
            domain: run.trialId || 'capability', status: run.state,
            success: Boolean(run.terminal && Number(run.score?.value || 0) >= 70),
            verified: Boolean(run.terminal && run.score), failed: Boolean(run.terminal && Number(run.score?.value || 0) < 70),
            falseSuccess: false, attempts: 1, durationMs: 0, userDirected: run.requestedBy === 'operator', signature: run.trialId
        });
    }

    async record(event) {
        const value = { ...event, at: Number(event.at || this.now()) };
        this.state.events.push(value);
        this.state.events = this.state.events.slice(-MAX_EVENTS);
        this.state.updatedAt = this.now();
        this._writeChain = this._writeChain.catch(() => {}).then(() => atomicJson(this.statePath, this.state));
        await this._writeChain;
        return value;
    }

    dashboard({ window = 200 } = {}) {
        const events = this.state.events.slice(-Math.max(10, Number(window) || 200));
        const actionable = events.filter(item => item.type !== 'transaction' || item.lane !== 'inference');
        const terminal = actionable.filter(item => item.success || item.failed || item.status === 'completed');
        const failures = terminal.filter(item => item.failed);
        const verified = terminal.filter(item => item.verified);
        const recoveredSignatures = new Set();
        const failedSignatures = new Set(failures.map(item => item.signature).filter(Boolean));
        for (const item of terminal) if (item.verified && item.signature && failedSignatures.has(item.signature)) recoveredSignatures.add(item.signature);
        const attempts = terminal.map(item => Number(item.attempts || 1));
        const half = Math.floor(terminal.length / 2);
        const earlier = terminal.slice(0, half), recent = terminal.slice(half);
        const verifiedRate = list => ratio(list.filter(item => item.verified).length, list.length);
        const metrics = {
            terminalOutcomes: terminal.length,
            completionRate: ratio(terminal.filter(item => item.success).length, terminal.length),
            verificationRate: ratio(verified.length, terminal.length),
            recoveryRate: ratio(recoveredSignatures.size, failedSignatures.size),
            falseSuccessRate: ratio(terminal.filter(item => item.falseSuccess).length, terminal.length),
            userInterventionRate: ratio(terminal.filter(item => item.userDirected).length, terminal.length),
            averageAttempts: attempts.length ? attempts.reduce((sum, value) => sum + value, 0) / attempts.length : 0,
            verifiedTrend: verifiedRate(recent) - verifiedRate(earlier)
        };
        const objectives = {
            completionRate: { target: 0.8, value: metrics.completionRate, passing: metrics.completionRate >= 0.8 },
            verificationRate: { target: 0.95, value: metrics.verificationRate, passing: metrics.verificationRate >= 0.95 },
            recoveryRate: { target: 0.6, value: metrics.recoveryRate, passing: metrics.recoveryRate >= 0.6 },
            falseSuccessRate: { target: 0.02, comparison: 'maximum', value: metrics.falseSuccessRate, passing: metrics.falseSuccessRate <= 0.02 }
        };
        return { generatedAt: this.now(), metrics, objectives, passing: Object.values(objectives).every(item => item.passing), recent: events.slice(-20) };
    }

    getStatus() { return { events: this.state.events.length, updatedAt: this.state.updatedAt, dashboard: this.dashboard() }; }
}

export default AutonomyReliability;
