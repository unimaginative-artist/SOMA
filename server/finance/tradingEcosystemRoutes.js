import express from 'express';
import ecosystem from './TradingEcosystem.js';

const router = express.Router();
router.get('/status', (_req, res) => {
    try { res.json({ success: true, ecosystem: ecosystem.status() }); }
    catch (error) { res.status(503).json({ success: false, error: error.message }); }
});
router.post('/paper/start', async (req, res) => {
    try { res.json({ success: true, result: await ecosystem.startPaper(req.body?.lane, req.body?.symbol) }); }
    catch (error) { res.status(409).json({ success: false, error: error.message }); }
});
router.post('/paper/pause', async (req, res) => {
    try { res.json({ success: true, result: await ecosystem.pausePaper(req.body?.symbol) }); }
    catch (error) { res.status(409).json({ success: false, error: error.message }); }
});
router.post('/research', async (req, res) => {
    try { res.json({ success: true, report: await ecosystem.research(req.body?.lane, req.body?.symbol) }); }
    catch (error) { res.status(409).json({ success: false, error: error.message }); }
});
export default router;
