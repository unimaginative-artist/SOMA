import path from 'node:path';
import { SemanticMemoryIndex } from './SemanticMemoryIndex.js';
import { MemoryBehaviorGate } from './MemoryBehaviorGate.js';
import { CanonicalMemoryStore } from './CanonicalMemoryStore.js';

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return /^(?:1|true|yes|on)$/i.test(value);
}

/**
 * Governed facade for SOMA's next-generation memory. It remains shadow-only
 * until an evaluation release is explicitly promoted, so the legacy store is
 * never silently replaced.
 */
export class MemorySubstrateV2 {
  constructor({
    sourceDbPath = path.resolve('SOMA/soma-memory.db'),
    indexDbPath = path.resolve('SOMA/memory-semantic.sqlite'),
    encoderModel = process.env.SOMA_MEMORY_ENCODER || 'Xenova/bge-small-en-v1.5',
    encoderVersion = 'transformers.js-2.17.2',
    embed = null,
    logger = console,
    forceAuthority = boolEnv('SOMA_MEMORY_V2_AUTHORITY', false),
    shadowSampleRate = Number(process.env.SOMA_MEMORY_V2_SHADOW_SAMPLE_RATE || 0),
    minimumPromotionFixtures = Number(process.env.SOMA_MEMORY_V2_MIN_FIXTURES || 8),
    minimumPromotionCoverage = Number(process.env.SOMA_MEMORY_V2_MIN_COVERAGE || 0.95)
  } = {}) {
    this.sourceDbPath = sourceDbPath;
    this.indexDbPath = indexDbPath;
    this.logger = logger;
    this.forceAuthority = forceAuthority;
    this.shadowSampleRate = Math.max(0, Math.min(1, shadowSampleRate));
    this.minimumPromotionFixtures = Math.max(1, minimumPromotionFixtures);
    this.minimumPromotionCoverage = Math.max(0, Math.min(1, minimumPromotionCoverage));
    this.index = new SemanticMemoryIndex({ indexDbPath, dbPath: indexDbPath, encoderModel, encoderVersion, embed, logger });
    this.behaviorGate = null;
    this.canonical = null;
    this.lastRecall = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this;
    this.index.initialize();
    this.behaviorGate = new MemoryBehaviorGate({ db: this.index.db }).initialize();
    this.canonical = new CanonicalMemoryStore({ db: this.index.db }).initialize();
    this.initialized = true;
    return this;
  }

  isAuthoritative() {
    if (this.forceAuthority) return true;
    const activeReleaseId = Number(this.index.getMeta('active_release_id')?.value || 0);
    const release = activeReleaseId ? this.index.releaseById(activeReleaseId) : null;
    return release?.status === 'promoted' && release.encoder_id === this.index.encoderId;
  }

  async recall(query, topK = 5, options = {}) {
    await this.initialize();
    const authoritative = this.isAuthoritative();
    const shouldShadow = options.forceShadow === true || Math.random() < this.shadowSampleRate;
    if (!authoritative && !shouldShadow) {
      return { results: [], tier: 'semantic-v2-shadow', authoritative: false, skipped: 'quality_gate_not_promoted' };
    }
    const started = Date.now();
    const correlationId = options.correlationId || this.behaviorGate.createCorrelationId('recall');
    const results = await this.index.search(query, { limit: topK, category: options.category, dense: options.dense !== false });
    for (const result of results) {
      this.behaviorGate.record({ correlationId, memoryId: result.id, stage: 'retrieved', evidence: { query, score: result.score, channels: result.channels } });
    }
    const constraints = this.behaviorGate.deriveConstraints(results);
    this.lastRecall = { query, resultIds: results.map(row => row.id), latencyMs: Date.now() - started, authoritative, correlationId, constraints };
    return { results, tier: 'semantic-v2', authoritative, shadow: !authoritative, correlationId, constraints, latency: Date.now() - started };
  }

  async search(query, options = {}) {
    const payload = await this.recall(query, options.limit || 8, { ...options, forceShadow: true });
    return payload.results;
  }

  async sync(options = {}) {
    await this.initialize();
    return this.index.syncFromSource({ sourceDbPath: this.sourceDbPath, ...options });
  }

  async ingestMemory(record = {}) {
    await this.initialize();
    if (!record.id) return { indexed: false, status: 'missing_id' };
    const shouldEmbed = this.isAuthoritative() || boolEnv('SOMA_MEMORY_V2_INDEX_WRITES', false);
    return this.index.indexRecord(record, { classifyOnly: !shouldEmbed });
  }

  async upsertCanonicalFact(fact) {
    await this.initialize();
    const stored = this.canonical.upsert(fact);
    const record = this.canonical.asMemoryRecord(stored);
    return this.index.indexRecord(record, { goldLocked: true, actor: 'canonical_consolidator' });
  }

  promote({ evaluation, comparison = null, reason = 'retrieval quality gate passed' } = {}) {
    if (!evaluation?.passed) throw new Error('Cannot promote semantic memory: candidate evaluation did not pass');
    if (comparison && !comparison.passed) throw new Error('Cannot promote semantic memory: candidate did not beat baseline');
    const health = this.promotionHealth(evaluation);
    if (!health.eligible) {
      throw new Error(`Cannot promote semantic memory: ${health.reasons.join('; ')}`);
    }
    const releaseId = this.index.recordRelease({ status: 'promoted', metrics: { evaluation, comparison }, reason });
    this.index.setMeta('active_release_id', String(releaseId));
    return { releaseId, authoritative: true };
  }

  reject({ evaluation = {}, reason = 'retrieval quality gate failed' } = {}) {
    return { releaseId: this.index.recordRelease({ status: 'rejected', metrics: evaluation, reason }), authoritative: false };
  }

  promotionHealth(evaluation = null) {
    if (!this.initialized) return { eligible: false, reasons: ['substrate_not_initialized'] };
    const latestMetrics = this.index.latestRelease()?.metrics;
    const measuredEvaluation = evaluation || latestMetrics?.evaluation || latestMetrics || null;
    const counts = this.index.counts();
    const effectiveAdmission = this.index.ledger.effectiveStats();
    const admittedMemories = effectiveAdmission
      .filter(row => row.state === 'episodic_admitted' || row.state === 'artifact_admitted')
      .reduce((sum, row) => sum + Number(row.memories || 0), 0);
    const conflicts = Number(effectiveAdmission.find(row => row.state === 'conflict')?.memories || 0);
    const coverage = admittedMemories > 0 ? Math.min(1, counts.sourceDocuments / admittedMemories) : 0;
    const fixtureCount = Number(measuredEvaluation?.metrics?.fixtureCount || 0);
    const reasons = [];
    if (fixtureCount < this.minimumPromotionFixtures) reasons.push(`fixture_count_${fixtureCount}_below_${this.minimumPromotionFixtures}`);
    if (coverage < this.minimumPromotionCoverage) reasons.push(`index_coverage_${coverage.toFixed(4)}_below_${this.minimumPromotionCoverage}`);
    if (conflicts > 0) reasons.push(`gold_admission_conflicts_${conflicts}`);
    return {
      eligible: reasons.length === 0,
      reasons,
      fixtureCount,
      minimumFixtureCount: this.minimumPromotionFixtures,
      admittedMemories,
      indexedSourceDocuments: counts.sourceDocuments,
      coverage,
      minimumCoverage: this.minimumPromotionCoverage,
      conflicts
    };
  }

  status() {
    if (!this.initialized) return { initialized: false, authoritative: false };
    const promotion = this.promotionHealth();
    return {
      initialized: true,
      authoritative: this.isAuthoritative(),
      encoderId: this.index.encoderId,
      dimensions: this.index.dimensions,
      counts: this.index.counts(),
      admission: this.index.ledger.stats(),
      effectiveAdmission: this.index.ledger.effectiveStats(),
      promotion,
      canonicalFacts: this.canonical.list().length,
      release: this.index.latestRelease(),
      activeRelease: this.index.releaseById(Number(this.index.getMeta('active_release_id')?.value || 0)),
      lastRecall: this.lastRecall
    };
  }

  close() {
    this.behaviorGate = null;
    this.canonical = null;
    this.index.close();
    this.initialized = false;
  }
}

export default MemorySubstrateV2;
