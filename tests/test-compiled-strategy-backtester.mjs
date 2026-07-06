import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CompiledStrategyBacktester } from '../server/finance/CompiledStrategyBacktester.js';

function bars(count = 120) {
    const rows = [];
    let price = 100;
    for (let i = 0; i < count; i++) {
        price *= 1 + (i % 20 < 14 ? 0.0025 : -0.001);
        rows.push({
            timestamp: 1780000000000 + i * 300000,
            open: price * 0.998,
            high: price * 1.004,
            low: price * 0.996,
            close: Number(price.toFixed(4)),
            volume: 1000
        });
    }
    return rows;
}

function candidate(symbol = 'SOL') {
    return {
        key: 'full_aggression:SOL',
        strategyId: 'full_aggression',
        symbol,
        compiledStrategy: {
            dsl: {
                signalSet: ['trend', 'volatility_guard'],
                exit: {
                    stopLossPct: 0.018,
                    takeProfitPct: 0.02,
                    trailingStopPct: 0.014
                },
                sizing: {
                    maxPositionPct: 0.2,
                    maxPaperTradeValue: 1000
                }
            }
        },
        simulation: {
            status: 'ready_for_paper'
        }
    };
}

test('compiled strategy backtester runs a candidate against local historical bars', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-backtest-'));
    await fs.writeFile(path.join(dir, 'SOL_5Min.json'), JSON.stringify({ symbol: 'SOL', timeframe: '5Min', bars: bars() }), 'utf8');
    const backtester = new CompiledStrategyBacktester({
        cacheDir: dir,
        reportPath: path.join(dir, 'report.json'),
        initialCapital: 10000
    });

    const results = await backtester.runCandidates([candidate()], { limit: 1 });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'backtested');
    assert.equal(results[0].bars, 120);
    assert.ok(results[0].backtest.trades > 0);
});

test('compiled strategy backtester reports missing historical data', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-backtest-empty-'));
    const backtester = new CompiledStrategyBacktester({
        cacheDir: dir,
        reportPath: path.join(dir, 'report.json')
    });

    const results = await backtester.runCandidates([candidate('NOPE')], { limit: 1 });

    assert.equal(results[0].status, 'no_historical_data');
});
