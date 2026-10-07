import test from 'node:test';
import assert from 'node:assert/strict';
import { CrossNodeTandemBridge } from '../core/cluster/CrossNodeTandemBridge.js';

test('CrossNodeTandemBridge initializes with correct defaults', () => {
    const bridge = new CrossNodeTandemBridge({ remoteHost: '192.168.1.250', remotePort: 3001 });
    const status = bridge.getStatus();
    assert.equal(status.nodeId, 'machine-b');
    assert.equal(status.host, '192.168.1.250');
    assert.equal(status.port, 3001);
    assert.equal(status.state, 'initializing');
    bridge.stop();
});

test('CrossNodeTandemBridge transitions state cleanly on stop', () => {
    const bridge = new CrossNodeTandemBridge();
    bridge.stop();
    assert.equal(bridge.getStatus().state, 'offline');
    assert.equal(bridge.isOnline(), false);
});

test('CrossNodeTandemBridge ping returns result or gracefully handles timeout', async () => {
    const bridge = new CrossNodeTandemBridge({ remoteHost: '192.168.1.250', remotePort: 3001 });
    const pingResult = await bridge.ping();
    assert.equal(typeof pingResult.ok, 'boolean');
    if (pingResult.ok) {
        assert.ok(pingResult.latencyMs !== null);
        assert.ok(pingResult.latencyMs >= 0);
    }
    bridge.stop();
});

test('CrossNodeTandemBridge handles state changes via events', (t, done) => {
    const bridge = new CrossNodeTandemBridge();
    bridge.on('state_change', ({ from, to }) => {
        assert.equal(from, 'initializing');
        assert.equal(to, 'offline');
        done();
    });
    bridge.stop();
});
