/**
 * Alert API Routes
 * CRUD for price alerts
 */

import express from 'express';
import alertEngine from './AlertEngine.js';

const router = express.Router();

/**
 * GET /api/alerts
 */
router.get('/', (req, res) => {
    res.json({ success: true, alerts: alertEngine.listAlerts() });
});

/**
 * POST /api/alerts
 * Body: { symbol, type, value, label }
 * Types: price_above | price_below
 */
router.post('/', (req, res) => {
    try {
        const alert = alertEngine.createAlert(req.body);
        res.json({ success: true, alert });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

/**
 * DELETE /api/alerts/:id
 */
router.delete('/:id', (req, res) => {
    const deleted = alertEngine.deleteAlert(req.params.id);
    res.json({ success: deleted, id: req.params.id });
});

/**
 * POST /api/alerts/:id/reset
 * Re-arm a triggered alert
 */
router.post('/:id/reset', (req, res) => {
    const alert = alertEngine.resetAlert(req.params.id);
    if (!alert) return res.status(404).json({ success: false, error: 'Alert not found' });
    res.json({ success: true, alert });
});

export default router;
