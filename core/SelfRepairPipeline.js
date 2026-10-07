import { SelfRepairCandidate } from './SelfRepairCandidate.js';
import { SELF_MODIFICATION_INTERNAL } from './SelfModificationProtocol.js';

export async function runIsolatedRepair(pipeline, governance, entry, preflight, options = {}) {
    let candidate;
    let committed = false;
    let phase = 'draft';
    try {
        let draft;
        if (options.patch) {
            if (pipeline.system.commandBridgeSettings?.authority?.selfModificationApprover !== 'max') throw new Error('External repair requires configured MAX authority');
            // MAX's proposed patch is evidence, not permission to bypass review.
            const shim = await pipeline.system.engineeringSwarm._getMaxApprovalShim();
            const approval = await shim.requestApproval({ filepath: entry.filepath, request: `${entry.proposedChange}\nCandidate patch:\n${JSON.stringify(options.patch)}` });
            draft = { success: true, patch: options.patch, approval };
        } else {
            draft = await pipeline.system.engineeringSwarm.modifyCode(entry.filepath, entry.finalChange, null, {
                protocolToken: SELF_MODIFICATION_INTERNAL, deferPublication: true, candidateOnly: true,
            });
        }
        const approval = draft?.approval || draft?.evidence?.approval;
        if (!draft?.success || !approval?.approved) throw new Error(draft?.error || approval?.reason || 'Explicit MAX approval required');
        phase = 'isolated_validation';
        candidate = await SelfRepairCandidate.create(governance, draft.patch, entry.capabilityContract);
        for (const file of candidate.preflight.files) {
            if (options.sourceHashes && options.sourceHashes[file] !== candidate.preflight.beforeHashes[file]) throw new Error('External repair source changed before validation');
        }
        if (candidate.preflight.head !== preflight.head) throw new Error('Repository changed during drafting');
        entry.isolatedValidation = { ...candidate.validation, isolated: true, passed: true, files: candidate.preflight.files, hashes: candidate.hashes };
        entry.stages.push({ stage: phase, state: 'complete', evidence: entry.isolatedValidation });
        phase = 'nemesis_review';
        const nemesis = pipeline.system.nemesis;
        if (!nemesis?.evaluateCandidate) throw new Error('Independent candidate-aware NEMESIS review unavailable');
        const verdict = await nemesis.evaluateCandidate(candidate.worktree, entry.filepath, entry.finalChange, entry.motivation);
        const independence = governance.reviewerIndependence(approval, verdict);
        if (!independence.passed || !(Number(verdict?.score) >= .7)) throw new Error(verdict?.feedback || 'Candidate review/independence failed');
        entry.reviewerIndependence = independence;
        entry.stages.push({ stage: phase, state: 'approve', score: verdict.score, independence });
        phase = 'evidence_verification';
        const proof = await pipeline._poseidon.verify('Candidate passed independent review and executable checks', {
            falsificationTest: 'Registered candidate tests and independent review must pass before any publication',
            testResult: candidate.validation.passed === true && independence.passed && Number(verdict.score) >= .7,
            evidence: { validation: entry.isolatedValidation, approval, verdict },
        });
        if (proof?.state !== 'TRUE') throw new Error('Poseidon did not verify candidate evidence');
        if (entry.asiCycleId && process.env.SOMA_RSI_AUTOPROMOTE_ENABLED !== 'true') {
            entry.outcome = 'shadow_validated';
            entry.shadowValidation = {
                cycleId: entry.asiCycleId,
                files: candidate.preflight.files,
                beforeHashes: candidate.preflight.beforeHashes,
                afterHashes: candidate.hashes,
                checks: candidate.validation.checks,
                reviewerIndependence: independence,
                published: false,
            };
            entry.stages.push({ stage: 'shadow_evaluation', state: 'complete', evidence: entry.shadowValidation });
            return { state: 'shadow_validated', implemented: false, shelved: true,
                reason: 'Candidate verified in isolation; autonomous RSI publication remains disabled during shadow evaluation', entry };
        }
        phase = 'publication';
        const version = await candidate.commitSnapshot();
        const publication = candidate.publicationSnapshot();
        entry.promotion = await governance.promoteSnapshot({
            proposalId: entry.id, goalId: entry.goalId, asiCycleId: entry.asiCycleId,
            files: candidate.preflight.files, beforeHashes: candidate.preflight.beforeHashes,
            baseline: preflight.baseline, reviewers: independence, sandbox: entry.isolatedValidation,
            capabilityContract: entry.capabilityContract, publication, version, prepared: true,
        });
        await candidate.publish();
        entry.promotion.deployment.status = 'pending';
        await governance._persist();
        committed = true;
        entry.implemented = true;
        entry.outcome = 'promoted';
        entry.poseidonState = '/';
        entry.stages.push({ stage: 'promotion', state: 'complete', commit: entry.promotion.commit, deployment: 'pending' });
    } catch (error) {
        entry.implemented = false;
        entry.outcome = 'deferred';
        entry.failureStage = phase;
        entry.failureReason = error.message;
        if (error.stdout || error.stderr) {
            entry.validationFailure = { output: `${error.stdout || ''}\n${error.stderr || ''}`.slice(-10000) };
        }
        if (candidate && !committed) {
            try {
                await candidate.rollbackPublication();
                if (entry.promotion) {
                    await governance.cancelPreparedDeployment(entry.promotion);
                }
            } catch (rollbackError) { entry.rollback = { restored: false, error: rollbackError.message }; }
        }
    } finally {
        try { await candidate?.close(); }
        catch (error) { entry.cleanupError = error.message; }
        await pipeline._logToLedger(entry);
    }
    return { state: entry.outcome, implemented: entry.implemented, shelved: false,
        reason: entry.failureReason, deploymentPending: committed, entry };
}
