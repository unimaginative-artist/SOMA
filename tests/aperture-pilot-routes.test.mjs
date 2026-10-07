import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerAperturePilotRoutes } from '../server/routes/aperturePilotRoutes.js';

async function fixture(t, { settings = {}, system = {} } = {}) {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAperturePilotRoutes(router, { system, readState: async () => ({ settings: { autonomyLevel: 3, permissions: {}, ...settings } }) });
    app.use(router);
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    return async (path, body) => {
        const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() };
    };
}
const observation = () => ({ id: crypto.randomUUID(), observedAt: Date.now(), surface: 'aperture', signature: 'empty', windows: [] });

test('pilot API returns a correlated proposal, never claims it executed the action', async t => {
    const post = await fixture(t);
    const state = observation();
    const { body } = await post('/pilot_decide', { observation: state, userDirective: 'open files' });
    assert.equal(body.decision.action, 'launch_app');
    assert.equal(body.decision.observationId, state.id);
    assert.equal(body.executionStatus, 'proposed');
    assert.equal(body.verified, false);
});
test('old or malformed clients cannot actuate from an ungrounded window list', async t => {
    const post = await fixture(t);
    assert.equal((await post('/pilot_decide', { openWindows: [], userDirective: 'open files' })).body.decision.action, 'idle');
});
test('server-stored on-demand and permission settings override client wishes', async t => {
    const post = await fixture(t, { settings: { autonomyLevel: 1, permissions: { networkAccess: false } } });
    const body = { observation: observation(), autonomyLevel: 3 };
    assert.equal((await post('/pilot_decide', body)).body.decision.action, 'idle');
    assert.equal((await post('/pilot_decide', { ...body, userDirective: 'search topic' })).body.decision.action, 'idle');
    assert.equal((await post('/pilot_decide', { ...body, userDirective: 'open files' })).body.decision.action, 'launch_app');
});
test('brain proposals are validated rather than trusted as execution authority', async t => {
    const post = await fixture(t, { system: { brain: { reason: async () => ({ text: JSON.stringify({ action: 'task_advance', params: {}, intent: 'Mark it complete' }) }) } } });
    assert.equal((await post('/pilot_decide', { observation: observation(), userDirective: 'finish the thing' })).body.decision.action, 'idle');
});
test('a disabled reasoner is never called and missing inference falls back honestly', async t => {
    let calls = 0;
    const post = await fixture(t, { settings: { permissions: { somaReasoning: false } }, system: { brain: { reason: () => { calls++; throw new Error('offline'); } } } });
    assert.equal((await post('/pilot_decide', { observation: observation(), userDirective: 'do something clever' })).body.decision.action, 'idle');
    assert.equal(calls, 0);
});
test('trading goals do not authorize autonomous desktop manipulation', async t => {
    let calls = 0;
    const system = { goalPlanner: { goals: new Map([['trade', { status: 'active', category: 'trading', title: 'Trade' }]]) }, brain: { reason: () => { calls++; } } };
    const post = await fixture(t, { system });
    assert.equal((await post('/pilot_decide', { observation: observation(), recentActions: [{ action: 'soma_status' }] })).body.decision.action, 'idle');
    assert.equal(calls, 0);
});
test('explicit desktop goals can produce bounded autonomous research proposals', async t => {
    const system = { goalPlanner: { goals: new Map([['desktop', { status: 'active', approved: true, category: 'desktop', title: 'Research a public topic' }]]) },
        brain: { reason: async () => ({ text: '```json\n{"action":"portal_navigate","params":{"query":"orbital mechanics"},"intent":"Research"}\n```' }) } };
    const post = await fixture(t, { system });
    const result = await post('/pilot_decide', { observation: observation() });
    assert.equal(result.body.decision.action, 'portal_navigate');
    assert.equal(result.body.verified, false);
});
test('remote commands are dispatched, not verified, and cannot close windows', async t => {
    const broadcasts = [];
    const post = await fixture(t, { system: { broadcast: (...args) => broadcasts.push(args) } });
    const result = await post('/command', { verb: 'open_app', arg: 'files' });
    assert.equal(result.body.status, 'dispatched');
    assert.equal(result.body.verified, false);
    assert.ok(broadcasts[0][1].id);
    assert.equal((await post('/command', { verb: 'close_app', arg: 'notes' })).status, 400);
    assert.equal((await post('/command', { verb: 'open_app', arg: 'made-up' })).status, 400);
    assert.equal(broadcasts.length, 1);
});
test('remote commands respect server on-demand and network restrictions', async t => {
    const post = await fixture(t, { settings: { autonomyLevel: 1 }, system: { broadcast() { throw new Error('Should not broadcast'); } } });
    assert.equal((await post('/command', { verb: 'open_app', arg: 'files' })).status, 409);
    const second = await fixture(t, { settings: { permissions: { networkAccess: false } }, system: { broadcast() { throw new Error('Should not broadcast'); } } });
    assert.equal((await second('/command', { verb: 'portal_navigate', arg: 'topic' })).status, 403);
});

test('unapproved desktop goals cannot cause autonomous action planning', async t => {
    let calls = 0;
    const system = { goalPlanner: { goals: new Map([['desktop', { status: 'pending', approved: false, category: 'desktop' }]]) },
        brain: { reason: () => { calls++; } } };
    const post = await fixture(t, { system });
    assert.equal((await post('/pilot_decide', { observation: observation(), recentActions: ['soma_status'] })).body.decision.action, 'idle');
    assert.equal(calls, 0);
});
