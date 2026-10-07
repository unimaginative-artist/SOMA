import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ModelResourceGovernor, isExpectedOptionalGpuProcess } from '../core/ModelResourceGovernor.js';
import { LARGE_MODEL_LEASE_PATH, acquireLargeModelLease, releaseLargeModelLease, waitForStandardModelResources } from '../core/LargeModelResourceGate.js';

function fetchFixture(events) {
    return async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        if (url.endsWith('/api/ps')) {
            return { ok: true, json: async () => ({ models: url.includes('11435') ? [{ name: 'llama3.2:1b' }] : [] }) };
        }
        if (url.endsWith('/api/generate')) {
            events.push({ url, body });
            return { ok: true, json: async () => ({ response: 'OK' }) };
        }
        throw new Error(`Unexpected URL ${url}`);
    };
}

class FixtureGovernor extends ModelResourceGovernor {
    constructor(options) { super(options); this.started = 0; this.stopped = 0; }
    async _optionalGpuProcesses() { return []; }
    async _start() { this.started++; }
    async _stop() { this.stopped++; }
}

test('optional GPU process identity matcher accepts only known launch shapes', () => {
    assert.equal(isExpectedOptionalGpuProcess({ port: 8000, command: '"C:\\Python\\python.exe" -m uvicorn scripts.local_backend:app --port 8000' }), true);
    assert.equal(isExpectedOptionalGpuProcess({ port: 8080, command: '"C:\\SOMA\\siren-bridge\\.venv\\Scripts\\python.exe" "C:\\SOMA\\siren-bridge\\engine\\tools\\api.py" --listen 0.0.0.0:8080 --device cuda' }), true);
    assert.equal(isExpectedOptionalGpuProcess({ port: 8000, command: 'python.exe malicious.py --port 8000' }), false);
    assert.equal(isExpectedOptionalGpuProcess({ port: 8080, command: 'node.exe server.js' }), false);
});

test('governor evicts exact inventory, runs Qwen work, and restores inventory', async () => {
    await fs.unlink(LARGE_MODEL_LEASE_PATH).catch(() => {});
    const events = [];
    const governor = new FixtureGovernor({ fetchImpl: fetchFixture(events), minFreeVramMiB: 100, minFreeRamGiB: 1 });
    governor._telemetry = async () => ({ freeVramMiB: 9000, freeRamGiB: 20 });
    const result = await governor.withLargeModel(async () => 'council-result');
    assert.equal(result, 'council-result');
    assert.equal(governor.started, 1);
    assert.equal(governor.stopped, 1);
    assert.equal(events.length, 2);
    assert.equal(events[0].body.keep_alive, 0);
    assert.equal(events[1].body.keep_alive, -1);
    assert.equal(await fs.stat(LARGE_MODEL_LEASE_PATH).catch(() => null), null);
});

test('failed resource preflight restores Ollama and never starts Qwen', async () => {
    await fs.unlink(LARGE_MODEL_LEASE_PATH).catch(() => {});
    const events = [];
    const governor = new FixtureGovernor({ fetchImpl: fetchFixture(events), minFreeVramMiB: 7800, minFreeRamGiB: 10 });
    governor._telemetry = async () => ({ freeVramMiB: 4000, freeRamGiB: 20 });
    await assert.rejects(() => governor.withLargeModel(async () => 'no'), /Insufficient resources/);
    assert.equal(governor.started, 0);
    assert.equal(events.at(-1).body.keep_alive, -1);
    assert.equal(await fs.stat(LARGE_MODEL_LEASE_PATH).catch(() => null), null);
});

test('standard Ollama work waits until the large-model lease is released', async () => {
    await fs.unlink(LARGE_MODEL_LEASE_PATH).catch(() => {});
    const lease = await acquireLargeModelLease({ owner: 'test' });
    let finished = false;
    const waiting = waitForStandardModelResources({ timeoutMs: 1000 }).then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(finished, false);
    await releaseLargeModelLease(lease);
    await waiting;
    assert.equal(finished, true);
});

test('exclusive council lease permits only its standard phases and isolates Qwen phase', async () => {
    await fs.unlink(LARGE_MODEL_LEASE_PATH).catch(() => {});
    const events = [];
    const phasesSeen = [];
    const governor = new FixtureGovernor({ fetchImpl: fetchFixture(events), minFreeVramMiB: 100, minFreeRamGiB: 1 });
    governor._telemetry = async () => ({ freeVramMiB: 9000, freeRamGiB: 20 });
    const result = await governor.withExclusiveCouncil(async phases => {
        await phases.runStandard(async () => {
            await waitForStandardModelResources({ timeoutMs: 50 });
            phasesSeen.push('lobe');
        });
        await phases.runLarge(async () => phasesSeen.push('qwen'));
        await phases.runStandard(async () => {
            await waitForStandardModelResources({ timeoutMs: 50 });
            phasesSeen.push('verifier');
        });
        return 'verified';
    });
    assert.equal(result, 'verified');
    assert.deepEqual(phasesSeen, ['lobe', 'qwen', 'verifier']);
    assert.equal(governor.started, 1);
    assert.ok(governor.stopped >= 1);
    assert.equal(events.at(-1).body.keep_alive, -1);
    assert.equal(await fs.stat(LARGE_MODEL_LEASE_PATH).catch(() => null), null);
});
