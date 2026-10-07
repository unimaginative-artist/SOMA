import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Isolate the resource lease BEFORE imports. Never remove the real GPU lease.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-public-lease-test-'));
const leasePath = path.join(directory, 'lease.json');
process.env.SOMA_LARGE_MODEL_LEASE_PATH = leasePath;
const gate = await import('../core/LargeModelResourceGate.js');
assert.equal(gate.LARGE_MODEL_LEASE_PATH, leasePath);
const { SOMArbiterV2_QuadBrain } = await import('../arbiters/SOMArbiterV2_QuadBrain.js');
test.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
const lease = (patch = {}) => ({ owner: 'private test work', pid: process.pid, token: 'TEST_PRIVATE_TOKEN', expiresAt: Date.now() + 60000, ...patch });
const write = value => fs.writeFile(leasePath, JSON.stringify(value));

test('availability respects active lease without exposing its owner or token', async () => {
    await write(lease());
    const state = await gate.standardModelResourceAvailability();
    assert.deepEqual(state, { available: false, reason: 'large_model_resource_busy' });
    assert.ok(!JSON.stringify(state).includes('PRIVATE')); assert.ok(!JSON.stringify(state).includes('private test'));
});

test('stale leases and authorized standard phases preserve existing resource semantics', async () => {
    await write(lease({ expiresAt: 1 })); assert.equal((await gate.standardModelResourceAvailability()).available, true);
    await write(lease({ pid: 2147483647 })); assert.equal((await gate.standardModelResourceAvailability()).available, true);
    const current = lease(); await write(current);
    await gate.withLargeModelLeaseAccess(current, async () => assert.equal((await gate.standardModelResourceAvailability()).available, true));
    assert.equal((await gate.standardModelResourceAvailability()).available, false);
});

test('public generation is blocked before any provider request while a large model owns resources', async t => {
    await write(lease()); let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Unexpected request'); });
    const brain = Object.create(SOMArbiterV2_QuadBrain.prototype); brain.ollamaEndpoint = 'http://localhost:11434';
    await assert.rejects(brain._callOllama('Hi', 'qwen2.5:7b', 0.6, 96, 'Public prompt', [], null, [], '2m', 'human', null, { num_ctx: 4096 }),
        error => error.code === 'PUBLIC_MODEL_RESOURCE_BUSY');
    assert.equal(requests, 0);
});

test('provider cascade preserves busy state rather than fabricating an offline-model answer', async () => {
    await write(lease());
    const brain = Object.create(SOMArbiterV2_QuadBrain.prototype);
    brain.ollamaEndpoint = 'http://localhost:11434'; brain.ollamaModel = 'qwen2.5:7b'; brain.lobeModels = {};
    brain._getAvailableOllamaModels = async () => ['qwen2.5:7b'];
    brain.auditLogger = { info() {}, warn() {}, error() {} };
    await assert.rejects(brain._callProviderCascade('Hello', { publicContextOnly: true, publicModel: 'qwen2.5:7b', forceLocal: true }),
        error => error.code === 'PUBLIC_MODEL_RESOURCE_BUSY');
});
