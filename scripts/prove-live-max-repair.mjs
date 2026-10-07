// Live MAX + real isolated Git/test execution. Never publishes into SOMA.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { MaxAgentBridge } from '../core/MaxAgentBridge.js';
import { SelfModificationGovernance } from '../core/SelfModificationGovernance.js';
import { SelfRepairCandidate } from '../core/SelfRepairCandidate.js';
import { SelfModificationPipeline } from '../core/SelfModificationPipeline.js';
import { MaxApprovalShim } from '../arbiters/MaxApprovalShim.js';
import { NemesisArbiter } from '../arbiters/NemesisArbiter.js';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const requestId = `live-repair-proof-${Date.now()}`;
const directory = path.resolve('data/repair-verification', requestId);
await fs.mkdir(directory, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-live-max-proof-'));
const report = { requestId, startedAt: new Date().toISOString(), productionPublication: false };
const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true }).toString().trim();
let governance, candidate, shim;
try {
    git(['init']); git(['config', 'user.name', 'SOMA Live Proof']); git(['config', 'user.email', 'soma-proof@localhost']);
    await fs.mkdir(path.join(root, 'core')); await fs.mkdir(path.join(root, 'tests'));
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    const original = 'export function add(a, b) { return a - b; }\n';
    await fs.writeFile(path.join(root, 'core/arithmetic.js'), original);
    await fs.writeFile(path.join(root, 'tests/arithmetic.test.mjs'), "import assert from 'node:assert/strict'; import {add} from '../core/arithmetic.js'; assert.equal(add(2,3),5); assert.equal(add(-2,3),1); assert.equal(add(0,0),0);\n");
    git(['add', '.']); git(['commit', '-m', 'Isolated live repair proof baseline']);
    const bridge = new MaxAgentBridge({ ledgerPath: path.join(directory, 'bridge.jsonl') });
    const health = await bridge.ensureAvailable({ startIfOffline: false });
    assert.equal(health.health?.boundedRepairProtocol, 1, 'Running MAX lacks bounded repair protocol');
    const sourceHash = crypto.createHash('sha256').update(original).digest('hex');
    const acceptance = await bridge.injectGoal('Isolated repair proof: addition returns subtraction', {
        requestId, readOnly: true, priority: .8,
        description: 'In the isolated fixture only, core/arithmetic.js add(2,3) returns -1; required result is 5. add(-2,3) must return 1 and add(0,0) must return 0. Propose the minimal source correction using the supplied real source. Do not edit files or deploy anything.',
        repairContract: { schemaVersion: 1, sourceGoalId: requestId, workspace: root, files: [{ path: 'core/arithmetic.js', sourceHash }] },
    });
    report.maxGoalId = acceptance.id;
    console.log(`MAX accepted durable repair job ${acceptance.id}; awaiting real model proposal.`);
    let job;
    const deadline = Date.now() + 240000;
    let lastStatus;
    do {
        job = await bridge.getGoal(acceptance.id);
        if (job.status !== lastStatus) console.log(`MAX job status: ${job.status}`);
        lastStatus = job.status;
        if (['done', 'failed', 'cancelled'].includes(job.status)) break;
        await new Promise(resolve => setTimeout(resolve, 3000));
    } while (Date.now() < deadline);
    report.maxStatus = job.status;
    report.outcome = job.outcome;
    assert.equal(job.status, 'done', JSON.stringify(job.outcome || { status: job.status }));
    assert.equal(job.outcome?.state, 'proposal_only');
    assert.equal(job.outcome.sourceGoalId, requestId);
    assert.equal(await fs.readFile(path.join(root, 'core/arithmetic.js'), 'utf8'), original, 'MAX unexpectedly changed source');
    governance = new SelfModificationGovernance({ root, system: {} });
    await governance.initialize();
    candidate = await SelfRepairCandidate.create(governance, job.outcome.patch, { testFiles: ['tests/arithmetic.test.mjs'], risk: 'low' });
    report.validation = candidate.validation;
    report.originalUnchanged = await fs.readFile(path.join(root, 'core/arithmetic.js'), 'utf8') === original;
    report.passed = candidate.validation.passed === true && report.originalUnchanged;
    assert.equal(report.passed, true);
    console.log('PASS: live MAX proposal passed real candidate tests; original fixture and SOMA source were not modified.');
    if (process.argv.includes('--review')) {
        await candidate.close(); candidate = null;
        shim = new MaxApprovalShim({ name: 'LiveRepairProofApproval' });
        await shim.initialize({ maxAgentBridge: bridge });
        const system = { selfModificationGovernance: governance,
            commandBridgeSettings: { authority: { selfModificationApprover: 'max' } },
            engineeringSwarm: { _getMaxApprovalShim: async () => shim },
            nemesis: new NemesisArbiter({ rootPath: root, maxSteps: 5 }),
        };
        const pipeline = new SelfModificationPipeline({ root });
        pipeline.initialize(system);
        // Store the normal pipeline ledger in this proof's artifact directory.
        pipeline._logToLedger = async entry => fs.writeFile(path.join(directory, 'pipeline.json'), JSON.stringify(entry, null, 2));
        console.log('Requesting actual MAX approval and NEMESIS tool-based review of the isolated fixture.');
        const result = await pipeline.propose('core/arithmetic.js', job.outcome.summary, 'isolated live proof', {
            patch: job.outcome.patch, sourceHashes: { 'core/arithmetic.js': sourceHash },
            capabilityContract: { testFiles: ['tests/arithmetic.test.mjs'], risk: 'low' },
        });
        report.reviewedFixturePromotion = { implemented: result.implemented, deploymentPending: result.deploymentPending,
            promotionId: result.entry?.promotion?.id, stages: result.entry?.stages, reason: result.reason };
        assert.equal(result.implemented, true, result.reason);
        assert.equal(result.deploymentPending, true);
        console.log('PASS: real MAX/NEMESIS review and Poseidon validation promoted only the temporary fixture; no production deployment requested.');
    }
} catch (error) {
    report.passed = false;
    report.error = error.message;
    console.error(`Live proof failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    if (candidate) await candidate.close();
    clearInterval(governance?._timer);
    await shim?.shutdown?.();
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    // Only the exact mkdtemp directory owned by this invocation is removed.
    await fs.rm(root, { recursive: true, force: true });
    console.log(`Live proof receipt: ${path.join(directory, 'report.json')}`);
}
