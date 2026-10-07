import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { OutcomeTruthLedger } from '../core/OutcomeTruthLedger.js';
import { AdaptiveLearningRouter } from '../arbiters/AdaptiveLearningRouter.js';
import { UniversalLearningPipeline } from '../arbiters/UniversalLearningPipeline.js';
import FragmentRegistry from '../arbiters/FragmentRegistry.js';
import { SomaAgenticExecutor } from '../core/SomaAgenticExecutor.js';

function ledgerFor(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-outcome-truth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new OutcomeTruthLedger({ dbPath: path.join(dir, 'truth.sqlite'), logger: { warn() {} } }).initialize();
}

test('traces begin unknown and model confidence cannot authorize learning', t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'chat-1', source: 'chat', sessionId: 'owner', input: 'hello' });
  const signal = ledger.recordSignal('chat-1', {
    type: 'model_confidence', polarity: 'success', reward: 1, actor: 'qwen', evidence: { confidence: 0.99 }
  });
  assert.equal(signal.authoritative, false);
  assert.equal(ledger.resolution('chat-1').status, 'unknown');
  assert.equal(ledger.trainingCandidates().length, 0);
  ledger.close();
});

test('verified receipts resolve outcomes and attribute bounded component credit', t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'goal-1', source: 'agentic', input: 'repair parser' });
  ledger.linkComponent('goal-1', { kind: 'planner', id: 'GoalPlanner' });
  ledger.linkComponent('goal-1', { kind: 'tool', id: 'run_tests' });
  const signal = ledger.recordSignal('goal-1', {
    type: 'test_receipt', polarity: 'success', actor: 'test_runner',
    evidence: { receiptId: 'receipt-1', passed: true }
  });
  assert.equal(signal.authoritative, true);
  const trace = ledger.getTrace('goal-1');
  assert.equal(trace.status, 'verified_success');
  assert.equal(trace.credit.length, 2);
  assert.equal(trace.credit.reduce((sum, row) => sum + row.credit, 0), 1);
  assert.equal(ledger.trainingCandidates().length, 1);
  ledger.close();
});

test('conflicting authoritative evidence fails closed until superseded', t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'task-1', source: 'agentic', input: 'build feature' });
  const pass = ledger.recordSignal('task-1', {
    type: 'test_receipt', polarity: 'success', actor: 'runner', evidence: { receiptId: 'r-pass', passed: true }, assignCredit: false
  });
  ledger.recordSignal('task-1', {
    type: 'artifact_verification', polarity: 'failure', actor: 'verifier', evidence: { receiptId: 'r-fail', passed: false }, assignCredit: false
  });
  assert.equal(ledger.resolution('task-1').status, 'conflicted');
  ledger.recordSignal('task-1', {
    type: 'operator_verdict', polarity: 'failure', actor: 'Owner', evidence: { verdict: 'corrected' }, supersedesSignalId: pass.signalId, assignCredit: false
  });
  assert.equal(ledger.resolution('task-1').status, 'verified_failure');
  ledger.close();
});

test('implicit feedback attaches to the previous turn and remains advisory', t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'chat-old', source: 'chat', sessionId: 'owner', input: 'first' });
  ledger.beginTrace({ traceId: 'chat-new', source: 'chat', sessionId: 'owner', input: 'that was wrong' });
  const result = ledger.recordImplicitFeedbackForPrevious('owner', {
    observed: true, userCorrected: true, userSatisfaction: 0.1, reason: 'correction phrase'
  }, { excludeTraceId: 'chat-new' });
  assert.equal(result.traceId, 'chat-old');
  assert.equal(result.authoritative, false);
  assert.equal(ledger.getTrace('chat-new').signals.length, 0);
  ledger.close();
});

test('explicit feedback resolves the selected prior trace', t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'chat-1', source: 'chat', sessionId: 'owner', input: 'question' });
  ledger.observeOutput('chat-1', 'answer');
  const result = ledger.recordExplicitFeedback({ traceId: 'chat-1', sessionId: 'owner', rating: -1, comment: 'wrong answer', actor: 'Owner' });
  assert.equal(result.recorded, true);
  assert.equal(result.signal.authoritative, true);
  assert.equal(ledger.getTrace('chat-1').status, 'verified_failure');
  ledger.close();
});

test('comment-only explicit feedback is interpreted rather than coerced to a zero rating', t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'chat-comment', source: 'chat', sessionId: 'owner', input: 'question' });
  const result = ledger.recordExplicitFeedback({ traceId: 'chat-comment', comment: 'that was a helpful answer', actor: 'Owner' });
  assert.equal(result.signal.authoritative, true);
  assert.equal(result.signal.polarity, 'success');
  assert.equal(ledger.getTrace('chat-comment').status, 'verified_success');
  ledger.close();
});

test('signal history is append-only at the database boundary', t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'chat-1', source: 'chat', input: 'question' });
  ledger.recordSignal('chat-1', { type: 'model_confidence', polarity: 'success', actor: 'model' });
  const db = new Database(ledger.dbPath);
  assert.throws(() => db.prepare('UPDATE outcome_truth_signals SET reward = 1').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM outcome_truth_signals').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM outcome_truth_event_log').run(), /append-only/);
  db.close();
  ledger.close();
});

test('unified event chain is ordered across stages and signals and redacts common secrets', t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'chain-1', source: 'chat', input: 'api_key=very-secret-value-12345' });
  const stage = ledger.recordStage('chain-1', 'routed', { data: { token: 'sensitive-token-value' } });
  const signal = ledger.recordSignal('chain-1', {
    type: 'model_confidence', polarity: 'success', actor: 'model', reason: 'Bearer abcdefghijklmnop', evidence: { confidence: 1 },
  });
  const trace = ledger.getTrace('chain-1');
  assert.match(trace.input_excerpt, /\[REDACTED\]/);
  assert.equal(signal.previousHash, stage.eventHash);
  assert.doesNotMatch(signal.reason, /abcdefghijklmnop/);
  ledger.close();
});

test('adaptive routing learns only from resolved outcome truth, never self-confidence', async t => {
  const ledger = ledgerFor(t);
  ledger.beginTrace({ traceId: 'route-1', source: 'chat', sessionId: 'owner', input: 'plan this' });
  const router = new AdaptiveLearningRouter({ outcomeTruth: ledger });
  const profile = { conversationTopic: 'planning', userId: 'owner', userWorkflow: 'chat' };
  const ignored = await router.recordRoutingDecision('plan this', profile, 'PROMETHEUS', { confidence: 0.99, outcomeTraceId: 'route-1' });
  assert.equal(ignored.learned, false);
  assert.equal(router.routingMemory.size, 0);
  ledger.recordSignal('route-1', {
    type: 'explicit_user_feedback', polarity: 'success', actor: 'Owner', evidence: { rating: 1, verdict: 'accepted' }, assignCredit: false
  });
  const learned = await router.recordRoutingDecision('plan this', profile, 'PROMETHEUS', { confidence: 0.01, outcomeTraceId: 'route-1' });
  assert.equal(learned.learned, true);
  assert.equal(learned.satisfaction, 1);
  assert.equal(router.routingMemory.size, 1);
  ledger.close();
});

test('adaptive routing memory survives a process-style reload and deduplicates traces', async t => {
  const ledger = ledgerFor(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-routing-memory-'));
  const storagePath = path.join(dir, 'routing.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  ledger.beginTrace({ traceId: 'route-durable', source: 'chat', sessionId: 'owner', input: 'plan this' });
  const signal = ledger.recordSignal('route-durable', {
    type: 'explicit_user_feedback', polarity: 'success', actor: 'Owner', evidence: { rating: 1, verdict: 'accepted' }, assignCredit: false
  });
  const profile = { conversationTopic: 'planning', userId: 'owner', userWorkflow: 'chat' };
  const first = new AdaptiveLearningRouter({ outcomeTruth: ledger, storagePath });
  await first.initialize();
  assert.equal((await first.recordRoutingDecision('plan this', profile, 'PROMETHEUS', {
    outcomeTraceId: 'route-durable', outcomeTruth: signal.resolution
  })).learned, true);
  assert.equal((await first.recordRoutingDecision('plan this', profile, 'PROMETHEUS', {
    outcomeTraceId: 'route-durable', outcomeTruth: signal.resolution
  })).reason, 'trace_already_recorded');

  const restored = new AdaptiveLearningRouter({ outcomeTruth: ledger, storagePath });
  await restored.initialize();
  assert.equal(restored.routingMemory.size, 1);
  assert.equal(Array.from(restored.routingMemory.values())[0][0].outcomeTraceId, 'route-durable');
  ledger.close();
});

test('verified traces fan out exactly once to replay, planner, router, and fragments', async t => {
  const ledger = ledgerFor(t);
  const experiences = [];
  const planned = [];
  const routed = [];
  const fragments = [];
  const pipeline = new UniversalLearningPipeline({
    experienceBuffer: { addExperience: value => experiences.push(value), experiences },
    outcomeTracker: { recordOutcome() {}, outcomes: new Map() },
    truthConsumerId: 'test_pipeline',
  });
  pipeline.initialized = true;
  pipeline.storeInMemory = async () => null;
  pipeline.storeDistilledLesson = async () => null;
  pipeline.adaptivePlanner = { recordLearningOutcome(topic, outcome) { planned.push({ topic, outcome }); } };
  pipeline.adaptiveRouter = { async recordRoutingDecision(...args) { routed.push(args); return { learned: true }; } };
  pipeline.fragmentRegistry = { async recordFragmentOutcome(...args) { fragments.push(args); return { learned: true }; } };
  await pipeline.attachOutcomeTruth(ledger);

  ledger.beginTrace({ traceId: 'fanout-1', source: 'discord_conversation', sessionId: 'owner', input: 'fix it' });
  ledger.linkComponent('fanout-1', { kind: 'model', id: 'qwen-27b', role: 'response_generator' });
  ledger.linkComponent('fanout-1', { kind: 'fragment', id: 'LOGOS_debugging', role: 'matched_fragment' });
  ledger.observeOutput('fanout-1', 'fixed');
  const signal = ledger.recordSignal('fanout-1', {
    type: 'test_receipt', polarity: 'success', actor: 'test_runner',
    evidence: { receiptId: 'receipt-1', passed: true }
  });
  const first = await pipeline.ingestVerifiedTrace(ledger.getTrace('fanout-1'), signal.eventHash);
  assert.equal(first.learned, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(experiences.length, 1);
  assert.equal(planned.length, 1);
  assert.equal(routed.length, 1);
  assert.equal(fragments.length, 1);
  assert.equal(ledger.pendingTrainingCandidates({ consumerId: 'test_pipeline' }).length, 0);
  assert.equal((await pipeline.ingestVerifiedTrace(ledger.getTrace('fanout-1'), signal.eventHash)).reason, 'already_consumed');
  ledger.close();
});

test('fragment expertise changes only for authoritative verified outcomes', async () => {
  const registry = new FragmentRegistry();
  registry.saveFragments = async () => ({ success: true });
  const fragment = await registry.spawnFragment('testing', registry.fragmentTemplates.get('testing'));
  const initial = fragment.expertiseLevel;
  assert.equal((await registry.recordFragmentOutcome(fragment.id, { reward: 1 })).learned, false);
  assert.equal(fragment.expertiseLevel, initial);
  const learned = await registry.recordFragmentOutcome(fragment.id, {
    reward: 1,
    outcomeTruthAuthoritative: true,
    outcomeTruthStatus: 'verified_success',
  });
  assert.equal(learned.learned, true);
  assert.ok(fragment.expertiseLevel > initial);
});

test('universal learning pipeline stores observations but gives unknown turns no reward or lesson', async () => {
  const experiences = [];
  const pipeline = new UniversalLearningPipeline({
    experienceBuffer: { addExperience: value => experiences.push(value), experiences: [] },
    outcomeTracker: { recordOutcome() {}, outcomes: new Map() },
  });
  const unknown = {
    id: 'unknown-1', timestamp: Date.now(), type: 'chat', agent: 'Qwen',
    input: 'question', output: 'confident answer', context: {},
    metadata: { confidence: 0.99, userSatisfaction: 1, success: true, outcomeTruthStatus: 'unknown' },
  };
  assert.equal(pipeline.calculateReward(unknown), 0);
  assert.equal(pipeline.isSuccessful(unknown), null);
  assert.equal(await pipeline.storeAsExperience(unknown), false);
  assert.equal(await pipeline.storeDistilledLesson(unknown), null);
  assert.equal(experiences.length, 0);

  const verified = {
    ...unknown,
    id: 'verified-1',
    metadata: {
      success: true,
      userSatisfaction: 1,
      outcomeTruthAuthoritative: true,
      outcomeTruthStatus: 'verified_success',
    },
  };
  assert.ok(pipeline.calculateReward(verified) > 0);
  assert.equal(await pipeline.storeAsExperience(verified), true);
  assert.equal(experiences.length, 1);
});

test('agentic executor opens an auditable trace before its selection gate', async t => {
  const ledger = ledgerFor(t);
  const executor = new SomaAgenticExecutor({ maxIterations: 1 });
  executor.initialize({
    brain: { name: 'test-brain', reason: async () => ({ text: '' }) },
    system: { outcomeTruth: ledger },
  });
  const result = await executor.execute({ id: 'goal-low', title: 'deferred task', priority: 1, metadata: {} });
  assert.equal(result.deliberationRejected, true);
  assert.ok(result.outcomeTraceId.startsWith('agentic:'));
  const trace = ledger.getTrace(result.outcomeTraceId);
  assert.equal(trace.status, 'unknown');
  assert.ok(trace.stages.some(stage => stage.stage === 'selection_rejected'));
  assert.ok(trace.components.some(component => component.component_kind === 'model'));
  ledger.close();
});
