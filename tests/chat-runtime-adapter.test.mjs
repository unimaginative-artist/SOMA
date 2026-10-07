import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatRuntimeAdapter } from '../core/ChatRuntimeAdapter.js';

test('all chat transports delegate to the cognitive runtime with original intent intact', async () => {
    const calls = [];
    const adapter = new ChatRuntimeAdapter({
        system: { cognitiveRuntime: { run: async input => { calls.push(input); return { text: 'done', cognitiveTransaction: { id: 'tx-1', lane: 'agentic' } }; } } }
    });
    const result = await adapter.handle({ channel: 'discord', message: 'fix the failing test', prompt: '[context] fix the failing test', sessionId: 'discord:1', trustedActionAuthority: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].message, 'fix the failing test');
    assert.equal(calls[0].prompt, '[context] fix the failing test');
    assert.equal(calls[0].options.sourceChannel, 'discord');
    assert.equal(result.adapter.lane, 'agentic');
});

test('chat adapter refuses to silently fall back to a language model', async () => {
    const adapter = new ChatRuntimeAdapter({ system: { quadBrain: { reason: async () => 'wrapper response' } } });
    await assert.rejects(() => adapter.handle({ message: 'do work' }), /CognitiveRuntime is unavailable/);
});
