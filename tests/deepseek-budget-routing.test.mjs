import test from 'node:test';
import assert from 'node:assert/strict';

import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';

test('agentic executor honors forceLocal before attempting DeepSeek', async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.DEEPSEEK_API_KEY;
    const urls = [];
    process.env.DEEPSEEK_API_KEY = 'test-key';
    globalThis.fetch = async url => {
        urls.push(String(url));
        return { ok: true, json: async () => ({ response: 'local result' }) };
    };

    try {
        const executor = new SomaAgenticExecutor();
        executor.brain = { deepseekApiKey: 'test-key', ollamaEndpoint: 'http://localhost:11434', ollamaModel: 'test-local' };
        const result = await executor._callDirectAPI('system', 'user', true);
        assert.equal(result.provider, 'ollama');
        assert.equal(urls.length, 1);
        assert.match(urls[0], /localhost:11434\/api\/generate/);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
        else process.env.DEEPSEEK_API_KEY = originalKey;
    }
});

test('zero agentic cloud-call allowance forces local execution', async () => {
    const originalFetch = globalThis.fetch;
    const originalLimit = process.env.SOMA_AGENTIC_DEEPSEEK_DAILY_CALL_LIMIT;
    const urls = [];
    process.env.SOMA_AGENTIC_DEEPSEEK_DAILY_CALL_LIMIT = '0';
    globalThis.fetch = async url => {
        urls.push(String(url));
        return { ok: true, json: async () => ({ response: 'budget-safe local result' }) };
    };

    try {
        const executor = new SomaAgenticExecutor();
        executor.brain = { deepseekApiKey: 'test-key', ollamaEndpoint: 'http://localhost:11434', ollamaModel: 'test-local' };
        const result = await executor._callDirectAPI('system', 'user', false);
        assert.equal(result.provider, 'ollama');
        assert.ok(urls.every(url => !url.includes('api.deepseek.com')));
    } finally {
        globalThis.fetch = originalFetch;
        if (originalLimit === undefined) delete process.env.SOMA_AGENTIC_DEEPSEEK_DAILY_CALL_LIMIT;
        else process.env.SOMA_AGENTIC_DEEPSEEK_DAILY_CALL_LIMIT = originalLimit;
    }
});
