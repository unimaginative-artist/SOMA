import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compactMessages, estimateMessageTokens } from '../server/core/DeepSeekGateway.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayUrl = pathToFileURL(path.resolve(here, '../server/core/DeepSeekGateway.js')).href;

function runIsolated(source, env = {}) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-deepseek-gateway-'));
    try {
        return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
            cwd,
            encoding: 'utf8',
            env: { ...process.env, ...env },
        }).trim();
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
    }
}

test('prompt compaction preserves system context and newest user message', () => {
    const messages = [
        { role: 'system', content: 'System rules '.repeat(500) },
        ...Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `old-${index} ` + 'x'.repeat(3000) })),
        { role: 'user', content: 'newest request must survive' },
    ];
    const compacted = compactMessages(messages, { priority: 'background', maxInputTokens: 1200 });
    assert.equal(compacted[0].role, 'system');
    assert.equal(compacted.at(-1).content, 'newest request must survive');
    assert.ok(estimateMessageTokens(compacted) <= 1300);
    assert.ok(compacted.length < messages.length);
});

test('gateway meters calls and preserves human requests when background anomaly circuit opens', () => {
    const source = `
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } })
        });
        const { default: gateway } = await import(${JSON.stringify(gatewayUrl)});
        const base = { apiKey: 'test', messages: [{ role: 'user', content: 'test request' }], maxTokens: 10 };
        await gateway.complete({ ...base, actor: 'BackgroundTest', action: 'test', priority: 'background' });
        let backgroundBlocked = false;
        try { await gateway.complete({ ...base, actor: 'BackgroundTest', action: 'test', priority: 'background' }); }
        catch (error) { backgroundBlocked = error.code === 'DEEPSEEK_ANOMALY_BLOCKED'; }
        const human = await gateway.complete({ ...base, actor: 'HumanTest', action: 'chat', priority: 'human' });
        const { default: ledger } = await import(${JSON.stringify(pathToFileURL(path.resolve(here, '../server/core/CostLedger.js')).href)});
        console.log(JSON.stringify({ backgroundBlocked, human: human.data.choices[0].message.content, report: ledger.getDailyReport() }));
    `;
    const result = JSON.parse(runIsolated(source, {
        SOMA_DAILY_BUDGET_USD: '10',
        SOMA_DEEPSEEK_BACKGROUND_CALLS_PER_WINDOW: '1',
        SOMA_DEEPSEEK_ANOMALY_MIN_CALLS: '1',
    }));
    assert.equal(result.backgroundBlocked, true);
    assert.equal(result.human, 'ok');
    assert.equal(result.report.calls, 2);
    assert.deepEqual(result.report.groups.map(group => group.actor).sort(), ['BackgroundTest', 'HumanTest']);
});

test('budget reservations prevent concurrent calls from crossing the cap', () => {
    const source = `
        globalThis.fetch = async () => {
            await new Promise(resolve => setTimeout(resolve, 25));
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1000, completion_tokens: 1000 } }) };
        };
        const { default: gateway } = await import(${JSON.stringify(gatewayUrl)});
        const base = { apiKey: 'test', messages: [{ role: 'user', content: 'x'.repeat(4000) }], maxTokens: 1000, actor: 'ConcurrentTest', action: 'test', priority: 'human' };
        const results = await Promise.allSettled([gateway.complete(base), gateway.complete(base)]);
        console.log(JSON.stringify(results.map(result => result.status)));
    `;
    const statuses = JSON.parse(runIsolated(source, {
        SOMA_DAILY_BUDGET_USD: '0.0005',
        DEEPSEEK_CHAT_INPUT_PER_MILLION: '0.14',
        DEEPSEEK_CHAT_OUTPUT_PER_MILLION: '0.28',
    }));
    assert.deepEqual(statuses.sort(), ['fulfilled', 'rejected']);
});
