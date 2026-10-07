import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TradeLogger } from '../server/finance/TradeLogger.js';

test('stale open rows are reconciled without fabricating closed-trade PnL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trades-'));
    const logger = new TradeLogger(path.join(dir, 'trades.db'));
    logger.initialize();
    logger.logTradeEntry({ orderId: 'stale-1', symbol: 'BTC-USD', side: 'buy', qty: 1, entryPrice: 10, strategy: 'test' });
    logger.db.prepare("UPDATE trades SET entry_time = '2020-01-01T00:00:00.000Z' WHERE order_id = 'stale-1'").run();
    const result = logger.reconcileStaleOpenTrades({ activeOrderIds: [], maxAgeMs: 1000, now: Date.now() });
    assert.equal(result.reconciled.length, 1);
    assert.equal(logger.getOpenTrades().length, 0);
    assert.equal(logger.getClosedTrades().length, 0);
    const row = logger.db.prepare("SELECT status, pnl, exit_reason FROM trades WHERE order_id = 'stale-1'").get();
    assert.deepEqual(row, { status: 'reconciled', pnl: null, exit_reason: 'RUNTIME_POSITION_MISSING' });
    logger.close();
});

test('trade ledger persists entry and exit fees in net realized PnL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trade-fees-'));
    const logger = new TradeLogger(path.join(dir, 'trades.db'));
    logger.initialize();
    const id = logger.logTradeEntry({
        orderId: 'fee-1', symbol: 'ETH-USD', side: 'sell', qty: 2,
        entryPrice: 100, entryFee: 0.04, strategy: 'paper_canary_test'
    });
    logger.logTradeExit(id, { exitPrice: 99, exitFee: 0.04, reason: 'TEST_EXIT' });
    const row = logger.db.prepare('SELECT pnl, entry_fee, exit_fee, status FROM trades WHERE id = ?').get(id);
    assert.equal(row.status, 'closed');
    assert.equal(row.entry_fee, 0.04);
    assert.equal(row.exit_fee, 0.04);
    assert.ok(Math.abs(row.pnl - 1.92) < 1e-9);
    logger.close();
});
