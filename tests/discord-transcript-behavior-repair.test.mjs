/**
 * tests/discord-transcript-behavior-repair.test.mjs
 * 
 * End-to-end regression test suite verifying the 12-pillar behavioral and architectural
 * repairs for SOMA based on the real Discord transcript.
 * 
 * Sequences tested:
 * - Sequence A: Intent classification (praise/critique never creates an engineering goal)
 * - Sequence B: State-aware status & capability inquiry ("Are you able to execute?")
 * - Sequence C: Structured MAX architecture audit report with separated facts/hypotheses
 * - Sequence D: Follow-up research authorization (immediate execution, no "Would you like me to proceed?")
 * - Sequence E: Explicit task states (TASK_STATES, formatProgressMessage with jobId and state)
 * - Sequence F: Image capability inquiry sets pendingImagePromptChannels
 * - Sequence G: Follow-up image prompt ("how about a warrior squirrel") & artifact verification
 * - Sequence H: Authoritative trading intent (desiredState vs actualState, explicit stop surviving restart)
 * - Sequence I: Trading promotion gates (23 trades, 13% win rate, 0.03 PF strictly blocked)
 * - Sequence J: System scan memory diagnostics (V8 heap limit, explicit thresholds, boot vs runtime explanation)
 * - Sequence K: Budget exhaustion autopsy (failedStep, lastError, attempts, partialEvidence, alternativePlan)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import sharp from 'sharp';

import {
    classifyTurnIntent,
    INTENT_TYPES,
    isDiscordFeedbackOrCritique,
    isDiscordStatusOrCapabilityQuestion,
    isDiscordWorkStatusRequest
} from '../server/discord/DiscordTurnPolicy.js';

import { globalCognitiveMoERouter, MOE_LANES } from '../core/CognitiveMoERouter.js';
import { TASK_STATES, formatProgressMessage, createInspectionGoal } from '../core/ExecutionProtocol.js';
import {
    isCodebaseInspectionRequest,
    resolveInspectionProject,
    inspectImprovementCodebase
} from '../server/discord/DiscordOperationalEvidence.js';
import { generateArchitectureReport } from '../core/StructuredArchitectureAudit.js';
import { StagedSelfImprovementPipeline, PIPELINE_STAGES } from '../core/StagedSelfImprovementPipeline.js';
import { evaluatePromotionLadder } from '../server/finance/PromotionLadder.js';
import { normalizeTradingIntent, allowsAutonomousEntries, resumeMode, stopTradingIntent } from '../server/finance/TradingIntentPolicy.js';
import toolRegistry from '../core/ToolRegistry.js';
import '../server/loaders/tools.js';

test('Sequence A: Conversational praise/critique MUST NOT create goals or route to ACTION_EXECUTION', async () => {
    const feedbackText = "Beautiful planning this is much better than it was before now whether you execute or not is another issue";
    
    // 1. Policy check
    assert.equal(isDiscordFeedbackOrCritique(feedbackText), true, 'Feedback text must be identified as feedback/critique');
    const intent = classifyTurnIntent(feedbackText);
    assert.equal(intent.intent, INTENT_TYPES.FEEDBACK, 'classifyTurnIntent must return FEEDBACK intent');

    // 2. Cognitive MoE router check
    const route = await globalCognitiveMoERouter.route(feedbackText, { channel: 'discord', user: 'owner' });
    assert.equal(route.lane, MOE_LANES.CONVERSATION, 'MoE Router must route feedback to CONVERSATION, never ACTION_EXECUTION');
    assert.equal(route.requiresTools, false, 'Feedback must not require tool execution');

    // 3. Negative test: Actionable engineering request check
    const DiscordArbiterModule = await import('../arbiters/DiscordArbiter.js');
    let goalsCreated = 0;
    const arbiter = new DiscordArbiterModule.default({ masterId: 'owner', goalPlanner: {
        goals: new Map(), createGoal: async () => { goalsCreated++; return { success: true }; }
    } });
    assert.equal(
        arbiter._isActionableEngineeringRequest(feedbackText, null, { authorized: true }),
        false,
        'Feedback must NEVER be considered an actionable engineering request, even if authorized=true'
    );
    const message = { id: 'feedback', channelId: 'dm', author: { id: 'owner', username: 'Owner' }, content: feedbackText, reply: async () => {} };
    assert.equal((await arbiter._handleDiscordCommand(message, feedbackText)).handled, false);
    assert.equal(goalsCreated, 0);
});

test('Sequence B: State-aware status & capability inquiry ("Are you able to execute?")', async () => {
    const query = "Are you able to execute?";
    
    assert.equal(isDiscordStatusOrCapabilityQuestion(query), true, 'Must identify capability question');
    const intent = classifyTurnIntent(query);
    assert.equal(intent.intent, INTENT_TYPES.STATUS_REQUEST, 'Intent must be STATUS_REQUEST');

    const DiscordArbiterModule = await import('../arbiters/DiscordArbiter.js');
    const arbiter = new DiscordArbiterModule.default({
        system: {
            agenticExecutor: { execute: async () => {}, name: 'SomaAgenticExecutor' }
        },
        goalPlanner: {
            goals: new Map([
                ['goal-101', {
                    id: 'goal-101',
                    title: 'Inspect architecture',
                    status: 'completed',
                    metadata: { lastVerification: { summary: 'syntax check passed' } }
                }]
            ])
        }
    });

    const reply = await arbiter._buildStateAwareStatusReply(query);
    assert.match(reply, /SOMA Execution Substrate Status/i, 'Must report substrate status');
    assert.match(reply, /Motor Cortex \/ Executor/i, 'Must report executor status');
    assert.match(reply, /Online \(SomaAgenticExecutor\)/i, 'Must confirm executor online');
    assert.match(reply, /\[Job: `goal-101` \| State: `completed`\]/i, 'Must cite recent job with state');
});

test('Sequence C: Structured MAX architecture audit report with separated facts and hypotheses', async () => {
    const query = "Can you analyze MAX architecture and look for weaknesses?";
    
    assert.equal(isCodebaseInspectionRequest(query), true, 'Must recognize architecture inspection request');
    assert.equal(resolveInspectionProject(query), 'MAX', 'Must resolve target project to MAX');

    const maxRoot = path.resolve(process.cwd(), '..', 'MAX');
    const audit = await generateArchitectureReport({ root: maxRoot, project: 'MAX', query });

    assert.equal(audit.project, 'MAX');
    assert.ok(audit.findings.length > 0, 'Must produce architectural findings for MAX');

    const finding1 = audit.findings.find(f => f.id === 'FINDING-MAX-ARCH-01');
    assert.ok(finding1, 'Must identify FINDING-MAX-ARCH-01 in SelfImprovementLoop.js');
    assert.equal(finding1.severity, 'HIGH');
    assert.equal(finding1.filePath, 'core/SelfImprovementLoop.js');
    assert.match(finding1.observedFact, /evolve\(\) method in SelfImprovementLoop does not execute code modifications/i);
    assert.match(finding1.evidence, /Would evolve:/i);
    assert.ok(finding1.impact.length > 0);
    assert.ok(finding1.safeTest.length > 0);
    assert.ok(finding1.modificationRequired.length > 0);

    // Verify report format separates Grounded Observations, Interpretations/Hypotheses, and Recommendations
    assert.match(audit.reportText, /1\. Grounded Observations \(Code Facts\)/i);
    assert.match(audit.reportText, /2\. Interpretations & Hypotheses/i);
    assert.match(audit.reportText, /3\. Prescriptive Recommendations & Safe Next Steps/i);
});

test('Sequence D: Follow-up research authorization executes immediately without asking permission', async () => {
    const followup = "Find those improvement areas and search the web for things that might improve it";
    
    const intent = classifyTurnIntent(followup, { hasPriorInspection: true });
    assert.equal(intent.intent, INTENT_TYPES.CONTINUE_PREVIOUS_TASK, 'Must classify as continuation');

    // Verify that _runVerifiedDiscordTask treats read-only research as inspection
    const DiscordArbiterModule = await import('../arbiters/DiscordArbiter.js');
    const updates = [];
    const arbiter = new DiscordArbiterModule.default({
        system: {
            executionJobStore: {
                createJob: record => { updates.push({ event: 'created', ...record }); return record; },
                updateJob: (_id, record) => { updates.push({ event: 'updated', ...record }); return record; }
            },
            agenticExecutor: {
                execute: async (goal) => ({
                    done: true,
                    state: 'completed',
                    summary: 'Search completed and verified 3 potential architectural improvements.',
                    toolsUsed: ['search_code', 'web_search'],
                    totalIterations: 2,
                    toolResults: [
                        { tool: 'search_code', success: true, result: { matches: ['core/example.js:12: TODO improve memory'] } },
                        { tool: 'web_search', success: true, result: 'Source: https://arxiv.org/abs/2304.03442' }
                    ],
                    verification: { passed: true }
                })
            }
        }
    });

    const result = await arbiter._runVerifiedDiscordTask(followup, { requireWebResearch: true, contextParentGoalId: 'prior-inspection' }, { id: 'followup-msg', channelId: 'dm' });
    assert.equal(result.success, true, 'Read-only research must run immediately and succeed');
    assert.equal(result.queued, undefined, 'Must not be queued as a pending engineering goal');
    assert.match(result.summary, /Search completed/i);
    assert.equal(updates[0].metadata.contextParentGoalId, 'prior-inspection');
    assert.equal(updates.at(-1).status, 'completed');
    let routed = null;
    arbiter._isSovereignOperator = () => true;
    arbiter._recentArchitectureContext = async () => ({ id: 'earlier', metadata: {
        inspectionId: 'prior-inspection', project: 'SOMA',
        findings: [{ id: 'F-1', filePath: 'core/example.js', lineNumbers: '12', observedFact: 'A source finding' }]
    } });
    arbiter._handleLiveAgentExecution = async (_msg, _text, options) => { routed = options; return { handled: true }; };
    const followupMessage = { id: 'followup-msg', channelId: 'dm', author: { id: 'owner', username: 'Owner' }, content: followup, reply: async () => { throw new Error('Research asked for unnecessary confirmation'); } };
    assert.equal((await arbiter._handleDiscordCommand(followupMessage, followup)).handled, true);
    assert.equal(routed.requireWebResearch, true);
    assert.equal(routed.contextParentGoalId, 'prior-inspection');
    assert.match(routed.inspectionTask, /web_search/);
});

test('Sequence E: Explicit task states and progress message formatting', async () => {
    assert.equal(TASK_STATES.ACCEPTED, 'accepted');
    assert.equal(TASK_STATES.PLANNING, 'planning');
    assert.equal(TASK_STATES.EXECUTING, 'executing');
    assert.equal(TASK_STATES.AWAITING_APPROVAL, 'awaiting_approval');
    assert.equal(TASK_STATES.VERIFYING, 'verifying');
    assert.equal(TASK_STATES.COMPLETED, 'completed');
    assert.equal(TASK_STATES.BLOCKED, 'blocked');
    assert.equal(TASK_STATES.FAILED, 'failed');
    assert.equal(TASK_STATES.INCOMPLETE, 'incomplete');

    const formatted = formatProgressMessage('job-42', TASK_STATES.EXECUTING, 'running static verification');
    assert.equal(formatted, '[Job: job-42 | State: executing] running static verification');

    const fallbackFormatted = formatProgressMessage('job-99', 'unknown_state', 'fallback check');
    assert.equal(fallbackFormatted, '[Job: job-99 | State: executing] fallback check');
});

test('Sequence F & G: Image capability inquiry, pending channel tracking, and artifact verification', async () => {
    const DiscordArbiterModule = await import('../arbiters/DiscordArbiter.js');
    const arbiter = new DiscordArbiterModule.default();

    const channelId = 'chan-test-888';
    const fakeMsg = {
        id: 'msg-001',
        channelId,
        author: { id: 'user-owner', username: 'owner' },
        reply: async (content) => { fakeMsg.lastReply = content; }
    };

    // Sequence F: Inquiry
    const asksCapability = "can you make an image?";
    assert.equal(arbiter._isImageCapabilityQuestion(asksCapability), true);
    
    const handledCapability = await arbiter._handleDiscordCommand(fakeMsg, asksCapability);
    assert.equal(handledCapability.handled, true);
    assert.equal(arbiter.pendingImagePromptChannels.has(channelId), true, 'Must record pending channel');
    assert.match(fakeMsg.lastReply, /Yes\. Tell me what image you want/i);

    // Sequence G: Follow-up prompt ("how about a warrior squirrel")
    const followUpPrompt = "how about a warrior squirrel";
    const extracted = arbiter._extractImagePrompt(followUpPrompt);
    assert.equal(extracted, 'warrior squirrel', 'Must extract clean subject without colloquial intro');

    // Create a temporary mock image file for artifact verification
    const tmpDir = path.join(process.cwd(), 'data', 'temp');
    await fs.mkdir(tmpDir, { recursive: true });
    const mockImagePath = path.join(tmpDir, 'test_squirrel.png');
    const mockImageContent = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#6f4e37' } }).png().toBuffer();
    await fs.writeFile(mockImagePath, mockImageContent);

    // Test successful verification path
    let lastSentReply = null;
    fakeMsg.reply = async (content) => { lastSentReply = content; };

    // Mock somaImageGeneration.generate to return the mock file
    const originalGenerate = (await import('../server/social/SomaImageGenerationEngine.js')).default.generate;
    (await import('../server/social/SomaImageGenerationEngine.js')).default.generate = async () => ({
        provider: 'bonsai-http',
        image: { path: mockImagePath },
        prompt: 'warrior squirrel, fantasy armor'
    });

    const followUpMsg = {
        id: 'msg-002',
        channelId,
        author: { id: 'user-owner', username: 'owner' },
        reply: async (content) => {
            lastSentReply = content;
            return {
                id: 'uploaded-message',
                attachments: new Map([['image-1', { id: 'image-1', name: 'test_squirrel.png', size: mockImageContent.length,
                    contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/test_squirrel.png' }]]),
                edit: async update => { lastSentReply = { ...lastSentReply, ...update }; }
            };
        }
    };

    const handledPrompt = await arbiter._handleDiscordCommand(followUpMsg, followUpPrompt);
    assert.equal(handledPrompt.handled, true);
    assert.equal(arbiter.pendingImagePromptChannels.has(channelId), false, 'Pending state must be consumed');
    assert.match(lastSentReply.content, /Here you go/i);
    assert.equal(lastSentReply.files?.length, 1);

    // Verify artifact failure case: if generated image is missing or empty, must not emit success or "!Warrior Squirrel"
    (await import('../server/social/SomaImageGenerationEngine.js')).default.generate = async () => ({
        provider: 'bonsai-http',
        image: { path: path.join(tmpDir, 'non_existent.png') }
    });

    let errorReply = null;
    followUpMsg.reply = async (content) => { errorReply = content; };
    await arbiter._replyWithGeneratedImage(followUpMsg, "warrior squirrel");
    assert.match(errorReply, /I could not generate that image: Generated image file is missing or empty/i);
    assert.doesNotMatch(errorReply, /^!Warrior Squirrel/);

    // Clean up
    (await import('../server/social/SomaImageGenerationEngine.js')).default.generate = originalGenerate;
    await fs.unlink(mockImagePath).catch(() => {});
    await fs.unlink(path.join(process.cwd(), 'data', 'discord', 'image-receipts', 'msg-002.json')).catch(() => {});
});

test('Sequence H: Trading intent tracks desiredState vs actualState and explicit stop prevents auto-resume', async () => {
    const engaged = normalizeTradingIntent({
        desiredState: 'running', autoResume: true,
        engaged: { SPY: { preset: 'mean_reversion', config: { paperMode: true } } }
    });
    const persistedStop = stopTradingIntent(engaged, { stopped: ['SPY'] });
    const afterRestart = normalizeTradingIntent(JSON.parse(JSON.stringify(persistedStop)));
    assert.equal(afterRestart.desiredState, 'stopped');
    assert.equal(afterRestart.autoResume, false);
    assert.equal(allowsAutonomousEntries(afterRestart), false);
    assert.equal(resumeMode(afterRestart, false), 'skip');
    assert.equal(resumeMode(afterRestart, true), 'protect_exits_only');
});

test('Sequence I: Trading promotion gates strictly block underperforming candidates', async () => {
    // Failing candidate metrics: 23/100 trades, 13% win rate, 0.03 profit factor
    const failingStats = {
        totalTrades: 23,
        winningTrades: 3,
        losingTrades: 20,
        winRate: 13.04,
        profitFactor: 0.03,
        maxDrawdown: 18.5,
        totalPnL: -450.20
    };

    const verdict = evaluatePromotionLadder({
        stats: failingStats,
        testingDays: 3,
        latestTraining: { best: { trades: 23, pnl: -450 } }
    });

    assert.equal(verdict.liveEligible, false, 'Failing candidate must NOT be eligible for live promotion');
    assert.equal(verdict.paperProven, false, 'Failing candidate is not paper proven');
    assert.equal(verdict.maxEligibleTier, 'paper');
    assert.equal(verdict.nextTier, 'tiny_live');
    
    // Check specific gates failed
    const tinyGates = verdict.tiers.tiny_live.gates;
    const tradesGate = tinyGates.find(g => g.id === 'closedTrades');
    assert.equal(tradesGate.passed, false, '23 trades must fail the 100 trade gate');
    
    const winRateGate = tinyGates.find(g => g.id === 'winRate');
    assert.equal(winRateGate.passed, false, '13% win rate must fail the 60% win rate gate');

    const pfGate = tinyGates.find(g => g.id === 'profitFactor');
    assert.equal(pfGate.passed, false, '0.03 profit factor must fail the 1.4 PF gate');
});

test('Sequence J: System scan evaluates explicit memory thresholds, leak warnings, and boot vs runtime context', async () => {
    const { loadTools } = await import('../server/loaders/tools.js');
    await loadTools();
    const scanResult = await toolRegistry.execute('system_scan', {});
    
    assert.ok(['HEALTHY', 'DEGRADED', 'CRITICAL', 'UNKNOWN'].includes(scanResult.status), 'Must return explicit health status');
    assert.ok(scanResult.diagnostics, 'Must include diagnostics');
    assert.ok(Number.isFinite(scanResult.diagnostics.heapUsedMb));
    assert.ok(Number.isFinite(scanResult.diagnostics.heapLimitMb));
    assert.ok(Number.isFinite(scanResult.diagnostics.rssMb));
    assert.ok(Number.isFinite(scanResult.diagnostics.systemRamUsedPct));
    assert.ok(Number.isFinite(scanResult.diagnostics.recentPeakRssMb));
    assert.ok(['STABLE', 'RISING', 'FALLING'].includes(scanResult.diagnostics.trend));
    assert.equal(typeof scanResult.diagnostics.leakWarning, 'boolean');
    assert.equal(scanResult.diagnostics.oomHistory.state, 'unknown');

    assert.ok(scanResult.thresholds, 'Must define explicit thresholds');
    assert.match(scanResult.memoryExplanation, /Earlier boot heap measurements are not directly comparable/i);
    assert.doesNotMatch(scanResult.memoryExplanation, /~87MB|~440MB/);
});

test('Sequence K: Budget exhaustion autopsy persists failed step, last error, attempts, and alternative plan', async () => {
    const AutonomousHeartbeatModule = await import('../server/services/AutonomousHeartbeat.cjs');
    const AutonomousHeartbeat = AutonomousHeartbeatModule.AutonomousHeartbeat || AutonomousHeartbeatModule.default;

    const mockSystem = {
        goalPlanner: {
            getExecutionAttemptBudget: () => ({ attempts: 3, maxAttempts: 3 }),
            transitionGoal: () => ({ success: true })
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} }
    };

    const heartbeat = new AutonomousHeartbeat(mockSystem);
    const mockGoal = {
        id: 'test-exhaustion-goal-123',
        title: 'Repair flaky test in mission pipeline',
        description: 'Test goal for budget exhaustion verification',
        metadata: {
            failedStep: 'execute_unit_test',
            lastError: 'AssertionError: expected true but got false',
            executionAttempts: 3,
            partialEvidence: [{ check: 'source_inspected', passed: true }],
            alternativePlan: 'Decompose test into isolated component mock and run with verbose trace.'
        }
    };

    const autopsyResult = await heartbeat._writeGoalAutopsy(mockGoal, {
        phase: 'attempt_budget_exhausted',
        reason: 'Execution attempt budget exhausted (3/3).',
        failedStep: mockGoal.metadata.failedStep,
        lastError: mockGoal.metadata.lastError,
        attempts: 3,
        maxAttempts: 3,
        partialEvidence: mockGoal.metadata.partialEvidence,
        alternativePlan: mockGoal.metadata.alternativePlan
    });

    assert.ok(autopsyResult.path, 'Must persist autopsy file');
    const persisted = JSON.parse(await fs.readFile(autopsyResult.path, 'utf8'));

    assert.equal(persisted.goalId, 'test-exhaustion-goal-123');
    assert.equal(persisted.phase, 'attempt_budget_exhausted');
    assert.equal(persisted.failedStep, 'execute_unit_test');
    assert.equal(persisted.lastError, 'AssertionError: expected true but got false');
    assert.equal(persisted.attempts, 3);
    assert.equal(persisted.maxAttempts, 3);
    assert.equal(persisted.partialEvidence.length, 1);
    assert.match(persisted.alternativePlan, /Decompose test into isolated component mock/i);

    // Clean up test autopsy file
    await fs.unlink(autopsyResult.path).catch(() => {});
});

test('declared self-improvement stages do not masquerade as executed verification', async () => {
    assert.equal(PIPELINE_STAGES.length, 12, 'Pipeline must define all 12 stages');
    assert.deepEqual(PIPELINE_STAGES, [
        'TARGET_SELECTION',
        'DEPENDENCY_ANALYSIS',
        'BASELINE_VERIFICATION',
        'SANDBOX_PROVISIONING',
        'PATCH_APPLICATION',
        'STATIC_LINT_SYNTAX',
        'UNIT_REGRESSION_TESTING',
        'BENCHMARK_EVALUATION',
        'GOVERNANCE_EVALUATION',
        'ROLLBACK_PREPARATION',
        'STAGED_DEPLOYMENT',
        'PROBATION_MONITORING'
    ]);

    let inventedExecution = 0;
    const pipeline = new StagedSelfImprovementPipeline({
        governance: { evaluateCandidate: async () => { inventedExecution++; return { approved: true }; } },
        runner: { createSandbox: async () => { inventedExecution++; return { path: 'not-used' }; } }
    });
    const original = await fs.readFile('server/loaders/tools.js', 'utf8');
    const result = await pipeline.executePipeline({
        targetFile: 'server/loaders/tools.js',
        proposedCode: 'const testCandidate = true;',
        rationale: 'Verify 12-stage self-improvement safety harness',
        testCommand: 'node -e "process.exit(0)"'
    });

    assert.equal(result.state, 'incomplete');
    assert.equal(result.currentStage, 'DEPENDENCY_ANALYSIS');
    assert.deepEqual(result.stagesCompleted.map(stage => stage.stage), ['TARGET_SELECTION']);
    assert.equal(result.verification.passed, false);
    assert.equal(inventedExecution, 0);
    assert.equal(await fs.readFile('server/loaders/tools.js', 'utf8'), original);
});
