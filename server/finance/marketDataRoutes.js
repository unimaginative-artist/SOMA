/**
 * Market Data API Routes
 * Provides real-time candlestick/bar data for Mission Control charts
 */

import express from 'express';
import marketDataService from './marketDataService.js';

const router = express.Router();

const freshnessByTimeframe = {
    '1Min': 15 * 60 * 1000,
    '5Min': 45 * 60 * 1000,
    '15Min': 2 * 60 * 60 * 1000,
    '1H': 6 * 60 * 60 * 1000,
    '1D': 3 * 24 * 60 * 60 * 1000
};

router.get('/bars/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const sym = symbol.toUpperCase();
        const { timeframe = '1Min', limit = 100 } = req.query;

        const bars = await marketDataService.getBars(sym, timeframe, parseInt(limit));
        const quality = marketDataService.validateDataQuality(
            bars,
            freshnessByTimeframe[timeframe] || freshnessByTimeframe['1Min']
        );

        res.json({
            success: true,
            symbol: sym,
            timeframe,
            bars,
            count: bars.length,
            timestamp: Date.now(),
            quality
        });
    } catch (error) {
        const sym = req.params.symbol.toUpperCase();
        console.error(`[Market Data API] Failed to get bars for ${sym}:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/market/price/:symbol
 * Get latest price for a symbol
 */
router.get('/price/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const price = await marketDataService.getLatestPrice(symbol.toUpperCase());

        res.json({
            success: true,
            ...price
        });
    } catch (error) {
        console.error(`[Market Data API] Failed to get price:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/market/stream
 * Start streaming price updates for multiple symbols
 * (For future WebSocket implementation)
 */
router.post('/stream', (req, res) => {
    res.json({
        success: false,
        error: 'WebSocket streaming not yet implemented. Use polling with /bars endpoint.'
    });
});

/**
 * GET /api/market/espn/:sport/:league/scoreboard
 * Proxy for ESPN Scoreboard API to bypass CORS
 */
router.get('/espn/:sport/:league/scoreboard', async (req, res) => {
    try {
        const { sport, league } = req.params;
        const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
        
        console.log(`[Market Data Proxy] Fetching ESPN data from: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`ESPN API returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(`[Market Data Proxy] Failed to fetch ESPN data:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/market/quality/:symbol
 * Check data quality for a symbol before trading
 */
router.get('/quality/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { timeframe = '1Min', limit = 50 } = req.query;

        const bars = await marketDataService.getBars(symbol.toUpperCase(), timeframe, parseInt(limit));
        const quality = marketDataService.validateDataQuality(
            bars,
            freshnessByTimeframe[timeframe] || freshnessByTimeframe['1Min']
        );

        res.json({
            success: true,
            symbol: symbol.toUpperCase(),
            timeframe,
            ...quality,
            tradeable: quality.valid,
            recommendation: quality.valid ? 'Data quality acceptable for trading' :
                `DO NOT TRADE: ${quality.issues.join('; ')}`
        });
    } catch (error) {
        res.json({
            success: true,
            symbol: req.params.symbol.toUpperCase(),
            valid: false,
            tradeable: false,
            issues: [error.message],
            recommendation: `DO NOT TRADE: ${error.message}`
        });
    }
});

/**
 * DELETE /api/market/cache
 * Clear market data cache
 */
router.delete('/cache', (req, res) => {
    try {
        marketDataService.clearCache();
        res.json({
            success: true,
            message: 'Cache cleared'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/market/diagnostics
 * Circuit breaker states, cache sizes, pending refreshes
 */
router.get('/diagnostics', (req, res) => {
    res.json({
        success: true,
        ...marketDataService.getDiagnostics()
    });
});

export default router;
