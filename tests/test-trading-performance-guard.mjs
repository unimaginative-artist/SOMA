import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingPerformanceGuard } from '../server/finance/TradingPerformanceGuard.js';

function trades(strategy, symbol, wins, losses, winPnl = 1, lossPnl = -1) {
    return [
        ...Array.from({ length: wins }, (_, id) => ({ id, strategy, symbol, status: 'closed', pnl: winPnl })),
        ...Array.from({ length: losses }, (_, id) => ({ id: wins + id, strategy, symbol, status: 'closed', pnl: lossPnl }))
    ];
}

function guardFor(rows) {
    return new TradingPerformanceGuard({ tradeSource: { db: {}, getClosedTrades: () => rows } });
}

test('quarantines strategy-wide losing evidence once thirty trades are available', () => {
    const guard = guardFor([
        ...trades('BTC_NATIVE', 'BTC-USD', 11, 16, 0.85, -0.9),
        ...trades('BTC_NATIVE', 'SOL-USD', 8, 20, 0.8, -0.95)
    ]);
    const verdict = guard.evaluate({ symbol: 'BTC-USD', strategyId: 'BTC_NATIVE' });

    assert.equal(verdict.allowed, false);
    assert.equal(verdict.action, 'quarantine');
    assert.equal(verdict.evidenceState, 'mature_failure');
    assert.equal(verdict.strategyId, 'btc_native');
    assert.ok(verdict.stats.strategy.trades >= 40);
    assert.ok(verdict.reasons.some(reason => reason.includes('profit factor')));
});

test('fully quarantines mature contradictory evidence', () => {
    const guard = guardFor(trades('BTC_NATIVE', 'BTC-USD', 30, 70, 0.8, -1));
    const verdict = guard.evaluate({ symbol: 'BTC-USD', strategyId: 'BTC_NATIVE' });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.action, 'quarantine');
    assert.equal(verdict.evidenceState, 'mature_failure');
});

test('allows strategies without enough live-paper evidence', () => {
    const verdict = guardFor([]).evaluate({ symbol: 'TLT', strategyId: 'fresh_research_strategy' });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.action, 'allow');
    assert.equal(verdict.stats.strategy.trades, 0);
});

test('performance report is deterministic and includes strategy-wide restrictions', () => {
    const rows = [
        ...trades('BTC_NATIVE', 'BTC-USD', 11, 16, 0.85, -0.9),
        ...trades('BTC_NATIVE', 'SOL-USD', 8, 20, 0.8, -0.95),
        ...trades('healthy', 'ETH-USD', 30, 10, 1.2, -0.7)
    ];
    const report = guardFor(rows).report({ limit: 10 });
    assert.equal(report.success, true);
    assert.equal(report.summary.trades, rows.length);
    assert.ok(report.quarantined.some(item => item.strategyId === 'btc_native'));
});

test('passes the authoritative evidence cutoff to the SQLite trade source', () => {
    let received = null;
    const guard = new TradingPerformanceGuard({
        tradeSource: {
            db: {},
            getClosedTrades(days, options) {
                received = { days, options };
                return [];
            }
        }
    });
    const verdict = guard.evaluate({ symbol: 'ETH-USD', strategyId: 'full_aggression', since: '2026-07-03T14:00:00Z' });
    assert.deepEqual(received, { days: null, options: { since: '2026-07-03T14:00:00Z' } });
    assert.equal(verdict.evidenceWindow.source, 'sqlite_closed_trades');
    assert.equal(verdict.evidenceWindow.since, '2026-07-03T14:00:00Z');
});
