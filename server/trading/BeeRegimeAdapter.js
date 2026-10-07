/**
 * BeeRegimeAdapter.js
 *
 * Dynamic Regime-Adaptive Modulation for SOMA BeeBots.
 * Integrates with SOMA's MarketRegimeDetector to dynamically tune bee behavior:
 *  - Suppresses counter-trend strategies in strong directional runs
 *  - Expands take-profit targets in trending regimes
 *  - Tightens profit targets and raises conviction bars during chop/ranging regimes
 *  - Dynamically widens ATR stop distance during volatility shocks (preserving 1R risk)
 */

import marketRegimeDetector from '../finance/MarketRegimeDetector.js';

export const REGIME_BEHAVIORS = {
    TRENDING_UP: {
        bizzy: {
            active: true,
            minConviction: 1, // Aggressive entry on upside breakouts
            tpAtrMultiplier: 3.5, // Let winners run in bull trend
            stopAtrMultiplier: 1.5,
            allowedSides: ['LONG'], // Disallow shorting breakouts against bull trend
            description: 'Bull trend breakout: expanded profit targets, longs only'
        },
        boozy: {
            active: true,
            minConviction: 2,
            tpAtrMultiplier: 2.0,
            stopAtrMultiplier: 1.5,
            allowedSides: ['LONG'], // Dip buyer only; do NOT fade overbought bull runs
            description: 'Bull trend pullback: buying oversold dips only, no short fades'
        },
        breezy: {
            active: true,
            minConviction: 1,
            tpAtrMultiplier: 3.5,
            stopAtrMultiplier: 1.5,
            allowedSides: ['LONG'],
            description: 'Bull trend carry: riding long momentum and positive funding'
        }
    },

    TRENDING_DOWN: {
        bizzy: {
            active: true,
            minConviction: 1,
            tpAtrMultiplier: 3.5, // Expanded downside targets
            stopAtrMultiplier: 1.5,
            allowedSides: ['SHORT'],
            description: 'Bear trend breakdown: expanded downside targets, shorts only'
        },
        boozy: {
            active: true,
            minConviction: 2,
            tpAtrMultiplier: 2.0,
            stopAtrMultiplier: 1.5,
            allowedSides: ['SHORT'], // Fade overbought relief bounces only; do NOT catch falling knives
            description: 'Bear trend relief fade: fading overbought bounces only, no long dip buys'
        },
        breezy: {
            active: true,
            minConviction: 1,
            tpAtrMultiplier: 3.5,
            stopAtrMultiplier: 1.5,
            allowedSides: ['SHORT'],
            description: 'Bear trend carry: shorting crowded longs or following breakdown'
        }
    },

    RANGING: {
        bizzy: {
            active: true,
            minConviction: 3, // Very strict: avoid false breakout whipsaws in range
            tpAtrMultiplier: 2.0,
            stopAtrMultiplier: 1.5,
            allowedSides: ['LONG', 'SHORT'],
            description: 'Chop/range: high conviction required to avoid false breakouts'
        },
        boozy: {
            active: true,
            minConviction: 2, // Require moderate conviction to avoid noise in chop
            tpAtrMultiplier: 1.8, // Quick profit taking inside the channel
            stopAtrMultiplier: 1.4,
            allowedSides: ['LONG', 'SHORT'],
            description: 'Chop/range: primary oscillator fading boundaries (moderate conviction required)'
        },
        breezy: {
            active: false, // Suppress trend follower in zero-trend chop
            minConviction: 3,
            tpAtrMultiplier: 2.0,
            stopAtrMultiplier: 1.5,
            allowedSides: ['LONG', 'SHORT'],
            description: 'Chop/range: trend carry suppressed to prevent fee bleed'
        }
    },

    VOLATILE: {
        bizzy: {
            active: true,
            minConviction: 3, // Only textbook setups
            tpAtrMultiplier: 3.0,
            stopAtrMultiplier: 2.2, // Wider stop to survive high noise (1R dollar risk kept constant)
            allowedSides: ['LONG', 'SHORT'],
            description: 'Volatile: wider stops and strict conviction gate'
        },
        boozy: {
            active: false, // Disallow mean-reversion during wild erratic swings
            minConviction: 3,
            tpAtrMultiplier: 2.5,
            stopAtrMultiplier: 2.2,
            allowedSides: ['LONG', 'SHORT'],
            description: 'Volatile: mean-reversion suppressed'
        },
        breezy: {
            active: true,
            minConviction: 2,
            tpAtrMultiplier: 3.0,
            stopAtrMultiplier: 2.2,
            allowedSides: ['LONG', 'SHORT'],
            description: 'Volatile: wider stops with multi-factor confirmation'
        }
    },

    CRASH: {
        bizzy: {
            active: true,
            minConviction: 2,
            tpAtrMultiplier: 4.0,
            stopAtrMultiplier: 2.5,
            allowedSides: ['SHORT'], // Only downside participation
            description: 'Crash regime: defensive short breakouts only'
        },
        boozy: {
            active: false, // NEVER catch a falling knife in CRASH regime
            minConviction: 3,
            tpAtrMultiplier: 2.0,
            stopAtrMultiplier: 2.0,
            allowedSides: [],
            description: 'Crash regime: mean reversion disabled'
        },
        breezy: {
            active: true,
            minConviction: 2,
            tpAtrMultiplier: 4.0,
            stopAtrMultiplier: 2.5,
            allowedSides: ['SHORT'],
            description: 'Crash regime: short momentum only'
        }
    }
};

export class BeeRegimeAdapter {
    constructor(options = {}) {
        this.detector = options.detector || marketRegimeDetector;
    }

    /**
     * Map OKX perp symbol to MarketRegimeDetector symbol key
     */
    mapSymbol(instId) {
        if (!instId) return 'BTC-USD';
        const base = instId.split('-')[0];
        return `${base}-USD`;
    }

    /**
     * Get active regime for symbol or global anchor, utilizing live HTF trend if available
     */
    getCurrentRegime(instId = null, marketState = null) {
        if (marketState && marketState.htfTrend) {
            if (marketState.htfTrend === 'BULLISH') return 'TRENDING_UP';
            if (marketState.htfTrend === 'BEARISH') return 'TRENDING_DOWN';
            if (marketState.htfTrend === 'RANGING') return 'RANGING';
        }

        try {
            const mapped = this.mapSymbol(instId);
            const r = this.detector.getRegime(mapped);
            return r?.regime || 'RANGING';
        } catch (_) {
            return 'RANGING';
        }
    }

    /**
     * Get tailored parameters for a specific bee and symbol
     */
    getBeeAdjustments(beeKey, instId = null, overrideRegime = null, marketState = null) {
        const regime = overrideRegime || this.getCurrentRegime(instId, marketState);
        const regimeConfig = REGIME_BEHAVIORS[regime] || REGIME_BEHAVIORS.RANGING;
        const beeAdjustment = regimeConfig[beeKey] || {
            active: true,
            minConviction: 2,
            tpAtrMultiplier: 2.5,
            stopAtrMultiplier: 1.5,
            allowedSides: ['LONG', 'SHORT'],
            description: 'Default parameters'
        };

        return {
            regime,
            ...beeAdjustment
        };
    }
}
