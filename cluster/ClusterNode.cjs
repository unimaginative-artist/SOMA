// ClusterNode.cjs
// Enables SOMA federation across multiple machines!

const express = require('express');
const http = require('http');
const fetch = require('node-fetch');
const EventEmitter = require('events');

class ClusterNode extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.nodeId = config.nodeId || `node_${Date.now()}`;
    this.nodeName = config.nodeName || require('os').hostname();
    this.port = config.port || 5000;
    this.role = config.role || 'worker'; // 'coordinator' or 'worker'
    
    // Network discovery
    this.discoveryHosts = config.discoveryHosts || [];
    this.knownNodes = new Map(); // nodeId -> nodeInfo
    this.heartbeatInterval = config.heartbeatInterval || 30000; // 30 sec
    
    // SOMA instance
    this.soma = config.soma || null;
    
    // Metrics
    this.metrics = {
      tasksReceived: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      bytesReceived: 0,
      bytesSent: 0,
      uptime: 0,
      startTime: Date.now()
    };
    
    // Server
    this.app = express();
    this.server = null;
    
    this.logger = config.logger || console;
    
    this._setupRoutes();
  }
  
  _setupRoutes() {
    this.app.use(express.json({ limit: '100mb' }));
    
    // In-memory chunk store for unified memory demo
    this.memoryChunks = new Map(); // chunkId -> Buffer

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        nodeId: this.nodeId,
        nodeName: this.nodeName,
        role: this.role,
        uptime: Date.now() - this.metrics.startTime
      });
    });
    
    // Node info
    this.app.get('/node/info', (req, res) => {
      res.json(this._getNodeInfo());
    });
    
    // Discover - called by other nodes
    this.app.post('/node/discover', (req, res) => {
      const { nodeInfo } = req.body;
      
      if (nodeInfo && nodeInfo.nodeId !== this.nodeId) {
        this.knownNodes.set(nodeInfo.nodeId, {
          ...nodeInfo,
          lastSeen: Date.now()
        });
        
        this.logger.info(`[ClusterNode:${this.nodeId}] Discovered node: ${nodeInfo.nodeName}`);
      }
      
      res.json({
        success: true,
        nodeInfo: this._getNodeInfo()
      });
    });
    
    // Execute task (work distribution)
    this.app.post('/task/execute', async (req, res) => {
      const { task, taskId } = req.body;
      
      this.metrics.tasksReceived++;
      this.logger.info(`[ClusterNode:${this.nodeId}] Received task: ${taskId}`);
      
      try {
        const result = await this._executeTask(task);
        
        this.metrics.tasksCompleted++;
        res.json({
          success: true,
          taskId,
          result,
          nodeId: this.nodeId
        });
      } catch (err) {
        this.metrics.tasksFailed++;
        res.status(500).json({
          success: false,
          taskId,
          error: err.message,
          nodeId: this.nodeId
        });
      }
    });
    
    // Get cluster status
    this.app.get('/cluster/status', (req, res) => {
      res.json(this._getClusterStatus());
    });
    
    // List nodes
    this.app.get('/cluster/nodes', (req, res) => {
      res.json({
        count: this.knownNodes.size + 1, // +1 for self
        nodes: [
          this._getNodeInfo(),
          ...Array.from(this.knownNodes.values())
        ]
      });
    });
    
    // === UNIFIED MEMORY ENDPOINTS (demo) ===
    // Allocate a chunk placeholder
    this.app.post('/memory/chunk/alloc', async (req, res) => {
      try {
        const { chunkId, size } = req.body;
        if (!chunkId || !Number.isFinite(size)) return res.status(400).json({ success: false, error: 'chunkId and size required' });
        this.memoryChunks.set(chunkId, Buffer.alloc(size));
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // Write/replace chunk data (base64)
    this.app.post('/memory/chunk/write', async (req, res) => {
      try {
        const { chunkId, dataBase64 } = req.body;
        if (!chunkId || !dataBase64) return res.status(400).json({ success: false, error: 'chunkId and dataBase64 required' });
        const buf = Buffer.from(dataBase64, 'base64');
        this.memoryChunks.set(chunkId, buf);
        res.json({ success: true, size: buf.length });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // Read chunk data (base64)
    this.app.get('/memory/chunk/read', (req, res) => {
      try {
        const { chunkId } = req.query;
        if (!chunkId) return res.status(400).json({ success: false, error: 'chunkId required' });
        const buf = this.memoryChunks.get(chunkId);
        if (!buf) return res.status(404).json({ success: false, error: 'not_found' });
        res.json({ success: true, dataBase64: buf.toString('base64'), size: buf.length });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // === TRANSMITTER SYNC ENDPOINTS (NOT IMPLEMENTED) ===
    // These endpoints require integration with actual Transmitter module
    // See: core/Transmitter.cjs
    
    // Sync transmitter memories
    this.app.post('/transmitter/sync', async (req, res) => {
      res.status(501).json({
        success: false,
        error: 'NOT_IMPLEMENTED',
        message: 'Transmitter sync requires integration with core/Transmitter module',
        status: 'Transmitter sync endpoint is not yet wired. To implement, integrate with actual Transmitter.recall()'
      });
    });
    
    // Push memories
    this.app.post('/transmitter/push', async (req, res) => {
      res.status(501).json({
        success: false,
        error: 'NOT_IMPLEMENTED',
        message: 'Transmitter push requires integration with core/Transmitter module',
        status: 'Transmitter push endpoint is not yet wired. To implement, integrate with actual Transmitter.remember()'
      });
    });
    
    // Query transmitter
    this.app.post('/transmitter/query', async (req, res) => {
      res.status(501).json({
        success: false,
        error: 'NOT_IMPLEMENTED',
        message: 'Transmitter query requires integration with core/Transmitter module',
        status: 'Transmitter query endpoint is not yet wired. To implement, integrate with actual Transmitter.recall()'
      });
    });
    
    // === FEDERATED LEARNING ENDPOINTS (NOT IMPLEMENTED) ===
    // These endpoints require integration with actual FederatedLearning module
    // See: cluster/FederatedLearning.cjs
    
    // Request training
    this.app.post('/federated/train', async (req, res) => {
      res.status(501).json({
        success: false,
        error: 'NOT_IMPLEMENTED',
        message: 'Federated training requires integration with FederatedLearning module',
        status: 'Training endpoint not wired. To implement, create FederatedLearning instance and call trainLocal()'
      });
    });
    
    // Submit model update
    this.app.post('/federated/submit', async (req, res) => {
      res.status(501).json({
        success: false,
        error: 'NOT_IMPLEMENTED',
        message: 'Model aggregation requires integration with FederatedLearning module',
        status: 'Submit endpoint not wired. To implement, create FederatedLearning instance and call submitModelUpdate()'
      });
    });
    
    // Get global model
    this.app.get('/federated/model', (req, res) => {
      res.status(501).json({
        success: false,
        error: 'NOT_IMPLEMENTED',
        message: 'Global model retrieval requires integration with FederatedLearning module',
        status: 'Model endpoint not wired. To implement, create FederatedLearning instance and return globalModel'
      });
    });
  }
  
  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        this.logger.info(`[ClusterNode:${this.nodeId}] Started on port ${this.port}`);
        this.logger.info(`[ClusterNode:${this.nodeId}] Role: ${this.role}`);
        this.logger.info(`[ClusterNode:${this.nodeId}] Name: ${this.nodeName}`);
        
        // Start discovery
        this._startDiscovery();
        
        // Start heartbeat
        this._startHeartbeat();
        
        resolve();
      });
    });
  }
  
  async _startDiscovery() {
    this.logger.info(`[ClusterNode:${this.nodeId}] Starting node discovery...`);
    
    for (const host of this.discoveryHosts) {
      try {
        await this._discoverNode(host);
      } catch (err) {
        this.logger.warn(`[ClusterNode:${this.nodeId}] Discovery failed for ${host}: ${err.message}`);
      }
    }
    
    this.logger.info(`[ClusterNode:${this.nodeId}] Discovery complete: ${this.knownNodes.size} nodes found`);
  }
  
  async _discoverNode(host) {
    // Allow discoveryHosts entries like "host" or "host:port"
    let targetHost = host;
    let targetPort = this.port;
    if (typeof host === 'string' && host.includes(':')) {
      const parts = host.split(':');
      targetHost = parts[0];
      const parsed = parseInt(parts[1], 10);
      if (!Number.isNaN(parsed)) targetPort = parsed;
    }

    const url = `http://${targetHost}:${targetPort}/node/discover`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeInfo: this._getNodeInfo()
        }),
        timeout: 5000
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.nodeInfo && data.nodeInfo.nodeId !== this.nodeId) {
          this.knownNodes.set(data.nodeInfo.nodeId, {
            ...data.nodeInfo,
            lastSeen: Date.now()
          });
          
          this.logger.info(`[ClusterNode:${this.nodeId}] Connected to: ${data.nodeInfo.nodeName}`);
        }
      }
    } catch (err) {
      // Silently fail for unreachable nodes
    }
  }
  
  _startHeartbeat() {
    setInterval(() => {
      this._sendHeartbeats();
      this._pruneStaleNodes();
    }, this.heartbeatInterval);
  }
  
  async _sendHeartbeats() {
    const nodeInfo = this._getNodeInfo();
    
    for (const [nodeId, node] of this.knownNodes.entries()) {
      try {
        const response = await fetch(`http://${node.host}:${node.port}/node/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeInfo }),
          timeout: 3000
        });
        
        if (response.ok) {
          node.lastSeen = Date.now();
        }
      } catch (err) {
        // Node unreachable
      }
    }
  }
  
  _pruneStaleNodes() {
    const now = Date.now();
    const staleThreshold = this.heartbeatInterval * 3; // 90 seconds
    
    for (const [nodeId, node] of this.knownNodes.entries()) {
      if (now - node.lastSeen > staleThreshold) {
        this.logger.warn(`[ClusterNode:${this.nodeId}] Node ${node.nodeName} is stale, removing`);
        this.knownNodes.delete(nodeId);
      }
    }
  }
  
  _getNodeInfo() {
    return {
      nodeId: this.nodeId,
      nodeName: this.nodeName,
      role: this.role,
      host: this._getLocalIP(),
      port: this.port,
      metrics: this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      timestamp: Date.now()
    };
  }
  
  _getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    
    return 'localhost';
  }
  
  _getClusterStatus() {
    const nodes = [
      this._getNodeInfo(),
      ...Array.from(this.knownNodes.values())
    ];
    
    const totalTasks = nodes.reduce((sum, n) => sum + (n.metrics?.tasksCompleted || 0), 0);
    const totalFailed = nodes.reduce((sum, n) => sum + (n.metrics?.tasksFailed || 0), 0);
    
    return {
      clusterSize: nodes.length,
      coordinator: nodes.find(n => n.role === 'coordinator')?.nodeName || 'None',
      workers: nodes.filter(n => n.role === 'worker').length,
      totalTasksCompleted: totalTasks,
      totalTasksFailed: totalFailed,
      nodes
    };
  }
  
  async _executeTask(task) {
    if (!this.soma) {
      throw new Error('SOMA instance not configured');
    }
    
    const { agent, taskData, config } = task;
    
    // Execute task through SOMA
    const result = await this.soma.executeMicroTask(agent, taskData, config);
    
    return result;
  }
  
  async distributeTask(agent, taskData, config = {}) {
    // Find least busy node
    const nodes = [
      { ...this._getNodeInfo(), local: true },
      ...Array.from(this.knownNodes.values()).map(n => ({ ...n, local: false }))
    ];
    
    // Sort by load (least busy first)
    nodes.sort((a, b) => {
      const aLoad = (a.metrics?.tasksReceived || 0) - (a.metrics?.tasksCompleted || 0);
      const bLoad = (b.metrics?.tasksReceived || 0) - (b.metrics?.tasksCompleted || 0);
      return aLoad - bLoad;
    });
    
    const targetNode = nodes[0];
    
    if (targetNode.local) {
      // Execute locally
      return await this._executeTask({ agent, taskData, config });
    }
    
    // Execute remotely
    this.logger.info(`[ClusterNode:${this.nodeId}] Distributing task to ${targetNode.nodeName}`);
    
    const response = await fetch(`http://${targetNode.host}:${targetNode.port}/task/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: Date.now(),
        task: { agent, taskData, config }
      }),
      timeout: 60000
    });
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return result.result;
  }
  
  async shutdown() {
    this.logger.info(`[ClusterNode:${this.nodeId}] Shutting down...`);
    
    if (this.server) {
      this.server.close();
    }
    
    this.logger.info(`[ClusterNode:${this.nodeId}] Shutdown complete`);
  }
}

module.exports = { ClusterNode };
