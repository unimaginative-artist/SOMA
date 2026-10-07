/**
 * MetaLearningEngine.js - Learning to Learn
 *
 * The Meta-Learning Engine optimizes SOMA's learning processes themselves.
 * Instead of just learning from experiences, SOMA learns which learning strategies work best.
 *
 * Key Capabilities:
 * - Learns optimal learning rates for different contexts
 * - Identifies which experiences are most valuable to learn from
 * - Optimizes exploration vs exploitation balance
 * - Tunes hyperparameters dynamically
 * - Detects learning plateaus and adjusts strategies
 * - Learns transfer learning patterns (when knowledge transfers well)
 *
 * Meta-Learning Dimensions:
 * 1. Strategy Selection: Which learning algorithm to use when
 * 2. Hyperparameter Optimization: Dynamic tuning of learning rates, batch sizes, etc.
 * 3. Curriculum Learning: Order experiences for optimal learning
 * 4. Sample Efficiency: Learn more from fewer experiences
 * 5. Transfer Optimization: Maximize knowledge transfer across domains
 *
 * Example Meta-Learnings:
 * - "Code debugging learns best with low temperature (0.2) and high experience replay"
 * - "Creative tasks improve faster with diversity-weighted sampling"
 * - "Legal reasoning benefits from cross-domain transfer from ethics domain"
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class MetaLearningEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'MetaLearningEngine';

    // Dependencies
    this.learningPipeline = opts.learningPipeline;
    this.fragmentRegistry = opts.fragmentRegistry;
    this.messageBroker = opts.messageBroker;

    // Meta-learning storage
    this.strategyPerformance = new Map(); // strategy -> performance metrics
    this.contextualStrategies = new Map(); // context -> best strategies
    this.hyperparameterHistory = new Map(); // param -> [value, performance] history
    this.learningCurves = new Map(); // domain -> learning progression
    this.transferPatterns = new Map(); // "domainA->domainB" -> transfer effectiveness
    this.fewShotExemplars = new Map(); // category -> [exemplars] for few-shot learning
    this.activeLearningQueue = []; // Uncertain cases flagged for human feedback

    // Curriculum learning configuration
    this.curriculum = {
      stage: 0,
      stages: [
        { level: 0, name: 'Basic Patterns', difficulty: 0.2, minAccuracy: 0.9 },
        { level: 1, name: 'Simple Reasoning', difficulty: 0.4, minAccuracy: 0.85 },
        { level: 2, name: 'Complex Queries', difficulty: 0.6, minAccuracy: 0.8 },
        { level: 3, name: 'Multi-Step Tasks', difficulty: 0.8, minAccuracy: 0.75 },
        { level: 4, name: 'Creative Synthesis', difficulty: 1.0, minAccuracy: 0.7 }
      ],
      currentAccuracy: 0,
      readyForNext: false
    };

    // Current meta-parameters (optimized over time)
    this.metaParams = {
      defaultLearningRate: 0.1,
      explorationRate: 0.3, // 30% exploration, 70% exploitation
      experienceReplayRatio: 0.2, // 20% of training from replay
      diversitySamplingWeight: 0.5,
      prioritizedReplayAlpha: 0.6, // Prioritization strength
      curriculumDifficulty: 0.5, // Start at medium difficulty
      fewShotExamples: 5, // Number of exemplars per category
      uncertaintyThreshold: 0.6 // Flag cases below this confidence for active learning
    };

    // Performance tracking
    this.performanceWindow = []; // Recent performance scores
    this.plateauDetector = {
      windowSize: 20,
      threshold: 0.02, // 2% improvement required
      currentPlateau: false,
      plateauCount: 0
    };

    // Strategy registry
    this.strategies = this._defineStrategies();

    // Stats
    this.stats = {
      totalOptimizations: 0,
      strategyChanges: 0,
      plateausDetected: 0,
      hyperparameterAdjustments: 0,
      avgPerformanceImprovement: 0.0,
      learningEfficiency: 1.0, // Higher = learning more per experience
      totalExemplars: 0, // Few-shot exemplars collected
      curriculumStage: 0, // Current curriculum stage
      activeQueriesAsked: 0 // Uncertain cases flagged
    };

    // Configuration
    this.config = {
      optimizationInterval: opts.optimizationInterval || 100, // Optimize every N experiences
      minExperiencesForOptimization: opts.minExperiencesForOptimization || 50,
      adaptationRate: opts.adaptationRate || 0.1, // How quickly to adapt meta-params
      performanceMemory: opts.performanceMemory || 100 // Remember last N performances
    };

    console.log(`[${this.name}] Initialized - SOMA will now learn how to learn`);
  }

  /**
   * Initialize meta-learning engine
   */
  async initialize(deps = {}) {
    console.log(`[${this.name}] 🎓 Initializing Meta-Learning Engine...`);

    // Connect dependencies
    if (deps.experienceBuffer) this.experienceBuffer = deps.experienceBuffer;
    if (deps.outcomeTracker) this.outcomeTracker = deps.outcomeTracker;
    if (deps.fragmentRegistry) this.fragmentRegistry = deps.fragmentRegistry;

    // Subscribe to learning events
    if (this.learningPipeline) {
      this.learningPipeline.on('experience:added', this._onExperienceAdded.bind(this));
      this.learningPipeline.on('outcome:recorded', this._onOutcomeRecorded.bind(this));
      console.log(`[${this.name}]    Subscribed to learning pipeline events`);
    }

    // Subscribe to MessageBroker for system-wide learning events
    if (this.messageBroker) {
      this.messageBroker.subscribe('meta:optimize', this._handleOptimizationRequest.bind(this));
      console.log(`[${this.name}]    Subscribed to MessageBroker events`);
    }

    // Start periodic optimization
    this.startPeriodicOptimization();

    console.log(`[${this.name}] ✅ Meta-Learning Engine ready`);
    console.log(`[${this.name}]    Initial learning rate: ${this.metaParams.defaultLearningRate}`);
    console.log(`[${this.name}]    Exploration rate: ${(this.metaParams.explorationRate * 100).toFixed(0)}%`);
  }

  /**
   * Define learning strategies
   */
  _defineStrategies() {
    return new Map([
      ['aggressive_learning', {
        name: 'Aggressive Learning',
        learningRate: 0.3,
        explorationRate: 0.5,
        replayRatio: 0.1,
        description: 'Fast adaptation, high exploration'
      }],
      ['conservative_learning', {
        name: 'Conservative Learning',
        learningRate: 0.05,
        explorationRate: 0.1,
        replayRatio: 0.4,
        description: 'Slow, stable learning with heavy replay'
      }],
      ['balanced_learning', {
        name: 'Balanced Learning',
        learningRate: 0.1,
        explorationRate: 0.3,
        replayRatio: 0.2,
        description: 'Balanced exploration and exploitation'
      }],
      ['transfer_focused', {
        name: 'Transfer-Focused',
        learningRate: 0.15,
        explorationRate: 0.2,
        replayRatio: 0.3,
        description: 'Optimized for cross-domain transfer'
      }],
      ['diversity_seeking', {
        name: 'Diversity-Seeking',
        learningRate: 0.2,
        explorationRate: 0.6,
        replayRatio: 0.15,
        description: 'Maximize experience diversity'
      }]
    ]);
  }

  /**
   * 🚀 ONLINE LEARNING: Update immediately from a single experience
   * Called by ExperienceReplayBuffer for real-time learning
   */
  async updateFromExperience(experience) {
    const { context, action, agent, reward, outcome, metadata } = experience;

    // 1. Update strategy performance tracking
    const strategyUsed = metadata?.strategy || 'unknown';
    if (!this.strategyPerformance.has(strategyUsed)) {
      this.strategyPerformance.set(strategyUsed, {
        uses: 0,
        totalReward: 0,
        avgReward: 0,
        successRate: 0,
        successes: 0
      });
    }

    const perf = this.strategyPerformance.get(strategyUsed);
    perf.uses++;
    perf.totalReward += reward;
    perf.avgReward = perf.totalReward / perf.uses;

    if (reward > 0) {
      perf.successes++;
    }
    perf.successRate = perf.successes / perf.uses;

    // 2. Update contextual strategy mapping
    const actionStr = action || 'unknown';
    const contextKey = JSON.stringify({
      agent,
      actionType: actionStr.split(':')[0], // First part of action
      hasReward: reward > 0
    });

    if (!this.contextualStrategies.has(contextKey)) {
      this.contextualStrategies.set(contextKey, new Map());
    }

    const contextStrategies = this.contextualStrategies.get(contextKey);
    if (!contextStrategies.has(strategyUsed)) {
      contextStrategies.set(strategyUsed, { count: 0, totalReward: 0, avgReward: 0 });
    }

    const contextPerf = contextStrategies.get(strategyUsed);
    contextPerf.count++;
    contextPerf.totalReward += reward;
    contextPerf.avgReward = contextPerf.totalReward / contextPerf.count;

    // 3. Update performance window
    this.performanceWindow.push(reward);
    if (this.performanceWindow.length > this.config.performanceMemory) {
      this.performanceWindow.shift();
    }

    // 4. Adaptive learning rate adjustment
    if (this.performanceWindow.length >= 10) {
      const recentPerf = this.performanceWindow.slice(-10);
      const avgRecent = recentPerf.reduce((a, b) => a + b, 0) / recentPerf.length;

      // If recent performance is poor, increase learning rate (adapt faster)
      if (avgRecent < 0.3 && this.metaParams.defaultLearningRate < 0.3) {
        this.metaParams.defaultLearningRate = Math.min(0.3, this.metaParams.defaultLearningRate * 1.1);
      }

      // If recent performance is good, can reduce learning rate (stabilize)
      if (avgRecent > 0.8 && this.metaParams.defaultLearningRate > 0.05) {
        this.metaParams.defaultLearningRate = Math.max(0.05, this.metaParams.defaultLearningRate * 0.95);
      }
    }

    // 5. Update learning efficiency stat
    if (this.stats.totalOptimizations > 0) {
      const avgPerf = this.performanceWindow.reduce((a, b) => a + b, 0) / this.performanceWindow.length;
      this.stats.learningEfficiency = avgPerf / (this.stats.totalOptimizations || 1);
    }

    // Log occasionally (every 100 experiences)
    if (perf.uses % 100 === 0) {
      console.log(`[${this.name}] 🚀 Online learning: ${strategyUsed} (${perf.uses} uses, ${(perf.successRate * 100).toFixed(0)}% success, ${perf.avgReward.toFixed(2)} avg reward)`);
    }

    // 🔄 FEEDBACK LOOP: Tell other systems what's working
    await this._sendFeedback(experience, strategyUsed, perf);
  }

  /**
   * 🔄 FEEDBACK LOOP: Send performance feedback to other systems
   */
  async _sendFeedback(experience, strategyUsed, performance) {
    if (!this.messageBroker) return;

    const { reward, agent, action } = experience;

    // 1. High-performing strategies → TrainingCoordinator
    if (performance.successRate > 0.8 && performance.uses >= 10) {
      await this.messageBroker.sendMessage({
        from: this.name,
        to: 'TrainingCoordinator',
        type: 'strategy_success',
        payload: {
          strategy: strategyUsed,
          successRate: performance.successRate,
          avgReward: performance.avgReward,
          uses: performance.uses,
          recommendation: 'prioritize_this_strategy',
          agent,
          actionType: action.split(':')[0]
        }
      });
    }

    // 2. High-value patterns → LocalModelManager
    if (reward > 0.85 && performance.avgReward > 0.7) {
      await this.messageBroker.sendMessage({
        from: this.name,
        to: 'LocalModelManager',
        type: 'high_value_pattern',
        payload: {
          pattern: {
            strategy: strategyUsed,
            agent,
            action,
            context: experience.context
          },
          reward,
          avgReward: performance.avgReward,
          priority: 'high',
          recommendation: 'include_in_training'
        }
      });
    }

    // 3. Poor-performing strategies → TrainingCoordinator
    if (performance.successRate < 0.3 && performance.uses >= 20) {
      await this.messageBroker.sendMessage({
        from: this.name,
        to: 'TrainingCoordinator',
        type: 'strategy_failure',
        payload: {
          strategy: strategyUsed,
          successRate: performance.successRate,
          avgReward: performance.avgReward,
          uses: performance.uses,
          recommendation: 'avoid_this_strategy',
          agent
        }
      });
    }

    // 4. Learning insights → System-wide broadcast
    if (this.performanceWindow.length >= 50 && this.performanceWindow.length % 50 === 0) {
      const avgPerf = this.performanceWindow.reduce((a, b) => a + b, 0) / this.performanceWindow.length;

      await this.messageBroker.sendMessage({
        from: this.name,
        to: 'broadcast',
        type: 'learning_insight',
        payload: {
          avgPerformance: avgPerf,
          learningEfficiency: this.stats.learningEfficiency,
          currentLearningRate: this.metaParams.defaultLearningRate,
          topStrategies: this._getTopStrategies(5),
          recommendation: avgPerf > 0.7 ? 'performance_good' : 'needs_improvement'
        }
      });
    }
  }

  /**
   * Get top performing strategies
   */
  _getTopStrategies(limit = 5) {
    return Array.from(this.strategyPerformance.entries())
      .filter(([_, perf]) => perf.uses >= 10) // Minimum sample size
      .sort((a, b) => b[1].avgReward - a[1].avgReward)
      .slice(0, limit)
      .map(([strategy, perf]) => ({
        strategy,
        avgReward: perf.avgReward,
        successRate: perf.successRate,
        uses: perf.uses
      }));
  }

  /**
   * Optimize meta-parameters based on recent performance
   */
  async optimizeMetaParameters() {
    this.stats.totalOptimizations++;

    if (this.performanceWindow.length < this.config.minExperiencesForOptimization) {
      return; // Not enough data yet
    }

    // 1. Detect learning plateau
    const plateau = this._detectPlateau();
    if (plateau && !this.plateauDetector.currentPlateau) {
      console.log(`[${this.name}] 📊 Learning plateau detected - adjusting strategy`);
      this.plateauDetector.currentPlateau = true;
      this.plateauDetector.plateauCount++;
      this.stats.plateausDetected++;

      // Break plateau: increase exploration or change strategy
      await this._breakPlateau();
    } else if (!plateau && this.plateauDetector.currentPlateau) {
      this.plateauDetector.currentPlateau = false;
      console.log(`[${this.name}] ✅ Plateau broken - learning improving`);
    }

    // 2. Optimize learning rate
    const optimalLR = await this._optimizeLearningRate();
    if (Math.abs(optimalLR - this.metaParams.defaultLearningRate) > 0.01) {
      console.log(`[${this.name}] 🎯 Adjusted learning rate: ${this.metaParams.defaultLearningRate.toFixed(3)} → ${optimalLR.toFixed(3)}`);
      this.metaParams.defaultLearningRate = optimalLR;
      this.stats.hyperparameterAdjustments++;
    }

    // 3. Optimize exploration vs exploitation
    const optimalExploration = await this._optimizeExploration();
    if (Math.abs(optimalExploration - this.metaParams.explorationRate) > 0.05) {
      console.log(`[${this.name}] 🔍 Adjusted exploration rate: ${(this.metaParams.explorationRate * 100).toFixed(0)}% → ${(optimalExploration * 100).toFixed(0)}%`);
      this.metaParams.explorationRate = optimalExploration;
      this.stats.hyperparameterAdjustments++;
    }

    // 4. Calculate learning efficiency
    this._updateLearningEfficiency();

    // Publish meta-parameter update
    if (this.messageBroker) {
      this.messageBroker.publish('meta:parameters:updated', {
        metaParams: this.metaParams,
        stats: this.stats,
        timestamp: Date.now()
      });
    }

    this.emit('meta:optimized', {
      metaParams: this.metaParams,
      stats: this.stats
    });
  }

  /**
   * Detect learning plateau
   */
  _detectPlateau() {
    const window = this.performanceWindow.slice(-this.plateauDetector.windowSize);
    if (window.length < this.plateauDetector.windowSize) return false;

    // Calculate trend (linear regression slope)
    const n = window.length;
    const xMean = (n - 1) / 2;
    const yMean = window.reduce((sum, y) => sum + y, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (window[i] - yMean);
      denominator += (i - xMean) ** 2;
    }

    const slope = numerator / denominator;

    // Plateau if slope is near zero (minimal improvement)
    return Math.abs(slope) < this.plateauDetector.threshold;
  }

  /**
   * Break out of learning plateau
   */
  async _breakPlateau() {
    // Strategy 1: Increase exploration
    this.metaParams.explorationRate = Math.min(0.8, this.metaParams.explorationRate * 1.5);

    // Strategy 2: Increase replay diversity
    this.metaParams.diversitySamplingWeight = Math.min(1.0, this.metaParams.diversitySamplingWeight * 1.3);

    // Strategy 3: Try different learning strategy
    const currentBest = this._selectBestStrategy();
    if (currentBest) {
      console.log(`[${this.name}] 🔄 Switching to ${currentBest.name} strategy`);
      this._applyStrategy(currentBest);
      this.stats.strategyChanges++;
    }
  }

  /**
   * Optimize learning rate based on recent performance
   */
  async _optimizeLearningRate() {
    const window = this.performanceWindow.slice(-20);
    if (window.length < 10) return this.metaParams.defaultLearningRate;

    // If performance is improving rapidly, can afford slightly higher LR
    // If performance is noisy/unstable, reduce LR
    const recentImprovement = window[window.length - 1] - window[0];
    const variance = this._calculateVariance(window);

    let optimalLR = this.metaParams.defaultLearningRate;

    if (recentImprovement > 0.1 && variance < 0.05) {
      // Good progress, low variance -> can increase LR slightly
      optimalLR *= 1.1;
    } else if (variance > 0.15) {
      // High variance -> reduce LR for stability
      optimalLR *= 0.9;
    }

    return Math.max(0.01, Math.min(0.5, optimalLR));
  }

  /**
   * Optimize exploration rate
   */
  async _optimizeExploration() {
    // Early in learning: high exploration
    // Later in learning: reduce exploration
    const totalExperiences = this.experienceBuffer ? this.experienceBuffer.size() : 0;

    let optimalExploration = this.metaParams.explorationRate;

    // Decay exploration over time (but never below 10%)
    if (totalExperiences > 1000) {
      optimalExploration = Math.max(0.1, 0.5 * Math.exp(-totalExperiences / 5000));
    }

    // If in plateau, increase exploration
    if (this.plateauDetector.currentPlateau) {
      optimalExploration = Math.min(0.8, optimalExploration * 1.5);
    }

    return optimalExploration;
  }

  /**
   * Select best learning strategy based on historical performance
   */
  _selectBestStrategy() {
    if (this.strategyPerformance.size === 0) {
      return this.strategies.get('balanced_learning');
    }

    let bestStrategy = null;
    let bestScore = -Infinity;

    for (const [strategyName, perf] of this.strategyPerformance) {
      const avgScore = perf.totalReward / Math.max(1, perf.timesUsed);
      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestStrategy = this.strategies.get(strategyName);
      }
    }

    return bestStrategy;
  }

  /**
   * Apply a learning strategy
   */
  _applyStrategy(strategy) {
    this.metaParams.defaultLearningRate = strategy.learningRate;
    this.metaParams.explorationRate = strategy.explorationRate;
    this.metaParams.experienceReplayRatio = strategy.replayRatio;
  }

  /**
   * Update learning efficiency metric
   */
  _updateLearningEfficiency() {
    const window = this.performanceWindow.slice(-50);
    if (window.length < 10) return;

    const improvement = window[window.length - 1] - window[0];
    const experiencesUsed = window.length;

    // Efficiency = improvement per experience
    this.stats.learningEfficiency = improvement / experiencesUsed;
  }

  /**
   * Calculate variance of array
   */
  _calculateVariance(arr) {
    const mean = arr.reduce((sum, x) => sum + x, 0) / arr.length;
    const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
    return variance;
  }

  /**
   * Event handlers
   */
  async _onExperienceAdded(experience) {
    // Track experience for optimization
    if (experience.reward !== undefined) {
      this.performanceWindow.push(experience.reward);

      // Keep window size manageable
      if (this.performanceWindow.length > this.config.performanceMemory) {
        this.performanceWindow.shift();
      }
    }

    // Periodic optimization check
    const totalExperiences = this.experienceBuffer ? this.experienceBuffer.size() : 0;
    if (totalExperiences % this.config.optimizationInterval === 0) {
      await this.optimizeMetaParameters();
    }
  }

  async _onOutcomeRecorded(outcome) {
    // Learn from outcome patterns
    if (outcome.domain) {
      this._updateLearningCurve(outcome.domain, outcome.reward || 0);
    }

    // Track strategy performance
    if (outcome.strategy) {
      this._updateStrategyPerformance(outcome.strategy, outcome.reward || 0);
    }
  }

  /**
   * Update learning curve for a domain
   */
  _updateLearningCurve(domain, reward) {
    if (!this.learningCurves.has(domain)) {
      this.learningCurves.set(domain, []);
    }
    const curve = this.learningCurves.get(domain);
    curve.push({ timestamp: Date.now(), reward });

    // Keep last 1000 points
    if (curve.length > 1000) {
      curve.shift();
    }
  }

  /**
   * Update strategy performance tracking
   */
  _updateStrategyPerformance(strategyName, reward) {
    if (!this.strategyPerformance.has(strategyName)) {
      this.strategyPerformance.set(strategyName, {
        timesUsed: 0,
        totalReward: 0,
        avgReward: 0
      });
    }

    const perf = this.strategyPerformance.get(strategyName);
    perf.timesUsed++;
    perf.totalReward += reward;
    perf.avgReward = perf.totalReward / perf.timesUsed;
  }

  /**
   * MessageBroker handler
   */
  async _handleOptimizationRequest(data) {
    console.log(`[${this.name}] 📩 Optimization request received`);
    await this.optimizeMetaParameters();
  }

  /**
   * Start periodic optimization
   */
  startPeriodicOptimization() {
    setInterval(async () => {
      if (this.performanceWindow.length >= this.config.minExperiencesForOptimization) {
        await this.optimizeMetaParameters();
      }
    }, 60000); // Optimize every minute
  }

  /**
   * Get current meta-parameters
   */
  getMetaParameters() {
    return { ...this.metaParams };
  }

  /**
   * Get meta-learning statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentPlateau: this.plateauDetector.currentPlateau,
      plateauCount: this.plateauDetector.plateauCount,
      performanceWindowSize: this.performanceWindow.length,
      trackedDomains: this.learningCurves.size,
      trackedStrategies: this.strategyPerformance.size,
      metaParams: this.metaParams
    };
  }

  /**
   * Get learning curves for all domains
   */
  getLearningCurves() {
    const curves = {};
    for (const [domain, curve] of this.learningCurves) {
      curves[domain] = {
        points: curve.length,
        latestReward: (curve[curve.length - 1] && curve[curve.length - 1].reward) || 0,
        avgReward: curve.reduce((sum, p) => sum + p.reward, 0) / curve.length
      };
    }
    return curves;
  }

  /**
   * Recommend learning strategy for a context
   */
  recommendStrategy(context = {}) {
    const { domain, difficulty, isNovel } = context;

    // If novel/exploratory task, use diversity-seeking
    if (isNovel) {
      return this.strategies.get('diversity_seeking');
    }

    // If domain has good transfer history, use transfer-focused
    if (domain && this._hasGoodTransferHistory(domain)) {
      return this.strategies.get('transfer_focused');
    }

    // Default to best historical strategy
    return this._selectBestStrategy() || this.strategies.get('balanced_learning');
  }

  /**
   * 🔄 TRANSFER LEARNING TRACKING: Track knowledge transfer between domains/tasks
   *
   * Records when learning from domain A helps with domain B.
   * This allows SOMA to:
   * - Identify which domains transfer well (e.g., medical → legal for ethics)
   * - Suggest training strategies based on transfer patterns
   * - Optimize curriculum by leveraging positive transfer
   */
  trackTransferLearning(sourceDomain, targetDomain, performance) {
    const transferKey = `${sourceDomain}->${targetDomain}`;

    if (!this.transferPatterns.has(transferKey)) {
      this.transferPatterns.set(transferKey, {
        source: sourceDomain,
        target: targetDomain,
        attempts: 0,
        successes: 0,
        totalPerformance: 0,
        avgPerformance: 0,
        effectiveness: 0,
        lastUpdated: Date.now()
      });
    }

    const pattern = this.transferPatterns.get(transferKey);
    pattern.attempts++;
    pattern.totalPerformance += performance;
    pattern.avgPerformance = pattern.totalPerformance / pattern.attempts;

    // Success if performance > 0.6
    if (performance > 0.6) {
      pattern.successes++;
    }

    // Effectiveness = success rate + performance boost
    pattern.effectiveness = (pattern.successes / pattern.attempts) * pattern.avgPerformance;
    pattern.lastUpdated = Date.now();

    // Log significant transfer patterns
    if (pattern.attempts === 10 || pattern.attempts % 50 === 0) {
      console.log(`[${this.name}] 🔄 Transfer pattern: ${transferKey} - ${(pattern.effectiveness * 100).toFixed(0)}% effective (${pattern.attempts} attempts)`);
    }

    return pattern;
  }

  /**
   * 🔍 DETECT TRANSFER OPPORTUNITIES: Identify potential transfer learning opportunities
   *
   * Analyzes:
   * - Current capability gaps
   * - Successful transfer patterns from history
   * - Domain similarities
   *
   * Returns suggestions for leveraging transfer learning.
   */
  async detectTransferOpportunities(targetDomain) {
    const opportunities = [];

    // Find all successful transfers TO the target domain
    for (const [transferKey, pattern] of this.transferPatterns) {
      if (pattern.target === targetDomain && pattern.effectiveness > 0.5) {
        opportunities.push({
          type: 'historical_transfer',
          source: pattern.source,
          target: pattern.target,
          effectiveness: pattern.effectiveness,
          confidence: Math.min(1.0, pattern.attempts / 20), // More attempts = higher confidence
          suggestion: `Training in ${pattern.source} has ${(pattern.effectiveness * 100).toFixed(0)}% effectiveness for improving ${targetDomain}`,
          priority: pattern.effectiveness
        });
      }
    }

    // Find similar domains that might transfer well (based on strategy similarity)
    const targetStrategies = this._getDomainStrategies(targetDomain);

    for (const [domain, strategies] of this._getAllDomainStrategies()) {
      if (domain === targetDomain) continue;

      // Calculate strategy overlap
      const overlap = this._calculateStrategyOverlap(targetStrategies, strategies);

      if (overlap > 0.6) {
        opportunities.push({
          type: 'similar_domain',
          source: domain,
          target: targetDomain,
          effectiveness: overlap,
          confidence: 0.5, // Lower confidence for predicted transfers
          suggestion: `${domain} has ${(overlap * 100).toFixed(0)}% strategy similarity with ${targetDomain} - likely good transfer candidate`,
          priority: overlap * 0.8 // Lower priority than proven transfers
        });
      }
    }

    // Sort by priority
    opportunities.sort((a, b) => b.priority - a.priority);

    return opportunities;
  }

  /**
   * 📊 GET TRANSFER SUGGESTIONS: Get actionable transfer learning suggestions
   *
   * Provides specific training recommendations based on transfer patterns.
   */
  async getTransferSuggestions(options = {}) {
    const {
      targetDomain = null,
      minEffectiveness = 0.5,
      maxSuggestions = 10
    } = options;

    const suggestions = [];

    // 1. Suggestions for specific target domain
    if (targetDomain) {
      const opportunities = await this.detectTransferOpportunities(targetDomain);

      for (const opp of opportunities.slice(0, 5)) {
        suggestions.push({
          type: 'transfer_training',
          action: 'train_on_source_domain',
          sourceDomain: opp.source,
          targetDomain: opp.target,
          effectiveness: opp.effectiveness,
          rationale: opp.suggestion,
          priority: opp.priority,
          estimatedImprovement: `+${(opp.effectiveness * 30).toFixed(0)}%` // Rough estimate
        });
      }
    }

    // 2. General transfer patterns (top transferrable domains)
    const topTransfers = Array.from(this.transferPatterns.values())
      .filter(p => p.effectiveness >= minEffectiveness && p.attempts >= 5)
      .sort((a, b) => b.effectiveness - a.effectiveness)
      .slice(0, maxSuggestions);

    for (const pattern of topTransfers) {
      suggestions.push({
        type: 'proven_transfer',
        action: 'leverage_transfer_pattern',
        sourceDomain: pattern.source,
        targetDomain: pattern.target,
        effectiveness: pattern.effectiveness,
        rationale: `Proven transfer: ${pattern.source} → ${pattern.target} (${(pattern.effectiveness * 100).toFixed(0)}% effective, ${pattern.attempts} attempts)`,
        priority: pattern.effectiveness,
        estimatedImprovement: `+${(pattern.effectiveness * 30).toFixed(0)}%`
      });
    }

    // 3. Cross-domain synthesis opportunities (high diversity transfers)
    const crossDomainPairs = this._findCrossDomainOpportunities();

    for (const pair of crossDomainPairs.slice(0, 3)) {
      suggestions.push({
        type: 'cross_domain_synthesis',
        action: 'train_synthesis',
        sourceDomain: pair.domainA,
        targetDomain: pair.domainB,
        effectiveness: pair.potential,
        rationale: `Cross-domain synthesis: ${pair.domainA} + ${pair.domainB} = ${pair.synergy}`,
        priority: pair.potential * 0.7, // Lower priority (experimental)
        estimatedImprovement: `+${(pair.potential * 40).toFixed(0)}%` // Higher potential for synthesis
      });
    }

    // Sort all suggestions by priority
    suggestions.sort((a, b) => b.priority - a.priority);

    // Limit results
    return suggestions.slice(0, maxSuggestions);
  }

  /**
   * Helper: Get strategies used in a domain
   */
  _getDomainStrategies(domain) {
    const strategies = new Set();

    for (const [contextKey, strategyMap] of this.contextualStrategies) {
      const context = JSON.parse(contextKey);
      if (context.agent?.toLowerCase().includes(domain.toLowerCase())) {
        for (const strategy of strategyMap.keys()) {
          strategies.add(strategy);
        }
      }
    }

    return strategies;
  }

  /**
   * Helper: Get all domain→strategies mappings
   */
  _getAllDomainStrategies() {
    const domainStrategies = new Map();

    for (const [contextKey, strategyMap] of this.contextualStrategies) {
      const context = JSON.parse(contextKey);
      const agent = context.agent || 'unknown';

      if (!domainStrategies.has(agent)) {
        domainStrategies.set(agent, new Set());
      }

      for (const strategy of strategyMap.keys()) {
        domainStrategies.get(agent).add(strategy);
      }
    }

    return domainStrategies;
  }

  /**
   * Helper: Calculate strategy overlap between two domains
   */
  _calculateStrategyOverlap(strategiesA, strategiesB) {
    if (strategiesA.size === 0 || strategiesB.size === 0) return 0;

    const intersection = new Set([...strategiesA].filter(s => strategiesB.has(s)));
    const union = new Set([...strategiesA, ...strategiesB]);

    return intersection.size / union.size; // Jaccard similarity
  }

  /**
   * Helper: Find cross-domain synthesis opportunities
   */
  _findCrossDomainOpportunities() {
    const domains = Array.from(this._getAllDomainStrategies().keys());
    const opportunities = [];

    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const domainA = domains[i];
        const domainB = domains[j];

        // Check if domains are different enough for synthesis
        const strategiesA = this._getDomainStrategies(domainA);
        const strategiesB = this._getDomainStrategies(domainB);
        const overlap = this._calculateStrategyOverlap(strategiesA, strategiesB);

        // Good synthesis candidates: 20-50% overlap (not too similar, not too different)
        if (overlap >= 0.2 && overlap <= 0.5) {
          opportunities.push({
            domainA,
            domainB,
            overlap,
            potential: 1 - Math.abs(overlap - 0.35) / 0.35, // Peak at 35% overlap
            synergy: `Novel combinations from ${(1 - overlap) * 100}% unique strategies`
          });
        }
      }
    }

    return opportunities.sort((a, b) => b.potential - a.potential);
  }

  /**
   * Check if domain has good transfer learning history
   */
  _hasGoodTransferHistory(domain) {
    for (const [pattern, patternData] of this.transferPatterns) {
      if (pattern.endsWith(`->${domain}`) && patternData.effectiveness > 0.7) {
        return true;
      }
    }
    return false;
  }

  /**
   * Categorize experience for few-shot learning
   * @private
   */
  categorizeExperience(experience) {
    const input = experience.input || experience.state?.context?.query || '';
    const inputLower = input.toLowerCase();

    // Keyword-based categorization
    if (/\b(code|debug|function|error|bug)\b/.test(inputLower)) return 'technical';
    if (/\b(creative|story|write|imagine)\b/.test(inputLower)) return 'creative';
    if (/\b(plan|roadmap|strategy|goal)\b/.test(inputLower)) return 'planning';
    if (/\b(explain|what|why|how|understand)\b/.test(inputLower)) return 'explanation';
    if (/\b(math|calculate|compute|solve)\b/.test(inputLower)) return 'mathematical';
    if (/\b(analyze|compare|evaluate|assess)\b/.test(inputLower)) return 'analytical';

    return 'general';
  }

  /**
   * Extract high-quality exemplar for few-shot learning
   * Stores best examples per category for rapid learning
   */
  async extractExemplar(experience) {
    const category = experience.category || this.categorizeExperience(experience);

    if (!this.fewShotExemplars.has(category)) {
      this.fewShotExemplars.set(category, []);
    }

    const exemplars = this.fewShotExemplars.get(category);

    // Add this exemplar
    exemplars.push({
      input: experience.state?.context?.query || experience.input,
      output: experience.outcome,
      reward: experience.reward,
      timestamp: Date.now(),
      metadata: experience.metadata
    });

    // Keep only top N exemplars per category
    exemplars.sort((a, b) => b.reward - a.reward);
    if (exemplars.length > this.metaParams.fewShotExamples) {
      exemplars.splice(this.metaParams.fewShotExamples);
    }

    this.stats.totalExemplars = Array.from(this.fewShotExemplars.values())
      .reduce((sum, arr) => sum + arr.length, 0);

    console.log(`[${this.name}] 🎯 Exemplar extracted: ${category} (reward: ${experience.reward.toFixed(2)})`);

    this.emit('exemplar_extracted', { category, reward: experience.reward });
  }

  /**
   * Update curriculum stage based on performance
   * Implements progressive difficulty learning
   */
  async updateCurriculum(experience) {
    const currentStage = this.curriculum.stages[this.curriculum.stage];

    // Update running accuracy for current stage
    const successRate = experience.reward;
    this.curriculum.currentAccuracy =
      this.curriculum.currentAccuracy * 0.95 + successRate * 0.05;

    // Check if ready to progress
    if (this.curriculum.currentAccuracy >= currentStage.minAccuracy) {
      if (!this.curriculum.readyForNext && this.curriculum.stage < this.curriculum.stages.length - 1) {
        this.curriculum.readyForNext = true;
        console.log(`[${this.name}] 📈 Ready to advance to next curriculum stage!`);
        this.emit('curriculum_ready', {
          currentStage: this.curriculum.stage,
          nextStage: this.curriculum.stage + 1
        });
      }
    }

    this.stats.curriculumStage = this.curriculum.stage;
  }

  /**
   * Flag uncertain cases for active learning
   * Identifies cases where human feedback would be valuable
   */
  async flagForActiveLearning(experience) {
    this.activeLearningQueue.push({
      input: experience.input,
      output: experience.outcome,
      confidence: experience.confidence,
      timestamp: Date.now()
    });

    // Keep only last 50 uncertain queries
    if (this.activeLearningQueue.length > 50) {
      this.activeLearningQueue.shift();
    }

    this.stats.activeQueriesAsked++;

    console.log(`[${this.name}] ❓ Uncertain case flagged for active learning (confidence: ${experience.confidence.toFixed(2)})`);

    this.emit('active_learning_flag', {
      confidence: experience.confidence,
      queueSize: this.activeLearningQueue.length
    });
  }

  /**
   * Advance curriculum to next stage
   * Called when current stage mastery is achieved
   */
  async advanceCurriculum() {
    if (this.curriculum.stage >= this.curriculum.stages.length - 1) {
      console.log(`[${this.name}] 🎓 Curriculum complete! Master level reached.`);
      return false;
    }

    this.curriculum.stage++;
    this.curriculum.currentAccuracy = 0;
    this.curriculum.readyForNext = false;
    this.stats.curriculumStage = this.curriculum.stage;

    const newStage = this.curriculum.stages[this.curriculum.stage];
    console.log(`[${this.name}] 📚 Advanced to curriculum stage ${this.curriculum.stage}: ${newStage.name}`);
    console.log(`[${this.name}]    Difficulty: ${newStage.difficulty}, Target Accuracy: ${newStage.minAccuracy}`);

    this.emit('curriculum_advanced', {
      stage: this.curriculum.stage,
      stageName: newStage.name,
      difficulty: newStage.difficulty
    });

    return true;
  }

  /**
   * Export meta-learning data for training
   * @param {string} outputPath - Path to save the dataset
   * @returns {string} - The path to the saved dataset
   */
  async exportTrainingDataset(outputPath) {
    console.log(`[${this.name}] 📚 Exporting meta-learning dataset to ${outputPath}...`);
    
    const examples = [];
    
    // 1. Export strategy performances
    for (const [strategyName, perf] of this.strategyPerformance) {
      if (perf.timesUsed > 0) {
        examples.push({
          input: `What is the optimal learning strategy for ${strategyName}?`,
          output: `Based on my meta-learning, the ${strategyName} strategy has an average reward of ${perf.avgReward.toFixed(2)} after ${perf.timesUsed} uses.`,
          source: 'meta_learning_strategy',
          weight: 0.9
        });
      }
    }
    
    // 2. Export current meta-parameters
    examples.push({
      input: "What are your current optimized meta-parameters?",
      output: `My current optimized meta-parameters are: Learning Rate: ${this.metaParams.defaultLearningRate.toFixed(3)}, Exploration Rate: ${(this.metaParams.explorationRate * 100).toFixed(0)}%, Replay Ratio: ${(this.metaParams.experienceReplayRatio * 100).toFixed(0)}%.`,
      source: 'meta_learning_params',
      weight: 1.0
    });
    
    // 3. Export domain learning curves
    for (const [domain, curve] of this.learningCurves) {
      if (curve.length > 0) {
        const avgReward = curve.reduce((sum, p) => sum + p.reward, 0) / curve.length;
        examples.push({
          input: `How well am I learning in the ${domain} domain?`,
          output: `In the ${domain} domain, I have an average proficiency reward of ${avgReward.toFixed(2)} based on ${curve.length} learning points.`,
          source: 'meta_learning_domain',
          weight: 0.8
        });
      }
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    // Write as JSONL
    const jsonl = examples.map(ex => JSON.stringify(ex)).join('\n');
    await fs.writeFile(outputPath, jsonl, 'utf8');
    
    console.log(`[${this.name}] ✅ Exported ${examples.length} meta-learning examples`);
    return outputPath;
  }
}

export default MetaLearningEngine;
