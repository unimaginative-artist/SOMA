import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePilotDecision, fallbackPilotDecision, PILOT_READ_COMMANDS } from '../shared/AperturePilotPolicy.js';
import { PilotRuntime, requestPilotAction, registerPilotHandler, hasPilotHandler, ACTION_REQUEST, ACTION_RESULT } from '../frontend/apps/command-bridge/panels/aperture/kernel/PilotRuntime.js';

const observation = () => ({ id: crypto.randomUUID(), observedAt: Date.now(), surface: 'aperture', signature: 'windows:1', windows: [{ id: 'w', appId: 'files' }] });
const settings = () => ({ enabled: true, autonomyLevel: 3, permissions: {} });
const proposal = (action = 'launch_app', params = { appId: 'files' }) => ({ id: crypto.randomUUID(), action, params });
const check = (p, context = {}) => validatePilotDecision(p, { observation: observation(), settings: settings(), ...context });

test('autonomy does one initial inspection then waits instead of manufacturing work', () => {
    assert.equal(fallbackPilotDecision('').action, 'soma_status');
    const next = fallbackPilotDecision('', [{ action: 'soma_status', status: 'completed' }]);
    assert.equal(next.action, 'idle');
    assert.equal(fallbackPilotDecision('delete everything').action, 'idle');
});
test('known explicit directives map to bounded actions', () => {
    assert.equal(fallbackPilotDecision('open files').params.appId, 'files');
    assert.equal(fallbackPilotDecision('run ps').params.cmd, 'ps');
    assert.equal(fallbackPilotDecision('search orbital mechanics').params.query, 'orbital mechanics');
});
for (const action of ['task_advance', 'window_close', 'shell_exec', 'unknown']) {
    test(`model cannot authorize ${action}`, () => assert.equal(check(proposal(action)).valid, false));
}
test('CSS selectors are discarded rather than treated as executable fallback', () => {
    const result = check({ ...proposal(), targetSelector: 'button.delete-everything' });
    assert.equal(result.valid, true);
    assert.equal(result.decision.targetSelector, undefined);
});
test('stale, future, missing and mismatched observations fail closed', () => {
    assert.equal(check(proposal(), { observation: null }).valid, false);
    assert.equal(check(proposal(), { observation: { ...observation(), observedAt: Date.now() - 31000 } }).valid, false);
    assert.equal(check(proposal(), { observation: { ...observation(), observedAt: Date.now() + 5000 } }).valid, false);
    assert.equal(check({ ...proposal(), observationId: 'different' }).valid, false);
});
test('on-demand, disabled and locked settings remain authoritative', () => {
    assert.equal(check(proposal(), { settings: { autonomyLevel: 1 } }).valid, false);
    assert.equal(check(proposal(), { settings: { autonomyLevel: 1 }, userDirective: 'open files' }).valid, true);
    assert.equal(check(proposal(), { settings: { enabled: false }, userDirective: 'open files' }).valid, false);
    assert.equal(check(proposal(), { settings: { locked: true }, userDirective: 'open files' }).valid, false);
});
test('pilot cannot invoke arbitrary terminal, AI tools or publishing', () => {
    for (const cmd of ['ai delete files', 'tool write_file {}', 'soma publish site', 'kill 123', 'ps; evil', '']) assert.equal(check(proposal('terminal_exec', { cmd })).valid, false);
    for (const cmd of PILOT_READ_COMMANDS) assert.equal(check(proposal('terminal_exec', { cmd })).valid, true);
});
test('notes require both an explicit write directive and memory permission', () => {
    const p = proposal('note_create', { content: 'Actual observation', title: 'Note' });
    assert.equal(check(p).valid, false);
    assert.equal(check(p, { userDirective: 'open notes' }).valid, false);
    assert.equal(check(p, { userDirective: 'write a note' }).valid, true);
    assert.equal(check(p, { userDirective: 'write a note', settings: { permissions: { memoryWrite: false } } }).valid, false);
});
test('network and relative filesystem bounds are enforced', () => {
    assert.equal(check(proposal('portal_navigate', { query: 'test' }), { settings: { permissions: { networkAccess: false } } }).valid, false);
    assert.equal(check(proposal('file_browse', { path: 'data' }), { settings: { permissions: { fileRead: false } } }).valid, false);
    for (const path of ['../secrets', 'C:\\Users', '/etc', '\\server', 'data/../../x']) assert.equal(check(proposal('file_browse', { path })).valid, false);
    assert.equal(check(proposal('file_browse', { path: 'data/reports' })).valid, true);
});
test('layout changes require a directive, not an autonomous cleanup guess', () => {
    assert.equal(check(proposal('tile_windows', {})).valid, false);
    assert.equal(check(proposal('tile_windows', {}), { userDirective: 'tile windows' }).valid, true);
});
function runtimeFixture(perform = async () => ({ status: 'completed', verified: true, evidence: { visible: true } })) {
    let state = observation();
    let policy = settings();
    const receipts = [];
    const runtime = new PilotRuntime({ observe: () => state, settings: () => policy, perform, onReceipt: r => receipts.push(r) });
    return { runtime, receipts, state, setState: s => { state = s; }, setPolicy: s => { policy = s; } };
}
test('runtime only verifies completion accompanied by evidence', async () => {
    const { runtime } = runtimeFixture(async () => ({ status: 'completed', verified: true }));
    const receipt = await runtime.execute(proposal());
    assert.equal(receipt.verified, false);
    assert.equal(receipt.status, 'unverified');
});
test('runtime propagates real receipts and does not replay decision IDs', async () => {
    let calls = 0;
    const { runtime, receipts } = runtimeFixture(async () => { calls++; return { status: 'completed', verified: true, evidence: { visible: true } }; });
    const p = proposal();
    assert.equal((await runtime.execute(p)).verified, true);
    assert.equal((await runtime.execute(p)).status, 'duplicate');
    assert.equal(calls, 1);
    assert.equal(receipts.length, 1);
});
test('single-flight gate refuses overlapping actions', async () => {
    let settle;
    const { runtime } = runtimeFixture(() => new Promise(r => { settle = r; }));
    const first = runtime.execute(proposal());
    assert.equal((await runtime.execute(proposal())).status, 'busy');
    settle({ status: 'submitted', verified: false });
    await first;
});
test('stop invalidates pending plans and cannot report a late success', async () => {
    let settle;
    const { runtime } = runtimeFixture(() => new Promise(r => { settle = r; }));
    const before = runtime.epoch;
    const first = runtime.execute(proposal());
    runtime.stop();
    assert.ok(runtime.epoch > before);
    settle({ status: 'completed', verified: true, evidence: { late: true } });
    const result = await first;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.verified, false);
});
test('workspace changes during planning are refused without input', async () => {
    let calls = 0;
    const f = runtimeFixture(async () => { calls++; });
    const before = f.state;
    f.setState({ ...before, signature: 'different windows' });
    assert.equal((await f.runtime.execute(proposal(), { observation: before })).status, 'failed');
    assert.equal(calls, 0);
});
test('permission is read at execution time, not inherited from the plan', async () => {
    const f = runtimeFixture();
    f.setPolicy({ enabled: false });
    assert.equal((await f.runtime.execute(proposal())).status, 'blocked');
});
test('app request reaches exactly one addressed window and returns its receipt', async t => {
    const target = new EventTarget();
    const id = crypto.randomUUID();
    let wrong = 0;
    t.after(registerPilotHandler(target, { windowId: 'other', action: 'note_create', execute: () => { wrong++; } }));
    t.after(registerPilotHandler(target, { windowId: id, action: 'note_create', execute: async () => ({ status: 'completed', verified: true, evidence: { readbackMatched: true } }) }));
    assert.equal(hasPilotHandler(id, 'note_create'), true);
    const result = await requestPilotAction(target, { id: crypto.randomUUID(), windowId: id, action: 'note_create' });
    assert.equal(result.evidence.readbackMatched, true);
    assert.equal(wrong, 0);
});
test('unmounted apps time out without pretending they acted', async () => {
    const result = await requestPilotAction(new EventTarget(), { id: crypto.randomUUID(), windowId: 'missing', action: 'note_create' }, { timeoutMs: 5 });
    assert.equal(result.status, 'unverified');
});
test('receipts with a wrong action or window cannot satisfy a request', async () => {
    const target = new EventTarget(), id = crypto.randomUUID();
    const pending = requestPilotAction(target, { id, windowId: 'one', action: 'note_create' }, { timeoutMs: 5 });
    target.dispatchEvent(new CustomEvent(ACTION_RESULT, { detail: { id, windowId: 'two', action: 'note_create', status: 'completed' } }));
    assert.equal((await pending).status, 'unverified');
});
test('cancellation ends receipt wait and late receipts do not certify success', async () => {
    const target = new EventTarget(), signal = new AbortController();
    const pending = requestPilotAction(target, { id: crypto.randomUUID(), windowId: 'one', action: 'note_create' }, { signal: signal.signal });
    signal.abort();
    assert.equal((await pending).status, 'cancelled');
});
test('React handler re-registration cannot duplicate an in-flight write', async () => {
    const target = new EventTarget(), windowId = crypto.randomUUID(), id = crypto.randomUUID();
    let calls = 0, settle;
    const execute = () => { calls++; return new Promise(r => { settle = r; }); };
    let dispose = registerPilotHandler(target, { windowId, action: 'note_create', execute });
    const event = () => new CustomEvent(ACTION_REQUEST, { detail: { id, windowId, action: 'note_create' } });
    target.dispatchEvent(event());
    dispose();
    dispose = registerPilotHandler(target, { windowId, action: 'note_create', execute });
    target.dispatchEvent(event());
    assert.equal(calls, 1);
    settle({ status: 'completed', verified: true, evidence: {} });
    await Promise.resolve();
    dispose();
});
