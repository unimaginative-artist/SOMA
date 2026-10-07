import { calculateRSI, calculateMACD, calculateBollingerBands } from './TechnicalIndicators.js';

// Pure strategy logic shared by next-bar research and the paper executor.
export function evaluateScalpingSignal(completedBars, { entry = {}, position = null } = {}) {
    const closes = completedBars.slice(-100).map(bar => Number(bar.close));
    const held = reason => ({ action: 'HOLD', confidence: 0, reason, source: 'scalping_confluence' });
    if (closes.length < 36 || closes.some(price => !Number.isFinite(price) || price <= 0)) return held('Scalper needs 36 completed candles');
    const price = closes.at(-1);
    const bb = calculateBollingerBands(closes, 20, 2);
    const rsi = calculateRSI(closes, 14);
    const histogram = calculateMACD(closes).histogram;
    const votes = [price < bb.lower, rsi < Number(entry.rsiBuyZone || 45), histogram.at(-2) < 0 && histogram.at(-1) > histogram.at(-2)];
    const count = votes.filter(Boolean).length;
    const metadata = { rsi, bandMiddle: bb.middle, votes: count,
        signals: { rsi: { score: votes[1] ? 0.8 : 0 }, bollinger: { score: votes[0] ? 0.8 : 0 }, macd: { score: votes[2] ? 0.8 : 0 } } };
    if (position) return price >= bb.middle
        ? { action: 'SELL', closeOnly: true, confidence: 0.95, reason: 'Scalp mean-reversion exit', metadata }
        : { ...held('Scalp position remains below its mean'), metadata };
    const required = Math.min(3, Math.max(2, Number(entry.requiredSignals) || 2));
    return count >= required && price < bb.middle
        ? { action: 'BUY', confidence: count / 3, reason: `${count}/3 completed-candle scalp signals`, metadata }
        : { ...held(`Scalp confluence ${count}/3; requires ${required}`), metadata };
}
