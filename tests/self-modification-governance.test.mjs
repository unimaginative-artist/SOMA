import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SelfModificationGovernance } from '../core/SelfModificationGovernance.js';
import { VersionedArtifactRegistry } from '../core/VersionedArtifactRegistry.js';
import { requireSelfModificationOperatorAuth } from '../server/loaders/authMiddleware.js';
import { evaluateCapabilityContract, normalizeCapabilityContract } from '../core/SelfModificationCapabilityContract.js';
import { IsolatedCandidateRunner } from '../core/IsolatedCandidateRunner.js';

describe('persistent self-modification governance', () => {
    let root;
    let governance;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-governance-test-'));
        execFileSync('git', ['init'], { cwd: root });
        execFileSync('git', ['config', 'user.email', 'redacted@example.com'], { cwd: root });
        execFileSync('git', ['config', 'user.name', 'SOMA Test'], { cwd: root });
        await fs.writeFile(path.join(root, 'candidate.js'), 'export const value = 1;\n');
        execFileSync('git', ['add', 'candidate.js'], { cwd: root });
        execFileSync('git', ['commit', '-m', 'baseline'], { cwd: root });
        const benchmark = {
            async snapshot() { return { schemaVersion: 2, composite: 0.7, scores: {} }; },
            compare() { return { valid: true, delta: 0, regressed: [] }; },
        };
        governance = new SelfModificationGovernance({
            root,
            probationMs: 60_000,
            system: { benchmark, selfModPipeline: {}, engineeringSwarm: {}, nemesis: {}, causality: { async recordIntervention() {} } },
        });
        await governance.initialize();
    });

    afterEach(async () => {
        clearInterval(governance?._timer);
        await fs.rm(root, { recursive: true, force: true });
    });

    it('refuses to absorb pre-existing dirty target files', async () => {
        await fs.writeFile(path.join(root, 'candidate.js'), 'export const value = 2;\n');
        await assert.rejects(
            governance.preflight({ proposalId: 'dirty', files: ['candidate.js'] }),
            /already had uncommitted work/
        );
    });

    it('validates in an isolated worktree, commits only reviewed files, and can persistently revert', async () => {
        const preflight = await governance.preflight({ proposalId: 'safe-change', files: ['candidate.js'] });
        await fs.writeFile(path.join(root, 'candidate.js'), 'export const value = 2;\n');
        const isolated = await governance.validateInWorktree({ proposalId: 'safe-change', files: ['candidate.js'] });
        assert.equal(isolated.isolated, true);
        const promoted = await governance.promote({ proposalId: 'safe-change', files: ['candidate.js'], baseline: preflight.baseline, sandbox: isolated });
        assert.equal(promoted.status, 'probation');
        assert.equal(execFileSync('git', ['show', 'HEAD:candidate.js'], { cwd: root, encoding: 'utf8' }), 'export const value = 2;\n');
        const rolledBack = await governance.operatorRollback('safe-change', 'test');
        assert.equal(rolledBack.status, 'rolled_back');
        assert.equal(execFileSync('git', ['show', 'HEAD:candidate.js'], { cwd: root, encoding: 'utf8' }), 'export const value = 1;\n');
    });

    it('can govern a delayed rollback after a promotion was initially accepted', async () => {
        const preflight = await governance.preflight({ proposalId: 'late-regression', files: ['candidate.js'] });
        await fs.writeFile(path.join(root, 'candidate.js'), 'export const value = 9;\n');
        await governance.promote({ proposalId: 'late-regression', files: ['candidate.js'], baseline: preflight.baseline });
        const accepted = await governance.evaluateProbation('late-regression');
        assert.equal(accepted.status, 'accepted');
        const rolledBack = await governance.rollbackPromotion('late-regression', '7d:regression');
        assert.equal(rolledBack.status, 'rolled_back');
        assert.equal(rolledBack.rollbackReason, '7d:regression');
        assert.equal(execFileSync('git', ['show', 'HEAD:candidate.js'], { cwd: root, encoding: 'utf8' }), 'export const value = 1;\n');
    });

    it('detects governance ledger tampering', async () => {
        await governance.appendLedger('test_event', { safe: true });
        const ledgerPath = path.join(root, 'data', 'self-modification', 'governance-ledger.jsonl');
        const rows = (await fs.readFile(ledgerPath, 'utf8')).trim().split(/\r?\n/);
        const first = JSON.parse(rows[0]);
        first.metadata.safe = false;
        rows[0] = JSON.stringify(first);
        await fs.writeFile(ledgerPath, `${rows.join('\n')}\n`);
        assert.equal((await governance.verifyLedger()).valid, false);
    });

    it('versions non-code artifacts by content hash and supports pointer rollback', async () => {
        await fs.mkdir(path.join(root, 'prompts'), { recursive: true });
        await fs.writeFile(path.join(root, 'prompts', 'planner.txt'), 'plan carefully');
        const registry = new VersionedArtifactRegistry({ root, governance });
        await registry.initialize();
        const version = await registry.promote({ kind: 'prompt', id: 'planner', sourcePath: 'prompts/planner.txt' });
        assert.match(version.hash, /^[a-f0-9]{64}$/);
        const restored = await registry.rollback({ kind: 'prompt', id: 'planner', hash: version.hash });
        assert.equal(restored.hash, version.hash);
    });

    it('versions model references that do not exist as ordinary files', async () => {
        const registry = new VersionedArtifactRegistry({ root, governance });
        await registry.initialize();
        const version = await registry.promoteReference({ kind: 'model', id: 'logos', reference: 'soma-logos-v2:latest' });
        assert.equal(version.reference, 'soma-logos-v2:latest');
        assert.match(version.hash, /^[a-f0-9]{64}$/);
    });

    it('builds a Marionette handoff using the parent commit as rollback ref', async () => {
        const preflight = await governance.preflight({ proposalId: 'handoff', files: ['candidate.js'] });
        await fs.writeFile(path.join(root, 'candidate.js'), 'export const value = 3;\n');
        const promoted = await governance.promote({ proposalId: 'handoff', files: ['candidate.js'], baseline: preflight.baseline });
        const handoff = await governance.buildSupervisorHandoff('test');
        assert.equal(handoff.promotion_id, promoted.id);
        assert.equal(handoff.candidate_ref, promoted.commit);
        assert.equal(handoff.rollback_ref, promoted.parentCommit);
    });

    it('writes a signed ledger anchor outside the SOMA workspace', async () => {
        const prior = process.env.SOMA_GOVERNANCE_ANCHOR_SECRET;
        process.env.SOMA_GOVERNANCE_ANCHOR_SECRET = 'anchor-test-secret';
        governance.anchorPath = path.join(path.dirname(root), `${path.basename(root)}-anchor.jsonl`);
        await governance.appendLedger('anchor_test', { ok: true });
        const result = await governance.anchorLedgerTip('test');
        assert.equal(result.configured, true);
        const anchor = JSON.parse((await fs.readFile(governance.anchorPath, 'utf8')).trim());
        assert.match(anchor.signature, /^[a-f0-9]{64}$/);
        await fs.rm(governance.anchorPath, { force: true });
        if (prior === undefined) delete process.env.SOMA_GOVERNANCE_ANCHOR_SECRET; else process.env.SOMA_GOVERNANCE_ANCHOR_SECRET = prior;
    });
});

describe('proposal-specific capability contracts', () => {
    it('requires measured target improvement and non-regression evidence', () => {
        const contract = normalizeCapabilityContract({
            targetDimension: 'task_completion_rate', minimumTargetDelta: 0.05,
            nonRegressionDimensions: ['memory_precision'], minimumObservations: 2,
        });
        const before = { scores: { task_completion_rate: 0.4, memory_precision: 0.7 } };
        const after = { scores: { task_completion_rate: 0.47, memory_precision: 0.7 } };
        const result = evaluateCapabilityContract(contract, before, after, { valid: true, delta: 0.02, regressed: [] }, [{}, {}]);
        assert.equal(result.passed, true);
    });

    it('rejects a passing global score when the named capability did not improve', () => {
        const contract = normalizeCapabilityContract({ targetDimension: 'memory_precision', minimumTargetDelta: 0.05, minimumObservations: 1 });
        const before = { scores: { memory_precision: 0.7 } };
        const after = { scores: { memory_precision: 0.71 } };
        const result = evaluateCapabilityContract(contract, before, after, { valid: true, delta: 0.1, regressed: [] }, [{}]);
        assert.equal(result.passed, false);
        assert.match(result.failures.join(' '), /memory_precision/);
    });

    it('normalizes malformed numeric limits to conservative finite defaults', () => {
        const contract = normalizeCapabilityContract({
            targetDimension: 'tool_efficiency',
            minimumTargetDelta: 'not-a-number',
            maximumCompositeRegression: Infinity,
            maximumRegressedDimensions: -4,
            minimumObservations: NaN,
        });
        assert.equal(contract.minimumTargetDelta, 0.01);
        assert.equal(contract.maximumCompositeRegression, 0.01);
        assert.equal(contract.maximumRegressedDimensions, 0);
        assert.equal(contract.minimumObservations, 2);
    });
});

describe('resource-limited isolated candidate execution', () => {
    it('runs explicit low-risk integration tests in the isolated process fallback', async () => {
        const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-isolated-runner-'));
        try {
            await fs.mkdir(path.join(worktree, 'tests'), { recursive: true });
            await fs.writeFile(path.join(worktree, 'candidate.js'), 'export const value = 4;\n');
            await fs.writeFile(path.join(worktree, 'tests', 'candidate.test.mjs'), "import assert from 'node:assert/strict'; import { value } from '../candidate.js'; assert.equal(value, 4);\n");
            const runner = new IsolatedCandidateRunner({ root: worktree });
            runner.dockerAvailable = async () => false;
            const receipt = await runner.run({
                worktree, files: ['candidate.js'],
                contract: normalizeCapabilityContract({ risk: 'low', testFiles: ['tests/candidate.test.mjs'] }),
            });
            assert.equal(receipt.passed, true);
            assert.equal(receipt.mode, 'process');
        } finally { await fs.rm(worktree, { recursive: true, force: true }); }
    });

    it('defers high-risk candidates when no real container and test contract are available', async () => {
        const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-isolated-runner-'));
        try {
            await fs.writeFile(path.join(worktree, 'candidate.js'), 'export const value = 4;\n');
            const runner = new IsolatedCandidateRunner({ root: worktree });
            runner.dockerAvailable = async () => false;
            await assert.rejects(
                runner.run({ worktree, files: ['candidate.js'], contract: normalizeCapabilityContract({ risk: 'high' }) }),
                /requires explicit integration testFiles/
            );
        } finally { await fs.rm(worktree, { recursive: true, force: true }); }
    });
});

describe('self-modification operator authentication', () => {
    it('never falls back to the historical development key', () => {
        const priorOperator = process.env.SOMA_OPERATOR_TOKEN;
        const priorApi = process.env.SOMA_API_KEY;
        delete process.env.SOMA_OPERATOR_TOKEN;
        delete process.env.SOMA_API_KEY;
        let response;
        const req = { header(name) { return name === 'X-Operator-Token' ? 'soma_sk_local_dev_9942a1' : null; } };
        const res = { status(code) { this.code = code; return this; }, json(body) { response = { code: this.code, body }; return this; } };
        requireSelfModificationOperatorAuth(req, res, () => assert.fail('must not authorize'));
        assert.equal(response.code, 403);
        assert.equal(response.body.code, 'OPERATOR_AUTH_INVALID');
        if (priorOperator === undefined) delete process.env.SOMA_OPERATOR_TOKEN; else process.env.SOMA_OPERATOR_TOKEN = priorOperator;
        if (priorApi === undefined) delete process.env.SOMA_API_KEY; else process.env.SOMA_API_KEY = priorApi;
    });

    it('accepts an explicitly configured operator token', () => {
        const prior = process.env.SOMA_OPERATOR_TOKEN;
        process.env.SOMA_OPERATOR_TOKEN = 'test-operator-secret';
        const req = { header(name) { return name === 'X-Operator-Token' ? 'test-operator-secret' : null; } };
        const res = { status(code) { this.code = code; return this; }, json() { return this; } };
        let called = false;
        requireSelfModificationOperatorAuth(req, res, () => { called = true; });
        assert.equal(called, true);
        if (prior === undefined) delete process.env.SOMA_OPERATOR_TOKEN; else process.env.SOMA_OPERATOR_TOKEN = prior;
    });
});
