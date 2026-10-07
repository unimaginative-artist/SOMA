/**
 * Multi-Timeframe Analyzer - Analyze stocks across multiple timeframes
 *
 * Concept: Professional traders use multiple timeframes (1min, 5min, 1H, 1D)
 * to confirm trends. SOMA should do the same.
 *
 * Example: 1D shows uptrend, 1H shows pullback, 5min shows reversal = BUY
 */

import marketDataService from '../server/finance/marketDataService.js';

export class MultiTimeframeAnalyzer {
    constructor() {
        this.timeframes = ['1Min', '5Min', '15Min', '1H', '1D'];
    }

    /**
     * Analyze a symbol across all timeframes
     */
    async analyzeSymbol(symbol) {
        console.log(`[MTF] Analyzing ${symbol} across ${this.timeframes.length} timeframes...`);

        const analyses = {};

        for (const tf of this.timeframes) {
            try {
                const bars = await marketDataService.getBars(symbol, tf, 100);

                if (!bars || bars.length === 0) {
                    console.warn(`[MTF] No data for ${symbol} on ${tf}`);
                    continue;
                }

                analyses[tf] = this.analyzeTechnicals(bars, tf);
            } catch (error) {
                console.error(`[MTF] Failed to analyze ${symbol} on ${tf}:`, error.message);
            }
        }

        // Synthesize multi-timeframe view
        const synthesis = this.synthesizeTimeframes(analyses);

        return {
            symbol,
            timestamp: Date.now(),
            timeframes: analyses,
            synthesis,
            alignment: synthesis.alignment,
            confidence: synthesis.confidence
        };
    }

    /**
     * Perform technical analysis on candle data
     */
    analyzeTechnicals(bars, timeframe) {
        const closes = bars.map(b => b.close);
        const highs = bars.map(b => b.high);
        const lows = bars.map(b => b.low);
        const volumes = bars.map(b => b.volume);

        // Trend (simple: compare current to SMA)
        const sma20 = this.calculateSMA(closes, 20);
        const currentPrice = closes[closes.length - 1];
        const trend = currentPrice > sma20 ? 'UPTREND' : 'DOWNTREND';

        // Momentum (rate of change)
        const roc10 = ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100;
        const momentum = roc10 > 2 ? 'STRONG_UP' : roc10 < -2 ? 'STRONG_DOWN' : 'NEUTRAL';

        // Support/Resistance
        const support = Math.min(...lows.slice(-20));
        const resistance = Math.max(...highs.slice(-20));

        // Volatility (ATR-like)
        const ranges = bars.slice(-14).map(b => b.high - b.low);
        const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
        const volatility = (avgRange / currentPrice) * 100;

        // Volume trend
        const avgVolume = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20;
        const currentVolume = volumes[volumes.length - 1];
        const volumeTrend = currentVolume > avgVolume * 1.5 ? 'HIGH' :
                           currentVolume < avgVolume * 0.5 ? 'LOW' : 'NORMAL';

        // Simple RSI (14-period)
        const rsi = this.calculateRSI(closes, 14);

        return {
            timeframe,
            price: currentPrice,
            trend,
            momentum,
            sma20,
            support,
            resistance,
            volatility: volatility.toFixed(2),
            rsi: rsi.toFixed(2),
            volumeTrend,
            signal: this.generateSignal(trend, momentum, rsi)
        };
    }

    /**
     * Generate trading signal from technicals
     */
    generateSignal(trend, momentum, rsi) {
        // Oversold + Uptrend = BUY
        if (rsi < 30 && trend === 'UPTREND') return 'STRONG_BUY';

        // Overbought + Downtrend = SELL
        if (rsi > 70 && trend === 'DOWNTREND') return 'STRONG_SELL';

        // Momentum + Trend aligned
        if (trend === 'UPTREND' && (momentum === 'STRONG_UP' || momentum === 'NEUTRAL')) return 'BUY';
        if (trend === 'DOWNTREND' && (momentum === 'STRONG_DOWN' || momentum === 'NEUTRAL')) return 'SELL';

        return 'HOLD';
    }

    /**
     * Synthesize multi-timeframe analysis
     */
    synthesizeTimeframes(analyses) {
        const timeframes = Object.keys(analyses);

        if (timeframes.length === 0) {
            return {
                alignment: 'UNKNOWN',
                confidence: 0,
                summary: 'Insufficient data'
            };
        }

        // Count bullish vs bearish signals
        let bullish = 0;
        let bearish = 0;

        const tfResults = [];

        for (const tf of timeframes) {
            const analysis = analyses[tf];
            const signal = analysis.signal;

            tfResults.push({ tf, signal, trend: analysis.trend });

            if (signal.includes('BUY')) bullish++;
            else if (signal.includes('SELL')) bearish++;
        }

        // Calculate alignment strength
        const total = timeframes.length;
        const maxVotes = Math.max(bullish, bearish);
        const alignment = maxVotes / total;

        let direction = 'NEUTRAL';
        let confidence = 0;

        if (bullish > bearish) {
            direction = 'BULLISH';
            confidence = alignment;
        } else if (bearish > bullish) {
            direction = 'BEARISH';
            confidence = alignment;
        }

        // Higher timeframe confirmation boost
        const dailyAnalysis = analyses['1D'];
        if (dailyAnalysis) {
            if (dailyAnalysis.trend === 'UPTREND' && direction === 'BULLISH') {
                confidence *= 1.2; // 20% confidence boost
            } else if (dailyAnalysis.trend === 'DOWNTREND' && direction === 'BEARISH') {
                confidence *= 1.2;
            }
        }

        // Cap confidence at 1.0
        confidence = Math.min(confidence, 1.0);

        return {
            alignment: direction,
            confidence: confidence.toFixed(2),
            bullishTimeframes: bullish,
            bearishTimeframes: bearish,
            totalTimeframes: total,
            summary: this.generateSummary(direction, confidence, tfResults),
            timeframeResults: tfResults
        };
    }

    /**
     * Generate human-readable summary
     */
    generateSummary(direction, confidence, tfResults) {
        const confPercent = (confidence * 100).toFixed(0);

        let summary = `${direction} bias with ${confPercent}% confidence across ${tfResults.length} timeframes.\n\n`;

        summary += 'Timeframe Breakdown:\n';
        for (const { tf, signal, trend } of tfResults) {
            summary += `- ${tf}: ${signal} (${trend})\n`;
        }

        return summary;
    }

    /**
     * Calculate Simple Moving Average
     */
    calculateSMA(values, period) {
        if (values.length < period) return values[values.length - 1];

        const slice = values.slice(-period);
        return slice.reduce((sum, val) => sum + val, 0) / period;
    }

    /**
     * Calculate RSI (Relative Strength Index)
     */
    calculateRSI(closes, period = 14) {
        if (closes.length < period + 1) return 50; // Neutral default

        const changes = [];
        for (let i = 1; i < closes.length; i++) {
            changes.push(closes[i] - closes[i - 1]);
        }

        const recentChanges = changes.slice(-period);

        const gains = recentChanges.filter(c => c > 0);
        const losses = recentChanges.filter(c => c < 0).map(Math.abs);

        const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

        if (avgLoss === 0) return 100; // All gains
        if (avgGain === 0) return 0;   // All losses

        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        return rsi;
    }
}
