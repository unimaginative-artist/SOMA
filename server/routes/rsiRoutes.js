import express from 'express';
import { requireSelfModificationOperatorAuth } from '../loaders/authMiddleware.js';
import { IsolatedCandidateRunner } from '../../core/IsolatedCandidateRunner.js';

// A view and trigger for the existing ASI -> SelfEvolutionDirector -> governed
// candidate pipeline. There is deliberately no second, mock tournament.
export default function createRsiRoutes(system = {}) {
    const router = express.Router();
    router.use(requireSelfModificationOperatorAuth);

    router.get('/status', async (_req, res) => {
        try {
            const isolationReady = await new IsolatedCandidateRunner({ root: system.rootPath || process.cwd() }).dockerAvailable();
            const cycles = system.asiKernel?._cycles || [];
            const ready = Boolean(system.asiKernel && system.selfEvolutionDirector && system.capabilityTrials);
            res.json({
                ok: true,
                engine: 'SOMA governed self-evolution',
                claim: 'Improvement requires a linked code change, independent trials, and probation',
                ready,
                readinessReason: ready ? null : 'Self-evolution components are still initializing or unavailable',
                isolationReady,
                shadowMode: process.env.SOMA_RSI_AUTOPROMOTE_ENABLED !== 'true',
                automaticPromotionReady: isolationReady && Boolean(system.selfModificationGovernance?.ready)
                    && process.env.SOMA_RSI_AUTOPROMOTE_ENABLED === 'true',
                active: system.asiKernel?._activeCycle || null,
                recentCycles: cycles.slice(-5).map(cycle => ({ id: cycle.id, result: cycle.result, startedAt: cycle.startedAt,
                    error: cycle.error || null, admission: cycle.phases?.execute?.admission || null })),
                trials: system.capabilityTrials?.getStatus?.() || null,
                experiments: system.selfEvolutionDirector?.experiments?.slice(-5).map(item => ({ id: item.id, cycleId: item.cycleId, state: item.state, decision: item.decision, reason: item.reason || null })) || [],
            });
        } catch {
            res.status(500).json({ ok: false, error: 'RSI status unavailable', code: 'RSI_STATUS_FAILED' });
        }
    });

    router.post('/evaluate', async (req, res) => {
        if (req.body && Object.keys(req.body).some(key => key !== 'domains')) {
            return res.status(400).json({ ok: false, error: 'Only registered trial domains may be requested' });
        }
        if (!system.capabilityTrials) return res.status(503).json({ ok: false, error: 'Capability trials unavailable' });
        try {
            const requested = req.body?.domains;
            const known = new Set(system.capabilityTrials.listTrials().map(trial => trial.id));
            if (requested !== undefined && (!Array.isArray(requested) || !requested.length || requested.some(domain => !known.has(domain)))) {
                return res.status(400).json({ ok: false, error: 'Unknown or invalid trial domain' });
            }
            const scoreboard = await system.capabilityTrials.runSuite({ reason: 'rsi_operator_evaluation', domains: requested });
            return res.json({ ok: true, scoreboard, promoted: false });
        } catch {
            return res.status(500).json({ ok: false, error: 'Registered trial execution failed', code: 'RSI_EVALUATION_FAILED' });
        }
    });

    router.post('/cycle', async (req, res) => {
        if (req.body && Object.keys(req.body).length) return res.status(400).json({ ok: false, error: 'Cycle inputs are selected by the governed self-evolution director' });
        if (!system.asiKernel || !system.selfEvolutionDirector) return res.status(503).json({ ok: false, error: 'Governed self-evolution unavailable' });
        try {
            const cycle = await system.asiKernel.runCycle();
            if (!cycle) return res.status(409).json({ ok: false, error: 'A cycle is already active or the kernel is stopped' });
            if (cycle.skipped) return res.status(409).json({ ok: false, cycleId: cycle.id, state: cycle.result, error: cycle.reason, promoted: false });
            const accepted = ['pending_execution', 'pending_approval'].includes(cycle.result);
            return res.status(accepted ? 202 : 503).json({
                ok: accepted,
                cycleId: cycle.id,
                state: cycle.result,
                goalId: cycle.phases?.execute?.goalId || null,
                proposalId: cycle.phases?.execute?.proposalId || null,
                admission: cycle.phases?.execute?.admission || null,
                error: cycle.error || null,
                nextStep: cycle.result === 'pending_approval'
                    ? 'Proposal remains queued; inspect admission and retry when the autonomous execution slot is free'
                    : cycle.result === 'pending_execution' ? 'Poll status and the linked goal receipt for verified execution'
                        : 'Inspect the cycle error and repair the blocking dependency before retrying',
                promoted: false,
            });
        } catch {
            return res.status(500).json({ ok: false, error: 'Governed cycle failed', code: 'RSI_CYCLE_FAILED' });
        }
    });
    return router;
}
