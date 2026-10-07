import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MemorySubstrateV2 } from '../core/memory/MemorySubstrateV2.js';
import { MemoryRetrievalQualityGate } from '../core/memory/MemoryRetrievalQualityGate.js';
import { memoryContentHash } from '../core/memory/MemoryAdmissionLedger.js';

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const has = name => process.argv.includes(`--${name}`);

function lexicalBaseline(sourceDbPath) {
  return {
    async search(query, { limit = 5 } = {}) {
      const db = new Database(sourceDbPath, { readonly: true });
      try {
        const terms = [...new Set(String(query).toLowerCase().match(/[a-z0-9_-]{3,}/g) || [])]
          .filter(term => !['what', 'when', 'where', 'which', 'with', 'that', 'this', 'from', 'about'].includes(term))
          .slice(0, 10);
        if (!terms.length) return [];
        const rows = db.prepare(`
          SELECT id, content, importance FROM memories
          WHERE ${terms.map(() => 'LOWER(content) LIKE ?').join(' OR ')}
          ORDER BY importance DESC, created_at DESC LIMIT ?
        `).all(...terms.map(term => `%${term}%`), Math.max(limit * 10, 50));
        return rows.map(row => ({
          ...row,
          score: terms.reduce((score, term) => score + (row.content.toLowerCase().includes(term) ? 1 : 0), 0) / terms.length
        })).sort((a, b) => b.score - a.score || b.importance - a.importance).slice(0, limit);
      } finally {
        db.close();
      }
    }
  };
}

async function atomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

const root = process.cwd();
const sourceDbPath = path.resolve(arg('source', path.join(root, 'SOMA', 'soma-memory.db')));
const indexDbPath = path.resolve(arg('index', path.join(root, 'SOMA', 'memory-semantic.sqlite')));
const fixturePath = path.resolve(arg('fixtures', path.join(root, 'config', 'memory-retrieval-fixtures.json')));
const canonicalPath = path.resolve(arg('canonical', path.join(root, 'config', 'canonical-memory-facts.json')));
const goldPath = path.resolve(arg('gold', path.join(root, 'config', 'gold-memory-admissions.json')));
const reportPath = path.resolve(arg('report', path.join(root, 'Artifacts', 'memory-substrate-v2-evaluation.json')));
const encoderModel = arg('model', process.env.SOMA_MEMORY_ENCODER || 'Xenova/bge-small-en-v1.5');
const limitArg = arg('limit', '1000');
const limit = limitArg === 'all' ? 'all' : Math.max(1, Number(limitArg));
const classifyOnly = has('classify-only');
const pendingOnly = has('pending-only');
const showProgress = has('progress') || process.stdout.isTTY;
const fixtures = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const canonicalFacts = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
const goldAdmissions = JSON.parse(await fs.readFile(goldPath, 'utf8'));

const substrate = new MemorySubstrateV2({ sourceDbPath, indexDbPath, encoderModel });
await substrate.initialize();
try {
  // Always index the gold retrieval fixtures first. A bounded shadow build can
  // therefore be evaluated honestly without depending on source sort order.
  if (!classifyOnly) {
    const source = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
    try {
      const fixtureIds = [...new Set(fixtures.flatMap(item => item.expectedIds || []))];
      const find = source.prepare('SELECT * FROM memories WHERE id = ?');
      for (const gold of goldAdmissions) {
        const row = find.get(gold.memoryId);
        if (!row) throw new Error(`Gold admission ${gold.memoryId} has no live source row`);
        const content = String(row.content).toLowerCase();
        const missing = (gold.mustContain || []).filter(term => !content.includes(String(term).toLowerCase()));
        if (missing.length) throw new Error(`Gold admission ${gold.memoryId} failed content check: ${missing.join(', ')}`);
        const alreadyLocked = substrate.index.ledger.listForMemory(gold.memoryId).some(decision => decision.gold_locked === 1);
        if (!alreadyLocked) {
          substrate.index.ledger.appendDecision({
            memoryId: gold.memoryId,
            state: gold.state,
            reason: gold.reason,
            contentHash: memoryContentHash(row.content),
            actor: 'verified_retrieval_fixture',
            goldLocked: true
          });
        }
      }
      for (const id of fixtureIds) {
        const row = find.get(id);
        if (row) await substrate.index.indexRecord(row);
      }
      for (const fact of canonicalFacts) {
        const sources = fact.sourceMemoryIds.map(id => find.get(id)).filter(Boolean);
        if (!sources.length) throw new Error(`Canonical fact ${fact.key} has no live provenance rows`);
        const evidence = sources.map(row => row.content).join('\n').toLowerCase();
        const missing = (fact.sourceMustContain || []).filter(term => !evidence.includes(String(term).toLowerCase()));
        if (missing.length) throw new Error(`Canonical fact ${fact.key} failed provenance check: ${missing.join(', ')}`);
        await substrate.upsertCanonicalFact(fact);
      }
    } finally {
      source.close();
    }
  }

  const sync = await substrate.sync({
    limit,
    classifyOnly,
    pendingOnly,
    onProgress: showProgress
      ? progress => process.stdout.write(`\r[semantic-memory] scanned=${progress.scanned} indexed=${progress.indexed} skipped=${progress.skipped} errors=${progress.errors.length}`)
      : null
  });
  if (showProgress) process.stdout.write('\n');

  let evaluation = null;
  let baseline = null;
  let comparison = null;
  if (!classifyOnly) {
    const gate = new MemoryRetrievalQualityGate({ minimumRecallAtK: 0.75, minimumMrr: 0.6, topK: 5 });
    evaluation = await gate.evaluate(substrate, fixtures);
    baseline = await gate.evaluate(lexicalBaseline(sourceDbPath), fixtures);
    comparison = gate.compare(evaluation, baseline);
    if (has('promote')) substrate.promote({ evaluation, comparison, reason: 'BGE shadow index passed fixed retrieval suite and beat lexical baseline' });
    else substrate.index.recordRelease({ status: evaluation.passed ? 'shadow' : 'rejected', metrics: { evaluation, baseline, comparison }, reason: 'automated shadow evaluation' });
  }

  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceDbPath,
    indexDbPath,
    fixturePath,
    canonicalPath,
    goldPath,
    encoderModel,
    limit,
    classifyOnly,
    pendingOnly,
    sync,
    evaluation,
    baseline,
    comparison,
    status: substrate.status()
  };
  await atomicJson(reportPath, report);
  console.log(JSON.stringify({ reportPath, sync, evaluation: evaluation?.metrics || null, baseline: baseline?.metrics || null, comparison, authoritative: substrate.isAuthoritative() }, null, 2));
  if (sync.errors.length) process.exitCode = 2;
  if (has('promote') && !substrate.isAuthoritative()) process.exitCode = 3;
} finally {
  substrate.close();
}
