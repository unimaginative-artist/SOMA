import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMarketLabEntry, compileMarketLabLedger } from '../server/finance/MarketStrategyCompiler.js';

function baseEntry(overrides = {}) {
    return {
        id: 'market-test-entry',
        source: 'market-simulation-lab',
        paperOnly: true,
        createdAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-06-25T00:00:00.000Z',
        asset: {
            symbol: 'GLD',
            assetClass: 'hedge',
            allowShort: false
        },
        strategy: {
            id: 'standard_portfolio',
            name: 'Standard Portfolio',
            premise: 'Conservative trend and risk-guard strategy.'
        },
        paperAccount: {
            averageDollarPnl: 42.5
        },
        metrics: {
            trades: 220,
            winRate: 0.63,
            profitFactor: 1.7,
            maxDrawdown: 0.08,
            averageDollarPnl: 42.5
        },
        prometheusScore: 0.74,
        ...overrides
    };
}

test('compiler turns a strong symbol-bound simulation into a paper-only compiled strategy', () => {
    const compiled = compileMarketLabEntry(baseEntry());

    assert.equal(compiled.status, 'ready_for_paper');
    assert.equal(compiled.graduation.canPromoteToPaper, true);
    assert.equal(compiled.graduation.canPromoteToLive, false);
    assert.equal(compiled.compiledStrategy.symbol, 'GLD');
    assert.deepEqual(compiled.compiledStrategy.dsl.allowedSymbols, ['GLD']);
    assert.equal(compiled.validation.symbolBound, true);
    assert.equal(compiled.validation.simulation.passed, true);
});

test('compiler blocks strong-looking simulations contradicted by live paper evidence', () => {
    const compiled = compileMarketLabEntry(baseEntry({
        id: 'market-btc-native-test',
        asset: {
            symbol: 'BTC-USD',
            assetClass: 'crypto',
            allowShort: true
        },
        strategy: {
            id: 'BTC_NATIVE',
            name: 'BTC Native'
        }
    }));

    assert.equal(compiled.status, 'blocked_by_live_paper');
    assert.equal(compiled.graduation.canPromoteToPaper, false);
    assert.equal(compiled.performanceGuard.allowed, false);
    assert.ok(compiled.graduation.reasons.some(reason => reason.includes('paper evidence quarantine')));
});

test('compiler rejects weak simulations before paper promotion', () => {
    const compiled = compileMarketLabEntry(baseEntry({
        id: 'market-weak-test',
        paperAccount: { averageDollarPnl: -12 },
        metrics: {
            trades: 40,
            winRate: 0.48,
            profitFactor: 0.6,
            maxDrawdown: 0.31,
            averageDollarPnl: -12
        },
        prometheusScore: 0.4
    }));

    assert.equal(compiled.status, 'rejected_in_simulation');
    assert.equal(compiled.graduation.canPromoteToPaper, false);
    assert.equal(compiled.validation.simulation.passed, false);
    assert.ok(compiled.graduation.reasons.some(reason => reason.includes('simulation trades')));
});

test('compiler ledger summary counts ready, blocked, and rejected entries', () => {
    const ledger = compileMarketLabLedger([
        baseEntry({ id: 'ready' }),
        baseEntry({
            id: 'blocked',
            asset: { symbol: 'BTC-USD', assetClass: 'crypto', allowShort: true },
            strategy: { id: 'BTC_NATIVE', name: 'BTC Native' }
        }),
        baseEntry({
            id: 'rejected',
            paperAccount: { averageDollarPnl: -1 },
            metrics: { trades: 1, winRate: 0.1, profitFactor: 0.1, maxDrawdown: 0.5, averageDollarPnl: -1 },
            prometheusScore: 0.1
        })
    ]);

    assert.equal(ledger.summary.total, 3);
    assert.equal(ledger.summary.readyForPaper, 1);
    assert.equal(ledger.summary.blockedByLivePaper, 1);
    assert.equal(ledger.summary.rejectedInSimulation, 1);
});
