import assert from 'node:assert/strict';
import test from 'node:test';
import { runBeeResearchIntegration, summarizeBeeProxyResearch } from '../server/trading/BeeResearchIntegration.js';

function artifact() {
    const comparison = { trades: 12, totalPnl: -3, profitFactor: 0.8, winRate: 0.4 };
    return {
        paperOnly: true, promotionAuthorized: false, createdAt: '2026-10-06T12:00:00.000Z',
        bees: Object.fromEntries(['bizzy', 'boozy', 'breezy'].map(key => [key, {
            instrument: `${key}-USDT-SWAP`, completedBars: 1200, lastTs: 1791316800000,
            trainingCandidates: [{ metrics: { ...comparison, totalPnl: 4 } }],
            holdout: { metrics: comparison }
        }]))
    };
}

test('Bee proxy comparison stays diagnostic and keeps development separate from holdout', async () => {
    const bridgeCalls = [];
    const report = await runBeeResearchIntegration({
        bridge: {
            ensurePrometheusResearchEntries() { bridgeCalls.push('register'); return { success: true }; },
            syncValidatedResearchParameters() { bridgeCalls.push('sync'); return { updated: false, reason: 'no_validated_parameter_results' }; }
        },
        research: async () => 'bounded-proxy.json',
        readSummary: async () => JSON.stringify(artifact())
    });
    assert.deepEqual(bridgeCalls, ['register', 'sync']);
    assert.equal(report.status, 'diagnostic_complete');
    assert.equal(report.paperOrdersAllowed, false);
    assert.equal(report.promotionAllowed, false);
    assert.equal(report.bees.bizzy.development.totalPnl, 4);
    assert.equal(report.bees.bizzy.holdout.totalPnl, -3);
    assert.equal(report.parameterSync.updated, false);
});

test('Bee research failure cannot abort the primary cycle or create promotion evidence', async () => {
    const report = await runBeeResearchIntegration({
        bridge: {
            ensurePrometheusResearchEntries: () => ({ success: true }),
            syncValidatedResearchParameters: () => ({ updated: false })
        },
        research: async () => { throw new Error('OKX unavailable'); }
    });
    assert.equal(report.status, 'diagnostic_unavailable');
    assert.match(report.error, /OKX unavailable/);
    assert.equal(report.paperOrdersAllowed, false);
    assert.equal(report.promotionAllowed, false);
    assert.throws(() => summarizeBeeProxyResearch({ ...artifact(), promotionAuthorized: true }, 'bad.json'), /deny promotion/);
});
