import crypto from 'node:crypto';
import Database from 'better-sqlite3';

function stableId(key) {
  return `canonical_${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 20)}`;
}

export class CanonicalMemoryStore {
  constructor({ db, dbPath = null } = {}) {
    this.db = db || (dbPath ? new Database(dbPath) : null);
    this.ownsDb = !db;
  }

  initialize() {
    if (!this.db) throw new Error('db or dbPath is required');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_memory_facts (
        fact_id TEXT PRIMARY KEY,
        fact_key TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        statement TEXT NOT NULL,
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        provenance_json TEXT NOT NULL,
        category TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','disputed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_canonical_subject ON canonical_memory_facts(subject, status);
    `);
    return this;
  }

  upsert({ key, subject, predicate, object, statement, confidence = 1, sourceMemoryIds = [], category = 'general' } = {}) {
    this.initialize();
    if (!key || !subject || !predicate || !object || !statement) throw new Error('canonical fact fields are required');
    if (!sourceMemoryIds.length) throw new Error('canonical facts require at least one provenance memory ID');
    const factId = stableId(key);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO canonical_memory_facts
        (fact_id, fact_key, subject, predicate, object, statement, confidence, provenance_json, category, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(fact_key) DO UPDATE SET
        subject=excluded.subject, predicate=excluded.predicate, object=excluded.object,
        statement=excluded.statement, confidence=excluded.confidence,
        provenance_json=excluded.provenance_json, category=excluded.category,
        status='active', updated_at=excluded.updated_at
    `).run(factId, key, subject, predicate, object, statement, Number(confidence), JSON.stringify(sourceMemoryIds), category, now, now);
    return this.get(key);
  }

  get(key) {
    this.initialize();
    const row = this.db.prepare('SELECT * FROM canonical_memory_facts WHERE fact_key = ?').get(String(key));
    return row ? { ...row, sourceMemoryIds: JSON.parse(row.provenance_json || '[]') } : null;
  }

  list({ status = 'active' } = {}) {
    this.initialize();
    return this.db.prepare('SELECT * FROM canonical_memory_facts WHERE status = ? ORDER BY confidence DESC, updated_at DESC').all(status)
      .map(row => ({ ...row, sourceMemoryIds: JSON.parse(row.provenance_json || '[]') }));
  }

  asMemoryRecord(fact) {
    return {
      id: fact.fact_id,
      content: fact.statement,
      importance: 10,
      category: fact.category,
      sector: 'canonical_fact',
      createdAt: fact.updated_at,
      metadata: {
        type: 'canonical_fact',
        factKey: fact.fact_key,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        confidence: fact.confidence,
        sourceMemoryIds: fact.sourceMemoryIds
      }
    };
  }

  close() {
    if (this.ownsDb && this.db?.open) this.db.close();
    this.db = null;
  }
}

export default CanonicalMemoryStore;
