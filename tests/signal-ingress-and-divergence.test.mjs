import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { calculateRSISeries, findPivots, detectRSIDivergence } from '../server/finance/TechnicalIndicators.js';
import signalRoutes from '../server/finance/signalRoutes.js';

test('TechnicalIndicators - Zero-lookahead findPivots', () => {
    // Array with clear peak at index 3 (value 15) and valley at index 7 (value 5)
    const series = [10, 11, 12, 15, 12, 11, 10, 5, 8, 9, 10];
    const leftBars = 3;
    const rightBars = 1;

    const pivots = findPivots(series, leftBars, rightBars);

    assert.ok(pivots.highs.length >= 1, 'Should detect at least 1 high');
    const peak = pivots.highs.find(h => h.index === 3);
    assert.ok(peak, 'Should identify index 3 as swing high');
    assert.equal(peak.value, 15);
    assert.equal(peak.confirmedIndex, 4, 'High at index 3 is confirmed strictly at index 4 (zero lookahead)');

    assert.ok(pivots.lows.length >= 1, 'Should detect at least 1 low');
    const valley = pivots.lows.find(l => l.index === 7);
    assert.ok(valley, 'Should identify index 7 as swing low');
    assert.equal(valley.value, 5);
    assert.equal(valley.confirmedIndex, 8, 'Low at index 7 is confirmed strictly at index 8 (zero lookahead)');
});

test('TechnicalIndicators - Regular Bullish Divergence Detection', () => {
    // Construct synthetic series:
    // Low 1 at bar 10 (Price 100, RSI oversold at ~25)
    // Low 2 at bar 20 (Price 90 [Lower Low], RSI at ~35 [Higher Low])
    const closes = [];
    // Lead-in to establish RSI
    for (let i = 0; i < 15; i++) closes.push(110 - i * 0.5);
    
    // First valley (Price 100)
    closes.push(102, 101, 100, 103, 105, 106);
    
    // Recovery bounce
    closes.push(107, 108, 107, 105, 103);
    
    // Second valley (Price 95 -> Lower Low in price)
    closes.push(98, 96, 95, 97, 99, 100);

    const rsiSeries = calculateRSISeries(closes, 14);
    assert.equal(rsiSeries.length, closes.length, 'RSI series length matches closes');

    const result = detectRSIDivergence(closes, null, {
        leftBars: 2,
        rightBars: 1,
        minBarsBetweenPivots: 3,
        oversoldThreshold: 45
    });

    assert.ok(typeof result.hasBullishDivergence === 'boolean');
    assert.ok(typeof result.hasBearishDivergence === 'boolean');
});

test('Signal Ingress Gateway - Fail-closed arbitration and schema enforcement', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/finance/signal', signalRoutes);

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/api/finance/signal`;

    try {
        // 1. Rejects invalid source
        const resNoSource = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: 'ETH-USDT', signal: 'BUY' })
        });
        assert.equal(resNoSource.status, 400);

        // 2. Rejects stale timestamp (>120s old)
        const resStale = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'test_machine_b',
                symbol: 'ETH-USDT',
                signal: 'BUY',
                confidence: 0.85,
                timestamp: Date.now() - 300_000 // 5 minutes old
            })
        });
        assert.equal(resStale.status, 422);
        const staleJson = await resStale.json();
        assert.equal(staleJson.decision, 'REJECTED_STALE');

        // 3. Accepts fresh signal and arbitrates to OBSERVED_HOLD under stopped trading intent
        const resValid = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'test_machine_b',
                symbol: 'ETH-USDT-SWAP',
                timeframe: '1h',
                signal: 'BUY',
                confidence: 0.82,
                timestamp: Date.now(),
                metrics: {
                    price: 2650.00,
                    rsi: 28.5,
                    atr: 12.4
                }
            })
        });
        assert.equal(resValid.status, 200);
        const validJson = await resValid.json();
        assert.equal(validJson.ok, true);
        assert.equal(validJson.decision, 'OBSERVED_HOLD', 'Must fail-closed to OBSERVED_HOLD when tradingIntent is stopped');
        assert.ok(validJson.signalId.startsWith('sig_'));

        // 4. Ingress journal inspection
        const resJournal = await fetch(`${baseUrl}/journal`);
        assert.equal(resJournal.status, 200);
        const journalJson = await resJournal.json();
        assert.equal(journalJson.ok, true);
        assert.ok(Array.isArray(journalJson.signals));
        assert.ok(journalJson.signals.length >= 1);
        assert.equal(journalJson.signals[0].source, 'test_machine_b');

    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
