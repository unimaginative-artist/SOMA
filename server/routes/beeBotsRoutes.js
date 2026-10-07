/**
 * beeBotsRoutes.js
 *
 * REST API routes for SOMA BeeBots Trading Architecture
 * Controls Bizzy (BTC), Boozy (ETH), Breezy (SOL), Laya System 1 Substrate status,
 * and autonomic 1R portfolio risk management.
 */

import express from 'express';
import { SomaBeeService } from '../trading/SomaBeeService.js';
import beePrometheusBridge, { validateSharedTuning } from '../trading/BeePrometheusBridge.js';

let sharedBeeService = null;

function getBeeService(system = {}) {
    if (system.beeService) return system.beeService;
    if (global.SOMA_TRADING && global.SOMA_TRADING.beeService) return global.SOMA_TRADING.beeService;
    if (!sharedBeeService) {
        sharedBeeService = new SomaBeeService();
        if (system) system.beeService = sharedBeeService;
    }
    return sharedBeeService;
}

export default function createBeeBotsRoutes(system = {}) {
    const router = express.Router();

    /**
     * GET /status
     * Live telemetry on swarm status, active positions, portfolio PnL, regime, and Laya health
     */
    router.get('/status', async (_req, res) => {
        try {
            const beeService = getBeeService(system);
            const status = beeService.getStatus();

            // Probe Laya System 1 Substrate status
            let layaHealth = { online: false, device: 'unknown', latencyMs: 0 };
            try {
                const t0 = Date.now();
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 600);
                const layaRes = await fetch('http://127.0.0.1:5055/health', { signal: controller.signal });
                clearTimeout(timeoutId);
                if (layaRes.ok) {
                    const layaData = await layaRes.json();
                    layaHealth = {
                        online: true,
                        model: layaData.model,
                        backbone: layaData.backbone,
                        device: layaData.device,
                        vramAllocatedMb: layaData.vram_allocated_mb,
                        latencyMs: Date.now() - t0
                    };
                }
            } catch {
                layaHealth = {
                    online: false,
                    device: 'algorithmic_rule_fallback',
                    reason: 'Laya daemon offline; high-conviction deterministic fallback active',
                    latencyMs: 0
                };
            }

            res.json({
                ok: true,
                ...status,
                laya: layaHealth,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message, code: 'BEEBOTS_STATUS_FAILED' });
        }
    });

    /**
     * POST /tick
     * Trigger an immediate market tick cycle across all 3 bees
     */
    router.post('/tick', async (_req, res) => {
        try {
            const beeService = getBeeService(system);
            const report = await beeService.tick();
            if (report?.skipped && report.reason === 'trading_intent_stopped') {
                return res.status(409).json({ ok: false, error: 'Trading intent is stopped', code: 'BEEBOTS_TRADING_STOPPED' });
            }
            const summary = beeService.engine.getPortfolioSummary();
            res.json({
                ok: true,
                report,
                portfolio: summary
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message, code: 'BEEBOTS_TICK_FAILED' });
        }
    });

    /**
     * POST /start
     * Start autonomous background trading loop (60s tick interval)
     */
    router.post('/start', async (_req, res) => {
        try {
            const beeService = getBeeService(system);
            await beeService.start();
            res.json({
                ok: true,
                message: 'SOMA BeeBots autonomous loop started',
                status: beeService.getStatus()
            });
        } catch (err) {
            res.status(err.message.includes('Trading intent is stopped') ? 409 : 500)
                .json({ ok: false, error: err.message, code: 'BEEBOTS_START_FAILED' });
        }
    });

    /**
     * POST /stop
     * Stop autonomous background loop
     */
    router.post('/stop', async (_req, res) => {
        try {
            const beeService = getBeeService(system);
            await beeService.stop();
            res.json({
                ok: true,
                message: 'SOMA BeeBots autonomous loop stopped',
                status: beeService.getStatus()
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message, code: 'BEEBOTS_STOP_FAILED' });
        }
    });

    /**
     * GET /ledger
     * Detailed ledger history with all closed trades and R-multiples
     */
    router.get('/ledger', async (_req, res) => {
        try {
            const beeService = getBeeService(system);
            const portfolio = beeService.engine.getPortfolioSummary();
            const ledger = beeService.engine.state;
            res.json({
                ok: true,
                portfolio,
                ledger
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message, code: 'BEEBOTS_LEDGER_FAILED' });
        }
    });

    /**
     * GET /promotion
     * Live Sim-to-Live promotion ladder progress and policy gate checks for BeeBots
     */
    router.get('/promotion', async (_req, res) => {
        try {
            const status = beePrometheusBridge.getPromotionStatus();
            res.json({
                ok: true,
                promotion: status
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message, code: 'BEEBOTS_PROMOTION_STATUS_FAILED' });
        }
    });

    /**
     * POST /reconcile
     * Triggers bidirectional parameter co-optimization sync and Sim-to-Live reconciliation
     */
    router.post('/reconcile', async (_req, res) => {
        try {
            const beeService = getBeeService(system);
            const outcome = await beePrometheusBridge.syncAndReconcile();
            beePrometheusBridge.applyParametersToSwarm(beeService.engine);
            res.json({
                ok: true,
                outcome
            });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message, code: 'BEEBOTS_RECONCILE_FAILED' });
        }
    });

    /**
     * GET /shared-tuning
     * Retrieve current Prometheus-optimized strategy parameters
     */
    router.get('/shared-tuning', (_req, res) => {
        try {
            const params = beePrometheusBridge.loadSharedParameters();
            res.json({ ok: true, params });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    /**
     * POST /shared-tuning
     * Update shared parameters and immediately propagate to running swarm
     */
    router.post('/shared-tuning', (req, res) => {
        try {
            const beeService = getBeeService(system);
            const { tuning } = req.body || {};
            let validated;
            try { validated = validateSharedTuning(tuning); }
            catch (error) { return res.status(400).json({ ok: false, error: error.message }); }

            const current = beePrometheusBridge.loadSharedParameters();
            current.updatedAt = new Date().toISOString();
            current.source = 'manual_operator_or_prometheus_sync';
            current.tuning = Object.fromEntries(Object.entries(current.tuning).map(([key, params]) =>
                [key, { ...params, ...(validated[key] || {}) }]));
            if (!beePrometheusBridge.saveSharedParameters(current)) {
                throw new Error('Shared tuning could not be persisted');
            }
            beePrometheusBridge.applyParametersToSwarm(beeService.engine);

            res.json({ ok: true, params: current });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    return router;
}
