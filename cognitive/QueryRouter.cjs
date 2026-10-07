/**
 * QueryRouter.cjs - Intelligent provider routing based on query difficulty
 * 
 * Implements cost-optimized escalation:
 * 1. Ollama (local, free) - Try first for simple/medium queries
 * 2. DeepSeek (paid, you own account) - Escalate for complex queries
 * 3. Gemini (free tier) - Use if DeepSeek fails
 * 4. OpenAI (premium cost) - Last resort only
 * 
 * Tracks success rates per provider and adjusts strategy dynamically
 */

const { getEnvLoader } = require('../config/EnvLoader.cjs');

class QueryRouter {
  constructor(config = {}) {
    this.envLoader = getEnvLoader();
    
    // Provider configuration with cost tiers
    this.providers = {
      gemini: {
        name: 'gemini',
        cost: 'free-tier',
        tier: 0,
        description: 'SOMA cognitive core (memory, arbiters, ASI)',
        maxComplexity: 0.85,  // Handles most everything with full cognitive integration
        timeout: 30000,
        successRate: 1.0
      },
      deepseek: {
        name: 'deepseek',
        cost: 'paid',
        tier: 1,
        description: 'Deep reasoning specialist (ultra-complex logic)',
        maxComplexity: 0.99, // Only for extremely complex reasoning tasks
        timeout: 30000,
        successRate: 1.0
      },
      ollama: {
        name: 'ollama',
        cost: 'free',
        tier: 2,
        description: 'Local fallback (disabled)',
        maxComplexity: 0.1,  // Essentially disabled
        timeout: 60000,
        successRate: 1.0  // Track empirically
      },
      openai: {
        name: 'openai',
        cost: 'premium',
        tier: 3,
        description: 'Premium model (highest cost)',
        maxComplexity: 1.0,  // Best-effort fallback
        timeout: 30000,
        successRate: 1.0
      }
    };

    // Track which providers are actually available
    this.availableProviders = this._detectAvailableProviders();

    // Metrics
    this.metrics = {
      totalQueries: 0,
      successByProvider: {},
      costSavings: {
        ollama_queries: 0,
        deepseek_queries: 0,
        gemini_queries: 0,
        openai_queries: 0,
        total_cost_saved: 0  // Estimated in API call units
      },
      routingDecisions: []
    };

    // Initialize cost tracking
    Object.keys(this.providers).forEach(name => {
      this.metrics.successByProvider[name] = { success: 0, failure: 0, totalTime: 0 };
    });

    console.log(`[QueryRouter] Initialized with ${this.availableProviders.length} providers`);
    this.availableProviders.forEach(p => {
      console.log(`  - ${p.name} (${this.providers[p.name].description})`);
    });
  }

  /**
   * Detect which providers are actually available
   */
  _detectAvailableProviders() {
    const available = [];
    const providers = this.envLoader.getAvailableProviders();

    // Build map of available providers
    const availableMap = {};
    providers.forEach(p => {
      availableMap[p.type] = true;
    });

    // Add available providers to list
    if (availableMap.ollama) available.push(this.providers.ollama);
    if (availableMap.deepseek) available.push(this.providers.deepseek);
    if (availableMap.gemini) available.push(this.providers.gemini);
    if (availableMap.openai) available.push(this.providers.openai);

    return available;
  }

  /**
   * Calculate query complexity (0-1 scale)
   * Factors: length, token count estimate, question types, technical depth
   */
  calculateComplexity(query) {
    // Length factor (0-0.3)
    const lengthFactor = Math.min(0.3, query.length / 1000);

    // Token estimate (words * 1.3 / 750 tokens per 1000 words)
    const wordCount = query.split(/\s+/).length;
    const estimatedTokens = wordCount * 1.3;
    const tokenFactor = Math.min(0.3, estimatedTokens / 1000);

    // Technical depth indicators
    let depthFactor = 0;
    const technicalPatterns = [
      /\b(algorithm|complexity|optimize|architecture|design pattern|recursive|async|concurrency|distributed|microservice|kubernetes|neural|tensor|matrix)\b/gi,
      /\b(why|how|explain|compare|analyze|implement|debug|edge case|trade-off)\b/gi,
      /[{}()\[\];:<>]/g  // Code-like syntax
    ];

    let technicalMatches = 0;
    technicalPatterns.forEach(pattern => {
      const matches = query.match(pattern);
      technicalMatches += matches ? matches.length : 0;
    });

    depthFactor = Math.min(0.4, technicalMatches / 20);

    // Multi-part complexity (multiple questions or subtasks)
    const questionCount = (query.match(/\?/g) || []).length;
    const partFactor = Math.min(0.2, questionCount * 0.05);

    // Subtlety/nuance (requires reasoning)
    const nuanceKeywords = ['nuance', 'subtle', 'tradeoff', 'consider', 'edge case', 'context', 'perspective', 'implication'];
    const nuanceMatches = nuanceKeywords.filter(k => query.toLowerCase().includes(k)).length;
    const nuanceFactor = Math.min(0.15, nuanceMatches * 0.03);

    // Combined complexity score
    const complexity = Math.min(1.0, 
      lengthFactor + 
      tokenFactor + 
      depthFactor + 
      partFactor + 
      nuanceFactor
    );

    return {
      score: complexity,
      breakdown: {
        length: lengthFactor,
        tokens: tokenFactor,
        depth: depthFactor,
        multipart: partFactor,
        nuance: nuanceFactor
      }
    };
  }

  /**
   * Select provider for this query based on complexity and cost optimization
   */
  selectProvider(query, preferences = {}) {
    const complexity = this.calculateComplexity(query);
    const score = complexity.score;

    // Decision log for metrics
    const decision = {
      timestamp: new Date().toISOString(),
      queryLength: query.length,
      complexity: score,
      preferredCost: preferences.preferCost || 'minimize'
    };

    let selectedProvider = null;

    // Cost optimization strategy: minimize paid API usage
    if (preferences.preferCost === 'minimize') {
      // Try to use free/local providers first
      for (const provider of this.availableProviders) {
        if (score <= provider.maxComplexity) {
          // This provider can handle it
          if (provider.cost === 'free' || provider.cost === 'free-tier') {
            selectedProvider = provider;
            decision.reason = `Free/local provider sufficient for complexity ${score.toFixed(2)}`;
            break;
          }
        }
      }

      // If no free option works, try paid options
      if (!selectedProvider) {
        for (const provider of this.availableProviders) {
          if (score <= provider.maxComplexity) {
            if (provider.cost === 'paid') {
              selectedProvider = provider;
              decision.reason = `Paid provider needed for complexity ${score.toFixed(2)}`;
              break;
            }
          }
        }
      }

      // Last resort: use any available provider
      if (!selectedProvider) {
        selectedProvider = this.availableProviders[this.availableProviders.length - 1];
        decision.reason = `Last resort: ${selectedProvider.name}`;
      }
    } else {
      // Default: complexity-based routing (original behavior)
      for (const provider of this.availableProviders) {
        if (score <= provider.maxComplexity) {
          selectedProvider = provider;
          decision.reason = `Complexity ${score.toFixed(2)} matches provider tier ${provider.tier}`;
          break;
        }
      }

      // Fallback
      if (!selectedProvider) {
        selectedProvider = this.availableProviders[this.availableProviders.length - 1];
        decision.reason = `Fallback to highest tier`;
      }
    }

    // Track metrics
    this.metrics.totalQueries++;
    this.metrics.routingDecisions.push({
      ...decision,
      selected: selectedProvider.name
    });

    // Track cost savings
    if (selectedProvider.cost === 'free') {
      this.metrics.costSavings.ollama_queries++;
      this.metrics.costSavings.total_cost_saved += 5;  // Estimate: free query worth ~5 paid units
    } else if (selectedProvider.cost === 'paid') {
      this.metrics.costSavings.deepseek_queries++;
      // DeepSeek costs less than others
    } else if (selectedProvider.cost === 'free-tier') {
      this.metrics.costSavings.gemini_queries++;
    } else if (selectedProvider.cost === 'premium') {
      this.metrics.costSavings.openai_queries++;
    }

    return {
      provider: selectedProvider,
      complexity: score,
      decision
    };
  }

  /**
   * Record success/failure for learning
   */
  recordResult(providerName, success, timeMs) {
    const metrics = this.metrics.successByProvider[providerName];
    if (metrics) {
      if (success) {
        metrics.success++;
      } else {
        metrics.failure++;
      }
      metrics.totalTime += timeMs;
    }

    // Update success rate (exponential moving average)
    const provider = this.providers[providerName];
    if (provider) {
      const totalAttempts = metrics.success + metrics.failure;
      provider.successRate = totalAttempts > 0 
        ? metrics.success / totalAttempts 
        : 1.0;
    }
  }

  /**
   * Get routing strategy explanation
   */
  explainStrategy() {
    return {
      strategy: 'Cost-optimized escalation',
      providers: {
        tier_0: {
          name: 'Ollama',
          cost: 'Free (local)',
          usage: 'Simple to moderate queries (complexity ≤ 0.6)',
          selection: 'Preferred - minimizes API costs'
        },
        tier_1: {
          name: 'DeepSeek',
          cost: 'Paid (you own)',
          usage: 'Complex queries (complexity 0.6-0.85)',
          selection: 'Secondary - balance cost/quality'
        },
        tier_2: {
          name: 'Gemini',
          cost: 'Free tier (limited)',
          usage: 'Very complex queries (complexity 0.85-0.9)',
          selection: 'Fallback - free but rate-limited'
        },
        tier_3: {
          name: 'OpenAI',
          cost: 'Premium',
          usage: 'Impossible queries (complexity > 0.9)',
          selection: 'Last resort only'
        }
      },
      metrics: {
        totalQueries: this.metrics.totalQueries,
        costSavings: this.metrics.costSavings
      }
    };
  }

  /**
   * Get metrics report
   */
  getMetrics() {
    const successByProvider = {};
    Object.entries(this.metrics.successByProvider).forEach(([name, data]) => {
      const total = data.success + data.failure;
      successByProvider[name] = {
        success: data.success,
        failure: data.failure,
        successRate: total > 0 ? (data.success / total * 100).toFixed(1) + '%' : 'N/A',
        avgTime: total > 0 ? (data.totalTime / total).toFixed(0) + 'ms' : 'N/A'
      };
    });

    return {
      totalQueries: this.metrics.totalQueries,
      successByProvider,
      costSavings: {
        ...this.metrics.costSavings,
        summary: `Served ${this.metrics.costSavings.ollama_queries} queries free via Ollama (${this.metrics.costSavings.total_cost_saved} estimated cost units saved)`
      },
      recentDecisions: this.metrics.routingDecisions.slice(-5)
    };
  }
}

module.exports = { QueryRouter };
