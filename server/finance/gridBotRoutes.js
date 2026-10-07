/**
 * gridBotRoutes.js
 * REST API for the crypto grid trading bot.
 *
 * POST /api/gridbot/start         — start the bot with config
 * POST /api/gridbot/stop          — graceful stop (cancel orders)
 * POST /api/gridbot/emergency-stop— nuclear option (cancel everything)
 * GET  /api/gridbot/status        — current state, P&L, open orders
 * GET  /api/gridbot/decisions     — decision log (newest first)
 * GET  /api/gridbot/preview       — calculate grid levels without starting
 */

import express from 'express';
import gridBot from './GridBot.js';
import gridEngine from './strategies/GridEngine.js';
import binanceService from './BinanceService.js';

const router = express.Router();

// ── Start ─────────────────────────────────────────────────────────────────────

router.post('/start', async (req, res) => {
    try {
        const {
            symbol       = 'BTCUSDT',
            upperPrice,
            lowerPrice,
            gridCount    = 20,
            totalCapital = 1000,
            mode         = 'arithmetic',
            stopLossPct  = 0.05,
            takeProfitPct,
            makerFee     = 0.001,
        } = req.body;

        if (!upperPrice || !lowerPrice) {
            return res.status(400).json({ success: false, error: 'upperPrice and lowerPrice are required.' });
        }

        const result = await gridBot.start(symbol, {
            upperPrice, lowerPrice, gridCount, totalCapital,
            mode, stopLossPct, takeProfitPct, makerFee,
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Stop ─────────────────────────────────────────────────────────────────────

router.post('/stop', async (req, res) => {
    try {
        const result = await gridBot.stop();
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Emergency stop ────────────────────────────────────────────────────────────

router.post('/emergency-stop', async (req, res) => {
    try {
        const result = await gridBot.emergencyStop();
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Status ────────────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
    try {
        res.json({ success: true, status: gridBot.getStatus() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Decision log ──────────────────────────────────────────────────────────────

router.get('/decisions', (req, res) => {
    try {
        const limit   = parseInt(req.query.limit) || 100;
        const decisions = gridBot.getDecisions(limit);
        res.json({ success: true, decisions, total: decisions.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Preview (dry-run level calculation) ──────────────────────────────────────

router.post('/preview', async (req, res) => {
    try {
        const {
            symbol       = 'BTCUSDT',
            upperPrice,
            lowerPrice,
            gridCount    = 20,
            totalCapital = 1000,
            mode         = 'arithmetic',
            makerFee     = 0.001,
        } = req.body;

        if (!upperPrice || !lowerPrice) {
            return res.status(400).json({ success: false, error: 'upperPrice and lowerPrice are required.' });
        }

        // Get live price for context
        let currentPrice = null;
        try {
            const p = await binanceService.getPrice(symbol.toUpperCase());
            currentPrice = p.price;
        } catch (_) { /* not connected — preview still works */ }

        const refPrice = currentPrice ?? (parseFloat(upperPrice) + parseFloat(lowerPrice)) / 2;

        const gridResult = gridEngine.calculateLevels(
            refPrice,
            parseFloat(upperPrice),
            parseFloat(lowerPrice),
            parseInt(gridCount),
            mode
        );

        const capitalPerGrid  = totalCapital / gridCount;
        const gridSpacing     = (parseFloat(upperPrice) - parseFloat(lowerPrice)) / gridCount;
        const qtyPerGrid      = capitalPerGrid / refPrice;
        const profitPerCycle  = gridSpacing * qtyPerGrid;
        const feePerCycle     = (refPrice * qtyPerGrid * makerFee) * 2;
        const netPerCycle     = profitPerCycle - feePerCycle;
        const breakEvenCycles = netPerCycle > 0 ? Math.ceil(totalCapital / (profitPerCycle * gridCount)) : null;

        res.json({
            success: true,
            preview: {
                symbol:          symbol.toUpperCase(),
                currentPrice,
                gridLevels:      gridResult.levels,
                gridSpacing:     gridSpacing.toFixed(2),
                capitalPerGrid:  capitalPerGrid.toFixed(2),
                qtyPerGrid:      qtyPerGrid.toFixed(6),
                profitPerCycle:  profitPerCycle.toFixed(4),
                feePerCycle:     feePerCycle.toFixed(4),
                netPerCycle:     netPerCycle.toFixed(4),
                breakEvenCycles,
                // Rough ROI estimate at 10 crossings/day
                estimatedDailyROI: netPerCycle > 0
                    ? `${((netPerCycle * 10 / totalCapital) * 100).toFixed(3)}%`
                    : 'N/A (grid spacing too small to cover fees)',
                inRange: currentPrice
                    ? (currentPrice >= parseFloat(lowerPrice) && currentPrice <= parseFloat(upperPrice))
                    : null,
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
