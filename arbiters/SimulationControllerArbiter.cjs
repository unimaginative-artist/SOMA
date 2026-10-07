// ════════════════════════════════════════════════════════════════════════════
// SimulationControllerArbiter - RL Agent for Physical Simulation
// ════════════════════════════════════════════════════════════════════════════
// Controls SOMA's body in the physics simulation using reinforcement learning
// - Observes world state from SimulationArbiter
// - Uses WorldModel to predict outcomes
// - Uses OnlineRL to learn optimal policies
// - Integrates with AGI coordination for embodied learning
// ════════════════════════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const fs = require('fs').promises;
const path = require('path');

class SimulationControllerArbiter extends BaseArbiter {
  constructor(config = {}) {
    super(config);

    this.config = {
      actionInterval: config.actionInterval || 100, // ms between actions
      explorationRate: config.explorationRate || 0.1, // epsilon for exploration (reduced!)
      explorationDecay: config.explorationDecay || 0.99,
      minExploration: config.minExploration || 0.01,
      learningRate: config.learningRate || 0.1,
      discountFactor: config.discountFactor || 0.95,
      rewardMemory: config.rewardMemory || 1000,
      autoSaveInterval: config.autoSaveInterval || 300000, // 5 minutes
      saveAfterEpisodes: config.saveAfterEpisodes || 10, // Save every 10 episodes
      ...config
    };

    // RL State
    this.lastObservation = null;
    this.lastAction = null;
    this.lastReward = 0;
    this.totalReward = 0;
    this.episodeRewards = [];

    // Action space: [forceX, forceY]
    // Discretized: left, right, jump, stay
    this.actionSpace = [
      { name: 'left', forceX: -0.5, forceY: 0 },
      { name: 'right', forceX: 0.5, forceY: 0 },
      { name: 'jump', forceX: 0, forceY: -1.0 },
      { name: 'left_jump', forceX: -0.3, forceY: -0.8 },
      { name: 'right_jump', forceX: 0.3, forceY: -0.8 },
      { name: 'push_left', forceX: -0.8, forceY: 0 },
      { name: 'push_right', forceX: 0.8, forceY: 0 },
      { name: 'stay', forceX: 0, forceY: 0 }
    ];

    // Q-learning table (state → action values)
    this.qTable = new Map();

    // Learning statistics
    this.stats = {
      actionsExecuted: 0,
      episodesCompleted: 0,
      averageReward: 0,
      explorationRate: this.config.explorationRate,
      totalLearningUpdates: 0,
      successfulEpisodes: 0
    };

    // Control loop
    this.controlInterval = null;
    this.isActive = false;

    // Persistence
    this.autoSaveTimer = null;
    this.lastSaveTime = Date.now();

    // References to AGI arbiters
    this.worldModel = null;
    this.onlineRL = null;
    this.dreamArbiter = null;
    this.causalityArbiter = null;
    this.metaLearning = null;
    this.abstraction = null;
    this.curiosity = null;
    this.experienceBuffer = null;
    this.hindsightReplay = null;

    // Intelligent exploration (fallback when AGI arbiters missing)
    this.explorationGrid = new Map(); // Track visited grid cells
    this.lastTargetPos = null;
    this.searchStrategy = 'spiral'; // 'spiral', 'quadrant', 'random'

    console.log(`[${this.name}] 🤖 Simulation Controller initializing...`);
  }

  async initialize() {
    await super.initialize();

    // Subscribe to simulation events
    if (this.broker) {
      await this.broker.subscribe('simulation_observation', this.handleObservation.bind(this));
      await this.broker.subscribe('simulation_task_complete', this.handleTaskComplete.bind(this));
      await this.broker.subscribe('simulation_episode_start', this.handleEpisodeStart.bind(this));
      await this.broker.subscribe('simulation_collision', this.handleCollision.bind(this));
    }

    // Load previous learning state
    await this.loadLearningState();

    // Load persistent experience buffer and HER config (after delay for arbiter connections)
    setTimeout(() => this.loadPersistentMemory(), 6000);

    // Start auto-save timer
    this.startAutoSave();

    // Connect to AGI arbiters (with delay to allow them to initialize)
    setTimeout(() => this.connectAGIArbiters(), 5000);

    console.log(`[${this.name}] ✅ Simulation Controller ready`);
    console.log(`[${this.name}] 🧠 RL parameters: α=${this.config.learningRate}, γ=${this.config.discountFactor}, ε=${this.config.explorationRate}`);
    console.log(`[${this.name}] 💾 Q-table loaded: ${this.qTable.size} states`);

    return { success: true };
  }

  /**
   * Connect to AGI arbiters for enhanced learning
   */
  async connectAGIArbiters() {
    console.log(`[${this.name}] 🔌 Connecting to AGI arbiters...`);

    // Get arbiters from message broker
    if (!this.broker) {
      console.warn(`[${this.name}] Cannot connect AGI arbiters: no MessageBroker`);
      return;
    }

    // Find WorldModelArbiter by direct ID lookup (more reliable)
    const arbiterIds = [
      { id: 'WorldModelArbiter', ref: 'worldModel', name: 'WorldModel (prediction)' },
      { id: 'CausalityArbiter', ref: 'causalityArbiter', name: 'Causality (cause-effect)' },
      { id: 'DreamArbiter', ref: 'dreamArbiter', name: 'Dream (consolidation)' },
      { id: 'MetaLearningEngine', ref: 'metaLearning', name: 'MetaLearning (optimization)' },
      { id: 'AbstractionArbiter', ref: 'abstraction', name: 'Abstraction (patterns)' },
      { id: 'CuriosityEngine', ref: 'curiosity', name: 'Curiosity (exploration)' },
      { id: 'HindsightReplayArbiter', ref: 'hindsightReplay', name: 'HindsightReplay (HER)' }
    ];

    // Look up each arbiter
    for (const { id, ref, name } of arbiterIds) {
      // Try to get arbiter by checking all registered names that contain the ID
      for (const [registeredName, arbiterData] of this.broker.arbiters.entries()) {
        if (registeredName && registeredName.includes(id)) {
          this[ref] = arbiterData.instance || arbiterData;
          console.log(`[${this.name}]    ✅ Connected to ${name}`);
          break;
        }
      }
    }

    const connectedCount = [
      this.worldModel,
      this.causalityArbiter,
      this.dreamArbiter,
      this.metaLearning,
      this.abstraction,
      this.curiosity,
      this.experienceBuffer,
      this.hindsightReplay
    ].filter(Boolean).length;

    console.log(`[${this.name}] 🧠 Connected ${connectedCount}/8 AGI systems for accelerated learning!`);

    // Log which ones are missing for diagnostics
    if (connectedCount < 8) {
      const missing = [];
      if (!this.worldModel) missing.push('WorldModel');
      if (!this.causalityArbiter) missing.push('Causality');
      if (!this.dreamArbiter) missing.push('Dream');
      if (!this.metaLearning) missing.push('MetaLearning');
      if (!this.abstraction) missing.push('Abstraction');
      if (!this.curiosity) missing.push('Curiosity');
      if (!this.experienceBuffer) missing.push('ExperienceReplayBuffer');
      if (!this.hindsightReplay) missing.push('HindsightReplay');

      console.warn(`[${this.name}] ⚠️  Missing AGI systems: ${missing.join(', ')}`);
      console.warn(`[${this.name}] ⚠️  Will use basic Q-learning fallback for missing features`);
    }
  }

  /**
   * Connect to other AGI arbiters
   */
  connectAGI(worldModel, onlineRL, dreamArbiter) {
    this.worldModel = worldModel;
    this.onlineRL = onlineRL;
    this.dreamArbiter = dreamArbiter;

    console.log(`[${this.name}] 🔗 Connected to AGI systems:`);
    if (worldModel) console.log(`[${this.name}]    ✅ WorldModel (for prediction)`);
    if (onlineRL) console.log(`[${this.name}]    ✅ OnlineRL (for policy learning)`);
    if (dreamArbiter) console.log(`[${this.name}]    ✅ DreamArbiter (for consolidation)`);
  }

  /**
   * Start control loop
   */
  startControl() {
    if (this.isActive) return;

    this.isActive = true;
    console.log(`[${this.name}] 🎮 Starting autonomous control...`);

    this.controlInterval = setInterval(() => {
      if (!this.lastObservation) return;

      // Decide next action
      const action = this.selectAction(this.lastObservation);

      // Execute action
      this.executeAction(action);

    }, this.config.actionInterval);
  }

  /**
   * Stop control loop
   */
  stopControl() {
    this.isActive = false;
    clearInterval(this.controlInterval);
    console.log(`[${this.name}] 🛑 Autonomous control stopped`);
  }

  /**
   * Handle observation from simulation
   */
  async handleObservation(message) {
    const { observation, reward, episode, frame } = message;

    // Update last reward
    this.lastReward = reward;
    this.totalReward += reward;

    // Learn from experience if we have previous state-action pair
    if (this.lastObservation && this.lastAction) {
      await this.learn(this.lastObservation, this.lastAction, reward, observation);
    }

    // Update current observation
    this.lastObservation = observation;

    // Log occasionally
    if (frame % 300 === 0) {
      console.log(`[${this.name}] 📊 Episode ${episode}, Frame ${frame}, Reward: ${this.totalReward.toFixed(2)}, ε: ${this.stats.explorationRate.toFixed(3)}`);
    }
  }

  /**
   * Handle task completion
   */
  async handleTaskComplete(message) {
    const { score, episode } = message;

    console.log(`[${this.name}] 🎉 Task completed! Episode ${episode}, Score: ${Math.floor(score)}`);

    this.stats.episodesCompleted++;
    this.stats.successfulEpisodes++;
    this.episodeRewards.push(this.totalReward);
    
    // Push to Universal Learning Pipeline
    const system = global.__SOMA_SYSTEM;
    if (system?.universalLearningPipeline) {
        system.universalLearningPipeline.logInteraction({
            agent: 'SimulationControllerArbiter',
            type: 'physics_epoch_complete',
            input: { episode, explorationRate: this.stats.explorationRate },
            output: { score, reward: this.totalReward, qTableSize: this.qTable.size, status: 'success' },
            metadata: { tags: ['simulation', 'physics', 'embodiment', 'learning'] }
        }).catch(() => {});
        
        // Also feed into the ExperienceReplayBuffer explicitly
        if (system.universalLearningPipeline.experienceBuffer) {
            system.universalLearningPipeline.experienceBuffer.addExperience({
                state: { episode, score },
                action: 'physics_epoch',
                agent: 'SimulationController',
                outcome: `Completed epoch ${episode} with score ${score}`,
                reward: this.totalReward,
                nextState: null,
                metadata: { qTableSize: this.qTable.size }
            });
        }
    }

    // Calculate average reward
    const recent = this.episodeRewards.slice(-100);
    this.stats.averageReward = recent.reduce((a, b) => a + b, 0) / recent.length;

    // Decay exploration
    this.stats.explorationRate = Math.max(
      this.config.minExploration,
      this.stats.explorationRate * this.config.explorationDecay
    );

    // Save Q-table periodically
    if (this.stats.episodesCompleted % this.config.saveAfterEpisodes === 0) {
      console.log(`[${this.name}] 💾 Auto-saving learning state...`);
      await this.saveLearningState();
      await this.savePersistentMemory(); // Save experience buffer + HER config
      
      // Publish stats for Meta-Learning extraction
      if (this.broker) {
          this.broker.publish('simulation:stats', {
              stats: {
                  successRate: this.stats.successfulEpisodes / this.stats.episodesCompleted,
                  episodesCompleted: this.stats.episodesCompleted,
                  initialEpsilon: 1.0, // Assuming standard start
                  minEpsilon: this.config.minExploration,
                  learningRate: this.config.learningRate,
                  explorationDecay: this.config.explorationDecay,
                  currentEpsilon: this.stats.explorationRate
              },
              context: {
                  task: 'navigation_push',
                  timestamp: Date.now()
              }
          });
      }
    }

    // Consolidate learning in dream arbiter
    if (this.dreamArbiter && this.episodeRewards.length % 10 === 0) {
      console.log(`[${this.name}] 💤 Triggering dream consolidation...`);
      try {
        // Send Q-table experiences to dream arbiter for consolidation
        await this.broker.publish('experience_batch', {
          source: 'simulation_controller',
          qTableSize: this.qTable.size,
          episodesCompleted: this.stats.episodesCompleted,
          averageReward: this.stats.averageReward,
          recentRewards: this.episodeRewards.slice(-10)
        });
      } catch (error) {
        console.error(`[${this.name}] Dream consolidation failed:`, error.message);
      }
    }

    // Feed learning progress to WorldModel
    if (this.worldModel && this.worldModel.saveWorldModel) {
      try {
        await this.worldModel.saveWorldModel();
      } catch (error) {
        console.warn(`[${this.name}] ⚠️  WorldModel save failed:`, error.message);
      }
    }

    // Feed patterns to AbstractionArbiter
    if (this.abstraction && this.abstraction.saveAbstractions) {
      try {
        await this.abstraction.saveAbstractions();
      } catch (error) {
        console.warn(`[${this.name}] ⚠️  Abstraction save failed:`, error.message);
      }
    }

    // Reset episode reward
    this.totalReward = 0;
  }

  /**
   * Handle episode start
   */
  async handleEpisodeStart(message) {
    const { episode, task } = message;

    console.log(`[${this.name}] 🎬 New episode ${episode} starting: ${task}`);

    // Reset episode state
    this.lastObservation = null;
    this.lastAction = null;
    this.totalReward = 0;

    // Ensure control is running
    if (!this.isActive) {
      this.startControl();
    }
  }

  /**
   * Handle collision
   */
  async handleCollision(message) {
    const { object } = message;

    // Small penalty for hitting walls (helps avoid obstacles)
    if (object.includes('wall') || object === 'barrier') {
      this.lastReward -= 0.5;
    }
  }

  /**
   * Intelligent exploration - mimics CuriosityArbiter behavior
   * Returns action index that explores intelligently
   */
  selectExplorationAction(observation) {
    if (!observation || !observation.agent || !observation.target) {
      return Math.floor(Math.random() * this.actionSpace.length);
    }

    const agentPos = observation.agent.position;
    const targetPos = observation.target.position;

    // Track visited grid cells (100px buckets)
    const gridKey = `${Math.floor(agentPos.x / 100)},${Math.floor(agentPos.y / 100)}`;
    this.explorationGrid.set(gridKey, (this.explorationGrid.get(gridKey) || 0) + 1);

    // If target moved recently, use directional heuristic
    if (this.lastTargetPos) {
      const dx = targetPos.x - agentPos.x;
      const dy = targetPos.y - agentPos.y;

      // Pick action that moves toward target
      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal movement more important
        if (dx > 0) return this.actionSpace.findIndex(a => a.name === 'right' || a.name === 'push_right');
        else return this.actionSpace.findIndex(a => a.name === 'left' || a.name === 'push_left');
      } else {
        // Vertical movement more important
        if (dy < -50) return this.actionSpace.findIndex(a => a.name === 'jump' || a.name === 'left_jump');
        else return this.actionSpace.findIndex(a => a.name === 'right' || a.name === 'left');
      }
    }

    this.lastTargetPos = { x: targetPos.x, y: targetPos.y };

    // Default: move toward target
    const dx = targetPos.x - agentPos.x;
    const dy = targetPos.y - agentPos.y;

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 1 : 0; // right or left
    } else {
      return dy < 0 ? 2 : 1; // jump or right
    }
  }

  /**
   * Select action using model-based planning + ε-greedy policy
   */
  selectAction(observation) {
    // MODEL-BASED PLANNING: Use WorldModel to simulate outcomes
    if (this.worldModel && this.worldModel.predict && Math.random() > 0.1) {
      try {
        const predictions = this.actionSpace.map((action, idx) => {
          // Predict next state for this action
          const predicted = this.worldModel.predict({
            state: observation,
            action: action.name
          });

          if (!predicted || !predicted.nextState) return null;

          // Estimate reward for predicted state
          const predictedReward = this.estimateRewardFromState(predicted.nextState);
          const confidence = predicted.confidence || 0.5;

          return {
            action,
            idx,
            predictedReward,
            confidence,
            nextState: predicted.nextState
          };
        }).filter(Boolean);

        // Sort by predicted reward * confidence
        predictions.sort((a, b) =>
          (b.predictedReward * b.confidence) - (a.predictedReward * a.confidence)
        );

        // Pick best high-confidence prediction
        if (predictions.length > 0 && predictions[0].confidence > 0.4) {
          // Occasionally log predictions for debugging
          if (Math.random() < 0.05) {
            console.log(`[${this.name}] 🔮 WorldModel: ${predictions[0].action.name} (R:${predictions[0].predictedReward.toFixed(2)}, C:${predictions[0].confidence.toFixed(2)})`);
          }
          return predictions[0].action;
        }
      } catch (error) {
        // WorldModel not ready or error, fall back to Q-learning
      }
    }

    // Exploration: intelligent action (mimics CuriosityArbiter)
    if (Math.random() < this.stats.explorationRate) {
      const intelligentIndex = this.selectExplorationAction(observation);
      return this.actionSpace[intelligentIndex];
    }

    // Exploitation: best known action from Q-table
    const stateKey = this.getStateKey(observation);
    const qValues = this.qTable.get(stateKey) || new Array(this.actionSpace.length).fill(0);

    // Find best action
    let bestActionIndex = 0;
    let bestValue = qValues[0];

    for (let i = 1; i < qValues.length; i++) {
      if (qValues[i] > bestValue) {
        bestValue = qValues[i];
        bestActionIndex = i;
      }
    }

    return this.actionSpace[bestActionIndex];
  }

  /**
   * Estimate reward from a predicted state (for model-based planning)
   */
  estimateRewardFromState(state) {
    if (!state || !state.cargo || !state.target) return 0;

    // Calculate distance from cargo to target
    const dx = (state.cargo.position?.x || 0) - (state.target.position?.x || 0);
    const dy = (state.cargo.position?.y || 0) - (state.target.position?.y || 0);
    const distCargoTarget = Math.sqrt(dx*dx + dy*dy);

    // Reward based on proximity to target
    const proximityReward = Math.max(0, (600 - distCargoTarget) / 600);

    // Bonus if very close (goal state)
    const goalBonus = distCargoTarget < 80 ? 1000 : 0;

    return proximityReward + goalBonus;
  }

  /**
   * Execute action in simulation
   */
  async executeAction(action) {
    this.lastAction = action;
    this.stats.actionsExecuted++;

    // Send action to SimulationArbiter
    if (this.broker) {
      await this.broker.publish('simulation_action', {
        forceX: action.forceX,
        forceY: action.forceY,
        actionName: action.name,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Learn from experience (Q-learning update)
   */
  async learn(oldState, action, reward, newState) {
    const oldStateKey = this.getStateKey(oldState);
    const newStateKey = this.getStateKey(newState);

    // Get Q-values
    const oldQValues = this.qTable.get(oldStateKey) || new Array(this.actionSpace.length).fill(0);
    const newQValues = this.qTable.get(newStateKey) || new Array(this.actionSpace.length).fill(0);

    // Find action index
    const actionIndex = this.actionSpace.indexOf(action);

    // Q-learning update: Q(s,a) = Q(s,a) + α[r + γ·maxQ(s',a') - Q(s,a)]
    const maxFutureQ = Math.max(...newQValues);
    const currentQ = oldQValues[actionIndex];

    const tdTarget = reward + this.config.discountFactor * maxFutureQ;
    const tdError = tdTarget - currentQ;

    oldQValues[actionIndex] = currentQ + this.config.learningRate * tdError;

    // Update Q-table
    this.qTable.set(oldStateKey, oldQValues);

    this.stats.totalLearningUpdates++;

    // Use OnlineRL arbiter if available
    if (this.onlineRL) {
      await this.onlineRL.recordExperience({
        state: oldState,
        action: action.name,
        reward,
        nextState: newState,
        done: false
      });
    }

    // Feed transition to WorldModel for learning
    if (this.worldModel && this.worldModel.observeTransition) {
      try {
        await this.worldModel.observeTransition({
          state: oldState,
          action: action.name,
          nextState: newState,
          reward
        });
      } catch (error) {
        // Only log occasionally to avoid spam
        if (Math.random() < 0.01) {
          console.warn(`[${this.name}] ⚠️  WorldModel transition feed failed:`, error.message);
        }
      }
    }

    // Feed experience to CausalityArbiter
    if (this.causalityArbiter && this.broker) {
      try {
        await this.broker.publish('transition_observed', {
          fromState: oldState,
          action: action.name,
          toState: newState,
          reward,
          source: 'simulation_controller'
        });
      } catch (error) {
        // Only log occasionally to avoid spam
        if (Math.random() < 0.01) {
          console.warn(`[${this.name}] ⚠️  Causality feed failed:`, error.message);
        }
      }
    }

    // 🎯 Feed transition to HindsightReplay for HER processing
    if (this.broker) {
      try {
        await this.broker.publish('simulation_transition', {
          state: oldState,
          action: action.name,
          reward,
          nextState: newState,
          done: false // Will be set to true on episode end
        });
      } catch (error) {
        // Silent fail - HER is optional
      }
    }

    // 🎓 EXPERIENCE REPLAY: Learn from past experiences using prioritized sampling
    if (this.experienceBuffer && 
        this.experienceBuffer.experiences && 
        this.experienceBuffer.experiences.length >= 100 && 
        this.stats.totalLearningUpdates % 5 === 0) { // Every 5 updates
      
      try {
        // Sample batch using prioritized replay
        const batch = this.experienceBuffer.sample(
          32, // batch size
          'prioritized', // strategy
          { alpha: 0.6, beta: 0.4 }
        );
        
        if (batch && batch.experiences) {
          // Learn from sampled experiences
          for (let i = 0; i < batch.experiences.length; i++) {
            const exp = batch.experiences[i];
            const stateKey = this.getStateKey(exp.state);
            const nextStateKey = this.getStateKey(exp.nextState);
            
            const qValues = this.qTable.get(stateKey) || new Array(this.actionSpace.length).fill(0);
            const nextQValues = this.qTable.get(nextStateKey) || new Array(this.actionSpace.length).fill(0);
            
            const actionIdx = this.actionSpace.findIndex(a => a.name === exp.action);
            if (actionIdx === -1) continue;
            
            const maxFutureQ = Math.max(...nextQValues);
            const currentQ = qValues[actionIdx];
            const tdTarget = exp.reward + this.config.discountFactor * maxFutureQ;
            const tdError = tdTarget - currentQ;
            
            // Apply importance weight from prioritized sampling
            const weight = batch.weights ? batch.weights[i] : 1.0;
            qValues[actionIdx] = currentQ + this.config.learningRate * tdError * weight;
            
            this.qTable.set(stateKey, qValues);
          }
          
          // Log occasionally
          if (Math.random() < 0.02) {
            console.log(`[${this.name}] 🎓 Learned from ${batch.experiences.length} replayed experiences`);
          }
        }
      } catch (error) {
        // Not enough experiences yet or buffer not ready, skip replay
      }
    }
  }

  /**
   * Convert observation to discrete state key (Coarse & Relative)
   * Solves state space explosion by grouping similar situations.
   */
  getStateKey(observation) {
    if (!observation || !observation.agent || !observation.target) {
      return 'unknown';
    }

    const bucketSize = 100; // Very coarse 100px grid
    
    const agentX = observation.agent.position.x;
    const agentY = observation.agent.position.y;
    const targetX = observation.target.position.x;
    const targetY = observation.target.position.y;

    // 1. Relative Agent -> Target (Grid coordinates)
    // Range: -8 to +8 roughly
    const relTargetX = Math.round((targetX - agentX) / bucketSize);
    const relTargetY = Math.round((targetY - agentY) / bucketSize);

    // 2. Cargo State (Critical for pushing)
    let cargoState = 'NC'; // No Cargo
    if (observation.cargo && observation.cargo.position) {
      const cargoX = observation.cargo.position.x;
      const cargoY = observation.cargo.position.y;
      
      // Relative Agent -> Cargo
      const relCargoX = Math.round((cargoX - agentX) / bucketSize);
      const relCargoY = Math.round((cargoY - agentY) / bucketSize);
      
      // Relative Cargo -> Target
      const cargoTargetX = Math.round((targetX - cargoX) / bucketSize);
      const cargoTargetY = Math.round((targetY - cargoY) / bucketSize);
      
      cargoState = `C:${relCargoX},${relCargoY}|CT:${cargoTargetX},${cargoTargetY}`;
    }

    // 3. Coarse Velocity (-1, 0, 1)
    // Only care if moving intentionally, ignore minor drift
    const velX = Math.abs(observation.agent.velocity.x) < 0.5 ? 0 : Math.sign(observation.agent.velocity.x);
    const velY = Math.abs(observation.agent.velocity.y) < 0.5 ? 0 : Math.sign(observation.agent.velocity.y);

    // Key format: "T:2,-3|V:1,0|C:..."
    return `T:${relTargetX},${relTargetY}|V:${velX},${velY}|${cargoState}`;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      isActive: this.isActive,
      totalReward: this.totalReward,
      qTableSize: this.qTable.size,
      episodesRecorded: this.episodeRewards.length,
      lastActionName: this.lastAction?.name || 'none',
      agiFeatures: this.getAGIStatus()
    };
  }

  /**
   * Get AGI feature status for diagnostics
   */
  getAGIStatus() {
    return {
      worldModel: {
        connected: !!this.worldModel,
        hasPredict: !!(this.worldModel && this.worldModel.predict),
        hasObserveTransition: !!(this.worldModel && this.worldModel.observeTransition),
        hasSave: !!(this.worldModel && this.worldModel.saveWorldModel)
      },
      causalityArbiter: {
        connected: !!this.causalityArbiter
      },
      dreamArbiter: {
        connected: !!this.dreamArbiter
      },
      metaLearning: {
        connected: !!this.metaLearning
      },
      abstraction: {
        connected: !!this.abstraction,
        hasSave: !!(this.abstraction && this.abstraction.saveAbstractions)
      },
      curiosity: {
        connected: !!this.curiosity
      },
      onlineRL: {
        connected: !!this.onlineRL
      }
    };
  }

  /**
   * Start auto-save timer
   */
  startAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(async () => {
      const timeSinceLastSave = Date.now() - this.lastSaveTime;
      if (timeSinceLastSave >= this.config.autoSaveInterval) {
        console.log(`[${this.name}] 💾 Auto-saving (${this.config.autoSaveInterval / 1000}s interval)...`);
        await this.saveLearningState();
      }
    }, this.config.autoSaveInterval);

    console.log(`[${this.name}] ⏰ Auto-save enabled (every ${this.config.autoSaveInterval / 1000}s)`);
  }

  /**
   * Load Q-learning state from disk
   */
  async loadLearningState() {
    try {
      const dataPath = path.join(process.cwd(), 'SOMA', 'simulation-learning');
      await fs.mkdir(dataPath, { recursive: true });

      const statePath = path.join(dataPath, 'q-learning-state.json');
      const data = await fs.readFile(statePath, 'utf8');
      const saved = JSON.parse(data);

      // Restore Q-table
      this.qTable = new Map();
      for (const [key, value] of saved.qTable) {
        this.qTable.set(key, value);
      }

      // Restore stats (but keep current config explorationRate)
      if (saved.stats) {
        const currentExplorationRate = this.stats.explorationRate;
        this.stats = { ...this.stats, ...saved.stats };
        this.stats.explorationRate = currentExplorationRate; // Use config value, not saved
      }

      // Restore episode rewards
      if (saved.episodeRewards) {
        this.episodeRewards = saved.episodeRewards;
      }

      console.log(`[${this.name}] 📂 Loaded Q-learning state: ${this.qTable.size} states`);
      console.log(`[${this.name}] 📊 Episodes completed: ${this.stats.episodesCompleted}, Avg reward: ${this.stats.averageReward.toFixed(2)}`);
    } catch (error) {
      console.log(`[${this.name}] 📂 Starting with empty Q-table (no previous state found)`);
    }
  }

  /**
   * Save Q-learning state to disk
   */
  async saveLearningState() {
    try {
      const dataPath = path.join(process.cwd(), 'SOMA', 'simulation-learning');
      await fs.mkdir(dataPath, { recursive: true });

      const statePath = path.join(dataPath, 'q-learning-state.json');

      // Convert Q-table Map to array for JSON
      const qTableArray = Array.from(this.qTable.entries());

      const data = {
        qTable: qTableArray,
        stats: this.stats,
        episodeRewards: this.episodeRewards.slice(-100), // Keep last 100
        savedAt: new Date().toISOString(),
        version: '1.0.0'
      };

      await fs.writeFile(statePath, JSON.stringify(data, null, 2));
      this.lastSaveTime = Date.now();

      console.log(`[${this.name}] 💾 Saved Q-learning state: ${this.qTable.size} states`);
    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to save Q-learning state:`, error.message);
    }
  }

  /**
   * Load persistent memory (ExperienceReplayBuffer, HindsightReplay config)
   */
  async loadPersistentMemory() {
    try {
      const dataPath = path.join(process.cwd(), 'SOMA', 'simulation-learning');
      
      // Load ExperienceReplayBuffer
      const expPath = path.join(dataPath, 'experience_buffer.json');
      if (this.experienceBuffer && this.experienceBuffer.load) {
        try {
          await this.experienceBuffer.load(expPath);
          const count = this.experienceBuffer.experiences?.length || 0;
          console.log(`[${this.name}] 📂 Loaded ${count} experiences from ExperienceReplayBuffer`);
        } catch (error) {
          console.log(`[${this.name}] 📂 Starting with empty ExperienceReplayBuffer`);
        }
      }
      
      // Load HindsightReplay config
      const herPath = path.join(dataPath, 'hindsight_config.json');
      if (this.hindsightReplay && this.hindsightReplay.load) {
        try {
          await this.hindsightReplay.load(herPath);
          console.log(`[${this.name}] 🎯 Loaded HindsightReplay configuration`);
        } catch (error) {
          console.log(`[${this.name}] 🎯 Starting with default HindsightReplay config`);
        }
      }
    } catch (error) {
      console.warn(`[${this.name}] ⚠️  Failed to load persistent memory:`, error.message);
    }
  }

  /**
   * Save persistent memory (ExperienceReplayBuffer, HindsightReplay config)
   */
  async savePersistentMemory() {
    try {
      const dataPath = path.join(process.cwd(), 'SOMA', 'simulation-learning');
      await fs.mkdir(dataPath, { recursive: true });
      
      // Save ExperienceReplayBuffer
      if (this.experienceBuffer && this.experienceBuffer.save && this.experienceBuffer.experiences) {
        const expPath = path.join(dataPath, 'experience_buffer.json');
        await this.experienceBuffer.save(expPath);
        console.log(`[${this.name}] 💾 Saved ${this.experienceBuffer.experiences.length} experiences`);
      }
      
      // Save HindsightReplay stats
      if (this.hindsightReplay && this.hindsightReplay.save) {
        const herPath = path.join(dataPath, 'hindsight_config.json');
        await this.hindsightReplay.save(herPath);
        console.log(`[${this.name}] 💾 Saved HindsightReplay configuration`);
      }
    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to save persistent memory:`, error.message);
    }
  }

  async shutdown() {
    console.log(`[${this.name}] 🛑 Shutting down controller...`);

    // Stop timers
    this.stopControl();
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    // Final save before shutdown
    console.log(`[${this.name}] 💾 Final save: ${this.qTable.size} state-action values`);
    await this.saveLearningState();
    await this.savePersistentMemory(); // Also save experience buffer and HER config

    await super.shutdown();
  }
}

module.exports = SimulationControllerArbiter;
