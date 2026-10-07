import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import createArbiteriumRoutes from '../server/routes/arbiteriumRoutes.js';

async function withServer(system, callback) {
  const app = express();
  app.use(express.json());
  app.set('somaSystem', system);
  app.use('/api/arbiterium', createArbiteriumRoutes(system));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('Arbiterium telemetry reports registered runtime state instead of fixtures', async () => {
  const system = {
    fragmentRegistry: { stats: { activeFragments: 7 } },
    messageBroker: {
      getArbiters() {
        return [{ name: 'ActualAnalyst', role: 'analyst', status: 'active', lastHeartbeat: 42 }];
      }
    }
  };
  await withServer(system, async base => {
    const body = await fetch(`${base}/api/arbiterium/system-state-snapshot`).then(response => response.json());
    assert.equal(body.snapshot.counts.arbiters, 1);
    assert.equal(body.snapshot.counts.fragments, 7);
    assert.equal(body.snapshot.agents[0].name, 'ActualAnalyst');
    assert.equal(body.snapshot.network, null);
  });
});

test('Arbiterium refuses to claim a step completed without an execution path', async () => {
  await withServer({}, async base => {
    const response = await fetch(`${base}/api/arbiterium/execute-step`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-1', description: 'Perform real work' })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.success, false);
    assert.notEqual(body.status, 'completed');
  });
});

test('Arbiterium queues agentic work and does not misreport it as completed', async () => {
  const system = {
    agenticExecutor: {},
    goalPlanner: {
      async createGoal() { return { success: true, goalId: 'goal-real-1' }; }
    }
  };
  await withServer(system, async base => {
    const response = await fetch(`${base}/api/arbiterium/execute-step`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stepId: 'step-2', description: 'Run verified checks', arbiterRole: 'coding' })
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.status, 'queued');
    assert.equal(body.metadata.goalId, 'goal-real-1');
    assert.equal(body.metadata.evidenceBacked, false);
  });
});
