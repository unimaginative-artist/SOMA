import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalStateProjector } from '../core/CanonicalStateProjector.js';

test('projector exposes bounded cross-domain summaries without raw trading state', async () => {
    const writes = [];
    const system = {
        stateGateway: { publish: async (...args) => writes.push(args) },
        goalPlanner: { getActiveGoals: () => [{ id: 'g1', title: 'test', status: 'active', secret: 'omit' }] },
        visionDaemon: { lastPerception: { timestamp: 1, scene: { objects: [{ label: 'person', embedding: [1, 2, 3] }] } } },
        embodimentRuntime: { getStatus: () => ({ simulation: true, armed: false, emergencyStop: false, sensors: ['vision'], actuators: [] }) },
        tradingPerformanceGuard: { getStatus: () => ({ mode: 'paper', restrictedStrategies: ['x'], rawTrades: [{ pnl: 9 }] }) }
        ,audioDaemon: { getStatus: () => ({ enabled: true, state: 'armed', mode: 'local_whisper_phrase_gate', wakePhrase: 'Hey Soma', device: 1 }) }
    };
    await new CanonicalStateProjector({ system }).refresh();
    assert.deepEqual(writes.map(write => `${write[0]}.${write[1]}`).sort(), ['audio.hearing_status', 'embodiment.body_status', 'goals.active_summary', 'trading.safety_summary', 'vision.latest_scene']);
    const trading = writes.find(write => write[0] === 'trading')[2];
    assert.equal(trading.mode, 'paper');
    assert.equal('rawTrades' in trading, false);
});
