import test from 'node:test';
import assert from 'node:assert/strict';
import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';

test('optional memory recall cannot hold the RSI execution slot indefinitely', async () => {
    const executor = Object.create(SomaAgenticExecutor.prototype);
    executor.memory = { recall: () => new Promise(() => {}) };
    const started = Date.now();
    assert.deepEqual(await executor._recallMemories('bounded research goal', { timeoutMs: 20 }), []);
    assert.ok(Date.now() - started < 1000);
    executor.memory = { recall: async () => [{ content: 'Useful prior evidence', similarity: 0.8 }] };
    assert.deepEqual(await executor._recallMemories('bounded research goal', { timeoutMs: 20 }), ['Useful prior evidence']);
});
