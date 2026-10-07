// TransmitterSync.cjs
// Federated knowledge sharing and synchronization across cluster nodes

const fetch = require('node-fetch');
const EventEmitter = require('events');

class TransmitterSync extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.nodeId = config.nodeId;
    this.clusterNode = config.clusterNode; // Reference to ClusterNode
    this.transmitter = config.transmitter; // Reference to local Transmitter
    
    this.syncInterval = config.syncInterval || 60000; // 1 minute
    this.batchSize = config.batchSize || 50; // Memories per sync
    
    this.logger = config.logger || console;
    
    // Sync state
    this.lastSyncTime = new Map(); // nodeId -> timestamp
    this.syncInProgress = false;
    
    // Federation metadata
    this.federationVersion = 0; // Increments on local changes
    this.remoteVersions = new Map(); // nodeId -> version
    
    this._syncTimer = null;
  }
  
  start() {
    this.logger.info(`[TransmitterSync:${this.nodeId}] Starting synchronization service...`);
    
    // Start periodic sync
    this._syncTimer = setInterval(() => {
      this._periodicSync();
    }, this.syncInterval);
    
    this.logger.info(`[TransmitterSync:${this.nodeId}] Sync service started (interval: ${this.syncInterval}ms)`);
  }
  
  stop() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
    
    this.logger.info(`[TransmitterSync:${this.nodeId}] Sync service stopped`);
  }
  
  async _periodicSync() {
    if (this.syncInProgress) {
      this.logger.debug(`[TransmitterSync:${this.nodeId}] Sync already in progress, skipping...`);
      return;
    }
    
    try {
      this.syncInProgress = true;
      await this.syncWithCluster();
    } catch (err) {
      this.logger.error(`[TransmitterSync:${this.nodeId}] Sync error: ${err.message}`);
    } finally {
      this.syncInProgress = false;
    }
  }
  
  async syncWithCluster() {
    if (!this.clusterNode || !this.transmitter) {
      this.logger.warn(`[TransmitterSync:${this.nodeId}] Not properly configured, skipping sync`);
      return;
    }
    
    const nodes = Array.from(this.clusterNode.knownNodes.values());
    
    if (nodes.length === 0) {
      this.logger.debug(`[TransmitterSync:${this.nodeId}] No cluster nodes to sync with`);
      return;
    }
    
    this.logger.info(`[TransmitterSync:${this.nodeId}] Starting sync with ${nodes.length} nodes...`);
    
    let synced = 0;
    let failed = 0;
    
    for (const node of nodes) {
      try {
        await this._syncWithNode(node);
        synced++;
      } catch (err) {
        failed++;
        this.logger.warn(`[TransmitterSync:${this.nodeId}] Failed to sync with ${node.nodeName}: ${err.message}`);
      }
    }
    
    this.logger.info(`[TransmitterSync:${this.nodeId}] Sync complete: ${synced} succeeded, ${failed} failed`);
    
    this.emit('sync_complete', { synced, failed });
  }
  
  async _syncWithNode(node) {
    const nodeId = node.nodeId;
    const url = `http://${node.host}:${node.port}/transmitter/sync`;
    
    // Get local version
    const localVersion = this.federationVersion;
    const remoteVersion = this.remoteVersions.get(nodeId) || 0;
    
    // Exchange metadata
    const syncRequest = {
      sourceNodeId: this.nodeId,
      sourceVersion: localVersion,
      lastSyncVersion: remoteVersion,
      timestamp: Date.now()
    };
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(syncRequest),
        timeout: 10000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const syncData = await response.json();
      
      // Update remote version
      this.remoteVersions.set(nodeId, syncData.version);
      
      // Import remote memories if any
      if (syncData.memories && syncData.memories.length > 0) {
        await this._importMemories(syncData.memories, nodeId);
      }
      
      this.lastSyncTime.set(nodeId, Date.now());
      
      this.logger.debug(`[TransmitterSync:${this.nodeId}] Synced with ${node.nodeName}: ${syncData.memories?.length || 0} memories`);
      
    } catch (err) {
      // Node might not have sync endpoint yet
      throw err;
    }
  }
  
  async _importMemories(memories, sourceNodeId) {
    if (!this.transmitter) return;
    
    let imported = 0;
    let skipped = 0;
    
    for (const memory of memories) {
      try {
        // Check if memory already exists (by hash or content)
        const exists = await this._memoryExists(memory);
        
        if (!exists) {
          // Add federated metadata
          const federatedMemory = {
            ...memory,
            _federated: true,
            _sourceNode: sourceNodeId,
            _syncTimestamp: Date.now()
          };
          
          // Store in local transmitter
          await this.transmitter.store(federatedMemory.content, {
            metadata: federatedMemory
          });
          
          imported++;
        } else {
          skipped++;
        }
      } catch (err) {
        this.logger.warn(`[TransmitterSync:${this.nodeId}] Failed to import memory: ${err.message}`);
      }
    }
    
    this.logger.debug(`[TransmitterSync:${this.nodeId}] Imported ${imported} memories, skipped ${skipped} duplicates`);
  }
  
  async _memoryExists(memory) {
    // Simple existence check - can be enhanced with proper deduplication
    // For now, just accept all incoming memories
    return false;
  }
  
  async pushMemories(memories) {
    // Push specific memories to all cluster nodes
    const nodes = Array.from(this.clusterNode.knownNodes.values());
    
    const results = await Promise.allSettled(
      nodes.map(node => this._pushMemoriesToNode(node, memories))
    );
    
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    this.logger.info(`[TransmitterSync:${this.nodeId}] Pushed ${memories.length} memories: ${succeeded} nodes succeeded, ${failed} failed`);
    
    return { succeeded, failed };
  }
  
  async _pushMemoriesToNode(node, memories) {
    const url = `http://${node.host}:${node.port}/transmitter/push`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceNodeId: this.nodeId,
        memories,
        timestamp: Date.now()
      }),
      timeout: 15000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  }
  
  async queryCluster(query, options = {}) {
    // Distributed query across all nodes
    const nodes = [
      { nodeId: this.nodeId, local: true },
      ...Array.from(this.clusterNode.knownNodes.values()).map(n => ({ ...n, local: false }))
    ];
    
    const limit = options.limit || 10;
    const resultsPerNode = Math.ceil(limit / nodes.length);
    
    this.logger.info(`[TransmitterSync:${this.nodeId}] Distributed query across ${nodes.length} nodes`);
    
    const results = await Promise.allSettled(
      nodes.map(node => 
        node.local 
          ? this._queryLocal(query, resultsPerNode)
          : this._queryRemote(node, query, resultsPerNode)
      )
    );
    
    // Aggregate results
    const allMemories = [];
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        allMemories.push(...result.value);
      }
    }
    
    // Sort by relevance and limit
    allMemories.sort((a, b) => (b.score || 0) - (a.score || 0));
    
    const topResults = allMemories.slice(0, limit);
    
    this.logger.info(`[TransmitterSync:${this.nodeId}] Distributed query returned ${topResults.length} results`);
    
    return topResults;
  }
  
  async _queryLocal(query, limit) {
    if (!this.transmitter) return [];
    
    // Query local transmitter
    const results = await this.transmitter.retrieve(query, { limit });
    
    return results.map(r => ({
      ...r,
      _sourceNode: this.nodeId,
      _local: true
    }));
  }
  
  async _queryRemote(node, query, limit) {
    const url = `http://${node.host}:${node.port}/transmitter/query`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit,
        sourceNodeId: this.nodeId
      }),
      timeout: 10000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    return data.results.map(r => ({
      ...r,
      _sourceNode: node.nodeId,
      _local: false
    }));
  }
  
  incrementVersion() {
    this.federationVersion++;
    this.logger.debug(`[TransmitterSync:${this.nodeId}] Version incremented to ${this.federationVersion}`);
  }
  
  getStats() {
    return {
      nodeId: this.nodeId,
      version: this.federationVersion,
      syncedNodes: this.lastSyncTime.size,
      lastSync: Array.from(this.lastSyncTime.entries()).map(([nodeId, time]) => ({
        nodeId,
        timestamp: time,
        age: Date.now() - time
      })),
      remoteVersions: Array.from(this.remoteVersions.entries()).map(([nodeId, version]) => ({
        nodeId,
        version
      }))
    };
  }
}

module.exports = { TransmitterSync };
