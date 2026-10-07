import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { AutonomousMissionDirector } = createRequire(import.meta.url)('../core/AutonomousMissionDirector.cjs');
import { SelfEvolutionResearch, parseArxivFeed, reasonResearchHypothesis } from '../core/SelfEvolutionResearch.js';
import { SelfEvolutionDirector } from '../core/SelfEvolutionDirector.js';
import { CapabilityTrialRegistry } from '../core/CapabilityTrialRegistry.js';
import { nextResearchExperimentAction } from '../core/SomaAgenticExecutor.js';
import { assertRepairArtifactWrite } from '../core/SelfRepairArtifactPolicy.js';

const xml = '<feed><entry><id>http://arxiv.org/abs/2501.12345v1</id><title>Evidence &amp; tests</title><published>2025-01-20T00:00:00Z</published><updated>2025-01-21T00:00:00Z</updated><summary>Measure useful changes using repeatable outcomes.</summary></entry></feed>';
const input = { target: { dimension: 'research', testFiles: [] }, baseline: { receipts: { research: {
    suiteFingerprint: 'fixed-suite', testFiles: [], passed: 3, failed: 5, outputTail: ['real failing test'] } } } };

async function harness(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-research-loop-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'core'));
    await fs.writeFile(path.join(root, 'core/ResearchSourcePolicy.js'), 'export const example = 1;');
    const calls = [], prompts = [];
    const research = new SelfEvolutionResearch({ root, now: () => Date.parse('2026-09-15T12:00:00Z'),
        fetchImpl: async url => { calls.push(String(url)); return new Response(String(url).includes('arxiv') ? xml : 'The scheme and host are case-insensitive. Paths and queries are case sensitive.'); },
        reason: async prompt => {
            prompts.push(prompt);
            const sourceId = JSON.parse(prompt.split('UNTRUSTED REFERENCE DATA: ')[1].split('\nEND REFERENCE DATA.')[0])[0].id;
            return JSON.stringify({ hypothesis: 'Preserve distinct source identities to prevent evidence loss.',
                alternatives: ['Compare raw identifiers; misses equivalent host serialization.', 'Parse URLs and preserve path/query case; avoids merging distinct evidence.'],
                selectedApproach: 'Parse URLs conservatively and retain complete typed fallback identifiers.',
                file: 'core/ResearchSourcePolicy.js', sourceIds: [sourceId], falsification: 'Reject if the fixed source-identity checks do not all pass.' });
        }, ...options });
    await research.initialize(); return { root, research, calls, prompts };
}

test('source discovery orders by submission date and records dates, hashes and abstract-only provenance', async t => {
    const { research, calls } = await harness(t);
    const batch = await research.discover('research');
    assert.equal(batch.state, 'acquired'); assert.equal(batch.sources.length, 2);
    const url = new URL(calls[0]);
    assert.equal(url.searchParams.get('sortBy'), 'submittedDate');
    assert.equal(url.searchParams.get('sortOrder'), 'descending');
    assert.equal(batch.sources[0].kind, 'paper_abstract'); assert.equal(batch.sources[0].peerReviewed, 'not_established');
    assert.equal(batch.sources[0].title, 'Evidence & tests'); assert.equal(batch.sources[0].contentHash.length, 64);
    assert.equal((await research.discover('research')).id, batch.id); assert.equal(calls.length, 2);
});

test('research plan pins the complete benchmark suite and repairs a legacy public-only list', async t => {
    const { root, research } = await harness(t);
    await fs.mkdir(path.join(root, 'tests'));
    const allTests = ['tests/agency-proving-ground.test.cjs', 'tests/research-source-outcomes.test.mjs', 'tests/rsi-research-holdout.test.mjs'];
    const digest = value => crypto.createHash('sha256').update(value).digest('hex');
    for (const [index, file] of allTests.entries()) await fs.writeFile(path.join(root, file), `// fixed evaluator ${index}\n`);
    const suiteFingerprint = digest(JSON.stringify(await Promise.all(allTests.map(async file =>
        [file, digest(await fs.readFile(path.join(root, file)))]))));
    const plan = await research.prepare({ target: { dimension: 'research', testFiles: allTests.slice(0, 2) },
        baseline: { receipts: { research: { suiteFingerprint, testFiles: allTests, passed: 1, failed: 1, outputTail: ['measured failure'] } } } });
    assert.deepEqual(plan.testFiles, allTests);
    assert.equal((await research.validatePlan(plan.id)).id, plan.id);
    plan.testFiles = allTests.slice(0, 2);
    assert.deepEqual((await research.validatePlan(plan.id)).testFiles, allTests);
    await fs.writeFile(path.join(root, allTests[2]), '// changed holdout\n');
    await assert.rejects(research.validatePlan(plan.id), /evaluator changed/);
});
test('malformed, future-dated and off-domain paper entries are not research evidence', () => {
    assert.equal(parseArxivFeed(xml.replace('arxiv.org', '127.0.0.1'), '2026-09-15').length, 0);
    assert.equal(parseArxivFeed(xml, '2024-01-01').length, 0);
    assert.equal(parseArxivFeed('<feed>error</feed>', '2026-09-15').length, 0);
});
test('HTTP failures are recorded and cannot be converted into imaginary sources', async t => {
    const { research } = await harness(t, { fetchImpl: async () => new Response('unavailable', { status: 503 }) });
    const result = await research.prepare(input);
    assert.equal(result.state, 'blocked'); assert.equal(result.reason, 'no_verified_external_sources');
    assert.equal(research.state.batches[0].errors.length, 2);
    await assert.rejects(research._fetchText('http://localhost/secret'), /allowlist/);
    await assert.rejects(research._fetchText('https://export.arxiv.org@localhost/'), /allowlist/);
});
test('a sourced hypothesis is durable, exact-file scoped and source-hash guarded', async t => {
    const { root, research } = await harness(t);
    const plan = await research.prepare(input);
    assert.equal(plan.state, 'ready'); assert.equal(plan.alternatives.length, 2);
    assert.equal((await research.prepare(input)).id, plan.id);
    const restored = await new SelfEvolutionResearch({ root }).initialize();
    assert.equal((await restored.validatePlan(plan.id)).sourceHash, plan.sourceHash);
    await fs.writeFile(path.join(root, plan.file), 'export const ownerEdit = true;');
    await assert.rejects(restored.validatePlan(plan.id), /source changed/);
});
test('outcomes feed the next hypothesis and identical attempted inputs cannot spin forever', async t => {
    const { root, research, prompts } = await harness(t);
    const plan = await research.prepare(input);
    await research.startPlan(plan.id, 'experiment-1');
    await research.recordOutcome({ id: 'experiment-1', researchPlanId: plan.id, domain: 'research', state: 'rejected', reason: 'candidate dropped source provenance', decision: 'reject' });
    assert.equal((await research.prepare(input)).reason, 'model_repeated_a_failed_approach');
    await fs.writeFile(path.join(root, plan.file), 'export const revisedSource = 2;');
    const second = await research.prepare(input);
    assert.equal(second.state, 'ready'); assert.match(prompts.at(-1), /candidate dropped source provenance/);
    await research.startPlan(second.id, 'experiment-2');
    await assert.rejects(research.startPlan(second.id, 'wrong-experiment'), /already belongs/);
    await fs.writeFile(path.join(root, plan.file), 'export const revisedSource = 3;');
    assert.equal((await research.prepare(input)).reason, 'two_experiments_per_domain_per_day');
});
test('a failed Docker shadow candidate informs the next plan instead of being reused', async t => {
    const { root, research, prompts } = await harness(t);
    const first = await research.prepare(input);
    const directory = path.join(root, 'data/self-evolution/shadow-replays');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'rsi-shadow-test.json'), JSON.stringify({
        receiptId: 'rsi-shadow-test', planId: first.id, state: 'shadow_failed',
        sourceHash: first.sourceHash, suiteFingerprint: first.suiteFingerprint, failureTestCount: 3
    }));
    assert.equal((await research.prepare(input)).reason, 'model_repeated_a_failed_approach');
    assert.match(prompts.at(-1), /Isolated candidate failed 3 fixed tests/);
    research.reason = async prompt => {
        const sourceId = JSON.parse(prompt.split('UNTRUSTED REFERENCE DATA: ')[1].split('\nEND REFERENCE DATA.')[0])[0].id;
        return JSON.stringify({ hypothesis: 'Preserve malformed URL fallbacks separately from typed identifiers.',
            alternatives: ['Use typed exact fallback strings without loss.', 'Keep one display title and risk collisions.'],
            selectedApproach: 'Preserve source type and exact fallback identifier for malformed URLs.',
            file: first.file, sourceIds: [sourceId], falsification: 'Reject if the full fixed suite still has failures.' });
    };
    const second = await research.prepare(input);
    assert.equal(second.state, 'ready');
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.approachFingerprint, first.approachFingerprint);
});
test('invented citations or scope expansion cannot enter the execution contract', async t => {
    const { research } = await harness(t, { reason: async () => JSON.stringify({ hypothesis: 'A valid length hypothesis', alternatives: ['First alternative approach', 'Second alternative approach'],
        selectedApproach: 'Replace unrelated source files', file: 'core/ASIKernel.js', sourceIds: ['made-up'], falsification: 'A sufficiently long falsification' }) });
    assert.equal((await research.prepare(input)).state, 'blocked'); assert.equal(research.state.plans.length, 0);
});
test('research goal retains exact scope, citations and immutable tests through director construction', async t => {
    const { root, research } = await harness(t);
    const plan = await research.prepare(input);
    const director = new SelfEvolutionDirector({ root });
    const goal = director.buildGoal({ ...input.target, score: .3 }, { research: plan, baseline: input.baseline });
    assert.equal(goal.metadata.researchPlanId, plan.id);
    assert.deepEqual(goal.allowedWritePaths.slice(1), [path.join(root, plan.file)]);
    assert.ok(goal.description.includes(plan.id));
    assert.equal(goal.metadata.researchSources[0].url, plan.sources[0].url);
    assert.ok(!goal.description.includes(plan.request));
    const riskGate = Object.create(AutonomousMissionDirector.prototype);
    riskGate.charter = { permittedCategories: ['asi_kernel'] };
    assert.equal(riskGate._riskReason({ ...goal, category: 'asi_kernel' }), null);
    assert.equal(riskGate._riskReason({ ...goal, category: 'asi_kernel', description: 'Change account password and deploy to production' }), 'approval_required_action');
    assert.ok(!goal.allowedWritePaths.includes(path.join(root, 'tests')));
    assert.throws(() => assertRepairArtifactWrite(root, path.join(root, 'data/self-evolution/research/ledger.json')), /evaluation service/);
    assert.doesNotThrow(() => assertRepairArtifactWrite(root, path.join(root, 'data/self-evolution/diagnostics/result.md')));
});
test('an executable failure outranks saturated tests with a low historical score', () => {
    const registry = new CapabilityTrialRegistry();
    const target = registry.weakest({ scores: { research: .8, planning: .5 }, receipts: {
        research: { valid: true, exitCode: 1, failed: 1 }, planning: { valid: true, exitCode: 0, failed: 0 } } });
    assert.equal(target.dimension, 'research');
});
test('execution progresses from real source read to one governed mutation and fixed post-change checks', () => {
    const plan = { id: 'plan-1', file: 'core/ResearchSourcePolicy.js', request: 'Precise sourced request' };
    const goal = { metadata: { selfEvolution: true, researchPlanId: plan.id, benchmarkTests: ['tests/fixed.mjs'], expectedArtifact: 'data/report.md' } };
    const obs = [];
    assert.equal(nextResearchExperimentAction(goal, obs, plan).tool, 'read_file');
    obs.push({ tool: 'read_file', args: { path: plan.file }, result: { content: 'real source' } });
    assert.equal(nextResearchExperimentAction(goal, obs, plan).tool, 'modify_code');
    obs.push({ tool: 'modify_code', args: { filepath: plan.file }, result: { success: false } });
    assert.equal(nextResearchExperimentAction(goal, obs, plan).failed, true);
    obs[1].result.success = true;
    assert.equal(nextResearchExperimentAction(goal, obs, plan).tool, 'run_tests');
    obs.push({ tool: 'run_tests', args: { testFile: 'tests/fixed.mjs' }, result: { passed: true } });
    assert.equal(nextResearchExperimentAction(goal, obs, plan).tool, 'verify_syntax');
    obs.push({ tool: 'verify_syntax', args: { filePath: plan.file }, result: { valid: false } });
    assert.equal(nextResearchExperimentAction(goal, obs, plan).failed, true);
    obs.at(-1).result.valid = true;
    obs.push({ tool: 'read_file', args: { path: plan.file }, result: { content: 'new source' } });
    obs.push({ tool: 'read_file', args: { path: goal.metadata.expectedArtifact }, result: { content: 'diagnosis' } });
    assert.equal(nextResearchExperimentAction(goal, obs, plan).complete, true);
});

async function draftHarness(t, options = {}) {
    const h = await harness(t, options);
    const plan = await h.research.prepare(input);
    await fs.mkdir(path.join(h.root, 'tests'));
    const evaluator = "import test from 'node:test'; test('fixed', () => {});";
    await fs.writeFile(path.join(h.root, 'tests/fixed.mjs'), evaluator);
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    plan.testFiles = ['tests/fixed.mjs'];
    plan.suiteFingerprint = hash(JSON.stringify([['tests/fixed.mjs', hash(evaluator)]]));
    const requests = [];
    const patch = { files: [{ path: plan.file, edits: [{ old: 'example = 1', new: 'example = 2' }] }] };
    const bridge = {
        ensureAvailable: async () => ({ health: { boundedRepairProtocol: 1 } }),
        injectGoal: async (_, opts) => { requests.push(opts); return { id: `job-${requests.length}` }; },
        getGoal: async id => ({ status: 'done', outcome: { state: 'proposal_only', sourceGoalId: requests[Number(id.split('-')[1]) - 1].requestId, patch } }),
    };
    return { ...h, plan, requests, bridge, patch };
}

test('MAX retries receive the rejected patch and real failures, and only passing receipts are cached', async t => {
    const h = await draftHarness(t);
    let attempts = 0, closed = 0;
    const options = { bridge: h.bridge, governance: {}, candidateFactory: async () => {
        attempts++;
        if (attempts === 1) throw Object.assign(new Error('fixed tests failed'), { stdout: 'ReferenceError: missing binding\n at unrelated stack\nReferenceError: missing binding' });
        return { validation: { passed: true }, close: async () => closed++ };
    } };
    assert.deepEqual(await h.research.draft(h.plan.id, options), h.patch);
    assert.equal(h.requests.length, 2); assert.equal(closed, 1);
    assert.match(h.requests[1].description, /REJECTED PATCH.*example = 2/);
    assert.match(h.requests[1].description, /ReferenceError: missing binding/);
    assert.doesNotMatch(h.requests[1].description, /unrelated stack/);
    assert.equal(h.requests[0].readOnly, true);
    assert.equal(h.requests[0].repairContract.files[0].sourceHash, h.plan.sourceHash);
    await h.research.draft(h.plan.id, options); assert.equal(h.requests.length, 2);
});

test('a SOMA prototype is untrusted until isolated execution and leaves MAX approval to the publication pipeline', async t => {
    const h = await draftHarness(t);
    h.plan.candidatePatch = h.patch;
    let validations = 0;
    const result = await h.research.draft(h.plan.id, { bridge: h.bridge, governance: {}, candidateFactory: async (_, patch, contract) => {
        validations++; assert.equal(patch, h.patch);
        assert.deepEqual(contract.testFiles, [...h.plan.testFiles, 'tests/rsi-research-holdout.test.mjs']);
        assert.equal(contract.requiresContainer, true);
        return { validation: { passed: true }, close: async () => {} };
    } });
    assert.equal(result, h.patch); assert.equal(validations, 1); assert.equal(h.requests.length, 0);
    assert.equal(h.plan.draftAttempts[0].origin, 'soma_research');
    assert.equal(h.plan.draftAttempts[0].jobId, undefined); // Never forge a MAX receipt.
    assert.equal(h.plan.outcome, undefined); // Tested prototype is not promoted improvement.
});

test('a failed SOMA prototype gives MAX the failure and consumes one of the same two attempts', async t => {
    const h = await draftHarness(t); h.plan.candidatePatch = h.patch;
    await assert.rejects(h.research.draft(h.plan.id, { bridge: h.bridge, governance: {}, candidateFactory: async () => { throw new Error('prototype invariant failed'); } }), /budget exhausted/);
    assert.equal(h.requests.length, 1); assert.equal(h.plan.draftAttempts.length, 2);
    assert.match(h.requests[0].description, /prototype invariant failed/);
    assert.match(h.requests[0].description, /REJECTED PATCH/);
});

test('failed or absent test receipts exhaust a durable two-candidate budget', async t => {
    const h = await draftHarness(t);
    const options = { bridge: h.bridge, governance: {}, candidateFactory: async () => ({ validation: { passed: false }, close: async () => {} }) };
    await assert.rejects(h.research.draft(h.plan.id, options), /budget exhausted/);
    assert.equal(h.requests.length, 2); assert.equal(h.plan.validatedPatch, undefined);
    const restored = await new SelfEvolutionResearch({ root: h.root }).initialize();
    await assert.rejects(restored.draft(h.plan.id, options), /budget exhausted/);
    assert.equal(h.requests.length, 2);
});

test('queued MAX jobs resume without reinjection and have a durable deadline', async t => {
    const h = await draftHarness(t);
    h.plan.draftAttempts = [{ number: 1, state: 'queued', createdAt: h.research.now() - 121000, jobId: 'existing-job' }];
    h.bridge.getGoal = async () => ({ status: 'running' });
    await assert.rejects(h.research.draft(h.plan.id, { bridge: h.bridge, governance: {}, pollMs: 1 }), /deadline exceeded/);
    assert.equal(h.requests.length, 0); assert.equal(h.plan.draftAttempts[0].state, 'timed_out');
});

test('mismatched MAX receipts cannot reach candidate execution and evaluator edits invalidate cached patches', async t => {
    const h = await draftHarness(t);
    h.bridge.getGoal = async () => ({ status: 'done', outcome: { state: 'proposal_only', sourceGoalId: 'unrelated', patch: h.patch } });
    await assert.rejects(h.research.draft(h.plan.id, { bridge: h.bridge, governance: {}, candidateFactory: () => assert.fail('untrusted patch executed') }), /identity\/state mismatch/);
    h.plan.validatedPatch = h.patch;
    await fs.appendFile(path.join(h.root, 'tests/fixed.mjs'), '// changed evaluator');
    await assert.rejects(h.research.draft(h.plan.id, { bridge: h.bridge, governance: {} }), /evaluator changed/);
});

test('grounded planning keeps real source and evaluator below gateway truncation budget', async t => {
    const { research, prompts } = await harness(t);
    const plan = await research.prepare(input);
    assert.equal(plan.state, 'ready');
    assert.ok(prompts[0].length <= 11500);
    assert.match(prompts[0], /export const example = 1/);
    assert.match(prompts[0], /IMMUTABLE EVALUATOR/);
});

test('a refused experiment binding cannot create an executing director entry', async t => {
    const { root } = await harness(t);
    const director = new SelfEvolutionDirector({ root, system: { selfEvolutionResearch: { startPlan: async () => { throw new Error('stale source'); } } } });
    await assert.rejects(director.openExperiment({ cycleId: 'cycle', goal: { id: 'goal' }, preparation: { target: input.target, research: { id: 'plan', state: 'ready' } } }), /stale source/);
    assert.equal(director.experiments.length, 0);
});

test('structured hypothesis calls retain source, JSON schema, background budget and cancellation', async () => {
    const signal = new AbortController().signal;
    const result = await reasonResearchHypothesis('exact pinned source', { signal, gateway: { complete: async options => {
        assert.equal(options.messages[1].content, 'exact pinned source');
        assert.equal(options.priority, 'background'); assert.equal(options.signal, signal);
        assert.equal(options.reasoningEffort, 'low');
        assert.deepEqual(options.responseFormat, { type: 'json_object' }); assert.equal(options.tools, undefined);
        assert.equal(options.timeoutMs, 60000);
        return { data: { model: 'actual-model', choices: [{ message: { content: '{"deferReason":"measured"}' }, finish_reason: 'stop' }] } };
    } } });
    assert.equal(result.model, 'actual-model'); assert.equal(result.text, '{"deferReason":"measured"}');
});

test('empty reasoning-only output gets one metered non-thinking retry, never an inferred answer', async () => {
    const requests = [];
    const result = await reasonResearchHypothesis('exact evidence', { gateway: { complete: async options => {
        requests.push(options);
        return { data: { choices: [{ message: { content: requests.length === 1 ? '' : '{"deferReason":"insufficient evidence"}' }, finish_reason: requests.length === 1 ? 'length' : 'stop' }] } };
    } } });
    assert.equal(requests.length, 2); assert.equal(requests[1].reasoningEffort, 'none');
    assert.equal(requests[1].priority, 'background'); assert.equal(requests[1].maxTokens, 4096);
    assert.equal(result.attempts.length, 2); assert.match(result.text, /insufficient evidence/);
});
