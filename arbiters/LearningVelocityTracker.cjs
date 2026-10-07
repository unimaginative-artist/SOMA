// ═══════════════════════════════════════════════════════════
// FILE: arbiters/LearningVelocityTracker.cjs
// Tracks SOMA's learning velocity and coordinates resource allocation
// Target: 100% learning acceleration (1 year = 2 years learned)
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const os = require('os');

class LearningVelocityTracker extends BaseArbiter {
  static role = 'learning-velocity';
  static capabilities = ['track-learning', 'consolidate-knowledge', 'scale-resources', 'optimize-learning'];

  constructor(broker, config = {}) {
    // Support both (broker, config) and (config) signatures for compatibility
    if (typeof broker === 'object' && !broker.publish) {
      // Called with just config as first param
      config = broker;
      broker = null;
    }

    super({
      ...config,
      name: config.name || 'LearningVelocityTracker',
      role: LearningVelocityTracker.role,
      capabilities: LearningVelocityTracker.capabilities
    });

    // Learning velocity tracking
    this.baselineVelocity = 1.0;  // 1x = normal LLM learning speed
    this.targetVelocity = config.targetVelocity || 2.0;  // 2x = 100% acceleration (2 years in 1)
    this.currentVelocity = 0;
    this.velocityHistory = [];
    this.maxVelocityHistory = 1000;

    // Learning metrics
    this.learningMetrics = {
      patternsLearned: 0,
      knowledgeAcquired: 0,  // bytes
      consolidationsPerformed: 0,
      edgeWorkerTasks: 0,
      resourceScalings: 0,
      learningCycles: 0
    };

    // Resource allocation
    this.resourceThresholds = {
      cpuWarning: 0.80,      // 80% CPU usage
      memoryWarning: 0.85,   // 85% memory usage
      diskWarning: 0.80,     // 80% disk usage
      velocityDrop: 0.70     // Alert if velocity drops below 70% of target
    };

    // Agent coordination
    this.agents = {
      black: null,      // System health monitor
      kuze: null,       // Pattern analyzer
      jetstream: null,  // Ops router
      storage: null,    // Storage arbiter
      mnemonic: null    // Memory arbiter
    };

    // Consolidation state
    this.pendingConsolidation = [];
    this.consolidationInterval = null;
    this.velocityCheckInterval = null;

    // Timekeeper integration
    this.timekeeperConnected = false;
    this.learningScheduleActive = false;

    this.logger.info(`[${this.name}] 🧠 LearningVelocityTracker initializing...`);
    this.logger.info(`[${this.name}] 🎯 Target: ${this.targetVelocity}x baseline (${((this.targetVelocity - 1) * 100).toFixed(0)}% acceleration)`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    // Connect to agents
    await this.connectToAgents();

    // Start velocity tracking
    this.startVelocityTracking();

    // Start consolidation loop
    this.startConsolidationLoop();

    // Register with Timekeeper
    await this.registerWithTimekeeper();

    this.logger.info(`[${this.name}] ✅ Learning velocity tracking active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: LearningVelocityTracker.role,
        capabilities: LearningVelocityTracker.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    messageBroker.subscribe(this.name, 'learning_event');
    messageBroker.subscribe(this.name, 'knowledge_acquired');
    messageBroker.subscribe(this.name, 'pattern_detected');
    messageBroker.subscribe(this.name, 'consolidate_request');
    messageBroker.subscribe(this.name, 'velocity_query');
    messageBroker.subscribe(this.name, 'system_metrics');
    messageBroker.subscribe(this.name, 'time_pulse');
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload } = message;

      switch (type) {
        case 'learning_event':
          return await this.recordLearningEvent(payload);

        case 'knowledge_acquired':
          return await this.recordKnowledgeAcquisition(payload);

        case 'pattern_detected':
          return await this.recordPatternDetection(payload);

        case 'consolidate_request':
          return await this.consolidateKnowledge(payload);

        case 'velocity_query':
          return this.getVelocityReport();

        case 'system_metrics':
          return await this.handleSystemMetrics(payload);

        case 'time_pulse':
          return await this.handleTimePulse(payload);

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ AGENT COORDINATION ░░
  // ═══════════════════════════════════════════════════════════

  async connectToAgents() {
    this.logger.info(`[${this.name}] Connecting to Phase 1 agents...`);

    // In production, would query MessageBroker for agent instances
    // For now, we'll establish message-based coordination

    try {
      if (messageBroker.getArbiter('BlackAgent')) {
        await messageBroker.sendMessage({
          from: this.name,
          to: 'BlackAgent',
          type: 'status_check',
          payload: {}
        });
      }

      if (messageBroker.getArbiter('KuzeAgent')) {
        await messageBroker.sendMessage({
          from: this.name,
          to: 'KuzeAgent',
          type: 'status_check',
          payload: {}
        });
      }

      this.logger.info(`[${this.name}] Agent coordination established`);
    } catch (err) {
      this.logger.warn(`[${this.name}] Some agents unavailable: ${err.message}`);
    }
  }

  async registerWithTimekeeper() {
    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'TimekeeperArbiter',
        type: 'register_rhythm',
        payload: {
          rhythm: 'learningVelocityCheck',
          pattern: '*/5 * * * *',  // Every 5 minutes
          callback: this.name,
          action: 'velocity_check'
        }
      });

      await messageBroker.sendMessage({
        from: this.name,
        to: 'TimekeeperArbiter',
        type: 'register_rhythm',
        payload: {
          rhythm: 'knowledgeConsolidation',
          pattern: '0 4 * * *',  // 4 AM daily
          callback: this.name,
          action: 'consolidate_knowledge'
        }
      });

      this.timekeeperConnected = true;
      this.learningScheduleActive = true;

      this.logger.info(`[${this.name}] Registered with Timekeeper (velocity checks + consolidation)`);
    } catch (err) {
      this.logger.warn(`[${this.name}] Timekeeper registration failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ VELOCITY TRACKING ░░
  // ═══════════════════════════════════════════════════════════

  startVelocityTracking() {
    if (this.velocityCheckInterval) {
      clearInterval(this.velocityCheckInterval);
    }

    this.velocityCheckInterval = setInterval(async () => {
      await this.calculateVelocity();
      await this.checkResourceConstraints();
    }, 60000); // Every minute

    this.logger.info(`[${this.name}] Velocity tracking started (60s interval)`);
  }

  async calculateVelocity() {
    // Calculate learning velocity based on recent metrics
    const now = Date.now();
    const windowMs = 3600000; // 1 hour window
    const cutoff = now - windowMs;

    // Filter recent velocity samples
    const recentSamples = this.velocityHistory.filter(v => v.timestamp > cutoff);

    if (recentSamples.length === 0) {
      this.currentVelocity = 0;
      return;
    }

    // Calculate average velocity over window
    const avgVelocity = recentSamples.reduce((sum, v) => sum + v.velocity, 0) / recentSamples.length;
    this.currentVelocity = avgVelocity;

    // Record velocity
    this.velocityHistory.push({
      timestamp: now,
      velocity: avgVelocity,
      metrics: { ...this.learningMetrics }
    });

    // Prune old history
    if (this.velocityHistory.length > this.maxVelocityHistory) {
      this.velocityHistory = this.velocityHistory.slice(-this.maxVelocityHistory);
    }

    // Check if we're hitting target
    const targetRatio = avgVelocity / this.targetVelocity;
    
    // Determine trend
    let trend = 'stable';
    if (recentSamples.length >= 3) {
      const recent3 = recentSamples.slice(-3).map(s => s.velocity);
      if (recent3[2] < recent3[1] && recent3[1] < recent3[0]) {
        trend = 'declining';
      } else if (recent3[2] > recent3[1] && recent3[1] > recent3[0]) {
        trend = 'improving';
      }
    }

    if (targetRatio < this.resourceThresholds.velocityDrop) {
      this.logger.warn(`[${this.name}] ⚠️ Learning velocity below target: ${(avgVelocity * 100).toFixed(1)}% (target: ${(this.targetVelocity * 100).toFixed(1)}%)`);
      
      // Send velocity report to GoalPlanner
      await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'velocity_report',
        payload: {
          currentVelocity: avgVelocity,
          targetVelocity: this.targetVelocity,
          trend,
          metrics: { ...this.learningMetrics }
        }
      });
      
      await this.optimizeLearningPipeline();
    } else if (targetRatio >= 0.95) {
      this.logger.info(`[${this.name}] ✅ Learning velocity on target: ${(avgVelocity * 100).toFixed(1)}%`);
    }

    return avgVelocity;
  }

  async recordLearningEvent(event) {
    this.learningMetrics.learningCycles++;

    // Estimate velocity contribution from this event
    const velocityContribution = event.complexity || 1.0;

    this.velocityHistory.push({
      timestamp: Date.now(),
      velocity: velocityContribution,
      event: event.type || 'unknown'
    });

    return { success: true, recorded: true };
  }

  async recordKnowledgeAcquisition(data) {
    const size = data.size || 0;
    this.learningMetrics.knowledgeAcquired += size;

    // Queue for consolidation
    this.pendingConsolidation.push({
      timestamp: Date.now(),
      data,
      size
    });

    this.logger.info(`[${this.name}] Knowledge acquired: ${this.formatBytes(size)} (pending consolidation: ${this.pendingConsolidation.length})`);

    // BRIDGE: Notify Knowledge Graph
    if (data.concept || data.topic) {
        await messageBroker.sendMessage({
            from: this.name,
            to: 'KnowledgeGraphFusion',
            type: 'knowledge:add',
            payload: {
                concept: data.concept || data.topic,
                domain: data.domain || 'general',
                confidence: data.confidence || 0.8,
                source: 'learning_velocity'
            }
        });
    }

    return { success: true, queued: true };
  }

  async recordPatternDetection(data) {
    this.learningMetrics.patternsLearned++;

    // Forward to Kuze for deeper analysis
    await messageBroker.sendMessage({
      from: this.name,
      to: 'KuzeAgent',
      type: 'analyze-pattern',
      payload: data
    });

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ KNOWLEDGE CONSOLIDATION ░░
  // ═══════════════════════════════════════════════════════════

  startConsolidationLoop() {
    if (this.consolidationInterval) {
      clearInterval(this.consolidationInterval);
    }

    this.consolidationInterval = setInterval(async () => {
      if (this.pendingConsolidation.length > 0) {
        await this.consolidateKnowledge();
      }
    }, 600000); // Every 10 minutes

    this.logger.info(`[${this.name}] Consolidation loop started (10min interval)`);
  }

  async consolidateKnowledge(options = {}) {
    if (this.pendingConsolidation.length === 0) {
      return { success: true, consolidated: 0, message: 'Nothing to consolidate' };
    }

    this.logger.info(`[${this.name}] 🔄 Consolidating ${this.pendingConsolidation.length} knowledge items...`);

    const startTime = Date.now();
    let consolidated = 0;
    let totalSize = 0;

    // Step 1: Extract patterns via Kuze
    const patterns = await this.extractPatterns(this.pendingConsolidation);

    // Step 2: Compress via StorageArbiter
    const compressed = await this.compressKnowledge(patterns);

    // Step 3: Archive to cold storage via MnemonicArbiter
    const archived = await this.archiveKnowledge(compressed);

    // Clear pending queue
    consolidated = this.pendingConsolidation.length;
    totalSize = this.pendingConsolidation.reduce((sum, item) => sum + item.size, 0);
    this.pendingConsolidation = [];

    const duration = Date.now() - startTime;
    this.learningMetrics.consolidationsPerformed++;

    this.logger.info(`[${this.name}] ✅ Consolidated ${consolidated} items (${this.formatBytes(totalSize)}) in ${duration}ms`);

    return {
      success: true,
      consolidated,
      totalSize,
      duration,
      patterns: patterns.length,
      compressed: compressed.success,
      archived: archived.success
    };
  }

  async extractPatterns(items) {
    // Send batch to Kuze for pattern extraction
    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'KuzeAgent',
        type: 'pattern-detect',
        payload: {
          events: items.map(item => ({
            type: item.data.type || 'knowledge',
            timestamp: item.timestamp,
            data: item.data
          })),
          context: 'consolidation'
        }
      });

      return items;  // Return items for now (in production, would wait for Kuze response)
    } catch (err) {
      this.logger.error(`[${this.name}] Pattern extraction failed: ${err.message}`);
      return items;
    }
  }

  async compressKnowledge(items) {
    // Send to StorageArbiter for compression
    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'StorageArbiter',
        type: 'compress-batch',
        payload: {
          items,
          method: 'gzip',
          level: 9
        }
      });

      return { success: true };
    } catch (err) {
      this.logger.error(`[${this.name}] Compression failed: ${err.message}`);
      return { success: false };
    }
  }

  async archiveKnowledge(data) {
    // Send to MnemonicArbiter for cold storage
    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'MnemonicArbiter',
        type: 'archive-cold',
        payload: data
      });

      return { success: true };
    } catch (err) {
      this.logger.error(`[${this.name}] Archival failed: ${err.message}`);
      return { success: false };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ RESOURCE SCALING ░░
  // ═══════════════════════════════════════════════════════════

  async checkResourceConstraints() {
    // Query Black for current system health
    try {
      if (messageBroker.getArbiter('BlackAgent')) {
        await messageBroker.sendMessage({
          from: this.name,
          to: 'BlackAgent',
          type: 'get-metrics',
          payload: {}
        });
      }

      // In production, would wait for response and analyze
      // For now, use local os metrics

      // Windows os.loadavg() returns [0, 0, 0], so we track process CPU usage as a proxy
      let cpuLoad = 0;
      if (os.platform() === 'win32') {
          // Calculate CPU usage based on process time since last check
          const currentUsage = process.cpuUsage();
          if (this.lastCpuUsage && this.lastCpuTime) {
              const timeDelta = Date.now() - this.lastCpuTime;
              const userDelta = currentUsage.user - this.lastCpuUsage.user;
              const systemDelta = currentUsage.system - this.lastCpuUsage.system;
              
              // (User + System microseconds) / (Time elapsed milliseconds * 1000)
              // This gives us the % of one CPU core used by SOMA
              const totalCpuPercent = (userDelta + systemDelta) / (timeDelta * 1000);
              
              // Normalize by number of cores to get system-wide impact estimate
              cpuLoad = totalCpuPercent / os.cpus().length;
          }
          this.lastCpuUsage = currentUsage;
          this.lastCpuTime = Date.now();
      } else {
        cpuLoad = os.loadavg()[0] / os.cpus().length;
      }
      
      const memUsage = 1 - (os.freemem() / os.totalmem());

      if (cpuLoad > this.resourceThresholds.cpuWarning) {
        this.logger.warn(`[${this.name}] ⚠️ High CPU load: ${(cpuLoad * 100).toFixed(1)}%`);
        await this.optimizeLearningPipeline();
      }

      if (memUsage > this.resourceThresholds.memoryWarning) {
        this.logger.warn(`[${this.name}] ⚠️ High memory usage: ${(memUsage * 100).toFixed(1)}%`);
        await this.consolidateKnowledge();  // Free up memory
      }

    } catch (err) {
      this.logger.error(`[${this.name}] Resource check failed: ${err.message}`);
    }
  }

  async optimizeLearningPipeline() {
    this.logger.info(`[${this.name}] 🔧 Optimizing learning pipeline...`);

    const optimizations = [];

    // 1. Trigger consolidation to free resources
    if (this.pendingConsolidation.length > 10) {
      await this.consolidateKnowledge();
      optimizations.push('consolidation');
    }

    // 2. Request Jetstream to optimize routing
    await messageBroker.sendMessage({
      from: this.name,
      to: 'JetstreamAgent',
      type: 'ops-route',
      payload: {
        type: 'memory-intensive',
        priority: 'high',
        requirements: { optimize: true }
      }
    });
    optimizations.push('routing');

    // 3. Scale resource allocation via Timekeeper
    await messageBroker.sendMessage({
      from: this.name,
      to: 'TimekeeperArbiter',
      type: 'evolve',
      payload: {
        avgLoad: 0.85,  // Signal high load
        reason: 'learning_velocity_optimization'
      }
    });
    optimizations.push('scaling');

    this.learningMetrics.resourceScalings++;

    this.logger.info(`[${this.name}] ✅ Applied optimizations: ${optimizations.join(', ')}`);

    return { success: true, optimizations };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ TIME PULSE HANDLING ░░
  // ═══════════════════════════════════════════════════════════

  async handleTimePulse(payload) {
    // Sync with Timekeeper's temporal pulse
    const timestamp = payload.timestamp || Date.now();

    // Update learning cycle counter
    this.learningMetrics.learningCycles++;

    return { success: true };
  }

  async handleSystemMetrics(metrics) {
    // Received from Timekeeper - use for velocity adjustment
    const avgLoad = metrics.avgLoad || 0;

    if (avgLoad > 0.8) {
      this.logger.info(`[${this.name}] High system load detected - adjusting learning targets`);
      // Temporarily reduce target velocity to prevent overload
      this.targetVelocity = Math.max(1.5, this.targetVelocity * 0.9);
    }

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ REPORTING ░░
  // ═══════════════════════════════════════════════════════════

  getVelocityReport() {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const recentSamples = this.velocityHistory.filter(v => v.timestamp > hourAgo);

    const avgVelocity = recentSamples.length > 0
      ? recentSamples.reduce((sum, v) => sum + v.velocity, 0) / recentSamples.length
      : 0;

    const targetRatio = avgVelocity / this.targetVelocity;
    const accelerationPercent = ((this.targetVelocity - 1) * 100).toFixed(0);

    return {
      success: true,
      velocity: {
        current: avgVelocity,
        target: this.targetVelocity,
        baseline: this.baselineVelocity,
        ratio: targetRatio,
        accelerationPercent: `${accelerationPercent}%`,
        status: targetRatio >= 0.95 ? 'on-target' : targetRatio >= 0.70 ? 'acceptable' : 'below-target'
      },
      metrics: this.learningMetrics,
      consolidation: {
        pending: this.pendingConsolidation.length,
        totalSize: this.formatBytes(this.pendingConsolidation.reduce((sum, i) => sum + i.size, 0))
      },
      resources: {
        cpu: (os.loadavg()[0] / os.cpus().length * 100).toFixed(1) + '%',
        memory: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1) + '%'
      },
      timekeeper: {
        connected: this.timekeeperConnected,
        scheduleActive: this.learningScheduleActive
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ UTILITIES ░░
  // ═══════════════════════════════════════════════════════════

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getStatus() {
    return {
      name: this.name,
      role: LearningVelocityTracker.role,
      capabilities: LearningVelocityTracker.capabilities,
      velocity: {
        current: this.currentVelocity,
        target: this.targetVelocity,
        samples: this.velocityHistory.length
      },
      metrics: this.learningMetrics,
      consolidation: {
        pending: this.pendingConsolidation.length,
        intervalActive: this.consolidationInterval !== null
      },
      agents: {
        timekeeperConnected: this.timekeeperConnected
      }
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] Shutting down...`);

    // Stop intervals
    if (this.velocityCheckInterval) clearInterval(this.velocityCheckInterval);
    if (this.consolidationInterval) clearInterval(this.consolidationInterval);

    // Final consolidation
    if (this.pendingConsolidation.length > 0) {
      await this.consolidateKnowledge();
    }

    this.logger.info(`[${this.name}] ✅ Shutdown complete`);
  }
}

module.exports = LearningVelocityTracker;
