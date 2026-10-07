import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMarketLabEntry, compileMarketLabLedger } from '../server/finance/MarketStrategyCompiler.js';
import { TradingPerformanceGuard } from '../server/finance/TradingPerformanceGuard.js';

const losingRows = [
    ...Array.from({ length: 19 }, (_, id) => ({ id, strategy: 'BTC_NATIVE', symbol: id < 10 ? 'BTC-USD' : 'SOL-USD', status: 'closed', pnl: 0.8 })),
    ...Array.from({ length: 36 }, (_, id) => ({ id: 19 + id, strategy: 'BTC_NATIVE', symbol: id < 17 ? 'BTC-USD' : 'SOL-USD', status: 'closed', pnl: -1 }))
];
const performanceGuard = new TradingPerformanceGuard({ tradeSource: { db: {}, getClosedTrades: () => losingRows } });

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
        dataSource: 'real',
        realDataBars: 420,
        walkForward: {
            skipped: false,
            passes: true,
            grade: 'ROBUST',
            oos: { trades: 42, totalPnl: 0.12, winRate: 0.57, sharpe: 1.2 }
        },
        ...overrides
    };
}

test('compiler turns a strong symbol-bound simulation into a paper-only compiled strategy', () => {
    // Use the fixed fixture guard, never the operator's changing paper ledger.
    const compiled = compileMarketLabEntry(baseEntry(), { performanceGuard });

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
    }), { performanceGuard });

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

test('compiler rejects synthetic-only results even when headline metrics look excellent', () => {
    const compiled = compileMarketLabEntry(baseEntry({
        id: 'synthetic-mirage',
        dataSource: 'synthetic',
        realDataBars: 0,
        walkForward: null,
        metrics: {
            trades: 466,
            winRate: 0.7189,
            profitFactor: 23.428,
            maxDrawdown: 0.033,
            averageDollarPnl: 290.38
        },
        paperAccount: { averageDollarPnl: 290.38 },
        prometheusScore: 0.8774
    }));

    assert.equal(compiled.status, 'rejected_in_simulation');
    assert.equal(compiled.graduation.canPromoteToPaper, false);
    assert.ok(compiled.graduation.reasons.some(reason => reason.includes('not real market data')));
    assert.ok(compiled.graduation.reasons.some(reason => reason.includes('walk-forward validation is required')));
});

test('compiler rejects real-data results when held-out evidence is missing', () => {
    const compiled = compileMarketLabEntry(baseEntry({
        id: 'missing-holdout',
        walkForward: null
    }));

    assert.equal(compiled.status, 'rejected_in_simulation');
    assert.equal(compiled.graduation.canPromoteToPaper, false);
    assert.ok(compiled.graduation.reasons.some(reason => reason.includes('walk-forward validation is required')));
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
    ], { performanceGuard });

    assert.equal(ledger.summary.total, 3);
    assert.equal(ledger.summary.readyForPaper, 1);
    assert.equal(ledger.summary.blockedByLivePaper, 1);
    assert.equal(ledger.summary.rejectedInSimulation, 1);
});
