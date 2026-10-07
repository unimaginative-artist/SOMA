import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLowTurnoverTrend, lowTurnoverTrendCandidate } from '../server/finance/LowTurnoverTrendResearch.js';

test('one frozen, long-only, paper-ineligible recipe is reproducible per symbol', () => {
    const btc = lowTurnoverTrendCandidate('BTC-USD');
    const eth = lowTurnoverTrendCandidate('ETH-USD');
    assert.notEqual(btc.id, eth.id);
    assert.equal(btc.id, lowTurnoverTrendCandidate('BTC-USD').id);
    assert.equal(btc.key, lowTurnoverTrendCandidate('BTC-USD').key);
    assert.equal(btc.researchOnly, true);
    assert.equal(btc.compiledStrategy.dsl.execution.timeframe, '4H');
    assert.equal(btc.compiledStrategy.dsl.execution.style, 'taker_market');
    assert.equal(btc.compiledStrategy.dsl.entry.direction, 'long_only');
    assert.equal(btc.compiledStrategy.dsl.exit.maxPositionAgeMs, 14 * 24 * 60 * 60_000);
    assert.throws(() => lowTurnoverTrendCandidate('TLT'));
});

test('research refuses bars without verified native-venue provenance', async () => {
    await assert.rejects(evaluateLowTurnoverTrend({ symbol: 'BTC-USD', backtester: {
        loadBars: async () => ({ bars: [], provenanceVerified: false })
    } }), /missing verified Alpaca provenance/);
});

test('research refuses synthetic candles even if a cache claims Alpaca provenance', async () => {
    const now = Date.now();
    const bars = Array.from({ length: 720 }, (_, index) => ({
        timestamp: now - (720 - index) * 4 * 60 * 60_000,
        open: 100, high: 101, low: 99, close: 100, volume: 1, source: 'synthetic'
    }));
    await assert.rejects(evaluateLowTurnoverTrend({ symbol: 'BTC-USD', now,
        backtester: { loadBars: async () => ({ bars, provenanceVerified: true,
            provenance: { venue: 'alpaca_crypto_us', sha256: 'fixture' } }) }
    }), /real completed Alpaca candle validation failed/);
});
