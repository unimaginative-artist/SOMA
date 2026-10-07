import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MemoryAdmissionLedger, memoryContentHash } from './MemoryAdmissionLedger.js';

const DEFAULT_MODEL = 'Xenova/bge-small-en-v1.5';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const TOKEN_RE = /[a-z0-9][a-z0-9_-]{2,}/gi;
const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'before', 'could', 'does',
  'did', 'from', 'have', 'his', 'how', 'into', 'just', 'more', 'not', 'say', 'that', 'the',
  'their', 'there', 'these', 'this', 'was', 'were', 'what', 'when', 'where', 'which', 'who',
  'why', 'with', 'would', 'your'
]);

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function normalizeVector(vector) {
  const out = vector instanceof Float32Array ? vector : Float32Array.from(vector || []);
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function vectorToBuffer(vector) {
  const normalized = normalizeVector(vector);
  return Buffer.from(normalized.buffer, normalized.byteOffset, normalized.byteLength);
}

function bufferToVector(buffer) {
  if (!buffer?.byteLength) return new Float32Array();
  const copy = Uint8Array.from(buffer);
  return new Float32Array(copy.buffer);
}

function dot(a, b) {
  if (!a?.length || a.length !== b?.length) return -1;
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i] * b[i];
  return score;
}

function uniqueTerms(text = '') {
  return [...new Set((String(text).match(TOKEN_RE) || []).map(term => term.toLowerCase()))]
    .filter(term => !STOPWORDS.has(term))
    .slice(0, 14);
}

function ftsQuery(text = '') {
  const terms = uniqueTerms(text).map(term => `"${term.replace(/"/g, '""')}"*`);
  return terms.length ? terms.join(' OR ') : null;
}

export function chunkMemoryText(content = '', { maxChars = 1200, overlapChars = 160 } = {}) {
  const text = String(content).replace(/\0/g, '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + maxChars);
    if (end < text.length) {
      const floor = cursor + Math.floor(maxChars * 0.6);
      const candidates = [text.lastIndexOf('\n', end), text.lastIndexOf('. ', end), text.lastIndexOf('! ', end), text.lastIndexOf('? ', end)];
      const boundary = Math.max(...candidates);
      if (boundary >= floor) end = boundary + 1;
    }
    const chunk = text.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    cursor = Math.max(cursor + 1, end - overlapChars);
  }
  return chunks;
}

export class SemanticMemoryIndex {
  constructor({
    dbPath = path.resolve('SOMA/memory-semantic.sqlite'),
    encoderModel = DEFAULT_MODEL,
    encoderVersion = 'transformers.js-2.17.2',
    dimensions = null,
    embed = null,
    logger = console,
    queryPrefix = QUERY_PREFIX
  } = {}) {
    this.dbPath = dbPath;
    this.encoderModel = encoderModel;
    this.encoderVersion = encoderVersion;
    this.encoderId = `${encoderModel}@${encoderVersion}`;
    this.dimensions = dimensions;
    this.embedFn = embed;
    this.logger = logger;
    this.queryPrefix = queryPrefix;
    this.db = null;
    this.ledger = null;
    this.pipeline = null;
    this.encoderPromise = null;
  }

  initialize() {
    if (this.db) return this;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS semantic_documents (
        memory_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        category TEXT,
        sector TEXT,
        importance REAL NOT NULL DEFAULT 0,
        source_created_at INTEGER,
        admission_state TEXT NOT NULL,
        admission_decision_id INTEGER NOT NULL,
        encoder_id TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS semantic_chunks (
        chunk_id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        parent_memory_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        vector BLOB NOT NULL,
        encoder_id TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES semantic_documents(memory_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_chunks_memory ON semantic_chunks(memory_id, chunk_index);
      CREATE INDEX IF NOT EXISTS idx_semantic_documents_admission ON semantic_documents(admission_state, importance DESC);
      CREATE TABLE IF NOT EXISTS semantic_index_releases (
        release_id INTEGER PRIMARY KEY AUTOINCREMENT,
        encoder_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('shadow','promoted','rejected')),
        metrics_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_retrieval_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT NOT NULL,
        query_text TEXT NOT NULL,
        backend TEXT NOT NULL,
        result_ids_json TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS semantic_fts USING fts5(
        chunk_id UNINDEXED,
        memory_id UNINDEXED,
        content,
        tokenize = 'porter unicode61'
      );
    `);
    const storedEncoder = this.db.prepare("SELECT value FROM semantic_index_meta WHERE key = 'encoder_id'").get()?.value;
    const storedDimensions = Number(this.db.prepare("SELECT value FROM semantic_index_meta WHERE key = 'dimensions'").get()?.value || 0);
    if (storedEncoder === this.encoderId && storedDimensions > 0 && this.dimensions == null) this.dimensions = storedDimensions;
    this.ledger = new MemoryAdmissionLedger({ db: this.db }).initialize();
    return this;
  }

  close() {
    this.ledger = null;
    if (this.db?.open) this.db.close();
    this.db = null;
  }

  async initializeEncoder() {
    if (this.embedFn || this.pipeline) return;
    if (this.encoderPromise) return this.encoderPromise;
    this.encoderPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = await pipeline('feature-extraction', this.encoderModel, { quantized: true });
      this.logger.info?.(`[SemanticMemory] Encoder ready: ${this.encoderId}`);
    })().finally(() => { this.encoderPromise = null; });
    return this.encoderPromise;
  }

  async embed(text, { query = false } = {}) {
    if (!this.embedFn && !this.pipeline) await this.initializeEncoder();
    const input = query && /bge/i.test(this.encoderModel) ? `${this.queryPrefix}${text}` : String(text);
    let vector;
    if (this.embedFn) vector = await this.embedFn(input, { query, model: this.encoderModel });
    else {
      const output = await this.pipeline(input, { pooling: 'mean', normalize: true });
      vector = output.data;
    }
    const normalized = normalizeVector(vector);
    if (!normalized.length) throw new Error('Encoder returned an empty vector');
    if (this.dimensions == null) this.dimensions = normalized.length;
    if (normalized.length !== this.dimensions) {
      throw new Error(`Encoder dimension mismatch: expected ${this.dimensions}, received ${normalized.length}`);
    }
    return normalized;
  }

  _sourceRows(sourceDb, limit, { pendingOnly = false } = {}) {
    const columns = new Set(sourceDb.prepare('PRAGMA table_info(memories)').all().map(row => row.name));
    const field = name => columns.has(name) ? name : `NULL AS ${name}`;
    const baseSql = `
      SELECT id, content, metadata, importance, created_at, accessed_at,
             ${field('category')}, ${field('sector')}, ${field('tier')}
      FROM memories
      ORDER BY importance DESC, created_at DESC
    `;
    if (!pendingOnly) {
      const sql = `${baseSql} ${Number.isFinite(limit) ? 'LIMIT ?' : ''}`;
      return Number.isFinite(limit) ? sourceDb.prepare(sql).all(limit) : sourceDb.prepare(sql).all();
    }

    const rows = [];
    const currentDocument = this.db.prepare(`
      SELECT content_hash, encoder_id, admission_decision_id
      FROM semantic_documents WHERE memory_id = ?
    `);
    for (const row of sourceDb.prepare(baseSql).iterate()) {
      const contentHash = memoryContentHash(row.content);
      const resolved = this.ledger.resolve(row.id, { contentHash });
      const current = currentDocument.get(row.id);
      const currentMatches = resolved.status === 'effective' && current
        && current.content_hash === contentHash
        && current.encoder_id === this.encoderId
        && Number(current.admission_decision_id) === Number(resolved.decision?.decision_id);
      if (currentMatches) continue;
      if (resolved.status === 'effective' && !resolved.admitted && !current) continue;
      rows.push(row);
      if (Number.isFinite(limit) && rows.length >= limit) break;
    }
    return rows;
  }

  async indexRecord(record = {}, { classifyOnly = false, chunkOptions, goldLocked = false, actor = 'classifier' } = {}) {
    this.initialize();
    if (!record.id) throw new Error('record.id is required');
    if (!classifyOnly) await this.initializeEncoder();
    const row = {
      ...record,
      metadata: parseMetadata(record.metadata),
      importance: Number(record.importance ?? parseMetadata(record.metadata).importance ?? 0)
    };
    const contentHash = memoryContentHash(row.content);
    const current = this.db.prepare('SELECT * FROM semantic_documents WHERE memory_id = ?').get(row.id);
    let resolved = this.ledger.resolve(row.id, { contentHash });
    const decisionCreated = resolved.status !== 'effective';
    if (resolved.status !== 'effective') {
      const canonical = this.db.prepare(`
        SELECT memory_id FROM semantic_documents
        WHERE content_hash = ? AND memory_id <> ?
          AND admission_state IN ('episodic_admitted','artifact_admitted')
        LIMIT 1
      `).get(contentHash, row.id);
      resolved = this.ledger.ensureDecision(row, canonical
        ? { state: 'duplicate_or_stale', reason: `exact_duplicate_of:${canonical.memory_id}`, actor }
        : { goldLocked, actor });
    }
    if (!resolved.admitted) {
      if (current) this._deleteDocument(row.id);
      return { status: resolved.decision?.state || resolved.status, memoryId: row.id, indexed: false, decisionCreated, decision: resolved.decision };
    }
    if (current?.content_hash === contentHash && current.encoder_id === this.encoderId && current.dimensions === this.dimensions) {
      this.db.prepare(`
        UPDATE semantic_documents SET admission_state = ?, admission_decision_id = ?, metadata_json = ?,
          category = ?, sector = ?, importance = ?, source_created_at = ? WHERE memory_id = ?
      `).run(resolved.decision.state, resolved.decision.decision_id, JSON.stringify(row.metadata), row.category || null,
        row.sector || null, row.importance, row.created_at || row.createdAt || null, row.id);
      return { status: 'unchanged', memoryId: row.id, indexed: false, decisionCreated, decision: resolved.decision };
    }
    if (classifyOnly) return { status: 'admitted', memoryId: row.id, indexed: false, decision: resolved.decision };

    const chunks = chunkMemoryText(row.content, chunkOptions);
    const embedded = [];
    for (let index = 0; index < chunks.length; index++) {
      const content = chunks[index];
      embedded.push({
        chunkId: crypto.createHash('sha256').update(`${row.id}:${index}:${content}`).digest('hex').slice(0, 32),
        index,
        content,
        contentHash: memoryContentHash(content),
        vector: await this.embed(content)
      });
    }
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM semantic_fts WHERE memory_id = ?').run(row.id);
      this.db.prepare('DELETE FROM semantic_chunks WHERE memory_id = ?').run(row.id);
      this.db.prepare('DELETE FROM semantic_documents WHERE memory_id = ?').run(row.id);
      this.db.prepare(`
        INSERT INTO semantic_documents
          (memory_id, content_hash, content, metadata_json, category, sector, importance,
           source_created_at, admission_state, admission_decision_id, encoder_id, dimensions, chunk_count, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id, contentHash, String(row.content), JSON.stringify(row.metadata), row.category || null,
        row.sector || null, row.importance, row.created_at || row.createdAt || null,
        resolved.decision.state, resolved.decision.decision_id, this.encoderId, this.dimensions, embedded.length, now
      );
      const insertChunk = this.db.prepare(`
        INSERT INTO semantic_chunks
          (chunk_id, memory_id, parent_memory_id, chunk_index, content, content_hash, vector, encoder_id, dimensions, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare('INSERT INTO semantic_fts(chunk_id, memory_id, content) VALUES (?, ?, ?)');
      for (const item of embedded) {
        insertChunk.run(item.chunkId, row.id, row.id, item.index, item.content, item.contentHash,
          vectorToBuffer(item.vector), this.encoderId, this.dimensions, now);
        insertFts.run(item.chunkId, row.id, item.content);
      }
    })();
    return { status: 'indexed', memoryId: row.id, indexed: true, chunks: embedded.length, decisionCreated, decision: resolved.decision };
  }

  _deleteDocument(memoryId) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM semantic_fts WHERE memory_id = ?').run(memoryId);
      this.db.prepare('DELETE FROM semantic_chunks WHERE memory_id = ?').run(memoryId);
      this.db.prepare('DELETE FROM semantic_documents WHERE memory_id = ?').run(memoryId);
    })();
  }

  async syncFromSource({ sourceDbPath, limit = 1000, classifyOnly = false, pendingOnly = false, chunkOptions, onProgress } = {}) {
    this.initialize();
    if (!sourceDbPath) throw new Error('sourceDbPath is required');
    if (!classifyOnly) await this.initializeEncoder();
    const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
    const numericLimit = limit === 'all' ? Infinity : Math.max(1, Number(limit || 1000));
    const stats = { scanned: 0, classified: 0, indexed: 0, skipped: 0, unchanged: 0, duplicates: 0, errors: [] };
    try {
      const rows = this._sourceRows(sourceDb, numericLimit, { pendingOnly });
      const seenAdmittedHash = new Map();
      for (const row of rows) {
        stats.scanned++;
        try {
          const contentHash = memoryContentHash(row.content);
          const prior = this.ledger.resolve(row.id, { contentHash });
          const canonicalMemoryId = seenAdmittedHash.get(contentHash);
          if (canonicalMemoryId && prior.admitted && !prior.protectedByGoldLock) {
            this.ledger.appendDecision({
              memoryId: row.id,
              state: 'duplicate_or_stale',
              reason: `exact_duplicate_of:${canonicalMemoryId}`,
              contentHash,
              actor: 'exact_hash_deduplicator'
            });
            stats.classified++;
          }
          const result = await this.indexRecord(row, { classifyOnly, chunkOptions });
          if (result.decisionCreated) stats.classified++;
          if (result.indexed) stats.indexed++;
          else if (result.status === 'unchanged') stats.unchanged++;
          else if (!['admitted'].includes(result.status)) {
            stats.skipped++;
            if (result.status === 'duplicate_or_stale') stats.duplicates++;
          }
          if (result.decision && ['episodic_admitted', 'artifact_admitted'].includes(result.decision.state)) {
            seenAdmittedHash.set(contentHash, row.id);
          }
        } catch (error) {
          stats.errors.push({ memoryId: row.id, error: error.message });
        }
        if (onProgress && stats.scanned % 25 === 0) await onProgress({ ...stats });
      }
      this.setMeta('encoder_id', this.encoderId);
      this.setMeta('dimensions', String(this.dimensions || 0));
      this.setMeta('last_sync_at', String(Date.now()));
      this.setMeta('source_db', path.resolve(sourceDbPath));
      return stats;
    } finally {
      sourceDb.close();
    }
  }

  lexicalSearch(query, limit = 20) {
    this.initialize();
    const match = ftsQuery(query);
    if (!match) return [];
    try {
      return this.db.prepare(`
        SELECT f.chunk_id, f.memory_id, f.content, bm25(semantic_fts) AS rank,
               d.category, d.sector, d.importance, d.source_created_at, d.metadata_json
        FROM semantic_fts f JOIN semantic_documents d ON d.memory_id = f.memory_id
        WHERE semantic_fts MATCH ?
        ORDER BY rank ASC LIMIT ?
      `).all(match, Math.max(1, limit)).map(row => ({ ...row, lexicalScore: 1 / (1 + Math.abs(Number(row.rank || 0))) }));
    } catch (error) {
      this.logger.warn?.(`[SemanticMemory] FTS query failed: ${error.message}`);
      return [];
    }
  }

  async denseSearch(query, limit = 20) {
    this.initialize();
    const queryVector = await this.embed(query, { query: true });
    const rows = this.db.prepare(`
      SELECT c.chunk_id, c.memory_id, c.content, c.vector, c.dimensions,
             d.category, d.sector, d.importance, d.source_created_at, d.metadata_json
      FROM semantic_chunks c JOIN semantic_documents d ON d.memory_id = c.memory_id
      WHERE c.encoder_id = ? AND c.dimensions = ?
    `).iterate(this.encoderId, queryVector.length);
    const bestByMemory = new Map();
    for (const row of rows) {
      const score = dot(queryVector, bufferToVector(row.vector));
      const previous = bestByMemory.get(row.memory_id);
      if (!previous || score > previous.semanticScore) bestByMemory.set(row.memory_id, { ...row, semanticScore: score, vector: undefined });
    }
    return [...bestByMemory.values()].sort((a, b) => b.semanticScore - a.semanticScore).slice(0, Math.max(1, limit));
  }

  async search(query, { limit = 8, category = null, dense = true } = {}) {
    this.initialize();
    const started = Date.now();
    const candidateLimit = Math.max(limit * 5, 30);
    const lexical = this.lexicalSearch(query, candidateLimit);
    const queryTerms = uniqueTerms(query);
    let semantic = [];
    if (dense && this.counts().chunks > 0) {
      try { semantic = await this.denseSearch(query, candidateLimit); }
      catch (error) { this.logger.warn?.(`[SemanticMemory] Dense recall unavailable: ${error.message}`); }
    }
    const merged = new Map();
    const add = (row, rank, channel) => {
      if (category && row.category !== category && row.sector !== category) return;
      const current = merged.get(row.memory_id) || { ...row, channels: [], score: 0 };
      current.score += 1 / (60 + rank);
      current.channels.push(channel);
      if (row.semanticScore != null) current.semanticScore = row.semanticScore;
      if (row.lexicalScore != null) current.lexicalScore = row.lexicalScore;
      const content = String(row.content || '').toLowerCase();
      const coverage = queryTerms.length
        ? queryTerms.reduce((count, term) => count + (content.includes(term) ? 1 : 0), 0) / queryTerms.length
        : 0;
      current.termCoverage = Math.max(current.termCoverage || 0, coverage);
      // Importance breaks close ties; it must never overpower direct evidence.
      current.score += Math.min(0.0005, Math.max(0, Number(row.importance || 0)) * 0.00005);
      const metadata = parseMetadata(row.metadata_json);
      if (metadata.type === 'canonical_fact') current.score += 0.025 * Number(metadata.confidence ?? 1);
      merged.set(row.memory_id, current);
    };
    lexical.forEach((row, index) => add(row, index + 1, 'lexical'));
    semantic.forEach((row, index) => add(row, index + 1, 'dense'));
    const results = [...merged.values()]
      .map(row => ({ ...row, score: row.score + Math.pow(row.termCoverage || 0, 2) * 0.02 }))
      .sort((a, b) => b.score - a.score || Number(b.importance || 0) - Number(a.importance || 0))
      .slice(0, Math.max(1, limit))
      .map(row => ({
        id: row.memory_id,
        memoryId: row.memory_id,
        chunkId: row.chunk_id,
        content: row.content,
        metadata: parseMetadata(row.metadata_json),
        category: row.category,
        sector: row.sector,
        importance: row.importance,
        createdAt: row.source_created_at,
        score: Number(row.score.toFixed(6)),
        similarity: row.semanticScore == null ? null : Number(row.semanticScore.toFixed(6)),
        channels: row.channels,
        termCoverage: Number((row.termCoverage || 0).toFixed(4))
      }));
    this.db.prepare(`
      INSERT INTO memory_retrieval_events(query_hash, query_text, backend, result_ids_json, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.createHash('sha256').update(String(query)).digest('hex'), String(query).slice(0, 1000),
      semantic.length ? 'hybrid_dense_fts' : 'fts_only', JSON.stringify(results.map(row => row.id)), Date.now() - started, Date.now()
    );
    return results;
  }

  setMeta(key, value) {
    this.initialize();
    this.db.prepare(`
      INSERT INTO semantic_index_meta(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(String(key), String(value), Date.now());
  }

  getMeta(key) {
    this.initialize();
    return this.db.prepare('SELECT value, updated_at FROM semantic_index_meta WHERE key = ?').get(String(key)) || null;
  }

  recordRelease({ status = 'shadow', metrics = {}, reason = 'quality gate pending' } = {}) {
    this.initialize();
    const info = this.db.prepare(`
      INSERT INTO semantic_index_releases(encoder_id, status, metrics_json, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(this.encoderId, status, JSON.stringify(metrics), reason, Date.now());
    return Number(info.lastInsertRowid);
  }

  latestRelease() {
    this.initialize();
    const row = this.db.prepare('SELECT * FROM semantic_index_releases ORDER BY release_id DESC LIMIT 1').get();
    return row ? { ...row, metrics: parseMetadata(row.metrics_json) } : null;
  }

  releaseById(releaseId) {
    this.initialize();
    const row = this.db.prepare('SELECT * FROM semantic_index_releases WHERE release_id = ?').get(Number(releaseId));
    return row ? { ...row, metrics: parseMetadata(row.metrics_json) } : null;
  }

  counts() {
    this.initialize();
    return {
      documents: this.db.prepare('SELECT COUNT(*) n FROM semantic_documents').get().n,
      sourceDocuments: this.db.prepare("SELECT COUNT(*) n FROM semantic_documents WHERE memory_id NOT LIKE 'canonical_%'").get().n,
      chunks: this.db.prepare('SELECT COUNT(*) n FROM semantic_chunks').get().n,
      decisions: this.db.prepare('SELECT COUNT(*) n FROM memory_admission_decisions').get().n,
      retrievals: this.db.prepare('SELECT COUNT(*) n FROM memory_retrieval_events').get().n
    };
  }
}

export default SemanticMemoryIndex;
