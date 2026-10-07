import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopWorldModel } from '../core/DesktopWorldModel.js';
import { AdaptiveCognitionPolicy } from '../core/AdaptiveCognitionPolicy.js';
import { CAPABILITY_TRIALS } from '../core/CapabilityTrialRegistry.js';

test('capability gym registers vision and bounded desktop domains', () => {
    assert.deepEqual(CAPABILITY_TRIALS.vision.tests, ['tests/multimodal-vision.test.mjs', 'tests/visual-object-memory.test.mjs']);
    assert.ok(CAPABILITY_TRIALS.desktop.tests.includes('tests/computer-workspace-service.test.mjs'));
    assert.equal(CAPABILITY_TRIALS.trading_analysis.paperOnly, true);
});

test('desktop world model observes bounded workspace consequences without claiming unavailable screen state', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-world-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let transactions = [];
    const workspace = {
        async listRoots() { return { roots: [{ id: 'workspace-1', path: root }] }; },
        async history() { return { transactions, count: transactions.length }; }
    };
    const model = await new DesktopWorldModel({ statePath: path.join(root, 'world.json'), workspaceService: workspace, system: {} }).initialize({});
    const before = model.getStatus().current;
    transactions = [{ transactionId: 'tx-1', operation: 'write', status: 'complete', path: path.join(root, 'report.md') }];
    const consequence = await model.recordConsequence({ transactionId: 'cognitive-1', action: 'write_file', before, verified: true });
    assert.equal(consequence.changed, true);
    assert.equal(consequence.change.workspaceTransactionsAdded[0].transactionId, 'tx-1');
    assert.equal(model.getStatus().current.applications.available, false);
});

test('adaptive cognition spends effort based on novelty, uncertainty, complexity, and consequence', () => {
    const system = {
        beingKernel: { state: { capabilityState: { general: { attempts: 10, verified: 9 } } } },
        proceduralMemory: { retrieve: ({ task }) => task.includes('familiar') ? [{ score: 0.95 }] : [] }
    };
    const policy = new AdaptiveCognitionPolicy({ system });
    const fast = policy.assess({ message: 'Summarize the familiar note', domain: 'general' });
    const highRisk = policy.assess({ message: 'Deploy this security change to production and delete the old credentials', domain: 'general' });
    assert.equal(fast.mode, 'fast');
    assert.equal(highRisk.mode, 'adversarial');
    assert.equal(highRisk.forceMultiLobe, true);
    assert.equal(highRisk.evidenceStrictness, 'maximum');
});

test('clock, reason and process uptime are not evidence of a changed desktop', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-world-stable-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let now = 100000;
    const model = await new DesktopWorldModel({ statePath: path.join(root, 'world.json'), now: () => now, system: {} }).initialize({});
    const before = model.state.current;
    now += 10000;
    const after = await model.observe({ reason: 'new clock, same state' });
    assert.equal(before.digest, after.digest);
    assert.equal((await model.recordConsequence({ action: 'no-op', before, after })).changed, false);
});

test('arbiter health/status is not a screen observation', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-world-status-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const system = { computerControl: { getStatus: () => ({ ready: true }) } };
    const model = await new DesktopWorldModel({ statePath: path.join(root, 'world.json'), system }).initialize(system);
    assert.equal(model.state.current.applications.available, false);
});

test('screen IDs and timestamps do not count as visual changes; content does', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-world-frame-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let hash = 'same-image';
    const system = { computerControl: { observe: async () => ({ success: true, surface: 'native-desktop', observedAt: Date.now(), frameId: crypto.randomUUID(), contentDigest: hash }) } };
    const model = await new DesktopWorldModel({ statePath: path.join(root, 'world.json'), system }).initialize(system);
    const same = await model.observe();
    assert.equal(same.change.screenChanged, false);
    hash = 'changed-image';
    assert.equal((await model.observe()).change.screenChanged, true);
});

test('stale structured screen observations are unavailable, not current evidence', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-world-stale-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const system = { computerControl: { observe: async () => ({ surface: 'native-desktop', observedAt: Date.now() - 60000, contentDigest: 'old' }) } };
    const model = await new DesktopWorldModel({ statePath: path.join(root, 'world.json'), system }).initialize(system);
    assert.equal(model.state.current.applications.available, false);
});
