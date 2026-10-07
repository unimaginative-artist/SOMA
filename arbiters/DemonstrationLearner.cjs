// ════════════════════════════════════════════════════════════════════════════
// DemonstrationLearner - Imitation Learning from User Demonstrations
// ════════════════════════════════════════════════════════════════════════════
// Learns from user gameplay through behavioral cloning and demonstration analysis
// - Records state-action pairs from user demonstrations
// - Builds a simple policy network for imitation
// - Provides action recommendations based on learned behavior
// - Analyzes successful strategies from demonstrations
// ════════════════════════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');

class DemonstrationLearner extends BaseArbiter {
  constructor(config = {}) {
    super(config);

    // Demonstration storage
    this.demonstrations = [];
    this.demonstrationCount = 0;

    // Simple behavioral cloning model (state → action mapping)
    this.policyMap = new Map(); // Maps state signatures to action distributions
    this.stateActionCounts = new Map(); // Count how often actions are taken in similar states

    // Learning statistics
    this.stats = {
      totalDemonstrations: 0,
      totalStateActionPairs: 0,
      successfulDemonstrations: 0,
      averageScore: 0,
      policySize: 0
    };

    console.log(`[${this.name}] 🧠 Demonstration Learner initializing...`);
  }

  async initialize() {
    await super.initialize();

    // Subscribe to demonstration events from SimulationArbiter
    if (this.broker) {
      await this.broker.subscribe('simulation_demonstration', this.learnFromDemonstration.bind(this));
      console.log(`[${this.name}] 📡 Subscribed to simulation demonstrations`);
    }

    console.log(`[${this.name}] ✅ Ready to learn from user!`);
    return { success: true };
  }

  /**
   * Learn from a user demonstration
   */
  async learnFromDemonstration(message) {
    const { demonstration, count, timestamp } = message;

    if (!demonstration || !demonstration.stateActionPairs) {
      console.warn(`[${this.name}] ⚠️  Invalid demonstration received`);
      return;
    }

    this.demonstrations.push(demonstration);
    this.demonstrationCount = count || this.demonstrations.length;

    console.log(`[${this.name}] 📝 Learning from demonstration #${this.demonstrationCount}`);
    console.log(`[${this.name}]    - Actions: ${demonstration.stateActionPairs.length}`);
    console.log(`[${this.name}]    - Score: ${Math.floor(demonstration.finalScore)}`);
    console.log(`[${this.name}]    - Success: ${demonstration.success ? '✅' : '❌'}`);

    // Extract patterns from this demonstration
    for (const pair of demonstration.stateActionPairs) {
      const { state, action } = pair;

      if (!state || !action) continue;

      // Create a state signature (simplified for now)
      const stateSignature = this._createStateSignature(state);

      // Record this state-action pair
      if (!this.stateActionCounts.has(stateSignature)) {
        this.stateActionCounts.set(stateSignature, []);
      }

      this.stateActionCounts.get(stateSignature).push({
        action: action,
        success: demonstration.success,
        score: demonstration.finalScore,
        timestamp: timestamp
      });

      this.stats.totalStateActionPairs++;
    }

    // Update statistics
    this.stats.totalDemonstrations++;
    if (demonstration.success) {
      this.stats.successfulDemonstrations++;
    }

    const totalScore = this.demonstrations.reduce((sum, d) => sum + d.finalScore, 0);
    this.stats.averageScore = totalScore / this.demonstrations.length;
    this.stats.policySize = this.stateActionCounts.size;

    // Build/update policy from all demonstrations
    this._buildPolicy();

    console.log(`[${this.name}] 🧠 Policy updated: ${this.stats.policySize} unique states learned`);

    // Emit learning progress
    if (this.broker) {
      this.broker.publish('demonstration_learning_update', {
        stats: this.stats,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Create a simple state signature for state comparison
   * (In a real ML system, this would be a neural network feature extraction)
   */
  _createStateSignature(state) {
    if (!state || !state.agent || !state.target) {
      return 'invalid';
    }

    // Discretize continuous state into buckets for simple pattern matching
    const agentX = Math.floor(state.agent.position.x / 50) * 50;
    const agentY = Math.floor(state.agent.position.y / 50) * 50;
    const targetX = Math.floor(state.target.position.x / 50) * 50;
    const targetY = Math.floor(state.target.position.y / 50) * 50;

    const velX = Math.sign(state.agent.velocity.x);
    const velY = Math.sign(state.agent.velocity.y);

    // Direction to target
    const dx = targetX - agentX;
    const dy = targetY - agentY;
    const directionBucket = this._getDirectionBucket(dx, dy);

    return `pos:${agentX},${agentY}|vel:${velX},${velY}|dir:${directionBucket}`;
  }

  _getDirectionBucket(dx, dy) {
    const angle = Math.atan2(dy, dx);
    const bucket = Math.floor((angle + Math.PI) / (Math.PI / 4)); // 8 directional buckets
    return bucket;
  }

  /**
   * Build policy from accumulated demonstrations
   */
  _buildPolicy() {
    this.policyMap.clear();

    // For each state signature, find the most common action from successful demonstrations
    for (const [stateSignature, actions] of this.stateActionCounts.entries()) {
      // Weight successful demonstrations more heavily
      const successfulActions = actions.filter(a => a.success);
      const actionsToUse = successfulActions.length > 0 ? successfulActions : actions;

      if (actionsToUse.length === 0) continue;

      // Average the actions
      const avgForceX = actionsToUse.reduce((sum, a) => sum + a.action.forceX, 0) / actionsToUse.length;
      const avgForceY = actionsToUse.reduce((sum, a) => sum + a.action.forceY, 0) / actionsToUse.length;

      this.policyMap.set(stateSignature, {
        forceX: avgForceX,
        forceY: avgForceY,
        confidence: Math.min(actionsToUse.length / 10, 1.0), // More examples = higher confidence
        sampleCount: actionsToUse.length
      });
    }
  }

  /**
   * Get recommended action for a given state (used by SimulationControllerArbiter)
   */
  getRecommendedAction(state) {
    if (!state) return null;

    const stateSignature = this._createStateSignature(state);
    const policy = this.policyMap.get(stateSignature);

    if (policy) {
      return {
        forceX: policy.forceX,
        forceY: policy.forceY,
        confidence: policy.confidence,
        source: 'demonstration',
        samples: policy.sampleCount
      };
    }

    return null;
  }

  /**
   * Get learning statistics
   */
  getStats() {
    return {
      ...this.stats,
      demonstrationCount: this.demonstrationCount,
      successRate: this.stats.totalDemonstrations > 0
        ? (this.stats.successfulDemonstrations / this.stats.totalDemonstrations)
        : 0
    };
  }

  /**
   * Get all demonstrations (for analysis)
   */
  getDemonstrations() {
    return this.demonstrations.map(d => ({
      episode: d.episode,
      startTime: d.startTime,
      endTime: d.endTime,
      actionCount: d.stateActionPairs.length,
      finalScore: d.finalScore,
      success: d.success
    }));
  }

  async shutdown() {
    console.log(`[${this.name}] 🛑 Shutting down...`);
    console.log(`[${this.name}]    Learned from ${this.stats.totalDemonstrations} demonstrations`);
    console.log(`[${this.name}]    Policy size: ${this.stats.policySize} states`);
    await super.shutdown();
  }
}

module.exports = { DemonstrationLearner };
