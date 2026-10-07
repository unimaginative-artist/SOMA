import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyDiscordConversationLane } from '../server/discord/DiscordConversationRouting.js';
import { evaluateDiscordReply } from '../server/discord/DiscordReplyQuality.js';
import { DiscordConversationTelemetry } from '../server/discord/DiscordConversationTelemetry.js';
import { DiscordConversationJobStore } from '../server/discord/DiscordConversationJobStore.js';
import { createDiscordConversationAdapter } from '../server/discord/DiscordConversationAdapter.js';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';

test('Discord routes social turns fast and substantive planning to the local specialist', () => {
    assert.equal(classifyDiscordConversationLane('Hey Soma, how have you been?').lane, 'fast_social');
    const plan = classifyDiscordConversationLane('Build and compare a three-year business plan with $5k starting capital.');
    assert.equal(plan.lane, 'specialist');
    assert.ok(plan.reasons.includes('specialist_topic'));
});

test('ambiguous status, repair, and follow-up turns fail upward to the specialist', () => {
    for (const message of [
        'What are you working on today!?',
        'What kind of improvements?',
        'Are you still broken?',
        'Can you fix yourself or have MAX fix you?'
    ]) {
        const route = classifyDiscordConversationLane(message);
        assert.equal(route.lane, 'specialist', message);
    }
    assert.ok(classifyDiscordConversationLane('What kind of improvements?').reasons.includes('ambiguous_fail_upward'));
});

test('Qwen and full-lobe requests select the deliberate large council lane', () => {
    for (const message of [
        'Use Qwen 27B and all four lobes for this architecture review',
        'Run this through the deep council',
        'Can the full council think about this business plan?'
    ]) {
        const route = classifyDiscordConversationLane(message);
        assert.equal(route.lane, 'large_council');
        assert.ok(route.reasons.includes('explicit_large_council'));
        assert.equal(route.expectedMaxLatencyMs, 300_000);
    }
});

test('Discord forwards durable request identity, progress, and cancellation into the council', async () => {
    const calls = [];
    const controller = new AbortController();
    const onCouncilProgress = () => {};
    const adapter = createDiscordConversationAdapter({
        system: {},
        brain: {
            async reason(_prompt, options) {
                calls.push(options);
                return { text: 'Separating proposals from actions lets verification reject unsafe ideas before execution, while retaining an auditable decision boundary for authorized work.' };
            }
        }
    });
    await adapter.processQuery('Use Qwen 27B and all four lobes to review this architecture.', {
        rawMessage: 'Use Qwen 27B and all four lobes to review this architecture.',
        requestId: 'discord-message-42',
        signal: controller.signal,
        onCouncilProgress
    });
    assert.equal(calls[0].largeCouncil, true);
    assert.equal(calls[0].requestId, 'discord-message-42');
    assert.equal(calls[0].signal, controller.signal);
    assert.equal(calls[0].onCouncilProgress, onCouncilProgress);
});

test('reply evaluator scores multiple quality dimensions and rejects irrelevant fragments', () => {
    const result = evaluateDiscordReply({
        input: 'Compare pricing and cash flow for a shower glass business plan.',
        reply: 'Okay.',
        intent: 'substantive'
    });
    assert.equal(result.acceptable, false);
    assert.ok(result.issues.includes('underdeveloped_substantive_reply'));
    assert.ok(result.dimensions.relevance < 0.3);
});

test('reply evaluator rejects leaked tone directions and fabricated teams', () => {
    assert.ok(evaluateDiscordReply({ input: 'What are you doing?', reply: '[Warm, empathetic tone] I am working on it.' }).issues.includes('style_direction_leak'));
    assert.ok(evaluateDiscordReply({ input: 'Can you build it?', reply: 'I will pass that idea along to the team.' }).issues.includes('fabricated_team'));
});

test('conversation telemetry persists lane, latency, repairs, and fallback counts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-discord-telemetry-'));
    try {
        const statePath = path.join(dir, 'telemetry.json');
        const telemetry = new DiscordConversationTelemetry({ statePath });
        telemetry.record({ lane: 'fast_social', latencyMs: 800, repaired: false, success: true });
        telemetry.record({ lane: 'specialist', fallbackLane: 'fast_social', latencyMs: 4200, repaired: true, success: true });
        const summary = new DiscordConversationTelemetry({ statePath }).summary();
        assert.deepEqual(summary.lanes, { specialist: 1, fast_social: 1 });
        assert.equal(summary.repairs, 1);
        assert.equal(summary.fallbacks, 1);
        assert.equal(summary.averageLatencyMs, 2500);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('durable Discord jobs are reclaimable after a process crash and idempotent after delivery', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-discord-jobs-'));
    try {
        const statePath = path.join(dir, 'jobs.json');
        const first = new DiscordConversationJobStore({ statePath, ownerId: 'process-a' });
        first.receive({ id: 'message-1', messageId: 'message-1', channelId: 'channel-1', content: 'hello' });
        assert.ok(first.claim('message-1'));

        const restarted = new DiscordConversationJobStore({ statePath, ownerId: 'process-b' });
        assert.equal(restarted.pending().length, 1);
        assert.ok(restarted.claim('message-1'));
        restarted.markDeliveryIntent('message-1', { outboxChunks: ['part one', 'part two'], expectedChunkCount: 2 });
        restarted.markDeliveryProgress('message-1', 'reply-1');
        const midDelivery = JSON.parse(fs.readFileSync(statePath, 'utf8')).jobs['message-1'];
        assert.deepEqual(midDelivery.deliveredMessageIds, ['reply-1']);
        assert.equal(midDelivery.expectedChunkCount, 2);
        restarted.complete('message-1', { deliveredMessageIds: ['reply-1'] });
        assert.equal(restarted.claim('message-1'), null);
        assert.equal(restarted.receive({ id: 'message-1' }).status, 'posted');
        assert.deepEqual(restarted.summary(), { total: 1, pending: 0, posted: 1, failed: 0, retryable: 0 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Discord crash recovery sends only missing durable outbox chunks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-discord-outbox-'));
    try {
        const statePath = path.join(dir, 'jobs.json');
        const crashed = new DiscordConversationJobStore({ statePath, ownerId: 'process-a' });
        crashed.receive({ id: 'message-2', messageId: 'message-2', channelId: 'channel-2', content: 'long request' });
        crashed.claim('message-2');
        crashed.markDeliveryIntent('message-2', { outboxChunks: ['part one', 'part two'], expectedChunkCount: 2 });
        crashed.markDeliveryProgress('message-2', 'reply-1');

        const recoveredStore = new DiscordConversationJobStore({ statePath, ownerId: 'process-b' });
        const sent = [];
        const recent = new Map([['reply-1', { id: 'reply-1', author: { id: 'bot' }, reference: { messageId: 'message-2' } }]]);
        recent.filter = callback => new Map([...recent].filter(([, value]) => callback(value)));
        const sourceMessage = { async reply(payload) { sent.push(payload.content); return { id: 'reply-2' }; } };
        const channel = { messages: { async fetch(arg) { return typeof arg === 'object' ? recent : sourceMessage; } } };
        const arbiter = new DiscordArbiter({ conversationJobs: recoveredStore });
        arbiter.connected = true;
        arbiter.client = { user: { id: 'bot' }, channels: { async fetch() { return channel; } } };

        await arbiter._recoverPendingConversationJobs();
        assert.deepEqual(sent, ['part two']);
        assert.equal(recoveredStore.summary().posted, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('substantive Discord overload repairs use an alternate provider and attribute its result', async () => {
    const calls = [];
    const telemetryEvents = [];
    const adapter = createDiscordConversationAdapter({
        system: { discordConversationTelemetry: { record(event) { telemetryEvents.push(event); return { at: 'now' }; } } },
        brain: {
            async reason(prompt, options) {
                calls.push({ prompt, options });
                if (calls.length === 1) return { text: 'My local brain is overloaded right now. Retry in a moment.' };
                return { text: 'With $5k starting capital, begin with measured shower-glass jobs, preserve cash for materials, and compare pricing against local installation demand before expanding.', model: 'deepseek-chat' };
            }
        }
    });
    const result = await adapter.processQuery('What would a shower glass business plan look like with $5k starting capital?', { rawMessage: 'What would a shower glass business plan look like with $5k starting capital?', isAdmin: true });
    assert.equal(calls[0].options.localModel, 'qwen2.5:7b');
    assert.equal(calls[1].options.localModel, 'qwen2.5:7b');
    assert.equal(calls[1].options.localFirst, false);
    assert.equal(calls[1].options.forceLocal, false);
    assert.equal(result.metadata.discordConversationLane, 'specialist');
    assert.equal(result.metadata.discordConversationFallbackLane, 'provider_repair');
    assert.equal(result.metadata.discordConversationModel, 'deepseek-chat');
    assert.match(result.response, /\$5k starting capital/i);
    assert.equal(telemetryEvents[0].fallbackLane, 'provider_repair');
});
