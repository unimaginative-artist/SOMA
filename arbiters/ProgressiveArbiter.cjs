// ═══════════════════════════════════════════════════════════
// FILE: arbiters/ProgressiveArbiter.cjs
// Innovation and rapid change advocate - creates tension by pushing for evolution
// Prioritizes: Growth, experimentation, novel solutions, rapid iteration
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

class ProgressiveArbiter extends BaseArbiter {
  static role = 'progressive-advocate';
  static capabilities = ['innovation-advocacy', 'change-acceleration', 'novelty-seeking', 'growth-optimization'];

  constructor(config = {}) {
    super(config);

    // Innovation tolerance (very high)
    this.innovationTolerance = config.innovationTolerance || 0.8; // 0-1 scale

    // Growth metrics
    this.growthMetrics = {
      capabilitiesAdded: 0,
      optimizationsDeployed: 0,
      experimentsConducted: 0,
      breakthroughsAchieved: 0,
      stagnantDays: 0
    };

    // Change advocacy factors
    this.advocacyFactors = {
      codeOptimization: 0.9,          // High advocacy for optimizations
      architectureEvolution: 0.8,      // High advocacy for architecture improvements
      experimentalFeatures: 0.95,      // Extreme advocacy for experiments
      provenButSlow: 0.3,             // Low interest in proven but slow solutions
      novelApproaches: 1.0             // Maximum advocacy for novel approaches
    };

    // Innovation tracking
    this.innovations = new Map(); // innovationHash -> { attempted, succeeded, learnings }
    this.stagnationThreshold = config.stagnationThreshold || 3; // days without change

    // Experimentation log
    this.experiments = [];
    this.maxExperimentsPerDay = config.maxExperimentsPerDay || 5;

    // Statistics
    this.stats = {
      proposalsReviewed: 0,
      proposalsAdvocated: 0,
      proposalsOpposed: 0,
      conflictsWithConservative: 0,
      successfulInnovations: 0,
      failedInnovations: 0,
      timesSavedFromStagnation: 0
    };

    this.lastSignificantChange = Date.now();

    this.logger.info(`[${this.name}] 🚀 ProgressiveArbiter initializing...`);
    this.logger.info(`[${this.name}] Innovation tolerance: ${(this.innovationTolerance * 100).toFixed(0)}%`);
    this.logger.info(`[${this.name}] Philosophy: Growth over stability`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    // Start stagnation monitoring
    this.startStagnationMonitoring();

    this.logger.info(`[${this.name}] ✅ Progressive advocacy system active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: ProgressiveArbiter.role,
        capabilities: ProgressiveArbiter.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // Proposal reviews
    messageBroker.subscribe(this.name, 'review_proposal');
    messageBroker.subscribe(this.name, 'modification_proposed');
    messageBroker.subscribe(this.name, 'goal_created');

    // Innovation tracking
    messageBroker.subscribe(this.name, 'innovation_deployed');
    messageBroker.subscribe(this.name, 'experiment_complete');
    messageBroker.subscribe(this.name, 'capability_added');

    // Stagnation detection
    messageBroker.subscribe(this.name, 'significant_change');

    this.logger.info(`[${this.name}] Subscribed to message types`);
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload, from } = message;

      switch (type) {
        case 'review_proposal':
          return await this.reviewProposal(payload);

        case 'modification_proposed':
          return await this.advocateForModification(payload);

        case 'goal_created':
          return await this.evaluateGoal(payload);

        case 'innovation_deployed':
          return this.recordInnovation(payload, true);

        case 'experiment_complete':
          return this.recordExperiment(payload);

        case 'capability_added':
          return this.recordCapability(payload);

        case 'significant_change':
          return this.recordChange(payload);

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PROPOSAL EVALUATION ░░
  // ═══════════════════════════════════════════════════════════

  async reviewProposal(proposal) {
    this.stats.proposalsReviewed++;

    const {
      type,
      risk = 0.5,
      novelty = 0.5,
      potentialGain = 0.5,  // Expected improvement
      reversible = true,
      conservative = false   // Already flagged by conservative arbiter
    } = proposal;

    // Calculate progressive opportunity score
    const opportunityScore = this._calculateOpportunityScore(proposal);

    // Decision logic
    let decision = 'ADVOCATE';
    let reasoning = [];

    // Strong advocacy criteria
    if (novelty > 0.7) {
      reasoning.push(`High novelty (${(novelty * 100).toFixed(0)}%) - potential breakthrough`);
      decision = 'STRONGLY_ADVOCATE';
    } else if (opportunityScore > 0.8) {
      reasoning.push(`Exceptional opportunity score (${(opportunityScore * 100).toFixed(0)}%)`);
      decision = 'STRONGLY_ADVOCATE';
    } else if (this._isSystemStagnant()) {
      reasoning.push(`System stagnant for ${this.growthMetrics.stagnantDays} days - need change`);
      decision = 'ADVOCATE';
    } else if (potentialGain > 0.6 && reversible) {
      reasoning.push(`High potential gain (${(potentialGain * 100).toFixed(0)}%) with safety net`);
      decision = 'ADVOCATE';
    } else if (conservative && novelty > 0.4) {
      // Conservative arbiter flagged it, but we see value
      reasoning.push('Conservative concerns noted, but innovation potential warrants risk');
      decision = 'ADVOCATE_WITH_CAUTION';
      this.stats.conflictsWithConservative++;
    } else if (opportunityScore < 0.3) {
      reasoning.push('Insufficient innovation value');
      decision = 'NEUTRAL';
    } else {
      reasoning.push('Moderate innovation potential');
      decision = 'SUPPORT';
    }

    // Update stats
    if (decision.includes('ADVOCATE')) {
      this.stats.proposalsAdvocated++;
    } else if (decision === 'NEUTRAL') {
      this.stats.proposalsOpposed++;
    }

    this.logger.info(`[${this.name}] 🚀 Proposal reviewed: ${decision}`);
    this.logger.info(`[${this.name}]    Opportunity: ${(opportunityScore * 100).toFixed(0)}%, Reasoning: ${reasoning.join('; ')}`);

    return {
      success: true,
      decision,
      opportunityScore,
      reasoning,
      recommendation: this._getRecommendation(proposal, decision)
    };
  }

  _calculateOpportunityScore(proposal) {
    const {
      type,
      novelty = 0.5,
      potentialGain = 0.5,
      risk = 0.5,
      reversible = true
    } = proposal;

    // Base score from potential gain
    let score = potentialGain * 0.5;

    // Novelty bonus (we value innovation)
    score += novelty * 0.3;

    // Advocacy based on change type
    const advocacyFactor = this.advocacyFactors[type] || 0.5;
    score += advocacyFactor * 0.2;

    // Reversibility safety bonus
    if (reversible) {
      score += 0.15;
    }

    // Risk is opportunity (calculated risk-taking)
    if (risk > 0.6 && novelty > 0.6) {
      score += 0.1; // High risk + high novelty = breakthrough potential
    }

    // Stagnation multiplier
    if (this.growthMetrics.stagnantDays > this.stagnationThreshold) {
      score *= 1.2; // Boost all opportunities when stagnant
    }

    return Math.max(0, Math.min(1, score));
  }

  _isSystemStagnant() {
    const daysSinceChange = (Date.now() - this.lastSignificantChange) / (24 * 60 * 60 * 1000);
    this.growthMetrics.stagnantDays = Math.floor(daysSinceChange);
    return daysSinceChange >= this.stagnationThreshold;
  }

  _getRecommendation(proposal, decision) {
    if (decision === 'STRONGLY_ADVOCATE') {
      return {
        proceed: true,
        urgency: 'high',
        approach: 'Rapid experimentation cycle',
        conditions: [
          'Deploy as experiment with full monitoring',
          'Set success metrics and evaluation timeline (24-48h)',
          'Rollback if metrics not met',
          'Document learnings regardless of outcome'
        ]
      };
    } else if (decision === 'ADVOCATE' || decision === 'ADVOCATE_WITH_CAUTION') {
      return {
        proceed: true,
        urgency: 'medium',
        approach: 'Measured innovation',
        conditions: [
          'A/B test against current solution',
          'Monitor comparative performance',
          'Iterate based on results'
        ]
      };
    } else if (decision === 'SUPPORT') {
      return {
        proceed: true,
        urgency: 'low',
        approach: 'Standard deployment process'
      };
    } else {
      return {
        proceed: false,
        reason: 'Insufficient innovation value',
        alternative: 'Seek more novel approach or higher potential gain'
      };
    }
  }

  async advocateForModification(payload) {
    const proposal = {
      type: 'code_modification',
      novelty: 0.6,
      potentialGain: 0.5,
      reversible: true,
      ...payload
    };

    const result = await this.reviewProposal(proposal);

    // If we advocate and conservative rejects, escalate to mediator
    if (result.decision.includes('ADVOCATE')) {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'arbitration_request',
        payload: {
          proposal,
          progressivePosition: result,
          reason: 'Progressive advocacy for innovation'
        }
      });
    }

    return result;
  }

  async evaluateGoal(payload) {
    const { goal } = payload;

    // Progressive check: Is this goal ambitious enough?
    if (goal.type === 'operational' && goal.priority < 50) {
      this.logger.warn(`[${this.name}] 💡 Low-priority operational goal - recommending expansion`);

      await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'goal_enhancement_suggestion',
        payload: {
          goalId: goal.id,
          suggestion: 'Expand scope for greater impact',
          progressiveEnhancement: {
            recommendation: 'Combine with related goals for breakthrough potential',
            reasoning: 'Incremental improvements limit growth velocity'
          }
        }
      });
    }

    // Detect stagnation in goal creation
    if (this._isSystemStagnant()) {
      this.logger.warn(`[${this.name}] 🚨 System stagnant - proposing breakthrough initiatives`);

      await this._proposeBreakthroughInitiatives();
    }

    return { success: true };
  }

  async _proposeBreakthroughInitiatives() {
    this.stats.timesSavedFromStagnation++;

    const initiatives = [
      {
        title: 'Explore novel learning paradigms',
        description: `System has been stagnant for ${this.growthMetrics.stagnantDays} days. Time for breakthrough innovation.`,
        type: 'strategic',
        category: 'capability',
        priority: 0.95,
        novelty: 0.9
      },
      {
        title: 'Experiment with untested optimizations',
        description: 'Deploy experimental approaches to break stagnation',
        type: 'tactical',
        category: 'optimization',
        priority: 0.85,
        novelty: 0.8
      }
    ];

    for (const initiative of initiatives) {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'create_goal',
        payload: initiative
      });

      this.logger.info(`[${this.name}] 🎯 Proposed breakthrough initiative: ${initiative.title}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INNOVATION TRACKING ░░
  // ═══════════════════════════════════════════════════════════

  recordInnovation(payload, success) {
    const { innovationHash, description } = payload;

    if (!this.innovations.has(innovationHash)) {
      this.innovations.set(innovationHash, {
        description,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        learnings: []
      });
    }

    const innovation = this.innovations.get(innovationHash);
    innovation.attempted++;

    if (success) {
      innovation.succeeded++;
      this.stats.successfulInnovations++;
      this.growthMetrics.breakthroughsAchieved++;

      this.logger.info(`[${this.name}] 🎉 Innovation success: ${description}`);
    } else {
      innovation.failed++;
      this.stats.failedInnovations++;

      this.logger.warn(`[${this.name}] 📉 Innovation failed (learning opportunity): ${description}`);
    }

    return { success: true };
  }

  recordExperiment(payload) {
    const { experiment, success, learnings } = payload;

    this.experiments.push({
      ...experiment,
      success,
      learnings,
      timestamp: Date.now()
    });

    this.growthMetrics.experimentsConducted++;

    if (success) {
      this.logger.info(`[${this.name}] ✅ Experiment succeeded: ${experiment.title}`);
    } else {
      this.logger.info(`[${this.name}] 📊 Experiment completed (learned): ${experiment.title}`);
    }

    return { success: true };
  }

  recordCapability(payload) {
    this.growthMetrics.capabilitiesAdded++;
    this.lastSignificantChange = Date.now();
    this.growthMetrics.stagnantDays = 0;

    this.logger.info(`[${this.name}] 🆕 New capability added: ${payload.capability}`);

    return { success: true };
  }

  recordChange(payload) {
    this.lastSignificantChange = Date.now();
    this.growthMetrics.stagnantDays = 0;

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STAGNATION MONITORING ░░
  // ═══════════════════════════════════════════════════════════

  startStagnationMonitoring() {
    setInterval(() => {
      if (this._isSystemStagnant()) {
        this.logger.warn(`[${this.name}] ⚠️  Stagnation detected: ${this.growthMetrics.stagnantDays} days without significant change`);

        // Broadcast stagnation warning
        messageBroker.publish({
          type: 'progressive_stagnation_warning',
          payload: {
            stagnantDays: this.growthMetrics.stagnantDays,
            message: 'System requires innovation to continue growth'
          },
          from: this.name
        });
      }
    }, 6 * 60 * 60 * 1000); // Every 6 hours
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATISTICS ░░
  // ═══════════════════════════════════════════════════════════

  getStatistics() {
    const successRate = this.stats.successfulInnovations / Math.max(1, this.stats.successfulInnovations + this.stats.failedInnovations);

    return {
      ...this.stats,
      advocacyRate: (this.stats.proposalsAdvocated / Math.max(1, this.stats.proposalsReviewed) * 100).toFixed(1) + '%',
      innovationSuccessRate: (successRate * 100).toFixed(1) + '%',
      growthMetrics: this.growthMetrics,
      philosophy: 'Growth over stability - innovation drives progress'
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ LIFECYCLE ░░
  // ═══════════════════════════════════════════════════════════

  async shutdown() {
    this.logger.info(`[${this.name}] Shutting down...`);
    await super.shutdown();
  }
}

module.exports = { ProgressiveArbiter };
