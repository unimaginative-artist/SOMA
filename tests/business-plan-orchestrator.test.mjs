import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BusinessPlanOrchestrator } from '../server/business-planning/BusinessPlanOrchestrator.js';

const profile = {
  businessName: 'Northstar',
  concept: 'Planning software for small contractors',
  customer: 'Independent trade contractors',
  problem: 'Quoting and scheduling are fragmented',
  solution: 'A focused operational workspace',
  revenueModel: 'Monthly subscription',
  stage: 'validation',
  geography: 'United States',
  founderAdvantages: 'Industry experience',
  goals: 'Twenty paying customers',
  constraints: 'Bootstrapped',
};

async function waitForTerminal(orchestrator, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await orchestrator.get(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('business plan job did not finish');
}

async function waitForRevision(orchestrator, jobId, revisionId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await orchestrator.getRevision(jobId, revisionId);
    if (['proposed', 'answered', 'failed'].includes(result.revision.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('business plan revision did not finish');
}

test('business plan orchestrator fans out specialists, red-teams, synthesizes, and persists', async () => {
  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-business-plan-'));
  let calls = 0;
  const brain = {
    async reason(prompt) {
      calls += 1;
      if (/business-model calibration council/.test(prompt)) return { text:JSON.stringify({ summary:'Use the linked market source and retain unverified pricing as assumptions.', marketAssumptions:{ totalPotentialCustomers:10000, annualSpendPerCustomer:1200, serviceableGeographyPct:50, targetSegmentPct:20, year3ObtainableSharePct:2, annualMarketGrowthPct:4, sourceRefs:{ totalPotentialCustomers:['S1'], annualSpendPerCustomer:['S1'], annualMarketGrowthPct:['S1'] } }, pricingTiers:[{ id:'core', name:'Core', price:120, materialCost:15, laborCost:10, fulfillmentCost:5, commissionPct:5, warrantyReservePct:2, monthlyVolume:25 }], unresolved:['Validate willingness to pay with customer commitments.'] }) };
      if (/managing partner/.test(prompt)) return { text: '# Northstar\n\n## Executive Summary\nA grounded final plan.' };
      return { text: `memo-${calls}` };
    },
  };
  const personas = new Map([
    ['startup-analyst', { content: 'You are a startup analyst.', lobe: 'PROMETHEUS' }],
    ['business-analyst', { content: 'You are a business analyst.', lobe: 'PROMETHEUS' }],
    ['legal-advisor', { content: 'You are a legal risk analyst.', lobe: 'THALAMUS' }],
  ]);
  const system = {
    brain,
    identityArbiter: { personas },
    devilsAdvocate: { name: 'Devil’s Advocate', async challenge() { return { frictionScore: 0.7, critique: 'Test demand.' }; } },
    crona: { async reason() { return { ok: true, text: '# Northstar\n\n## Executive Summary\nCouncil synthesis.' }; } },
  };
  const researchService = {
    isConfigured: () => true,
    async searchWeb(query) { return { success: true, results: [{ title: 'Source', url: 'https://example.com', content: query }] }; },
  };
  const exportService = { async export(job, format, ownerId) { return { buffer:Buffer.from('export'), filename:`${job.id}.${format}`, mimeType:'application/octet-stream', ownerId }; } };
  const orchestrator = new BusinessPlanOrchestrator(system, { jobDir, researchService, exportService });
  const created = await orchestrator.create(profile, { sessionId: 'test-session' });
  assert.equal(created.status, 'queued');

  const completed = await waitForTerminal(orchestrator, created.id);
  assert.equal(completed.status, 'completed', completed.error);
  assert.equal(completed.progress, 100);
  assert.match(completed.plan, /^# Northstar/);
  assert.ok(completed.stages.every(stage => stage.status === 'completed'));
  assert.ok(completed.participants.some(person => person.role === 'adversarial reviewer'));
  assert.ok(completed.participants.some(person => person.role === 'causal synthesis'));
  assert.equal(completed.evidence.sources.length, 1, 'duplicate source URLs are consolidated into one ledger entry');
  assert.equal(completed.evidence.sources[0].id, 'S1');
  assert.ok(completed.financialModel.scenarios.base.monthly.length === 36);
  assert.equal(completed.marketModel.tam, 0, 'unknown market size must start at zero instead of looking researched');
  assert.equal(completed.pricingModel.tiers[0].price, completed.financialModel.assumptions.monthlyPrice);
  assert.equal(completed.sensitivityAnalysis.cells.length, 9);
  assert.ok(completed.operatingWorkspace.experiments.length >= 3);
  assert.ok(calls >= 8, `expected a multi-pass workflow, received ${calls} calls`);

  const preview = await orchestrator.previewBusinessModel(created.id, { marketAssumptions:{ totalPotentialCustomers:2000, annualSpendPerCustomer:500 } });
  assert.equal(preview.marketModel.tam, 1000000);
  assert.equal((await orchestrator.get(created.id)).marketModel.tam, 0, 'live preview must not persist model changes');
  const recalculated = await orchestrator.recalculateBusinessModel(created.id, { marketAssumptions:{ totalPotentialCustomers:5000, annualSpendPerCustomer:1000, sourceRefs:{ totalPotentialCustomers:['S1'], annualSpendPerCustomer:['S1'], annualMarketGrowthPct:[] } } });
  assert.equal(recalculated.marketModel.tam, 5000000);
  assert.equal(recalculated.modelVersions.length, 1);
  const calibration = await orchestrator.proposeBusinessModelRecalibration(created.id, 'Use the evidence ledger.');
  assert.equal(calibration.proposal.status, 'proposed');
  assert.equal(calibration.job.marketModel.tam, 5000000, 'proposal must not mutate the approved model');
  const appliedModel = await orchestrator.applyBusinessModelProposal(created.id, calibration.proposal.id);
  assert.equal(appliedModel.marketModel.tam, 12000000);
  assert.equal(appliedModel.modelProposal, null);
  const handoff = await orchestrator.prepareArbiteriumHandoff(created.id);
  assert.equal(handoff.workflow.steps.length, 6);
  assert.equal(handoff.job.arbiteriumHandoffs.length, 1);
  const exported = await orchestrator.exportBusinessPlan(created.id, 'xlsx');
  assert.equal(exported.filename, `${created.id}.xlsx`);

  const stored = JSON.parse(await fs.readFile(path.join(jobDir, `${created.id}.json`), 'utf8'));
  assert.equal(stored.status, 'completed');

  const startedRevision = await orchestrator.createRevision(created.id, 'Make pricing more conservative and lower the startup budget.');
  assert.deepEqual(startedRevision.revision.selectedSpecialists, ['Product & Customer', 'Go-to-Market', 'Financial Modeling']);
  const proposed = await waitForRevision(orchestrator, created.id, startedRevision.revision.id);
  assert.equal(proposed.revision.status, 'proposed', proposed.revision.error);
  assert.ok(proposed.revision.changedSections.includes('Financial Framework'));
  assert.ok(proposed.revision.revisedPlan);
  const applied = await orchestrator.applyRevision(created.id, proposed.revision.id);
  assert.equal(applied.revision.status, 'applied');
  assert.equal(applied.job.collaboration.versions.length, 1);
  assert.match(applied.job.collaboration.messages.at(-1).content, /previous plan is preserved as version 1/i);

  const exploratory = await orchestrator.createRevision(created.id, 'What would it look like if we had $5k starting capital over three years?');
  assert.equal(exploratory.revision.kind, 'exploration');
  assert.ok(exploratory.revision.selectedSpecialists.includes('Financial Modeling'));
  const answered = await waitForRevision(orchestrator, created.id, exploratory.revision.id);
  assert.equal(answered.revision.status, 'answered', answered.revision.error);
  assert.ok(answered.revision.answer);
  assert.equal(answered.job.collaboration.versions.length, 1, 'brainstorming must not create a plan version');
  assert.equal(answered.job.plan, applied.job.plan, 'brainstorming must leave the approved plan untouched');

  const scenario = await orchestrator.createScenario(created.id, { name:'Five-thousand-dollar branch', assumptions:{ startingCapital:5000 } });
  assert.equal(scenario.assumptions.startingCapital, 5000);
  assert.equal(scenario.financialModel.scenarios.base.annual.length, 3);
  const versions = await orchestrator.listVersions(created.id);
  assert.equal(versions.versions.length, 1);
  const diff = await orchestrator.diffVersion(created.id, 1);
  assert.ok(Number.isInteger(diff.addedCount));
  await assert.rejects(() => orchestrator.get(created.id, 'different-owner'), /Business plan job not found/);
  await fs.rm(jobDir, { recursive: true, force: true });
});

test('business plan orchestrator rejects an incomplete founder brief', async () => {
  const orchestrator = new BusinessPlanOrchestrator({ brain: { reason: async () => ({ text: 'x' }) } }, {
    jobDir: path.join(os.tmpdir(), 'soma-business-plan-unused'),
    researchService: { isConfigured: () => false },
  });
  await assert.rejects(() => orchestrator.create({ concept: 'x' }), /Missing required business brief fields/);
});

test('collaboration intent separates hypothetical questions from revision commands', () => {
  const orchestrator = new BusinessPlanOrchestrator({ brain: { reason: async () => ({ text: 'x' }) } }, { researchService: { isConfigured: () => false } });
  assert.equal(orchestrator._classifyCollaborationIntent('What would it look like with $5k?'), 'exploration');
  assert.equal(orchestrator._classifyCollaborationIntent('Could we model this over three years?'), 'exploration');
  assert.equal(orchestrator._classifyCollaborationIntent('Lower the startup budget to $5k'), 'revision');
  assert.equal(orchestrator._classifyCollaborationIntent('Please revise the financial model'), 'revision');
});

test('a persisted in-progress build resumes from completed checkpoints after restart', async () => {
  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-business-plan-resume-'));
  const prompts = [];
  const system = { brain:{ async reason(prompt) { prompts.push(prompt); return { text:/managing partner/.test(prompt) ? '# Resumed plan' : 'resumed memo' }; } } };
  const first = new BusinessPlanOrchestrator(system, { jobDir, researchService:{ isConfigured:() => false } });
  const cleanProfile = { ...profile, financialAssumptions:{} };
  const stored = first._newJob(cleanProfile, { ownerId:'resume-owner' });
  stored.status = 'running'; stored.startedAt = Date.now() - 1000; stored.progress = 8;
  stored.stages[0] = { ...stored.stages[0], status:'completed', startedAt:Date.now() - 1000, finishedAt:Date.now() - 900 };
  stored.artifacts.brief = 'checkpointed brief';
  await first._persist(stored);

  const restarted = new BusinessPlanOrchestrator(system, { jobDir, researchService:{ isConfigured:() => false } });
  const loaded = await restarted.get(stored.id, 'resume-owner');
  assert.ok(['queued', 'running'].includes(loaded.status));
  let completed;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    completed = await restarted.get(stored.id, 'resume-owner');
    if (completed.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(completed.status, 'completed', completed.error);
  assert.ok(!prompts.some(prompt => /Act as the lead startup strategist/.test(prompt)), 'completed brief stage should not run twice');
  await fs.rm(jobDir, { recursive:true, force:true });
});

test('cancellation aborts an active reasoning call and marks the durable job cancelled', async () => {
  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-business-plan-cancel-'));
  const brain = { reason(prompt, options) { return new Promise((resolve, reject) => { const timer = setTimeout(() => resolve({ text:'late result' }), 500); options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once:true }); }); } };
  const orchestrator = new BusinessPlanOrchestrator({ brain }, { jobDir, researchService:{ isConfigured:() => false } });
  const created = await orchestrator.create(profile);
  for (let attempt = 0; attempt < 30 && !orchestrator.controllers.has(created.id); attempt += 1) await new Promise(resolve => setTimeout(resolve, 5));
  await orchestrator.cancel(created.id);
  const cancelled = await waitForTerminal(orchestrator, created.id);
  assert.equal(cancelled.status, 'cancelled');
  await fs.rm(jobDir, { recursive:true, force:true });
});
