import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SomaAgenticExecutor, goalAllowsMutationPath } from '../core/SomaAgenticExecutor.js';
import { SelfRepairCoordinator } from '../core/SelfRepairCoordinator.js';
import AutonomousHeartbeat from '../server/services/AutonomousHeartbeat.cjs';

test('off-scope and protected proposals stop the executor in one step and free its slot', async () => {
  const executor = new SomaAgenticExecutor();
  executor.initialize({});
  executor.maxIterations = 5;
  executor._deliberateSelection = async () => ({ approved: true });
  executor._recallMemories = async () => [];
  executor._loadGoalAutopsy = async () => null;
  let modelCalls = 0;
  executor._callDirectAPI = async () => {
    modelCalls++;
    return { text: 'THINK: change executor\nTOOL: modify_code\nARGS: {"filepath":"core/SomaAgenticExecutor.js","request":"change it"}' };
  };
  executor.brain = { name: 'fixture' };
  const goal = { id: `scope-fixture-${Date.now()}`, title: 'Repair research source',
    metadata: { goalContract: { strict: true, allowedTools: ['modify_code'],
      allowedWritePaths: [path.join(process.cwd(), 'core', 'ResearchSourcePolicy.js')] } } };
  assert.equal(goalAllowsMutationPath(goal, 'modify_code', { filepath: 'core/SomaAgenticExecutor.js' }).allowed, false);
  const result = await executor.execute(goal);
  assert.equal(result.state, 'blocked');
  assert.equal(result.stopReason, 'goal_contract_rejected');
  assert.equal(result.needsContinuation, false);
  assert.equal(result.iterations, 1);
  assert.equal(result.observations.at(-1).outcome.code, 'PATH_OUTSIDE_GOAL_CONTRACT');
  assert.equal(modelCalls, 1);
  assert.equal(executor._executionActive, false);
  const offScope = { metadata: { goalContract: { strict: true, allowedTools: ['modify_code'],
    allowedWritePaths: [path.join(process.cwd(), 'arbiters', 'AnalystArbiter.cjs')] } } };
  assert.deepEqual(goalAllowsMutationPath(offScope, 'modify_code', { filepath: 'core/ResearchSourcePolicy.js' }),
    { allowed: false, reason: 'path_outside_goal_contract' });
});

test('recovery escalation retains the original research file and source hash', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-rsi-scope-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'core'));
  const source = 'export const pinned = true;\n';
  await fs.writeFile(path.join(root, 'core', 'ResearchSourcePolicy.js'), source);
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const original = { id: 'original-research', title: 'Improve research evidence',
    description: 'Change only core/ResearchSourcePolicy.js under the fixed evaluator.',
    metadata: { researchPlanId: 'plan-1', asiCycleId: 'cycle-1',
      capabilityContract: { testFiles: ['tests/original.test.mjs'], risk: 'medium' } } };
  const recovery = { id: 'recovery', title: 'Recovery', description: 'Previously proposed core/SomaAgenticExecutor.js',
    metadata: { recoveryOfGoalId: original.id } };
  let submitted;
  const system = { goalPlanner: { goals: new Map([[original.id, original]]) },
    selfEvolutionResearch: { validatePlan: async id => {
      assert.equal(id, 'plan-1');
      return { id, file: 'core/ResearchSourcePolicy.js', sourceHash, testFiles: ['tests/original.test.mjs'] };
    } },
    maxBridge: { ensureAvailable: async () => ({ available: true, health: { boundedRepairProtocol: 1 } }),
      injectGoal: async (_title, request) => { submitted = request; return { id: 'max-fixture' }; } } };
  const coordinator = new SelfRepairCoordinator({ system, root });
  const queued = await coordinator.queue(recovery, null);
  assert.equal(queued.success, true);
  assert.equal(submitted.repairContract.sourceGoalId, original.id);
  assert.deepEqual(submitted.repairContract.files, [{ path: 'core/ResearchSourcePolicy.js', sourceHash }]);
  assert.deepEqual(coordinator.jobs[0].capabilityContract.testFiles, ['tests/original.test.mjs']);
  assert.doesNotMatch(submitted.description, /SomaAgenticExecutor/);
  assert.equal((await coordinator.queue(recovery, null)).maxGoalId, 'max-fixture');
  assert.equal(coordinator.jobs.length, 1);

  await fs.writeFile(path.join(root, 'core', 'ResearchSourcePolicy.js'), 'changed');
  const stale = new SelfRepairCoordinator({ system, root });
  const result = await stale.queue(recovery, null);
  assert.equal(result.success, false);
  assert.match(result.error, /hash-pinned/);
});

test('terminal budget result has no continuation and the execution lease is released', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-rsi-lease-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const goal = { id: 'exhausted', title: 'Research', status: 'active', metadata: { executionAttempts: 12,
    goalContract: { maxAttempts: 12 } } };
  const planner = { goals: new Map([[goal.id, goal]]), getExecutionAttemptBudget: () => ({ attempts: 12, maxAttempts: 12 }),
    transitionGoal: (_id, status) => { goal.status = status; return { success: true }; } };
  const heartbeat = new AutonomousHeartbeat({ goalPlanner: planner, agenticExecutor: { escalateGoalToMax: async () => ({ success: false, error: 'No eligible source' }) } },
    { logger: { log() {}, warn() {}, error() {} } });
  heartbeat.goalLeases.root = root;
  heartbeat._writeGoalAutopsy = async () => ({ path: 'fixture-autopsy', record: {} });
  const result = await heartbeat._executeAgenticGoal(goal);
  assert.equal(result.state, 'attempt_budget_exhausted');
  assert.equal(result.needsContinuation, false);
  assert.equal(goal.status, 'blocked');
  assert.deepEqual(await fs.readdir(root), []);
  const receipt = await heartbeat._writeExecutionReceipt(goal, result, { lifecycleState: goal.status });
  assert.equal(receipt.receipt.lifecycleState, 'blocked');
  await fs.unlink(path.join(process.cwd(), receipt.path));
});

test('RSI goal waits for its research service without spending a boot-time execution attempt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-rsi-boot-race-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const goal = { id: 'boot-race', title: 'Pinned research repair', status: 'active',
    metadata: { selfEvolution: true, researchPlanId: 'plan-1', executionAttempts: 0 } };
  let attempts = 0;
  const system = { goalPlanner: { beginExecutionAttempt: () => { attempts++; return { success: true }; } },
    agenticExecutor: { execute: async () => { throw new Error('must wait for research'); } } };
  const heartbeat = new AutonomousHeartbeat(system, { logger: { log() {}, warn() {}, error() {} } });
  heartbeat.goalLeases.root = root;
  const deferred = await heartbeat._executeAgenticGoal(goal);
  assert.equal(deferred.state, 'dependency_initializing');
  assert.equal(deferred.needsContinuation, true);
  assert.equal(attempts, 0);
  assert.deepEqual(await fs.readdir(root), []);
  const executor = Object.create(SomaAgenticExecutor.prototype);
  executor.brain = {};
  executor.system = system;
  assert.equal((await executor._executeGoal(goal)).stopReason, 'research_service_initializing');
});

test('heartbeat writes a blocked receipt after settling a rejected goal', async () => {
  const goal = { id: 'receipt-fixture', title: 'Bounded repair', description: 'Research only',
    status: 'active', metrics: { progress: 0 }, metadata: {} };
  const receipts = [];
  const planner = { goals: new Map([[goal.id, goal]]), activeGoals: new Set([goal.id]),
    transitionGoal: (_id, status) => { goal.status = status; return { success: true }; },
    updateGoalProgress: async () => ({ success: true }), _saveToDisk() {} };
  const heartbeat = new AutonomousHeartbeat({ goalPlanner: planner, agenticExecutor: {},
    autonomyReliability: { dashboard: () => ({ metrics: {} }) },
    realityLoop: { observeGoalAttempt: async () => {} } },
  { logger: { log() {}, warn() {}, error() {} } });
  heartbeat.isRunning = true;
  heartbeat._assessResourcePressure = () => ({ level: 'normal', memoryUsedRatio: 0, processHeapRatio: 0, actions: [] });
  heartbeat._applyResourcePolicy = async () => [];
  heartbeat._getDueSchedules = () => [];
  heartbeat._runGoalJanitor = async () => ({ actions: [] });
  heartbeat._pollForTask = async () => ({ source: 'GoalPlanner', description: goal.description,
    context: { goalId: goal.id, goalTitle: goal.title } });
  heartbeat._executeAgenticGoal = async () => ({ done: false, state: 'blocked',
    stopReason: 'goal_contract_rejected', result: 'protected_or_non_source_path',
    iterations: 1, toolsUsed: [], observations: [], needsContinuation: false });
  heartbeat._writeExecutionReceipt = async (_goal, _result, context) => {
    receipts.push({ status: goal.status, lifecycleState: context.lifecycleState });
    return { path: 'data/goal-receipts/fixture.json', receipt: { receiptId: 'fixture' } };
  };
  heartbeat._reportGoalTerminal = async () => ({ reported: false });
  heartbeat._appendRunLog = () => {};
  heartbeat._broadcast = () => {};
  heartbeat._updateTaskState = () => {};
  heartbeat._sendProactiveSummary = async () => {};
  await heartbeat.tick();
  assert.equal(goal.status, 'blocked');
  assert.deepEqual(receipts, [{ status: 'blocked', lifecycleState: 'blocked' }]);
  assert.equal(goal.metadata.latestExecutionReceipt, 'data/goal-receipts/fixture.json');
});

test('MAX proposal outside pinned repair files is rejected before pipeline mutation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-rsi-max-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'core'));
  const source = 'export const source = true;\n';
  await fs.writeFile(path.join(root, 'core', 'ResearchSourcePolicy.js'), source);
  const sourceHash = createHash('sha256').update(source).digest('hex');
  let mutationCalls = 0;
  const system = { agenticExecutor: {}, selfRepairDeployment: {},
    selfModificationGovernance: { records: [] },
    maxBridge: { getGoal: async () => ({ status: 'done', outcome: { state: 'proposal_only',
      sourceGoalId: 'original', patch: { files: [{ path: 'core/SomaAgenticExecutor.js', content: 'bad' }] } } }) },
    selfModPipeline: { propose: async () => { mutationCalls++; } } };
  const coordinator = new SelfRepairCoordinator({ system, root });
  coordinator.jobs = [{ sourceGoalId: 'original', maxGoalId: 'max-job', status: 'queued',
    files: [{ path: 'core/ResearchSourcePolicy.js', sourceHash }], createdAt: Date.now() - 1000 }];
  await coordinator.tick();
  assert.equal(coordinator.jobs[0].status, 'blocked');
  assert.match(coordinator.jobs[0].error, /exceeded its repair scope/);
  assert.equal(mutationCalls, 0);
  assert.equal(coordinator.busy, false);
  assert.equal(await fs.readFile(path.join(root, 'core', 'ResearchSourcePolicy.js'), 'utf8'), source);
});
