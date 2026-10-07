import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SelfEvolutionDirector } from '../core/SelfEvolutionDirector.js';
import { CapabilityTrialRegistry } from '../core/CapabilityTrialRegistry.js';
import { goalAllowsTool, requiredSelfEvolutionDiagnostic, requiredSelfEvolutionPreflight } from '../core/SomaAgenticExecutor.js';

function suite(research, coding = 0.8) {
    return {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        scores: { research, coding },
        composite: (research + coding) / 2,
        receipts: {
            research: { domain: 'research', score: research, executableScore: research, suiteFingerprint: 'research-v1', valid: true, exitCode: 0, failed: 0 },
            coding: { domain: 'coding', score: coding, executableScore: coding, suiteFingerprint: 'coding-v1', valid: true, exitCode: 0, failed: 0 },
        },
    };
}

async function harness({ candidate = suite(0.6), canary = 0.6, promotion = false } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-evolution-'));
    const baseline = suite(0.4);
    const registry = {
        listTrials: () => [{ id: 'research' }, { id: 'coding' }],
        snapshot: () => baseline,
        runSuite: async ({ reason }) => reason === 'self_evolution_baseline' ? baseline : structuredClone(candidate),
        run: async () => ({ domain: 'research', score: canary, executableScore: canary, suiteFingerprint: 'research-v1', valid: true, exitCode: 0, failed: 0 }),
        weakest: () => ({ dimension: 'research', label: 'research-to-paper', score: 0.4, testFiles: ['tests/research.mjs'] }),
        compare: (before, after) => {
            const delta = after.composite - before.composite;
            const regressed = Object.keys(before.scores).filter(key => after.scores[key] < before.scores[key] - 0.02)
                .map(domain => ({ domain, before: before.scores[domain], after: after.scores[domain] }));
            return { valid: true, delta, improved: [], regressed, unchanged: [] };
        },
        promoteVersion: async () => 12,
        getStatus: () => ({ currentVersion: 11 }),
    };
    const rolledBack = [];
    const records = promotion ? [{ id: 'old', status: 'accepted' }] : [];
    const system = {
        selfModificationGovernance: {
            records,
            evaluateProbation: async (id, options) => rolledBack.push({ id, options }),
        },
    };
    const director = new SelfEvolutionDirector({ root, system, registry });
    await director.initialize(system);
    return { root, director, registry, records, rolledBack };
}

test('a later governed rollback retracts the experiment, version, and research outcome without erasing measurements', async t => {
    const { root, director, records } = await harness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const registry = new CapabilityTrialRegistry({ root });
    await registry.initialize();
    director.registry = registry;
    const version = await registry.promoteVersion({ experimentId: 'experiment', comparison: { delta: .2 }, scores: suite(.6) });
    const experiment = { id: 'experiment', cycleId: 'cycle', goalId: 'goal', state: 'promoted', decision: 'promote', version,
        governancePromotions: ['promotion'], comparison: { delta: .2 }, researchPlanId: 'plan' };
    director.experiments.push(experiment);
    director.system.selfModificationGovernance.ready = true;
    const outcomes = [];
    director.system.selfEvolutionResearch = { recordOutcome: async result => outcomes.push(result.state) };
    records.push({ id: 'promotion', goalId: 'different', asiCycleId: 'cycle', status: 'rolled_back' });
    assert.equal((await director.reconcilePromotions()).length, 0, 'wrong goal cannot revoke this experiment');
    records[0].goalId = 'goal';
    records[0].rollbackReason = 'probation_failure';
    assert.equal((await director.reconcilePromotions()).length, 1);
    assert.equal(experiment.state, 'rolled_back');
    assert.equal(experiment.comparison.delta, .2, 'keep historical measured gain');
    assert.equal(registry.getStatus().currentVersion, 0);
    assert.equal(registry.getStatus().versions[0].status, 'retracted');
    assert.deepEqual(outcomes, ['rolled_back']);
    assert.equal((await director.reconcilePromotions()).length, 0, 'idempotent');
    assert.equal(await registry.promoteVersion({ experimentId: 'next', scores: suite(.7) }), 2, 'never reuse a historical version');
});

test('director selects the weakest measured capability and promotes only a measured non-regression', async t => {
    const { root, director, records } = await harness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const preparation = await director.prepareCycle({ operationalBaseline: { composite: 0.5 } });
    assert.equal(preparation.target.dimension, 'research');
    const goal = { id: 'goal-1', title: 'Improve research' };
    const experiment = await director.openExperiment({ cycleId: 'cycle-1', goal, preparation });
    records.push({ id: 'change-1', goalId: goal.id, asiCycleId: 'cycle-1', status: 'probation' });
    const result = await director.evaluateCompleted({
        cycle: { id: 'cycle-1' },
        goal,
        operationalAfter: { composite: 0.6 },
        operationalComparison: { valid: true, delta: 0.1, regressed: [] },
    });
    assert.equal(result.accepted, true);
    assert.equal(experiment.state, 'promoted');
    assert.equal(experiment.version, 12);
});

test('a verified saturated-baseline diagnosis closes without a promotion or failed-repair claim', async t => {
    const { root, director, registry } = await harness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const preparation = await director.prepareCycle();
    preparation.baseline.receipts.research.executableScore = 1;
    registry.run = async () => ({ valid: true, exitCode: 0, failed: 0, executableScore: 1, suiteFingerprint: 'research-v1' });
    const goal = { id: 'diagnosis-1', title: 'Measure research', metadata: { diagnosticOnly: true, lastVerification: { passed: true } } };
    const experiment = await director.openExperiment({ cycleId: 'diagnosis-cycle', goal, preparation });
    const result = await director.evaluateCompleted({ cycle: { id: 'diagnosis-cycle' }, goal });
    assert.equal(result.accepted, false);
    assert.equal(experiment.state, 'diagnosis_completed');
    assert.equal(experiment.decision, 'no_change');
    assert.equal(experiment.version, null);
    assert.equal(director.failures.length, 0);
});

test('director rejects cross-domain regressions, rolls back linked probation, and remembers the failure', async t => {
    const { root, director, records, rolledBack } = await harness({ candidate: suite(0.65, 0.5), canary: 0.65, promotion: true });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const preparation = await director.prepareCycle({ operationalBaseline: { composite: 0.5 } });
    const goal = { id: 'goal-2', title: 'Improve research' };
    const experiment = await director.openExperiment({ cycleId: 'cycle-2', goal, preparation });
    records.push({ id: 'new-probation', goalId: goal.id, asiCycleId: 'cycle-2', status: 'probation' });
    const result = await director.evaluateCompleted({
        cycle: { id: 'cycle-2' },
        goal,
        operationalAfter: { composite: 0.5 },
        operationalComparison: { valid: true, delta: 0, regressed: [] },
    });
    assert.equal(result.accepted, false);
    assert.equal(experiment.state, 'rejected');
    assert.equal(rolledBack[0].id, 'new-probation');
    assert.equal(rolledBack[0].options.forceRollback, true);
    assert.equal(director.getStatus().failedApproaches.length, 1);
});

test('directed goals reject unrelated domain tools and require a diagnostic artifact', async t => {
    const { root, director } = await harness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const goal = director.buildGoal({
        dimension: 'research', label: 'research-to-paper', score: 0.4,
        testFiles: ['tests/agency-proving-ground.test.cjs'], paperOnly: false,
    });
    assert.equal(goal.metadata.expectedArtifact, 'data/self-evolution/diagnostics/research-latest.md');
    assert.equal(goalAllowsTool({ metadata: goal.metadata }, 'run_tests'), true);
    assert.equal(goalAllowsTool({ metadata: goal.metadata }, 'web_fetch'), true);
    assert.equal(goalAllowsTool({ metadata: goal.metadata }, 'market_lab_status'), false);
});

test('self-evolution execution cannot skip its repeatable benchmark preflight', () => {
    const goal = {
        metadata: {
            selfEvolution: true,
            benchmarkTests: ['tests/agency-proving-ground.test.cjs'],
        },
    };
    assert.deepEqual(requiredSelfEvolutionPreflight(goal, []), {
        tool: 'run_tests',
        args: { testFile: 'tests/agency-proving-ground.test.cjs', timeout: 60000 },
        reason: 'required_self_evolution_baseline',
    });
    assert.equal(requiredSelfEvolutionPreflight(goal, [{
        tool: 'run_tests',
        args: { testFile: 'tests/agency-proving-ground.test.cjs' },
        result: { passed: false, testFile: 'tests/agency-proving-ground.test.cjs' },
    }]), null);
    assert.notEqual(requiredSelfEvolutionPreflight(goal, [{
        tool: 'run_tests',
        args: { testFile: 'tests/agency-proving-ground.test.cjs' },
        result: { error: 'runner unavailable' },
    }]), null);
});

test('self-evolution creates its diagnostic from benchmark evidence before further exploration', () => {
    const goal = {
        title: 'Improve research',
        metadata: {
            selfEvolution: true,
            capabilityDomain: 'research',
            baselineScore: 0.42,
            expectedArtifact: 'data/self-evolution/diagnostics/research-test.md',
        },
    };
    const action = requiredSelfEvolutionDiagnostic(goal, [{
        tool: 'run_tests',
        args: { testFile: 'tests/agency-proving-ground.test.cjs' },
        result: { passed: true, output: 'ℹ tests 6\nℹ pass 6' },
    }], { exists: () => false });
    assert.equal(action.tool, 'write_file');
    assert.equal(action.args.path, goal.metadata.expectedArtifact);
    assert.match(action.args.content, /Recorded capability baseline: 42\.0%/);
    assert.match(action.args.content, /Benchmark result: PASS/);
    assert.equal(requiredSelfEvolutionDiagnostic(goal, [{
        tool: 'run_tests', result: { passed: true },
    }], { exists: () => true }), null);
});

test('score drift without this experiment making a governed change never earns a promotion', async t => {
    const { root, director, records, rolledBack } = await harness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const preparation = await director.prepareCycle();
    const goal = { id: 'no-change', title: 'Improve research' };
    await director.openExperiment({ cycleId: 'no-change-cycle', goal, preparation });
    records.push({ id: 'someone-elses-change', goalId: 'other-goal', asiCycleId: 'other-cycle', status: 'probation' });
    const result = await director.evaluateCompleted({ cycle: { id: 'no-change-cycle' }, goal });
    assert.equal(result.accepted, false);
    assert.equal(result.experiment.comparison.linkedChange, false);
    assert.equal(rolledBack.length, 0);
});

test('changing the baseline tests cannot manufacture a capability gain', async t => {
    const { root, director, records } = await harness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const preparation = await director.prepareCycle();
    preparation.baseline.receipts.research.suiteFingerprint = 'old-tests';
    const goal = { id: 'changed-tests', title: 'Improve research' };
    await director.openExperiment({ cycleId: 'changed-tests-cycle', goal, preparation });
    records.push({ id: 'change', goalId: goal.id, asiCycleId: 'changed-tests-cycle', status: 'probation' });
    const result = await director.evaluateCompleted({ cycle: { id: 'changed-tests-cycle' }, goal });
    assert.equal(result.accepted, false);
    assert.equal(result.experiment.comparison.fixedSuite, false);
});
