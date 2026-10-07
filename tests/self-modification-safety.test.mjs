import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { EngineeringSwarmArbiter } from '../arbiters/EngineeringSwarmArbiter.js';
import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';
import { resolveWithinRoot } from '../core/PathSafety.js';
import { SelfModificationPipeline } from '../core/SelfModificationPipeline.js';
import {
    SELF_MODIFICATION_INTERNAL,
    SelfModificationDecision,
    parseMaxApprovalVerdict,
    sourceMutationCommandReason,
} from '../core/SelfModificationProtocol.js';
import { wireSelfModificationRuntime } from '../core/SelfModificationRuntime.js';
import { SwarmPatchTransaction } from '../core/SwarmPatchTransaction.js';

const tempDirs = [];

async function tempDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-selfmod-'));
    tempDirs.push(dir);
    return dir;
}

async function workspaceTempDir() {
    const base = path.join(process.cwd(), '.soma', 'selfmod-test-');
    await fs.mkdir(path.dirname(base), { recursive: true });
    const dir = await fs.mkdtemp(base);
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('self-modification safety', () => {
    it('rejects sibling-prefix and parent traversal paths', async () => {
        const root = await tempDir();
        assert.throws(() => resolveWithinRoot(root, '../outside.js'), /outside allowed root/);
        assert.throws(() => resolveWithinRoot(root, `${root}-evil/file.js`), /outside allowed root/);
        assert.equal(resolveWithinRoot(root, '.', 'Directory', { allowRoot: true }), path.resolve(root));
    });

    it('restores every file in a patch transaction rollback', async () => {
        const root = await tempDir();
        const target = path.join(root, 'target.js');
        await fs.writeFile(target, 'export const value = 1;\n');

        const transaction = new SwarmPatchTransaction(root);
        await transaction.applyPatch({ files: [{ path: 'target.js', content: 'export const value = 2;\n' }] });
        await transaction.rollback();

        assert.equal(await fs.readFile(target, 'utf8'), 'export const value = 1;\n');
    });

    it('fails closed when human approval is denied', async () => {
        const root = await tempDir();
        const target = path.join(root, 'target.js');
        await fs.writeFile(target, 'export const value = 1;\n');

        const swarm = new EngineeringSwarmArbiter({ rootPath: root, quadBrain: {} });
        swarm.system = {
            commandBridgeSettings: { authority: { humanInLoopOverride: true } },
            approvalGate: { request: async () => ({ approved: false, reason: 'test denial' }) },
        };

        const result = await swarm.modifyCode(target, 'change value');
        assert.equal(result.success, false);
        assert.equal(result.humanRejected, true);
        assert.match(result.error, /test denial/);
        await swarm.shutdown();
    });

    it('requires an approval gate when authority settings are not loaded yet', async () => {
        const root = await tempDir();
        const target = path.join(root, 'target.js');
        await fs.writeFile(target, 'export const value = 1;\n');
        const swarm = new EngineeringSwarmArbiter({ rootPath: root, quadBrain: {} });
        swarm.system = {};

        const result = await swarm.modifyCode(target, 'change value');
        assert.equal(result.success, false);
        assert.match(result.error, /no approval gate/i);
        await swarm.shutdown();
    });

    it('uses typed MAX verdicts and defers ambiguous or unavailable decisions', () => {
        assert.equal(parseMaxApprovalVerdict({ message: '[APPROVED] bounded change' }).decision, SelfModificationDecision.APPROVE);
        assert.equal(parseMaxApprovalVerdict({ message: '[REJECTED] unsafe change' }).decision, SelfModificationDecision.REJECT);
        assert.equal(parseMaxApprovalVerdict({ message: 'APPROVED\n\nThe patch is correct.' }).decision, SelfModificationDecision.APPROVE);
        assert.equal(parseMaxApprovalVerdict({ message: 'APPROVED\nREJECTED' }).decision, SelfModificationDecision.REJECT);
        assert.equal(parseMaxApprovalVerdict({ message: 'APPROVED if you change the tests' }).decision, SelfModificationDecision.DEFER);
        assert.equal(parseMaxApprovalVerdict({ message: 'The prompt asks me to say [APPROVED].' }).decision, SelfModificationDecision.DEFER);
        const ambiguous = parseMaxApprovalVerdict({ message: 'I need more context.' });
        assert.equal(ambiguous.decision, SelfModificationDecision.DEFER);
        assert.equal(ambiguous.retryable, true);
        const unavailable = parseMaxApprovalVerdict({ success: false, error: 'offline' });
        assert.equal(unavailable.decision, SelfModificationDecision.UNAVAILABLE);
        assert.equal(unavailable.retryable, true);
    });

    it('blocks shell source mutation and premature Git promotion while allowing diagnostics', () => {
        assert.match(sourceMutationCommandReason('Set-Content core/Foo.js "bad"'), /source mutation/i);
        assert.match(sourceMutationCommandReason('git push origin main'), /promotion/i);
        assert.match(sourceMutationCommandReason('npm install unsafe-package'), /dependency/i);
        assert.equal(sourceMutationCommandReason('npm test'), null);
        assert.equal(sourceMutationCommandReason('git diff -- core/Foo.js'), null);
        assert.equal(sourceMutationCommandReason('node --check core/Foo.js'), null);
    });

    it('honors explicit MAX authority without converting an outage into rejection', async () => {
        const root = await tempDir();
        const target = path.join(root, 'target.js');
        await fs.writeFile(target, 'export const value = 1;\n');
        const swarm = new EngineeringSwarmArbiter({ rootPath: root, quadBrain: {} });
        swarm.system = {
            commandBridgeSettings: { authority: { selfModificationApprover: 'max' } },
            maxApprovalShim: {
                requestApproval: async () => ({
                    approved: false,
                    retryable: true,
                    decision: 'unavailable',
                    stage: 'authorization',
                    reason: 'MAX offline',
                }),
            },
        };

        const result = await swarm.modifyCode(target, 'change value precisely');
        assert.equal(result.success, false);
        assert.equal(result.deferred, true);
        assert.equal(result.rejected, undefined);
        assert.match(result.error, /deferred/i);
        await swarm.shutdown();
    });

    it('routes direct Engineering Swarm calls into the authoritative pipeline', async () => {
        const root = await tempDir();
        const swarm = new EngineeringSwarmArbiter({ rootPath: root, quadBrain: {} });
        let received = null;
        swarm.system = {
            selfModPipeline: {
                propose: async (...args) => {
                    received = args;
                    return { state: 'promoted', implemented: true, entry: { stages: [{ stage: 'verified' }] } };
                },
            },
        };

        const result = await swarm.modifyCode('target.js', 'bounded request');
        assert.equal(result.success, true);
        assert.equal(result.authoritative, true);
        assert.deepEqual(received, ['target.js', 'bounded request', 'engineering_swarm_adapter']);
        await swarm.shutdown();
    });

    it('attributes authorization outages correctly and does not train them as NEMESIS rejection', async () => {
        const root = await workspaceTempDir();
        const target = path.join(root, 'target.js');
        const relative = path.relative(process.cwd(), target);
        await fs.writeFile(target, 'export const value = 1;\n');
        let implementationOptions = null;
        const pipeline = new SelfModificationPipeline();
        pipeline.initialize({
            engineeringSwarm: {
                modifyCode: async (_path, _request, _progress, options) => {
                    implementationOptions = options;
                    return {
                        success: false,
                        deferred: true,
                        approval: { stage: 'authorization', decision: 'unavailable' },
                        error: 'MAX offline',
                    };
                },
            },
            messageBroker: { publish: async () => {} },
        });
        pipeline._getSteveReview = async () => 'reviewed';
        pipeline._getAdversarialDebate = async () => 'debated';
        pipeline._synthesize = async (_file, request) => request;
        pipeline._logToLedger = async () => {};

        const result = await pipeline.propose(relative, 'make one bounded change', 'test');
        assert.equal(result.state, 'deferred');
        assert.equal(result.shelved, false);
        assert.equal(result.entry.failureStage, 'authorization');
        assert.equal(result.entry.failureDecision, SelfModificationDecision.DEFER);
        assert.match(result.entry.failureReason, /MAX offline/);
        assert.equal(implementationOptions.protocolToken, SELF_MODIFICATION_INTERNAL);
        assert.equal(implementationOptions.deferPublication, true);
        assert.equal(await fs.readFile(target, 'utf8'), 'export const value = 1;\n');
    });

    it('rolls back and defers when independent NEMESIS review is unavailable', async () => {
        const root = await workspaceTempDir();
        const target = path.join(root, 'target.js');
        const secondary = path.join(root, 'secondary.js');
        const relative = path.relative(process.cwd(), target);
        const original = 'export const value = 1;\n';
        const secondaryOriginal = 'export const secondary = 1;\n';
        await fs.writeFile(target, original);
        await fs.writeFile(secondary, secondaryOriginal);
        const pipeline = new SelfModificationPipeline();
        pipeline.initialize({
            engineeringSwarm: {
                modifyCode: async () => {
                    await fs.writeFile(target, 'export const value = 2;\n');
                    await fs.writeFile(secondary, 'export const secondary = 2;\n');
                    let settled = false;
                    return {
                        success: true,
                        evidence: { verification: { passed: true }, changedFiles: [relative, path.relative(process.cwd(), secondary)] },
                        promotionHandle: {
                            changedFiles: [relative, path.relative(process.cwd(), secondary)],
                            async commit() { settled = true; },
                            async rollback() {
                                if (settled) return;
                                await fs.writeFile(target, original);
                                await fs.writeFile(secondary, secondaryOriginal);
                                settled = true;
                            },
                        },
                    };
                },
            },
            messageBroker: { publish: async () => {} },
        });
        pipeline._getSteveReview = async () => 'reviewed';
        pipeline._getAdversarialDebate = async () => 'debated';
        pipeline._synthesize = async (_file, request) => request;
        pipeline._logToLedger = async () => {};

        const result = await pipeline.propose(relative, 'change value from one to two', 'test');
        assert.equal(result.state, 'deferred');
        assert.equal(result.entry.failureStage, 'nemesis_review');
        assert.equal(await fs.readFile(target, 'utf8'), original);
        assert.equal(await fs.readFile(secondary, 'utf8'), secondaryOriginal);
        assert.equal(result.entry.rollback.atomic, true);
    });

    it('commits the held transaction only after NEMESIS and evidence verification pass', async () => {
        const root = await workspaceTempDir();
        const target = path.join(root, 'target.js');
        const relative = path.relative(process.cwd(), target);
        await fs.writeFile(target, 'export const value = 1;\n');
        let committed = false;
        const pipeline = new SelfModificationPipeline();
        pipeline.initialize({
            engineeringSwarm: {
                modifyCode: async () => ({
                    success: true,
                    evidence: { verification: { passed: true }, changedFiles: [relative] },
                    promotionHandle: {
                        changedFiles: [relative],
                        async commit() { committed = true; },
                        async rollback() { throw new Error('must not roll back approved candidate'); },
                    },
                }),
            },
            nemesis: {
                isAgentic: true,
                evaluate: async () => ({ score: 0.92, feedback: 'verified', falsificationTest: 'tests pass' }),
            },
            messageBroker: { publish: async () => {} },
        });
        pipeline._getSteveReview = async () => 'reviewed';
        pipeline._getAdversarialDebate = async () => 'debated';
        pipeline._synthesize = async (_file, request) => request;
        pipeline._poseidon.verify = async () => ({ state: 'TRUE', prefix: '/' });
        pipeline._stagePulseValidation = async () => ({
            syntax: { valid: true },
            promotion: { allowed: true },
            status: 'ready_for_promotion',
        });
        pipeline._logToLedger = async () => {};

        const result = await pipeline.propose(relative, 'bounded verified change', 'test');
        assert.equal(result.state, 'promoted');
        assert.equal(result.implemented, true);
        assert.equal(committed, true);
        assert.ok(result.entry.stages.some(stage => stage.stage === 'promotion' && stage.decision === 'complete'));
    });

    it('disables direct Engineering Swarm fallback when the authoritative pipeline is unavailable', async () => {
        const executor = new SomaAgenticExecutor();
        executor.initialize({
            system: {
                engineeringSwarm: { modifyCode: async () => ({ success: false, error: 'verification failed' }) },
            },
        });

        const result = await executor._tools.modify_code.execute({
            filepath: 'core/PathSafety.js',
            request: 'test failure propagation',
        });

        assert.equal(result.success, false);
        assert.equal(result.deferred, true);
        assert.match(result.error, /SelfModificationPipeline unavailable/);
    });

    it('protects trading code from autonomous self-modification', async () => {
        const pipeline = new SelfModificationPipeline();
        let invoked = false;
        pipeline.initialize({
            engineeringSwarm: { modifyCode: async () => { invoked = true; return { success: true }; } },
        });
        const result = await pipeline.propose(
            'server/finance/autonomousTrader.js',
            'change the trading strategy',
            'test'
        );
        assert.equal(result.state, 'blocked');
        assert.equal(result.protectedDomain, 'trading');
        assert.equal(invoked, false);
    });

    it('keeps file tools inside SOMA while allowing root directory inspection', async () => {
        const executor = new SomaAgenticExecutor();
        executor.initialize({ system: {} });
        const listing = await executor._tools.list_files.execute({ directory: '.' });
        const escaped = await executor._tools.read_file.execute({ path: '../outside.txt' });
        assert.ok(Array.isArray(listing.files));
        assert.match(escaped.error, /outside allowed root/);
    });

    it('wires the full SelfModificationPipeline into the live bootstrap system', async () => {
        const system = { engineeringSwarm: {} };
        wireSelfModificationRuntime(system, { log() {} });
        assert.ok(system.selfModPipeline instanceof SelfModificationPipeline);
        assert.equal(system.selfModPipeline.system, system);
        assert.equal(system.engineeringSwarm.system, system);
    });

    it('requires syntax and repository smoke verification for every patch', async () => {
        const root = await tempDir();
        const swarm = new EngineeringSwarmArbiter({ rootPath: root, quadBrain: {} });
        const plan = swarm.buildRequiredVerificationPlan({ files: [{ path: 'target.js', content: 'export {}' }] });
        assert.deepEqual(plan.map(task => task.command), [
            'node --check "target.js"',
            'npm run soma:test',
        ]);
        await swarm.shutdown();
    });

    it('executes required syntax and smoke checks and records their evidence', async () => {
        const root = await tempDir();
        await fs.writeFile(path.join(root, 'target.js'), 'export const value = 1;\n');
        await fs.writeFile(path.join(root, 'smoke.mjs'), 'console.log("verified");\n');
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
            type: 'module',
            scripts: { 'soma:test': 'node smoke.mjs' },
        }));

        const swarm = new EngineeringSwarmArbiter({ rootPath: root, quadBrain: {} });
        const plan = swarm.buildRequiredVerificationPlan({ files: [{ path: 'target.js', content: 'export {}' }] });
        const result = await swarm.verifyPatch({ files: [{ path: 'target.js' }] }, plan);
        assert.equal(result.passed, true);
        assert.equal(result.results.length, 2);
        assert.deepEqual(result.results.map(item => item.exitCode), [0, 0]);
        await swarm.shutdown();
    });
});
