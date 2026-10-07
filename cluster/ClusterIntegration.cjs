// ClusterIntegration.cjs
// Full SOMA cluster orchestration - integrates all cluster components

const { ClusterNode } = require('./ClusterNode.cjs');
const { TransmitterSync } = require('./TransmitterSync.cjs');
const { FederatedLearning } = require('./FederatedLearning.cjs');
const EventEmitter = require('events');

class ClusterIntegration extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.nodeId = config.nodeId || `soma_node_${Date.now()}`;
    this.config = config;
    this.logger = config.logger || console;
    
    // Components
    this.clusterNode = null;
    this.transmitterSync = null;
    this.federatedLearning = null;
    
    // SOMA reference
    this.soma = config.soma || null;
    this.transmitter = config.transmitter || null;
    
    this.isRunning = false;
  }
  
  async initialize() {
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Initializing cluster federation...`);
    
    // 1. Create ClusterNode
    this.clusterNode = new ClusterNode({
      nodeId: this.nodeId,
      nodeName: this.config.nodeName,
      port: this.config.port || 5000,
      role: this.config.role || 'worker',
      discoveryHosts: this.config.discoveryHosts || [],
      heartbeatInterval: this.config.heartbeatInterval || 30000,
      aggressiveDiscovery: this.config.aggressiveDiscovery,
      persistenceFile: this.config.persistenceFile,
      soma: this.soma,
      logger: this.logger
    });
    
    // Forward node discovery events
    this.clusterNode.on('node_discovered', (nodeInfo) => {
      this.emit('node_discovered', nodeInfo);
    });
    
    // 2. Create TransmitterSync
    if (this.transmitter) {
      this.transmitterSync = new TransmitterSync({
        nodeId: this.nodeId,
        clusterNode: this.clusterNode,
        transmitter: this.transmitter,
        syncInterval: this.config.syncInterval || 60000,
        batchSize: this.config.batchSize || 50,
        logger: this.logger
      });
      
      // Set up event handlers
      this.transmitterSync.on('sync_complete', (data) => {
        this.logger.info(`[ClusterIntegration:${this.nodeId}] Transmitter sync complete: ${data.synced} nodes`);
        this.emit('sync_complete', data);
      });
    }
    
    // 3. Create FederatedLearning
    this.federatedLearning = new FederatedLearning({
      nodeId: this.nodeId,
      clusterNode: this.clusterNode,
      role: this.config.role || 'worker',
      minParticipants: this.config.minParticipants || 1,
      logger: this.logger
    });
    
    // Set up federated learning event handlers
    this.federatedLearning.on('training_complete', (data) => {
      this.logger.info(`[ClusterIntegration:${this.nodeId}] Local training complete`);
      this.emit('training_complete', data);
    });
    
    this.federatedLearning.on('ready_to_aggregate', (data) => {
      this.logger.info(`[ClusterIntegration:${this.nodeId}] Ready to aggregate models`);
      this.emit('ready_to_aggregate', data);
    });
    
    this.federatedLearning.on('aggregation_complete', (data) => {
      this.logger.info(`[ClusterIntegration:${this.nodeId}] Model aggregation complete`);
      this.emit('aggregation_complete', data);
    });
    
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Initialization complete`);
  }
  
  async start() {
    if (this.isRunning) {
      this.logger.warn(`[ClusterIntegration:${this.nodeId}] Already running`);
      return;
    }
    
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Starting cluster federation...`);
    
    // Start cluster node
    await this.clusterNode.start();
    
    // Start transmitter sync if configured
    if (this.transmitterSync) {
      this.transmitterSync.start();
    }
    
    this.isRunning = true;
    
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Cluster federation running!`);
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Role: ${this.config.role}`);
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Port: ${this.config.port || 5000}`);
    
    this.emit('started', {
      nodeId: this.nodeId,
      role: this.config.role,
      port: this.config.port || 5000
    });
  }
  
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Stopping cluster federation...`);
    
    // Stop transmitter sync
    if (this.transmitterSync) {
      this.transmitterSync.stop();
    }
    
    // Stop cluster node
    await this.clusterNode.shutdown();
    
    this.isRunning = false;
    
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Cluster federation stopped`);
    
    this.emit('stopped');
  }
  
  // === CONVENIENCE METHODS ===
  
  async distributeTask(agent, taskData, config = {}) {
    if (!this.clusterNode) {
      throw new Error('Cluster not initialized');
    }
    
    return await this.clusterNode.distributeTask(agent, taskData, config);
  }
  
  async syncTransmitters() {
    if (!this.transmitterSync) {
      throw new Error('Transmitter sync not configured');
    }
    
    return await this.transmitterSync.syncWithCluster();
  }
  
  async queryCluster(query, options = {}) {
    if (!this.transmitterSync) {
      throw new Error('Transmitter sync not configured');
    }
    
    return await this.transmitterSync.queryCluster(query, options);
  }
  
  async initiateTrainingRound(trainingConfig = {}) {
    if (this.config.role !== 'coordinator') {
      throw new Error('Only coordinator can initiate training rounds');
    }
    
    return await this.federatedLearning.initiateRound(trainingConfig);
  }
  
  async aggregateModels(strategy = 'federated_averaging') {
    if (this.config.role !== 'coordinator') {
      throw new Error('Only coordinator can aggregate models');
    }
    
    return await this.federatedLearning.aggregateModels(strategy);
  }
  
  // === STATUS & MONITORING ===
  
  getClusterStatus() {
    if (!this.clusterNode) {
      return { error: 'Cluster not initialized' };
    }
    
    const baseStatus = this.clusterNode._getClusterStatus();
    
    return {
      ...baseStatus,
      nodeId: this.nodeId,
      isRunning: this.isRunning,
      components: {
        clusterNode: !!this.clusterNode,
        transmitterSync: !!this.transmitterSync,
        federatedLearning: !!this.federatedLearning
      },
      transmitterSync: this.transmitterSync?.getStats() || null,
      federatedLearning: this.federatedLearning?.getStats() || null
    };
  }
  
  getNodes() {
    if (!this.clusterNode) {
      return [];
    }
    
    return [
      this.clusterNode._getNodeInfo(),
      ...Array.from(this.clusterNode.knownNodes.values())
    ];
  }
  
  getCoordinator() {
    const nodes = this.getNodes();
    return nodes.find(n => n.role === 'coordinator') || null;
  }
  
  getWorkers() {
    const nodes = this.getNodes();
    return nodes.filter(n => n.role === 'worker');
  }
  
  isCoordinator() {
    return this.config.role === 'coordinator';
  }
  
  // === ADVANCED OPERATIONS ===
  
  async broadcastMessage(message, target = 'all') {
    const nodes = target === 'all' 
      ? this.getNodes().filter(n => n.nodeId !== this.nodeId)
      : target === 'workers'
      ? this.getWorkers().filter(n => n.nodeId !== this.nodeId)
      : [target];
    
    this.logger.info(`[ClusterIntegration:${this.nodeId}] Broadcasting to ${nodes.length} nodes`);
    
    const results = await Promise.allSettled(
      nodes.map(node => this._sendMessage(node, message))
    );
    
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    
    return { succeeded, total: nodes.length };
  }
  
  async _sendMessage(node, message) {
    // Placeholder for custom messaging
    // Can be extended based on message type
    return { success: true };
  }
  
  async performHealthCheck() {
    const nodes = this.getNodes();
    
    const checks = await Promise.allSettled(
      nodes.map(node => this._checkNodeHealth(node))
    );
    
    const healthy = checks.filter(c => c.status === 'fulfilled' && c.value.healthy).length;
    
    return {
      total: nodes.length,
      healthy,
      unhealthy: nodes.length - healthy,
      timestamp: Date.now()
    };
  }
  
  async _checkNodeHealth(node) {
    if (node.nodeId === this.nodeId) {
      return { healthy: true, node: this.nodeId };
    }
    
    try {
      const fetch = require('node-fetch');
      const response = await fetch(`http://${node.host}:${node.port}/health`, {
        timeout: 3000
      });
      
      return {
        healthy: response.ok,
        node: node.nodeId,
        status: response.status
      };
    } catch (err) {
      return {
        healthy: false,
        node: node.nodeId,
        error: err.message
      };
    }
  }
  
  // === DIAGNOSTICS ===
  
  getDiagnostics() {
    return {
      nodeId: this.nodeId,
      nodeName: this.config.nodeName,
      role: this.config.role,
      isRunning: this.isRunning,
      uptime: this.clusterNode?.metrics.uptime || 0,
      
      cluster: {
        nodes: this.clusterNode?.knownNodes.size || 0,
        status: this.clusterNode ? 'online' : 'offline'
      },
      
      transmitter: this.transmitterSync ? {
        version: this.transmitterSync.federationVersion,
        syncedNodes: this.transmitterSync.lastSyncTime.size,
        syncInProgress: this.transmitterSync.syncInProgress
      } : null,
      
      federated: {
        currentRound: this.federatedLearning?.currentRound || 0,
        trainingInProgress: this.federatedLearning?.trainingInProgress || false,
        hasGlobalModel: this.federatedLearning?.globalModel !== null,
        history: this.federatedLearning?.history.length || 0
      }
    };
  }
}

module.exports = { ClusterIntegration };
