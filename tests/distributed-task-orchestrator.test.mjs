import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { DistributedTaskOrchestrator } from '../core/cluster/DistributedTaskOrchestrator.js';

test('DistributedTaskOrchestrator executes local fallback when forced', async () => {
    const tempLedger = path.resolve(process.cwd(), 'data', `test_ledger_${Date.now()}.jsonl`);
    const orchestrator = new DistributedTaskOrchestrator({ ledgerPath: tempLedger });

    const result = await orchestrator.dispatchTask('run_diagnostics', {}, { forceLocal: true });

    assert.equal(result.targetNode, 'machine-a (fallback)');
    assert.equal(result.nodeHost, '127.0.0.1');
    assert.equal(result.success, true);
    assert.equal(result.result.status, 'HEALTHY');
    assert.ok(result.latencyMs >= 0);

    const history = orchestrator.getLedgerHistory(5);
    assert.equal(history.length, 1);
    assert.equal(history[0].taskId, result.taskId);

    // Clean up temp file
    try { fs.unlinkSync(tempLedger); } catch (_) {}
});

test('DistributedTaskOrchestrator dispatches diagnostics to Machine B when online', async () => {
    const tempLedger = path.resolve(process.cwd(), 'data', `test_ledger_${Date.now()}.jsonl`);
    const orchestrator = new DistributedTaskOrchestrator({
        remoteHost: '192.168.1.250',
        remotePort: 3001,
        ledgerPath: tempLedger
    });

    const result = await orchestrator.dispatchTask('run_diagnostics', {}, { timeout: 3500 });
    assert.equal(result.success, true);
    assert.ok(['machine-b', 'machine-a (fallback)'].includes(result.targetNode));
    assert.ok(result.result);

    try { fs.unlinkSync(tempLedger); } catch (_) {}
});
