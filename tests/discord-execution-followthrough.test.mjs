import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';
import { extractDiscordPaths, resolveDiscordWorkspaceFile, preflightDiscordEngineering } from '../server/discord/DiscordWorkspaceFiles.js';
import { isDiscordSourceInspection } from '../server/discord/DiscordTurnPolicy.js';
import { inspectDiscordSource } from '../server/discord/DiscordSourceInspection.js';
import { evaluateDiscordReply } from '../server/discord/DiscordReplyQuality.js';
import { sourceReadReceipt } from '../core/ConversationEvidence.js';

function harness() {
    const replies = [], goals = [], tools = [], records = [];
    const arbiter = new DiscordArbiter({ masterId: 'owner', goalPlanner: { createGoal: async goal => { goals.push(goal); return { success: true, goalId: 'fixture-goal' }; } } });
    arbiter._recordDiscordInteraction = async record => records.push(record);
    arbiter._executeRegistryTool = async (tool, args) => { tools.push({ tool, args }); return fs.readFile(path.resolve(args.path), 'utf8'); };
    const msg = { author: { id: 'owner' }, channelId: 'test', reply: async reply => replies.push(reply) };
    return { arbiter, msg, replies, goals, tools, records };
}

const inspectionJobStore = { createJob: record => record, updateJob: (_id, update) => update };

test('Discord simple inspection uses an isolated read-only host while the main executor is busy', async () => {
    const { arbiter, msg } = harness();
    let forked = false;
    arbiter.system = { executionJobStore: inspectionJobStore, agenticExecutor: {
        _executionActive: true,
        execute: async () => { throw new Error('Busy main executor must not be called'); },
        forkReadOnlyInspection() {
            forked = true;
            return { execute: async goal => ({ state: 'completed', verification: { passed: true },
                summary: `Listed ${goal.description}`, toolsUsed: ['list_files', 'record_observation'], iterations: 2 }) };
        }
    } };
    const result = await arbiter._runVerifiedDiscordTask('can you explore other folders?', {}, msg);
    assert.equal(forked, true);
    assert.equal(result.success, true);
    assert.deepEqual(result.toolsUsed, ['list_files', 'record_observation']);
});

test('Discord MAX architecture analysis uses an isolated MAX-root inspection while engineering is busy', async () => {
    const { arbiter, msg } = harness();
    let observedRoot;
    arbiter.system = { executionJobStore: inspectionJobStore, maxBridge: { maxPath: 'C:/fixture/MAX' }, agenticExecutor: {
        _executionActive: true,
        execute: async () => { throw new Error('Busy main executor must not be called'); },
        forkReadOnlyInspection() {
            return { execute: async function(goal) {
                observedRoot = this.inspectionRoot;
                return { state: 'completed', verification: { passed: true },
                    summary: `Inspected ${goal.description}`, toolsUsed: ['list_files', 'record_observation'] };
            } };
        }
    } };
    const result = await arbiter._runVerifiedDiscordTask('Can you analyze maxs architecture and look for weaknesses',
        { lane: 'direct_inspection' }, msg);
    assert.equal(result.success, true);
    assert.equal(observedRoot, 'C:/fixture/MAX');
});

test('Discord account of fixing file search remains conversation, not a command', async () => {
    const { arbiter, msg, replies, tools } = harness();
    const handled = await arbiter._handleDiscordCommand(msg,
        'No i spent all day trying to fix your ability to search files on that computer');
    assert.equal(handled.handled, false);
    assert.deepEqual(replies, []);
    assert.deepEqual(tools, []);
});

for (const input of ['Well whats in your dream_journal.html', 'No just seeing whats im claude.md?', 'What is inside CLAUDE.md?', 'Read docs/architecture.md']) {
    test(`document inspection recognizes transcript: ${input}`, () => assert.equal(isDiscordSourceInspection(input), true));
}
test('file mutations still route to engineering, not read-only interception', () => {
    for (const input of ['Update DiscordArbiter.js', 'Create new-report.md', 'Write a new file named new-probe.js']) assert.equal(isDiscordSourceInspection(input), false);
});
test('path extraction preserves relative paths without swallowing prose', () => {
    assert.deepEqual(extractDiscordPaths('Please update server/finance/AutonomousTrader.js and `docs/My Notes.md`.'), ['docs/My Notes.md', 'server/finance/AutonomousTrader.js']);
    assert.deepEqual(extractDiscordPaths('Update `one.js` and two.js'), ['one.js', 'two.js']);
});

test('verified document read returns real Markdown and HTML, including case-insensitive root names', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-document-read-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    for (const [filename, content] of [['CLAUDE.md', '# SOMA Project Reference\nActual startup documentation.'], ['DREAM_JOURNAL.html', '<title>SOMA Intelligence Journal</title>\n<section>Recorded dream entry</section>']]) {
        await fs.writeFile(path.join(root, filename), content);
        const result = await inspectDiscordSource({ root, filename: filename.toLowerCase(), execute: async (tool, args) => { assert.equal(tool, 'read_file'); return fs.readFile(path.join(root, args.path), 'utf8'); } });
        assert.match(result.excerpts, filename.endsWith('.md') ? /Actual startup/ : /Recorded dream entry/);
        assert.match(result.reply, /not the full file/);
        assert.match(result.reply, /not permission to execute/);
    }
});
test('full command handler reads the named document and follow-up from disk without a goal or LLM', async t => {
    const filename = `document-fixture-${crypto.randomUUID()}.md`;
    await fs.writeFile(filename, '# First actual document\n');
    t.after(() => fs.rm(filename, { force: true }));
    const { arbiter, msg, replies, goals, tools } = harness();
    assert.equal((await arbiter._handleDiscordCommand(msg, `Whats in ${filename}?`)).handled, true);
    assert.match(replies[0], /First actual document/);
    await fs.writeFile(filename, '# Changed on disk\n');
    assert.equal((await arbiter._handleDiscordCommand(msg, 'What did you find?')).handled, true);
    assert.match(replies[1], /Changed on disk/);
    assert.equal(goals.length, 0);
    assert.deepEqual(tools.map(call => call.tool), ['read_file', 'read_file']);
});
test('canonical paths reject traversal, junction escapes and ambiguous basenames', async t => {
    const area = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-path-preflight-'));
    t.after(() => fs.rm(area, { recursive: true, force: true }));
    const root = path.join(area, 'repo'), outside = path.join(area, 'outside');
    await fs.mkdir(path.join(root, 'core'), { recursive: true });
    await fs.mkdir(path.join(root, 'arbiters'));
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'outside.js'), '// external');
    await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const filename of ['../outside/outside.js', path.join(outside, 'outside.js'), 'linked/outside.js', 'linked/new.js']) await assert.rejects(resolveDiscordWorkspaceFile(root, filename), /limited/);
    await fs.writeFile(path.join(root, 'core', 'Duplicate.js'), '// one');
    await fs.writeFile(path.join(root, 'arbiters', 'Duplicate.js'), '// two');
    await assert.rejects(resolveDiscordWorkspaceFile(root, 'Duplicate.js'), /More than one/);
    assert.equal(await resolveDiscordWorkspaceFile(root, 'core/Duplicate.js'), 'core/Duplicate.js');
});
test('preflight permits explicit new files but rejects changes to missing targets, even among multiple files', async () => {
    assert.equal((await preflightDiscordEngineering({ root: process.cwd(), request: 'Create new-explicit-fixture.js' })).ok, true);
    for (const request of ['Update fictional-trading-strategy.js', 'Change fictional-trading-strategy.js', 'Replace fictional-trading-strategy.js', 'Fix fictional-trading-strategy.js', 'Update one-missing.js and two-missing.js']) assert.equal((await preflightDiscordEngineering({ root: process.cwd(), request })).ok, false);
});
test('model-authored engineering tag cannot bypass the shared nonexistent-target gate', async () => {
    const { arbiter, goals } = harness();
    const reply = await arbiter._queueAdminEngineeringGoal('Update fictional-trading-strategy.js to use Prometheus for trading', null, 'test', { authorized: true });
    assert.equal(goals.length, 0);
    assert.match(reply, /haven't queued/);
    assert.doesNotMatch(reply, /actual trading logic lives/);
});
test('persistent engineering and trading intake cannot bypass missing-file preflight', async () => {
    const { arbiter, msg, goals, replies } = harness();
    for (const input of ['Fix fictional-trading-strategy.js for trading', 'Update fictional-trading-strategy.js to use Prometheus for trading']) {
        assert.equal((await arbiter._handleAdminOperationalAction(msg, input)).handled, true);
        assert.match(replies.at(-1), /haven't queued/);
    }
    assert.equal(goals.length, 0);
});
test('existing-file engineering requests still queue with canonical targets and verification requirements', async t => {
    const filename = `existing-fixture-${crypto.randomUUID()}.js`;
    await fs.writeFile(filename, 'export const sample = 1;');
    t.after(() => fs.rm(filename, { force: true }));
    const { arbiter, goals } = harness();
    const reply = await arbiter._queueAdminEngineeringGoal(`Update ${filename} to improve the sample`, null, 'test', { authorized: true });
    assert.equal(goals.length, 1);
    assert.equal(goals[0].metadata.pathCandidate, filename);
    assert.equal(goals[0].verification.required, true);
    assert.match(reply, /queued/);
});
test('underspecified search asks for input without claiming a failed tool execution', async () => {
    const { arbiter, msg, replies, tools, records } = harness();
    await arbiter._handleAdminOperationalAction(msg, 'Search a repo');
    assert.equal(tools.length, 0);
    assert.match(replies[0], /search target/);
    assert.doesNotMatch(replies[0], /tool path failed/);
    assert.equal(records[0].status, 'needs_input');
});
test('Gemini listing fix survives full command routing for both transcript sentences', async () => {
    const { arbiter, msg, replies, tools } = harness();
    for (const input of ['No i dont but you should have full access to your file system you should be able to see your soma-promethus v3 lobe', 'Are you able to execute any of these plans within this file?']) {
        assert.equal(arbiter._isFileListingRequest(input), false);
    }
    assert.equal((await arbiter._handleDiscordCommand(msg, 'No i dont but you should have full access to your file system you should be able to see your soma-promethus v3 lobe')).handled, false);
    // The capability question now receives a state-aware answer, never a file dump.
    assert.equal((await arbiter._handleDiscordCommand(msg, 'Are you able to execute any of these plans within this file?')).handled, true);
    for (const input of ['list your files', 'what files do you have', 'show all files']) assert.equal(arbiter._isFileListingRequest(input), true);
    assert.equal(tools.length, 0);
    assert.equal(replies.length, 1);
    assert.doesNotMatch(replies[0], /Here is a real listing/);
});
test('unsupported document dumps and completion claims are rejected, but suggestions remain conversation', () => {
    for (const reply of ["I've made the changes. Now let's run a basic trading simulation.", 'I have applied the patch.', 'The changes have been applied.', 'I will run this command now.', 'Here are its contents:\n```html\n<p>No actual dreams recorded yet.</p>\n```', 'It looks like the file is currently just a placeholder.']) {
        assert.equal(evaluateDiscordReply({ input: 'What is in dream_journal.html?', reply }).acceptable, false, reply);
    }
    for (const reply of ['I would run a small simulation after checking the implementation.', 'Here is proposed code, not its actual contents:\n```js\nconst demo = true;\n```', "I haven't made any changes. The job is still waiting for an executor receipt."]) assert.equal(evaluateDiscordReply({ input: 'Read dream_journal.html', reply }).acceptable, true, reply);
    const receipt = sourceReadReceipt({ path: 'CLAUDE.md', content: '# Real reference' });
    assert.equal(evaluateDiscordReply({ input: 'Read CLAUDE.md', reply: 'I read `CLAUDE.md`. Here are its contents: # Real reference', receipts: [receipt] }).acceptable, true);
    assert.equal(evaluateDiscordReply({ input: 'Update CLAUDE.md', reply: "I've made the changes.", receipts: [receipt] }).acceptable, false);
    assert.equal(evaluateDiscordReply({ input: 'Read DREAM_JOURNAL.html', reply: 'Here are its contents: an empty journal.', receipts: [receipt] }).acceptable, false);
    assert.equal(evaluateDiscordReply({ input: 'Read CLAUDE.md', reply: 'Here are its contents:\n```markdown\n# Invented reference\n```', receipts: [receipt] }).acceptable, false);
});
test('a trading guarantee question requires a direct denial, not vague reassurance', () => {
    const input = 'Can you guarantee your next paper trade will make money?';
    assert.equal(evaluateDiscordReply({ input, reply: 'Predicting the future with certainty is challenging. Let us focus on better strategies.' }).acceptable, false);
    assert.equal(evaluateDiscordReply({ input, reply: 'No. I cannot guarantee a profitable trade. Paper testing can measure performance, not remove uncertainty.' }).acceptable, true);
});
