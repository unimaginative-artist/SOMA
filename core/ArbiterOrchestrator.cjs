// ════════════════════════════════════════════════════════════════════════════
// ArbiterOrchestrator — Master Coordinator for All Arbiters
// ════════════════════════════════════════════════════════════════════════════
// PURPOSE: Population-wide manager that loads genomes, spins up arbiters,
//          encodes them with PURPOSE, monitors health, and coordinates messaging
// ════════════════════════════════════════════════════════════════════════════

const messageBroker = require('./MessageBroker.cjs');
const EventEmitter = require('events');
const path = require('path');
const { pathToFileURL } = require('url');

class ArbiterOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      healthCheckInterval: config.healthCheckInterval || 5000,
      maxRestarts: config.maxRestarts || 3,
      restartWindow: config.restartWindow || 60000, // 1 minute
      ...config
    };

    this.broker = messageBroker;
    this.population = new Map();  // arbiter instances
    this.registry = new Map();    // arbiter metadata
    this.genomes = new Map();     // loaded genomes
    this.health = new Map();      // health tracking

    this.healthMonitoringTimer = null;  // Timer cleanup

    this.isRunning = false;
    this.startTime = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  async initialize() {
    console.log('🚀 SOMA ArbiterOrchestrator initializing...');
    
    // Load genomes
    await this.loadGenomes();
    
    // Setup global message handlers
    this.setupGlobalHandlers();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    this.isRunning = true;
    this.startTime = Date.now();
    
    console.log('✅ ArbiterOrchestrator initialized');
    console.log(`   Loaded ${this.genomes.size} genomes`);
  }

  /**
   * Register an already instantiated arbiter
   * @param {string} arbiterId 
   * @param {string} arbiterType 
   * @param {object} arbiter 
   */
  registerExistingArbiter(arbiterId, arbiterType, arbiter) {
    if (!arbiter) return;
    
    this.population.set(arbiterId, arbiter);
    this.registry.set(arbiterId, {
      id: arbiterId,
      type: arbiterType,
      spawnTime: Date.now(),
      restarts: 0,
      lastRestart: null,
      isExternal: true
    });

    this.health.set(arbiterId, {
      status: 'healthy',
      lastCheck: Date.now(),
      consecutiveFailures: 0
    });

    console.log(`📡 Registered existing ${arbiterType} with ID ${arbiterId}`);
  }

  async loadGenomes() {
    // In production, load from GenomeArbiter
    // For now, register available arbiter types
    
    const arbiterTypes = [
      { name: 'EmotionalEngine', path: '../cognitive/EmotionalEngine.cjs' },
      { name: 'PersonalityEngine', path: '../cognitive/PersonalityEngine.cjs' },
      { name: 'CognitiveBridge', path: '../cognitive/CognitiveBridge.cjs' },
      { name: 'SOMArbiterV3', path: '../arbiters/SOMArbiterV3.js' },
      { name: 'GenomeArbiter', path: '../arbiters/GenomeArbiter.cjs' },
      { name: 'DeploymentArbiter', path: '../arbiters/DeploymentArbiter.cjs' },
      { name: 'ArchivistArbiter', path: '../arbiters/ArchivistArbiter.cjs' },
      { name: 'StorageArbiter', path: '../arbiters/StorageArbiter.cjs' },
      { name: 'ConductorArbiter', path: '../arbiters/ConductorArbiter.cjs' },
      { name: 'EdgeWorkerArbiter', path: '../arbiters/EdgeWorkerArbiter.cjs' },
      { name: 'TimekeeperArbiter', path: '../arbiters/TimekeeperArbiter.cjs' },
      { name: 'UnifiedMemoryArbiter', path: '../arbiters/UnifiedMemoryArbiter.cjs' },

      // AGI System Arbiters (Phase 1)
      { name: 'AGIIntegrationHub', path: '../arbiters/AGIIntegrationHub.cjs' },
      { name: 'TemporalQueryArbiter', path: '../arbiters/TemporalQueryArbiter.cjs' },
      { name: 'GoalPlannerArbiter', path: '../arbiters/GoalPlannerArbiter.cjs' },
      { name: 'LearningVelocityTracker', path: '../arbiters/LearningVelocityTracker.cjs' },

      // AGI System Arbiters (Phase 2 - Social Intelligence)
      { name: 'TheoryOfMindArbiter', path: '../arbiters/TheoryOfMindArbiter.cjs' },

      // AGI System Arbiters (Phase 3 - Multi-Modal Intelligence)
      { name: 'AudioProcessingArbiter', path: '../arbiters/AudioProcessingArbiter.cjs' },
      { name: 'VisionProcessingArbiter', path: '../arbiters/VisionProcessingArbiter.cjs' },

      // AGI System Arbiters (Phase 3 - Embodied Learning)
      { name: 'SimulationArbiter', path: '../arbiters/SimulationArbiter.cjs' },
      { name: 'SimulationControllerArbiter', path: '../arbiters/SimulationControllerArbiter.cjs' },

      // AGI System Arbiters (Phase 3 - Cognitive Enhancement for Simulation)
      { name: 'WorldModelArbiter', path: '../arbiters/WorldModelArbiter.js' },
      { name: 'CausalityArbiter', path: '../arbiters/CausalityArbiter.js' },
      { name: 'DreamArbiter', path: '../arbiters/DreamArbiter.cjs', exportName: 'DreamArbiter' },
      { name: 'MetaLearningEngine', path: '../arbiters/MetaLearningEngine.js' },
      { name: 'AbstractionArbiter', path: '../arbiters/AbstractionArbiter.js' },
      { name: 'CuriosityEngine', path: '../arbiters/CuriosityEngine.js' },
      // Note: ExperienceReplayBuffer is a utility class, not an arbiter - removed from spawn list
      { name: 'HindsightReplayArbiter', path: '../arbiters/HindsightReplayArbiter.js' },

      // Self-Healing & Monitoring
      { name: 'ImmuneSystemArbiter', path: '../arbiters/ImmuneSystemArbiter.js' }
    ];

    for (const type of arbiterTypes) {
      try {
        let ArbiterClass;
        
        // Check if it's an ES6 module (.js) or CommonJS (.cjs)
        if (type.path.endsWith('.js')) {
          // ES6 module - use dynamic import with absolute path
          const absolutePath = path.resolve(__dirname, type.path);
          const fileUrl = pathToFileURL(absolutePath).href;
          const module = await import(fileUrl);
          
          // Try to get the named export matching the arbiter name
          ArbiterClass = module[type.name] || module.default;
          
          if (!ArbiterClass) {
            console.warn(`⚠️  Could not find export for ${type.name} in ${type.path}`);
            continue;
          }
        } else {
          // CommonJS module - use require
          const required = require(type.path);
          
          // If exportName is specified, it's a named export (e.g., { DreamArbiter })
          if (type.exportName) {
            ArbiterClass = required[type.exportName];
          } else {
            // Otherwise, assume it's a direct export (module.exports = Class)
            ArbiterClass = required;
          }
        }
        
        if (!ArbiterClass) {
          console.warn(`⚠️  Could not load ${type.name}: No valid class export found`);
          continue;
        }
        
        this.genomes.set(type.name, {
          name: type.name,
          class: ArbiterClass,
          purpose: this.getDefaultPurpose(type.name)
        });
      } catch (error) {
        console.warn(`⚠️  Could not load ${type.name}: ${error.message}`);
      }
    }
  }

  getDefaultPurpose(name) {
    const purposes = {
      EmotionalEngine: 'Process and manage emotional states',
      PersonalityEngine: 'Maintain personality coherence and growth',
      CognitiveBridge: 'Translate between consciousness layers',
      SOMArbiterV2: 'Core autonomous decision-making (legacy)',
      SOMArbiterV3: 'Core autonomous decision-making (QuadBrain)',
      GenomeArbiter: 'Encode and evolve arbiter genomes',
      DeploymentArbiter: 'Manage secure system updates',
      ArchivistArbiter: 'Optimize long-term memory storage',
      StorageArbiter: 'Manage multi-tier data persistence',
      ConductorArbiter: 'Orchestrate AI agent creation',
      EdgeWorkerArbiter: 'Gather and synthesize web knowledge',
      UnifiedMemoryArbiter: 'Pool RAM across cluster nodes for distributed memory',
      SyntheticLayeredCortex: 'Multi-brain thinking layer with reflection and perception',

      // AGI System Purposes
      AGIIntegrationHub: 'Coordinate and wire all AGI systems together',
      TemporalQueryArbiter: 'Enable temporal reasoning and time-based memory retrieval',
      GoalPlannerArbiter: 'Hierarchical goal planning and multi-step execution',
      LearningVelocityTracker: 'Track and optimize learning acceleration (2x target)',
      TheoryOfMindArbiter: 'Model user mental states, infer intent, and adapt responses',
      AudioProcessingArbiter: 'Speech-to-text transcription and audio intelligence',
      VisionProcessingArbiter: 'Multi-modal image analysis and visual scene understanding',
      SimulationArbiter: 'Physics-based embodied learning environment (Matter.js)',
      SimulationControllerArbiter: 'RL agent for controlling simulation via Q-learning',
      WorldModelArbiter: 'Predict state transitions for model-based planning',
      CausalityArbiter: 'Learn causal relationships and physics rules',
      DreamArbiter: 'Offline experience consolidation and counterfactual learning',
      MetaLearningEngine: 'Optimize learning hyperparameters and strategies',
      AbstractionArbiter: 'Extract transferable patterns and hierarchical skills',
      CuriosityEngine: 'Intrinsic motivation and novelty-driven exploration',
      ExperienceReplayBuffer: 'Prioritized replay buffer for efficient learning',
      HindsightReplayArbiter: 'Learn from failures by reinterpreting goals (HER)',
      ImmuneSystemArbiter: 'Self-healing system that detects and auto-fixes failing arbiters'
    };
    return purposes[name] || 'Autonomous system arbiter';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARBITER LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  async spawn(arbiterType, config = {}) {
    const genome = this.genomes.get(arbiterType);
    if (!genome) {
      throw new Error(`Unknown arbiter type: ${arbiterType}`);
    }

    const arbiterId = `${arbiterType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`🧬 Spawning ${arbiterType} with ID ${arbiterId}`);
    
    try {
      // Instantiate arbiter
      const arbiter = new genome.class(this.broker, {
        ...config,
        id: arbiterId,
        purpose: genome.purpose
      });

      // Encode with genome (inject PURPOSE)
      await this.encodeArbiter(arbiter, genome);

      // Initialize
      await arbiter.initialize();

      // Register
      this.population.set(arbiterId, arbiter);
      this.registry.set(arbiterId, {
        id: arbiterId,
        type: arbiterType,
        spawnTime: Date.now(),
        restarts: 0,
        lastRestart: null
      });

      // Initialize health tracking
      this.health.set(arbiterId, {
        status: 'healthy',
        lastCheck: Date.now(),
        consecutiveFailures: 0
      });

      console.log(`✅ Spawned ${arbiterType} successfully`);
      
      this.emit('arbiter.spawned', { arbiterId, type: arbiterType });
      
      return arbiterId;

    } catch (error) {
      console.error(`❌ Failed to spawn ${arbiterType}: ${error.message}`);
      throw error;
    }
  }

  async encodeArbiter(arbiter, genome) {
    // Inject genome data into arbiter
    arbiter.genome = {
      name: genome.name,
      purpose: genome.purpose,
      version: '1.0.0',
      encodedAt: Date.now()
    };

    // Add lifecycle hooks if not present
    if (!arbiter.onHealthCheck) {
      arbiter.onHealthCheck = async () => {
        return {
          status: 'healthy',
          timestamp: Date.now()
        };
      };
    }

    console.log(`   Encoded ${arbiter.name} with genome: ${genome.purpose}`);
  }

  async terminate(arbiterId) {
    const arbiter = this.population.get(arbiterId);
    if (!arbiter) {
      console.warn(`⚠️  Arbiter ${arbiterId} not found`);
      return;
    }

    console.log(`🛑 Terminating ${arbiterId}...`);
    
    try {
      // Cleanup
      if (arbiter.cleanup) {
        await arbiter.cleanup();
      }

      // Remove from tracking
      this.population.delete(arbiterId);
      this.registry.delete(arbiterId);
      this.health.delete(arbiterId);

      console.log(`✅ Terminated ${arbiterId}`);
      
      this.emit('arbiter.terminated', { arbiterId });

    } catch (error) {
      console.error(`❌ Error terminating ${arbiterId}: ${error.message}`);
    }
  }

  async restart(arbiterId) {
    const metadata = this.registry.get(arbiterId);
    if (!metadata) {
      console.warn(`⚠️  Cannot restart unknown arbiter ${arbiterId}`);
      return;
    }

    // Check restart limits
    const now = Date.now();
    if (metadata.lastRestart && (now - metadata.lastRestart) < this.config.restartWindow) {
      metadata.restarts++;
    } else {
      metadata.restarts = 1;
    }
    metadata.lastRestart = now;

    if (metadata.restarts > this.config.maxRestarts) {
      console.error(`❌ ${arbiterId} exceeded max restarts (${this.config.maxRestarts})`);
      this.emit('arbiter.failed', { arbiterId, reason: 'max_restarts_exceeded' });
      await this.terminate(arbiterId);
      return;
    }

    console.log(`🔄 Restarting ${arbiterId} (attempt ${metadata.restarts}/${this.config.maxRestarts})...`);
    
    try {
      // Get config from existing arbiter
      const arbiter = this.population.get(arbiterId);
      const config = arbiter?.config || {};

      // Terminate old instance
      await this.terminate(arbiterId);

      // Spawn new instance
      await this.spawn(metadata.type, config);

      console.log(`✅ Restarted ${metadata.type} successfully`);

    } catch (error) {
      console.error(`❌ Failed to restart ${arbiterId}: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HEALTH MONITORING
  // ═══════════════════════════════════════════════════════════════════════════

  startHealthMonitoring() {
    this.healthMonitoringTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);

    console.log(`💓 Health monitoring started (interval: ${this.config.healthCheckInterval}ms)`);
  }

  async performHealthChecks() {
    for (const [arbiterId, arbiter] of this.population.entries()) {
      try {
        const health = await this.checkArbiterHealth(arbiter);
        
        this.health.set(arbiterId, {
          status: health.status,
          lastCheck: Date.now(),
          consecutiveFailures: health.status === 'healthy' ? 0 : (this.health.get(arbiterId)?.consecutiveFailures || 0) + 1,
          details: health
        });

        // Handle unhealthy arbiters
        if (health.status === 'unhealthy') {
          const failures = this.health.get(arbiterId).consecutiveFailures;
          console.warn(`⚠️  ${arbiterId} is unhealthy (${failures} consecutive failures)`);
          
          if (failures >= 3) {
            console.error(`❌ ${arbiterId} failed health checks, restarting...`);
            await this.restart(arbiterId);
          }
        }

      } catch (error) {
        console.error(`❌ Health check failed for ${arbiterId}: ${error.message}`);
        
        // Mark as unhealthy
        const current = this.health.get(arbiterId) || {};
        this.health.set(arbiterId, {
          status: 'error',
          lastCheck: Date.now(),
          consecutiveFailures: (current.consecutiveFailures || 0) + 1,
          error: error.message
        });
      }
    }
  }

  async checkArbiterHealth(arbiter) {
    // Use arbiter's health check if available
    if (arbiter.onHealthCheck) {
      return await arbiter.onHealthCheck();
    }

    // Default health check
    return {
      status: arbiter.isRunning !== false ? 'healthy' : 'unhealthy',
      timestamp: Date.now()
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL MESSAGE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  setupGlobalHandlers() {
    // Listen for arbiter lifecycle events
    this.broker.subscribe('arbiter.spawn', async (data) => {
      await this.spawn(data.type, data.config);
    });

    this.broker.subscribe('arbiter.terminate', async (data) => {
      await this.terminate(data.arbiterId);
    });

    this.broker.subscribe('arbiter.restart', async (data) => {
      await this.restart(data.arbiterId);
    });

    // Listen for system queries
    this.broker.subscribe('system.status', () => {
      this.broker.publish('system.status.response', this.getSystemStatus());
    });

    this.broker.subscribe('system.population', () => {
      this.broker.publish('system.population.response', this.getPopulationStats());
    });

    console.log('📡 Global message handlers registered');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POPULATION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  getPopulation() {
    return Array.from(this.population.entries()).map(([id, arbiter]) => ({
      id,
      type: arbiter.constructor.name,
      name: arbiter.name,
      status: this.health.get(id)?.status || 'unknown'
    }));
  }

  getArbiter(arbiterId) {
    return this.population.get(arbiterId);
  }

  async spawnPopulation(config) {
    console.log('🌱 Spawning complete arbiter population...');

    const population = config.population || [
      { type: 'CognitiveBridge', config: {} },
      { type: 'SOMArbiterV3', config: {} },
      { type: 'GenomeArbiter', config: {} },
      { type: 'StorageArbiter', config: { backend: 'filesystem' } },
      { type: 'ArchivistArbiter', config: {} },
      { type: 'ConductorArbiter', config: { openaiKey: process.env.OPENAI_API_KEY } },
      { type: 'EdgeWorkerArbiter', config: { maxClones: 5 } },
      { type: 'DeploymentArbiter', config: {} },

      // AGI System Arbiters (Phase 1)
      { type: 'AGIIntegrationHub', config: { enableAutoPlanning: true, enableCausalWorldModel: true } },
      { type: 'TemporalQueryArbiter', config: { timeBucketMs: 3600000, patternDetectionThreshold: 3 } },

      // AGI System Arbiters (Phase 2 - Social Intelligence)
      { type: 'TheoryOfMindArbiter', config: { intentConfidenceThreshold: 0.7, confusionThreshold: 0.6 } },

      // AGI System Arbiters (Phase 3 - Multi-Modal Intelligence)
      { type: 'AudioProcessingArbiter', config: { whisperModel: 'whisper-1', enableTimestamps: true } },
      { type: 'VisionProcessingArbiter', config: { visionModel: 'gemini-2.0-flash-exp', enableCaching: true } },

      // AGI System Arbiters (Phase 3 - Embodied Learning)
      // (Simulation & Controller now manually handled in Bootstrap to avoid port conflicts)

      // AGI System Arbiters (Phase 3 - Cognitive Enhancement for Simulation)
      { type: 'WorldModelArbiter', config: { maxLookAhead: 5, minConfidenceToAct: 0.6, learningRate: 0.1 } },
      { type: 'CausalityArbiter', config: { minObservations: 10, confidenceThreshold: 0.7, interventionWeight: 2.0 } },
      { type: 'DreamArbiter', config: { dreamIntervalMs: 60000, maxFragments: 1000, enableCounterfactuals: true } },
      { type: 'MetaLearningEngine', config: { optimizationInterval: 100, minExperiencesForOptimization: 50 } },
      { type: 'AbstractionArbiter', config: { minSimilarity: 0.65, transferThreshold: 0.7, maxPatterns: 1000 } },
      { type: 'CuriosityEngine', config: { noveltyRewardWeight: 0.5, explorationInterval: 5000 } },
      // ExperienceReplayBuffer is a utility class, not an arbiter - removed from spawn list
      { type: 'HindsightReplayArbiter', config: { hindsightRatio: 0.8, maxHindsightGoals: 4, minEpisodeLength: 3 } }
    ];

    const spawned = [];
    for (const spec of population) {
      try {
        const arbiterId = await this.spawn(spec.type, spec.config);
        spawned.push({ type: spec.type, id: arbiterId });
      } catch (error) {
        console.error(`❌ Failed to spawn ${spec.type}: ${error.message}`);
      }
    }

    console.log(`✅ Spawned ${spawned.length}/${population.length} arbiters`);

    // Initialize AGI system integration
    try {
      const { getAGIIntegration } = require('./AGI-Integration.cjs');
      const agi = getAGIIntegration();
      await agi.initializeAGI(this);
      
      // Expose Learning Pipeline for other arbiters (like STEVE)
      if (agi.learningPipeline) {
          this.learningPipeline = agi.learningPipeline;
          console.log('🔗 Learning Pipeline linked to Orchestrator');
      }
    } catch (error) {
      console.error(`⚠️  AGI initialization failed: ${error.message}`);
    }

    return spawned;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS & STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════

  getSystemStatus() {
    return {
      isRunning: this.isRunning,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      population: {
        total: this.population.size,
        healthy: Array.from(this.health.values()).filter(h => h.status === 'healthy').length,
        unhealthy: Array.from(this.health.values()).filter(h => h.status === 'unhealthy').length,
        error: Array.from(this.health.values()).filter(h => h.status === 'error').length
      },
      broker: {
        subscriptions: this.broker.subscriptions.size,
        messages: this.broker.metrics.messagesSent || 0
      },
      timestamp: Date.now()
    };
  }

  getPopulationStats() {
    const stats = {
      total: this.population.size,
      byType: {},
      byHealth: {
        healthy: 0,
        unhealthy: 0,
        error: 0,
        unknown: 0
      },
      arbiters: []
    };

    for (const [id, arbiter] of this.population.entries()) {
      const type = arbiter.constructor.name;
      const metadata = this.registry.get(id);
      const health = this.health.get(id);

      // Count by type
      stats.byType[type] = (stats.byType[type] || 0) + 1;

      // Count by health
      const status = health?.status || 'unknown';
      stats.byHealth[status] = (stats.byHealth[status] || 0) + 1;

      // Add arbiter details
      stats.arbiters.push({
        id,
        type,
        name: arbiter.name,
        purpose: arbiter.genome?.purpose,
        spawnTime: metadata?.spawnTime,
        uptime: metadata ? Date.now() - metadata.spawnTime : 0,
        health: {
          status: status,
          lastCheck: health?.lastCheck,
          consecutiveFailures: health?.consecutiveFailures || 0
        }
      });
    }

    return stats;
  }

  getHealthReport() {
    const report = {
      timestamp: Date.now(),
      overall: 'healthy',
      arbiters: {}
    };

    for (const [id, health] of this.health.entries()) {
      const arbiter = this.population.get(id);
      report.arbiters[id] = {
        type: arbiter?.constructor.name,
        name: arbiter?.name,
        ...health
      };

      if (health.status !== 'healthy') {
        report.overall = 'degraded';
      }
    }

    return report;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHUTDOWN
  // ═══════════════════════════════════════════════════════════════════════════

  async shutdown() {
    console.log('🛑 Shutting down ArbiterOrchestrator...');

    this.isRunning = false;

    // Clear health monitoring timer
    if (this.healthMonitoringTimer) {
      clearInterval(this.healthMonitoringTimer);
      this.healthMonitoringTimer = null;
    }

    // Terminate all arbiters
    const arbiters = Array.from(this.population.keys());
    for (const arbiterId of arbiters) {
      await this.terminate(arbiterId);
    }

    // Cleanup broker
    if (this.broker.shutdown) {
      await this.broker.shutdown();
    }

    console.log('✅ ArbiterOrchestrator shut down');
  }
}

module.exports = ArbiterOrchestrator;
