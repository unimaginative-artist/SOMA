import express from 'express';
import marketEvidenceStore from './MarketEvidenceStore.js';

const router = express.Router();

router.get('/status', (req, res) => {
    res.json({ success: true, status: marketEvidenceStore.getStatus(), summary: marketEvidenceStore.summarize() });
});

router.get('/summary', (req, res) => {
    res.json({ success: true, summary: marketEvidenceStore.summarize() });
});

router.get('/events', (req, res) => {
    const { symbol = null, type = null, limit = 100 } = req.query;
    res.json({
        success: true,
        events: marketEvidenceStore.query({ symbol, type, limit }),
    });
});

router.post('/events', (req, res) => {
    const { type = 'system', payload = {}, options = {} } = req.body || {};
    if (process.env.SOMA_ALLOW_EVIDENCE_POST !== 'true') {
        return res.status(403).json({ success: false, error: 'External evidence append is disabled. Internal services write directly to the evidence store.' });
    }
    const internalToken = process.env.SOMA_INTERNAL_API_TOKEN || process.env.SOMA_EVIDENCE_TOKEN || '';
    if (internalToken && req.get('x-soma-internal-token') !== internalToken) {
        return res.status(403).json({ success: false, error: 'Evidence append requires an internal token.' });
    }
    if (!marketEvidenceStore.isAllowedType(type)) {
        return res.status(400).json({ success: false, error: `Unsupported evidence type: ${type}` });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return res.status(400).json({ success: false, error: 'Evidence payload must be an object.' });
    }
    const record = marketEvidenceStore.append(type, payload, options);
    res.json({ success: true, record });
});

export default router;
