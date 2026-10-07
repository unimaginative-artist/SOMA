import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { classifyPersistentTask, extractFileSearchRequest, isExplicitGoalAuthorization, taskOutputHint } from '../server/discord/DiscordTaskRouter.js';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';

test('natural-language computer search preserves the requested term and expands scope safely', () => {
    const request = extractFileSearchRequest('Hey Soma, search this computer for MAX');
    assert.equal(request.kind, 'file_search');
    assert.equal(request.query, 'MAX');
    assert.equal(request.root, os.homedir());
    assert.equal(request.scope, 'personal computer');
});

test('describing a broken search ability stays in conversation', () => {
    assert.equal(extractFileSearchRequest('No i spent all day trying to fix your ability to search files on that computer'), null);
    assert.equal(extractFileSearchRequest('I can search files on my computer now'), null);
    assert.equal(extractFileSearchRequest('Search a repo').error, 'Tell me the filename or phrase to search for.');
});

test('Discord task router recognizes synthesis, medical paper, research, and app work', () => {
    assert.equal(classifyPersistentTask('Can you consolidate all of your reflections and SOMASagas into one cohesive story?').kind, 'artifact_synthesis');
    const medical = classifyPersistentTask('Consolidate all of your medical research and formulate it like a medical paper');
    assert.equal(medical.kind, 'artifact_synthesis');
    assert.equal(medical.domain, 'medical_research');
    assert.equal(classifyPersistentTask('Search for some research on mitochondrial aging').kind, 'research');
    assert.equal(classifyPersistentTask('Build me an app so I can use it when I get home').kind, 'app_build');
});

test('Discord task router classifies tech research separately from medical research', () => {
    const aiResearch = classifyPersistentTask('Research AI substrates and organic LLMs for neocortex architecture');
    assert.equal(aiResearch.kind, 'research');
    assert.equal(aiResearch.domain, 'tech_research');
    assert.notEqual(aiResearch.domain, 'medical_research');

    const techSynth = classifyPersistentTask('Consolidate your research on neural substrates and LLM architectures into a paper');
    assert.equal(techSynth.kind, 'artifact_synthesis');
    assert.equal(techSynth.domain, 'tech_research');
    assert.notEqual(techSynth.domain, 'medical_research');
});

test('status questions and brainstorming never authorize persistent work', () => {
    for (const message of [
        'Hows your medical research going',
        'How has work been today!?',
        'Your goals keep blocking do you know why?',
        'Ok how do you propose we fix the noise and irrelevant signals?',
        'Oh so you think we can fix it?',
        'Are you able to execute a fix without setting up a queued task?'
    ]) {
        assert.equal(isExplicitGoalAuthorization(message), false, message);
        assert.equal(classifyPersistentTask(message), null, message);
    }
});

test('direct owner action language still authorizes bounded persistent work', () => {
    for (const message of [
        'Can you research mitochondrial aging?',
        'Build me an app for this',
        'Please fix the Discord responder',
        'Go ahead and implement the tested fix'
    ]) assert.equal(isExplicitGoalAuthorization(message), true, message);
});

test('Discord task router keeps profit-repair requests in the paper-trading lane', () => {
    const direct = classifyPersistentTask('Can you fix the trading strategy and start making money?');
    assert.equal(direct.kind, 'trading_diagnostic');
    assert.equal(direct.category, 'trading');
    assert.equal(direct.domain, 'paper_trading');
    assert.equal(classifyPersistentTask('Can you fix it? And start making money?').kind, 'trading_diagnostic');
});

test('trading status questions and image generation do not become background engineering goals', () => {
    const arbiter = new DiscordArbiter();
    assert.equal(arbiter._isTradingStatusQuestion('You make any positive trades yet?'), true);
    assert.equal(classifyPersistentTask('Can you generate me an illustration of a marshy purple landscape?'), null);
});

test('Discord image requests route directly to generation before admin task classification', async () => {
    let generated = 0;
    let created = 0;
    const arbiter = new DiscordArbiter({
        masterId: 'owner-1',
        goalPlanner: { async createGoal() { created++; return { success: true, goalId: 'wrong' }; } },
    });
    arbiter._replyWithGeneratedImage = async () => { generated++; };
    const msg = { author: { id: 'owner-1', username: 'owner' }, channelId: 'dm-1', content: 'Generate me an illustration of a marshy purple landscape', async reply() {} };
    const result = await arbiter._handleDiscordCommand(msg, msg.content);
    assert.equal(result.handled, true);
    assert.equal(generated, 1);
    assert.equal(created, 0);
});

test('Discord image responses reply naturally after a verified upload', async (t) => {
    const arbiter = new DiscordArbiter({ masterId: 'owner-1' });
    const replies = [];
    const imageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-image-route-'));
    const imagePath = path.join(imageDir, 'squirrels.png');
    await sharp({ create: { width: 32, height: 32, channels: 4, background: '#744422' } }).png().toFile(imagePath);
    t.after(async () => {
        await fs.rm(imageDir, { recursive: true, force: true });
        await fs.rm(path.join('data', 'discord', 'image-receipts', 'msg-image-test.json'), { force: true });
    });
    const msg = {
        id: 'msg-image-test',
        author: { id: 'owner-1', username: 'owner' },
        channelId: 'dm-1',
        content: '@Soma ok id like an image of two squirrel warriors battling in the style of sword and sorcery',
        async reply(payload) {
            replies.push(payload);
            return {
                id: 'uploaded-image',
                attachments: new Map([['image', {
                    name: 'squirrels.png', size: (await fs.stat(imagePath)).size,
                    contentType: 'image/png', url: 'https://cdn.discordapp.com/squirrels.png'
                }]]),
                async edit(update) { replies[0] = { ...replies[0], ...update }; }
            };
        }
    };
    const imageEngine = (await import('../server/social/SomaImageGenerationEngine.js')).default;
    const origGenerate = imageEngine.generate;
    imageEngine.generate = async () => ({
        provider: 'bonsai-http',
        prompt: 'A dramatic, low-angle shot captures the intense clash of two squirrel warriors...',
        image: { path: imagePath }
    });
    try {
        await arbiter._replyWithGeneratedImage(msg, msg.content);
        assert.equal(replies.length, 1);
        assert.equal(replies[0].content, 'Here you go, Owner!');
        assert.doesNotMatch(replies[0].content, /AURORA-directed prompt/i);
        assert.doesNotMatch(replies[0].content, /I made this from/i);
        assert.ok(replies[0].files.length === 1);
    } finally {
        imageEngine.generate = origGenerate;
    }
});

test('Discord cancellation changes scheduler state instead of merely promising to stop', async () => {
    const goal = { id: 'b03dcf01-93e5-4ad3-a0f0-09b12061f265', title: 'Trading diagnostic', status: 'active', createdAt: Date.now(), metadata: { sourceChannelId: 'dm-1' } };
    let cancelled = null;
    const arbiter = new DiscordArbiter({
        masterId: 'owner-1',
        goalPlanner: { goals: new Map([[goal.id, goal]]), async cancelGoal(id, reason) { cancelled = { id, reason }; goal.status = 'abandoned'; return { success: true, goal }; } },
    });
    const replies = [];
    const msg = { author: { id: 'owner-1', username: 'owner' }, channelId: 'dm-1', content: 'terminate that goal', async reply(value) { replies.push(value); } };
    const result = await arbiter._handleDiscordCommand(msg, msg.content);
    assert.equal(result.handled, true);
    assert.equal(cancelled.id, goal.id);
    assert.match(cancelled.reason, /owner requested/i);
    assert.match(replies[0], /Cancelled goal/i);
});

test('contextual task inheritance ignores stale and terminal goals', () => {
    const now = Date.now();
    const completed = { id: 'old-trading', status: 'completed', createdAt: now - 1_000, metadata: { taskKind: 'trading_diagnostic', domain: 'paper_trading', sourceChannelId: 'dm-1', originalRequest: 'Fix trading' } };
    const stale = { id: 'stale-research', status: 'active', createdAt: now - 3 * 60 * 60_000, metadata: { taskKind: 'research', domain: 'general', sourceChannelId: 'dm-1', originalRequest: 'Research batteries' } };
    const arbiter = new DiscordArbiter({ goalPlanner: { goals: new Map([[completed.id, completed], [stale.id, stale]]) } });
    assert.equal(arbiter._resolveContextualPersistentTask('Can you finish it?', 'dm-1'), null);
});

test('image analysis capability reply answers the analysis question', async () => {
    const arbiter = new DiscordArbiter();
    arbiter._recordDiscordInteraction = async () => {};
    const replies = [];
    const msg = { author: { id: 'someone', username: 'someone' }, channelId: 'general', content: 'Can you analyze an image if I upload it and help me adjust it?', async reply(value) { replies.push(value); } };
    const result = await arbiter._handleDiscordCommand(msg, msg.content);
    assert.equal(result.handled, true);
    assert.match(replies[0], /analyze its visible subject/i);
    assert.doesNotMatch(replies[0], /dinosaur/i);
});

test('an attached image analysis question reaches reasoning with visual context', async () => {
    const arbiter = new DiscordArbiter();
    const msg = { author: { id: 'someone', username: 'someone' }, channelId: 'general', content: 'Can you analyze this image?', async reply() { throw new Error('capability reply should not intercept an attached image'); } };
    const result = await arbiter._handleDiscordCommand(msg, msg.content, '[SOMA-VISION: A purple marsh.]');
    assert.equal(result.handled, false);
});

test('Discord downloads and analyzes an image attachment without requiring the legacy vision arbiter', async () => {
    const arbiter = new DiscordArbiter({ attachmentAnalyzer: async () => ({ summary: 'A purple marsh with a central tree.', ocrText: null }) });
    const bytes = Buffer.from('not-a-real-image-but-the-injected-analyzer-is-deterministic').toString('base64');
    const attachment = { name: 'marsh.png', contentType: 'image/png', url: `data:image/png;base64,${bytes}`, size: 64 };
    const result = await arbiter._processAttachments({ attachments: new Map([['one', attachment]]) });
    assert.match(result, /purple marsh/i);
});

test('persistent Discord jobs target owner-controlled computer workspaces', () => {
    const fakeHome = path.join(os.tmpdir(), 'owner-home');
    const appPath = taskOutputHint({ kind: 'app_build', domain: 'software' }, 0, fakeHome);
    const paperPath = taskOutputHint({ kind: 'artifact_synthesis', domain: 'medical_research' }, 0, fakeHome);
    assert.equal(appPath.startsWith(path.join(fakeHome, 'Desktop', 'Soma Projects')), true);
    assert.equal(paperPath.startsWith(path.join(fakeHome, 'Documents', 'Soma', 'Artifacts')), true);
});

test('owner background task creates a persistent verified goal instead of a conversational reply', async () => {
    const created = [];
    const arbiter = new DiscordArbiter({
        masterId: 'owner-1',
        goalPlanner: { async createGoal(goal, source) { created.push({ goal, source }); return { success: true, goalId: 'discord-job-1' }; } },
    });
    arbiter._recordDiscordInteraction = async () => {};
    const replies = [];
    const msg = { author: { id: 'owner-1', username: 'owner' }, channelId: 'dm-1', guild: null, content: 'Build me an app so I can use it when I get home', async reply(text) { replies.push(text); } };
    const result = await arbiter._handleDiscordCommand(msg, msg.content);
    assert.equal(result.handled, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].goal.metadata.taskKind, 'app_build');
    assert.equal(created[0].goal.verification.required, true);
    assert.match(replies[0], /real background job/i);
    assert.match(replies[0], /discord-job-1/);
});

test('own-work status questions use live ledgers and do not mint goals', async () => {
    let created = 0;
    const arbiter = new DiscordArbiter({
        masterId: 'owner-1',
        goalPlanner: { goals: new Map(), async createGoal() { created++; return { success: true, goalId: 'wrong' }; } },
    });
    arbiter._recordDiscordInteraction = async () => {};
    arbiter._buildOwnWorkReply = async () => 'No recent verified completion receipts.';
    const replies = [];
    const msg = { author: { id: 'owner-1', username: 'owner' }, channelId: 'dm-1', guild: null, content: 'Hows your medical research going', async reply(text) { replies.push(text); } };
    const result = await arbiter._handleDiscordCommand(msg, msg.content);
    assert.equal(result.handled, true);
    assert.equal(created, 0);
    assert.match(replies[0], /verified completion receipts/i);
});

test('blocked-goal questions report the recorded reason rather than blaming a provider', async () => {
    const goal = {
        id: 'goal-1', title: 'Discord medical research status', status: 'blocked', updatedAt: Date.now(),
        metadata: { lastTransition: { reason: 'execution_attempt_budget_exhausted' } }
    };
    const arbiter = new DiscordArbiter({ goalPlanner: { goals: new Map([[goal.id, goal]]) } });
    const reply = await arbiter._buildOwnWorkReply('Your goals keep blocking do you know why?');
    assert.match(reply, /execution_attempt_budget_exhausted/);
    assert.match(reply, /does not prove a DeepSeek, network, or memory-corruption cause/i);
});

test('non-owner cannot start computer searches or persistent jobs', async () => {
    let executed = false;
    const arbiter = new DiscordArbiter({ masterId: 'owner-1', system: { toolRegistry: { async execute() { executed = true; } } } });
    arbiter._recordDiscordInteraction = async () => {};
    const replies = [];
    const msg = { author: { id: 'other', username: 'owner' }, channelId: 'dm-1', guild: null, content: 'search this computer for MAX', async reply(text) { replies.push(text); } };
    const result = await arbiter._handleDiscordCommand(msg, msg.content);
    assert.equal(result.handled, true);
    assert.equal(executed, false);
    assert.match(replies[0], /Access denied/i);
});

test('backtest requests route directly to trading diagnostic goals', () => {
    const backtest1 = classifyPersistentTask('run a backtest on btc and eth trend following');
    assert.equal(backtest1?.kind, 'trading_diagnostic');
    assert.equal(backtest1?.domain, 'paper_trading');

    const backtest2 = classifyPersistentTask('backtest the trend following strategy on btc');
    assert.equal(backtest2?.kind, 'trading_diagnostic');

    const backtest3 = classifyPersistentTask('can you simulate the btc strategy?');
    assert.equal(backtest3?.kind, 'trading_diagnostic');
});

test('conversational sentences with stop do not trigger goal cancellation', async () => {
    const arbiter = new DiscordArbiter({ masterId: 'owner-1' });
    let replyCalled = false;
    const msg = {
        author: { id: 'owner-1', username: 'owner' },
        channelId: 'dm-1',
        guild: null,
        content: 'stop asking for permission do it then we can talk',
        async reply() { replyCalled = true; }
    };
    const result = await arbiter._handleDiscordCommand(msg, msg.content);
    // Should NOT be intercepted as a cancel command
    assert.equal(result.handled, false);
    assert.equal(replyCalled, false);
});
