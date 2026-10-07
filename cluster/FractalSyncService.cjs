// ═══════════════════════════════════════════════════════════
// FractalSyncService.cjs - Distributed Fractal Intelligence Network
// Enables SOMA instances to share and merge cognitive fractals
// ═══════════════════════════════════════════════════════════

const EventEmitter = require('events');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * FractalSyncService
 *
 * Manages sharing and merging of:
 * - ThoughtNetwork fractals
 * - Causality chains
 * - Knowledge graph nodes
 * - Learned patterns
 *
 * Architecture:
 *   User Instance → compresses fractals → uploads to coordinator
 *   Coordinator → merges all fractals → creates global knowledge
 *   Coordinator → pushes updates → all instances get smarter
 */
class FractalSyncService extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'FractalSyncService';
    this.role = config.role || 'worker'; // 'coordinator' or 'worker'
    this.nodeId = config.nodeId || this._generateNodeId();

    // Connected systems
    this.thoughtNetwork = config.thoughtNetwork;
    this.causalityArbiter = config.causalityArbiter;
    this.knowledgeGraph = config.knowledgeGraph;
    this.swarm = config.swarm; // MicroAgentPool for fractal analysis

    // Network config
    this.coordinatorUrl = config.coordinatorUrl || process.env.SOMA_COORDINATOR;
    this.syncInterval = config.syncInterval || 3600000; // 1 hour
    this.minFractalsForSync = config.minFractalsForSync || 50; // Sync after 50 new fractals

    // Local storage
    this.dataDir = config.dataDir || path.join(process.cwd(), '.soma', 'sync');
    this.lastSyncTime = 0;
    this.localFractalCount = 0;

    // Coordinator state (if coordinator role)
    this.globalFractals = new Map(); // nodeId → fractals
    this.mergedNetwork = null;
    this.versionNumber = 1;

    // Stats
    this.stats = {
      totalSyncs: 0,
      fractalsUploaded: 0,
      fractalsDownloaded: 0,
      mergesPerformed: 0,
      compressionRatio: 0
    };

    this.syncTimer = null;

    console.log(`[${this.name}] 🌐 Fractal Sync Service initialized (${this.role})`);
  }

  async initialize() {
    console.log(`[${this.name}] Initializing...`);

    // Create data directory
    await fs.mkdir(this.dataDir, { recursive: true });

    if (this.role === 'coordinator') {
      await this._initializeCoordinator();
    } else {
      await this._initializeWorker();
    }

    console.log(`[${this.name}] ✅ Initialized as ${this.role}`);
  }

  /**
   * WORKER METHODS
   */

  async _initializeWorker() {
    // Start periodic sync
    this.syncTimer = setInterval(async () => {
      await this.syncWithCoordinator();
    }, this.syncInterval);

    // Immediate sync on startup (after 30s)
    setTimeout(() => this.syncWithCoordinator(), 30000);

    console.log(`[${this.name}]    Will sync every ${this.syncInterval / 60000} minutes`);
  }

  /**
   * Sync local fractals with coordinator
   */
  async syncWithCoordinator() {
    if (!this.coordinatorUrl) {
      console.warn(`[${this.name}] No coordinator configured - skipping sync`);
      return;
    }

    try {
      console.log(`\n[${this.name}] 🔄 Starting fractal sync...`);

      // Step 1: Compress local fractals using swarm (if available)
      const compressedFractals = await this._compressFractals();

      if (compressedFractals.totalFractals < this.minFractalsForSync) {
        console.log(`[${this.name}]    Not enough new fractals (${compressedFractals.totalFractals}/${this.minFractalsForSync})`);
        return;
      }

      // Step 2: Upload to coordinator
      const uploadResult = await this._uploadFractals(compressedFractals);

      if (!uploadResult.success) {
        throw new Error('Upload failed');
      }

      console.log(`[${this.name}]    ✅ Uploaded ${compressedFractals.totalFractals} fractals`);
      this.stats.fractalsUploaded += compressedFractals.totalFractals;

      // Step 3: Download global fractals from coordinator
      const globalUpdate = await this._downloadGlobalFractals();

      if (globalUpdate && globalUpdate.fractals) {
        console.log(`[${this.name}]    📥 Received ${globalUpdate.newFractalCount} new fractals`);

        // Step 4: Merge global fractals into local network
        await this._mergeGlobalFractals(globalUpdate.fractals);

        console.log(`[${this.name}]    ✅ Merged global knowledge (version ${globalUpdate.version})`);
        this.stats.fractalsDownloaded += globalUpdate.newFractalCount;
      }

      this.lastSyncTime = Date.now();
      this.stats.totalSyncs++;

      console.log(`[${this.name}] ✅ Sync complete!\n`);
      this.emit('sync_complete', { uploaded: compressedFractals.totalFractals, downloaded: globalUpdate?.newFractalCount || 0 });

    } catch (err) {
      console.error(`[${this.name}] ❌ Sync failed:`, err.message);
      this.emit('sync_error', { error: err.message });
    }
  }

  /**
   * Compress fractals using swarm intelligence
   */
  async _compressFractals() {
    const result = {
      thoughtNetwork: null,
      causalChains: null,
      knowledgeGraph: null,
      totalFractals: 0,
      compressionRatio: 1.0
    };

    // Extract ThoughtNetwork fractals
    if (this.thoughtNetwork) {
      const stats = this.thoughtNetwork.getStats();
      const totalNodes = stats.totalNodes || 0;

      if (totalNodes > 0) {
        console.log(`[${this.name}]    🧠 Extracting ${totalNodes} thought fractals...`);

        // Use swarm to analyze and compress if available
        if (this.swarm && totalNodes > 100) {
          result.thoughtNetwork = await this._swarmCompressThoughts(totalNodes);
        } else {
          // Simple export if no swarm or small network
          result.thoughtNetwork = await this._exportThoughtNetwork();
        }

        result.totalFractals += totalNodes;
      }
    }

    // Extract causality chains
    if (this.causalityArbiter && this.causalityArbiter.exportChains) {
      const chains = await this.causalityArbiter.exportChains();
      if (chains && chains.length > 0) {
        console.log(`[${this.name}]    🔗 Extracting ${chains.length} causal chains...`);
        result.causalChains = chains;
        result.totalFractals += chains.length;
      }
    }

    // Extract knowledge graph
    if (this.knowledgeGraph && this.knowledgeGraph.exportGraph) {
      const graph = await this.knowledgeGraph.exportGraph();
      if (graph && graph.nodes) {
        console.log(`[${this.name}]    📊 Extracting knowledge graph (${graph.nodes.length} nodes)...`);
        result.knowledgeGraph = graph;
        result.totalFractals += graph.nodes.length;
      }
    }

    console.log(`[${this.name}]    📦 Total fractals: ${result.totalFractals}`);

    return result;
  }

  /**
   * Use swarm to compress thought network (remove redundancy)
   */
  async _swarmCompressThoughts(nodeCount) {
    console.log(`[${this.name}]       🐝 Deploying swarm to compress ${nodeCount} nodes...`);

    try {
      // Create micro-agents to analyze fractal clusters
      const tasks = [];
      const nodesPerAgent = Math.ceil(nodeCount / 10); // 10 agents max

      for (let i = 0; i < Math.min(10, nodeCount); i++) {
        tasks.push({
          type: 'fractal_analysis',
          nodeRange: [i * nodesPerAgent, (i + 1) * nodesPerAgent],
          objective: 'identify_redundancy_and_compress'
        });
      }

      // Swarm analyzes and compresses in parallel
      const results = await this.swarm.executeTasks(tasks);

      // Aggregate compressed fractals
      const compressed = {
        nodes: [],
        compressionRatio: 1.0
      };

      results.forEach(r => {
        if (r.compressedNodes) {
          compressed.nodes.push(...r.compressedNodes);
        }
      });

      compressed.compressionRatio = compressed.nodes.length / nodeCount;

      console.log(`[${this.name}]       ✅ Compressed ${nodeCount} → ${compressed.nodes.length} (${(compressed.compressionRatio * 100).toFixed(0)}%)`);

      return compressed;

    } catch (err) {
      console.warn(`[${this.name}]       ⚠️  Swarm compression failed, using raw export:`, err.message);
      return await this._exportThoughtNetwork();
    }
  }

  /**
   * Simple export of thought network
   */
  async _exportThoughtNetwork() {
    const savePath = path.join(this.dataDir, 'thought-network-export.json');
    await this.thoughtNetwork.save();

    // Read saved file
    const data = JSON.parse(await fs.readFile(savePath, 'utf8'));
    return data;
  }

  /**
   * Upload fractals to coordinator
   */
  async _uploadFractals(fractals) {
    const url = `http://${this.coordinatorUrl}/fractals/upload`;

    const payload = {
      nodeId: this.nodeId,
      timestamp: Date.now(),
      fractals,
      stats: this.stats
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 30000
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    return await res.json();
  }

  /**
   * Download global fractals from coordinator
   */
  async _downloadGlobalFractals() {
    const url = `http://${this.coordinatorUrl}/fractals/download?nodeId=${this.nodeId}`;

    const res = await fetch(url, {
      method: 'GET',
      timeout: 30000
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  }

  /**
   * Merge global fractals into local cognitive systems
   */
  async _mergeGlobalFractals(globalFractals) {
    let merged = 0;

    // Merge ThoughtNetwork
    if (globalFractals.thoughtNetwork && this.thoughtNetwork) {
      const result = await this._mergeThoughtNetwork(globalFractals.thoughtNetwork);
      merged += result.newNodes;
      console.log(`[${this.name}]       🧠 Merged ${result.newNodes} new thought nodes`);
    }

    // Merge Causality Chains
    if (globalFractals.causalChains && this.causalityArbiter) {
      const result = await this._mergeCausalChains(globalFractals.causalChains);
      merged += result.newChains;
      console.log(`[${this.name}]       🔗 Merged ${result.newChains} new causal chains`);
    }

    // Merge Knowledge Graph
    if (globalFractals.knowledgeGraph && this.knowledgeGraph) {
      const result = await this._mergeKnowledgeGraph(globalFractals.knowledgeGraph);
      merged += result.newNodes;
      console.log(`[${this.name}]       📊 Merged ${result.newNodes} new knowledge nodes`);
    }

    return { totalMerged: merged };
  }

  async _mergeThoughtNetwork(globalNodes) {
    // Simple merge: add nodes that don't exist locally
    let newNodes = 0;

    for (const nodeData of globalNodes.nodes || []) {
      const exists = this.thoughtNetwork.nodes.has(nodeData.id);
      if (!exists) {
        // Add new node
        await this.thoughtNetwork.addNode(nodeData.content, nodeData.metadata);
        newNodes++;
      }
    }

    return { newNodes };
  }

  async _mergeCausalChains(globalChains) {
    let newChains = 0;

    if (!this.causalityArbiter.importChains) {
      return { newChains: 0 };
    }

    // Import chains
    const result = await this.causalityArbiter.importChains(globalChains);
    newChains = result.added || 0;

    return { newChains };
  }

  async _mergeKnowledgeGraph(globalGraph) {
    let newNodes = 0;

    if (!this.knowledgeGraph.mergeGraph) {
      return { newNodes: 0 };
    }

    const result = await this.knowledgeGraph.mergeGraph(globalGraph);
    newNodes = result.nodesAdded || 0;

    return { newNodes };
  }

  /**
   * COORDINATOR METHODS
   */

  async _initializeCoordinator() {
    console.log(`[${this.name}]    📡 Starting coordinator server...`);

    // Load existing global fractals if any
    await this._loadGlobalFractals();

    // Set up HTTP endpoints (would need Express/Fastify integration)
    // For now, just log
    console.log(`[${this.name}]    Endpoints ready:`);
    console.log(`[${this.name}]       POST /fractals/upload - Worker uploads`);
    console.log(`[${this.name}]       GET  /fractals/download - Worker downloads`);
  }

  /**
   * Handle fractal upload from worker
   */
  async handleUpload(nodeId, fractals) {
    console.log(`[${this.name}] 📥 Receiving fractals from ${nodeId}...`);

    // Store fractals
    this.globalFractals.set(nodeId, {
      fractals,
      timestamp: Date.now(),
      nodeId
    });

    // Trigger merge
    await this._mergeAllFractals();

    console.log(`[${this.name}]    ✅ Stored fractals from ${nodeId}`);

    return {
      success: true,
      version: this.versionNumber,
      nodesInGlobal: this.globalFractals.size
    };
  }

  /**
   * Handle fractal download request from worker
   */
  async handleDownload(requestingNodeId) {
    console.log(`[${this.name}] 📤 Sending global fractals to ${requestingNodeId}...`);

    if (!this.mergedNetwork) {
      return {
        success: false,
        message: 'No global fractals available yet'
      };
    }

    // Calculate what's new for this worker
    const workerData = this.globalFractals.get(requestingNodeId);
    const newFractalCount = this._calculateNewFractals(requestingNodeId);

    return {
      success: true,
      version: this.versionNumber,
      fractals: this.mergedNetwork,
      newFractalCount,
      totalNodes: this.globalFractals.size
    };
  }

  /**
   * Merge fractals from all workers into global network
   */
  async _mergeAllFractals() {
    console.log(`[${this.name}] 🔀 Merging fractals from ${this.globalFractals.size} nodes...`);

    const merged = {
      thoughtNetwork: { nodes: [], connections: [] },
      causalChains: [],
      knowledgeGraph: { nodes: [], edges: [] }
    };

    let totalFractals = 0;

    // Aggregate all fractals
    for (const [nodeId, data] of this.globalFractals.entries()) {
      const { fractals } = data;

      // Merge thought networks
      if (fractals.thoughtNetwork && fractals.thoughtNetwork.nodes) {
        merged.thoughtNetwork.nodes.push(...fractals.thoughtNetwork.nodes);
        totalFractals += fractals.thoughtNetwork.nodes.length;
      }

      // Merge causal chains
      if (fractals.causalChains) {
        merged.causalChains.push(...fractals.causalChains);
        totalFractals += fractals.causalChains.length;
      }

      // Merge knowledge graphs
      if (fractals.knowledgeGraph && fractals.knowledgeGraph.nodes) {
        merged.knowledgeGraph.nodes.push(...fractals.knowledgeGraph.nodes);
        totalFractals += fractals.knowledgeGraph.nodes.length;
      }
    }

    // Deduplicate (remove duplicates by ID)
    merged.thoughtNetwork.nodes = this._deduplicateById(merged.thoughtNetwork.nodes);
    merged.causalChains = this._deduplicateByKey(merged.causalChains, chain => `${chain.cause}→${chain.effect}`);
    merged.knowledgeGraph.nodes = this._deduplicateById(merged.knowledgeGraph.nodes);

    this.mergedNetwork = merged;
    this.versionNumber++;
    this.stats.mergesPerformed++;

    console.log(`[${this.name}]    ✅ Global network: ${totalFractals} total fractals (deduplicated)`);
    console.log(`[${this.name}]    Version ${this.versionNumber}`);

    // Save global network
    await this._saveGlobalFractals();

    this.emit('merge_complete', { version: this.versionNumber, totalFractals });
  }

  async _loadGlobalFractals() {
    const globalPath = path.join(this.dataDir, 'global-fractals.json');

    try {
      const data = JSON.parse(await fs.readFile(globalPath, 'utf8'));
      this.mergedNetwork = data.mergedNetwork;
      this.versionNumber = data.version || 1;
      console.log(`[${this.name}]    Loaded global fractals (version ${this.versionNumber})`);
    } catch (err) {
      console.log(`[${this.name}]    No existing global fractals, starting fresh`);
    }
  }

  async _saveGlobalFractals() {
    const globalPath = path.join(this.dataDir, 'global-fractals.json');

    const data = {
      mergedNetwork: this.mergedNetwork,
      version: this.versionNumber,
      timestamp: Date.now(),
      stats: this.stats
    };

    await fs.writeFile(globalPath, JSON.stringify(data, null, 2));
  }

  _deduplicateById(items) {
    const seen = new Set();
    return items.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  _deduplicateByKey(items, keyFn) {
    const seen = new Set();
    return items.filter(item => {
      const key = keyFn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _calculateNewFractals(nodeId) {
    // Calculate how many fractals are new since this node's last sync
    // Simplified: just return total for now
    return this.mergedNetwork ?
      (this.mergedNetwork.thoughtNetwork?.nodes?.length || 0) +
      (this.mergedNetwork.causalChains?.length || 0) +
      (this.mergedNetwork.knowledgeGraph?.nodes?.length || 0) : 0;
  }

  _generateNodeId() {
    return `soma-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown() {
    console.log(`[${this.name}] Shutting down...`);

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.role === 'coordinator') {
      await this._saveGlobalFractals();
    }

    console.log(`[${this.name}] ✅ Shut down`);
  }

  getStats() {
    return {
      ...this.stats,
      role: this.role,
      lastSyncTime: this.lastSyncTime,
      localFractalCount: this.localFractalCount,
      globalVersion: this.versionNumber
    };
  }
}

module.exports = { FractalSyncService };
