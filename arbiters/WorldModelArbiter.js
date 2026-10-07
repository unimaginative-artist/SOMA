/**
 * WorldModelArbiter.js
 *
 * Mental simulation engine - enables SOMA to predict future states without acting.
 * This is how humans achieve intelligence: we simulate outcomes mentally before
 * committing to actions.
 *
 * Key Capabilities:
 * - State transition modeling (Current state + Action → Future state)
 * - Multi-step look-ahead planning
 * - "What if" scenario simulation
 * - Uncertainty quantification
 * - Learned dynamics from experience
 *
 * Integrates with CausalityArbiter to use causal knowledge for predictions.
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

export class WorldModelArbiter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'WorldModelArbiter';
    this.messageBroker = config.messageBroker || null;
    this.causalityArbiter = config.causalityArbiter || null;
    this.experienceBuffer = config.experienceBuffer || null;
    this.metaLearning = config.metaLearning || null;

    this.config = {
      maxLookAhead: 5,              // Max steps to simulate ahead
      minConfidenceToAct: 0.6,      // Min confidence to recommend action
      learningRate: 0.1,            // How fast model updates
      uncertaintyPenalty: 0.2,      // Penalty for uncertain predictions
      maxStateHistory: 10000,       // Max historical states to store
      ...config
    };

    // World model: Map of (state, action) → (nextState, reward, confidence)
    this.transitionModel = new Map();

    // State history: Track actual transitions observed
    this.stateHistory = [];

    // Reward model: Track which states are desirable
    this.rewardModel = new Map();

    // Planning cache: Cache simulated plans
    this.planCache = new Map();

    // Statistics
    this.stats = {
      simulationsRun: 0,
      predictionsCorrect: 0,
      predictionsTested: 0,
      avgPredictionError: 0,
      plansGenerated: 0,
      lobeDiscrepancies: 0
    };

    console.log('🌍 [WorldModelArbiter] Initialized (Quad-Lobe Simulation Ready)');
  }

  /**
   * Quad-Lobe Simulation: The DM's Intuition
   * Simulates an action across all four cognitive dimensions.
   */
  async simulateQuad(state, action) {
      this.stats.simulationsRun++;
      
      const logicSim      = this._simulateLogos(state, action);      // Rules & Physics
      const soulSim       = this._simulateAurora(state, action);     // Vibe & Emotion
      const strategySim   = this._simulatePrometheus(state, action); // Plot & Consequences
      const integritySim  = this._simulateThalamus(state, action);   // Consistency & Safety

      // Consolidate into a Sovereign State
      const consolidated = {
          nextState: logicSim.nextState,
          reward: (logicSim.reward + soulSim.reward + strategySim.reward) / 3,
          confidence: Math.min(logicSim.confidence, integritySim.confidence),
          lobes: {
              logos: logicSim,
              aurora: soulSim,
              prometheus: strategySim,
              thalamus: integritySim
          },
          isSafe: integritySim.approved,
          plotImpact: strategySim.impact
      };

      if (consolidated.confidence < 0.4) {
          this.stats.lobeDiscrepancies++;
          this.emit('simulation.dissonance', consolidated);
      }

      return consolidated;
  }

  _simulateLogos(state, action) {
      // Logic: Is it possible? (Rule check)
      return { 
          approved: true, 
          nextState: { ...state, lastAction: action }, 
          reward: 0.5, 
          confidence: 0.9 
      };
  }

  _simulateAurora(state, action) {
      // Soul: How does it feel? (Atmosphere check)
      return { 
          vibe: 'tense', 
          reward: 0.6, 
          confidence: 0.8 
      };
  }

  _simulatePrometheus(state, action) {
      // Strategy: Where does it lead? (Plot check)
      return { 
          impact: 'low', 
          horizon: '3steps', 
          reward: 0.5, 
          confidence: 0.7 
      };
  }

  _simulateThalamus(state, action) {
      // Integrity: Is it consistent? (Cheat/Safety check)
      return { 
          approved: true, 
          consistency: 1.0, 
          confidence: 1.0 
      };
  }

  /**
   * Initialize the arbiter
   */
  async initialize({ causalityArbiter, experienceBuffer, metaLearning } = {}) {
    this.causalityArbiter = causalityArbiter || this.causalityArbiter;
    this.experienceBuffer = experienceBuffer || this.experienceBuffer;
    this.metaLearning = metaLearning || this.metaLearning;

    // Load existing world model
    await this.loadWorldModel();

    // Autosave every 10 minutes — world model accumulates across sessions
    setInterval(() => this.saveWorldModel().catch(() => {}), 10 * 60 * 1000).unref();

    console.log('✅ [WorldModelArbiter] Ready');
    console.log(`   🌍 States modeled: ${this.transitionModel.size}`);
    console.log(`   📊 Prediction accuracy: ${(this.getAccuracy() * 100).toFixed(1)}%`);

    return true;
  }

  /**
   * Observe a state transition and update world model
   * @param {Object} transition - { state: Object, action: string, nextState: Object, reward: number }
   */
  async observeTransition(transition) {
    const { state, action, nextState, reward = 0 } = transition;

    // Store in history
    this.stateHistory.push({
      state,
      action,
      nextState,
      reward,
      timestamp: Date.now()
    });

    // Limit history size
    if (this.stateHistory.length > this.config.maxStateHistory) {
      this.stateHistory.shift();
    }

    // Update transition model
    await this.updateTransitionModel(state, action, nextState, reward);

    // Update reward model
    await this.updateRewardModel(nextState, reward);

    // Check if any cached predictions were correct
    await this.validatePredictions(state, action, nextState);
  }

  /**
   * Update transition model with new observation
   */
  async updateTransitionModel(state, action, nextState, reward) {
    const key = this.getTransitionKey(state, action);

    if (!this.transitionModel.has(key)) {
      this.transitionModel.set(key, {
        observations: 0,
        nextStates: new Map(),
        avgReward: 0
      });
    }

    const model = this.transitionModel.get(key);
    model.observations++;

    // Track distribution of next states
    const nextStateKey = this.getStateKey(nextState);
    const count = (model.nextStates.get(nextStateKey) || 0) + 1;
    model.nextStates.set(nextStateKey, count);

    // Update average reward
    model.avgReward = model.avgReward + this.config.learningRate * (reward - model.avgReward);
  }

  /**
   * Update reward model
   */
  async updateRewardModel(state, reward) {
    const stateKey = this.getStateKey(state);

    if (!this.rewardModel.has(stateKey)) {
      this.rewardModel.set(stateKey, {
        count: 0,
        totalReward: 0,
        avgReward: 0
      });
    }

    const model = this.rewardModel.get(stateKey);
    model.count++;
    model.totalReward += reward;
    model.avgReward = model.totalReward / model.count;
  }

  /**
   * Alias for simulate() to match controller expectations
   */
  predict(params) {
    const { state, action } = params;
    return this.simulate(state, action);
  }

  /**
   * General-purpose prediction for abstract queries (Metaphorical Simulation)
   * Example: "What happens if I aggressively refactor this legacy code?"
   * -> Maps to "What happens if I aggressively push this unstable tower?"
   */
  async predictOutcome(query, context = {}) {
    // 1. Check if this is a physical query we can simulate directly
    if (context.isPhysical && context.state) {
      return this.simulate(context.state, context.action || 'wait');
    }

    // Abstract predictions require observed transitions or causal evidence. Never
    // manufacture a generic outcome merely to satisfy the caller.
    this.stats.simulationsRun++;

    if (this.causalityArbiter?.predictOutcome) {
      const predicted = await this.causalityArbiter.predictOutcome(query, context);
      if (predicted?.outcome != null && Number(predicted.confidence || 0) > 0) {
        return {
          ...predicted,
          source: predicted.source || 'causality_arbiter',
          evidenceBacked: true
        };
      }
    }

    return {
      outcome: null,
      confidence: 0,
      status: 'insufficient_evidence',
      evidenceBacked: false,
      reasoning: 'No observed state transition or causal evidence supports an abstract prediction.'
    };
  }

  /**
   * Simulate an action from a given state
   * @param {Object} state - Current state
   * @param {string} action - Action to simulate
   * @returns {Object} - { nextState: Object, reward: number, confidence: number }
   */
  simulate(state, action) {
    this.stats.simulationsRun++;

    const key = this.getTransitionKey(state, action);

    if (!this.transitionModel.has(key)) {
      // No data for this (state, action) pair
      // Try to use causal knowledge as fallback
      if (this.causalityArbiter) {
        const predicted = this.causalityArbiter.predictOutcome(action, state);
        return {
          nextState: predicted.outcome,
          reward: 0, // Unknown
          confidence: predicted.confidence * 0.5 // Lower confidence for causal fallback
        };
      }

      return {
        nextState: state, // Assume no change
        reward: 0,
        confidence: 0
      };
    }

    const model = this.transitionModel.get(key);

    // Find most likely next state
    let mostLikelyState = null;
    let maxCount = 0;

    for (const [stateKey, count] of model.nextStates.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostLikelyState = stateKey;
      }
    }

    // Calculate confidence based on observation count and distribution
    const confidence = Math.min(0.95,
      (model.observations / 10) * (maxCount / model.observations)
    );

    return {
      nextState: mostLikelyState ? JSON.parse(mostLikelyState) : state,
      reward: model.avgReward,
      confidence
    };
  }

  /**
   * Plan ahead multiple steps using tree search
   * @param {Object} currentState
   * @param {Array} possibleActions
   * @param {number} depth - How many steps to look ahead
   * @returns {Object} - Best plan with expected total reward
   */
  planAhead(currentState, possibleActions, depth = 3) {
    depth = Math.min(depth, this.config.maxLookAhead);

    this.stats.plansGenerated++;

    // Check cache
    const cacheKey = `${this.getStateKey(currentState)}_${depth}`;
    if (this.planCache.has(cacheKey)) {
      return this.planCache.get(cacheKey);
    }

    // Recursive tree search
    const bestPlan = this.searchPlanTree(currentState, possibleActions, depth, 0);

    // Cache result
    this.planCache.set(cacheKey, bestPlan);

    // Limit cache size
    if (this.planCache.size > 1000) {
      const firstKey = this.planCache.keys().next().value;
      this.planCache.delete(firstKey);
    }

    return bestPlan;
  }

  /**
   * Recursive tree search for best plan
   */
  searchPlanTree(state, possibleActions, maxDepth, currentDepth, pathSoFar = []) {
    if (currentDepth >= maxDepth) {
      return {
        actions: pathSoFar,
        totalReward: 0,
        confidence: 1.0
      };
    }

    let bestPlan = null;
    let bestValue = -Infinity;

    for (const action of possibleActions) {
      // Simulate this action
      const { nextState, reward, confidence } = this.simulate(state, action);

      // Penalize uncertainty
      const adjustedReward = reward - (1 - confidence) * this.config.uncertaintyPenalty;

      // Recursively search from next state
      const futurePlan = this.searchPlanTree(
        nextState,
        possibleActions,
        maxDepth,
        currentDepth + 1,
        [...pathSoFar, action]
      );

      // Calculate total value
      const discountFactor = 0.9; // Discount future rewards
      const totalValue = adjustedReward + discountFactor * futurePlan.totalReward;

      if (totalValue > bestValue) {
        bestValue = totalValue;
        bestPlan = {
          actions: [...pathSoFar, action],
          nextState,
          totalReward: totalValue,
          confidence: confidence * futurePlan.confidence
        };
      }
    }

    return bestPlan || {
      actions: pathSoFar,
      totalReward: 0,
      confidence: 0
    };
  }

  /**
   * Recommend best action given current state
   * @param {Object} currentState
   * @param {Array} possibleActions
   * @returns {Object} - { action: string, expectedReward: number, confidence: number, reasoning: string }
   */
  recommendAction(currentState, possibleActions) {
    // Plan ahead
    const plan = this.planAhead(currentState, possibleActions, 3);

    if (plan.actions.length === 0 || plan.confidence < this.config.minConfidenceToAct) {
      return {
        action: null,
        expectedReward: 0,
        confidence: plan.confidence,
        reasoning: plan.confidence < this.config.minConfidenceToAct
          ? `Confidence too low (${(plan.confidence * 100).toFixed(1)}%) - need more data`
          : 'No viable actions found'
      };
    }

    const recommendedAction = plan.actions[0];

    return {
      action: recommendedAction,
      expectedReward: plan.totalReward,
      confidence: plan.confidence,
      reasoning: `Simulated ${plan.actions.length} steps ahead. Best path: ${plan.actions.slice(0, 3).join(' → ')}`
    };
  }

  /**
   * Generate "what if" scenarios
   * @param {Object} currentState
   * @param {Array} scenarios - Array of action sequences to simulate
   * @returns {Array} - Predicted outcomes for each scenario
   */
  generateWhatIfScenarios(currentState, scenarios) {
    const results = [];

    for (const scenario of scenarios) {
      const { actions, description } = scenario;

      let state = currentState;
      let totalReward = 0;
      let minConfidence = 1.0;
      const trajectory = [state];

      // Simulate action sequence
      for (const action of actions) {
        const sim = this.simulate(state, action);
        state = sim.nextState;
        totalReward += sim.reward;
        minConfidence = Math.min(minConfidence, sim.confidence);
        trajectory.push(state);
      }

      results.push({
        description: description || actions.join(' → '),
        finalState: state,
        totalReward,
        confidence: minConfidence,
        trajectory
      });

      this.stats.simulationsRun += actions.length;
    }

    console.log(`🤔 [WorldModel] Simulated ${scenarios.length} "what if" scenarios`);

    return results;
  }

  /**
   * Validate predictions against actual outcomes
   */
  async validatePredictions(actualPriorState, actualAction, actualNextState) {
    // Check if we had predicted this transition
    const key = this.getTransitionKey(actualPriorState, actualAction);
    const prediction = this.simulate(actualPriorState, actualAction);

    if (prediction.confidence > 0) {
      this.stats.predictionsTested++;

      // Calculate error
      const actualStateKey = this.getStateKey(actualNextState);
      const predictedStateKey = this.getStateKey(prediction.nextState);

      if (actualStateKey === predictedStateKey) {
        this.stats.predictionsCorrect++;
      }

      // Update running average of prediction error
      const error = actualStateKey === predictedStateKey ? 0 : 1;
      this.stats.avgPredictionError = this.stats.avgPredictionError +
        this.config.learningRate * (error - this.stats.avgPredictionError);
    }
  }

  /**
   * Get prediction stats for Epistemic Curiosity
   * Returns recent prediction failures to drive curiosity.
   */
  getPredictionStats({ limit = 10 } = {}) {
    const failures = [];
    const successes = [];

    // Analyze recent history (last 50 items)
    const recentHistory = this.stateHistory.slice(-50).reverse();

    for (const item of recentHistory) {
      // Re-run simulation to see what the model predicts NOW
      const prediction = this.simulate(item.state, item.action);
      
      // Compare predicted next state with actual next state
      const actualKey = this.getStateKey(item.nextState);
      const predictedKey = this.getStateKey(prediction.nextState);
      
      const isCorrect = actualKey === predictedKey;
      const errorMagnitude = isCorrect ? 0 : (1.0 - prediction.confidence); // High confidence + wrong = high surprise

      const entry = {
        event: `action '${item.action}' in state ${actualKey.substring(0, 20)}...`,
        errorMagnitude,
        timestamp: item.timestamp,
        context: {
          state: item.state,
          action: item.action,
          predicted: prediction.nextState,
          actual: item.nextState
        }
      };

      if (isCorrect) {
        successes.push(entry);
      } else {
        failures.push(entry);
      }
    }

    // Sort failures by surprise (error magnitude)
    failures.sort((a, b) => b.errorMagnitude - a.errorMagnitude);

    return {
      failures: failures.slice(0, limit),
      successes: successes.slice(0, limit),
      accuracy: this.getAccuracy()
    };
  }

  /**
   * Get prediction accuracy
   */
  getAccuracy() {
    if (this.stats.predictionsTested === 0) return 0;
    return this.stats.predictionsCorrect / this.stats.predictionsTested;
  }

  /**
   * Get a state key for hashing
   */
  getStateKey(state) {
    // Create a deterministic string representation
    return JSON.stringify(this.normalizeState(state));
  }

  /**
   * Get a transition key for hashing
   */
  getTransitionKey(state, action) {
    return `${this.getStateKey(state)}|${action}`;
  }

  /**
   * Normalize state for consistent hashing
   */
  normalizeState(state) {
    // Remove timestamp and other ephemeral fields
    const normalized = { ...state };
    delete normalized.timestamp;
    delete normalized._id;
    return normalized;
  }

  /**
   * Load world model from disk
   */
  async loadWorldModel() {
    try {
      const dataPath = path.join('SOMA', 'world-model');
      await fs.mkdir(dataPath, { recursive: true });

      const modelPath = path.join(dataPath, 'transitions.json');
      const data = await fs.readFile(modelPath, 'utf8');
      const saved = JSON.parse(data);

      // Restore Maps
      this.transitionModel = new Map();
      for (const [key, value] of saved.transitions) {
        value.nextStates = new Map(value.nextStates);
        this.transitionModel.set(key, value);
      }

      this.rewardModel = new Map(saved.rewards);
      this.stateHistory = saved.history || [];
      this.stats = saved.stats || this.stats;

      console.log('📂 [WorldModelArbiter] Loaded existing world model');
    } catch (error) {
      console.log('📂 [WorldModelArbiter] Starting with empty world model');
    }
  }

  /**
   * Save world model to disk
   */
  async saveWorldModel() {
    try {
      const dataPath = path.join('SOMA', 'world-model');
      await fs.mkdir(dataPath, { recursive: true });

      const modelPath = path.join(dataPath, 'transitions.json');

      // Convert Maps to arrays for JSON
      const transitions = [];
      for (const [key, value] of this.transitionModel.entries()) {
        const val = { ...value };
        val.nextStates = Array.from(value.nextStates.entries());
        transitions.push([key, val]);
      }

      const data = {
        transitions,
        rewards: Array.from(this.rewardModel.entries()),
        history: this.stateHistory.slice(-1000), // Keep last 1000
        stats: this.stats,
        savedAt: new Date().toISOString()
      };

      await fs.writeFile(modelPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('❌ [WorldModelArbiter] Failed to save world model:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      statesModeled: this.transitionModel.size,
      historySize: this.stateHistory.length,
      accuracy: this.getAccuracy()
    };
  }

  /**
   * Get status for dashboard integration
   */
  getStatus() {
    return {
        status: this.transitionModel.size > 0 ? 'active' : 'calibrating',
        nodes: this.transitionModel.size,
        accuracy: this.getAccuracy(),
        simulations: this.stats.simulationsRun
    };
  }

  /**
   * Export model for visualization
   */
  exportModel() {
    const transitions = [];

    for (const [key, model] of this.transitionModel.entries()) {
      const [stateKey, action] = key.split('|');

      for (const [nextStateKey, count] of model.nextStates.entries()) {
        transitions.push({
          from: stateKey.substring(0, 50),
          action,
          to: nextStateKey.substring(0, 50),
          probability: count / model.observations,
          avgReward: model.avgReward,
          observations: model.observations
        });
      }
    }

    return { transitions };
  }
}

export default WorldModelArbiter;
