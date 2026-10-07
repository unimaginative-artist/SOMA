/**
 * tests/soma-bee-swarm.test.mjs
 *
 * Verification suite for SOMA Neocortex Trading Swarm:
 *  1. BeeSwarmBroker: Central Nervous System pub/sub messaging & macro bias
 *  2. BeeRegimeAdapter: Dynamic parameter modulation across all 5 regimes
 *  3. BeeLearningBridge: Performance attribution & UCB1 bandit capital rebalancing
 *  4. EnterpriseRiskGate: Conflicting direction blocks & global drawdown circuit breaker
 *  5. End-to-End Swarm Engine: Full tick & trade execution with all modules integrated
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { BeeSwarmBroker, TOPICS } from '../server/trading/BeeSwarmBroker.js';
import { BeeRegimeAdapter } from '../server/trading/BeeRegimeAdapter.js';
import { BeeLearningBridge } from '../server/trading/BeeLearningBridge.js';
import { EnterpriseRiskGate } from '../server/trading/EnterpriseRiskGate.js';
import { SomaBeeTradingEngine, BEE_CONFIGS } from '../server/trading/SomaBeeTradingEngine.js';
import { BeeAutonomicTuner } from '../server/trading/BeeAutonomicTuner.js';

describe('SOMA Neocortex Trading Swarm Architecture', () => {
    const testLedgerPath = path.join(process.cwd(), 'data', 'trading', 'test_swarm_ledger.json');

    after(() => {
        if (fs.existsSync(testLedgerPath)) {
            try { fs.unlinkSync(testLedgerPath); } catch (_) {}
        }
    });

    // ─────────────────────────────────────────────────────────────
    // 1. BeeSwarmBroker Tests
    // ─────────────────────────────────────────────────────────────
    describe('BeeSwarmBroker (CNS Communication)', () => {
        test('correctly broadcasts and ingests macro bias and regime shifts', async () => {
            const published = [];
            const mockPublish = async (topic, payload) => {
                published.push({ topic, payload });
                return 1;
            };

            const broker = new BeeSwarmBroker({ publish: mockPublish });

            // Ingest macro bias from AutonomousTrader
            broker.latestMacroBias['BTC-USDT-SWAP'] = {
                bias: 'BULLISH',
                timeframe: '1D',
                reason: 'Daily EMA20 golden cross'
            };

            const bias = broker.getMacroBias('BTC-USDT-SWAP');
            assert.equal(bias.bias, 'BULLISH');
            assert.equal(broker.getMacroBias('BTC/USD')?.bias, 'BULLISH', 'Should resolve root asset');

            // Test publish methods
            await broker.publishTradeOpen({ bee: 'bizzy', symbol: 'BTC-USDT-SWAP', side: 'LONG' });
            await broker.publishTradeClose({ bee: 'bizzy', pnl: 45.5, rMultiple: 1.5 });
            await broker.publishVolatilityAlert({ symbol: 'SOL-USDT-SWAP', atr_pct: 1.8 });

            assert.equal(published.length, 3);
            assert.equal(published[0].topic, TOPICS.HIVE_TRADE_OPEN);
            assert.equal(published[1].topic, TOPICS.HIVE_TRADE_CLOSE);
            assert.equal(published[2].topic, TOPICS.HIVE_VOLATILITY);

            broker.destroy();
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 2. BeeRegimeAdapter Tests
    // ─────────────────────────────────────────────────────────────
    describe('BeeRegimeAdapter (Dynamic Regime Modulation)', () => {
        const adapter = new BeeRegimeAdapter();

        test('applies TRENDING_UP adjustments: expands TP, restricts boozy to LONG only', () => {
            const bizzyAdj = adapter.getBeeAdjustments('bizzy', 'BTC-USDT-SWAP', 'TRENDING_UP');
            assert.equal(bizzyAdj.active, true);
            assert.equal(bizzyAdj.tpAtrMultiplier, 3.5, 'TP multiplier should expand in trend');
            assert.deepEqual(bizzyAdj.allowedSides, ['LONG']);

            const boozyAdj = adapter.getBeeAdjustments('boozy', 'ETH-USDT-SWAP', 'TRENDING_UP');
            assert.deepEqual(boozyAdj.allowedSides, ['LONG'], 'Boozy should only buy dips in bull trend, never short fade');
        });

        test('applies RANGING adjustments: boozy thrives with tight TP, breezy suppressed', () => {
            const boozyAdj = adapter.getBeeAdjustments('boozy', 'ETH-USDT-SWAP', 'RANGING');
            assert.equal(boozyAdj.active, true);
            assert.equal(boozyAdj.minConviction, 2, 'Boozy minConviction should be 2 to avoid chop noise');
            assert.equal(boozyAdj.tpAtrMultiplier, 1.8, 'TP should tighten in range');

            const breezyAdj = adapter.getBeeAdjustments('breezy', 'SOL-USDT-SWAP', 'RANGING');
            assert.equal(breezyAdj.active, false, 'Trend follower should be suppressed in zero-trend range');
        });

        test('applies CRASH adjustments: suppresses mean-reversion completely', () => {
            const boozyAdj = adapter.getBeeAdjustments('boozy', 'ETH-USDT-SWAP', 'CRASH');
            assert.equal(boozyAdj.active, false, 'Boozy must never buy dips during a CRASH');
            assert.deepEqual(boozyAdj.allowedSides, []);
        });

        test('applies VOLATILE adjustments: widens ATR stop multiplier', () => {
            const bizzyAdj = adapter.getBeeAdjustments('bizzy', 'BTC-USDT-SWAP', 'VOLATILE');
            assert.equal(bizzyAdj.stopAtrMultiplier, 2.2, 'Stop should widen during volatility spikes');
            assert.equal(bizzyAdj.minConviction, 3, 'Conviction must be strict in volatile regimes');
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 3. BeeLearningBridge Tests
    // ─────────────────────────────────────────────────────────────
    describe('BeeLearningBridge (Performance & UCB1 Bandit)', () => {
        const bridge = new BeeLearningBridge({ minTradesForBandit: 3 });

        test('accurately calculates rolling R-multiples and profit factor', () => {
            const mockTrades = [
                { bee: 'bizzy', pnl: 20, rMultiple: 1.0 },
                { bee: 'bizzy', pnl: 40, rMultiple: 2.0 },
                { bee: 'bizzy', pnl: -20, rMultiple: -1.0 },
                { bee: 'boozy', pnl: -20, rMultiple: -1.0 },
                { bee: 'breezy', pnl: 10, rMultiple: 0.5 }
            ];

            const stats = bridge.computeBeeStats(mockTrades);
            assert.equal(stats.bizzy.count, 3);
            assert.equal(stats.bizzy.wins, 2);
            assert.equal(stats.bizzy.losses, 1);
            assert.equal(stats.bizzy.avgR, 0.667);
            assert.equal(stats.bizzy.profitFactor, 3.0); // 60 win / 20 loss

            assert.equal(stats.boozy.count, 1);
            assert.equal(stats.boozy.avgR, -1.0);
        });

        test('rebalances capital weights toward high-performing bees via UCB1', () => {
            const mockTrades = [
                { bee: 'bizzy', pnl: 40, rMultiple: 2.0 },
                { bee: 'bizzy', pnl: 30, rMultiple: 1.5 },
                { bee: 'bizzy', pnl: 20, rMultiple: 1.0 },
                { bee: 'boozy', pnl: -20, rMultiple: -1.0 },
                { bee: 'boozy', pnl: -20, rMultiple: -1.0 },
                { bee: 'breezy', pnl: 0, rMultiple: 0.0 }
            ];

            const result = bridge.computeCapitalWeights(mockTrades);
            assert.equal(result.isBanditActive, true);
            assert.ok(result.weights.bizzy > result.weights.boozy, 'Winning bee must receive higher capital weight than losing bee');
            
            const totalWeight = Object.values(result.weights).reduce((a, b) => a + b, 0);
            assert.ok(Math.abs(totalWeight - 1.0) < 0.01, 'Total weights must sum to 1.0');
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 4. EnterpriseRiskGate Tests
    // ─────────────────────────────────────────────────────────────
    describe('EnterpriseRiskGate (Cross-Engine Protection)', () => {
        test('blocks conflicting directional positions across engines', () => {
            const gate = new EnterpriseRiskGate();

            // Alpaca (AutonomousTrader) holds LONG BTC/USD ($850 notional)
            gate.registerOpenPosition('AUTONOMOUS_TRADER', {
                symbol: 'BTC/USD',
                side: 'LONG',
                size: 0.01,
                entryPrice: 85000
            });

            // BeeBots attempts to open SHORT BTC-USDT-SWAP
            const checkShort = gate.checkOrderApproval({
                engine: 'BEEBOTS',
                symbol: 'BTC-USDT-SWAP',
                side: 'SHORT',
                notional: 1000,
                entryPrice: 85000
            });
            assert.equal(checkShort.approved, false);
            assert.match(checkShort.reason, /Conflicting cross-engine position/);

            // BeeBots attempts to open LONG BTC-USDT-SWAP (concordant direction allowed)
            const checkLong = gate.checkOrderApproval({
                engine: 'BEEBOTS',
                symbol: 'BTC-USDT-SWAP',
                side: 'LONG',
                notional: 500,
                entryPrice: 85000
            });
            assert.equal(checkLong.approved, true);
        });

        test('trips circuit breaker when cumulative daily drawdown exceeds threshold', () => {
            const gate = new EnterpriseRiskGate({ maxDailyDrawdownDollars: 100 });

            gate.registerClosedTrade('BEEBOTS', { symbol: 'ETH-USDT-SWAP', pnl: -60 });
            assert.equal(gate.isEmergencyHalted, false);

            gate.registerClosedTrade('AUTONOMOUS_TRADER', { symbol: 'BTC/USD', pnl: -50 });
            assert.equal(gate.isEmergencyHalted, true, 'Circuit breaker must trip when cumulative loss exceeds $100');

            const orderAttempt = gate.checkOrderApproval({
                engine: 'BEEBOTS',
                symbol: 'SOL-USDT-SWAP',
                side: 'LONG',
                notional: 100
            });
            assert.equal(orderAttempt.approved, false);
            assert.match(orderAttempt.reason, /Circuit Breaker/);
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 5. End-to-End Swarm Engine Integration
    // ─────────────────────────────────────────────────────────────
    describe('SomaBeeTradingEngine Swarm Integration', () => {
        let engine;
        let publishedEvents = [];
        const mockRiskGate = new EnterpriseRiskGate();

        before(() => {
            if (fs.existsSync(testLedgerPath)) fs.unlinkSync(testLedgerPath);

            const mockBroker = new BeeSwarmBroker({
                publish: async (topic, payload) => {
                    publishedEvents.push({ topic, payload });
                    return 1;
                }
            });

            engine = new SomaBeeTradingEngine({
                ledgerPath: testLedgerPath,
                tradeLogger: null,
                autonomicTuner: new BeeAutonomicTuner(),
                prometheusBridge: { applyParametersToSwarm: () => false },
                swarmBroker: mockBroker,
                riskGate: mockRiskGate,
                minConviction: 2
            });
        });

        test('openPosition enforces regime parameters and broadcasts trade open to CNS', () => {
            const mockMarket = {
                instId: 'BTC-USDT-SWAP',
                bid: 86000,
                ask: 86010,
                atr_14: 300,
                atr_pct: 0.35
            };

            const mockLaya = {
                choice: 'LONG',
                confidence: 0.90,
                probabilities: { LONG: 0.9, SHORT: 0.05, HOLD: 0.05 }
            };

            // Set regime to TRENDING_UP
            engine.regimeAdapter.detector = {
                getRegime: () => ({ regime: 'TRENDING_UP', confidence: 0.95 })
            };

            // Try opening SHORT in TRENDING_UP (should be blocked by regime adapter)
            const shortPos = engine.openPosition('bizzy', 'SHORT', mockMarket, 3, mockLaya);
            assert.equal(shortPos, null, 'Short breakout must be blocked during TRENDING_UP');

            // Open LONG in TRENDING_UP (allowed, with expanded TP)
            const longPos = engine.openPosition('bizzy', 'LONG', mockMarket, 2, mockLaya);
            assert.ok(longPos, 'Long position should open cleanly');
            assert.equal(longPos.regime, 'TRENDING_UP');

            // Check expanded TP: stop = 1.5 * 300 = 450, tp = 3.5 * 300 = 1050
            const expectedTp = 86010 + (3.5 * 300);
            assert.equal(longPos.takeProfit, expectedTp);

            // Check CNS broadcast
            const openEvent = publishedEvents.find(e => e.topic === TOPICS.HIVE_TRADE_OPEN);
            assert.ok(openEvent, 'Trade open must be published over CNS');
            assert.equal(openEvent.payload.position.symbol, 'BTC-USDT-SWAP');
        });

        test('closePosition broadcasts to CNS and updates EnterpriseRiskGate', () => {
            const closed = engine.closePosition('bizzy', 87060, 'TAKE_PROFIT');
            assert.ok(closed, 'Position should close');
            assert.ok(closed.pnl > 0, 'PnL should be positive');

            const closeEvent = publishedEvents.find(e => e.topic === TOPICS.HIVE_TRADE_CLOSE);
            assert.ok(closeEvent, 'Trade close must be published over CNS');
            assert.equal(closeEvent.payload.exitReason, 'TAKE_PROFIT');

            // Risk gate position table should be cleared
            assert.equal(mockRiskGate.activePositions.size, 0);
        });
    });
});
