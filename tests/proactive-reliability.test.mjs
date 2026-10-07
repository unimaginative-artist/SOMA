import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OutboundAutonomyGate } from '../core/OutboundAutonomyGate.js';
import { ProactivePresence } from '../core/ProactivePresence.js';
import { AutonomyReliability } from '../core/AutonomyReliability.js';

test('proactive presence publishes verified changes once and suppresses heartbeat-like repetition', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-presence-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let now = new Date('2026-08-04T16:00:00-04:00').getTime();
    const published = [];
    const gate = new OutboundAutonomyGate({ statePath: path.join(root, 'gate.json'), now: () => now });
    const presence = await new ProactivePresence({
        system: { messageBroker: { async publish(type, payload) { published.push({ type, payload }); } } },
        gate, statePath: path.join(root, 'presence.json'), now: () => now, cooldownMs: 60_000
    }).initialize();
    const first = await presence.reportVerifiedWork({ message: 'Research trial completed with a verified artifact.', evidence: { receiptId: 'r1' } });
    const second = await presence.reportVerifiedWork({ message: 'Research trial completed with a verified artifact.', evidence: { receiptId: 'r1' } });
    assert.equal(first.delivered, true);
    assert.equal(second.delivered, false);
    assert.equal(second.reason, 'cooldown');
    assert.equal(published.length, 1);
    assert.equal(published[0].payload.kind, 'verified_work');
    assert.equal(presence.getStatus().consent.social, false);
});

test('autonomy reliability exposes completion, verification, recovery, false-success, and trend SLOs', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-reliability-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const reliability = await new AutonomyReliability({ statePath: path.join(root, 'reliability.json') }).initialize();
    await reliability.record({ type: 'goal', id: 'g1', failed: true, success: false, verified: false, signature: 'research', attempts: 2 });
    await reliability.record({ type: 'goal', id: 'g2', failed: false, success: true, verified: true, signature: 'research', attempts: 1 });
    await reliability.record({ type: 'goal', id: 'g3', failed: false, success: true, verified: false, falseSuccess: true, signature: 'coding', attempts: 1 });
    const dashboard = reliability.dashboard();
    assert.equal(dashboard.metrics.terminalOutcomes, 3);
    assert.equal(dashboard.metrics.recoveryRate, 1);
    assert.equal(dashboard.metrics.falseSuccessRate, 1 / 3);
    assert.equal(dashboard.objectives.falseSuccessRate.passing, false);
});
