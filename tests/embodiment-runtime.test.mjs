import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { EmbodimentRuntime } from '../core/EmbodimentRuntime.js';

async function runtime(options = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-body-'));
    return new EmbodimentRuntime({ simulation: true, receiptPath: path.join(dir, 'receipts.jsonl'), ...options });
}

test('physical motion is blocked while disarmed', async () => {
    const body = await runtime();
    const result = await body.execute({ type: 'move', linearMps: 1, durationMs: 9000 });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'embodiment_disarmed');
});

test('armed simulation clamps motion and requires fresh sensors', async () => {
    const body = await runtime();
    body.registerSensor('odometry', { read: async () => ({ x: 0, timestamp: Date.now() }) });
    assert.equal(body.arm({ operatorConfirmed: true }).armed, true);
    const result = await body.execute({ type: 'move', linearMps: 4, angularRps: 8, durationMs: 9000 });
    assert.equal(result.success, true);
    assert.equal(result.simulated, true);
    assert.equal(result.action.linearMps, 0.25);
    assert.equal(result.action.angularRps, 0.5);
    assert.equal(result.action.durationMs, 2000);
});

test('stale sensors block movement', async () => {
    const body = await runtime({ maxSensorAgeMs: 50 });
    body.registerSensor('odometry', { read: async () => ({ timestamp: Date.now() - 1000 }) });
    body.arm({ operatorConfirmed: true });
    const result = await body.execute({ type: 'move', linearMps: 0.1 });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'fresh_sensor_state_required');
});

test('emergency stop is latched and requires explicit operator reset', async () => {
    const body = await runtime();
    body.arm({ operatorConfirmed: true });
    await body.emergencyStop('test');
    assert.equal(body.getStatus().emergencyStop, true);
    assert.equal(body.arm({ operatorConfirmed: true }).armed, false);
    assert.equal(body.resetEmergencyStop().reset, false);
    assert.equal(body.resetEmergencyStop({ operatorConfirmed: true }).reset, true);
    assert.equal(body.getStatus().armed, false);
});

test('alarm blocks motion without changing arm or emergency-stop authority', async () => {
    const body = await runtime();
    body.registerSensor('odometry', { read: async () => ({ timestamp: Date.now() }) });
    body.arm({ operatorConfirmed: true });
    body.updateAffectiveState({ feelings: { alarm: 0.95 }, source: 'test' });
    const result = await body.execute({ type: 'move', linearMps: 0.1 });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'affective_alarm_hold');
    assert.equal(body.getStatus().armed, true);
    assert.equal(body.getStatus().emergencyStop, false);
});

test('uncertainty requests a confirming observation and fatigue slows motion', async () => {
    const body = await runtime();
    let reads = 0;
    body.registerSensor('odometry', { read: async () => { reads++; return { timestamp: Date.now() }; } });
    body.arm({ operatorConfirmed: true });
    body.updateAffectiveState({ feelings: { uncertainty: 0.8, fatigue: 0.8, alarm: 0.2 }, source: 'test' });
    const result = await body.execute({ type: 'move', linearMps: 0.2 });
    assert.equal(result.success, true);
    assert.equal(reads, 2);
    assert.ok(result.action.linearMps < 0.2);
    assert.equal(result.affective.chargingRecommended, true);
});
