import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { LiveConversationalAgent } from '../core/LiveConversationalAgent.js';

describe('LiveConversationalAgent', () => {
  test('Parses ReAct tool call formats correctly', () => {
    const agent = new LiveConversationalAgent();
    
    const toolResp = `THINK: I need to check the route definition.
TOOL: read_file
ARGS: {"path": "server/routes/executeRoute.js", "startLine": 1, "endLine": 20}`;
    
    const parsedTool = agent._parseResponse(toolResp);
    assert.equal(parsedTool.isDone, false);
    assert.equal(parsedTool.tool, 'read_file');
    assert.equal(parsedTool.args.path, 'server/routes/executeRoute.js');
    assert.equal(parsedTool.thought, 'I need to check the route definition.');

    const doneResp = `DONE: yes
RESULT: Analyzed executeRoute.js and confirmed error handling is robust. All tests pass.`;
    const parsedDone = agent._parseResponse(doneResp);
    assert.equal(parsedDone.isDone, true);
    assert.ok(parsedDone.result.includes('Analyzed executeRoute.js'));
  });

  test('Executes safe read_file and list_files tools', async () => {
    const agent = new LiveConversationalAgent();
    
    const listRes = await agent._executeTool('list_files', { directory: 'core' });
    assert.equal(listRes.success, true);
    assert.ok(listRes.output.includes('ToolRegistry.js'));

    const readRes = await agent._executeTool('read_file', { path: 'package.json', startLine: 1, endLine: 5 });
    assert.equal(readRes.success, true);
    assert.ok(readRes.output.includes('{'));
  });

  test('Resolves and inspects MAX peer workspace without escaping The Stack', async () => {
    const agent = new LiveConversationalAgent();
    
    // Directory listing for MAX
    const maxListing = await agent._executeTool('list_files', { directory: 'max' });
    assert.equal(maxListing.success, true);
    assert.ok(maxListing.output.includes('Agent0') || maxListing.output.includes('core'));

    // Read MAX package.json
    const maxPkg = await agent._executeTool('read_file', { path: 'max/package.json', startLine: 1, endLine: 5 });
    assert.equal(maxPkg.success, true);
    assert.ok(maxPkg.output.includes('max-agent'));
  });

  test('Executes multi-step turn with progress events using mock Ollama', async () => {
    const progressEvents = [];
    const agent = new LiveConversationalAgent();

    // Mock _callOllama to simulate a 2-step execution: read file -> done
    let callCount = 0;
    agent._callOllama = async () => {
      callCount++;
      if (callCount === 1) {
        return `THINK: Inspecting package.json to check version.
TOOL: read_file
ARGS: {"path": "package.json", "startLine": 1, "endLine": 10}`;
      }
      return `DONE: yes
RESULT: Verified package.json contains valid configuration.`;
    };

    const result = await agent.runTurn('Inspect package.json and verify version', {
      jobId: 'test-turn-123',
      onProgress: (evt) => progressEvents.push(evt)
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.ok(result.summary.includes('Verified package.json'));
    assert.equal(result.toolsUsed.length, 1);
    assert.equal(result.toolsUsed[0], 'read_file');
    assert.ok(progressEvents.length >= 3);
    assert.equal(progressEvents[0].phase, 'planning');
    assert.equal(progressEvents[1].phase, 'executing');
    assert.equal(progressEvents[progressEvents.length - 1].phase, 'completed');
  });

  test('Transactional rollback on syntax error in edit_file', async () => {
    const tempDir = path.resolve('tests/temp-live-agent');
    await fs.mkdir(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, 'sample.js');
    await fs.writeFile(tempFile, 'const x = 10;\nexport default x;\n', 'utf8');

    const agent = new LiveConversationalAgent();
    
    // Attempt invalid edit with syntax error (unclosed brace)
    const badEdit = await agent._executeTool('edit_file', {
      path: tempFile,
      targetContent: 'const x = 10;',
      replacementContent: 'const x = { broken syntax'
    });

    assert.equal(badEdit.success, false);
    assert.ok(badEdit.output.includes('Edit failed') || badEdit.output.includes('syntax'));

    // Verify file was restored
    const restored = await fs.readFile(tempFile, 'utf8');
    assert.equal(restored, 'const x = 10;\nexport default x;\n');

    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
