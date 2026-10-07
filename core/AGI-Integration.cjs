// ════════════════════════════════════════════════════════════════════════════
// AGI System Integration Module
// ════════════════════════════════════════════════════════════════════════════
// PURPOSE: Wire all AGI components together and manage the AGI coordination loop
// ════════════════════════════════════════════════════════════════════════════

const messageBroker = require('./MessageBroker.cjs');

class AGISystemIntegration {
  constructor() {
    this.agiArbiters = new Map();
    this.initialized = false;
    this.coordinationLoopActive = false;
    this.loopInterval = null;

    // AGI metrics
    this.metrics = {
      planningCycles: 0,
      causalInferences: 0,
      dreamConsolidations: 0,
      onlineLearningUpdates: 0,
      worldSimulations: 0,
      temporalPatterns: 0,
      totalIntelligenceScore: 0,
      lastUpdate: null
    };

    console.log('🧠 AGI System Integration initialized');
  }

  /**
   * Initialize all AGI arbiters
   * Called by ArbiterOrchestrator after spawning population
   */
  async initializeAGI(orchestrator) {
    console.log('═'.repeat(80));
    console.log('🧠 INITIALIZING AGI SYSTEM');
    console.log('═'.repeat(80));
    console.log();

    try {
      // Get references to spawned AGI arbiters
      await this.gatherAGIArbiters(orchestrator);

      // Wire systems together
      await this.wireAGISystems();

      // Start AGI coordination loop
      this.startAGICoordinationLoop();

      this.initialized = true;

      console.log();
      console.log('✅ AGI SYSTEM OPERATIONAL');
      console.log(`   Connected Arbiters: ${this.agiArbiters.size}`);
      console.log(`   Coordination Loop: ${this.coordinationLoopActive ? 'ACTIVE' : 'INACTIVE'}`);
      console.log('═'.repeat(80));
      console.log();

      return true;
    } catch (error) {
      console.error('❌ AGI initialization failed:', error.message);
      console.error(error.stack);
      return false;
    }
  }

  /**
   * Gather references to all AGI arbiters from population
   */
  async gatherAGIArbiters(orchestrator) {
    console.log('🔍 Gathering AGI arbiters...');

    const agiArbiterNames = [
      'AGIIntegrationHub',
      'TemporalQueryArbiter',
      'WorldModelArbiter',
      'GoalPlannerArbiter',
      'LearningVelocityTracker',
      'TheoryOfMindArbiter',
      'AudioProcessingArbiter',
      'VisionProcessingArbiter',
      'SimulationArbiter',
      'SimulationControllerArbiter',
      'CausalityArbiter',
      'DreamArbiter',
      'MetaLearningEngine',
      'AbstractionArbiter',
      'CuriosityEngine',
      'ExperienceReplayBuffer',
      'HindsightReplayArbiter'
    ];

    for (const name of agiArbiterNames) {
      // Try to find the arbiter in the population
      for (const [id, arbiter] of orchestrator.population.entries()) {
        if (id.startsWith(name) || arbiter.name === name) {
          this.agiArbiters.set(name, arbiter);
          console.log(`   ✅ Found ${name}`);
          break;
        }
      }

      if (!this.agiArbiters.has(name)) {
        console.log(`   ⚠️  ${name} not found in population`);
      }
    }

    console.log(`   Total: ${this.agiArbiters.size}/${agiArbiterNames.length} arbiters found`);

    // Wire MetaLearning to ExperienceReplayBuffer
    const metaLearning = this.agiArbiters.get('MetaLearningEngine');
    const expBuffer = this.agiArbiters.get('ExperienceReplayBuffer');
    
    if (metaLearning && expBuffer) {
      // Cross-connect
      expBuffer.metaLearningEngine = metaLearning;
      metaLearning.experienceBuffer = expBuffer;
      console.log('   🔗 Connected MetaLearningEngine <-> ExperienceReplayBuffer');
    }
  }

  /**
   * Wire AGI systems together via message subscriptions
   */
  async wireAGISystems() {
    console.log('🔗 Wiring AGI systems...');

    // Subscribe to key AGI events
    const agiEvents = [
      'goal_created',
      'transition_observed',
      'causal_link_discovered',
      'dream_completed',
      'learning_event',
      'knowledge_acquired',
      'pattern_detected',
      'temporal_pattern_detected',
      'intent_inferred',
      'user_confused',
      'user_message',
      'user_interaction',
      'audio_transcribed',
      'audio_received',
      'transcription_requested',
      'vision_analyzed',
      'image_received',
      'vision_analysis_requested',
      'simulation_observation',
      'simulation_action',
      'simulation_task_complete',
      'simulation_episode_start',
      'simulation_collision'
    ];

    for (const event of agiEvents) {
      messageBroker.subscribe('AGISystemIntegration', event);
    }

    // Setup event handlers
    this.setupEventHandlers();

    console.log(`   ✅ Subscribed to ${agiEvents.length} AGI events`);
    console.log('   ✅ Event handlers configured');
  }

  /**
   * Setup handlers for AGI events
   */
  setupEventHandlers() {
    // Track metrics when events occur
    messageBroker.on('goal_created', (msg) => {
      this.metrics.planningCycles++;
      this.metrics.lastUpdate = Date.now();
    });

    messageBroker.on('causal_link_discovered', (msg) => {
      this.metrics.causalInferences++;
      this.metrics.lastUpdate = Date.now();
    });

    messageBroker.on('dream_completed', (msg) => {
      this.metrics.dreamConsolidations++;
      this.metrics.lastUpdate = Date.now();
    });

    messageBroker.on('learning_event', (msg) => {
      this.metrics.onlineLearningUpdates++;
      this.metrics.lastUpdate = Date.now();
    });

    messageBroker.on('temporal_pattern_detected', (msg) => {
      this.metrics.temporalPatterns++;
      this.metrics.lastUpdate = Date.now();
    });

    messageBroker.on('intent_inferred', (msg) => {
      // Track intent inference as part of intelligence
      this.metrics.lastUpdate = Date.now();
    });

    messageBroker.on('user_confused', (msg) => {
      // Log confusion detection for learning
      console.log(`[AGI] User confusion detected, suggested clarification available`);
    });

    messageBroker.on('audio_transcribed', async (msg) => {
      // When audio is transcribed, send to TheoryOfMind for intent analysis
      const { text, audioPath, metadata } = msg.payload;

      if (text && text.length > 0) {
        console.log(`[AGI] Audio transcribed: "${text.substring(0, 50)}..."`);

        // Send as user message for intent analysis
        await messageBroker.publish('user_message', {
          userId: 'voice-user',
          message: text,
          context: {
            source: 'audio',
            audioPath,
            duration: metadata?.duration,
            language: metadata?.language
          }
        });
      }
    });

    messageBroker.on('vision_analyzed', async (msg) => {
      // When image is analyzed, send to TheoryOfMind for visual intent analysis
      const { description, metadata } = msg.payload;

      if (description && description.length > 0) {
        console.log(`[AGI] Vision analyzed: "${description.substring(0, 50)}..."`);

        // Send as user message for visual intent analysis
        await messageBroker.publish('user_message', {
          userId: 'vision-user',
          message: `[Visual Context] ${description}`,
          context: {
            source: 'vision',
            imageType: metadata?.mimeType,
            model: metadata?.model
          }
        });
      }
    });

    messageBroker.on('simulation_task_complete', async (msg) => {
      // When simulation task is completed, log learning progress
      const { score, episode } = msg.payload;

      console.log(`[AGI] 🎮 Simulation episode ${episode} completed: Score ${Math.floor(score)}`);

      // Emit learning event for LearningVelocityTracker
      await messageBroker.publish('learning_event', {
        source: 'embodied_simulation',
        outcome: 'task_completed',
        score,
        episode,
        timestamp: Date.now()
      });
    });

    messageBroker.on('simulation_collision', async (msg) => {
      // Collisions teach physics and cause-effect relationships
      const { object, position } = msg.payload;

      // Feed to CausalityArbiter for learning
      await messageBroker.publish('transition_observed', {
        fromState: { position },
        action: 'collision',
        toState: { object },
        source: 'simulation'
      });
    });
  }

  /**
   * Start AGI coordination loop
   * Runs every minute to coordinate AGI systems
   */
  startAGICoordinationLoop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
    }

    this.loopInterval = setInterval(async () => {
      await this.runAGICoordinationCycle();
    }, 60000); // 60 seconds

    this.coordinationLoopActive = true;

    console.log('🔄 AGI coordination loop started (60s interval)');
  }

  /**
   * Run one cycle of AGI coordination
   */
  async runAGICoordinationCycle() {
    if (!this.initialized) return;

    try {
      // Update intelligence score
      this.updateIntelligenceScore();

      // Check if planning is needed
      await this.checkPlanningNeeds();

      // Check if consolidation is needed
      await this.checkConsolidationNeeds();

      // Publish AGI metrics
      await this.publishMetrics();

    } catch (error) {
      console.error('AGI coordination cycle error:', error.message);
    }
  }

  /**
   * Update overall intelligence score based on AGI activity
   */
  updateIntelligenceScore() {
    const weights = {
      planning: 0.25,
      causal: 0.20,
      consolidation: 0.20,
      learning: 0.25,
      temporal: 0.10
    };

    const rawScore =
      (this.metrics.planningCycles * weights.planning) +
      (this.metrics.causalInferences * weights.causal) +
      (this.metrics.dreamConsolidations * weights.consolidation) +
      (this.metrics.onlineLearningUpdates * weights.learning) +
      (this.metrics.temporalPatterns * weights.temporal);

    // Normalize to 0-10 scale
    this.metrics.totalIntelligenceScore = Math.min(10, rawScore / 100);
  }

  /**
   * Check if autonomous planning should be triggered
   */
  async checkPlanningNeeds() {
    try {
      // Query learning velocity
      await messageBroker.sendMessage({
        from: 'AGISystemIntegration',
        to: 'LearningVelocityTracker',
        type: 'velocity_query',
        payload: {}
      });
    } catch (error) {
      // LearningVelocityTracker might not be available yet
    }
  }

  /**
   * Check if dream consolidation should be triggered
   */
  async checkConsolidationNeeds() {
    // Check if it's around 4 AM (consolidation time)
    const now = new Date();
    const hour = now.getHours();

    if (hour === 4) {
      try {
        await messageBroker.sendMessage({
          from: 'AGISystemIntegration',
          to: 'DreamArbiter',
          type: 'run_dream',
          payload: {
            since_hours: 24,
            human_review: false
          }
        });

        console.log('🌙 Triggered 4 AM dream consolidation');
      } catch (error) {
        // DreamArbiter might not be available
      }
    }
  }

  /**
   * Publish AGI metrics to message broker
   */
  async publishMetrics() {
    try {
      await messageBroker.publish('agi_metrics_updated', {
        metrics: this.metrics,
        timestamp: Date.now(),
        source: 'AGISystemIntegration'
      });
    } catch (error) {
      // Ignore publish errors
    }
  }

  /**
   * Get current AGI status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      coordinationLoopActive: this.coordinationLoopActive,
      connectedArbiters: Array.from(this.agiArbiters.keys()),
      arbiterCount: this.agiArbiters.size,
      metrics: { ...this.metrics },
      uptime: this.coordinationLoopActive ? process.uptime() : 0
    };
  }

  /**
   * Get detailed AGI metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      intelligenceScore: this.metrics.totalIntelligenceScore.toFixed(2),
      lastUpdate: this.metrics.lastUpdate ? new Date(this.metrics.lastUpdate).toISOString() : null
    };
  }

  /**
   * Shutdown AGI systems
   */
  async shutdown() {
    console.log('🧠 Shutting down AGI systems...');

    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }

    this.coordinationLoopActive = false;
    this.initialized = false;

    console.log('✅ AGI systems shutdown complete');
  }
}

// Singleton instance
let agiIntegration = null;

function getAGIIntegration() {
  if (!agiIntegration) {
    agiIntegration = new AGISystemIntegration();
  }
  return agiIntegration;
}

module.exports = {
  AGISystemIntegration,
  getAGIIntegration
};
