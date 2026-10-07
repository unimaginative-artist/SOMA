import crypto from 'node:crypto';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';

export const OUTCOME_STATES = Object.freeze([
  'unknown',
  'verified_success',
  'verified_failure',
  'conflicted'
]);

export const AUTHORITATIVE_SIGNAL_TYPES = new Set([
  'explicit_user_feedback',
  'operator_verdict',
  'tool_receipt',
  'test_receipt',
  'artifact_verification',
  'goal_verification',
  'runtime_failure',
  'real_world_outcome'
]);

export const ADVISORY_SIGNAL_TYPES = new Set([
  'implicit_user_language',
  'model_confidence',
  'critic_assessment',
  'nemesis_verdict',
  'verifier_verdict',
  'latency_observation'
]);

const SECRET_KEY = /(?:api[_-]?key|authorization|cookie|credential|password|secret|token)/i;

function compact(value, max = 2000) {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function redactText(value, max = 2000) {
  const text = compact(value, max);
  if (!text) return text;
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_SECRET]')
    .replace(/\b(api[_-]?key|password|secret|token)\b(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]');
}

function safeJson(value = {}) {
  const walk = (current, depth = 0) => {
    if (depth > 8) return '[MAX_DEPTH]';
    if (current == null || typeof current === 'number' || typeof current === 'boolean') return current;
    if (typeof current === 'string') return redactText(current, 4000);
    if (Array.isArray(current)) return current.slice(0, 100).map(item => walk(item, depth + 1));
    if (typeof current !== 'object') return String(current);
    return Object.fromEntries(Object.entries(current).slice(0, 100).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : walk(item, depth + 1)
    ]));
  };
  return JSON.stringify(walk(value));
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizePolarity(value) {
  const normalized = String(value ?? 'unknown').toLowerCase();
  if (['success', 'positive', 'pass', 'passed', 'accepted', 'true', '1'].includes(normalized)) return 'success';
  if (['failure', 'negative', 'fail', 'failed', 'rejected', 'false', '-1'].includes(normalized)) return 'failure';
  return 'unknown';
}

function validateAuthoritativeEvidence(type, polarity, evidence = {}, actor = '') {
  if (!AUTHORITATIVE_SIGNAL_TYPES.has(type) || polarity === 'unknown') return false;
  if (type === 'explicit_user_feedback') {
    return Number.isFinite(Number(evidence.rating)) || ['accepted', 'corrected', 'rejected'].includes(String(evidence.verdict || '').toLowerCase());
  }
  if (type === 'operator_verdict') {
    return Boolean(actor) && ['accepted', 'corrected', 'rejected'].includes(String(evidence.verdict || '').toLowerCase());
  }
  if (type === 'runtime_failure') return Boolean(evidence.errorCode || evidence.error || evidence.timeout);
  if (type === 'real_world_outcome') return Boolean(evidence.observationId || evidence.source) && evidence.observed === true;
  return Boolean(evidence.receiptId || evidence.artifactPath || evidence.verificationId)
    && (evidence.passed === true || evidence.passed === false);
}

function eventDigest(event) {
  return crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

/**
 * Durable epistemic boundary between observations and learning authority.
 * Every trace starts unknown. Model confidence and implicit language can be
 * stored as advisory evidence, but they can never become reward by themselves.
 */
export class OutcomeTruthLedger extends EventEmitter {
  constructor({
    dbPath = path.resolve('SOMA/outcome-truth.sqlite'),
    db = null,
    clock = () => Date.now(),
    logger = console
  } = {}) {
    super();
    this.dbPath = dbPath;
    this.db = db;
    this.ownsDb = !db;
    this.clock = clock;
    this.logger = logger;
  }

  initialize() {
    if (!this.db) this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outcome_truth_traces (
        trace_id TEXT PRIMARY KEY,
        parent_trace_id TEXT,
        source TEXT NOT NULL,
        session_id TEXT,
        request_id TEXT,
        input_hash TEXT NOT NULL,
        input_excerpt TEXT,
        output_hash TEXT,
        output_excerpt TEXT,
        status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('unknown','verified_success','verified_failure','conflicted')),
        resolution_json TEXT NOT NULL DEFAULT '{}',
        opened_at INTEGER NOT NULL,
        observed_at INTEGER,
        resolved_at INTEGER,
        FOREIGN KEY(parent_trace_id) REFERENCES outcome_truth_traces(trace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_truth_trace_session ON outcome_truth_traces(session_id, opened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_truth_trace_status ON outcome_truth_traces(status, opened_at DESC);

      CREATE TABLE IF NOT EXISTS outcome_truth_components (
        component_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        component_kind TEXT NOT NULL,
        component_id TEXT NOT NULL,
        role TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        observed_at INTEGER NOT NULL,
        UNIQUE(trace_id, component_kind, component_id, role),
        FOREIGN KEY(trace_id) REFERENCES outcome_truth_traces(trace_id)
      );

      CREATE TABLE IF NOT EXISTS outcome_truth_stages (
        stage_id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        component_kind TEXT,
        component_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        observed_at INTEGER NOT NULL,
        previous_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(trace_id) REFERENCES outcome_truth_traces(trace_id)
      );

      CREATE TABLE IF NOT EXISTS outcome_truth_signals (
        signal_id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        polarity TEXT NOT NULL CHECK(polarity IN ('success','failure','unknown')),
        reward REAL NOT NULL DEFAULT 0 CHECK(reward >= -1 AND reward <= 1),
        authoritative INTEGER NOT NULL CHECK(authoritative IN (0,1)),
        actor TEXT NOT NULL,
        reason TEXT,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        supersedes_signal_id INTEGER,
        observed_at INTEGER NOT NULL,
        previous_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE,
        FOREIGN KEY(trace_id) REFERENCES outcome_truth_traces(trace_id),
        FOREIGN KEY(supersedes_signal_id) REFERENCES outcome_truth_signals(signal_id)
      );
      CREATE INDEX IF NOT EXISTS idx_truth_signal_trace ON outcome_truth_signals(trace_id, observed_at, signal_id);
      CREATE INDEX IF NOT EXISTS idx_truth_signal_authority ON outcome_truth_signals(authoritative, signal_type, observed_at DESC);

      CREATE TABLE IF NOT EXISTS outcome_truth_event_log (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        event_kind TEXT NOT NULL CHECK(event_kind IN ('stage','signal')),
        reference_id INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        previous_hash TEXT,
        event_hash TEXT NOT NULL UNIQUE,
        UNIQUE(event_kind, reference_id),
        FOREIGN KEY(trace_id) REFERENCES outcome_truth_traces(trace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_truth_event_trace ON outcome_truth_event_log(trace_id, event_id DESC);

      CREATE TABLE IF NOT EXISTS outcome_truth_credit (
        credit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        signal_id INTEGER NOT NULL,
        component_kind TEXT NOT NULL,
        component_id TEXT NOT NULL,
        credit REAL NOT NULL CHECK(credit >= -1 AND credit <= 1),
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        method TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(signal_id, component_kind, component_id),
        FOREIGN KEY(trace_id) REFERENCES outcome_truth_traces(trace_id),
        FOREIGN KEY(signal_id) REFERENCES outcome_truth_signals(signal_id)
      );

      CREATE TABLE IF NOT EXISTS outcome_truth_consumptions (
        consumer_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        resolution_fingerprint TEXT NOT NULL,
        consumed_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (consumer_id, trace_id, resolution_fingerprint),
        FOREIGN KEY(trace_id) REFERENCES outcome_truth_traces(trace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_truth_consumption_trace
        ON outcome_truth_consumptions(trace_id, consumed_at DESC);

      CREATE TRIGGER IF NOT EXISTS outcome_truth_signals_no_update
      BEFORE UPDATE ON outcome_truth_signals BEGIN SELECT RAISE(ABORT, 'outcome truth signals are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_truth_signals_no_delete
      BEFORE DELETE ON outcome_truth_signals BEGIN SELECT RAISE(ABORT, 'outcome truth signals are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_truth_stages_no_update
      BEFORE UPDATE ON outcome_truth_stages BEGIN SELECT RAISE(ABORT, 'outcome truth stages are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_truth_stages_no_delete
      BEFORE DELETE ON outcome_truth_stages BEGIN SELECT RAISE(ABORT, 'outcome truth stages are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_truth_event_log_no_update
      BEFORE UPDATE ON outcome_truth_event_log BEGIN SELECT RAISE(ABORT, 'outcome truth event log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_truth_event_log_no_delete
      BEFORE DELETE ON outcome_truth_event_log BEGIN SELECT RAISE(ABORT, 'outcome truth event log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_truth_consumptions_no_update
      BEFORE UPDATE ON outcome_truth_consumptions BEGIN SELECT RAISE(ABORT, 'outcome truth consumptions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_truth_consumptions_no_delete
      BEFORE DELETE ON outcome_truth_consumptions BEGIN SELECT RAISE(ABORT, 'outcome truth consumptions are append-only'); END;
    `);
    this.db.exec(`
      INSERT OR IGNORE INTO outcome_truth_event_log
        (trace_id, event_kind, reference_id, observed_at, previous_hash, event_hash)
      SELECT trace_id, 'stage', stage_id, observed_at, previous_hash, event_hash FROM outcome_truth_stages
      UNION ALL
      SELECT trace_id, 'signal', signal_id, observed_at, previous_hash, event_hash FROM outcome_truth_signals
      ORDER BY observed_at;
    `);
    return this;
  }

  close() {
    this.removeAllListeners();
    if (this.ownsDb && this.db?.open) this.db.close();
    this.db = null;
  }

  createTraceId(prefix = 'truth') {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  beginTrace({ traceId = this.createTraceId(), parentTraceId = null, source = 'unknown', sessionId = null, requestId = null, input = '' } = {}) {
    this.initialize();
    const inputText = redactText(input, 4000) || '';
    this.db.prepare(`
      INSERT OR IGNORE INTO outcome_truth_traces
        (trace_id, parent_trace_id, source, session_id, request_id, input_hash, input_excerpt, opened_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(traceId), parentTraceId ? String(parentTraceId) : null, String(source), sessionId ? String(sessionId) : null,
      requestId ? String(requestId) : null, eventDigest(inputText), inputText, this.clock());
    return this.getTrace(traceId);
  }

  observeOutput(traceId, output, metadata = {}) {
    this.initialize();
    const outputText = redactText(output, 6000) || '';
    const info = this.db.prepare(`
      UPDATE outcome_truth_traces
      SET output_hash = ?, output_excerpt = ?, observed_at = ?
      WHERE trace_id = ?
    `).run(eventDigest(outputText), outputText, this.clock(), String(traceId));
    if (!info.changes) throw new Error(`Unknown outcome trace: ${traceId}`);
    this.recordStage(traceId, 'output_observed', { data: metadata });
    return this.getTrace(traceId);
  }

  linkComponent(traceId, { kind, id, role = null, metadata = {} } = {}) {
    this.initialize();
    if (!kind || !id) throw new Error('Outcome component kind and id are required');
    this._requireTrace(traceId);
    this.db.prepare(`
      INSERT OR IGNORE INTO outcome_truth_components
        (trace_id, component_kind, component_id, role, metadata_json, observed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(traceId), String(kind), String(id), role ? String(role) : null, safeJson(metadata), this.clock());
    return { traceId: String(traceId), kind: String(kind), id: String(id), role };
  }

  recordStage(traceId, stage, { componentKind = null, componentId = null, data = {} } = {}) {
    this.initialize();
    this._requireTrace(traceId);
    const previousHash = this._latestEventHash(traceId);
    const observedAt = this.clock();
    const event = { traceId: String(traceId), stage: String(stage), componentKind, componentId, data: parseJson(safeJson(data)), observedAt, previousHash };
    const eventHash = eventDigest(event);
    const info = this.db.prepare(`
      INSERT INTO outcome_truth_stages
        (trace_id, stage, component_kind, component_id, data_json, observed_at, previous_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(traceId), String(stage), componentKind, componentId, safeJson(data), observedAt, previousHash, eventHash);
    this.db.prepare(`
      INSERT INTO outcome_truth_event_log
        (trace_id, event_kind, reference_id, observed_at, previous_hash, event_hash)
      VALUES (?, 'stage', ?, ?, ?, ?)
    `).run(String(traceId), Number(info.lastInsertRowid), observedAt, previousHash, eventHash);
    return { stageId: Number(info.lastInsertRowid), eventHash, ...event };
  }

  recordSignal(traceId, {
    type,
    polarity = 'unknown',
    reward = null,
    actor = 'system',
    reason = null,
    evidence = {},
    supersedesSignalId = null,
    assignCredit = true
  } = {}) {
    this.initialize();
    if (!type) throw new Error('Outcome signal type is required');
    this._requireTrace(traceId);
    const normalizedPolarity = normalizePolarity(polarity);
    const safeEvidence = parseJson(safeJson(evidence));
    const authoritative = validateAuthoritativeEvidence(String(type), normalizedPolarity, safeEvidence, String(actor));
    const normalizedReward = reward == null
      ? (normalizedPolarity === 'success' ? 1 : normalizedPolarity === 'failure' ? -1 : 0)
      : Math.max(-1, Math.min(1, Number(reward) || 0));
    if (supersedesSignalId) {
      const superseded = this.db.prepare('SELECT * FROM outcome_truth_signals WHERE signal_id = ? AND trace_id = ?').get(Number(supersedesSignalId), String(traceId));
      if (!superseded) throw new Error('Superseded outcome signal must exist on the same trace');
      if (!authoritative) throw new Error('An advisory signal cannot supersede authoritative outcome evidence');
    }
    const previousHash = this._latestEventHash(traceId);
    const observedAt = this.clock();
    const event = {
      traceId: String(traceId), type: String(type), polarity: normalizedPolarity,
      reward: normalizedReward, authoritative, actor: String(actor), reason: redactText(reason, 1000),
      evidence: safeEvidence, supersedesSignalId: supersedesSignalId ? Number(supersedesSignalId) : null,
      observedAt, previousHash
    };
    const eventHash = eventDigest(event);
    const info = this.db.prepare(`
      INSERT INTO outcome_truth_signals
        (trace_id, signal_type, polarity, reward, authoritative, actor, reason, evidence_json,
         supersedes_signal_id, observed_at, previous_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(traceId), String(type), normalizedPolarity, normalizedReward, authoritative ? 1 : 0,
      String(actor), redactText(reason, 1000), safeJson(safeEvidence), supersedesSignalId ? Number(supersedesSignalId) : null,
      observedAt, previousHash, eventHash);
    const signalId = Number(info.lastInsertRowid);
    this.db.prepare(`
      INSERT INTO outcome_truth_event_log
        (trace_id, event_kind, reference_id, observed_at, previous_hash, event_hash)
      VALUES (?, 'signal', ?, ?, ?, ?)
    `).run(String(traceId), signalId, observedAt, previousHash, eventHash);
    const resolution = this._projectResolution(traceId);
    if (authoritative && assignCredit && resolution.status !== 'conflicted') this.assignCredit(traceId, signalId);
    if (authoritative && ['verified_success', 'verified_failure'].includes(resolution.status)) {
      queueMicrotask(() => this.emit('trace_resolved', {
        traceId: String(traceId),
        signalId,
        resolution,
        resolutionFingerprint: eventHash,
      }));
    }
    return { signalId, eventHash, authoritative, resolution, ...event };
  }

  recordImplicitFeedbackForPrevious(sessionId, feedback = {}, { excludeTraceId = null, actor = 'user_language_detector' } = {}) {
    if (!sessionId || feedback.observed !== true) return null;
    const prior = this.previousTraceForSession(sessionId, { excludeTraceId });
    if (!prior) return null;
    const polarity = feedback.userCorrected ? 'failure'
      : Number(feedback.userSatisfaction) >= 0.8 ? 'success'
        : 'unknown';
    return this.recordSignal(prior.trace_id, {
      type: 'implicit_user_language',
      polarity,
      reward: polarity === 'success' ? 0.25 : polarity === 'failure' ? -0.25 : 0,
      actor,
      reason: feedback.reason || 'heuristic language signal; advisory only',
      evidence: { ...feedback, advisoryOnly: true },
      assignCredit: false
    });
  }

  recordExplicitFeedback({ traceId = null, sessionId = null, rating = null, comment = null, actor = 'user' } = {}) {
    this.initialize();
    const target = traceId ? this.db.prepare('SELECT * FROM outcome_truth_traces WHERE trace_id = ?').get(String(traceId))
      : this.previousTraceForSession(sessionId);
    if (!target) return { recorded: false, reason: 'no_matching_trace' };
    const numeric = Number(rating);
    const hasNumeric = rating !== null && rating !== undefined && rating !== '' && Number.isFinite(numeric);
    const polarity = hasNumeric
      ? (numeric > 0 ? 'success' : numeric < 0 ? 'failure' : 'unknown')
      : (/\b(?:wrong|incorrect|bad|failed|not what i asked)\b/i.test(String(comment || '')) ? 'failure'
        : /\b(?:good|correct|helpful|perfect|worked)\b/i.test(String(comment || '')) ? 'success' : 'unknown');
    const verdict = polarity === 'success' ? 'accepted' : polarity === 'failure' ? 'corrected' : 'unknown';
    const signal = this.recordSignal(target.trace_id, {
      type: 'explicit_user_feedback',
      polarity,
      reward: hasNumeric ? Math.max(-1, Math.min(1, numeric)) : null,
      actor,
      reason: compact(comment, 1000) || 'explicit user rating',
      evidence: { rating: hasNumeric ? numeric : null, verdict, comment: compact(comment, 2000) }
    });
    return { recorded: true, traceId: target.trace_id, signal };
  }

  assignCredit(traceId, signalId, weights = null) {
    this.initialize();
    const signal = this.db.prepare('SELECT * FROM outcome_truth_signals WHERE signal_id = ? AND trace_id = ?').get(Number(signalId), String(traceId));
    if (!signal?.authoritative) return { assigned: 0, reason: 'signal_not_authoritative' };
    const components = this.db.prepare('SELECT * FROM outcome_truth_components WHERE trace_id = ?').all(String(traceId));
    if (!components.length) return { assigned: 0, reason: 'no_observed_components' };
    const requested = weights && typeof weights === 'object' ? weights : {};
    const rawWeights = components.map(component => {
      const key = `${component.component_kind}:${component.component_id}`;
      return Math.max(0, Number(requested[key] ?? requested[component.component_kind] ?? 1));
    });
    const total = rawWeights.reduce((sum, value) => sum + value, 0) || components.length;
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO outcome_truth_credit
        (trace_id, signal_id, component_kind, component_id, credit, confidence, method, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const transaction = this.db.transaction(() => components.forEach((component, index) => {
      const weight = (rawWeights[index] || 1) / total;
      insert.run(String(traceId), Number(signalId), component.component_kind, component.component_id,
        Math.max(-1, Math.min(1, Number(signal.reward) * weight)), weights ? 0.8 : 0.5,
        weights ? 'explicit_component_weights' : 'uniform_observed_components', this.clock());
    }));
    transaction();
    return { assigned: components.length, method: weights ? 'explicit_component_weights' : 'uniform_observed_components' };
  }

  previousTraceForSession(sessionId, { excludeTraceId = null } = {}) {
    this.initialize();
    if (!sessionId) return null;
    return this.db.prepare(`
      SELECT * FROM outcome_truth_traces
      WHERE session_id = ? AND (? IS NULL OR trace_id <> ?)
      ORDER BY opened_at DESC LIMIT 1
    `).get(String(sessionId), excludeTraceId, excludeTraceId);
  }

  resolution(traceId) {
    this.initialize();
    this._requireTrace(traceId);
    return this._resolveRows(traceId);
  }

  getTrace(traceId) {
    this.initialize();
    const trace = this.db.prepare('SELECT * FROM outcome_truth_traces WHERE trace_id = ?').get(String(traceId));
    if (!trace) return null;
    const components = this.db.prepare('SELECT * FROM outcome_truth_components WHERE trace_id = ? ORDER BY component_row_id').all(String(traceId));
    const signals = this.db.prepare('SELECT * FROM outcome_truth_signals WHERE trace_id = ? ORDER BY signal_id').all(String(traceId));
    const stages = this.db.prepare('SELECT * FROM outcome_truth_stages WHERE trace_id = ? ORDER BY stage_id').all(String(traceId));
    const credit = this.db.prepare('SELECT * FROM outcome_truth_credit WHERE trace_id = ? ORDER BY credit_id').all(String(traceId));
    return {
      ...trace,
      resolution: parseJson(trace.resolution_json),
      components: components.map(row => ({ ...row, metadata: parseJson(row.metadata_json) })),
      signals: signals.map(row => ({ ...row, authoritative: row.authoritative === 1, evidence: parseJson(row.evidence_json) })),
      stages: stages.map(row => ({ ...row, data: parseJson(row.data_json) })),
      credit
    };
  }

  trainingCandidates({ limit = 100, status = null } = {}) {
    this.initialize();
    const states = status ? [String(status)] : ['verified_success', 'verified_failure'];
    const placeholders = states.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT t.* FROM outcome_truth_traces t
      WHERE t.status IN (${placeholders})
        AND EXISTS (SELECT 1 FROM outcome_truth_signals s WHERE s.trace_id = t.trace_id AND s.authoritative = 1)
      ORDER BY t.resolved_at DESC LIMIT ?
    `).all(...states, Math.max(1, Math.min(1000, Number(limit) || 100)));
    return rows.map(row => this.getTrace(row.trace_id));
  }

  resolutionFingerprint(traceId) {
    this.initialize();
    const row = this.db.prepare(`
      SELECT event_hash FROM outcome_truth_signals
      WHERE trace_id = ? AND authoritative = 1
      ORDER BY signal_id DESC LIMIT 1
    `).get(String(traceId));
    return row?.event_hash || null;
  }

  pendingTrainingCandidates({ consumerId, limit = 100 } = {}) {
    this.initialize();
    if (!consumerId) throw new Error('Outcome Truth consumerId is required');
    const rows = this.db.prepare(`
      SELECT t.trace_id,
        (SELECT s.event_hash FROM outcome_truth_signals s
         WHERE s.trace_id = t.trace_id AND s.authoritative = 1
         ORDER BY s.signal_id DESC LIMIT 1) AS resolution_fingerprint
      FROM outcome_truth_traces t
      WHERE t.status IN ('verified_success', 'verified_failure')
        AND NOT EXISTS (
          SELECT 1 FROM outcome_truth_consumptions c
          WHERE c.consumer_id = ?
            AND c.trace_id = t.trace_id
            AND c.resolution_fingerprint = (
              SELECT s2.event_hash FROM outcome_truth_signals s2
              WHERE s2.trace_id = t.trace_id AND s2.authoritative = 1
              ORDER BY s2.signal_id DESC LIMIT 1
            )
        )
      ORDER BY t.resolved_at, t.trace_id
      LIMIT ?
    `).all(String(consumerId), Math.max(1, Math.min(1000, Number(limit) || 100)));
    return rows.map(row => ({
      trace: this.getTrace(row.trace_id),
      resolutionFingerprint: row.resolution_fingerprint,
    }));
  }

  markTrainingCandidateConsumed(consumerId, traceId, resolutionFingerprint, metadata = {}) {
    this.initialize();
    if (!consumerId || !traceId || !resolutionFingerprint) {
      throw new Error('consumerId, traceId, and resolutionFingerprint are required');
    }
    const info = this.db.prepare(`
      INSERT OR IGNORE INTO outcome_truth_consumptions
        (consumer_id, trace_id, resolution_fingerprint, consumed_at, metadata_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(consumerId), String(traceId), String(resolutionFingerprint), this.clock(), safeJson(metadata));
    return { recorded: info.changes === 1, consumerId, traceId, resolutionFingerprint };
  }

  status() {
    this.initialize();
    const byStatus = this.db.prepare('SELECT status, COUNT(*) count FROM outcome_truth_traces GROUP BY status ORDER BY count DESC').all();
    const signals = this.db.prepare(`
      SELECT authoritative, COUNT(*) count FROM outcome_truth_signals GROUP BY authoritative ORDER BY authoritative DESC
    `).all();
    return {
      dbPath: this.dbPath,
      traces: byStatus.reduce((sum, row) => sum + Number(row.count), 0),
      byStatus,
      signals: {
        authoritative: Number(signals.find(row => row.authoritative === 1)?.count || 0),
        advisory: Number(signals.find(row => row.authoritative === 0)?.count || 0)
      },
      trainingCandidates: this.db.prepare("SELECT COUNT(*) count FROM outcome_truth_traces WHERE status IN ('verified_success','verified_failure')").get().count
    };
  }

  _requireTrace(traceId) {
    const row = this.db.prepare('SELECT trace_id FROM outcome_truth_traces WHERE trace_id = ?').get(String(traceId));
    if (!row) throw new Error(`Unknown outcome trace: ${traceId}`);
    return row;
  }

  _latestEventHash(traceId) {
    const row = this.db.prepare(`
      SELECT event_hash FROM outcome_truth_event_log
      WHERE trace_id = ? ORDER BY event_id DESC LIMIT 1
    `).get(String(traceId));
    return row?.event_hash || null;
  }

  _resolveRows(traceId) {
    const rows = this.db.prepare(`
      SELECT s.* FROM outcome_truth_signals s
      WHERE s.trace_id = ? AND s.authoritative = 1
        AND NOT EXISTS (
          SELECT 1 FROM outcome_truth_signals replacement
          WHERE replacement.supersedes_signal_id = s.signal_id
        )
      ORDER BY s.observed_at, s.signal_id
    `).all(String(traceId));
    const success = rows.filter(row => row.polarity === 'success');
    const failure = rows.filter(row => row.polarity === 'failure');
    const status = success.length && failure.length ? 'conflicted'
      : success.length ? 'verified_success'
        : failure.length ? 'verified_failure' : 'unknown';
    return {
      status,
      authoritativeSignalIds: rows.map(row => row.signal_id),
      positiveEvidence: success.length,
      negativeEvidence: failure.length,
      reward: status === 'conflicted' || status === 'unknown' ? 0
        : rows.reduce((sum, row) => sum + Number(row.reward || 0), 0) / Math.max(1, rows.length)
    };
  }

  _projectResolution(traceId) {
    const resolution = this._resolveRows(traceId);
    const resolvedAt = resolution.status === 'unknown' ? null : this.clock();
    this.db.prepare(`
      UPDATE outcome_truth_traces SET status = ?, resolution_json = ?, resolved_at = ? WHERE trace_id = ?
    `).run(resolution.status, safeJson(resolution), resolvedAt, String(traceId));
    return resolution;
  }
}

export default OutcomeTruthLedger;
