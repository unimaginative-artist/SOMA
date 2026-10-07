// TransmitterManager.cjs
// Production orchestrator for 1000s of Transmitters
// Manages routing, compression, graph formation, and maintenance

const fs = require('fs');
const path = require('path');
const { Transmitter } = require('./Transmitter.cjs');

const DEFAULT_BASE = path.resolve(process.env.SOMA_HOME || path.join(process.cwd(), 'SOMA', 'transmitters'));

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA * normB) || 1);
}

class TransmitterManager {
  constructor(basePath = DEFAULT_BASE, config = {}) {
    this.basePath = path.resolve(basePath);
    ensureDir(this.basePath);
    
    this.config = {
      // Capacity & splitting
      tn_capacity_estimate: 1_000_000,
      split_threshold: 0.75,
      min_age_before_split: 3600,
      
      // Compression
      enable_compression: true,
      compression_trigger: 0.6,
      compression_threshold: 0.90,
      
      // Decay & pruning
      decay_half_life_days: 100,
      prune_score_threshold: 0.05,
      
      // Graph
      link_discovery_enabled: true,
      link_threshold: 0.7,
      max_links_per_tn: 20,
      spreading_activation_ttl: 4,
      hybrid_retrieval: true,
      
      // Limits
      global_max_tns: 10000,
      split_rate_limit_per_min: 5,
      
      // Logging
      logging: true,
      
      ...config
    };
    
    this.tns = new Map();
    this.splitEvents = [];
    
    this.metrics = {
      totalAdds: 0,
      totalSearches: 0,
      totalCompressions: 0,
      totalSplits: 0,
      avgRouteTime: 0,
      avgSearchTime: 0
    };
    
    this._loadExisting();
    
    if (this.config.logging) {
      console.log(`[TM] Initialized with ${this.tns.size} transmitters`);
    }
  }
  
  _loadExisting() {
    try {
      const entries = fs.readdirSync(this.basePath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      
      for (const e of entries) {
        try {
          const tn = new Transmitter(this.basePath, e, {
            compressionThreshold: this.config.compression_threshold,
            autoCompress: this.config.enable_compression,
            capacity: this.config.tn_capacity_estimate
          });
          this.tns.set(tn.id, tn);
        } catch (err) {
          console.error(`[TM] Failed to load TN ${e}:`, err.message);
        }
      }
      
      if (this.tns.size === 0) {
        const t = new Transmitter(this.basePath, null, {
          compressionThreshold: this.config.compression_threshold,
          autoCompress: this.config.enable_compression,
          capacity: this.config.tn_capacity_estimate
        });
        this.tns.set(t.id, t);
        
        if (this.config.logging) {
          console.log(`[TM] Created initial transmitter: ${t.id}`);
        }
      }
    } catch (err) {
      console.error('[TM] Load error:', err.message);
    }
  }
  
  async createTN() {
    const tn = new Transmitter(this.basePath, null, {
      compressionThreshold: this.config.compression_threshold,
      autoCompress: this.config.enable_compression,
      capacity: this.config.tn_capacity_estimate
    });
    this.tns.set(tn.id, tn);
    
    if (this.config.logging) {
      console.log(`[TM] Created new transmitter: ${tn.id}`);
    }
    
    return tn;
  }
  
  // ========== ROUTING ==========
  async addItemToBest(item) {
    const start = Date.now();
    
    // Phase 1: Find best TN by centroid similarity
    let best = null;
    let bestScore = -1;
    
    for (const tn of this.tns.values()) {
      if (!tn.meta.centroid) continue;
      
      const s = cosine(item.embedding, tn.meta.centroid);
      if (s > bestScore) {
        bestScore = s;
        best = tn;
      }
    }
    
    // Fallback: least utilized
    if (!best) {
      let least = null;
      let leastU = Infinity;
      
      for (const tn of this.tns.values()) {
        const u = tn.utilization(this.config.tn_capacity_estimate);
        if (u < leastU) {
          leastU = u;
          least = tn;
        }
      }
      
      best = least || (await this.createTN());
    }
    
    // Check if too full
    if (best.utilization(this.config.tn_capacity_estimate) > 0.95) {
      if (this.tns.size < this.config.global_max_tns) {
        if (this.config.logging) {
          console.log(`[TM] TN ${best.id} full, creating new`);
        }
        best = await this.createTN();
      }
    }
    
    // Phase 2: Link discovery
    if (this.config.link_discovery_enabled) {
      await this._discoverLinks(best, item.embedding);
    }
    
    // Phase 3: Add item
    const result = await best.addItem(item);
    
    this.metrics.totalAdds++;
    this.metrics.avgRouteTime = (this.metrics.avgRouteTime * (this.metrics.totalAdds - 1) + (Date.now() - start)) / this.metrics.totalAdds;
    
    return result;
  }
  
  async _discoverLinks(sourceTn, embedding) {
    const candidates = [];
    
    for (const tn of this.tns.values()) {
      if (tn.id === sourceTn.id) continue;
      if (!tn.meta.centroid) continue;
      
      const similarity = cosine(embedding, tn.meta.centroid);
      if (similarity >= this.config.link_threshold) {
        candidates.push({ tn, similarity });
      }
    }
    
    candidates.sort((a, b) => b.similarity - a.similarity);
    const topCandidates = candidates.slice(0, Math.min(5, this.config.max_links_per_tn));
    
    for (const { tn: targetTn, similarity } of topCandidates) {
      if (sourceTn.links.semantic.size < this.config.max_links_per_tn) {
        await sourceTn.linkTo(targetTn.id, similarity, 'semantic');
      }
      
      if (targetTn.links.semantic.size < this.config.max_links_per_tn) {
        await targetTn.linkTo(sourceTn.id, similarity, 'semantic');
      }
    }
  }
  
  // ========== SEARCH ==========
  async search(opts = {}) {
    // Simple wrapper for BrainConductor integration
    const { embedding, topK = 10 } = opts;
    
    if (!embedding || !Array.isArray(embedding)) {
      return [];
    }
    
    return await this.hybridSearch(embedding, topK);
  }
  
  async hybridSearch(queryEmbedding, topK = 10) {
    const start = Date.now();
    const results = new Map();
    
    // Phase 1: Tree routing
    const treeCandidates = await this.routeQueryEmb(queryEmbedding, Math.ceil(topK * 0.6));
    for (const { tn, score } of treeCandidates) {
      results.set(tn.id, { tn, score, source: 'tree', activationLevel: 1.0 });
    }
    
    // Phase 2: Spreading activation
    if (this.config.hybrid_retrieval) {
      const graphResults = await this._spreadingActivation(
        Array.from(results.keys()),
        queryEmbedding,
        this.config.spreading_activation_ttl
      );
      
      for (const { tnId, score, activationLevel } of graphResults) {
        if (!results.has(tnId)) {
          const tn = this.tns.get(tnId);
          if (tn) {
            results.set(tnId, { tn, score, source: 'graph', activationLevel });
          }
        } else {
          const existing = results.get(tnId);
          existing.score = Math.max(existing.score, score);
          existing.source = 'hybrid';
          existing.activationLevel = Math.max(existing.activationLevel, activationLevel);
        }
      }
    }
    
    // Phase 3: Rank
    const ranked = Array.from(results.values())
      .map(r => ({
        ...r,
        finalScore: r.score * (r.source === 'hybrid' ? 1.2 : 1.0) * r.activationLevel
      }))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, topK);
    
    // Phase 4: Record co-access
    await this._recordCoAccess(ranked.map(r => r.tn.id));
    
    this.metrics.totalSearches++;
    this.metrics.avgSearchTime = (this.metrics.avgSearchTime * (this.metrics.totalSearches - 1) + (Date.now() - start)) / this.metrics.totalSearches;
    
    if (this.config.logging) {
      console.log(`[TM] Hybrid search: ${ranked.length} TNs in ${Date.now() - start}ms`);
    }
    
    return ranked;
  }
  
  async routeQueryEmb(queryEmbedding, topK = 6) {
    const scores = [];
    
    for (const tn of this.tns.values()) {
      if (!tn.meta.centroid) continue;
      scores.push({ tn, score: cosine(queryEmbedding, tn.meta.centroid) || 0 });
    }
    
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
  
  async _spreadingActivation(seedTnIds, queryEmbedding, ttl) {
    const visited = new Set();
    const frontier = seedTnIds.map(id => ({ tnId: id, activationLevel: 1.0, depth: 0 }));
    const results = [];
    
    while (frontier.length > 0) {
      const { tnId, activationLevel, depth } = frontier.shift();
      
      if (visited.has(tnId) || depth >= ttl) continue;
      visited.add(tnId);
      
      const tn = this.tns.get(tnId);
      if (!tn || !tn.meta.centroid) continue;
      
      const similarity = cosine(queryEmbedding, tn.meta.centroid);
      const decayedActivation = activationLevel * Math.pow(0.75, depth);
      
      if (similarity * decayedActivation > 0.3) {
        results.push({
          tnId: tn.id,
          score: similarity,
          activationLevel: decayedActivation,
          depth
        });
        
        const neighbors = tn.getNeighbors(0.1);
        for (const { tnId: neighborId, weight } of neighbors) {
          if (!visited.has(neighborId)) {
            frontier.push({
              tnId: neighborId,
              activationLevel: activationLevel * weight,
              depth: depth + 1
            });
          }
        }
      }
    }
    
    return results;
  }
  
  async _recordCoAccess(tnIds) {
    for (let i = 0; i < tnIds.length; i++) {
      for (let j = i + 1; j < tnIds.length; j++) {
        const tn1 = this.tns.get(tnIds[i]);
        const tn2 = this.tns.get(tnIds[j]);
        
        if (tn1 && tn2) {
          if (tn1.links.temporal.has(tn2.id)) {
            const link = tn1.links.temporal.get(tn2.id);
            link.count++;
            link.lastCoAccess = new Date().toISOString();
          } else {
            await tn1.linkTo(tn2.id, 0.3, 'temporal');
          }
          
          if (tn2.links.temporal.has(tn1.id)) {
            const link = tn2.links.temporal.get(tn1.id);
            link.count++;
            link.lastCoAccess = new Date().toISOString();
          } else {
            await tn2.linkTo(tn1.id, 0.3, 'temporal');
          }
          
          // Graduate to semantic
          if (tn1.links.temporal.get(tn2.id)?.count > 5) {
            await tn1.linkTo(tn2.id, 0.6, 'semantic');
            await tn2.linkTo(tn1.id, 0.6, 'semantic');
          }
        }
      }
    }
  }
  
  // ========== MAINTENANCE ==========
  async maintenanceTick() {
    if (this.config.logging) {
      console.log(`[TM] Starting maintenance on ${this.tns.size} transmitters`);
    }
    
    const halfSeconds = (this.config.decay_half_life_days || 100) * 86400;
    const lambda = Math.log(2) / (halfSeconds || (100 * 86400));
    
    for (const [id, tn] of this.tns.entries()) {
      try {
        // Prune old items
        await tn.pruneItems(lambda, this.config.prune_score_threshold);
        
        // Decay links
        await tn.decayLinks(0.01);
        
        // Compress if needed
        if (this.config.enable_compression && !tn.meta.compressed) {
          if (tn.utilization(this.config.tn_capacity_estimate) > this.config.compression_trigger) {
            await tn.compress();
            this.metrics.totalCompressions++;
          }
        }
        
      } catch (e) {
        console.error(`[TM] Maintenance error for ${id}:`, e.message);
      }
    }
    
    if (this.config.logging) {
      console.log(`[TM] Maintenance complete`);
    }
  }
  
  // ========== STATS ==========
  stats() {
    let totalSize = 0;
    let totalItems = 0;
    let avgUtil = 0;
    let compressedCount = 0;
    let totalLinks = 0;
    
    for (const tn of this.tns.values()) {
      totalSize += tn.meta.sizeEstimate || 0;
      totalItems += tn.meta.items || 0;
      avgUtil += tn.utilization(this.config.tn_capacity_estimate);
      if (tn.meta.compressed) compressedCount++;
      totalLinks += tn.links.semantic.size + tn.links.temporal.size;
    }
    
    return {
      totalTNs: this.tns.size,
      totalItems,
      totalSize: `${(totalSize / 1024).toFixed(1)}KB`,
      avgUtil: this.tns.size ? (avgUtil / this.tns.size * 100).toFixed(1) + '%' : '0%',
      compressedTNs: compressedCount,
      compressionRate: this.tns.size ? (compressedCount / this.tns.size * 100).toFixed(1) + '%' : '0%',
      totalLinks,
      avgLinksPerTN: this.tns.size ? (totalLinks / this.tns.size).toFixed(1) : '0',
      metrics: this.metrics
    };
  }
  
  status() {
    return {
      basePath: this.basePath,
      config: this.config,
      stats: this.stats(),
      transmitters: Array.from(this.tns.values()).slice(0, 10).map(tn => tn.status())
    };
  }
}

module.exports = { TransmitterManager };
