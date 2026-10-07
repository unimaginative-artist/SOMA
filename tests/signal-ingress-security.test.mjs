import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSignalRouter } from '../server/finance/SignedSignalRouter.js';
import { signSignal, signJournalRead } from '../server/finance/SignalIngressProtocol.js';

const SECRET = 'test-only-signal-secret-longer-than-32-bytes';

async function fixture(options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-signal-security-'));
    const journalPath = path.join(directory, 'journal.jsonl');
    const trades = [];
    const app = express();
    app.use(express.json());
    const routerOptions = { journalPath, secret: SECRET,
        getTradingIntent: () => ({ desiredState: 'running', autoResume: true }),
        guardrails: { validateTrade: () => ({ allowed: true }) },
        tradeLogger: { logTradeEntry: trade => trades.push(trade) }, ...options };
    app.use('/api/finance/signal', createSignalRouter(routerOptions));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/finance/signal`;
    return { directory, journalPath, trades, url, routerOptions,
        close: async () => { await new Promise(resolve => server.close(resolve));
            fs.rmSync(directory, { recursive: true, force: true }); } };
}

function payload(overrides = {}) {
    return { source: 'machine_b_sentinel', symbol: 'ETH-USDT-SWAP', timeframe: '1h',
        signal: 'BUY', confidence: 0.85, timestamp: Date.now(), metrics: { price: 2500 },
        ...overrides };
}

function post(url, body, key = 'machine_b:ETH-USDT-SWAP:1h:2026-10-07T13:00:00Z', options = {}) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
        'x-soma-idempotency-key': key,
        'x-soma-signature': signSignal(SECRET, key, body), ...options.headers },
    body: JSON.stringify(body) });
}

test('signal ingress fails closed without a configured secret', async () => {
    const f = await fixture({ secret: '' });
    try {
        assert.equal((await post(f.url, payload())).status, 503);
        assert.equal((await fetch(`${f.url}/journal`)).status, 503);
        assert.equal(f.trades.length, 0);
    } finally { await f.close(); }
});

test('signal ingress rejects unsigned or modified requests and protects the journal', async () => {
    const f = await fixture();
    try {
        const body = payload();
        assert.equal((await fetch(f.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body) })).status, 400);
        assert.equal((await post(f.url, body, 'valid-key', { headers: { 'x-soma-signature': '0'.repeat(64) } })).status, 401);
        assert.equal((await fetch(`${f.url}/journal`)).status, 401);
        const ts = Date.now();
        assert.equal((await fetch(`${f.url}/journal`, { headers: {
            'x-soma-journal-timestamp': String(ts),
            'x-soma-journal-signature': signJournalRead(SECRET, ts)
        } })).status, 200);
        assert.equal(f.trades.length, 0);
    } finally { await f.close(); }
});

test('signal ingress rejects future, stale, unsupported and zero-price signals', async () => {
    const f = await fixture();
    try {
        assert.equal((await post(f.url, payload({ timestamp: Date.now() + 1000 }), 'future')).status, 422);
        assert.equal((await post(f.url, payload({ timestamp: Date.now() - 120_001 }), 'stale')).status, 422);
        assert.equal((await post(f.url, payload({ symbol: 'DOGE-USDT-SWAP' }), 'symbol')).status, 400);
        assert.equal((await post(f.url, payload({ timeframe: '7h' }), 'timeframe')).status, 400);
        assert.equal((await post(f.url, payload({ metrics: { price: 0 } }), 'zero')).status, 400);
        assert.equal(f.trades.length, 0);
    } finally { await f.close(); }
});

test('normalized HOLD is observed; paper execution is idempotent across router instances', async () => {
    const f = await fixture();
    try {
        const hold = await post(f.url, payload({ signal: 'hold', metrics: {} }), 'hold-key');
        assert.equal((await hold.json()).decision, 'OBSERVED_HOLD');
        assert.equal(f.trades.length, 0);

        const buy = payload({ mode: 'live' });
        const first = await post(f.url, buy, 'paper-key');
        const receipt = await first.json();
        assert.equal(receipt.decision, 'PAPER_EXECUTE');
        assert.equal(f.trades.length, 1);
        assert.equal(f.trades[0].mode, 'paper');
        assert.equal(f.trades[0].broker, 'isolated_paper_sandbox');
        const replay = await post(f.url, buy, 'paper-key');
        const replayReceipt = await replay.json();
        assert.equal(replayReceipt.signalId, receipt.signalId);
        assert.equal(replayReceipt.duplicate, true);
        assert.equal(f.trades.length, 1);
        assert.equal((await post(f.url, payload({ metrics: { price: 2501 } }), 'paper-key')).status, 409);

        const restarted = express();
        restarted.use(express.json());
        restarted.use('/api/finance/signal', createSignalRouter(f.routerOptions));
        const server = http.createServer(restarted);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const nextUrl = `http://127.0.0.1:${server.address().port}/api/finance/signal`;
            const again = await post(nextUrl, buy, 'paper-key');
            assert.equal((await again.json()).signalId, receipt.signalId);
            assert.equal(f.trades.length, 1);
        } finally { await new Promise(resolve => server.close(resolve)); }

        const journal = fs.readFileSync(f.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(journal.filter(entry => entry.state === 'complete' && entry.decision === 'PAPER_EXECUTE').length, 1);
    } finally { await f.close(); }
});

test('signed BUY under stopped intent leaves a durable observation receipt and no trade', async () => {
    const f = await fixture({ getTradingIntent: () => ({ desiredState: 'stopped', autoResume: false }) });
    try {
        const body = payload();
        const first = await post(f.url, body, 'stopped-observation-key');
        const firstReceipt = await first.json();
        assert.equal(first.status, 200);
        assert.equal(firstReceipt.decision, 'OBSERVED_HOLD');
        assert.equal(f.trades.length, 0);

        const receiptFiles = fs.readdirSync(path.join(f.directory, 'idempotency'));
        assert.equal(receiptFiles.length, 1);
        const stored = JSON.parse(fs.readFileSync(path.join(f.directory, 'idempotency', receiptFiles[0]), 'utf8'));
        assert.equal(stored.state, 'complete');
        assert.equal(stored.response.signalId, firstReceipt.signalId);
        const journal = fs.readFileSync(f.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(journal.filter(row => row.state === 'complete' && row.signalId === firstReceipt.signalId).length, 1);

        const restarted = express();
        restarted.use(express.json());
        restarted.use('/api/finance/signal', createSignalRouter(f.routerOptions));
        const server = http.createServer(restarted);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const nextUrl = `http://127.0.0.1:${server.address().port}/api/finance/signal`;
            const replay = await post(nextUrl, body, 'stopped-observation-key');
            const replayReceipt = await replay.json();
            assert.equal(replayReceipt.duplicate, true);
            assert.equal(replayReceipt.signalId, firstReceipt.signalId);
            assert.equal(f.trades.length, 0);
        } finally { await new Promise(resolve => server.close(resolve)); }
    } finally { await f.close(); }
});
