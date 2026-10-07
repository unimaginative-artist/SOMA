import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  MemoryAdmissionLedger,
  classifyMemoryAdmission,
  memoryContentHash
} from '../core/memory/MemoryAdmissionLedger.js';
import { SemanticMemoryIndex, chunkMemoryText } from '../core/memory/SemanticMemoryIndex.js';
import { MemoryBehaviorGate } from '../core/memory/MemoryBehaviorGate.js';
import { MemoryRetrievalQualityGate } from '../core/memory/MemoryRetrievalQualityGate.js';
import { MemorySubstrateV2 } from '../core/memory/MemorySubstrateV2.js';
import { CanonicalMemoryStore } from '../core/memory/CanonicalMemoryStore.js';

function tempPaths(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-memory-v2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, source: path.join(dir, 'source.sqlite'), index: path.join(dir, 'semantic.sqlite') };
}

function fakeEmbed(text) {
  const groups = [
    ['observation', 'retry', 'unchanged', 'artifact', 'failed'],
    ['owner', 'creator', 'partner', 'owner'],
    ['shower', 'glass', 'business', 'capital', 'pricing'],
    ['memory', 'semantic', 'retrieval', 'embedding'],
    ['market', 'trade', 'finance', 'profit'],
    ['code', 'function', 'javascript', 'patch'],
    ['discord', 'conversation', 'social'],
    ['goal', 'execution', 'blocked', 'budget']
  ];
  const value = String(text).toLowerCase();
  const vector = groups.map(words => words.reduce((sum, word) => sum + (value.includes(word) ? 1 : 0), 0));
  if (!vector.some(Boolean)) vector[7] = 0.1;
  return vector;
}

function createSource(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, metadata TEXT, importance REAL,
      created_at INTEGER, accessed_at INTEGER, category TEXT, sector TEXT, tier TEXT
    )
  `);
  const insert = db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const now = Date.now();
  insert.run('lesson-1', 'A failed observation-only loop must not retry the unchanged approach. Use a concretely different artifact-first plan. The action fingerprint alone is not evidence.', JSON.stringify({ type: 'goal_lesson', importance: 8 }), 8, now, now, 'loop_failure', 'loop_deadlock', 'warm');
  insert.run('owner-1', 'Owner, also known as Owner, is the creator and operator of SOMA and her long-term development partner.', JSON.stringify({ type: 'user_profile' }), 7, now - 1, now, 'user_owner', 'identity', 'warm');
  insert.run('business-1', 'Shower glass business planning should model starting capital, pricing, installation labor, margins, and a three-year plan.', JSON.stringify({ type: 'decision' }), 7, now - 2, now, 'finance', 'business_planning', 'warm');
  insert.run('journal-1', '{"C:\\\\SOMA\\\\file.js":{"fingerprint":"1:2","contentIndexed":true,"indexedAt":1234},"D:\\\\MAX\\\\file.js":{"fingerprint":"2:3","contentIndexed":true,"indexedAt":1235}}', JSON.stringify({ type: 'file_content', path: '.soma/index_journal.json' }), 0.8, now - 3, now, 'index_noise', 'index_noise', 'cold');
  insert.run('business-duplicate', 'Shower glass business planning should model starting capital, pricing, installation labor, margins, and a three-year plan.', JSON.stringify({ type: 'conversation' }), 1, now - 4, now, 'finance', 'business_planning', 'cold');
  insert.run('empty-1', '', '{}', 0, now - 5, now, 'general', 'general', 'cold');
  db.close();
}

test('classifier protects lessons containing the word fingerprint', () => {
  const lesson = classifyMemoryAdmission({
    content: 'Do not repeat this action fingerprint without new evidence.',
    metadata: { type: 'goal_lesson', importance: 8 },
    importance: 8
  });
  assert.equal(lesson.state, 'episodic_admitted');
  const journal = classifyMemoryAdmission({
    content: '{"C:\\\\a":{"fingerprint":"1","contentIndexed":true,"indexedAt":2},"D:\\\\b":{"fingerprint":"2","contentIndexed":true,"indexedAt":3}}',
    metadata: { path: '.soma/index_journal.json' }
  });
  assert.equal(journal.state, 'rejected_noise');
});

test('gold decisions remain effective when a newer automated proposal disagrees', t => {
  const { index } = tempPaths(t);
  const ledger = new MemoryAdmissionLedger({ dbPath: index }).initialize();
  const hash = memoryContentHash('important memory');
  ledger.appendDecision({ memoryId: 'm1', state: 'episodic_admitted', reason: 'manual review', contentHash: hash, actor: 'owner', goldLocked: true });
  ledger.appendDecision({ memoryId: 'm1', state: 'rejected_noise', reason: 'automated guess', contentHash: hash, actor: 'classifier' });
  const resolved = ledger.resolve('m1', { contentHash: hash });
  assert.equal(resolved.status, 'effective');
  assert.equal(resolved.decision.state, 'episodic_admitted');
  assert.equal(resolved.protectedByGoldLock, true);
  assert.equal(ledger.listForMemory('m1').length, 2);
  const stale = ledger.ensureDecision({ id: 'm1', content: 'changed content', metadata: {} });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.admitted, false);
  assert.equal(ledger.listForMemory('m1').length, 2);
  ledger.close();
});

test('chunking preserves parent-sized passages with overlap', () => {
  const text = `${'alpha '.repeat(160)}. ${'beta '.repeat(160)}. ${'gamma '.repeat(160)}`;
  const chunks = chunkMemoryText(text, { maxChars: 500, overlapChars: 80 });
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(chunk => chunk.length <= 500));
  assert.ok(chunks.join(' ').includes('gamma'));
});

test('parallel semantic index classifies, embeds, retrieves, and skips unchanged records', async t => {
  const paths = tempPaths(t);
  createSource(paths.source);
  const index = new SemanticMemoryIndex({ dbPath: paths.index, encoderModel: 'fake/bge-small', encoderVersion: 'test-v1', dimensions: 8, embed: fakeEmbed, logger: { info() {}, warn() {} } });
  index.initialize();
  const first = await index.syncFromSource({ sourceDbPath: paths.source, limit: 'all' });
  assert.equal(first.scanned, 6);
  assert.equal(first.indexed, 3);
  assert.equal(first.skipped, 3);
  assert.equal(first.duplicates, 1);
  assert.equal(index.counts().documents, 3);
  const second = await index.syncFromSource({ sourceDbPath: paths.source, limit: 'all' });
  assert.equal(second.unchanged, 3);
  assert.equal(second.duplicates, 1);
  const pending = await index.syncFromSource({ sourceDbPath: paths.source, limit: 2, pendingOnly: true });
  assert.equal(pending.scanned, 0);
  assert.equal(pending.indexed, 0);
  const loop = await index.search('why should the same failed approach not retry without a new artifact', { limit: 3 });
  assert.equal(loop[0].id, 'lesson-1');
  assert.ok(loop[0].channels.includes('dense'));
  const identity = await index.search('who is the creator and partner called Owner', { limit: 3 });
  assert.equal(identity[0].id, 'owner-1');
  assert.equal(index.getMeta('encoder_id').value, 'fake/bge-small@test-v1');
  index.close();
});

test('quality promotion is gated and behavior constraints block unchanged retries', async t => {
  const paths = tempPaths(t);
  createSource(paths.source);
  const substrate = new MemorySubstrateV2({ sourceDbPath: paths.source, indexDbPath: paths.index, encoderModel: 'fake/bge-small', encoderVersion: 'test-v1', embed: fakeEmbed, logger: { info() {}, warn() {} }, minimumPromotionFixtures: 3, minimumPromotionCoverage: 1 });
  await substrate.initialize();
  await substrate.sync({ limit: 'all' });
  const gate = new MemoryRetrievalQualityGate({ minimumRecallAtK: 1, minimumMrr: 0.8, topK: 3 });
  const evaluation = await gate.evaluate(substrate, [
    { name: 'loop lesson', query: 'failed unchanged retry artifact plan', expectedIds: ['lesson-1'] },
    { name: 'identity', query: 'Owner creator Owner partner', expectedIds: ['owner-1'] },
    { name: 'business', query: 'shower glass starting capital pricing', expectedIds: ['business-1'] }
  ]);
  assert.equal(evaluation.passed, true);
  assert.throws(() => substrate.promote({ evaluation: { passed: false } }), /did not pass/);
  assert.equal(substrate.status().promotion.coverage, 1);
  substrate.promote({ evaluation });
  assert.equal(substrate.status().authoritative, true);
  substrate.index.recordRelease({ status: 'shadow', metrics: {}, reason: 'later shadow benchmark' });
  assert.equal(substrate.status().authoritative, true);
  const recall = await substrate.recall('why not retry the same failed approach', 3);
  assert.equal(recall.results[0].id, 'lesson-1');
  const verdict = substrate.behaviorGate.evaluateAction(
    { fingerprint: 'same', tools: ['read_file'] },
    { constraints: recall.constraints, previousAttempt: { fingerprint: 'same', tools: ['read_file'] } }
  );
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, 'blocked_unchanged_observation_only_retry');
  substrate.close();
});

test('quality promotion refuses a strong score from a partial corpus', async t => {
  const paths = tempPaths(t);
  createSource(paths.source);
  const substrate = new MemorySubstrateV2({
    sourceDbPath: paths.source,
    indexDbPath: paths.index,
    encoderModel: 'fake/bge-small',
    encoderVersion: 'test-v1',
    embed: fakeEmbed,
    logger: { info() {}, warn() {} },
    minimumPromotionFixtures: 1,
    minimumPromotionCoverage: 0.95
  });
  await substrate.initialize();
  await substrate.sync({ limit: 'all', classifyOnly: true });
  const source = new Database(paths.source, { readonly: true });
  await substrate.index.indexRecord(source.prepare('SELECT * FROM memories WHERE id = ?').get('lesson-1'));
  source.close();
  const evaluation = { passed: true, metrics: { fixtureCount: 1, recallAtK: 1, mrr: 1 } };
  assert.ok(substrate.promotionHealth(evaluation).coverage < 0.95);
  assert.throws(() => substrate.promote({ evaluation }), /index_coverage/);
  substrate.close();
});

test('behavior trace reports the first missing handoff stage', t => {
  const { index } = tempPaths(t);
  const gate = new MemoryBehaviorGate({ dbPath: index }).initialize();
  gate.record({ correlationId: 'turn-1', memoryId: 'm1', stage: 'captured' });
  gate.record({ correlationId: 'turn-1', memoryId: 'm1', stage: 'admitted' });
  const summary = gate.summarize('turn-1');
  assert.equal(summary.complete, false);
  assert.equal(summary.firstMissingStage, 'embedded');
  gate.close();
});

test('canonical facts require provenance and become high-confidence memory records', t => {
  const { index } = tempPaths(t);
  const db = new Database(index);
  const store = new CanonicalMemoryStore({ db }).initialize();
  assert.throws(() => store.upsert({ key: 'x', subject: 'a', predicate: 'b', object: 'c', statement: 'a b c' }), /provenance/);
  const fact = store.upsert({
    key: 'identity.owner', subject: 'Owner', predicate: 'created', object: 'SOMA',
    statement: 'Owner created SOMA.', confidence: 1, sourceMemoryIds: ['source-1'], category: 'user_owner'
  });
  const memory = store.asMemoryRecord(fact);
  assert.equal(memory.metadata.type, 'canonical_fact');
  assert.deepEqual(memory.metadata.sourceMemoryIds, ['source-1']);
  assert.equal(memory.importance, 10);
  db.close();
});
