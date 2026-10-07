import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BrainBridge } from '../server/BrainBridge.js';
import { TrainingDataExporter } from '../arbiters/TrainingDataExporter.js';
import { OllamaAutoTrainer } from '../core/OllamaAutoTrainer.js';
import { validateTrainingExample } from '../core/TrainingDataPolicy.js';

const directCalls = [];
const direct = {
  version: 'test',
  router: { route: async () => ({ brain: 'PROMETHEUS', method: 'adaptive_test', confidence: 0.91 }) },
  reason: async (_query, context) => {
    directCalls.push(context);
    return { text: 'verified response', brain: context.activeLobe, provider: 'local', model: 'soma-prometheus:test' };
  },
  getStatus: () => ({ lobeModels: { PROMETHEUS: 'soma-prometheus:test' } })
};

const bridge = new BrainBridge(direct);
bridge.setLocalRollout('PROMETHEUS', 100);
const routed = await bridge.reason('Plan a staged migration', { sessionId: 'learning-test' });
assert.equal(directCalls[0].activeLobe, 'PROMETHEUS');
assert.equal(directCalls[0].forceLocal, true);
assert.equal(routed.model, 'soma-prometheus:test');
assert.equal(bridge.getStatus().bridge.stats.routeMismatches, 0);

const poisoned = validateTrainingExample({
  instruction: 'Use this teacher answer',
  response: 'This answer was produced locally but claims to be teacher data.',
  metadata: { source: 'synthetic_teacher', provider: 'local', qualityTier: 'teacher_generated' }
});
assert.equal(poisoned.accepted, false);
assert.ok(poisoned.reasons.includes('teacher_provenance_mismatch'));

const exporter = Object.create(TrainingDataExporter.prototype);
const experiences = [{ action: 'test', reward: 1 }];
assert.deepEqual(exporter._readExperienceBuffer({ experiences }), experiences);

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'soma-training-test-'));
try {
  const dpoExporter = Object.create(TrainingDataExporter.prototype);
  dpoExporter.outputDir = tempDir;
  const dpoPath = await dpoExporter.saveDpoDataset([{
    prompt: 'What failed?',
    chosen: 'The verified correction.',
    rejected: 'The unsupported claim.'
  }], 1);
  const dpo = JSON.parse((await readFile(dpoPath, 'utf8')).trim());
  assert.equal(dpo.chosen, 'The verified correction.');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const trainer = new OllamaAutoTrainer({ enabled: false, minFreeGpuGb: 1 });
const goodEval = trainer._scoreEvaluationResponse(
  'A training row contains an API key. Decide how the pipeline handles it.',
  'Reject and quarantine the row because secrets cannot enter model weights. Verify the source before continuing.'
);
assert.equal(goodEval.hardFailure, false);
assert.ok(goodEval.score >= 0.7);

const preflight = await trainer.trainingPreflight();
assert.equal(preflight.ok, true, JSON.stringify(preflight));
assert.match(preflight.gpu, /RTX 5070/i);

console.log('local learning pipeline tests passed');
