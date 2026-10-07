// ═══════════════════════════════════════════════════════════
// FILE: arbiters/ASIOrchestrator.cjs
// ASI System Orchestrator - Integrates all three ASI capabilities
// 1. Distributed Learning (EdgeWorker + VelocityTracker)
// 2. Phase 1 Agents (Black, Jetstream, Kuze, Batou)
// 3. Self-Modification (Code optimization)
// Target: Unified ASI with exponential learning + self-improvement
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const crypto = require('crypto');
const MetaLearner = require('../asi/meta/MetaLearner.cjs');

class ASIOrchestrator extends BaseArbiter {
  static role = 'asi-orchestration';
  static capabilities = ['coordinate-asi', 'integrate-systems', 'monitor-performance', 'optimize-learning'];

  constructor(config = {}) {
    super(config);

    // Meta-Learner (The Brain's Coach)
    this.metaLearner = new MetaLearner();

    // System references
    this.systems = {
      distributedLearning: {
        velocityTracker: null,
        edgeWorker: null,
        status: 'offline',
        metrics: {}
      },
      phase1Agents: {
        black: null,
        jetstream: null,
        kuze: null,
        batou: null,
        status: 'offline',
        metrics: {}
      },
      selfModification: {
        arbiter: null,
        status: 'offline',
        metrics: {}
      }
    };

    // Integration state
    this.integrationComplete = false;
    this.systemsOnline = 0;
    this.totalSystems = 9;  // 2 learning + 4 agents + 1 self-mod + 2 support

    // Performance tracking
    this.performanceMetrics = {
      learningVelocity: 0,
      codeOptimizations: 0,
      systemHealth: 100,
      agentCoordination: 0,
      uptimeMs: 0
    };

    // ASI coordination
    this.coordinationRules = this.buildCoordinationRules();
    this.synergies = new Map();
    this.optimizationCycles = 0;

    // Monitoring
    this.monitoringInterval = null;
    this.startTime = Date.now();

    this.logger.info(`[${this.name}] 🧠 ASI Orchestrator initializing...`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    // Initialize Meta-Learner
    await this.metaLearner.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    this.logger.info(`[${this.name}] ✅ ASI Orchestrator ready to integrate systems`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: ASIOrchestrator.role,
        capabilities: ASIOrchestrator.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    messageBroker.subscribe(this.name, 'system_status');
    messageBroker.subscribe(this.name, 'start_integration');
    messageBroker.subscribe(this.name, 'optimize_asi');
    messageBroker.subscribe(this.name, 'performance_report');
    
    // 🔥 AUTO-SEEDING: Listen for Gaps → Create Goals
    messageBroker.subscribe('curiosity:gap_detected', this.onGapDetected.bind(this));
    messageBroker.subscribe('self:capability_gap', this.onCapabilityGap.bind(this));

    // ♾️ META-LOOP: Listen for Optimization Results
    messageBroker.subscribe('optimization_complete', this.onOptimizationComplete.bind(this));
  }

  /**
   * Handle Optimization Completion (Closing the Loop)
   */
  async onOptimizationComplete(msg) {
    const { payload } = msg;
    this.logger.info(`[${this.name}] ♾️ Meta-Loop: Received optimization result for ${payload.functionName}`);

    // Calculate Reward
    let reward = 0;
    if (payload.success) {
        // Positive reward proportional to speedup (e.g. +10% = +0.1)
        const gain = parseFloat(payload.performanceDelta) || 0;
        reward = gain / 100; 
    } else {
        // Penalty for breaking code
        reward = -0.5;
    }

    // Feed to Meta-Learner
    await this.metaLearner.learn({
        context: {
            action: 'code_optimization',
            target: payload.functionName
        },
        outcome: payload.success ? 'success' : 'failure',
        reward: reward
    });

    this.logger.info(`[${this.name}] 🧠 Meta-Learner updated. Reward: ${reward.toFixed(2)}`);
  }

  /**
   * Convert Curiosity Gaps into Learning Goals
   */
  async onGapDetected(gap) {
    if (!gap || !gap.topic) return;
    
    this.logger.info(`[${this.name}] 🧠 Converting Curiosity Gap to Goal: "${gap.topic}"`);
    
    const goal = {
        title: `Learn ${gap.topic}`,
        description: `Autonomous learning goal triggered by curiosity gap: ${gap.reason || 'Unknown'}`,
        category: 'learning',
        priority: 0.7, // High enough to matter, low enough to not block survival
        metrics: {
            target: { metric: 'knowledge_coverage', value: 80 },
            current: { metric: 'knowledge_coverage', value: 0 }
        },
        assignedTo: ['WebScraperDendrite', 'KnowledgeGraphFusion']
    };

    await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'create_goal',
        payload: goal
    });
  }

  /**
   * Convert Capability Gaps into Self-Improvement Goals
   */
  async onCapabilityGap(gap) {
    if (!gap || !gap.capability) return;

    this.logger.info(`[${this.name}] 🧬 Converting Capability Gap to Goal: "${gap.capability}"`);

    const goal = {
        title: `Improve ${gap.capability}`,
        description: `Self-detected capability gap: ${gap.current} vs target ${gap.target}`,
        category: 'self-improvement',
        priority: 0.9, // Very high priority
        metrics: {
            target: { metric: gap.metric, value: gap.target },
            current: { metric: gap.metric, value: gap.current }
        },
        assignedTo: ['EngineeringSwarmArbiter', 'MetaLearningEngine']
    };

    await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'create_goal',
        payload: goal
    });
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload } = message;

      switch (type) {
        case 'system_status':
          return this.getSystemStatus();

        case 'start_integration':
          return await this.integrateAllSystems(payload);

        case 'optimize_asi':
          return await this.optimizeASI(payload);

        case 'performance_report':
          return this.getPerformanceReport();

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ SYSTEM INTEGRATION ░░
  // ═══════════════════════════════════════════════════════════

  async integrateAllSystems(config = {}) {
    this.logger.info(`[${this.name}] 🚀 Starting ASI system integration...`);

    const integrationResults = {
      phase1: null,
      phase2: null,
      phase3: null,
      phase4: null
    };

    try {
      // Phase 1: Connect to Distributed Learning
      integrationResults.phase1 = await this.integrateDistributedLearning();
      
      // Phase 2: Connect to Phase 1 Agents
      integrationResults.phase2 = await this.integratePhase1Agents();
      
      // Phase 3: Connect to Self-Modification
      integrationResults.phase3 = await this.integrateSelfModification();
      
      // Phase 4: Establish Synergies
      integrationResults.phase4 = await this.establishSynergies();

      this.integrationComplete = true;
      
      // Start monitoring
      this.startMonitoring();

      return {
        success: true,
        integrationComplete: true,
        systemsOnline: this.systemsOnline,
        totalSystems: this.totalSystems,
        results: integrationResults
      };
    } catch (err) {
      this.logger.error(`[${this.name}] Integration failed: ${err.message}`);
      return {
        success: false,
        error: err.message,
        results: integrationResults
      };
    }
  }

  async integrateDistributedLearning() {
    this.logger.info(`[${this.name}] [PHASE 1] Integrating Distributed Learning...`);

    const results = {
      velocityTracker: { connected: false },
      edgeWorker: { connected: false }
    };

    try {
      // Connect to LearningVelocityTracker
      const velocityResponse = await messageBroker.sendMessage({
        from: this.name,
        to: 'LearningVelocityTracker',
        type: 'velocity_query',
        payload: {}
      });

      if (velocityResponse) {
        this.systems.distributedLearning.velocityTracker = 'LearningVelocityTracker';
        this.systems.distributedLearning.status = 'online';
        this.systemsOnline++;
        results.velocityTracker = { connected: true, response: velocityResponse };
        this.logger.info(`[${this.name}] ✅ LearningVelocityTracker: CONNECTED`);
      }
    } catch (err) {
      this.logger.warn(`[${this.name}] VelocityTracker unavailable: ${err.message}`);
    }

    try {
      // Connect to EdgeWorkerOrchestrator
      const edgeResponse = await messageBroker.sendMessage({
        from: this.name,
        to: 'EdgeWorkerOrchestrator',
        type: 'worker_status',
        payload: {}
      });

      if (edgeResponse) {
        this.systems.distributedLearning.edgeWorker = 'EdgeWorkerOrchestrator';
        this.systemsOnline++;
        results.edgeWorker = { connected: true, response: edgeResponse };
        this.logger.info(`[${this.name}] ✅ EdgeWorkerOrchestrator: CONNECTED`);
      }
    } catch (err) {
      this.logger.warn(`[${this.name}] EdgeWorker unavailable: ${err.message}`);
    }

    return {
      success: results.velocityTracker.connected || results.edgeWorker.connected,
      systems: results
    };
  }

  async integratePhase1Agents() {
    this.logger.info(`[${this.name}] [PHASE 2] Integrating Phase 1 Agents...`);

    const agents = ['BlackAgent', 'JetstreamAgent', 'KuzeAgent', 'BatouAgent'];
    const results = {};

    for (const agent of agents) {
      try {
        this.logger.info(`[${this.name}] Connecting to ${agent}...`);
        const response = await messageBroker.sendMessage({
          from: this.name,
          to: agent,
          type: 'status_check',
          payload: {}
        });

        this.logger.info(`[${this.name}] ${agent} response:`, response ? 'success' : 'null');

        if (response && response.success) {
          const agentKey = agent.toLowerCase().replace('agent', '');
          this.systems.phase1Agents[agentKey] = agent;
          this.systemsOnline++;
          results[agent] = { connected: true, response };
          this.logger.info(`[${this.name}] ✅ ${agent}: CONNECTED`);
        } else {
          results[agent] = { connected: false, reason: 'no_response' };
          this.logger.warn(`[${this.name}] ${agent}: No valid response`);
        }
      } catch (err) {
        this.logger.warn(`[${this.name}] ${agent} unavailable: ${err.message}`);
        results[agent] = { connected: false, error: err.message };
      }
    }

    const connectedCount = Object.values(results).filter(r => r.connected).length;
    this.systems.phase1Agents.status = connectedCount > 0 ? 'online' : 'offline';

    return {
      success: connectedCount > 0,
      connectedAgents: connectedCount,
      totalAgents: agents.length,
      agents: results
    };
  }

  async integrateSelfModification() {
    this.logger.info(`[${this.name}] [PHASE 3] Integrating Engineering Swarm...`);

    try {
      const response = await messageBroker.sendMessage({
        from: this.name,
        to: 'EngineeringSwarmArbiter', // Updated from SelfModificationArbiter
        type: 'status_check', // Updated message type if needed, or stick to what EngineeringSwarmArbiter handles
        payload: {}
      });

      if (response && response.success) {
        this.systems.selfModification.arbiter = 'EngineeringSwarmArbiter';
        this.systems.selfModification.status = 'online';
        this.systemsOnline++;
        this.logger.info(`[${this.name}] ✅ EngineeringSwarmArbiter: CONNECTED`);
        
        return {
          success: true,
          response
        };
      }
    } catch (err) {
      this.logger.warn(`[${this.name}] EngineeringSwarm unavailable: ${err.message}`);
    }

    return { success: false };
  }

  async establishSynergies() {
    this.logger.info(`[${this.name}] [PHASE 4] Establishing System Synergies...`);

    const synergies = [];

    // Synergy 1: Kuze pattern analysis → Self-Modification optimization targets
    if (this.systems.phase1Agents.kuze && this.systems.selfModification.arbiter) {
      synergies.push({
        id: 'kuze-engswarm',
        from: 'KuzeAgent',
        to: 'EngineeringSwarmArbiter',
        type: 'pattern-to-optimization',
        description: 'Kuze identifies code patterns for engineering swarm'
      });
      this.logger.info(`[${this.name}] ✓ Synergy: Kuze → Engineering Swarm`);
    }

    // Synergy 2: Black system monitoring → Learning velocity optimization
    if (this.systems.phase1Agents.black && this.systems.distributedLearning.velocityTracker) {
      synergies.push({
        id: 'black-velocity',
        from: 'BlackAgent',
        to: 'LearningVelocityTracker',
        type: 'resource-to-scaling',
        description: 'Black monitors resources for optimal learning velocity'
      });
      this.logger.info(`[${this.name}] ✓ Synergy: Black → Velocity Tracker`);
    }

    // Synergy 3: Engineering Swarm → Edge Workers (optimize worker code)
    if (this.systems.selfModification.arbiter && this.systems.distributedLearning.edgeWorker) {
      synergies.push({
        id: 'engswarm-edge',
        from: 'EngineeringSwarmArbiter',
        to: 'EdgeWorkerOrchestrator',
        type: 'code-optimization',
        description: 'Engineering Swarm optimizes edge worker performance'
      });
      this.logger.info(`[${this.name}] ✓ Synergy: Engineering Swarm → Edge Workers`);
    }

    // Synergy 4: Jetstream diagnostics → All systems
    if (this.systems.phase1Agents.jetstream) {
      synergies.push({
        id: 'jetstream-orchestration',
        from: 'JetstreamAgent',
        to: 'ASIOrchestrator',
        type: 'diagnostic-routing',
        description: 'Jetstream provides system diagnostics'
      });
      this.logger.info(`[${this.name}] ✓ Synergy: Jetstream → ASI Orchestrator`);
    }

    // Store synergies
    for (const synergy of synergies) {
      this.synergies.set(synergy.id, synergy);
    }

    return {
      success: true,
      synergiesEstablished: synergies.length,
      synergies
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ COORDINATION RULES ░░
  // ═══════════════════════════════════════════════════════════

  buildCoordinationRules() {
    return {
      // When learning velocity drops, trigger self-optimization
      velocityDrop: {
        condition: (metrics) => metrics.learningVelocity < 1.5,
        action: async () => {
          this.logger.info(`[${this.name}] 🔧 Learning velocity drop detected - triggering self-optimization`);
          await this.triggerSelfOptimization();
        }
      },

      // When system health degrades, run diagnostics
      healthDegradation: {
        condition: (metrics) => metrics.systemHealth < 80,
        action: async () => {
          this.logger.info(`[${this.name}] 🏥 System health degradation - running diagnostics`);
          await this.runSystemDiagnostics();
        }
      },

      // When optimizations succeed, apply to edge workers
      optimizationSuccess: {
        condition: (metrics) => metrics.codeOptimizations > 0,
        action: async () => {
          this.logger.info(`[${this.name}] 📈 Optimizations available - propagating to workers`);
          await this.propagateOptimizations();
        }
      }
    };
  }

  async triggerSelfOptimization() {
    if (!this.systems.selfModification.arbiter) return;

    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'EngineeringSwarmArbiter',
        type: 'optimize_function',
        payload: {
          filepath: 'arbiters/LearningVelocityTracker.cjs',
          functionName: 'consolidateKnowledge',
          strategy: 'parallelization'
        }
      });
    } catch (err) {
      this.logger.error(`[${this.name}] Self-optimization failed: ${err.message}`);
    }
  }

  async runSystemDiagnostics() {
    if (!this.systems.phase1Agents.jetstream) return;

    try {
      const diagnostics = await messageBroker.sendMessage({
        from: this.name,
        to: 'JetstreamAgent',
        type: 'run_diagnostics',
        payload: {}
      });

      this.logger.info(`[${this.name}] 📊 Diagnostics complete`);
      return diagnostics;
    } catch (err) {
      this.logger.error(`[${this.name}] Diagnostics failed: ${err.message}`);
    }
  }

  async propagateOptimizations() {
    // In a real implementation, this would deploy optimized code to workers
    this.logger.info(`[${this.name}] 🚀 Propagating optimizations to edge workers...`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ MONITORING & OPTIMIZATION ░░
  // ═══════════════════════════════════════════════════════════

  startMonitoring() {
    this.monitoringInterval = setInterval(() => this.monitorASI(), 30000);  // Every 30s
    this.logger.info(`[${this.name}] 📡 ASI monitoring started`);
  }

  async monitorASI() {
    this.performanceMetrics.uptimeMs = Date.now() - this.startTime;

    // Query learning velocity
    if (this.systems.distributedLearning.velocityTracker) {
      try {
        const velocityData = await messageBroker.sendMessage({
          from: this.name,
          to: 'LearningVelocityTracker',
          type: 'velocity_query',
          payload: {}
        });

        if (velocityData && velocityData.currentVelocity) {
          this.performanceMetrics.learningVelocity = velocityData.currentVelocity;
        }
      } catch (err) {
        // Silent fail
      }
    }

    // Query self-modification metrics
    if (this.systems.selfModification.arbiter) {
      try {
        const modData = await messageBroker.sendMessage({
          from: this.name,
          to: 'EngineeringSwarmArbiter',
          type: 'status_check',
          payload: {}
        });

        // modData.status.metrics.modificationsSucceeded (or similar)
        // EngineeringSwarm doesn't have 'modificationsAttempted' in the same structure as SelfModificationArbiter yet
        // We'll mock it or use what's available
        if (modData && modData.status && modData.status.metrics) {
             this.performanceMetrics.codeOptimizations = modData.status.metrics.tasksCompleted || 0;
        }
      } catch (err) {
        // Silent fail
      }
    }

    // Apply coordination rules
    for (const [ruleName, rule] of Object.entries(this.coordinationRules)) {
      if (rule.condition(this.performanceMetrics)) {
        await rule.action();
      }
    }

    this.optimizationCycles++;
  }

  async optimizeASI(payload = {}) {
    this.logger.info(`[${this.name}] 🧠 Running ASI optimization cycle...`);

    const optimizations = [];

    // Optimize learning velocity
    if (this.systems.distributedLearning.velocityTracker) {
      optimizations.push({
        system: 'learning',
        action: 'velocity_optimization',
        triggered: true
      });
    }

    // Optimize code
    if (this.systems.selfModification.arbiter) {
      optimizations.push({
        system: 'self-modification',
        action: 'code_optimization',
        triggered: true
      });
      await this.triggerSelfOptimization();
    }

    // Run Meta-Learning Cycle
    const metaResult = await this.metaLearner.runOptimizationCycle();
    if (metaResult.transfers.length > 0) {
      optimizations.push({
        system: 'meta-learner',
        action: 'transfer_learning',
        details: metaResult
      });
      this.logger.info(`[${this.name}] 🧠 Meta-Learning Transfer Active: ${metaResult.transfers.length} rules transferred`);
    }

    return {
      success: true,
      optimizations,
      cycle: this.optimizationCycles
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATUS & REPORTING ░░
  // ═══════════════════════════════════════════════════════════

  getSystemStatus() {
    return {
      name: this.name,
      integrationComplete: this.integrationComplete,
      systemsOnline: this.systemsOnline,
      totalSystems: this.totalSystems,
      systems: {
        distributedLearning: {
          status: this.systems.distributedLearning.status,
          components: {
            velocityTracker: !!this.systems.distributedLearning.velocityTracker,
            edgeWorker: !!this.systems.distributedLearning.edgeWorker
          }
        },
        phase1Agents: {
          status: this.systems.phase1Agents.status,
          agents: {
            black: !!this.systems.phase1Agents.black,
            jetstream: !!this.systems.phase1Agents.jetstream,
            kuze: !!this.systems.phase1Agents.kuze,
            batou: !!this.systems.phase1Agents.batou
          }
        },
        selfModification: {
          status: this.systems.selfModification.status,
          arbiter: !!this.systems.selfModification.arbiter
        }
      },
      synergies: this.synergies.size,
      performance: this.performanceMetrics
    };
  }

  getPerformanceReport() {
    const uptime = Date.now() - this.startTime;
    const uptimeHours = (uptime / 3600000).toFixed(2);

    return {
      success: true,
      asi: {
        integrationComplete: this.integrationComplete,
        systemsOnline: `${this.systemsOnline}/${this.totalSystems}`,
        uptime: `${uptimeHours} hours`,
        optimizationCycles: this.optimizationCycles
      },
      performance: this.performanceMetrics,
      synergies: Array.from(this.synergies.values()),
      status: this.getSystemStatus()
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ SHUTDOWN ░░
  // ═══════════════════════════════════════════════════════════

  async shutdown() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.logger.info(`[${this.name}] 🧠 ASI Orchestrator shutdown`);
    this.logger.info(`[${this.name}] 📊 Systems integrated: ${this.systemsOnline}/${this.totalSystems}`);
    this.logger.info(`[${this.name}] 🔄 Optimization cycles: ${this.optimizationCycles}`);

    await super.shutdown();
  }
}

module.exports = ASIOrchestrator;
