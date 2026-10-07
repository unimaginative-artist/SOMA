import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TrainingCandidatePromoter } from '../core/TrainingCandidatePromoter.js';
import { TrainingDataExporter } from '../arbiters/TrainingDataExporter.js';
import { OllamaAutoTrainer } from '../core/OllamaAutoTrainer.js';

async function fixture(root, name, { highRisk = false, goalId = `goal-${name}` } = {}) {
  const source = `sources/${name}.md`;
  const receipt = `receipts/${name}.json`;
  const markers = [`LOCAL-${name}-A`, `WEB-${name}-B`, `WEB-${name}-C`];
  await fs.mkdir(path.join(root, 'sources'), { recursive: true });
  await fs.mkdir(path.join(root, 'receipts'), { recursive: true });
  await fs.mkdir(path.join(root, 'candidates'), { recursive: true });
  await fs.writeFile(path.join(root, source), `Evidence ${markers[0]}`, 'utf8');
  await fs.writeFile(path.join(root, receipt), JSON.stringify({
    goalId,
    done: true,
    stopReason: 'poseidon_verified'
  }), 'utf8');
  const candidate = {
    instruction: highRisk
      ? 'Choose a live crypto trading order and guarantee a profitable outcome.'
      : 'Explain a provenance-preserving method for maintaining software documentation.',
    response: `${markers.join(' ')} Use versioned source records, explicit evidence links, regression checks, and reversible updates. Distinguish direct observations from synthesis and retain the precise reason for every accepted change. This produces an auditable learning example without treating fluent text as proof or allowing unsupported material to silently enter future datasets.`,
    metadata: {
      goalId,
      source: 'verified_research_candidate',
      sourceFiles: [source],
      sourceUrls: [`https://example.com/${name}`, `https://example.org/${name}`],
      evidenceMarkers: markers,
      qualityTier: 'verified_candidate',
      promotionStatus: 'awaiting_automatic_review',
      reviewRequired: true,
      autoTrain: false,
      verification: { passed: true, score: 100, receiptPath: receipt }
    }
  };
  const candidatePath = path.join(root, 'candidates', `training-candidate-${name}.json`);
  await fs.writeFile(candidatePath, JSON.stringify(candidate, null, 2), 'utf8');
  return { candidate, candidatePath };
}

test('low-risk candidate is automatically promoted from durable verified evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-promoter-'));
  const promoter = new TrainingCandidatePromoter({ root, candidateRoots: ['candidates'], intervalMs: 60_000 });
  try {
    await fixture(root, 'safe');
    await promoter.initialize();
    promoter.stop();
    const result = await promoter.runCycle();
    assert.equal(result.reviewed, 1);
    assert.equal(result.results[0].review.approved, true);
    assert.equal(result.results[0].review.decision, 'auto_approved');
    const approved = await promoter.getApprovedExamples();
    assert.equal(approved.length, 1);
    assert.equal(approved[0].metadata.qualityTier, 'training_approved');
    assert.equal(approved[0].metadata.promotionStatus, 'auto_approved');
    assert.equal(approved[0].metadata.autoTrain, true);
    assert.equal(approved[0].metadata.reviewRequired, false);
    const decisions = await promoter.getRecentDecisions();
    assert.match(decisions[0].hash, /^[a-f0-9]{64}$/);
  } finally {
    promoter.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('high-risk trading candidate is quarantined without blocking safe promotion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-promoter-risk-'));
  const promoter = new TrainingCandidatePromoter({ root, candidateRoots: ['candidates'] });
  try {
    await fixture(root, 'risky', { highRisk: true });
    await promoter.initialize();
    promoter.stop();
    const result = await promoter.runCycle();
    assert.equal(result.results[0].review.approved, false);
    assert.equal(result.results[0].review.decision, 'quarantined');
    assert.ok(result.results[0].review.highRiskDomains.includes('trading'));
    assert.equal((await promoter.getApprovedExamples()).length, 0);
  } finally {
    promoter.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('unverified metadata and proving-ground fixtures cannot self-authorize training', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-promoter-proof-'));
  const promoter = new TrainingCandidatePromoter({ root, candidateRoots: ['candidates'] });
  try {
    const { candidate } = await fixture(root, 'fixture');
    const review = promoter.reviewCandidate(candidate, {
      path: path.join(root, 'data', 'agency-proving-ground', 'training-candidate.json')
    });
    assert.equal(review.approved, false);
    assert.ok(review.reasons.includes('test_fixture_excluded'));

    candidate.metadata.verification.receiptPath = 'receipts/missing.json';
    const durable = await promoter._verifyDurableEvidence(candidate, promoter.reviewCandidate(candidate, { path: 'candidates/real.json' }));
    assert.equal(durable.approved, false);
    assert.ok(durable.reasons.includes('verification_receipt_unreadable'));
  } finally {
    promoter.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('training exporter includes only auto-approved candidate rows', async () => {
  const exporter = new TrainingDataExporter({ outputDir: path.join(os.tmpdir(), `soma-export-${Date.now()}`) });
  const safe = {
    instruction: 'Explain a verified engineering pattern.',
    response: 'Use a concrete artifact, run its relevant tests, retain provenance, record failed checks, and keep every deployment reversible so later evidence can correct the learned behavior.',
    metadata: { source: 'candidate_promoter', qualityTier: 'training_approved', promotionStatus: 'auto_approved' }
  };
  const blocked = {
    instruction: 'Unverified example', response: 'This row should never be included in the resulting dataset because its promotion status has not passed the automatic authority.',
    metadata: { source: 'candidate_promoter', qualityTier: 'verified_candidate', promotionStatus: 'awaiting_human_review' }
  };
  const dataset = await exporter.mergeIntoTrainingFormat({ approvedCandidates: { examples: [safe, blocked] } });
  assert.equal(dataset.length, 1);
  assert.equal(dataset[0].metadata.qualityTier, 'training_approved');
});

test('approved candidate batches can trigger unattended training without new conversations', async () => {
  const trainer = new OllamaAutoTrainer({ conversationThreshold: 100, candidateThreshold: 5 });
  trainer.conversationHistory = { getStats: () => ({ totalMessages: 10 }) };
  trainer.trainingCandidatePromoter = {
    getApprovedExamples: async () => Array.from({ length: 5 }, (_, index) => ({ instruction: `i${index}`, response: `r${index}` }))
  };
  trainer.lastConversationCount = 10;
  trainer.lastApprovedCandidateCount = 0;
  trainer.lastTrainingTime = 0;
  let trained = 0;
  trainer.autoTrain = async () => { trained++; return { success: true }; };
  await trainer.checkAndTrain();
  assert.equal(trained, 1);
});
