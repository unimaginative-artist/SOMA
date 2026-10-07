/**
 * Opportunity Scanner Service
 * 
 * Scans the market (Top Crypto/Stocks) for autonomous trading setups.
 * acts as a "Pre-Filter" for the AutonomousTrader.
 */

import marketDataService from './marketDataService.js';

class OpportunityScanner {
    constructor() {
        this.cache = {
            crypto: { data: [], timestamp: 0 },
            stocks: { data: [], timestamp: 0 }
        };
        this.CACHE_TTL = 300_000; // 5 minutes
    }

    /**
     * Scan for opportunities
     * @param {string} assetType - 'CRYPTO' or 'STOCKS'
     */
    async scan(assetType = 'CRYPTO') {
        // Return cached if fresh
        const cache = assetType === 'CRYPTO' ? this.cache.crypto : this.cache.stocks;
        if (Date.now() - cache.timestamp < this.CACHE_TTL && cache.data.length > 0) {
            return cache.data;
        }

        try {
            let candidates = [];
            if (assetType === 'CRYPTO') {
                candidates = await this._scanCrypto();
            } else {
                candidates = await this._scanStocks();
            }

            // Save to cache
            if (assetType === 'CRYPTO') this.cache.crypto = { data: candidates, timestamp: Date.now() };
            else this.cache.stocks = { data: candidates, timestamp: Date.now() };

            return candidates;
        } catch (error) {
            console.error(`[Scanner] Scan failed for ${assetType}:`, error.message);
            return [];
        }
    }

    /**
     * Scan Top Cryptos (using CoinGecko/Binance logic via MarketDataService)
     * For now, we simulate a scan of a fixed list since we don't have a "Market Screener" API connected yet.
     */
    async _scanCrypto() {
        const universe = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'XRP-USD', 'ADA-USD', 'AVAX-USD', 'LINK-USD'];
        const results = [];

        // Run parallel analysis on the universe
        const promises = universe.map(async (symbol) => {
            try {
                // Get last 50 candles (15m timeframe for trends)
                const bars = await marketDataService.getBars(symbol, '15Min', 50);
                if (!bars || bars.length < 30) return null;

                const score = this._calculateScore(bars);
                const suggestedStrategy = this._suggestStrategy(score, bars);

                return {
                    symbol,
                    score: score.total,
                    metrics: score.metrics,
                    strategy: suggestedStrategy,
                    price: bars[bars.length - 1].close,
                    change24h: ((bars[bars.length - 1].close - bars[0].close) / bars[0].close) * 100
                };
            } catch (e) {
                return null;
            }
        });

        const analyzed = await Promise.all(promises);
        return analyzed
            .filter(r => r !== null)
            .sort((a, b) => b.score - a.score) // Sort by best score
            .slice(0, 5); // Return top 5
    }

    /**
     * Scan Top Tech Stocks
     */
    async _scanStocks() {
        const universe = ['AAPL', 'NVDA', 'TSLA', 'AMD', 'MSFT', 'GOOGL', 'META', 'AMZN'];
        const results = [];

        const promises = universe.map(async (symbol) => {
            try {
                const bars = await marketDataService.getBars(symbol, '15Min', 50);
                if (!bars || bars.length < 30) return null;

                const score = this._calculateScore(bars);
                const suggestedStrategy = this._suggestStrategy(score, bars);

                return {
                    symbol,
                    score: score.total,
                    metrics: score.metrics,
                    strategy: suggestedStrategy,
                    price: bars[bars.length - 1].close,
                    change24h: ((bars[bars.length - 1].close - bars[0].close) / bars[0].close) * 100
                };
            } catch (e) {
                return null;
            }
        });

        const analyzed = await Promise.all(promises);
        return analyzed
            .filter(r => r !== null)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
    }

    /**
     * Calculate an "Opportunity Score" (0-100) based on technicals
     */
    _calculateScore(bars) {
        const closes = bars.map(b => b.close);
        const last = closes[closes.length - 1];
        
        // 1. RSI (Approximate)
        const rsi = this._calculateRSI(closes, 14);
        
        // 2. Volatility (ATR-like)
        const ranges = bars.map(b => b.high - b.low);
        const avgRange = ranges.slice(-10).reduce((a,b) => a+b, 0) / 10;
        const volatilityPct = (avgRange / last) * 100;

        // 3. Volume Trend
        const recentVol = bars.slice(-5).reduce((a,b) => a+b.volume, 0) / 5;
        const oldVol = bars.slice(-20, -5).reduce((a,b) => a+b.volume, 0) / 15;
        const volSpike = recentVol > oldVol * 1.5;

        // Scoring Logic
        let score = 50; // Base

        // RSI Logic (Mean Reversion or Momentum)
        if (rsi < 30) score += 20; // Oversold buy opportunity
        if (rsi > 70) score += 10; // Strong momentum (or overbought short) - context dependent
        
        // Volatility Logic
        if (volatilityPct > 0.5) score += 15; // Action is happening

        // Volume Logic
        if (volSpike) score += 15; // Something is happening

        return {
            total: Math.min(99, Math.round(score)),
            metrics: { rsi, volatility: volatilityPct, volSpike }
        };
    }

    _suggestStrategy(score, bars) {
        const { rsi, volatility } = score.metrics;
        
        // Simple heuristic for strategy selection
        if (volatility > 1.0) return 'SCALPING_FAST'; // High vol -> Scalp
        if (rsi < 30 || rsi > 70) return 'MEAN_REVERSION'; // Extremes -> Revert
        return 'TREND_FOLLOWING'; // Default
    }

    _calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return 50;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = prices[prices.length - i] - prices[prices.length - i - 1];
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }
        if (losses === 0) return 100;
        const rs = gains / losses;
        return 100 - (100 / (1 + rs));
    }
}

const opportunityScanner = new OpportunityScanner();
export default opportunityScanner;
