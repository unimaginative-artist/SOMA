import test from 'node:test';
import assert from 'node:assert/strict';

import { WorldModelArbiter } from '../arbiters/WorldModelArbiter.js';

test('abstract world-model prediction fails closed without observed evidence', async () => {
  const model = new WorldModelArbiter();
  const result = await model.predictOutcome('What happens if this architecture is changed?');
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.outcome, null);
  assert.equal(result.confidence, 0);
  assert.equal(result.evidenceBacked, false);
});

test('abstract world-model prediction exposes causal evidence when available', async () => {
  const model = new WorldModelArbiter({
    causalityArbiter: {
      predictOutcome() {
        return { outcome: 'Latency increases', confidence: 0.8, evidence: ['transition-4'] };
      }
    }
  });
  const result = await model.predictOutcome('Increase synchronous work', {});
  assert.equal(result.outcome, 'Latency increases');
  assert.equal(result.evidenceBacked, true);
  assert.deepEqual(result.evidence, ['transition-4']);
});
