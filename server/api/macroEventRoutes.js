import express from 'express';
const router = express.Router();
import macroEventArbiter from '../../arbiters/MacroEventArbiter.js';
import rippleLoopLedger from '../../core/RippleLoopLedger.js';

// GET /api/macro-events/predictions
// Returns the latest generated causal predictions
router.get('/predictions', (req, res) => {
    try {
        const predictions = macroEventArbiter.getPredictions();
        res.json({ success: true, predictions, data: predictions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/macro-events/analyze
// Triggers a new analysis of current macro events and generates a prediction
router.post('/analyze', async (req, res) => {
    try {
        const force = req.body?.force === true || req.query.force === 'true';
        const allowBrave = req.body?.allowBrave === true || req.query.allowBrave === 'true';
        const result = await macroEventArbiter.analyzeMacroEvents({ force, allowBrave });
        const normalized = {
            ...result,
            headline: result.headlines?.[0] || result.query || 'Macro event scan',
            prediction: result.rippleEffectsPrediction || result.prediction || ''
        };
        res.json({ success: true, prediction: normalized, data: normalized });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/loops/status', (_req, res) => {
    try {
        res.json({ success: true, ...rippleLoopLedger.status() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/loops/outcome-check', async (req, res) => {
    try {
        const id = req.body?.id || req.body?.fingerprint || req.query.id || req.query.fingerprint;
        if (!id) return res.status(400).json({ success: false, error: 'id or fingerprint required' });
        const result = await rippleLoopLedger.assessOutcomeCheck(String(id), {
            force: req.body?.force === true || req.query.force === 'true'
        });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
