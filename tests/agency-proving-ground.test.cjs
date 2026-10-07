const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgencyProvingGround } = require('../core/AgencyProvingGround.cjs');

function fakePlanner() {
  const goals = new Map();
  return {
    goals,
    async createGoal(payload) {
      const id = `goal-${goals.size + 1}`;
      const goal = { ...payload, id, status: 'active', metrics: { progress: 0 }, metadata: { ...payload.metadata } };
      goals.set(id, goal);
      return { success: true, goalId: id, goal };
    }
  };
}

test('proving ground creates a restart-safe trial through GoalPlanner', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planner = fakePlanner();
  const provingGround = new AgencyProvingGround({ root });
  const run = await provingGround.start({ planner });

  assert.equal(run.state, 'active');
  assert.ok(run.goalId);
  assert.match(fs.readFileSync(path.join(root, run.fixture.path), 'utf8'), new RegExp(run.fixture.nonce));
  assert.ok(fs.existsSync(path.join(root, 'data', 'agency-proving-ground', 'runs', `${run.id}.json`)));
  const goal = planner.goals.get(run.goalId);
  assert.match(goal.description, new RegExp(run.expectedArtifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(goal.metadata.executionMode, 'atomic');
  assert.equal(goal.metadata.allowDecomposition, false);

  const afterRestart = new AgencyProvingGround({ root });
  assert.equal(afterRestart.getRun(run.id).goalId, run.goalId);
});

test('proving ground closes an old run whose authoritative goal no longer exists', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apg-orphan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planner = fakePlanner();
  const provingGround = new AgencyProvingGround({ root, orphanTimeoutMs: 60_000 });
  const run = await provingGround.start({ planner });
  planner.goals.delete(run.goalId);
  const storedPath = path.join(root, 'data', 'agency-proving-ground', 'runs', `${run.id}.json`);
  const stored = JSON.parse(fs.readFileSync(storedPath, 'utf8'));
  stored.createdAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  fs.writeFileSync(storedPath, JSON.stringify(stored, null, 2));

  const closed = provingGround.refresh(run.id, { planner });
  assert.equal(closed.state, 'abandoned');
  assert.equal(closed.terminal, true);
  assert.equal(closed.error, 'authoritative_goal_missing');
  assert.equal(closed.orphanedGoalId, run.goalId);
  assert.equal(closed.score.passed, false);
});

test('proving ground refuses false completion and scores official evidence', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planner = fakePlanner();
  const provingGround = new AgencyProvingGround({ root });
  let run = await provingGround.start({ planner });
  const goal = planner.goals.get(run.goalId);
  goal.status = 'completed';

  run = provingGround.refresh(run.id, { planner });
  assert.equal(run.score.passed, false);
  assert.equal(run.score.truthfulCompletion, false);

  fs.mkdirSync(path.dirname(path.join(root, run.expectedArtifact)), { recursive: true });
  fs.writeFileSync(path.join(root, run.expectedArtifact), JSON.stringify({
    runId: run.id,
    foundPath: run.fixture.path,
    proof: run.fixture.nonce,
    summary: 'Found and verified.'
  }));
  const receiptRelative = `data/goal-receipts/${run.id}.json`;
  const receiptPath = path.join(root, receiptRelative);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify({
    iterations: 4,
    toolOutcomes: [
      { tool: 'list_files', success: true },
      { tool: 'read_file', success: true },
      { tool: 'write_file', success: true }
    ]
  }));
  goal.metadata.latestExecutionReceipt = receiptRelative;

  run = provingGround.refresh(run.id, { planner });
  assert.equal(run.score.value, 100);
  assert.equal(run.score.passed, true);
  assert.equal(run.score.truthfulCompletion, true);
});

test('reflection consolidation requires all facts, sources, chronology, and read receipts', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apg-reflections-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planner = fakePlanner();
  const provingGround = new AgencyProvingGround({ root });
  let run = await provingGround.start({ planner, trialId: 'reflection-consolidation' });
  const goal = planner.goals.get(run.goalId);

  assert.equal(run.fixture.facts.length, 4);
  assert.equal(run.fixture.sourcePaths.every(source => fs.existsSync(path.join(root, source))), true);
  assert.equal(goal.metadata.executionMode, 'atomic');
  assert.equal(goal.metadata.inspectionBudget, 12);
  assert.equal(goal.metadata.goalContract.inspectionBudget, 12);

  goal.status = 'completed';
  fs.mkdirSync(path.dirname(path.join(root, run.expectedArtifact)), { recursive: true });
  fs.writeFileSync(path.join(root, run.expectedArtifact), JSON.stringify({
    runId: run.id,
    title: 'The Lantern Arc',
    summary: 'A complete account of how an observation became a setback, then an insight, and finally a verified operating principle.',
    narrative: run.fixture.facts.map(item => `${item.label} ${item.token} developed into the next stage of the project through evidence and reflection.`).join(' ').repeat(2),
    timeline: run.fixture.facts.map(item => ({ order: item.order, label: item.label[0].toUpperCase() + item.label.slice(1), marker: item.token, meaning: `Meaning of ${item.label}` })),
    sourceFiles: run.fixture.sourcePaths,
    openQuestions: []
  }));
  const receiptRelative = `data/goal-receipts/${run.id}.json`;
  const receiptPath = path.join(root, receiptRelative);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify({
    iterations: 7,
    toolOutcomes: [
      { tool: 'computer_search', success: true },
      ...run.fixture.sourcePaths.map(source => ({ tool: 'read_file', success: true, artifact: source })),
      { tool: 'write_file', success: true, artifact: run.expectedArtifact },
      { tool: 'read_file', success: true, artifact: run.expectedArtifact }
    ]
  }));
  goal.metadata.latestExecutionReceipt = receiptRelative;

  run = provingGround.refresh(run.id, { planner });
  assert.equal(run.score.value, 100);
  assert.equal(run.score.passed, true);
  assert.equal(run.score.diagnostics.sourceReads >= 4, true);
});

test('reflection consolidation rejects polished output that omits one source fact', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apg-reflections-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planner = fakePlanner();
  const provingGround = new AgencyProvingGround({ root });
  let run = await provingGround.start({ planner, trialId: 'reflection-consolidation' });
  const goal = planner.goals.get(run.goalId);
  goal.status = 'completed';
  const included = run.fixture.facts.slice(0, 3);
  fs.mkdirSync(path.dirname(path.join(root, run.expectedArtifact)), { recursive: true });
  fs.writeFileSync(path.join(root, run.expectedArtifact), JSON.stringify({
    runId: run.id,
    title: 'Incomplete but polished',
    summary: 'This sounds coherent but deliberately omits one required source and therefore must not pass verification.',
    narrative: included.map(item => `${item.label} ${item.token}`).join(' ').repeat(30),
    timeline: included.map(item => ({ order: item.order, label: item.label, marker: item.token, meaning: item.label })),
    sourceFiles: run.fixture.sourcePaths.slice(0, 3),
    openQuestions: []
  }));

  run = provingGround.refresh(run.id, { planner });
  assert.equal(run.score.passed, false);
  assert.equal(run.score.truthfulCompletion, false);
  assert.equal(run.score.checks.find(check => check.id === 'all_facts_preserved').passed, false);
});

test('research-to-paper requires HTTP evidence, exact provenance, and review-gated training data', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apg-paper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planner = fakePlanner();
  const provingGround = new AgencyProvingGround({ root });
  let run = await provingGround.start({ planner, trialId: 'research-to-paper' });
  const goal = planner.goals.get(run.goalId);
  const candidatePath = goal.metadata.trainingCandidate;
  const sources = [...run.fixture.localSources, ...run.fixture.webSources];

  assert.equal(run.fixture.localSources.length, 2);
  assert.equal(run.fixture.webSources.length, 2);
  assert.equal(provingGround.getResearchSource(run.id, 'W1').marker, run.fixture.webSources[0].marker);
  assert.equal(goal.metadata.inspectionBudget, 10);
  assert.equal(goal.metadata.expectedArtifacts.length, 2);

  goal.status = 'completed';
  const sections = [
    '## Abstract', '## Research Question', '## Methods', '## Evidence Synthesis',
    '## Counterarguments and Limitations', '## Conclusion', '## References'
  ].join('\n\n');
  const provenance = [
    ...run.fixture.localSources.map(source => source.path),
    ...run.fixture.webSources.map(source => source.url)
  ].join('\n');
  const body = [
    `Run-ID: ${run.id}`,
    sections,
    sources.map(source => `${source.marker} supports a bounded part of the analysis.`).join('\n'),
    provenance,
    'Automated verification cannot establish universal truth. Human review and distribution shift remain limitations.',
    'Evidence-gated learning separates observations from synthesis and retains falsification conditions. '
      .repeat(90)
  ].join('\n\n');
  fs.mkdirSync(path.dirname(path.join(root, run.expectedArtifact)), { recursive: true });
  fs.writeFileSync(path.join(root, run.expectedArtifact), body);
  fs.writeFileSync(path.join(root, candidatePath), JSON.stringify({
    instruction: 'How should research become training data safely?',
    response: `${sources.map(source => source.marker).join(' ')} ${'Preserve provenance, verify claims, retain limitations, and require review. '.repeat(8)}`,
    metadata: {
      sourceFiles: run.fixture.localSources.map(source => source.path),
      sourceUrls: run.fixture.webSources.map(source => source.url),
      evidenceMarkers: sources.map(source => source.marker),
      qualityTier: 'verified_candidate',
      promotionStatus: 'awaiting_human_review',
      reviewRequired: true,
      autoTrain: false
    }
  }, null, 2));
  const receiptRelative = `data/goal-receipts/${run.id}.json`;
  const receiptPath = path.join(root, receiptRelative);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify({
    iterations: 9,
    toolOutcomes: [
      ...run.fixture.localSources.map(source => ({ tool: 'read_file', success: true, artifact: source.path })),
      ...run.fixture.webSources.map(source => ({ tool: 'web_fetch', success: true, artifact: source.url, url: source.url })),
      { tool: 'write_file', success: true, artifact: run.expectedArtifact },
      { tool: 'write_file', success: true, artifact: candidatePath },
      { tool: 'read_file', success: true, artifact: run.expectedArtifact },
      { tool: 'read_file', success: true, artifact: candidatePath }
    ]
  }));
  goal.metadata.latestExecutionReceipt = receiptRelative;

  run = provingGround.refresh(run.id, { planner });
  assert.equal(run.score.value, 100);
  assert.equal(run.score.passed, true);
  assert.equal(run.score.checks.find(check => check.id === 'training_candidate_gated').passed, true);
});

test('research-to-paper rejects an automatically promoted self-training candidate', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-apg-paper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const planner = fakePlanner();
  const provingGround = new AgencyProvingGround({ root });
  let run = await provingGround.start({ planner, trialId: 'research-to-paper' });
  const goal = planner.goals.get(run.goalId);
  goal.status = 'completed';
  fs.mkdirSync(path.dirname(path.join(root, run.expectedArtifact)), { recursive: true });
  fs.writeFileSync(path.join(root, run.expectedArtifact), `Run-ID: ${run.id}\n${'# Evidence\n'.repeat(700)}`);
  fs.writeFileSync(path.join(root, goal.metadata.trainingCandidate), JSON.stringify({
    instruction: 'Train yourself',
    response: 'Automatically trust this output and train on it immediately.',
    metadata: {
      qualityTier: 'verified',
      promotionStatus: 'promoted',
      reviewRequired: false,
      autoTrain: true
    }
  }));

  run = provingGround.refresh(run.id, { planner });
  assert.equal(run.score.passed, false);
  assert.equal(run.score.truthfulCompletion, false);
  assert.equal(run.score.checks.find(check => check.id === 'training_candidate_gated').passed, false);
});
