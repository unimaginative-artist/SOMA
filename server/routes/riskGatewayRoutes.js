/**
 * Risk Gateway Routes
 * 
 * Exposes endpoints to control SOMA's Pre-Trade Risk Gateway, adjust thresholds,
 * and trigger manual emergency halt/liquidation.
 */

import express from 'express';
import riskGateway from '../finance/RiskGateway.js';
import alpacaService from '../finance/AlpacaService.js';
import binanceService from '../finance/BinanceService.js';
import { requireEnterpriseAuth } from '../loaders/authMiddleware.js';

const router = express.Router();

/**
 * GET /api/risk/gateway/state
 * Returns current risk gateway configuration, hard halt status, and metrics.
 */
router.get('/state', (req, res) => {
    try {
        const riskSummary = global.SOMA_TRADING?.riskManager?.getRiskSummary() || null;
        res.json({
            success: true,
            gateway: {
                isHardHalted: riskGateway.isHardHalted,
                config: riskGateway.config,
                activeCooldowns: Array.from(riskGateway.lastSymbolOrderTime.entries()).map(([sym, time]) => ({
                    symbol: sym,
                    elapsedMs: Date.now() - time,
                    cooldownRemainingMs: Math.max(0, riskGateway.config.symbolCooldownMs - (Date.now() - time))
                })).filter(c => c.cooldownRemainingMs > 0),
                rateLimitUsage: riskGateway.submissionTimestamps.filter(t => Date.now() - t < 10000).length
            },
            portfolioRiskSummary: riskSummary
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/risk/gateway/config
 * Updates the pre-trade risk thresholds on the gateway and persists to disk.
 */
router.post('/config', requireEnterpriseAuth, (req, res) => {
    try {
        const { maxOrderValueUsd, maxOrdersPer10Sec, maxPriceDeviationPct, symbolCooldownMs, failClosedOnQuoteError } = req.body || {};

        const changed = {};
        if (maxOrderValueUsd !== undefined) {
            riskGateway.config.maxOrderValueUsd = parseFloat(maxOrderValueUsd);
            changed.maxOrderValueUsd = riskGateway.config.maxOrderValueUsd;
        }
        if (maxOrdersPer10Sec !== undefined) {
            riskGateway.config.maxOrdersPer10Sec = parseInt(maxOrdersPer10Sec);
            changed.maxOrdersPer10Sec = riskGateway.config.maxOrdersPer10Sec;
        }
        if (maxPriceDeviationPct !== undefined) {
            riskGateway.config.maxPriceDeviationPct = parseFloat(maxPriceDeviationPct);
            changed.maxPriceDeviationPct = riskGateway.config.maxPriceDeviationPct;
        }
        if (symbolCooldownMs !== undefined) {
            riskGateway.config.symbolCooldownMs = parseInt(symbolCooldownMs);
            changed.symbolCooldownMs = riskGateway.config.symbolCooldownMs;
        }
        if (failClosedOnQuoteError !== undefined) {
            riskGateway.config.failClosedOnQuoteError = !!failClosedOnQuoteError;
            changed.failClosedOnQuoteError = riskGateway.config.failClosedOnQuoteError;
        }

        if (Object.keys(changed).length > 0) {
            riskGateway.savePersistedState();
            riskGateway.logAuditEvent('config_updated', { changed, current: riskGateway.config });
            console.log('[RiskGateway] Config updated and persisted:', riskGateway.config);
        }

        res.json({ success: true, config: riskGateway.config });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/risk/gateway/halt
 * Emergency Kill Switch: Locks the gateway and cancels/liquidates ALL active broker exposure.
 */
router.post('/halt', requireEnterpriseAuth, async (req, res) => {
    try {
        const { reason = 'Manual emergency stop triggered via Risk Gateway API' } = req.body || {};

        console.warn(`[RiskGateway] 🚨 EMERGENCY STOP TRIGGERED: ${reason}`);

        // Lock the Gateway immediately
        riskGateway.setHardHalt(true);

        // Also lock SOMA's central RiskManager if present
        const riskManager = global.SOMA_TRADING?.riskManager;
        if (riskManager) {
            await riskManager.haltTrading(reason);
        }

        const brokerResults = { alpaca: null, binance: null };

        // Liquidate Alpaca Positions
        if (alpacaService.isConnected) {
            try {
                brokerResults.alpaca = await alpacaService.closeAllPositions();
            } catch (err) {
                brokerResults.alpaca = { success: false, error: err.message };
            }
        }

        // Liquidate Binance Spot/Futures exposure
        if (binanceService.isConnected) {
            try {
                brokerResults.binance = await binanceService.emergencyStop();
            } catch (err) {
                brokerResults.binance = { success: false, error: err.message };
            }
        }

        res.json({
            success: true,
            message: 'Emergency stop activated. All outgoing order paths locked, open positions closed.',
            brokerResults
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/risk/gateway/resume
 * Resumes trading by disarming the hard stop lock.
 */
router.post('/resume', requireEnterpriseAuth, async (req, res) => {
    try {
        riskGateway.setHardHalt(false);

        // Resume SOMA's central RiskManager if present
        const riskManager = global.SOMA_TRADING?.riskManager;
        if (riskManager) {
            await riskManager.resumeTrading();
        }

        res.json({
            success: true,
            message: 'Emergency stop disarmed. Trade execution path unlocked.'
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
