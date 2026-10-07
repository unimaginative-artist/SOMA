/**
 * SelfModificationPipeline.js
 *
 * SOMA's autonomous self-improvement loop.
 * Every proposed code change passes through this pipeline before touching disk:
 *
 *   SOMA draft
 *     → Steve review (independent internal perspective)
 *     → Adversarial brain debate (LOGOS × THALAMUS)
 *     → SOMA synthesizes all feedback into a final change
 *     → EngineeringSwarm implements
 *     → NEMESIS code gate (specialized, not prose gate)
 *     → Poseidon.verify() — TRUE must be earned
 *     → Log to self_mod_ledger.jsonl + contested_changes.json
 *
 * Up to 3 rounds. On round failure: shelve (not abandon, not human-gate).
 * Nothing requires Owner. Contested changes queue for next relevant session.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'node:crypto';
import { Poseidon } from './Poseidon.js';
import { recordTruth } from './TruthLedger.js';
import { resolveWithinRoot } from './PathSafety.js';
import { protectionForArchitecturePath } from './ArchitectureProtectionPolicy.js';
import { normalizeCapabilityContract } from './SelfModificationCapabilityContract.js';
import { runIsolatedRepair } from './SelfRepairPipeline.js';
import {
    SELF_MODIFICATION_INTERNAL,
    SELF_MODIFICATION_PROTOCOL_VERSION,
    SelfModificationDecision,
    stageReceipt,
} from './SelfModificationProtocol.js';
import { globalQwenAuditGate } from './QwenAuditGate.js';

const ROOT = process.cwd();
const LEDGER_PATH    = path.join(ROOT, 'data', 'self_mod_ledger.jsonl');
const CONTESTED_PATH = path.join(ROOT, 'data', 'contested_changes.json');
const PULSE_SELF_MOD_ROOT = path.join(ROOT, 'data', 'code-lab', 'sandbox', 'pulse-self-mod');
const execFileAsync = promisify(execFile);

// Files SOMA must never autonomously modify — only Owner can touch these
const IMMUTABLE_PATHS = [
    'server/routes/somaRoutes.js',
    'launcher_ULTRA.mjs',
    'start_production.bat',
    'clean_restart.bat',
    'core/SomaBootstrapV2.js',
    'core/SelfModificationPipeline.js',
    'server/loaders/',
    'config/',
    'ecosystem.config.cjs',
];

function safeStageId(input = '') {
    return String(input || 'selfmod')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'selfmod';
}

function isNodeSyntaxFile(filePath = '') {
    return /\.(js|cjs|mjs)$/i.test(filePath);
}

export class SelfModificationPipeline {
    constructor(config = {}) {
        this.root = config.root || ROOT;
        this.name     = 'SelfModificationPipeline';
        this.maxRounds = config.maxRounds || 3;
        this.system    = null;
        this._poseidon = new Poseidon({ threshold: 0.70 });
        this._queue = Promise.resolve();
        this._activeProposal = null;
    }

    initialize(system) {
        this.system = system;
        console.log(`[${this.name}] ✅ Self-modification pipeline ready (max ${this.maxRounds} rounds)`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // MAIN ENTRY POINT
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Propose a self-modification.
     * @param {string} filepath      - relative path to file being changed
     * @param {string} proposedChange - description of the change + rationale
     * @param {string} motivation    - why SOMA wants this change (from goal/curiosity)
     * @returns {{ state, implemented, shelved, round, nemesisScore, entry }}
     */
    async propose(filepath, proposedChange, motivation = 'autonomous improvement', options = {}) {
        const run = async () => {
            this._activeProposal = { filepath, motivation, startedAt: new Date().toISOString() };
            const ledger = this.system?.executionEventLedger || this.system?.toolRegistry?.executionLedger || null;
            const sessionId = options.executionSessionId || `selfmod-${crypto.randomUUID()}`;
            const ownsSession = !options.executionSessionId;
            try {
                await ledger?.startSession(sessionId, {
                    kind: 'self-modification',
                    actor: this.name,
                    profileId: 'self-modification-governed',
                    target: filepath,
                    reasoningAuthority: 'SOMA self-modification governance',
                    observationalOnly: true
                }).catch(() => {});
                await ledger?.append(sessionId, 'selfmod/proposal', {
                    filepath,
                    proposedChange,
                    motivation,
                    capabilityContract: options.capabilityContract || null,
                    externalEvidence: options.externalEvidence || null
                }).catch(() => {});
                const result = await this._proposeUnlocked(filepath, proposedChange, motivation, options);
                await ledger?.append(sessionId, 'selfmod/result', {
                    filepath,
                    state: result.state,
                    poseidon: result.poseidon || null,
                    implemented: result.implemented === true,
                    shelved: result.shelved === true,
                    reason: result.reason || null,
                    round: result.round || 0,
                    nemesisScore: result.nemesisScore ?? null,
                    stages: result.entry?.stages || []
                }).catch(() => {});
                if (ownsSession) await ledger?.endSession(sessionId, {
                    ok: result.implemented === true,
                    state: result.state,
                    target: filepath
                }).catch(() => {});
                return result;
            } catch (error) {
                await ledger?.append(sessionId, 'selfmod/error', {
                    filepath,
                    error: { name: error.name, message: error.message, code: error.code || null }
                }).catch(() => {});
                if (ownsSession) await ledger?.endSession(sessionId, {
                    ok: false,
                    state: 'error',
                    target: filepath,
                    error: error.message
                }).catch(() => {});
                throw error;
            } finally {
                this._activeProposal = null;
            }
        };
        const queued = this._queue.then(run, run);
        this._queue = queued.catch(() => {});
        return queued;
    }

    async _proposeUnlocked(filepath, proposedChange, motivation = 'autonomous improvement', options = {}) {
        if (typeof filepath !== 'string' || !filepath.trim()) {
            return { state: 'blocked', implemented: false, shelved: false, reason: 'Self-modification filepath is required' };
        }
        if (typeof proposedChange !== 'string' || !proposedChange.trim()) {
            return { state: 'blocked', implemented: false, shelved: false, filepath, reason: 'A precise self-modification request is required' };
        }
        // Guard: never allow autonomous modification of protected infrastructure files
        const normalised = filepath.replace(/\\/g, '/');
        const domainProtection = protectionForArchitecturePath(normalised);
        if (domainProtection.protected) {
            console.warn(`[${this.name}] 🚫 BLOCKED protected ${domainProtection.domain} path: "${filepath}"`);
            return {
                state: 'blocked',
                implemented: false,
                shelved: false,
                filepath,
                protectedDomain: domainProtection.domain,
                reason: domainProtection.reason,
            };
        }
        const blocked = IMMUTABLE_PATHS.find(p => normalised.includes(p.replace(/\\/g, '/')));
        if (blocked) {
            console.warn(`[${this.name}] 🚫 BLOCKED: "${filepath}" matches protected path "${blocked}". Only Owner can modify this.`);
            return { state: 'blocked', implemented: false, shelved: false, filepath, reason: `Protected path: ${blocked}` };
        }

        console.log(`[${this.name}] 🔧 Proposal: ${filepath}`);
        console.log(`[${this.name}]    Motivation: ${motivation.substring(0, 80)}`);
        let absPath;
        try {
            absPath = resolveWithinRoot(this.root, filepath, 'Self-modification path');
        } catch (error) {
            return { state: 'blocked', implemented: false, shelved: false, filepath, reason: error.message };
        }
        let originalContent = null;
        try {
            originalContent = await fs.readFile(absPath, 'utf8');
        } catch (e) {
            return { state: 'blocked', implemented: false, shelved: false, filepath, reason: `Unable to snapshot original file: ${e.message}` };
        }
        const expectedSourceHash = options.externalEvidence?.sourceHash;
        const currentSourceHash = crypto.createHash('sha256').update(originalContent).digest('hex');
        if (expectedSourceHash && expectedSourceHash !== currentSourceHash) {
            return { state: 'deferred', implemented: false, shelved: false, filepath, reason: 'External proposal is stale: source hash changed before governance' };
        }

        const governance = await (this.governanceReady || Promise.resolve(this.system?.selfModificationGovernance || null));
        let governancePreflight = null;
        if (this.system?.selfModificationGovernance && !governance) {
            return { state: 'deferred', implemented: false, shelved: false, filepath, reason: 'Persistent self-modification governance is unavailable' };
        }

        const entry = {
            id:          `selfmod-${Date.now()}`,
            timestamp:   new Date().toISOString(),
            filepath,
            motivation,
            proposedChange: proposedChange.substring(0, 500),
            steveReview:    null,
            brainDebate:    null,
            finalChange:    proposedChange,
            pulseSandbox:   null,
            protocolVersion: SELF_MODIFICATION_PROTOCOL_VERSION,
            stages:         [],
            outcome:        'running',
            failureStage:   null,
            failureReason:  null,
            failureDecision: null,
            rounds:         [],
            poseidonState:  '|',
            implemented:    false,
            shelved:        false
        };
        entry.externalEvidence = options.externalEvidence || null;
        entry.goalId = options.goalId || null;
        entry.asiCycleId = options.asiCycleId || null;
        entry.capabilityContract = normalizeCapabilityContract(options.capabilityContract, {
            filepath, motivation, proposedChange,
        });

        // Owner's Directive: Fallback LLMs must ask Qwen 3.8 27B before any changes
        if (options.authorityTier === 'local' || options.localModel === true) {
            const auditGate = this.system?.qwenAuditGate || globalQwenAuditGate;
            const audit = await auditGate.auditProposedChange({
                caller: options.actor || options.caller || 'local-fallback',
                model: options.model || 'local',
                toolName: 'modify_code',
                targetPath: filepath,
                explanation: motivation,
                args: { filepath, proposedChange: proposedChange.slice(0, 1000) }
            });
            entry.qwenAudit = audit;
            if (!audit.approved) {
                entry.outcome = 'rejected';
                entry.failureStage = 'qwen_27b_audit';
                entry.failureDecision = SelfModificationDecision.REJECT;
                entry.failureReason = audit.reason;
                entry.stages.push(stageReceipt('qwen_27b_audit', 'reject', { reason: audit.reason }));
                await this._logToLedger(entry);
                return { state: 'rejected', implemented: false, shelved: false, reason: `Qwen 3.8 27B rejected proposal: ${audit.reason}`, entry };
            }
            entry.stages.push(stageReceipt('qwen_27b_audit', 'complete', { approvedBy: audit.qwenModel, risk: audit.risk }));
        }

        if (governance) {
            try {
                governancePreflight = await governance.preflight({ proposalId: entry.id, files: [normalised], isolated: true });
                entry.governance = { preflight: governancePreflight };
                entry.stages.push(stageReceipt('git_preflight', 'complete', { head: governancePreflight.head, files: governancePreflight.files }));
            } catch (error) {
                entry.outcome = 'deferred';
                entry.failureStage = 'git_preflight';
                entry.failureDecision = SelfModificationDecision.DEFER;
                entry.failureReason = error.message;
                entry.stages.push(stageReceipt('git_preflight', 'defer', { reason: error.message }));
                await this._logToLedger(entry);
                return { state: entry.outcome, implemented: false, shelved: false, reason: error.message, entry };
            }
        }

        if (governance) {
            return runIsolatedRepair(this, governance, entry, governancePreflight, options);
        }

        // ── Phase 1: Steve review ─────────────────────────────────────────
        try {
            entry.steveReview = await this._getSteveReview(filepath, proposedChange);
            entry.stages.push(stageReceipt('internal_review', 'complete', { reviewer: 'steve' }));
            console.log(`[${this.name}] Steve reviewed: ${entry.steveReview.substring(0, 60)}`);
        } catch (e) {
            entry.steveReview = `Steve unavailable: ${e.message}`;
        }

        // ── Phase 2: Adversarial brain debate (LOGOS × THALAMUS) ─────────
        try {
            entry.brainDebate = await this._getAdversarialDebate(filepath, proposedChange);
            entry.stages.push(stageReceipt('adversarial_debate', 'complete'));
            console.log(`[${this.name}] Brain debate complete`);
        } catch (e) {
            entry.brainDebate = `Debate failed: ${e.message}`;
        }

        // ── Phase 3: SOMA synthesizes all input into refined change ───────
            try {
                entry.finalChange = await this._synthesize(
                filepath, proposedChange, entry.steveReview, entry.brainDebate
            );
            entry.stages.push(stageReceipt('synthesis', 'complete'));
        } catch (e) {
            entry.finalChange = proposedChange; // fallback to original
        }

        // ── Phase 4: Implementation + NEMESIS gate (up to maxRounds) ─────
        let lastNemesis = null;
        let activePromotionHandle = null;
        for (let round = 0; round < this.maxRounds; round++) {
            const roundEntry = { round: round + 1, nemesisScore: null, nemesisPassed: false, error: null };
            let implResult = null;

            // Implement via EngineeringSwarm
            try {
                implResult = await this._implement(filepath, entry.finalChange);
                roundEntry.approval = implResult?.approval || implResult?.evidence?.approval || null;
                if (!implResult.success) {
                    roundEntry.error = implResult.error || 'EngineeringSwarm failed';
                    roundEntry.failureStage = implResult?.approval?.stage || 'implementation';
                    roundEntry.failureDecision = implResult?.deferred
                        ? SelfModificationDecision.DEFER
                        : (implResult?.rejected ? SelfModificationDecision.REJECT : SelfModificationDecision.ERROR);
                    entry.failureStage = roundEntry.failureStage;
                    entry.failureDecision = roundEntry.failureDecision;
                    entry.failureReason = roundEntry.error;
                    entry.stages.push(stageReceipt(
                        roundEntry.failureStage,
                        roundEntry.failureDecision,
                        { round: round + 1, reason: roundEntry.error, approval: roundEntry.approval }
                    ));
                    entry.rounds.push(roundEntry);
                    break;
                }
                roundEntry.implementationEvidence = implResult.evidence || null;
                activePromotionHandle = implResult.promotionHandle || null;
                entry.stages.push(stageReceipt('implementation', 'complete', {
                    round: round + 1,
                    approval: roundEntry.approval,
                    changedFiles: implResult?.evidence?.changedFiles || [],
                }));
            } catch (e) {
                roundEntry.error = e.message;
                entry.rounds.push(roundEntry);
                break;
            }

            // NEMESIS code gate
            try {
                lastNemesis = await this._nemesisCodeGate(filepath, entry.finalChange, motivation);
                roundEntry.nemesisScore = lastNemesis.score;
                roundEntry.nemesisFeedback = lastNemesis.feedback?.substring(0, 200);

                if (lastNemesis.decision === SelfModificationDecision.UNAVAILABLE
                    || lastNemesis.decision === SelfModificationDecision.DEFER
                    || lastNemesis.decision === SelfModificationDecision.ERROR) {
                    roundEntry.error = lastNemesis.feedback || 'NEMESIS unavailable';
                    roundEntry.failureStage = 'nemesis_review';
                    roundEntry.failureDecision = lastNemesis.decision;
                    entry.failureStage = 'nemesis_review';
                    entry.failureDecision = lastNemesis.decision;
                    entry.failureReason = roundEntry.error;
                    entry.stages.push(stageReceipt('nemesis_review', lastNemesis.decision, {
                        round: round + 1,
                        reason: roundEntry.error,
                    }));
                    entry.rounds.push(roundEntry);
                    break;
                }

                if (lastNemesis.decision === SelfModificationDecision.APPROVE && lastNemesis.score >= 0.70) {
                    roundEntry.nemesisPassed = true;
                    entry.stages.push(stageReceipt('nemesis_review', 'approve', {
                        round: round + 1,
                        score: lastNemesis.score,
                    }));

                    if (governance) {
                        const independence = governance.reviewerIndependence(roundEntry.approval, lastNemesis);
                        entry.reviewerIndependence = independence;
                        if (!independence.passed) {
                            entry.implemented = false;
                            entry.failureStage = 'reviewer_independence';
                            entry.failureDecision = SelfModificationDecision.DEFER;
                            entry.failureReason = 'MAX and NEMESIS resolved to the same reviewer fingerprint';
                            entry.stages.push(stageReceipt('reviewer_independence', 'defer', independence));
                            break;
                        }
                        entry.stages.push(stageReceipt('reviewer_independence', 'complete', independence));
                    }
                    entry.rounds.push(roundEntry);

                    // Poseidon verify — TRUE must be earned
                    const verified = await this._poseidon.verify(
                        `Change to ${filepath} is correct, safe, and solves the stated problem`,
                        {
                            falsificationTest: lastNemesis.falsificationTest || 'Engineering verification and NEMESIS review must both pass',
                            testResult: lastNemesis.score >= 0.70 && implResult?.evidence?.verification?.passed === true,
                            evidence: implResult?.evidence || null,
                        }
                    );

                    entry.poseidonState = verified.prefix; // /, |, or \
                    entry.implemented   = verified.state === 'TRUE';
                    entry.stages.push(stageReceipt('evidence_verification', entry.implemented ? 'approve' : 'reject', {
                        round: round + 1,
                        poseidon: verified.prefix,
                    }));
                    if (entry.implemented) {
                        entry.pulseSandbox = await this._stagePulseValidation(entry, absPath);
                        if (entry.pulseSandbox?.promotion?.allowed !== true) {
                            entry.implemented = false;
                            entry.poseidonState = '|';
                            roundEntry.error = `Candidate snapshot validation failed: ${entry.pulseSandbox?.promotion?.evidence || entry.pulseSandbox?.syntax?.output || 'unknown error'}`;
                            entry.failureStage = 'candidate_validation';
                            entry.failureDecision = SelfModificationDecision.REJECT;
                            entry.failureReason = roundEntry.error;
                        }
                    }

                    if (entry.implemented && activePromotionHandle) {
                        const changedFiles = implResult?.evidence?.changedFiles || activePromotionHandle.changedFiles || [normalised];
                        const candidatePreflight = implResult?.evidence?.governancePreflight || governancePreflight;
                        const unexpected = changedFiles.map(file => file.replace(/\\/g, '/')).filter(file => !candidatePreflight?.files?.includes(file));
                        if (governance && (unexpected.length || candidatePreflight?.head !== governancePreflight?.head)) {
                            throw new Error(unexpected.length
                                ? `Candidate changed files outside its clean preflight scope: ${unexpected.join(', ')}`
                                : 'Repository HEAD changed during self-modification review');
                        }
                        if (governance) {
                            entry.isolatedValidation = await governance.validateInWorktree({
                                proposalId: entry.id,
                                files: changedFiles,
                                contract: entry.capabilityContract,
                            });
                            entry.stages.push(stageReceipt('isolated_validation', 'complete', entry.isolatedValidation));
                            entry.promotion = await governance.promote({
                                proposalId: entry.id,
                                goalId: entry.goalId,
                                asiCycleId: entry.asiCycleId,
                                files: changedFiles,
                                baseline: governancePreflight?.baseline || null,
                                beforeHashes: candidatePreflight?.beforeHashes || null,
                                reviewers: entry.reviewerIndependence || null,
                                sandbox: entry.isolatedValidation,
                                capabilityContract: entry.capabilityContract,
                            });
                        }
                        await activePromotionHandle.commit();
                        entry.stages.push(stageReceipt('promotion', 'complete', {
                            round: round + 1,
                            changedFiles,
                            commit: entry.promotion?.commit || null,
                            probationEndsAt: entry.promotion?.probationEndsAt || null,
                        }));
                        activePromotionHandle = null;
                    }

                    console.log(`[${this.name}] ${verified.prefix} Poseidon ${verified.state} — round ${round + 1}`);
                    break;
                }

                // NEMESIS rejected — incorporate feedback for next round
                entry.failureStage = 'nemesis_review';
                entry.failureDecision = SelfModificationDecision.REJECT;
                entry.failureReason = lastNemesis.feedback || `NEMESIS score ${lastNemesis.score}`;
                entry.stages.push(stageReceipt('nemesis_review', 'reject', {
                    round: round + 1,
                    score: lastNemesis.score,
                    reason: entry.failureReason,
                }));
                const canRetryWithFix = round < this.maxRounds - 1 && !!lastNemesis.suggestedFix;
                if (canRetryWithFix) {
                    console.log(`[${this.name}] ⚠️ NEMESIS scored ${lastNemesis.score.toFixed(2)} — retrying with feedback (round ${round + 2})`);
                    if (activePromotionHandle) {
                        await activePromotionHandle.rollback();
                        activePromotionHandle = null;
                    }
                    entry.finalChange = lastNemesis.suggestedFix;
                }
                entry.rounds.push(roundEntry);
                if (!canRetryWithFix) break;
            } catch (e) {
                roundEntry.error = `NEMESIS error: ${e.message}`;
                roundEntry.failureStage = 'nemesis_review';
                roundEntry.failureDecision = SelfModificationDecision.UNAVAILABLE;
                entry.failureStage = 'nemesis_review';
                entry.failureDecision = SelfModificationDecision.UNAVAILABLE;
                entry.failureReason = roundEntry.error;
                entry.rounds.push(roundEntry);
                break;
            }
        }

        // ── Phase 5: Shelve if still not passing ─────────────────────────
        if (!entry.implemented) {
            try {
                if (activePromotionHandle) {
                    await activePromotionHandle.rollback();
                    entry.rollback = { restored: true, atomic: true, reason: 'self_mod_not_promoted' };
                    activePromotionHandle = null;
                } else {
                    await fs.writeFile(absPath, originalContent, 'utf8');
                    entry.rollback = { restored: true, atomic: false, reason: 'self_mod_not_promoted' };
                }
            } catch (e) {
                entry.rollback = { restored: false, error: e.message };
            }
            const retryable = [
                SelfModificationDecision.DEFER,
                SelfModificationDecision.UNAVAILABLE,
                SelfModificationDecision.ERROR,
            ].includes(entry.failureDecision);
            entry.shelved = !retryable;
            entry.outcome = retryable ? 'deferred' : 'rejected';
            entry.poseidonState = '|'; // UNCERTAIN — not confirmed, not rejected
            if (entry.shelved) await this._shelve(entry);
            console.log(`[${this.name}] | ${retryable ? 'Deferred' : 'Shelved'} "${filepath}" at ${entry.failureStage || 'unknown'} after ${entry.rounds.length} round(s)`);
        } else {
            entry.outcome = 'promoted';
            entry.failureStage = null;
            entry.failureDecision = null;
            entry.failureReason = null;
        }

        // ── Always: log to ledger ─────────────────────────────────────────
        await this._logToLedger(entry);

        // Notify via messageBroker
        this.system?.messageBroker?.publish('soma.selfmod', {
            filepath,
            state:       entry.poseidonState,
            implemented: entry.implemented,
            shelved:     entry.shelved,
            rounds:      entry.rounds.length,
            motivation:  motivation.substring(0, 100)
        }).catch(() => {});

        return {
            state:       entry.outcome,
            poseidon:    entry.poseidonState,
            implemented: entry.implemented,
            shelved:     entry.shelved,
            reason:      entry.failureReason,
            round:       entry.rounds.length,
            nemesisScore: lastNemesis?.score,
            entry
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // PHASE IMPLEMENTATIONS
    // ─────────────────────────────────────────────────────────────────────

    async _getSteveReview(filepath, proposedChange) {
        if (!this.system?.steveArbiter) return 'Steve offline';
        const broker = this.system.messageBroker;
        if (!broker) return 'MessageBroker unavailable';

        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve('Steve: no response within 30s'), 30000);

            const handler = (envelope) => {
                const data = envelope?.data || envelope;
                if (data?.task?.includes(filepath.substring(0, 20))) {
                    clearTimeout(timeout);
                    broker.unsubscribe?.('steve.task.complete', handler);
                    resolve((data.response || 'Steve: no opinion').substring(0, 400));
                }
            };
            broker.subscribe('steve.task.complete', handler);

            const reviewPrompt = `Code Review Task (respond concisely):
File: ${filepath}
Proposed change: ${proposedChange.substring(0, 300)}

Review this as a skeptical senior engineer. Flag: correctness issues, security risks, unintended side effects, better approaches. Score 0-10 and explain why.`;

            // Fire Steve
            this.system.steveArbiter.processChat(reviewPrompt, [], { source: 'selfmod_pipeline', autonomous: true })
                .then(r => {
                    clearTimeout(timeout);
                    broker.unsubscribe?.('steve.task.complete', handler);
                    resolve((r?.response || 'Steve: no response').substring(0, 400));
                })
                .catch(e => {
                    clearTimeout(timeout);
                    broker.unsubscribe?.('steve.task.complete', handler);
                    resolve(`Steve error: ${e.message}`);
                });
        });
    }

    async _getAdversarialDebate(filepath, proposedChange) {
        if (!this.system?.quadBrain?.reason) return 'QuadBrain unavailable';

        const prompt = `Adversarial code review for file: ${filepath}

Proposed change:
${proposedChange.substring(0, 400)}

LOGOS: Analyze technical correctness, logic, and implementation quality.
THALAMUS: Analyze risk, security implications, and unintended consequences.

Provide a structured verdict: what's good, what's risky, what should change.`;

        const result = await this.system.quadBrain.reason(prompt, {
            forceMultiLobe: true,
            source: 'selfmod_pipeline',
            temperature: 0.4,
            maxTokens: 600
        });
        return (result?.text || 'Debate produced no output').substring(0, 600);
    }

    async _synthesize(filepath, original, steveReview, brainDebate) {
        if (!this.system?.quadBrain?.reason) return original;

        const prompt = `You are SOMA synthesizing feedback on a proposed self-modification.

File: ${filepath}
Original proposal: ${original.substring(0, 300)}

Steve's review: ${steveReview?.substring(0, 200) || 'N/A'}
Brain debate: ${brainDebate?.substring(0, 300) || 'N/A'}

Produce the FINAL refined change description, incorporating valid feedback. Be specific and precise.
Output ONLY the refined change description, nothing else.`;

        const result = await this.system.quadBrain.reason(prompt, {
            source: 'selfmod_pipeline',
            temperature: 0.3,
            maxTokens: 400
        });
        return (result?.text || original).substring(0, 500);
    }

    async _implement(filepath, changeDescription) {
        const swarm = this.system?.engineeringSwarm;
        if (!swarm) return { success: false, error: 'EngineeringSwarm not loaded' };

        try {
            const absPath = resolveWithinRoot(ROOT, filepath, 'Self-modification path');
            const result = await swarm.modifyCode(absPath, changeDescription, null, {
                protocolToken: SELF_MODIFICATION_INTERNAL,
                deferPublication: true,
                source: 'self_modification_pipeline',
            });
            return result;
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async _stagePulseValidation(entry, absPath) {
        const id = `${entry.id}-${safeStageId(entry.filepath)}`;
        const stageDir = path.join(PULSE_SELF_MOD_ROOT, id);
        const rel = path.relative(ROOT, absPath);
        const stagedPath = path.join(stageDir, rel);
        await fs.mkdir(path.dirname(stagedPath), { recursive: true });
        const content = await fs.readFile(absPath, 'utf8');
        await fs.writeFile(stagedPath, content, 'utf8');

        let syntax = { valid: true, output: 'syntax check skipped for this file type' };
        if (isNodeSyntaxFile(stagedPath)) {
            try {
                const result = await execFileAsync(process.execPath, ['--check', stagedPath], { timeout: 10000 });
                syntax = { valid: true, output: (result.stdout || result.stderr || '').substring(0, 600) };
            } catch (e) {
                syntax = {
                    valid: false,
                    output: ((e.stdout || '') + (e.stderr || '') + e.message).substring(0, 1200)
                };
            }
        }

        let promotionAllowed = syntax.valid === true;
        const manifest = {
            id,
            source: 'SelfModificationPipeline',
            createdAt: new Date().toISOString(),
            filepath: rel.replace(/\\/g, '/'),
            productionPath: absPath,
            stagedPath,
            syntax,
            status: promotionAllowed ? 'ready_for_promotion' : 'rejected_in_sandbox',
            promotion: {
                allowed: promotionAllowed,
                source: 'pulse_self_mod_sandbox',
                rollbackGuard: true,
                ledgerEntry: entry.id,
                evidence: promotionAllowed
                    ? 'Staged production candidate passed sandbox syntax checks.'
                    : 'Staged production candidate failed sandbox syntax checks.',
                nextStep: promotionAllowed
                    ? 'Promote only after production verification confirms the staged artifact still matches the live file.'
                    : 'Do not promote; revise in sandbox and rerun validation.'
            }
        };
        const manifestPath = path.join(stageDir, 'pulse-self-mod-manifest.json');
        let truthEntry = null;
        try {
            truthEntry = await recordTruth(`Self-modification sandbox ${manifest.status}: ${manifest.filepath}`, {
                status: promotionAllowed ? 'verified' : 'rejected',
                confidence: promotionAllowed ? 0.9 : 1,
                proof: { syntax, manifest: manifestPath },
                source: 'self_modification_pipeline',
                artifactPath: path.relative(ROOT, manifestPath).replace(/\\/g, '/'),
                metadata: { entryId: entry.id, filepath: manifest.filepath }
            });
        } catch (error) {
            promotionAllowed = false;
            manifest.status = 'rejected_in_sandbox';
            manifest.promotion.allowed = false;
            manifest.promotion.evidence = `Truth ledger write failed: ${error.message}`;
            manifest.promotion.nextStep = 'Do not promote; restore truth ledger availability and rerun validation.';
        }
        manifest.truthLedger = truthEntry
            ? { required: true, recorded: true, id: truthEntry.id }
            : { required: true, recorded: false };
        manifest.promotion.allowed = promotionAllowed;
        manifest.status = promotionAllowed ? 'ready_for_promotion' : 'rejected_in_sandbox';
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        return manifest;
    }

    async _nemesisCodeGate(filepath, changeDescription, motivation) {
        const nemesis = this.system?.nemesis;

        // ── Agentic NEMESIS (full investigative loop) ─────────────────────
        if (nemesis?.isAgentic) {
            try {
                const result = await nemesis.evaluate(filepath, changeDescription, motivation);
                const score = Math.max(0, Math.min(1, Number(result?.score) || 0));
                return {
                    ...result,
                    score,
                    reviewer: 'nemesis',
                    provider: result?.provider || nemesis._lastBrainProvenance?.provider || 'undisclosed',
                    model: result?.model || nemesis._lastBrainProvenance?.model || 'undisclosed',
                    reviewerFingerprint: result?.reviewerFingerprint || nemesis._lastBrainProvenance?.reviewerFingerprint || 'nemesis:undisclosed:undisclosed',
                    decision: score >= 0.70
                        ? SelfModificationDecision.APPROVE
                        : SelfModificationDecision.REJECT,
                };
            } catch (e) {
                console.warn(`[${this.name}] Agentic NEMESIS unavailable: ${e.message}`);
                return {
                    decision: SelfModificationDecision.UNAVAILABLE,
                    score: 0,
                    feedback: `NEMESIS unavailable: ${e.message}`,
                    falsificationTest: 'NEMESIS must complete an independent review before promotion',
                    suggestedFix: null,
                };
            }
        }

        // ── Legacy one-shot NEMESIS (pre-agentic, kept as fallback) ──────
        if (nemesis) {
            const codePrompt = `CODE REVIEW — NEMESIS GATE
File: ${filepath}
Motivation: ${motivation.substring(0, 100)}
Change: ${changeDescription.substring(0, 400)}
Score 0.0-1.0 on correctness, safety, consistency, scope.
JSON only: { "score": 0.0, "feedback": "...", "falsificationTest": "...", "suggestedFix": "..." }`;

            try {
                const result = await nemesis.evaluate?.(codePrompt) ||
                    await this.system.quadBrain?.reason(codePrompt, {
                        source: 'nemesis_code_gate', temperature: 0.2, maxTokens: 400
                    });
                const text = result?.text || result?.response || '';
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return {
                        score:             Math.max(0, Math.min(1, Number(parsed.score) || 0)),
                        decision:          Number(parsed.score) >= 0.70
                            ? SelfModificationDecision.APPROVE
                            : SelfModificationDecision.REJECT,
                        feedback:          parsed.feedback || '',
                        falsificationTest: parsed.falsificationTest || `NEMESIS scored ${parsed.score}`,
                        suggestedFix:      parsed.suggestedFix || null,
                        reviewer: 'nemesis',
                        provider: nemesis._lastBrainProvenance?.provider || 'legacy',
                        model: nemesis._lastBrainProvenance?.model || 'undisclosed',
                        reviewerFingerprint: nemesis._lastBrainProvenance?.reviewerFingerprint || 'nemesis:legacy:undisclosed'
                    };
                }
                return { decision: SelfModificationDecision.DEFER, score: 0, feedback: 'NEMESIS verdict was unparseable', falsificationTest: 'Typed NEMESIS verdict required', suggestedFix: null };
            } catch (e) {
                return { decision: SelfModificationDecision.UNAVAILABLE, score: 0, feedback: `NEMESIS error: ${e.message}`, falsificationTest: 'NEMESIS must be available', suggestedFix: null };
            }
        }

        // Independence matters: Soma's proposing brain cannot substitute for
        // the adversarial reviewer when production promotion is at stake.
        return {
            decision: SelfModificationDecision.UNAVAILABLE,
            score: 0,
            feedback: 'NEMESIS is not loaded; independent review is required',
            falsificationTest: 'Load NEMESIS and rerun the proposal',
            suggestedFix: null,
        };
    }

    async _fallbackNemesisGate(filepath, changeDescription) {
        if (!this.system?.quadBrain?.reason) return { score: 0.5, feedback: 'No brain available', falsificationTest: 'N/A' };

        const result = await this.system.quadBrain.reason(
            `Score this code change 0.0-1.0 for correctness + safety. File: ${filepath}. Change: ${changeDescription.substring(0, 200)}. JSON only: {"score":0.0,"feedback":""}`,
            { source: 'nemesis_fallback', temperature: 0.2, maxTokens: 100 }
        );
        try {
            const j = JSON.parse((result?.text || '{}').match(/\{.*\}/s)?.[0] || '{}');
            return { score: Number(j.score) || 0.5, feedback: j.feedback || '', falsificationTest: `Score ${j.score}`, suggestedFix: null };
        } catch {
            return { score: 0.5, feedback: 'Parse error', falsificationTest: 'N/A', suggestedFix: null };
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PERSISTENCE
    // ─────────────────────────────────────────────────────────────────────

    async _logToLedger(entry) {
        try {
            await fs.mkdir(path.dirname(LEDGER_PATH), { recursive: true });
            const line = JSON.stringify({
                id:          entry.id,
                timestamp:   entry.timestamp,
                filepath:    entry.filepath,
                motivation:  entry.motivation?.substring(0, 150),
                poseidon:    entry.poseidonState,
                implemented: entry.implemented,
                shelved:     entry.shelved,
                rounds:      entry.rounds.length,
                nemesisScore: entry.rounds.at(-1)?.nemesisScore ?? null,
                pulseSandbox: entry.pulseSandbox ? {
                    status: entry.pulseSandbox.status,
                    stagedPath: entry.pulseSandbox.stagedPath,
                    syntaxValid: entry.pulseSandbox.syntax?.valid
                } : null,
                protocolVersion: entry.protocolVersion || SELF_MODIFICATION_PROTOCOL_VERSION,
                outcome: entry.outcome || (entry.implemented ? 'promoted' : 'rejected'),
                failureStage: entry.failureStage || null,
                failureDecision: entry.failureDecision || null,
                failureReason: entry.failureReason || null,
                stages: entry.stages || [],
                rollback: entry.rollback || null
                ,governance: entry.governance || null
                ,reviewerIndependence: entry.reviewerIndependence || null
                ,isolatedValidation: entry.isolatedValidation || null
                ,promotion: entry.promotion || null
                ,capabilityContract: entry.capabilityContract || null
            }) + '\n';
            await fs.appendFile(LEDGER_PATH, line, 'utf8');
        } catch (e) {
            console.error(`[${this.name}] Ledger write failed:`, e.message);
        }
    }

    async _shelve(entry) {
        try {
            let contested = [];
            try {
                const raw = await fs.readFile(CONTESTED_PATH, 'utf8');
                contested = JSON.parse(raw);
            } catch { /* fresh file */ }

            contested.push({
                id:          entry.id,
                timestamp:   entry.timestamp,
                filepath:    entry.filepath,
                motivation:  entry.motivation?.substring(0, 150),
                finalChange: entry.finalChange?.substring(0, 300),
                rounds:      entry.rounds,
                failureStage: entry.failureStage || 'unknown',
                failureDecision: entry.failureDecision || SelfModificationDecision.REJECT,
                reason:      entry.failureReason || `Self-modification rejected at ${entry.failureStage || 'unknown stage'}`
            });

            // Keep last 50 contested changes
            if (contested.length > 50) contested = contested.slice(-50);
            await fs.writeFile(CONTESTED_PATH, JSON.stringify(contested, null, 2), 'utf8');
        } catch (e) {
            console.error(`[${this.name}] Shelve write failed:`, e.message);
        }

        // ── Contested change recycler ─────────────────────────────────────
        // Publish a goal so SOMA revisits this change next relevant session
        const lastRound = entry.rounds.at(-1);
        const suggestedFix = entry.failureStage === 'nemesis_review' && lastRound?.nemesisFeedback
            ? `Retry with NEMESIS feedback: ${lastRound.nemesisFeedback}`
            : entry.finalChange;

        this.system?.messageBroker?.publish('goal_created', {
            title:       `Retry shelved change: ${entry.filepath}`,
            description: `Self-mod to ${entry.filepath} was rejected at ${entry.failureStage || 'unknown stage'} after ${entry.rounds.length} round(s). Reason: ${entry.failureReason || 'unspecified'}. Motivation: ${entry.motivation?.substring(0, 100)}. Correct the recorded failure before retrying.`,
            priority:    3,
            source:      'selfmod_pipeline',
            metadata:    { shelvedId: entry.id, filepath: entry.filepath, suggestedFix }
        }).catch(() => {});

        // ── MAX analysis dispatch ─────────────────────────────────────────
        // MAX may analyze a rejection, but may not implement around this
        // pipeline. Any resulting recommendation must return as a new proposal.
        const lastNemesisFix = entry.failureStage === 'nemesis_review' ? entry.rounds
            .slice()
            .reverse()
            .find(r => r.nemesisFeedback)?.nemesisFeedback : null;

        if (lastNemesisFix && this.system?.maxBridge) {
            this.system.maxBridge.injectGoal(
                `Analyze NEMESIS rejection: ${entry.filepath}`,
                {
                    description: `SOMA's self-mod to ${entry.filepath} was rejected. NEMESIS feedback: ${lastNemesisFix}. Original motivation: ${entry.motivation?.substring(0, 100)}. Analyze the failure and return a bounded recommendation. Do not edit SOMA files or implement the change directly; a corrected change must re-enter SelfModificationPipeline.`,
                    priority: 0.8
                }
            ).catch(e => console.warn(`[${this.name}] MAX dispatch failed: ${e.message}`));
            console.log(`[${this.name}] 🤝 Rejection analysis dispatched to MAX: ${entry.filepath}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STATUS
    // ─────────────────────────────────────────────────────────────────────

    async getStatus() {
        let recentEntries = [];
        let contested = [];

        let allEntries = [];
        try {
            const raw = await fs.readFile(LEDGER_PATH, 'utf8');
            allEntries = raw.trim().split('\n')
                .filter(Boolean)
                .map(l => { try { return JSON.parse(l); } catch { return null; } })
                .filter(Boolean);
            recentEntries = allEntries.slice(-20).reverse(); // newest first
        } catch { /* no ledger yet */ }

        try {
            contested = JSON.parse(await fs.readFile(CONTESTED_PATH, 'utf8'));
        } catch { /* no contested yet */ }

        // ── Score trend: rolling 7-entry average of NEMESIS scores ────────
        const scoredEntries = allEntries.filter(e => e.nemesisScore != null);
        const trend = [];
        const window = 7;
        for (let i = window - 1; i < scoredEntries.length; i++) {
            const slice = scoredEntries.slice(i - window + 1, i + 1);
            const avg   = slice.reduce((s, e) => s + e.nemesisScore, 0) / slice.length;
            trend.push({ ts: scoredEntries[i].timestamp, avg: Math.round(avg * 100) / 100 });
        }
        // Also include last 20 individual scores for sparkline
        const scoreHistory = scoredEntries.slice(-20).map(e => ({
            ts:    e.timestamp,
            score: e.nemesisScore,
            pass:  e.implemented
        }));

        return {
            authoritative: true,
            protocolVersion: SELF_MODIFICATION_PROTOCOL_VERSION,
            activeProposal: this._activeProposal,
            recentEntries,
            contested:    contested.slice(-10),
            contestedCount: contested.length,
            implemented:  recentEntries.filter(e => e.implemented).length,
            shelved:      recentEntries.filter(e => e.shelved).length,
            trend,        // rolling 7-avg over all time
            scoreHistory  // last 20 individual scores
        };
    }
}
