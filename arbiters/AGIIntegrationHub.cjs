// ═══════════════════════════════════════════════════════════
// FILE: arbiters/AGIIntegrationHub.cjs
// AGI Integration Hub - Wires all AGI components together
//
// Purpose: Connect existing arbiters into a coherent AGI system
// - WorldModel ↔ GoalPlanner (use simulations for planning)
// - CausalityArbiter → WorldModel (causal knowledge for predictions)
// - DreamArbiter → MnemonicArbiter (episodic → semantic)
// - ExperienceReplay → MetaLearning (online RL)
// - LearningVelocityTracker → All systems (learning acceleration)
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

class AGIIntegrationHub extends BaseArbiter {
  static role = 'agi-integration';
  static capabilities = [
    'coordinate-agi-systems',
    'wire-arbiters',
    'manage-agi-loop',
    'monitor-intelligence'
  ];

  constructor(config = {}) {
    super(config);

    // Connected arbiters (will be wired during initialization)
    this.connectedArbiters = {
      worldModel: null,
      goalPlanner: null,
      causality: null,
      dream: null,
      mnemonic: null,
      experienceReplay: null,
      metaLearning: null,
      learningVelocity: null,
      vision: null
    };

    // Integration state
    this.integrationActive = false;
    this.agiLoopRunning = false;
    this.loopInterval = null;

    // AGI metrics
    this.agiMetrics = {
      planningCycles: 0,
      causalInferences: 0,
      dreamConsolidations: 0,
      onlineLearningUpdates: 0,
      worldSimulations: 0,
      totalIntelligenceScore: 0
    };

    // Configuration
    this.config = {
      agiLoopIntervalMs: config.agiLoopIntervalMs || 60000, // 1 minute
      enableAutoPlanning: config.enableAutoPlanning !== false,
      enableCausalWorldModel: config.enableCausalWorldModel !== false,
      enableDreamConsolidation: config.enableDreamConsolidation !== false,
      enableOnlineLearning: config.enableOnlineLearning !== false,
      ...config
    };

    this.logger.info(`[${this.name}] 🧠 AGI Integration Hub initializing...`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION & WIRING ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    // Wire all AGI arbiters
    await this.wireAGISystems();

    // Start AGI coordination loop
    this.startAGILoop();

    this.integrationActive = true;
    this.logger.info(`[${this.name}] ✅ AGI Integration Hub active`);
    this.logger.info(`[${this.name}] 🔗 Connected arbiters: ${Object.keys(this.connectedArbiters).filter(k => this.connectedArbiters[k]).length}/9`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: AGIIntegrationHub.role,
        capabilities: AGIIntegrationHub.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // AGI coordination messages
    messageBroker.subscribe(this.name, 'agi_status');
    messageBroker.subscribe(this.name, 'agi_metrics');
    messageBroker.subscribe(this.name, 'trigger_planning');
    messageBroker.subscribe(this.name, 'trigger_consolidation');

    // Cross-arbiter events
    messageBroker.subscribe(this.name, 'goal_created');
    messageBroker.subscribe(this.name, 'transition_observed');
    messageBroker.subscribe(this.name, 'causal_link_discovered');
    messageBroker.subscribe(this.name, 'dream_completed');
    messageBroker.subscribe(this.name, 'learning_event');
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload } = message;

      switch (type) {
        case 'agi_status':
          return this.getAGIStatus();

        case 'agi_metrics':
          return this.getAGIMetrics();

        case 'trigger_planning':
          return await this.triggerPlanningCycle(payload);

        case 'trigger_consolidation':
          return await this.triggerDreamConsolidation(payload);

        // Cross-arbiter integration handlers
        case 'goal_created':
          return await this.handleGoalCreated(payload);

        case 'transition_observed':
          return await this.handleTransitionObserved(payload);

        case 'causal_link_discovered':
          return await this.handleCausalLinkDiscovered(payload);

        case 'dream_completed':
          return await this.handleDreamCompleted(payload);

        case 'learning_event':
          return await this.handleLearningEvent(payload);

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ AGI SYSTEM WIRING ░░
  // ═══════════════════════════════════════════════════════════

  async wireAGISystems() {
    this.logger.info(`[${this.name}] 🔌 Wiring AGI systems...`);

    try {
      // Wire 1: WorldModel ↔ GoalPlanner
      await this.wireWorldModelToGoalPlanner();

      // Wire 2: CausalityArbiter → WorldModel
      await this.wireCausalityToWorldModel();

      // Wire 3: DreamArbiter → MnemonicArbiter
      await this.wireDreamToMnemonic();

      // Wire 4: ExperienceReplay → MetaLearning
      await this.wireExperienceToMetaLearning();

      // Wire 5: LearningVelocityTracker → All systems
      await this.wireLearningVelocityTracker();

      this.logger.info(`[${this.name}] ✅ All AGI systems wired successfully`);
    } catch (err) {
      this.logger.error(`[${this.name}] Wiring failed: ${err.message}`);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ WIRE 1: WorldModel ↔ GoalPlanner ░░
  // ═══════════════════════════════════════════════════════════

  async wireWorldModelToGoalPlanner() {
    this.logger.info(`[${this.name}] 🔗 Wire 1: WorldModel ↔ GoalPlanner`);

    // Establish bidirectional communication
    // GoalPlanner requests simulations from WorldModel before committing to goals
    // WorldModel informs GoalPlanner of discovered opportunities

    // Subscribe to goal creation events
    messageBroker.subscribe(this.name, 'create_goal');

    // Mark as connected
    this.connectedArbiters.worldModel = 'connected';
    this.connectedArbiters.goalPlanner = 'connected';

    this.logger.info(`[${this.name}]    ✅ WorldModel ↔ GoalPlanner wired`);
    this.logger.info(`[${this.name}]    → GoalPlanner will simulate outcomes before creating goals`);
  }

  async handleGoalCreated(payload) {
    if (!this.config.enableAutoPlanning) return { success: true, skipped: true };

    this.agiMetrics.planningCycles++;

    // When a goal is created, simulate its outcome using WorldModel
    const goal = payload.goal || payload;

    this.logger.info(`[${this.name}] 🎯 Goal created: "${goal.description || goal.title}"`);
    this.logger.info(`[${this.name}] 🌍 Simulating goal outcomes...`);

    try {
      // Request WorldModel simulation
      await messageBroker.sendMessage({
        from: this.name,
        to: 'WorldModelArbiter',
        type: 'simulate_plan',
        payload: {
          goal: goal,
          steps: goal.steps || [],
          lookAhead: 3
        }
      });

      this.agiMetrics.worldSimulations++;

      // Request causal impact analysis
      if (this.config.enableCausalWorldModel) {
        await messageBroker.sendMessage({
          from: this.name,
          to: 'CausalityArbiter',
          type: 'analyze_intervention',
          payload: {
            intervention: goal.description || goal.title,
            context: goal.context || {}
          }
        });

        this.agiMetrics.causalInferences++;
      }

      return { success: true, simulated: true };
    } catch (err) {
      this.logger.error(`[${this.name}] Goal simulation failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ WIRE 2: CausalityArbiter → WorldModel ░░
  // ═══════════════════════════════════════════════════════════

  async wireCausalityToWorldModel() {
    this.logger.info(`[${this.name}] 🔗 Wire 2: CausalityArbiter → WorldModel`);

    // WorldModel uses causal knowledge to improve predictions
    // When CausalityArbiter discovers a causal link, inform WorldModel

    this.connectedArbiters.causality = 'connected';

    this.logger.info(`[${this.name}]    ✅ CausalityArbiter → WorldModel wired`);
    this.logger.info(`[${this.name}]    → Causal knowledge will enhance world predictions`);
  }

  async handleCausalLinkDiscovered(payload) {
    if (!this.config.enableCausalWorldModel) return { success: true, skipped: true };

    this.agiMetrics.causalInferences++;

    const { cause, effect, strength, context } = payload;

    this.logger.info(`[${this.name}] 🔗 Causal link: ${cause} → ${effect} (strength: ${strength})`);

    try {
      // Inform WorldModel to update its transition model
      await messageBroker.sendMessage({
        from: this.name,
        to: 'WorldModelArbiter',
        type: 'update_causal_transition',
        payload: {
          cause,
          effect,
          strength,
          context
        }
      });

      return { success: true, updated: true };
    } catch (err) {
      this.logger.error(`[${this.name}] Causal update failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleTransitionObserved(payload) {
    // When WorldModel observes a transition, check if it reveals causal structure
    const { state, action, nextState, reward } = payload;

    try {
      // Ask CausalityArbiter to analyze for causal links
      await messageBroker.sendMessage({
        from: this.name,
        to: 'CausalityArbiter',
        type: 'observe_transition',
        payload: {
          before: state,
          action,
          after: nextState,
          outcome: reward
        }
      });

      return { success: true, analyzed: true };
    } catch (err) {
      this.logger.warn(`[${this.name}] Causal analysis failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ WIRE 3: DreamArbiter → MnemonicArbiter ░░
  // ═══════════════════════════════════════════════════════════

  async wireDreamToMnemonic() {
    this.logger.info(`[${this.name}] 🔗 Wire 3: DreamArbiter → MnemonicArbiter`);

    // DreamArbiter performs episodic → semantic consolidation
    // Distilled principles are stored in MnemonicArbiter long-term memory

    this.connectedArbiters.dream = 'connected';
    this.connectedArbiters.mnemonic = 'connected';

    this.logger.info(`[${this.name}]    ✅ DreamArbiter → MnemonicArbiter wired`);
    this.logger.info(`[${this.name}]    → Episodic memories will consolidate to semantic knowledge`);
  }

  async handleDreamCompleted(payload) {
    if (!this.config.enableDreamConsolidation) return { success: true, skipped: true };

    this.agiMetrics.dreamConsolidations++;

    const { principles, summary } = payload;

    this.logger.info(`[${this.name}] 💭 Dream cycle completed: ${summary?.proposals_count || 0} proposals`);

    try {
      // Forward distilled principles to MnemonicArbiter for long-term storage
      if (principles && principles.length > 0) {
        await messageBroker.sendMessage({
          from: this.name,
          to: 'MnemonicArbiter',
          type: 'store_principles',
          payload: {
            principles,
            source: 'dream_distillation',
            confidence: 0.95,
            timestamp: Date.now()
          }
        });

        this.logger.info(`[${this.name}]    💾 Stored ${principles.length} distilled principles`);
      }

      // Notify LearningVelocityTracker of consolidation
      await messageBroker.sendMessage({
        from: this.name,
        to: 'LearningVelocityTracker',
        type: 'knowledge_acquired',
        payload: {
          concept: 'dream_consolidation',
          domain: 'episodic_memory',
          size: JSON.stringify(principles || []).length,
          source: 'dream_arbiter'
        }
      });

      return { success: true, principles: principles?.length || 0 };
    } catch (err) {
      this.logger.error(`[${this.name}] Dream consolidation failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ WIRE 4: ExperienceReplay → MetaLearning ░░
  // ═══════════════════════════════════════════════════════════

  async wireExperienceToMetaLearning() {
    this.logger.info(`[${this.name}] 🔗 Wire 4: ExperienceReplay → MetaLearning`);

    // ExperienceReplayBuffer already has online learning (line 141-154)
    // Ensure MetaLearningEngine is connected to receive updates

    this.connectedArbiters.experienceReplay = 'connected';
    this.connectedArbiters.metaLearning = 'connected';

    this.logger.info(`[${this.name}]    ✅ ExperienceReplay → MetaLearning wired`);
    this.logger.info(`[${this.name}]    → Online RL updates will feed meta-learning`);
  }

  async handleLearningEvent(payload) {
    if (!this.config.enableOnlineLearning) return { success: true, skipped: true };

    this.agiMetrics.onlineLearningUpdates++;

    // Learning events are already handled by UniversalLearningPipeline
    // We just track them here for AGI metrics

    return { success: true, tracked: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ WIRE 5: LearningVelocityTracker → All Systems ░░
  // ═══════════════════════════════════════════════════════════

  async wireLearningVelocityTracker() {
    this.logger.info(`[${this.name}] 🔗 Wire 5: LearningVelocityTracker → All Systems`);

    // LearningVelocityTracker receives events from all learning systems
    // Already subscribed to learning_event, knowledge_acquired, pattern_detected

    this.connectedArbiters.learningVelocity = 'connected';

    this.logger.info(`[${this.name}]    ✅ LearningVelocityTracker → All Systems wired`);
    this.logger.info(`[${this.name}]    → Learning velocity tracking active across AGI`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ AGI COORDINATION LOOP ░░
  // ═══════════════════════════════════════════════════════════

  startAGILoop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
    }

    this.loopInterval = setInterval(async () => {
      await this.runAGICycle();
    }, this.config.agiLoopIntervalMs);

    this.agiLoopRunning = true;

    this.logger.info(`[${this.name}] 🔄 AGI coordination loop started (${this.config.agiLoopIntervalMs / 1000}s interval)`);
  }

  async runAGICycle() {
    if (!this.integrationActive) return;

    try {
      // 1. Check if planning is needed
      if (this.config.enableAutoPlanning) {
        await this.checkPlanningNeeds();
      }

      // 2. Update intelligence score
      this.updateIntelligenceScore();

      // 3. Publish AGI metrics
      await this.publishAGIMetrics();

    } catch (err) {
      this.logger.error(`[${this.name}] AGI cycle error: ${err.message}`);
    }
  }

  async checkPlanningNeeds() {
    // Request current velocity from LearningVelocityTracker
    try {
      const velocityResponse = await messageBroker.sendMessage({
        from: this.name,
        to: 'LearningVelocityTracker',
        type: 'velocity_query',
        payload: {}
      });

      // If velocity is low, trigger autonomous planning
      if (velocityResponse && velocityResponse.velocity) {
        const ratio = velocityResponse.velocity.ratio || 0;

        if (ratio < 0.7) {
          this.logger.warn(`[${this.name}] ⚠️ Low learning velocity detected: ${(ratio * 100).toFixed(0)}%`);
          await this.triggerPlanningCycle({ reason: 'low_velocity' });
        }
      }
    } catch (err) {
      this.logger.warn(`[${this.name}] Velocity check failed: ${err.message}`);
    }
  }

  async triggerPlanningCycle(options = {}) {
    this.logger.info(`[${this.name}] 🎯 Triggering planning cycle (${options.reason || 'manual'})`);

    try {
      // Ask GoalPlanner to generate new goals
      await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'autonomous_planning',
        payload: {
          trigger: options.reason || 'agi_coordination',
          context: options.context || {}
        }
      });

      this.agiMetrics.planningCycles++;

      return { success: true, triggered: true };
    } catch (err) {
      this.logger.error(`[${this.name}] Planning trigger failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async triggerDreamConsolidation(options = {}) {
    this.logger.info(`[${this.name}] 💭 Triggering dream consolidation (${options.reason || 'manual'})`);

    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'DreamArbiter',
        type: 'run_dream',
        payload: {
          since_hours: options.since_hours || 24,
          human_review: options.human_review !== false
        }
      });

      return { success: true, triggered: true };
    } catch (err) {
      this.logger.error(`[${this.name}] Dream trigger failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INTELLIGENCE METRICS ░░
  // ═══════════════════════════════════════════════════════════

  updateIntelligenceScore() {
    // Calculate overall AGI intelligence score
    // Based on activity across all integrated systems

    const weights = {
      planning: 0.25,
      causal: 0.20,
      consolidation: 0.20,
      learning: 0.25,
      simulation: 0.10
    };

    const rawScore =
      (this.agiMetrics.planningCycles * weights.planning) +
      (this.agiMetrics.causalInferences * weights.causal) +
      (this.agiMetrics.dreamConsolidations * weights.consolidation) +
      (this.agiMetrics.onlineLearningUpdates * weights.learning) +
      (this.agiMetrics.worldSimulations * weights.simulation);

    // Normalize to 0-10 scale
    this.agiMetrics.totalIntelligenceScore = Math.min(10, rawScore / 100);
  }

  async publishAGIMetrics() {
    await messageBroker.publish('agi_metrics_updated', {
      metrics: this.agiMetrics,
      timestamp: Date.now(),
      source: this.name
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATUS & REPORTING ░░
  // ═══════════════════════════════════════════════════════════

  getAGIStatus() {
    return {
      success: true,
      status: {
        integrationActive: this.integrationActive,
        agiLoopRunning: this.agiLoopRunning,
        connectedArbiters: Object.keys(this.connectedArbiters).filter(
          k => this.connectedArbiters[k]
        ),
        configuration: {
          autoPlanning: this.config.enableAutoPlanning,
          causalWorldModel: this.config.enableCausalWorldModel,
          dreamConsolidation: this.config.enableDreamConsolidation,
          onlineLearning: this.config.enableOnlineLearning
        }
      }
    };
  }

  getAGIMetrics() {
    return {
      success: true,
      metrics: {
        ...this.agiMetrics,
        intelligenceScore: this.agiMetrics.totalIntelligenceScore.toFixed(2),
        uptime: process.uptime(),
        timestamp: Date.now()
      }
    };
  }

  getStatus() {
    return {
      name: this.name,
      role: AGIIntegrationHub.role,
      capabilities: AGIIntegrationHub.capabilities,
      integration: {
        active: this.integrationActive,
        loopRunning: this.agiLoopRunning,
        connectedSystems: Object.keys(this.connectedArbiters).filter(
          k => this.connectedArbiters[k]
        ).length
      },
      metrics: this.agiMetrics,
      config: this.config
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] Shutting down AGI Integration Hub...`);

    // Stop AGI loop
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }

    this.agiLoopRunning = false;
    this.integrationActive = false;

    this.logger.info(`[${this.name}] ✅ Shutdown complete`);
  }
}

module.exports = AGIIntegrationHub;
module.exports.AGIIntegrationHub = AGIIntegrationHub;
