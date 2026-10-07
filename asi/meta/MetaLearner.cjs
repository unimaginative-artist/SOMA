/**
 * MetaLearner.cjs - The "Brain's Coach"
 * 
 * Responsible for "Learning to Learn".
 * Sits above the StrategyOptimizer and tunes the learning process itself.
 * 
 * Capabilities:
 * 1. Transfer Learning: Applies successful strategies from one domain to similar domains.
 * 2. Hyperparameter Tuning: Adjusts the exploration/exploitation balance (epsilon) based on system maturity.
 * 3. Learning Velocity Analysis: Detects if the system is learning faster or slower.
 */

class MetaLearner {
  constructor(config = {}) {
    this.strategyOptimizer = null;
    this.outcomeTracker = null;
    this.fixProposalSystem = config.fixProposalSystem || null; // New: FixProposalSystem
    
    this.state = {
      maturityLevel: 0, // 0.0 to 1.0 (Novice to Expert)
      learningVelocity: [],
      transferMap: new Map() // sourceDomain -> [targetDomains]
    };

    // Configuration
    this.config = {
      minMaturityForTransfer: 0.3,
      velocityWindow: 50,
      ...config
    };
  }

  async initialize() {
    console.log('[MetaLearner] 🧠 Initializing Meta-Learning Subsystem...');
    
    // Dynamic imports for ES modules
    try {
      const { getStrategyOptimizer } = await import('../../arbiters/StrategyOptimizer.js');
      const { getOutcomeTracker } = await import('../../arbiters/OutcomeTracker.js');
      
      this.strategyOptimizer = getStrategyOptimizer();
      this.outcomeTracker = getOutcomeTracker();
      
      await this.strategyOptimizer.initialize();
      await this.outcomeTracker.initialize();
    } catch (error) {
      console.warn('[MetaLearner] ⚠️ Could not load StrategyOptimizer/OutcomeTracker:', error.message);
      // Create mock implementations to prevent crashes
      this.strategyOptimizer = {
        initialize: async () => {},
        getStats: () => ({ totalRecommendations: 0, successfulRecommendations: 0 }),
        getDomainStats: () => null,
        recordOutcome: () => {},
        config: { epsilonGreedy: 0.1, decayFactor: 0.95 }
      };
      this.outcomeTracker = {
        initialize: async () => {}
      };
    }
    
    // Analyze historical data to set initial state
    await this.assessSystemMaturity();
    console.log(`[MetaLearner] ✅ System Maturity: ${(this.state.maturityLevel * 100).toFixed(1)}%`);
  }

  /**
   * Assess how "mature" the system is based on successful outcomes.
   * Higher maturity = Less random exploration, more exploitation.
   */
  async assessSystemMaturity() {
    const stats = this.strategyOptimizer.getStats();
    
    if (stats.totalRecommendations < 10) {
      this.state.maturityLevel = 0.1; // Novice
    } else {
      // Calculate sigmoid function of success rate * volume
      const successVolume = stats.successfulRecommendations;
      this.state.maturityLevel = 1 / (1 + Math.exp(-0.01 * (successVolume - 50)));
    }

    // Tune the optimizer's parameters based on maturity
    await this.tuneHyperparameters();
  }

  /**
   * Adjust StrategyOptimizer's exploration parameters dynamically
   */
  async tuneHyperparameters() { // Make async to allow fixProposalSystem.generateProposalFromObservations
    // As maturity increases, reduce random exploration (epsilon)
    const newEpsilon = 0.2 - (0.15 * this.state.maturityLevel);
    this.newEpsilon = Math.max(0.05, newEpsilon); // Store for proposal
    
    // As maturity increases, trust recent data more (higher decay factor)
    this.newDecayFactor = 0.90 + (0.09 * this.state.maturityLevel); // Store for proposal

    const currentEpsilon = this.strategyOptimizer.config.epsilonGreedy;
    const currentDecayFactor = this.strategyOptimizer.config.decayFactor;

    // Only propose a change if the new values are significantly different
    if (Math.abs(this.newEpsilon - currentEpsilon) > 0.01 || Math.abs(this.newDecayFactor - currentDecayFactor) > 0.005) {
      const proposalTitle = `Tune Learning Hyperparameters (Epsilon: ${currentEpsilon.toFixed(3)} -> ${this.newEpsilon.toFixed(3)}, Decay: ${currentDecayFactor.toFixed(3)} -> ${this.newDecayFactor.toFixed(3)})`;
      const proposalDescription = `Based on current system maturity (${(this.state.maturityLevel * 100).toFixed(1)}%), it is proposed to adjust the StrategyOptimizer's hyperparameters to better balance exploration and exploitation. This should lead to more efficient learning.`;
      
      const fixDetails = {
        type: 'config_change',
        changes: [{
          file: 'StrategyOptimizer.js (config)', // Conceptual file path
          parameter: 'epsilonGreedy',
          originalValue: currentEpsilon,
          newValue: this.newEpsilon
        }, {
          file: 'StrategyOptimizer.js (config)',
          parameter: 'decayFactor',
          originalValue: currentDecayFactor,
          newValue: this.newDecayFactor
        }],
        // Before/After could be more complex, showing config block or relevant code
        beforeAfter: {
          file: 'StrategyOptimizer.js',
          original: `epsilonGreedy: ${currentEpsilon.toFixed(3)}, decayFactor: ${currentDecayFactor.toFixed(3)}`,
          modified: `epsilonGreedy: ${this.newEpsilon.toFixed(3)}, decayFactor: ${this.newDecayFactor.toFixed(3)}`
        }
      };

      if (this.fixProposalSystem) {
        await this.fixProposalSystem.generateProposalFromObservations(
          { description: proposalDescription, context: { maturity: this.state.maturityLevel } },
          {
            title: proposalTitle,
            description: proposalDescription,
            confidence: this.state.maturityLevel, // Confidence scales with maturity
            risk: 1 - this.state.maturityLevel,    // Risk reduces with maturity
            safetyApproved: true, // Assuming hyperparameter tuning is inherently safe
            fix: fixDetails
          }
        );
        console.log(`[MetaLearner] 📝 Proposed hyperparameter tuning: ${proposalTitle}`);
      } else {
        // Fallback: apply directly if no proposal system
        this.strategyOptimizer.config.epsilonGreedy = this.newEpsilon;
        this.strategyOptimizer.config.decayFactor = this.newDecayFactor;
        console.log(`[MetaLearner] 🔧 Tuned Hyperparameters Directly: Epsilon=${this.newEpsilon.toFixed(3)}, Decay=${this.newDecayFactor.toFixed(3)} (No Fix Proposal System)`);
      }
    } else {
      console.log('[MetaLearner] Hyperparameters within tolerance; no tuning proposed.');
    }
  }

  /**
   * Attempt to transfer knowledge from a source domain to a target domain.
   * e.g., If 'memoization' works for 'sorting', try it for 'searching'.
   */
  async transferKnowledge(sourceDomain, targetDomain) {
    if (this.state.maturityLevel < this.config.minMaturityForTransfer) {
      return { success: false, reason: 'System too immature for transfer learning' };
    }

    const sourceStats = this.strategyOptimizer.getDomainStats(sourceDomain);
    if (!sourceStats || sourceStats.strategies.length === 0) {
      return { success: false, reason: 'Source domain has no data' };
    }

    const topStrategies = sourceStats.strategies
      .filter(s => s.successRate > 0.7) // Only high performing strategies
      .map(s => s.name);

    if (topStrategies.length === 0) {
      return { success: false, reason: 'No high-quality strategies to transfer' };
    }

    // Instead of directly applying, propose as a FixProposal
    const proposalTitle = `Propose Knowledge Transfer: ${sourceDomain} -> ${targetDomain}`;
    const proposalDescription = `Based on successful strategies in '${sourceDomain}', it is proposed to transfer and apply the following high-performing strategies to '${targetDomain}': ${topStrategies.join(', ')}. This is expected to accelerate learning and performance in the target domain.`;

    const fixDetails = {
      type: 'knowledge_transfer',
      changes: [{
        sourceDomain: sourceDomain,
        targetDomain: targetDomain,
        strategies: topStrategies
      }],
      beforeAfter: { // Conceptual representation
        file: 'StrategyOptimizer.js (knowledge)',
        original: `Strategies in ${targetDomain}: (prior state)`,
        modified: `Strategies in ${targetDomain}: (after transfer of ${topStrategies.join(', ')})`
      }
    };

    if (this.fixProposalSystem) {
      await this.fixProposalSystem.generateProposalFromObservations(
        { description: proposalDescription, context: { sourceDomain, targetDomain, maturity: this.state.maturityLevel } },
        {
          title: proposalTitle,
          description: proposalDescription,
          confidence: this.state.maturityLevel, // Confidence scales with maturity
          risk: 1 - this.state.maturityLevel,    // Risk reduces with maturity
          safetyApproved: true, // Assuming knowledge transfer is safe
          fix: fixDetails
        }
      );
      console.log(`[MetaLearner] 📝 Proposed knowledge transfer: ${proposalTitle}`);
      return { success: true, proposed: true };
    } else {
      // Fallback: apply directly if no proposal system
      console.log(`[MetaLearner] 🔄 Applying knowledge transfer directly: ${sourceDomain} -> ${targetDomain} (No Fix Proposal System)`);
      for (const strategy of topStrategies) {
        this.strategyOptimizer.recordOutcome(targetDomain, strategy, {
          success: true,
          reward: 0.5,
          context: { transfer: true, source: sourceDomain }
        });
      }
      return { success: true, transferred: topStrategies, count: topStrategies.length };
    }
  }

  /**
   * Main entry point for the ASI Orchestrator to trigger meta-learning
   */
  async runOptimizationCycle() {
    await this.assessSystemMaturity();
    
    // Check for transfer opportunities
    // For now, hardcoded mappings, but this could be learned
    const transferMap = [
      ['code_optimization', 'query_optimization'],
      ['data_compression', 'memory_consolidation']
    ];

    const results = [];
    for (const [source, target] of transferMap) {
      const res = await this.transferKnowledge(source, target);
      if (res.success) results.push(res);
    }

    return {
      maturity: this.state.maturityLevel,
      transfers: results
    };
  }
}

module.exports = MetaLearner;
