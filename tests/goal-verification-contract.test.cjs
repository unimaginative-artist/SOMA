const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GoalPlannerArbiter = require('../arbiters/GoalPlannerArbiter.cjs');
const { verifyGoal } = require('../core/GoalQualityGate.cjs');
const { compileEvidencePreflight, deriveGoalState, isHumanGoal } = require('../core/GoalLifecycle.cjs');

function goalFixture(id, overrides = {}) {
  return {
    id,
    title: 'Verify asynchronous completion contract',
    description: 'Prove that the goal verifier resolves before lifecycle state is evaluated.',
    category: 'engineering',
    status: 'active',
    approved: true,
    priority: 80,
    metrics: { progress: 99 },
    metadata: {},
    successCriteria: [],
    verification: null,
    tasks: [],
    dependencies: [],
    prerequisites: [],
    createdAt: Date.now(),
    startedAt: Date.now(),
    ...overrides,
  };
}

test('completeGoal awaits verification instead of storing a Promise as an empty object', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-goal-verify-'));
  const planner = new GoalPlannerArbiter({ dataDir });
  const goal = goalFixture('await-verifier');
  planner.goals.set(goal.id, goal);
  planner.activeGoals.add(goal.id);
  try {
    const result = await planner.completeGoal(goal.id, {
      summary: 'Completion evidence exists.',
      result: 'Completion evidence exists.',
      force: true,
    });
    assert.equal(result.success, true);
    assert.equal(goal.status, 'completed');
    assert.equal(goal.metadata.lastVerification.passed, true);
    assert.ok(Array.isArray(goal.metadata.lastVerification.checks));
    assert.equal(typeof goal.metadata.lastVerification.then, 'undefined');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('physical artifact evidence passes the real Poseidon completion gate', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-goal-physical-'));
  const planner = new GoalPlannerArbiter({ dataDir });
  const relativeArtifact = `data/goal-verification-${process.pid}-${Date.now()}.json`;
  const absoluteArtifact = path.join(process.cwd(), relativeArtifact);
  fs.writeFileSync(absoluteArtifact, JSON.stringify({ verified: true }));
  const goal = goalFixture('physical-verifier', {
    category: 'system_canary',
    successCriteria: ['Produce a concrete output artifact'],
    verification: { evidenceRequired: ['summary', 'artifact'], filesExist: [relativeArtifact] },
    metadata: {
      goalContract: {
        successCriteria: ['Produce a concrete output artifact'],
        evidenceRequired: ['summary', 'artifact'],
        verification: { evidenceRequired: ['summary', 'artifact'], filesExist: [relativeArtifact] },
      },
    },
  });
  planner.goals.set(goal.id, goal);
  planner.activeGoals.add(goal.id);
  try {
    const result = await planner.completeGoal(goal.id, {
      summary: 'Created and checked the required artifact.',
      evidence: { artifact: relativeArtifact },
    });
    assert.equal(result.success, true, JSON.stringify(result.verification || result));
    assert.equal(goal.metadata.lastVerification.passed, true);
    assert.equal(goal.metadata.lastVerification.poseidon.state, 'TRUE');
  } finally {
    fs.rmSync(absoluteArtifact, { force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('loader resets only empty-object verification corruption without claiming completion', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-goal-recovery-'));
  const persistPath = path.join(dataDir, 'goals.json');
  const goal = goalFixture('corrupt-verifier', {
    metrics: { progress: 75 },
    metadata: { lastVerification: {}, executionAttempts: 3 },
  });
  fs.writeFileSync(persistPath, JSON.stringify({
    version: 1,
    goals: { [goal.id]: goal },
    activeGoals: [goal.id],
    completedGoals: [],
    failedGoals: [],
    stats: {},
  }));
  const planner = new GoalPlannerArbiter({ dataDir });
  try {
    await planner._loadFromDisk();
    const recovered = planner.goals.get(goal.id);
    assert.equal(recovered.status, 'active');
    assert.equal(recovered.metrics.progress, 65);
    assert.equal(recovered.metadata.executionAttempts, 0);
    assert.equal(recovered.metadata.lastVerification, undefined);
    assert.equal(recovered.metadata.verificationRecovery.reason, 'async_verifier_promise_was_not_awaited');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('evidence preflight selects concrete proof contracts by goal type', () => {
  const code = compileEvidencePreflight({ title: 'Repair the arbiter route implementation' });
  const research = compileEvidencePreflight({ category: 'research', title: 'Investigate source material' });
  assert.equal(code.profile, 'code');
  assert.equal(code.requiresExecutableProof, true);
  assert.deepEqual(code.proof, ['changed file', 'syntax or build', 'tests']);
  assert.equal(research.profile, 'research');
  assert.equal(research.requiresExecutableProof, false);
});

test('lifecycle reporting uses states and preserves human goal identity', () => {
  assert.equal(deriveGoalState({ status: 'pending' }), 'queued');
  assert.equal(deriveGoalState({ status: 'active', metadata: { executionAttempts: 1 } }), 'executing');
  assert.equal(deriveGoalState({ status: 'active', metadata: { lastVerification: { passed: false } } }), 'awaiting_evidence');
  assert.equal(isHumanGoal({ status: 'active', metadata: { source: 'discord_admin' } }), true);
});

test('research verification requires a durable report and source trail', async () => {
  const relativeArtifact = `data/research-proof-${process.pid}-${Date.now()}.md`;
  const absoluteArtifact = path.join(process.cwd(), relativeArtifact);
  fs.writeFileSync(absoluteArtifact, '# Finding\nEvidence from https://example.com/source\n', 'utf8');
  const goal = goalFixture('research-proof', {
    category: 'research',
    title: 'Investigate a source-backed question',
    verification: { profile: 'research', evidenceRequired: ['summary', 'artifact'] },
  });
  try {
    const passed = await verifyGoal(goal, {
      summary: 'The report contains a traceable source.',
      evidence: { artifact: relativeArtifact },
    });
    assert.equal(passed.passed, true, JSON.stringify(passed));

    fs.writeFileSync(absoluteArtifact, '# Finding\nNo source trail.\n', 'utf8');
    const failed = await verifyGoal(goal, {
      summary: 'The report is no longer sourced.',
      evidence: { artifact: relativeArtifact },
    });
    assert.equal(failed.passed, false);
    assert.equal(failed.checks.find(check => check.type === 'source_trail').passed, false);
  } finally {
    fs.rmSync(absoluteArtifact, { force: true });
  }
});

test('capacity deferral preserves human requests', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-goal-slots-'));
  const planner = new GoalPlannerArbiter({ dataDir, maxActiveGoals: 3, humanReservedSlots: 1 });
  const human = goalFixture('human-slot', { priority: 1, metadata: { source: 'discord_admin' } });
  const autonomous = goalFixture('auto-slot', { priority: 2, metadata: { source: 'autonomous' } });
  planner.goals.set(human.id, human);
  planner.goals.set(autonomous.id, autonomous);
  planner.activeGoals.add(human.id);
  planner.activeGoals.add(autonomous.id);
  try {
    const count = await planner.deferLowPriorityGoals(1, { preserveHuman: true });
    assert.equal(count, 1);
    assert.equal(planner.activeGoals.has(human.id), true);
    assert.equal(planner.activeGoals.has(autonomous.id), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('deferred backlog compaction writes an auditable archive', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-goal-archive-'));
  const planner = new GoalPlannerArbiter({ dataDir });
  const now = Date.now();
  for (let index = 0; index < 4; index++) {
    const goal = goalFixture(`deferred-${index}`, {
      status: 'deferred',
      createdAt: now - index * 1000,
      metadata: { source: 'autonomous' },
    });
    planner.goals.set(goal.id, goal);
  }
  try {
    const result = planner.compactDeferredGoals({ maxRetained: 2, now });
    assert.equal(result.archived, 2);
    assert.equal(result.retained, 2);
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(fs.readFileSync(result.path, 'utf8').trim().split('\n').length, 2);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lifecycle canary traverses the real completion verifier without external work', async () => {
  const dataDir = path.join(process.cwd(), 'data', `test-goal-canary-${process.pid}-${Date.now()}`);
  const planner = new GoalPlannerArbiter({ dataDir });
  try {
    const result = await planner.runLifecycleCanary();
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(planner.activeGoals.size, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
