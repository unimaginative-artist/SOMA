import express from 'express';
import BusinessPlanOrchestrator from '../business-planning/BusinessPlanOrchestrator.js';

const orchestrators = new WeakMap();

function getOrchestrator(system) {
    if (!orchestrators.has(system)) orchestrators.set(system, new BusinessPlanOrchestrator(system));
    return orchestrators.get(system);
}

const ownerOf = req => String(req.studioActor?.userId || req.axisUser?.userId || 'local-owner');
const statusFor = error => /not found/i.test(error.message) ? 404 : /Missing required|Unknown operating|item not found/i.test(error.message) ? 400 : /must finish|already preparing|Review the current proposal|can run at once|not ready/i.test(error.message) ? 409 : /not available/i.test(error.message) ? 503 : 500;

export default function createBusinessPlanRoutes(system) {
    const router = express.Router();
    const orchestrator = getOrchestrator(system);

    router.post('/', async (req, res) => {
        try {
            const job = await orchestrator.create(req.body?.profile, { sessionId: req.body?.sessionId, ownerId: ownerOf(req) });
            res.status(202).json({ success: true, job });
        } catch (error) {
            res.status(statusFor(error)).json({ success: false, error: error.message });
        }
    });

    router.get('/:id', async (req, res) => {
        try {
            const job = await orchestrator.get(req.params.id, ownerOf(req));
            if (!job) return res.status(404).json({ success: false, error: 'Business plan job not found' });
            return res.json({ success: true, job });
        } catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/cancel', async (req, res) => {
        try {
            const job = await orchestrator.cancel(req.params.id, ownerOf(req));
            if (!job) return res.status(404).json({ success: false, error: 'Business plan job not found' });
            return res.json({ success: true, job });
        } catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/revisions', async (req, res) => {
        try {
            const result = await orchestrator.createRevision(req.params.id, req.body?.message, req.body?.mode, ownerOf(req));
            res.status(202).json({ success: true, ...result });
        } catch (error) {
            const status = /not found/i.test(error.message) ? 404 : /must finish|Tell SOMA|already preparing|Review the current proposal/.test(error.message) ? 409 : 500;
            res.status(status).json({ success: false, error: error.message });
        }
    });

    router.get('/:id/revisions/:revisionId', async (req, res) => {
        try {
            const result = await orchestrator.getRevision(req.params.id, req.params.revisionId, ownerOf(req));
            if (!result) return res.status(404).json({ success: false, error: 'Revision not found' });
            return res.json({ success: true, ...result });
        } catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/revisions/:revisionId/apply', async (req, res) => {
        try {
            const result = await orchestrator.applyRevision(req.params.id, req.params.revisionId, ownerOf(req));
            return res.json({ success: true, ...result });
        } catch (error) {
            return res.status(/not found/i.test(error.message) ? 404 : 409).json({ success: false, error: error.message });
        }
    });

    router.post('/:id/revisions/:revisionId/discard', async (req, res) => {
        try {
            const result = await orchestrator.discardRevision(req.params.id, req.params.revisionId, ownerOf(req));
            return res.json({ success: true, ...result });
        } catch (error) {
            return res.status(/not found/i.test(error.message) ? 404 : 409).json({ success: false, error: error.message });
        }
    });

    router.get('/:id/versions', async (req, res) => {
        try { return res.json({ success: true, ...(await orchestrator.listVersions(req.params.id, ownerOf(req))) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.get('/:id/versions/:version', async (req, res) => {
        try {
            const version = await orchestrator.getVersion(req.params.id, req.params.version, ownerOf(req));
            return version ? res.json({ success: true, version }) : res.status(404).json({ success: false, error: 'Version not found' });
        } catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.get('/:id/versions/:version/diff', async (req, res) => {
        try {
            const diff = await orchestrator.diffVersion(req.params.id, req.params.version, ownerOf(req));
            return diff ? res.json({ success: true, diff }) : res.status(404).json({ success: false, error: 'Version not found' });
        } catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/versions/:version/restore', async (req, res) => {
        try { return res.json({ success: true, job: await orchestrator.restoreVersion(req.params.id, req.params.version, ownerOf(req)) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/scenarios', async (req, res) => {
        try { return res.status(201).json({ success: true, scenario: await orchestrator.createScenario(req.params.id, req.body, ownerOf(req)) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.patch('/:id/operations', async (req, res) => {
        try { return res.json({ success: true, operatingWorkspace: await orchestrator.updateOperatingWorkspace(req.params.id, req.body, ownerOf(req)) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.put('/:id/model', async (req, res) => {
        try { return res.json({ success: true, job: await orchestrator.recalculateBusinessModel(req.params.id, req.body, ownerOf(req)) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/model/preview', async (req, res) => {
        try { return res.json({ success: true, preview: await orchestrator.previewBusinessModel(req.params.id, req.body, ownerOf(req)) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/model/recalibrate', async (req, res) => {
        try { return res.json({ success: true, ...(await orchestrator.proposeBusinessModelRecalibration(req.params.id, req.body?.request, ownerOf(req))) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/model/proposals/:proposalId/apply', async (req, res) => {
        try { return res.json({ success: true, job: await orchestrator.applyBusinessModelProposal(req.params.id, req.params.proposalId, ownerOf(req)) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/model/proposals/:proposalId/discard', async (req, res) => {
        try { return res.json({ success: true, job: await orchestrator.discardBusinessModelProposal(req.params.id, req.params.proposalId, ownerOf(req)) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.get('/:id/exports/:format', async (req, res) => {
        try {
            const result = await orchestrator.exportBusinessPlan(req.params.id, req.params.format, ownerOf(req));
            res.setHeader('Content-Type', result.mimeType); res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
            return res.send(result.buffer);
        } catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.post('/:id/arbiterium-handoff', async (req, res) => {
        try { return res.status(201).json({ success: true, ...(await orchestrator.prepareArbiteriumHandoff(req.params.id, ownerOf(req))) }); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    router.delete('/:id', async (req, res) => {
        try { await orchestrator.delete(req.params.id, ownerOf(req)); return res.status(204).end(); }
        catch (error) { return res.status(statusFor(error)).json({ success: false, error: error.message }); }
    });

    return router;
}
