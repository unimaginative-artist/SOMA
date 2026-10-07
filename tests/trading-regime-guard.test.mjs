import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingPerformanceGuard, TOXIC_STRATEGIES } from '../server/finance/TradingPerformanceGuard.js';

test('TradingPerformanceGuard: permanently quarantines blacklisted toxic strategies', () => {
    const guard = new TradingPerformanceGuard({ tradeSource: { db: {}, getClosedTrades: () => [] } });
    
    assert.ok(TOXIC_STRATEGIES.has('full_aggression'));
    assert.ok(TOXIC_STRATEGIES.has('daviddtech_keltner'));
    
    const verdict = guard.evaluate({ symbol: 'ETH-USD', strategyId: 'full_aggression' });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.action, 'quarantine');
    assert.ok(verdict.reasons.some(r => r.includes('blacklisted')));
});

test('TradingPerformanceGuard: enforces hard -$5.00 loss circuit breaker on early trades', () => {
    const losingTrades = [
        { id: 1, strategy: 'some_bot', symbol: 'BTC-USD', status: 'closed', pnl: -2.50 },
        { id: 2, strategy: 'some_bot', symbol: 'BTC-USD', status: 'closed', pnl: -1.80 },
        { id: 3, strategy: 'some_bot', symbol: 'BTC-USD', status: 'closed', pnl: -1.20 }
    ]; // total = -5.50 on 3 trades
    
    const guard = new TradingPerformanceGuard({ tradeSource: { db: {}, getClosedTrades: () => losingTrades } });
    const verdict = guard.evaluate({ symbol: 'BTC-USD', strategyId: 'some_bot' });
    
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.action, 'quarantine');
    assert.ok(verdict.reasons.some(r => r.includes('hard loss threshold')));
});

test('TradingPerformanceGuard: evaluateTradeRisk validates risk %, 2R reward, and regime gating', () => {
    const guard = new TradingPerformanceGuard({ tradeSource: { db: {}, getClosedTrades: () => [] } });

    // 1. Blacklisted strategy
    const toxicCheck = guard.evaluateTradeRisk({
        symbol: 'ETH-USD',
        strategyId: 'full_aggression',
        entryPrice: 3000,
        stopLoss: 2970,
        takeProfit: 3070
    });
    assert.equal(toxicCheck.allowed, false);
    assert.ok(toxicCheck.reason.includes('blacklisted'));

    // 2. Risk exceeds 2.0%
    const highRisk = guard.evaluateTradeRisk({
        symbol: 'BTC-USD',
        strategyId: 'safe_bot',
        entryPrice: 60000,
        stopLoss: 58000, // 3.33% risk
        takeProfit: 65000,
        side: 'long'
    });
    assert.equal(highRisk.allowed, false);
    assert.ok(highRisk.reason.includes('exceeds max allowable 2.0%'));

    // 3. Risk-to-reward ratio < 2.0R
    const lowReward = guard.evaluateTradeRisk({
        symbol: 'BTC-USD',
        strategyId: 'safe_bot',
        entryPrice: 60000,
        stopLoss: 59400, // 1% risk ($600)
        takeProfit: 60900, // 1.5R reward ($900)
        side: 'long'
    });
    assert.equal(lowReward.allowed, false);
    assert.ok(lowReward.reason.includes('below minimum required 2.0R'));

    // 4. Regime gate blocks trend trade in RANGING market
    const rangingCheck = guard.evaluateTradeRisk({
        symbol: 'BTC-USD',
        strategyId: 'safe_bot',
        entryPrice: 60000,
        stopLoss: 59400, // 1% risk
        takeProfit: 61500, // 2.5R reward
        side: 'long',
        regime: { regime: 'RANGING', adxProxy: 0.18 }
    });
    assert.equal(rangingCheck.allowed, false);
    assert.ok(rangingCheck.reason.includes('Regime gate blocked'));

    // 5. Valid trade in TRENDING_UP market with ADX >= 0.25
    const validTrade = guard.evaluateTradeRisk({
        symbol: 'BTC-USD',
        strategyId: 'safe_bot',
        entryPrice: 60000,
        stopLoss: 59400, // 1% risk
        takeProfit: 61500, // 2.5R reward ($1500 / $600 = 2.5)
        side: 'long',
        regime: { regime: 'TRENDING_UP', adxProxy: 0.35 }
    });
    assert.equal(validTrade.allowed, true);
    assert.equal(validTrade.riskPct, 1.0);
    assert.equal(validTrade.riskRewardRatio, 2.5);
});
