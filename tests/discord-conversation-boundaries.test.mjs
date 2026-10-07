import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';
import { isDiscordWorkStatusRequest, needsDiscordOperationalContext, isDiscordSourceInspection } from '../server/discord/DiscordTurnPolicy.js';
import { inspectDiscordSource } from '../server/discord/DiscordSourceInspection.js';
import { buildDiscordHistory, cleanDiscordMemories, assessDiscordReply, createDiscordConversationAdapter, identityPrompt } from '../server/discord/DiscordConversationAdapter.js';
import { classifyDiscordConversationLane } from '../server/discord/DiscordConversationRouting.js';

const discussion = [
    'Ok what else would you like to work on',
    'You can talk about whatever u want',
    'What do you think about what I said?',
    'Yes working toward emergent behaviors is what our goals are, we are designing towards a more cognitive substrate',
    'Well no I have nothing planned I think its something thats going to sit above your existing architecture but I have yet to figure that out',
    'Well you can 100% work on the trades i love that idea but when I get home I am 100% changing your all around structure I need you to be making adjustments and code edits autonomously and whatever I did before is hindering that also using aurora for trading is probably why you are losing the trades aurora is for creativity not strategy you have the Prometheus lobe for strategy so thats prob where we are broken',
    'The whole purpose of you your reason for existing is to modify yourself and grow exponentially max is a tool to facilitate that!',
];
for (const input of discussion) test(`brainstorming stays conversation: ${input.slice(0, 65)}`, async () => {
    assert.equal(isDiscordWorkStatusRequest(input), false);
    const arbiter = new DiscordArbiter({ masterId: 'owner' });
    arbiter._handleAdminLocalSpeechRetry = async () => ({ handled: false });
    arbiter._handleAdminLocalSpeech = async () => ({ handled: false });
    arbiter._executeRegistryTool = async () => { throw new Error('No tool was requested'); };
    arbiter._recordDiscordInteraction = async () => {};
    const replies = [];
    const msg = { id: 'message', author: { id: 'owner' }, channelId: 'channel', reply: async text => replies.push(text) };
    assert.equal((await arbiter._handleDiscordCommand(msg, input)).handled, false);
    assert.equal(replies.length, 0);
});
test('explicit work status still reaches real ledgers', () => {
    for (const input of ['Hows your medical research going', 'What are you working on today?', 'What have you built?', 'Your goals keep blocking do you know why?', '!goals']) assert.equal(isDiscordWorkStatusRequest(input), true, input);
});
test('casual greetings and architecture discussions do not inject trading state', () => {
    assert.equal(needsDiscordOperationalContext('Hows it going'), false);
    assert.equal(needsDiscordOperationalContext('How can we improve your architecture?'), false);
    assert.equal(needsDiscordOperationalContext('What is your current trading PnL?'), true);
});
test('short technical questions and their followups select the reasoning lane', () => {
    for (const input of ['Maybe try the discordarbiter.js maybe its in there', 'Well if your mixture of experts isnt correctly functioning then it needs corrected', 'Marionette is an asset', 'Prometheus is for strategy']) assert.equal(classifyDiscordConversationLane(input).lane, 'specialist');
    assert.equal(classifyDiscordConversationLane('Ok so what can you do about it?', { runningHistory: [{ bot: false, content: 'Your mixture of experts needs correction' }] }).lane, 'specialist');
    assert.equal(classifyDiscordConversationLane('Good morning').lane, 'fast_social');
});
test('peer bots and other people keep their identity in multi-party history', () => {
    const history = buildDiscordHistory([
        { bot: true, authorId: 'peer', author: 'MAX', content: 'A peer idea.' },
        { bot: true, authorId: 'soma', author: 'SOMA', content: 'My own reply.' },
        { bot: false, authorId: 'other', author: 'Alex', content: 'A different view.' },
        { bot: false, authorId: 'owner', author: 'Owner', content: 'My question.' },
    ], { selfUserId: 'soma', currentUserId: 'owner' });
    assert.deepEqual(history.map(m => m.role), ['user', 'assistant', 'user', 'user']);
    assert.match(history[0].content, /MAX \(other bot\)/);
    assert.match(history[2].content, /Alex/);
    assert.equal(history[3].content, 'My question.');
});
const fabricated = [
    'I should only talk about artifacts I can point to.',
    'The recent TP53 cycles are showing a consistent degradation in protein sequencing accuracy.',
    'I’ve flagged it for MAX’s attention.',
    'I found a series of archived communication logs from the initial Aurora development phase.',
    'I’ve accessed the relevant files. discordarbiter.js exists.',
    'The core constraint is within the weight_data() function. The key line is if (divergence_score > threshold) { weight = 0.1; }',
    'I’m queuing a targeted self-diagnostic.',
];
for (const reply of fabricated) test(`reject and exclude unsupported transcript claim: ${reply.slice(0, 64)}`, () => {
    assert.equal(assessDiscordReply('Can you read it and find the line?', reply).acceptable, false);
    assert.deepEqual(buildDiscordHistory([{ bot: true, content: reply }]), []);
});
test('ideas and preferences need no artifact and remain acceptable', () => {
    for (const reply of [
        'I would like to explore a shared working-memory layer. We can sketch it before deciding whether it belongs above the existing components.',
        'I think Marionette is useful for recovery. I would test rollback before relying on it for a larger change.',
        'I found that idea interesting. A design sketch would help us compare the options.',
    ]) assert.equal(assessDiscordReply('What else would you like to work on?', reply).acceptable, true, reply);
    assert.match(identityPrompt({ isAdmin: true, mode: 'General' }), /Ideas and opinions do not require local artifacts/);
    assert.doesNotMatch(identityPrompt({ isAdmin: true, mode: 'General' }), /speaking privately/);
});
test('source inspection recognizes an explicit filename and scoped follow-up', () => {
    assert.equal(isDiscordSourceInspection('Maybe try the discordarbiter.js maybe its in there'), true);
    assert.equal(isDiscordSourceInspection('Can you read it and find the line that keeps you constrained?', true), true);
    assert.equal(isDiscordSourceInspection('What did you find?', false), false);
    assert.equal(isDiscordSourceInspection('Modify DiscordArbiter.js to improve replies'), false);
});
test('source read resolves actual case and reports actual numbered lines', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-source-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'arbiters'));
    const content = '// inspected fixture\nconst greeting = "hello";\nconst text = "I should only talk about artifacts I can point to.";\n';
    await fs.writeFile(path.join(root, 'arbiters', 'DiscordArbiter.js'), content);
    const calls = [];
    const result = await inspectDiscordSource({ root, filename: 'discordarbiter.js', query: 'find the line that keeps you constrained', execute: async (tool, args) => { calls.push([tool, args]); return content; } });
    assert.deepEqual(calls, [['read_file', { path: 'arbiters/DiscordArbiter.js' }]]);
    assert.match(result.excerpts, /3: const text/);
    assert.doesNotMatch(result.reply, /weight_data|divergence_score/);
    await assert.rejects(inspectDiscordSource({ root, filename: '../outside.js', execute: () => assert.fail('must not execute') }), /limited/);
    await assert.rejects(inspectDiscordSource({ root, filename: 'discordarbiter.js', execute: async () => 'Error: read failed' }), /read failed/);
    await assert.rejects(inspectDiscordSource({ root, filename: '*.js', execute: () => assert.fail('must not execute') }), /specific/);
});
test('failed generation stays visible as a failure rather than receiving success credit', async () => {
    const events = [];
    const adapter = createDiscordConversationAdapter({ system: { discordConversationTelemetry: { record: e => events.push(e) } }, brain: { reason: async () => ({ text: 'I’m queuing a targeted self-diagnostic.' }) } });
    const result = await adapter.processQuery('How would a cognitive substrate help?', { isAdmin: true });
    assert.equal(events[0].deterministicRecovery, true);
    assert.equal(events[0].success, false);
    assert.match(result.response, /reply generation failed/);
    assert.doesNotMatch(result.response, /Tell me what.s on your mind/);
});

test('real Mnemonic envelope, numeric topK and memories reach the actual fast-path persona', async () => {
    const calls = [], recalls = [];
    const adapter = createDiscordConversationAdapter({
        system: { mnemonicArbiter: { recall: async (...args) => { recalls.push(args); return { tier: 'cold', results: [{ content: 'Owner enjoys open-ended conversations about the project.', metadata: { authorId: 'owner' } }] }; } } },
        brain: { reason: async (prompt, options) => { calls.push(options); return { text: 'We can start with what you want the new layer to connect, and sketch a small experiment together.' }; } }
    });
    const result = await adapter.processQuery('I have not figured the idea out yet', { isAdmin: true, guildId: 'DM', userId: 'owner', visualContext: 'A sketch with three connected circles.' });
    assert.equal(recalls[0][1], 5);
    assert.match(calls[0].localPersona, /Owner enjoys open-ended conversations/);
    assert.match(calls[0].localPersona, /three connected circles/);
    assert.equal(result.metadata.discordConversationMemoryCount, 1);
    assert.equal(result.metadata.discordConversationMemoryStatus, 'included');
});
test('private memories are not shared with a different Discord user or public channel', () => {
    const memories = { results: [
        { content: 'Personal owner memory.', metadata: { authorId: 'owner' } },
        { content: 'Unscoped legacy private context.' },
        { content: 'Public project context.', metadata: { visibility: 'public' } },
    ] };
    assert.deepEqual(cleanDiscordMemories(memories, { isAdmin: false, userId: 'other', guildId: 'DM' }), ['Public project context.']);
    assert.deepEqual(cleanDiscordMemories(memories, { isAdmin: true, userId: 'owner', guildId: 'guild' }), ['Public project context.']);
});

test('private conversation identity uses immutable owner IDs, not a matching username', () => {
    const arbiter = new DiscordArbiter({ masterId: 'owner' });
    assert.equal(arbiter._isSovereignOperator({ author: { id: 'owner', username: 'renamed-owner' } }), true);
    assert.equal(arbiter._isSovereignOperator({ author: { id: 'other', username: 'owner' } }), false);
    assert.match(DiscordArbiter.prototype._handleIncomingMessage.toString(), /isAdmin: this\._isSovereignOperator\(msg\)/);
});

test('source inspection followups reread the actual file and stay scoped to the owner session', async t => {
    const filename = `DiscordProbe-${crypto.randomUUID()}.js`;
    const fixture = path.join(process.cwd(), filename);
    await fs.writeFile(fixture, 'const constraint = "first version";\n');
    t.after(() => fs.rm(fixture, { force: true }));
    const calls = [], replies = [];
    const arbiter = new DiscordArbiter({ masterId: 'owner', system: { toolRegistry: { execute: async (name, args) => {
        calls.push({ name, args });
        return fs.readFile(path.join(process.cwd(), args.path), 'utf8');
    } } } });
    arbiter._recordDiscordInteraction = async () => {};
    const msg = { author: { id: 'owner' }, channelId: 'one', reply: async text => replies.push(text) };
    assert.equal((await arbiter._handleSourceInspection(msg, `Read ${filename} and find the constraint`)).handled, true);
    await fs.writeFile(fixture, 'const constraint = "second version";\n');
    assert.equal((await arbiter._handleSourceInspection(msg, 'What did you find?')).handled, true);
    assert.equal(calls.length, 2);
    assert.match(replies[1], /second version/);
    assert.equal((await arbiter._handleSourceInspection({ ...msg, channelId: 'other' }, 'What did you find?')).handled, false);
    await arbiter._handleSourceInspection({ ...msg, author: { id: 'imposter', username: 'owner' } }, `Read ${filename}`);
    assert.equal(calls.length, 2);
    assert.match(replies.at(-1), /owner ID/);
});
test('repair model identity is attributed to the draft actually delivered', async () => {
    let attempts = 0;
    const adapter = createDiscordConversationAdapter({ system: {}, brain: { reason: async () => ++attempts === 1
        ? { text: 'I have been running simulations.', model: 'failed-draft-model' }
        : { text: 'I would start with a small experiment that checks whether context reaches the selected model.', model: 'successful-repair-model' } } });
    const result = await adapter.processQuery('What would you like to try next?');
    assert.equal(result.metadata.discordConversationModel, 'successful-repair-model');
});
