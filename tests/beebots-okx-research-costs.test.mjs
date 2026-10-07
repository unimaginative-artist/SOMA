import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompletedCandles, evaluateResearch, replay } from '../scripts/beebots-okx-research.mjs';
import { paperEntryCosts, paperNetPnl } from '../server/trading/BeePaperExecutionCosts.js';

test('OKX history ignores incomplete candles', () => {
    const rows = [
        ['200', '100', '102', '99', '101', '1', '0', '0', '0'],
        ['100', '100', '102', '99', '101', '1', '0', '0', '1']
    ];
    assert.deepEqual(parseCompletedCandles(rows).map(bar => bar.ts), [100]);
});

test('paper costs reduce a break-even trade and reserve funding by held interval', () => {
    const entry = paperEntryCosts(100, 1);
    const samePrice = paperNetPnl({ side: 'LONG', entryPrice: 100, exitPrice: 100,
        size: 1, heldMs: 9 * 60 * 60 * 1000, entryCosts: entry });
    assert.equal(entry.fee, 0.05);
    assert.ok(samePrice.netPnl < -0.15);
    assert.equal(samePrice.exit.fundingReserve, 0.02);
});

test('research freezes training choice before holdout and never marks proxy eligible', () => {
    const bars = Array.from({ length: 400 }, (_, i) => ({ ts: i * 3600000,
        open: 100 + i * 0.1, high: 101 + i * 0.1, low: 99 + i * 0.1,
        close: 100 + i * 0.1, volume: 1 }));
    const result = evaluateResearch('breezy', bars);
    assert.equal(result.eligibleForPromotion, false);
    assert.equal(result.trainEndTs, bars[279].ts);
    assert.equal(result.holdoutStartTs, bars[280].ts);
    assert.deepEqual(result.frozenParameters, result.trainingCandidates[0].parameters);
    assert.ok(result.holdout.trades.every(trade => trade.entryTs >= bars[280].ts));
    assert.ok(replay('breezy', bars, result.frozenParameters, 280, 400).metrics.modeledCosts >= 0);
});
