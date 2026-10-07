import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ImprovementScorecard } from '../core/ImprovementScorecard.js';

const roots = [];
afterEach(async () => {
    while (roots.length) await fs.rm(roots.pop(), { recursive: true, force: true });
});

async function fixture({ comparison = { valid: true, delta: 0.05, regressed: [] } } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-improvement-scorecard-'));
    roots.push(root);
    const rolledBack = [];
    const promotion = {
        id: 'promotion-1', kind: 'code', files: ['core/example.js'], commit: 'abc123', status: 'accepted',
        promotedAt: new Date(Date.now() - 1000).toISOString(), acceptedAt: new Date(Date.now() - 1000).toISOString(),
        baseline: { schemaVersion: 2, composite: 0.7, scores: { task: 0.7 } },
    };
    const system = {
        benchmark: {
            async snapshot() { return { schemaVersion: 2, composite: 0.75, scores: { task: 0.75 } }; },
            compare() { return comparison; },
        },
        selfModificationGovernance: {
            records: [promotion],
            async rollbackPromotion(id, reason) {
                rolledBack.push({ id, reason });
                promotion.status = 'rolled_back';
                promotion.rollbackReason = reason;
                return promotion;
            },
        },
    };
    const scorecard = new ImprovementScorecard({ root, system, checkpoints: [{ label: '7d', delayMs: 0 }] });
    await scorecard.initialize();
    return { root, system, scorecard, promotion, rolledBack };
}

describe('durable self-improvement scorecard', () => {
    it('persists feedback and records a passing long-term survival checkpoint', async () => {
        const { root, scorecard } = await fixture();
        await scorecard.recordFeedback({ corrected: false, rating: 1, comment: 'kept helping' });
        const [checkpoint] = await scorecard.reconcileDue();
        assert.equal(checkpoint.label, '7d');
        assert.equal(checkpoint.passed, true);
        assert.equal(checkpoint.action, 'retained');
        assert.equal(scorecard.getStatus().summary.survived7d, 1);
        const persisted = JSON.parse(await fs.readFile(path.join(root, 'data', 'self-evolution', 'improvement-scorecard.json'), 'utf8'));
        assert.equal(persisted.records[0].feedback.total, 1);
        clearInterval(scorecard._timer);
    });

    it('rolls back the latest attributable promotion after measured long-term regression', async () => {
        const { scorecard, rolledBack } = await fixture({ comparison: { valid: true, delta: -0.08, regressed: [{ domain: 'task' }, { domain: 'memory' }] } });
        const [checkpoint] = await scorecard.reconcileDue();
        assert.equal(checkpoint.passed, false);
        assert.equal(checkpoint.action, 'rolled_back');
        assert.deepEqual(rolledBack, [{ id: 'promotion-1', reason: '7d:long_term_benchmark_regression' }]);
        clearInterval(scorecard._timer);
    });

    it('flags an older promotion for review instead of falsely attributing a newer regression', async () => {
        const { scorecard, system, rolledBack } = await fixture({ comparison: { valid: true, delta: -0.08, regressed: [{ domain: 'task' }, { domain: 'memory' }] } });
        const newer = {
            id: 'promotion-2', kind: 'code', files: ['core/newer.js'], status: 'accepted',
            promotedAt: new Date().toISOString(), acceptedAt: new Date().toISOString(), baseline: { composite: 0.7, scores: {} },
        };
        system.selfModificationGovernance.records.push(newer);
        await scorecard.registerPromotion(newer);
        const checkpoint = await scorecard.evaluateCheckpoint('promotion-1', 'operator');
        assert.equal(checkpoint.action, 'review_required');
        assert.equal(checkpoint.automaticRollbackEligible, false);
        assert.equal(rolledBack.length, 0);
        clearInterval(scorecard._timer);
    });

    it('defers without rollback when a checkpoint has no valid benchmark evidence', async () => {
        const { scorecard, rolledBack } = await fixture({ comparison: { valid: false, delta: 0, regressed: [] } });
        const [checkpoint] = await scorecard.reconcileDue();
        assert.equal(checkpoint.completed, false);
        assert.equal(checkpoint.action, 'deferred');
        assert.equal(rolledBack.length, 0);
        clearInterval(scorecard._timer);
    });
});
