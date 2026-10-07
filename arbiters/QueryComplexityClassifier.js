/**
 * QueryComplexityClassifier.js - Intelligent Query Routing
 *
 * Analyzes query complexity and routes to appropriate LLM:
 * - SIMPLE → Ollama (local, fast, free)
 * - MEDIUM → DeepSeek (cheap, capable)
 * - COMPLEX → OpenAI/Gemini (expensive, best quality)
 *
 * Saves costs by ~70% while maintaining quality for complex queries.
 */

import { EventEmitter } from 'events';
import { getKnowledgeAugmentedGenerator } from './KnowledgeAugmentedGenerator.js';

export class QueryComplexityClassifier extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Use SOMA's own knowledge as fallback
      useKnowledgeFallback: true,
      knowledgeFallbackPriority: 'before_llama', // 'before_llama' or 'after_llama'

      // Complexity thresholds (0-1 scale)
      simpleThreshold: 0.3,    // Below this = SIMPLE
      mediumThreshold: 0.6,    // Below this = MEDIUM, above = COMPLEX

      // Weights for complexity factors
      weights: {
        questionLength: 0.15,      // Longer = more complex
        technicalTerms: 0.25,      // More technical = more complex
        contextRequired: 0.20,     // Needs context = more complex
        reasoningDepth: 0.25,      // Multi-step = more complex
        domainSpecificity: 0.15    // Specialized = more complex
      },

      // Technical term patterns
      technicalPatterns: [
        // Programming
        /\b(algorithm|optimization|refactor|async|await|closure|recursion|polymorphism)\b/i,
        /\b(API|REST|GraphQL|WebSocket|OAuth|JWT|microservice)\b/i,
        /\b(neural network|machine learning|deep learning|transformer|gradient)\b/i,

        // System design
        /\b(architecture|scalability|distributed|consensus|CAP theorem|eventual consistency)\b/i,
        /\b(kubernetes|docker|container|orchestration|deployment)\b/i,

        // Math/Science
        /\b(derivative|integral|matrix|eigenvalue|probability|statistics)\b/i,
        /\b(quantum|relativity|thermodynamics|entropy)\b/i
      ],

      // Reasoning depth indicators
      reasoningPatterns: [
        /\b(why|how|explain|compare|analyze|evaluate|justify)\b/i,
        /\b(pros and cons|trade-?offs?|advantages|disadvantages)\b/i,
        /\b(best practice|optimal|efficient|performance)\b/i,
        /\b(design pattern|approach|strategy|methodology)\b/i
      ],

      // Context requirement indicators
      contextPatterns: [
        /\b(this code|above|previous|earlier|before)\b/i,
        /\b(in my project|my application|our system)\b/i,
        /\b(current|existing|ongoing)\b/i
      ],

      // Simple query patterns (override to SIMPLE)
      simplePatterns: [
        /^(what is|define|meaning of)\b/i,
        /^(yes|no|maybe|ok|sure|thanks)\b/i,
        /\b(hello|hi|hey|greetings)\b/i,
        /\b(test|testing|demo)\b/i
      ],

      ...config
    };

    this.stats = {
      totalQueries: 0,
      simpleQueries: 0,
      mediumQueries: 0,
      complexQueries: 0,
      costSavings: 0,  // Estimated $ saved
      answeredFromKnowledge: 0  // Answered using SOMA's own knowledge
    };

    // Initialize Knowledge-Augmented Generator for fallback
    if (this.config.useKnowledgeFallback) {
      this.knowledgeGenerator = getKnowledgeAugmentedGenerator();
    }
  }

  /**
   * Classify query complexity
   * @param {string} query - The user query
   * @param {Object} context - Optional context (conversation history, etc.)
   * @returns {Object} Classification result with complexity level and recommended provider
   */
  classifyQuery(query, context = {}) {
    // Check if it's obviously simple
    for (const pattern of this.config.simplePatterns) {
      if (pattern.test(query)) {
        this.stats.totalQueries++;
        this.stats.simpleQueries++;

        return {
          complexity: 'SIMPLE',
          score: 0.1,
          recommendedProvider: 'ollama',
          fallbackProviders: ['deepseek', 'gemini', 'openai'],
          reasoning: 'Matched simple query pattern',
          factors: { pattern: 'simple_override' }
        };
      }
    }

    // Calculate complexity factors
    const factors = this.calculateComplexityFactors(query, context);

    // Weighted complexity score
    const score =
      factors.questionLength * this.config.weights.questionLength +
      factors.technicalTerms * this.config.weights.technicalTerms +
      factors.contextRequired * this.config.weights.contextRequired +
      factors.reasoningDepth * this.config.weights.reasoningDepth +
      factors.domainSpecificity * this.config.weights.domainSpecificity;

    // Determine complexity level
    let complexity, recommendedProvider, fallbackProviders;

    if (score < this.config.simpleThreshold) {
      complexity = 'SIMPLE';
      recommendedProvider = 'ollama';
      fallbackProviders = ['deepseek', 'gemini', 'openai'];
      this.stats.simpleQueries++;
      this.stats.costSavings += 0.15; // Saved ~$0.15 per 1M tokens vs OpenAI
    } else if (score < this.config.mediumThreshold) {
      complexity = 'MEDIUM';
      recommendedProvider = 'deepseek';
      fallbackProviders = ['gemini', 'openai', 'ollama'];
      this.stats.mediumQueries++;
      this.stats.costSavings += 0.01; // Saved ~$0.01 vs OpenAI
    } else {
      complexity = 'COMPLEX';
      recommendedProvider = 'openai';
      fallbackProviders = ['gemini', 'deepseek', 'ollama'];
      this.stats.complexQueries++;
      // No savings - using best model
    }

    this.stats.totalQueries++;

    const result = {
      complexity,
      score: Math.round(score * 100) / 100,
      recommendedProvider,
      fallbackProviders,
      reasoning: this.explainClassification(factors, score),
      factors
    };

    this.emit('query_classified', result);

    return result;
  }

  /**
   * Calculate individual complexity factors
   */
  calculateComplexityFactors(query, context) {
    const factors = {};

    // 1. Question Length (0-1 scale)
    // Short questions = simple, long questions = complex
    const words = query.trim().split(/\s+/).length;
    factors.questionLength = Math.min(words / 50, 1); // Normalize to 50 words = 1.0

    // 2. Technical Terms (0-1 scale)
    let technicalMatches = 0;
    for (const pattern of this.config.technicalPatterns) {
      const matches = query.match(pattern);
      if (matches) technicalMatches += matches.length;
    }
    factors.technicalTerms = Math.min(technicalMatches / 5, 1); // 5+ terms = 1.0

    // 3. Context Required (0-1 scale)
    let contextMatches = 0;
    for (const pattern of this.config.contextPatterns) {
      if (pattern.test(query)) contextMatches++;
    }
    factors.contextRequired = Math.min(contextMatches / 3, 1);

    // Boost if actual context provided
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      factors.contextRequired = Math.min(factors.contextRequired + 0.3, 1);
    }

    // 4. Reasoning Depth (0-1 scale)
    let reasoningMatches = 0;
    for (const pattern of this.config.reasoningPatterns) {
      const matches = query.match(pattern);
      if (matches) reasoningMatches += matches.length;
    }
    factors.reasoningDepth = Math.min(reasoningMatches / 3, 1);

    // Check for multi-step questions
    if (query.includes('?') && query.split('?').length > 2) {
      factors.reasoningDepth = Math.min(factors.reasoningDepth + 0.2, 1);
    }

    // 5. Domain Specificity (0-1 scale)
    // Check if query is about a specific domain
    const domainIndicators = [
      /\b(in|for|using|with) (python|javascript|rust|go|java|c\+\+)\b/i,
      /\b(react|vue|angular|django|flask|express|nextjs)\b/i,
      /\b(aws|azure|gcp|terraform|ansible)\b/i,
      /\b(pytorch|tensorflow|keras|scikit-learn)\b/i
    ];

    let domainMatches = 0;
    for (const pattern of domainIndicators) {
      if (pattern.test(query)) domainMatches++;
    }
    factors.domainSpecificity = Math.min(domainMatches / 2, 1);

    return factors;
  }

  /**
   * Explain why query was classified this way
   */
  explainClassification(factors, score) {
    const reasons = [];

    if (factors.questionLength > 0.5) {
      reasons.push('Long detailed question');
    } else if (factors.questionLength < 0.2) {
      reasons.push('Short simple question');
    }

    if (factors.technicalTerms > 0.6) {
      reasons.push('Heavy technical terminology');
    } else if (factors.technicalTerms > 0.3) {
      reasons.push('Some technical terms');
    }

    if (factors.reasoningDepth > 0.6) {
      reasons.push('Requires deep reasoning');
    } else if (factors.reasoningDepth > 0.3) {
      reasons.push('Moderate reasoning needed');
    }

    if (factors.contextRequired > 0.6) {
      reasons.push('Needs significant context');
    }

    if (factors.domainSpecificity > 0.5) {
      reasons.push('Domain-specific knowledge required');
    }

    if (reasons.length === 0) {
      reasons.push('General knowledge question');
    }

    return reasons.join(', ');
  }

  /**
   * Get routing recommendation with provider availability
   * @param {string} query - The user query
   * @param {Array} availableProviders - Currently available providers
   * @param {Object} context - Optional context
   */
  getRoutingRecommendation(query, availableProviders = [], context = {}) {
    const classification = this.classifyQuery(query, context);

    // Filter to only available providers
    let selectedProvider = classification.recommendedProvider;

    if (!availableProviders.includes(selectedProvider)) {
      // Fallback to first available provider from fallback list
      selectedProvider = classification.fallbackProviders.find(p =>
        availableProviders.includes(p)
      );

      if (!selectedProvider && availableProviders.length > 0) {
        // Just use first available
        selectedProvider = availableProviders[0];
      }
    }

    return {
      ...classification,
      selectedProvider,
      wasRecommended: selectedProvider === classification.recommendedProvider,
      availableProviders
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    const totalCost = {
      ollama: 0,  // Free
      deepseek: this.stats.mediumQueries * 0.14 / 1000000, // $0.14/1M tokens
      openai: this.stats.complexQueries * 0.15 / 1000000   // $0.15/1M tokens
    };

    const worstCaseCost = this.stats.totalQueries * 0.15 / 1000000; // All on OpenAI

    return {
      ...this.stats,
      distribution: {
        simple: `${((this.stats.simpleQueries / this.stats.totalQueries) * 100 || 0).toFixed(1)}%`,
        medium: `${((this.stats.mediumQueries / this.stats.totalQueries) * 100 || 0).toFixed(1)}%`,
        complex: `${((this.stats.complexQueries / this.stats.totalQueries) * 100 || 0).toFixed(1)}%`
      },
      estimatedCost: totalCost,
      worstCaseCost,
      savings: `${((1 - Object.values(totalCost).reduce((a, b) => a + b, 0) / worstCaseCost) * 100 || 0).toFixed(1)}%`
    };
  }
}

// Singleton instance
let instance = null;

export function getQueryComplexityClassifier(config) {
  if (!instance) {
    instance = new QueryComplexityClassifier(config);
  }
  return instance;
}

export default QueryComplexityClassifier;
