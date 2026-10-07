// ═══════════════════════════════════════════════════════════
// LoadPipelineArbiter.js - ULTRA-ROBUST PRODUCTION VERSION
// Smart Load Balancing + GPU Detection + Pipeline Orchestration
// Extends BaseArbiter for enterprise-grade reliability
// ═══════════════════════════════════════════════════════════

import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import BaseArbiter, { ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

const execAsync = promisify(exec);

// Helper for safe command execution with timeout
const safeExec = async (command, timeout = 3000) => {
  let timer;
  try {
    const promise = execAsync(command);
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
    });
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } catch (error) {
    throw error; // Let caller handle
  } finally {
    clearTimeout(timer);
  }
};

export class LoadPipelineArbiter extends BaseArbiter {
  constructor(config = {}) {
    // Initialize BaseArbiter with robust defaults
    super({
      name: config.name || 'LoadPipelineArbiter',
      role: ArbiterRole.ARCHITECT, // High-level orchestration role
      capabilities: [
        ArbiterCapability.EXECUTE_CODE, // For hardware profiling
        ArbiterCapability.MEMORY_ACCESS // For state persistence
      ],
      ...config,
      config: {
        maxRetries: 3,
        operationTimeout: 10000, // 10s default timeout
        ...config.config
      }
    });

    this.mode = config.mode || 'standalone';
    this.isReady = false;

    // ============ HARDWARE PROFILING ============
    this.hardwareProfile = null;
    this.nodeProfiles = new Map(); // nodeName -> profile
    this.lastProfileTime = 0;
    this.profileInterval = config.profileInterval || 60000;

    // ============ ROUTING TABLE ============
    // Organized by role, sorted by score
    this.routingTable = {
      gpu_training: [],
      cpu_training: [],
      storage: [],
      coordination: [],
      inference: []
    };

    // ============ TASK MANAGEMENT ============
    this.taskQueue = []; // Priority queue could be implemented here
    this.activeTasks = new Map(); // taskId -> taskInfo
    this.maxConcurrent = config.maxConcurrent || 50; // Higher default, but managed per node
    this.maxQueue = config.maxQueue || 1000;

    // ============ LOAD TRACKING ============
    this.nodeLoads = new Map(); // node -> current_active_tasks
    this.nodeHealth = new Map(); // node -> health_score (0-100)
    
    // ============ METRICS ============
    // BaseArbiter has its own metrics, we add specific ones
    this.pipelineMetrics = {
      totalRouted: 0,
      totalFailures: 0,
      gpuUtilization: 0,
      avgQueueTime: 0
    };

    // ============ OPTIMIZATION ============
    this.rebalanceThreshold = config.rebalanceThreshold || 0.3;
    
    // ============ ROUTING STRATEGIES ============
    this.routingStrategies = {
      'round_robin': this.routeRoundRobin.bind(this),
      'least_loaded': this.routeLeastLoaded.bind(this),
      'capability_match': this.routeCapabilityMatch.bind(this),
      'performance_based': this.routePerformanceBased.bind(this),
      'health_aware': this.routeHealthAware.bind(this) // NEW: Robust strategy
    };
    this.currentStrategy = config.routingStrategy || 'health_aware';

    // ============ EVENT LOOP MONITORING ============
    this.lastLoopTime = Date.now();
    this.loopLag = 0;
    this.lagCheckInterval = setInterval(() => this.checkEventLoopLag(), 1000);

    console.log(`🛡️  [${this.name}] Initialized (Robust Mode: ON)`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async onInitialize() {
    this.auditLogger.info(`Starting initialization in ${this.mode} mode...`);

    // Profile local hardware immediately
    try {
      await this.profileHardware();
    } catch (err) {
      this.auditLogger.error('Initial hardware profiling failed', { error: err.message });
      // Fallback profile is better than crashing
      this.createFallbackProfile();
    }

    // Start background loops
    this.startProfileLoop();
    this.startRebalanceLoop();

    this.isReady = true;
    this.auditLogger.info('LoadPipelineArbiter ready', { 
      tier: this.hardwareProfile?.tier,
      gpu: this.hardwareProfile?.gpu?.available
    });
    
    return true;
  }

  async onShutdown() {
    if (this.profileLoopInterval) clearInterval(this.profileLoopInterval);
    if (this.rebalanceLoopInterval) clearInterval(this.rebalanceLoopInterval);
    if (this.lagCheckInterval) clearInterval(this.lagCheckInterval);
    
    this.auditLogger.info('Shutdown complete');
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ EVENT LOOP MONITORING ░░
  // ═══════════════════════════════════════════════════════════

  checkEventLoopLag() {
    const now = Date.now();
    this.loopLag = now - this.lastLoopTime - 1000;
    this.lastLoopTime = now;

    if (this.loopLag > 100) {
      this.auditLogger.warn(`High event loop lag detected: ${this.loopLag}ms`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ HARDWARE PROFILING ░░
  // ═══════════════════════════════════════════════════════════

  async profileHardware() {
    // Use CircuitBreaker from BaseArbiter to prevent cascading failures during profiling
    return this.circuitBreaker.execute(async () => {
      const profile = {
        node: this.name,
        timestamp: Date.now(),
        platform: os.platform(),
        cpu: await this.profileCPU(),
        memory: await this.profileMemory(),
        gpu: await this.profileGPU(),
        disk: { available: true, writeSpeed: 500 }, // Safe defaults
        network: { available: true, latency: 1 }
      };

      profile.score = this.calculatePerformanceScore(profile);
      profile.tier = this.assignTier(profile.score);
      profile.optimalRoles = this.determineOptimalRoles(profile);

      this.hardwareProfile = profile;
      this.nodeProfiles.set(this.name, profile);
      this.updateRoutingTable();

      // Emit heartbeat for cluster visibility
      this.emit('heartbeat', profile);

      return profile;
    });
  }

  createFallbackProfile() {
    this.hardwareProfile = {
      node: this.name,
      timestamp: Date.now(),
      platform: os.platform(),
      cpu: { cores: 2, speed: 2000, usage: 0.5 },
      memory: { totalGB: 4, freeGB: 1 },
      gpu: { available: false },
      score: 100,
      tier: 'minimal',
      optimalRoles: ['coordination']
    };
    this.nodeProfiles.set(this.name, this.hardwareProfile);
  }

  async profileCPU() {
    try {
      const cpus = os.cpus();
      const load = os.loadavg();
      return {
        cores: cpus.length,
        model: cpus[0].model,
        speed: cpus[0].speed,
        load,
        usage: load[0] / cpus.length // Approximate usage 0-1
      };
    } catch (e) {
      return { cores: 1, speed: 1000, usage: 1 };
    }
  }

  async profileMemory() {
    try {
      const total = os.totalmem();
      const free = os.freemem();
      return {
        total,
        free,
        used: total - free,
        totalGB: (total / (1024 ** 3)).toFixed(2),
        freeGB: (free / (1024 ** 3)).toFixed(2)
      };
    } catch (e) {
      return { total: 0, free: 0, totalGB: 0, freeGB: 0 };
    }
  }

  async profileGPU() {
    const gpu = {
      available: false,
      type: null,
      memory: 0,
      compute: 0,
      vendor: null
    };

    try {
      if (os.platform() === 'win32' || os.platform() === 'linux') {
        // Safe execution with strict timeout
        const { stdout } = await safeExec('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', 2000);
        const lines = stdout.trim().split('\n');
        if (lines.length > 0) {
          const [name, memory] = lines[0].split(',').map(s => s.trim());
          gpu.available = true;
          gpu.type = name;
          gpu.memory = parseInt(memory) || 0;
          gpu.vendor = 'NVIDIA';
          gpu.compute = 800;
        }
      } else if (os.platform() === 'darwin') {
        const { stdout } = await safeExec('system_profiler SPDisplaysDataType', 2000);
        if (stdout.includes('Apple') && (stdout.includes('M1') || stdout.includes('M2') || stdout.includes('M3'))) {
            gpu.available = true;
            gpu.vendor = 'Apple';
            gpu.type = 'Apple Silicon';
            gpu.compute = 600;
            // Rough estimation for Unified Memory
            gpu.memory = Math.floor(os.totalmem() / (1024 * 1024) * 0.7); 
        }
      }
    } catch (e) {
      // GPU detection failures are non-critical, just log debug
      this.auditLogger.debug(`GPU profiling skipped: ${e.message}`);
    }

    return gpu;
  }

  calculatePerformanceScore(profile) {
    let score = 0;
    // Base score from CPU
    score += (profile.cpu.cores * 50);
    score += (profile.cpu.speed / 100);
    // Memory
    score += (parseFloat(profile.memory.totalGB) * 20);
    // GPU is the big multiplier
    if (profile.gpu.available) {
      score += profile.gpu.compute;
      score += (profile.gpu.memory / 1024) * 10;
    }
    // Lag penalty
    if (this.loopLag > 50) score -= (this.loopLag * 2);
    
    return Math.max(10, Math.round(score));
  }

  assignTier(score) {
    if (score >= 1000) return 'godlike';
    if (score >= 800) return 'beast';
    if (score >= 600) return 'strong';
    if (score >= 400) return 'medium';
    if (score >= 200) return 'weak';
    return 'minimal';
  }

  determineOptimalRoles(profile) {
    const roles = ['coordination']; // Everyone can coordinate
    if (profile.gpu.available) roles.push('gpu_training', 'inference');
    if (profile.cpu.cores >= 4) roles.push('cpu_training');
    if (parseFloat(profile.memory.totalGB) > 8) roles.push('storage');
    return roles;
  }

  updateRoutingTable() {
    this.routingTable = {
      gpu_training: [],
      cpu_training: [],
      storage: [],
      coordination: [],
      inference: []
    };

    for (const [node, profile] of this.nodeProfiles) {
      // Initialize health if missing
      if (!this.nodeHealth.has(node)) this.nodeHealth.set(node, 100);

      const health = this.nodeHealth.get(node);
      if (health < 20) continue; // Skip unhealthy nodes

      for (const role of profile.optimalRoles) {
        if (this.routingTable[role]) {
          this.routingTable[role].push({
            node,
            score: profile.score,
            health,
            profile
          });
        }
      }
    }

    // Sort: primarily by health, then by score
    for (const role in this.routingTable) {
      this.routingTable[role].sort((a, b) => {
        if (Math.abs(a.health - b.health) > 20) return b.health - a.health;
        return b.score - a.score;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ TASK ROUTING ░░
  // ═══════════════════════════════════════════════════════════

  async routeTask(payload) {
    // Robust input validation
    if (!payload || !payload.task) {
      throw new Error('Invalid routing payload');
    }

    // Queue pressure check
    if (this.activeTasks.size >= this.maxQueue) {
        this.auditLogger.warn('Task queue overflow, rejecting task');
        return { success: false, error: 'queue_full' };
    }

    const { task, preferredRole, constraints } = payload;
    const taskId = task.taskId || crypto.randomUUID();
    const role = preferredRole || this.inferTaskRole(task);

    // Apply strategy
    const strategy = this.routingStrategies[this.currentStrategy];
    let targetNode = await strategy(role, task, constraints);

    // Fallback strategy if primary fails
    if (!targetNode && this.currentStrategy !== 'round_robin') {
        this.auditLogger.info(`Strategy ${this.currentStrategy} failed, falling back to round_robin`);
        targetNode = await this.routeRoundRobin(role, task, constraints);
    }

    if (!targetNode) {
      this.pipelineMetrics.totalFailures++;
      return { success: false, error: 'no_available_node', role };
    }

    // Track assignment
    this.activeTasks.set(taskId, {
        node: targetNode,
        startTime: Date.now(),
        role
    });
    
    // Increment load
    const currentLoad = this.nodeLoads.get(targetNode) || 0;
    this.nodeLoads.set(targetNode, currentLoad + 1);
    this.pipelineMetrics.totalRouted++;

    this.auditLogger.debug(`Routed task ${taskId}`, { targetNode, role });

    return {
      success: true,
      taskId,
      targetNode,
      role
    };
  }

  // Completes a task and updates load/health
  completeTask(taskId, success = true) {
    const taskInfo = this.activeTasks.get(taskId);
    if (!taskInfo) return;

    const { node } = taskInfo;
    
    // Decrement load
    const currentLoad = this.nodeLoads.get(node) || 1;
    this.nodeLoads.set(node, Math.max(0, currentLoad - 1));

    // Update Health
    const currentHealth = this.nodeHealth.get(node) || 100;
    if (success) {
        this.nodeHealth.set(node, Math.min(100, currentHealth + 1));
    } else {
        // Penalize failure
        this.nodeHealth.set(node, Math.max(0, currentHealth - 10));
        this.auditLogger.warn(`Node ${node} failed task, health reduced to ${currentHealth - 10}`);
    }

    this.activeTasks.delete(taskId);
  }

  inferTaskRole(task) {
    const type = (task.type || '').toLowerCase();
    if (type.includes('train') && task.useGPU !== false) return 'gpu_training';
    if (type.includes('train')) return 'cpu_training';
    if (type.includes('inference') || type.includes('predict')) return 'inference';
    if (type.includes('storage')) return 'storage';
    return 'coordination';
  }

  async routeHealthAware(role, task, constraints) {
    const candidates = this.routingTable[role] || [];
    if (candidates.length === 0) return null;

    let bestScore = -Infinity;
    let bestNode = null;

    for (const candidate of candidates) {
      const load = this.nodeLoads.get(candidate.node) || 0;
      // Health is the multiplier. 100 health = 1.0, 50 health = 0.5
      const healthFactor = (candidate.health || 100) / 100;
      
      // Calculate effective score: (Base Score / (Load + 1)) * Health
      const effectiveScore = (candidate.score / (load + 1)) * healthFactor;

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestNode = candidate.node;
      }
    }
    return bestNode;
  }

  async routeRoundRobin(role) {
    const candidates = this.routingTable[role] || [];
    if (candidates.length === 0) return null;
    return candidates[this.pipelineMetrics.totalRouted % candidates.length].node;
  }

  async routeLeastLoaded(role) {
    const candidates = this.routingTable[role] || [];
    if (candidates.length === 0) return null;
    
    // Sort by current load
    candidates.sort((a, b) => {
        const loadA = this.nodeLoads.get(a.node) || 0;
        const loadB = this.nodeLoads.get(b.node) || 0;
        return loadA - loadB;
    });
    
    return candidates[0].node;
  }
  
  // Stubs for API compatibility with old strategies
  async routeCapabilityMatch(role) { return this.routeRoundRobin(role); }
  async routePerformanceBased(role) { return this.routeHealthAware(role); }

  // ═══════════════════════════════════════════════════════════
  // ░░ PIPELINE STAGES (UNIFIED MEMORY SUPPORT) ░░
  // ═══════════════════════════════════════════════════════════

  async selectOptimalNode({ chunkIndex, hint }) {
    // Advanced logic for Unified Memory placement
    const remote = process.env.UNIFIED_REMOTE_TARGET;
    if (remote && (chunkIndex % 2 === 0)) return remote;
    return (hint && hint.preferLocal) ? null : (process.env.UNIFIED_LOCAL_NODE_ID || null);
  }

  async planWrite({ chunks }) { return { orderedChunks: chunks.slice() }; }
  async planRead({ chunks }) { return { orderedChunks: chunks.slice() }; }
  async recordTransfer() { return {}; } // Placeholder for metrics
  async analyzeTransferPatterns() { return new Map(); }

  // ═══════════════════════════════════════════════════════════
  // ░░ BACKGROUND LOOPS ░░
  // ═══════════════════════════════════════════════════════════

  startProfileLoop() {
    this.profileLoopInterval = setInterval(async () => {
      try {
        await this.profileHardware();
      } catch (err) {
        // Silent catch for background loop
      }
    }, this.profileInterval);
  }

  startRebalanceLoop() {
    this.rebalanceLoopInterval = setInterval(() => {
        // Decay load counts slightly to prevent stuck tasks from permanently penalizing nodes
        for (const [node, load] of this.nodeLoads) {
            if (load > 0) this.nodeLoads.set(node, Math.floor(load * 0.9));
        }
        // Recover health slowly
        for (const [node, health] of this.nodeHealth) {
            if (health < 100) this.nodeHealth.set(node, Math.min(100, health + 5));
        }
    }, 30000);
  }
  
  // Cluster support
  startNodeDiscovery() {
      // Stub for cluster discovery
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATUS ░░
  // ═══════════════════════════════════════════════════════════

  getStatus() {
    const status = super.getStatus(); // Get BaseArbiter status
    return {
      ...status,
      mode: this.mode,
      hardware: {
        tier: this.hardwareProfile?.tier,
        score: this.hardwareProfile?.score,
        gpu: this.hardwareProfile?.gpu
      },
      metrics: {
        ...status.metrics,
        ...this.pipelineMetrics,
        activeTasks: this.activeTasks.size,
        eventLoopLag: this.loopLag
      }
    };
  }
}

export default LoadPipelineArbiter;
