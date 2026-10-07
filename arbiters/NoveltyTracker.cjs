// ═══════════════════════════════════════════════════════════
// FILE: arbiters/NoveltyTracker.cjs
// Tracks solution uniqueness and rewards exploration over exploitation
// Penalizes repetitive patterns and promotes creative diversity
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const crypto = require('crypto');

class NoveltyTracker extends BaseArbiter {
  static role = 'novelty-tracker';
  static capabilities = ['track-uniqueness', 'score-novelty', 'detect-repetition', 'reward-exploration'];

  constructor(config = {}) {
    super(config);

    // Solution archive (for novelty comparison)
    this.solutionArchive = new Map(); // solutionHash -> { count, contexts, lastUsed }
    this.patternArchive = new Map();  // patternHash -> { count, variations }

    // Approach tracking
    this.approachHistory = []; // Recent approaches used
    this.historyWindow = config.historyWindow || 100; // Last 100 solutions

    // Novelty thresholds
    this.thresholds = {
      novel: 0.7,        // >70% = novel
      derivative: 0.4,   // 40-70% = derivative
      repetitive: 0.4    // <40% = repetitive
    };

    // Repetition penalties
    this.penalties = {
      exactRepeat: 0.5,           // 50% penalty for exact repeats
      minorVariation: 0.3,        // 30% penalty for minor variations
      commonPattern: 0.2,         // 20% penalty for common patterns
      overusedApproach: 0.15      // 15% penalty for overused approach
    };

    // Exploration rewards
    this.rewards = {
      newPattern: 0.3,            // 30% bonus for new patterns
      uniqueApproach: 0.4,        // 40% bonus for unique approaches
      creativeSynthesis: 0.5,     // 50% bonus for creative synthesis
      breakthroughNovelty: 0.7    // 70% bonus for breakthrough novelty
    };

    // Statistics
    this.stats = {
      solutionsEvaluated: 0,
      novelSolutions: 0,
      repetitiveSolutions: 0,
      avgNoveltyScore: 0,
      uniquePatterns: 0,
      mostRepeatedPattern: null,
      explorationRate: 0 // % of solutions that are novel
    };

    // Diversity tracking
    this.diversityMetrics = {
      paradigmDistribution: new Map(), // paradigm -> count
      approachDistribution: new Map(), // approach -> count
      entropyScore: 0 // Shannon entropy of approach distribution
    };

    this.logger.info(`[${this.name}] 🎨 NoveltyTracker initializing...`);
    this.logger.info(`[${this.name}] Rewarding exploration and creative diversity`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    this.logger.info(`[${this.name}] ✅ Novelty tracking system active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: NoveltyTracker.role,
        capabilities: NoveltyTracker.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // Solution evaluation
    messageBroker.subscribe(this.name, 'evaluate_novelty');
    messageBroker.subscribe(this.name, 'solution_proposed');
    messageBroker.subscribe(this.name, 'solution_deployed');

    // Pattern tracking
    messageBroker.subscribe(this.name, 'pattern_detected');
    messageBroker.subscribe(this.name, 'approach_used');

    this.logger.info(`[${this.name}] Subscribed to message types`);
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload, from } = message;

      switch (type) {
        case 'evaluate_novelty':
          return await this.evaluateNovelty(payload);

        case 'solution_proposed':
          return await this.scoreSolution(payload);

        case 'solution_deployed':
          return await this.recordSolution(payload);

        case 'pattern_detected':
          return this.recordPattern(payload);

        case 'approach_used':
          return this.recordApproach(payload);

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ NOVELTY EVALUATION ░░
  // ═══════════════════════════════════════════════════════════

  async evaluateNovelty(payload) {
    const { solution, context = {} } = payload;

    this.stats.solutionsEvaluated++;

    // Generate hash for solution
    const solutionHash = this._hashSolution(solution);

    // Check if exact repeat
    if (this.solutionArchive.has(solutionHash)) {
      const archived = this.solutionArchive.get(solutionHash);
      archived.count++;
      archived.lastUsed = Date.now();

      this.stats.repetitiveSolutions++;

      this.logger.warn(`[${this.name}] 🔁 Exact repeat detected (used ${archived.count}x)`);

      return {
        success: true,
        noveltyScore: this._calculateBaseNovelty() - this.penalties.exactRepeat,
        classification: 'repetitive',
        penalty: this.penalties.exactRepeat,
        reason: 'Exact solution already in archive'
      };
    }

    // Extract patterns and approaches
    const patterns = this._extractPatterns(solution);
    const approach = this._identifyApproach(solution, context);

    // Calculate novelty score
    const noveltyScore = this._calculateNoveltyScore(solution, patterns, approach);

    // Classify
    let classification;
    if (noveltyScore >= this.thresholds.novel) {
      classification = 'novel';
      this.stats.novelSolutions++;
    } else if (noveltyScore >= this.thresholds.derivative) {
      classification = 'derivative';
    } else {
      classification = 'repetitive';
      this.stats.repetitiveSolutions++;
    }

    // Update statistics
    this._updateAverageNoveltyScore(noveltyScore);
    this._updateExplorationRate();

    this.logger.info(`[${this.name}] 🎯 Novelty: ${(noveltyScore * 100).toFixed(0)}% - ${classification.toUpperCase()}`);

    return {
      success: true,
      noveltyScore,
      classification,
      patterns,
      approach,
      rewards: this._calculateRewards(noveltyScore, patterns, approach),
      recommendation: this._getRecommendation(classification, noveltyScore)
    };
  }

  async scoreSolution(payload) {
    return await this.evaluateNovelty(payload);
  }

  async recordSolution(payload) {
    const { solution, success, metrics } = payload;

    const solutionHash = this._hashSolution(solution);

    // Add to archive
    if (!this.solutionArchive.has(solutionHash)) {
      this.solutionArchive.set(solutionHash, {
        solution,
        count: 1,
        contexts: [metrics?.context || 'unknown'],
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        lastUsed: Date.now(),
        firstUsed: Date.now()
      });
    } else {
      const archived = this.solutionArchive.get(solutionHash);
      archived.count++;
      archived.lastUsed = Date.now();
      if (success) {
        archived.successCount++;
      } else {
        archived.failureCount++;
      }
    }

    // Add to recent history
    this.approachHistory.push({
      hash: solutionHash,
      timestamp: Date.now(),
      success
    });

    // Trim history
    if (this.approachHistory.length > this.historyWindow) {
      this.approachHistory.shift();
    }

    return { success: true };
  }

  recordPattern(payload) {
    const { pattern, context } = payload;

    const patternHash = this._hashPattern(pattern);

    if (!this.patternArchive.has(patternHash)) {
      this.patternArchive.set(patternHash, {
        pattern,
        count: 1,
        variations: 1,
        contexts: [context]
      });
      this.stats.uniquePatterns++;
    } else {
      const archived = this.patternArchive.get(patternHash);
      archived.count++;
      if (!archived.contexts.includes(context)) {
        archived.variations++;
        archived.contexts.push(context);
      }
    }

    return { success: true };
  }

  recordApproach(payload) {
    const { approach, paradigm } = payload;

    // Track paradigm distribution
    const currentCount = this.diversityMetrics.paradigmDistribution.get(paradigm) || 0;
    this.diversityMetrics.paradigmDistribution.set(paradigm, currentCount + 1);

    // Track approach distribution
    const approachCount = this.diversityMetrics.approachDistribution.get(approach) || 0;
    this.diversityMetrics.approachDistribution.set(approach, approachCount + 1);

    // Recalculate diversity entropy
    this._calculateDiversityEntropy();

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ NOVELTY CALCULATION ░░
  // ═══════════════════════════════════════════════════════════

  _calculateNoveltyScore(solution, patterns, approach) {
    let score = this._calculateBaseNovelty();

    // Penalty for repeated patterns
    for (const pattern of patterns) {
      const patternHash = this._hashPattern(pattern);
      if (this.patternArchive.has(patternHash)) {
        const archived = this.patternArchive.get(patternHash);
        const repetitionPenalty = Math.min(0.3, archived.count * 0.05);
        score -= repetitionPenalty;
      } else {
        // New pattern - bonus!
        score += this.rewards.newPattern;
      }
    }

    // Penalty for overused approaches
    const approachCount = this.diversityMetrics.approachDistribution.get(approach) || 0;
    if (approachCount > 5) {
      score -= this.penalties.overusedApproach * (approachCount / 10);
    } else if (approachCount === 0) {
      // New approach - bonus!
      score += this.rewards.uniqueApproach;
    }

    // Bonus for high diversity
    if (this.diversityMetrics.entropyScore > 2.0) {
      score += this.rewards.creativeSynthesis;
    }

    // Bonus for paradigm underuse
    const paradigm = this._identifyParadigm(solution);
    const paradigmCount = this.diversityMetrics.paradigmDistribution.get(paradigm) || 0;
    const avgParadigmCount = this._getAverageParadigmCount();
    if (paradigmCount < avgParadigmCount * 0.5) {
      // Underused paradigm - encourage diversity
      score += 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }

  _calculateBaseNovelty() {
    // Start with assumption of moderate novelty
    return 0.5;
  }

  _calculateRewards(noveltyScore, patterns, approach) {
    const rewards = [];

    if (noveltyScore >= 0.9) {
      rewards.push({ type: 'breakthrough', bonus: this.rewards.breakthroughNovelty });
    }

    const newPatterns = patterns.filter(p => !this.patternArchive.has(this._hashPattern(p)));
    if (newPatterns.length > 0) {
      rewards.push({ type: 'new_pattern', bonus: this.rewards.newPattern, count: newPatterns.length });
    }

    const approachCount = this.diversityMetrics.approachDistribution.get(approach) || 0;
    if (approachCount === 0) {
      rewards.push({ type: 'unique_approach', bonus: this.rewards.uniqueApproach });
    }

    return rewards;
  }

  _getRecommendation(classification, noveltyScore) {
    if (classification === 'repetitive') {
      return {
        message: 'Solution lacks novelty - seek alternative approaches',
        suggestion: 'Try different paradigm or creative synthesis',
        priority: 'high'
      };
    } else if (classification === 'derivative') {
      return {
        message: 'Solution is derivative - moderate novelty',
        suggestion: 'Build on this but explore variations',
        priority: 'medium'
      };
    } else {
      return {
        message: 'Novel solution detected - high exploration value',
        suggestion: 'Deploy and monitor for breakthroughs',
        priority: 'low'
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PATTERN EXTRACTION ░░
  // ═══════════════════════════════════════════════════════════

  _extractPatterns(solution) {
    const patterns = [];

    if (typeof solution !== 'string') {
      return patterns;
    }

    // Extract structural patterns
    if (solution.includes('for') && solution.includes('loop')) {
      patterns.push('for-loop');
    }
    if (solution.includes('map') || solution.includes('filter')) {
      patterns.push('functional-array-methods');
    }
    if (solution.includes('async') && solution.includes('await')) {
      patterns.push('async-await');
    }
    if (solution.includes('class') || solution.includes('constructor')) {
      patterns.push('object-oriented');
    }
    if (solution.includes('reduce')) {
      patterns.push('reduction');
    }
    if (solution.includes('recursiv')) {
      patterns.push('recursion');
    }
    if (solution.includes('memoiz')) {
      patterns.push('memoization');
    }
    if (solution.includes('cache')) {
      patterns.push('caching');
    }

    return patterns;
  }

  _identifyApproach(solution, context) {
    // Identify high-level approach
    const approaches = this._extractPatterns(solution);

    if (approaches.includes('recursion')) return 'recursive';
    if (approaches.includes('functional-array-methods')) return 'functional';
    if (approaches.includes('for-loop')) return 'iterative';
    if (approaches.includes('object-oriented')) return 'oop';
    if (approaches.includes('memoization')) return 'memoized';

    return 'imperative';
  }

  _identifyParadigm(solution) {
    const patterns = this._extractPatterns(solution);

    if (patterns.includes('functional-array-methods') && patterns.includes('recursion')) {
      return 'functional';
    }
    if (patterns.includes('object-oriented')) {
      return 'object-oriented';
    }
    if (patterns.includes('recursion')) {
      return 'recursive';
    }
    if (patterns.includes('for-loop')) {
      return 'imperative';
    }

    return 'procedural';
  }

  _hashSolution(solution) {
    // 🛡️ Safety Check: Prevent crash on undefined/null
    if (solution === undefined || solution === null) {
        return crypto.createHash('md5').update('null_state').digest('hex');
    }

    const normalized = typeof solution === 'string'
      ? solution.replace(/\s+/g, '').toLowerCase()
      : JSON.stringify(solution);
    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  _hashPattern(pattern) {
    return crypto.createHash('md5').update(pattern).digest('hex');
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ DIVERSITY METRICS ░░
  // ═══════════════════════════════════════════════════════════

  _calculateDiversityEntropy() {
    // Shannon entropy of approach distribution
    const total = Array.from(this.diversityMetrics.approachDistribution.values())
      .reduce((sum, count) => sum + count, 0);

    if (total === 0) {
      this.diversityMetrics.entropyScore = 0;
      return;
    }

    let entropy = 0;
    for (const count of this.diversityMetrics.approachDistribution.values()) {
      const p = count / total;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }

    this.diversityMetrics.entropyScore = entropy;
  }

  _getAverageParadigmCount() {
    const counts = Array.from(this.diversityMetrics.paradigmDistribution.values());
    if (counts.length === 0) return 0;
    return counts.reduce((sum, c) => sum + c, 0) / counts.length;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATISTICS ░░
  // ═══════════════════════════════════════════════════════════

  _updateAverageNoveltyScore(newScore) {
    const total = this.stats.solutionsEvaluated;
    this.stats.avgNoveltyScore =
      (this.stats.avgNoveltyScore * (total - 1) + newScore) / total;
  }

  _updateExplorationRate() {
    if (this.stats.solutionsEvaluated === 0) {
      this.stats.explorationRate = 0;
      return;
    }

    this.stats.explorationRate =
      this.stats.novelSolutions / this.stats.solutionsEvaluated;
  }

  getStatistics() {
    // Find most repeated pattern
    let mostRepeated = null;
    let maxCount = 0;

    for (const [hash, data] of this.patternArchive) {
      if (data.count > maxCount) {
        maxCount = data.count;
        mostRepeated = data.pattern;
      }
    }

    return {
      ...this.stats,
      mostRepeatedPattern: mostRepeated ? `${mostRepeated} (${maxCount}x)` : 'None',
      explorationRate: (this.stats.explorationRate * 100).toFixed(1) + '%',
      avgNoveltyScore: (this.stats.avgNoveltyScore * 100).toFixed(1) + '%',
      diversityMetrics: {
        entropyScore: this.diversityMetrics.entropyScore.toFixed(2),
        paradigms: this.diversityMetrics.paradigmDistribution.size,
        approaches: this.diversityMetrics.approachDistribution.size
      }
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

module.exports = { NoveltyTracker };
