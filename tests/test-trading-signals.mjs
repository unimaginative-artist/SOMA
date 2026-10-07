/**
 * test-trading-signals.mjs
 *
 * Tests for the three institutional trading improvements:
 *   1. SignalLibrary — 8 alpha signals + adaptive ensemble
 *   2. VWAPExecutor  — TWAP slicing with adverse-move cancel
 *   3. AltDataService — Fear & Greed + Reddit sentiment (live API)
 *
 * Run: node tests/test-trading-signals.mjs
 */

import { signalLibrary } from '../server/finance/SignalLibrary.js';
import { vwapExecutor }   from '../server/finance/VWAPExecutor.js';
import { altDataService } from '../server/finance/AltDataService.js';

let passed = 0;
let failed = 0;

function assert(condition, name, detail = '') {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passed++;
    } else {
        console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Generate synthetic OHLCV bars */
function makeBars(prices, volume = 10000) {
    return prices.map((close, i) => {
        const open  = i === 0 ? close : prices[i - 1];
        const high  = Math.max(open, close) * 1.002;
        const low   = Math.min(open, close) * 0.998;
        return { open, high, low, close, volume };
    });
}

/** Generate a clean uptrend: 100 → 150 */
function uptrendBars(n = 60) {
    const prices = [];
    for (let i = 0; i < n; i++) {
        prices.push(100 + (i / n) * 50 + (Math.random() - 0.5) * 0.5);
    }
    return makeBars(prices, 15000 + Math.random() * 5000);
}

/** Generate a clean downtrend: 150 → 100 */
function downtrendBars(n = 60) {
    const prices = [];
    for (let i = 0; i < n; i++) {
        prices.push(150 - (i / n) * 50 + (Math.random() - 0.5) * 0.5);
    }
    return makeBars(prices, 15000 + Math.random() * 5000);
}

/** Generate choppy bars around a mean */
function noisyBars(n = 60, mean = 120) {
    const prices = [];
    for (let i = 0; i < n; i++) {
        prices.push(mean + (Math.random() - 0.5) * 10);
    }
    return makeBars(prices, 8000 + Math.random() * 4000);
}

// ─── 1. SignalLibrary ─────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log('  1. SignalLibrary — 8-signal ensemble');
console.log('══════════════════════════════════════════');

{
    const bars = uptrendBars(60);
    const price = bars[bars.length - 1].close;
    const result = signalLibrary.analyze(bars, price);

    assert(result != null, 'returns a result object');
    assert(typeof result.composite === 'number', 'composite is a number');
    assert(result.composite >= -1 && result.composite <= 1, `composite in [-1,1] (got ${result.composite?.toFixed(3)})`);
    assert(result.composite > 0, `uptrend → positive composite (got ${result.composite?.toFixed(3)})`);
    assert(typeof result.confidence === 'number', 'confidence is a number');
    assert(result.confidence >= 0 && result.confidence <= 1, `confidence in [0,1] (got ${result.confidence?.toFixed(3)})`);
    assert(typeof result.signals === 'object', 'signals is an object');
    assert(Object.keys(result.signals).length >= 4, `at least 4 signal keys (got ${Object.keys(result.signals).length})`);
    assert(typeof result.inAgreement === 'number', 'inAgreement is a number');
    assert(result.inAgreement >= 0 && result.inAgreement <= 8, `inAgreement in [0,8] (got ${result.inAgreement})`);
    assert(typeof result.recommendation === 'string', 'recommendation is a string');
    assert(['BUY', 'SELL', 'HOLD'].includes(result.recommendation), `recommendation is BUY/SELL/HOLD (got ${result.recommendation})`);
    console.log(`     composite=${result.composite?.toFixed(3)}, inAgreement=${result.inAgreement}/8, rec=${result.recommendation}`);
}

{
    const bars = downtrendBars(60);
    const price = bars[bars.length - 1].close;
    const result = signalLibrary.analyze(bars, price);
    assert(result.composite < 0, `downtrend → negative composite (got ${result.composite?.toFixed(3)})`);
    console.log(`     downtrend composite=${result.composite?.toFixed(3)}, rec=${result.recommendation}`);
}

{
    const bars = noisyBars(60);
    const price = bars[bars.length - 1].close;
    const result = signalLibrary.analyze(bars, price);
    // Noisy market has lower agreement — just check it doesn't crash
    assert(result != null, 'noisy market — no crash');
    console.log(`     noisy composite=${result.composite?.toFixed(3)}, inAgreement=${result.inAgreement}/8`);
}

// Minimum bar count guard
{
    const shortBars = makeBars([100, 101, 102]);
    const result = signalLibrary.analyze(shortBars, 102);
    assert(result != null, 'short bar array — graceful fallback (no crash)');
}

// Adaptive weight update — recordOutcome
{
    const bars = uptrendBars(60);
    const price = bars[bars.length - 1].close;
    const result = signalLibrary.analyze(bars, price);
    const weightsBefore = { ...signalLibrary._weights };

    // Simulate a winning trade — weights should shift toward signals that agreed
    signalLibrary.recordOutcome(result.signals, +0.08); // +8% win
    const weightsAfter = { ...signalLibrary._weights };

    const keys = Object.keys(weightsBefore);
    const anyChanged = keys.some(k => Math.abs(weightsAfter[k] - weightsBefore[k]) > 0.0001);
    assert(anyChanged, 'recordOutcome changes at least one weight');

    // All weights should remain in bounds [0.2, 2.0]
    const allInBounds = keys.every(k => weightsAfter[k] >= 0.19 && weightsAfter[k] <= 2.01);
    assert(allInBounds, 'weights stay within [0.2, 2.0] bounds after recordOutcome');

    // Simulate a losing trade
    signalLibrary.recordOutcome(result.signals, -0.05);
    const weightsAfterLoss = { ...signalLibrary._weights };
    const anyChangedLoss = keys.some(k => Math.abs(weightsAfterLoss[k] - weightsAfter[k]) > 0.0001);
    assert(anyChangedLoss, 'recordOutcome on loss also changes weights');

    console.log(`     weight sample — RSI: ${weightsBefore.rsi?.toFixed(3)} → ${weightsAfter.rsi?.toFixed(3)} (win) → ${weightsAfterLoss.rsi?.toFixed(3)} (loss)`);
}

// ─── 2. VWAPExecutor ─────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log('  2. VWAPExecutor — TWAP slicing');
console.log('══════════════════════════════════════════');

{
    // Small order < $500 → single shot (no slicing)
    const result = await vwapExecutor.execute('AAPL', 'buy', 1, 100, { paperMode: true, slices: 6, intervalMs: 10 });
    assert(result != null, 'small order returns a result');
    assert(result.mode === 'single', `small order uses single mode (got ${result.mode})`);
    assert(result.totalFilled === 1, `small order fills full qty (got ${result.totalFilled})`);
    assert(result.fills.length === 1, `single mode has 1 fill (got ${result.fills.length})`);
    assert(result.savings === 0, `single mode has 0 savings (got ${result.savings})`);
    console.log(`     single shot: qty=${result.totalFilled}, price=$${result.avgPrice?.toFixed(2)}`);
}

{
    // Large order > $500 → TWAP slicing (paper mode, fast intervals)
    // 10 shares × $200 = $2000 notional → will slice
    const result = await vwapExecutor.execute('TSLA', 'buy', 10, 200, {
        paperMode: true,
        slices: 4,
        intervalMs: 50, // 50ms for fast testing
    });
    assert(result != null, 'large order returns a result');
    assert(result.mode === 'twap', `large order uses TWAP mode (got ${result.mode})`);
    assert(result.totalFilled > 0, `TWAP fills some qty (got ${result.totalFilled})`);
    assert(result.fills.length > 1, `TWAP has multiple fills (got ${result.fills.length})`);
    assert(typeof result.avgPrice === 'number', `avgPrice is a number (got ${result.avgPrice})`);
    assert(result.savings >= 0, `savings non-negative (got ${result.savings})`);
    assert(result.status !== 'failed', `TWAP status not failed (got ${result.status})`);
    console.log(`     TWAP: slices=${result.slicesExecuted}/${4}, qty=${result.totalFilled}/10, avg=$${result.avgPrice?.toFixed(2)}, savings=$${result.savings?.toFixed(2)}`);
}

{
    // Sell order
    const result = await vwapExecutor.execute('SPY', 'sell', 5, 500, {
        paperMode: true,
        slices: 3,
        intervalMs: 50,
    });
    assert(result != null, 'sell order returns a result');
    assert(result.totalFilled > 0, `sell fills some qty (got ${result.totalFilled})`);
    console.log(`     sell: mode=${result.mode}, qty=${result.totalFilled}/5`);
}

{
    // cancel() API
    vwapExecutor.cancel('NOPE');  // Non-existent — should not throw
    assert(true, 'cancel() on non-existent symbol does not throw');
}

// ─── 3. AltDataService ───────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log('  3. AltDataService — live API calls');
console.log('══════════════════════════════════════════');
console.log('  (network calls — may take a few seconds)');

{
    // getScore composite — crypto
    const result = await altDataService.getScore('BTC-USD');
    assert(result != null, 'getScore(BTC-USD) returns a result');
    assert(typeof result.score === 'number', `score is a number (got ${result.score})`);
    assert(result.score >= -1 && result.score <= 1, `score in [-1,1] (got ${result.score?.toFixed(3)})`);
    assert(typeof result.confidence === 'number', `confidence is a number (got ${result.confidence})`);
    assert(typeof result.label === 'string', `label is a string (got ${result.label})`);
    console.log(`     BTC composite: score=${result.score?.toFixed(3)}, confidence=${result.confidence?.toFixed(2)}, label=${result.label}, sources=${result.sourcesActive}`);
}

{
    // getFearGreed — crypto
    const fg = await altDataService.getFearGreed('BTC-USD');
    // May return null if API is down — just don't crash
    if (fg) {
        assert(typeof fg.score === 'number', `F&G crypto score is a number (got ${fg.score})`);
        assert(fg.score >= -1 && fg.score <= 1, `F&G crypto score in [-1,1] (got ${fg.score})`);
        assert(fg.source === 'alternative.me', `F&G crypto source correct (got ${fg.source})`);
        console.log(`     Crypto F&G: value=${fg.value}, label=${fg.label}, score=${fg.score}`);
    } else {
        console.log('     Crypto F&G: API unavailable (null returned — OK, graceful degradation)');
        assert(true, 'F&G crypto — graceful null on failure');
    }
}

{
    // getFearGreed — equity
    const fg = await altDataService.getFearGreed('AAPL');
    if (fg) {
        assert(typeof fg.score === 'number', `F&G equity score is a number (got ${fg.score})`);
        assert(fg.source === 'CNN', `F&G equity source is CNN (got ${fg.source})`);
        console.log(`     Equity F&G: value=${fg.value}, label=${fg.label}, score=${fg.score}`);
    } else {
        console.log('     Equity F&G: API unavailable (null — OK)');
        assert(true, 'F&G equity — graceful null on failure');
    }
}

{
    // getRedditSentiment — crypto
    const rd = await altDataService.getRedditSentiment('BTC');
    if (rd) {
        assert(typeof rd.score === 'number', `Reddit score is a number (got ${rd.score})`);
        assert(rd.score >= -1 && rd.score <= 1, `Reddit score in [-1,1] (got ${rd.score})`);
        assert(typeof rd.mentions === 'number', `mentions is a number (got ${rd.mentions})`);
        console.log(`     Reddit BTC: mentions=${rd.mentions}, score=${rd.score?.toFixed(3)}, bull=${rd.bullScore?.toFixed(1)}, bear=${rd.bearScore?.toFixed(1)}`);
    } else {
        console.log('     Reddit BTC: API unavailable (null — OK)');
        assert(true, 'Reddit — graceful null on failure');
    }
}

{
    // Cache: second call should hit cache (fast)
    const t0 = Date.now();
    await altDataService.getScore('BTC-USD');
    const elapsed = Date.now() - t0;
    assert(elapsed < 200, `second call uses cache — fast (${elapsed}ms < 200ms)`);
}

{
    // Stats
    const stats = altDataService.getStats();
    assert(typeof stats.fetchCount === 'number', 'getStats() returns fetchCount');
    assert(typeof stats.errorRate === 'string' || typeof stats.errorRate === 'number', 'getStats() returns errorRate');
    console.log(`     AltData stats: fetches=${stats.fetchCount}, errors=${stats.errorCount}, errorRate=${stats.errorRate}`);
}

// ─── summary ──────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
