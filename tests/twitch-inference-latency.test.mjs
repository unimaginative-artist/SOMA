import test from 'node:test';
import assert from 'node:assert/strict';
import { SOMArbiterV2_QuadBrain } from '../arbiters/SOMArbiterV2_QuadBrain.js';

const publicModel = 'qwen2.5:7b';
const resident = (patch = {}) => ({ name: publicModel, model: publicModel, context_length: 32768,
    expires_at: new Date(Date.now() + 60000).toISOString(), ...patch });
const reply = () => new Response(JSON.stringify({ message: { content: 'Hello stream.' },
    load_duration: 12000000, total_duration: 250000000, prompt_eval_duration: 40000000,
    eval_duration: 190000000, prompt_eval_count: 12, eval_count: 5 }));
function brain() {
    const value = Object.create(SOMArbiterV2_QuadBrain.prototype);
    value.ollamaEndpoint = 'http://localhost:11434';
    // These provider-only fixtures never inspect or change a production lease.
    value._assertPublicModelResources = async () => {}; return value;
}
const runPublic = (value, signal = null) => value._callOllama('Public viewer question', publicModel, 0.65, 96,
    'Public co-host prompt', [], signal, [], '2m', 'human', null, { num_ctx: 4096 });

test('public call reuses only the exact resident public model allocation and reports bounded timings', async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, options });
        if (url.endsWith('/api/ps')) return new Response(JSON.stringify({ models: [resident({ private_history: 'SECRET_NOT_A_PROMPT' })] }));
        return reply();
    });
    const result = await runPublic(brain());
    const body = JSON.parse(requests[1].options.body);
    assert.equal(body.options.num_ctx, 32768); assert.equal(body.keep_alive, '2m');
    assert.equal(body.messages.length, 2); assert.ok(!requests[1].options.body.includes('SECRET'));
    assert.deepEqual(result.inference, { contextTokens: 32768, contextPolicy: 'resident_reuse',
        loadMs: 12, totalMs: 250, promptEvalMs: 40, evalMs: 190, promptTokens: 12, evalTokens: 5 });
});

test('cold, stale, oversized, malformed and different-model snapshots retain the 4K default', async t => {
    for (const models of [[], [resident({ name: 'private-lora' })], [resident({ model: 'private-lora' })],
        [resident({ context_length: 65536 })], [resident({ context_length: '32768' })],
        [resident({ context_length: 2048 })], [resident({ expires_at: new Date(0).toISOString() })],
        [resident({ expires_at: 'unknown' })]]) {
        let body;
        const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
            if (url.endsWith('/api/ps')) return new Response(JSON.stringify({ models }));
            body = JSON.parse(options.body); return reply();
        });
        const result = await runPublic(brain());
        assert.equal(body.options.num_ctx, 4096); assert.equal(result.inference.contextPolicy, 'cold_default');
        mock.mock.restore();
    }
});

test('resident lookup failure does not prevent a bounded cold call', async t => {
    t.mock.method(globalThis, 'fetch', async url => url.endsWith('/api/ps') ? new Response('private provider body', { status: 500 }) : reply());
    const result = await runPublic(brain());
    assert.equal(result.inference.contextTokens, 4096); assert.ok(!JSON.stringify(result).includes('private provider body'));
});

test('an uncooperative resident lookup cannot block beyond its bounded host timeout', async t => {
    let signal;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (url.endsWith('/api/ps')) { signal = options.signal; return new Promise(() => {}); }
        return reply();
    });
    const result = await runPublic(brain());
    assert.equal(signal.aborted, true); assert.equal(result.inference.contextPolicy, 'cold_default');
});

test('normal private calls do not inspect resident models or change request defaults', async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return reply(); });
    const result = await brain()._callOllama('Private question', 'private-lora', 0.4, 500, 'Private personality', [{ role: 'user', content: 'History' }]);
    assert.equal(requests.length, 1); assert.ok(requests[0].url.endsWith('/api/chat'));
    assert.equal(requests[0].body.options.num_ctx, undefined); assert.equal(requests[0].body.keep_alive, undefined);
    assert.equal(requests[0].body.messages.length, 3); assert.equal(result.inference, undefined);
});

test('already cancelled public requests perform no model lookup or generation', async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return reply(); });
    const controller = new AbortController(); controller.abort(new Error('Cancelled by caller'));
    await assert.rejects(runPublic(brain(), controller.signal), /Cancelled by caller/);
    assert.equal(calls, 0);
});

test('cancellation during resident lookup cannot start a later generation', async t => {
    const controller = new AbortController(); let generationCalls = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        if (url.endsWith('/api/ps')) { controller.abort(new Error('Cancelled during lookup')); throw controller.signal.reason; }
        generationCalls++; return reply();
    });
    await assert.rejects(runPublic(brain(), controller.signal), /Cancelled during lookup/);
    assert.equal(generationCalls, 0);
});

test('provider timing fields are validated rather than exposing arbitrary provider data', async t => {
    t.mock.method(globalThis, 'fetch', async url => url.endsWith('/api/ps') ? new Response(JSON.stringify({ models: [] }))
        : new Response(JSON.stringify({ message: { content: 'Hello.' }, load_duration: 'SECRET', total_duration: -5,
            eval_count: 'SECRET', prompt_eval_count: 1e9 })));
    const result = await runPublic(brain());
    for (const key of ['loadMs', 'totalMs', 'evalTokens', 'promptTokens']) assert.equal(result.inference[key], null);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
});
