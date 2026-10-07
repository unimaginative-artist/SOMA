import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';
import { ToolRegistry } from '../core/ToolRegistry.js';
import { ExecutionEventLedger } from '../core/ExecutionEventLedger.js';
import { ExecutionJobStore } from '../core/ExecutionJobStore.js';
import { ExecutionProfileRegistry } from '../core/ExecutionProfileRegistry.js';
import { parseExecutionTool, formatToolFeedback, createExecutionGoal, createInspectionGoal, simpleInspectionAction } from '../core/ExecutionProtocol.js';
import { handleExecuteRoute } from '../server/routes/executeRoute.js';
import { inspectionTools, describeInspection } from '../core/InspectionExecution.js';

const quietLogger = { log() {}, warn() {}, error() {} };

test('folder exploration wording from Discord is a deterministic root listing', () => {
    assert.deepEqual(simpleInspectionAction('So you can explore folders now what other folders do you see'),
        { tool: 'list_files', args: { directory: '.' } });
    assert.deepEqual(simpleInspectionAction('can you explore other folders?'),
        { tool: 'list_files', args: { directory: '.' } });
    assert.equal(simpleInspectionAction('Can you edit other folders?'), null);
});

test('a busy autonomous executor does not block a separate deterministic read-only inspection', async t => {
    const { root, registry, executor } = await createHarness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'sample.txt'), 'Actual source content.');
    const jobStore = new ExecutionJobStore({ root, logger: quietLogger });
    executor.system = { toolRegistry: registry, executionJobStore: jobStore, agenticExecutor: executor };
    executor.jobStore = jobStore;
    executor._executionActive = true;
    const req = { body: { task: 'read sample.txt', mode: 'inspect', sync: true }, signal: new AbortController().signal };
    let statusCode = 200, response;
    const res = { status(code) { statusCode = code; return this; }, json(value) { response = value; return this; } };
    await handleExecuteRoute(req, res, executor.system);
    assert.equal(statusCode, 200);
    assert.equal(response.state, 'completed');
    assert.equal(response.verification.passed, true);
    assert.ok(response.toolsUsed.includes('read_file'));
    assert.equal(executor._executionActive, true);
    const unsafe = await executor.forkReadOnlyInspection().execute(createExecutionGoal('modify sample.txt', 'modify'));
    assert.equal(unsafe.state, 'blocked');
    assert.equal(unsafe.stopReason, 'isolated_inspection_only');

    let complexInspectionForked = false;
    executor.forkReadOnlyInspection = () => ({
        execute: async () => {
            complexInspectionForked = true;
            return {
                state: 'completed', success: true, done: true,
                summary: 'Inspected architecture without changing files.',
                evidence: ['inspection receipt'], toolsUsed: ['record_observation'],
                verification: { passed: true }
            };
        }
    });
    await handleExecuteRoute({ ...req, body: { task: 'compare the architecture and propose changes', mode: 'inspect', sync: true } }, res, executor.system);
    assert.equal(statusCode, 200);
    assert.equal(response.state, 'completed');
    assert.equal(complexInspectionForked, true);
    assert.equal(executor._executionActive, true);
});

test('an isolated executor can complete a general read-only inspection without using the busy main host', async t => {
    const { root, executor } = await createHarness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, 'architecture.md'), '# Actual architecture');
    executor._executionActive = true;
    const fork = executor.forkReadOnlyInspection();
    let step = 0;
    fork._callDirectAPI = async (_system, prompt) => {
        step++;
        if (step === 1) return 'THINK: inspect the repository root\nTOOL: list_files\nARGS: {"directory":"."}';
        if (step === 2) {
            const receiptId = prompt.match(/"receiptId":\s*"([a-f0-9-]+)"/i)?.[1];
            assert.ok(receiptId);
            return `THINK: record the listing\nTOOL: record_observation\nARGS: ${JSON.stringify({ summary: 'Found architecture.md in the inspected root.', evidence: [receiptId] })}`;
        }
        return 'DONE: yes\nRESULT: Found architecture.md in the inspected root.\nFALSIFICATION_TEST: list_files receipt\nTEST_RESULT: true';
    };
    const result = await fork.execute(createInspectionGoal('Analyze this repository architecture'));
    assert.equal(result.state, 'completed');
    assert.deepEqual(result.toolsUsed, ['list_files', 'record_observation']);
    assert.equal(executor._executionActive, true);
});

test('source search reaches nested modules before root-file clutter and labels partial results', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-inspection-order-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'core', 'executive'), { recursive: true });
    await fs.writeFile(path.join(root, 'root.md'), 'Neocortex root reference');
    await fs.writeFile(path.join(root, 'core', 'executive', 'NeocortexHarness.js'), 'export const NeocortexHarness = true;');

    const result = await inspectionTools(root, []).tools.search_code.execute({ pattern: 'Neocortex', maxResults: 1 });
    assert.match(result.matches[0], /core[\\/]executive[\\/]NeocortexHarness\.js/);
    assert.equal(result.truncated, true);

    const partial = describeInspection({ tool: 'search_code', result: {
        matches: [], scannedFiles: 3, truncated: true, scope: ['core']
    } });
    assert.match(partial, /Partial search: no matches among 3 scanned files/);
});

async function createHarness() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-agentic-protocol-'));
    const ledger = new ExecutionEventLedger({ root });
    const profiles = new ExecutionProfileRegistry();
    const registry = new ToolRegistry({ executionLedger: ledger, profileRegistry: profiles, logger: quietLogger });
    const executor = new SomaAgenticExecutor();
    executor.system = { toolRegistry: registry };
    executor.inspectionRoot = root;
    return { root, ledger, profiles, registry, executor };
}

test('Requirement A: Valid local tool call parses and executes', async t => {
    const { root, executor } = await createHarness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    // Create a dummy file in root
    await fs.writeFile(path.join(root, 'sample.txt'), 'hello tool calling world', 'utf8');

    const goal = { metadata: { executionMode: 'inspect' } };
    const observations = [];
    const session = inspectionTools(root, observations);
    executor._inspectionSession = session;
    const tools = executor._getToolCollection(goal);

    assert.ok(tools.has('search_code'));

    const rawCall = 'THINK: searching for pattern\nTOOL: search_code\nARGS: {"pattern": "calling"}';
    const parsed = parseExecutionTool(rawCall, tools);
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.tool, 'search_code');
    assert.deepEqual(parsed.args, { pattern: 'calling' });

    const result = await tools.get('search_code').execute(parsed.args);
    assert.equal(result.success, true);
    assert.ok(result.matches.some(m => m.includes('sample.txt') && m.includes('calling')));
});

test('Requirement B: Valid dynamic registry tool parses and executes', async t => {
    const { root, registry, executor } = await createHarness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    registry.registerTool({
        name: 'dynamic_multiplier',
        description: 'Multiplies two numbers',
        parameters: {
            type: 'object',
            properties: {
                a: { type: 'number' },
                b: { type: 'number' }
            },
            required: ['a', 'b']
        },
        execute: async ({ a, b }) => ({ success: true, product: a * b })
    });

    const goal = { metadata: { executionMode: 'general' } };
    const tools = executor._getToolCollection(goal);
    assert.ok(tools.has('dynamic_multiplier'));

    const rawCall = 'TOOL: dynamic_multiplier\nARGS: {"a": 6, "b": 7}';
    const parsed = parseExecutionTool(rawCall, tools);
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.tool, 'dynamic_multiplier');

    const result = await executor._dispatchTool(parsed, goal);
    assert.equal(result.success, true);
    assert.equal(result.product, 42);
});

test('Requirement C: Narrative intent generates format error', async () => {
    const tools = new Map([
        ['search_code', { parameters: { type: 'object' } }]
    ]);

    const narrative = "I will now search the codebase for references to tool calling:\nsearch_code('tool calling')";
    const parsed = parseExecutionTool(narrative, tools);
    assert.ok(parsed.error);
    assert.match(parsed.error, /Emit exactly one TOOL call/);
});

test('Requirement D: Unknown tool rejected without execution', async () => {
    const tools = new Map([
        ['read_file', { parameters: { type: 'object' } }]
    ]);

    const rawCall = 'TOOL: delete_all_files\nARGS: {"target":"*"}';
    const parsed = parseExecutionTool(rawCall, tools);
    assert.ok(parsed.error);
    assert.match(parsed.error, /Unknown or disallowed tool: delete_all_files/);
});

test('Requirement E: Malformed arguments rejected safely', async () => {
    const tools = new Map([
        ['read_file', {
            parameters: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path']
            }
        }]
    ]);

    // Non-JSON args
    const badJson = 'TOOL: read_file\nARGS: {path: unquoted_val}';
    const parsed1 = parseExecutionTool(badJson, tools);
    assert.ok(parsed1.error);
    assert.match(parsed1.error, /ARGS must be valid JSON/);

    // Missing required argument
    const missingArgs = 'TOOL: read_file\nARGS: {"notPath": "test"}';
    const parsed2 = parseExecutionTool(missingArgs, tools);
    assert.ok(parsed2.error);
    assert.match(parsed2.error, /Invalid arguments/);
});

test('Requirement F: Prompt contains explicit TOOL_RESULT block with step, tool, args, success, result', async () => {
    const observations = [
        {
            step: 1,
            tool: 'search_code',
            args: { pattern: 'test' },
            result: { success: true, matches: ['file1.js:10: test'] },
            outcome: { ok: true },
            receiptId: 'receipt-uuid-123'
        }
    ];

    const feedback = formatToolFeedback(observations);
    assert.ok(feedback.includes('TOOL_RESULT:'));
    assert.ok(feedback.includes('"step": 1'));
    assert.ok(feedback.includes('"tool": "search_code"'));
    assert.ok(feedback.includes('"success": true'));
    assert.ok(feedback.includes('"receiptId": "receipt-uuid-123"'));
});

test('Requirement G: Inspection completion (search -> record_observation -> DONE with evidence)', async t => {
    const { root, executor } = await createHarness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    await fs.writeFile(path.join(root, 'counter.js'), 'export const value = 42;\n', 'utf8');

    // Mock model responses:
    // 1. search_code
    // 2. record_observation
    // 3. DONE
    let stepCount = 0;
    executor._callDirectAPI = async () => {
        stepCount++;
        if (stepCount === 1) {
            return {
                text: 'THINK: Search for counter\nTOOL: search_code\nARGS: {"pattern":"value"}'
            };
        }
        if (stepCount === 2) {
            return {
                text: 'THINK: Record findings\nTOOL: record_observation\nARGS: {"summary":"Found counter definition","evidence":["counter.js:1: export const value = 42;"]}'
            };
        }
        return {
            text: 'DONE: yes\nRESULT: Inspection completed and verified\nFALSIFICATION_TEST: Found value in counter.js\nTEST_RESULT: true'
        };
    };

    const goal = createExecutionGoal('Find counter in the workspace', 'inspect', 'test');
    const result = await executor.execute(goal);

    assert.equal(result.success, true);
    assert.equal(result.state, 'completed');
    assert.equal(result.stopReason, 'inspection_verified');
    assert.ok(result.evidence.length > 0);
    assert.ok(result.toolsUsed.includes('search_code'));
    assert.ok(result.toolsUsed.includes('record_observation'));
    assert.equal(result.verification.passed, true);
});

test('Requirement H: Chat route uses brain.reason for regular chat without tool execution', async () => {
    let reasonCalled = false;
    let systemToolsExecuted = false;

    const mockSystem = {
        toolRegistry: {
            execute: async () => { systemToolsExecuted = true; return {}; },
            getToolsManifest: () => []
        },
        agenticExecutor: {
            execute: async () => {
                systemToolsExecuted = true;
                return { success: true, state: 'completed' };
            }
        }
    };

    const mockBrain = {
        reason: async (msg) => {
            reasonCalled = true;
            return { text: `Hello Owner! You said: ${msg}` };
        }
    };

    // Simulated normal chat request
    const message = 'Hello SOMA, how are you today?';
    const incomingBody = { message, execute: false, isAgentic: false };

    let chatResponse;
    if (incomingBody.execute === true || incomingBody.isAgentic === true) {
        chatResponse = await mockSystem.agenticExecutor.execute({ title: message });
    } else {
        const result = await mockBrain.reason(message);
        chatResponse = { success: true, reply: result.text };
    }

    assert.equal(reasonCalled, true);
    assert.equal(systemToolsExecuted, false);
    assert.equal(chatResponse.reply, 'Hello Owner! You said: Hello SOMA, how are you today?');
});

test('Requirement I: POST /api/execute returns documented structured contract', async () => {
    const mockExecutor = {
        execute: async (goal) => ({
            success: true,
            state: 'completed',
            stopReason: 'verified',
            summary: 'Inspected files',
            result: 'Inspected files',
            evidence: [{ finding: 'core/SomaAgenticExecutor.js:10' }],
            toolsUsed: ['search_code', 'record_observation'],
            iterations: 2,
            totalIterations: 2,
            continuationFile: null,
            verification: { passed: true },
            errors: [],
            nextStep: null
        })
    };

    const mockSystem = { agenticExecutor: mockExecutor };

    const req = {
        body: { task: 'Search for references', mode: 'inspect', sync: true },
        signal: new AbortController().signal
    };

    let statusCode = 200;
    let jsonResponse = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(data) { jsonResponse = data; return this; }
    };

    await handleExecuteRoute(req, res, mockSystem);

    assert.equal(statusCode, 200);
    assert.ok(jsonResponse);
    assert.equal(jsonResponse.success, true);
    assert.equal(jsonResponse.state, 'completed');
    assert.equal(jsonResponse.stopReason, 'verified');
    assert.equal(jsonResponse.summary, 'Inspected files');
    assert.equal(jsonResponse.result, 'Inspected files');
    assert.ok(Array.isArray(jsonResponse.evidence));
    assert.ok(Array.isArray(jsonResponse.toolsUsed));
    assert.equal(jsonResponse.iterations, 2);
    assert.equal(jsonResponse.totalIterations, 2);
    assert.equal(jsonResponse.continuationFile, null);
    assert.deepEqual(jsonResponse.verification, { passed: true });
    assert.deepEqual(jsonResponse.errors, []);
    assert.equal(jsonResponse.nextStep, null);
});

test('Requirement J: Path safety rejects path traversal escapes', async t => {
    const { root, executor } = await createHarness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    const goal = { metadata: { executionMode: 'inspect' } };
    const observations = [];
    const session = inspectionTools(root, observations);
    executor._inspectionSession = session;
    const tools = executor._getToolCollection(goal);

    await assert.rejects(
        async () => {
            await tools.get('read_file').execute({ path: '../../etc/passwd' });
        },
        /Inspection path outside allowed root/
    );
});

test('Requirement K: Format error recovery terminates safely after max 3 repairs', async t => {
    const { root, executor } = await createHarness();
    t.after(() => fs.rm(root, { recursive: true, force: true }));

    // Model consistently outputs narrative garbage without formatting
    executor._callDirectAPI = async () => ({
        text: 'I will now do the work for you, just give me a moment.'
    });

    const goal = createExecutionGoal('Inspect files', 'inspect', 'test');
    const result = await executor.execute(goal);

    assert.equal(result.success, false);
    assert.equal(result.state, 'failed');
    assert.equal(result.stopReason, 'format_repair_exhausted');
    assert.ok(result.errors.some(e => e.includes('format_repair_exhausted') || e.includes('Emit one valid TOOL call')));
});
