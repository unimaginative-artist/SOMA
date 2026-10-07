/**
 * SignalLibrary — Ensemble of independent alpha signals
 *
 * Each signal scores -1.0 to +1.0:
 *   -1 = strong sell,  0 = neutral,  +1 = strong buy
 *
 * Signals are weighted by recent accuracy (adaptive weight decay).
 * The ensemble blends all signals into one confidence-weighted vote.
 * This is the same architecture as quant funds — many weak signals,
 * combined they produce a robust edge.
 */

import fs from 'fs';
import path from 'path';

export const SIGNAL_LEARNING_VERSION = 2;

export class SignalLibrary {
    constructor({ weightsFile = path.join(process.cwd(), 'data', 'trading', 'signal-weights.json'), load = true } = {}) {
        this._weightsFile = weightsFile;

        // Initial equal weights — adapt over time via recordOutcome()
        this._weights = {
            rsi:            1.0,
            sma:            1.0,
            momentum:       1.0,
            vpt:            1.0,   // Volume Price Trend (accumulation/distribution)
            bollinger:      1.0,
            macd:           1.0,
            breakout:       1.0,
            microstructure: 0.8,   // Noisier — lower initial weight
            volumeSurge:    0.9,   // Abnormal volume on directional candles
            optionsIV:      0.7,   // IV/VIX regime signal (async, scored externally)
        };
        this._lastIVScore = null; // set by AutonomousTrader after each IV fetch

        this._outcomeHistory = []; // { signalScores, pnlPct, timestamp }
        this._maxHistory = 200;
        this._outcomesSinceLastSave = 0;
        this._processedTradeIds = new Set();
        this._legacyWeightsNeedBackup = false;

        if (load) this._loadWeights();
    }

    _loadWeights() {
        try {
            if (fs.existsSync(this._weightsFile)) {
                const saved = JSON.parse(fs.readFileSync(this._weightsFile, 'utf8'));
                // Version 1 compared {score, reason} objects with numbers and
                // rewarded every signal on losses. Rebuild from the closed ledger.
                if (saved.learningVersion !== SIGNAL_LEARNING_VERSION) {
                    this._legacyWeightsNeedBackup = true;
                    console.warn('[SignalLibrary] Legacy learning weights excluded; awaiting closed-trade replay');
                    return;
                }
                if (saved.weights) {
                    for (const [k, v] of Object.entries(saved.weights)) {
                        if (this._weights[k] !== undefined && Number.isFinite(v)) this._weights[k] = Math.min(2, Math.max(0.2, v));
                    }
                }
                this._processedTradeIds = new Set((saved.processedTradeIds || []).map(String));
                if (saved.outcomeHistory) {
                    this._outcomeHistory = saved.outcomeHistory.slice(-this._maxHistory);
                }
                console.log('[SignalLibrary] Restored learned weights from disk');
            }
        } catch { /* fresh start */ }
    }

    saveWeights() {
        try {
            const dir = path.dirname(this._weightsFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (this._legacyWeightsNeedBackup && fs.existsSync(this._weightsFile)) {
                const backup = `${this._weightsFile}.pre-v2-${Date.now()}.bak`;
                fs.copyFileSync(this._weightsFile, backup, fs.constants.COPYFILE_EXCL);
                this._legacyWeightsNeedBackup = false;
            }
            const temporary = `${this._weightsFile}.${process.pid}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify({
                learningVersion: SIGNAL_LEARNING_VERSION,
                processedTradeIds: [...this._processedTradeIds],
                weights: { ...this._weights },
                outcomeHistory: this._outcomeHistory.slice(-50), // save last 50 for context
                savedAt: new Date().toISOString()
            }, null, 2));
            fs.renameSync(temporary, this._weightsFile);
            this._outcomesSinceLastSave = 0;
        } catch (err) {
            console.warn('[SignalLibrary] Failed to save weights:', err.message);
        }
    }

    /**
     * Run all signals, return ensemble vote
     * @param {Array}  bars         - OHLCV bar array
     * @param {number} currentPrice
     * @returns {{ action, confidence, composite, reason, signals, recommendation }}
     */
    analyze(bars, currentPrice) {
        if (!bars || bars.length < 20) {
            return { action: 'HOLD', confidence: 0, composite: 0, reason: 'Insufficient bar data', signals: {}, recommendation: 'HOLD' };
        }

        const signals = {
            rsi:            this._rsiSignal(bars, currentPrice),
            sma:            this._smaSignal(bars, currentPrice),
            momentum:       this._momentumSignal(bars, currentPrice),
            vpt:            this._vptSignal(bars),
            bollinger:      this._bollingerSignal(bars, currentPrice),
            macd:           this._macdSignal(bars),
            breakout:       this._breakoutSignal(bars, currentPrice),
            microstructure: this._microstructureSignal(bars),
            volumeSurge:    this._volumeSurgeSignal(bars),
        };

        return this._ensemble(signals);
    }

    // ── Signal Implementations ────────────────────────────────────────────────

    /** Signal 1: RSI Mean Reversion — oversold = buy, overbought = sell */
    _rsiSignal(bars, currentPrice) {
        const closes = bars.map(b => b.close);
        const rsi    = this._rsi(closes, 14);
        let score    = 0;
        let reason   = '';

        if      (rsi < 20) { score = 1.0;  reason = `RSI ${rsi.toFixed(1)} extreme oversold`; }
        else if (rsi < 30) { score = 0.75; reason = `RSI ${rsi.toFixed(1)} oversold`; }
        else if (rsi < 40) { score = 0.3;  reason = `RSI ${rsi.toFixed(1)} leaning oversold`; }
        else if (rsi > 80) { score = -1.0; reason = `RSI ${rsi.toFixed(1)} extreme overbought`; }
        else if (rsi > 70) { score = -0.75;reason = `RSI ${rsi.toFixed(1)} overbought`; }
        else if (rsi > 60) { score = -0.3; reason = `RSI ${rsi.toFixed(1)} leaning overbought`; }
        else               { score = (50 - rsi) / 100; reason = `RSI ${rsi.toFixed(1)} neutral`; }

        return { score: this._clamp(score), reason, meta: { rsi } };
    }

    /** Signal 2: SMA Crossover — golden/death cross with trend strength */
    _smaSignal(bars, currentPrice) {
        const closes = bars.map(b => b.close);
        const sma10  = this._sma(closes, 10);
        const sma20  = this._sma(closes, 20);
        const sma50  = closes.length >= 50 ? this._sma(closes, 50) : sma20;
        const sep    = (sma10 - sma20) / (sma20 || 1);

        let score = 0, reason = '';

        if      (sma10 > sma20 && sma20 > sma50) { score = this._clamp(0.5 + sep * 15); reason = `Full bullish MA alignment`; }
        else if (sma10 < sma20 && sma20 < sma50) { score = this._clamp(-0.5 + sep * 15); reason = `Full bearish MA alignment`; }
        else if (sma10 > sma20)                  { score = 0.25; reason = `Short-term bullish cross`; }
        else                                      { score = -0.25; reason = `Short-term bearish cross`; }

        return { score: this._clamp(score), reason, meta: { sma10, sma20, sma50 } };
    }

    /** Signal 3: Multi-timeframe Momentum — compound ROC */
    _momentumSignal(bars, currentPrice) {
        const closes = bars.map(b => b.close);
        const roc = (n) => closes.length >= n
            ? (currentPrice - closes[closes.length - n]) / (closes[closes.length - n] || 1)
            : 0;

        const composite = roc(5) * 0.5 + roc(10) * 0.3 + roc(20) * 0.2;
        const score = this._clamp(composite * 30); // 3.3% move = score 1.0

        return {
            score,
            reason: `Momentum ROC 5b=${(roc(5)*100).toFixed(2)}% 10b=${(roc(10)*100).toFixed(2)}% 20b=${(roc(20)*100).toFixed(2)}%`,
            meta: { roc5: roc(5), roc10: roc(10), roc20: roc(20) }
        };
    }

    /** Signal 4: Volume Price Trend — accumulation vs distribution */
    _vptSignal(bars) {
        const recent    = bars.slice(-20);
        const last5     = bars.slice(-5);
        const avgVol    = recent.reduce((s, b) => s + (b.volume || 0), 0) / (recent.length || 1) || 1;

        const clv = (bar) => {
            const range = (bar.high - bar.low) || 1;
            return ((bar.close - bar.low) - (bar.high - bar.close)) / range; // -1 to +1
        };

        const recentFlow = last5.reduce((s, b) => s + clv(b) * (b.volume || 1), 0);
        const normalized = recentFlow / (avgVol * 5);
        const score = this._clamp(normalized);

        return {
            score,
            reason: `VPT ${score > 0.1 ? 'accumulation' : score < -0.1 ? 'distribution' : 'neutral'} (${score.toFixed(3)})`,
            meta: { recentFlow, normalized }
        };
    }

    /** Signal 5: Bollinger Band — mean reversion + squeeze detection */
    _bollingerSignal(bars, currentPrice) {
        const closes  = bars.map(b => b.close).slice(-20);
        const sma     = this._sma(closes, 20);
        const stddev  = Math.sqrt(closes.reduce((s, v) => s + (v - sma) ** 2, 0) / closes.length);
        const upper   = sma + 2 * stddev;
        const lower   = sma - 2 * stddev;
        const pctB    = (currentPrice - lower) / ((upper - lower) || 1);
        const bw      = (upper - lower) / (sma || 1);

        // Historical bandwidth for squeeze detection
        const prevCloses = bars.map(b => b.close).slice(-40, -20);
        let prevBW = bw;
        if (prevCloses.length >= 20) {
            const ps  = this._sma(prevCloses, 20);
            const psd = Math.sqrt(prevCloses.reduce((s, v) => s + (v - ps) ** 2, 0) / prevCloses.length);
            prevBW    = (ps + 2*psd - (ps - 2*psd)) / (ps || 1);
        }
        const isSqueeze = bw < prevBW * 0.75;

        let score = 0, reason = '';
        if      (pctB < 0.0)  { score = 1.0;  reason = `Below lower BB${isSqueeze ? ' + SQUEEZE' : ''}`; }
        else if (pctB < 0.15) { score = 0.7;  reason = `Near lower BB (${(pctB*100).toFixed(0)}%)${isSqueeze ? ' + SQUEEZE' : ''}`; }
        else if (pctB < 0.35) { score = 0.3;  reason = `Lower-mid BB (${(pctB*100).toFixed(0)}%)`; }
        else if (pctB > 1.0)  { score = -1.0; reason = `Above upper BB${isSqueeze ? ' + SQUEEZE' : ''}`; }
        else if (pctB > 0.85) { score = -0.7; reason = `Near upper BB (${(pctB*100).toFixed(0)}%)${isSqueeze ? ' + SQUEEZE' : ''}`; }
        else if (pctB > 0.65) { score = -0.3; reason = `Upper-mid BB (${(pctB*100).toFixed(0)}%)`; }
        else                  { score = (0.5 - pctB) * 0.4; reason = `Mid BB (${(pctB*100).toFixed(0)}%)`; }

        return { score: this._clamp(score), reason, meta: { pctB, bw, isSqueeze, upper, lower, sma } };
    }

    /** Signal 6: MACD — trend direction and momentum change */
    _macdSignal(bars) {
        const closes = bars.map(b => b.close);
        if (closes.length < 26) return { score: 0, reason: 'Need 26+ bars for MACD', meta: {} };

        const ema12   = this._ema(closes, 12);
        const ema26   = this._ema(closes, 26);
        const macd    = ema12 - ema26;

        // Approximate signal line: EMA of recent MACD values
        const macdSeries = [];
        for (let i = 26; i <= closes.length; i++) {
            const sl = closes.slice(0, i);
            macdSeries.push(this._ema(sl, 12) - this._ema(sl, 26));
        }
        const signal   = this._ema(macdSeries, 9);
        const histogram = macd - signal;

        let score = 0, reason = '';
        if (macd > 0 && histogram > 0)       { score = Math.min(0.8, Math.abs(histogram) / (Math.abs(ema26) * 0.005)); reason = `MACD bullish + expanding histogram`; }
        else if (macd < 0 && histogram < 0)  { score = Math.max(-0.8, -Math.abs(histogram) / (Math.abs(ema26) * 0.005)); reason = `MACD bearish + expanding histogram`; }
        else if (macd > 0 && histogram < 0)  { score = 0.15;  reason = `MACD positive, histogram contracting`; }
        else                                  { score = -0.15; reason = `MACD negative, histogram contracting`; }

        return { score: this._clamp(score), reason, meta: { macd, signal, histogram } };
    }

    /** Signal 7: Breakout with volume confirmation */
    _breakoutSignal(bars, currentPrice) {
        const window  = bars.slice(-21, -1); // Exclude last bar for prev high/low
        if (window.length < 5) return { score: 0, reason: 'Insufficient data', meta: {} };

        const prevHigh  = Math.max(...window.map(b => b.high));
        const prevLow   = Math.min(...window.map(b => b.low));
        const avgVol    = window.reduce((s, b) => s + (b.volume || 0), 0) / window.length || 1;
        const lastVol   = bars[bars.length - 1]?.volume || 0;
        const volRatio  = lastVol / avgVol;
        const volConf   = Math.min(2.0, volRatio); // Cap at 2x

        let score = 0, reason = '';
        if      (currentPrice > prevHigh * 1.002) { score = Math.min(1.0, 0.55 + volConf * 0.25); reason = `Breakout above ${prevHigh.toFixed(2)} (vol ${volRatio.toFixed(1)}x)`; }
        else if (currentPrice < prevLow * 0.998)  { score = Math.max(-1.0, -0.55 - volConf * 0.25); reason = `Breakdown below ${prevLow.toFixed(2)} (vol ${volRatio.toFixed(1)}x)`; }
        else {
            const range = (prevHigh - prevLow) || 1;
            const pos   = (currentPrice - prevLow) / range;
            score = (pos - 0.5) * 0.4;
            reason = `In range at ${(pos*100).toFixed(0)}% (H:${prevHigh.toFixed(0)} L:${prevLow.toFixed(0)})`;
        }

        return { score: this._clamp(score), reason, meta: { prevHigh, prevLow, volRatio } };
    }

    /** Signal 8: Market Microstructure — bar body/wick analysis */
    _microstructureSignal(bars) {
        const recent = bars.slice(-10);
        let bodyDir  = 0;
        let bodyConv = 0;

        for (const b of recent) {
            const range  = (b.high - b.low) || 1;
            const body   = Math.abs(b.close - b.open);
            const dir    = b.close >= b.open ? 1 : -1;
            bodyDir  += dir * (body / range);
            bodyConv += body / range;
        }
        bodyDir  /= recent.length;
        bodyConv /= recent.length;

        const last    = bars[bars.length - 1];
        const lRange  = (last.high - last.low) || 1;
        const upWick  = last.high - Math.max(last.open, last.close);
        const dnWick  = Math.min(last.open, last.close) - last.low;
        const wickBias = (dnWick - upWick) / lRange; // + = more lower wick = bullish rejection

        const score = this._clamp(bodyDir * 0.65 + wickBias * 0.35);
        return {
            score,
            reason: `Micro: body=${(bodyConv*100).toFixed(0)}% dir=${bodyDir.toFixed(2)} wickBias=${wickBias.toFixed(2)}`,
            meta: { bodyDir, bodyConv, wickBias }
        };
    }

    /** Signal 9: Volume Surge — high-volume directional candles */
    _volumeSurgeSignal(bars) {
        if (bars.length < 20) return { score: 0, reason: 'Insufficient data', meta: {} };
        const last20 = bars.slice(-20);
        const avgVol = last20.reduce((s, b) => s + (b.volume || 0), 0) / 20 || 1;
        const curr = bars[bars.length - 1];
        const currVol = curr.volume || 0;
        const volRatio = currVol / avgVol;
        if (volRatio < 0.5) return { score: 0, reason: `Thin volume (${volRatio.toFixed(1)}x avg)`, meta: { volRatio } };
        const bodySize = Math.abs(curr.close - curr.open);
        const barRange = (curr.high - curr.low) || 1;
        const directionStrength = bodySize / barRange;
        const isBullish = curr.close > curr.open;
        const surgeBonus = Math.max(0, (volRatio - 1.0) / 2.0);
        const rawScore = surgeBonus * directionStrength;
        const score = this._clamp(isBullish ? rawScore : -rawScore);
        const reason = `VolSurge ${volRatio.toFixed(1)}x avg ${isBullish ? '▲' : '▼'} dir=${(directionStrength * 100).toFixed(0)}%`;
        return { score, reason, meta: { volRatio, directionStrength, isBullish } };
    }

    // ── Ensemble ──────────────────────────────────────────────────────────────

    _ensemble(signals) {
        let weightedSum = 0;
        let totalWeight = 0;
        const details   = {};

        for (const [name, sig] of Object.entries(signals)) {
            const w     = Math.max(0.1, this._weights[name] || 1.0);
            weightedSum += sig.score * w;
            totalWeight += w;
            details[name] = { score: sig.score, reason: sig.reason };
        }

        const composite  = totalWeight > 0 ? weightedSum / totalWeight : 0;
        const confidence = Math.min(0.95, Math.abs(composite) * 1.5);

        // Agreement count — how many signals agree with composite direction
        const inAgreement = Object.values(signals).filter(s =>
            (composite > 0 && s.score > 0.1) || (composite < 0 && s.score < -0.1)
        ).length;
        const totalSignals = Object.keys(signals).length; // 8 internal + optionsIV tracked externally
        const agreementBonus = inAgreement >= 6 ? 0.1 : inAgreement >= 4 ? 0.05 : 0;

        const finalConf   = Math.min(0.97, confidence + agreementBonus);
        const action      = composite >= 0.18 ? 'BUY' : composite <= -0.18 ? 'SELL' : 'HOLD';

        // Top 3 driving signals for human-readable reason
        const top3 = Object.entries(details)
            .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score))
            .slice(0, 3)
            .map(([k, v]) => `${k}:${v.score > 0 ? '+' : ''}${v.score.toFixed(2)}`);

        return {
            action,
            confidence: finalConf,
            composite,
            reason:         `SignalLib(${composite.toFixed(3)}) ${inAgreement}/${totalSignals} agree | ${top3.join(' ')}`,
            recommendation: action,
            signals:        details,
            inAgreement,
        };
    }

    // ── Adaptive Weight Update ─────────────────────────────────────────────────

    /**
     * Call after a trade closes to update signal weights.
     * @param {Object} signalScoresAtEntry  - { rsi: 0.7, sma: -0.2, ... } at trade entry
     * @param {number} pnlPct               - realized P&L as fraction (0.02 = +2%)
     */
    recordOutcome(signalScoresAtEntry, pnlPct, { side = 'buy', tradeId = null } = {}) {
        if (!signalScoresAtEntry || !Number.isFinite(pnlPct)) return false;
        const id = tradeId == null ? null : String(tradeId);
        if (id && this._processedTradeIds.has(id)) return false;
        const direction = ['buy', 'long'].includes(String(side).toLowerCase()) ? 1
            : ['sell', 'short'].includes(String(side).toLowerCase()) ? -1 : 0;
        if (!direction) return false;

        const lr    = 0.04;  // Learning rate
        const allScores = {};
        for (const [name, value] of Object.entries(signalScoresAtEntry)) {
            const score = typeof value === 'number' ? value : value?.score;
            if (!Number.isFinite(score) || !(name in this._weights)) continue;
            allScores[name] = score;
        }
        if (!Object.keys(allScores).length) return false;
        for (const [name, score] of Object.entries(allScores)) {
            if (Math.abs(score) < 0.15) continue; // Signal wasn't decisive — skip
            if (pnlPct === 0) continue; // Flat outcomes contain no directional evidence.
            // Reward agreement with a profitable position, accounting for shorts.
            // This measures net trade utility, not a calibrated win probability.
            const correct = Math.sign(score) * direction * Math.sign(pnlPct) > 0;
            if (correct) {
                this._weights[name] = Math.min(2.0, (this._weights[name] || 1.0) * (1 + lr));
            } else {
                this._weights[name] = Math.max(0.2, (this._weights[name] || 1.0) * (1 - lr));
            }
        }

        if (id) this._processedTradeIds.add(id);
        this._outcomeHistory.push({ signalScoresAtEntry: allScores, pnlPct, side, tradeId: id, timestamp: Date.now() });
        if (this._outcomeHistory.length > this._maxHistory) this._outcomeHistory.shift();

        this._outcomesSinceLastSave++;
        if (this._outcomesSinceLastSave >= 10) this.saveWeights();
        return true;
    }

    /** Returns current signal weights snapshot */
    getWeights() {
        return { ...this._weights };
    }

    getLearningStatus() {
        return {
            version: SIGNAL_LEARNING_VERSION,
            processedClosedTrades: this._processedTradeIds.size,
            lastOutcomeAt: this._outcomeHistory.at(-1)?.timestamp || null,
            legacyWeightsExcluded: this._legacyWeightsNeedBackup,
            weights: this.getWeights()
        };
    }

    /** Returns recent outcome history (trimmed to last N) */
    getOutcomeHistory(limit = 100) {
        return this._outcomeHistory.slice(-limit);
    }

    /** Recent signal performance stats */
    getStats() {
        const total  = this._outcomeHistory.length;
        const wins   = this._outcomeHistory.filter(o => o.pnlPct > 0).length;
        return {
            totalTrades:   total,
            winRate:       total > 0 ? wins / total : 0,
            currentWeights: { ...this._weights },
            topSignal:     Object.entries(this._weights).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
            weakestSignal: Object.entries(this._weights).sort((a, b) => a[1] - b[1])[0]?.[0] || 'none',
        };
    }

    // ── Math Helpers ──────────────────────────────────────────────────────────

    _sma(arr, n) {
        const sl = arr.slice(-n);
        return sl.reduce((s, v) => s + v, 0) / (sl.length || 1);
    }

    _ema(arr, n) {
        if (!arr.length) return 0;
        const k = 2 / (n + 1);
        let ema  = arr[0];
        for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
        return ema;
    }

    _rsi(closes, n = 14) {
        if (closes.length < n + 1) return 50;
        const changes = closes.slice(-(n + 1)).map((v, i, a) => i === 0 ? 0 : v - a[i - 1]).slice(1);
        const avgGain  = changes.filter(c => c > 0).reduce((s, v) => s + v, 0) / n;
        const avgLoss  = changes.filter(c => c < 0).map(Math.abs).reduce((s, v) => s + v, 0) / n;
        return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }

    _clamp(v) { return Math.max(-1, Math.min(1, v)); }
}

export const signalLibrary = new SignalLibrary();
