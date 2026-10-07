/**
 * StrategyOptimizer.js - Intelligent Strategy Selection System
 *
 * THE STRATEGIC INTELLIGENCE - Learns which strategies work best.
 *
 * Uses Multi-Armed Bandit algorithms to solve the exploration-exploitation tradeoff:
 * - Exploration: Try new/uncertain strategies to learn about them
 * - Exploitation: Use known good strategies to maximize reward
 *
 * Algorithm: UCB1 (Upper Confidence Bound)
 * - Balances exploration and exploitation mathematically
 * - Selects strategies with high average reward + uncertainty bonus
 * - Converges to optimal strategy over time
 *
 * Integrates with:
 * - OutcomeTracker: Get historical success/failure data
 * - ExperienceReplayBuffer: Sample past experiences for learning
 * - SelfModificationArbiter: Recommend which optimization to use
 * - GenomeArbiter: Recommend which evolution strategy to apply
 *
 * Example Usage:
 * ```javascript
 * const optimizer = getStrategyOptimizer();
 *
 * // Get recommendation for code optimization
 * const strategy = optimizer.selectStrategy('code_optimization', {
 *   functionName: 'processData',
 *   complexity: 'high'
 * });
 * // Returns: 'memoization' (because it has 38.5% avg improvement)
 *
 * // After executing strategy, record outcome
 * optimizer.recordOutcome('code_optimization', 'memoization', {
 *   success: true,
 *   reward: 1.42 // 42% improvement
 * });
 * ```
 */

import EventEmitter from 'events';
import { getOutcomeTracker } from './OutcomeTracker.js';
import { getExperienceReplayBuffer } from './ExperienceReplayBuffer.js';

class StrategyOptimizer extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // UCB1 parameters
      explorationConstant: config.explorationConstant || 2.0, // Higher = more exploration
      minTrialsBeforeExploit: config.minTrialsBeforeExploit || 3, // Try each strategy N times before exploiting

      // Strategy evaluation
      windowSize: config.windowSize || 100, // Recent N outcomes for reward calculation
      decayFactor: config.decayFactor || 0.95, // Weight recent outcomes higher

      // Epsilon-greedy fallback
      epsilonGreedy: config.epsilonGreedy || 0.1, // 10% random exploration

      ...config
    };

    // Strategy tracking
    this.strategies = new Map(); // domain -> { strategies: Map<strategy, stats> }

    // Integration
    this.outcomeTracker = getOutcomeTracker();
    this.experienceBuffer = getExperienceReplayBuffer();

    // Performance
    this.totalRecommendations = 0;
    this.successfulRecommendations = 0;
  }

  /**
   * Initialize optimizer by loading historical data
   */
  async initialize() {
    console.log('🎯 Initializing StrategyOptimizer...');

    // Load historical outcomes to warm up strategy knowledge
    await this.loadHistoricalData();

    console.log(`   ✅ StrategyOptimizer ready (${this.strategies.size} domains tracked)`);

    this.emit('initialized');
  }

  /**
   * Load historical outcomes from OutcomeTracker
   */
  async loadHistoricalData() {
    try {
      // Get all outcomes
      const allOutcomes = this.outcomeTracker.queryOutcomes({
        limit: 10000 // Load up to 10k historical outcomes
      });

      console.log(`   📊 Loading ${allOutcomes.length} historical outcomes...`);

      // Group by action (domain)
      const byDomain = new Map();

      for (const outcome of allOutcomes) {
        const domain = outcome.action;
        if (!byDomain.has(domain)) {
          byDomain.set(domain, []);
        }
        byDomain.get(domain).push(outcome);
      }

      // Build strategy stats for each domain
      for (const [domain, outcomes] of byDomain.entries()) {
        this._buildStrategyStatsFromOutcomes(domain, outcomes);
      }

      console.log(`   ✅ Loaded strategy data for ${this.strategies.size} domains`);
    } catch (error) {
      console.error('StrategyOptimizer: Failed to load historical data:', error.message);
    }
  }

  /**
   * Build strategy statistics from outcomes
   */
  _buildStrategyStatsFromOutcomes(domain, outcomes) {
    const strategyMap = new Map();

    for (const outcome of outcomes) {
      // Extract strategy from metadata or context
      const strategy = this._extractStrategy(outcome);
      if (!strategy) continue;

      if (!strategyMap.has(strategy)) {
        strategyMap.set(strategy, {
          name: strategy,
          trials: 0,
          successes: 0,
          failures: 0,
          totalReward: 0,
          avgReward: 0,
          rewards: [], // Recent rewards for variance calculation
          lastUsed: 0
        });
      }

      const stats = strategyMap.get(strategy);
      stats.trials++;

      if (outcome.success) {
        stats.successes++;
      } else {
        stats.failures++;
      }

      stats.totalReward += outcome.reward;
      stats.rewards.push(outcome.reward);
      stats.lastUsed = Math.max(stats.lastUsed, outcome.timestamp);

      // Keep only recent rewards (window)
      if (stats.rewards.length > this.config.windowSize) {
        stats.rewards.shift();
      }

      // Recalculate average
      stats.avgReward = stats.rewards.reduce((a, b) => a + b, 0) / stats.rewards.length;
    }

    this.strategies.set(domain, { strategies: strategyMap });
  }

  /**
   * Extract strategy name from outcome
   */
  _extractStrategy(outcome) {
    // Try metadata first
    if (outcome.metadata && outcome.metadata.strategyUsed) {
      return outcome.metadata.strategyUsed;
    }

    // Try context
    if (outcome.context && outcome.context.strategy) {
      return outcome.context.strategy;
    }

    // Try result
    if (outcome.result && outcome.result.strategy) {
      return outcome.result.strategy;
    }

    return null;
  }

  /**
   * Select the best strategy for a given domain using UCB1
   *
   * @param {string} domain - Action type (e.g., 'code_optimization', 'genome_evolution')
   * @param {Object} context - Additional context for selection
   * @param {string[]} availableStrategies - List of strategies to choose from (optional)
   * @returns {string} Selected strategy name
   */
  selectStrategy(domain, context = {}, availableStrategies = null) {
    this.totalRecommendations++;

    // Get or create domain
    if (!this.strategies.has(domain)) {
      this.strategies.set(domain, { strategies: new Map() });
    }

    const domainData = this.strategies.get(domain);
    let strategies = domainData.strategies;

    // Filter by available strategies if provided
    if (availableStrategies && availableStrategies.length > 0) {
      const filtered = new Map();
      for (const strat of availableStrategies) {
        if (strategies.has(strat)) {
          filtered.set(strat, strategies.get(strat));
        } else {
          // Initialize unknown strategy
          filtered.set(strat, {
            name: strat,
            trials: 0,
            successes: 0,
            failures: 0,
            totalReward: 0,
            avgReward: 0,
            rewards: [],
            lastUsed: 0
          });
        }
      }
      strategies = filtered;
    }

    // No strategies available
    if (strategies.size === 0) {
      console.warn(`StrategyOptimizer: No strategies available for domain '${domain}'`);
      return null;
    }

    // If any strategy has < minTrials, select one randomly for exploration
    const undertriedStrategies = Array.from(strategies.values()).filter(
      s => s.trials < this.config.minTrialsBeforeExploit
    );

    if (undertriedStrategies.length > 0) {
      const selected = undertriedStrategies[Math.floor(Math.random() * undertriedStrategies.length)];
      console.log(`🔍 Exploring: ${selected.name} (${selected.trials}/${this.config.minTrialsBeforeExploit} trials)`);
      return selected.name;
    }

    // Epsilon-greedy: Random exploration
    if (Math.random() < this.config.epsilonGreedy) {
      const allStrategies = Array.from(strategies.values());
      const selected = allStrategies[Math.floor(Math.random() * allStrategies.length)];
      console.log(`🎲 Random exploration: ${selected.name}`);
      return selected.name;
    }

    // UCB1: Select strategy with highest upper confidence bound
    const totalTrials = Array.from(strategies.values()).reduce((sum, s) => sum + s.trials, 0);

    let bestStrategy = null;
    let bestScore = -Infinity;

    for (const strategy of strategies.values()) {
      // UCB1 formula: avgReward + explorationConstant * sqrt(ln(totalTrials) / trials)
      const explorationBonus = this.config.explorationConstant * Math.sqrt(
        Math.log(totalTrials) / strategy.trials
      );

      const ucbScore = strategy.avgReward + explorationBonus;

      if (ucbScore > bestScore) {
        bestScore = ucbScore;
        bestStrategy = strategy;
      }
    }

    if (bestStrategy) {
      console.log(`⭐ UCB1 selected: ${bestStrategy.name} (avg: ${(bestStrategy.avgReward * 100).toFixed(1)}%, trials: ${bestStrategy.trials})`);
      return bestStrategy.name;
    }

    // Fallback: Select strategy with highest average reward
    const fallback = Array.from(strategies.values()).reduce((best, s) =>
      s.avgReward > best.avgReward ? s : best
    );

    console.log(`⚠️ Fallback: ${fallback.name}`);
    return fallback.name;
  }

  /**
   * Record outcome for a strategy
   *
   * @param {string} domain - Action type
   * @param {string} strategyName - Strategy used
   * @param {Object} outcome - { success, reward, context }
   */
  recordOutcome(domain, strategyName, outcome) {
    // Ensure domain exists
    if (!this.strategies.has(domain)) {
      this.strategies.set(domain, { strategies: new Map() });
    }

    const domainData = this.strategies.get(domain);

    // Ensure strategy exists
    if (!domainData.strategies.has(strategyName)) {
      domainData.strategies.set(strategyName, {
        name: strategyName,
        trials: 0,
        successes: 0,
        failures: 0,
        totalReward: 0,
        avgReward: 0,
        rewards: [],
        lastUsed: 0
      });
    }

    const stats = domainData.strategies.get(strategyName);

    // Update stats
    stats.trials++;
    stats.lastUsed = Date.now();

    if (outcome.success) {
      stats.successes++;
      this.successfulRecommendations++;
    } else {
      stats.failures++;
    }

    const reward = outcome.reward !== undefined ? outcome.reward : (outcome.success ? 1 : 0);
    stats.totalReward += reward;
    stats.rewards.push(reward);

    // Keep only recent rewards
    if (stats.rewards.length > this.config.windowSize) {
      stats.rewards.shift();
    }

    // Recalculate average with decay (recent outcomes weighted higher)
    let weightedSum = 0;
    let weightSum = 0;
    const decayFactor = this.config.decayFactor;

    for (let i = 0; i < stats.rewards.length; i++) {
      const age = stats.rewards.length - 1 - i; // 0 = most recent
      const weight = Math.pow(decayFactor, age);
      weightedSum += stats.rewards[i] * weight;
      weightSum += weight;
    }

    stats.avgReward = weightedSum / weightSum;

    this.emit('outcome_recorded', { domain, strategy: strategyName, outcome, stats });
  }

  /**
   * Get statistics for a domain
   */
  getDomainStats(domain) {
    if (!this.strategies.has(domain)) {
      return null;
    }

    const domainData = this.strategies.get(domain);
    const strategies = Array.from(domainData.strategies.values());

    return {
      domain,
      totalStrategies: strategies.length,
      strategies: strategies.map(s => ({
        name: s.name,
        trials: s.trials,
        successRate: s.trials > 0 ? s.successes / s.trials : 0,
        avgReward: s.avgReward,
        lastUsed: s.lastUsed
      })).sort((a, b) => b.avgReward - a.avgReward) // Sort by reward
    };
  }

  /**
   * Get top strategies for a domain
   */
  getTopStrategies(domain, limit = 5) {
    const stats = this.getDomainStats(domain);
    if (!stats) return [];

    return stats.strategies.slice(0, limit);
  }

  /**
   * Get recommendation with explanation
   */
  getRecommendation(domain, context = {}, availableStrategies = null) {
    const selected = this.selectStrategy(domain, context, availableStrategies);

    if (!selected) {
      return {
        strategy: null,
        reason: 'No strategies available',
        confidence: 0
      };
    }

    const domainData = this.strategies.get(domain);
    const stats = domainData.strategies.get(selected);

    const confidence = stats.trials >= this.config.minTrialsBeforeExploit
      ? Math.min(stats.trials / (this.config.minTrialsBeforeExploit * 3), 1.0)
      : stats.trials / this.config.minTrialsBeforeExploit;

    let reason = '';
    if (stats.trials < this.config.minTrialsBeforeExploit) {
      reason = `Exploring: Only ${stats.trials} trials so far`;
    } else if (stats.avgReward > 0.5) {
      reason = `High performance: ${(stats.avgReward * 100).toFixed(1)}% avg reward`;
    } else if (stats.avgReward > 0) {
      reason = `Moderate performance: ${(stats.avgReward * 100).toFixed(1)}% avg reward`;
    } else {
      reason = `Needs more data: ${(stats.avgReward * 100).toFixed(1)}% avg reward`;
    }

    return {
      strategy: selected,
      reason,
      confidence,
      stats: {
        trials: stats.trials,
        successRate: stats.trials > 0 ? stats.successes / stats.trials : 0,
        avgReward: stats.avgReward
      }
    };
  }

  /**
   * Get overall statistics
   */
  getStats() {
    return {
      totalDomains: this.strategies.size,
      totalRecommendations: this.totalRecommendations,
      successfulRecommendations: this.successfulRecommendations,
      successRate: this.totalRecommendations > 0
        ? this.successfulRecommendations / this.totalRecommendations
        : 0,
      domains: Array.from(this.strategies.keys())
    };
  }

  /**
   * Reset all strategy data
   */
  reset() {
    this.strategies.clear();
    this.totalRecommendations = 0;
    this.successfulRecommendations = 0;
    this.emit('reset');
  }
}

// Singleton instance
let optimizerInstance = null;

export function getStrategyOptimizer(config = {}) {
  if (!optimizerInstance) {
    optimizerInstance = new StrategyOptimizer(config);
  }
  return optimizerInstance;
}

export default StrategyOptimizer;
