// ═══════════════════════════════════════════════════════════
// ClusterMemoryManager.js - Simplified Distributed Memory
// Integrates with existing ClusterCoordinator
// ═══════════════════════════════════════════════════════════

import EventEmitter from 'events';
import crypto from 'crypto';
import { promisify } from 'util';
import zlib from 'zlib';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export class ClusterMemoryManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.name = config.name || 'ClusterMemoryManager';
    this.coordinator = config.coordinator; // Reference to ClusterCoordinator
    this.nodeId = config.nodeId || crypto.randomUUID();
    
    // Memory storage
    this.localChunks = new Map(); // chunkId -> Buffer
    this.chunkMetadata = new Map(); // chunkId -> metadata
    this.tensorRegistry = new Map(); // tensorId -> tensor info
    
    // Compression settings
    this.compressionEnabled = config.compression !== false;
    this.chunkSize = config.chunkSize || 64 * 1024 * 1024; // 64MB
    
    // Metrics
    this.metrics = {
      chunksStored: 0,
      totalBytesStored: 0,
      compressionRatio: 1.0,
      remoteFetches: 0,
      cacheHits: 0
    };
    
    console.log(`💾 [${this.name}] Memory manager initialized`);
  }

  async initialize() {
    console.log(`🚀 [${this.name}] Starting memory manager...`);
    
    // Wire into coordinator events
    if (this.coordinator) {
      this.coordinator.on('node_heartbeat', (profile) => {
        this.handleNodeUpdate(profile);
      });
      
      this.coordinator.on('task_complete', (data) => {
        this.handleTaskComplete(data);
      });
    }
    
    console.log(`✅ [${this.name}] Memory manager ready`);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // TENSOR ALLOCATION
  // ═══════════════════════════════════════════════════════════

  async allocateTensor(size, options = {}) {
    const tensorId = crypto.randomBytes(8).toString('hex');
    const numChunks = Math.ceil(size / this.chunkSize);
    
    console.log(`📦 [${this.name}] Allocating tensor ${tensorId} (${(size/1024**3).toFixed(2)}GB, ${numChunks} chunks)`);
    
    const chunks = [];
    
    for (let i = 0; i < numChunks; i++) {
      const chunkId = `${tensorId}_${i}`;
      const chunkSize = Math.min(this.chunkSize, size - (i * this.chunkSize));
      
      // Determine placement (local vs remote)
      const nodeId = this.selectNodeForChunk(i, numChunks, options);
      
      chunks.push({
        chunkId,
        index: i,
        size: chunkSize,
        nodeId,
        allocated: Date.now()
      });
      
      // If local, pre-allocate
      if (nodeId === this.nodeId) {
        this.localChunks.set(chunkId, Buffer.alloc(0)); // Empty until written
        this.chunkMetadata.set(chunkId, {
          tensorId,
          index: i,
          size: chunkSize,
          compressed: false
        });
      }
    }
    
    // Register tensor
    this.tensorRegistry.set(tensorId, {
      id: tensorId,
      size,
      chunks,
      options,
      created: Date.now()
    });
    
    this.metrics.chunksStored += chunks.filter(c => c.nodeId === this.nodeId).length;
    
    return { tensorId, chunks };
  }

  selectNodeForChunk(index, total, options) {
    // Simple strategy: distribute round-robin if coordinator available
    if (this.coordinator && this.coordinator.nodes.size > 0) {
      const nodes = [this.nodeId, ...Array.from(this.coordinator.nodes.keys())];
      return nodes[index % nodes.length];
    }
    
    // Otherwise, keep local
    return this.nodeId;
  }

  // ═══════════════════════════════════════════════════════════
  // READ/WRITE OPERATIONS
  // ═══════════════════════════════════════════════════════════

  async writeTensor(tensorId, data) {
    const tensor = this.tensorRegistry.get(tensorId);
    if (!tensor) throw new Error(`Tensor ${tensorId} not found`);
    
    console.log(`✍️  [${this.name}] Writing tensor ${tensorId}`);
    
    let offset = 0;
    const writes = [];
    
    for (const chunk of tensor.chunks) {
      const chunkData = data.slice(offset, offset + chunk.size);
      offset += chunk.size;
      
      if (chunk.nodeId === this.nodeId) {
        // Local write
        writes.push(this.writeLocalChunk(chunk.chunkId, chunkData));
      } else {
        // Remote write via coordinator
        writes.push(this.writeRemoteChunk(chunk.nodeId, chunk.chunkId, chunkData));
      }
    }
    
    await Promise.all(writes);
    console.log(`✅ [${this.name}] Tensor ${tensorId} written`);
  }

  async writeLocalChunk(chunkId, data) {
    let finalData = data;
    let compressed = false;
    
    // Compress if enabled
    if (this.compressionEnabled && data.length > 1024) {
      const compressedData = await gzip(data);
      if (compressedData.length < data.length) {
        finalData = compressedData;
        compressed = true;
        
        const ratio = data.length / compressedData.length;
        this.metrics.compressionRatio = 
          (this.metrics.compressionRatio + ratio) / 2;
      }
    }
    
    this.localChunks.set(chunkId, finalData);
    
    const metadata = this.chunkMetadata.get(chunkId) || {};
    metadata.compressed = compressed;
    metadata.originalSize = data.length;
    metadata.storedSize = finalData.length;
    metadata.lastWrite = Date.now();
    this.chunkMetadata.set(chunkId, metadata);
    
    this.metrics.totalBytesStored += finalData.length;
  }

  async writeRemoteChunk(nodeId, chunkId, data) {
    // Send via coordinator if available
    if (this.coordinator) {
      const socket = this.coordinator.connections.get(nodeId);
      if (socket) {
        const compressed = this.compressionEnabled ? await gzip(data) : data;
        this.coordinator.sendMessage(socket, {
          type: 'memory_write',
          chunkId,
          data: compressed.toString('base64'),
          compressed: this.compressionEnabled
        });
      }
    }
  }

  async readTensor(tensorId) {
    const tensor = this.tensorRegistry.get(tensorId);
    if (!tensor) throw new Error(`Tensor ${tensorId} not found`);
    
    console.log(`📖 [${this.name}] Reading tensor ${tensorId}`);
    
    const reads = [];
    
    for (const chunk of tensor.chunks) {
      if (chunk.nodeId === this.nodeId) {
        reads.push(this.readLocalChunk(chunk.chunkId).then(data => ({
          index: chunk.index,
          data
        })));
      } else {
        reads.push(this.readRemoteChunk(chunk.nodeId, chunk.chunkId).then(data => ({
          index: chunk.index,
          data
        })));
      }
    }
    
    const results = await Promise.all(reads);
    results.sort((a, b) => a.index - b.index);
    
    const fullData = Buffer.concat(results.map(r => r.data));
    console.log(`✅ [${this.name}] Tensor ${tensorId} read (${(fullData.length/1024**3).toFixed(2)}GB)`);
    
    return fullData;
  }

  async readLocalChunk(chunkId) {
    const data = this.localChunks.get(chunkId);
    if (!data) throw new Error(`Chunk ${chunkId} not found locally`);
    
    const metadata = this.chunkMetadata.get(chunkId);
    
    // Decompress if needed
    if (metadata?.compressed) {
      return await gunzip(data);
    }
    
    this.metrics.cacheHits++;
    return data;
  }

  async readRemoteChunk(nodeId, chunkId) {
    this.metrics.remoteFetches++;
    
    // Would fetch via coordinator
    // For now, return empty buffer
    console.log(`  ⚠️  Remote fetch from ${nodeId} not yet implemented`);
    return Buffer.alloc(0);
  }

  // ═══════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════

  handleNodeUpdate(profile) {
    // Node joined/updated - could trigger rebalancing
    console.log(`  💾 Node ${profile.node} available for memory storage`);
  }

  handleTaskComplete(data) {
    // Task completed - could trigger cleanup
    console.log(`  💾 Task ${data.taskId} complete - memory cleanup possible`);
  }

  // ═══════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════

  getStatus() {
    return {
      name: this.name,
      nodeId: this.nodeId,
      memory: {
        chunksStored: this.localChunks.size,
        totalBytes: this.metrics.totalBytesStored,
        totalGB: (this.metrics.totalBytesStored / 1024**3).toFixed(2)
      },
      tensors: {
        total: this.tensorRegistry.size,
        list: Array.from(this.tensorRegistry.keys())
      },
      performance: {
        compressionRatio: this.metrics.compressionRatio.toFixed(2),
        remoteFetches: this.metrics.remoteFetches,
        cacheHits: this.metrics.cacheHits
      }
    };
  }

  async shutdown() {
    console.log(`🛑 [${this.name}] Shutting down memory manager...`);
    this.localChunks.clear();
    this.chunkMetadata.clear();
    this.tensorRegistry.clear();
  }
}

export default ClusterMemoryManager;
