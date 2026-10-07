import fs from 'fs/promises';
import path from 'path';

const DAY = 24 * 60 * 60 * 1000;
const TERMINAL = new Set(['rolled_back', 'rollback_blocked']);

function atomicJson(filePath, value) {
    return fs.mkdir(path.dirname(filePath), { recursive: true })
        .then(() => fs.writeFile(`${filePath}.tmp`, JSON.stringify(value, null, 2), 'utf8'))
        .then(() => fs.rename(`${filePath}.tmp`, filePath));
}

function finite(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function defaultCheckpoints() {
    return [
        { label: '7d', delayMs: 7 * DAY },
        { label: '30d', delayMs: 30 * DAY },
    ];
}

/**
 * Durable outcome ledger for governed self-improvement.
 *
 * The benchmark and governance layers decide whether a candidate may ship. This
 * class answers the longer-term question: did the change keep helping after it
 * shipped, what did it cost, and did the operator have to correct it?
 */
export class ImprovementScorecard {
    constructor({ root = process.cwd(), system = null, checkpoints = defaultCheckpoints(), correctionMinimum = 5 } = {}) {
        this.root = path.resolve(root);
        this.system = system;
        this.statePath = path.join(this.root, 'data', 'self-evolution', 'improvement-scorecard.json');
        this.checkpoints = checkpoints
            .map(item => ({ label: String(item.label), delayMs: Math.max(0, finite(item.delayMs, 0)) }))
            .sort((a, b) => a.delayMs - b.delayMs);
        this.correctionMinimum = Math.max(1, finite(correctionMinimum, 5));
        this.state = { schemaVersion: 1, records: [], experiments: [], updatedAt: null };
        this._timer = null;
        this._busy = false;
    }

    async initialize(system = this.system) {
        this.system = system || this.system;
        try {
            const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (parsed?.schemaVersion === 1) this.state = parsed;
        } catch { /* first run */ }
        await this.syncPromotions();
        this._timer = setInterval(() => this.reconcileDue().catch(error => {
            console.warn(`[ImprovementScorecard] checkpoint reconciliation failed: ${error.message}`);
        }), 60_000);
        this._timer.unref?.();
        return this;
    }

    async syncPromotions() {
        for (const promotion of this.system?.selfModificationGovernance?.records || []) {
            await this.registerPromotion(promotion, { persist: false });
        }
        await this._persist();
    }

    async registerPromotion(promotion, { persist = true } = {}) {
        if (!promotion?.id) return null;
        let record = this.state.records.find(item => item.id === promotion.id);
        if (!record) {
            record = {
                id: promotion.id,
                kind: promotion.kind || 'code',
                files: promotion.files || [],
                commit: promotion.commit || null,
                promotedAt: promotion.promotedAt || new Date().toISOString(),
                status: promotion.status || 'probation',
                acceptedAt: promotion.acceptedAt || null,
                baseline: promotion.baseline || null,
                capabilityContract: promotion.capabilityContract || null,
                resourcesBaseline: this._resourceSnapshot(),
                checkpoints: [],
                feedback: { total: 0, corrections: 0, positive: 0, ratingSum: 0, comments: [] },
            };
            this.state.records.push(record);
        } else {
            record.status = promotion.status || record.status;
            record.acceptedAt = promotion.acceptedAt || record.acceptedAt;
            record.rollbackReason = promotion.rollbackReason || record.rollbackReason;
        }
        if (persist) await this._persist();
        return record;
    }

    async registerExperiment(experiment) {
        if (!experiment?.id) return null;
        let entry = this.state.experiments.find(item => item.id === experiment.id);
        if (!entry) {
            entry = {
                id: experiment.id,
                cycleId: experiment.cycleId,
                domain: experiment.domain,
                openedAt: experiment.openedAt,
                state: experiment.state,
                baseline: experiment.baseline,
                target: experiment.target,
                candidatePolicy: 'diagnosis_then_candidate_plus_independent_canary',
            };
            this.state.experiments.push(entry);
        }
        await this._persist();
        return entry;
    }

    async recordExperimentEvaluation(experiment) {
        const entry = await this.registerExperiment(experiment);
        Object.assign(entry, {
            state: experiment.state,
            decision: experiment.decision,
            candidate: experiment.candidate,
            comparison: experiment.comparison,
            operationalComparison: experiment.operationalComparison,
            promotionIds: experiment.governancePromotions || [],
            evaluatedAt: experiment.updatedAt || new Date().toISOString(),
        });
        await this._persist();
        return entry;
    }

    async recordProbationResult(promotion, { snapshot = null, comparison = null, contractResult = null } = {}) {
        const record = await this.registerPromotion(promotion, { persist: false });
        record.status = promotion.status;
        record.acceptedAt = promotion.acceptedAt || record.acceptedAt;
        record.rollbackReason = promotion.rollbackReason || null;
        this._upsertCheckpoint(record, {
            label: 'probation',
            dueAt: promotion.probationEndsAt,
            checkedAt: new Date().toISOString(),
            passed: promotion.status === 'accepted',
            snapshot,
            comparison,
            contractResult,
            resources: this._resourceDelta(record.resourcesBaseline),
            action: promotion.status === 'accepted' ? 'accepted' : promotion.status,
        });
        await this._persist();
        return record;
    }

    async recordFeedback({ promotionId = null, corrected = false, rating = null, comment = null, source = 'chat' } = {}) {
        const record = promotionId
            ? this.state.records.find(item => item.id === promotionId)
            : [...this.state.records].reverse().find(item => ['probation', 'accepted'].includes(item.status)
                && !item.checkpoints?.some(checkpoint => checkpoint.label === '30d' && checkpoint.completed !== false));
        if (!record) return { attributed: false, reason: 'no_active_or_accepted_promotion' };
        const feedback = record.feedback || (record.feedback = { total: 0, corrections: 0, positive: 0, ratingSum: 0, comments: [] });
        feedback.total += 1;
        if (corrected) feedback.corrections += 1;
        if (finite(rating) > 0) feedback.positive += 1;
        if (finite(rating) !== null) feedback.ratingSum += finite(rating, 0);
        if (comment) feedback.comments = [...feedback.comments, { at: new Date().toISOString(), source, comment: String(comment).slice(0, 1000) }].slice(-20);
        feedback.correctionRate = feedback.corrections / Math.max(1, feedback.total);
        await this._persist();
        return { attributed: true, promotionId: record.id, feedback };
    }

    async reconcileDue({ now = Date.now() } = {}) {
        if (this._busy) return [];
        this._busy = true;
        try {
            const results = [];
            for (const record of this.state.records) {
                if (record.status !== 'accepted' || !record.acceptedAt) continue;
                for (const checkpoint of this.checkpoints) {
                    if (record.checkpoints?.some(item => item.label === checkpoint.label && item.completed !== false)) continue;
                    const dueAt = Date.parse(record.acceptedAt) + checkpoint.delayMs;
                    if (dueAt > now) continue;
                    results.push(await this.evaluateCheckpoint(record.id, checkpoint.label, { dueAt }));
                }
            }
            return results;
        } finally {
            this._busy = false;
        }
    }

    async evaluateCheckpoint(id, label, { dueAt = Date.now() } = {}) {
        const record = this.state.records.find(item => item.id === id);
        if (!record) throw new Error(`Unknown improvement scorecard record: ${id}`);
        const snapshot = await this.system?.benchmark?.snapshot?.().catch(() => null) || null;
        const comparison = record.baseline && snapshot && this.system?.benchmark?.compare
            ? this.system.benchmark.compare(record.baseline, snapshot) : null;
        const feedback = record.feedback || {};
        const correctionFailure = Number(feedback.total || 0) >= this.correctionMinimum
            && Number(feedback.correctionRate || 0) > 0.5;
        const benchmarkFailure = comparison?.valid === true
            && (Number(comparison.delta || 0) < -0.02 || (comparison.regressed?.length || 0) > 1);
        const completed = comparison?.valid === true;
        const passed = completed && !benchmarkFailure && !correctionFailure;
        const reason = correctionFailure ? 'human_correction_rate_exceeded'
            : benchmarkFailure ? 'long_term_benchmark_regression'
                : comparison?.valid ? null : 'benchmark_unavailable';
        const automaticRollbackEligible = this._isLatestPromotion(record);
        let action = !completed ? 'deferred' : passed ? 'retained' : 'review_required';
        if (!passed && completed && (benchmarkFailure || correctionFailure) && automaticRollbackEligible && this.system?.selfModificationGovernance?.rollbackPromotion) {
            const result = await this.system.selfModificationGovernance.rollbackPromotion(id, `${label}:${reason}`);
            record.status = result.status;
            record.rollbackReason = result.rollbackReason;
            action = result.status;
        }
        const checkpoint = {
            label,
            dueAt: new Date(dueAt).toISOString(),
            checkedAt: new Date().toISOString(),
            completed,
            passed,
            reason,
            snapshot,
            comparison,
            resources: this._resourceDelta(record.resourcesBaseline),
            feedback: { ...feedback },
            automaticRollbackEligible,
            action,
        };
        this._upsertCheckpoint(record, checkpoint);
        await this._persist();
        return checkpoint;
    }

    getStatus() {
        const records = this.state.records;
        const accepted = records.filter(item => item.status === 'accepted');
        const survived7d = records.filter(item => item.checkpoints?.some(cp => cp.label === '7d' && cp.passed)).length;
        const survived30d = records.filter(item => item.checkpoints?.some(cp => cp.label === '30d' && cp.passed)).length;
        const feedback = records.reduce((out, item) => {
            out.total += Number(item.feedback?.total || 0);
            out.corrections += Number(item.feedback?.corrections || 0);
            return out;
        }, { total: 0, corrections: 0 });
        return {
            schemaVersion: 1,
            summary: {
                totalPromotions: records.length,
                inProbation: records.filter(item => item.status === 'probation').length,
                accepted: accepted.length,
                rolledBack: records.filter(item => item.status === 'rolled_back').length,
                survived7d,
                survived30d,
                humanCorrections: feedback.corrections,
                feedbackCount: feedback.total,
                correctionRate: feedback.corrections / Math.max(1, feedback.total),
            },
            records: records.slice(-25).reverse(),
            experiments: this.state.experiments.slice(-25).reverse(),
            updatedAt: this.state.updatedAt,
        };
    }

    _resourceSnapshot() {
        const gateway = this.system?.deepseekGateway?.getStatus?.() || this.system?.deepSeekGateway?.getStatus?.() || null;
        const cost = this.system?.costLedger?.getStatus?.() || gateway?.cost || gateway?.ledger || null;
        const cluster = this.system?.maintenanceBridge?.getClusterStatus?.() || null;
        const local = this.system?.localModelServer?.getStatus?.() || null;
        return {
            capturedAt: new Date().toISOString(),
            cloudSpend: finite(cost?.monthlySpent ?? cost?.dailySpent, null),
            cloudCalls: finite(cost?.recentCalls?.length ?? gateway?.recentBackground?.calls, null),
            localCompleted: finite(local?.metrics?.totalInferences
                ?? cluster?.coordinator?.totalTasksCompleted ?? cluster?.totalTasksCompleted, null),
        };
    }

    _resourceDelta(baseline) {
        const current = this._resourceSnapshot();
        const delta = (key) => finite(current[key]) !== null && finite(baseline?.[key]) !== null
            ? finite(current[key]) - finite(baseline[key]) : null;
        const local = delta('localCompleted');
        const cloud = delta('cloudCalls');
        return {
            ...current,
            cloudSpendDelta: delta('cloudSpend'),
            cloudCallsDelta: cloud,
            localCompletedDelta: local,
            localExecutionRatio: local !== null && cloud !== null ? local / Math.max(1, local + cloud) : null,
        };
    }

    _isLatestPromotion(record) {
        const eligible = this.state.records
            .filter(item => !TERMINAL.has(item.status) && item.kind === 'code')
            .sort((a, b) => Date.parse(b.promotedAt) - Date.parse(a.promotedAt));
        return eligible[0]?.id === record.id;
    }

    _upsertCheckpoint(record, checkpoint) {
        record.checkpoints = record.checkpoints || [];
        const index = record.checkpoints.findIndex(item => item.label === checkpoint.label);
        if (index >= 0) record.checkpoints[index] = checkpoint;
        else record.checkpoints.push(checkpoint);
    }

    async _persist() {
        this.state.records = this.state.records.slice(-500);
        this.state.experiments = this.state.experiments.slice(-500);
        this.state.updatedAt = new Date().toISOString();
        await atomicJson(this.statePath, this.state);
    }
}

export default ImprovementScorecard;
