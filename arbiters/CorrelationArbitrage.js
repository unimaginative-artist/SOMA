/**
 * Correlation Arbitrage - Production Grade
 *
 * Pairs Trading Strategy:
 * - Find assets that normally move together (BTC/ETH, AAPL/MSFT)
 * - When correlation breaks (spread widens), trade the reversion
 * - Long underperformer, short overperformer
 * - Exit when spread returns to normal
 *
 * This is a market-neutral strategy (makes money in any market).
 */

import fs from 'fs/promises';
import path from 'path';

export class CorrelationArbitrage {
    constructor({ rootPath }) {
        this.rootPath = rootPath;
        this.dataPath = path.join(rootPath, 'data', 'correlation_arbitrage');

        // Strategy parameters
        this.lookbackPeriods = [30, 60, 90]; // Days for correlation calculation
        this.entryZScore = 2.0;  // Enter when spread > 2 std deviations
        this.exitZScore = 0.5;   // Exit when spread < 0.5 std deviations
        this.minCorrelation = 0.7; // Only trade pairs with >0.7 correlation

        // Known correlated pairs
        this.knownPairs = [
            // Crypto pairs
            { pair: ['BTC-USD', 'ETH-USD'], correlation: 0.85, sector: 'Crypto' },
            { pair: ['BTC', 'ETH'], correlation: 0.85, sector: 'Crypto' },

            // Tech stocks
            { pair: ['AAPL', 'MSFT'], correlation: 0.72, sector: 'Tech' },
            { pair: ['GOOGL', 'META'], correlation: 0.68, sector: 'Tech' },
            { pair: ['NVDA', 'AMD'], correlation: 0.75, sector: 'Semiconductors' },

            // Indices
            { pair: ['SPY', 'QQQ'], correlation: 0.88, sector: 'Indices' },
            { pair: ['DIA', 'IWM'], correlation: 0.65, sector: 'Indices' },

            // Oil & Energy
            { pair: ['XOM', 'CVX'], correlation: 0.82, sector: 'Energy' }
        ];

        this.priceHistory = new Map(); // symbol -> [prices]
        this.activePairs = [];
    }

    async initialize() {
        await fs.mkdir(this.dataPath, { recursive: true });
        await this.loadState();
        console.log('[CorrelationArbitrage] ✅ Initialized with', this.knownPairs.length, 'known pairs');
    }

    /**
     * Calculate correlation between two price series
     */
    calculateCorrelation(prices1, prices2) {
        if (prices1.length !== prices2.length || prices1.length < 2) {
            return 0;
        }

        const n = prices1.length;

        // Calculate means
        const mean1 = prices1.reduce((sum, p) => sum + p, 0) / n;
        const mean2 = prices2.reduce((sum, p) => sum + p, 0) / n;

        // Calculate correlation coefficient
        let numerator = 0;
        let sum1Sq = 0;
        let sum2Sq = 0;

        for (let i = 0; i < n; i++) {
            const diff1 = prices1[i] - mean1;
            const diff2 = prices2[i] - mean2;

            numerator += diff1 * diff2;
            sum1Sq += diff1 * diff1;
            sum2Sq += diff2 * diff2;
        }

        const denominator = Math.sqrt(sum1Sq * sum2Sq);

        if (denominator === 0) return 0;

        return numerator / denominator;
    }

    /**
     * Calculate spread ratio between two assets
     */
    calculateSpreadRatio(price1, price2) {
        if (price2 === 0) return 0;
        return price1 / price2;
    }

    /**
     * Calculate z-score of current spread
     */
    calculateZScore(currentSpread, historicalSpreads) {
        if (historicalSpreads.length < 2) return 0;

        const mean = historicalSpreads.reduce((sum, s) => sum + s, 0) / historicalSpreads.length;

        const variance = historicalSpreads.reduce((sum, s) => {
            return sum + Math.pow(s - mean, 2);
        }, 0) / historicalSpreads.length;

        const stdDev = Math.sqrt(variance);

        if (stdDev === 0) return 0;

        return (currentSpread - mean) / stdDev;
    }

    /**
     * Analyze a pair for trading opportunity
     */
    analyzePair(symbol1, symbol2, prices1, prices2, lookback = 60) {
        // Get recent prices
        const recentPrices1 = prices1.slice(-lookback);
        const recentPrices2 = prices2.slice(-lookback);

        if (recentPrices1.length < 30 || recentPrices2.length < 30) {
            return {
                tradeable: false,
                reason: 'Insufficient price history'
            };
        }

        // Calculate correlation
        const correlation = this.calculateCorrelation(recentPrices1, recentPrices2);

        if (correlation < this.minCorrelation) {
            return {
                tradeable: false,
                reason: `Low correlation: ${(correlation * 100).toFixed(1)}% (min ${(this.minCorrelation * 100).toFixed(0)}%)`
            };
        }

        // Calculate historical spreads
        const historicalSpreads = [];
        for (let i = 0; i < recentPrices1.length; i++) {
            const spread = this.calculateSpreadRatio(recentPrices1[i], recentPrices2[i]);
            historicalSpreads.push(spread);
        }

        // Current spread and z-score
        const currentPrice1 = prices1[prices1.length - 1];
        const currentPrice2 = prices2[prices2.length - 1];
        const currentSpread = this.calculateSpreadRatio(currentPrice1, currentPrice2);
        const zScore = this.calculateZScore(currentSpread, historicalSpreads);

        // Calculate mean spread for reference
        const meanSpread = historicalSpreads.reduce((sum, s) => sum + s, 0) / historicalSpreads.length;

        // Determine signal
        let signal = 'HOLD';
        let action = null;

        if (zScore > this.entryZScore) {
            // Asset1 overperforming relative to Asset2
            signal = 'ENTRY';
            action = {
                type: 'MEAN_REVERSION',
                short: symbol1,  // Short overperformer
                long: symbol2,   // Long underperformer
                reason: `${symbol1} overvalued vs ${symbol2} (z-score: ${zScore.toFixed(2)})`
            };
        } else if (zScore < -this.entryZScore) {
            // Asset2 overperforming relative to Asset1
            signal = 'ENTRY';
            action = {
                type: 'MEAN_REVERSION',
                short: symbol2,  // Short overperformer
                long: symbol1,   // Long underperformer
                reason: `${symbol2} overvalued vs ${symbol1} (z-score: ${zScore.toFixed(2)})`
            };
        } else if (Math.abs(zScore) < this.exitZScore) {
            signal = 'EXIT';
            action = {
                type: 'EXIT',
                reason: `Spread normalized (z-score: ${zScore.toFixed(2)})`
            };
        }

        return {
            tradeable: true,
            correlation: correlation,
            currentSpread: currentSpread,
            meanSpread: meanSpread,
            zScore: zScore,
            signal,
            action,
            prices: {
                [symbol1]: currentPrice1,
                [symbol2]: currentPrice2
            },
            lookback
        };
    }

    /**
     * Find all tradeable pair opportunities
     */
    async findOpportunities(priceData) {
        const opportunities = [];

        for (const pairInfo of this.knownPairs) {
            const [symbol1, symbol2] = pairInfo.pair;

            // Check if we have price data for both
            const prices1 = priceData[symbol1];
            const prices2 = priceData[symbol2];

            if (!prices1 || !prices2) {
                continue;
            }

            // Analyze each lookback period
            for (const lookback of this.lookbackPeriods) {
                const analysis = this.analyzePair(symbol1, symbol2, prices1, prices2, lookback);

                if (analysis.tradeable && analysis.signal === 'ENTRY') {
                    opportunities.push({
                        pair: pairInfo.pair,
                        sector: pairInfo.sector,
                        analysis,
                        lookback,
                        expectedCorrelation: pairInfo.correlation
                    });
                }
            }
        }

        // Sort by absolute z-score (most diverged first)
        opportunities.sort((a, b) => Math.abs(b.analysis.zScore) - Math.abs(a.analysis.zScore));

        return opportunities;
    }

    /**
     * Check if we should exit an active pair trade
     */
    shouldExitPair(pairTrade, prices1, prices2) {
        const [symbol1, symbol2] = pairTrade.pair;

        const analysis = this.analyzePair(
            symbol1,
            symbol2,
            prices1,
            prices2,
            pairTrade.lookback
        );

        return analysis.signal === 'EXIT';
    }

    /**
     * Calculate hedge ratio (beta-neutral positioning)
     */
    calculateHedgeRatio(prices1, prices2) {
        // Simple hedge ratio: 1:1 dollar-neutral
        // Advanced: Could use beta regression for optimal hedge
        return 1.0;
    }

    /**
     * Generate trade parameters for a pair
     */
    generateTradeParams(opportunity, capitalPerSide = 1000) {
        const { pair, analysis } = opportunity;
        const [symbol1, symbol2] = pair;

        const price1 = analysis.prices[symbol1];
        const price2 = analysis.prices[symbol2];

        // Calculate shares for dollar-neutral hedge
        const hedgeRatio = this.calculateHedgeRatio([], []); // Simplified: 1:1
        const shares1 = Math.floor(capitalPerSide / price1);
        const shares2 = Math.floor(capitalPerSide / price2);

        return {
            pair,
            entry: {
                long: {
                    symbol: analysis.action.long,
                    shares: analysis.action.long === symbol1 ? shares1 : shares2,
                    price: analysis.action.long === symbol1 ? price1 : price2,
                    cost: capitalPerSide
                },
                short: {
                    symbol: analysis.action.short,
                    shares: analysis.action.short === symbol1 ? shares1 : shares2,
                    price: analysis.action.short === symbol1 ? price1 : price2,
                    proceeds: capitalPerSide
                }
            },
            zScore: analysis.zScore,
            correlation: analysis.correlation,
            reason: analysis.action.reason
        };
    }

    /**
     * Get summary of pair trading opportunities
     */
    getSummary(opportunities) {
        if (opportunities.length === 0) {
            return {
                count: 0,
                message: 'No pair trading opportunities found'
            };
        }

        const topOpportunity = opportunities[0];
        const { pair, analysis } = topOpportunity;

        return {
            count: opportunities.length,
            topOpportunity: {
                pair: pair.join(' / '),
                action: `Short ${analysis.action.short}, Long ${analysis.action.long}`,
                zScore: analysis.zScore.toFixed(2),
                correlation: (analysis.correlation * 100).toFixed(1) + '%',
                reason: analysis.action.reason
            },
            allOpportunities: opportunities.slice(0, 5).map(opp => ({
                pair: opp.pair.join(' / '),
                zScore: opp.analysis.zScore.toFixed(2),
                sector: opp.sector
            }))
        };
    }

    /**
     * Save state
     */
    async saveState() {
        try {
            const state = {
                timestamp: Date.now(),
                activePairs: this.activePairs,
                knownPairs: this.knownPairs
            };

            const filePath = path.join(this.dataPath, 'correlation_state.json');
            await fs.writeFile(filePath, JSON.stringify(state, null, 2));
        } catch (error) {
            console.error('[CorrelationArbitrage] Failed to save state:', error.message);
        }
    }

    /**
     * Load state
     */
    async loadState() {
        try {
            const filePath = path.join(this.dataPath, 'correlation_state.json');
            const content = await fs.readFile(filePath, 'utf-8');
            const state = JSON.parse(content);

            this.activePairs = state.activePairs || [];

            console.log('[CorrelationArbitrage] Loaded state from disk');
        } catch (error) {
            console.log('[CorrelationArbitrage] No previous state found, starting fresh');
        }
    }

    /**
     * Format opportunity for display
     */
    formatOpportunity(opportunity) {
        const { pair, analysis, sector } = opportunity;

        return `
${pair.join(' / ')} (${sector})
  Z-Score: ${analysis.zScore > 0 ? '+' : ''}${analysis.zScore.toFixed(2)}σ
  Correlation: ${(analysis.correlation * 100).toFixed(1)}%
  Action: ${analysis.action.type}
    → Short: ${analysis.action.short} (overperformer)
    → Long: ${analysis.action.long} (underperformer)
  Reason: ${analysis.action.reason}
        `.trim();
    }
}
