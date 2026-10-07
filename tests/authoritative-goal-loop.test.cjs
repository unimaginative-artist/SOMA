'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthoritativeGoalLoop } = require('../core/AuthoritativeGoalLoop.cjs');

function fixture() {
  const goal = {
    id: 'goal-1', title: 'Produce verified work', status: 'active', category: 'engineering',
    metrics: { progress: 10 }, metadata: { executionAttempts: 1 }
  };
  const calls = { complete: 0, progress: [], transitions: [], receipts: [], learning: 0, terminal: 0 };
  const planner = {
    updateGoalProgress: async (_id, progress, metadata) => {
      calls.progress.push({ progress, metadata });
      goal.metrics.progress = progress;
      Object.assign(goal.metadata, metadata);
      return { success: true, goal };
    },
    completeGoal: async () => {
      calls.complete++;
      goal.status = 'completed';
      goal.metrics.progress = 100;
      return { success: true, goal };
    },
    transitionGoal: (_id, status, options) => {
      calls.transitions.push({ status, options });
      goal.status = status;
      return { success: true, goal };
    },
    getExecutionAttemptBudget: () => ({ attempts: 1, maxAttempts: 3, exhausted: false }),
    _saveToDisk() {}
  };
  const system = {
    goalPlanner: planner,
    autonomyReliability: { dashboard: () => ({ metrics: { verificationRate: 0.9 } }) },
    realityLoop: { observeGoalAttempt: async () => { calls.learning++; } }
  };
  const writeReceipt = async (_goal, execResult, context) => {
    calls.receipts.push(context);
    return {
      path: `data/goal-receipts/r-${calls.receipts.length}.json`,
      receipt: { receiptId: `r-${calls.receipts.length}`, lifecycle: context.lifecycleState, completionEvidence: execResult.completionEvidence }
    };
  };
  return { goal, calls, system, writeReceipt };
}

test('authoritative loop measures, verifies, learns and completes exactly once', async () => {
  const { goal, calls, system, writeReceipt } = fixture();
  const loop = new AuthoritativeGoalLoop(system, { now: (() => { let value = 1000; return () => ++value; })() });
  const outcome = await loop.run(goal, {
    execute: async () => ({
      done: true, result: 'Artifact and tests passed', toolsUsed: ['write_file', 'run_tests'], observations: [],
      iterations: 2, completionEvidence: { passed: true }, evidenceProgress: { progress: 100 }
    }),
    verify: async () => ({ verified: true, checks: [{ check: 'tests', passed: true }], evidence: { tests: true } }),
    writeReceipt,
    reportTerminal: async () => { calls.terminal++; }
  });

  assert.equal(outcome.complete, true);
  assert.equal(goal.status, 'completed');
  assert.equal(calls.complete, 1);
  assert.equal(calls.learning, 1);
  assert.equal(calls.terminal, 1);
  assert.deepEqual(calls.receipts.map(item => item.lifecycleState), [
    'awaiting_verification', 'awaiting_goalplanner_verification', 'completed'
  ]);
  assert.equal(goal.metadata.authoritativeLoop.verified, true);
});

test('failed verification remains open, records an autopsy, and cannot complete', async () => {
  const { goal, calls, system, writeReceipt } = fixture();
  const loop = new AuthoritativeGoalLoop(system);
  const outcome = await loop.run(goal, {
    execute: async () => ({ done: true, result: 'Claimed done', toolsUsed: [], observations: [], iterations: 1, evidenceProgress: { progress: 90 } }),
    verify: async () => ({ verified: false, checks: [{ check: 'artifact', passed: false }] }),
    writeAutopsy: async () => ({ path: 'data/goal-autopsies/goal-1.json', nextStrategy: 'Create and verify the artifact.' }),
    writeReceipt,
    reportTerminal: async () => { calls.terminal++; }
  });

  assert.equal(outcome.complete, false);
  assert.equal(calls.complete, 0);
  assert.equal(outcome.progress, 75);
  assert.equal(goal.metadata.latestAutopsy, 'data/goal-autopsies/goal-1.json');
  assert.equal(calls.receipts.at(-1).lifecycleState, 'awaiting_evidence');
  assert.equal(calls.learning, 1);
});

test('execution exceptions become durable retry state instead of stranded active goals', async () => {
  const { goal, calls, system, writeReceipt } = fixture();
  const loop = new AuthoritativeGoalLoop(system);
  const outcome = await loop.run(goal, {
    execute: async () => { throw new Error('provider disconnected'); },
    verify: async () => { throw new Error('verification must not run'); },
    writeAutopsy: async () => ({ path: 'data/goal-autopsies/goal-1.json', nextStrategy: 'Use fallback provider.' }),
    writeReceipt,
    reportTerminal: async () => { calls.terminal++; }
  });

  assert.equal(outcome.ok, false);
  assert.equal(goal.status, 'pending');
  assert.equal(calls.transitions[0].status, 'pending');
  assert.equal(calls.complete, 0);
  assert.equal(calls.receipts.at(-1).lifecycleState, 'continuing');
  assert.equal(calls.learning, 1);
});
