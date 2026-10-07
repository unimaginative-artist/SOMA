import test from 'node:test';
import assert from 'node:assert/strict';
import AutonomousHeartbeat from '../server/services/AutonomousHeartbeat.cjs';

test('heartbeat settles an agentic goal once and skips the legacy completion callback', async () => {
    const goal = {
        id: 'heartbeat-goal', title: 'Finish once', description: 'Produce verified evidence',
        status: 'active', category: 'engineering', metrics: { progress: 0 }, metadata: { executionAttempts: 1 }
    };
    const calls = { complete: 0, legacyComplete: 0, receipts: [], learned: 0, terminal: 0 };
    const planner = {
        goals: new Map([[goal.id, goal]]), activeGoals: new Set([goal.id]),
        async updateGoalProgress(_id, progress, metadata) {
            goal.metrics.progress = progress;
            Object.assign(goal.metadata, metadata);
            return { success: true, goal };
        },
        async completeGoal() {
            calls.complete++;
            goal.status = 'completed';
            goal.metrics.progress = 100;
            return { success: true, goal };
        },
        _saveToDisk() {}
    };
    const system = {
        goalPlanner: planner,
        agenticExecutor: {},
        autonomyReliability: { dashboard: () => ({ metrics: {} }) },
        realityLoop: { async observeGoalAttempt() { calls.learned++; } },
        mnemonicArbiter: { async remember() {} }
    };
    const heartbeat = new AutonomousHeartbeat(system, { logger: { log() {}, warn() {}, error() {} } });
    heartbeat.isRunning = true;
    heartbeat._assessResourcePressure = () => ({ level: 'normal', memoryUsedRatio: 0, processHeapRatio: 0, actions: [] });
    heartbeat._applyResourcePolicy = async () => [];
    heartbeat._getDueSchedules = () => [];
    heartbeat._runGoalJanitor = async () => ({ actions: [] });
    heartbeat._pollForTask = async () => ({
        source: 'GoalPlanner', description: goal.description, context: { goalId: goal.id, goalTitle: goal.title },
        async onComplete() { calls.legacyComplete++; }
    });
    heartbeat._executeAgenticGoal = async () => ({
        done: true, result: 'Verified output', iterations: 2, toolsUsed: ['run_tests'], observations: [],
        completionEvidence: { passed: true }, evidenceProgress: { progress: 100 }
    });
    heartbeat._verifyGoalCompletion = async () => ({ verified: true, checks: [{ check: 'tests', passed: true }], evidence: { tests: true } });
    heartbeat._writeExecutionReceipt = async (_goal, execResult, context) => {
        calls.receipts.push(context.lifecycleState);
        return {
            path: `data/goal-receipts/test-${calls.receipts.length}.json`,
            receipt: { receiptId: `test-${calls.receipts.length}`, lifecycle: context.lifecycleState, completionEvidence: execResult.completionEvidence }
        };
    };
    heartbeat._reportGoalTerminal = async () => { calls.terminal++; };
    heartbeat._appendRunLog = () => {};
    heartbeat._broadcast = () => {};
    heartbeat._updateTaskState = () => {};
    heartbeat._sendProactiveSummary = async () => {};

    await heartbeat.tick();

    assert.equal(goal.status, 'completed');
    assert.equal(calls.complete, 1);
    assert.equal(calls.legacyComplete, 0);
    assert.equal(calls.learned, 1);
    assert.equal(calls.terminal, 1);
    assert.deepEqual(calls.receipts, ['awaiting_verification', 'awaiting_goalplanner_verification', 'completed']);
});
