// No Discord connection, messages, goals, trades, edits or restarts. Replay the real
// command handlers against live status snapshots and actual read-only MAX source.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Isolate imported SQLite handles in a child, then clean up after they close.
if (!process.argv.includes('--worker')) {
    const owned = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-discord-probe-'));
    let code = 1;
    try {
        code = await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--worker', owned], { stdio: 'inherit', windowsHide: true });
            child.once('error', reject); child.once('exit', resolve);
        });
    } finally { await fs.rm(owned, { recursive: true, force: true }); }
    process.exit(code ?? 1);
}
const temporary = process.argv.at(-1);
const report = { at: new Date().toISOString(), mode: 'isolated-handler-replay-with-live-evidence', discordMessagesSent: 0, sourceWrites: 0, results: [] };
const load = file => import(pathToFileURL(path.join(root, file)).href);
const get = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
};
try {
    process.chdir(temporary);
    const status = await get('http://127.0.0.1:3001/api/asi/status');
    assert.ok(status.kernel && status.selfEvolution, 'Live ASI status required');
    const { DiscordArbiter } = await load('arbiters/DiscordArbiter.js');
    const system = { asiKernel: { getStatus: () => status.kernel, getCycles: () => [] },
        selfEvolutionDirector: { getStatus: () => status.selfEvolution },
        maxBridge: { maxPath: process.env.MAX_PATH || path.join(root, '..', 'MAX') } };
    const arbiter = new DiscordArbiter({ masterId: 'probe-owner', system });
    arbiter._recordDiscordInteraction = async record => { report.results.at(-1).record = { action: record.action, metadata: record.metadata }; };
    arbiter._executeRegistryTool = async () => { throw new Error('Unexpected executable tool'); };
    arbiter.readMessages = async () => [{ id: 'prior-human', bot: false, authorId: 'probe-owner', content: 'You have access to all of MAX code; I need him to be self recursive too', createdAt: Date.now() - 60_000 }];
    for (const input of ['No how is your recursive self improvement going', 'Can u look at his code base? And let me know!']) {
        const row = { input }; report.results.push(row);
        const msg = { id: 'probe-turn', author: { id: 'probe-owner' }, guildId: 'DM', channelId: 'probe-only', reply: async text => { row.reply = text; } };
        const result = await arbiter._handleDiscordCommand(msg, input);
        assert.equal(result.handled, true);
        assert.ok(row.reply);
    }
    assert.match(report.results[0].reply, /recorded cycle window/);
    assert.ok(report.results[1].record.metadata.reads.length > 0, 'Actual MAX source read required');

    if (process.argv.includes('--model')) {
        const { createDiscordConversationAdapter } = await load('server/discord/DiscordConversationAdapter.js');
        const modelStatus = await get('http://127.0.0.1:3001/api/social/discord/bot/status');
        const active = modelStatus.conversationRouting?.last;
        assert.ok(active?.endpoint && active?.model, 'Actual Discord model telemetry required');
        const endpoint = new URL(active.endpoint);
        assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Probe is local inference only');
        const brain = { reason: async (prompt, options) => {
            const response = await fetch(`${endpoint.origin}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(60000), body: JSON.stringify({ model: active.model, stream: false,
                    messages: [{ role: 'system', content: options.systemPrompt }, ...(options.history || []), { role: 'user', content: prompt }],
                    options: { temperature: options.temperature, num_predict: options.maxTokens } }) });
            if (!response.ok) throw new Error(`Local model HTTP ${response.status}`);
            const result = await response.json();
            return { text: result.message?.content || '', model: result.model };
        } };
        const adapter = createDiscordConversationAdapter({ system: {}, brain });
        for (const input of ['Yes I have seen an octopus; they also have a sense of intelligence', 'U and max are my only two projects']) {
            const result = await adapter.processQuery(input, { userId: 'probe-owner', isAdmin: true, guildId: 'DM', channelId: 'probe-only' });
            report.results.push({ input, reply: result.text, model: active.model, quality: result.metadata.discordConversationQuality,
                repaired: result.metadata.discordConversationRepair, fallback: result.metadata.discordConversationDeterministicRecovery });
            assert.equal(result.metadata.discordConversationDeterministicRecovery, false, 'The real model must answer, not a deterministic fallback');
            assert.equal(result.metadata.discordConversationQuality.acceptable, true);
        }
    }
    report.passed = true;
} catch (error) {
    report.passed = false; report.error = error.message; process.exitCode = 1;
} finally {
    process.chdir(root);
    const output = path.join(root, 'data/repair-verification', `discord-followthrough-${Date.now()}.json`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, error: report.error, report: output, results: report.results.map(({ input, reply, fallback }) => ({ input, reply, fallback })) }, null, 2));
    // Parent removes its own temporary workspace after this child's handles close.
}
