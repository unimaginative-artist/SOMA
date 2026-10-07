import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { CognitiveMoERouter, MOE_LANES } from '../core/CognitiveMoERouter.js';
import { LiveConversationalAgent } from '../core/LiveConversationalAgent.js';
import { globalJobStore } from '../core/ExecutionJobStore.js';

describe('Cognitive MoE & Live Agent: Hardcore Stress & Adversarial Suite', () => {

  test('1. Adversarial Hypothetical Trap: Must NOT execute code on hypothetical inquiries', async () => {
    const router = new CognitiveMoERouter();
    
    // User is discussing hypothetical rewrites, not commanding execution
    const res = await router.route('What would happen if someone tried to rewrite server/routes/executeRoute.js in Rust?');
    assert.equal(res.lane, MOE_LANES.CONVERSATION, 'Hypothetical questions must route to conversation/reflection');
    assert.equal(res.requiresTools, false);
    assert.equal(res.targetLobe, 'AURORA');
  });

  test('2. General Knowledge Code Trap: Must NOT attempt local workspace edits', async () => {
    const router = new CognitiveMoERouter();

    const res = await router.route('How do I write a binary search algorithm in Python?');
    assert.equal(res.lane, MOE_LANES.CONVERSATION, 'General algorithm questions must not trigger local file tools');
    assert.equal(res.requiresTools, false);
  });

  test('3. Compound Greeting + Code Inspection: Correctly parses embedded directive', async () => {
    const router = new CognitiveMoERouter();

    const res = await router.route('Good morning SOMA! Could you inspect core/ExecutionJobStore.js and tell me how queueNotification works?');
    assert.equal(res.lane, MOE_LANES.DIRECT_INSPECTION);
    assert.equal(res.requiresTools, true);
    assert.equal(res.targetLobe, 'LOGOS');
  });

  test('4. Security Shield: Path Traversal attempts are blocked', async () => {
    const agent = new LiveConversationalAgent();

    const res = await agent._executeTool('read_file', {
      path: '../../../../Windows/System32/drivers/etc/hosts'
    });

    assert.equal(res.success, false);
    assert.ok(
      res.output.includes('violates') || res.output.includes('safety') || res.output.includes('outside'),
      `Expected path safety violation error, got: ${res.output}`
    );
  });

  test('5. Security Shield: Dangerous destructive shell commands are blocked', async () => {
    const agent = new LiveConversationalAgent();

    const res = await agent._executeTool('run_command', {
      command: 'format C: /fs:NTFS'
    });

    assert.equal(res.success, false);
    assert.ok(
      res.output.includes('blocked by security policy') || res.output.includes('Tool error'),
      `Expected command policy block, got: ${res.output}`
    );
  });

  test('6. Self-Healing & Transactional Rollback: Agent recovers from syntax error and fixes it', async () => {
    const tempDir = path.resolve('tests/temp-hardcore-agent');
    await fs.mkdir(tempDir, { recursive: true });
    const targetFile = path.join(tempDir, 'broken-module.js');
    await fs.writeFile(targetFile, 'export function calculate() { return 42; }\n', 'utf8');

    const agent = new LiveConversationalAgent();
    let turnStep = 0;

    // Simulate model: Step 1 introduces fatal syntax error -> receives rollback error -> Step 2 self-corrects!
    agent._callOllama = async () => {
      turnStep++;
      if (turnStep === 1) {
        return `THINK: Modifying calculate function but with a syntax error.
TOOL: edit_file
ARGS: {"path": "${targetFile.replace(/\\/g, '/')}", "targetContent": "return 42;", "replacementContent": "return { unclosed syntax"}`;
      } else if (turnStep === 2) {
        return `THINK: The previous edit failed syntax check and was rolled back. Fixing syntax now.
TOOL: edit_file
ARGS: {"path": "${targetFile.replace(/\\/g, '/')}", "targetContent": "return 42;", "replacementContent": "return 100;"}`;
      } else {
        return `DONE: yes
RESULT: Successfully corrected the function to return 100 after recovering from syntax validation.`;
      }
    };

    const result = await agent.runTurn('Update calculate to return 100', {
      jobId: 'hardcore-recovery-test'
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.equal(turnStep, 3);

    // Verify final file on disk has the valid self-corrected code
    const finalContent = await fs.readFile(targetFile, 'utf8');
    assert.equal(finalContent, 'export function calculate() { return 100; }\n');

    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('7. Runaway Loop Prevention: Strictly terminates at step limit without hanging', async () => {
    const agent = new LiveConversationalAgent({ maxSteps: 3 });

    // Mock an infinite loop where the model keeps requesting tools without terminating
    agent._callOllama = async () => {
      return `THINK: Still looking for more clues...
TOOL: list_files
ARGS: {"directory": "core"}`;
    };

    const result = await agent.runTurn('Run endless search', {
      jobId: 'hardcore-runaway-test'
    });

    assert.equal(result.status, 'stopped_at_step_limit');
    assert.equal(result.stepCount, 3);
    assert.equal(result.observations.length, 3);
    assert.ok(result.durationMs > 0);
  });

  test('8. Concurrent Execution & Job Store Isolation', async () => {
    const agent = new LiveConversationalAgent();

    agent._callOllama = async (sys, prompt) => {
      return `DONE: yes
RESULT: Completed task for ${prompt.slice(0, 30)}`;
    };

    // Run 3 concurrent jobs simultaneously
    const jobs = ['conc-1', 'conc-2', 'conc-3'].map((id) =>
      agent.runTurn(`Task for ${id}`, { jobId: id })
    );

    const results = await Promise.all(jobs);

    assert.equal(results.length, 3);
    for (const r of results) {
      assert.equal(r.status, 'completed');
      const stored = globalJobStore.getJob(r.jobId);
      assert.ok(stored, `Job ${r.jobId} must be persisted in ExecutionJobStore`);
      assert.equal(stored.status, 'completed');
    }
  });

});
