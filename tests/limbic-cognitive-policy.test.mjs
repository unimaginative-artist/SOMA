import test from 'node:test';
import assert from 'node:assert/strict';
import { LimbicCognitivePolicy, deriveFeelingsFromChemistry } from '../core/LimbicCognitivePolicy.js';
import { SOMArbiterV2_QuadBrain } from '../arbiters/SOMArbiterV2_QuadBrain.js';

test('affective input is clamped, provenance is retained, and stale signals are rejected', () => {
  let now = 1_000_000;
  const policy = new LimbicCognitivePolicy({ now: () => now, maxSignalAgeMs: 60_000 });
  const accepted = policy.ingest({
    chemistry: { dopamine: 4, cortisol: -2 },
    feelings: { alarm: 8, curiosity: -4 },
    source: 'fixture', confidence: 2, observedAt: now, reason: 'test'
  });
  assert.equal(accepted.accepted, true);
  const snapshot = policy.snapshot();
  assert.equal(snapshot.chemistry.dopamine, 1);
  assert.equal(snapshot.chemistry.cortisol, 0);
  assert.equal(snapshot.feelings.alarm, 1);
  assert.equal(snapshot.feelings.curiosity, 0);
  assert.equal(snapshot.provenance.source, 'fixture');
  assert.equal(snapshot.provenance.confidence, 1);

  now += 120_000;
  assert.equal(policy.ingest({ chemistry: { cortisol: 1 }, observedAt: now - 120_000 }).accepted, false);
});

test('chemistry creates embodied feelings instead of dialogue-only mood labels', () => {
  const feelings = deriveFeelingsFromChemistry({ dopamine: 0.05, cortisol: 0.95, oxytocin: 0.1, serotonin: 0.05 });
  assert.ok(feelings.alarm > 0.9);
  assert.ok(feelings.fatigue > 0.7);
  assert.ok(feelings.frustration > 0.8);
  assert.ok(feelings.loneliness > 0.8);
});

test('limbic temperature remains task-bounded and has no authority effect', () => {
  const policy = new LimbicCognitivePolicy();
  policy.ingest({ chemistry: { dopamine: 1, cortisol: 0, serotonin: 1 }, source: 'test' });
  const factual = policy.cognitivePolicy({ temperature: 1.2, taskKind: 'factual' }, 'verify code evidence');
  const creative = policy.cognitivePolicy({ temperature: 1.2, taskKind: 'creative' }, 'write a story');
  assert.ok(factual.temperature <= 0.5);
  assert.ok(creative.temperature <= 0.95);
  assert.equal(factual.authorityImpact, 'advisory_governed');
  assert.equal(policy.embodimentPolicy().authorityImpact, 'advisory_governed');
});

test('adversarial debate uses an independent bounded adjudicator', async () => {
  const brain = Object.create(SOMArbiterV2_QuadBrain.prototype);
  brain.auditLogger = { info() {}, warn() {} };
  const calls = [];
  brain._runLobe = async (lobe, prompt) => {
    calls.push({ type: 'lobe', lobe, prompt });
    return { lobe, name: lobe, output: lobe === 'LOGOS' ? 'Initial proposal' : 'Unsupported assumption found', provider: 'fixture' };
  };
  brain._callProviderCascade = async (prompt, context) => {
    calls.push({ type: 'judge', prompt, context });
    return { text: 'NEEDS_OBSERVATION\nCollect a fresh depth frame.', provider: 'fixture' };
  };
  const results = await brain._executeLobeReasoning(
    [['LOGOS', 0.8], ['THALAMUS', 0.7]],
    'Can the robot move?',
    { deepThinking: true, maxDebateCalls: 3, evidenceSummary: 'Camera frame is stale.' }
  );
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).type, 'judge');
  assert.equal(calls.at(-1).context.activeLobe, 'SYNTHESIS');
  assert.equal(results.length, 1);
  assert.equal(results[0].debate.decision, 'NEEDS_OBSERVATION');
  assert.equal(results[0].debate.rounds, 1);
});

test('debate budget below three calls falls back to parallel perspectives', async () => {
  const brain = Object.create(SOMArbiterV2_QuadBrain.prototype);
  brain.auditLogger = { info() {}, warn() {} };
  let judgeCalls = 0;
  brain._runLobe = async lobe => ({ lobe, name: lobe, output: `${lobe} result`, provider: 'fixture' });
  brain._callProviderCascade = async () => { judgeCalls++; return { text: 'ANSWER' }; };
  const results = await brain._executeLobeReasoning(
    [['LOGOS', 0.8], ['THALAMUS', 0.7]], 'Question', { deepThinking: true, maxDebateCalls: 2 }
  );
  assert.equal(judgeCalls, 0);
  assert.equal(results.length, 2);
});
