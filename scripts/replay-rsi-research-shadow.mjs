import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { SelfRepairCandidate } from '../core/SelfRepairCandidate.js';
import { SelfModificationGovernance } from '../core/SelfModificationGovernance.js';
import { IsolatedCandidateRunner } from '../core/IsolatedCandidateRunner.js';
import { CAPABILITY_TRIALS } from '../core/CapabilityTrialRegistry.js';

const root = process.cwd();
const planId = process.argv[2];
if (!planId) throw new Error('Pass the existing research plan ID');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ledger = JSON.parse(await fs.readFile(path.join(root, 'data/self-evolution/research/ledger.json')));
const plan = ledger.plans.find(item => item.id === planId && item.state === 'ready');
if (!plan || plan.domain !== 'research' || !plan.candidatePatch?.files?.length) throw new Error('No eligible pinned research candidate');
if (plan.candidatePatch.files.length !== 1 || plan.candidatePatch.files[0].path !== plan.file) throw new Error('Candidate exceeds the pinned source scope');
const sourcePath = path.join(root, plan.file);
const originalHash = digest(await fs.readFile(sourcePath));
if (originalHash !== plan.sourceHash) throw new Error('Pinned source hash changed');
const registeredTests = [...CAPABILITY_TRIALS.research.tests, ...(CAPABILITY_TRIALS.research.holdoutTests || [])];
if (!plan.testFiles?.length || !plan.testFiles.every(file => registeredTests.includes(file))) throw new Error('Research evaluator outside registered suite');
const fingerprintFor = async files => digest(JSON.stringify(await Promise.all(files.map(async file =>
  [file, digest(await fs.readFile(path.join(root, file)))]))));
const testFiles = await fingerprintFor(plan.testFiles) === plan.suiteFingerprint ? plan.testFiles : registeredTests;
if (await fingerprintFor(testFiles) !== plan.suiteFingerprint) throw new Error('Fixed evaluator fingerprint changed');
const runner = new IsolatedCandidateRunner({ root });
if (!await runner.dockerAvailable()) throw new Error('Docker engine is unavailable');

const receipt = { receiptId: `rsi-shadow-${crypto.randomUUID()}`, state: 'shadow_failed',
  planId, source: plan.file, sourceHash: plan.sourceHash, suiteFingerprint: plan.suiteFingerprint,
  testFiles, createdAt: new Date().toISOString(), published: false, tradingStateChanged: false };
let candidate;
try {
  let baseline;
  try {
    const passed = await runner.run({ worktree: root, files: [], contract: { requiresContainer: true, testFiles } });
    baseline = { passed: true, mode: passed.mode, checks: passed.checks };
  } catch (error) {
    baseline = { passed: false, mode: 'container', output: String(error.stdout || '').slice(-12000),
      error: String(error.stderr || error.message).slice(-3000) };
    if (!/not ok\s+\d+/i.test(baseline.output)) throw new Error(`Baseline infrastructure failed: ${baseline.error}`);
  }
  receipt.baseline = baseline;
  const governance = new SelfModificationGovernance({ root, system: {} });
  candidate = await SelfRepairCandidate.create(governance, plan.candidatePatch,
    { testFiles, risk: 'medium', requiresContainer: true });
  if (digest(await fs.readFile(sourcePath)) !== originalHash) throw new Error('Owner source changed during shadow replay');
  const validation = candidate.validation;
  const containerCheck = validation?.checks?.find(check => check.isolation === 'container' && check.passed === true);
  if (!baseline.passed && validation?.passed === true && validation.mode === 'container'
      && validation.networkIsolated === true && containerCheck && candidate.hashes[plan.file] !== originalHash) {
    receipt.state = 'shadow_validated';
    receipt.candidateHash = candidate.hashes[plan.file];
    receipt.validation = validation;
    receipt.comparison = { baselinePassed: false, candidatePassed: true,
      baselineFailedTests: (baseline.output.match(/not ok\s+\d+/gi) || []).length,
      candidateFailedTests: 0, sourceChangedInOwner: false };
  } else throw new Error('Candidate did not pass the isolated comparison');
} catch (error) {
  receipt.error = String(error.message || error);
  if (error.stdout || error.stderr) {
    receipt.failureOutput = String(error.stdout || '').slice(-12000);
    receipt.failureStderr = String(error.stderr || '').slice(-3000);
    receipt.failureTestCount = (receipt.failureOutput.match(/not ok\s+\d+/gi) || []).length;
  }
} finally {
  await candidate?.close();
  const directory = path.join(root, 'data/self-evolution/shadow-replays');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${receipt.receiptId}.json`);
  await fs.writeFile(target, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ receiptId: receipt.receiptId, path: path.relative(root, target),
    state: receipt.state, comparison: receipt.comparison || null, failureTestCount: receipt.failureTestCount || 0,
    error: receipt.error || null }, null, 2));
  if (receipt.state !== 'shadow_validated') process.exitCode = 1;
}
