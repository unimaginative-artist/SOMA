import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { SpecialistRegistry, registerCoreSpecialists } from '../core/SpecialistRegistry.js';
import { AgencyMetrics } from '../core/AgencyMetrics.js';

test('core specialists implement the complete lifecycle and trading remains analysis-only', async () => {
    const registry = registerCoreSpecialists(new SpecialistRegistry(), {});
    assert.deepEqual(registry.describe().map(item => item.domain).sort(), ['embodiment', 'trading']);
    const run = await registry.run('trading', { message: 'analyze BTC' }, {
        infer: async () => ({ text: 'analysis' }),
        actionAuthorized: true
    });
    assert.equal(run.kind, 'inference');
    assert.equal(run.receipt.authority.requestsAction, false);
    assert.equal(run.verified, false);
});

test('embodiment specialist rejects typed action without trusted authority', async () => {
    let executions = 0;
    const system = { embodimentRuntime: { getStatus: () => ({ armed: false }), execute: async () => { executions++; return { success: true }; } } };
    const registry = registerCoreSpecialists(new SpecialistRegistry(), system);
    const run = await registry.run('embodiment', { embodimentAction: { type: 'move' } }, {
        infer: async () => ({ text: 'unused' }),
        actionAuthorized: false
    });
    assert.equal(executions, 0);
    assert.equal(run.receipt.stages.execution.denied, true);
});

test('agency metrics count receipts rather than language claims', async () => {
    const metrics = new AgencyMetrics({ ledgerPath: `${process.cwd()}/SOMA/test-agency-metrics-${process.pid}.jsonl` });
    metrics.record = AgencyMetrics.prototype.record.bind(metrics);
    await metrics.record({ id: 'one', finishedAt: Date.now(), durationMs: 2, classification: { lane: 'agentic', domain: 'general' }, observed: { success: true, verified: true, toolsUsed: ['test'], evidence: { passed: true }, observationCount: 1 } });
    const summary = metrics.summarize();
    assert.equal(summary.transactions, 1);
    assert.equal(summary.verifiedRate, 1);
    assert.equal(summary.toolBackedRate, 1);
    await fs.unlink(metrics.ledgerPath);
});
