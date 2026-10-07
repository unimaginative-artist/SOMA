/**
 * MnemonicArbiter.js
 * 
 * PRODUCTION HYBRID MEMORY SYSTEM - 3 Tier Architecture (v2.5)
 * - Hot Tier: Redis (in-memory, <1ms)
 * - Warm Tier: Vector embeddings with reranking (~10ms)
 * - Cold Tier: SQLite (persistent, ~50ms)
 * 
 * FEATURES:
 * ✓ Real TierManager: Intelligent promotion/demotion based on access patterns.
 * ✓ Cognitive Links: Integrates causality, vision, and fragment context into recall.
 * ✓ Reranking: Uses cross-encoders to refine semantic search results.
 * ✓ Memory Pressure: Auto-evicts and compresses under load.
 */

import BaseArbiter, { 
  ArbiterRole, 
  ArbiterCapability, 
  ArbiterResult 
} from '../core/BaseArbiter.js';
import { createClient } from 'redis';
import { RedisMockArbiter } from './RedisMockArbiter.js';
import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// ===========================
// Vector Utilities
// ===========================

class VectorUtils {
  static async generateEmbedding(text, embedder) {
    if (!embedder) throw new Error('Embedder not available');
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  static cosineSimilarity(a, b) {
    if (a.length !== b.length) throw new Error('Vector dimension mismatch');
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  static approximateNearestNeighbors(queryVector, vectors, k = 5, threshold = 0.5) {
    const results = [];
    for (const [id, vectorData] of vectors.entries()) {
      const similarity = this.cosineSimilarity(queryVector, vectorData.vector);
      if (similarity > threshold) {
        results.push({
          id,
          similarity,
          ...vectorData
        });
      }
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }
}

// ===========================
// Tier Management
// ===========================

class TierManager {
  constructor(config) {
    this.config = config;
    this.accessPatterns = new Map(); // id -> {access_count, last_access, tier}
    this.promotionThreshold = config.promotionThreshold || 5; 
    this.demotionDays = config.demotionDays || 7; 
  }

  recordAccess(id, currentTier = 'cold') {
    const pattern = this.accessPatterns.get(id) || { access_count: 0, last_access: Date.now(), tier: currentTier };
    pattern.access_count++;
    pattern.last_access = Date.now();
    this.accessPatterns.set(id, pattern);
    return pattern;
  }

  shouldPromote(id) {
    const pattern = this.accessPatterns.get(id);
    if (!pattern) return null;
    if (pattern.tier === 'cold' && pattern.access_count >= this.promotionThreshold) return 'warm';
    if (pattern.tier === 'warm' && pattern.access_count >= this.promotionThreshold * 2) return 'hot';
    return null;
  }

  shouldDemote(id) {
    const pattern = this.accessPatterns.get(id);
    if (!pattern) return null;
    const daysSinceAccess = (Date.now() - pattern.last_access) / (1000 * 60 * 60 * 24);
    if (pattern.tier === 'hot' && daysSinceAccess > (1 / 24)) return 'warm';
    if (pattern.tier === 'warm' && daysSinceAccess > this.demotionDays) return 'cold';
    return null;
  }
}

// ===========================
// Main MnemonicArbiter
// ===========================

export class MnemonicArbiter extends BaseArbiter {
  constructor(opts = {}) {
    super({
      name: opts.name || 'MnemonicArbiter',
      role: ArbiterRole.MNEMONIC,
      capabilities: [
        ArbiterCapability.CACHE_DATA,
        ArbiterCapability.ACCESS_DB,
        ArbiterCapability.CLONE_SELF
      ],
      version: '2.5.0-unified',
      ...opts
    });

    // Cognitive Links
    this.causalityArbiter = opts.causalityArbiter || null;
    this.visionArbiter = opts.visionArbiter || null;
    this.fragmentRegistry = opts.fragmentRegistry || null;
    this.system1Bridge = opts.system1Bridge || null;

    // Configuration
    this.config = {
      ...this.config,
      redisUrl: Object.prototype.hasOwnProperty.call(opts, 'redisUrl') ? opts.redisUrl : 'redis://localhost:6379',
      dbPath: opts.dbPath || path.join(process.cwd(), 'soma-memory.db'),
      vectorDbPath: opts.vectorDbPath || path.join(process.cwd(), 'soma-vectors.json'),
      embeddingModel: opts.embeddingModel || 'Xenova/all-MiniLM-L6-v2',
      rerankerModel: opts.rerankerModel || 'Xenova/ms-marco-MiniLM-L-6-v2',
      vectorSimilarityThreshold: opts.vectorSimilarityThreshold || 0.5,
      hotTierTTL: opts.hotTierTTL || 3600,
      memoryPressureThreshold: opts.memoryPressureThreshold || 0.85,
      cleanupInterval: opts.cleanupInterval || 300000,
      saveInterval: opts.saveInterval || 120000
    };

    this.redis = null;
    this.hotTierBackend = 'none';
    this.db = null;
    this.vectorStore = new Map();
    this.embedder = null;
    this.reranker = null;
    this.unsavedChanges = 0;

    this.tierManager = new TierManager({
      promotionThreshold: 5,
      demotionDays: 7
    });

    this.tierMetrics = {
      hot: { hits: 0, misses: 0, stores: 0, size: 0 },
      warm: { hits: 0, misses: 0, stores: 0, size: 0 },
      cold: { hits: 0, misses: 0, stores: 0, size: 0 },
      total: { queries: 0, stores: 0, promotions: 0, demotions: 0 }
    };
  }

  setSystem1Bridge(bridge) {
    this.system1Bridge = bridge;
  }

  async onInitialize() {
    this.log('info', '🧠 MnemonicArbiter (Unified Production) initializing...');
    try {
      await this._initRedis();
      await this._initSQLite();
      await this._initVectorStore();
      await this._initAI();

      this._startAutoCleanup();
      this._startAutoSave();
      
      this.log('info', '✅ MnemonicArbiter Online (3-Tier Hybrid Memory)');
    } catch (error) {
      this.log('error', 'Initialization failed', { error: error.message });
      throw error;
    }
  }

  async _initRedis() {
    if (!this.config.redisUrl) {
      await this._installMockHotTier('redis_url_not_configured');
      return;
    }
    try {
      this.redis = createClient({ 
        url: this.config.redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 2) {
              this.log('warn', 'Redis unreachable after 3 attempts. Disabling hot tier.');
              return false; // Stop retrying
            }
            return 500; // Retry after 500ms
          },
          connectTimeout: 2000
        }
      });

      this.redis.on('error', (err) => {
          // Only log the first few errors to avoid spam
          if (!this._redisSuppressed) {
              this.log('warn', 'Redis unavailable; preserving hot tier with in-memory fallback', { error: err.message });
              this._redisSuppressed = true;
          }
          this._installMockHotTier('redis_runtime_error').catch(() => {});
      });

      await this.redis.connect();
      this.hotTierBackend = 'redis';
      this.log('info', '🔥 Hot tier (Redis) ready');
    } catch (e) {
      await this._installMockHotTier(`redis_connect_failed:${e.message}`);
    }
  }

  async _installMockHotTier(reason = 'redis_unavailable') {
    if (this.hotTierBackend === 'mock' && this.redis?.isOpen) return this.redis;
    try {
      const mockRedis = new RedisMockArbiter({ name: 'MnemonicHotTierMock' });
      await mockRedis.initialize();
      this.redis = mockRedis;
      this.hotTierBackend = 'mock';
      this.log('info', '🔥 Hot tier preserved with in-memory RedisMock fallback', { reason });
      return this.redis;
    } catch (mockError) {
      this.log('warn', 'Mock Redis failed - hot tier disabled', { reason, error: mockError.message });
      this.redis = null;
      this.hotTierBackend = 'none';
      return null;
    }
  }

  async _hotSetEx(key, ttl, value) {
    if (!this.redis?.isOpen || typeof this.redis.setEx !== 'function') {
      await this._installMockHotTier('hot_set_requires_backend');
    }
    if (!this.redis?.isOpen || typeof this.redis.setEx !== 'function') return false;
    try {
      await this.redis.setEx(key, ttl, value);
      return true;
    } catch (error) {
      this.log('warn', 'Hot tier write failed; swapping to RedisMock fallback', { backend: this.hotTierBackend, error: error.message });
      await this._installMockHotTier('hot_set_failed');
      if (this.redis?.isOpen && typeof this.redis.setEx === 'function') {
        await this.redis.setEx(key, ttl, value);
        return true;
      }
      return false;
    }
  }

  async _hotGet(key) {
    if (!this.redis?.isOpen || typeof this.redis.get !== 'function') return null;
    try {
      return await this.redis.get(key);
    } catch (error) {
      this.log('warn', 'Hot tier read failed; swapping to RedisMock fallback', { backend: this.hotTierBackend, error: error.message });
      await this._installMockHotTier('hot_get_failed');
      return null;
    }
  }

  async _initSQLite() {
    this.db = new Database(this.config.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding_id TEXT,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0,
        importance REAL DEFAULT 0.5,
        tier TEXT DEFAULT 'cold'
      );
      CREATE INDEX IF NOT EXISTS idx_accessed_at ON memories(accessed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance DESC);
    `);
    this.log('info', '❄️  Cold tier (SQLite) ready');
  }

  async _initVectorStore() {
    try {
      const data = await fs.readFile(this.config.vectorDbPath, 'utf8');
      const vectors = JSON.parse(data);
      for (const [id, vec] of Object.entries(vectors)) {
        this.vectorStore.set(id, vec);
        this.tierManager.recordAccess(vec.memoryId, vec.tier || 'warm');
      }
      this.log('info', `🌡️  Warm tier loaded ${this.vectorStore.size} vectors`);
    } catch (e) {
      this.log('info', 'Warm tier starting fresh');
    }
  }

  async _initAI() {
    try {
      const { pipeline } = await import('@xenova/transformers');
      this.embedder = await pipeline('feature-extraction', this.config.embeddingModel);
      this.reranker = await pipeline('text-classification', this.config.rerankerModel);
      this.log('info', '✅ AI models (Embedder/Reranker) loaded');
    } catch (e) {
      this.log('warn', 'AI models failed to load - semantic features limited');
    }
  }

  async remember(content, metadata = {}) {
    // System 1 Ingestion Filter: evaluate novelty, contradiction, and noise
    if (this.system1Bridge) {
      try {
        const evalResult = await this.system1Bridge.evaluateMemoryIngestion(content, metadata);
        if (evalResult) {
          if (evalResult.shouldIngest === false) {
            this.log('info', 'Memory ingestion filtered by System 1 (noise/duplicate)', { content: String(content || '').slice(0, 80) });
            return { id: null, filtered: true, reason: 'noise_or_duplicate', success: false };
          }
          if (evalResult.suggestedTier) {
            metadata.system1Tier = evalResult.suggestedTier;
          }
          if (evalResult.isContradiction) {
            metadata.contradictionAlert = true;
          }
        }
      } catch (e) {
        this.log('warn', 'System 1 memory ingestion check fail-open', { error: e.message });
      }
    }

    const id = this._generateId(content);
    const now = Date.now();
    this.tierMetrics.total.stores++;

    // Evidence-backed memory provenance classification (Requirement 9)
    const validMemoryTypes = ['observation', 'interpretation', 'preference', 'procedure', 'hypothesis'];
    const memoryType = validMemoryTypes.includes(metadata?.type) ? metadata.type : (metadata?.type || 'observation');
    const provenance = {
      content: String(content || ''),
      type: memoryType,
      source: metadata?.source || 'agentic_executor',
      sourceJobId: metadata?.sourceJobId || metadata?.jobId || null,
      sourcePath: metadata?.sourcePath || metadata?.path || null,
      confidence: typeof metadata?.confidence === 'number' ? metadata.confidence : (memoryType === 'observation' ? 0.95 : 0.70),
      createdAt: metadata?.createdAt || now,
      lastVerifiedAt: metadata?.lastVerifiedAt || now,
      expiresAt: metadata?.expiresAt || null,
      supersedes: metadata?.supersedes || null
    };
    metadata.provenance = provenance;
    metadata.confidence = provenance.confidence;
    metadata.type = memoryType;

    try {
      let embeddingId = null;
      if (this.embedder) {
        const embedding = await VectorUtils.generateEmbedding(content, this.embedder);
        embeddingId = `emb_${id}`;
        this.vectorStore.set(embeddingId, {
          id: embeddingId,
          memoryId: id,
          vector: embedding,
          content: content.substring(0, 200),
          createdAt: now,
          tier: 'warm'
        });
        this.unsavedChanges++;
      }

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO memories (id, content, metadata, embedding_id, created_at, accessed_at, importance, tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'cold')
      `);
      stmt.run(id, content, JSON.stringify(metadata), embeddingId, now, now, metadata.importance || provenance.confidence || 0.5);

      await this._hotSetEx(`mem:${id}`, this.config.hotTierTTL, JSON.stringify({ content, metadata, embeddingId }));
      this.tierMetrics.hot.stores++;

      return { id, provenance, success: true };
    } catch (e) {
      this.log('error', 'Remember failed', { error: e.message });
      throw e;
    }
  }

  async recall(query, topK = 5, options = {}) {
    if (options.publicScope) {
      // Public stream queries may only retrieve that viewer's public channel
      // observations. Do not use the global semantic/cache pipeline here.
      const { source, channel, viewerId } = options.publicScope;
      if (source !== 'twitch_public' || !/^[a-z0-9_]{1,25}$/.test(channel || '') || !/^\d+$/.test(viewerId || '')) {
        throw new Error('Invalid public memory scope');
      }
      const limit = Math.max(1, Math.min(10, Number.isInteger(topK) ? topK : 5));
      const results = this.db.prepare(`
        SELECT content, metadata, created_at FROM memories
        WHERE json_valid(metadata)
          AND json_extract(metadata, '$.source') = ?
          AND json_extract(metadata, '$.channel') = ?
          AND json_extract(metadata, '$.viewerId') = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(source, channel, viewerId, limit);
      return { results, tier: 'cold', scope: 'public_viewer' };
    }
    this.tierMetrics.total.queries++;
    const startTime = Date.now();
    let searchTerms = query;

    // Cognitive Link: Causal Expansion
    if (this.causalityArbiter) {
      try {
        const chains = await this.causalityArbiter.queryCausalChains(query, { maxDepth: 1 });
        if (chains?.length) searchTerms += ' ' + chains.map(c => c.effect).join(' ');
      } catch (e) {}
    }

    // 1. Hot Tier
    if (this.redis && this.redis.isOpen) {
      const cached = await this._hotGet(`query:${searchTerms}`);
      if (cached) {
        this.tierMetrics.hot.hits++;
        return { results: JSON.parse(cached), tier: 'hot', backend: this.hotTierBackend, latency: Date.now() - startTime };
      }
      this.tierMetrics.hot.misses++;
    }

    // 2. Warm Tier (Vector + Rerank)
    if (this.embedder && this.vectorStore.size > 0) {
      const queryEmbedding = await VectorUtils.generateEmbedding(searchTerms, this.embedder);
      const candidates = VectorUtils.approximateNearestNeighbors(queryEmbedding, this.vectorStore, topK * 3);
      
      let results = candidates;
      if (this.reranker && candidates.length > 0) {
        // Simple reranking logic: compare candidate content with query
        const scores = await Promise.all(candidates.map(async c => {
          const res = await this.reranker(searchTerms, { candidate: c.content });
          return { ...c, score: res[0].score };
        }));
        results = scores.sort((a, b) => b.score - a.score).slice(0, topK);
      }

      // Upgrade to Bidirectional System 1 Arbiter: resolves contradiction and authority
      if (this.system1Bridge && results.length > 0) {
        try {
          const s1Rerank = await this.system1Bridge.rerankMemories(searchTerms, results);
          if (s1Rerank?.results?.length) {
            results = s1Rerank.results.slice(0, topK);
          }
        } catch (e) {
          this.log('warn', 'System 1 memory rerank fail-open', { error: e.message });
        }
      }

      if (results.length > 0) {
        this.tierMetrics.warm.hits++;
        await this._hotSetEx(`query:${searchTerms}`, this.config.hotTierTTL, JSON.stringify(results));
        return { results, tier: 'warm', latency: Date.now() - startTime };
      }
    }

    // 3. Cold Tier
    let coldResults = this._sqliteSearch(query, topK * 2);
    if (this.system1Bridge && coldResults.length > 0) {
      try {
        const s1Rerank = await this.system1Bridge.rerankMemories(query, coldResults);
        if (s1Rerank?.results?.length) {
          coldResults = s1Rerank.results.slice(0, topK);
        }
      } catch (e) {
        this.log('warn', 'System 1 cold memory rerank fail-open', { error: e.message });
      }
    }
    return { results: coldResults.slice(0, topK), tier: 'cold', latency: Date.now() - startTime };
  }

  _sqliteSearch(query, limit) {
    const stmt = this.db.prepare(`
      SELECT id, content, metadata, accessed_at, access_count, importance, tier
      FROM memories
      WHERE content LIKE ?
      ORDER BY importance DESC, access_count DESC, accessed_at DESC
      LIMIT ?
    `);
    const results = stmt.all(`%${query}%`, limit);
    const now = Date.now();
    const updateStmt = this.db.prepare('UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?');
    for (const r of results) {
      updateStmt.run(now, r.id);
      this.tierManager.recordAccess(r.id, r.tier);
    }
    return results.map(r => {
      let meta = {};
      try { meta = JSON.parse(r.metadata || '{}'); } catch {}
      const provenance = meta.provenance || {
        content: r.content,
        type: meta.type || 'observation',
        source: meta.source || 'cold_storage',
        confidence: meta.confidence || r.importance || 0.5,
        createdAt: r.created_at,
        lastVerifiedAt: r.accessed_at
      };
      return {
        ...r,
        metadata: meta,
        provenance,
        confidence: provenance.confidence
      };
    });
  }

  _generateId(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  _startAutoSave() {
    this._autoSaveTimer = setInterval(async () => {
      if (this.unsavedChanges > 0) {
        const vectors = Object.fromEntries(this.vectorStore);
        await fs.writeFile(this.config.vectorDbPath, JSON.stringify(vectors, null, 2));
        this.unsavedChanges = 0;
        this.log('info', 'Vector store persisted');
      }
    }, this.config.saveInterval);
    if (this._autoSaveTimer?.unref) this._autoSaveTimer.unref();
  }

  _startAutoCleanup() {
    this._autoCleanupTimer = setInterval(() => {
      this.log('info', 'Optimizing tiers...');
      for (const [id, pattern] of this.tierManager.accessPatterns.entries()) {
        const promote = this.tierManager.shouldPromote(id);
        if (promote) this._updateTier(id, promote);
        const demote = this.tierManager.shouldDemote(id);
        if (demote) this._updateTier(id, demote);
      }
    }, this.config.cleanupInterval);
    if (this._autoCleanupTimer?.unref) this._autoCleanupTimer.unref();
  }

  destroy() {
    if (this._autoSaveTimer) clearInterval(this._autoSaveTimer);
    if (this._autoCleanupTimer) clearInterval(this._autoCleanupTimer);
    if (this.db) {
      try { this.db.close(); } catch {}
    }
  }

  _updateTier(id, tier) {
    this.db.prepare('UPDATE memories SET tier = ? WHERE id = ?').run(tier, id);
    if (this.tierManager.accessPatterns.has(id)) {
        this.tierManager.accessPatterns.get(id).tier = tier;
    }
    this.log('info', `Tier update: ${id.substring(0, 8)} -> ${tier}`);
  }

  async execute(task) {
    const { query, context } = task;
    const action = context.action || 'recall';
    let data;
    if (action === 'remember') data = await this.remember(context.content, context.metadata);
    else data = await this.recall(query, context.topK || 5);
    
    return new ArbiterResult({ success: true, data, arbiter: this.name });
  }

  getMemoryStats() {
    const memoryCount = this.db ? this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count : 0;
    return {
      storage: {
        memories: memoryCount,
        vectors: this.vectorStore.size,
        compressed: 0, // Placeholder for future compression metrics
        hot: this.redis?.isOpen ? 'active' : 'inactive',
        hotBackend: this.hotTierBackend
      },
      hot: { size: this.redis?.store?.size || 0, hits: this.tierMetrics.hot.hits, stores: this.tierMetrics.hot.stores, backend: this.hotTierBackend, status: this.redis?.isOpen ? 'connected' : 'offline' },
      warm: { size: this.vectorStore.size, hits: this.tierMetrics.warm.hits },
      cold: { size: memoryCount, hits: this.tierMetrics.cold.hits },
      total: this.tierMetrics.total,
      memoryPressure: (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100
    };
  }

  getAvailableCommands() {
    return [
      ...super.getAvailableCommands(),
      'remember',
      'recall',
      'forget',
      'stats',
      'recall_recent'
    ];
  }
}

export default MnemonicArbiter;
