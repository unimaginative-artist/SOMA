/**
 * Alpaca API Routes for Mission Control
 * Handles real money trading integration with Alpaca Markets
 */

import express from 'express';
import alpacaService from './AlpacaService.js';

const router = express.Router();

/**
 * POST /api/alpaca/connect
 * Connect to Alpaca with API credentials
 * Supports separate Paper and Live credential sets via credentialType param
 */
router.post('/connect', async (req, res) => {
    try {
        const { apiKey, secretKey, paperTrading, credentialType, baseUrl } = req.body;

        if (!apiKey || !secretKey) {
            return res.status(400).json({
                success: false,
                error: 'API Key and Secret Key are required'
            });
        }

        // Determine paper mode from credentialType or explicit paperTrading param
        const isPaper = credentialType === 'alpaca_paper' ? true :
                        credentialType === 'alpaca_live' ? false :
                        paperTrading;

        const result = await alpacaService.connect(apiKey, secretKey, isPaper, true, credentialType, baseUrl);

        res.json({
            success: true,
            account: result.account,
            credentialType: result.credentialType
        });
    } catch (error) {
        console.error('[Alpaca API] Connection failed:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/alpaca/disconnect
 * Disconnect from Alpaca
 */
router.post('/disconnect', (req, res) => {
    try {
        alpacaService.disconnect();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/alpaca/status
 * Get connection status
 */
router.get('/status', (req, res) => {
    try {
        const status = alpacaService.getStatus();
        res.json({
            success: true,
            status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/alpaca/clear-credentials
 * Clear saved API credentials from disk
 * Can specify credentialType: 'alpaca_paper' or 'alpaca_live'
 */
router.post('/clear-credentials', (req, res) => {
    try {
        const { credentialType } = req.body;
        alpacaService.clearCredentials(credentialType);

        // Only disconnect if clearing the currently connected credential type
        const status = alpacaService.getStatus();
        if (!credentialType || credentialType === status.credentialType) {
            alpacaService.disconnect();
        }

        res.json({
            success: true,
            message: `${credentialType || 'Alpaca'} credentials cleared`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/alpaca/has-credentials
 * Check if credentials are saved (supports ?type=alpaca_paper or alpaca_live)
 */
router.get('/has-credentials', (req, res) => {
    try {
        const { type } = req.query;
        const hasCredentials = alpacaService.hasStoredCredentials(type || null);
        res.json({
            success: true,
            hasCredentials,
            // Also return detailed status for frontend to know which credentials exist
            hasPaperCredentials: alpacaService.hasStoredCredentials('alpaca_paper'),
            hasLiveCredentials: alpacaService.hasStoredCredentials('alpaca_live')
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/alpaca/account
 * Get account information and positions
 */
router.get('/account', async (req, res) => {
    try {
        const accountData = await alpacaService.getAccount();
        res.json({
            success: true,
            data: accountData
        });
    } catch (error) {
        console.error('[Alpaca API] Failed to get account:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/alpaca/orders
 * Get recent orders
 */
router.get('/orders', async (req, res) => {
    try {
        const { status = 'all', limit = 50 } = req.query;
        const orders = await alpacaService.getOrders(status, parseInt(limit));
        
        res.json({
            success: true,
            orders
        });
    } catch (error) {
        console.error('[Alpaca API] Failed to get orders:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/alpaca/order
 * Execute a trade order
 */
router.post('/order', async (req, res) => {
    try {
        const { symbol, side, qty, orderType = 'market', timeInForce = 'day' } = req.body;

        if (!symbol || !side || !qty) {
            return res.status(400).json({
                success: false,
                error: 'Symbol, side, and quantity are required'
            });
        }

        const order = await alpacaService.executeOrder(
            symbol,
            side,
            parseFloat(qty),
            orderType,
            timeInForce
        );

        res.json({
            success: true,
            order
        });
    } catch (error) {
        console.error('[Alpaca API] Order failed:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/alpaca/trailing-stop
 * Place a trailing stop order
 * Body: { symbol, side, qty, trailPercent }
 */
router.post('/trailing-stop', async (req, res) => {
    try {
        const { symbol, side, qty, trailPercent } = req.body;
        if (!symbol || !side || !qty || !trailPercent) {
            return res.status(400).json({ success: false, error: 'symbol, side, qty, and trailPercent are required' });
        }
        const order = await alpacaService.placeTrailingStopOrder(symbol, side, parseFloat(qty), parseFloat(trailPercent));
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/alpaca/quote/:symbol
 * Get real-time quote for a symbol
 */
router.get('/quote/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const quote = await alpacaService.getQuote(symbol.toUpperCase());
        
        res.json({
            success: true,
            quote
        });
    } catch (error) {
        console.error(`[Alpaca API] Failed to get quote for ${req.params.symbol}:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/alpaca/position/:symbol
 * Get position for a specific symbol
 */
router.get('/position/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const position = await alpacaService.getPosition(symbol.toUpperCase());
        
        res.json({
            success: true,
            position
        });
    } catch (error) {
        console.error(`[Alpaca API] Failed to get position for ${req.params.symbol}:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/alpaca/position/:symbol
 * Close position for a symbol
 */
router.delete('/position/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const result = await alpacaService.closePosition(symbol.toUpperCase());
        
        res.json({
            success: true,
            result
        });
    } catch (error) {
        console.error(`[Alpaca API] Failed to close position for ${req.params.symbol}:`, error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/alpaca/emergency-stop
 * EMERGENCY: Close ALL positions and cancel ALL orders
 */
router.post('/emergency-stop', async (req, res) => {
    try {
        console.error('[Alpaca] *** EMERGENCY STOP TRIGGERED ***');

        if (!alpacaService.isConnected) {
            return res.json({
                success: true,
                message: 'Not connected to broker - no positions to close',
                result: { ordersCanelled: 0, positions: [] }
            });
        }

        const result = await alpacaService.closeAllPositions();

        res.json({
            success: true,
            message: 'EMERGENCY STOP: All positions closed, all orders cancelled',
            result
        });
    } catch (error) {
        console.error('[Alpaca] Emergency stop error:', error.message);
        res.status(500).json({
            success: false,
            error: `Emergency stop partially failed: ${error.message}`
        });
    }
});

/**
 * GET /api/alpaca/positions
 * Get all open positions
 */
router.get('/positions', async (req, res) => {
    try {
        if (!alpacaService.isConnected) {
            return res.json({ success: true, positions: [] });
        }

        const positions = await alpacaService.getPositions();
        res.json({ success: true, positions });
    } catch (error) {
        console.error('[Alpaca] Failed to get positions:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
