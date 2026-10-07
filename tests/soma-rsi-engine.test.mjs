import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';

import { RsiBenchmarkHarness } from '../core/rsi/RsiBenchmarkHarness.js';
import { IsolatedCandidateRunner } from '../core/IsolatedCandidateRunner.js';
import { SelfEvolutionDirector } from '../core/SelfEvolutionDirector.js';
import { MaxApprovalShim } from '../arbiters/MaxApprovalShim.js';
import { SelfModificationDecision } from '../core/SelfModificationProtocol.js';
import { GOVERNED_RSI_REPAIR_INTERNAL } from '../core/SelfModificationProtocol.js';
import { governedRsiRepairAuthorization, SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';
import { ToolRegistry } from '../core/ToolRegistry.js';
import createRsiRoutes from '../server/routes/rsiRoutes.js';

const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
async function scratch() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-rsi-')); temporary.push(dir); return dir; }

describe('RSI evidence and safety contract', () => {
    it('cannot create a fake incumbent or score a client-supplied function', async () => {
        const harness = new RsiBenchmarkHarness();
        assert.equal(harness.getBaseline(), null);
        assert.throws(() => harness.setBaseline(100), /cannot be set directly/);
        await assert.rejects(harness.evaluateCandidate({ checkSafety: () => true }), /isolated/);
        await assert.rejects(harness.runSuite(), /unavailable/);
    });

    it('uses registered executable trials as its only benchmark', async () => {
        const calls = [];
        const registry = {
            getStatus: () => ({ currentVersion: 3 }),
            runSuite: async request => { calls.push(request); return { scores: { coding: 0.8 }, receipts: { coding: { valid: true } } }; },
        };
        const harness = new RsiBenchmarkHarness({ registry });
        assert.equal(harness.getBaseline().currentVersion, 3);
        const result = await harness.runSuite({ domains: ['coding'] });
        assert.equal(result.scores.coding, 0.8);
        assert.deepEqual(calls, [{ reason: 'rsi_registered_suite', domains: ['coding'] }]);
        await assert.rejects(harness.runSuite({ domains: ['made_up'] }), /Unknown/);
    });

    it('requires container validation on all self-evolution source changes', async () => {
        const director = new SelfEvolutionDirector({ root: await scratch() });
        const goal = director.buildGoal({ dimension: 'coding', score: 0.4, testFiles: ['tests/self-modification-safety.test.mjs'] });
        assert.equal(goal.metadata.capabilityContract.requiresContainer, true);
        director.experiments.push({ id: 'one', domain: 'coding', target: { testFiles: ['tests/self-modification-safety.test.mjs'] }, state: 'executing' });
        assert.equal(director.capabilityContractForActiveExperiment().requiresContainer, true);
    });

    it('adds evaluator-only research cases to both candidate contracts without including their contents in the goal', async () => {
        const director = new SelfEvolutionDirector({ root: await scratch() });
        const goal = director.buildGoal({ dimension: 'research', score: 0.4, testFiles: ['tests/research-source-outcomes.test.mjs'] });
        assert.deepEqual(goal.metadata.capabilityContract.testFiles,
            ['tests/research-source-outcomes.test.mjs', 'tests/rsi-research-holdout.test.mjs']);
        assert.doesNotMatch(goal.description, /fragment and userinfo/);
        director.experiments.push({ id: 'one', domain: 'research', target: { testFiles: ['tests/research-source-outcomes.test.mjs'] }, state: 'executing' });
        assert.deepEqual(director.capabilityContractForActiveExperiment().testFiles,
            goal.metadata.capabilityContract.testFiles);
    });

    it('fails before candidate checks if the required container is unavailable', async () => {
        const runner = new IsolatedCandidateRunner({ root: await scratch() });
        runner.dockerAvailable = async () => false;
        await assert.rejects(runner.run({ worktree: await scratch(), files: ['core/candidate.js'], contract: { requiresContainer: true, testFiles: ['tests/candidate.test.mjs'] } }), /Docker is unavailable/);
    });

    it('MAX approval is only preflight, never a fabricated benchmark promotion', async () => {
        const shim = new MaxApprovalShim({ rootPath: await scratch() });
        await shim.initialize({ maxAgentBridge: { chat: async () => ({ response: '[APPROVED] Review only.' }), getLastHealth: () => ({ provider: 'test', model: 'local' }) } });
        const verdict = await shim.requestApproval({ filepath: 'core/SearchPolicy.js', request: 'Improve search', candidateHarness: { checkSafety: () => true }, empiricalCheck: true });
        assert.equal(verdict.decision, SelfModificationDecision.APPROVE);
        assert.equal(verdict.empiricalReport, undefined);
        assert.equal(shim.rsiBenchmark, undefined);
    });

    it('only an exact, mission-approved, revalidated RSI plan bypasses the redundant Qwen preflight', async () => {
        const goal = { metadata: { source: 'ASIKernel', selfEvolution: true, missionDirectorApproved: true,
            asiCycleId: 'cycle-1', researchPlanId: 'plan-1' } };
        const call = { tool: 'modify_code', args: { filepath: 'core/example.js', request: 'Exact pinned repair' } };
        let audits = 0;
        const registry = new ToolRegistry({ logger: { log() {} }, qwenAuditGate: { auditProposedChange: async () => {
            audits++; return { approved: false, reason: 'offline' };
        } } });
        const tool = { execute: async () => ({ passedToGovernedPipeline: true }) };
        const research = { validatePlan: async id => { assert.equal(id, 'plan-1'); return { file: 'core/example.js', request: 'Exact pinned repair' }; } };
        const token = await governedRsiRepairAuthorization(goal, call, research);
        assert.equal(token, GOVERNED_RSI_REPAIR_INTERNAL);
        const result = await registry.executeDefinition('modify_code', tool, call.args,
            { source: 'SomaAgenticExecutor', modelProvider: 'local', rsiRepairToken: token, record: false });
        assert.equal(result.passedToGovernedPipeline, true);
        assert.equal(audits, 0);
        assert.equal(await governedRsiRepairAuthorization(goal, { ...call, args: { ...call.args, request: 'Different repair' } }, research), null);
        assert.equal(await governedRsiRepairAuthorization({ metadata: { ...goal.metadata, missionDirectorApproved: false } }, call, research), null);
        await assert.rejects(registry.executeDefinition('modify_code', tool, call.args,
            { source: 'SomaAgenticExecutor', modelProvider: 'local', rsiRepairToken: true, record: false }), /Qwen/);
        assert.equal(audits, 1);
    });

    it('reports a validated shadow repair truthfully and does not train it as a failed candidate', async () => {
        const executor = new SomaAgenticExecutor();
        let failures = 0;
        executor._currentGoal = { id: 'goal-1', metadata: { asiCycleId: 'cycle-1', researchPlanId: 'plan-1', capabilityContract: {} } };
        executor.system = {
            engineeringSwarm: {},
            selfEvolutionResearch: {
                validatePlan: async () => ({ id: 'plan-1', file: 'core/example.js', request: 'Repair example', sourceHash: 'hash', sources: [] }),
                draft: async () => ({ files: [{ path: 'core/example.js' }] }),
                recordCandidateFailure: async () => { failures++; },
            },
            selfModPipeline: { propose: async () => ({ state: 'shadow_validated', implemented: false, shelved: true,
                entry: { shadowValidation: { published: false, checks: [{ isolation: 'container' }] } } }) },
        };
        const outcome = await executor._buildTools().modify_code.execute({ filepath: 'core/example.js', request: 'Repair example' });
        assert.equal(outcome.verifiedShadow, true);
        assert.equal(outcome.success, false);
        assert.equal(outcome.shadowValidation.published, false);
        assert.match(outcome.summary, /no source change was published/);
        assert.equal(failures, 0);
    });

});

describe('RSI route delegates to governed kernel', () => {
    async function post(base, body, token = null) {
        return new Promise((resolve, reject) => {
            const request = http.request(`${base}/api/soma/rsi/cycle`, { method: 'POST', headers: {
                'Content-Type': 'application/json', Connection: 'close', ...(token ? { 'X-Operator-Token': token } : {}),
            } }, response => {
                let payload = '';
                response.on('data', chunk => { payload += chunk; });
                response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(payload) }));
            });
            request.on('error', reject);
            request.end(JSON.stringify(body));
        });
    }
    async function withServer(system, action) {
        const app = express();
        app.use(express.json());
        app.use('/api/soma/rsi', createRsiRoutes(system));
        const server = app.listen(0, '127.0.0.1');
        try { await new Promise(resolve => server.once('listening', resolve)); return await action(`http://127.0.0.1:${server.address().port}`); }
        finally { await new Promise(resolve => server.close(resolve)); }
    }

    it('requires operator auth and rejects client-provided mock scores or harnesses', async () => {
        const previous = process.env.SOMA_OPERATOR_TOKEN;
        process.env.SOMA_OPERATOR_TOKEN = 'rsi-test-operator';
        let calls = 0;
        try {
            await withServer({ asiKernel: { runCycle: async () => { calls++; return { id: 'cycle_real', result: 'pending_execution', phases: { execute: { goalId: 'goal_real' } } }; } }, selfEvolutionDirector: {} }, async base => {
                const anonymous = await post(base, {});
                assert.equal(anonymous.status, 401);
                const spoof = await post(base, { candidateHarness: {}, arm: 'tool_dispatch' }, 'rsi-test-operator');
                assert.equal(spoof.status, 400);
                assert.equal(calls, 0);
                const accepted = await post(base, {}, 'rsi-test-operator');
                assert.equal(accepted.status, 202);
                const receipt = accepted.json;
                assert.deepEqual({ cycleId: receipt.cycleId, state: receipt.state, goalId: receipt.goalId, promoted: receipt.promoted }, { cycleId: 'cycle_real', state: 'pending_execution', goalId: 'goal_real', promoted: false });
                assert.equal(calls, 1);
            });
        } finally { if (previous === undefined) delete process.env.SOMA_OPERATOR_TOKEN; else process.env.SOMA_OPERATOR_TOKEN = previous; }
    });

    it('reports a queued admission honestly when another autonomous goal owns the slot', async () => {
        const previous = process.env.SOMA_OPERATOR_TOKEN;
        process.env.SOMA_OPERATOR_TOKEN = 'rsi-test-operator';
        try {
            const admission = { promoted: false, reason: 'autonomous_execution_slot_occupied', activeGoalId: 'other-goal' };
            await withServer({ asiKernel: { runCycle: async () => ({ id: 'cycle_queued', result: 'pending_approval',
                phases: { execute: { proposalId: 'proposal-1', admission } } }) }, selfEvolutionDirector: {} }, async base => {
                const response = await post(base, {}, 'rsi-test-operator');
                assert.equal(response.status, 202);
                assert.equal(response.json.state, 'pending_approval');
                assert.equal(response.json.proposalId, 'proposal-1');
                assert.deepEqual(response.json.admission, admission);
                assert.equal(response.json.goalId, null);
                assert.equal(response.json.promoted, false);
                assert.match(response.json.nextStep, /queued/);
            });
        } finally { if (previous === undefined) delete process.env.SOMA_OPERATOR_TOKEN; else process.env.SOMA_OPERATOR_TOKEN = previous; }
    });
});
