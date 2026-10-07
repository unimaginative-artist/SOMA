import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';
import { ToolRegistry } from '../core/ToolRegistry.js';
import { ExecutionEventLedger } from '../core/ExecutionEventLedger.js';
import { ExecutionJobStore } from '../core/ExecutionJobStore.js';
import { inspectionTools } from '../core/InspectionExecution.js';
import { createInspectionGoal, executionResult, simpleInspectionAction } from '../core/ExecutionProtocol.js';
import { globalProcedureStore } from '../core/ProcedureLearningStore.js';
import { CognitiveRuntime } from '../core/CognitiveRuntime.js';
import { CognitiveMoERouter } from '../core/CognitiveMoERouter.js';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';
import { extractDiscordPaths } from '../server/discord/DiscordWorkspaceFiles.js';
import { handleExecuteRoute, handleGetJobRoute, authorizeExecution } from '../server/routes/executeRoute.js';

async function harness(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-execution-boundary-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    t.mock.method(globalProcedureStore, 'recordProcedure', () => ({}));
    const executor = new SomaAgenticExecutor({ maxIterations: 8 });
    const registry = new ToolRegistry({ executionLedger: new ExecutionEventLedger({ root }) });
    executor.system = { toolRegistry: registry };
    executor.inspectionRoot = root;
    const store = new ExecutionJobStore({ root });
    return { root, executor, registry, store };
}

test('canonical parser cannot fall back to executing malformed or multiple calls', async t => {
    const { executor, root } = await harness(t);
    const goal = createInspectionGoal('Inspect the module');
    executor._inspectionSession = inspectionTools(root, []);
    for (const args of ['null', '[]', '{path: doEvil()}', '{"path":"x"}; doEvil()', '{"__proto__":{}}']) {
        assert.equal(executor._parseToolCall(`TOOL: read_file\nARGS: ${args}`, goal), null);
        assert.ok(executor._lastToolParseError);
    }
    assert.equal(executor._parseToolCall('TOOL: list_files\nARGS: {}\nTOOL: list_files\nARGS: {}', goal), null);
    assert.deepEqual(executor._parseToolCall('THINK: Read source\nTOOL: read_file\nARGS: {"path":"a.js",}', goal), { tool: 'read_file', args: { path: 'a.js' } });
});

test('invented observations cannot become verified receipts', async t => {
    const { root } = await harness(t);
    const observations = [{ receiptId: 'real-read', tool: 'search_code', outcome: { ok: true }, args: { pattern: 'x' }, result: { matches: ['actual.js:1: x'] } }];
    const { tools } = inspectionTools(root, observations);
    await assert.rejects(tools.record_observation.execute({ summary: 'Invented', evidence: ['Neocortex is deployed and all tests passed'] }), /successful receipt ID/);
    const receipt = await tools.record_observation.execute({ summary: 'One hit', evidence: ['actual.js:1: x'] });
    assert.equal(receipt.evidence[0].receiptId, 'real-read');
    observations[0].outcome.ok = false;
    await assert.rejects(tools.record_observation.execute({ summary: 'No', evidence: ['real-read'] }), /successful tool observation/);
});

test('full dynamic-tool loop gets TOOL_RESULT feedback and registry guards', async t => {
    const { executor, registry } = await harness(t);
    let calls = 0, prompts = [];
    registry.registerTool({ name: 'read_counter', readOnly: true, description: 'Reads the counter', parameters: { type: 'object', additionalProperties: false }, execute: async () => { calls++; return { success: true, value: 7 }; } });
    executor._callDirectAPI = async (_system, prompt) => {
        prompts.push(prompt);
        if (prompts.length === 1) return { text: 'TOOL: read_counter\nARGS: {}' };
        if (prompts.length === 2) {
            const id = prompt.match(/"receiptId":\s*"([^"]+)"/)[1];
            return { text: `TOOL: record_observation\nARGS: ${JSON.stringify({ summary: 'Counter value is 7.', evidence: [id] })}` };
        }
        return { text: 'DONE: yes\nRESULT: Counter is 7\nFALSIFICATION_TEST: receipt\nTEST_RESULT: true' };
    };
    const result = await executor.execute(createInspectionGoal('Inspect the counter value'));
    assert.equal(result.state, 'completed'); assert.equal(calls, 1);
    assert.match(prompts[1], /TOOL_RESULT:/);
    assert.deepEqual(result.toolsUsed, ['read_counter', 'record_observation']);
    assert.equal(result.evidence[0].result.value, 7);
});

test('inspect mode denies writes and cannot satisfy an engineering verification contract', async t => {
    const { executor, root } = await harness(t);
    executor._tools = { write_file: { execute: () => { throw new Error('must not run'); } } };
    executor._inspectionSession = inspectionTools(root, []);
    const goal = createInspectionGoal('Inspect x');
    await assert.rejects(executor._dispatchTool({ tool: 'write_file', args: {} }, goal), /disallowed/);
    const evidence = await executor._verifyCompletionEvidence({ id: 'engineering-test', title: 'Change source', successCriteria: ['Source-code change verified with tests'] }, 'changed', 'test', [
        { tool: 'record_observation', result: { success: true, type: 'inspection', summary: 'changed', evidence: ['fake'] } }
    ]);
    assert.equal(evidence.passed, false);
    assert.equal(executionResult({ done: true, state: 'completed', result: 'I did it!' }).success, false);
});

test('execution endpoint validates requests, requires auth, and returns a real read receipt over HTTP', async t => {
    const { executor, root, store } = await harness(t);
    await fs.writeFile(path.join(root, 'sample.md'), '# Real contents\n');
    const previous = process.env.SOMA_OPERATOR_TOKEN;
    process.env.SOMA_OPERATOR_TOKEN = 'fixture-only-execution-token';
    t.after(() => { if (previous === undefined) delete process.env.SOMA_OPERATOR_TOKEN; else process.env.SOMA_OPERATOR_TOKEN = previous; });
    const app = express(); app.use(express.json());
    const system = { agenticExecutor: executor, executionJobStore: store };
    app.post('/api/execute', authorizeExecution, (req, res) => handleExecuteRoute(req, res, system));
    app.get('/api/execute/:jobId', authorizeExecution, (req, res) => handleGetJobRoute(req, res, system));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/execute`;
    const post = (body, authenticated = true) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'X-Operator-Token': process.env.SOMA_OPERATOR_TOKEN } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post({ task: 'read sample.md' }, false)).status, 401);
    assert.equal((await post({ task: '  ' })).status, 400);
    assert.equal((await post({ task: 'write sample.md', mode: 'modify' })).status, 400);
    const response = await post({ task: 'read sample.md', sync: true, goalId: 'caller-must-not-overwrite' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.state, 'completed'); assert.equal(body.success, true);
    assert.notEqual(body.jobId, 'caller-must-not-overwrite');
    assert.match(body.summary, /Real contents/);
    assert.equal(body.evidence[0].result.path, 'sample.md');
    assert.equal(body.verification.passed, true);
    assert.deepEqual(body.toolsUsed, ['read_file', 'record_observation']);
    assert.equal((await fetch(`${url}/${body.jobId}`)).status, 401);
    assert.equal(JSON.stringify(body).includes('THINK:'), false);
    const accepted = await post({ task: 'read sample.md', async: true, sync: false });
    assert.equal(accepted.status, 202);
    const queued = await accepted.json();
    assert.equal(queued.accepted, true); assert.equal(queued.success, false);
    let polled;
    for (let attempt = 0; attempt < 25; attempt++) {
        polled = await (await fetch(`${url}/${queued.jobId}`, { headers: { 'X-Operator-Token': process.env.SOMA_OPERATOR_TOKEN } })).json();
        if (polled.state === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(polled.state, 'completed'); assert.equal(polled.verification.passed, true);
    assert.match(polled.result, /Real contents/);
    system.agenticExecutor = null;
    assert.equal((await post({ task: 'read sample.md' })).status, 503);
});

test('Discord command actually executes named-file reads; code reviews and tool inventory do not execute', async t => {
    const { executor, root } = await harness(t);
    await fs.writeFile(path.join(root, 'Neocortex.js'), 'export const memory = true;');
    const arbiter = new DiscordArbiter({ masterId: 'owner' });
    arbiter.system = { agenticExecutor: executor };
    arbiter._recordDiscordInteraction = async () => {};
    const replies = [];
    const msg = { id: 'test-turn', author: { id: 'owner' }, channelId: 'test', reply: async text => { replies.push(text); return { edit: async updated => replies.push(updated) }; } };
    const result = await arbiter._handleDiscordCommand(msg, 'read Neocortex.js');
    assert.equal(result.result.state, 'completed');
    assert.match(replies.at(-1), /export const memory = true/);
    const code = "How's this look? router.post('/api/execute', async (req,res) => { return res.json({success:true}); });";
    assert.deepEqual(extractDiscordPaths(code), []);
    assert.equal((await arbiter._handleDiscordCommand(msg, code)).handled, false);
    assert.equal((await arbiter._handleDiscordCommand(msg, 'What tools do you already have?')).handled, true);
});

test('real cognitive conversation path calls brain.reason, never the new live agent', async t => {
    const { root } = await harness(t);
    let brains = 0, actions = 0;
    const runtime = new CognitiveRuntime({ ledgerPath: path.join(root, 'conversation.jsonl') }).initialize({
        quadBrain: { reason: async () => { brains++; return { text: 'Still here, Owner.' }; } },
        liveAgent: { runTurn: async () => { actions++; throw new Error('Unexpected action'); } },
        agenticExecutor: { execute: async () => { actions++; throw new Error('Unexpected action'); } }
    });
    await runtime.run({ message: 'How are you today?' });
    await runtime.run({ message: "How's this look? const task = req.body; res.json(task);" });
    assert.equal(brains, 2); assert.equal(actions, 0);
    const router = new CognitiveMoERouter({ system1Bridge: { classifyTurn: async () => ({ actVsEscalate: 'act_immediately', lane: 'specialist' }) } });
    assert.equal((await router.route('I already fixed that code')).lane, 'conversation');
    assert.equal(simpleInspectionAction('I think you should read files someday'), null);
});
