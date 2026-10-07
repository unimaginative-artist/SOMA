/**
 * Low-Latency Trading Engine API Routes
 */

import express from 'express';
import lowLatencyEngine from './lowLatencyEngine.js';
import tradingEcosystem from './TradingEcosystem.js';

const router = express.Router();

/**
 * POST /api/lowlatency/start
 * Start the low-latency engine
 */
router.post('/start', async (req, res) => {
    try {
        const { symbols } = req.body;
        await lowLatencyEngine.start(symbols);
        
        res.json({
            success: true,
            message: 'Low-latency engine started',
            stats: lowLatencyEngine.getLatencyStats()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/lowlatency/stop
 * Stop the engine
 */
router.post('/stop', (req, res) => {
    try {
        const protecting = tradingEcosystem.sessions().filter(session => session.isRunning && session.openPositions?.length);
        if (protecting.length) return res.json({ success: true, retained: true,
            message: 'Quote feed retained to protect open positions', symbols: protecting.map(session => session.symbol) });
        lowLatencyEngine.stop();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/lowlatency/stats
 * Get latency statistics
 */
router.get('/stats', (req, res) => {
    try {
        const stats = lowLatencyEngine.getLatencyStats();
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/lowlatency/orderbook
 * Get current in-memory order book
 */
router.get('/orderbook', (req, res) => {
    try {
        const orderBook = lowLatencyEngine.getOrderBook();
        res.json({ success: true, orderBook });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/lowlatency/order
 * Execute ultra-fast order
 */
router.post('/order', async (req, res) => {
    try {
        const { symbol, side, qty, orderType = 'market' } = req.body;
        
        if (!symbol || !side || !qty) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: symbol, side, qty'
            });
        }

        const result = await lowLatencyEngine.executeOrderFast(
            symbol,
            side,
            parseFloat(qty),
            orderType
        );

        res.json({
            success: true,
            order: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/lowlatency/preposition
 * Pre-position an order for instant execution
 */
router.post('/preposition', async (req, res) => {
    try {
        const { symbol, side, qty, limitPrice } = req.body;
        
        const order = await lowLatencyEngine.prePositionOrder(
            symbol,
            side,
            parseFloat(qty),
            limitPrice ? parseFloat(limitPrice) : null
        );

        res.json({
            success: true,
            order
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
