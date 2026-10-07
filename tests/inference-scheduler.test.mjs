import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceScheduler, normalizeInferencePriority } from '../server/core/InferenceScheduler.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('normalizes existing foreground and autonomy priority names', () => {
    assert.equal(normalizeInferencePriority('discord'), 'human');
    assert.equal(normalizeInferencePriority('goal_driven'), 'goal');
    assert.equal(normalizeInferencePriority('curiosity'), 'idle');
    assert.equal(normalizeInferencePriority('unknown'), 'background');
});

test('serializes a constrained resource and drains higher priority first', async () => {
    const scheduler = new InferenceScheduler({ defaultLimit: 1, preemptForeground: false });
    const order = [];
    let release;
    const blocker = scheduler.schedule({ resource: 'gpu', priority: 'interactive' }, async () => {
        order.push('active');
        await new Promise(resolve => { release = resolve; });
        return 'active';
    });
    await wait(5);
    const idle = scheduler.schedule({ resource: 'gpu', priority: 'idle' }, async () => { order.push('idle'); return 'idle'; });
    const goal = scheduler.schedule({ resource: 'gpu', priority: 'goal' }, async () => { order.push('goal'); return 'goal'; });
    release();
    assert.deepEqual(await Promise.all([blocker, idle, goal]), ['active', 'idle', 'goal']);
    assert.deepEqual(order, ['active', 'goal', 'idle']);
    assert.equal(scheduler.getStatus().stats.completed, 3);
});

test('foreground preempts preemptible background without oversubscribing the resource', async () => {
    const scheduler = new InferenceScheduler({ defaultLimit: 1 });
    let active = 0;
    let peak = 0;
    const background = scheduler.schedule({ resource: 'gpu', priority: 'background' }, async ({ signal }) => {
        active++;
        peak = Math.max(peak, active);
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 1000);
                signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
            });
        } finally {
            active--;
        }
        return 'background';
    });
    await wait(10);
    const foreground = scheduler.schedule({ resource: 'gpu', priority: 'human' }, async () => {
        active++;
        peak = Math.max(peak, active);
        active--;
        return 'foreground';
    });

    await assert.rejects(background, error => error.code === 'INFERENCE_PREEMPTED');
    assert.equal(await foreground, 'foreground');
    assert.equal(peak, 1);
    assert.equal(scheduler.getStatus().stats.preempted, 1);
});

test('deadline rejects queued work and it never runs later', async () => {
    const scheduler = new InferenceScheduler({ defaultLimit: 1, preemptForeground: false });
    let release;
    const blocker = scheduler.schedule({ resource: 'gpu', priority: 'interactive', timeoutMs: 1000 }, () => new Promise(resolve => { release = resolve; }));
    await wait(5);
    let ran = false;
    const expired = scheduler.schedule({ resource: 'gpu', priority: 'idle', timeoutMs: 20 }, async () => { ran = true; });
    await assert.rejects(expired, error => error.code === 'INFERENCE_DEADLINE_EXCEEDED');
    release('done');
    await blocker;
    await wait(10);
    assert.equal(ran, false);
    assert.equal(scheduler.getStatus().stats.expired, 1);
});

test('bounded queue rejects low priority and admits a higher-priority displacement', async () => {
    const scheduler = new InferenceScheduler({ defaultLimit: 1, maxQueue: 1, preemptForeground: false });
    let release;
    const blocker = scheduler.schedule({ resource: 'gpu', priority: 'interactive' }, () => new Promise(resolve => { release = resolve; }));
    await wait(5);
    const idle = scheduler.schedule({ resource: 'gpu', priority: 'idle' }, async () => 'idle');
    const goal = scheduler.schedule({ resource: 'gpu', priority: 'goal' }, async () => 'goal');
    await assert.rejects(idle, error => error.code === 'INFERENCE_DISPLACED');
    release('done');
    assert.equal(await blocker, 'done');
    assert.equal(await goal, 'goal');
    assert.equal(scheduler.getStatus().stats.preempted, 1);
});

test('external cancellation prevents a late result from being published', async () => {
    const scheduler = new InferenceScheduler({ defaultLimit: 1 });
    const controller = new AbortController();
    const result = scheduler.schedule({ resource: 'gpu', priority: 'goal', signal: controller.signal }, async () => {
        await wait(30);
        return 'too late';
    });
    await wait(5);
    controller.abort(new Error('operator cancelled'));
    await assert.rejects(result, /operator cancelled/);
    await wait(40);
    assert.equal(scheduler.getStatus().stats.completed, 0);
});
