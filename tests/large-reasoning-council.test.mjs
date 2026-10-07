import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalLargeReasoningClient } from '../core/LocalLargeReasoningClient.js';
import { LargeReasoningCouncil, LARGE_COUNCIL_LOBES } from '../core/LargeReasoningCouncil.js';
import { BrainBridge } from '../server/BrainBridge.js';

test('local Qwen client disables hidden thinking and exposes model provenance', async () => {
    let request = null;
    const client = new LocalLargeReasoningClient({
        endpoint: 'http://127.0.0.1:8084',
        model: 'qwen-test',
        fetchImpl: async (_url, options) => {
            request = JSON.parse(options.body);
            return { ok: true, json: async () => ({ model: 'qwen-test', choices: [{ message: { content: 'draft' } }], usage: { total_tokens: 42 } }) };
        }
    });
    const result = await client.complete({ prompt: 'Synthesize this', systemPrompt: 'Proposal only' });
    assert.equal(request.chat_template_kwargs.enable_thinking, false);
    assert.equal(request.preserve_thinking, false);
    assert.equal(result.text, 'draft');
    assert.equal(result.model, 'qwen-test');
    assert.equal(result.provider, 'local-llama-server');
});

test('four lobes feed Qwen sequentially and LOGOS verifies the draft', async () => {
    const calls = [];
    const callOptions = [];
    const lobeRunner = async (lobe, prompt, options) => {
        calls.push(lobe);
        callOptions.push(options);
        if (calls.length === 5) {
            assert.equal(lobe, 'LOGOS');
            assert.match(prompt, /QWEN DRAFT/);
            return { text: 'VERDICT: REVISE\nFINAL: Verified council answer.' };
        }
        return { text: `${lobe} evidence`, provider: 'local', model: `soma-${lobe.toLowerCase()}:v2` };
    };
    let synthesisPrompt = '';
    const largeClient = {
        complete: async ({ prompt }) => {
            synthesisPrompt = prompt;
            return { text: 'Untrusted Qwen draft', provider: 'local-llama-server', model: 'qwen-27b', endpoint: 'http://127.0.0.1:8084' };
        }
    };
    const council = new LargeReasoningCouncil({ lobeRunner, largeClient });
    const result = await council.deliberate('Design a robust plan');
    assert.deepEqual(calls, [...LARGE_COUNCIL_LOBES, 'LOGOS']);
    for (const options of callOptions) {
        assert.equal(options.localKeepAlive, 0);
        assert.ok(options.localTimeoutMs >= 90000);
        assert.equal(options.localEndpoint, process.env.SOMA_COUNCIL_LOBE_ENDPOINT || 'http://127.0.0.1:11436');
    }
    for (const lobe of LARGE_COUNCIL_LOBES) assert.match(synthesisPrompt, new RegExp(`## ${lobe}`));
    assert.equal(result.text, 'Verified council answer.');
    assert.equal(result.council.verifier.verdict, 'REVISE');
    assert.equal(result.council.toolAuthority, false);
    assert.match(result.brain, /QWEN27B/);
});

test('large council fails closed before Qwen when fewer than two lobes answer', async () => {
    let qwenCalls = 0;
    const council = new LargeReasoningCouncil({
        lobeRunner: async lobe => lobe === 'LOGOS' ? { text: 'one memo' } : { text: '' },
        largeClient: { complete: async () => { qwenCalls++; return { text: 'should not run' }; } }
    });
    await assert.rejects(() => council.deliberate('Question'), /at least two lobe perspectives/);
    assert.equal(qwenCalls, 0);
});

test('real council lobe path calls trained weights directly without recursive harness', async () => {
    const calls = [];
    class FakeBrain {
        static BRAIN_PERSONAS = { LOGOS: 'logos persona' };
        constructor() { this.lobeModels = { LOGOS: 'soma-logos:v2' }; this.ollamaModel = 'fallback'; }
        async _callOllama(...args) { calls.push(args); return { text: 'memo', model: args[1] }; }
        async callBrain() { throw new Error('recursive harness should not run'); }
    }
    const council = new LargeReasoningCouncil({ brain: new FakeBrain(), largeClient: { complete: async () => ({ text: 'unused' }) } });
    const memo = await council._runLobe('LOGOS', 'question', { lobeTimeoutMs: 20000, lobeMaxTokens: 80 });
    assert.equal(memo.text, 'memo');
    assert.equal(calls[0][1], process.env.SOMA_COUNCIL_MODEL_LOGOS || 'soma-logos:v2');
    assert.equal(calls[0][4], 'logos persona');
    assert.equal(calls[0][8], 0);
    assert.equal(calls[0][10], 'http://127.0.0.1:11436');
    assert.equal(calls[0][11], true);
});

test('a rejected Qwen draft never becomes the final answer', async () => {
    let calls = 0;
    const council = new LargeReasoningCouncil({
        lobeRunner: async lobe => {
            calls++;
            return calls === 5 ? { text: 'VERDICT: REJECT\nFINAL: unsafe' } : { text: `${lobe} memo` };
        },
        largeClient: { complete: async () => ({ text: 'unsafe draft', model: 'qwen-27b' }) }
    });
    await assert.rejects(() => council.deliberate('Question'), /verifier rejected/);
});

test('BrainBridge keeps large council turns on the fully wired direct brain', async () => {
    let directCalls = 0;
    const bridge = new BrainBridge({
        reason: async () => { directCalls++; return { text: 'direct council' }; },
        router: null,
        toolRegistry: null
    });
    bridge._useWorker = true;
    bridge._worker = { postMessage() { throw new Error('worker must not receive council request'); } };
    const result = await bridge.reason('Use the council', { largeCouncil: true, disableAdaptiveRouting: true });
    assert.equal(result.text, 'direct council');
    assert.equal(directCalls, 1);
    assert.equal(bridge._stats.directCalls, 1);
    assert.equal(bridge._stats.workerCalls, 0);
});
