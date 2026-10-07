// ═══════════════════════════════════════════════════════════
// IntelligentRouter.js - Dynamic Gemini ↔ Local Model Switching
// Learns from Gemini by copying its responses for training
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

/**
 * IntelligentRouter
 *
 * Routes queries to Gemini or local model based on:
 * - Query complexity
 * - Local model capability
 * - Cost optimization
 * - Learning opportunities
 *
 * FEDERATED LEARNING FROM GEMINI:
 * - Hard queries → Gemini
 * - Copy Gemini's response as training data
 * - Train local model on Gemini's responses
 * - Eventually, local model can handle those queries
 * - "Piggybacking" off Gemini's intelligence!
 */
export class IntelligentRouter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'IntelligentRouter';
    this.geminiModel = config.geminiModel || null;
    this.localModelServer = config.localModelServer || null;

    // Routing strategy
    this.strategy = config.strategy || 'adaptive'; // 'adaptive', 'local-first', 'gemini-first'
    this.complexityThreshold = config.complexityThreshold || 0.4; // Lowered to favor local for chat
    this.localConfidenceThreshold = config.localConfidenceThreshold || 0.85;

    // Simple chat patterns to bypass complexity check
    this.simpleChatPatterns = [
        /^(hi|hello|hey|howdy|greetings|sup)\b/i,
        /^(how are you|how is it going|what's up)\b/i,
        /^(thanks|thank you|cool|ok|okay|sure)\b/i,
        /^just testing\b/i
    ];

    // Learning from Gemini
    this.learnFromGemini = config.learnFromGemini !== false;
    this.geminiResponsesPath = config.geminiResponsesPath || './.soma/gemini-learning';

    // Metrics
    this.metrics = {
      totalQueries: 0,
      geminiQueries: 0,
      localQueries: 0,
      fallbacksToGemini: 0,
      learningOpportunities: 0,
      costSaved: 0
    };

    // Cost per query (approximate)
    this.geminiCostPerQuery = 0.001; // $0.001 per query
    this.localCostPerQuery = 0.0001; // Much cheaper

    console.log(`[${this.name}] 🎯 Intelligent Router initialized`);
  }

  async initialize() {
    console.log(`[${this.name}] Initializing intelligent routing...`);

    // Create gemini learning directory
    if (this.learnFromGemini) {
      try {
        await fs.mkdir(this.geminiResponsesPath, { recursive: true });
        console.log(`[${this.name}]    ✅ Gemini learning enabled`);
      } catch (error) {
        console.warn(`[${this.name}]    ⚠️  Failed to create learning directory: ${error.message}`);
      }
    }

    this.emit('initialized');
    console.log(`[${this.name}] ✅ Intelligent routing ready`);
    return { success: true };
  }

  /**
   * Route a query to the best model
   * THIS IS THE KEY TO PIGGYBACKING OFF GEMINI
   */
  async route(query, context = {}) {
    this.metrics.totalQueries++;

    // Analyze query complexity
    const complexity = this.analyzeComplexity(query, context);

    console.log(`[${this.name}] Routing query (complexity: ${complexity.score.toFixed(2)})`);

    let response;
    let source;
    let learningOpportunity = false;

    // Route based on complexity and strategy
    if (this.shouldUseGemini(complexity, context)) {
      // Use Gemini for complex/critical queries
      console.log(`[${this.name}]    → Gemini (${complexity.reason})`);

      response = await this.queryGemini(query, context);
      source = 'gemini';
      this.metrics.geminiQueries++;

      // LEARNING OPPORTUNITY: Save Gemini's response for training
      if (this.learnFromGemini && response.success) {
        await this.saveGeminiResponse(query, response.text, complexity);
        learningOpportunity = true;
        this.metrics.learningOpportunities++;
      }

    } else {
      // Try local model first
      console.log(`[${this.name}]    → Local (sufficient capability)`);

      response = await this.queryLocal(query, context);
      source = 'local';
      this.metrics.localQueries++;

      // Cost savings
      this.metrics.costSaved += (this.geminiCostPerQuery - this.localCostPerQuery);

      // Fallback to Gemini if local fails or low confidence
      if (!response.success || (response.confidence && response.confidence < this.localConfidenceThreshold)) {
        console.log(`[${this.name}]    ⚠️  Local failed/low confidence, falling back to Gemini`);

        response = await this.queryGemini(query, context);
        source = 'gemini-fallback';
        this.metrics.fallbacksToGemini++;

        // This is also a learning opportunity
        if (this.learnFromGemini && response.success) {
          await this.saveGeminiResponse(query, response.text, complexity, { fallback: true });
          learningOpportunity = true;
          this.metrics.learningOpportunities++;
        }
      }
    }

    this.emit('query_routed', {
      source,
      complexity: complexity.score,
      learningOpportunity
    });

    return {
      ...response,
      source,
      complexity: complexity.score,
      learningOpportunity
    };
  }

  /**
   * Analyze query complexity
   */
  analyzeComplexity(query, context = {}) {
    let score = 0;
    const factors = [];

    // Force SIMPLE for known chat patterns
    for (const pattern of this.simpleChatPatterns) {
        if (pattern.test(query)) {
            return {
                score: 0.1,
                reason: 'simple chat pattern',
                factors: ['simple_chat']
            };
        }
    }

    // Length-based complexity
    if (query.length > 500) {
      score += 0.2;
      factors.push('long query');
    }

    // Multi-step reasoning
    if (new RegExp('first|then|next|finally|step', 'gi').test(query)) {
      score += 0.3;
      factors.push('multi-step reasoning');
    }

    // Code generation
    if (new RegExp('write|code|function|implement|create', 'gi').test(query) && 
        new RegExp('python|javascript|java|function', 'gi').test(query)) {
      score += 0.2;
      factors.push('code generation');
    }

    // Complex topics
    const complexTopics = ['quantum', 'blockchain', 'machine learning', 'neural network', 'cryptography'];
    if (complexTopics.some(topic => query.toLowerCase().includes(topic))) {
      score += 0.2;
      factors.push('complex domain');
    }

    // Context indicates complexity
    if (context.requiresDeepReasoning) {
      score += 0.3;
      factors.push('deep reasoning required');
    }

    if (context.critical) {
      score += 0.4;
      factors.push('critical query');
    }

    // Clamp to 0-1
    score = Math.min(1.0, score);

    return {
      score,
      reason: factors.length > 0 ? factors.join(', ') : 'simple query',
      factors
    };
  }

  /**
   * Decide if we should use Gemini
   */
  shouldUseGemini(complexity, context) {
    // Always use Gemini for critical queries
    if (context.critical) return true;

    // Strategy-based routing
    if (this.strategy === 'gemini-first') return true;
    if (this.strategy === 'local-first') return false;

    // Adaptive: Use Gemini if complexity exceeds threshold
    if (this.strategy === 'adaptive') {
      return complexity.score >= this.complexityThreshold;
    }

    return false;
  }

  /**
   * Query Gemini
   */
  async queryGemini(query, context = {}) {
    if (!this.geminiModel) {
      return {
        success: false,
        error: 'Gemini model not available'
      };
    }

    try {
      const result = await this.geminiModel.reason({
        query,
        context
      });

      return {
        success: true,
        text: result.response || result.result?.response,
        confidence: result.confidence || 1.0
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Query local model
   */
  async queryLocal(query, context = {}) {
    if (!this.localModelServer || !this.localModelServer.currentModel) {
      return {
        success: false,
        error: 'Local model not available'
      };
    }

    try {
      const result = await this.localModelServer.inference(query, {
        temperature: context.temperature || 0.7,
        maxTokens: context.maxTokens || 2048
      });

      return {
        success: result.success,
        text: result.response,
        confidence: 0.9, // TODO: Get real confidence from model
        latency: result.latency
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save Gemini response for training
   * THIS IS HOW WE LEARN FROM GEMINI!
   */
  async saveGeminiResponse(query, response, complexity, metadata = {}) {
    try {
      const learningExample = {
        timestamp: Date.now(),
        query,
        response,
        complexity: complexity.score,
        complexityFactors: complexity.factors,
        metadata: {
          ...metadata,
          source: 'gemini-learning'
        }
      };

      // Save to JSON file for training
      const filename = `gemini-learning-${Date.now()}.json`;
      const filepath = path.join(this.geminiResponsesPath, filename);

      await fs.writeFile(filepath, JSON.stringify(learningExample, null, 2));

      console.log(`[${this.name}]       💾 Saved Gemini response for training`);

    } catch (error) {
      console.error(`[${this.name}]       ❌ Failed to save learning example: ${error.message}`);
    }
  }

  /**
   * Get routing statistics
   */
  getStats() {
    const totalQueries = this.metrics.totalQueries || 1;

    return {
      ...this.metrics,
      geminiPercentage: ((this.metrics.geminiQueries / totalQueries) * 100).toFixed(1),
      localPercentage: ((this.metrics.localQueries / totalQueries) * 100).toFixed(1),
      fallbackRate: ((this.metrics.fallbacksToGemini / this.metrics.localQueries) * 100).toFixed(1),
      estimatedCostSaved: `$${this.metrics.costSaved.toFixed(3)}`
    };
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      name: this.name,
      strategy: this.strategy,
      complexityThreshold: this.complexityThreshold,
      learnFromGemini: this.learnFromGemini,
      metrics: this.metrics,
      stats: this.getStats()
    };
  }
}

export default IntelligentRouter;
