/**
 * Market Regime Detector - Identify current market conditions
 *
 * Concept: Markets have different "regimes" (trending, ranging, volatile, calm).
 * Different strategies work in different regimes. SOMA should:
 * 1. Detect current regime
 * 2. Adapt strategy selection based on regime
 * 3. Avoid strategies that fail in current conditions
 *
 * Example: Trend-following strategies fail in ranging markets.
 *          Mean-reversion strategies fail in trending markets.
 */

import marketDataService from '../server/finance/marketDataService.js';

export class MarketRegimeDetector {
    constructor() {
        this.regimes = {
            TRENDING_BULL: 'Strong uptrend - momentum strategies',
            TRENDING_BEAR: 'Strong downtrend - short or avoid',
            RANGING: 'Sideways market - mean reversion strategies',
            VOLATILE: 'High volatility - reduce size, wider stops',
            CALM: 'Low volatility - can increase size',
            BREAKOUT: 'Range breakout - momentum strategies',
            REVERSAL: 'Trend reversal - caution, wait for confirmation'
        };

        this.currentRegime = null;
        this.confidence = 0;
    }

    /**
     * Detect market regime for a symbol
     */
    async detectRegime(symbol, benchmarkSymbol = 'SPY') {
        console.log(`[RegimeDetector] Analyzing market regime for ${symbol}...`);

        try {
            // Get multi-timeframe data
            const dailyBars = await marketDataService.getBars(symbol, '1D', 100);
            const hourlyBars = await marketDataService.getBars(symbol, '1H', 100);

            // Also check benchmark (market overall)
            let benchmarkBars = null;
            try {
                benchmarkBars = await marketDataService.getBars(benchmarkSymbol, '1D', 100);
            } catch (err) {
                console.warn('[RegimeDetector] Could not fetch benchmark data');
            }

            // Analyze each component
            const trendAnalysis = this.analyzeTrend(dailyBars);
            const volatilityAnalysis = this.analyzeVolatility(hourlyBars);
            const rangeAnalysis = this.analyzeRange(dailyBars);
            const momentumAnalysis = this.analyzeMomentum(dailyBars);

            // Synthesize regime
            const regime = this.synthesizeRegime({
                trend: trendAnalysis,
                volatility: volatilityAnalysis,
                range: rangeAnalysis,
                momentum: momentumAnalysis,
                benchmark: benchmarkBars ? this.analyzeTrend(benchmarkBars) : null
            });

            this.currentRegime = regime.type;
            this.confidence = regime.confidence;

            console.log(`[RegimeDetector] ✅ Detected: ${regime.type} (${(regime.confidence * 100).toFixed(0)}% confidence)`);

            return regime;
        } catch (error) {
            console.error('[RegimeDetector] Failed to detect regime:', error.message);
            return {
                type: 'UNKNOWN',
                confidence: 0,
                strategies: ['Wait for clear signal'],
                warnings: ['Insufficient data for regime detection']
            };
        }
    }

    /**
     * Analyze trend strength and direction
     */
    analyzeTrend(bars) {
        if (!bars || bars.length < 50) {
            return { direction: 'UNKNOWN', strength: 0 };
        }

        const closes = bars.map(b => b.close);

        // Calculate SMAs
        const sma20 = this.calculateSMA(closes, 20);
        const sma50 = this.calculateSMA(closes, 50);
        const currentPrice = closes[closes.length - 1];

        // Trend direction
        const direction = currentPrice > sma20 && sma20 > sma50 ? 'UP' :
                         currentPrice < sma20 && sma20 < sma50 ? 'DOWN' : 'SIDEWAYS';

        // Trend strength (how far from moving average)
        const distanceFromSMA = Math.abs((currentPrice - sma20) / sma20);
        const strength = Math.min(distanceFromSMA * 20, 1); // 0-1 scale

        // Higher highs / lower lows pattern
        const highs = bars.slice(-20).map(b => b.high);
        const lows = bars.slice(-20).map(b => b.low);

        const recentHigh = Math.max(...highs.slice(-5));
        const previousHigh = Math.max(...highs.slice(0, -5));

        const recentLow = Math.min(...lows.slice(-5));
        const previousLow = Math.min(...lows.slice(0, -5));

        const pattern = recentHigh > previousHigh && recentLow > previousLow ? 'HIGHER_HIGHS_LOWS' :
                       recentHigh < previousHigh && recentLow < previousLow ? 'LOWER_HIGHS_LOWS' :
                       'MIXED';

        return {
            direction,
            strength: strength.toFixed(2),
            sma20,
            sma50,
            pattern,
            currentPrice
        };
    }

    /**
     * Analyze volatility
     */
    analyzeVolatility(bars) {
        if (!bars || bars.length < 20) {
            return { level: 'UNKNOWN', percentile: 50 };
        }

        // Calculate ATR-like measure
        const ranges = bars.slice(-20).map(b => (b.high - b.low) / b.close);
        const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;

        // Recent vs historical volatility
        const recentRanges = bars.slice(-5).map(b => (b.high - b.low) / b.close);
        const recentAvgRange = recentRanges.reduce((sum, r) => sum + r, 0) / recentRanges.length;

        const volatilityRatio = recentAvgRange / avgRange;

        const level = volatilityRatio > 1.5 ? 'HIGH' :
                     volatilityRatio < 0.7 ? 'LOW' : 'NORMAL';

        // Percentile (simplified)
        const percentile = Math.min(100, volatilityRatio * 50);

        return {
            level,
            ratio: volatilityRatio.toFixed(2),
            percentile: percentile.toFixed(0),
            avgRange: (avgRange * 100).toFixed(2) + '%'
        };
    }

    /**
     * Analyze if price is ranging
     */
    analyzeRange(bars) {
        if (!bars || bars.length < 30) {
            return { isRanging: false };
        }

        const closes = bars.slice(-30).map(b => b.close);
        const highs = bars.slice(-30).map(b => b.high);
        const lows = bars.slice(-30).map(b => b.low);

        const highLevel = Math.max(...highs);
        const lowLevel = Math.min(...lows);
        const rangeSize = ((highLevel - lowLevel) / lowLevel) * 100;

        // Count touches of range boundaries
        let upperTouches = 0;
        let lowerTouches = 0;

        const upperBand = highLevel * 0.98; // Within 2% of high
        const lowerBand = lowLevel * 1.02;  // Within 2% of low

        for (const bar of bars.slice(-30)) {
            if (bar.high >= upperBand) upperTouches++;
            if (bar.low <= lowerBand) lowerTouches++;
        }

        // Ranging if: small range + multiple touches
        const isRanging = rangeSize < 15 && upperTouches >= 2 && lowerTouches >= 2;

        return {
            isRanging,
            rangeSize: rangeSize.toFixed(2),
            support: lowLevel.toFixed(2),
            resistance: highLevel.toFixed(2),
            upperTouches,
            lowerTouches
        };
    }

    /**
     * Analyze momentum
     */
    analyzeMomentum(bars) {
        if (!bars || bars.length < 20) {
            return { strength: 'UNKNOWN' };
        }

        const closes = bars.map(b => b.close);

        // Rate of change (10-day and 20-day)
        const roc10 = ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100;
        const roc20 = ((closes[closes.length - 1] - closes[closes.length - 20]) / closes[closes.length - 20]) * 100;

        const strength = Math.abs(roc10) > 5 ? 'STRONG' :
                        Math.abs(roc10) < 2 ? 'WEAK' : 'MODERATE';

        const direction = roc10 > 0 ? 'POSITIVE' : 'NEGATIVE';

        // Accelerating or decelerating?
        const acceleration = Math.abs(roc10) > Math.abs(roc20) ? 'ACCELERATING' : 'DECELERATING';

        return {
            strength,
            direction,
            acceleration,
            roc10: roc10.toFixed(2),
            roc20: roc20.toFixed(2)
        };
    }

    /**
     * Synthesize all analyses into a regime
     */
    synthesizeRegime(analysis) {
        const { trend, volatility, range, momentum, benchmark } = analysis;

        let regimeType = 'UNKNOWN';
        let confidence = 0;
        let strategies = [];
        let warnings = [];

        // TRENDING BULL
        if (trend.direction === 'UP' && momentum.direction === 'POSITIVE' && !range.isRanging) {
            regimeType = 'TRENDING_BULL';
            confidence = 0.7 + (parseFloat(trend.strength) * 0.3);
            strategies = [
                'Trend-following strategies',
                'Buy dips to moving averages',
                'Momentum plays',
                'Avoid shorting'
            ];

            if (volatility.level === 'HIGH') {
                warnings.push('High volatility - use wider stops');
            }
        }

        // TRENDING BEAR
        else if (trend.direction === 'DOWN' && momentum.direction === 'NEGATIVE' && !range.isRanging) {
            regimeType = 'TRENDING_BEAR';
            confidence = 0.7 + (parseFloat(trend.strength) * 0.3);
            strategies = [
                'Avoid or short',
                'Wait for reversal signals',
                'Use tight stops if long'
            ];
            warnings.push('Bearish trend - be cautious with longs');
        }

        // RANGING
        else if (range.isRanging) {
            regimeType = 'RANGING';
            confidence = 0.6;
            strategies = [
                'Mean reversion at range boundaries',
                'Buy support, sell resistance',
                'Avoid trend-following',
                'Wait for breakout'
            ];
            warnings.push('Ranging market - avoid momentum strategies');
        }

        // VOLATILE
        else if (volatility.level === 'HIGH') {
            regimeType = 'VOLATILE';
            confidence = 0.5;
            strategies = [
                'Reduce position sizes',
                'Use wider stops',
                'Wait for clarity',
                'Consider volatility strategies'
            ];
            warnings.push('High volatility - reduce risk exposure');
        }

        // CALM
        else if (volatility.level === 'LOW' && range.isRanging) {
            regimeType = 'CALM';
            confidence = 0.6;
            strategies = [
                'Wait for breakout',
                'Can use tighter stops',
                'Low volatility won\'t last'
            ];
        }

        // REVERSAL
        else if (trend.pattern === 'MIXED' && momentum.acceleration === 'DECELERATING') {
            regimeType = 'REVERSAL';
            confidence = 0.4;
            strategies = [
                'Wait for confirmation',
                'Reduce positions',
                'Watch for new trend direction'
            ];
            warnings.push('Potential reversal - wait for confirmation');
        }

        // DEFAULT
        else {
            regimeType = 'MIXED';
            confidence = 0.3;
            strategies = ['No clear regime - wait for clarity'];
            warnings.push('Market conditions unclear - avoid trading');
        }

        return {
            type: regimeType,
            confidence,
            strategies,
            warnings,
            analysis: {
                trend,
                volatility,
                range,
                momentum
            },
            benchmark: benchmark ? {
                direction: benchmark.direction,
                strength: benchmark.strength
            } : null,
            timestamp: Date.now()
        };
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
     * Get recommended strategy adjustments for current regime
     */
    getStrategyAdjustments() {
        const adjustments = {
            regime: this.currentRegime,
            confidence: this.confidence
        };

        switch (this.currentRegime) {
            case 'TRENDING_BULL':
                adjustments.positionSizeMultiplier = 1.2;
                adjustments.stopLossPercent = 3;
                adjustments.preferredStrategies = ['momentum', 'trend-following'];
                adjustments.avoidStrategies = ['mean-reversion', 'short'];
                break;

            case 'TRENDING_BEAR':
                adjustments.positionSizeMultiplier = 0.5;
                adjustments.stopLossPercent = 2;
                adjustments.preferredStrategies = ['wait', 'defensive'];
                adjustments.avoidStrategies = ['momentum', 'long'];
                break;

            case 'RANGING':
                adjustments.positionSizeMultiplier = 0.8;
                adjustments.stopLossPercent = 2;
                adjustments.preferredStrategies = ['mean-reversion', 'range-trading'];
                adjustments.avoidStrategies = ['trend-following', 'breakout'];
                break;

            case 'VOLATILE':
                adjustments.positionSizeMultiplier = 0.5;
                adjustments.stopLossPercent = 5;
                adjustments.preferredStrategies = ['wait', 'reduced-risk'];
                adjustments.avoidStrategies = ['large-positions'];
                break;

            default:
                adjustments.positionSizeMultiplier = 0.7;
                adjustments.stopLossPercent = 3;
                adjustments.preferredStrategies = ['wait'];
                adjustments.avoidStrategies = ['aggressive'];
        }

        return adjustments;
    }
}
