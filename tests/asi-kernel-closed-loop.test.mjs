import test from 'node:test';
import assert from 'node:assert/strict';
import { ASIKernel } from '../core/ASIKernel.js';
import { CapabilityBenchmark } from '../core/CapabilityBenchmark.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function snapshot(composite, taskCompletion) {
    return {
        schemaVersion: 2,
        timestamp: new Date().toISOString(),
        composite,
        scores: {
            reasoning_accuracy: 0.5,
            task_completion_rate: taskCompletion,
            memory_precision: 0.6,
            tool_efficiency: 0.5,
            knowledge_coverage: 0.5,
            response_latency_score: 0.5,
        }
    };
}

function createHarness() {
    const goals = new Map();
    const snapshots = [snapshot(0.45, 0.2), snapshot(0.55, 0.8)];
    const benchmark = {
        snapshot: async () => snapshots.shift(),
        compare: (before, after) => ({
            valid: true,
            delta: after.composite - before.composite,
            improved: [{ dim: 'task_completion_rate', before: 0.2, after: 0.8, delta: 0.6 }],
            regressed: [],
            unchanged: []
        }),
        getVelocity: () => 0.1
    };
    const goalPlanner = {
        goals,
        activeGoals: new Set(),
        maxActiveGoals: 20,
        _saveToDisk: async () => {},
        createGoal: async data => {
            const goal = { id: 'asi-goal-1', ...data, status: 'active', metadata: { ...data.metadata } };
            goals.set(goal.id, goal);
            goalPlanner.activeGoals.add(goal.id);
            return { success: true, goalId: goal.id, goal };
        }
    };
    const system = {
        benchmark,
        goalPlanner,
        constitutional: { check: async () => ({ ok: true, violations: [] }) },
        transfer: { synthesizeCross: async () => 0 },
        longHorizon: { getNextMilestone: async () => null }
    };
    const kernel = new ASIKernel({ system, isolationProbe: async () => true });
    kernel._running = true;
    kernel._persist = async () => {};
    return { kernel, goals };
}

test('autonomous evolution records a blocked cycle before paid research when isolation is absent', async () => {
    const { kernel, goals } = createHarness();
    let researched = false;
    kernel.system.selfEvolutionDirector = { prepareCycle: async () => { researched = true; } };
    kernel._isolationProbe = async () => false;
    const cycle = await kernel.runCycle();
    assert.equal(cycle.result, 'blocked_isolation_unavailable');
    assert.equal(researched, false);
    assert.equal(goals.size, 0);
    assert.equal(cycle.phases.preflight.isolationReady, false);
});

test('a rolled-back promotion no longer counts as a verified ASI success', async () => {
    const { kernel } = createHarness();
    const experiment = { id: 'e', cycleId: 'c', state: 'rolled_back', reason: 'probation_failure' };
    kernel.system.selfEvolutionDirector = { reconcilePromotions: async () => [experiment], findByCycle: () => experiment };
    kernel._cycles = [{ id: 'c', result: 'verified_improvement', phases: { verify: { comparison: { delta: .2 } } } }];
    await kernel.reconcilePendingCycles();
    assert.equal(kernel.getStatus().successCycles, 0);
    assert.equal(kernel._cycles[0].result, 'improvement_retracted');
    assert.equal(kernel._cycles[0].phases.verify.comparison.delta, .2);
});

test('ASI cycle remains pending until its exact goal is verified', async () => {
    const { kernel, goals } = createHarness();
    const cycle = await kernel.runCycle();
    assert.equal(cycle.result, 'pending_execution');
    assert.equal(cycle.phases.execute.goalId, 'asi-goal-1');
    assert.equal(kernel.getStatus().successCycles, 0);

    const goal = goals.get('asi-goal-1');
    goal.status = 'completed';
    goal.metadata.lastVerification = { passed: true, checks: [{ type: 'tests', passed: true }] };
    const resolved = await kernel.reconcilePendingCycles();
    assert.equal(resolved.length, 1);
    assert.equal(cycle.result, 'verified_improvement');
    assert.ok(Math.abs(cycle.phases.verify.comparison.delta - 0.1) < 1e-9);
    assert.equal(kernel.getStatus().successCycles, 1);
});

test('ASI cycle fails closed when required dependencies are missing', async () => {
    const kernel = new ASIKernel({ system: {} });
    kernel._running = true;
    kernel._persist = async () => {};
    const cycle = await kernel.runCycle();
    assert.equal(cycle.result, 'blocked_missing_dependencies');
    assert.deepEqual(cycle.phases.preflight.missing, ['benchmark', 'goalPlanner', 'constitutional']);
    assert.equal(kernel.getStatus().successCycles, 0);
});

test('optional transfer brainstorming cannot block the authoritative measured research cycle', async () => {
    const { kernel } = createHarness();
    kernel.system.transfer.synthesizeCross = () => assert.fail('advisory model probes ran on the critical path');
    kernel.system.selfEvolutionDirector = { prepareCycle: async () => ({ target: { dimension: 'research' }, baseline: {}, research: { state: 'deferred', reason: 'fixture_no_experiment' } }) };
    const cycle = await kernel.runCycle();
    assert.equal(cycle.result, 'research_deferred'); assert.equal(cycle.phases.transfer.state, 'advisory_only');
    assert.equal(kernel.getStatus().activeCycle, null);
});

test('failed execution resolves the cycle without claiming improvement', async () => {
    const { kernel, goals } = createHarness();
    const cycle = await kernel.runCycle();
    const goal = goals.get('asi-goal-1');
    goal.status = 'verification_failed';
    goal.metadata.lastVerification = { passed: false, checks: [{ type: 'tests', passed: false }] };
    await kernel.reconcilePendingCycles();
    assert.equal(cycle.result, 'execution_failed');
    assert.equal(kernel.getStatus().successCycles, 0);
});

test('blocked execution resolves the cycle so later experiments cannot deadlock', async () => {
    const { kernel, goals } = createHarness();
    const cycle = await kernel.runCycle();
    const goal = goals.get('asi-goal-1');
    goal.status = 'blocked';
    await kernel.reconcilePendingCycles();
    assert.equal(cycle.result, 'execution_failed');
    assert.equal(kernel.getStatus().pendingCycles, 0);
});

test('pending ASI cycle repairs an orphaned active-index entry after restart', async () => {
    const { kernel, goals } = createHarness();
    const cycle = await kernel.runCycle();
    kernel.system.goalPlanner.activeGoals.delete('asi-goal-1');
    await kernel.reconcilePendingCycles();
    assert.equal(kernel.system.goalPlanner.activeGoals.has('asi-goal-1'), true);
    assert.ok(cycle.phases.execute.recoveredToActiveIndexAt);
    assert.equal(goals.get('asi-goal-1').status, 'active');
});

test('missing persisted goal resolves as an orphan and cannot deadlock later cycles', async () => {
    const { kernel, goals } = createHarness();
    kernel._orphanGraceMs = 0;
    const cycle = await kernel.runCycle();
    goals.delete('asi-goal-1');

    const resolved = await kernel.reconcilePendingCycles();
    assert.equal(resolved.length, 1);
    assert.equal(cycle.result, 'execution_orphaned');
    assert.equal(cycle.phases.verify.state, 'execution_orphaned');
    assert.equal(kernel.getStatus().pendingCycles, 0);
});

test('an approved proposal whose goal vanished cannot hold the approval queue forever', async () => {
    const { kernel } = createHarness();
    kernel._orphanGraceMs = 0;
    kernel.system.goalPlanner.workGovernor = { getProposal: () => ({ status: 'promoted', metadata: { goalId: 'vanished' } }) };
    const cycle = { id: 'old-approved', result: 'pending_approval', phases: { execute: { proposalId: 'old-proposal' } } };
    kernel._cycles.push(cycle);
    await kernel.reconcilePendingCycles();
    assert.equal(cycle.result, 'execution_orphaned');
    assert.equal(kernel.getStatus().awaitingApproval, 0);
    assert.equal(kernel.getStatus().successCycles, 0);
});

test('capability benchmark measures terminal goal archives instead of treating active backlog as failure', async () => {
    const benchmark = new CapabilityBenchmark({
        system: {
            goalPlanner: {
                goals: new Map([
                    ['active-1', { id: 'active-1', status: 'active' }],
                    ['failed-2', { id: 'failed-2', status: 'verification_failed' }]
                ]),
                completedGoals: [{ id: 'done-1', status: 'completed' }],
                failedGoals: [{ id: 'failed-1', status: 'failed' }]
            }
        }
    });
    benchmark._persist = async () => {};
    const result = await benchmark.snapshot();
    assert.equal(result.scores.task_completion_rate, 1 / 3);
});

test('capability velocity never compares incompatible benchmark schemas', () => {
    const benchmark = new CapabilityBenchmark();
    benchmark._history = [
        { schemaVersion: 1, composite: 0.1 },
        { schemaVersion: 2, composite: 0.9 }
    ];
    assert.equal(benchmark.getVelocity(), 0);
});

function approvalHarness() {
    const { kernel, goals } = createHarness();
    const cycle = { id: 'approval-cycle', startedAt: new Date().toISOString(), result: 'pending_approval', phases: {
        identify: { dimension: 'coding' }, measure: { baseline: snapshot(0.45, 0.2) },
        scoreboard: { baseline: { timestamp: new Date().toISOString(), scores: { coding: 0.4 }, receipts: { coding: { suiteFingerprint: 'fixed' } } } },
        execute: { proposalId: 'proposal-1' },
    } };
    const proposal = { id: 'proposal-1', status: 'proposed', metadata: { selfEvolution: true, asiCycleId: cycle.id } };
    const experiments = [];
    kernel._cycles = [cycle];
    kernel.system.goalPlanner.workGovernor = {
        getProposal: id => id === proposal.id ? proposal : null,
        markProposal: (id, status, metadata) => Object.assign(proposal, { status, metadata: { ...proposal.metadata, ...metadata } }),
    };
    kernel.system.selfEvolutionDirector = {
        findByCycle: id => experiments.find(item => item.cycleId === id),
        openExperiment: async data => { const result = { id: 'experiment-1', state: 'executing', ...data }; experiments.push(result); return result; },
        evaluateCompleted: async () => ({ accepted: false, experiment: experiments[0] }),
        getStatus: () => ({}),
    };
    return { kernel, goals, cycle, proposal, experiments };
}

test('a terminal mission rejection releases the evolution slot without approving the rejected goal', async () => {
    const h = approvalHarness();
    h.kernel.system.goalPlanner.missionDirector = { ensureMission: async () => ({ rejections: [{ id: h.proposal.id, reason: 'resembles_failed_goal:old-failure' }] }) };
    await h.kernel.reconcilePendingCycles();
    assert.equal(h.cycle.result, 'admission_deferred');
    assert.equal(h.proposal.status, 'deferred');
    assert.equal(h.goals.size, 0);
    assert.equal(h.kernel.getStatus().awaitingApproval, 0);
});

test('approval reconnects its exact experiment, preserves baseline, and is idempotent', async () => {
    const h = approvalHarness();
    const baseline = h.cycle.phases.measure.baseline;
    h.proposal.status = 'promoted';
    h.proposal.metadata.goalId = 'approved-goal';
    h.goals.set('approved-goal', { id: 'approved-goal', title: 'Improve coding', status: 'pending', metadata: {
        asiCycleId: h.cycle.id, missionProposalId: h.proposal.id,
    } });
    await Promise.all([h.kernel.reconcilePendingCycles(), h.kernel.reconcilePendingCycles()]);
    assert.equal(h.cycle.result, 'pending_execution');
    assert.equal(h.experiments.length, 1);
    assert.equal(h.experiments[0].preparation.operationalBaseline, baseline);
    assert.equal(h.kernel.system.goalPlanner.activeGoals.has('approved-goal'), true);
    await h.kernel.reconcilePendingCycles();
    assert.equal(h.experiments.length, 1);
});

test('a different proposal goal cannot hijack an ASI experiment', async () => {
    const h = approvalHarness();
    h.proposal.status = 'promoted';
    h.proposal.metadata.goalId = 'unrelated';
    h.goals.set('unrelated', { id: 'unrelated', status: 'completed', metadata: { asiCycleId: 'other', lastVerification: { passed: true } } });
    await h.kernel.reconcilePendingCycles();
    assert.equal(h.cycle.result, 'pending_approval');
    assert.match(h.cycle.phases.execute.linkError, /does not match/);
    assert.equal(h.experiments.length, 0);
});

test('pending approval does not manufacture more improvement proposals', async () => {
    const h = approvalHarness();
    h.kernel.system.goalPlanner.createGoal = () => { throw new Error('must not queue duplicate'); };
    const result = await h.kernel.runCycle();
    assert.equal(result.skipped, true);
    assert.equal(h.kernel._busy, false);
    assert.equal(h.kernel._cycles.length, 1);
});

test('duplicate unstarted ASI proposals are superseded without removing their receipts', async () => {
    const h = approvalHarness();
    const older = structuredClone(h.cycle); older.id = 'older'; older.phases.execute.proposalId = 'older-proposal';
    const oldProposal = { id: 'older-proposal', status: 'proposed', metadata: { selfEvolution: true, asiCycleId: older.id } };
    h.kernel._cycles.unshift(older);
    const proposals = new Map([[h.proposal.id, h.proposal], [oldProposal.id, oldProposal]]);
    h.kernel.system.goalPlanner.workGovernor = {
        getProposal: id => proposals.get(id), markProposal: (id, status) => { proposals.get(id).status = status; },
    };
    await h.kernel.reconcilePendingCycles();
    assert.equal(older.result, 'proposal_superseded');
    assert.equal(oldProposal.status, 'superseded');
    assert.equal(h.cycle.result, 'pending_approval');
    assert.equal(h.kernel._cycles.length, 2);
});

test('cycle receipts survive atomic persistence and restart', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-asi-restart-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const h = approvalHarness();
    const cyclesFile = path.join(root, 'cycles.json');
    const writer = new ASIKernel({ system: h.kernel.system, cyclesFile });
    writer._cycles = h.kernel._cycles;
    await Promise.all([writer._persist(), writer._persist()]);
    const restarted = new ASIKernel({ system: h.kernel.system, cyclesFile });
    await restarted.initialize();
    assert.equal(restarted._cycles[0].phases.execute.proposalId, h.proposal.id);
    assert.equal(restarted.getStatus().awaitingApproval, 1);
    await restarted.shutdown();
});
