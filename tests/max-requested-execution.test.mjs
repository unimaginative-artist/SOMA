import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GoalEngine } from '../../MAX/core/GoalEngine.js';
import { AgentLoop } from '../../MAX/core/AgentLoop.js';
import { installRequestedGoals } from '../../MAX/server/requestedGoals.js';
import { MaxAgentBridge } from '../core/MaxAgentBridge.js';
import { parseGoalPlan } from '../../MAX/core/GoalPlanParser.js';

async function fixture(t, config = {}) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'max-requested-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const goals = new GoalEngine({}, null, null, { storageDir: dir, ...config });
    return { dir, goals };
}

test('full active queue parks old machine work, preserves requests, and survives restart', async t => {
    const { dir, goals } = await fixture(t, { maxActive: 1 });
    const old = goals.addGoal({ title: 'old auto', source: 'auto', priority: .2 });
    const request = goals.submitRequested({ title: 'review', source: 'soma', requestId: 'r1', priority: .95, readOnly: true });
    assert.equal(request.accepted, true);
    assert.equal(goals.getGoal(old).status, 'pending');
    goals.activateRequested(request.id);
    assert.equal(goals.getGoal(old).status, 'queued');
    assert.equal(goals.addGoal({ title: 'more auto', source: 'auto' }), null);
    assert.equal(goals.submitRequested({ title: 'duplicate', source: 'soma', requestId: 'r1' }).id, request.id);
    const restored = new GoalEngine({}, null, null, { storageDir: dir }); restored.initialize();
    assert.equal(restored.getGoal(old).status, 'queued');
    assert.equal(restored.getGoal(request.id).readOnly, true);
});

test('backlog quotas and persistence failures are explicit, without eviction', async t => {
    const { goals } = await fixture(t, { maxQueuedPerSource: 1 });
    const one = goals.submitRequested({ title: 'one', source: 'soma' });
    assert.equal(goals.submitRequested({ title: 'two', source: 'soma' }).code, 'SOURCE_QUEUE_FULL');
    assert.ok(goals.getGoal(one.id));
    goals._save = () => false;
    assert.equal(goals.submitRequested({ title: 'api job' }).code, 'PERSISTENCE_FAILED');
    assert.equal(goals._queued.size, 1);
});

test('requested dispatcher wakes only the selected request, independent of heartbeat autonomy', async t => {
    const { goals } = await fixture(t);
    goals.addGoal({ title: 'unrelated auto', source: 'auto' });
    const request = goals.submitRequested({ title: 'read a file', source: 'soma' });
    const calls = [];
    const max = { _ready: true, goals, agentLoop: { runCycle: async arg => calls.push(arg) } };
    const routes = {};
    const runner = installRequestedGoals({ get: (p,h) => routes[`GET ${p}`]=h, post: (p,h) => routes[`POST ${p}`]=h }, max, { intervalMs: 60000 });
    t.after(runner.close);
    await runner.tick();
    assert.deepEqual(calls, [{ goalId: request.id }]);
    max._chatBusy = true; await runner.tick(); assert.equal(calls.length, 1);
    const res = { status(n) { this.code=n; return this; }, json(v) { this.body=v; } };
    routes['POST /api/goals']({ body: { title: 'another', source: 'soma', requestId: 'r2' } }, res);
    assert.equal(res.code, 202); assert.equal(res.body.accepted, true);
    routes['GET /api/goals/:id']({ params: { id: res.body.id } }, res);
    assert.equal(res.body.status, 'queued');
});

test('real requested read yields a durable tool receipt and does not execute the old backlog', async t => {
    const { dir, goals } = await fixture(t);
    const target = path.join(dir, 'proof.txt'); await writeFile(target, 'real-proof-291');
    goals.addGoal({ title: 'old backlog', source: 'auto', priority: 1 });
    goals.decompose = async () => [{ step: 1, tool: 'file', action_name: 'read', action: 'Read evidence', params: { filePath: target }, success: 'real-proof-291' }];
    const max = { goals, tools: { get: () => ({}), execute: async (_t,_a,p) => ({ success: true, content: await readFile(p.filePath, 'utf8') }) } };
    const loop = new AgentLoop(max);
    const req = goals.submitRequested({ title: 'read proof', source: 'soma', readOnly: true });
    const result = await loop.runCycle({ goalId: req.id });
    assert.equal(result.success, true);
    assert.equal(goals.getGoal(req.id).outcome.steps[0].tool, 'file');
    assert.match(goals.getGoal(req.id).outcome.steps[0].result, /real-proof-291/);
    assert.equal(goals.listActive()[0].title, 'old backlog');
    const persisted = JSON.parse(await readFile(goals.goalsPath, 'utf8'));
    assert.equal(persisted.completed[0].status, 'done');
});

test('tool failure, unknown tools, and read-only mutation cannot become narrative success', async () => {
    let calls = 0;
    const loop = new AgentLoop({ tools: { get: name => name === 'file' ? {} : null, execute: async () => { calls++; return { success: false, error: 'missing file' }; } }, agentBrain: { think: () => { throw new Error('Must not use fictional retry'); } } });
    const goal = { title: 'test', dispatchMode: 'requested', readOnly: true };
    assert.equal((await loop._executeStep({ step: 1, action: 'read', tool: 'file.read' }, goal)).success, false);
    assert.equal((await loop._executeStep({ step: 2, action: 'write', tool: 'file.write' }, goal)).success, false);
    assert.equal((await loop._executeStep({ step: 3, action: 'x', tool: 'fake.run' }, { ...goal, readOnly: false })).success, false);
    assert.equal(calls, 1);
});

test('busy requested cycle does not queue an unrelated autonomous cycle', async () => {
    const loop = new AgentLoop({}); loop._busy = true;
    await loop.runCycle({ goalId: 'queued-request' });
    assert.notEqual(loop._pendingCycle, true);
});

test('planner parses actual steps amid empty arrays, fenced blocks, and bracketed text', () => {
    const step = { step: 1, tool: 'file', action: 'Read [version]', action_name: 'read', params: { filePath: 'package.json' }, dependsOn: [] };
    assert.deepEqual(parseGoalPlan('[]\n```json\n' + JSON.stringify([step]) + '\n```\n[]'), [step]);
    assert.throws(() => parseGoalPlan('[1,2]'), /no valid bounded/);
    assert.throws(() => parseGoalPlan(JSON.stringify([step, step])), /no valid bounded/);
});

test('heartbeat-selected requested work retains the dedicated read-only path', async t => {
    const { goals } = await fixture(t);
    const req = goals.submitRequested({ title: 'read', readOnly: true });
    const loop = new AgentLoop({ goals });
    let seen;
    loop._requestedCycle = async goal => { seen = goal; goals.complete(goal.id, { summary: 'test' }); return { success: true }; };
    await loop._cycle();
    assert.equal(seen.id, req.id); assert.equal(seen.readOnly, true);
});

test('file listing parameters preserve the requested directory', async () => {
    const bridge = new MaxAgentBridge({ apiKey: 'test' });
    let params;
    bridge._tool = async (_t,_a,p) => { params = p; };
    await bridge.listFiles('C:/SOMA/core');
    assert.equal(params.dir, 'C:/SOMA/core');
});

test('SOMA preserves idempotency and read-only review scope; rejects unverified receipts', async () => {
    const bridge = new MaxAgentBridge({ apiKey: 'test' });
    let payload;
    bridge._fetch = async (_m,_p,b) => { payload = b; return { accepted: true, id: 'goal-1', status: 'queued' }; };
    await bridge.injectGoal('review', { requestId: 'retry-stable', readOnly: true });
    assert.equal(payload.source, 'soma'); assert.equal(payload.requestId, 'retry-stable'); assert.equal(payload.readOnly, true);
    bridge._fetch = async () => ({ success: true, task: { status: 'completed', receipt: { resultHash: 'fake' } } });
    await assert.rejects(bridge.delegateSomaImprovement('review'), /invalid or incomplete/);
});

test('maintenance cluster status/control use the existing authenticated coordinator routes', async () => {
    const bridge = new MaxAgentBridge({ apiKey: 'test' });
    const paths = [];
    bridge._fetch = async (method, route) => { paths.push([method, route]); return { success: true }; };
    await bridge.getClusterStatus(); await bridge.controlCluster('refresh');
    assert.deepEqual(paths, [['GET','/api/swarm/status'], ['POST','/api/swarm/control/refresh']]);
    await assert.rejects(bridge.controlCluster('../bad'), /Unknown/);
});
