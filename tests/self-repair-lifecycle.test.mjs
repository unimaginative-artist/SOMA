import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SelfRepairCandidate } from '../core/SelfRepairCandidate.js';
import { SelfModificationGovernance } from '../core/SelfModificationGovernance.js';
import { runIsolatedRepair } from '../core/SelfRepairPipeline.js';
import { SelfRepairDeployment } from '../core/SelfRepairDeployment.js';
import { SelfRepairCoordinator } from '../core/SelfRepairCoordinator.js';
import { SelfModificationPipeline } from '../core/SelfModificationPipeline.js';
import { runSomaRepairJob, parseRepairProposal } from '../../MAX/core/SomaRepairJob.js';
import { Brain } from '../../MAX/core/Brain.js';
import { resolveWithinRoot } from '../core/PathSafety.js';
import { assertRepairArtifactWrite } from '../core/SelfRepairArtifactPolicy.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-repair-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
    git(['init']); git(['config', 'user.name', 'Repair Test']); git(['config', 'user.email', 'redacted@example.com']);
    await fs.mkdir(path.join(root, 'core')); await fs.mkdir(path.join(root, 'tests'));
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(root, 'core/counter.js'), 'export const value = 1;\n');
    await fs.writeFile(path.join(root, 'owner.txt'), 'owner baseline');
    await fs.writeFile(path.join(root, 'tests/counter.test.mjs'), "import assert from 'node:assert/strict'; import {value} from '../core/counter.js'; assert.equal(value, 2);\n");
    git(['add', '.']); git(['commit', '-m', 'baseline']);
    await fs.writeFile(path.join(root, 'owner.txt'), 'uncommitted owner work');
    const governance = new SelfModificationGovernance({ root, system: {} });
    await governance.initialize(); t.after(() => clearInterval(governance._timer));
    governance.candidateRunner._docker = false;
    const contract = { testFiles: ['tests/counter.test.mjs'], risk: 'low' };
    const patch = { files: [{ path: 'core/counter.js', content: 'export const value = 2;\n' }] };
    return { root, git, governance, contract, patch };
}

test('MAX structured repair output survives Markdown without enabling narrative patches', async () => {
    const proposal = { summary: 'fix', patch: { files: [{ path: 'core/a.js', content: 'export const obj = {a: "}"};' }] } };
    assert.deepEqual(parseRepairProposal('**Bounded repair**\n```json\n' + JSON.stringify(proposal) + '\n```'), proposal);
    assert.throws(() => parseRepairProposal('I fixed the source.'), /exactly one/);
    assert.throws(() => parseRepairProposal(JSON.stringify(proposal) + '\n' + JSON.stringify(proposal)), /exactly one/);
    const brain = Object.create(Brain.prototype);
    brain._ready = true;
    brain._runCode = async (_prompt, systemPrompt) => { assert.doesNotMatch(systemPrompt, /CRITICAL REASONING PROTOCOL/); return { text: '{}' }; };
    await brain.think('fix code function', { tier: 'code', structuredOutput: true, systemPrompt: 'JSON only' });
});

test('owned candidate roots resolve locally while explicit brain-tier boundaries remain enforced', async t => {
    const f = await fixture(t);
    assert.equal(resolveWithinRoot(f.root, 'core/counter.js'), path.join(f.root, 'core/counter.js'));
    assert.throws(() => resolveWithinRoot(f.root, '../escape.js'), /outside allowed root/);
    assert.throws(() => resolveWithinRoot(f.root, 'core/counter.js', 'Model path', { authorityTier: 'local' }), /boundary|local brain/);
    assert.throws(() => resolveWithinRoot(f.root, 'core/counter.js', 'Model path', { authorityTier: 'frontier' }), /boundary/);
});

test('artifact tools cannot forge deployment receipts or directly replace source', async t => {
    const f = await fixture(t);
    assert.equal(assertRepairArtifactWrite(f.root, path.join(f.root, 'data/report.md')), 'data/report.md');
    assert.throws(() => assertRepairArtifactWrite(f.root, path.join(f.root, 'data/self-modification/promotions.json')), /governance/);
    assert.throws(() => assertRepairArtifactWrite(f.root, path.join(f.root, 'core/counter.js')), /modify_code/);
});

test('real candidate tests pass without touching owner source; failed candidates leave it intact', async t => {
    const f = await fixture(t);
    const candidate = await SelfRepairCandidate.create(f.governance, f.patch, f.contract);
    assert.equal(await fs.readFile(path.join(f.root, 'core/counter.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(candidate.validation.passed, true);
    await candidate.close();
    await assert.rejects(SelfRepairCandidate.create(f.governance, { files: [{ path: 'core/counter.js', content: 'export const value = 9;' }] }, f.contract));
    assert.equal(await fs.readFile(path.join(f.root, 'core/counter.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(await fs.readFile(path.join(f.root, 'owner.txt'), 'utf8'), 'uncommitted owner work');
});

test('post-validation edits and protected paths cannot be overwritten or promoted', async t => {
    const f = await fixture(t);
    const candidate = await SelfRepairCandidate.create(f.governance, f.patch, f.contract);
    await fs.writeFile(path.join(f.root, 'core/counter.js'), 'owner edit');
    await assert.rejects(candidate.publish(), /changed/);
    await candidate.close();
    await assert.rejects(SelfRepairCandidate.create(f.governance, { files: [{ path: '../escape.js', content: 'bad' }] }, f.contract));
    await assert.rejects(SelfRepairCandidate.create(f.governance, { files: [{ path: 'tests/counter.test.mjs', content: 'pass' }] }, f.contract), /protected/);
});

test('review -> exact tested publication -> durable restart request, no premature probation', async t => {
    const f = await fixture(t);
    const entry = { id: 'repair-one', filepath: 'core/counter.js', finalChange: 'fix counter', motivation: 'test', capabilityContract: f.contract, stages: [] };
    const preflight = await f.governance.preflight({ proposalId: entry.id, files: [entry.filepath] });
    const pipeline = { system: {
        engineeringSwarm: { modifyCode: async (_p,_r,_c,options) => {
            assert.equal(options.candidateOnly, true);
            return { success: true, patch: f.patch, approval: { approved: true, reviewerFingerprint: 'max:reviewer' } };
        } },
        nemesis: { evaluateCandidate: async root => {
            assert.equal(await fs.readFile(path.join(f.root, 'core/counter.js'), 'utf8'), 'export const value = 1;\n');
            assert.equal(await fs.readFile(path.join(root, 'core/counter.js'), 'utf8'), 'export const value = 2;\n');
            return { score: .9, reviewerFingerprint: 'nemesis:reviewer' };
        } },
    }, _poseidon: { verify: async () => ({ state: 'TRUE' }) }, _logToLedger: async () => {} };
    const result = await runIsolatedRepair(pipeline, f.governance, entry, preflight);
    assert.equal(result.implemented, true, result.reason);
    assert.equal(result.deploymentPending, true);
    const record = result.entry.promotion;
    assert.equal(record.deployment.status, 'pending');
    assert.equal((await f.governance.evaluateProbation(record.id)).evaluationReason, 'tested_version_not_deployed');
    const manifest = JSON.parse(await fs.readFile(path.join(f.root, record.deployment.manifest)));
    assert.equal(Buffer.from(manifest.files[0].before_base64, 'base64').toString(), 'export const value = 1;\n');
    assert.equal(f.git(['show', 'HEAD:owner.txt']), 'owner baseline');
    assert.equal(await fs.readFile(path.join(f.root, 'owner.txt'), 'utf8'), 'uncommitted owner work');
    let requests = 0;
    const deployment = new SelfRepairDeployment({ system: {}, governance: f.governance, fetchImpl: async (url, options) => {
        if (url.endsWith('/ping')) return { ok: true, json: async () => ({ deployment_contract_version: 2 }) };
        requests++;
        assert.equal(JSON.parse(options.body).deployment_manifest, record.deployment.manifest);
        return { ok: true, json: async () => ({ promotion_id: record.id }) };
    } });
    record.promotedAt = new Date(Date.now() - 20000).toISOString();
    await deployment.tick(); assert.equal(requests, 1);
    assert.equal(record.deployment.status, 'requested');
    const receipt = { promotion_id: record.id, candidate_ref: record.commit, status: 'succeeded', pid: process.pid };
    await fs.writeFile(path.join(f.root, path.dirname(record.deployment.manifest), 'receipt.json'), JSON.stringify(receipt));
    await deployment.tick();
    assert.equal(record.deployment.status, 'succeeded');
    assert.equal(deployment.pendingShutdown, false);
});

test('RSI shadow cycle validates a real candidate but never publishes it', async t => {
    const f = await fixture(t);
    const previous = process.env.SOMA_RSI_AUTOPROMOTE_ENABLED;
    delete process.env.SOMA_RSI_AUTOPROMOTE_ENABLED;
    t.after(() => { if (previous === undefined) delete process.env.SOMA_RSI_AUTOPROMOTE_ENABLED; else process.env.SOMA_RSI_AUTOPROMOTE_ENABLED = previous; });
    const entry = { id: 'rsi-shadow-one', goalId: 'goal-rsi', asiCycleId: 'cycle-rsi',
        filepath: 'core/counter.js', finalChange: 'fix counter', motivation: 'measured defect',
        capabilityContract: { ...f.contract, requiresContainer: true }, stages: [] };
    const preflight = await f.governance.preflight({ proposalId: entry.id, files: [entry.filepath] });
    const pipeline = { system: {
        engineeringSwarm: { modifyCode: async () => ({ success: true, patch: f.patch,
            approval: { approved: true, reviewerFingerprint: 'max:reviewer' } }) },
        nemesis: { evaluateCandidate: async () => ({ score: .9, reviewerFingerprint: 'nemesis:reviewer' }) },
    }, _poseidon: { verify: async () => ({ state: 'TRUE' }) }, _logToLedger: async () => {} };
    const result = await runIsolatedRepair(pipeline, f.governance, entry, preflight);
    assert.equal(result.state, 'shadow_validated', result.reason);
    assert.equal(result.implemented, false);
    assert.equal(result.entry.shadowValidation.published, false);
    assert.equal(result.entry.shadowValidation.checks.some(check => check.isolation === 'container'), true);
    assert.equal(await fs.readFile(path.join(f.root, 'core/counter.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(f.governance.records.length, 0);
});

test('MAX reads pinned real source, returns a durable proposal, and SOMA validates/promotes it', async t => {
    const f = await fixture(t);
    let requested;
    let outcome;
    const approval = { approved: true, reviewerFingerprint: 'max:independent' };
    const system = { commandBridgeSettings: { authority: { selfModificationApprover: 'max' } },
        selfModificationGovernance: f.governance,
        engineeringSwarm: { _getMaxApprovalShim: async () => ({ requestApproval: async () => approval }) },
        nemesis: { evaluateCandidate: async () => ({ score: .9, reviewerFingerprint: 'nemesis:independent' }) },
        maxBridge: { ensureAvailable: async () => ({ available: true, health: { boundedRepairProtocol: 1 } }),
            injectGoal: async (title, options) => { requested = { title, ...options, source: 'soma' }; return { id: 'max-job' }; },
            getGoal: async () => ({ status: 'done', outcome }) },
    };
    const pipeline = new SelfModificationPipeline({ root: f.root });
    pipeline.initialize(system); pipeline._logToLedger = async () => {};
    system.selfModPipeline = pipeline;
    const coordinator = new SelfRepairCoordinator({ system, root: f.root });
    await coordinator.initialize(); t.after(() => clearInterval(coordinator.timer));
    const goal = { id: 'original-goal', title: 'Repair core/counter.js', description: 'Counter should be 2', metadata: { capabilityContract: f.contract } };
    const queued = await coordinator.queue(goal, null);
    assert.equal(queued.success, true);
    assert.equal(requested.readOnly, true);
    outcome = await runSomaRepairJob({ agentBrain: { think: async prompt => {
        assert.match(prompt, /export const value = 1/);
        return { text: JSON.stringify({ summary: 'Correct counter value', patch: f.patch }) };
    } } }, requested);
    assert.equal(outcome.state, 'proposal_only');
    assert.equal(await fs.readFile(path.join(f.root, 'core/counter.js'), 'utf8'), 'export const value = 1;\n');
    await coordinator.tick();
    assert.equal(coordinator.jobs[0].status, 'promoted', coordinator.jobs[0].error);
    assert.equal(f.governance.records[0].goalId, 'original-goal');
    assert.equal(f.governance.records[0].deployment.status, 'pending');
    const restored = new SelfRepairCoordinator({ system, root: f.root });
    await restored.initialize(); t.after(() => clearInterval(restored.timer));
    assert.equal((await restored.queue(goal, null)).maxGoalId, 'max-job');
});

test('MAX rejects stale source and invented file paths without source writes', async t => {
    const f = await fixture(t);
    const contract = { schemaVersion: 1, workspace: f.root, files: [{ path: 'core/counter.js', sourceHash: '0'.repeat(64) }] };
    await assert.rejects(runSomaRepairJob({}, { source: 'soma', repairContract: contract }), /changed/);
    contract.files[0].path = '../escape.js';
    await assert.rejects(runSomaRepairJob({}, { source: 'soma', repairContract: contract }), /outside contract/);
});

test('MAX rejects fictional replacement spans before completing a proposal job', async t => {
    const f = await fixture(t);
    const { beforeHashes } = await f.governance.inspectSnapshotFiles(['core/counter.js']);
    const goal = { source: 'soma', description: 'Fix counter', outcome: { lastError: 'prior edit did not match' },
        repairContract: { schemaVersion: 1, workspace: f.root, files: [{ path: 'core/counter.js', sourceHash: beforeHashes['core/counter.js'] }] } };
    await assert.rejects(runSomaRepairJob({ agentBrain: { think: async prompt => {
        assert.match(prompt, /prior edit did not match/);
        return { text: JSON.stringify({ patch: { files: [{ path: 'core/counter.js', edits: [{ old: 'imagined_source', new: '2' }] }] } }) };
    } } }, goal), /exact real source span/);
});

test('dirty source uses a private baseline; owner HEAD and index remain untouched', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.root, 'core/counter.js'), 'export const value = 0; // owner change\n');
    f.git(['add', 'core/counter.js']);
    const head = f.git(['rev-parse', 'HEAD']);
    const index = f.git(['diff', '--cached']);
    const candidate = await SelfRepairCandidate.create(f.governance, f.patch, f.contract);
    const version = await candidate.commitSnapshot();
    const publication = await candidate.publish();
    const record = await f.governance.promoteSnapshot({ proposalId: 'dirty-safe', files: ['core/counter.js'],
        sandbox: candidate.validation, capabilityContract: f.contract, publication, version });
    await candidate.close();
    assert.equal(f.git(['rev-parse', 'HEAD']), head);
    assert.equal(f.git(['diff', '--cached']), index);
    assert.equal(f.git(['show', `${record.parentCommit}:core/counter.js`]), 'export const value = 0; // owner change');
    assert.equal(f.git(['show', `${record.commit}:core/counter.js`]), 'export const value = 2;');
    assert.equal(Buffer.from(publication[0].before_base64, 'base64').toString(), 'export const value = 0; // owner change\n');
});

test('legacy supervisor is refused without sending a deployment or claiming success', async t => {
    const f = await fixture(t);
    const deployment = new SelfRepairDeployment({ system: {}, governance: f.governance,
        fetchImpl: async url => { assert.ok(url.endsWith('/ping')); return { ok: true, json: async () => ({ status: 'alive' }) }; } });
    await assert.rejects(deployment.request({ id: 'pending', deployment: {} }), /contract v2/);
    assert.equal(deployment.pendingShutdown, false);
});

test('lost deployment acknowledgement unpauses admission without claiming deployment', async t => {
    const f = await fixture(t);
    const deployment = new SelfRepairDeployment({ system: {}, governance: f.governance,
        fetchImpl: async url => {
            if (url.endsWith('/ping')) return { ok: true, json: async () => ({ deployment_contract_version: 2 }) };
            throw new Error('connection lost');
        } });
    const record = { id: 'pending', deployment: { manifest: 'data/self-modification/deployments/pending/manifest.json' } };
    await assert.rejects(deployment.request(record), /connection lost/);
    assert.equal(deployment.pendingShutdown, false);
    assert.equal(record.deployment.status, 'requested');
    assert.match(record.deployment.lastError, /connection lost/);
});

test('a blocked original goal gets one verified changed-strategy retry, never a fake completion', async t => {
    const f = await fixture(t);
    const goal = { id: 'g1', status: 'blocked', metadata: { maxEscalation: { success: true } } };
    let retries = 0;
    const deployment = new SelfRepairDeployment({ governance: f.governance, system: { goalPlanner: {
        goals: new Map([[goal.id, goal]]), retryGoal: async (id, options) => { retries++; assert.equal(id, goal.id); assert.equal(options.actor, 'SelfRepairDeployment'); return { success: true }; },
    } } });
    const record = { id: 'p1', goalId: goal.id };
    await deployment.resumeRepairedGoal(record); await deployment.resumeRepairedGoal(record);
    assert.equal(retries, 1); assert.equal(goal.status, 'blocked');
    assert.equal(goal.metadata.autonomousRepairRetries, 1);
});
