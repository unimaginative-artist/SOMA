/**
 * MnemonicArbiter.js
 * 
 * HYBRID MEMORY SYSTEM - 3 Tier Architecture
 * - Hot Tier: Redis (in-memory, <1ms)
 * - Warm Tier: Vector embeddings (semantic search, ~10ms)
 * - Cold Tier: SQLite (persistent, ~50ms)
 * 
 * Self-optimizing memory with automatic tier promotion/demotion
 */

import BaseArbiter, { 
  ArbiterRole, 
  ArbiterCapability, 
  Task, 
  ArbiterResult 
} from './BaseArbiter.js';
const { createClient } = require('redis.cjs');
const Database = require('better-sqlite3.cjs');
const { pipeline } = require('@xenova/transformers.cjs');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class MnemonicArbiter extends BaseArbiter {
  constructor(opts = {}) {
    super({
      name: opts.name || 'MnemonicArbiter',
      role: ArbiterRole.MNEMONIC,
      capabilities: [
        ArbiterCapability.CACHE_DATA,
        ArbiterCapability.ACCESS_DB,
        ArbiterCapability.CLONE_SELF
      ],
      version: '1.0.0',
      maxContextSize: 200,
      ...opts
    });
    this.tier = 'cognitive';

    // Configuration
    this.config = {
      ...this.config,
      redisUrl: opts.redisUrl || 'redis://localhost:6379',
      dbPath: opts.dbPath || path.join(process.cwd(), 'soma-memory.db'),
      vectorDbPath: opts.vectorDbPath || path.join(process.cwd(), 'soma-vectors.json'),
      hotTierTTL: opts.hotTierTTL || 3600, // 1 hour
      warmTierLimit: opts.warmTierLimit || 10000, // 10k vectors
      embeddingModel: opts.embeddingModel || 'Xenova/all-MiniLM-L6-v2',
      enableAutoCleanup: opts.enableAutoCleanup !== false,
      cleanupInterval: opts.cleanupInterval || 60000, // 1 minute (was 1 hour)
      persistenceInterval: opts.persistenceInterval || 10000 // Save vectors every 10s if changed
    };

    // Storage layers
    this.redis = null; // Hot tier
    this.db = null; // Cold tier (SQLite)
    this.vectorStore = new Map(); // Warm tier (in-memory vectors)
    this.embedder = null; // Embedding pipeline
    this.vectorsDirty = false; // Track changes

    // Metrics
    this.tierMetrics = {
      hot: { hits: 0, misses: 0, size: 0 },
      warm: { hits: 0, misses: 0, size: 0 },
      cold: { hits: 0, misses: 0, size: 0 },
      total: { queries: 0, stores: 0 }
    };

    // Hot tier status tracking
    this.hotTierDegraded = false;
    this.hotTierDegradedAt = null;

    // Cleanup timer
    this.cleanupTimer = null;
  }

  // ===========================
  // Lifecycle
  // ===========================

  async onInitialize() {
    this.log('info', 'MnemonicArbiter initializing hybrid memory...');

    try {
      // Initialize Redis (Hot Tier)
      await this._initRedis();

      // Initialize SQLite (Cold Tier)
      await this._initSQLite();

      // Initialize Vector Store (Warm Tier)
      await this._initVectorStore();

      // Load embedding model
      await this._initEmbedder();

      // Start auto-cleanup
      if (this.config.enableAutoCleanup) {
        this._startAutoCleanup();
      }

      // Start persistence loop
      this._startPersistenceLoop();

      // Register custom handlers
      this.registerMessageHandler('remember', this._handleRemember.bind(this));
      this.registerMessageHandler('recall', this._handleRecall.bind(this));
      this.registerMessageHandler('forget', this._handleForget.bind(this));
      this.registerMessageHandler('stats', this._handleStats.bind(this));
      this.registerMessageHandler('recall_recent', this._handleRecallRecent.bind(this));
      this.registerMessageHandler('deep_cleanup', this._handleDeepCleanup.bind(this));

      this.log('info', 'MnemonicArbiter ready - 3-tier hybrid memory online');
    } catch (error) {
      this.log('error', 'Failed to initialize memory tiers', { error: error.message });
      throw error;
    }
  }

  async onShutdown() {
    this.log('info', 'MnemonicArbiter shutting down...');

    // Stop cleanup
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Save vector store
    await this._saveVectorStore();

    // Close Redis
    if (this.redis) {
      await this.redis.quit();
    }

    // Close SQLite
    if (this.db) {
      this.db.close();
    }

    this.log('info', 'MnemonicArbiter shutdown complete');
  }

  // ===========================
  // Tier Initialization
  // ===========================

  async _initRedis() {
    try {
      this.redis = createClient({ url: this.config.redisUrl });

      this.redis.on('error', (err) => {
        if (!this.hotTierDegraded) {
          // First time degradation - alert operator
          console.error(`\n⚠️  [MnemonicArbiter] HOT TIER DEGRADED - Redis connection lost!`);
          console.error(`   📉 Performance Impact: <1ms → potentially slower fallback to warm/cold tiers`);
          console.error(`   🔧 Action: Check Redis service at ${this.config.redisUrl}`);
          console.error(`   ⏰ Degraded at: ${new Date().toISOString()}\n`);

          this.hotTierDegraded = true;
          this.hotTierDegradedAt = Date.now();
        }
        this.log('warn', 'Redis error (falling back to in-memory)', { error: err.message });
      });

      await this.redis.connect();
      this.log('info', 'Hot tier (Redis) connected');
    } catch (error) {
      // Redis not available at startup
      console.error(`\n⚠️  [MnemonicArbiter] HOT TIER UNAVAILABLE - Redis not accessible!`);
      console.error(`   📉 Performance Impact: <1ms Redis lookups disabled, using slower tiers`);
      console.error(`   🔧 Action: Start Redis service at ${this.config.redisUrl}`);
      console.error(`   ⏰ Time: ${new Date().toISOString()}\n`);

      this.hotTierDegraded = true;
      this.hotTierDegradedAt = Date.now();
      this.redis = null; // Fall back to in-memory

      this.log('warn', 'Redis not available - hot tier disabled', { error: error.message });
    }
  }

  async _initSQLite() {
    try {
      this.db = new Database(this.config.dbPath);
      
      // Create schema
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          metadata TEXT,
          embedding_id TEXT,
          created_at INTEGER NOT NULL,
          accessed_at INTEGER NOT NULL,
          access_count INTEGER DEFAULT 0,
          importance REAL DEFAULT 0.5
        );

        CREATE INDEX IF NOT EXISTS idx_accessed_at ON memories(accessed_at);
        CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance);
        CREATE INDEX IF NOT EXISTS idx_embedding_id ON memories(embedding_id);

        CREATE TABLE IF NOT EXISTS purgatory (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          metadata TEXT,
          original_importance REAL DEFAULT 0.5,
          substance_score REAL DEFAULT 0.0,
          prune_reason TEXT,
          purgatory_at INTEGER NOT NULL
        );
      `);

      this.log('info', 'Cold tier (SQLite) initialized');
    } catch (error) {
      this.log('error', 'Failed to initialize SQLite', { error: error.message });
      throw error;
    }
  }

  async _initVectorStore() {
    try {
      // Try to load existing vectors
      const vectorPath = this.config.vectorDbPath;
      try {
        const data = await fs.readFile(vectorPath, 'utf8');
        const vectors = JSON.parse(data);
        
        for (const [id, vec] of Object.entries(vectors)) {
          this.vectorStore.set(id, vec);
        }
        
        this.log('info', `Warm tier loaded ${this.vectorStore.size} vectors`);
      } catch (e) {
        this.log('info', 'Warm tier starting fresh (no existing vectors)');
      }
    } catch (error) {
      this.log('warn', 'Vector store init warning', { error: error.message });
    }
  }

  async _initEmbedder() {
    try {
      this.log('info', 'Loading embedding model (this may take a moment)...');
      this.embedder = await pipeline('feature-extraction', this.config.embeddingModel);
      this.log('info', 'Embedding model loaded');
    } catch (error) {
      this.log('warn', 'Embedder not available - semantic search disabled', { error: error.message });
      this.embedder = null;
    }
  }

  // ===========================
  // Main Execute
  // ===========================

  async execute(task) {
    const startTime = Date.now();

    try {
      const { query, context } = task;
      const action = context.action || 'recall';

      let result;
      
      switch (action) {
        case 'remember':
          result = await this.remember(context.content, context.metadata);
          break;
        
        case 'recall':
          result = await this.recall(query, context.topK || 5);
          break;
        
        case 'forget':
          result = await this.forget(context.id);
          break;
        
        case 'stats':
          result = this.getMemoryStats();
          break;
        
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return new ArbiterResult({
        success: true,
        data: result,
        confidence: 0.9,
        arbiter: this.name,
        duration: Date.now() - startTime
      });

    } catch (error) {
      this.log('error', 'Memory operation failed', { error: error.message });
      
      return new ArbiterResult({
        success: false,
        error: error.message,
        arbiter: this.name,
        duration: Date.now() - startTime
      });
    }
  }

  // ===========================
  // Core Memory Operations
  // ===========================

  /**
   * Remember - Store new memory across all tiers
   */
  async remember(content, metadata = {}) {
    // SAFETY GUARD: Prevent massive blobs from bloating the DB and hanging reasoning
    if (content && content.length > 100000) {
      this.log('warn', `⚠️ Skipping memory storage: Content too large (${Math.round(content.length/1024)}KB). Probable state dump.`);
      return { success: false, error: 'Content exceeds memory size limit' };
    }

    if (content && (content.includes('"experiences":') || content.includes('"state":'))) {
      this.log('warn', '⚠️ Skipping memory storage: State dump detected.');
      return { success: false, error: 'State dumps should not be stored in semantic memory' };
    }

        // Epistemic verification layer check
    try {
      const { epistemicLayer, CLAIM_TYPE } = await import('../core/EpistemicLayer.js');
      // If it's a generated summary or inference, run it through the Epistemic Layer
      if (metadata.source !== 'raw_extraction' && !metadata.skipEpistemic) {
          const claim = await epistemicLayer.processClaim(content, {
              type: metadata.claimType || CLAIM_TYPE.OBSERVATION,
              metadata: metadata
          });
          
          if (claim.status === 'REJECTED') {
              this.log('warn', `?? Skipping memory storage: Epistemic failure (hallucination detected).`, { reason: claim.metadata?.rejectionReason });
              return { success: false, error: 'Epistemic rejection: hallucinatory or invalid memory' };
          }
      }
    } catch (e) {
      // Graceful fail if epistemic layer is offline
      this.log('warn', `?? Epistemic check failed: ${e.message}`);
    }

    const id = this._generateId(content);
    const now = Date.now();

    this.tierMetrics.total.stores++;

    // Generate embedding
    let embeddingId = null;
    if (this.embedder) {
      try {
        const embedding = await this._generateEmbedding(content);
        embeddingId = `emb_${id}`;
        
        this.vectorStore.set(embeddingId, {
          id: embeddingId,
          memoryId: id,
          vector: embedding,
          content: content.substring(0, 100), // Store snippet
          createdAt: now
        });
        
        this.vectorsDirty = true; // Mark for save

        this.tierMetrics.warm.size = this.vectorStore.size;
      } catch (error) {
        this.log('warn', 'Failed to generate embedding', { error: error.message });
      }
    }

    // Store in cold tier (SQLite) - permanent
    // NOTE: better-sqlite3 is synchronous by design. We wrap in a Promise with setImmediate
    // to yield control back to the event loop, preventing blocking on large operations.
    await new Promise((resolve) => {
      setImmediate(() => {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO memories (id, content, metadata, embedding_id, created_at, accessed_at, access_count, importance)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `);

        stmt.run(
          id,
          content,
          JSON.stringify(metadata),
          embeddingId,
          now,
          now,
          metadata.importance || 0.5
        );

        this.tierMetrics.cold.size = this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
        resolve();
      });
    });

    // Store in hot tier (Redis) - temporary
    if (this.redis) {
      try {
        await this.redis.setEx(
          `mem:${id}`,
          this.config.hotTierTTL,
          JSON.stringify({ content, metadata, embeddingId })
        );
        this.tierMetrics.hot.size++;
      } catch (error) {
        this.log('warn', 'Redis store failed', { error: error.message });
      }
    }

    this.log('info', `Memory stored: ${id.substring(0, 8)}...`);

    return {
      id,
      embeddingId,
      stored: true,
      tiers: {
        hot: !!this.redis,
        warm: !!embeddingId,
        cold: true
      }
    };
  }

  /**
   * Store - Alias for remember() to maintain backwards compatibility
   * Some arbiters use store() instead of remember()
   */
  async store(contentOrData, metadata = {}) {
    // Handle different call signatures
    if (typeof contentOrData === 'string') {
      // Called as store(content, metadata)
      return await this.remember(contentOrData, metadata);
    } else if (typeof contentOrData === 'object' && contentOrData.content) {
      // Called as store({ content, metadata, ... })
      const { content, ...rest } = contentOrData;
      return await this.remember(content, { ...metadata, ...rest });
    } else {
      throw new Error('Invalid arguments to store(): expected string content or object with content property');
    }
  }

  /**
   * Recall - Retrieve memories with 3-tier cascade
   */
  async recall(query, topK = 5) {
    this.tierMetrics.total.queries++;
    const startTime = Date.now();

    // Try hot tier first (Redis)
    if (this.redis) {
      try {
        const cached = await this.redis.get(`query:${query}`);
        if (cached) {
          this.tierMetrics.hot.hits++;
          this.log('info', 'Hot tier hit');
          return {
            results: JSON.parse(cached),
            tier: 'hot',
            latency: Date.now() - startTime
          };
        }
      } catch (error) {
        this.log('warn', 'Redis read failed', { error: error.message });
      }
      this.tierMetrics.hot.misses++;
    }

    // Try warm tier (Vector search)
    if (this.embedder && this.vectorStore.size > 0) {
      try {
        const queryEmbedding = await this._generateEmbedding(query);
        const results = this._vectorSearch(queryEmbedding, topK);
        
        if (results.length > 0) {
          this.tierMetrics.warm.hits++;
          
          // Promote to hot tier
          if (this.redis) {
            await this.redis.setEx(
              `query:${query}`,
              this.config.hotTierTTL,
              JSON.stringify(results)
            );
          }

          this.log('info', 'Warm tier hit (vector search)');
          
          return {
            results,
            tier: 'warm',
            latency: Date.now() - startTime
          };
        }
      } catch (error) {
        this.log('warn', 'Vector search failed', { error: error.message });
      }
      this.tierMetrics.warm.misses++;
    }

    // Fall back to cold tier (SQLite full-text)
    this.tierMetrics.cold.misses++;
    const results = await this._sqliteSearch(query, topK);

    this.log('info', 'Cold tier search');

    // Promote to warm tier if embedder available
    if (this.embedder && results.length > 0) {
      for (const result of results) {
        try {
          const embedding = await this._generateEmbedding(result.content);
          const embId = `emb_${result.id}`;
          
          this.vectorStore.set(embId, {
            id: embId,
            memoryId: result.id,
            vector: embedding,
            content: result.content.substring(0, 100),
            createdAt: Date.now()
          });
        } catch (e) {
          // Skip embedding errors
        }
      }
    }

    // Promote to hot tier
    if (this.redis && results.length > 0) {
      try {
        await this.redis.setEx(
          `query:${query}`,
          this.config.hotTierTTL,
          JSON.stringify(results)
        );
      } catch (e) {
        // Skip cache errors
      }
    }

    if (results.length > 0) {
      this.tierMetrics.cold.hits++;
    }

    return {
      results,
      tier: 'cold',
      latency: Date.now() - startTime
    };
  }

  /**
   * RecallRecent - Retrieve memories from a specified duration
   */
  async recallRecent(durationMs = 86400000, limit = 10) { // Default to 24 hours (86,400,000 ms) and 10 memories
    const startTime = Date.now();
    const cutoffTime = Date.now() - durationMs;

    // Directly query the cold tier (SQLite) for time-based retrieval
    return await new Promise((resolve) => {
      setImmediate(() => {
        const stmt = this.db.prepare(`
          SELECT id, content, metadata, created_at, accessed_at, importance
          FROM memories
          WHERE created_at > ? OR accessed_at > ?
          ORDER BY accessed_at DESC, created_at DESC
          LIMIT ?
        `);

        const results = stmt.all(cutoffTime, cutoffTime, limit);

        const mapped = results.map(r => ({
          id: r.id,
          content: r.content,
          metadata: JSON.parse(r.metadata || '{}'),
          createdAt: r.created_at,
          accessedAt: r.accessed_at,
          importance: r.importance,
          tier: 'cold'
        }));

        this.log('info', `Recalled ${mapped.length} recent memories from cold tier (duration: ${durationMs / 3600000}h)`);

        resolve({
          results: mapped,
          tier: 'cold',
          latency: Date.now() - startTime
        });
      });
    });
  }

  /**
   * Forget - Remove from all tiers
   */
  async forget(id) {
    // Remove from cold tier (wrap sync operation to prevent event loop blocking)
    await new Promise((resolve) => {
      setImmediate(() => {
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
        resolve();
      });
    });

    // Remove from hot tier
    if (this.redis) {
      await this.redis.del(`mem:${id}`);
    }

    // Remove from warm tier
    const toDelete = [];
    for (const [vecId, vec] of this.vectorStore.entries()) {
      if (vec.memoryId === id) {
        toDelete.push(vecId);
      }
    }
    toDelete.forEach(vecId => this.vectorStore.delete(vecId));

    this.log('info', `Memory forgotten: ${id}`);

    return { id, forgotten: true };
  }

  /**
   * Deep Cleanup - Automated Digital Constipation Fix
   */
  async deepCleanup() {
    this.log('info', '🧹 Starting Deep Memory Cleanup (Digital Constipation Fix)...');
    
    if (!this.db) return { success: false, error: 'Cold storage not available' };

    try {
      // 1. Purge Garbage
      const result = await new Promise((resolve) => {
        setImmediate(() => {
          const res = this.db.prepare(`
            DELETE FROM memories
            WHERE length(content) > 100000
               OR content LIKE '%"experiences":%'
               OR content LIKE '%[MessageBroker] Arbiter not found%'
               OR content LIKE '%[MessageBroker]%unknown signal%'
               OR content LIKE '%missingArbiter%'
               OR content LIKE '%"state":{%'
               OR content LIKE '%"snapshot":{%'
               OR (length(content) < 20 AND unicode(content) < 32)
          `).run();
          resolve(res);
        });
      });

      this.log('info', `✅ Purged ${result.changes} garbage entries from DB.`);

      // 2. Index Optimization
      if (result.changes > 50) {
        this.log('info', '⏳ Reclaiming disk space (VACUUM)...');
        await new Promise(resolve => setImmediate(() => { this.db.exec("VACUUM;"); resolve(); }));
        this.log('info', '✨ Vacuum complete.');
      }

      this.db.exec("ANALYZE;");

      return {
        success: true,
        purged: result.changes
      };

    } catch (error) {
      this.log('error', `Deep cleanup failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Scan a batch of memories for the pruner to inspect — does NOT modify anything.
   * Returns raw rows: { id, content, metadata, importance, access_count, created_at }
   */
  async scanMemoriesForPruning(limit = 200, offset = 0) {
    if (!this.db) return [];
    return new Promise(resolve => {
      setImmediate(() => {
        try {
          const rows = this.db.prepare(`
            SELECT id, content, metadata, importance, access_count, created_at
            FROM memories
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
          `).all(limit, offset);
          resolve(rows);
        } catch { resolve([]); }
      });
    });
  }

  /**
   * Move a batch of memory IDs to purgatory (non-destructive first step).
   * They are removed from active recall but can be resurrected.
   */
  async purgeBatch(entries) {
    // entries: [{ id, substanceScore, reason }]
    if (!this.db || !entries.length) return 0;
    return new Promise(resolve => {
      setImmediate(() => {
        try {
          const insertStmt = this.db.prepare(`
            INSERT OR IGNORE INTO purgatory (id, content, metadata, original_importance, substance_score, prune_reason, purgatory_at)
            SELECT id, content, metadata, importance, ?, ?, ?
            FROM memories WHERE id = ?
          `);
          const deleteStmt = this.db.prepare('DELETE FROM memories WHERE id = ?');
          const tx = this.db.transaction(() => {
            let moved = 0;
            for (const e of entries) {
              insertStmt.run(e.substanceScore ?? 0, e.reason ?? 'pruned', Date.now(), e.id);
              deleteStmt.run(e.id);
              moved++;
              // Clean warm tier too
              for (const [vecId, vec] of this.vectorStore.entries()) {
                if (vec.memoryId === e.id) this.vectorStore.delete(vecId);
              }
            }
            return moved;
          });
          resolve(tx());
        } catch (err) {
          this.log('error', `purgeBatch failed: ${err.message}`);
          resolve(0);
        }
      });
    });
  }

  /**
   * Restore a memory from purgatory back into active recall.
   */
  async resurrectFromPurgatory(id) {
    if (!this.db) return false;
    return new Promise(resolve => {
      setImmediate(() => {
        try {
          const row = this.db.prepare('SELECT * FROM purgatory WHERE id = ?').get(id);
          if (!row) return resolve(false);
          const now = Date.now();
          this.db.prepare(`
            INSERT OR IGNORE INTO memories (id, content, metadata, created_at, accessed_at, access_count, importance)
            VALUES (?, ?, ?, ?, ?, 0, ?)
          `).run(row.id, row.content, row.metadata, row.purgatory_at, now, row.original_importance);
          this.db.prepare('DELETE FROM purgatory WHERE id = ?').run(id);
          resolve(true);
        } catch { resolve(false); }
      });
    });
  }

  /**
   * Permanently delete purgatory entries older than `olderThanDays` (default 30).
   */
  async expirePurgatory(olderThanDays = 30) {
    if (!this.db) return 0;
    const cutoff = Date.now() - (olderThanDays * 86400000);
    return new Promise(resolve => {
      setImmediate(() => {
        try {
          const res = this.db.prepare('DELETE FROM purgatory WHERE purgatory_at < ?').run(cutoff);
          resolve(res.changes);
        } catch { resolve(0); }
      });
    });
  }

  /** Stats for the pruner dashboard */
  async getPurgatoryStats() {
    if (!this.db) return { count: 0, oldestDays: null };
    return new Promise(resolve => {
      setImmediate(() => {
        try {
          const row = this.db.prepare('SELECT COUNT(*) as count, MIN(purgatory_at) as oldest FROM purgatory').get();
          resolve({
            count: row.count,
            oldestDays: row.oldest ? Math.floor((Date.now() - row.oldest) / 86400000) : null
          });
        } catch { resolve({ count: 0 }); }
      });
    });
  }

  // ===========================
  // Vector Operations
  // ===========================

  async _generateEmbedding(text) {
    if (!this.embedder) {
      throw new Error('Embedder not available');
    }

    const output = await this.embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  _vectorSearch(queryVector, topK = 5) {
    const results = [];

    for (const [id, vec] of this.vectorStore.entries()) {
      const similarity = this._cosineSimilarity(queryVector, vec.vector);
      results.push({
        id: vec.memoryId,
        content: vec.content,
        similarity,
        tier: 'warm'
      });
    }

    // Sort by similarity and return top K
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  _cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ===========================
  // SQLite Operations
  // ===========================

  async _sqliteSearch(query, limit = 5) {
    // Wrap synchronous SQLite operations to prevent event loop blocking
    return await new Promise((resolve) => {
      setImmediate(() => {
        const stmt = this.db.prepare(`
          SELECT id, content, metadata, accessed_at, access_count, importance
          FROM memories
          WHERE content LIKE ?
          ORDER BY importance DESC, accessed_at DESC
          LIMIT ?
        `);

        const results = stmt.all(`%${query}%`, limit);

        // Update access stats
        const updateStmt = this.db.prepare(`
          UPDATE memories
          SET accessed_at = ?, access_count = access_count + 1
          WHERE id = ?
        `);

        const now = Date.now();
        results.forEach(r => {
          updateStmt.run(now, r.id);
        });

        const mapped = results.map(r => ({
          id: r.id,
          content: r.content,
          metadata: JSON.parse(r.metadata || '{}'),
          accessed_at: r.accessed_at,
          access_count: r.access_count,
          importance: r.importance,
          tier: 'cold'
        }));

        resolve(mapped);
      });
    });
  }

  // ===========================
  // Utilities
  // ===========================

  _generateId(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  async _saveVectorStore() {
    if (!this.vectorsDirty && this.vectorStore.size > 0) return; // Skip if no changes

    try {
      const vectors = {};
      for (const [id, vec] of this.vectorStore.entries()) {
        vectors[id] = vec;
      }
      
      await fs.writeFile(
        this.config.vectorDbPath,
        JSON.stringify(vectors, null, 2),
        'utf8'
      );
      
      this.vectorsDirty = false;
      this.log('info', `Saved ${this.vectorStore.size} vectors to disk`);
    } catch (error) {
      this.log('error', 'Failed to save vector store', { error: error.message });
    }
  }

  _startPersistenceLoop() {
    this.persistenceTimer = setInterval(async () => {
      await this._saveVectorStore();
    }, this.config.persistenceInterval);
  }

  _startAutoCleanup() {
    this.cleanupTimer = setInterval(async () => {
      this.log('info', 'Running auto-cleanup...');

      // Clean old entries from cold tier (wrap sync operation)
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days
      const deleted = await new Promise((resolve) => {
        setImmediate(() => {
          const result = this.db.prepare(`
            DELETE FROM memories
            WHERE accessed_at < ? AND importance < 0.3
          `).run(cutoff);
          resolve(result);
        });
      });

      if (deleted.changes > 0) {
        this.log('info', `Cleaned ${deleted.changes} old memories`);
      }

      // Cap total memories at 4000 - prune least-accessed entries older than 7 days
      // when we exceed the ceiling. Preserves high-importance and recently-used memories.
      const MEMORY_CAP = 4000;
      const totalCount = await new Promise(resolve => setImmediate(() => {
        resolve(this.db.prepare('SELECT COUNT(*) as c FROM memories').get().c);
      }));
      if (totalCount > MEMORY_CAP) {
        const excess = totalCount - MEMORY_CAP;
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const pruned = await new Promise(resolve => setImmediate(() => {
          const res = this.db.prepare(`
            DELETE FROM memories WHERE id IN (
              SELECT id FROM memories
              WHERE created_at < ? AND importance < 5
              ORDER BY access_count ASC, accessed_at ASC
              LIMIT ?
            )
          `).run(weekAgo, excess);
          resolve(res);
        }));
        if (pruned.changes > 0) {
          this.log('info', `Memory cap: pruned ${pruned.changes} low-access entries (total was ${totalCount})`);
        }
      }

      // Save vectors periodically
      await this._saveVectorStore();

    }, this.config.cleanupInterval);
  }

  getMemoryStats() {
    const stats = {
      tiers: this.tierMetrics,
      storage: {
        hot: this.redis ? 'connected' : 'disabled',
        warm: `${this.vectorStore.size} vectors`,
        cold: `${this.tierMetrics.cold.size} memories`
      },
      hitRate: {
        hot: this.tierMetrics.hot.hits / (this.tierMetrics.hot.hits + this.tierMetrics.hot.misses) || 0,
        warm: this.tierMetrics.warm.hits / (this.tierMetrics.warm.hits + this.tierMetrics.warm.misses) || 0,
        cold: this.tierMetrics.cold.hits / (this.tierMetrics.cold.hits + this.tierMetrics.cold.misses) || 0
      }
    };

    // Include hot tier degradation info if applicable
    if (this.hotTierDegraded) {
      const degradedDuration = Date.now() - this.hotTierDegradedAt;
      stats.hotTierStatus = {
        degraded: true,
        degradedAt: new Date(this.hotTierDegradedAt).toISOString(),
        degradedForMs: degradedDuration,
        degradedForMinutes: Math.floor(degradedDuration / 60000),
        performanceImpact: 'High-speed Redis cache unavailable, using slower fallback tiers'
      };
    }

    return stats;
  }

  // ===========================
  // Message Handlers
  // ===========================

  async _handleRemember(envelope) {
    const result = await this.remember(
      envelope.payload.content,
      envelope.payload.metadata
    );

    await this.sendMessage(envelope.from, 'remember_response', result);
  }

  async _handleRecall(envelope) {
    const result = await this.recall(
      envelope.payload.query,
      envelope.payload.topK || 5
    );

    await this.sendMessage(envelope.from, 'recall_response', result);
  }

  async _handleForget(envelope) {
    const result = await this.forget(envelope.payload.id);
    await this.sendMessage(envelope.from, 'forget_response', result);
  }

  async _handleStats(envelope) {
    const stats = this.getMemoryStats();
    await this.sendMessage(envelope.from, 'stats_response', stats);
  }

  async _handleDeepCleanup(envelope) {
    const result = await this.deepCleanup();
    await this.sendMessage(envelope.from, 'deep_cleanup_response', result);
  }

  async _handleRecallRecent(envelope) {
    const result = await this.recallRecent(
      envelope.payload.durationMs,
      envelope.payload.limit
    );
    await this.sendMessage(envelope.from, 'recall_recent_response', result);
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

module.exports = MnemonicArbiter;







