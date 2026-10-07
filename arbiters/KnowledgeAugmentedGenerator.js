/**
 * KnowledgeAugmentedGenerator.js - SOMA's Self-Reliance System
 *
 * When external LLM APIs are unavailable or out of credits:
 * 1. Search SOMA's learned knowledge (MnemonicArbiter)
 * 2. Use reasoning engines (TriBrain, ReasoningChamber) to analyze
 * 3. Either answer directly OR enhance Llama with context
 *
 * This makes SOMA progressively MORE capable and LESS dependent on paid APIs!
 */

import { EventEmitter } from 'events';

export class KnowledgeAugmentedGenerator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Confidence thresholds
      directAnswerThreshold: 0.8,   // 80% confidence → answer directly
      augmentLlamaThreshold: 0.5,   // 50% confidence → help Llama
      giveUpThreshold: 0.3,         // <30% confidence → admit we don't know

      // Knowledge retrieval
      maxKnowledgeResults: 10,
      knowledgeRelevanceThreshold: 0.6,

      // Reasoning depth
      useTriBrain: true,             // Use advanced reasoning
      useReasoningChamber: true,     // Use structured thinking
      maxReasoningDepth: 3,          // How deep to reason

      ...config
    };

    this.stats = {
      totalQueries: 0,
      answeredDirectly: 0,
      augmentedLlama: 0,
      fellbackToLlama: 0,
      admittedUnknown: 0
    };

    // References to SOMA's knowledge systems (injected)
    this.mnemonicArbiter = null;
    this.triBrain = null;
    this.reasoningChamber = null;
  }

  /**
   * Initialize with references to SOMA's knowledge systems
   */
  initialize(components = {}) {
    this.mnemonicArbiter = components.mnemonicArbiter || null;
    this.triBrain = components.triBrain || null;
    this.reasoningChamber = components.reasoningChamber || null;

    this.emit('initialized', {
      hasMnemonic: !!this.mnemonicArbiter,
      hasTriBrain: !!this.triBrain,
      hasReasoningChamber: !!this.reasoningChamber
    });
  }

  /**
   * Main entry point: Answer query using SOMA's own knowledge + reasoning
   *
   * @param {string} query - User's question
   * @param {Object} context - Additional context
   * @returns {Object} Response with answer and confidence
   */
  async answerWithKnowledge(query, context = {}) {
    this.stats.totalQueries++;

    console.log(`\n[KnowledgeAugmentedGenerator] Query: "${query}"`);
    console.log(`[KnowledgeAugmentedGenerator] 🧠 Searching SOMA's learned knowledge...`);

    // Step 1: Search SOMA's memory for relevant knowledge
    const relevantKnowledge = await this.searchKnowledge(query, context);

    console.log(`[KnowledgeAugmentedGenerator] Found ${relevantKnowledge.length} relevant memories`);

    // Step 2: Use reasoning engines to analyze the query
    const reasoning = await this.applyReasoning(query, relevantKnowledge, context);

    console.log(`[KnowledgeAugmentedGenerator] Reasoning confidence: ${(reasoning.confidence * 100).toFixed(1)}%`);

    // Step 3: Decide how to respond based on confidence
    const response = this.generateResponse(query, relevantKnowledge, reasoning, context);

    console.log(`[KnowledgeAugmentedGenerator] Strategy: ${response.strategy}`);

    return response;
  }

  /**
   * Step 1: Search SOMA's learned knowledge
   */
  async searchKnowledge(query, context) {
    const results = [];

    // Search MnemonicArbiter if available
    if (this.mnemonicArbiter && this.mnemonicArbiter.search) {
      try {
        const memories = await this.mnemonicArbiter.search({
          query,
          limit: this.config.maxKnowledgeResults,
          minRelevance: this.config.knowledgeRelevanceThreshold
        });

        for (const memory of memories) {
          results.push({
            source: 'mnemonic',
            content: memory.content || memory.data,
            relevance: memory.relevance || memory.score || 0.7,
            timestamp: memory.timestamp,
            tags: memory.tags || []
          });
        }
      } catch (error) {
        console.warn('[KnowledgeAugmentedGenerator] MnemonicArbiter search failed:', error.message);
      }
    }

    // Search conversation history from context
    if (context.conversationHistory) {
      const relevantConversations = this.searchConversationHistory(
        query,
        context.conversationHistory
      );
      results.push(...relevantConversations);
    }

    // Search recent learnings
    if (context.recentLearnings) {
      results.push(...context.recentLearnings.map(learning => ({
        source: 'recent_learning',
        content: learning.content,
        relevance: 0.8,
        timestamp: learning.timestamp
      })));
    }

    // Sort by relevance
    return results.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Search conversation history for relevant info
   */
  searchConversationHistory(query, history) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);

    return history
      .filter(msg => {
        const contentLower = (msg.content || '').toLowerCase();
        // Check if message contains query keywords
        return queryWords.some(word => contentLower.includes(word));
      })
      .map(msg => ({
        source: 'conversation',
        content: msg.content,
        relevance: this.calculateRelevance(query, msg.content),
        timestamp: msg.timestamp
      }))
      .filter(result => result.relevance > this.config.knowledgeRelevanceThreshold);
  }

  /**
   * Calculate relevance score between query and content
   */
  calculateRelevance(query, content) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const contentLower = content.toLowerCase();

    let matches = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) matches++;
    }

    return Math.min(matches / queryWords.length, 1.0);
  }

  /**
   * Step 2: Apply reasoning engines to analyze query + knowledge
   */
  async applyReasoning(query, knowledge, context) {
    const reasoning = {
      confidence: 0,
      insights: [],
      canAnswer: false,
      reasoning_chain: []
    };

    // Basic confidence from knowledge quantity & quality
    if (knowledge.length === 0) {
      reasoning.confidence = 0.1;
      reasoning.insights.push('No relevant knowledge found');
      return reasoning;
    }

    // Calculate base confidence from knowledge relevance
    const avgRelevance = knowledge.reduce((sum, k) => sum + k.relevance, 0) / knowledge.length;
    reasoning.confidence = avgRelevance;

    // Use TriBrain if available (advanced multi-perspective reasoning)
    if (this.config.useTriBrain && this.triBrain && this.triBrain.analyze) {
      try {
        const tribrainResult = await this.triBrain.analyze({
          query,
          knowledge,
          context
        });

        reasoning.confidence = Math.max(reasoning.confidence, tribrainResult.confidence || 0);
        reasoning.insights.push(...(tribrainResult.insights || []));
        reasoning.reasoning_chain.push({
          engine: 'TriBrain',
          result: tribrainResult
        });
      } catch (error) {
        console.warn('[KnowledgeAugmentedGenerator] TriBrain analysis failed:', error.message);
      }
    }

    // Use ReasoningChamber if available (structured thinking)
    if (this.config.useReasoningChamber && this.reasoningChamber && this.reasoningChamber.reason) {
      try {
        const chamberResult = await this.reasoningChamber.reason({
          query,
          evidence: knowledge,
          depth: this.config.maxReasoningDepth
        });

        reasoning.confidence = Math.max(reasoning.confidence, chamberResult.confidence || 0);
        reasoning.insights.push(...(chamberResult.conclusions || []));
        reasoning.reasoning_chain.push({
          engine: 'ReasoningChamber',
          result: chamberResult
        });
      } catch (error) {
        console.warn('[KnowledgeAugmentedGenerator] ReasoningChamber failed:', error.message);
      }
    }

    // Determine if we can answer
    reasoning.canAnswer = reasoning.confidence >= this.config.directAnswerThreshold;

    return reasoning;
  }

  /**
   * Step 3: Generate response based on confidence level
   */
  generateResponse(query, knowledge, reasoning, context) {
    // STRATEGY 1: High confidence → Answer directly from SOMA's knowledge
    if (reasoning.confidence >= this.config.directAnswerThreshold) {
      this.stats.answeredDirectly++;

      return {
        strategy: 'DIRECT_ANSWER',
        confidence: reasoning.confidence,
        answer: this.synthesizeAnswer(knowledge, reasoning),
        sources: knowledge.slice(0, 5).map(k => ({
          source: k.source,
          relevance: k.relevance,
          timestamp: k.timestamp
        })),
        reasoning: reasoning.insights,
        usedLLM: false
      };
    }

    // STRATEGY 2: Medium confidence → Augment Llama with SOMA's knowledge
    if (reasoning.confidence >= this.config.augmentLlamaThreshold) {
      this.stats.augmentedLlama++;

      return {
        strategy: 'AUGMENT_LLAMA',
        confidence: reasoning.confidence,
        llamaPrompt: this.buildAugmentedPrompt(query, knowledge, reasoning),
        context: knowledge,
        reasoning: reasoning.insights,
        usedLLM: 'ollama',
        message: 'SOMA will enhance Llama with learned context'
      };
    }

    // STRATEGY 3: Low confidence → Pure Llama fallback
    if (reasoning.confidence >= this.config.giveUpThreshold) {
      this.stats.fellbackToLlama++;

      return {
        strategy: 'FALLBACK_LLAMA',
        confidence: reasoning.confidence,
        llamaPrompt: query, // Just the raw query
        usedLLM: 'ollama',
        message: 'SOMA has limited knowledge, using Llama alone'
      };
    }

    // STRATEGY 4: Very low confidence → Admit we don't know
    this.stats.admittedUnknown++;

    return {
      strategy: 'ADMIT_UNKNOWN',
      confidence: reasoning.confidence,
      answer: this.generateHonestResponse(query, reasoning),
      usedLLM: false,
      message: 'SOMA does not have enough knowledge to answer confidently'
    };
  }

  /**
   * Synthesize answer from SOMA's knowledge
   */
  synthesizeAnswer(knowledge, reasoning) {
    const topKnowledge = knowledge.slice(0, 5);

    let answer = `Based on what I've learned:\n\n`;

    // Include key facts from knowledge
    topKnowledge.forEach((k, i) => {
      answer += `${i + 1}. ${k.content}\n`;
    });

    // Include reasoning insights
    if (reasoning.insights.length > 0) {
      answer += `\nAnalysis:\n`;
      reasoning.insights.forEach(insight => {
        answer += `• ${insight}\n`;
      });
    }

    answer += `\n(Answered from SOMA's learned knowledge, confidence: ${(reasoning.confidence * 100).toFixed(1)}%)`;

    return answer;
  }

  /**
   * Build enhanced prompt for Llama with SOMA's context
   */
  buildAugmentedPrompt(query, knowledge, reasoning) {
    let prompt = `You are being assisted by SOMA, an AI that has learned from past interactions.\n\n`;
    prompt += `SOMA's relevant knowledge:\n`;

    // Add top 5 pieces of knowledge
    knowledge.slice(0, 5).forEach((k, i) => {
      prompt += `${i + 1}. ${k.content} (relevance: ${(k.relevance * 100).toFixed(0)}%)\n`;
    });

    // Add reasoning insights
    if (reasoning.insights.length > 0) {
      prompt += `\nSOMA's analysis:\n`;
      reasoning.insights.forEach(insight => {
        prompt += `• ${insight}\n`;
      });
    }

    prompt += `\nUser's question: ${query}\n\n`;
    prompt += `Please answer using SOMA's knowledge above as context. Be concise and accurate.`;

    return prompt;
  }

  /**
   * Generate honest "I don't know" response
   */
  generateHonestResponse(query, reasoning) {
    return `I don't have enough learned knowledge to answer this confidently (${(reasoning.confidence * 100).toFixed(1)}% confidence).\n\n` +
           `I could try to answer with Llama, but the result may not be accurate. Would you like me to:\n` +
           `1. Try anyway with Llama (local, free, but may be inaccurate)\n` +
           `2. Wait for external LLM credits to reset\n` +
           `3. Help me learn about this topic for future queries`;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      selfRelianceRate: `${((this.stats.answeredDirectly / this.stats.totalQueries) * 100 || 0).toFixed(1)}%`,
      augmentationRate: `${((this.stats.augmentedLlama / this.stats.totalQueries) * 100 || 0).toFixed(1)}%`
    };
  }
}

// Singleton
let instance = null;

export function getKnowledgeAugmentedGenerator(config) {
  if (!instance) {
    instance = new KnowledgeAugmentedGenerator(config);
  }
  return instance;
}

export default KnowledgeAugmentedGenerator;
