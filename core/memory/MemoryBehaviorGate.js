import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';

export const MEMORY_BEHAVIOR_STAGES = Object.freeze([
  'captured',
  'admitted',
  'embedded',
  'retrieved',
  'injected',
  'acknowledged',
  'enforced',
  'behavior_changed'
]);

const OBSERVATION_LOOP_LESSON = /observation[- ]only loops?.*do not re-propose|do not (?:retry|re-propose).*different.*artifact|unchanged.*(?:retry|approach)/is;

export class MemoryBehaviorGate {
  constructor({ dbPath = path.resolve('SOMA/memory-semantic.sqlite'), db = null } = {}) {
    this.dbPath = dbPath;
    this.db = db;
    this.ownsDb = !db;
  }

  initialize() {
    if (!this.db) this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_behavior_trace (
        trace_id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT NOT NULL,
        memory_id TEXT,
        stage TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_behavior_correlation
        ON memory_behavior_trace(correlation_id, trace_id);
    `);
    return this;
  }

  close() {
    if (this.ownsDb && this.db?.open) this.db.close();
    this.db = null;
  }

  record({ correlationId, memoryId = null, stage, evidence = {} } = {}) {
    if (!this.db) this.initialize();
    if (!correlationId) throw new Error('correlationId is required');
    if (!MEMORY_BEHAVIOR_STAGES.includes(stage)) throw new Error(`Invalid memory behavior stage: ${stage}`);
    const info = this.db.prepare(`
      INSERT INTO memory_behavior_trace(correlation_id, memory_id, stage, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(correlationId), memoryId ? String(memoryId) : null, stage, JSON.stringify(evidence || {}), Date.now());
    return Number(info.lastInsertRowid);
  }

  createCorrelationId(prefix = 'memory') {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  deriveConstraints(retrieved = []) {
    const constraints = [];
    for (const memory of retrieved) {
      const content = String(memory?.content || '');
      if (OBSERVATION_LOOP_LESSON.test(content)) {
        constraints.push({
          id: 'require_changed_artifact_first_plan',
          sourceMemoryId: memory.id || memory.memoryId,
          rule: 'A failed observation-only approach may not be retried without new evidence or a materially different artifact-producing plan.'
        });
      }
    }
    return [...new Map(constraints.map(item => [item.id, item])).values()];
  }

  evaluateAction(action = {}, { constraints = [], previousAttempt = null } = {}) {
    const applicable = constraints.find(item => item.id === 'require_changed_artifact_first_plan');
    if (!applicable || !previousAttempt) return { allowed: true, reason: 'no_blocking_memory_constraint' };
    const sameFingerprint = Boolean(action.fingerprint && previousAttempt.fingerprint && action.fingerprint === previousAttempt.fingerprint);
    const sameTools = JSON.stringify([...(action.tools || [])].sort()) === JSON.stringify([...(previousAttempt.tools || [])].sort());
    const hasNewEvidence = Boolean(action.newEvidence || action.evidenceDelta || action.changedInputs);
    const hasArtifactPlan = Boolean(action.artifactPath || action.patchPlan || action.expectedArtifact);
    if ((sameFingerprint || sameTools) && !hasNewEvidence && !hasArtifactPlan) {
      return {
        allowed: false,
        reason: 'blocked_unchanged_observation_only_retry',
        constraint: applicable
      };
    }
    return { allowed: true, reason: 'materially_changed_or_artifact_first' };
  }

  summarize(correlationId) {
    if (!this.db) this.initialize();
    const rows = this.db.prepare(`
      SELECT stage, memory_id, evidence_json, created_at FROM memory_behavior_trace
      WHERE correlation_id = ? ORDER BY trace_id ASC
    `).all(String(correlationId));
    const present = new Set(rows.map(row => row.stage));
    const firstMissingStage = MEMORY_BEHAVIOR_STAGES.find(stage => !present.has(stage)) || null;
    return {
      correlationId,
      complete: !firstMissingStage,
      firstMissingStage,
      stages: rows.map(row => ({ ...row, evidence: JSON.parse(row.evidence_json || '{}'), evidence_json: undefined }))
    };
  }
}

export default MemoryBehaviorGate;
