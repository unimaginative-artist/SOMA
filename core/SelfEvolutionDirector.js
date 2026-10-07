import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { CAPABILITY_TRIALS } from './CapabilityTrialRegistry.js';

const TERMINAL_FAILURE = new Set(['failed', 'broken', 'verification_failed', 'rejected', 'abandoned', 'cancelled']);

function atomicJson(filePath, value) {
    return fs.mkdir(path.dirname(filePath), { recursive: true })
        .then(() => fs.writeFile(`${filePath}.tmp`, JSON.stringify(value, null, 2), 'utf8'))
        .then(() => fs.rename(`${filePath}.tmp`, filePath));
}

function signatureFor(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

export class SelfEvolutionDirector {
    constructor({ root = process.cwd(), system = null, registry = null, minimumDelta = 0.01 } = {}) {
        this.root = path.resolve(root);
        this.system = system;
        this.registry = registry;
        this.minimumDelta = Math.max(0.001, Number(minimumDelta) || 0.01);
        this.executionProtocolVersion = 9;
        this.stateDir = path.join(this.root, 'data', 'self-evolution');
        this.ledgerPath = path.join(this.stateDir, 'experiments.json');
        this.failurePath = path.join(this.stateDir, 'failed-approaches.json');
        this.experiments = [];
        this.failures = [];
        this._busy = false;
    }

    async initialize(system = this.system) {
        this.system = system || this.system;
        this.registry = this.registry || this.system?.capabilityTrials;
        await fs.mkdir(this.stateDir, { recursive: true });
        try {
            const parsed = JSON.parse(await fs.readFile(this.ledgerPath, 'utf8'));
            if (Array.isArray(parsed)) this.experiments = parsed;
        } catch { /* first run */ }
        try {
            const parsed = JSON.parse(await fs.readFile(this.failurePath, 'utf8'));
            if (Array.isArray(parsed)) this.failures = parsed;
        } catch { /* first run */ }
        return this;
    }

    async prepareCycle({ operationalBaseline = null, targetDomain = null } = {}) {
        if (!this.registry) throw new Error('CapabilityTrialRegistry is unavailable');
        // Always establish a fresh, repeatable baseline. Cached health metrics
        // are useful for dashboards but cannot authorize self-modification.
        const baseline = await this.registry.runSuite({ reason: 'self_evolution_baseline' });
        const requested = targetDomain ? this.registry.listTrials().find(trial => trial.id === targetDomain) : null;
        if (targetDomain && !requested) throw new Error(`Unknown self-evolution target: ${targetDomain}`);
        const target = requested ? {
            dimension: targetDomain, label: requested.label, score: baseline.scores[targetDomain],
            testFiles: requested.tests, paperOnly: requested.paperOnly === true,
            reason: 'Resuming the original bounded experiment target',
        } : this.registry.weakest(baseline);
        const repeatedFailures = this.failures
            .filter(item => item.domain === target.dimension)
            .slice(-5)
            .map(item => ({ signature: item.signature, reason: item.reason, at: item.at }));
        const priorProcedures = this.system?.proceduralMemory?.retrieve?.({
            task: `Improve ${target.label || target.dimension}`,
            domain: target.dimension,
            limit: 5
        }) || [];
        const reusableSkills = this.system?.skillCompiler?.recommend?.({
            task: `Improve ${target.label || target.dimension}`,
            domain: target.dimension
        }) || [];
        const research = this.system?.selfEvolutionResearch
            ? await this.system.selfEvolutionResearch.prepare({ target, baseline, repeatedFailures }) : null;
        return { baseline, operationalBaseline, target, repeatedFailures, priorProcedures, reusableSkills, research };
    }

    buildGoal(target, context = {}) {
        const holdoutTests = CAPABILITY_TRIALS[target.dimension]?.holdoutTests || [];
        const baselineReceipt = context.baseline?.receipts?.[target.dimension];
        const diagnosticOnly = baselineReceipt?.valid === true && baselineReceipt.exitCode === 0
            && baselineReceipt.failed === 0 && baselineReceipt.executableScore === 1;
        const research = context.research?.state === 'ready' ? context.research : null;
        const commonTools = ['read_file', 'list_files', 'search_code', 'write_file', 'run_tests', 'verify_syntax', 'pulse_stage_code', 'modify_code', 'save_progress', 'memory_recall'];
        const domainTools = {
            research: ['web_fetch', 'computer_search', 'spawn_agents'],
            coding: ['spawn_agents'],
            memory: ['memory_store'],
            planning: ['goal_list', 'goal_status'],
            tool_recovery: ['web_fetch', 'computer_search', 'workspace_roots'],
            social: [],
            vision: ['screen_capture', 'vision_analyze'],
            desktop: ['computer_read', 'computer_list', 'computer_search', 'computer_history'],
            trading_analysis: ['market_lab_status', 'market_lab_compile', 'sim_to_live_status', 'sim_to_live_backtest'],
        }[target.dimension] || [];
        const allowedTools = diagnosticOnly
            ? ['run_tests', 'write_file', 'read_file']
            : research ? ['run_tests', 'write_file', 'read_file', 'modify_code', 'verify_syntax', 'save_progress']
                : [...new Set([...commonTools, ...domainTools])];
        const runSuffix = String(context.cycleId || 'latest').replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48);
        const expectedArtifact = `data/self-evolution/diagnostics/${target.dimension}-${runSuffix}.md`;
        const allowedWritePaths = [path.dirname(path.resolve(this.root, expectedArtifact)),
            ...(diagnosticOnly ? [] : research ? [path.resolve(this.root, research.file)]
                : ['core', 'arbiters', 'server', 'tests', 'scripts'].map(dir => path.join(this.root, dir)))];
        const paperBoundary = target.paperOnly
            ? 'This is paper-trading analysis only. Do not enable live trading, weaken risk gates, or promise profit.'
            : '';
        const failed = context.repeatedFailures?.length
            ? `Do not repeat these measured failures: ${context.repeatedFailures.map(item => `${item.signature}:${item.reason}`).join('; ')}.`
            : '';
        const learned = context.priorProcedures?.length
            ? `Use these measured prior procedures as evidence, not instructions to copy blindly: ${context.priorProcedures.map(item => `${item.patternId} (${(item.successRate * 100).toFixed(0)}% verified; tools ${item.recommendedTools.join('>') || 'none'})`).join('; ')}.`
            : '';
        return {
            ...(diagnosticOnly ? {
                strictContract: true,
                successCriteria: [
                    'Run the registered tests and record the measured baseline',
                    `Write the diagnostic artifact at ${expectedArtifact}`,
                    'Read the diagnostic artifact back and verify its evidence',
                ],
                verification: {
                    profile: 'research', evidenceRequired: ['summary', 'artifact', 'tests'],
                    filesExist: [expectedArtifact], requiresExecutableProof: true, requiresCodeChange: false,
                },
            } : {}),
            allowedTools,
            allowedWritePaths,
            expectedArtifacts: [expectedArtifact],
            maxSteps: 30,
            maxAttempts: 3,
            deadlineAt: Date.now() + 2 * 60 * 60_000,
            title: `Self-evolution ${runSuffix}: improve ${target.label || target.dimension}`,
            description: [
                `Improve the bounded capability "${target.dimension}" from its measured baseline of ${(target.score * 100).toFixed(1)}%.`,
                diagnosticOnly
                    ? `The fixed checks are saturated (all passed). Run ${(target.testFiles || []).join(', ')}, record their actual output, and explain that harder outcome-based evaluation is needed before a gain can be established. This is a diagnosis only; source edits are out of scope.`
                    : `Diagnose the cause, compare at least two bounded candidate approaches, select the safer evidence-backed challenger, make one isolated change through the authoritative tools, and verify it with: ${(target.testFiles || []).join(', ')}.`,
                `First write the evidence-backed diagnosis to ${expectedArtifact}; unrelated domains and tools are out of scope.`,
                'Do not claim completion without persisted work-ledger evidence and passing verification.',
                paperBoundary,
                failed,
                learned,
                // Admission evaluates the authorized action, not words inside
                // untrusted test fixtures or paper abstracts. Full details stay
                // in the pinned plan and are used by the exact-file repair tool.
                research ? `Research experiment: ${research.id}. Scoped source: ${research.file}. Use its hash-pinned plan and fixed evaluator; do not expand scope.` : '',
            ].filter(Boolean).join(' '),
            metadata: {
                source: 'SelfEvolutionDirector',
                selfEvolution: true,
                diagnosticOnly,
                researchPlanId: research?.id || null,
                researchInputFingerprint: research?.inputFingerprint || null,
                researchStatus: context.research?.state || 'not_configured',
                researchSources: research?.sources || [],
                // Revision 3 separates saturated-baseline diagnosis from
                // repair and makes diagnosis completion receipt-driven.
                executionProtocolVersion: this.executionProtocolVersion,
                admissionClass: 'self_evolution',
                admissionApproved: false,
                allowAutonomousExecution: true,
                capabilityDomain: target.dimension,
                baselineScore: target.score,
                benchmarkTests: target.testFiles || [],
                allowedTools,
                allowedWritePaths,
                inspectionBudget: 5,
                expectedArtifact,
                workflow: {
                    id: `self-evolution-${target.dimension}`,
                    stages: [
                        `Run the fixed baseline test(s): ${(target.testFiles || []).join(', ')}`,
                        `Inspect only the failing ${target.dimension} execution path and its direct dependencies`,
                        `Write a sourced diagnosis to ${expectedArtifact}`,
                        'Make at most one bounded change through the governed modification path',
                        'Rerun the fixed tests and verify the diagnostic artifact',
                    ],
                },
                paperOnly: target.paperOnly === true,
                priorProcedureIds: (context.priorProcedures || []).map(item => item.patternId),
                reusableSkillIds: (context.reusableSkills || []).map(item => item.id),
                executionMode: 'atomic',
                allowDecomposition: false,
                maxAttempts: 3,
                candidatePolicy: {
                    minimumAlternatives: 2,
                    selectionRule: 'highest_expected_target_gain_with_lowest_cross_domain_risk',
                    validation: 'fixed_candidate_suite_plus_independent_canary',
                },
                capabilityContract: {
                    objective: `Improve ${target.dimension}`,
                    targetDimension: null,
                    maximumCompositeRegression: 0,
                    maximumRegressedDimensions: 0,
                    minimumObservations: 2,
                    testFiles: [...new Set([...(target.testFiles || []), ...holdoutTests])],
                    risk: target.paperOnly ? 'high' : 'medium',
                    requiresContainer: true,
                },
            },
        };
    }

    async openExperiment({ cycleId, goal, preparation }) {
        const existing = this.findByCycle(cycleId);
        if (existing) {
            if (existing.goalId !== goal.id) throw new Error('Self-evolution cycle already belongs to a different goal');
            return existing;
        }
        const governanceBefore = this.system?.selfModificationGovernance?.records?.map(record => record.id) || [];
        const experiment = {
            schemaVersion: 1,
            id: `experiment-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            cycleId,
            goalId: goal.id,
            goalTitle: goal.title,
            domain: preparation.target.dimension,
            state: 'executing',
            openedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            baseline: preparation.baseline,
            operationalBaseline: preparation.operationalBaseline,
            target: preparation.target,
            repeatedFailures: preparation.repeatedFailures,
            researchPlanId: preparation.research?.state === 'ready' ? preparation.research.id : null,
            governanceBefore,
            candidate: null,
            comparison: null,
            decision: null,
            version: null,
        };
        if (experiment.researchPlanId) await this.system.selfEvolutionResearch.startPlan(experiment.researchPlanId, experiment.id);
        this.experiments.push(experiment);
        await this._persist();
        await this.system?.improvementScorecard?.registerExperiment?.(experiment).catch(() => {});
        return experiment;
    }

    findByCycle(cycleId) {
        return this.experiments.find(item => item.cycleId === cycleId) || null;
    }

    getActiveExperiment() {
        return this.experiments.find(item => ['executing', 'canary_running'].includes(item.state)) || null;
    }

    capabilityContractForActiveExperiment() {
        const experiment = this.getActiveExperiment();
        if (!experiment) return null;
        return {
            objective: `Improve ${experiment.domain} for ${experiment.id}`,
            targetDimension: null,
            maximumCompositeRegression: 0,
            maximumRegressedDimensions: 0,
            minimumObservations: 2,
            testFiles: [...new Set([...(experiment.target?.testFiles || []), ...(CAPABILITY_TRIALS[experiment.domain]?.holdoutTests || [])])],
            risk: experiment.target?.paperOnly ? 'high' : 'medium',
            requiresContainer: true,
        };
    }

    async recordOrphan({ cycle, goalId, reason }) {
        const existing = this.findByCycle(cycle.id);
        const failure = this._failure({
            domain: cycle.phases?.identify?.dimension || existing?.domain || 'unknown',
            goalTitle: cycle.phases?.goal?.title || existing?.goalTitle || 'missing goal',
            reason: reason || `Goal ${goalId || 'unknown'} disappeared before verification`,
        });
        if (existing) {
            existing.state = 'orphaned';
            existing.decision = 'rejected';
            existing.failureSignature = failure.signature;
            existing.updatedAt = new Date().toISOString();
            await this.system?.improvementScorecard?.recordExperimentEvaluation?.(existing);
        }
        await this._persist();
        return failure;
    }

    async evaluateCompleted({ cycle, goal, operationalAfter = null, operationalComparison = null }) {
        if (this._busy) return { state: 'evaluation_busy', accepted: false };
        this._busy = true;
        try {
            const experiment = this.findByCycle(cycle.id);
            if (!experiment) return { state: 'missing_experiment', accepted: false };
            const pendingDeployment = (this.system?.selfModificationGovernance?.records || [])
                .find(record => record.goalId === goal.id && record.asiCycleId === cycle.id && record.deployment
                    && ['prepared', 'pending', 'requested', 'rollback_pending', 'rollback_requested'].includes(record.deployment.status));
            if (pendingDeployment) return { state: 'awaiting_deployment', pending: true, accepted: false, experiment };
            if (goal.metadata?.diagnosticOnly === true && goal.metadata?.lastVerification?.passed === true) {
                const baseline = experiment.baseline?.receipts?.[experiment.domain];
                const checked = await this.registry.run(experiment.domain, { reason: `diagnosis:${experiment.id}` });
                const noCodeChanges = !(this.system?.selfModificationGovernance?.records || [])
                    .some(record => record.goalId === goal.id && record.asiCycleId === cycle.id);
                if (baseline?.executableScore === 1 && checked.valid === true && checked.exitCode === 0
                    && checked.failed === 0 && baseline.suiteFingerprint && baseline.suiteFingerprint === checked.suiteFingerprint && noCodeChanges) {
                    experiment.state = 'diagnosis_completed';
                    experiment.decision = 'no_change';
                    experiment.reason = 'Fixed checks saturated: diagnosis verified, no capability improvement claimed. Add outcome-based evaluation from real failures.';
                    experiment.diagnosticReceipt = checked;
                    experiment.updatedAt = new Date().toISOString();
                    await this._persist();
                    await this.system?.selfEvolutionResearch?.recordOutcome?.(experiment);
                    await this.system?.improvementScorecard?.recordExperimentEvaluation?.(experiment);
                    return { state: experiment.state, accepted: false, experiment };
                }
            }
            experiment.state = 'canary_running';
            experiment.updatedAt = new Date().toISOString();
            await this._persist();

            const candidate = await this.registry.runSuite({ reason: `candidate:${experiment.id}` });
            const targetCanary = await this.registry.run(experiment.domain, { reason: `canary:${experiment.id}` });
            const firstTarget = candidate.receipts[experiment.domain];
            const canaryScore = (Number(firstTarget?.score || 0) + Number(targetCanary.score || 0)) / 2;
            candidate.receipts[experiment.domain] = {
                ...targetCanary,
                score: canaryScore,
                canaryObservations: [firstTarget, targetCanary],
            };
            candidate.scores[experiment.domain] = canaryScore;
            candidate.composite = Math.round((Object.values(candidate.scores).reduce((sum, value) => sum + value, 0) / Math.max(1, Object.keys(candidate.scores).length)) * 1000) / 1000;
            const comparison = this.registry.compare(experiment.baseline, candidate);
            const targetBefore = Number(experiment.baseline?.scores?.[experiment.domain] || 0);
            const targetAfter = Number(candidate?.scores?.[experiment.domain] || 0);
            const targetDelta = targetAfter - targetBefore;
            const operationalSafe = !operationalComparison || (operationalComparison.valid !== false
                && operationalComparison.regressed?.length === 0 && operationalComparison.delta >= 0);
            const linkedPromotions = (this.system?.selfModificationGovernance?.records || [])
                .filter(record => record.goalId === goal.id && record.asiCycleId === cycle.id
                    && ['probation', 'accepted'].includes(record.status)
                    && (!record.deployment || record.deployment.status === 'succeeded'));
            const baselineReceipt = experiment.baseline?.receipts?.[experiment.domain];
            const executableDelta = Math.min(Number(firstTarget?.executableScore || 0), Number(targetCanary?.executableScore || 0))
                - Number(baselineReceipt?.executableScore || 0);
            const fixedSuite = Boolean(baselineReceipt?.suiteFingerprint)
                && baselineReceipt.suiteFingerprint === firstTarget?.suiteFingerprint
                && baselineReceipt.suiteFingerprint === targetCanary?.suiteFingerprint;
            const checksPassed = Object.values(candidate.receipts || {}).every(receipt => receipt.valid === true
                && receipt.exitCode === 0 && receipt.failed === 0)
                && firstTarget?.valid === true && firstTarget.exitCode === 0 && firstTarget.failed === 0
                && targetCanary.valid === true && targetCanary.exitCode === 0 && targetCanary.failed === 0;
            const accepted = linkedPromotions.length > 0 && fixedSuite && checksPassed
                && executableDelta >= this.minimumDelta
                && candidate.receipts?.[experiment.domain]?.valid === true
                && targetDelta >= this.minimumDelta
                && comparison.regressed.length === 0
                && comparison.delta > 0
                && operationalSafe;

            experiment.candidate = candidate;
            experiment.operationalAfter = operationalAfter;
            experiment.operationalComparison = operationalComparison;
            experiment.comparison = { ...comparison, targetDelta, executableDelta, fixedSuite, checksPassed, linkedChange: linkedPromotions.length > 0 };
            experiment.decision = accepted ? 'promote' : 'reject';
            experiment.state = accepted ? 'promoted' : 'rejected';
            experiment.updatedAt = new Date().toISOString();

            const newPromotions = linkedPromotions;
            experiment.governancePromotions = newPromotions.map(record => record.id);
            if (!accepted) {
                for (const record of newPromotions) {
                    if (record.status === 'probation') {
                        await this.system.selfModificationGovernance.evaluateProbation(record.id, {
                            forceRollback: true,
                            reason: `self_evolution_regression:${experiment.id}`,
                        });
                    } else {
                        await this.system.selfModificationGovernance.rollbackPromotion(record.id, `self_evolution_regression:${experiment.id}`);
                    }
                }
                const reason = !linkedPromotions.length ? 'No governed code change linked to this exact goal and cycle'
                    : !fixedSuite ? 'Fixed baseline test fingerprint missing or changed'
                    : !checksPassed ? 'Candidate or repeat verification did not pass all registered checks'
                    : executableDelta < this.minimumDelta ? 'No executable improvement; historical score changes do not establish causality'
                    : !operationalSafe ? 'operational benchmark regressed'
                    : comparison.regressed.length ? `cross-domain regression: ${comparison.regressed.map(item => item.domain).join(', ')}`
                        : `target delta ${targetDelta.toFixed(3)} did not exceed ${this.minimumDelta}`;
                experiment.reason = reason;
                const failure = this._failure({ domain: experiment.domain, goalTitle: experiment.goalTitle, reason });
                experiment.failureSignature = failure.signature;
            } else {
                experiment.version = await this.registry.promoteVersion({
                    experimentId: experiment.id,
                    comparison: experiment.comparison,
                    scores: candidate,
                });
            }
            await this._persist();
            await this.system?.selfEvolutionResearch?.recordOutcome?.(experiment);
            await this.system?.improvementScorecard?.recordExperimentEvaluation?.(experiment).catch(() => {});
            return { state: experiment.state, accepted, experiment };
        } finally {
            this._busy = false;
        }
    }

    async recordExecutionFailure({ cycle, goal, reason }) {
        const experiment = this.findByCycle(cycle.id);
        const failure = this._failure({
            domain: experiment?.domain || cycle.phases?.identify?.dimension || 'unknown',
            goalTitle: goal?.title || experiment?.goalTitle || 'unknown goal',
            reason,
        });
        if (experiment) {
            experiment.state = 'execution_failed';
            experiment.decision = 'rejected';
            experiment.failureSignature = failure.signature;
            experiment.updatedAt = new Date().toISOString();
            experiment.reason = reason;
            await this.system?.selfEvolutionResearch?.recordOutcome?.(experiment);
            await this.system?.improvementScorecard?.recordExperimentEvaluation?.(experiment);
        }
        await this._persist();
        return failure;
    }

    async reconcilePromotions() {
        if (this._busy || !this.system?.selfModificationGovernance?.ready) return [];
        const changed = [];
        for (const experiment of this.experiments.filter(item => ['promoted', 'promotion_retracted'].includes(item.state))) {
            const revoked = this.system.selfModificationGovernance.records.find(record =>
                experiment.governancePromotions?.includes(record.id) && record.goalId === experiment.goalId
                && record.asiCycleId === experiment.cycleId
                && (['rolled_back', 'rollback_blocked'].includes(record.status)
                    || ['rollback_pending', 'rollback_requested', 'rolled_back', 'rollback_blocked', 'failed'].includes(record.deployment?.status)));
            if (!revoked) continue;
            const state = revoked.status === 'rolled_back' ? 'rolled_back' : 'promotion_retracted';
            if (experiment.state === state) continue;
            experiment.previousDecision ||= { state: experiment.state, decision: experiment.decision, version: experiment.version };
            experiment.state = state;
            experiment.decision = 'retract';
            experiment.reason = `Governed promotion ${revoked.id} withdrawn: ${revoked.rollbackReason || revoked.deployment?.status || revoked.status}`;
            experiment.updatedAt = new Date().toISOString();
            await this.registry?.retractVersion?.(experiment.id, experiment.reason);
            await this.system?.selfEvolutionResearch?.recordOutcome?.(experiment);
            await this.system?.improvementScorecard?.recordExperimentEvaluation?.(experiment);
            changed.push(experiment);
        }
        if (changed.length) await this._persist();
        return changed;
    }

    getStatus() {
        return {
            running: !this._busy,
            active: this.experiments.filter(item => ['executing', 'canary_running'].includes(item.state)),
            recent: this.experiments.slice(-10),
            failedApproaches: this.failures.slice(-20),
            scoreboard: this.registry?.getStatus?.() || null,
            research: this.system?.selfEvolutionResearch?.getStatus?.() || null,
        };
    }

    _failure({ domain, goalTitle, reason }) {
        const signature = signatureFor({ domain, goalTitle: String(goalTitle).toLowerCase().replace(/\d+/g, '#') });
        const existing = this.failures.find(item => item.signature === signature);
        if (existing) {
            existing.count += 1;
            existing.reason = reason;
            existing.at = new Date().toISOString();
            return existing;
        }
        const failure = { signature, domain, goalTitle, reason, count: 1, at: new Date().toISOString() };
        this.failures.push(failure);
        this.failures = this.failures.slice(-500);
        return failure;
    }

    async _persist() {
        await atomicJson(this.ledgerPath, this.experiments.slice(-200));
        await atomicJson(this.failurePath, this.failures.slice(-500));
    }
}

export default SelfEvolutionDirector;
