/**
 * ConversationCompressor.js - Smart Memory Compression
 * 
 * Instead of hard limits that delete old conversations,
 * this compresses/summarizes them to preserve important context.
 * 
 * Strategy:
 * - Recent messages (< 50k tokens): Keep full detail
 * - Medium age (50k-150k tokens): Compress to summaries
 * - Old (150k-200k tokens): Compress to key facts only
 * - Beyond 200k: Archive summaries to long-term memory
 */

import { EventEmitter } from 'events';

export class ConversationCompressor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.name = 'ConversationCompressor';
    
    // Token thresholds
    this.thresholds = {
      fullDetail: config.fullDetailTokens || 50000,      // Keep full text
      summarized: config.summarizedTokens || 150000,     // Summarize to ~1/4
      keyFacts: config.keyFactsTokens || 200000,         // Just key points
      archive: config.archiveTokens || 250000            // Move to long-term
    };
    
    // Compression ratios
    this.compressionRatios = {
      summary: 0.25,    // Reduce to 25% of original
      keyFacts: 0.10    // Reduce to 10% of original
    };
    
    // Connected systems
    this.quadBrain = null;
    this.mnemonic = null;
    this.conversationHistory = null;
    
    // Stats
    this.stats = {
      compressions: 0,
      tokensSaved: 0,
      archivesCreated: 0
    };
    
    console.log(`[${this.name}] 🗜️ Conversation Compressor initialized`);
  }

  /**
   * Initialize with connected systems
   */
  async initialize(systems = {}) {
    this.quadBrain = systems.quadBrain || null;
    this.mnemonic = systems.mnemonic || null;
    this.conversationHistory = systems.conversationHistory || null;
    
    console.log(`[${this.name}] ✅ Compressor ready`);
    console.log(`[${this.name}]    Full detail: < ${this.thresholds.fullDetail} tokens`);
    console.log(`[${this.name}]    Summarized: ${this.thresholds.fullDetail}-${this.thresholds.summarized} tokens`);
    console.log(`[${this.name}]    Key facts: ${this.thresholds.summarized}-${this.thresholds.keyFacts} tokens`);
    console.log(`[${this.name}]    Archive: > ${this.thresholds.archive} tokens`);
    
    return { success: true };
  }

  /**
   * Estimate token count (rough: ~4 chars per token)
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if compression is needed and perform it
   */
  async checkAndCompress(messages) {
    const totalTokens = this.calculateTotalTokens(messages);
    
    console.log(`[${this.name}] 📊 Current context: ~${totalTokens} tokens`);
    
    if (totalTokens <= this.thresholds.fullDetail) {
      // No compression needed
      return { compressed: false, messages, tokens: totalTokens };
    }

    console.log(`[${this.name}] 🗜️ Compression needed (threshold: ${this.thresholds.fullDetail})`);
    
    const compressed = await this.compress(messages, totalTokens);
    
    return {
      compressed: true,
      messages: compressed.messages,
      tokens: compressed.newTokenCount,
      saved: totalTokens - compressed.newTokenCount
    };
  }

  /**
   * Calculate total tokens in messages
   */
  calculateTotalTokens(messages) {
    return messages.reduce((total, msg) => {
      const content = msg.content || msg.text || '';
      return total + this.estimateTokens(content);
    }, 0);
  }

  /**
   * Compress messages based on age/position
   */
  async compress(messages, totalTokens) {
    // Split messages into segments
    const recentCount = Math.min(20, Math.floor(messages.length * 0.2));  // Last 20%
    const recent = messages.slice(-recentCount);
    const older = messages.slice(0, -recentCount);
    
    console.log(`[${this.name}]    Keeping ${recent.length} recent messages in full`);
    console.log(`[${this.name}]    Compressing ${older.length} older messages`);
    
    // Compress older messages
    const compressedOlder = await this.compressMessages(older, totalTokens);
    
    // Combine
    const result = [...compressedOlder, ...recent];
    const newTokenCount = this.calculateTotalTokens(result);
    
    this.stats.compressions++;
    this.stats.tokensSaved += (totalTokens - newTokenCount);
    
    console.log(`[${this.name}] ✅ Compressed: ${totalTokens} → ${newTokenCount} tokens (saved ${totalTokens - newTokenCount})`);
    
    return { messages: result, newTokenCount };
  }

  /**
   * Compress a set of messages
   */
  async compressMessages(messages, contextTokens) {
    if (messages.length === 0) return [];
    
    // Determine compression level based on context size
    let compressionLevel = 'summary';
    if (contextTokens > this.thresholds.keyFacts) {
      compressionLevel = 'keyFacts';
    }
    
    // Group messages into chunks for summarization
    const chunkSize = 10;
    const chunks = [];
    
    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize));
    }
    
    // Compress each chunk
    const compressed = [];
    
    for (const chunk of chunks) {
      const summary = await this.summarizeChunk(chunk, compressionLevel);
      
      if (summary) {
        compressed.push({
          role: 'system',
          content: summary,
          metadata: {
            compressed: true,
            originalCount: chunk.length,
            compressionLevel,
            timestamp: Date.now()
          }
        });
      }
    }
    
    return compressed;
  }

  /**
   * Summarize a chunk of messages
   */
  async summarizeChunk(messages, level = 'summary') {
    // Build text from messages
    const text = messages.map(m => {
      const role = m.role || 'unknown';
      const content = m.content || m.text || '';
      return `${role}: ${content}`;
    }).join('\n\n');

    // If no QuadBrain, use simple extraction
    if (!this.quadBrain) {
      return this.simpleSummarize(text, level);
    }

    try {
      // Use QuadBrain for intelligent summarization
      const prompt = level === 'keyFacts' 
        ? `Extract only the KEY FACTS and IMPORTANT DECISIONS from this conversation. Be extremely brief (2-3 sentences max):\n\n${text}`
        : `Summarize this conversation, preserving important context and decisions. Be concise:\n\n${text}`;
      
      const result = await this.quadBrain.reason(prompt, 'fast', {
        localModel: true, // Summarization is well within soma 3.2B capability
        context: { task: 'compression' }
      });
      
      return `[Compressed ${messages.length} messages]: ${result.text || result.response}`;
    } catch (error) {
      console.warn(`[${this.name}] QuadBrain summarization failed, using simple method`);
      return this.simpleSummarize(text, level);
    }
  }

  /**
   * Simple summarization without AI
   */
  simpleSummarize(text, level) {
    const ratio = level === 'keyFacts' 
      ? this.compressionRatios.keyFacts 
      : this.compressionRatios.summary;
    
    const targetLength = Math.floor(text.length * ratio);
    
    // Extract key sentences (simple heuristic)
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    // Score sentences by importance indicators
    const scored = sentences.map(sentence => {
      let score = 0;
      
      // Boost for decision words
      if (/decided|will|should|must|important|key|critical|remember/i.test(sentence)) {
        score += 2;
      }
      
      // Boost for questions and answers
      if (/\?|because|therefore|so|thus/i.test(sentence)) {
        score += 1;
      }
      
      // Boost for names/specifics
      if (/[A-Z][a-z]+|\\d+/g.test(sentence)) {
        score += 1;
      }
      
      return { sentence, score };
    });
    
    // Sort by score and take top sentences up to target length
    scored.sort((a, b) => b.score - a.score);
    
    let summary = '';
    for (const { sentence } of scored) {
      if (summary.length + sentence.length > targetLength) break;
      summary += sentence.trim() + '. ';
    }
    
    return `[Compressed]: ${summary.trim()}` || '[Compressed]: (conversation context)';
  }

  /**
   * Archive old summaries to long-term memory
   */
  async archiveToLongTerm(summary, metadata = {}) {
    if (!this.mnemonic) {
      console.warn(`[${this.name}] Cannot archive - Mnemonic not available`);
      return false;
    }

    try {
      await this.mnemonic.remember(
        summary,
        {
          type: 'conversation_archive',
          compressed: true,
          ...metadata,
          timestamp: Date.now()
        }
      );
      
      this.stats.archivesCreated++;
      console.log(`[${this.name}] 📦 Archived to long-term memory`);
      return true;
    } catch (error) {
      console.error(`[${this.name}] Archive failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get compression statistics
   */
  getStats() {
    return {
      ...this.stats,
      averageSavings: this.stats.compressions > 0 
        ? Math.round(this.stats.tokensSaved / this.stats.compressions)
        : 0
    };
  }

  /**
   * Process conversation history and compress if needed
   * Call this periodically or before adding new messages
   */
  async processHistory() {
    if (!this.conversationHistory) {
      return { success: false, error: 'No conversation history connected' };
    }

    try {
      // Get all messages from current session
      const messages = this.conversationHistory.getRecentMessages(500);
      const totalTokens = this.calculateTotalTokens(messages);
      
      if (totalTokens <= this.thresholds.fullDetail) {
        return { 
          success: true, 
          compressed: false, 
          tokens: totalTokens 
        };
      }

      // Compress and update
      const result = await this.checkAndCompress(messages);
      
      // Archive if we're way over limit
      if (totalTokens > this.thresholds.archive) {
        const oldestChunk = messages.slice(0, Math.floor(messages.length * 0.3));
        const archiveSummary = await this.summarizeChunk(oldestChunk, 'keyFacts');
        await this.archiveToLongTerm(archiveSummary, {
          sessionId: this.conversationHistory.currentSessionId,
          messageCount: oldestChunk.length
        });
      }

      return {
        success: true,
        compressed: true,
        originalTokens: totalTokens,
        newTokens: result.tokens,
        saved: result.saved
      };
    } catch (error) {
      console.error(`[${this.name}] Process history failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

export default ConversationCompressor;
