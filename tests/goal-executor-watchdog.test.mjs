import test from 'node:test';
import assert from 'node:assert/strict';
import { GoalExecutorDaemon } from '../daemons/GoalExecutorDaemon.js';

test('legacy goal daemon nudges the authoritative heartbeat without claiming a goal', async () => {
    const calls = { tick: 0, plannerReads: 0 };
    const heartbeat = {
        isRunning: true,
        isProcessing: false,
        stats: { lastRun: 0 },
        async tick() { calls.tick++; }
    };
    const system = {
        autonomousHeartbeat: heartbeat,
        get goalPlanner() { calls.plannerReads++; return null; }
    };
    const daemon = new GoalExecutorDaemon({ system, logger: { warn() {}, info() {} } });
    daemon._createdAt = 0;

    await daemon.tick();

    assert.equal(calls.tick, 1);
    assert.equal(calls.plannerReads, 0);
    assert.equal(daemon._executing, false);
});

test('legacy goal execution is fail-closed when no heartbeat exists', async () => {
    let plannerReads = 0;
    const system = { get goalPlanner() { plannerReads++; return { goals: new Map() }; } };
    const daemon = new GoalExecutorDaemon({ system, logger: { warn() {}, info() {} } });
    daemon._createdAt = 0;

    await daemon.tick();

    assert.equal(plannerReads, 0);
    assert.equal(daemon._reportedLegacyDisabled, true);
});
