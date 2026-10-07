/**
 * Hyperliquid DEX API Routes
 * On-chain perpetual trading (no KYC)
 */

import express from 'express';
import hyperliquidService from './HyperliquidService.js';

const router = express.Router();

// ==================== CONNECTION ====================

/**
 * POST /api/hyperliquid/connect
 */
router.post('/connect', async (req, res) => {
    try {
        const { privateKey, testnet = true } = req.body;

        if (!privateKey) {
            return res.status(400).json({ success: false, error: 'Private key required' });
        }

        const result = await hyperliquidService.connect(privateKey, testnet);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/hyperliquid/disconnect
 */
router.post('/disconnect', (req, res) => {
    hyperliquidService.disconnect();
    res.json({ success: true });
});

/**
 * GET /api/hyperliquid/status
 */
router.get('/status', (req, res) => {
    res.json({ success: true, status: hyperliquidService.getStatus() });
});

// ==================== PUBLIC MARKET DATA ====================

/**
 * GET /api/hyperliquid/meta
 * Get all market metadata
 */
router.get('/meta', async (req, res) => {
    try {
        const data = await hyperliquidService.getMeta();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/mids
 * Get all mid prices
 */
router.get('/mids', async (req, res) => {
    try {
        const data = await hyperliquidService.getAllMids();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/orderbook/:coin
 */
router.get('/orderbook/:coin', async (req, res) => {
    try {
        const { coin } = req.params;
        const l2Book = await hyperliquidService.getL2Book(coin);
        const metrics = hyperliquidService.calculateOrderBookMetrics(l2Book);

        res.json({
            success: true,
            data: {
                ...l2Book,
                metrics
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/trades/:coin
 */
router.get('/trades/:coin', async (req, res) => {
    try {
        const { coin } = req.params;
        const { limit = 100 } = req.query;
        const data = await hyperliquidService.getRecentTrades(coin, parseInt(limit));
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/candles/:coin
 */
router.get('/candles/:coin', async (req, res) => {
    try {
        const { coin } = req.params;
        const { interval = '1h', startTime, endTime } = req.query;
        const data = await hyperliquidService.getCandles(
            coin,
            interval,
            startTime ? parseInt(startTime) : null,
            endTime ? parseInt(endTime) : null
        );
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/funding/:coin
 */
router.get('/funding/:coin', async (req, res) => {
    try {
        const { coin } = req.params;
        const data = await hyperliquidService.getFundingRate(coin);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/openinterest
 * Get all open interest data
 */
router.get('/openinterest', async (req, res) => {
    try {
        const data = await hyperliquidService.getAllOpenInterest();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ACCOUNT & TRADING ====================

/**
 * GET /api/hyperliquid/account
 */
router.get('/account', async (req, res) => {
    try {
        const data = await hyperliquidService.getAccountState();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/positions
 */
router.get('/positions', async (req, res) => {
    try {
        const data = await hyperliquidService.getPositions();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/orders/open
 */
router.get('/orders/open', async (req, res) => {
    try {
        const data = await hyperliquidService.getOpenOrders();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hyperliquid/fills
 */
router.get('/fills', async (req, res) => {
    try {
        const { startTime } = req.query;
        const data = await hyperliquidService.getUserFills(
            startTime ? parseInt(startTime) : null
        );
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/hyperliquid/order
 */
router.post('/order', async (req, res) => {
    try {
        const { coin, isBuy, size, price, reduceOnly = false, orderType = 'limit' } = req.body;

        if (!coin || isBuy === undefined || !size || !price) {
            return res.status(400).json({ success: false, error: 'Missing required fields: coin, isBuy, size, price' });
        }

        const order = await hyperliquidService.placeOrder(coin, isBuy, size, price, reduceOnly, orderType);
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/hyperliquid/order/:coin/:oid
 */
router.delete('/order/:coin/:oid', async (req, res) => {
    try {
        const { coin, oid } = req.params;
        const result = await hyperliquidService.cancelOrder(coin, oid);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
