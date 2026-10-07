/**
 * GridEngine.js
 * 
 * Ported from "NoFX" AutoTrader (Go) -> JavaScript
 * Implements advanced Grid Trading logic with Regime Detection.
 */

class GridEngine {
    constructor() {
        this.regimeLevels = {
            NARROW: 'narrow',     // Low volatility, high leverage safe
            STANDARD: 'standard', // Normal market
            WIDE: 'wide',         // High volatility
            VOLATILE: 'volatile'  // Extreme danger
        };
    }

    /**
     * Calculate Grid Levels
     * @param {number} currentPrice - Current market price
     * @param {number} upperPrice - Grid upper bound
     * @param {number} lowerPrice - Grid lower bound
     * @param {number} grids - Number of grid lines
     * @param {string} mode - 'arithmetic' or 'geometric'
     */
    calculateLevels(currentPrice, upperPrice, lowerPrice, grids, mode = 'arithmetic') {
        const levels = [];
        
        if (lowerPrice >= upperPrice) throw new Error("Lower price must be less than upper price");
        
        if (mode === 'arithmetic') {
            const spacing = (upperPrice - lowerPrice) / grids;
            for (let i = 0; i <= grids; i++) {
                levels.push(lowerPrice + (i * spacing));
            }
        } else {
            // Geometric (equal percentage)
            const ratio = Math.pow(upperPrice / lowerPrice, 1 / grids);
            let price = lowerPrice;
            for (let i = 0; i <= grids; i++) {
                levels.push(price);
                price *= ratio;
            }
        }

        // Determine current zone
        const currentZone = levels.findIndex(l => l > currentPrice) - 1;
        
        return {
            levels: levels.map(l => parseFloat(l.toFixed(2))),
            spacing: mode === 'arithmetic' ? (upperPrice - lowerPrice) / grids : null,
            currentZone: Math.max(0, currentZone),
            inRange: currentPrice >= lowerPrice && currentPrice <= upperPrice
        };
    }

    /**
     * Detect Market Regime based on Volatility
     * @param {number} bollingerWidth - (Upper - Lower) / Middle * 100
     * @param {number} atrPct - ATR / Price * 100
     */
    detectRegime(bollingerWidth, atrPct) {
        // Thresholds ported from nofx_repo/trader/grid_regime.go
        if (bollingerWidth < 2.0 && atrPct < 1.0) return this.regimeLevels.NARROW;
        if (bollingerWidth <= 3.0 && atrPct <= 2.0) return this.regimeLevels.STANDARD;
        if (bollingerWidth <= 4.0 && atrPct <= 3.0) return this.regimeLevels.WIDE;
        return this.regimeLevels.VOLATILE;
    }

    /**
     * Recommend Leverage based on Regime
     */
    getRecommendedLeverage(regime) {
        switch (regime) {
            case this.regimeLevels.NARROW: return 10;
            case this.regimeLevels.STANDARD: return 5;
            case this.regimeLevels.WIDE: return 2;
            case this.regimeLevels.VOLATILE: return 1;
            default: return 1;
        }
    }

    /**
     * Check for Breakout
     */
    checkBreakout(currentPrice, upper, lower) {
        if (currentPrice > upper) return { type: 'upper', pct: (currentPrice - upper) / upper };
        if (currentPrice < lower) return { type: 'lower', pct: (lower - currentPrice) / lower };
        return { type: 'none', pct: 0 };
    }
}

export default new GridEngine();
