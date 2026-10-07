/**
 * AdaptiveLearningPlanner.js - Intelligent Learning Topic Selection
 *
 * THE CURIOSITY ENGINE - Decides what SOMA should learn based on:
 * 1. Knowledge gaps (what she doesn't know)
 * 2. Usefulness (what topics help her perform better)
 * 3. User interests (what the user asks about)
 * 4. Recency (avoid stale knowledge)
 * 5. Success rate (prioritize topics that lead to successful outcomes)
 *
 * (StrategyOptimizer dependency removed for stability)
 */

import EventEmitter from 'events';
// import { getStrategyOptimizer } from './StrategyOptimizer.js'; // REMOVED
import { getOutcomeTracker } from './OutcomeTracker.js';

class AdaptiveLearningPlanner extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Topic selection
      maxTopicsPerSession: config.maxTopicsPerSession || 5,
      minTopicQuality: config.minTopicQuality || 0.3,

      // Learning domains
      domains: config.domains || [
        'programming_languages',
        'frameworks_libraries',
        'system_architecture',
        'algorithms_datastructures',
        'best_practices',
        'user_specific'
      ],

      // Topic quality scoring
      recencyWeight: config.recencyWeight || 0.3,
      usefulnessWeight: config.usefulnessWeight || 0.4,
      gapWeight: config.gapWeight || 0.3,

      ...config
    };

    // Knowledge tracking
    this.knowledgeGraph = new Map(); // topic -> { lastLearned, useCount, successRate, quality }
    this.userInterests = new Map(); // topic -> frequency
    this.recentTasks = []; // Recent task history
    this.knowledgeGaps = new Set(); // Identified gaps

    // Integration
    // this.strategyOptimizer = getStrategyOptimizer(); // REMOVED
    this.outcomeTracker = getOutcomeTracker();
  }

  /**
   * Initialize the learning planner
   */
  async initialize() {
    console.log('🧠 Initializing AdaptiveLearningPlanner...');

    // Load historical learning outcomes
    await this.analyzeHistoricalLearning();

    // Build user interest profile
    await this.buildUserInterestProfile();

    // Subscribe to live outcome events so knowledge graph adapts in real-time
    // (previously only updated via historical queryOutcomes() on startup)
    this.outcomeTracker.on('outcome', (outcome) => {
      const topic = outcome.context?.topic || outcome.metadata?.topic;
      if (!topic) return;
      if (!this.knowledgeGraph.has(topic)) {
        this.knowledgeGraph.set(topic, { topic, lastLearned: 0, useCount: 0, successRate: 0, successes: 0, failures: 0, avgReward: 0, totalReward: 0 });
      }
      const k = this.knowledgeGraph.get(topic);
      k.lastLearned = Date.now();
      if (outcome.success) { k.successes++; } else { k.failures++; }
      k.totalReward += outcome.reward || 0;
      k.avgReward = k.totalReward / (k.successes + k.failures);
      k.successRate = k.successes / (k.successes + k.failures);
    });

    console.log(`   ✅ AdaptiveLearningPlanner ready`);
    console.log(`      - Knowledge graph: ${this.knowledgeGraph.size} topics`);
    console.log(`      - User interests: ${this.userInterests.size} topics`);
    console.log(`      - Knowledge gaps: ${this.knowledgeGaps.size} gaps`);

    this.emit('initialized');
  }

  /**
   * Analyze historical learning outcomes to see what worked
   */
  async analyzeHistoricalLearning() {
    const outcomes = this.outcomeTracker.queryOutcomes({
      action: 'autonomous_learning',
      limit: 1000
    });

    for (const outcome of outcomes) {
      const topic = outcome.context?.topic || outcome.metadata?.topic;
      if (!topic) continue;

      if (!this.knowledgeGraph.has(topic)) {
        this.knowledgeGraph.set(topic, {
          topic,
          lastLearned: 0,
          useCount: 0,
          successRate: 0,
          successes: 0,
          failures: 0,
          avgReward: 0,
          totalReward: 0
        });
      }

      const knowledge = this.knowledgeGraph.get(topic);
      knowledge.lastLearned = Math.max(knowledge.lastLearned, outcome.timestamp);

      if (outcome.success) {
        knowledge.successes++;
      } else {
        knowledge.failures++;
      }

      knowledge.totalReward += outcome.reward || 0;
      knowledge.avgReward = knowledge.totalReward / (knowledge.successes + knowledge.failures);
      knowledge.successRate = knowledge.successes / (knowledge.successes + knowledge.failures);
    }

    console.log(`   📊 Analyzed ${outcomes.length} learning outcomes`);
  }

  /**
   * Build user interest profile from recent interactions
   */
  async buildUserInterestProfile() {
    const outcomes = this.outcomeTracker.queryOutcomes({
      limit: 500,
      agent: 'user_interaction'
    });

    for (const outcome of outcomes) {
      const topics = this.extractTopicsFromContext(outcome.context);

      for (const topic of topics) {
        const count = this.userInterests.get(topic) || 0;
        this.userInterests.set(topic, count + 1);
      }
    }

    console.log(`   👤 Built user interest profile from ${outcomes.length} interactions`);
  }

  /**
   * Extract topics from context (keywords, technologies mentioned)
   */
  extractTopicsFromContext(context) {
    const topics = new Set();

    if (!context) return topics;

    // Common technology keywords
    const techKeywords = [
      'javascript', 'typescript', 'python', 'rust', 'go', 'java',
      'react', 'vue', 'angular', 'node', 'express', 'fastapi',
      'docker', 'kubernetes', 'aws', 'azure', 'gcp',
      'sql', 'nosql', 'mongodb', 'postgres', 'redis',
      'tensorflow', 'pytorch', 'ml', 'ai', 'llm'
    ];

    const contextStr = JSON.stringify(context).toLowerCase();

    for (const keyword of techKeywords) {
      if (contextStr.includes(keyword)) {
        topics.add(keyword);
      }
    }

    return topics;
  }

  /**
   * Identify knowledge gaps from recent failures
   */
  identifyKnowledgeGaps() {
    const recentFailures = this.outcomeTracker.queryOutcomes({
      success: false,
      limit: 100
    });

    for (const failure of recentFailures) {
      // Extract what knowledge would have helped
      const missingKnowledge = this.analyzeFailureForGaps(failure);

      for (const gap of missingKnowledge) {
        this.knowledgeGaps.add(gap);
      }
    }

    return Array.from(this.knowledgeGaps);
  }

  /**
   * Analyze a failure to identify what knowledge was missing
   */
  analyzeFailureForGaps(failure) {
    const gaps = new Set();

    // Check error messages for clues
    if (failure.result && failure.result.error) {
      const error = failure.result.error.toLowerCase();

      // API errors
      if (error.includes('api') || error.includes('endpoint')) {
        gaps.add('api_documentation');
      }

      // Type errors
      if (error.includes('type') || error.includes('undefined')) {
        gaps.add('typescript_advanced');
      }

      // Performance issues
      if (error.includes('timeout') || error.includes('memory')) {
        gaps.add('performance_optimization');
      }

      // Module errors
      if (error.includes('module') || error.includes('import')) {
        gaps.add('module_systems');
      }
    }

    return gaps;
  }

  /**
   * Select topics for next learning session
   */
  selectLearningTopics(domain = null, count = null) {
    count = count || this.config.maxTopicsPerSession;

    // Identify current knowledge gaps
    const gaps = this.identifyKnowledgeGaps();

    // Build candidate topics
    const candidates = new Map();

    // Add all known topics
    for (const [topic, knowledge] of this.knowledgeGraph.entries()) {
      candidates.set(topic, this.scoreTopicPriority(topic, knowledge, gaps));
    }

    // Add knowledge gaps (high priority)
    for (const gap of gaps) {
      if (!candidates.has(gap)) {
        candidates.set(gap, {
          topic: gap,
          score: 0.9, // High priority for gaps
          reason: 'Knowledge gap - needed to prevent failures'
        });
      } else {
        // Boost score if it's a gap
        const existing = candidates.get(gap);
        existing.score = Math.min(existing.score * 1.5, 1.0);
        existing.reason += ' [KNOWLEDGE GAP]';
      }
    }

    // Add user interests
    for (const [topic, frequency] of this.userInterests.entries()) {
      if (!candidates.has(topic)) {
        candidates.set(topic, {
          topic,
          score: Math.min(frequency / 10, 0.8),
          reason: `User interest (${frequency} mentions)`
        });
      } else {
        // Boost score based on user interest
        const existing = candidates.get(topic);
        existing.score = Math.min(existing.score + (frequency / 20), 1.0);
        existing.reason += ` [USER INTEREST: ${frequency}x]`;
      }
    }

    // Sort by score
    const sorted = Array.from(candidates.values())
      .filter(c => c.score >= this.config.minTopicQuality)
      .sort((a, b) => b.score - a.score);

    // Take top N
    const selected = sorted.slice(0, count);

    // Record selections
    for (const topic of selected) {
      this.emit('topic_selected', {
        topic: topic.topic,
        score: topic.score,
        reason: topic.reason
      });
    }

    return selected;
  }

  /**
   * Score a topic's priority for learning
   */
  scoreTopicPriority(topic, knowledge, gaps) {
    const now = Date.now();

    // Recency score (0-1): How long since we learned this?
    const daysSinceLastLearned = (now - knowledge.lastLearned) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.min(daysSinceLastLearned / 30, 1); // Full score after 30 days

    // Usefulness score (0-1): How often do we use this?
    const usefulnessScore = Math.min(knowledge.useCount / 10, 1);

    // Success rate score (0-1): Does this knowledge lead to success?
    const successScore = knowledge.successRate || 0;

    // User interest score (0-1)
    const userInterestCount = this.userInterests.get(topic) || 0;
    const interestScore = Math.min(userInterestCount / 5, 1);

    // Knowledge gap score (0-1)
    const gapScore = gaps.includes(topic) ? 1.0 : 0.0;

    // Weighted average
    const score =
      recencyScore * this.config.recencyWeight +
      usefulnessScore * this.config.usefulnessWeight +
      gapScore * this.config.gapWeight +
      successScore * 0.2 +
      interestScore * 0.2;

    return {
      topic,
      score,
      recencyScore,
      usefulnessScore,
      successScore,
      interestScore,
      gapScore,
      reason: this.explainTopicSelection(topic, {
        recencyScore,
        usefulnessScore,
        successScore,
        interestScore,
        gapScore
      })
    };
  }

  /**
   * Explain why a topic was selected
   */
  explainTopicSelection(topic, scores) {
    const reasons = [];

    if (scores.gapScore > 0) {
      reasons.push('Addresses knowledge gap');
    }

    if (scores.interestScore > 0.5) {
      reasons.push('High user interest');
    }

    if (scores.recencyScore > 0.7) {
      reasons.push('Not learned recently');
    }

    if (scores.successScore > 0.8) {
      reasons.push('High success rate');
    }

    if (scores.usefulnessScore > 0.6) {
      reasons.push('Frequently used');
    }

    return reasons.length > 0
      ? reasons.join(', ')
      : 'General knowledge expansion';
  }

  /**
   * Record learning outcome to improve future selections
   */
  recordLearningOutcome(topic, outcome) {
    // Update knowledge graph
    if (!this.knowledgeGraph.has(topic)) {
      this.knowledgeGraph.set(topic, {
        topic,
        lastLearned: Date.now(),
        useCount: 0,
        successRate: 0,
        successes: 0,
        failures: 0,
        avgReward: 0,
        totalReward: 0
      });
    }

    const knowledge = this.knowledgeGraph.get(topic);
    knowledge.lastLearned = Date.now();

    if (outcome.success) {
      knowledge.successes++;
      knowledge.useCount++;
    } else {
      knowledge.failures++;
    }

    knowledge.totalReward += outcome.reward || 0;
    knowledge.avgReward = knowledge.totalReward / (knowledge.successes + knowledge.failures);
    knowledge.successRate = knowledge.successes / (knowledge.successes + knowledge.failures);

    // REMOVED: Also record to StrategyOptimizer so it learns topic selection
    /*
    this.strategyOptimizer.recordOutcome('learning_topic_selection', topic, {
      success: outcome.success,
      reward: outcome.reward || (outcome.success ? 1 : 0)
    });
    */

    this.emit('learning_outcome_recorded', { topic, outcome, knowledge });
  }

  /**
   * Get recommended learning targets for edge crawlers
   */
  getRecommendedCrawlerTargets(maxTargets = 5) {
    const topics = this.selectLearningTopics(null, maxTargets * 2);

    // Map topics to crawler targets
    const targets = new Set();

    for (const topicInfo of topics) {
      const topic = topicInfo.topic;

      // Map topic to crawler target type
      if (topic.includes('documentation') || topic.includes('api')) {
        targets.add('documentation');
      }

      if (topic.includes('research') || topic.includes('paper')) {
        targets.add('research_papers');
      }

      if (topic.includes('code') || topic.includes('example')) {
        targets.add('code_examples');
      }

      if (topic.includes('practice') || topic.includes('pattern')) {
        targets.add('best_practices');
      }

      if (topic.includes('tutorial') || topic.includes('learn')) {
        targets.add('tutorials');
      }

      // Technology-specific
      if (topic.match(/javascript|typescript|node/)) {
        targets.add('javascript_docs');
      }

      if (topic.match(/python|pytorch|tensorflow/)) {
        targets.add('python_docs');
      }

      if (topic.match(/rust|cargo/)) {
        targets.add('rust_docs');
      }
    }

    return {
      targets: Array.from(targets).slice(0, maxTargets),
      topics: topics.slice(0, maxTargets),
      reasoning: topics.map(t => `${t.topic}: ${t.reason}`)
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      knownTopics: this.knowledgeGraph.size,
      userInterests: this.userInterests.size,
      knowledgeGaps: this.knowledgeGaps.size,
      topKnowledge: Array.from(this.knowledgeGraph.values())
        .sort((a, b) => b.avgReward - a.avgReward)
        .slice(0, 10)
        .map(k => ({
          topic: k.topic,
          successRate: (k.successRate * 100).toFixed(1) + '%',
          avgReward: k.avgReward.toFixed(3),
          useCount: k.useCount
        }))
    };
  }

  /**
   * Track user interaction to learn interests
   */
  trackUserInteraction(context) {
    const topics = this.extractTopicsFromContext(context);

    for (const topic of topics) {
      const count = this.userInterests.get(topic) || 0;
      this.userInterests.set(topic, count + 1);
    }

    this.emit('user_interaction_tracked', { topics: Array.from(topics) });
  }
}

// Singleton instance
let plannerInstance = null;

export function getAdaptiveLearningPlanner(config = {}) {
  if (!plannerInstance) {
    plannerInstance = new AdaptiveLearningPlanner(config);
  }
  return plannerInstance;
}

export default AdaptiveLearningPlanner;