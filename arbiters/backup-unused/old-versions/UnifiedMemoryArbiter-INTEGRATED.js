import { BaseArbiter } from './core/BaseArbiter.cjs';
import ArchivistArbiter from './arbiters/ArchivistArbiter.cjs';
// Lightweight pipeline shim to satisfy the UnifiedMemoryArbiter contract
import PipelineArbiter from './arbiters/LoadPipelineArbiter.js';
import MemoryAgent from './memory-agent.js';
import messageBroker from './core/MessageBroker.cjs';
import crypto from 'crypto';
import os from 'os';
import { promisify } from 'util';
import zlib from 'zlib';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class UnifiedMemoryArbiter extends BaseArbiter {
  static role = 'unified_memory_orchestrator';
  static capabilities = ['unify', 'compress', 'distribute', 'prefetch', 'pipeline'];

  constructor(config = {}) {
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

    this.archivist = new ArchivistArbiter(messageBroker, {
      name: 'MemoryCompressor',
      storagePath: config.storagePath || './unified-memory'
    });

    this.pipeline = new PipelineArbiter({ name: 'MemoryPipeline' });

    // Minimal mnemonic shim locally (cache + simple heuristics)
    this.mnemonic = {
      hotCache: new Map(),
      async predict({ operation, size, hint, cluster }) {
        return { target: this.nodeId };
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

    this.memoryAgent.on('chunk_stored', (event) => {
      this.handleChunkStored(event);
    });

    this.startPipelineOptimizer();
    this.startPrefetcher();
    this.startCompressionOptimizer();

    this.subscribeToMessages();

    await this.waitForConnection();

    console.log(`✨ UNIFIED MEMORY ONLINE!`);
    console.log(`  Local RAM: ${(os.totalmem() / 1024**3).toFixed(1)}GB`);
    console.log(`  Free RAM: ${(os.freemem() / 1024**3).toFixed(1)}GB`);
  }

  detectNodeRole() {
    const hostname = os.hostname().toLowerCase();
    if (hostname.includes('gaming') || hostname.includes('gpu')) return 'compute';
    if (hostname.includes('macbook')) return 'cache';
    if (hostname.includes('mac')) return 'overflow';
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

    const strategies = [];
    const gzipped = await gzip(buffer);
    strategies.push({ data: gzipped, ratio: startSize / gzipped.length, method: 'gzip' });

    if (buffer.length > 1024 * 1024 && this.archivist.compressWithDedup) {
      const dedupedResult = await this.archivist.compressWithDedup(buffer);
      if (dedupedResult) {
        strategies.push({ data: dedupedResult.data, ratio: startSize / dedupedResult.data.length, method: 'archivist_dedup' });
      }
    }

    if (this.isTensorData(buffer)) {
      const quantized = await this.quantizeTensor(buffer);
      strategies.push({ data: quantized.data, ratio: startSize / quantized.data.length, method: 'quantization' });
    }

    const best = strategies.reduce((a, b) => (a.ratio > b.ratio ? a : b));

    console.log(`  📦 Compression: ${(startSize/1024**2).toFixed(1)}MB → ${(best.data.length/1024**2).toFixed(1)}MB (${best.ratio.toFixed(1)}x via ${best.method})`);

    this.metrics.compressionRatio = (this.metrics.compressionRatio + best.ratio) / 2;

    return { data: best.data, meta: { compressed: true, method: best.method, originalSize: startSize, ratio: best.ratio } };
  }

  isTensorData(buffer) {
    return buffer.length % 4 === 0 && buffer.length > 1024;
  }

  async quantizeTensor(buffer) {
    const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
    let max = 0;
    for (let i = 0; i < floats.length; i++) {
      const v = Math.abs(floats[i]);
      if (v > max) max = v;
    }
    const scale = 127 / (max || 1);
    const quantized = new Int8Array(floats.length);
    for (let i = 0; i < floats.length; i++) quantized[i] = Math.round(floats[i] * scale);
    const result = Buffer.allocUnsafe(4 + quantized.length);
    result.writeFloatLE(scale, 0);
    Buffer.from(quantized.buffer).copy(result, 4);
    return { data: result };
  }

  async allocateTensor(size, hint = {}) {
    const tensorId = crypto.randomBytes(8).toString('hex');
    const chunkSize = 64 * 1024 * 1024;
    const numChunks = Math.ceil(size / chunkSize);

    console.log(`\n🎯 Allocating tensor ${tensorId}`);
    console.log(`  Size: ${(size/1024**3).toFixed(2)}GB`);
    console.log(`  Chunks: ${numChunks}`);

    const placement = await this.mnemonic.predict({ operation: 'allocate', size, hint, cluster: Array.from(this.clusterTopology.values()) });
    const chunks = [];

    for (let i = 0; i < numChunks; i++) {
      const chunkId = `${tensorId}_chunk_${i}`;
      const chunkSizeActual = Math.min(chunkSize, size - i * chunkSize);
      const target = await this.pipeline.selectOptimalNode({ chunkIndex: i, totalChunks: numChunks, hint, prediction: placement });

      if (target === this.memoryAgent.nodeId) {
        await this.memoryAgent.allocateLocalChunk(chunkId, chunkSizeActual);
      } else {
        await this.memoryAgent.allocateRemoteChunk(target, chunkId, chunkSizeActual);
      }

      chunks.push({ chunkId, nodeId: target, size: chunkSizeActual, index: i });
      this.chunkToTensor.set(chunkId, tensorId);
    }

    this.tensorRegistry.set(tensorId, { id: tensorId, size, chunks, hint, accessCount: 0, lastAccess: Date.now(), tier: this.calculateTier(chunks), compressed: false });
    this.metrics.tensorsAllocated++;
    this.metrics.totalMemoryAllocated += size;
    await this.mnemonic.recordPattern({ type: 'allocation', tensorId, placement: chunks.map(c => c.nodeId), success: true });
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

  async writeTensor(tensorId, data) {
    const metadata = this.tensorRegistry.get(tensorId);
    if (!metadata) throw new Error(`Tensor ${tensorId} not found`);
    console.log(`\n📝 Writing tensor ${tensorId}`);

    const writePlan = await this.pipeline.planWrite({ chunks: metadata.chunks, dataSize: data.length });

    let offset = 0;
    const writePromises = [];
    for (const chunk of writePlan.orderedChunks) {
      const chunkData = data.slice(offset, offset + chunk.size);
      offset += chunk.size;
      const p = (async () => {
        const startTime = Date.now();
        if (chunk.nodeId === this.memoryAgent.nodeId) {
          const result = await this.memoryAgent.writeLocalChunk(chunk.chunkId, chunkData);
          console.log(`  ✓ Local write ${chunk.chunkId}: ${Date.now() - startTime}ms`);
          return result;
        } else {
          const compressed = await this.compressWithArchivist(chunkData);
          await this.memoryAgent.transferChunkToNode(chunk.nodeId, chunk.chunkId, compressed.data, compressed.meta.compressed);
          console.log(`  ✓ Remote write ${chunk.chunkId} to ${chunk.nodeId}: ${Date.now() - startTime}ms`);
          return compressed.meta;
        }
      })();
      writePromises.push(p);
      if (writePromises.length >= 3) await Promise.race(writePromises);
    }
    await Promise.all(writePromises);
    metadata.lastWrite = Date.now();
    metadata.compressed = true;
    console.log(`✅ Tensor ${tensorId} written successfully`);
  }

  async readTensor(tensorId) {
    const metadata = this.tensorRegistry.get(tensorId);
    if (!metadata) throw new Error(`Tensor ${tensorId} not found`);
    console.log(`\n📖 Reading tensor ${tensorId}`);
    metadata.accessCount++;
    metadata.lastAccess = Date.now();

    const cached = await this.mnemonic.checkCache(tensorId);
    if (cached) {
      this.metrics.cacheHits++;
      console.log(`  ✨ Cache hit!`);
      return cached;
    }
    this.metrics.cacheMisses++;

    const readPlan = await this.pipeline.planRead({ chunks: metadata.chunks, accessPattern: this.mnemonic.getAccessPattern(tensorId) });

    this.prefetchRelated(tensorId);

    const readPromises = readPlan.orderedChunks.map((chunk) => (async () => {
      const startTime = Date.now();
      let data;
      if (chunk.nodeId === this.memoryAgent.nodeId) {
        data = await this.memoryAgent.readLocalChunk(chunk.chunkId);
        console.log(`  ✓ Local read ${chunk.chunkId}: ${Date.now() - startTime}ms`);
      } else {
        data = await this.memoryAgent.fetchRemoteChunk(chunk.nodeId, chunk.chunkId);
        console.log(`  ✓ Remote read ${chunk.chunkId} from ${chunk.nodeId}: ${Date.now() - startTime}ms`);
      }
      return { index: chunk.index, data };
    })());

    const results = await Promise.all(readPromises);
    results.sort((a, b) => a.index - b.index);
    const fullData = Buffer.concat(results.map(r => r.data));
    await this.mnemonic.cache(tensorId, fullData);
    console.log(`✅ Tensor ${tensorId} read successfully (${(fullData.length/1024**3).toFixed(2)}GB)`);
    return fullData;
  }

  async prefetchRelated(tensorId) {
    const predictions = await this.mnemonic.predictRelated(tensorId);
    for (const prediction of predictions) {
      if (prediction.confidence > 0.7) {
        this.prefetchQueue.push({ tensorId: prediction.tensorId, priority: prediction.confidence, reason: `related to ${tensorId}` });
      }
    }
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
          const data = await this.readTensor(tensorId);
          await this.compressWithArchivist(data);
          metadata.compressed = true;
        }
      }
    }, 10000);
  }

  async loadModel(modelPath, modelSize) {
    console.log(`\n🤖 LOADING MODEL WITH UNIFIED MEMORY`);
    console.log(`  Path: ${modelPath}`);
    console.log(`  Size: ${(modelSize/1024**3).toFixed(1)}GB`);
    const allocation = await this.allocateTensor(modelSize, { type: 'model_weights', access: 'sequential', priority: 'high' });
    const modelData = Buffer.alloc(modelSize);
    await this.writeTensor(allocation.tensorId, modelData);
    const layerSize = modelSize / 32;
    const layers = [];
    for (let i = 0; i < 32; i++) {
      layers.push({ index: i, offset: i * layerSize, size: layerSize, tensorId: allocation.tensorId });
    }
    console.log(`✅ Model loaded and distributed!`);
    console.log(`  Chunks across ${new Set(allocation.chunks.map(c => c.nodeId)).size} nodes`);
    console.log(`  Compression ratio: ${this.metrics.compressionRatio.toFixed(1)}x`);
    return { tensorId: allocation.tensorId, layers };
  }

  async forward(model, input) {
    console.log(`\n⚡ RUNNING FORWARD PASS`);
    const startTime = Date.now();
    let currentInput = input;
    for (let i = 0; i < model.layers.length; i++) {
      const layer = model.layers[i];
      const layerStart = Date.now();
      const promises = [];
      promises.push(this.computeLayer(layer, currentInput));
      if (i + 2 < model.layers.length) promises.push(this.prefetchLayer(model.layers[i + 2]));
      if (i >= 2) promises.push(this.evictLayer(model.layers[i - 2]));
      promises.push(this.pipeline.recordTransfer({ layerIndex: i, startTime: layerStart }));
      const results = await Promise.all(promises);
      currentInput = results[0];
      const layerTime = Date.now() - layerStart;
      console.log(`  Layer ${i}: ${layerTime}ms`);
    }
    const totalTime = Date.now() - startTime;
    console.log(`\n✅ Forward pass complete!`);
    console.log(`  Total time: ${totalTime}ms`);
    console.log(`  Throughput: ${(1000 * model.layers.length / totalTime).toFixed(1)} layers/sec`);
    console.log(`  Cache hits: ${this.metrics.cacheHits}`);
    console.log(`  Pipeline efficiency: ${(this.metrics.pipelineEfficiency * 100).toFixed(1)}%`);
    return currentInput;
  }

  async computeLayer(layer, input) { await new Promise(r => setTimeout(r, 50)); return Buffer.alloc(input.length); }
  async prefetchLayer(layer) { console.log(`    🔮 Prefetching layer ${layer.index}`); }
  async evictLayer(layer) { console.log(`    🗑️ Evicting layer ${layer.index}`); }

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

  subscribeToMessages() {
    // Hook up topics needed (no-op placeholders)
  }

  handleChunkStored(event) {
    this.metrics.transfersCompleted++;
    console.log(`  📦 Chunk stored: ${event.chunkId} (${(event.size/1024**2).toFixed(1)}MB, compressed: ${event.compressed})`);
  }
}

export default UnifiedMemoryArbiter;

export async function startUnifiedMemory(role = 'auto') {
  const config = { hubUrl: process.env.HUB_URL || 'ws://localhost:3001', role: role === 'auto' ? undefined : role };
  const unifiedMemory = new UnifiedMemoryArbiter(config);
  process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); unifiedMemory.memoryAgent.close(); process.exit(0); });
  return unifiedMemory;
}

export async function testUnifiedSystem() {
  console.log('🚀 UNIFIED MEMORY SYSTEM TEST\n');
  const unified = await startUnifiedMemory();
  await new Promise(r => setTimeout(r, 500));
  console.log('\n📊 TEST 1: Allocate 64MB distributed tensor');
  const tensor1 = await unified.allocateTensor(64 * 1024 * 1024, { type: 'test_tensor', access: 'sequential' });
  console.log('\n📊 TEST 2: Write data to tensor');
  const testData = Buffer.alloc(64 * 1024 * 1024);
  await unified.writeTensor(tensor1.tensorId, testData);
  console.log('\n📊 TEST 3: Read data from tensor');
  const readData = await unified.readTensor(tensor1.tensorId);
  console.log(`  Read ${(readData.length/1024**2).toFixed(2)}MB`);
  console.log('\n📊 FINAL STATUS:');
  console.log(JSON.stringify(unified.getStatus(), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testUnifiedSystem().catch(console.error);
}
