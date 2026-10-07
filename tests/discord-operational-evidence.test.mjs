import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';
import { improvementStatusReply, isCodebaseInspectionRequest, isMaxFolderInspectionRequest, inspectProjectFolder, resolveInspectionProject, inspectImprovementCodebase } from '../server/discord/DiscordOperationalEvidence.js';
import { isDiscordImprovementStatusRequest } from '../server/discord/DiscordTurnPolicy.js';
import { evaluateDiscordReply } from '../server/discord/DiscordReplyQuality.js';
import { createDiscordConversationAdapter, buildDiscordHistory } from '../server/discord/DiscordConversationAdapter.js';
import { eligiblePaperTrade, summarizePaperTrades } from '../server/finance/TradeEvidenceScope.js';

const statusSystem = () => ({
    asiKernel: { getStatus: () => ({ successCycles: 0, pendingCycles: 0, awaitingApproval: 0, lastResult: 'admission_deferred' }), getCycles: () => [] },
    selfEvolutionDirector: { getStatus: () => ({ active: [], recent: [{ id: 'experiment-real', state: 'rolled_back', reason: 'capability_contract_failed' }] }) }
});
function harness(system = {}) {
    const replies = [], records = [];
    const arbiter = new DiscordArbiter({ masterId: 'owner', system });
    arbiter._recordDiscordInteraction = async row => records.push(row);
    arbiter._executeRegistryTool = async () => { throw new Error('Unrequested execution'); };
    const msg = { id: 'latest', author: { id: 'owner', username: 'owner' }, channelId: 'fixture', guildId: 'DM', reply: async text => replies.push(text) };
    return { arbiter, msg, replies, records };
}

test('RSI transcript and ordinary status variants use evidence; design discussion does not', () => {
    for (const input of ['No how is your recursive self improvement going', 'How’s your self-improvement going?', 'Any results from your self-repair?', 'RSI status']) assert.equal(isDiscordImprovementStatusRequest(input), true, input);
    for (const input of ['How does recursive self improvement work?', 'Could we build self-improvement?', 'Start self-improvement', 'Explain self-improvement progress metrics']) assert.equal(isDiscordImprovementStatusRequest(input), false, input);
});
test('full command handler reports rollback and zero gains, without asking a model or creating a goal', async () => {
    const { arbiter, msg, replies, records } = harness(statusSystem());
    assert.equal((await arbiter._handleDiscordCommand(msg, 'No how is your recursive self improvement going')).handled, true);
    assert.match(replies[0], /improvements in the recorded cycle window: 0/);
    assert.match(replies[0], /rolled_back.*capability_contract_failed/);
    assert.match(replies[0], /admission_deferred/);
    assert.equal(records[0].action, 'grounded_improvement_status');
});
test('a recent RSI status keeps ambiguous failure follow-ups on the self-improvement path', async () => {
    const { arbiter, msg, replies } = harness(statusSystem());
    arbiter._readActivityState = async () => ({ replies: [{ channelId: msg.channelId, authorId: 'owner',
        action: 'grounded_improvement_status', createdAt: Date.now() }] });
    assert.equal((await arbiter._handleDiscordCommand(msg, 'So its not working')).handled, true);
    assert.equal((await arbiter._handleDiscordCommand(msg, 'RSI is a challenge')).handled, true);
    assert.ok(replies.every(reply => /improvements in the recorded cycle window: 0/.test(reply)));
});
test('missing status service reports unavailable, not made-up progress', () => {
    assert.match(improvementStatusReply({}), /cannot verify/);
    assert.doesNotMatch(improvementStatusReply({}), /steady progress/);
});
test('status and repository inspections reject a username-only non-owner before reading anything', async () => {
    const { arbiter, msg, replies } = harness({ asiKernel: { getStatus: () => assert.fail('read denied') } });
    msg.author.id = 'stranger';
    arbiter.readMessages = () => assert.fail('history denied');
    for (const text of ['How is your self-improvement going?', 'Can u look at his code base?']) {
        assert.equal((await arbiter._handleDiscordCommand(msg, text)).handled, true);
        assert.match(replies.at(-1), /owner ID/);
    }
});
test('read-only codebase requests do not swallow implementation requests', () => {
    assert.equal(isCodebaseInspectionRequest('Can u look at his code base? And let me know!'), true);
    assert.equal(isCodebaseInspectionRequest('Read MAX source code'), true);
    assert.equal(isCodebaseInspectionRequest('Review and fix MAX codebase'), false);
});
test('MAX follow-up lists actual files and rejects fictional inspection staging', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-max-folder-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'core'));
    await fs.writeFile(path.join(root, 'core', 'SimulationSuite.js'), 'export const simulation = true;\n');
    assert.equal(isMaxFolderInspectionRequest('Oh sure i didnt know max was worked on today but yeah lets see it'), true);
    const inventory = await inspectProjectFolder({ root });
    assert.match(inventory.reply, /core\/SimulationSuite\.js/);
    assert.match(inventory.reply, /Modification times do not prove/);
    const fabricated = evaluateDiscordReply({ input: 'Let’s see MAX', reply: '[Opening MAX folder...]\nSimulation Suite Enhancements: New modules.' });
    assert.ok(fabricated.issues.includes('fictional_workspace_stage'));
    const reminder = evaluateDiscordReply({ input: 'Can you set a daily review?', reply: "I'll send a reminder at 9 AM." });
    assert.ok(reminder.issues.includes('unverified_reminder_promise'));
});
test('9 AM review request records a schedule state rather than claiming delivery', async () => {
    const { arbiter, msg, replies, records } = harness();
    const result = await arbiter._handleDiscordCommand(msg, 'Go ahead and try the daily review at 9 AM');
    assert.equal(result.handled, true);
    assert.match(replies[0], /scheduled for .*local 9:00 AM/);
    assert.match(replies[0], /not a delivered review/);
    assert.equal(records[0].action, 'daily_review_schedule');
    assert.ok(records[0].metadata.nextRunAt);
});
test('legacy Bee rows do not enter the same paper scope used for status and promotion', () => {
    const legacy = { strategy: 'beebots_boozy', pnl: 11.91, attribution_json: '{}' };
    const verified = { ...legacy, attribution_json: JSON.stringify({ source: 'soma_beebots', mode: 'paper', strategyId: 'beebots_boozy' }) };
    assert.equal(eligiblePaperTrade(legacy), false);
    assert.equal(eligiblePaperTrade(verified), true);
    assert.equal(eligiblePaperTrade({ strategy: 'standard_portfolio', pnl: -1 }), true);
    assert.deepEqual({ total: summarizePaperTrades([legacy, verified, { strategy: 'standard_portfolio', pnl: -1 }]).totalTrades,
        pnl: summarizePaperTrades([legacy, verified, { strategy: 'standard_portfolio', pnl: -1 }]).totalPnl },
        { total: 2, pnl: 10.91 });
});
test('pronouns use recent same-human history, not bots, other users or stale messages', () => {
    const now = Date.now(), input = 'Can u look at his code base?';
    const row = { authorId: 'owner', bot: false, content: 'You have access to all of MAX code', createdAt: now - 300_000 };
    assert.equal(resolveInspectionProject(input, [row], { userId: 'owner', now }), 'MAX');
    for (const invalid of [{ ...row, bot: true }, { ...row, authorId: 'other' }, { ...row, createdAt: now - 31 * 60_000 }, { ...row, createdAt: undefined }]) assert.equal(resolveInspectionProject(input, [invalid], { userId: 'owner', now }), null);
    assert.equal(resolveInspectionProject(input, [row, { ...row, content: 'Another project named Citrus' }], { userId: 'owner', now }), null);
    assert.equal(resolveInspectionProject('Inspect your codebase'), 'SOMA');
    assert.equal(resolveInspectionProject('Can you analyze maxs architecture and look for weaknesses'), 'MAX');
});
test('full transcript inspection reads configured MAX source and gives line/hash evidence, with no writes', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-max-inspection-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'core'));
    const content = 'async evolve() {\n// await this.max.tools.self.evolve({});\nconsole.log("Would evolve: placeholder");\n}';
    await fs.writeFile(path.join(root, 'core/SelfImprovementLoop.js'), content);
    const { arbiter, msg, replies, records } = harness({ maxBridge: { maxPath: root } });
    arbiter.readMessages = async () => [
        { id: 'recent', authorId: 'owner', content: 'I need him to be self recursive too', bot: false, createdAt: Date.now() - 60_000 },
        { id: 'previous', authorId: 'owner', content: 'You have access to all of MAX code', bot: false, createdAt: Date.now() - 180_000 }
    ];
    assert.equal((await arbiter._handleDiscordCommand(msg, 'Can u look at his code base? And let me know!')).handled, true);
    assert.match(replies[0], /read 1.*MAX/);
    assert.match(replies[0], /placeholder/);
    assert.match(replies[0], /L2:/);
    assert.match(replies[0], /not run tests, queued work or changed code/);
    assert.match(records[0].metadata.reads[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(await fs.readFile(path.join(root, 'core/SelfImprovementLoop.js'), 'utf8'), content);
});
test('inspection skips secrets and junctions leading outside the configured repository', async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-inspect-boundary-'));
    t.after(() => fs.rm(temp, { recursive: true, force: true }));
    const root = path.join(temp, 'repo'), external = path.join(temp, 'external');
    await fs.mkdir(root); await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'SelfImprovementLoop.js'), 'console.log("Would evolve: outside-secret");');
    await fs.symlink(external, path.join(root, 'core'), process.platform === 'win32' ? 'junction' : 'dir');
    await fs.writeFile(path.join(root, '.env'), 'SECRET=never-read');
    const result = await inspectImprovementCodebase({ root, project: 'MAX' });
    assert.equal(result.reads.length, 0);
    assert.doesNotMatch(result.reply, /outside-secret|never-read/);
});
test('reorganized MAX source symlinks inside its own repository are read, external ones are not', async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-inspect-links-'));
    t.after(() => fs.rm(temp, { recursive: true, force: true }));
    const root = path.join(temp, 'repo');
    await fs.mkdir(path.join(root, 'core'), { recursive: true });
    await fs.mkdir(path.join(root, 'cognition'));
    await fs.writeFile(path.join(root, 'cognition/loop.js'), 'console.log("Would evolve: internal");');
    await fs.writeFile(path.join(temp, 'outside.js'), 'console.log("Would evolve: private-outside");');
    try {
        await fs.symlink(path.join(root, 'cognition/loop.js'), path.join(root, 'core/SelfImprovementLoop.js'), 'file');
    } catch (error) {
        if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
        t.skip('Windows token cannot create file symlinks; actual existing MAX links are exercised by prove-discord-followthrough.mjs.');
        return;
    }
    await fs.symlink(path.join(temp, 'outside.js'), path.join(root, 'core/SelfImprovementEngine.js'), 'file');
    const result = await inspectImprovementCodebase({ root, project: 'MAX' });
    assert.equal(result.reads.length, 1);
    assert.match(result.reply, /internal/);
    assert.doesNotMatch(result.reply, /private-outside/);
});
test('vague improvement claims are rejected and removed from assistant history', () => {
    const reply = 'The recursive self-improvement loop is making steady progress. We’ve been refining the debate refinement process, which has helped the system converge on more effective execution paths.';
    assert.ok(evaluateDiscordReply({ input: 'How is self-improvement going?', reply }).issues.includes('unverified_improvement_claim'));
    assert.equal(buildDiscordHistory([{ bot: true, content: reply }]).length, 0);
    for (const text of ['I cannot verify that my self-improvement loop is making steady progress.', 'If the self-improvement loop is making progress, its tests should show a gain.', 'We could improve the debate process by measuring outcomes.']) assert.equal(evaluateDiscordReply({ input: 'How could we improve?', reply: text }).acceptable, true, text);
});
test('English-to-Chinese drift fails but translations, quotations, code and Chinese conversation remain valid', () => {
    const mixed = 'Indeed, octopuses展现他们的智慧令人印象深刻。他们的学习能力和解决问题的方式真的很神奇。';
    assert.ok(evaluateDiscordReply({ input: 'Yes they also have a sense of intelligence', reply: mixed }).issues.includes('unexpected_language_switch'));
    for (const input of ['Translate this into Chinese', '请用中文介绍章鱼', 'Quote the original sentence']) assert.ok(!evaluateDiscordReply({ input, reply: mixed }).issues.includes('unexpected_language_switch'));
    assert.ok(!evaluateDiscordReply({ input: 'Explain this code', reply: 'The string is a label: `他们的学习能力`.' }).issues.includes('unexpected_language_switch'));
});
test('direct-address U is not another project', () => {
    assert.ok(evaluateDiscordReply({ input: 'U and max are my only two projects', reply: 'That is great! How are U and MAX progressing?' }).issues.includes('self_reference_miss'));
    assert.ok(evaluateDiscordReply({ input: 'U and max are my only two projects', reply: 'Got it. U and MAX are your main focuses then. How can we collaborate more effectively on them?' }).issues.includes('self_reference_miss'));
    assert.equal(evaluateDiscordReply({ input: 'U and max are my only two projects', reply: 'Right—me and MAX. Then our ability to follow through is what matters here.' }).acceptable, true);
});
test('adapter repairs a language-switch draft before delivery and records the original failure', async () => {
    const events = [], calls = [];
    const system = { discordConversationTelemetry: { record: e => { events.push(e); return e; } } };
    const brain = { reason: async (prompt, opts) => { calls.push({ prompt, opts }); return { text: calls.length === 1 ? 'Indeed, octopuses展现他们的智慧令人印象深刻。' : 'Their problem-solving is remarkable. Watching one explore makes that intelligence much more tangible.' }; } };
    const adapter = createDiscordConversationAdapter({ system, brain });
    const result = await adapter.processQuery('Yes they also have a sense of intelligence', { userId: 'owner', isAdmin: true, guildId: 'DM' });
    assert.equal(calls.length, 2);
    assert.match(calls[1].prompt, /English stays English/);
    assert.ok(events[0].draftAssessments[0].issues.includes('unexpected_language_switch'));
    assert.equal(result.metadata.discordConversationDeterministicRecovery, false);
    assert.doesNotMatch(result.text, /[\p{Script=Han}]/u);
});
test('Discord boot initializes telemetry rather than silently losing quality records', async () => {
    const source = await fs.readFile(fileURLToPath(new URL('../server/loaders/extended.js', import.meta.url)), 'utf8');
    assert.match(source, /system\.discordConversationTelemetry\s*\|\|=\s*new DiscordConversationTelemetry/);
});
