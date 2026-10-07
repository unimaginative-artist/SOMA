import test from 'node:test';
import assert from 'node:assert/strict';
import { ReceiptDistiller } from '../core/ReceiptDistiller.js';
import { runIdleEvolutionCycle } from '../scripts/idle_evolution_daemon.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

test('ReceiptDistiller: formatTurnToChatML generates valid structured ChatML messages', () => {
    const distiller = new ReceiptDistiller();
    const chatml = distiller.formatTurnToChatML({
        systemPrompt: 'You are SOMA.',
        userPrompt: 'Actually can you open max folder and tell me the contents',
        thought: 'Inspecting MAX workspace using list_files tool.',
        toolCalls: [{ name: 'list_files', args: { dir: '../MAX' } }],
        toolOutputs: [['Agent0', 'blueprints', 'core']],
        assistantReply: 'The MAX repository contains Agent0, blueprints, and core directories.'
    });

    assert.ok(chatml);
    assert.equal(chatml.messages.length, 5);
    assert.equal(chatml.messages[0].role, 'system');
    assert.equal(chatml.messages[1].role, 'user');
    assert.equal(chatml.messages[2].role, 'assistant');
    assert.ok(chatml.messages[2].content.includes('<thought>'));
    assert.ok(chatml.messages[2].content.includes('<tool_call>'));
    assert.equal(chatml.messages[3].role, 'tool');
    assert.equal(chatml.messages[4].role, 'assistant');
    assert.ok(chatml.messages[4].content.includes('The MAX repository contains'));
});

test('ReceiptDistiller: filters out failed runs and harvests verified successful pairs', async () => {
    const tempFile = path.join(process.cwd(), 'data', 'distillation', `test_distill_${Date.now()}.jsonl`);
    const distiller = new ReceiptDistiller({ outputFile: tempFile });

    const mixedReceipts = [
        { success: false, prompt: 'Do something', error: 'Command failed' },
        { success: true, prompt: 'Valid turn', summary: 'Grounded success summary', toolCalls: [] },
        { status: 'failed', prompt: 'Another fail', summary: 'bad' }
    ];

    const result = await distiller.distillReceipts(mixedReceipts);
    assert.equal(result.harvestedCount, 1);

    const content = await fs.readFile(tempFile, 'utf8');
    assert.ok(content.includes('Valid turn'));
    assert.ok(!content.includes('Command failed'));

    // Cleanup
    await fs.unlink(tempFile).catch(() => {});
});

test('idle_evolution_daemon: runs forced evolution cycle cleanly', async () => {
    const cycle = await runIdleEvolutionCycle({ force: true });
    assert.equal(cycle.triggered, true);
    assert.ok(cycle.datasetFile);
});
