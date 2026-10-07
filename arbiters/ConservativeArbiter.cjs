// ═══════════════════════════════════════════════════════════
// FILE: arbiters/ConservativeArbiter.cjs
// Stability preservation advocate - creates tension by resisting change
// Prioritizes: Safety, proven solutions, incremental improvements, risk avoidance
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

class ConservativeArbiter extends BaseArbiter {
  static role = 'conservative-advocate';
  static capabilities = ['risk-assessment', 'stability-advocacy', 'change-resistance', 'proven-solutions'];

  constructor(config = {}) {
    super(config);

    // Risk tolerance (very low)
    this.riskTolerance = config.riskTolerance || 0.2; // 0-1 scale

    // Stability metrics
    this.stabilityMetrics = {
      systemUptime: 0,
      lastCrash: null,
      errorRate: 0.0,
      successfulOperations: 0,
      failedOperations: 0
    };

    // Change resistance factors
    this.resistanceFactors = {
      codeModification: 0.8,        // High resistance to code changes
      architectureChange: 0.9,      // Very high resistance to architecture changes
      newDependencies: 0.7,         // High resistance to new dependencies
      experimentalFeatures: 0.95,   // Extreme resistance to experimental features
      provenOptimizations: 0.3      // Low resistance to proven optimizations
    };

    // Proven solutions database
    this.provenSolutions = new Map(); // solutionHash -> { successRate, usageCount, lastUsed }

    // Change log (for risk assessment)
    this.recentChanges = [];
    this.maxChangesInWindow = config.maxChangesInWindow || 10; // Max changes per 24h
    this.changeWindow = 24 * 60 * 60 * 1000; // 24 hours

    // Statistics
    this.stats = {
      proposalsReviewed: 0,
      proposalsApproved: 0,
      proposalsRejected: 0,
      proposalsDeferred: 0,
      conflictsWithProgressive: 0,
      successfulPrevented: 0, // Changes prevented that would have failed
      unnecessaryBlocks: 0     // Changes blocked that would have succeeded
    };

    this.logger.info(`[${this.name}] 🛡️  ConservativeArbiter initializing...`);
    this.logger.info(`[${this.name}] Risk tolerance: ${(this.riskTolerance * 100).toFixed(0)}%`);
    this.logger.info(`[${this.name}] Philosophy: Stability over novelty`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    this.logger.info(`[${this.name}] ✅ Conservative advocacy system active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: ConservativeArbiter.role,
        capabilities: ConservativeArbiter.capabilities
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

    // System health
    messageBroker.subscribe(this.name, 'system_error');
    messageBroker.subscribe(this.name, 'operation_success');
    messageBroker.subscribe(this.name, 'operation_failure');

    this.logger.info(`[${this.name}] Subscribed to message types`);
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload, from } = message;

      switch (type) {
        case 'review_proposal':
          return await this.reviewProposal(payload);

        case 'modification_proposed':
          return await this.evaluateModification(payload);

        case 'goal_created':
          return await this.evaluateGoal(payload);

        case 'system_error':
          return this.recordError(payload);

        case 'operation_success':
          return this.recordSuccess(payload);

        case 'operation_failure':
          return this.recordFailure(payload);

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
      type,           // 'code_modification', 'architecture_change', 'new_feature', 'optimization'
      risk,           // 0-1 scale (from proposer)
      novelty,        // 0-1 scale (how new/untested)
      reversible,     // boolean
      testedBefore,   // boolean
      successRate,    // 0-1 if tested before
      changes         // Description of changes
    } = proposal;

    // Calculate conservative risk score
    const conservativeRisk = this._calculateConservativeRisk(proposal);

    // Decision logic
    let decision = 'REJECT';
    let reasoning = [];

    // Automatic rejection criteria
    if (conservativeRisk > 0.7) {
      reasoning.push(`High risk (${(conservativeRisk * 100).toFixed(0)}%) exceeds tolerance`);
      decision = 'REJECT';
    } else if (!reversible && novelty > 0.5) {
      reasoning.push('Irreversible change with high novelty - too dangerous');
      decision = 'REJECT';
    } else if (this._isChangeRateTooHigh()) {
      reasoning.push(`Change rate too high (${this.recentChanges.length} changes in 24h)`);
      decision = 'DEFER';
    } else if (testedBefore && successRate > 0.85) {
      reasoning.push(`Proven solution with ${(successRate * 100).toFixed(0)}% success rate`);
      decision = 'APPROVE';
    } else if (conservativeRisk < this.riskTolerance && reversible) {
      reasoning.push(`Acceptable risk (${(conservativeRisk * 100).toFixed(0)}%) and reversible`);
      decision = 'APPROVE_WITH_CAUTION';
    } else {
      reasoning.push('Insufficient confidence in safety');
      decision = 'REJECT';
    }

    // Update stats
    if (decision === 'APPROVE' || decision === 'APPROVE_WITH_CAUTION') {
      this.stats.proposalsApproved++;
    } else if (decision === 'REJECT') {
      this.stats.proposalsRejected++;
    } else {
      this.stats.proposalsDeferred++;
    }

    this.logger.info(`[${this.name}] 📋 Proposal reviewed: ${decision}`);
    this.logger.info(`[${this.name}]    Risk: ${(conservativeRisk * 100).toFixed(0)}%, Reasoning: ${reasoning.join('; ')}`);

    return {
      success: true,
      decision,
      conservativeRisk,
      reasoning,
      recommendation: this._getRecommendation(proposal, decision)
    };
  }

  _calculateConservativeRisk(proposal) {
    const {
      type,
      risk = 0.5,
      novelty = 0.5,
      reversible = true,
      testedBefore = false,
      successRate = 0
    } = proposal;

    // Base risk from proposer
    let totalRisk = risk;

    // Add resistance based on change type
    const resistanceFactor = this.resistanceFactors[type] || 0.5;
    totalRisk += resistanceFactor * 0.3;

    // Novelty penalty
    totalRisk += novelty * 0.4;

    // Irreversibility penalty
    if (!reversible) {
      totalRisk += 0.3;
    }

    // Proven solution discount
    if (testedBefore && successRate > 0.8) {
      totalRisk -= 0.4;
    }

    // System stability factor
    const errorRate = this.stabilityMetrics.errorRate;
    if (errorRate > 0.1) {
      // System already unstable - resist changes
      totalRisk += 0.2;
    }

    return Math.max(0, Math.min(1, totalRisk));
  }

  _isChangeRateTooHigh() {
    const now = Date.now();
    const recentChanges = this.recentChanges.filter(c => now - c.timestamp < this.changeWindow);
    return recentChanges.length >= this.maxChangesInWindow;
  }

  _getRecommendation(proposal, decision) {
    if (decision === 'APPROVE' || decision === 'APPROVE_WITH_CAUTION') {
      return {
        proceed: true,
        conditions: [
          'Deploy to sandbox environment first',
          'Monitor for 24 hours before production',
          'Keep rollback mechanism ready',
          'Implement comprehensive error logging'
        ]
      };
    } else if (decision === 'DEFER') {
      return {
        proceed: false,
        alternative: 'Wait until system stabilizes or change rate decreases',
        retryAfter: 24 * 60 * 60 * 1000 // 24 hours
      };
    } else {
      return {
        proceed: false,
        alternative: 'Use proven solution instead or reduce novelty',
        reducedRiskApproach: this._suggestSaferAlternative(proposal)
      };
    }
  }

  _suggestSaferAlternative(proposal) {
    return {
      suggestion: 'Break into smaller, reversible increments',
      testFirst: 'Test in isolated environment with rollback capability',
      incrementalApproach: 'Deploy 10% of change, monitor, then expand'
    };
  }

  async evaluateModification(payload) {
    const proposal = {
      type: 'code_modification',
      risk: 0.6,
      novelty: 0.5,
      reversible: true,
      ...payload
    };

    return await this.reviewProposal(proposal);
  }

  async evaluateGoal(payload) {
    const { goal } = payload;

    // Conservative check: Is this goal too risky?
    if (goal.type === 'strategic' && goal.category === 'capability') {
      this.logger.warn(`[${this.name}] ⚠️  Strategic capability goal detected - recommending caution`);

      // Send alternative conservative approach
      await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'goal_concern',
        payload: {
          goalId: goal.id,
          concern: 'Strategic changes should be incremental',
          conservativeAlternative: {
            suggestion: 'Break into smaller tactical goals',
            reasoning: 'Reduces risk and allows course correction'
          }
        }
      });
    }

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ SYSTEM HEALTH TRACKING ░░
  // ═══════════════════════════════════════════════════════════

  recordError(payload) {
    this.stabilityMetrics.failedOperations++;
    this.stabilityMetrics.lastCrash = Date.now();

    this._updateErrorRate();

    this.logger.error(`[${this.name}] ⚠️  System error recorded - increasing change resistance`);

    return { success: true };
  }

  recordSuccess(payload) {
    this.stabilityMetrics.successfulOperations++;
    this._updateErrorRate();

    return { success: true };
  }

  recordFailure(payload) {
    this.stabilityMetrics.failedOperations++;
    this._updateErrorRate();

    return { success: true };
  }

  _updateErrorRate() {
    const total = this.stabilityMetrics.successfulOperations + this.stabilityMetrics.failedOperations;
    if (total > 0) {
      this.stabilityMetrics.errorRate = this.stabilityMetrics.failedOperations / total;
    }

    // If error rate is high, automatically increase risk resistance
    if (this.stabilityMetrics.errorRate > 0.15) {
      this.logger.warn(`[${this.name}] 🚨 High error rate (${(this.stabilityMetrics.errorRate * 100).toFixed(1)}%) - entering defensive mode`);

      // Broadcast warning
      messageBroker.publish({
        type: 'conservative_defensive_mode',
        payload: {
          errorRate: this.stabilityMetrics.errorRate,
          message: 'System stability concerns - resisting non-essential changes'
        },
        from: this.name
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PROVEN SOLUTIONS DATABASE ░░
  // ═══════════════════════════════════════════════════════════

  recordProvenSolution(solutionHash, success) {
    if (!this.provenSolutions.has(solutionHash)) {
      this.provenSolutions.set(solutionHash, {
        successCount: 0,
        failureCount: 0,
        usageCount: 0,
        lastUsed: Date.now()
      });
    }

    const solution = this.provenSolutions.get(solutionHash);
    solution.usageCount++;
    solution.lastUsed = Date.now();

    if (success) {
      solution.successCount++;
    } else {
      solution.failureCount++;
    }

    return {
      success: true,
      successRate: solution.successCount / (solution.successCount + solution.failureCount)
    };
  }

  getProvenSolution(solutionHash) {
    const solution = this.provenSolutions.get(solutionHash);
    if (!solution) {
      return { success: false, proven: false };
    }

    const successRate = solution.successCount / (solution.successCount + solution.failureCount);

    return {
      success: true,
      proven: successRate > 0.8 && solution.usageCount > 3,
      successRate,
      usageCount: solution.usageCount
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATISTICS ░░
  // ═══════════════════════════════════════════════════════════

  getStatistics() {
    return {
      ...this.stats,
      approvalRate: (this.stats.proposalsApproved / Math.max(1, this.stats.proposalsReviewed) * 100).toFixed(1) + '%',
      rejectionRate: (this.stats.proposalsRejected / Math.max(1, this.stats.proposalsReviewed) * 100).toFixed(1) + '%',
      stabilityMetrics: this.stabilityMetrics,
      philosophy: 'Stability over novelty - proven solutions preferred'
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

module.exports = { ConservativeArbiter };
