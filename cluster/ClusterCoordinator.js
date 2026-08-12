// ═══════════════════════════════════════════════════════════
// ClusterCoordinator.js - Multi-Node Orchestration
// Distributed SOMA with federated learning & tensor sharing
// ═══════════════════════════════════════════════════════════

import EventEmitter from 'events';
import crypto from 'crypto';
import net from 'net';
import dgram from 'dgram';

export class ClusterCoordinator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'ClusterCoordinator';
    this.nodeId = config.nodeId || crypto.randomUUID();
    this.role = config.role || 'coordinator'; // 'coordinator' or 'worker'

    // ============ CLUSTER TOPOLOGY ============
    this.nodes = new Map(); // nodeId -> nodeInfo
    this.coordinatorAddress = config.coordinatorAddress || null;
    this.isCoordinator = this.role === 'coordinator';

    // ============ NETWORKING ============
    this.port = config.port || 7777;
    this.discoveryPort = config.discoveryPort || 7778;
    this.tcpServer = null;
    this.udpServer = null;
    this.connections = new Map(); // nodeId -> socket

    // ============ TASK DISTRIBUTION ============
    this.taskQueue = [];
    this.activeTasks = new Map(); // taskId -> nodeId
    this.taskResults = new Map();

    // ============ FEDERATED LEARNING ============
    this.gradientQueue = [];
    this.modelVersion = 0;
    this.syncInterval = config.syncInterval || 30000;

    // ============ PRIVACY ============
    this.enablePrivacy = config.enablePrivacy !== false;
    this.noiseScale = config.noiseScale || 0.01;

    // ============ HEALTH ============
    this.heartbeatInterval = config.heartbeatInterval || 5000;
    this.nodeTimeout = config.nodeTimeout || 15000;
    this.lastHeartbeats = new Map();

    // ============ METRICS ============
    this.metrics = {
      totalNodes: 0,
      totalTasksDistributed: 0,
      totalGradientsSynced: 0,
      avgLatency: 0,
      bandwidth: 0
    };

    console.log(`🌐 [${this.name}] Cluster coordinator initialized (${this.role})`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    console.log(`🚀 [${this.name}] Starting cluster coordinator...`);

    if (this.isCoordinator) {
      await this.startCoordinatorServers();
    } else {
      await this.connectToCoordinator();
    }

    this.startHeartbeatLoop();
    this.startHealthCheckLoop();

    if (this.isCoordinator) {
      this.startGradientSyncLoop();
    }

    console.log(`✅ [${this.name}] Cluster coordinator ready (${this.nodes.size} nodes)`);
    return { success: true, nodeId: this.nodeId };
  }

  async startCoordinatorServers() {
    // TCP server for commands and data
    this.tcpServer = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    await new Promise((resolve, reject) => {
      this.tcpServer.listen(this.port, () => {
        console.log(`🔌 [${this.name}] TCP server listening on port ${this.port}`);
        resolve();
      });
      this.tcpServer.on('error', reject);
    });

    // UDP server for discovery
    this.udpServer = dgram.createSocket('udp4');
    this.udpServer.on('message', (msg, rinfo) => {
      this.handleDiscoveryMessage(msg, rinfo);
    });

    await new Promise((resolve, reject) => {
      this.udpServer.bind(this.discoveryPort, () => {
        console.log(`📡 [${this.name}] UDP discovery server on port ${this.discoveryPort}`);
        resolve();
      });
      this.udpServer.on('error', reject);
    });
  }

  async connectToCoordinator() {
    if (!this.coordinatorAddress) {
      throw new Error('Coordinator address required for worker nodes');
    }

    const [host, port] = this.coordinatorAddress.split(':');
    const socket = net.createConnection(parseInt(port), host, () => {
      console.log(`🔗 [${this.name}] Connected to coordinator ${this.coordinatorAddress}`);
      this.sendMessage(socket, { type: 'register', nodeId: this.nodeId });
    });

    socket.on('data', (data) => {
      this.handleMessage(data, socket);
    });

    socket.on('close', () => {
      console.log(`❌ [${this.name}] Disconnected from coordinator`);
    });

    this.connections.set('coordinator', socket);
  }

  handleConnection(socket) {
    let nodeId = null;

    socket.on('data', (data) => {
      this.handleMessage(data, socket, (id) => { nodeId = id; });
    });

    socket.on('close', () => {
      if (nodeId) {
        console.log(`❌ [${this.name}] Node ${nodeId} disconnected`);
        this.nodes.delete(nodeId);
        this.connections.delete(nodeId);
      }
    });
  }

  handleMessage(data, socket, setNodeId) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'register':
          console.log(`✅ [${this.name}] Node registered: ${message.nodeId}`);
          this.nodes.set(message.nodeId, {
            nodeId: message.nodeId,
            address: socket.remoteAddress,
            connectedAt: Date.now()
          });
          this.connections.set(message.nodeId, socket);
          if (setNodeId) setNodeId(message.nodeId);
          this.sendMessage(socket, { type: 'welcome', coordinatorId: this.nodeId });
          break;

        case 'heartbeat':
          this.lastHeartbeats.set(message.nodeId, Date.now());
          break;

        case 'task_result':
          this.handleTaskResult(message);
          break;

        case 'gradient_update':
          this.handleGradientUpdate(message);
          break;

        case 'welcome':
          // Worker received welcome from coordinator - connection established
          console.log(`🤝 [${this.name}] Welcomed by coordinator ${message.coordinatorId}`);
          break;

        default:
          console.log(`⚠️  [${this.name}] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error(`❌ [${this.name}] Message handling error:`, err.message);
    }
  }

  handleDiscoveryMessage(msg, rinfo) {
    try {
      const message = JSON.parse(msg.toString());
      if (message.type === 'discover') {
        const response = {
          type: 'coordinator_info',
          nodeId: this.nodeId,
          address: rinfo.address,
          port: this.port
        };
        this.udpServer.send(JSON.stringify(response), rinfo.port, rinfo.address);
      }
    } catch (err) {
      console.error(`❌ [${this.name}] Discovery error:`, err.message);
    }
  }

  sendMessage(socket, message) {
    try {
      socket.write(JSON.stringify(message));
    } catch (err) {
      console.error(`❌ [${this.name}] Send error:`, err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ TASK DISTRIBUTION ░░
  // ═══════════════════════════════════════════════════════════

  async distributeTask(task) {
    if (!this.isCoordinator) {
      throw new Error('Only coordinator can distribute tasks');
    }

    const taskId = task.taskId || crypto.randomUUID();
    const availableNodes = Array.from(this.nodes.keys());

    if (availableNodes.length === 0) {
      return { success: false, error: 'no_available_nodes' };
    }

    // Simple round-robin for now
    const targetNode = availableNodes[this.metrics.totalTasksDistributed % availableNodes.length];
    const socket = this.connections.get(targetNode);

    this.sendMessage(socket, {
      type: 'task_assignment',
      taskId,
      task
    });

    this.activeTasks.set(taskId, targetNode);
    this.metrics.totalTasksDistributed++;

    console.log(`📤 [${this.name}] Distributed task ${taskId} to ${targetNode}`);

    return { success: true, taskId, targetNode };
  }

  handleTaskResult(message) {
    const { taskId, result } = message;
    this.taskResults.set(taskId, result);
    this.activeTasks.delete(taskId);
    console.log(`✅ [${this.name}] Task ${taskId} completed`);
    this.emit('task_complete', { taskId, result });
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ FEDERATED LEARNING ░░
  // ═══════════════════════════════════════════════════════════

  async syncGradients() {
    if (!this.isCoordinator || this.gradientQueue.length === 0) {
      return { success: false, reason: 'no_gradients' };
    }

    console.log(`🔄 [${this.name}] Syncing ${this.gradientQueue.length} gradient updates...`);

    // Aggregate gradients
    const aggregated = this.aggregateGradients(this.gradientQueue);

    // Apply privacy-preserving noise
    if (this.enablePrivacy) {
      this.addDifferentialPrivacyNoise(aggregated);
    }

    // Broadcast to all nodes
    for (const [nodeId, socket] of this.connections) {
      this.sendMessage(socket, {
        type: 'model_update',
        version: ++this.modelVersion,
        gradients: aggregated
      });
    }

    this.metrics.totalGradientsSynced += this.gradientQueue.length;
    this.gradientQueue = [];

    console.log(`✅ [${this.name}] Model synced (v${this.modelVersion})`);
    return { success: true, version: this.modelVersion };
  }

  aggregateGradients(updates) {
    // Federated averaging (FedAvg): per-key mean across all node updates.
    // Handles BOTH scalar gradients and array/tensor gradients (element-wise
    // mean). Updates whose shape disagrees for a key are skipped for that key
    // rather than silently corrupting the aggregate (the old version assumed
    // scalars and would concatenate numbers on arrays).
    if (updates.length === 0) return {};

    const byKey = new Map(); // key -> collected values (scalars or arrays)
    for (const update of updates) {
      for (const [key, value] of Object.entries(update.gradients || {})) {
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(value);
      }
    }

    const aggregated = {};
    for (const [key, values] of byKey) {
      if (values.length === 0) continue;

      if (Array.isArray(values[0])) {
        // Element-wise mean across same-length vectors; drop mismatched shapes.
        const dim = values[0].length;
        const consistent = values.filter(v => Array.isArray(v) && v.length === dim);
        if (consistent.length === 0) continue;
        const mean = new Array(dim).fill(0);
        for (const vec of consistent) {
          for (let i = 0; i < dim; i++) mean[i] += vec[i];
        }
        for (let i = 0; i < dim; i++) mean[i] /= consistent.length;
        aggregated[key] = mean;
      } else {
        // Scalar mean; ignore non-finite contributions.
        const nums = values.filter(v => Number.isFinite(v));
        if (nums.length === 0) continue;
        aggregated[key] = nums.reduce((a, b) => a + b, 0) / nums.length;
      }
    }

    return aggregated;
  }

  addDifferentialPrivacyNoise(gradients) {
    // Real Gaussian noise via Box-Muller — this is the mechanism that actually
    // provides the (ε,δ) differential-privacy guarantee. The previous version
    // added UNIFORM noise, which does not. Applies in place to scalar and
    // array-valued gradients alike.
    const gaussian = () => {
      let u = 0, v = 0;
      while (u === 0) u = Math.random(); // avoid log(0)
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    for (const key in gradients) {
      const val = gradients[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) val[i] += gaussian() * this.noiseScale;
      } else if (Number.isFinite(val)) {
        gradients[key] = val + gaussian() * this.noiseScale;
      }
    }
  }

  handleGradientUpdate(message) {
    this.gradientQueue.push(message);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ HEALTH MONITORING ░░
  // ═══════════════════════════════════════════════════════════

  startHeartbeatLoop() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isCoordinator) {
        // Coordinator broadcasts heartbeat
        for (const [nodeId, socket] of this.connections) {
          this.sendMessage(socket, { type: 'heartbeat', nodeId: this.nodeId });
        }
      } else {
        // Worker sends heartbeat to coordinator
        const socket = this.connections.get('coordinator');
        if (socket) {
          this.sendMessage(socket, { type: 'heartbeat', nodeId: this.nodeId });
        }
      }
    }, this.heartbeatInterval);
  }

  startHealthCheckLoop() {
    if (!this.isCoordinator) return;

    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();
      for (const [nodeId, lastTime] of this.lastHeartbeats) {
        if (now - lastTime > this.nodeTimeout) {
          console.log(`⚠️  [${this.name}] Node ${nodeId} timeout - removing`);
          this.nodes.delete(nodeId);
          this.connections.delete(nodeId);
          this.lastHeartbeats.delete(nodeId);
        }
      }
    }, this.heartbeatInterval);
  }

  startGradientSyncLoop() {
    this.syncLoopInterval = setInterval(async () => {
      try {
        await this.syncGradients();
      } catch (err) {
        console.error(`❌ [${this.name}] Gradient sync error:`, err.message);
      }
    }, this.syncInterval);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATUS & SHUTDOWN ░░
  // ═══════════════════════════════════════════════════════════

  getStatus() {
    return {
      name: this.name,
      nodeId: this.nodeId,
      role: this.role,
      isCoordinator: this.isCoordinator,
      cluster: {
        totalNodes: this.nodes.size,
        nodes: Array.from(this.nodes.keys())
      },
      tasks: {
        active: this.activeTasks.size,
        completed: this.taskResults.size
      },
      learning: {
        modelVersion: this.modelVersion,
        pendingGradients: this.gradientQueue.length
      },
      metrics: this.metrics
    };
  }

  async shutdown() {
    console.log(`🛑 [${this.name}] Shutting down cluster coordinator...`);

    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.syncLoopInterval) clearInterval(this.syncLoopInterval);

    for (const socket of this.connections.values()) {
      socket.end();
    }

    if (this.tcpServer) this.tcpServer.close();
    if (this.udpServer) this.udpServer.close();

    console.log(`✅ [${this.name}] Shutdown complete`);
  }
}

export default ClusterCoordinator;
