/**
 * Opportunity Scanner Routes
 * GET /api/scanner/opportunities?assetType=CRYPTO
 */

import express from 'express';
import opportunityScanner from './OpportunityScanner.js';

const router = express.Router();

router.get('/opportunities', async (req, res) => {
    try {
        const { assetType = 'CRYPTO' } = req.query;
        const opportunities = await opportunityScanner.scan(assetType.toUpperCase());
        
        res.json({
            success: true,
            assetType,
            timestamp: Date.now(),
            opportunities
        });
    } catch (error) {
        console.error('[Scanner API] Failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
