'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AutonomyScoreboard } = require('../core/AutonomyScoreboard.cjs');
const { STATUS } = require('../core/GoalLifecycle.cjs');

test('scoreboard reports useful outcomes, weakest capability, and real failure causes', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-scoreboard-'));
  const goals = new Map([
    ['a', { id: 'a', category: 'research', status: STATUS.COMPLETED, metadata: { autonomousMission: true, completionClassification: 'research_complete' } }],
    ['b', { id: 'b', category: 'engineering', status: STATUS.BLOCKED, metadata: { autonomousMission: true, lastTransition: { reason: 'tool_timeout' } } }]
  ]);
  const scoreboard = new AutonomyScoreboard({
    planner: { goals },
    governor: { proposals: [{ status: 'proposed', seenCount: 3 }, { status: 'completed', metadata: { outcome: 'verified_completion' } }] },
    dataDir
  }).snapshot({ idleReason: 'slot_empty', resource: { level: 'normal' } });
  assert.equal(scoreboard.usefulCompletions, 1);
  assert.equal(scoreboard.weakestArea, 'engineering');
  assert.equal(scoreboard.failureCauses.tool_timeout, 1);
  assert.equal(scoreboard.proposals.deduplicatedSignals, 2);
  assert.ok(fs.existsSync(path.join(dataDir, 'autonomy-scoreboard.json')));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('scoreboard does not mislabel deferred backlog as active work', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-scoreboard-deferred-'));
  const goals = new Map([
    ['deferred', { id: 'deferred', category: 'research', status: STATUS.DEFERRED, metadata: { autonomousMission: true } }],
    ['active', { id: 'active', category: 'engineering', status: STATUS.ACTIVE, metadata: { autonomousMission: true } }]
  ]);
  const scoreboard = new AutonomyScoreboard({ planner: { goals }, governor: { proposals: [] }, dataDir }).snapshot();
  assert.equal(scoreboard.activeMissions, 1);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('scoreboard carries forward reconciled director history after old goal compaction', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-scoreboard-history-'));
  const scoreboard = new AutonomyScoreboard({ planner: { goals: new Map() }, governor: { proposals: [] }, dataDir })
    .snapshot({ historical: { verifiedCompletions: 17, failedMissions: 22 } });
  assert.equal(scoreboard.verifiedCompletions, 17);
  assert.equal(scoreboard.usefulCompletions, 17);
  assert.equal(scoreboard.failedMissions, 22);
  assert.equal(scoreboard.completionRate, 43.6);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
