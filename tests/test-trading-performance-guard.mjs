import test from 'node:test';
import assert from 'node:assert/strict';
import tradingPerformanceGuard from '../server/finance/TradingPerformanceGuard.js';

test('performance guard quarantines the current failing BTC_NATIVE paper strategy', () => {
    const verdict = tradingPerformanceGuard.evaluate({
        symbol: 'BTC-USD',
        strategyId: 'BTC_NATIVE'
    });

    assert.equal(verdict.allowed, false);
    assert.equal(verdict.action, 'quarantine');
    assert.equal(verdict.strategyId, 'btc_native');
    assert.ok(verdict.stats.strategy.trades >= 100);
    assert.ok(verdict.stats.strategy.profitFactor < verdict.policy.minStrategyProfitFactor);
    assert.ok(verdict.reasons.some(reason => reason.includes('profit factor')));
});

test('performance guard allows strategies without enough live-paper evidence', () => {
    const verdict = tradingPerformanceGuard.evaluate({
        symbol: 'TLT',
        strategyId: 'fresh_research_strategy'
    });

    assert.equal(verdict.allowed, true);
    assert.equal(verdict.action, 'allow');
    assert.equal(verdict.stats.strategy.trades, 0);
});

test('performance report exposes worst pairs and quarantines', () => {
    const report = tradingPerformanceGuard.report({ limit: 10 });

    assert.equal(report.success, true);
    assert.ok(report.summary.trades >= 700);
    assert.ok(report.quarantined.some(item => item.strategyId === 'btc_native'));
});
