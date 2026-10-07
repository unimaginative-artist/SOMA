import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClusterTradingSentinel } from '../scripts/trading/ClusterTradingSentinel.js';
import { createSignalRouter } from '../server/finance/SignedSignalRouter.js';

const TEST_SECRET = 'test-only-signal-secret-longer-than-32-bytes';

test('ClusterTradingSentinel - Indicator analysis on simulated bars', () => {
    const sentinel = new ClusterTradingSentinel();
    const bars = [];
    // Generate 50 synthetic bars
    for (let i = 0; i < 50; i++) {
        bars.push({
            ts: 1700000000000 + i * 3600000,
            open: 100 + i,
            high: 102 + i,
            low: 99 + i,
            close: 101 + i,
            volume: 1000,
            confirmed: true
        });
    }

    const analysis = sentinel.analyzeAsset('ETH-USDT-SWAP', bars);
    assert.ok(analysis);
    assert.equal(analysis.symbol, 'ETH-USDT-SWAP');
    assert.ok(analysis.currentPrice > 100);
    assert.ok(analysis.rsi > 0 && analysis.rsi <= 100);
    assert.ok(analysis.atr > 0);
    assert.ok(['BUY', 'SELL', 'HOLD'].includes(analysis.signal));
});

test('ClusterTradingSentinel - End-to-end network dispatch to SOMA Signal Ingress', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-sentinel-test-'));
    const app = express();
    app.use(express.json());
    app.use('/api/finance/signal', createSignalRouter({
        secret: TEST_SECRET, journalPath: path.join(directory, 'journal.jsonl'),
        getTradingIntent: () => ({ desiredState: 'stopped', actualState: 'stopped', autoResume: false })
    }));

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const sentinel = new ClusterTradingSentinel({
        primaryHost: `127.0.0.1:${port}`,
        localFallbackHost: `127.0.0.1:${port}`,
        sourceId: 'unit_test_sentinel',
        signalSecret: TEST_SECRET
    });

    try {
        const simulatedAnalysis = {
            symbol: 'ETH-USDT-SWAP',
            currentPrice: 2600.50,
            rsi: 28.4,
            atr: 15.2,
            divergence: 'BULLISH',
            signal: 'BUY',
            confidence: 0.88,
            suggestedRisk: {
                stopLoss: 2575.00,
                takeProfit: 2660.00
            }
        };

        const result = await sentinel.dispatchSignal(simulatedAnalysis);
        assert.equal(result.success, true);
        assert.ok(result.receipt);
        assert.equal(result.receipt.ok, true);
        assert.ok(result.receipt.signalId.startsWith('sig_'));
        assert.equal(result.receipt.decision, 'OBSERVED_HOLD', 'Zero live execution under stopped trading intent');
        assert.equal(result.receipt.symbol, 'ETH-USDT-SWAP');

    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('ClusterTradingSentinel - Fallback to local offline ledger when core is unreachable', async () => {
    // Port 59999 has no listener
    const deadHost = '127.0.0.1:59999';
    const sentinel = new ClusterTradingSentinel({
        primaryHost: deadHost,
        localFallbackHost: deadHost,
        sourceId: 'offline_test_sentinel',
        signalSecret: TEST_SECRET
    });

    const analysis = {
        symbol: 'SOL-USDT-SWAP',
        currentPrice: 120.00,
        rsi: 30.0,
        atr: 2.5,
        divergence: 'NONE',
        signal: 'BUY',
        confidence: 0.75,
        suggestedRisk: null
    };

    const result = await sentinel.dispatchSignal(analysis);
    assert.equal(result.success, false);
    assert.equal(result.queuedLocally, true);
    assert.ok(fs.existsSync(sentinel.ledgerFile));

    const ledger = JSON.parse(fs.readFileSync(sentinel.ledgerFile, 'utf8'));
    assert.ok(Array.isArray(ledger));
    const lastEntry = ledger[ledger.length - 1];
    assert.equal(lastEntry.source, 'offline_test_sentinel');
    assert.equal(lastEntry.status, 'OFFLINE_QUEUED');
});
