import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { SomaAgenticExecutor, selfEvolutionDiagnosticFinish } from '../core/SomaAgenticExecutor.js';
import { SelfEvolutionDirector } from '../core/SelfEvolutionDirector.js';
import { ToolRegistry } from '../core/ToolRegistry.js';
const require = createRequire(import.meta.url);
const AutonomousHeartbeat = require('../server/services/AutonomousHeartbeat.cjs');
const { buildQualityReport, verifyGoal } = require('../core/GoalQualityGate.cjs');

test('the real test tool preserves exit failures and rejects missing or escaping paths', async t => {
    const dir = await fs.mkdtemp(path.join(process.cwd(), 'data', 'rsi-tool-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const executor = new SomaAgenticExecutor();
    executor.initialize({ brain: {} });
    const tool = executor._tools.run_tests;
    const passing = path.join(dir, 'pass.test.mjs');
    const failing = path.join(dir, 'fail.test.mjs');
    await fs.writeFile(passing, "import test from 'node:test'; test('real pass', () => {});\n");
    await fs.writeFile(failing, "import test from 'node:test'; test('real fail', () => { throw new Error('sentinel_failure'); });\n");
    assert.equal((await tool.execute({ testFile: passing })).passed, true);
    const failure = await tool.execute({ testFile: failing });
    assert.equal(failure.passed, false);
    assert.notEqual(failure.exitCode, 0);
    assert.match(failure.output, /sentinel_failure/);
    assert.ok((await tool.execute({})).error);
    assert.ok((await tool.execute({ testFile: '../outside.test.mjs' })).error);
});

test('a saturated baseline produces a bounded real diagnosis without a model or source edits', async t => {
    const dir = await fs.mkdtemp(path.join(process.cwd(), 'data', 'rsi-diagnosis-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const testFile = path.join(dir, 'check.test.mjs');
    await fs.writeFile(testFile, "import test from 'node:test'; test('baseline', () => {});\n");
    const director = new SelfEvolutionDirector();
    const id = `diagnostic-${Date.now()}-${process.pid}`;
    const data = director.buildGoal({ dimension: 'research', label: 'research', score: 0.7, testFiles: [testFile] }, {
        cycleId: id, baseline: { receipts: { research: { valid: true, exitCode: 0, failed: 0, executableScore: 1 } } },
    });
    const goal = { id, createdAt: Date.now() - 1000, ...data };
    // Keep the generated artifact inside this test's isolated scratch folder.
    const artifact = path.join(dir, 'diagnosis.md');
    goal.metadata.expectedArtifact = artifact;
    goal.allowedWritePaths = [dir];
    goal.metadata.allowedWritePaths = [dir];
    goal.expectedArtifacts = [artifact];
    goal.verification.filesExist = [artifact];
    goal.successCriteria[1] = `Write the diagnostic artifact at ${artifact}`;
    goal.metadata.goalContract = buildQualityReport(goal).contract;
    assert.equal(goal.metadata.diagnosticOnly, true);
    assert.equal(goal.allowedTools.includes('modify_code'), false);
    const executor = new SomaAgenticExecutor({ maxIterations: 6 });
    executor.initialize({ brain: {} });
    executor._deliberateSelection = async () => ({ approved: true });
    executor._recallMemories = async () => [];
    executor._callDirectAPI = async () => { throw new Error('The deterministic diagnosis must not need a language model'); };
    const result = await executor.execute(goal);
    assert.equal(result.done, true, JSON.stringify({ result: result.result, error: result.error, evidence: result.completionEvidence }));
    assert.deepEqual(result.toolsUsed, ['run_tests', 'write_file', 'read_file']);
    assert.match(await fs.readFile(artifact, 'utf8'), /No code defect or capability gain is established/);
    assert.match(result.result, /no code change or capability improvement/i);
    assert.ok(result.evidencePath);
    const heartbeat = new AutonomousHeartbeat({});
    const physical = await heartbeat._verifyGoalCompletion(goal, result);
    assert.equal(physical.verified, true);
    const final = await verifyGoal(goal, { summary: result.result, evidence: physical.evidence });
    assert.equal(final.passed, true, JSON.stringify(final));
});

test('diagnostic completion requires successful real test, write and subsequent read receipts', () => {
    const goal = { metadata: { selfEvolution: true, diagnosticOnly: true, benchmarkTests: ['tests/a.mjs'], expectedArtifact: 'data/a.md' } };
    const observations = [
        { tool: 'run_tests', args: { testFile: 'tests/a.mjs' }, result: { passed: true } },
        { tool: 'write_file', args: { path: 'data/a.md' }, result: { success: true } },
        { tool: 'read_file', args: { path: 'data/a.md' }, result: { content: '## Verification status' } },
    ];
    assert.equal(selfEvolutionDiagnosticFinish(goal, observations).complete, true);
    observations[0].result.passed = false;
    assert.equal(selfEvolutionDiagnosticFinish(goal, observations), null);
    observations[0].result.passed = true;
    observations[2].result.error = 'unavailable';
    assert.equal(selfEvolutionDiagnosticFinish(goal, observations).tool, 'read_file');
});

test('a sourced research goal reaches its governed patch and real post-change tests without narrative stalling', async t => {
    const dir = await fs.mkdtemp(path.join(process.cwd(), 'data', 'rsi-experiment-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const source = path.join(dir, 'value.mjs'), evaluator = path.join(dir, 'value.test.mjs');
    const artifact = path.join(dir, 'diagnosis.md');
    await fs.writeFile(source, 'export const value = 1;');
    await fs.writeFile(evaluator, "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from './value.mjs'; test('fixed expected value', () => assert.equal(value, 2));");
    const plan = { id: 'plan', state: 'ready', file: path.relative(process.cwd(), source).replaceAll('\\', '/'), request: 'Apply the measured fixture change', sources: [{ title: 'Fixture primary reference', url: 'https://example.org/reference' }], sourceHash: 'fixture-hash' };
    const director = new SelfEvolutionDirector();
    const goal = { id: `sourced-${Date.now()}`, createdAt: Date.now() - 1000, ...director.buildGoal({ dimension: 'research', score: .5, testFiles: [evaluator] }, {
        cycleId: `fixture-${Date.now()}`, research: plan, baseline: { receipts: { research: { valid: true, exitCode: 1, failed: 1, executableScore: 0 } } },
    }) };
    goal.metadata.expectedArtifact = artifact;
    goal.allowedWritePaths = [dir]; goal.metadata.allowedWritePaths = [dir]; goal.expectedArtifacts = [artifact];
    goal.metadata.asiCycleId = 'fixture-cycle';
    // Match the real planner's normalized criteria, including the next-step
    // requirement that a direct executor-only fixture used to omit.
    const quality = buildQualityReport(goal);
    goal.successCriteria = quality.successCriteria;
    goal.verification = quality.verification;
    goal.metadata.goalContract = quality.contract;
    let drafts = 0, publications = 0;
    const patch = { files: [{ path: plan.file, content: 'export const value = 2;' }] };
    const executor = new SomaAgenticExecutor({ maxIterations: 12 });
    // Model authority must pass through the real registry even in this isolated
    // fixture. Only the approval decision is stubbed; the governed patch and
    // post-change tests below are still executed and checked.
    const audits = [];
    const registry = new ToolRegistry({ qwenAuditGate: { auditProposedChange: async request => {
        audits.push(request.toolName); return { approved: true, reason: 'Isolated fixture approval' };
    } } });
    executor.initialize({ brain: {}, system: { toolRegistry: registry, engineeringSwarm: {}, selfEvolutionResearch: {
        validatePlan: async id => { assert.equal(id, plan.id); return plan; },
        draft: async () => { drafts++; return patch; },
    }, selfModPipeline: { propose: async (file, request, origin, options) => {
        assert.equal(file, plan.file); assert.equal(request, plan.request); assert.equal(options.patch, patch);
        assert.equal(options.goalId, goal.id); assert.equal(options.externalEvidence.planId, plan.id);
        publications++; await fs.writeFile(source, patch.files[0].content);
        return { implemented: true, deploymentPending: true, entry: { promotion: { id: 'fixture-promotion' } } };
    } } } });
    executor._deliberateSelection = async () => ({ approved: true });
    executor._recallMemories = async () => [];
    executor._callDirectAPI = async () => { throw new Error('Sourced experiment must use deterministic tool receipts, not narrative'); };
    const result = await executor.execute(goal);
    assert.equal(result.done, true, JSON.stringify({ error: result.error, result: result.result }));
    assert.equal(drafts, 1); assert.equal(publications, 1);
    assert.ok(audits.includes('modify_code'));
    assert.ok(result.toolsUsed.includes('modify_code')); assert.ok(result.toolsUsed.includes('verify_syntax'));
    assert.match(result.result, /Deployment and measured capability gain remain subject to independent reconciliation/);
    assert.match(result.result, /Next step:/);
    const heartbeat = new AutonomousHeartbeat({});
    const physical = await heartbeat._verifyGoalCompletion(goal, result);
    assert.equal(physical.verified, true, JSON.stringify(physical));
    assert.equal((await verifyGoal(goal, { summary: result.result, evidence: physical.evidence })).passed, true);

    // Simulate the historical missing checkpoint after publication. Only the
    // matching deployed receipt and unchanged published bytes permit recovery.
    const promotion = { id: 'fixture-promotion', goalId: goal.id, asiCycleId: 'fixture-cycle', status: 'probation',
        deployment: { status: 'succeeded' }, afterHashes: { [plan.file]: createHash('sha256').update(await fs.readFile(source)).digest('hex') } };
    executor.system.selfModificationGovernance = { records: [promotion] };
    const ledger = path.join(process.cwd(), 'data/goal-progress', `${goal.id}.observations.jsonl`);
    const recovered = await executor._recoverPublishedResearch(goal, plan, ledger);
    assert.equal(recovered.evidenceObservations.at(-1).tool, 'modify_code');
    assert.equal(recovered.evidenceObservations.some(obs => obs.tool === 'verify_syntax'), false);
    await fs.rm(path.join(process.cwd(), 'data/goal-progress', `${goal.id}.json`));
    const resumed = await executor.execute(goal);
    assert.equal(resumed.done, true, JSON.stringify(resumed.completionEvidence));
    assert.equal(publications, 1, 'restart verification must not republish');
    assert.equal(drafts, 1, 'restart verification must not draft again');
    const legacyRows = (await fs.readFile(ledger, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
    const mutation = legacyRows.find(obs => obs.tool === 'modify_code');
    delete mutation.result.promotionId;
    promotion.beforeHashes = { [plan.file]: plan.sourceHash };
    promotion.promotedAt = new Date(mutation.observedAt - 1).toISOString();
    await fs.writeFile(ledger, legacyRows.map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.equal((await executor._recoverPublishedResearch(goal, plan, ledger)).evidenceObservations.at(-1).tool, 'modify_code');
    promotion.promotedAt = new Date(mutation.observedAt + 1).toISOString();
    await assert.rejects(executor._recoverPublishedResearch(goal, plan, ledger), /No matching governed/);
    promotion.goalId = 'wrong-goal';
    await assert.rejects(executor._recoverPublishedResearch(goal, plan, ledger), /No deployed research receipt/);
    promotion.goalId = goal.id;
    await fs.writeFile(source, 'export const value = 3;');
    await assert.rejects(executor._recoverPublishedResearch(goal, plan, ledger), /source changed/);
});
