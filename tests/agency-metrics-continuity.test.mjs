import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgencyMetrics } from '../core/AgencyMetrics.js';

test('agency metrics survive restart instead of resetting the scoreboard', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-agency-metrics-'));
    const ledgerPath = path.join(root, 'agency.jsonl');
    try {
        const first = await new AgencyMetrics({ ledgerPath }).initialize();
        await first.record({
            id: 'tx-1', finishedAt: Date.now(), classification: { lane: 'agentic', domain: 'general' },
            observed: { success: true, verified: true, toolsUsed: ['write_file'], observationCount: 1 }
        });
        const second = await new AgencyMetrics({ ledgerPath }).initialize();
        const summary = second.summarize();
        assert.equal(summary.transactions, 1);
        assert.equal(summary.verifiedRate, 1);
        assert.equal(summary.toolBackedRate, 1);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
