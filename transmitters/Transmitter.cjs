// Transmitter.cjs
// Production-ready micro-agent with compression, graph links, and memory decay
// Compatible with Arbiter/MessageBroker patterns

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const zlib = require('zlib');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const now = () => Date.now();
const iso = (t = Date.now()) => new Date(t).toISOString();
const genId = (pref = 'tn') => `${pref}_${crypto.randomBytes(6).toString('hex')}`;

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

// ========== VECTOR MATH ==========
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] || 0) * (b[i] || 0);
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a)) || 1;
}

function cosine(a, b) {
  return dot(a, b) / (norm(a) * norm(b));
}

function addVec(a, b) {
  for (let i = 0; i < a.length; i++) a[i] = (a[i] || 0) + (b[i] || 0);
  return a;
}

function divVec(a, d) {
  for (let i = 0; i < a.length; i++) a[i] = (a[i] || 0) / d;
  return a;
}

function subtractVec(a, b) {
  return a.map((v, i) => v - (b[i] || 0));
}

// ========== COMPRESSION ENGINE ==========
class CompressionEngine {
  // Quantize float32 -> int8 (4x compression)
  static quantize(embedding) {
    const max = Math.max(...embedding.map(Math.abs));
    const scale = 127 / (max || 1);
    
    const quantized = new Int8Array(embedding.length);
    for (let i = 0; i < embedding.length; i++) {
      quantized[i] = Math.round(embedding[i] * scale);
    }
    
    return {
      q: Array.from(quantized),
      s: scale,
      d: embedding.length
    };
  }
  
  static dequantize({ q, s }) {
    return q.map(v => v / s);
  }
  
  // Cluster compression: centroid + residuals
  static async compressCluster(items, threshold = 0.90) {
    if (items.length < 3) return { compressed: false, items };
    
    const embeddings = items.map(i => i.embedding);
    const centroid = this.computeCentroid(embeddings);
    
    // Check similarity
    const avgSim = embeddings.reduce((s, e) => s + cosine(e, centroid), 0) / embeddings.length;
    
    if (avgSim < threshold) {
      return { compressed: false, items, reason: 'too_diverse', avgSim };
    }
    
    // Compress!
    const residuals = items.map(item => {
      const res = subtractVec(item.embedding, centroid);
      const maxRes = Math.max(...res.map(Math.abs));
      const scale = 15 / (maxRes || 1);
      
      return {
        id: item.id,
        r: res.map(v => Math.round(v * scale)),
        s: scale,
        score: item.score,
        meta: item.metadata,
        payload: item.payload
      };
    });
    
    return {
      compressed: true,
      centroid: this.quantize(centroid),
      residuals,
      count: items.length,
      avgSim,
      created: items[0].created,
      lastAccess: items.reduce((latest, i) => 
        new Date(i.lastAccess) > new Date(latest) ? i.lastAccess : latest, 
        items[0].lastAccess
      )
    };
  }
  
  static decompressCluster(compressed) {
    if (!compressed.compressed) return compressed.items;
    
    const centroid = this.dequantize(compressed.centroid);
    const items = [];
    
    for (const res of compressed.residuals) {
      const residual = res.r.map(v => v / res.s);
      const reconstructed = centroid.map((v, i) => v + residual[i]);
      
      items.push({
        id: res.id,
        embedding: reconstructed,
        score: res.score,
        metadata: res.meta,
        payload: res.payload,
        reconstructed: true
      });
    }
    
    return items;
  }
  
  static computeCentroid(embeddings) {
    const dim = embeddings[0].length;
    const sum = new Array(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) sum[i] += emb[i];
    }
    return sum.map(s => s / embeddings.length);
  }
}

// ========== TRANSMITTER CLASS ==========
class Transmitter {
  constructor(basePath, tid = null, config = {}) {
    this.basePath = path.resolve(basePath);
    this.id = tid || genId();
    this.dir = path.join(this.basePath, this.id);
    
    ensureDir(this.dir);
    
    this.dataFile = path.join(this.dir, 'items.jsonl');
    this.metaFile = path.join(this.dir, 'meta.json');
    this.linksFile = path.join(this.dir, 'links.json');
    this.compressedFile = path.join(this.dir, 'items.compressed.json');
    
    // Config
    this.config = {
      compressionThreshold: config.compressionThreshold || 0.90,
      autoCompress: config.autoCompress !== false,
      maxLinks: config.maxLinks || 20,
      ...config
    };
    
    // Metadata
    this.meta = {
      created: iso(),
      lastAccess: iso(),
      items: 0,
      sizeEstimate: 0,
      centroid: null,
      energy: 1.0,
      active: true,
      compressed: false,
      compressionRatio: null
    };
    
    // Graph links
    this.links = {
      semantic: new Map(),  // Discovered associations
      temporal: new Map(),  // Co-access patterns
      parent: null,         // Tree structure
      children: new Set()
    };
    
    // Cache
    this._itemsCache = null;
    this._compressed = false;
    
    // Load existing state
    this._loadMeta();
    this._loadLinks();
    
    // Metrics
    this.metrics = {
      reads: 0,
      writes: 0,
      compressions: 0,
      decompressions: 0,
      avgAccessTime: 0
    };
  }
  
  // ========== PERSISTENCE ==========
  _loadMeta() {
    if (fs.existsSync(this.metaFile)) {
      try {
        this.meta = JSON.parse(fs.readFileSync(this.metaFile, 'utf-8'));
      } catch (e) {
        console.error(`[TN:${this.id}] Meta load error:`, e.message);
      }
    }
  }
  
  _persistMeta() {
    try {
      fs.writeFileSync(this.metaFile, JSON.stringify(this.meta, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[TN:${this.id}] Meta persist error:`, e.message);
    }
  }
  
  _loadLinks() {
    if (fs.existsSync(this.linksFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.linksFile, 'utf-8'));
        this.links.semantic = new Map(data.semantic || []);
        this.links.temporal = new Map(data.temporal || []);
        this.links.parent = data.parent;
        this.links.children = new Set(data.children || []);
      } catch (e) {
        console.error(`[TN:${this.id}] Links load error:`, e.message);
      }
    }
  }
  
  _persistLinks() {
    try {
      fs.writeFileSync(this.linksFile, JSON.stringify({
        semantic: Array.from(this.links.semantic.entries()),
        temporal: Array.from(this.links.temporal.entries()),
        parent: this.links.parent,
        children: Array.from(this.links.children)
      }, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[TN:${this.id}] Links persist error:`, e.message);
    }
  }
  
  async _ensureLoaded() {
    if (this._itemsCache !== null) return;
    
    const start = Date.now();
    
    // Try compressed first
    if (this.meta.compressed && fs.existsSync(this.compressedFile)) {
      try {
        this._itemsCache = JSON.parse(fs.readFileSync(this.compressedFile, 'utf-8'));
        this._compressed = true;
        this.metrics.decompressions++;
      } catch (e) {
        console.error(`[TN:${this.id}] Compressed load error:`, e.message);
        this._itemsCache = [];
      }
    } else if (fs.existsSync(this.dataFile)) {
      // Load uncompressed JSONL
      this._itemsCache = [];
      const lines = fs.readFileSync(this.dataFile, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          this._itemsCache.push(JSON.parse(line));
        } catch (e) {
          console.error(`[TN:${this.id}] Line parse error:`, e.message);
        }
      }
      this._compressed = false;
    } else {
      this._itemsCache = [];
      this._compressed = false;
    }
    
    this.metrics.reads++;
    this.metrics.avgAccessTime = (this.metrics.avgAccessTime * (this.metrics.reads - 1) + (Date.now() - start)) / this.metrics.reads;
  }
  
  // ========== ITEMS API ==========
  async items() {
    await this._ensureLoaded();
    
    // If compressed, decompress for retrieval
    if (this._compressed) {
      const decompressed = [];
      for (const entry of this._itemsCache) {
        if (entry.compressed) {
          decompressed.push(...CompressionEngine.decompressCluster(entry));
        } else if (entry.items) {
          decompressed.push(...entry.items);
        }
      }
      return decompressed;
    }
    
    return this._itemsCache;
  }
  
  async addItem(item) {
    if (!item || !item.embedding) {
      throw new Error('item.embedding required');
    }
    
    await this._ensureLoaded();
    
    // Prepare item
    item.id = item.id || `${this.id}_${Date.now()}`;
    item.created = item.created || iso();
    item.lastAccess = item.lastAccess || iso();
    item.score = typeof item.score === 'number' ? item.score : 1.0;
    
    // Add to cache
    if (this._compressed) {
      // If compressed, decompress first
      const decompressed = await this.items();
      decompressed.push(item);
      this._itemsCache = decompressed;
      this._compressed = false;
    } else {
      this._itemsCache.push(item);
    }
    
    // Persist immediately to JSONL
    fs.appendFileSync(this.dataFile, JSON.stringify(item) + '\n', 'utf-8');
    
    // Update metadata
    this.meta.items = this._itemsCache.length;
    this.meta.sizeEstimate = (this.meta.sizeEstimate || 0) + JSON.stringify(item).length;
    this.meta.lastAccess = iso();
    this.meta.energy = Math.min(1.0, (this.meta.energy || 0.1) + 0.05);
    
    this._recomputeCentroid();
    this._persistMeta();
    
    this.metrics.writes++;
    
    // Auto-compress if needed
    if (this.config.autoCompress && this.utilization(this.config.capacity || 1_000_000) > 0.75) {
      await this.compress();
    }
    
    return item;
  }
  
  async searchItems(queryEmbedding, topK = 10) {
    const start = Date.now();
    await this._ensureLoaded();
    
    const candidates = [];
    
    // If compressed, use cluster centroids for fast filtering
    if (this._compressed) {
      for (const entry of this._itemsCache) {
        if (entry.compressed) {
          const centroid = CompressionEngine.dequantize(entry.centroid);
          const centroidSim = cosine(queryEmbedding, centroid);
          
          if (centroidSim > 0.5) {
            // Decompress this cluster
            const items = CompressionEngine.decompressCluster(entry);
            for (const item of items) {
              const sim = cosine(queryEmbedding, item.embedding);
              candidates.push({ item, score: sim });
            }
          }
        } else if (entry.items) {
          for (const item of entry.items) {
            const sim = cosine(queryEmbedding, item.embedding);
            candidates.push({ item, score: sim });
          }
        }
      }
    } else {
      // Uncompressed search
      for (const item of this._itemsCache) {
        const sim = cosine(queryEmbedding, item.embedding);
        candidates.push({ item, score: sim });
      }
    }
    
    candidates.sort((a, b) => b.score - a.score);
    const results = candidates.slice(0, topK);
    
    // Update access times
    for (const { item } of results) {
      item.lastAccess = iso();
      item.score = Math.min(1.0, item.score + 0.02);
    }
    
    this.meta.lastAccess = iso();
    this.meta.energy = Math.min(1.0, (this.meta.energy || 0.1) + 0.03);
    this._persistMeta();
    
    this.metrics.reads++;
    console.log(`[TN:${this.id}] Search: ${candidates.length} candidates, ${results.length} results in ${Date.now() - start}ms`);
    
    return results;
  }
  
  // ========== COMPRESSION ==========
  async compress() {
    if (this.meta.compressed) return;
    
    const start = Date.now();
    await this._ensureLoaded();
    
    if (this._itemsCache.length < 10) {
      console.log(`[TN:${this.id}] Too few items to compress (${this._itemsCache.length})`);
      return;
    }
    
    const beforeSize = JSON.stringify(this._itemsCache).length;
    
    // Cluster similar items
    const clusters = await this._clusterItems();
    const compressed = [];
    
    for (const cluster of clusters) {
      const result = await CompressionEngine.compressCluster(cluster, this.config.compressionThreshold);
      compressed.push(result);
    }
    
    // Save compressed
    fs.writeFileSync(this.compressedFile, JSON.stringify(compressed, null, 2), 'utf-8');
    
    // Clear JSONL
    if (fs.existsSync(this.dataFile)) {
      fs.unlinkSync(this.dataFile);
    }
    
    this._itemsCache = compressed;
    this._compressed = true;
    
    const afterSize = JSON.stringify(compressed).length;
    const ratio = (beforeSize / afterSize).toFixed(1);
    
    this.meta.compressed = true;
    this.meta.compressionRatio = ratio + 'x';
    this.meta.sizeEstimate = afterSize;
    this._persistMeta();
    
    this.metrics.compressions++;
    
    console.log(`[TN:${this.id}] Compressed: ${(beforeSize/1024).toFixed(1)}KB → ${(afterSize/1024).toFixed(1)}KB (${ratio}x) in ${Date.now()-start}ms`);
    
    return { beforeSize, afterSize, ratio };
  }
  
  async _clusterItems() {
    // Simple agglomerative clustering
    const clusters = this._itemsCache.map(item => [item]);
    
    while (true) {
      let bestPair = null;
      let bestSim = this.config.compressionThreshold;
      
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const centroidI = CompressionEngine.computeCentroid(clusters[i].map(it => it.embedding));
          const centroidJ = CompressionEngine.computeCentroid(clusters[j].map(it => it.embedding));
          const sim = cosine(centroidI, centroidJ);
          
          if (sim > bestSim) {
            bestSim = sim;
            bestPair = [i, j];
          }
        }
      }
      
      if (!bestPair) break;
      
      const [i, j] = bestPair;
      clusters[i].push(...clusters[j]);
      clusters.splice(j, 1);
    }
    
    return clusters;
  }
  
  // ========== GRAPH LINKS ==========
  async linkTo(targetTnId, weight = 0.5, type = 'semantic') {
    if (type === 'semantic') {
      this.links.semantic.set(targetTnId, {
        weight,
        created: iso(),
        activations: 0
      });
    } else if (type === 'temporal') {
      this.links.temporal.set(targetTnId, {
        weight,
        lastCoAccess: iso(),
        count: 1
      });
    }
    this._persistLinks();
  }
  
  async strengthenLink(targetTnId, boost = 0.1) {
    if (this.links.semantic.has(targetTnId)) {
      const link = this.links.semantic.get(targetTnId);
      link.weight = Math.min(1.0, link.weight + boost);
      link.activations++;
      this._persistLinks();
    }
  }
  
  getNeighbors(minWeight = 0.1) {
    const neighbors = [];
    
    // Semantic
    for (const [tnId, link] of this.links.semantic) {
      if (link.weight >= minWeight) {
        neighbors.push({ tnId, weight: link.weight, type: 'semantic' });
      }
    }
    
    // Tree
    if (this.links.parent) {
      neighbors.push({ tnId: this.links.parent, weight: 0.6, type: 'parent' });
    }
    for (const childId of this.links.children) {
      neighbors.push({ tnId: childId, weight: 0.5, type: 'child' });
    }
    
    // Temporal
    for (const [tnId, link] of this.links.temporal) {
      if (link.count > 2) {
        neighbors.push({ tnId, weight: 0.4, type: 'temporal' });
      }
    }
    
    return neighbors;
  }
  
  // ========== MAINTENANCE ==========
  async pruneItems(decayLambda, pruneThreshold) {
    await this._ensureLoaded();
    
    // If compressed, decompress first
    if (this._compressed) {
      const decompressed = await this.items();
      this._itemsCache = decompressed;
      this._compressed = false;
    }
    
    const kept = [];
    const pruned = [];
    const nowt = Date.now();
    
    for (const item of this._itemsCache) {
      const dt = (nowt - new Date(item.lastAccess).getTime()) / 1000.0;
      const newScore = item.score * Math.exp(-decayLambda * dt);
      
      if (newScore < pruneThreshold) {
        pruned.push(item);
      } else {
        item.score = newScore;
        kept.push(item);
      }
    }
    
    if (pruned.length > 0) {
      this._itemsCache = kept;
      
      // Rewrite JSONL
      fs.writeFileSync(this.dataFile, kept.map(i => JSON.stringify(i)).join('\n') + (kept.length ? '\n' : ''), 'utf-8');
      
      this.meta.items = kept.length;
      this.meta.sizeEstimate = kept.reduce((s, i) => s + JSON.stringify(i).length, 0);
      
      this._recomputeCentroid();
      this._persistMeta();
      
      console.log(`[TN:${this.id}] Pruned ${pruned.length} items, kept ${kept.length}`);
    }
    
    this.meta.energy = Math.max(0, (this.meta.energy || 0.1) - 0.01);
    this._persistMeta();
    
    return { prunedCount: pruned.length, keptCount: kept.length };
  }
  
  async decayLinks(decayRate = 0.02) {
    let changed = false;
    
    for (const [tnId, link] of this.links.semantic) {
      link.weight = Math.max(0, link.weight - decayRate);
      if (link.weight < 0.05) {
        this.links.semantic.delete(tnId);
        changed = true;
      }
    }
    
    const now = Date.now();
    for (const [tnId, link] of this.links.temporal) {
      const age = (now - new Date(link.lastCoAccess).getTime()) / 86400000;
      if (age > 30) {
        this.links.temporal.delete(tnId);
        changed = true;
      }
    }
    
    if (changed) this._persistLinks();
    return changed;
  }
  
  _recomputeCentroid() {
    if (!this._itemsCache || this._itemsCache.length === 0) {
      this.meta.centroid = null;
      return;
    }
    
    // Handle compressed data
    if (this._compressed) {
      const allCentroids = [];
      for (const entry of this._itemsCache) {
        if (entry.compressed) {
          allCentroids.push(CompressionEngine.dequantize(entry.centroid));
        } else if (entry.items) {
          const embeddings = entry.items.map(i => i.embedding);
          allCentroids.push(CompressionEngine.computeCentroid(embeddings));
        }
      }
      this.meta.centroid = CompressionEngine.computeCentroid(allCentroids);
    } else {
      const embeddings = this._itemsCache.map(i => i.embedding);
      this.meta.centroid = CompressionEngine.computeCentroid(embeddings);
    }
  }
  
  // ========== UTILITIES ==========
  utilization(capacityEstimate) {
    return (this.meta.sizeEstimate || 0) / (capacityEstimate || 1);
  }
  
  ageSeconds() {
    return (Date.now() - new Date(this.meta.created).getTime()) / 1000.0;
  }
  
  centroid() {
    return this.meta.centroid;
  }
  
  status() {
    return {
      id: this.id,
      items: this.meta.items,
      size: `${(this.meta.sizeEstimate / 1024).toFixed(1)}KB`,
      compressed: this.meta.compressed,
      compressionRatio: this.meta.compressionRatio,
      energy: this.meta.energy.toFixed(2),
      links: {
        semantic: this.links.semantic.size,
        temporal: this.links.temporal.size,
        parent: !!this.links.parent,
        children: this.links.children.size
      },
      metrics: this.metrics
    };
  }
}

module.exports = { Transmitter, CompressionEngine };
