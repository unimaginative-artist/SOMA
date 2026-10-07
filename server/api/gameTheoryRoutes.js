import express from 'express';
const router = express.Router();
import gameTheoryArbiter from '../../arbiters/GameTheoryArbiter.js';

// GET /api/game-theory/stats
router.get('/stats', (req, res) => {
    try {
        const stats = gameTheoryArbiter.getStats();
        res.json({ success: true, data: stats, ...stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/game-theory/run-match
router.post('/run-match', async (req, res) => {
    try {
        const rounds = req.body?.rounds || 5;
        const persona = req.body?.persona
            ? gameTheoryArbiter.personas.find(item => item.name === req.body.persona)
            : null;
        const result = await gameTheoryArbiter.runMatch(rounds, persona);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
