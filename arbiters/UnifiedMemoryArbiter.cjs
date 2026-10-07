// UnifiedMemoryArbiter.cjs - Distributed memory pooling across cluster nodes
const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const crypto = require('crypto');
const os = require('os');
const { promisify } = require('util');
const zlib = require('zlib');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// EXPERIMENTAL: MemoryAgent is experimental and not fully integrated
// Simple MemoryAgent implementation (hub client)
class MemoryAgent extends EventEmitter {
  constructor(config) {
    super();
    this.hubUrl = config.hubUrl;
    this.nodeId = config.nodeId;
    this.role = config.role;
    this.chunkPath = config.chunkPath || './memory-chunks';
    this.compressionHandler = config.compressionHandler;
    this.ramAllocated = new Map();
    this.swapAllocated = new Map();
    this._ws = null;
    this.connect();
  }

  connect() {
    this._ws = new WebSocket(this.hubUrl);
    this._ws.on('open', () => {
      console.log(`✅ MemoryAgent connected to hub`);
      this.emit('connected');
      this._ws.send(JSON.stringify({ type: 'register', nodeId: this.nodeId }));
    });
    this._ws.on('error', (err) => {
      // Suppress connection errors in standalone mode (no hub server)
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ENOTFOUND') {
        console.warn(`[MemoryAgent] Hub error: ${err.message}`);
      }
      this.emit('error', err);
    });
    this._ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        this.emit('message', msg);
      } catch (e) {
        this.emit('error', e);
      }
    });
  }

  startTelemetryLoop() {
    setInterval(() => {
      if (this._ws?.readyState === 1) {
        const telemetry = {
          type: 'telemetry',
          nodeId: this.nodeId,
          ramFree: os.freemem(),
          ramTotal: os.totalmem(),
          chunks: this.ramAllocated.size
        };
        this._ws.send(JSON.stringify(telemetry));
        this.emit('telemetry', telemetry);
      }
    }, 5000);
  }

  on(event, handler) {
    return super.on(event, handler);
  }

  async allocateLocalChunk(chunkId, size) {
    this.ramAllocated.set(chunkId, { size, buffer: Buffer.alloc(size) });
    if (this._ws?.readyState === 1) {
      this._ws.send(JSON.stringify({ type: 'allocate', chunkId, nodeId: this.nodeId, size }));
    }
  }

  async allocateRemoteChunk(nodeId, chunkId, size) {
    if (this._ws?.readyState === 1) {
      this._ws.send(JSON.stringify({ type: 'allocate', chunkId, nodeId, size }));
    }
  }

  async writeLocalChunk(chunkId, data) {
    const chunk = this.ramAllocated.get(chunkId);
    if (chunk) {
      data.copy(chunk.buffer, 0);
      if (this._ws?.readyState === 1) {
        this._ws.send(JSON.stringify({ type: 'write', chunkId, nodeId: this.nodeId, size: data.length }));
      }
    }
  }

  async readLocalChunk(chunkId) {
    const chunk = this.ramAllocated.get(chunkId);
    return chunk ? chunk.buffer : Buffer.alloc(0);
  }

  async transferChunkToNode(nodeId, chunkId, data, compressed) {
    // Simplified - in production would use direct node-to-node transfer
    if (this._ws?.readyState === 1) {
      this._ws.send(JSON.stringify({ type: 'transfer', chunkId, targetNode: nodeId, size: data.length, compressed }));
    }
  }

  async fetchRemoteChunk(nodeId, chunkId) {
    // Simplified - would fetch from remote node
    return Buffer.alloc(0);
  }

  close() {
    if (this._ws) this._ws.close();
  }
}

// Lightweight pipeline shim
class PipelineArbiter {
  constructor() {
    this.patterns = new Map();
  }

  async selectOptimalNode({ chunkIndex, totalChunks, hint, prediction }) {
    return prediction.target;
  }

  async planWrite({ chunks, dataSize }) {
    return { orderedChunks: chunks };
  }

  async planRead({ chunks, accessPattern }) {
    return { orderedChunks: chunks };
  }

  async analyzeTransferPatterns() {
    return new Map();
  }

  async recordTransfer({ layerIndex, startTime }) {
    // No-op
  }
}

/**
 * EXPERIMENTAL: UnifiedMemoryArbiter is experimental and not fully integrated into SOMA core
 * 
 * Status: Prototype
 * - MemoryAgent: Event emitter support added but hub integration incomplete
 * - PipelineArbiter: Stub implementation
 * - Memory pooling: Not fully tested with cluster nodes
 * 
 * TODO for production readiness:
 * 1. Complete Transmitter integration
 * 2. Implement real Mnemonic prediction (currently stub)
 * 3. Add distributed transfer protocols
 * 4. Comprehensive cluster testing
 * 
 * To use: Enable explicitly via config.enableUnifiedMemory = true
 * Default: Disabled (experimental)
 */
class UnifiedMemoryArbiter extends BaseArbiter {
  static role = 'unified_memory_orchestrator';
  static capabilities = ['unify', 'compress', 'distribute', 'prefetch', 'pipeline'];
  static EXPERIMENTAL = true; // Mark as experimental

  constructor(broker, config = {}) {
    // Support both (broker, config) and (config) signatures for compatibility
    if (typeof broker === 'object' && !broker.publish) {
      // Called with just config as first param
      config = broker;
      broker = null;
    }

    if (!config.enableUnifiedMemory) {
      throw new Error('UnifiedMemoryArbiter is EXPERIMENTAL and disabled by default. Set config.enableUnifiedMemory = true to enable.');
    }

    super({
      name: config.name || 'UnifiedMemoryArbiter',
      role: UnifiedMemoryArbiter.role,
      capabilities: UnifiedMemoryArbiter.capabilities
    });

    this.memoryAgent = new MemoryAgent({
      hubUrl: config.hubUrl || process.env.HUB_URL || 'ws://localhost:3001',
      nodeId: config.nodeId || os.hostname(),
      role: config.role || this.detectNodeRole(),
      chunkPath: config.chunkPath || './memory-chunks',
      compressionHandler: async (buffer) => {
        return await this.compressWithArchivist(buffer);
      }
    });

    // Prevent crash on connection error
    this.memoryAgent.on('error', (err) => {
        // Suppress connection errors in standalone/test mode
        if (err.code !== 'ECONNREFUSED') {
            console.warn(`[UnifiedMemoryArbiter] Agent error: ${err.message}`);
        }
    });

    this.pipeline = new PipelineArbiter();

    // Minimal mnemonic shim
    this.mnemonic = {
      hotCache: new Map(),
      async predict({ operation, size, hint, cluster }) {
        return { target: os.hostname() };
      },
      async recordPattern() {},
      async checkCache(id) { return this.hotCache.get(id); },
      async cache(id, buf) { this.hotCache.set(id, buf); },
      getAccessPattern() { return {}; },
      async predictRelated() { return []; }
    };

    this.tensorRegistry = new Map();
    this.chunkToTensor = new Map();
    this.clusterTopology = new Map();

    this.transferQueue = [];
    this.activeTransfers = new Map();
    this.prefetchQueue = [];

    this.metrics = {
      tensorsAllocated: 0,
      totalMemoryAllocated: 0,
      compressionRatio: 0,
      transfersCompleted: 0,
      cacheHits: 0,
      cacheMisses: 0,
      pipelineEfficiency: 0
    };

    this.init();
  }

  async init() {
    console.log(`🧠 UNIFIED MEMORY ARBITER INITIALIZING...`);
    console.log(`  Role: ${this.memoryAgent.role}`);
    console.log(`  Node: ${this.memoryAgent.nodeId}`);

    this.memoryAgent.startTelemetryLoop();
    this.startPipelineOptimizer();
    this.startPrefetcher();
    this.startCompressionOptimizer();

    await this.waitForConnection();

    console.log(`✨ UNIFIED MEMORY ONLINE!`);
    console.log(`  Local RAM: ${(os.totalmem() / 1024**3).toFixed(1)}GB`);
    console.log(`  Free RAM: ${(os.freemem() / 1024**3).toFixed(1)}GB`);
  }

  detectNodeRole() {
    const hostname = os.hostname().toLowerCase();
    if (hostname.includes('gaming') || hostname.includes('gpu')) return 'compute';
    if (hostname.includes('macbook') || hostname.includes('xbox')) return 'cache';
    if (hostname.includes('imac') || hostname.includes('mac')) return 'overflow';
    return 'worker';
  }

  async waitForConnection() {
    return new Promise((resolve) => {
      if (this.memoryAgent._ws?.readyState === 1) {
        resolve();
      } else {
        const checkConnection = setInterval(() => {
          if (this.memoryAgent._ws?.readyState === 1) {
            clearInterval(checkConnection);
            resolve();
          }
        }, 100);
      }
    });
  }

  async compressWithArchivist(buffer) {
    const startSize = buffer.length;
    const gzipped = await gzip(buffer);
    const ratio = startSize / gzipped.length;
    
    this.metrics.compressionRatio = (this.metrics.compressionRatio + ratio) / 2;
    
    return { 
      data: gzipped, 
      meta: { compressed: true, method: 'gzip', originalSize: startSize, ratio } 
    };
  }

  async allocateTensor(size, hint = {}) {
    const tensorId = crypto.randomBytes(8).toString('hex');
    const chunkSize = 64 * 1024 * 1024;
    const numChunks = Math.ceil(size / chunkSize);

    console.log(`\n🎯 Allocating tensor ${tensorId}`);
    console.log(`  Size: ${(size/1024**3).toFixed(2)}GB`);
    console.log(`  Chunks: ${numChunks}`);

    const placement = await this.mnemonic.predict({ 
      operation: 'allocate', 
      size, 
      hint, 
      cluster: Array.from(this.clusterTopology.values()) 
    });
    
    const chunks = [];

    for (let i = 0; i < numChunks; i++) {
      const chunkId = `${tensorId}_chunk_${i}`;
      const chunkSizeActual = Math.min(chunkSize, size - i * chunkSize);
      const target = await this.pipeline.selectOptimalNode({ 
        chunkIndex: i, 
        totalChunks: numChunks, 
        hint, 
        prediction: placement 
      });

      if (target === this.memoryAgent.nodeId) {
        await this.memoryAgent.allocateLocalChunk(chunkId, chunkSizeActual);
      } else {
        await this.memoryAgent.allocateRemoteChunk(target, chunkId, chunkSizeActual);
      }

      chunks.push({ chunkId, nodeId: target, size: chunkSizeActual, index: i });
      this.chunkToTensor.set(chunkId, tensorId);
    }

    this.tensorRegistry.set(tensorId, { 
      id: tensorId, 
      size, 
      chunks, 
      hint, 
      accessCount: 0, 
      lastAccess: Date.now(), 
      tier: this.calculateTier(chunks), 
      compressed: false 
    });
    
    this.metrics.tensorsAllocated++;
    this.metrics.totalMemoryAllocated += size;
    
    console.log(`✅ Tensor ${tensorId} allocated across ${new Set(chunks.map(c => c.nodeId)).size} nodes`);
    return { tensorId, chunks };
  }

  calculateTier(chunks) {
    const nodes = chunks.map(c => c.nodeId);
    const local = nodes.filter(n => n === this.memoryAgent.nodeId).length;
    if (local === chunks.length) return 'L1_LOCAL';
    if (local > chunks.length / 2) return 'L2_MIXED';
    return 'L3_REMOTE';
  }

  startPrefetcher() {
    setInterval(async () => {
      if (this.prefetchQueue.length === 0) return;
      this.prefetchQueue.sort((a, b) => b.priority - a.priority);
      const item = this.prefetchQueue.shift();
      try {
        console.log(`🔮 Prefetching ${item.tensorId} (${item.reason})`);
        await this.moveToFasterTier(item.tensorId);
      } catch (e) {
        console.warn(`Prefetch failed: ${e.message}`);
      }
    }, 1000);
  }

  async moveToFasterTier(tensorId) {
    const metadata = this.tensorRegistry.get(tensorId);
    if (!metadata) return;
    
    for (const chunk of metadata.chunks) {
      if (chunk.nodeId !== this.memoryAgent.nodeId) {
        const data = await this.memoryAgent.fetchRemoteChunk(chunk.nodeId, chunk.chunkId);
        await this.memoryAgent.writeLocalChunk(chunk.chunkId, data);
        chunk.nodeId = this.memoryAgent.nodeId;
      }
    }
    metadata.tier = 'L1_LOCAL';
  }

  startPipelineOptimizer() {
    setInterval(async () => {
      const patterns = await this.pipeline.analyzeTransferPatterns();
      for (const [tensorId, pattern] of patterns) {
        const metadata = this.tensorRegistry.get(tensorId);
        if (!metadata) continue;
        if (pattern.accessFrequency > 10 && metadata.tier !== 'L1_LOCAL') {
          console.log(`🔥 Moving hot tensor ${tensorId} to local tier`);
          await this.moveToFasterTier(tensorId);
        }
      }
    }, 5000);
  }

  startCompressionOptimizer() {
    setInterval(async () => {
      for (const [tensorId, metadata] of this.tensorRegistry) {
        const timeSinceAccess = Date.now() - metadata.lastAccess;
        if (timeSinceAccess > 60000 && !metadata.compressed) {
          console.log(`❄️ Compressing cold tensor ${tensorId}`);
          metadata.compressed = true;
        }
      }
    }, 10000);
  }

  getStatus() {
    return {
      node: { id: this.memoryAgent.nodeId, role: this.memoryAgent.role },
      memory: {
        ramTotal: (os.totalmem() / 1024**3).toFixed(1) + 'GB',
        ramFree: (os.freemem() / 1024**3).toFixed(1) + 'GB',
        chunksInRam: this.memoryAgent.ramAllocated.size,
        chunksOnSwap: this.memoryAgent.swapAllocated.size
      },
      tensors: {
        allocated: this.metrics.tensorsAllocated,
        totalSize: (this.metrics.totalMemoryAllocated / 1024**3).toFixed(1) + 'GB'
      },
      performance: {
        compressionRatio: this.metrics.compressionRatio.toFixed(1) + 'x',
        cacheHitRate: (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses || 1) * 100).toFixed(1) + '%',
        transfersCompleted: this.metrics.transfersCompleted
      }
    };
  }
}

module.exports = UnifiedMemoryArbiter;
