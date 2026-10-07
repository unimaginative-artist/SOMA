import express from 'express';

export function buildBeingStatus(system = {}) {
    const kernel = system.beingKernel;
    if (!kernel) return { success: false, ready: false, error: 'SomaBeingKernel is not initialized' };
    const snapshot = kernel.snapshot();
    return {
        success: true,
        ready: true,
        identity: snapshot.identity,
        continuity: snapshot.continuity,
        attention: snapshot.attention,
        commitments: snapshot.commitments,
        world: snapshot.world,
        recentExperiences: snapshot.experiences.slice(0, 12),
        scoreboard: kernel.getScoreboard()
    };
}

export default function createBeingRoutes(system = {}) {
    const router = express.Router();
    router.get('/status', (_req, res) => {
        const result = buildBeingStatus(system);
        res.status(result.success ? 200 : 503).json(result);
    });
    router.get('/scoreboard', (_req, res) => {
        if (!system.beingKernel) return res.status(503).json({ success: false, error: 'SomaBeingKernel is not initialized' });
        return res.json({ success: true, scoreboard: system.beingKernel.getScoreboard() });
    });
    router.get('/reality', (_req, res) => {
        if (!system.realityLoop) return res.status(503).json({ success: false, error: 'RealityLoop is not initialized' });
        return res.json({ success: true, reality: system.realityLoop.getStatus() });
    });
    return router;
}
