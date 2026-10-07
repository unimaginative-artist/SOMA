/**
 * soma-bee-autonomic-tuner.test.mjs
 *
 * Unit tests for BeeAutonomicTuner:
 *  - Anti-revenge stop-loss cooldown timers
 *  - Autonomic streak and drawdown adaptation (defensive gating)
 *  - Higher-Timeframe (HTF) trend alignment guards
 *  - State serialization and ledger restoration
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BeeAutonomicTuner } from '../server/trading/BeeAutonomicTuner.js';

describe('SOMA BeeAutonomicTuner Edge Controls', () => {

    test('Anti-revenge cooldown triggers on STOP_LOSS and blocks same-side re-entry', () => {
        const tuner = new BeeAutonomicTuner({ stopLossCooldownMs: 15 * 60 * 1000 });

        // Initial state: not under cooldown
        assert.equal(tuner.isUnderCooldown('ETH-USDT-SWAP', 'SHORT').active, false);

        // Register a STOP_LOSS exit
        tuner.registerClosedTrade({
            bee: 'boozy',
            symbol: 'ETH-USDT-SWAP',
            side: 'SHORT',
            exitReason: 'STOP_LOSS',
            pnl: -9.65
        });

        // Cooldown should now be active for SHORT on ETH
        const cdShort = tuner.isUnderCooldown('ETH-USDT-SWAP', 'SHORT');
        assert.equal(cdShort.active, true);
        assert.ok(cdShort.remainingMins > 0);

        // Other side (LONG) or symbol (BTC) should NOT be blocked
        assert.equal(tuner.isUnderCooldown('ETH-USDT-SWAP', 'LONG').active, false);
        assert.equal(tuner.isUnderCooldown('BTC-USDT-SWAP', 'SHORT').active, false);
    });

    test('Consecutive losses trigger defensive modulation (minConviction=3, 1% risk)', () => {
        const tuner = new BeeAutonomicTuner();

        // 1st loss
        tuner.registerClosedTrade({ bee: 'boozy', symbol: 'ETH-USDT-SWAP', side: 'SHORT', exitReason: 'SYSTEM1_CLOSE', pnl: -1.0 });
        let adj = tuner.getBeeAdjustments('boozy');
        assert.equal(adj.consecutiveLosses, 1);
        assert.equal(adj.status, 'NORMAL');
        assert.equal(adj.minConviction, 2);

        // 2nd loss (triggers defensive mode)
        tuner.registerClosedTrade({ bee: 'boozy', symbol: 'ETH-USDT-SWAP', side: 'SHORT', exitReason: 'STOP_LOSS', pnl: -10.0 });
        adj = tuner.getBeeAdjustments('boozy');
        assert.equal(adj.consecutiveLosses, 2);
        assert.equal(adj.status, 'DEFENSIVE');
        assert.equal(adj.minConviction, 3, 'Conviction bar escalated to 3');
        assert.equal(adj.riskPerTradePct, 0.01, 'Risk budget halved to 1%');
        assert.equal(adj.rsiOverbought, 76, 'Mean-reversion band widened to 76');

        // One win cannot immediately undo the loss-streak protection.
        tuner.registerClosedTrade({ bee: 'boozy', symbol: 'ETH-USDT-SWAP', side: 'LONG', exitReason: 'TAKE_PROFIT', pnl: 8.0 });
        adj = tuner.getBeeAdjustments('boozy');
        assert.equal(adj.status, 'DEFENSIVE');
        assert.equal(adj.minConviction, 3);
        assert.equal(adj.riskPerTradePct, 0.01);
        assert.equal(adj.rsiOverbought, 76);

        // Two consecutive wins restore NORMAL status.
        tuner.registerClosedTrade({ bee: 'boozy', symbol: 'ETH-USDT-SWAP', side: 'LONG', exitReason: 'TAKE_PROFIT', pnl: 8.0 });
        adj = tuner.getBeeAdjustments('boozy');
        assert.equal(adj.status, 'NORMAL');
        assert.equal(adj.minConviction, 2);
        assert.equal(adj.riskPerTradePct, 0.02);
        assert.equal(adj.rsiOverbought, 70);
    });

    test('HTF trend filter suppresses counter-trend fades without extreme blowout', () => {
        const tuner = new BeeAutonomicTuner();

        // Market in Bullish HTF trend
        const bullMarket = {
            instId: 'ETH-USDT-SWAP',
            htfTrend: 'BULLISH',
            rsi_14: 72,
            bollinger: { percent_b: 0.92 }
        };

        // Standard short fade should be blocked against HTF bull trend
        const shortCheck = tuner.checkHtfAlignment('boozy', 'SHORT', bullMarket);
        assert.equal(shortCheck.allowed, false);
        assert.match(shortCheck.reason, /Counter-trend SHORT suppressed/);

        // Dip buy in HTF bull trend should be allowed
        const longCheck = tuner.checkHtfAlignment('boozy', 'LONG', bullMarket);
        assert.equal(longCheck.allowed, true);

        // Extreme blowout short (RSI > 78 and %B > 1.05) should be allowed
        const blowoffMarket = {
            instId: 'ETH-USDT-SWAP',
            htfTrend: 'BULLISH',
            rsi_14: 81,
            bollinger: { percent_b: 1.08 }
        };
        const blowoffCheck = tuner.checkHtfAlignment('boozy', 'SHORT', blowoffMarket);
        assert.equal(blowoffCheck.allowed, true);
    });

    test('State serialization and restoration preserves tuning across restarts', () => {
        const tuner1 = new BeeAutonomicTuner();
        tuner1.registerClosedTrade({ bee: 'bizzy', symbol: 'BTC-USDT-SWAP', side: 'LONG', exitReason: 'STOP_LOSS', pnl: -5.0 });
        tuner1.registerClosedTrade({ bee: 'bizzy', symbol: 'BTC-USDT-SWAP', side: 'LONG', exitReason: 'STOP_LOSS', pnl: -5.0 });

        const serialized = tuner1.getState();
        assert.equal(serialized.bizzy.status, 'DEFENSIVE');
        assert.equal(serialized.bizzy.minConviction, 3);

        const tuner2 = new BeeAutonomicTuner();
        tuner2.loadState(serialized);
        assert.equal(tuner2.getBeeAdjustments('bizzy').status, 'DEFENSIVE');
        assert.equal(tuner2.getBeeAdjustments('bizzy').minConviction, 3);
    });
});
