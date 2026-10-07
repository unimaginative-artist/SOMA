/**
 * HybridSearchArbiter - World-Class Search Engine
 *
 * Combines the best of:
 * - ACORN (SIGMOD '24) - Hybrid vector search with metadata filtering
 * - RediSearch - Pre-filtering bounded search
 * - Meilisearch - Typo tolerance and ranking
 * - Traditional IR - BM25 and inverted indexes
 *
 * Search Pipeline:
 * 1. Parse natural language query
 * 2. Apply metadata filters (pre-filtering)
 * 3. Vector search (semantic similarity)
 * 4. Full-text search (keyword matching)
 * 5. Combine scores (hybrid ranking)
 * 6. Return ranked results with citations
 *
 * Use Cases:
 * - Medical research papers
 * - Legal documents
 * - Technical documentation
 * - Code search
 */

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const { ACORNAdapter } = require('../server/storage/ACORNAdapter.cjs');
const { InvertedIndex } = require('../server/storage/InvertedIndex.cjs');
const { BM25Ranker } = require('../server/storage/BM25Ranker.cjs');
const { DocumentClassifier } = require('../server/ml/DocumentClassifier.cjs');
const { TextChunker } = require('../server/utils/TextChunker.cjs');
const { PatternDetector } = require('../server/ml/PatternDetector.cjs');
const { buildSnippet } = require('../server/utils/SnippetBuilder.cjs');
const { LocalEmbedder } = require('../server/ml/LocalEmbedder.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const { Worker } = require('worker_threads');
const path = require('path');

class HybridSearchArbiter extends BaseArbiter {
  static role = 'hybrid_search';
  static capabilities = ['search', 'index', 'filter', 'rank', 'patterns'];

  constructor(config = {}) {
    super(config);
    this.name = config.name || 'HybridSearchArbiter';
    
    // Worker Configuration
    this.useWorker = config.useWorker !== false; // Default to TRUE for "Superior Architecture"
    this.worker = null;
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;

    // Persistence
    this.indexDir = config.indexDir || path.join(process.cwd(), '.soma', 'search_index');
    this.autoSaveIntervalMs = config.autoSaveIntervalMs || 300000; // 5 minutes
    this._autoSaveTimer = null;

    // Core components
    this.embedder = config.embedder || null;
    this.acornIndex = config.acornIndex || null;
    this.invertedIndex = config.invertedIndex || new InvertedIndex();
    this.bm25 = config.bm25 || new BM25Ranker();
    this.chunker = config.chunker || new TextChunker();
    this.classifier = config.classifier || new DocumentClassifier();
    this.patternDetector = config.patternDetector || null;

    // Caching and scoring
    this.queryCache = new Map();
    this.cacheMaxSize = config.cacheMaxSize || 500;
    this.cacheTTL = config.cacheTTL || 10 * 60 * 1000; // 10 minutes
    this.weights = {
      vectorWeight: config.vectorWeight || 0.6,
      bm25Weight: config.bm25Weight || 0.4,
      vector: config.vectorWeight || 0.6,
      bm25: config.bm25Weight || 0.4
    };

    // Stats
    this.stats = {
      totalSearches: 0,
      avgSearchTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      documentsClassified: 0,
      autoTagsAdded: 0,
      totalChunks: 0
    };
    
    // Initialize standard components (still needed for lightweight ops or fallback)
    if (!this.acornIndex) {
      this.acornIndex = new ACORNAdapter({/*...*/});
    }
  }

  async initialize() {
    await super.initialize();

    if (this.useWorker) {
        try {
            this.logger.info(`[${this.name}] 🚀 Starting SearchWorker thread...`);
            this.worker = new Worker(path.join(__dirname, '../server/workers/SearchWorker.cjs'), {
                workerData: { storagePath: path.join(process.cwd(), '.soma', 'storage') }
            });

            this.worker.on('message', (msg) => this._handleWorkerMessage(msg));
            this.worker.on('error', (err) => {
                this.logger.error(`[SearchWorker] Error: ${err.message}`);
                this.useWorker = false;
            });
            
            // Wait for ready (with generous timeout for model loading)
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.worker?.off('message', handler);
                    reject(new Error('SearchWorker ready timeout'));
                }, 60000);
                const handler = (msg) => {
                    if (msg.type === 'ready') {
                        clearTimeout(timeout);
                        this.worker.off('message', handler);
                        resolve();
                    }
                };
                this.worker.on('message', handler);
            });
            this.logger.info(`[${this.name}] ✅ SearchWorker Online`);
        } catch (err) {
            this.logger.warn(`[${this.name}] SearchWorker failed, falling back to inline search: ${err.message}`);
            this.useWorker = false;
            this.worker = null;
        }
    }

    if (!this.useWorker) {
        // Fallback initialization (Inline)
        this.acornIndex = new ACORNAdapter({
          dimension: 384,
          M: 32,
          efConstruction: 200,
          efSearch: 100,
          metric: 'cosine'
        });
        this.patternDetector = new PatternDetector(this.acornIndex);

        // Initialize embedder (non-blocking - loads model in background)
        if (!this.embedder) {
            this.embedder = new LocalEmbedder();
            this.embedder.initialize().then(() => {
                this.logger.info(`[${this.name}] ✅ LocalEmbedder ready (semantic search enabled)`);
            }).catch(err => {
                this.logger.warn(`[${this.name}] LocalEmbedder failed: ${err.message} (text-only search mode)`);
                this.embedder = null;
            });
        }
    }

    // Initialize Document Classifier (Always in main thread for now, lightweight)
    try {
      await this.classifier.initialize();
      this.logger.info(`[${this.name}] ✅ Document Classifier ready`);
    } catch (err) {
      this.logger.warn(`[${this.name}] Classifier initialization failed: ${err.message}`);
    }

    // Load persisted indexes if available
    try {
      await this.load(this.indexDir);
    } catch (e) {
      this.logger.warn(`[${this.name}] Index load failed (fresh start): ${e.message}`);
    }

    try {
      if (typeof this._registerWithBroker === 'function') {
        await this._registerWithBroker();
      }
    } catch (e) {
      this.logger.warn(`[${this.name}] Broker registration skipped: ${e.message}`);
    }
    this._subscribeBrokerMessages();

    // Auto-save timer
    if (!this._autoSaveTimer) {
      this._autoSaveTimer = setInterval(() => {
        this.save(this.indexDir).catch(() => {});
      }, this.autoSaveIntervalMs);
    }
  }

  _handleWorkerMessage(msg) {
      if (msg.type === 'search_complete') {
          const { requestId, results } = msg;
          const resolver = this.pendingRequests.get(requestId);
          if (resolver) {
              resolver.resolve(results);
              this.pendingRequests.delete(requestId);
          }
      }
      // Handle other messages (progress, etc)
  }

  _subscribeBrokerMessages() {
      try {
          messageBroker.on('index_document', async (doc) => {
              if (!doc) return;
              await this.indexDocument(doc);
          });

          messageBroker.on('index_batch', async (payload) => {
              if (!payload?.documents) return;
              await this.indexBatch(payload.documents, payload.options || {});
          });

          messageBroker.on('save_search_index', async (payload = {}) => {
              const dir = payload.directory || this.indexDir;
              await this.save(dir);
          });
      } catch (e) {
          this.logger.warn(`[${this.name}] Broker subscription failed: ${e.message}`);
      }
  }

  async search(query, filters = {}, options = {}) {
      if (this.useWorker && this.worker) {
          try {
              const requestId = this.requestIdCounter++;
              return await new Promise((resolve, reject) => {
                  this.pendingRequests.set(requestId, { resolve, reject });
                  this.worker.postMessage({ 
                      type: 'search', 
                      query, 
                      filters, 
                      topK: options.topK || 20, 
                      requestId 
                  });
                  // Timeout safety
                  setTimeout(() => {
                      if (this.pendingRequests.has(requestId)) {
                          this.pendingRequests.delete(requestId);
                          reject(new Error('Search worker timeout'));
                      }
                  }, 10000);
              });
          } catch (err) {
              this.logger.warn(`[${this.name}] Worker search failed, falling back to inline: ${err.message}`);
              this.useWorker = false;
          }
      }

      return this._inlineSearch(query, filters, options);
  }
  
  // Renamed original search to _inlineSearch for fallback
  async _inlineSearch(query, filters = {}, options = {}) {
    const startTime = Date.now();

    const {
      topK = 20,
      vectorWeight = this.weights.vector,
      bm25Weight = this.weights.bm25,
      useCache = true
    } = options;

    // Check cache
    const cacheKey = this._getCacheKey(query, filters, topK);
    if (useCache && this.queryCache.has(cacheKey)) {
      const cached = this.queryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        this.stats.cacheHits++;
        return cached.results;
      } else {
        this.queryCache.delete(cacheKey);
      }
    }

    this.stats.cacheMisses++;

    try {
      // 1. Get query embedding (if embedder available)
      let queryEmbedding = null;
      if (this.embedder && typeof this.embedder.embed === 'function' && typeof query === 'string') {
        try {
          queryEmbedding = await this.embedder.embed(query);
        } catch (err) {
          this.logger.warn(`[${this.name}] Embedding failed: ${err.message}, falling back to text-only search`);
        }
      } else if (Array.isArray(query)) {
        queryEmbedding = query;  // Already an embedding
      }

      // Extract query terms for text search
      const queryText = typeof query === 'string' ? query : options.queryText || '';
      const queryTerms = this._extractQueryTerms(queryText);

      // 2. Vector search (ACORN with pre-filtering)
      let vectorResults = [];
      if (queryEmbedding && this.acornIndex) {
        vectorResults = await this.acornIndex.search(
          queryEmbedding,
          filters,
          topK * 2  // Get extra for reranking
        );
      }

      // 3. Full-text search with BM25
      let textResults = [];
      if (queryTerms.length > 0) {
        textResults = this.invertedIndex.search(queryText, {
          operator: 'OR',
          maxResults: topK * 2
        });

        // Add BM25 scores
        textResults = this.bm25.scoreResults(textResults, queryTerms);
      }

      // 4. Merge and combine scores
      const merged = this._mergeResults(
        vectorResults,
        textResults,
        { vectorWeight, bm25Weight }
      );

      // 5. Apply final filtering and sorting
      const final = merged
        .filter(r => this._matchesFilters(r.metadata, filters))
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, topK);
      
      const finalWithSnippets = final.map(r => ({
        ...r,
        snippet: buildSnippet(r.content, queryText)
      }));

      // Prepare results
      const results = {
        success: true,
        query: queryText,
        filters,
        results: finalWithSnippets,
        count: finalWithSnippets.length,
        searchTime: Date.now() - startTime,
        stats: {
          vectorResults: vectorResults.length,
          textResults: textResults.length,
          mergedResults: merged.length
        }
      };

      // Cache results
      if (useCache) {
        this._cacheResults(cacheKey, results);
      }

      // Update stats
      this.stats.totalSearches++;
      this.stats.avgSearchTime =
        (this.stats.avgSearchTime * (this.stats.totalSearches - 1) +
          results.searchTime) / this.stats.totalSearches;

      return results;

    } catch (error) {
      this.logger.error(`[${this.name}] Search error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        searchTime: Date.now() - startTime
      };
    }
  }

  /**
   * Index a document for search (Chunked)
   */
  // Runtime data files that should never be indexed — they're high-churn internal state,
  // not searchable knowledge. Indexing them wastes memory and embeddings budget.
  static SKIP_PATTERNS = [
    /outcomes_current\.json$/i,
    /experiences_current\.json$/i,
    /soma-vectors\.json$/i,
    /index_journal\.json$/i,
    /causal-graph\.json$/i,
    /trauma_archive\.json$/i,
    /training-history\.json$/i,
    /limbic-state\.json$/i,
    /kuze_memory\.json$/i,
    /\.soma[/\\]/,
    /data[/\\]outcomes[/\\]/i,
  ];

  async indexDocument(doc) {
    const { id, content, metadata = {}, name, path: filePath } = doc;

    if (!id || !content) {
      return { success: false, error: 'id and content required' };
    }

    // Skip runtime data files — high-churn internal state, not searchable knowledge
    const docPath = filePath || id || '';
    if (HybridSearchArbiter.SKIP_PATTERNS.some(p => p.test(docPath))) {
      return { success: true, skipped: true, reason: 'runtime data file excluded' };
    }

    try {
      // 1. Auto-classify (on full content for better context)
      let classification = null;
      let enrichedMetadata = { ...metadata };
      if (name && !enrichedMetadata.name) enrichedMetadata.name = name;
      if (filePath && !enrichedMetadata.path) enrichedMetadata.path = filePath;

      if (this.classifier && this.classifier.initialized) {
        try {
          classification = this.classifier.classify(content, metadata);
          enrichedMetadata = {
            ...metadata,
            ...classification.suggestedMetadata,
            autoTags: classification.tags,
            classificationConfidence: {
              specialty: classification.specialtyConfidence,
              documentType: classification.documentTypeConfidence,
              outcomeType: classification.outcomeTypeConfidence
            }
          };
          if (!enrichedMetadata.tags) enrichedMetadata.tags = [];
          const existingTags = new Set(enrichedMetadata.tags);
          for (const tag of classification.tags) {
            if (!existingTags.has(tag)) enrichedMetadata.tags.push(tag);
          }
          this.stats.documentsClassified++;
          this.stats.autoTagsAdded += classification.tags.length;
        } catch (err) {
          this.logger.warn(`[${this.name}] Classification failed for doc ${id}: ${err.message}`);
        }
      }

      // Persist base document metadata (for later hydration/preview)
      try {
        this.acornIndex?.db?.addDocument?.({
          id,
          path: enrichedMetadata.path || filePath || '',
          name: enrichedMetadata.name || name || '',
          content,
          metadata: enrichedMetadata
        });
      } catch (e) {
        this.logger.warn(`[${this.name}] Document persist failed for ${id}: ${e.message}`);
      }

      // 2. Smart Chunking
      const chunks = this.chunker.chunk(content, enrichedMetadata);
      this.stats.totalChunks += chunks.length;
      this.logger.info(`[${this.name}] Split ${id} into ${chunks.length} chunks`);

      // 3. Process each chunk
      for (const chunk of chunks) {
          const chunkId = `${id}_chunk_${chunk.metadata.chunkIndex}`;
          
          // Generate embedding for chunk
          let embedding = null;
          if (this.embedder && typeof this.embedder.embed === 'function') {
            try {
              embedding = await this.embedder.embed(chunk.content);
            } catch (err) {
              this.logger.warn(`[${this.name}] Embedding failed for chunk ${chunkId}`);
            }
          }

          // Add to ACORN vector index
          if (embedding && this.acornIndex) {
            await this.acornIndex.add(chunkId, embedding, { ...chunk.metadata, parentId: id, content: chunk.content });
          }

          // Add to inverted index & BM25
          this.invertedIndex.add(chunkId, chunk.content, { ...chunk.metadata, parentId: id });
          this.bm25.indexDocument(chunkId, chunk.content);
      }

      return {
        success: true,
        id,
        chunks: chunks.length,
        indexed: {
          vector: true,
          fullText: true,
          bm25: true,
          classified: !!classification
        }
      };

    } catch (error) {
      this.logger.error(`[${this.name}] Index error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Batch index documents
   */
  async indexBatch(documents, options = {}) {
    const { progressCallback, batchSize = 10 } = options; // Smaller batch size due to chunks

    const results = {
      total: documents.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process in batches
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(doc => this.indexDocument(doc))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success) {
          results.successful++;
        } else {
          results.failed++;
          results.errors.push(
            result.status === 'rejected'
              ? result.reason.message
              : result.value.error
          );
        }
      }

      // Progress callback
      if (progressCallback) {
        progressCallback({
          processed: Math.min(i + batchSize, documents.length),
          total: documents.length,
          successful: results.successful,
          failed: results.failed
        });
      }
    }

    return results;
  }

  /**
   * Merge vector and text search results
   */
  _mergeResults(vectorResults, textResults, weights) {
    const merged = new Map();

    // Normalize vector scores (0-1 range)
    const maxVectorScore = Math.max(...vectorResults.map(r => r.similarity), 1);
    for (const result of vectorResults) {
      const normalizedScore = result.similarity / maxVectorScore;

      merged.set(result.id, {
        id: result.id,
        metadata: result.metadata,
        content: result.content,
        vectorScore: normalizedScore,
        bm25Score: 0,
        finalScore: normalizedScore * weights.vectorWeight
      });
    }

    // Normalize BM25 scores
    const maxBM25Score = Math.max(...textResults.map(r => r.bm25Score || 0), 1);
    for (const result of textResults) {
      const normalizedScore = (result.bm25Score || 0) / maxBM25Score;

      if (merged.has(result.docId)) {
        // Already in results from vector search
        const existing = merged.get(result.docId);
        existing.bm25Score = normalizedScore;
        existing.finalScore += normalizedScore * weights.bm25Weight;
      } else {
        // Only in text results
        merged.set(result.docId, {
          id: result.docId,
          metadata: result.metadata,
          content: result.content,
          vectorScore: 0,
          bm25Score: normalizedScore,
          finalScore: normalizedScore * weights.bm25Weight
        });
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Extract query terms for text search
   */
  _extractQueryTerms(queryText) {
    if (!queryText) return [];

    // Simple tokenization (will be improved with natural)
    return queryText
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  /**
   * Check if metadata matches filters
   */
  _matchesFilters(metadata, filters) {
    if (!metadata) return false;

    for (const [key, value] of Object.entries(filters)) {
      if (key === 'tags') continue; // Already handled by ACORN
      if (key === 'year') continue;
      if (key === 'type') continue;

      if (Array.isArray(value)) {
        if (!value.includes(metadata[key])) return false;
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        if (value.$in && Array.isArray(value.$in)) {
          if (!value.$in.includes(metadata[key])) return false;
          continue;
        }
        // Range query
        if (value.$gte && metadata[key] < value.$gte) return false;
        if (value.$lte && metadata[key] > value.$lte) return false;
        if (value.$gt && metadata[key] <= value.$gt) return false;
        if (value.$lt && metadata[key] >= value.$lt) return false;
      } else {
        if (key === 'path' && typeof value === 'string') {
          if (!String(metadata[key] || '').toLowerCase().includes(value.toLowerCase())) return false;
          continue;
        }
        // Exact match
        if (metadata[key] !== value) return false;
      }
    }

    return true;
  }

  /**
   * Generate cache key
   */
  _getCacheKey(query, filters, topK) {
    const queryStr = typeof query === 'string' ? query : JSON.stringify(query);
    return `${queryStr}:${JSON.stringify(filters)}:${topK}`;
  }

  /**
   * Cache search results
   */
  _cacheResults(key, results) {
    // Enforce cache size limit (LRU)
    if (this.queryCache.size >= this.cacheMaxSize) {
      const firstKey = this.queryCache.keys().next().value;
      this.queryCache.delete(firstKey);
    }

    this.queryCache.set(key, {
      results,
      timestamp: Date.now()
    });
  }

  /**
   * Clear query cache
   */
  clearCache() {
    this.queryCache.clear();
    return { success: true, message: 'Cache cleared' };
  }

  /**
   * Get all tags
   */
  getAllTags(options = {}) {
    if (!this.acornIndex) {
      return [];
    }
    return this.acornIndex.getAllTags(options);
  }

  /**
   * Get statistics
   */
  getStatus() {
    return {
      name: this.name,
      role: HybridSearchArbiter.role,
      capabilities: HybridSearchArbiter.capabilities,
      stats: {
        ...this.stats,
        acorn: this.acornIndex?.getStats() || {},
        invertedIndex: this.invertedIndex.getStats(),
        bm25: this.bm25.getStats(),
        classifier: this.classifier?.getStats() || {},
        cache: {
          size: this.queryCache.size,
          maxSize: this.cacheMaxSize,
          hitRate: this.stats.totalSearches > 0
            ? (this.stats.cacheHits / this.stats.totalSearches * 100).toFixed(2) + '%'
            : '0%'
        }
      },
      weights: this.weights
    };
  }

  /**
   * Save index to disk
   */
  async save(directory) {
    const results = {
      success: true,
      saved: []
    };

    try {
      // Save ACORN index
      if (this.acornIndex) {
        await this.acornIndex.save(directory);
        results.saved.push('acorn');
      }

      // Save BM25 state
      await this._saveBM25(directory);
      results.saved.push('bm25');

      this.logger.info(`[${this.name}] Index saved to ${directory}`);
      return results;

    } catch (error) {
      this.logger.error(`[${this.name}] Save error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Load index from disk
   */
  async load(directory) {
    try {
      // Load ACORN index
      if (this.acornIndex) {
        await this.acornIndex.load(directory);
      }

      await this._loadBM25(directory);

      this.logger.info(`[${this.name}] Index loaded from ${directory}`);
      return { success: true, directory };

    } catch (error) {
      this.logger.error(`[${this.name}] Load error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async _saveBM25(directory) {
    const fs = require('fs').promises;
    const bm25Path = path.join(directory, 'bm25.json');
    const data = {
      totalDocs: this.bm25.totalDocs,
      avgDocLength: this.bm25.avgDocLength,
      documentStats: Array.from(this.bm25.documentStats.entries()),
      termDocFreq: Array.from(this.bm25.termDocFreq.entries())
    };
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(bm25Path, JSON.stringify(data));
  }

  async _loadBM25(directory) {
    const fs = require('fs').promises;
    const bm25Path = path.join(directory, 'bm25.json');
    try {
      const raw = await fs.readFile(bm25Path, 'utf8');
      const data = JSON.parse(raw);
      this.bm25.totalDocs = data.totalDocs || 0;
      this.bm25.avgDocLength = data.avgDocLength || 0;
      this.bm25.documentStats = new Map(data.documentStats || []);
      this.bm25.termDocFreq = new Map(data.termDocFreq || []);
    } catch {
      // First run: no persisted BM25
    }
  }
}

module.exports = HybridSearchArbiter;
