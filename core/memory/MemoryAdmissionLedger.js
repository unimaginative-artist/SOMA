import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';

export const ADMISSION_STATES = Object.freeze([
  'episodic_admitted',
  'artifact_admitted',
  'diagnostic_only',
  'duplicate_or_stale',
  'rejected_noise'
]);

export const ADMITTED_STATES = new Set(['episodic_admitted', 'artifact_admitted']);
export const DEFAULT_CLASSIFIER_VERSION = 'memory-admission-v2.0.0';

const IMPORTANT_MEMORY_TYPES = new Set([
  'goal_lesson',
  'goal_execution',
  'agentic_finding',
  'user_profile',
  'preference',
  'decision',
  'reflection_summary',
  'canonical_fact'
]);

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export function memoryContentHash(content = '') {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

function looksLikeIndexJournal(content = '', metadata = {}) {
  const text = String(content);
  const sourcePath = String(metadata.path || metadata.absolutePath || '');
  const journalSource = /(?:^|[\\/])(?:index_journal|file[-_]?index|manifest)(?:\.|[\\/])/i.test(sourcePath);
  const structuralPairs = (text.match(/"(?:fingerprint|contentIndexed|indexedAt)"\s*:/g) || []).length;
  const windowsPaths = (text.match(/[A-Z]:\\\\/g) || []).length;
  return (journalSource && structuralPairs >= 2) || (structuralPairs >= 4 && windowsPaths >= 2);
}

function looksLikeCodeArtifact(content = '', metadata = {}) {
  const type = String(metadata.type || '').toLowerCase();
  if (['source_code', 'code_artifact', 'patch', 'diff'].includes(type)) return true;
  const text = String(content).trim();
  const markers = [
    /^(?:import|export|const|let|var|function|class|interface|type)\s+/m,
    /=>\s*\{/,
    /\b(?:console\.(?:log|warn|error)|module\.exports|require\(['"])/,
    /(?:^|\n)\s*[+-]{3}\s+[ab]\//,
    /(?:^|\n)@@\s+-\d+/,
    /;\s*$/m
  ].filter(re => re.test(text)).length;
  return text.length > 500 && markers >= 2;
}

function looksDiagnosticOnly(content = '', metadata = {}) {
  const type = String(metadata.type || '').toLowerCase();
  if (['telemetry', 'health_probe', 'diagnostic', 'debug_log'].includes(type)) return true;
  const text = String(content);
  return /(?:^|\n)(?:GET|POST|PUT|DELETE)\s+https?:\/\/\S+\s+(?:404|500)\b/.test(text)
    || (/\b(?:stack trace|console error|health check)\b/i.test(text) && text.length > 1200);
}

/**
 * Pure, conservative classifier. It deliberately gives known lessons and user
 * facts precedence over artifact/noise heuristics, preventing words such as
 * "fingerprint" from quarantining an otherwise valuable lesson.
 */
export function classifyMemoryAdmission(record = {}) {
  const content = String(record.content || '');
  const metadata = parseMetadata(record.metadata);
  const type = String(metadata.type || '').toLowerCase();
  const importance = Number(record.importance ?? metadata.importance ?? 0);

  if (IMPORTANT_MEMORY_TYPES.has(type) || importance >= 7) {
    return { state: 'episodic_admitted', reason: `protected_high_value:${type || 'importance'}` };
  }
  if (!content.trim()) return { state: 'rejected_noise', reason: 'empty_content' };
  if (looksLikeIndexJournal(content, metadata)) return { state: 'rejected_noise', reason: 'structured_index_journal' };
  if (looksDiagnosticOnly(content, metadata)) return { state: 'diagnostic_only', reason: 'operational_diagnostic' };
  if (looksLikeCodeArtifact(content, metadata)) return { state: 'artifact_admitted', reason: 'source_or_patch_artifact' };
  return { state: 'episodic_admitted', reason: `default_episodic:${type || 'untyped'}` };
}

export class MemoryAdmissionLedger {
  constructor({
    dbPath = path.resolve('SOMA/memory-semantic.sqlite'),
    db = null,
    classifierVersion = DEFAULT_CLASSIFIER_VERSION,
    clock = () => Date.now()
  } = {}) {
    this.dbPath = dbPath;
    this.db = db;
    this.ownsDb = !db;
    this.classifierVersion = classifierVersion;
    this.clock = clock;
  }

  initialize() {
    if (!this.db) this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_admission_decisions (
        decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN (
          'episodic_admitted','artifact_admitted','diagnostic_only','duplicate_or_stale','rejected_noise'
        )),
        reason TEXT NOT NULL,
        classifier_version TEXT NOT NULL,
        actor TEXT NOT NULL,
        gold_locked INTEGER NOT NULL DEFAULT 0 CHECK(gold_locked IN (0,1)),
        previous_decision_id INTEGER,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(previous_decision_id) REFERENCES memory_admission_decisions(decision_id)
      );
      CREATE INDEX IF NOT EXISTS idx_admission_memory_created
        ON memory_admission_decisions(memory_id, created_at DESC, decision_id DESC);
      CREATE INDEX IF NOT EXISTS idx_admission_gold
        ON memory_admission_decisions(memory_id, gold_locked, decision_id DESC);
    `);
    return this;
  }

  close() {
    if (this.ownsDb && this.db?.open) this.db.close();
    this.db = null;
  }

  appendDecision({ memoryId, state, reason, contentHash, actor = 'classifier', goldLocked = false, classifierVersion } = {}) {
    if (!this.db) this.initialize();
    if (!memoryId) throw new Error('memoryId is required');
    if (!ADMISSION_STATES.includes(state)) throw new Error(`Invalid admission state: ${state}`);
    if (!contentHash) throw new Error('contentHash is required');
    const previous = this.db.prepare(`
      SELECT decision_id FROM memory_admission_decisions
      WHERE memory_id = ? ORDER BY created_at DESC, decision_id DESC LIMIT 1
    `).get(memoryId);
    const info = this.db.prepare(`
      INSERT INTO memory_admission_decisions
        (memory_id, state, reason, classifier_version, actor, gold_locked, previous_decision_id, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(memoryId), state, String(reason || 'unspecified'),
      String(classifierVersion || this.classifierVersion), String(actor), goldLocked ? 1 : 0,
      previous?.decision_id || null, String(contentHash), this.clock()
    );
    return this.db.prepare('SELECT * FROM memory_admission_decisions WHERE decision_id = ?').get(info.lastInsertRowid);
  }

  ensureDecision(record = {}, options = {}) {
    if (!this.db) this.initialize();
    const memoryId = String(record.id || record.memoryId || '');
    if (!memoryId) throw new Error('record.id is required');
    const contentHash = memoryContentHash(record.content);
    const resolved = this.resolve(memoryId, { contentHash });
    if (resolved.status === 'effective') return resolved;
    if (resolved.status === 'conflict' || (resolved.status === 'stale' && resolved.decision?.gold_locked === 1)) {
      return resolved;
    }
    const classified = classifyMemoryAdmission(record);
    this.appendDecision({
      memoryId,
      contentHash,
      state: options.state || classified.state,
      reason: options.reason || classified.reason,
      actor: options.actor || 'classifier',
      goldLocked: options.goldLocked === true,
      classifierVersion: options.classifierVersion
    });
    return this.resolve(memoryId, { contentHash });
  }

  resolve(memoryId, { contentHash = null } = {}) {
    if (!this.db) this.initialize();
    const decisions = this.db.prepare(`
      SELECT * FROM memory_admission_decisions
      WHERE memory_id = ? ORDER BY created_at DESC, decision_id DESC
    `).all(String(memoryId));
    if (!decisions.length) return { status: 'missing', admitted: false, decision: null };

    const gold = decisions.filter(row => row.gold_locked === 1);
    if (gold.length && new Set(gold.map(row => row.state)).size > 1) {
      return { status: 'conflict', admitted: false, decision: null, decisions: gold };
    }
    const decision = gold[0] || decisions[0];
    if (contentHash && decision.content_hash !== contentHash) {
      return { status: 'stale', admitted: false, decision };
    }
    return {
      status: 'effective',
      admitted: ADMITTED_STATES.has(decision.state),
      decision,
      protectedByGoldLock: gold.length > 0
    };
  }

  listForMemory(memoryId) {
    if (!this.db) this.initialize();
    return this.db.prepare(`
      SELECT * FROM memory_admission_decisions
      WHERE memory_id = ? ORDER BY created_at ASC, decision_id ASC
    `).all(String(memoryId));
  }

  stats() {
    if (!this.db) this.initialize();
    return this.db.prepare(`
      SELECT state, COUNT(*) AS decisions,
             SUM(CASE WHEN gold_locked = 1 THEN 1 ELSE 0 END) AS gold_locked
      FROM memory_admission_decisions GROUP BY state ORDER BY decisions DESC
    `).all();
  }

  effectiveStats() {
    if (!this.db) this.initialize();
    return this.db.prepare(`
      WITH gold_conflicts AS (
        SELECT memory_id
        FROM memory_admission_decisions
        WHERE gold_locked = 1
        GROUP BY memory_id
        HAVING COUNT(DISTINCT state) > 1
      ), ranked AS (
        SELECT d.*,
               ROW_NUMBER() OVER (
                 PARTITION BY d.memory_id
                 ORDER BY d.gold_locked DESC, d.created_at DESC, d.decision_id DESC
               ) AS effective_rank
        FROM memory_admission_decisions d
        LEFT JOIN gold_conflicts c ON c.memory_id = d.memory_id
        WHERE c.memory_id IS NULL
      )
      SELECT state, COUNT(*) AS memories,
             SUM(CASE WHEN gold_locked = 1 THEN 1 ELSE 0 END) AS gold_locked
      FROM ranked
      WHERE effective_rank = 1
      GROUP BY state
      UNION ALL
      SELECT 'conflict' AS state, COUNT(*) AS memories, COUNT(*) AS gold_locked
      FROM gold_conflicts
      HAVING COUNT(*) > 0
      ORDER BY memories DESC
    `).all();
  }
}

export default MemoryAdmissionLedger;
