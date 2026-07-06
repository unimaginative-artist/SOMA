import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';

const require = createRequire(import.meta.url);
const GoalPlannerArbiter = require('../arbiters/GoalPlannerArbiter.cjs');
const AutonomousHeartbeat = require('../server/services/AutonomousHeartbeat.cjs');
const { GoalExecutionLease } = require('../core/GoalExecutionLease.cjs');
const { transitionGoal } = require('../core/GoalLifecycle.cjs');
const { atomicWriteJson, readJsonWithRecovery } = require('../core/AtomicJsonStore.cjs');
const ROOT = process.cwd();
const PROGRESS_DIR = path.join(ROOT, 'data', 'goal-progress');

test('restored observations do not consume the next session step budget', async () => {
  const goalId = `continuation-regression-${process.pid}-${Date.now()}`;
  const progressFile = path.join(PROGRESS_DIR, `${goalId}.json`);
  const priorObservations = Array.from({ length: 15 }, (_, index) => ({
    step: index + 1,
    tool: 'memory_recall',
    result: { memories: [] }
  }));

  await fs.mkdir(PROGRESS_DIR, { recursive: true });
  await fs.writeFile(progressFile, JSON.stringify({
    goalId,
    totalIterations: 15,
    observations: priorObservations
  }), 'utf8');

  const executor = new SomaAgenticExecutor({ maxIterations: 1, sessionTimeout: 10_000 });
  executor.initialize({
    brain: {},
    memory: {
      recall: async () => [],
      remember: async () => true
    },
    goalPlanner: { updateGoalProgress: async () => ({ success: true }) },
    system: {}
  });
  executor._callDirectAPI = async () => ({
    text: 'THINK: record one new concrete step\nTOOL: memory_store\nARGS: {"content":"continuation executed","importance":5}'
  });

  try {
    const result = await executor.execute({ id: goalId, title: 'Verify resumed goal execution', metadata: {} });
    assert.equal(result.iterations, 1);
    assert.equal(result.totalIterations, 16);
    assert.equal(result.observations.length, 13);
    assert.equal(result.observations.at(-1).tool, 'memory_store');
    assert.equal(result.needsContinuation, true);
  } finally {
    await fs.rm(progressFile, { force: true });
  }
});

test('completion evidence validates a written artifact on disk', async () => {
  const artifact = path.join('data', `completion-evidence-${process.pid}-${Date.now()}.txt`);
  const absoluteArtifact = path.join(ROOT, artifact);
  await fs.writeFile(absoluteArtifact, 'verified artifact', 'utf8');

  const executor = new SomaAgenticExecutor();
  try {
    const evidence = await executor._verifyCompletionEvidence({
      id: 'artifact-evidence-goal',
      title: 'Create a verified artifact',
      createdAt: Date.now() - 1000,
      successCriteria: ['Produce a concrete output artifact'],
      verification: { evidenceRequired: ['summary', 'artifact'] },
      metadata: {}
    }, 'Created and verified the artifact.', 'The artifact exists and is non-empty', [{
      tool: 'write_file',
      goalId: 'artifact-evidence-goal',
      observedAt: Date.now(),
      args: { path: artifact },
      result: { success: true, path: absoluteArtifact }
    }], 'artifact-evidence-execution');
    assert.equal(evidence.passed, true);
    assert.equal(evidence.checks[0].type, 'artifact_exists');
    assert.equal(evidence.checks[0].passed, true);
  } finally {
    await fs.rm(absoluteArtifact, { force: true });
  }
});

test('heartbeat completion verification accepts executable code evidence', async () => {
  const heartbeat = new AutonomousHeartbeat({}, {});
  const goal = {
    id: 'code-evidence-goal',
    title: 'Verify a code change with executable proof',
    createdAt: Date.now() - 1000,
    metadata: {}
  };
  const result = {
    toolsUsed: ['verify_syntax', 'run_tests'],
    completionEvidence: {
      passed: true,
      checks: [
        { type: 'syntax', passed: true, receiptId: 'syntax-receipt' },
        { type: 'tests', passed: true, receiptId: 'test-receipt' }
      ]
    },
    observations: [
      {
        tool: 'verify_syntax',
        goalId: goal.id,
        observedAt: Date.now(),
        args: { filePath: 'core/SomaAgenticExecutor.js' },
        result: { valid: true, filePath: 'core/SomaAgenticExecutor.js' }
      },
      {
        tool: 'run_tests',
        goalId: goal.id,
        observedAt: Date.now(),
        args: { testFile: 'tests/soma-agentic-executor-continuation.test.mjs' },
        result: { passed: true, testFile: 'tests/soma-agentic-executor-continuation.test.mjs' }
      }
    ]
  };

  const verification = await heartbeat._verifyGoalCompletion(goal, result);
  assert.equal(verification.verified, true);
  assert.equal(verification.evidence.runTests, true);
  assert.equal(verification.evidence.verifySyntax, true);
});

test('heartbeat completion verification accepts sandbox and delegation evidence', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const stageDir = path.join(ROOT, 'data', 'test-stage-proof', suffix);
  const manifestPath = path.join(stageDir, 'pulse-self-mod-manifest.json');
  const artifactPath = path.join(stageDir, 'delegation.json');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({ status: 'ready_for_promotion' }), 'utf8');
  await fs.writeFile(artifactPath, JSON.stringify({ artifacts: [] }), 'utf8');

  const heartbeat = new AutonomousHeartbeat({}, {});
  const goal = {
    id: 'sandbox-delegation-goal',
    title: 'Verify sandbox and delegation proof',
    createdAt: Date.now() - 1000,
    metadata: {}
  };

  try {
    const verification = await heartbeat._verifyGoalCompletion(goal, {
      toolsUsed: ['pulse_stage_code', 'spawn_agents'],
      completionEvidence: {
        passed: true,
        checks: [
          { type: 'sandbox_stage', passed: true, receiptId: 'stage-receipt', path: manifestPath },
          { type: 'delegation_artifact', passed: true, receiptId: 'delegation-receipt', path: artifactPath }
        ]
      },
      observations: [
        {
          tool: 'pulse_stage_code',
          goalId: goal.id,
          observedAt: Date.now(),
          args: { filepath: 'core/SomaAgenticExecutor.js' },
          result: {
            success: true,
            manifestPath,
            filepath: 'core/SomaAgenticExecutor.js',
            syntax: { valid: true }
          }
        },
        {
          tool: 'spawn_agents',
          goalId: goal.id,
          observedAt: Date.now(),
          result: {
            success: true,
            artifactPath,
            validation: { passed: true }
          }
        }
      ]
    });
    assert.equal(verification.verified, true);
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
});

test('goal janitor defers stale goals and fails unverifiable verification loops', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const dataDir = path.join(ROOT, 'data', 'test-goal-janitor', suffix);
  await fs.mkdir(dataDir, { recursive: true });
  const planner = new GoalPlannerArbiter({ dataDir });
  const now = Date.now();
  const staleGoal = {
    id: `stale-${suffix}`,
    title: 'Old autonomous idea with no work',
    status: 'pending',
    priority: 10,
    metrics: { progress: 0 },
    metadata: { source: 'autonomous' },
    createdAt: now - 3 * 24 * 60 * 60 * 1000,
    assignedTo: [],
    tasks: [],
    dependencies: [],
    prerequisites: []
  };
  const failedLoop = {
    id: `verification-loop-${suffix}`,
    title: 'Verification failed with no continuation proof',
    status: 'verification_failed',
    priority: 50,
    metrics: { progress: 75 },
    metadata: {
      source: 'autonomous',
      lastTransition: { at: now - 60 * 60 * 1000 }
    },
    createdAt: now - 2 * 60 * 60 * 1000,
    assignedTo: [],
    tasks: [],
    dependencies: [],
    prerequisites: []
  };
  planner.goals.set(staleGoal.id, staleGoal);
  planner.goals.set(failedLoop.id, failedLoop);
  planner.activeGoals.add(staleGoal.id);
  planner.activeGoals.add(failedLoop.id);

  const heartbeat = new AutonomousHeartbeat({ goalPlanner: planner }, {});
  try {
    const result = await heartbeat._runGoalJanitor({ now, stalePendingMs: 60_000, verificationFailureGraceMs: 60_000 });
    assert.equal(result.actions.length, 2);
    assert.equal(staleGoal.status, 'deferred');
    assert.equal(staleGoal.metadata.janitorState, 'stale');
    assert.equal(failedLoop.status, 'failed');
    assert.equal(failedLoop.metadata.janitorState, 'broken');
    assert.equal(planner.activeGoals.has(staleGoal.id), false);
    assert.equal(planner.activeGoals.has(failedLoop.id), false);
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('heartbeat writes durable execution receipts for agentic work', async () => {
  const goal = {
    id: `receipt-${process.pid}-${Date.now()}`,
    title: 'Receipt fixture',
    status: 'active',
    metrics: { progress: 42 },
    metadata: { source: 'discord_admin' }
  };
  const heartbeat = new AutonomousHeartbeat({}, {});
  const receipt = await heartbeat._writeExecutionReceipt(goal, {
    done: false,
    state: 'incomplete_step_budget',
    stopReason: 'max_iterations_reached',
    toolsUsed: ['read_file'],
    iterations: 1,
    totalIterations: 1,
    result: 'Read one file and saved continuation state.',
    observations: [{
      step: 1,
      tool: 'read_file',
      result: { content: 'hello' }
    }]
  }, { progress: 42, verificationNote: 'not complete yet' });

  try {
    assert.ok(receipt.path.startsWith('data/goal-receipts/'));
    const parsed = JSON.parse(await fs.readFile(path.join(ROOT, receipt.path), 'utf8'));
    assert.equal(parsed.goalId, goal.id);
    assert.equal(parsed.done, false);
    assert.equal(parsed.toolOutcomes.length, 1);
    assert.equal(parsed.toolOutcomes[0].success, true);
  } finally {
    if (receipt?.path) await fs.rm(path.join(ROOT, receipt.path), { force: true });
  }
});

test('filesystem lease prevents concurrent execution and validates release tokens', async () => {
  const root = path.join(ROOT, 'data', 'test-goal-leases', `${process.pid}-${Date.now()}`);
  const manager = new GoalExecutionLease({ root, defaultTtlMs: 60_000 });
  try {
    const first = manager.acquire('same-goal', 'worker-a');
    const second = manager.acquire('same-goal', 'worker-b');
    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    assert.equal(second.reason, 'goal_already_leased');
    assert.equal(manager.release({ ...first, lease: { ...first.lease, token: 'wrong' } }).released, false);
    assert.equal(manager.release(first).released, true);
    assert.equal(manager.acquire('same-goal', 'worker-b').acquired, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('invalid lifecycle transitions are rejected', () => {
  const goal = { id: 'lifecycle-goal', status: 'completed', metadata: {} };
  assert.throws(() => transitionGoal(goal, 'active'), /Invalid goal transition/);
  assert.equal(goal.status, 'completed');
});

test('atomic JSON store recovers the last valid backup', async () => {
  const root = path.join(ROOT, 'data', 'test-atomic-json', `${process.pid}-${Date.now()}`);
  const file = path.join(root, 'state.json');
  try {
    atomicWriteJson(file, { generation: 1 });
    atomicWriteJson(file, { generation: 2 });
    await fs.writeFile(file, '{broken json', 'utf8');
    const recovered = readJsonWithRecovery(file);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.value.generation, 1);
    assert.equal(recovered.source, `${file}.bak`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vague goals receive deterministic measurable decomposition without a brain', () => {
  const planner = new GoalPlannerArbiter({ dataDir: path.join(ROOT, 'data', 'test-decomposition-unused') });
  const goal = {
    id: 'broad-self-improvement-goal',
    title: 'Self-audit and harden every cognition layer',
    description: 'Improve memory, reasoning, throughput, verification, and self-modification architecture across the whole system.',
    metadata: {},
    tasks: [{ taskId: 'routing-receipt', arbiter: 'SomaAgenticExecutor', status: 'assigned' }]
  };
  try {
    assert.equal(planner._isComplexGoal(goal), true);
    const steps = planner._deterministicDecomposition(goal);
    assert.equal(steps.length, 4);
    assert.ok(steps.every(step => step.artifactPath.startsWith(`data/self-improvement/${goal.id}/`)));
    assert.ok(steps.every(step => step.successCriteria.length >= 2));
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
  }
});

test('exhausted attempt budget writes an autopsy, escalates to MAX, and marks goal broken', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const dataDir = path.join(ROOT, 'data', 'test-attempt-budget', suffix);
  const leaseRoot = path.join(ROOT, 'data', 'test-attempt-leases', suffix);
  await fs.mkdir(dataDir, { recursive: true });
  const planner = new GoalPlannerArbiter({ dataDir });
  const goal = {
    id: `attempt-goal-${suffix}`,
    title: 'Bounded failing goal',
    description: 'A fixture that has exhausted its durable execution budget.',
    category: 'engineering',
    status: 'active',
    metrics: { progress: 50 },
    metadata: { executionAttempts: 1, goalContract: { maxAttempts: 1 } },
    dependencies: [],
    prerequisites: [],
    assignedTo: [],
    tasks: []
  };
  planner.goals.set(goal.id, goal);
  planner.activeGoals.add(goal.id);
  let escalations = 0;
  const system = {
    goalPlanner: planner,
    agenticExecutor: {
      execute: async () => { throw new Error('executor must not run after budget exhaustion'); },
      escalateGoalToMax: async () => { escalations++; return { success: true, maxGoalId: 'max-repair-goal' }; }
    }
  };
  const heartbeat = new AutonomousHeartbeat(system, { goalLeaseRoot: leaseRoot });
  heartbeat._writeGoalAutopsy = async () => ({ path: 'data/goal-autopsies/attempt-test.json' });
  try {
    const result = await heartbeat._executeAgenticGoal(goal);
    assert.equal(result.state, 'attempt_budget_exhausted');
    assert.equal(escalations, 1);
    assert.equal(goal.status, 'broken');
    assert.equal(planner.activeGoals.has(goal.id), false);
    assert.equal(goal.metadata.maxEscalation.maxGoalId, 'max-repair-goal');
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(leaseRoot, { recursive: true, force: true });
  }
});

test('two execution sessions produce one verified completion', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const goalId = `e2e-goal-${suffix}`;
  const artifact = `data/e2e-goal-${suffix}.json`;
  const dataDir = path.join(ROOT, 'data', 'test-e2e-goals', suffix);
  const leaseRoot = path.join(ROOT, 'data', 'test-e2e-leases', suffix);
  await fs.mkdir(dataDir, { recursive: true });

  const planner = new GoalPlannerArbiter({ dataDir });
  const goal = {
    id: goalId,
    type: 'operational',
    category: 'engineering',
    title: 'Produce one verified end to end artifact',
    description: 'Write the goal artifact in session one and verify completion in session two.',
    status: 'active',
    approved: true,
    priority: 80,
    metrics: { progress: 0 },
    dependencies: [],
    prerequisites: [],
    createdAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    assignedTo: [],
    tasks: [],
    successCriteria: ['Produce a concrete output artifact'],
    verification: { evidenceRequired: ['summary', 'artifact'], filesExist: [artifact] },
    metadata: {
      source: 'discord_admin',
      expectedArtifact: artifact,
      evidenceRequired: ['summary', 'artifact'],
      goalContract: {
        successCriteria: ['Produce a concrete output artifact'],
        evidenceRequired: ['summary', 'artifact'],
        maxAttempts: 3,
        verification: { evidenceRequired: ['summary', 'artifact'], filesExist: [artifact] }
      }
    }
  };
  planner.goals.set(goalId, goal);
  planner.activeGoals.add(goalId);

  const memory = { recall: async () => [], remember: async () => true };
  const executor = new SomaAgenticExecutor({ maxIterations: 1, sessionTimeout: 10_000 });
  const system = { goalPlanner: planner, mnemonicArbiter: memory };
  executor.initialize({ brain: {}, memory, goalPlanner: planner, system });
  system.agenticExecutor = executor;
  const heartbeat = new AutonomousHeartbeat(system, { goalLeaseRoot: leaseRoot, goalLeaseTtlMs: 60_000 });

  const responses = [
    `THINK: write the required goal artifact\nTOOL: write_file\nARGS: {"path":"${artifact}","content":"{\\"verified\\":true}"}`,
    'DONE: yes\nRESULT: Created the required artifact and verified its persisted contents.\nFALSIFICATION_TEST: The expected JSON artifact exists, is non-empty, and hashes successfully.\nTEST_RESULT: true'
  ];
  executor._callDirectAPI = async () => ({ text: responses.shift() });

  try {
    const first = await heartbeat._executeAgenticGoal(goal);
    assert.equal(first.done, false);
    assert.equal(first.needsContinuation, true);
    assert.equal(first.totalIterations, 1);

    const second = await heartbeat._executeAgenticGoal(goal);
    assert.equal(second.done, true);
    assert.equal(second.completionEvidence.passed, true);
    assert.equal(second.totalIterations, 1);
    assert.ok(second.evidencePath);

    const heartbeatVerification = await heartbeat._verifyGoalCompletion(goal, second);
    assert.equal(heartbeatVerification.verified, true);
    await planner.updateGoalProgress(goalId, 99, { evidence: heartbeatVerification.evidence });
    const completed = await planner.completeGoal(goalId, {
      summary: second.result,
      result: second.result,
      evidence: heartbeatVerification.evidence
    });
    const duplicate = await planner.completeGoal(goalId, {
      summary: second.result,
      evidence: heartbeatVerification.evidence
    });
    assert.equal(completed.success, true, JSON.stringify(completed.verification || completed, null, 2));
    assert.equal(duplicate.alreadyCompleted, true);
    assert.equal(planner.completedGoals.filter(item => item.id === goalId).length, 1);
    assert.equal(goal.status, 'completed');
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(leaseRoot, { recursive: true, force: true });
    await fs.rm(path.join(ROOT, artifact), { force: true });
    await fs.rm(path.join(PROGRESS_DIR, `${goalId}.json`), { force: true });
    await fs.rm(path.join(PROGRESS_DIR, `${goalId}.json.bak`), { force: true });
    await fs.rm(path.join(PROGRESS_DIR, `${goalId}.observations.jsonl`), { force: true });
    await fs.rm(path.join(ROOT, 'data', 'goal-evidence', `${goalId}.json`), { force: true });
    await fs.rm(path.join(ROOT, 'data', 'goal-evidence', `${goalId}.json.bak`), { force: true });
  }
});

test('goal loader revives verification failures only when continuation evidence exists', async () => {
  const goalId = `goal-recovery-${process.pid}-${Date.now()}`;
  const dataDir = path.join(ROOT, 'data', 'test-goal-recovery', goalId);
  const progressFile = path.join(PROGRESS_DIR, `${goalId}.json`);
  const goal = {
    id: goalId,
    title: 'Recover a goal with persisted work',
    description: 'Regression fixture for continuation recovery after verification failure.',
    category: 'engineering',
    status: 'verification_failed',
    priority: 50,
    metrics: { progress: 95 },
    metadata: {},
    createdAt: Date.now(),
    assignedTo: [],
    tasks: []
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(PROGRESS_DIR, { recursive: true });
  await fs.writeFile(progressFile, JSON.stringify({ goalId, observations: [{ step: 1, tool: 'list_files' }] }), 'utf8');
  await fs.writeFile(path.join(dataDir, 'goals.json'), JSON.stringify({
    goals: { [goalId]: goal },
    activeGoals: [goalId],
    completedGoals: [],
    failedGoals: []
  }), 'utf8');

  const planner = new GoalPlannerArbiter({ dataDir });
  try {
    await planner._loadFromDisk();
    const recovered = planner.goals.get(goalId);
    assert.equal(recovered.status, 'pending');
    assert.equal(recovered.metrics.progress, 75);
    assert.equal(recovered.metadata.continuationFile, progressFile);
    assert.equal(planner.activeGoals.has(goalId), true);
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(progressFile, { force: true });
  }
});
