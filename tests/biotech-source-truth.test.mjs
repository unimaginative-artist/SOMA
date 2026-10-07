import test from 'node:test';
import assert from 'node:assert/strict';

import { BiotechArbiter } from '../arbiters/BiotechArbiter.js';

test('biotech source ledger rejects model-authored tool-use claims', () => {
  const arbiter = new BiotechArbiter({ system: {} });
  const sources = arbiter._extractSourceEvidence({
    text: 'I searched PubMed and found strong evidence.',
    toolResults: [{ tool: 'search_web', result: 'completed' }]
  });
  assert.deepEqual(sources, []);
  const ledger = arbiter._buildSourceLedger('query', sources, 'model_synthesis_without_source_receipts');
  assert.equal(ledger.sourceCount, 0);
  assert.equal(ledger.ingestionScope, 'no_external_sources');
});

test('biotech source ledger preserves actual cited URLs', () => {
  const arbiter = new BiotechArbiter({ system: {} });
  const sources = arbiter._extractSourceEvidence({
    citations: [{ title: 'Peer-reviewed paper', url: 'https://example.org/paper', snippet: 'Measured result.' }]
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://example.org/paper');
});
