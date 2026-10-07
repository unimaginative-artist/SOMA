import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import createPulseRoutes from '../server/routes/pulseRoutes.js';

async function withPulse(context, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/pulse', createPulseRoutes(context));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('Pulse workflow execution queues a real goal instead of returning a demo success', async () => {
  let captured = null;
  await withPulse({
    pulseArbiter: {},
    goalPlanner: {
      async createGoal(goal) {
        captured = goal;
        return { success: true, goalId: 'pulse-goal-1' };
      }
    }
  }, async base => {
    const response = await fetch(`${base}/api/pulse/workflow/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Repair the runtime', steps: [{ title: 'Run tests' }] })
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.status, 'queued');
    assert.equal(body.goalId, 'pulse-goal-1');
    assert.equal(captured.metadata.source, 'pulse_workflow');
    assert.deepEqual(captured.successCriteria, ['Run tests']);
  });
});

test('Pulse workflow execution fails honestly when GoalPlanner is offline', async () => {
  await withPulse({ pulseArbiter: {} }, async base => {
    const response = await fetch(`${base}/api/pulse/workflow/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Repair the runtime', steps: [{ title: 'Run tests' }] })
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.success, false);
  });
});
