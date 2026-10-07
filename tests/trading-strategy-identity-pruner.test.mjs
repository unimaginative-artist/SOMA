import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildTradingStrategyIdentity, stampTradingStrategyIdentity } from '../server/finance/TradingStrategyIdentity.js';
import { PortfolioPruner } from '../server/finance/PortfolioPruner.js';
import { TradeLogger } from '../server/finance/TradeLogger.js';

test('strategy identity changes with material configuration but not object key order', () => {
    const a = buildTradingStrategyIdentity({ symbol: 'btc-usd', strategyId: 'standard portfolio', config: { minConfidence: 0.62, stopLossPct: 0.02 } });
    const reordered = buildTradingStrategyIdentity({ symbol: 'BTC-USD', strategyId: 'standard_portfolio', config: { stopLossPct: 0.02, minConfidence: 0.62 } });
    const changed = buildTradingStrategyIdentity({ symbol: 'BTC-USD', strategyId: 'standard_portfolio', config: { stopLossPct: 0.03, minConfidence: 0.62 } });
    assert.equal(a.key, reordered.key);
    assert.notEqual(a.key, changed.key);
});

test('legacy configs are stamped once so runtime defaults cannot change their evidence identity', () => {
    const original = { paperMode: true, selectedBy: 'paper_learning_canary', minConfidence: 0.62 };
    const stamped = stampTradingStrategyIdentity({ symbol: 'SOL-USD', strategyId: 'standard_portfolio', preset: 'standard_portfolio', config: original });
    const afterRuntimeDefaults = buildTradingStrategyIdentity({
        symbol: 'SOL-USD', strategyId: 'standard_portfolio', preset: 'standard_portfolio',
        config: { ...stamped.config, stopLossPct: 0.02, takeProfitPct: 0.05, maxOpenPositions: 3 }
    });
    assert.equal(afterRuntimeDefaults.strategyVersion, stamped.identity.strategyVersion);
    assert.equal(afterRuntimeDefaults.key, stamped.identity.key);
    assert.equal(original.strategyVersion, undefined);
});

test('portfolio pruner attributes evidence to the exact symbol strategy and version', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE trades (id INTEGER PRIMARY KEY, symbol TEXT, strategy TEXT, strategy_version TEXT, status TEXT, pnl REAL, exit_time TEXT)');
    const insert = db.prepare('INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run(1, 'BTC-USD', 'standard_portfolio', 'v1', 'closed', -2, '2026-08-01T00:00:00Z');
    insert.run(2, 'BTC-USD', 'standard_portfolio', 'v1', 'closed', 1, '2026-08-02T00:00:00Z');
    insert.run(3, 'BTC-USD', 'standard_portfolio', 'v2', 'closed', 20, '2026-08-03T00:00:00Z');
    insert.run(4, 'BTC-USD', 'other', 'v1', 'closed', 20, '2026-08-04T00:00:00Z');
    const stats = new PortfolioPruner()._statsFor(db, { symbol: 'BTC-USD', strategyId: 'standard_portfolio', strategyVersion: 'v1' });
    assert.equal(stats.trades, 2);
    assert.equal(stats.wins, 1);
    assert.equal(stats.pnl, -1);
    assert.ok(stats.evidenceFingerprint);
    db.close();
});

test('TradeLogger migrates and persists strategy-version attribution', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trade-version-'));
    const dbPath = path.join(dir, 'trades.db');
    const logger = new TradeLogger(dbPath);
    try {
        logger.initialize();
        const id = logger.logTradeEntry({
            symbol: 'SOL-USD', side: 'buy', qty: 1, entryPrice: 100,
            strategy: 'standard_portfolio',
            attribution: { strategyId: 'standard_portfolio', strategyVersion: 'cfg-test', candidateKey: 'candidate-1' }
        });
        const row = logger.db.prepare('SELECT strategy, strategy_version, candidate_key, attribution_json FROM trades WHERE id=?').get(id);
        assert.equal(row.strategy, 'standard_portfolio');
        assert.equal(row.strategy_version, 'cfg-test');
        assert.equal(row.candidate_key, 'candidate-1');
        assert.equal(JSON.parse(row.attribution_json).strategyVersion, 'cfg-test');
    } finally {
        logger.db?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
