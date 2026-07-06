/**
 * MarketRegimeDetector — Live Market Condition Classifier
 *
 * Classifies the current market into one of five regimes using pure
 * technical analysis on recent price bars. No external API calls.
 *
 * Regimes:
 *   TRENDING_UP    — strong upward momentum, ADX-proxy > 25, price above SMA50
 *   TRENDING_DOWN  — strong downward momentum, price below SMA50
 *   RANGING        — low directional bias, price oscillating around SMA
 *   VOLATILE       — high ATR relative to price, unclear direction
 *   CRASH          — rapid decline > 8% from recent peak
 *
 * Updates every 5 minutes via heartbeat. ScalpingEngine + UCB1 read from
 * global.SOMA_TRADING.regimeDetector (this singleton).
 *
 * Detection algorithm:
 *   1. SMA20 / SMA50 slope and crossover → trend direction
 *   2. ATR(14) / price ratio → volatility regime
 *   3. 10-bar drawdown from peak → crash detection
 *   4. ADX proxy (directional movement index simplified) → trend strength
 */

import marketDataService from './marketDataService.js';

const HEARTBEAT_MS = 5 * 60 * 1000;
const DEFAULT_SYMBOLS = ['SPY', 'BTC-USD', 'ETH-USD'];

class MarketRegimeDetector {
    constructor() {
        this._intervalId   = null;
        this.currentRegime = 'RANGING';  // safe default
        this.confidence    = 0;
        this._regimeBySymbol = new Map(); // symbol → { regime, confidence, updatedAt }
        this._primarySymbol  = 'SPY';    // anchor for global regime
    }

    start(symbols = DEFAULT_SYMBOLS) {
        if (this._intervalId) return;
        this._primarySymbol = symbols[0] || 'SPY';
        console.log('[RegimeDetector] Started — 5min regime classification');
        this._intervalId = setInterval(() => {
            this._updateAll(symbols).catch(err =>
                console.warn('[RegimeDetector] Update error:', err.message)
            );
        }, HEARTBEAT_MS);
        // Initial detection after 30s
        setTimeout(() => this._updateAll(symbols).catch(() => {}), 30_000);
    }

    stop() {
        if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    }

    /**
     * Canonical map key — traders pass 'BTC-USD' while watchlists have used
     * 'BTC/USD'; a mismatched key silently fell back to the SPY anchor regime.
     */
    _key(symbol) {
        return String(symbol || '').toUpperCase().replace(/\//g, '-');
    }

    /** Returns regime for a specific symbol (or the global anchor if not tracked) */
    getRegime(symbol = null) {
        if (symbol) {
            const r = this._regimeBySymbol.get(this._key(symbol));
            if (r) return r;
        }
        return { regime: this.currentRegime, confidence: this.confidence, symbol: this._primarySymbol };
    }

    /** Force an immediate classification (for API calls) */
    async detectRegime(symbol) {
        const result = await this._classifySymbol(symbol);
        this._regimeBySymbol.set(this._key(symbol), result);
        return result;
    }

    /** Get strategy parameter adjustments based on current regime */
    getStrategyAdjustments(regime = null) {
        const r = regime || this.currentRegime;
        const adjustments = {
            TRENDING_UP:   { maxPositions: 1.3, cooldownMultiplier: 0.7, minConfidence: -0.05 },
            TRENDING_DOWN: { maxPositions: 0.5, cooldownMultiplier: 1.5, minConfidence: +0.05 },
            RANGING:       { maxPositions: 1.0, cooldownMultiplier: 1.0, minConfidence: 0 },
            VOLATILE:      { maxPositions: 0.6, cooldownMultiplier: 2.0, minConfidence: +0.08 },
            CRASH:         { maxPositions: 0.2, cooldownMultiplier: 3.0, minConfidence: +0.15 }
        };
        return adjustments[r] || adjustments.RANGING;
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    async _updateAll(symbols) {
        for (const sym of symbols) {
            try {
                const result = await this._classifySymbol(sym);
                this._regimeBySymbol.set(this._key(sym), result);
                if (sym.toUpperCase() === this._primarySymbol.toUpperCase()) {
                    this.currentRegime = result.regime;
                    this.confidence    = result.confidence;
                }
            } catch { /* non-fatal */ }
        }
    }

    async _classifySymbol(symbol) {
        const bars = await marketDataService.getBars(symbol, '1D', 60);
        if (!bars || bars.length < 30) {
            return { regime: 'RANGING', confidence: 0, symbol, reason: 'insufficient data', updatedAt: new Date().toISOString() };
        }

        const closes  = bars.map(b => b.close || b.c || b.price).filter(Boolean);
        if (closes.length < 20) {
            return { regime: 'RANGING', confidence: 0, symbol, reason: 'insufficient closes', updatedAt: new Date().toISOString() };
        }

        // Sanity: daily bars must actually span days. A mislabeled intraday feed
        // (the '1Day'→1m bug, Jun 2026) made every symbol read RANGING with high
        // confidence and froze all BTC_NATIVE engines. Refuse to classify garbage.
        const spanMs = (bars[bars.length - 1].timestamp || 0) - (bars[0].timestamp || 0);
        const minExpectedSpanMs = (bars.length - 1) * 6 * 3600 * 1000; // ≥6h per "daily" bar
        if (spanMs > 0 && spanMs < minExpectedSpanMs) {
            console.warn(`[RegimeDetector] ${symbol}: bars span ${(spanMs / 3600000).toFixed(1)}h for ${bars.length} "daily" bars — feed is not daily, skipping classification`);
            return { regime: 'UNKNOWN', confidence: 0, symbol, reason: 'bar timeframe mismatch (feed not daily)', updatedAt: new Date().toISOString() };
        }

        const highs  = bars.map(b => b.high  || b.h || b.close || b.c).filter(Boolean);
        const lows   = bars.map(b => b.low   || b.l || b.close || b.c).filter(Boolean);
        const n      = closes.length;
        const latest = closes[n - 1];

        // SMA20, SMA50
        const sma20 = this._sma(closes, 20);
        const sma50 = this._sma(closes, Math.min(50, n));
        const sma20Prev = this._sma(closes.slice(0, -3), 20);

        // SMA slope (% change over 3 bars)
        const smaSlope = sma20Prev > 0 ? (sma20 - sma20Prev) / sma20Prev : 0;

        // ATR(14) as volatility proxy
        const atr = this._atr(highs, lows, closes, 14);
        const atrRatio = latest > 0 ? atr / latest : 0; // e.g. 0.015 = 1.5% daily ATR

        // 10-bar drawdown from peak (crash detection)
        const recentCloses = closes.slice(-10);
        const peak         = Math.max(...recentCloses);
        const drawdownFrom = peak > 0 ? (peak - latest) / peak : 0;

        // ADX proxy: ratio of directional range to total range
        const dmPlus  = this._dmPlus(highs, lows, 14);
        const dmMinus = this._dmMinus(highs, lows, 14);
        const adxProxy = (dmPlus + dmMinus) > 0 ? Math.abs(dmPlus - dmMinus) / (dmPlus + dmMinus) : 0;

        // ── Classification logic ──────────────────────────────────────────────
        let regime, confidence, reason;

        if (drawdownFrom > 0.08) {
            regime = 'CRASH'; confidence = Math.min(0.95, drawdownFrom * 8); reason = `${(drawdownFrom * 100).toFixed(1)}% drawdown from 10-bar peak`;
        } else if (atrRatio > 0.025) {
            regime = 'VOLATILE'; confidence = Math.min(0.90, atrRatio * 30); reason = `ATR/Price ratio ${(atrRatio * 100).toFixed(2)}% (>2.5% threshold)`;
        } else if (smaSlope > 0.005 && latest > sma20 && adxProxy > 0.25) {
            regime = 'TRENDING_UP'; confidence = Math.min(0.90, adxProxy * 2 + smaSlope * 20); reason = `SMA slope +${(smaSlope * 100).toFixed(2)}%, price above SMA20, ADX ${adxProxy.toFixed(2)}`;
        } else if (smaSlope < -0.005 && latest < sma20 && adxProxy > 0.25) {
            regime = 'TRENDING_DOWN'; confidence = Math.min(0.90, adxProxy * 2 + Math.abs(smaSlope) * 20); reason = `SMA slope ${(smaSlope * 100).toFixed(2)}%, price below SMA20, ADX ${adxProxy.toFixed(2)}`;
        } else {
            regime = 'RANGING'; confidence = Math.max(0.3, 1 - atrRatio * 20 - adxProxy); reason = 'Low directional bias';
        }

        console.log(`[RegimeDetector] ${symbol}: ${regime} (confidence=${confidence.toFixed(2)}, ${reason})`);
        return { regime, confidence: parseFloat(confidence.toFixed(4)), symbol, reason, smaSlope: parseFloat(smaSlope.toFixed(5)), atrRatio: parseFloat(atrRatio.toFixed(5)), drawdownFrom: parseFloat(drawdownFrom.toFixed(4)), updatedAt: new Date().toISOString() };
    }

    _sma(arr, n) {
        const sl = arr.slice(-n);
        return sl.reduce((s, v) => s + v, 0) / sl.length;
    }

    _atr(highs, lows, closes, n) {
        const trs = [];
        for (let i = 1; i < highs.length; i++) {
            const hl  = highs[i]  - lows[i];
            const hcp = Math.abs(highs[i]  - closes[i - 1]);
            const lcp = Math.abs(lows[i]   - closes[i - 1]);
            trs.push(Math.max(hl, hcp, lcp));
        }
        const recent = trs.slice(-n);
        return recent.reduce((s, v) => s + v, 0) / recent.length;
    }

    _dmPlus(highs, lows, n) {
        let sum = 0;
        for (let i = Math.max(1, highs.length - n); i < highs.length; i++) {
            const upMove   = highs[i] - highs[i - 1];
            const downMove = lows[i - 1] - lows[i];
            if (upMove > downMove && upMove > 0) sum += upMove;
        }
        return sum / n;
    }

    _dmMinus(highs, lows, n) {
        let sum = 0;
        for (let i = Math.max(1, highs.length - n); i < highs.length; i++) {
            const upMove   = highs[i] - highs[i - 1];
            const downMove = lows[i - 1] - lows[i];
            if (downMove > upMove && downMove > 0) sum += downMove;
        }
        return sum / n;
    }
}

const marketRegimeDetector = new MarketRegimeDetector();
export default marketRegimeDetector;
