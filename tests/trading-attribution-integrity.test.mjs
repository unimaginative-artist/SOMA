import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveStrategyId, resolvePositionStrategyId } from '../server/finance/TradeAttribution.js';
import { getOpenStrategyIds, hasOpenPositions } from '../server/finance/StrategyRotationPolicy.js';
import { buildLiveStrategyEvidence } from '../server/finance/LiveStrategyEvidence.js';

test('a closing trade is credited to its entry strategy after runtime rotation', () => {
    const positionAtEntry = { attribution: { strategyId: 'YIELD_HARVESTER' } };
    assert.equal(resolvePositionStrategyId(positionAtEntry, null, 'boring_algo'), 'yield_harvester');
});

test('SQLite-restored strategy metadata outranks the current runtime fallback', () => {
    const restored = { strategy: 'BTC_NATIVE' };
    assert.equal(resolvePositionStrategyId(restored, null, 'micro_scalper'), 'btc_native');
});

test('auto selection does not let a legacy boot preset override the runtime strategy', () => {
    assert.equal(resolveActiveStrategyId({
        strategySelectionMode: 'auto',
        preset: 'BTC_NATIVE',
        runtimeProfile: { preset: 'yield_harvester' },
        config: {}
    }), 'yield_harvester');
    assert.equal(resolveActiveStrategyId({
        strategySelectionMode: 'manual',
        preset: 'BTC_NATIVE',
        runtimeProfile: { preset: 'yield_harvester' },
        config: {}
    }), 'btc_native');
});

test('strategy hunt detects portfolio exposure and its entry strategies before rotation', () => {
    const aggregate = {
        instances: [
            { openPositions: [{ attribution: { strategyId: 'yield_harvester' } }], paperPortfolio: { positionCount: 1 } },
            { openPositions: [] }
        ]
    };
    assert.equal(hasOpenPositions(aggregate), true);
    assert.deepEqual(getOpenStrategyIds(aggregate), ['yield_harvester']);
    assert.equal(hasOpenPositions({ instances: [{ openPositions: [], paperPortfolio: { positionCount: 0 } }] }), false);
});

test('live UCB evidence is rebuilt from authoritative closed trades without duplicate trial summaries', () => {
    const evidence = buildLiveStrategyEvidence([
        { status: 'closed', strategy: 'BTC_NATIVE', regime: 'VOLATILE', pnl: 2, pnl_pct: 0.02 },
        { status: 'closed', strategy: 'BTC_NATIVE', regime: 'VOLATILE', pnl: -1, pnl_pct: -0.01 },
        { status: 'open', strategy: 'BTC_NATIVE', regime: 'VOLATILE', pnl: 0, pnl_pct: 0 },
        { status: 'closed', strategy: 'YIELD_HARVESTER', regime: 'RANGING', pnl: 1, pnl_pct: 0.01 }
    ]);
    assert.equal(evidence.btc_native.trials, 2);
    assert.equal(evidence.btc_native.wins, 1);
    assert.equal(evidence.btc_native.byRegime.VOLATILE.trials, 2);
    assert.equal(evidence.yield_harvester.trials, 1);
});
