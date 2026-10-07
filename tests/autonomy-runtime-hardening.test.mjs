import assert from 'node:assert/strict';
import test from 'node:test';

import DistillationArbiter from '../arbiters/DistillationArbiter.js';
import { BiotechArbiter } from '../arbiters/BiotechArbiter.js';
import AutonomousHeartbeat from '../server/services/AutonomousHeartbeat.cjs';
import MnemonicArbiter from '../arbiters/MnemonicArbiter.js';

const silentLogger = {
  log() {},
  warn() {},
  error() {}
};

test('distillation accepts keyed experience collections without throwing', async () => {
  let prompt = '';
  const arbiter = new DistillationArbiter({
    quadBrain: {
      async reason(value) {
        prompt = value;
        return { text: 'Verify inputs before generalizing outcomes.' };
      }
    },
    beliefSystem: { async addBelief() {} }
  });

  await arbiter.handleLearningReady({
    payload: {
      experiences: {
        first: { action: 'read', reward: -1, outcome: 'failed', agent: 'executor' }
      }
    }
  });

  assert.match(prompt, /"action": "read"/);
  assert.equal(arbiter.isDistilling, false);
});

test('biotech initialization degrades instead of retrying forever', async () => {
  const arbiter = new BiotechArbiter({ system: {}, maxInitializeRetries: 0 });
  const result = await arbiter.initialize();

  assert.equal(result.degraded, true);
  assert.equal(arbiter.active, false);
  assert.equal(arbiter.getStatus().initializeState, 'degraded');
  assert.equal(arbiter._initializeRetryTimer, null);
});

test('mnemonic fast-start honors skipEmbedder and retains token-ranked cold recall', async () => {
  const mnemonic = new MnemonicArbiter({ skipEmbedder: true, dbPath: ':memory:', redisUrl: null });
  mnemonic.log = () => {};
  await mnemonic._initSQLite();
  await mnemonic._initAI();
  mnemonic.db.prepare(`
    INSERT INTO memories (id, content, metadata, created_at, accessed_at, importance, tier)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('one', 'SOMA completed the verified agency report with exact evidence.', '{}', Date.now(), Date.now(), 0.8, 'cold');

  assert.equal(mnemonic.embedder, null);
  assert.equal(mnemonic.reranker, null);
  const recalled = mnemonic._sqliteSearch('verified agency report', 3);
  assert.equal(recalled[0]?.id, 'one');
  assert.equal(recalled[0]?.score, 1);
  mnemonic.db.close();
});

test('heartbeat identifies constrained and critical memory pressure', () => {
  const constrained = new AutonomousHeartbeat({}, {
    logger: silentLogger,
    resourceSnapshot: () => ({ totalMemory: 100, freeMemory: 12 })
  });
  const critical = new AutonomousHeartbeat({}, {
    logger: silentLogger,
    resourceSnapshot: () => ({ totalMemory: 100, freeMemory: 5 })
  });

  assert.equal(constrained._assessResourcePressure().level, 'constrained');
  assert.equal(critical._assessResourcePressure().level, 'critical');
});

test('heartbeat treats sustained event-loop lag as critical pressure', () => {
  const heartbeat = new AutonomousHeartbeat({}, {
    logger: silentLogger,
    resourceSnapshot: () => ({ totalMemory: 100, freeMemory: 50 }),
    processMemorySnapshot: () => ({ heapUsed: 20, heapTotal: 100 }),
    eventLoopLagSnapshot: () => 2_000
  });

  const state = heartbeat._assessResourcePressure();
  assert.equal(state.level, 'critical');
  assert.equal(state.eventLoopLagMs, 2_000);
});

test('heartbeat defers accepted goals under critical pressure without starting them', async () => {
  let starts = 0;
  const goals = new Map([['pending-1', {
    id: 'pending-1', status: 'pending', title: 'Heavy accepted goal', priority: 100
  }]]);
  const heartbeat = new AutonomousHeartbeat({
    goalPlanner: {
      goals,
      activeGoals: new Set(),
      maxActiveGoals: 1,
      areDependenciesSatisfied: () => true,
      async startGoal() { starts += 1; return { success: true }; }
    }
  }, { logger: silentLogger });
  heartbeat._resourceState = { level: 'critical', memoryUsedRatio: 0.95, eventLoopLagMs: 0 };

  assert.equal(await heartbeat._pollForTask(), null);
  assert.equal(starts, 0);
  assert.equal(goals.get('pending-1').status, 'pending');
});

test('heartbeat suppresses optional curiosity work under resource pressure', async () => {
  let explored = 0;
  const heartbeat = new AutonomousHeartbeat({
    curiosityEngine: {
      curiosityQueue: [{ topic: 'optional' }],
      async explore() { explored += 1; }
    }
  }, { logger: silentLogger });
  heartbeat._resourceState = { level: 'critical', memoryUsedRatio: 0.95, sampledAt: Date.now() };

  const task = await heartbeat._pollForTask();
  assert.equal(task, null);
  assert.equal(explored, 0);
});

test('resource governor prunes registered caches once and exposes measured process pressure', async () => {
  let pruned = 0;
  const heartbeat = new AutonomousHeartbeat({}, {
    logger: silentLogger,
    resourceSnapshot: () => ({ totalMemory: 100, freeMemory: 50 }),
    processMemorySnapshot: () => ({ heapUsed: 95, heapTotal: 100 }),
    resourceMitigationCooldownMs: 30_000,
    resourcePruners: { cache: async () => ({ removed: ++pruned }) }
  });
  const state = heartbeat._assessResourcePressure();
  assert.equal(state.level, 'critical');
  assert.equal(state.processHeapRatio, 0.95);
  assert.deepEqual(await heartbeat._applyResourcePolicy(state), ['cache:1']);
  assert.deepEqual(await heartbeat._applyResourcePolicy(state), ['mitigation_cooldown']);
  assert.equal(pruned, 1);
});
