import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSystemMemory } from '../core/SystemMemoryHealth.js';

const gib = 1024 ** 3;
const sample = (heapUsed, rss = 1 * gib, physicalFree = 16 * gib) => evaluateSystemMemory({
    memory: { heapUsed, heapTotal: 2 * gib, rss, external: 100 },
    heapLimit: 4 * gib, physicalTotal: 32 * gib, physicalFree,
    samples: [{ heapUsed, rss }]
});

test('memory health is unknown when measurements are missing, not healthy by default', () => {
    assert.equal(evaluateSystemMemory({}).status, 'UNKNOWN');
});

test('heap, RSS and system pressure each drive degraded and critical status', () => {
    assert.equal(sample(0.5 * gib).status, 'HEALTHY');
    assert.equal(sample(3.1 * gib).status, 'CRITICAL'); // absolute 1.8 GiB cap
    assert.equal(sample(0.5 * gib, 3.1 * gib).status, 'DEGRADED');
    assert.equal(sample(0.5 * gib, 6.1 * gib).status, 'CRITICAL');
    assert.equal(sample(0.5 * gib, 1 * gib, 3 * gib).status, 'DEGRADED');
    assert.equal(sample(0.5 * gib, 1 * gib, 1 * gib).status, 'CRITICAL');
});

test('reports peak and honest unknown OOM history without inventing a boot baseline', () => {
    const result = evaluateSystemMemory({
        memory: { heapUsed: 400 * 1024 ** 2, heapTotal: 500 * 1024 ** 2, rss: 2 * gib },
        heapLimit: 4 * gib, physicalTotal: 32 * gib, physicalFree: 15 * gib,
        samples: [
            { heapUsed: 300 * 1024 ** 2, rss: 1 * gib },
            { heapUsed: 450 * 1024 ** 2, rss: 2.5 * gib }
        ]
    });
    assert.equal(result.diagnostics.recentPeakHeapMb, 450);
    assert.equal(result.diagnostics.oomHistory.state, 'unknown');
    assert.doesNotMatch(result.memoryExplanation, /87MB|440MB/);
});
