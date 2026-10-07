/**
 * Guardian Routes - REST API for the PositionGuardian
 *
 * Provides endpoints to:
 * - Check guardian status and active positions
 * - Force reconciliation with broker
 * - Set/remove stop-loss and take-profit levels
 * - Halt or resume trading
 */

import express from 'express';

const router = express.Router();

// The guardian instance is injected via the factory function
export default function createGuardianRoutes(guardian) {
    if (!guardian) {
        console.warn('[GuardianRoutes] No guardian instance provided - routes will return 503');
    }

    const requireGuardian = (req, res, next) => {
        if (!guardian) {
            return res.status(503).json({ success: false, error: 'Position Guardian not initialized' });
        }
        next();
    };

    /**
     * GET /api/guardian/status
     * Full guardian state: positions, stops, risk summary
     */
    router.get('/status', requireGuardian, (req, res) => {
        try {
            const status = guardian.getStatus();
            res.json({ success: true, ...status });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * POST /api/guardian/reconcile
     * Force reconciliation of broker positions with risk state
     */
    router.post('/reconcile', requireGuardian, async (req, res) => {
        try {
            const result = await guardian.reconcile();
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * POST /api/guardian/stop-loss/:symbol
     * Set stop-loss for a position
     * Body: { stopPercent: 0.05 } (5% below current price)
     *   or: { stopPrice: 150.00 } (absolute price)
     */
    router.post('/stop-loss/:symbol', requireGuardian, async (req, res) => {
        try {
            const { symbol } = req.params;
            const { stopPercent, stopPrice } = req.body;

            if (!stopPercent && !stopPrice) {
                return res.status(400).json({
                    success: false,
                    error: 'Provide stopPercent (e.g. 0.05 for 5%) or stopPrice (e.g. 150.00)'
                });
            }

            // Get current price from broker
            let currentPrice;
            try {
                const quote = await guardian.alpaca.getQuote(symbol.toUpperCase());
                currentPrice = quote.price;
            } catch (e) {
                // Fallback: check if we have a position with current price
                const pos = guardian.lastPositions.find(p => p.symbol === symbol.toUpperCase());
                if (pos) {
                    currentPrice = pos.current_price;
                } else {
                    return res.status(400).json({
                        success: false,
                        error: `Cannot get price for ${symbol}: ${e.message}`
                    });
                }
            }

            // Calculate stop percent from absolute price if needed
            const effectiveStopPercent = stopPrice
                ? (currentPrice - stopPrice) / currentPrice
                : stopPercent;

            const result = guardian.riskManager.setStopLoss(
                symbol.toUpperCase(),
                currentPrice,
                effectiveStopPercent
            );

            res.json({
                success: true,
                symbol: symbol.toUpperCase(),
                currentPrice,
                stopLoss: result
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * POST /api/guardian/take-profit/:symbol
     * Set take-profit for a position
     * Body: { targetPercent: 0.10 } (10% above current price)
     *   or: { targetPrice: 200.00 } (absolute price)
     */
    router.post('/take-profit/:symbol', requireGuardian, async (req, res) => {
        try {
            const { symbol } = req.params;
            const { targetPercent, targetPrice } = req.body;

            if (!targetPercent && !targetPrice) {
                return res.status(400).json({
                    success: false,
                    error: 'Provide targetPercent (e.g. 0.10 for 10%) or targetPrice (e.g. 200.00)'
                });
            }

            // Get current price
            let currentPrice;
            try {
                const quote = await guardian.alpaca.getQuote(symbol.toUpperCase());
                currentPrice = quote.price;
            } catch (e) {
                const pos = guardian.lastPositions.find(p => p.symbol === symbol.toUpperCase());
                if (pos) {
                    currentPrice = pos.current_price;
                } else {
                    return res.status(400).json({
                        success: false,
                        error: `Cannot get price for ${symbol}: ${e.message}`
                    });
                }
            }

            const effectiveTargetPercent = targetPrice
                ? (targetPrice - currentPrice) / currentPrice
                : targetPercent;

            const result = guardian.riskManager.setTakeProfit(
                symbol.toUpperCase(),
                currentPrice,
                effectiveTargetPercent
            );

            res.json({
                success: true,
                symbol: symbol.toUpperCase(),
                currentPrice,
                takeProfit: result
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * DELETE /api/guardian/stop-loss/:symbol
     * Remove stop-loss for a position
     */
    router.delete('/stop-loss/:symbol', requireGuardian, (req, res) => {
        const { symbol } = req.params;
        const existed = guardian.riskManager.stopLosses.delete(symbol.toUpperCase());
        res.json({ success: true, removed: existed, symbol: symbol.toUpperCase() });
    });

    /**
     * DELETE /api/guardian/take-profit/:symbol
     * Remove take-profit for a position
     */
    router.delete('/take-profit/:symbol', requireGuardian, (req, res) => {
        const { symbol } = req.params;
        const existed = guardian.riskManager.takeProfits.delete(symbol.toUpperCase());
        res.json({ success: true, removed: existed, symbol: symbol.toUpperCase() });
    });

    /**
     * POST /api/guardian/halt
     * Halt all trading immediately
     */
    router.post('/halt', requireGuardian, async (req, res) => {
        try {
            const { reason = 'Manual halt via API' } = req.body;
            await guardian.riskManager.haltTrading(reason, { scope: 'all' });
            res.json({ success: true, message: `Trading halted: ${reason}` });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * POST /api/guardian/resume
     * Resume trading after a halt
     */
    router.post('/resume', requireGuardian, async (req, res) => {
        try {
            await guardian.riskManager.resumeTrading();
            res.json({ success: true, message: 'Trading resumed' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * POST /api/guardian/risk-limits
     * Update risk limits
     */
    router.post('/risk-limits', requireGuardian, (req, res) => {
        try {
            const newLimits = req.body;
            guardian.riskManager.updateLimits(newLimits);
            res.json({
                success: true,
                limits: guardian.riskManager.limits
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}
