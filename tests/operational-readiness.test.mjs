import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationalReadiness } from '../core/OperationalReadiness.js';

test('core health does not imply Discord, memory, or extended systems are ready', () => {
    const snapshot = buildOperationalReadiness({
        ready: true,
        bootStatus: { core: 'ready', extended: 'loading' },
        mnemonicArbiter: { degraded: true, degradedReason: 'SQLite unavailable' },
        agenticExecutor: { execute() {}, _executionActive: true },
        maxBridge: {}
    });
    assert.equal(snapshot.core.state, 'ready');
    assert.equal(snapshot.extended.state, 'loading');
    assert.equal(snapshot.discord.state, 'loading');
    assert.equal(snapshot.memory.state, 'degraded');
    assert.equal(snapshot.inspection.state, 'shared_executor_only');
    assert.equal(snapshot.engineering.state, 'busy');
    assert.equal(snapshot.max.state, 'configured_unprobed');
});

test('connected Discord and isolated inspection have distinct readiness states', () => {
    const snapshot = buildOperationalReadiness({
        ready: true,
        bootStatus: { extended: 'ready' },
        discordArbiter: { connected: true },
        mnemonicArbiter: {},
        agenticExecutor: { execute() {}, forkReadOnlyInspection() {} }
    });
    assert.equal(snapshot.discord.state, 'connected');
    assert.equal(snapshot.memory.state, 'available');
    assert.equal(snapshot.inspection.state, 'available');
    assert.equal(snapshot.engineering.state, 'available');
});
