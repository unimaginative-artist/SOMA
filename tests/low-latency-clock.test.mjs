import test from 'node:test';
import assert from 'node:assert/strict';

import lowLatencyEngine from '../server/finance/lowLatencyEngine.js';

test('low-latency telemetry compares epoch timestamps and never reports impossible negative latency', async () => {
  const originalStats = { ...lowLatencyEngine.latencyStats };
  const receivedAtMs = 1_800_000_000_125;
  const tickEvent = new Promise(resolve => lowLatencyEngine.once('tick', resolve));
  try {
    lowLatencyEngine.latencyStats = {
      lastTickTimestamp: 0, avgLatency: 0, minLatency: Infinity, maxLatency: 0, tickCount: 0
    };
    lowLatencyEngine.handleTick({
      symbol: 'BTC/USD', price: 80_000, size: 0.01,
      timestamp: receivedAtMs - 25,
      receivedAtMs,
      receiveTime: 123_456
    });
    const emitted = await tickEvent;
    assert.equal(emitted.networkLatency, 25_000);
    assert.equal(lowLatencyEngine.latencyStats.minLatency, 25_000);
    assert.equal(lowLatencyEngine.latencyStats.avgLatency, 25_000);
  } finally {
    lowLatencyEngine.latencyStats = originalStats;
  }
});
