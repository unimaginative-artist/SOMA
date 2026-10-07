const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const AutonomousHeartbeat = require('../server/services/AutonomousHeartbeat.cjs');

test('heartbeat writes a deterministic goal autopsy without a model call', async () => {
  const heartbeat = new AutonomousHeartbeat({}, { logger: { log() {}, warn() {}, error() {} } });
  const result = await heartbeat._writeGoalAutopsy(
    { id: 'test-autopsy-goal', title: 'Test failed verification' },
    {
      phase: 'verification_failed',
      reason: 'artifact missing',
      verification: { checks: [{ check: 'test output', passed: false }] },
      execResult: { result: 'claimed completion', toolsUsed: ['write_file'] }
    }
  );

  assert.ok(fs.existsSync(result.path));
  const record = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(record.goalId, 'test-autopsy-goal');
  assert.deepEqual(record.failedChecks, ['test output']);
  assert.match(record.nextStrategy, /concrete evidence/);
  fs.unlinkSync(result.path);
});

test('heartbeat backs off after failures instead of retrying every base interval', async () => {
  const heartbeat = new AutonomousHeartbeat({}, { logger: { log() {}, warn() {}, error() {} } });
  heartbeat.isRunning = true;
  heartbeat._pollForTask = async () => { throw new Error('test failure'); };
  await heartbeat.tick();
  assert.equal(heartbeat._consecutiveTickFailures, 1);
  assert.ok(heartbeat._failureBackoffUntil >= Date.now() + 4 * 60 * 1000);
  const failures = heartbeat.stats.failures;
  await heartbeat.tick();
  assert.equal(heartbeat.stats.failures, failures);
});

test('heartbeat reads autonomous confidence from the GoalPlanner metadata contract', async () => {
  const goal = {
    id: 'asi-confidence-goal',
    title: 'Execute a verified ASI improvement',
    description: 'Exercise the real autonomous selection path.',
    status: 'active',
    priority: 75,
    metrics: { progress: 0 },
    category: 'asi_kernel',
    metadata: { source: 'ASIKernel', confidence: 0.85 }
  };
  const competing = {
    id: 'ordinary-high-priority', title: 'Ordinary high priority work', description: 'Competing work',
    status: 'active', priority: 100, metrics: { progress: 0 }, metadata: { source: 'autonomous', confidence: 0.9 }
  };
  const observedConfidences = [];
  const goalPlanner = {
    activeGoals: new Set([goal.id, competing.id]),
    goals: new Map([[goal.id, goal], [competing.id, competing]]),
    areDependenciesSatisfied: () => true,
    _isComplexGoal: () => false
  };
  const heartbeat = new AutonomousHeartbeat({ goalPlanner }, { logger: { log() {}, warn() {}, error() {} } });
  heartbeat.drive = {
    confidenceMet(value) { observedConfidences.push(value); return value >= 0.8; },
    isUrgent: () => false,
    getUrgencyBoost: () => 0
  };
  const task = await heartbeat._pollForTask();
  assert.equal(observedConfidences.includes(0.85), true);
  assert.equal(task.context.goalId, goal.id);
});
