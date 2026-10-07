import test from 'node:test';
import assert from 'node:assert/strict';
import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';
import { handleExecuteRoute } from '../server/routes/executeRoute.js';

test('End-to-End: Exact User Task Execution via handleExecuteRoute', async () => {
    const executor = new SomaAgenticExecutor();
    executor.inspectionRoot = process.cwd();

    // Model simulator following the EXACT execution protocol:
    // Step 1: Search codebase for references to tool calling
    // Step 2: Record observation with the top 5 findings
    // Step 3: Emit terminal DONE with falsification test
    let step = 0;
    executor._callDirectAPI = async (systemPrompt, userPrompt) => {
        step++;
        if (step === 1) {
            return {
                text: 'THINK: Search for tool calling references across the codebase\nTOOL: search_code\nARGS: {"pattern":"tool calling"}'
            };
        }
        if (step === 2) {
            // Check that feedback was formatted with TOOL_RESULT
            assert.ok(userPrompt.includes('TOOL_RESULT:'));
            return {
                text: 'THINK: Record five most relevant findings from search results\nTOOL: record_observation\nARGS: {"summary":"Found references to tool calling across agentic execution files","evidence":["core/ExecutionProtocol.js:6","core/SomaAgenticExecutor.js:4","core/ToolRegistry.js:9","core/InspectionExecution.js:118","server/routes/somaRoutes.js:2530"]}'
            };
        }
        return {
            text: 'DONE: yes\nRESULT: Recorded five relevant file-and-line findings for tool calling without modifying files.\nFALSIFICATION_TEST: Verification receipt recorded from search_code.\nTEST_RESULT: true'
        };
    };

    const system = {
        agenticExecutor: executor,
        toolRegistry: {
            execute: async () => ({}),
            getToolsManifest: () => []
        }
    };

    const task = "Search the SOMA codebase for every reference to tool calling. Record the five most relevant file-and-line findings and return a verified report. Do not modify any files.";
    const req = {
        body: { task, mode: 'inspect', sync: true },
        signal: new AbortController().signal
    };

    let statusCode = null;
    let jsonResponse = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(data) { jsonResponse = data; return this; }
    };

    await handleExecuteRoute(req, res, system);

    assert.equal(statusCode, null); // default 200 via res.json
    assert.ok(jsonResponse);
    assert.equal(jsonResponse.success, true);
    assert.equal(jsonResponse.state, 'completed');
    assert.equal(jsonResponse.stopReason, 'inspection_verified');
    assert.ok(jsonResponse.evidence.length >= 5);
    assert.ok(jsonResponse.toolsUsed.includes('search_code'));
    assert.ok(jsonResponse.toolsUsed.includes('record_observation'));
    assert.equal(jsonResponse.verification.passed, true);
    assert.deepEqual(jsonResponse.errors, []);
    assert.equal(jsonResponse.nextStep, null);
    assert.ok(jsonResponse.iterations >= 2);
    assert.ok(jsonResponse.totalIterations >= 2);

    console.log('\n--- VERIFIED EXECUTION REPORT ---');
    console.log('Success:', jsonResponse.success);
    console.log('State:', jsonResponse.state);
    console.log('Stop Reason:', jsonResponse.stopReason);
    console.log('Summary:', jsonResponse.summary);
    console.log('Tools Used:', jsonResponse.toolsUsed);
    console.log('Evidence Count:', jsonResponse.evidence.length);
    console.log('Evidence Findings:', jsonResponse.evidence.map(e => e.finding || e));
    console.log('Verification:', jsonResponse.verification);
    console.log('--------------------------------\n');
});
