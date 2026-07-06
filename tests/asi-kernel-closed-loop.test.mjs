import test from 'node:test';
import assert from 'node:assert/strict';
import { ASIKernel } from '../core/ASIKernel.js';
import { CapabilityBenchmark } from '../core/CapabilityBenchmark.js';

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
    const kernel = new ASIKernel({ system });
    kernel._running = true;
    kernel._persist = async () => {};
    return { kernel, goals };
}

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

test('pending ASI cycle repairs an orphaned active-index entry after restart', async () => {
    const { kernel, goals } = createHarness();
    const cycle = await kernel.runCycle();
    kernel.system.goalPlanner.activeGoals.delete('asi-goal-1');
    await kernel.reconcilePendingCycles();
    assert.equal(kernel.system.goalPlanner.activeGoals.has('asi-goal-1'), true);
    assert.ok(cycle.phases.execute.recoveredToActiveIndexAt);
    assert.equal(goals.get('asi-goal-1').status, 'active');
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
