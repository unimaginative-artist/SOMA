import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeIngestionSpine } from '../server/knowledge/KnowledgeIngestionSpine.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-knowledge-evidence-'));
  const spine = new KnowledgeIngestionSpine({
    root,
    dataDir: path.join(root, 'data', 'knowledge-spine'),
    reflectionsPath: path.join(root, 'reflections')
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, spine };
}

test('knowledge ingestion persists claim-evidence-source-confidence chains', async t => {
  const { spine } = await fixture(t);
  const sourceUrl = 'https://example.test/research/42';
  const result = await spine.ingest({
    id: 'entry-evidence-chain',
    title: 'Verified autonomy finding',
    domain: 'code',
    sourceType: 'test',
    sourceUrl,
    confidence: 0.88,
    content: 'Revision-aware writes reduce stale autonomous overwrites.',
    units: [{
      kind: 'claim',
      text: 'Revision-aware writes reduce stale autonomous overwrites.',
      confidence: 0.88
    }],
    evidence: [{
      kind: 'test_result',
      label: 'Two stale writers were rejected by the workspace revision test.',
      url: sourceUrl,
      confidence: 0.95
    }],
    publishToReflections: false
  });

  assert.equal(result.success, true);
  assert.equal(result.units[0].verificationStatus, 'supported');
  assert.equal(result.units[0].confidenceBasis, 'explicit');
  assert.equal(result.units[0].provenance.sourceIds.length, 1);
  assert.equal(result.units[0].provenance.evidenceIds.length, 1);

  const graph = spine.evidenceGraph();
  assert.ok(graph.nodes.some(node => node.type === 'claim'));
  assert.ok(graph.nodes.some(node => node.type === 'evidence'));
  assert.ok(graph.nodes.some(node => node.type === 'source' && node.url === sourceUrl));
  assert.ok(graph.edges.some(edge => edge.relationship === 'supported_by'));
  assert.ok(graph.edges.some(edge => edge.relationship === 'located_at'));
  assert.ok(graph.edges.some(edge => edge.relationship === 'derived_from'));
  assert.equal(spine.status().nodeCount, graph.nodes.length);
});

test('unsupported knowledge remains explicitly unverified', async t => {
  const { spine } = await fixture(t);
  const result = await spine.ingest({
    id: 'entry-no-evidence',
    title: 'Unsupported hypothesis',
    domain: 'general',
    sourceType: 'reflection',
    content: 'A speculative mechanism suggests this system improves every outcome.',
    units: [{
      kind: 'claim',
      text: 'A speculative mechanism suggests this system improves every outcome.'
    }],
    publishToReflections: false
  });

  assert.equal(result.units[0].verificationStatus, 'unverified');
  assert.equal(result.units[0].confidenceBasis, 'unverified-default');
  assert.equal(result.units[0].provenance.evidenceIds.length, 0);
  assert.ok(result.units[0].confidence <= 0.35);
});

test('legacy knowledge backfill creates provisional provenance without claiming verification', async t => {
  const { root, spine } = await fixture(t);
  const corpusPath = path.join(root, 'data', 'knowledge-spine', 'corpus.json');
  await fs.mkdir(path.dirname(corpusPath), { recursive: true });
  await fs.writeFile(corpusPath, JSON.stringify({
    version: 1,
    entries: [{
      id: 'legacy-entry',
      title: 'Legacy sourced hypothesis',
      domain: 'medical',
      sourceType: 'legacy_research',
      sourceUrl: 'https://example.test/legacy-source',
      confidence: 0.62,
      createdAt: '2026-01-01T00:00:00.000Z'
    }],
    units: [{
      id: 'legacy-unit',
      kind: 'claim',
      text: 'A legacy claim needs modern verification.',
      confidence: null,
      entryId: 'legacy-entry',
      domain: 'medical',
      sourceType: 'legacy_research',
      createdAt: '2026-01-01T00:00:00.000Z'
    }]
  }), 'utf8');

  const result = spine.backfillEvidenceGraph();
  assert.equal(result.success, true);
  assert.equal(result.unitsAdded, 1);
  const graph = spine.evidenceGraph();
  const claim = graph.nodes.find(node => node.id === 'legacy-unit');
  assert.equal(claim.verificationStatus, 'provisional');
  assert.equal(claim.legacyBackfill, true);
  assert.ok(graph.edges.some(edge => edge.from === claim.id && edge.relationship === 'supported_by'));

  const corpus = JSON.parse(await fs.readFile(corpusPath, 'utf8'));
  const unit = corpus.units.find(item => item.id === 'legacy-unit');
  assert.equal(unit.verificationStatus, 'provisional');
  assert.equal(unit.confidenceBasis, 'legacy-default');
});
