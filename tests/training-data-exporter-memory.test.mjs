import test from 'node:test';
import assert from 'node:assert/strict';

import { TrainingDataExporter } from '../arbiters/TrainingDataExporter.js';

function exporter(overrides = {}) {
  const instance = Object.create(TrainingDataExporter.prototype);
  Object.assign(instance, {
    mnemonic: null,
    nemesisReview: null,
    memoryExportLimit: 100,
    format: 'gemma',
    qualityStats: { totalReviewed: 0, passed: 0, failed: 0, uncertain: 0, sentToGraveyard: 0 },
    ...overrides
  });
  return instance;
}

test('memory export admits verified outcome truth and rejects raw recollection', async () => {
  const instance = exporter({
    mnemonic: {
      async listMemories() {
        return [
          {
            id: 'verified-1',
            content: 'Type: discord_turn\nInput: Why did the goal fail?\nResult: The unchanged retry exhausted its attempt budget.',
            created_at: 123,
            metadata: {
              outcomeTruthAuthoritative: true,
              outcomeTruthStatus: 'verified_failure',
              outcomeTraceId: 'trace-1',
              resolutionFingerprint: 'receipt-1'
            }
          },
          {
            id: 'raw-1',
            content: 'Input: Invent a team\nResult: Several fictional developers exist.',
            metadata: { importance: 1 }
          }
        ];
      }
    }
  });

  const result = await instance.exportMemories();
  assert.equal(result.scanned, 2);
  assert.equal(result.count, 1);
  assert.equal(result.examples[0].instruction, 'Why did the goal fail?');
  assert.equal(result.examples[0].metadata.qualityTier, 'verified');
  assert.equal(result.examples[0].metadata.evidenceId, 'receipt-1');
});

test('verified memories are merged and pass the shared training policy', async () => {
  const instance = exporter();
  const dataset = await instance.mergeIntoTrainingFormat({
    memories: {
      examples: [{
        instruction: 'How should an unchanged failed approach be handled?',
        response: 'Stop retrying it, record the verified failure, and require a materially different strategy.',
        metadata: { source: 'verified_memory', qualityTier: 'verified', evidenceId: 'receipt-2' }
      }]
    }
  });

  assert.equal(dataset.length, 1);
  assert.equal(dataset[0].metadata.source, 'verified_memory');
  assert.equal(dataset[0].metadata.evidenceId, 'receipt-2');
});

test('Nemesis revision export produces DPO pairs without leaking scope', async () => {
  const instance = exporter({
    nemesisReview: {
      getRevisionPairs() {
        return [{
          query: 'Who is on the team?',
          bad_response: 'Several unnamed developers are on the team.',
          good_response: 'Owner is the known human collaborator; MAX is a software system.',
          critique: 'The original answer invented people.',
          score_before: 0.1
        }];
      }
    }
  });

  const result = await instance.exportRevisionPairs();
  assert.equal(result.dpoPairs.length, 1);
  assert.equal(result.dpoPairs[0].chosen, 'Owner is the known human collaborator; MAX is a software system.');
});
