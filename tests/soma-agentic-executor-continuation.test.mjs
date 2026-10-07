import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
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

test('alternative evidence criteria do not require every listed evidence mode', () => {
  const executor = new SomaAgenticExecutor();
  assert.deepEqual(
    executor._criterionRequirements('Use concrete source, file, test, or measurement evidence'),
    ['inspection']
  );
  assert.deepEqual(
    executor._criterionRequirements('Run the relevant test and record the executable result'),
    ['tests', 'executable']
  );
});

test('implementation missions cannot complete from a formatted report alone', async () => {
  const artifact = path.join('data', `false-code-completion-${process.pid}-${Date.now()}.md`);
  const absoluteArtifact = path.join(ROOT, artifact);
  await fs.writeFile(absoluteArtifact, '# Evidence inspected\ncore/Foo.js\n\n# Evidence-backed finding\nA change is needed.\n\n# Verification status\nReport only.', 'utf8');
  const executor = new SomaAgenticExecutor();
  const goal = {
    id: 'false-code-completion',
    title: 'Autonomous mission: Implement a real endpoint',
    createdAt: Date.now() - 1000,
    successCriteria: [
      'Produce at least one governed source-code change in the scoped implementation roots',
      'Run and pass executable tests for the changed behavior',
      'Run and pass syntax or build verification for changed source files',
      `Create the supporting evidence report at ${artifact}`
    ],
    verification: {
      profile: 'code',
      evidenceRequired: ['summary', 'artifact', 'code_change', 'tests'],
      filesExist: [artifact],
      requiresExecutableProof: true,
      requiresCodeChange: true
    },
    metadata: {
      autonomousMission: true,
      expectedArtifact: artifact,
      requiresExecutableProof: true,
      requiresCodeChange: true
    }
  };
  try {
    const evidence = await executor._verifyCompletionEvidence(goal, 'Created the report.', 'The report exists.', [{
      tool: 'write_file',
      goalId: goal.id,
      observedAt: Date.now(),
      args: { path: artifact },
      result: { success: true, path: artifact }
    }], 'false-code-execution');
    assert.equal(evidence.passed, false);
    assert.equal(evidence.codeChangeProof.passed, false);
    assert.equal(evidence.executableProof.passed, false);
  } finally {
    await fs.rm(absoluteArtifact, { force: true });
  }
});

test('implementation missions pass with a governed change, tests, syntax, and report', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const artifact = path.join('data', `true-code-completion-${suffix}.md`);
  const source = path.join('data', `true-code-completion-${suffix}.js`);
  await fs.writeFile(path.join(ROOT, artifact), `# Evidence inspected

core/Foo.js was inspected as the implementation target. tests/endpoint.test.mjs is the executable acceptance check.

# Evidence-backed finding

The endpoint behavior was implemented through a governed source modification. The change is intentionally narrow: it exposes a deterministic health value without altering unrelated routing, authentication, memory, or trading behavior. The implementation receipt records the exact source file, while the test receipt demonstrates the requested behavior and the syntax receipt proves the changed module remains parseable.

The supporting report does not substitute for the code change. It links the source modification to the acceptance checks so a later audit can distinguish a real implementation from planning prose.

# Verification status

tests/endpoint.test.mjs passed. Syntax verification for the changed source passed. The implementation file and this report were both read through the bounded execution evidence path. No failed test, syntax, staging, code modification, or delegation receipt remains.
`, 'utf8');
  await fs.writeFile(path.join(ROOT, source), 'export const healthy = true;\n', 'utf8');
  const executor = new SomaAgenticExecutor();
  const goal = {
    id: 'true-code-completion',
    title: 'Autonomous mission: Implement a real endpoint',
    createdAt: Date.now() - 1000,
    successCriteria: [
      'Produce at least one governed source-code change in the scoped implementation roots',
      'Run and pass executable tests for the changed behavior',
      'Run and pass syntax or build verification for changed source files',
      `Create the supporting evidence report at ${artifact}`
    ],
    verification: {
      profile: 'code',
      evidenceRequired: ['summary', 'artifact', 'code_change', 'tests'],
      filesExist: [artifact],
      requiresExecutableProof: true,
      requiresCodeChange: true
    },
    metadata: {
      autonomousMission: true,
      expectedArtifact: artifact,
      requiresExecutableProof: true,
      requiresCodeChange: true
    }
  };
  const now = Date.now();
  try {
    const evidence = await executor._verifyCompletionEvidence(goal, 'Implemented and verified the endpoint.', 'The source exists and both checks pass.', [
      { tool: 'modify_code', goalId: goal.id, observedAt: now, args: { filepath: source }, result: { success: true, filepath: source } },
      { tool: 'run_tests', goalId: goal.id, observedAt: now + 1, args: { testFile: 'tests/endpoint.test.mjs' }, result: { passed: true, output: 'pass' } },
      { tool: 'verify_syntax', goalId: goal.id, observedAt: now + 2, args: { filePath: source }, result: { valid: true, filePath: source } },
      { tool: 'write_file', goalId: goal.id, observedAt: now + 3, args: { path: artifact }, result: { success: true, path: artifact } }
    ], 'true-code-execution');
    assert.equal(evidence.passed, true, JSON.stringify(evidence, null, 2));
    assert.equal(evidence.codeChangeProof.passed, true);
    assert.equal(evidence.executableProof.testsPassed, true);
    assert.equal(evidence.executableProof.syntaxPassed, true);
  } finally {
    await fs.rm(path.join(ROOT, artifact), { force: true });
    await fs.rm(path.join(ROOT, source), { force: true });
  }
});

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

test('completion evidence recognizes a verified owner-workspace artifact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-external-artifact-'));
  const artifact = path.join(dir, 'paper-trading-diagnostic.md');
  await fs.writeFile(artifact, 'Paper trading\nPnL: -1\nWin rate: 40%\nProfit factor: 0.9\nStrategy backtest\nLive trading remains blocked', 'utf8');
  const executor = new SomaAgenticExecutor({ maxIterations: 1 });
  const goal = {
    id: `external-artifact-${Date.now()}`,
    title: 'Paper trading diagnostic',
    createdAt: Date.now() - 1000,
    successCriteria: ['A diagnostic artifact exists'],
    verification: {
      filesExist: [artifact],
      evidenceRequired: ['summary', 'artifact'],
      containsAnyGroups: [['paper trading'], ['pnl'], ['win rate'], ['profit factor'], ['strategy'], ['live trading remains blocked']]
    },
    metadata: { expectedArtifact: artifact }
  };
  try {
    const observations = [
      { tool: 'workspace_write', goalId: goal.id, observedAt: Date.now(), args: { path: artifact }, result: { success: true, path: artifact } },
      { tool: 'computer_read', goalId: goal.id, observedAt: Date.now(), args: { path: artifact }, result: { content: await fs.readFile(artifact, 'utf8') } }
    ];
    const evidence = await executor._verifyCompletionEvidence(goal, `Created ${artifact}`, 'Artifact exists and contains required trading evidence.', observations, 'external-execution');
    assert.equal(evidence.passed, true, JSON.stringify(evidence, null, 2));
    assert.equal(evidence.artifactContentChecks.every(check => check.passed), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
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

test('heartbeat forwards research source receipts and the goal artifact to lifecycle verification', async () => {
  const heartbeat = new AutonomousHeartbeat({}, {});
  const goal = { id: 'research-evidence-goal', metadata: { expectedArtifact: 'research/paper.md' } };
  const verification = await heartbeat._verifyGoalCompletion(goal, {
    toolsUsed: ['web_fetch', 'read_file'],
    completionEvidence: { passed: true, checks: [{ type: 'artifact_exists', passed: true, path: 'research/paper.md', receiptId: 'a1' }] },
    observations: [
      { tool: 'web_fetch', args: { url: 'https://example.test/source' }, result: { success: true }, outcome: { ok: true } },
      { tool: 'read_file', args: { path: 'research/local.md' }, result: { success: true, path: 'research/local.md' }, outcome: { ok: true } }
    ]
  });
  assert.equal(verification.evidence.artifact, 'research/paper.md');
  assert.deepEqual(verification.evidence.sources, ['https://example.test/source', 'research/local.md']);
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

test('later execution receipts preserve prior tool evidence', async () => {
  const goal = { id: `receipt-chain-${process.pid}-${Date.now()}`, title: 'Receipt chain', metadata: {} };
  const heartbeat = new AutonomousHeartbeat({}, {});
  const first = await heartbeat._writeExecutionReceipt(goal, {
    done: false, toolsUsed: ['workspace_write'], observations: [{ tool: 'workspace_write', result: { success: true, path: 'artifact.md' } }]
  });
  goal.metadata.latestExecutionReceipt = first.path;
  const second = await heartbeat._writeExecutionReceipt(goal, {
    done: false, stopReason: 'max_attempts_reached', toolsUsed: [], observations: []
  });
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(ROOT, second.path), 'utf8'));
    assert.deepEqual(parsed.priorReceiptPaths, [first.path]);
    assert.equal(parsed.historicalToolOutcomes.some(item => item.tool === 'workspace_write' && item.success), true);
  } finally {
    await fs.rm(path.join(ROOT, first.path), { force: true });
    await fs.rm(path.join(ROOT, second.path), { force: true });
  }
});

test('blocked execution receipts preserve their real terminal lifecycle', async () => {
  const goal = { id: `blocked-receipt-${process.pid}-${Date.now()}`, title: 'Blocked receipt', status: 'blocked', metadata: {} };
  const heartbeat = new AutonomousHeartbeat({}, {});
  const receipt = await heartbeat._writeExecutionReceipt(goal, {
    done: false, state: 'attempt_budget_exhausted', stopReason: 'max_attempts_reached', toolsUsed: [], observations: []
  }, { lifecycleState: 'blocked' });
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(ROOT, receipt.path), 'utf8'));
    assert.equal(parsed.lifecycleState, 'blocked');
    assert.equal(parsed.stopReason, 'max_attempts_reached');
  } finally {
    await fs.rm(path.join(ROOT, receipt.path), { force: true });
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

test('filesystem lease immediately reclaims a lease owned by a dead process', async () => {
  const root = path.join(ROOT, 'data', 'test-goal-leases', `dead-${process.pid}-${Date.now()}`);
  const manager = new GoalExecutionLease({ root, defaultTtlMs: 60_000 });
  try {
    const first = manager.acquire('crashed-goal', 'worker-a');
    assert.equal(first.acquired, true);
    const persisted = JSON.parse(await fs.readFile(first.filePath, 'utf8'));
    persisted.pid = 2147483646;
    persisted.expiresAt = Date.now() + 60_000;
    await fs.writeFile(first.filePath, JSON.stringify(persisted), 'utf8');

    const recovered = manager.acquire('crashed-goal', 'worker-b');
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.lease.owner, 'worker-b');
    manager.release(recovered);
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
    metadata: { allowDecomposition: true, workflow: { allowDecomposition: true } },
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

test('exhausted code attempt budget writes an autopsy, escalates to MAX, and marks goal blocked', async () => {
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
    metadata: { executionAttempts: 1, goalContract: { maxAttempts: 1 }, taskKind: 'engineering' },
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
    assert.equal(goal.status, 'blocked');
    assert.equal(planner.activeGoals.has(goal.id), false);
    assert.equal(goal.metadata.maxEscalation.maxGoalId, 'max-repair-goal');
    assert.match(result.result, /MAX review was queued/);
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(leaseRoot, { recursive: true, force: true });
  }
});

test('failed MAX escalation is reported truthfully after execution budget exhaustion', async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const dataDir = path.join(ROOT, 'data', 'test-failed-max-escalation', suffix);
  const leaseRoot = path.join(ROOT, 'data', 'test-failed-max-escalation-leases', suffix);
  await fs.mkdir(dataDir, { recursive: true });
  const planner = new GoalPlannerArbiter({ dataDir });
  const goal = {
    id: `failed-max-goal-${suffix}`,
    title: 'Bounded failing goal with unavailable MAX',
    description: 'A fixture whose execution and MAX escalation budgets are exhausted.',
    category: 'engineering',
    status: 'active',
    metrics: { progress: 0 },
    metadata: { executionAttempts: 1, goalContract: { maxAttempts: 1 }, taskKind: 'engineering' },
    dependencies: [], prerequisites: [], assignedTo: [], tasks: []
  };
  planner.goals.set(goal.id, goal);
  planner.activeGoals.add(goal.id);
  const system = {
    goalPlanner: planner,
    agenticExecutor: {
      execute: async () => { throw new Error('executor must not run after budget exhaustion'); },
      escalateGoalToMax: async () => ({ success: false, error: 'MAX did not become healthy within 45000ms' })
    }
  };
  const heartbeat = new AutonomousHeartbeat(system, { goalLeaseRoot: leaseRoot });
  heartbeat._writeGoalAutopsy = async () => ({ path: 'data/goal-autopsies/failed-max-test.json' });
  try {
    const result = await heartbeat._executeAgenticGoal(goal);
    assert.equal(result.state, 'attempt_budget_exhausted');
    assert.match(result.result, /MAX escalation failed: MAX did not become healthy/);
    assert.doesNotMatch(result.result, /MAX review was queued/);
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

test('failed repair admission does not strand the original goal in a pseudo-status', async () => {
  const executor = new SomaAgenticExecutor();
  const goal = {
    id: 'repair-admission-regression',
    title: 'Produce a verified artifact',
    status: 'active',
    metrics: { progress: 60 }
  };
  executor.goalPlanner = {
    createGoal: async () => null,
    updateGoalProgress: async () => {
      throw new Error('the repair path must not mutate the original status');
    }
  };

  const repair = await executor._queuePoseidonRepairGoal(goal, {
    verified: { reason: 'missing evidence' },
    totalDoneBlocks: 2
  });

  assert.equal(repair, null);
  assert.equal(goal.status, 'active');
});

test('goal loader revives a legacy repairing goal even when the active index lost it', async () => {
  const goalId = `legacy-repairing-${process.pid}-${Date.now()}`;
  const dataDir = path.join(ROOT, 'data', 'test-goal-recovery', goalId);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'goals.json'), JSON.stringify({
    goals: {
      [goalId]: {
        id: goalId,
        title: 'Recover a stranded repair goal',
        description: 'Regression fixture for the legacy repairing pseudo-status.',
        category: 'research',
        status: 'repairing',
        priority: 50,
        metrics: { progress: 60 },
        metadata: {},
        createdAt: Date.now(),
        assignedTo: [],
        tasks: []
      }
    },
    activeGoals: [],
    completedGoals: [],
    failedGoals: []
  }), 'utf8');

  const planner = new GoalPlannerArbiter({ dataDir });
  try {
    await planner._loadFromDisk();
    const recovered = planner.goals.get(goalId);
    assert.equal(recovered.status, 'pending');
    assert.equal(recovered.metadata.lastTransition.reason, 'recover_legacy_lifecycle_status');
    assert.equal(planner.activeGoals.has(goalId), true);
  } finally {
    clearInterval(planner.planningInterval);
    clearInterval(planner.monitoringInterval);
    clearInterval(planner.autoSaveInterval);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
