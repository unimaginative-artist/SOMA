'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkGovernor } = require('../core/WorkGovernor.cjs');
const { AutonomousMissionDirector, classifyDeliverable, themeKey, assessMissionValue } = require('../core/AutonomousMissionDirector.cjs');
const { STATUS } = require('../core/GoalLifecycle.cjs');

function harness() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-mission-director-'));
  const governor = new WorkGovernor({ dataDir });
  const planner = {
    goals: new Map(),
    activeGoals: new Set(),
    workGovernor: governor,
    isTradingGoal: () => false,
    async createGoal(goalData) {
      const id = `goal-${this.goals.size + 1}`;
      const goal = {
        ...goalData,
        id,
        status: STATUS.PENDING,
        metadata: { ...(goalData.metadata || {}), goalContract: {
          version: 2,
          kind: 'goal',
          strict: true,
          allowedTools: goalData.allowedTools,
          allowedWritePaths: goalData.allowedWritePaths,
          expectedArtifacts: goalData.expectedArtifacts,
          maxSteps: goalData.maxSteps
        } }
      };
      this.goals.set(id, goal);
      this.activeGoals.add(id);
      return { success: true, goal };
    }
  };
  const director = new AutonomousMissionDirector({ planner, governor, dataDir, logger: { info() {} } });
  director.initialize();
  return { dataDir, governor, planner, director };
}

test('mission director promotes the highest-value bounded proposal with a strict contract', async () => {
  const h = harness();
  h.governor.submitProposal({
    title: 'Publish an autonomous Bluesky reply',
    category: 'social',
    priority: 100,
    description: 'Post a reply to another account without review.'
  }, 'proactive_council');
  const safe = h.governor.submitProposal({
    title: 'Diagnose tool recovery failures',
    category: 'engineering',
    priority: 82,
    description: 'Inspect recent tool failure receipts, compare failure categories, run the relevant tests, and produce an evidence-backed diagnostic report.'
  }, 'proactive_council');

  const result = await h.director.ensureMission();
  assert.equal(result.promoted, true);
  assert.equal(result.proposalId, safe.proposalId);
  const goal = h.planner.goals.get(result.goalId);
  assert.equal(goal.metadata.autonomousMission, true);
  assert.equal(goal.metadata.admissionApproved, true);
  assert.equal(goal.strictContract, true);
  assert.equal(goal.maxAttempts, 12);
  assert.equal(goal.metadata.maxAttempts, 12);
  assert.ok(goal.allowedTools.includes('read_file'));
  assert.ok(goal.allowedTools.includes('spawn_agents'));
  assert.ok(goal.allowedWritePaths.length > 1);
  assert.equal(goal.metadata.deliverableKind, 'code_change');
  assert.equal(goal.metadata.requiresCodeChange, true);
  assert.equal(goal.verification.profile, 'code');
  assert.ok(goal.verification.evidenceRequired.includes('tests'));
  assert.ok(goal.allowedTools.includes('modify_code'));
  assert.ok(goal.expectedArtifacts[0].endsWith('result.md'));
  assert.equal(h.governor.getProposal(safe.proposalId).status, 'promoted');
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('mission director keeps exactly one non-trading autonomous execution slot', async () => {
  const h = harness();
  h.planner.goals.set('existing', {
    id: 'existing',
    title: 'Existing autonomous work',
    category: 'research',
    status: STATUS.ACTIVE,
    metadata: { source: 'autonomous' }
  });
  h.governor.submitProposal({
    title: 'Measure memory retrieval quality',
    category: 'research',
    priority: 90,
    description: 'Run a repeatable retrieval benchmark and write a report containing measurements and verification evidence.'
  }, 'proactive_council');
  const result = await h.director.ensureMission();
  assert.equal(result.promoted, false);
  assert.equal(result.reason, 'autonomous_execution_slot_occupied');
  assert.equal(h.planner.goals.size, 1);
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('admission preserves the exact quality failure and duplicate identity', async () => {
  const h = harness();
  try {
    h.planner.createGoal = async () => ({ success: false, error: 'Goal failed quality gate', quality: {
      approved: false, issues: ['Likely duplicate of active goal "Existing repair"'], warnings: [], duplicateGoalId: 'existing-repair'
    } });
    const submitted = h.governor.submitProposal({ title: 'Diagnose tool recovery failures', category: 'engineering', priority: 82,
      description: 'Inspect recent tool failure receipts, compare failure categories, run focused tests, and produce a verified diagnostic artifact.' }, 'autonomous');
    const result = await h.director.ensureMission({ proposalId: submitted.proposalId });
    assert.equal(result.promoted, false);
    assert.equal(result.qualityFailure.duplicateGoalId, 'existing-repair');
    const receipt = h.governor.getProposal(submitted.proposalId);
    assert.equal(receipt.status, 'rejected');
    assert.deepEqual(receipt.metadata.lastPromotionQuality, result.qualityFailure);
    assert.match(receipt.metadata.lastPromotionQuality.issues[0], /Existing repair/);
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('completion audit recognizes the actual verifier code-change proof but rejects empty or failed proofs', () => {
  const h = harness();
  try {
    for (const [id, proof] of [['real', { passed: true, receiptIds: ['governed-receipt'] }],
      ['empty', { passed: true, receiptIds: [] }], ['failed', { passed: false, receiptIds: ['failed-receipt'] }]]) {
      h.planner.goals.set(id, { id, title: 'Implement a bounded code repair', category: 'engineering', status: STATUS.COMPLETED,
        metadata: { autonomousMission: true, lastVerification: { passed: true, checks: [
          { type: 'code_change_proof', ...proof }, { type: 'executable_proof', passed: true }
        ] } } });
    }
    const result = h.director._auditCompletionTruth();
    assert.equal(result.reclassified, 2);
    assert.equal(h.planner.goals.get('real').status, STATUS.COMPLETED);
    assert.equal(h.planner.goals.get('real').metadata.completionClassification, 'implemented');
    assert.equal(h.planner.goals.get('empty').status, STATUS.VERIFICATION_FAILED);
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('an unindexed pending row cannot reserve the mission slot or be silently approved', async () => {
  const h = harness();
  const orphan = { id: 'orphan', title: 'Old unadmitted audit', category: 'optimization', status: STATUS.PENDING, metrics: { progress: 10 }, metadata: { source: 'system_validator' } };
  h.planner.goals.set(orphan.id, orphan);
  const proposal = h.governor.submitProposal({ title: 'Diagnose tool recovery failures', category: 'engineering', priority: 82,
    description: 'Inspect recent tool failure receipts, compare failure categories, run focused tests, and produce a verified diagnostic artifact.' }, 'proactive_council');
  const result = await h.director.ensureMission({ proposalId: proposal.proposalId });
  assert.equal(result.promoted, true);
  assert.equal(orphan.status, STATUS.PENDING);
  assert.equal(h.planner.activeGoals.has(orphan.id), false);
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('a changed self-evolution execution protocol gets one new trial, not infinite retries', () => {
  const h = harness();
  const old = { id: 'failed-old', title: 'Self-evolution improve research-to-paper', status: STATUS.FAILED,
    createdAt: Date.now(), metadata: { selfEvolution: true } };
  h.planner.goals.set(old.id, old);
  const candidate = { title: old.title, metadata: { selfEvolution: true, executionProtocolVersion: 2 } };
  assert.equal(h.director._resemblesTerminalFailure(candidate), null);
  assert.equal(h.director._recentThemeOutcome(candidate), null);
  old.metadata.executionProtocolVersion = 2;
  assert.equal(h.director._resemblesTerminalFailure(candidate).id, old.id);
  assert.equal(h.director._recentThemeOutcome(candidate).goal.id, old.id);
  old.status = STATUS.COMPLETED;
  assert.equal(h.director._resemblesTerminalFailure(candidate), null);
  assert.equal(h.director._recentThemeOutcome(candidate).goal.id, old.id);
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('a new pinned research approach can retry an execution-only failure once per daily budget', () => {
  const h = harness();
  try {
    const goal = { id: 'contract-failure', title: 'Self-evolution improve research-to-paper',
      status: STATUS.BLOCKED, createdAt: Date.now(), metadata: {
        selfEvolution: true, diagnosticOnly: false, capabilityDomain: 'research',
        executionProtocolVersion: 9, researchPlanId: 'old-plan', researchInputFingerprint: 'old-input',
        latestExecutionReceipt: path.join(h.dataDir, 'old-receipt.json')
      } };
    h.planner.goals.set(goal.id, goal);
    fs.writeFileSync(goal.metadata.latestExecutionReceipt, JSON.stringify({ goalId: goal.id,
      lifecycleState: goal.status, result: 'Hash-pinned research plan unavailable: Research evaluator changed since baseline' }));
    const sha = char => char.repeat(64);
    const oldPlan = { id: 'old-plan', state: 'ready', domain: 'research', file: 'core/ResearchSourcePolicy.js',
      inputFingerprint: 'old-input', sourceHash: sha('a'), suiteFingerprint: sha('b'), approachFingerprint: sha('c') };
    const newPlan = { ...oldPlan, id: 'new-plan', inputFingerprint: 'new-input', approachFingerprint: sha('d') };
    const ledgerPath = path.join(h.dataDir, 'self-evolution', 'research', 'ledger.json');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    const savePlans = () => fs.writeFileSync(ledgerPath, JSON.stringify({ plans: [oldPlan, newPlan] }));
    savePlans();
    const proposal = { title: goal.title, metadata: { selfEvolution: true, diagnosticOnly: false,
      capabilityDomain: 'research', executionProtocolVersion: 9, researchPlanId: 'new-plan',
      researchInputFingerprint: 'new-input' } };
    h.planner.goals.set('generic-recovery', { id: 'generic-recovery', title: `Recovery: ${goal.title}`,
      status: STATUS.BLOCKED, createdAt: Date.now(), metadata: { recoveryOfGoalId: goal.id } });
    assert.equal(h.director._resemblesTerminalFailure(proposal), null);
    assert.equal(h.director._recentThemeOutcome(proposal), null);
    newPlan.approachFingerprint = oldPlan.approachFingerprint;
    savePlans();
    assert.equal(h.director._resemblesTerminalFailure(proposal)?.id, goal.id, 'same approach stays blocked');
    newPlan.approachFingerprint = sha('d');
    newPlan.suiteFingerprint = sha('e');
    savePlans();
    assert.equal(h.director._resemblesTerminalFailure(proposal)?.id, goal.id, 'changed evaluator stays blocked');
    newPlan.suiteFingerprint = sha('b');
    savePlans();
    h.planner.goals.set('second-trial', { ...goal, id: 'second-trial', metadata: { ...goal.metadata, researchPlanId: 'other-plan' } });
    assert.equal(h.director._resemblesTerminalFailure(proposal)?.id, goal.id, 'third daily trial stays blocked');
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('a started research plan retries only after a recorded failed experiment with a different pinned approach', () => {
  const h = harness();
  try {
    const sha = char => char.repeat(64);
    const goal = { id: 'failed-experiment', title: 'Self-evolution improve research-to-paper',
      status: STATUS.BLOCKED, createdAt: Date.now(), metadata: {
        selfEvolution: true, diagnosticOnly: false, capabilityDomain: 'research',
        executionProtocolVersion: 9, researchPlanId: 'old-plan', researchInputFingerprint: 'old-input',
        latestExecutionReceipt: path.join(h.dataDir, 'failed-receipt.json')
      } };
    h.planner.goals.set(goal.id, goal);
    fs.writeFileSync(goal.metadata.latestExecutionReceipt, JSON.stringify({ goalId: goal.id,
      lifecycleState: goal.status, stopReason: 'max_attempts_reached' }));
    const oldPlan = { id: 'old-plan', state: 'ready', startedAt: new Date().toISOString(),
      domain: 'research', file: 'core/ResearchSourcePolicy.js', inputFingerprint: 'old-input',
      sourceHash: sha('a'), suiteFingerprint: sha('b'), approachFingerprint: sha('c') };
    const newPlan = { ...oldPlan, id: 'new-plan', startedAt: null,
      inputFingerprint: 'new-input', approachFingerprint: sha('d') };
    const ledgerPath = path.join(h.dataDir, 'self-evolution', 'research', 'ledger.json');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    const ledger = { plans: [oldPlan, newPlan], outcomes: [] };
    const save = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    const proposal = { title: goal.title, metadata: { selfEvolution: true, diagnosticOnly: false,
      capabilityDomain: 'research', executionProtocolVersion: 9, researchPlanId: 'new-plan',
      researchInputFingerprint: 'new-input' } };
    save();
    assert.equal(h.director._resemblesTerminalFailure(proposal)?.id, goal.id, 'an unrecorded failure stays blocked');
    ledger.outcomes.push({ planId: 'old-plan', state: 'execution_failed', decision: 'rejected' });
    save();
    assert.equal(h.director._resemblesTerminalFailure(proposal), null);
    assert.equal(h.director._recentThemeOutcome(proposal), null);
    newPlan.approachFingerprint = oldPlan.approachFingerprint;
    save();
    assert.equal(h.director._resemblesTerminalFailure(proposal)?.id, goal.id, 'the same approach stays blocked');
    newPlan.approachFingerprint = sha('d');
    newPlan.suiteFingerprint = sha('e');
    save();
    assert.equal(h.director._resemblesTerminalFailure(proposal)?.id, goal.id, 'a changed evaluator stays blocked');
    newPlan.suiteFingerprint = sha('b');
    save();
    h.planner.goals.set('second-trial', { ...goal, id: 'second-trial', metadata: { ...goal.metadata,
      researchPlanId: 'another-plan' } });
    assert.equal(h.director._resemblesTerminalFailure(proposal)?.id, goal.id, 'the daily cap remains enforced');
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('restart restores a research goal to its pinned write scope', () => {
  const h = harness();
  try {
    const artifact = path.join(h.dataDir, 'diagnostics', 'research.md');
    const ledgerPath = path.join(h.dataDir, 'self-evolution', 'research', 'ledger.json');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, JSON.stringify({ plans: [{ id: 'pinned-plan', state: 'ready',
      domain: 'research', file: 'core/ResearchSourcePolicy.js' }] }));
    const goal = { id: 'scoped-goal', title: 'Self-evolution improve research-to-paper', status: STATUS.ACTIVE,
      expectedArtifacts: [artifact], allowedWritePaths: [path.resolve('core'), path.resolve('tests')],
      metadata: { autonomousMission: true, selfEvolution: true, admissionClass: 'self_evolution', capabilityDomain: 'research',
        researchPlanId: 'pinned-plan', expectedArtifact: artifact, maxAttempts: 3,
        allowedWritePaths: [path.resolve('core'), path.resolve('tests')],
        goalContract: { execution: {} } } };
    h.planner.goals.set(goal.id, goal);
    h.director.initialize();
    assert.deepEqual(goal.allowedWritePaths, [path.dirname(artifact), path.resolve('core/ResearchSourcePolicy.js')]);
    assert.deepEqual(goal.metadata.goalContract.execution.allowedWritePaths, goal.allowedWritePaths);
    assert.equal(goal.maxAttempts, 3);
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('the general scheduler cannot admit an ASI contract before its baseline mode is refreshed', async () => {
  const h = harness();
  try {
    const p = h.governor.submitProposal({ title: 'Self-evolution: improve research', category: 'asi_kernel', priority: 90,
      description: 'Diagnose the measured weakness, run tests and verify the fixed baseline.',
      metadata: { selfEvolution: true, admissionClass: 'self_evolution', executionProtocolVersion: 2 } }, 'ASIKernel');
    const decision = await h.director.ensureMission({ proposalId: p.proposalId });
    assert.equal(decision.promoted, false);
    assert.equal(decision.rejections[0].reason, 'self_evolution_contract_refresh_required');
    assert.equal(h.planner.goals.size, 0);
    assert.equal(h.governor.getProposal(p.proposalId).status, 'proposed');
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('mission director migrates active bounded missions to the current session budget', () => {
  const h = harness();
  const goal = {
    id: 'legacy-bounded-mission',
    title: 'Build a durable memory checker',
    category: 'engineering',
    status: STATUS.ACTIVE,
    maxAttempts: 8,
    metadata: {
      autonomousMission: true,
      admissionClass: 'bounded_mission',
      maxAttempts: 8,
      allowedTools: ['read_file'],
      goalContract: { maxAttempts: 8, execution: {} },
      quality: { contract: { maxAttempts: 8, execution: {} } }
    }
  };
  h.planner.goals.set(goal.id, goal);
  h.director.initialize();
  assert.equal(goal.maxAttempts, 12);
  assert.equal(goal.metadata.maxAttempts, 12);
  assert.equal(goal.metadata.goalContract.maxAttempts, 12);
  assert.equal(goal.metadata.quality.contract.maxAttempts, 12);
  assert.ok(goal.metadata.allowedTools.includes('spawn_agents'));
  assert.ok(goal.metadata.goalContract.allowedTools.includes('spawn_agents'));
  assert.ok(goal.allowedWritePaths.some(writePath => writePath.endsWith(`${path.sep}core`)));
  assert.ok(goal.metadata.evidenceRequired.includes('code_change'));
  assert.equal(goal.metadata.verification.requiresCodeChange, true);
  assert.equal(goal.metadata.missionCharterVersion, 2);
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('restart preserves the admitted diagnosis instead of classifying generated artifact instructions as code work', async () => {
  const h = harness();
  try {
    const p = h.governor.submitProposal({ title: 'Diagnose tool recovery failures', category: 'research', priority: 82,
      description: 'Inspect real failure receipts and verify a concrete diagnostic report with the focused test.' }, 'proactive_council');
    const result = await h.director.ensureMission({ proposalId: p.proposalId });
    assert.equal(result.promoted, true);
    const goal = h.planner.goals.get(result.goalId);
    assert.equal(goal.metadata.deliverableKind, 'diagnosis');
    assert.match(goal.description, /create the artifact/);
    h.director.initialize();
    assert.equal(goal.metadata.requiresCodeChange, false);
    assert.equal(goal.allowedTools.includes('modify_code'), false);
    assert.equal(goal.allowedWritePaths.length, 1);
    goal.status = STATUS.COMPLETED;
    h.director._auditCompletionTruth();
    assert.equal(goal.status, STATUS.COMPLETED);
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('restart does not expand a self-evolution experiment attempt budget', () => {
  const h = harness();
  try {
    const goal = { id: 'bounded-experiment', title: 'Improve research', status: STATUS.ACTIVE, maxAttempts: 3,
      metadata: { autonomousMission: true, selfEvolution: true, maxAttempts: 3, goalContract: { maxAttempts: 3 } } };
    h.planner.goals.set(goal.id, goal);
    h.director.initialize();
    assert.equal(goal.maxAttempts, 3);
    assert.equal(goal.metadata.maxAttempts, 3);
    assert.equal(goal.metadata.goalContract.maxAttempts, 3);
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('mission director hardens active coding self-evolution without widening its tool scope', () => {
  const h = harness();
  const goal = {
    id: 'legacy-self-evolution',
    title: 'Self-evolution: improve governed coding',
    category: 'asi_kernel',
    status: STATUS.ACTIVE,
    allowedTools: ['read_file', 'modify_code', 'run_tests', 'verify_syntax'],
    expectedArtifact: 'data/self-evolution/diagnostics/coding.md',
    metadata: {
      autonomousMission: true,
      admissionClass: 'self_evolution',
      allowedTools: ['read_file', 'modify_code', 'run_tests', 'verify_syntax'],
      goalContract: { execution: {} },
      quality: { contract: { execution: {} } }
    }
  };
  h.planner.goals.set(goal.id, goal);
  h.director.initialize();
  assert.ok(goal.allowedWritePaths.some(writePath => writePath.endsWith(`${path.sep}core`)));
  assert.ok(goal.allowedWritePaths.some(writePath => writePath.endsWith(`${path.sep}data${path.sep}self-evolution${path.sep}diagnostics`)));
  assert.ok(goal.metadata.evidenceRequired.includes('code_change'));
  assert.ok(goal.expectedArtifacts.some(artifact => artifact.endsWith(`${path.sep}coding.md`)));
  assert.equal(goal.metadata.allowedTools.includes('web_fetch'), false);
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('mission director durably rejects a constitutionally denied proposal and advances', async () => {
  const h = harness();
  const denied = h.governor.submitProposal({
    title: 'Diagnose schema recovery handling',
    category: 'engineering',
    priority: 100,
    description: 'Inspect schema recovery handling, run the relevant deterministic test, verify the measured failure, and write a bounded diagnostic report with concrete source evidence.'
  }, 'proactive_council');
  const safe = h.governor.submitProposal({
    title: 'Measure memory retrieval quality',
    category: 'research',
    priority: 80,
    description: 'Run a repeatable retrieval benchmark and create a sourced result artifact.'
  }, 'proactive_council');
  const originalCreateGoal = h.planner.createGoal.bind(h.planner);
  h.planner.createGoal = async goalData => {
    if (/schema/i.test(goalData.title)) {
      return { success: false, error: 'Goal rejected by ConstitutionalCore' };
    }
    return originalCreateGoal(goalData);
  };

  const first = await h.director.ensureMission();
  assert.equal(first.promoted, false);
  assert.equal(first.proposalStatus, 'rejected');
  assert.equal(h.governor.getProposal(denied.proposalId).status, 'rejected');

  const second = await h.director.ensureMission();
  assert.equal(second.promoted, true);
  assert.equal(second.proposalId, safe.proposalId);
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('deliverable classification follows the requested action rather than a loose category', () => {
  const implementation = classifyDeliverable({
    title: 'Integrate Playwright as browserAgentArbiter',
    category: 'capability',
    description: 'Build the implementation and prove it with tests.'
  });
  assert.equal(implementation.kind, 'code_change');
  assert.equal(implementation.profile, 'code');
  assert.equal(implementation.requiresCodeChange, true);

  const research = classifyDeliverable({
    title: 'Survey browser agent designs',
    category: 'research',
    description: 'Compare primary sources and produce a paper.'
  });
  assert.equal(research.kind, 'research_report');
  assert.equal(research.profile, 'research');
  assert.equal(research.requiresCodeChange, false);
});

test('mission themes collapse dashboard synonyms for cooldown enforcement', () => {
  assert.equal(
    themeKey('Build an arbiter health metrics dashboard'),
    themeKey('Create an arbiter observability monitoring dashboard')
  );
});

test('mission themes ignore per-run UUIDs and live memory measurements', () => {
  const first = 'Autonomous mission: Reduce memory pressure. Heap at 743MB. Write result to 8f88fce8-a7d9-4853-a733-7e6c752899af.';
  const second = 'Autonomous mission: Reduce memory pressure. Heap at 1223MB. Write result to 434badd3-800c-49c6-bcc9-0e94d4be7d9e.';
  assert.equal(themeKey(first), themeKey(second));
});

test('outcome usefulness gate rejects repetitive prose and favors measured capability work', () => {
  const repetitive = assessMissionValue({
    id: 'new', title: 'Write another memory reflection report', category: 'research',
    description: 'Write a summary document about memory.'
  }, [{ id: 'old', title: 'Write another memory reflection report', status: 'completed' }]);
  const useful = assessMissionValue({
    id: 'useful', title: 'Repair goal completion verification', category: 'self_repair',
    description: 'Implement a bounded fix, run a regression test, compare the completion metric to baseline, and attach a receipt.'
  }, []);
  assert.ok(repetitive.utilityScore < 0.42);
  assert.ok(useful.utilityScore > repetitive.utilityScore);
  assert.equal(useful.reasons.changesCapability, true);
});

test('general autonomous director rejects trading work for the dedicated paper research loop', () => {
  const h = harness();
  h.planner.isTradingGoal = goal => /trading/i.test(`${goal.category} ${goal.title}`);
  const proposal = h.governor.submitProposal({
    title: 'Improve paper trading signals', category: 'engineering', priority: 99,
    description: 'Implement and test a paper trading strategy candidate against the market ledger.'
  }, 'autonomous').proposal;
  const verdict = h.director.scoreProposal(proposal);
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reason, 'trading_requires_dedicated_research_loop');
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('failed autonomous missions create one changed-strategy recovery proposal', async () => {
  const h = harness();
  const submitted = h.governor.submitProposal({
    title: 'Benchmark research synthesis',
    category: 'research',
    priority: 75,
    description: 'Run a repeatable research synthesis benchmark and create a verified comparison artifact.'
  }, 'proactive_council');
  const first = await h.director.ensureMission();
  assert.equal(first.promoted, true);
  const failed = h.planner.goals.get(first.goalId);
  failed.status = STATUS.BLOCKED;
  failed.metadata.lastTransition = { reason: 'execution_attempt_budget_exhausted', at: Date.now() };
  failed.metadata.autopsyNextStrategy = 'Use one source and prove the artifact write before expanding scope.';

  h.planner.activeGoals.delete(first.goalId);
  await h.director.ensureMission();
  assert.equal(h.governor.getProposal(submitted.proposalId).status, 'failed');
  const recoveries = h.governor.proposals
    .filter(item => item.metadata?.recoveryOfGoalId === first.goalId);
  assert.equal(recoveries.length, 1);
  assert.match(recoveries[0].description, /Use one source/);
  assert.ok(['proposed', 'promoted'].includes(recoveries[0].status));

  await h.director.ensureMission();
  const allRecoveries = h.governor.proposals.filter(item => item.metadata?.recoveryOfGoalId === first.goalId);
  assert.equal(allRecoveries.length, 1);
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('failed self-evolution stays with its pinned research loop instead of spawning generic recovery', () => {
  const h = harness();
  try {
    const submitted = h.governor.submitProposal({ title: 'Self-evolution: improve research',
      category: 'asi_kernel', description: 'Run the fixed evaluator and verify the result.',
      metadata: { selfEvolution: true, diagnosticOnly: false } }, 'ASIKernel');
    const goal = { id: 'failed-rsi', title: submitted.proposal.title, status: STATUS.BLOCKED,
      metadata: { selfEvolution: true, lastTransition: { reason: 'execution_attempt_budget_exhausted' } } };
    h.planner.goals.set(goal.id, goal);
    h.governor.markProposal(submitted.proposalId, 'promoted', { goalId: goal.id });
    h.director._reconcileOutcomes();
    assert.equal(h.governor.getProposal(submitted.proposalId).status, 'failed');
    assert.equal(h.governor.proposals.filter(item => item.metadata?.recoveryOfGoalId === goal.id).length, 0);
  } finally { fs.rmSync(h.dataDir, { recursive: true, force: true }); }
});

test('operator-cancelled autonomous missions close without spawning a recovery clone', async () => {
  const h = harness();
  const submitted = h.governor.submitProposal({
    title: 'Repair a stale autonomous capability',
    category: 'engineering',
    priority: 75,
    description: 'Inspect the capability, repair it, run tests, and produce verified evidence.'
  }, 'proactive_council');
  const first = await h.director.ensureMission();
  assert.equal(first.promoted, true);
  const cancelled = h.planner.goals.get(first.goalId);
  cancelled.status = STATUS.ABANDONED;
  cancelled.metadata.cancelledAt = Date.now();
  cancelled.metadata.lastTransition = { reason: 'Discord owner requested cancellation', at: Date.now() };
  h.planner.activeGoals.delete(first.goalId);

  await h.director.ensureMission();
  assert.equal(h.governor.getProposal(submitted.proposalId).status, 'failed');
  assert.equal(
    h.governor.proposals.filter(item => item.metadata?.recoveryOfGoalId === first.goalId).length,
    0
  );
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('self-evolution must pass through the director without losing its benchmark contract', async () => {
  const h = harness();
  const expectedArtifact = path.join(h.dataDir, 'self-evolution', 'diagnostics', 'research.md');
  h.governor.submitProposal({
    type: 'self_improvement',
    title: 'Self-evolution: improve research',
    category: 'asi_kernel',
    priority: 76,
    description: 'Run the fixed research benchmark, diagnose the measured weakness, make one bounded change, and verify the result.',
    metadata: {
      source: 'ASIKernel',
      admissionClass: 'self_evolution',
      allowAutonomousExecution: true,
      benchmarkTests: ['tests/agency-proving-ground.test.cjs'],
      capabilityContract: { objective: 'Improve research' },
      expectedArtifact,
      allowedTools: ['read_file', 'write_file', 'run_tests']
    }
  }, 'ASIKernel');

  const result = await h.director.ensureMission();
  assert.equal(result.promoted, true);
  const goal = h.planner.goals.get(result.goalId);
  assert.equal(goal.metadata.missionDirectorApproved, true);
  assert.equal(goal.metadata.admissionClass, 'self_evolution');
  assert.equal(goal.metadata.expectedArtifact, expectedArtifact);
  assert.deepEqual(goal.metadata.benchmarkTests, ['tests/agency-proving-ground.test.cjs']);
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('verified diagnosis with a concrete code finding becomes one bounded action proposal', async () => {
  const h = harness();
  const submitted = h.governor.submitProposal({
    title: 'Diagnose stalled completion receipts', category: 'research', priority: 80,
    description: 'Inspect and diagnose receipt failures using concrete measurements and write a verified report.'
  }, 'autonomous');
  const first = await h.director.ensureMission();
  const goal = h.planner.goals.get(first.goalId);
  fs.mkdirSync(path.dirname(goal.metadata.expectedArtifact), { recursive: true });
  fs.writeFileSync(goal.metadata.expectedArtifact,
    'Evidence inspected\ncore/GoalLifecycle.cjs\nEvidence-backed finding\nFix the terminal transition guard.\nVerification status\nConfirmed.\n');
  goal.status = STATUS.COMPLETED;
  goal.metadata.completionClassification = 'research_complete';
  h.planner.activeGoals.delete(goal.id);
  await h.director.ensureMission();
  const actions = h.governor.proposals.filter(item => item.metadata?.diagnosisOfGoalId === goal.id);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].category, 'self_repair');
  await h.director.ensureMission();
  assert.equal(h.governor.proposals.filter(item => item.metadata?.diagnosisOfGoalId === goal.id).length, 1);
  assert.equal(h.governor.getProposal(submitted.proposalId).status, 'completed');
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});

test('empty execution slot seeds one purposeful benchmark and respects its cooldown', async () => {
  const h = harness();
  const first = await h.director.ensureMission();
  assert.equal(first.reason, 'purposeful_candidate_seeded');
  assert.ok(first.seededProposalId);
  const second = await h.director.ensureMission();
  assert.equal(second.promoted, true);
  h.planner.goals.get(second.goalId).status = STATUS.COMPLETED;
  h.planner.activeGoals.delete(second.goalId);
  const third = await h.director.ensureMission();
  assert.notEqual(third.reason, 'purposeful_candidate_seeded');
  fs.rmSync(h.dataDir, { recursive: true, force: true });
});
