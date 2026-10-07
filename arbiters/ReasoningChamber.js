/**
 * ReasoningChamber.js - Multi-Strategy Reasoning Engine
 *
 * Implements different reasoning strategies based on query type:
 * - Causal: Why does X cause Y?
 * - Counterfactual: What if we did X instead of Y?
 * - Comparative: How does X compare to Y?
 * - Mechanistic: How does X work?
 * - Analytical: Solve/calculate/analyze
 * - Generative: Create/design/generate
 * - General: Default reasoning
 *
 * Each strategy produces different confidence levels based on available evidence.
 */

export class ReasoningChamber {
  constructor(config = {}) {
    this.name = config.name || 'ReasoningChamber';
    this.lobe = 'LOGOS'; // Neural index: logic/code lobe
    this.tier = 'cognitive';

    // Dependencies (can be injected)
    this.causalityArbiter = config.causalityArbiter || null;
    this.knowledgeGraph = config.knowledgeGraph || null;
    this.mnemonic = config.mnemonic || null;
    this.worldModel = config.worldModel || null;

    // Reasoning statistics
    this.stats = {
      totalReasoning: 0,
      byType: {},
      byStrategy: {},
      avgConfidence: 0
    };

    console.log(`[${this.name}] Multi-strategy reasoning initialized`);
  }

  async initialize() {
    console.log(`[${this.name}] Initialized`);
    return true;
  }

  /**
   * Main reasoning entry point
   */
  async reason(task) {
    const { query, context = {}, executor } = task;

    this.stats.totalReasoning++;

    // Execute custom strategy if provided
    if (executor) {
      return {
        result: await executor(query),
        confidence: 0.8,
        strategy: 'custom_executor'
      };
    }

    // 1. Detect reasoning type
    const reasoningType = this._detectReasoningType(query);

    // 2. Select and execute strategy
    const strategy = this._selectStrategy(reasoningType, context);
    const result = await this._executeReasoning(strategy, query, context);

    // 3. Calculate confidence
    const confidence = this._calculateConfidence(result, context);

    // 4. Update stats
    this.stats.byType[reasoningType] = (this.stats.byType[reasoningType] || 0) + 1;
    this.stats.byStrategy[strategy] = (this.stats.byStrategy[strategy] || 0) + 1;

    const n = this.stats.totalReasoning;
    this.stats.avgConfidence = ((this.stats.avgConfidence * (n - 1)) + confidence) / n;

    console.log(`[${this.name}] Reasoning: ${reasoningType} (${strategy}) → confidence: ${(confidence * 100).toFixed(0)}%`);

    return {
      result: result.text,
      confidence,
      strategy,
      reasoningType,
      method: result.method,
      metadata: result
    };
  }

  /**
   * Detect type of reasoning needed using weighted scoring
   */
  _detectReasoningType(query) {
    const lowerQuery = query.toLowerCase();
    const scores = {
      causal: 0,
      counterfactual: 0,
      comparative: 0,
      mechanistic: 0,
      analytical: 0,
      generative: 0
    };

    // Helper for scoring
    const score = (keywords, type, weight = 1) => {
      for (const word of keywords) {
        if (lowerQuery.includes(word)) scores[type] += weight;
      }
    };

    // Causal
    score(['why', 'because', 'reason for', 'cause of', 'due to'], 'causal', 2);
    score(['led to', 'triggered'], 'causal', 1);

    // Counterfactual
    score(['what if', 'suppose', 'imagine if', 'alternative to'], 'counterfactual', 3);
    score(['instead of', 'otherwise'], 'counterfactual', 1);

    // Comparative
    score(['compare', 'difference between', 'better than', 'worse than', 'versus', ' vs '], 'comparative', 2);
    score(['advantages', 'disadvantages', 'pros and cons'], 'comparative', 1);

    // Mechanistic
    score(['how does', 'how do', 'mechanism', 'process of', 'explain how'], 'mechanistic', 2);
    score(['work', 'function'], 'mechanistic', 0.5); // weak signal

    // Analytical
    score(['solve', 'calculate', 'analyze', 'evaluate', 'determine', 'optimize', 'debug'], 'analytical', 2);
    score(['complexity', 'big o', 'performance'], 'analytical', 1);

    // Generative
    score(['create', 'design', 'generate', 'write', 'build', 'implement', 'code'], 'generative', 2);
    score(['story', 'poem', 'essay', 'function'], 'generative', 1);

    // Find max score
    let maxScore = 0;
    let bestType = 'general';

    for (const [type, val] of Object.entries(scores)) {
      if (val > maxScore) {
        maxScore = val;
        bestType = type;
      }
    }

    // Threshold: if max score is low, default to general
    if (maxScore < 2) return 'general';

    return bestType;
  }

  /**
   * Select reasoning strategy
   */
  _selectStrategy(reasoningType, context) {
    // Map reasoning type to strategy
    const strategyMap = {
      'causal': 'causal_chain',
      'counterfactual': 'counterfactual_simulation',
      'comparative': 'comparative_analysis',
      'mechanistic': 'mechanistic_decomposition',
      'analytical': 'logical_deduction',
      'generative': 'creative_synthesis',
      'general': 'integrated_reasoning'
    };

    return strategyMap[reasoningType] || 'integrated_reasoning';
  }

  /**
   * Execute reasoning based on strategy
   */
  async _executeReasoning(strategy, query, context) {
    switch (strategy) {
      case 'causal_chain':
        return await this._causalReasoning(query, context);

      case 'counterfactual_simulation':
        return await this._counterfactualReasoning(query, context);

      case 'comparative_analysis':
        return await this._comparativeReasoning(query, context);

      case 'mechanistic_decomposition':
        return await this._mechanisticReasoning(query, context);

      case 'logical_deduction':
        return await this._analyticalReasoning(query, context);

      case 'creative_synthesis':
        return await this._generativeReasoning(query, context);

      default:
        return await this._generalReasoning(query, context);
    }
  }

  /**
   * CAUSAL REASONING: Why does X cause Y?
   */
  async _causalReasoning(query, context) {
    if (!this.causalityArbiter) {
      return {
        text: 'Causal reasoning requires CausalityArbiter (not available)',
        method: 'fallback',
        confidence: 0.3
      };
    }

    // Extract keywords
    const keywords = this._extractKeywords(query);

    if (keywords.length === 0) {
      return {
        text: 'Could not identify causal concepts in query',
        method: 'parse_failed',
        confidence: 0.2
      };
    }

    // Query causal chains for all keywords
    const allChains = [];

    for (const keyword of keywords.slice(0, 3)) {
      const chains = await this.causalityArbiter.queryCausalChains(keyword, {
        maxDepth: 3,
        minConfidence: 0.3
      });

      if (chains && chains.length > 0) {
        allChains.push(...chains);
      }
    }

    if (allChains.length === 0) {
      return {
        text: `No established causal chains found for "${keywords.join(', ')}". The causal model is still learning. (Current graph size: ${this.causalityArbiter.getStats?.().graphNodes || 0} nodes)`,
        method: 'no_causal_data',
        confidence: 0.1,
        keywords
      };
    }

    // Remove duplicates and sort by confidence
    const uniqueChains = Array.from(
      new Map(allChains.map(c => [`${c.cause}→${c.effect}`, c])).values()
    ).sort((a, b) => b.confidence - a.confidence).slice(0, 10);

    // Build causal explanation
    const explanation = uniqueChains
      .map(c => {
        const depth = c.depth > 1 ? ` (multi-hop, depth ${c.depth})` : '';
        const conf = (c.confidence * 100).toFixed(0);
        return `  • ${c.cause} → ${c.effect}${depth} [${conf}% confidence]`;
      })
      .join('\n');

    return {
      text: `Causal Analysis (${uniqueChains.length} chains found):\n\n${explanation}`,
      method: 'causal_chain',
      chains: uniqueChains,
      depth: Math.max(...uniqueChains.map(c => c.depth || 1)),
      confidence: uniqueChains[0].confidence // Highest chain confidence
    };
  }

  /**
   * COUNTERFACTUAL REASONING: What if X instead of Y?
   */
  async _counterfactualReasoning(query, context) {
    if (!this.causalityArbiter) {
      return {
        text: 'Counterfactual reasoning requires CausalityArbiter (not available)',
        method: 'fallback',
        confidence: 0.3
      };
    }

    // Extract alternatives from query
    const alternatives = this._extractAlternatives(query);

    if (alternatives.length === 0) {
      return {
        text: 'Could not identify alternative scenario in query. Try phrasing as "What if [alternative]?"',
        method: 'parse_failed',
        confidence: 0.2
      };
    }

    // Generate counterfactual prediction
    const situation = context.situation || {
      actualAction: context.lastAction || 'unknown',
      actualOutcome: context.lastOutcome || {}
    };

    try {
      const counterfactual = this.causalityArbiter.generateCounterfactual(
        situation,
        alternatives[0]
      );

      return {
        text: `Counterfactual Analysis:\n\nActual: ${counterfactual.actualAction}\nAlternative: ${counterfactual.alternativeAction}\n\nPredicted Outcome: ${JSON.stringify(counterfactual.predictedOutcome, null, 2)}\n\nConfidence: ${(counterfactual.confidence * 100).toFixed(0)}%`,
        method: 'counterfactual',
        counterfactual,
        confidence: counterfactual.confidence
      };
    } catch (error) {
      return {
        text: `Counterfactual simulation failed: ${error.message}`,
        method: 'error',
        confidence: 0.1
      };
    }
  }

  /**
   * COMPARATIVE REASONING: X vs Y
   */
  async _comparativeReasoning(query, context) {
    const items = this._extractComparables(query);

    if (items.length < 2) {
      return {
        text: 'Comparative reasoning requires at least 2 items to compare',
        method: 'parse_failed',
        confidence: 0.2
      };
    }

    // Query knowledge about each item
    const comparisons = [];

    for (const item of items) {
      const knowledge = await this._queryKnowledge(item, context);
      comparisons.push({ item, knowledge });
    }

    // Build comparison
    const comparison = this._buildComparison(comparisons);

    return {
      text: comparison,
      method: 'comparative',
      items,
      comparisons,
      confidence: 0.7 // Moderate confidence for comparisons
    };
  }

  /**
   * MECHANISTIC REASONING: How does X work?
   */
  async _mechanisticReasoning(query, context) {
    const subject = this._extractSubject(query);

    // Query knowledge graph for mechanism
    const knowledge = await this._queryKnowledge(subject, context);

    if (Object.keys(knowledge).length === 0) {
      return {
        text: `No mechanistic knowledge available for "${subject}"`,
        method: 'no_knowledge',
        confidence: 0.1
      };
    }

    // Build mechanistic explanation
    const explanation = `Mechanistic Analysis of "${subject}":\n\n${Object.entries(knowledge)
      .map(([key, value]) => `  • ${key}: ${JSON.stringify(value)}`)
      .join('\n')}`;

    return {
      text: explanation,
      method: 'mechanistic',
      subject,
      knowledge,
      confidence: 0.6
    };
  }

  /**
   * ANALYTICAL REASONING: Solve/calculate/analyze
   */
  async _analyticalReasoning(query, context) {
    // Return structured delegation command
    return {
      text: `Analytical reasoning delegated to LOGOS brain`,
      method: 'delegated',
      delegateTo: 'LOGOS', // Explicit delegation
      reasoningType: 'analytical',
      confidence: 0.9,
      recommendation: 'Use LOGOS brain for analytical tasks'
    };
  }

  /**
   * GENERATIVE REASONING: Create/design/generate
   */
  async _generativeReasoning(query, context) {
    // Return structured delegation command
    return {
      text: `Generative reasoning delegated to AURORA brain`,
      method: 'delegated',
      delegateTo: 'AURORA', // Explicit delegation
      reasoningType: 'generative',
      confidence: 0.9,
      recommendation: 'Use AURORA brain for creative tasks'
    };
  }

  /**
   * GENERAL REASONING: Default fallback
   */
  async _generalReasoning(query, context) {
    // Integrated reasoning using all available context
    const reasoning = [];

    if (context.memories && context.memories.length > 0) {
      reasoning.push(`Recalled ${context.memories.length} relevant memories`);
    }

    if (context.knowledgeInsights && context.knowledgeInsights.length > 0) {
      reasoning.push(`Found ${context.knowledgeInsights.length} knowledge insights`);
    }

    if (reasoning.length === 0) {
      reasoning.push('No specific reasoning strategy identified - using general analysis');
    }

    return {
      text: `General Reasoning:\n${reasoning.join('\n')}`,
      method: 'general',
      confidence: 0.5
    };
  }

  /**
   * Calculate confidence based on result and context
   */
  _calculateConfidence(result, context) {
    let confidence = result.confidence || 0.5; // Start with result's confidence

    // Factor: Method used
    const methodBonus = {
      'causal_chain': 0.2,
      'counterfactual': 0.15,
      'comparative': 0.1,
      'mechanistic': 0.15,
      'delegated': 0.1,
      'general': 0.0,
      'fallback': -0.3,
      'parse_failed': -0.4,
      'no_knowledge': -0.3,
      'no_causal_data': -0.2,
      'error': -0.5
    };

    confidence += methodBonus[result.method] || 0;

    // Factor: Depth of reasoning
    if (result.depth >= 3) confidence += 0.15;
    else if (result.depth >= 2) confidence += 0.1;

    // Factor: Number of chains/evidence
    if (result.chains && result.chains.length > 5) confidence += 0.1;
    else if (result.chains && result.chains.length > 2) confidence += 0.05;

    // Factor: Context availability
    if (context.memories && context.memories.length > 0) confidence += 0.05;
    if (context.knowledgeInsights && context.knowledgeInsights.length > 0) confidence += 0.05;
    if (context.causalInsights) confidence += 0.05;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Helper: Extract keywords from query
   */
  _extractKeywords(query) {
    // Remove common words
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'why', 'does', 'do', 'how', 'what', 'when', 'where', 'who']);

    const words = query.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    return words.slice(0, 5); // Top 5 keywords
  }

  /**
   * Helper: Extract alternatives from query
   */
  _extractAlternatives(query) {
    // Look for "what if X" or "suppose X" patterns
    const patterns = [
      /what if ([^?]+)/i,
      /suppose ([^?]+)/i,
      /imagine if ([^?]+)/i,
      /alternative[:\s]+([^?]+)/i
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        return [match[1].trim()];
      }
    }

    return [];
  }

  /**
   * Helper: Extract comparables from query
   */
  _extractComparables(query) {
    // Look for "X vs Y", "X versus Y", "X compared to Y"
    const patterns = [
      /(.+?)\s+(?:vs|versus)\s+(.+)/i,
      /compare\s+(.+?)\s+(?:to|with|and)\s+(.+)/i,
      /difference between\s+(.+?)\s+and\s+(.+)/i
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        return [match[1].trim(), match[2].trim()];
      }
    }

    return [];
  }

  /**
   * Helper: Extract subject from query
   */
  _extractSubject(query) {
    // Remove "how does" / "how do" and get remaining words
    const cleaned = query
      .toLowerCase()
      .replace(/^(?:how does|how do|how is|how are)\s+/i, '')
      .replace(/\s+work[?]?$/i, '')
      .trim();

    return cleaned || 'unknown';
  }

  /**
   * Helper: Query knowledge about a concept
   */
  async _queryKnowledge(concept, context) {
    const knowledge = {};

    // Query knowledge graph if available
    if (this.knowledgeGraph) {
      try {
        const results = await this.knowledgeGraph.queryConcepts([concept], { limit: 5 });
        if (results && results.length > 0) {
          knowledge.graphInsights = results.map(r => r.concept || r);
        }
      } catch (err) {
        // Ignore errors
      }
    }

    // Query memories if available
    if (this.mnemonic) {
      try {
        const memories = await this.mnemonic.recall(concept, { limit: 3 });
        if (memories && memories.length > 0) {
          knowledge.memories = memories.map(m => m.content || m).slice(0, 100);
        }
      } catch (err) {
        // Ignore errors
      }
    }

    return knowledge;
  }

  /**
   * Helper: Build comparison text
   */
  _buildComparison(comparisons) {
    let text = 'Comparative Analysis:\n\n';

    for (const { item, knowledge } of comparisons) {
      text += `${item}:\n`;

      if (knowledge.graphInsights) {
        text += `  - Knowledge: ${knowledge.graphInsights.join(', ')}\n`;
      }

      if (knowledge.memories) {
        text += `  - Memories: ${knowledge.memories.length} relevant memories found\n`;
      }

      if (Object.keys(knowledge).length === 0) {
        text += `  - No knowledge available\n`;
      }

      text += '\n';
    }

    return text;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      totalReasoning: this.stats.totalReasoning,
      avgConfidence: (this.stats.avgConfidence * 100).toFixed(1) + '%'
    };
  }
}
