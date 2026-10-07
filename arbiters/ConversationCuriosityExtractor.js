/**
 * ConversationCuriosityExtractor.js
 *
 * Analyzes SOMA's conversations to identify what sparked her curiosity
 *
 * Looks for patterns like:
 * - Topics the user mentioned that SOMA doesn't fully understand
 * - Questions SOMA couldn't answer completely
 * - Concepts that came up repeatedly in conversation
 * - Areas where SOMA gave uncertain or incomplete responses
 * - New domains the user asked about
 *
 * This feeds the CuriosityEngine with conversation-driven learning goals.
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class ConversationCuriosityExtractor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'ConversationCuriosityExtractor';

    this.experiencesDir = opts.experiencesDir || path.join(process.cwd(), '.soma', 'experiences');
    this.curiosityEngine = opts.curiosityEngine || null;
    this.quadBrain = opts.quadBrain || null;

    // Extraction results
    this.uncertainTopics = new Map(); // topic -> uncertainty_score
    this.repeatedConcepts = new Map(); // concept -> frequency
    this.newDomains = new Map(); // domain -> first_seen
    this.incompleteResponses = []; // Responses SOMA wasn't confident about
    this.userInterests = new Map(); // What user talks about most

    // Curiosity triggers
    this.curiosityTriggers = [];

    // Stats
    this.stats = {
      conversationsAnalyzed: 0,
      experiencesProcessed: 0,
      uncertaintiesFound: 0,
      curiosityQuestionsGenerated: 0,
      lastAnalysisTime: null
    };

    console.log(`[${this.name}] 💬 Conversation Curiosity Extractor initialized`);
  }

  /**
   * Analyze recent conversations for curiosity triggers
   */
  async analyzeConversations(maxFiles = 50) {
    console.log(`[${this.name}] 💬 Analyzing conversations for curiosity triggers...`);
    const startTime = Date.now();

    this.uncertainTopics.clear();
    this.repeatedConcepts.clear();
    this.incompleteResponses = [];
    this.curiosityTriggers = [];

    // Load recent experience files
    const files = await this._getRecentExperienceFiles(maxFiles);
    console.log(`[${this.name}]    Found ${files.length} recent experience files`);

    // Process each file
    for (const file of files) {
      await this._processExperienceFile(file);
    }

    // Detect patterns
    await this._detectCuriosityPatterns();

    // Generate curiosity questions
    const questions = await this._generateCuriosityQuestions();

    // Stats
    const duration = Date.now() - startTime;
    this.stats.lastAnalysisTime = Date.now();

    console.log(`[${this.name}] ✅ Conversation analysis complete (${(duration / 1000).toFixed(1)}s)`);
    console.log(`[${this.name}]    Conversations: ${this.stats.conversationsAnalyzed}`);
    console.log(`[${this.name}]    Experiences: ${this.stats.experiencesProcessed}`);
    console.log(`[${this.name}]    Uncertainties: ${this.stats.uncertaintiesFound}`);
    console.log(`[${this.name}]    Curiosity Questions: ${questions.length}`);

    return {
      uncertainTopics: Array.from(this.uncertainTopics.entries()),
      repeatedConcepts: Array.from(this.repeatedConcepts.entries()),
      newDomains: Array.from(this.newDomains.entries()),
      userInterests: Array.from(this.userInterests.entries()),
      curiosityQuestions: questions,
      stats: this.stats
    };
  }

  /**
   * Get recent experience files
   */
  async _getRecentExperienceFiles(maxFiles) {
    try {
      const allFiles = await fs.readdir(this.experiencesDir);
      const experienceFiles = allFiles
        .filter(f => f.startsWith('experiences_') && f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, maxFiles);

      return experienceFiles.map(f => path.join(this.experiencesDir, f));
    } catch (error) {
      console.error(`[${this.name}] Error reading experiences directory:`, error.message);
      return [];
    }
  }

  /**
   * Process a single experience file
   */
  async _processExperienceFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      const experiences = Array.isArray(data) ? data : (data.experiences || []);

      this.stats.conversationsAnalyzed++;

      for (const exp of experiences) {
        this.stats.experiencesProcessed++;
        await this._extractCuriosityFromExperience(exp);
      }
    } catch (error) {
      // Skip malformed files
    }
  }

  /**
   * Extract curiosity triggers from a single experience
   */
  async _extractCuriosityFromExperience(exp) {
    // 1. Check for uncertain responses (low reward = uncertainty)
    if (exp.reward !== undefined && exp.reward < 0.5) {
      this.stats.uncertaintiesFound++;

      // Extract topic from state
      const topic = this._extractTopic(exp.state);
      if (topic) {
        const currentScore = this.uncertainTopics.get(topic) || 0;
        this.uncertainTopics.set(topic, currentScore + (1 - exp.reward));
      }

      // Store incomplete response
      this.incompleteResponses.push({
        topic,
        state: this._summarizeState(exp.state),
        action: exp.action,
        reward: exp.reward,
        timestamp: exp.timestamp
      });
    }

    // 2. Track repeated concepts (what user talks about)
    const concepts = this._extractConcepts(exp.state);
    for (const concept of concepts) {
      const count = this.repeatedConcepts.get(concept) || 0;
      this.repeatedConcepts.set(concept, count + 1);
    }

    // 3. Detect new domains
    if (exp.metadata?.domain) {
      if (!this.newDomains.has(exp.metadata.domain)) {
        this.newDomains.set(exp.metadata.domain, exp.timestamp || Date.now());
      }
    }

    // 4. Track user interests (what do they ask about most)
    if (exp.state?.query || exp.state?.request) {
      const interest = this._extractInterest(exp.state);
      if (interest) {
        const count = this.userInterests.get(interest) || 0;
        this.userInterests.set(interest, count + 1);
      }
    }
  }

  /**
   * Extract topic from experience state
   */
  _extractTopic(state) {
    if (typeof state === 'string') {
      return this._extractKeywords(state)[0];
    }

    if (state?.query) {
      return this._extractKeywords(state.query)[0];
    }

    if (state?.topic) {
      return state.topic;
    }

    if (state?.domain) {
      return state.domain;
    }

    return 'unknown';
  }

  /**
   * Extract concepts from state — reads actual message text, not JSON structure
   */
  _extractConcepts(state) {
    if (!state) return [];
    // Pull the human-readable text from the state, not the serialized JSON object.
    // JSON.stringify was returning field names (timestamp, sessionId, emotionalState)
    // as the top "keywords", sending the curiosity engine off to research metadata noise.
    const text =
      state.query ||
      state.request ||
      state.message ||
      state.text ||
      state.content ||
      (typeof state === 'string' ? state : '');
    if (!text) return [];
    return this._extractKeywords(text).slice(0, 5);
  }

  /**
   * Extract interest area from state
   */
  _extractInterest(state) {
    const query = state.query || state.request || '';
    const keywords = this._extractKeywords(query);

    // Group keywords into interest areas
    const interestAreas = {
      code: ['code', 'function', 'class', 'programming', 'javascript', 'python', 'debug', 'error'],
      ai: ['ai', 'model', 'training', 'learning', 'neural', 'llm', 'gpt', 'claude'],
      medical: ['medical', 'health', 'diagnosis', 'treatment', 'patient', 'oncology'],
      legal: ['legal', 'law', 'compliance', 'audit', 'regulation', 'contract'],
      science: ['quantum', 'physics', 'chemistry', 'biology', 'research'],
      data: ['data', 'analysis', 'statistics', 'visualization', 'metrics']
    };

    for (const [area, terms] of Object.entries(interestAreas)) {
      if (keywords.some(k => terms.includes(k.toLowerCase()))) {
        return area;
      }
    }

    return keywords[0] || 'general';
  }

  /**
   * Extract keywords from text
   */
  _extractKeywords(text) {
    if (!text || typeof text !== 'string') return [];

    // Simple keyword extraction
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3) // Min 4 chars
      .filter(w => !this._isStopWord(w));

    // Count frequency
    const freq = new Map();
    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    // Sort by frequency
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);
  }

  /**
   * Check if word is a stop word
   */
  _isStopWord(word) {
    const stopWords = new Set([
      // Common English stop words
      'this', 'that', 'with', 'from', 'have', 'what', 'when', 'where',
      'which', 'will', 'would', 'could', 'should', 'there', 'their',
      'about', 'into', 'through', 'during', 'before', 'after',
      'then', 'than', 'also', 'just', 'like', 'some', 'more', 'very',
      'your', 'they', 'them', 'been', 'were', 'said', 'each', 'does',
      'much', 'make', 'such', 'even', 'most', 'tell', 'does', 'want',
      'know', 'need', 'look', 'come', 'here', 'back', 'good', 'well',
      // JSON / state field names that were leaking through before the fix
      'query', 'request', 'message', 'timestamp', 'sessionid', 'session',
      'emotionalstate', 'emotional', 'state', 'metadata', 'payload',
      'response', 'result', 'error', 'status', 'data', 'type', 'null',
      'true', 'false', 'undefined', 'object', 'array', 'string', 'number',
    ]);
    return stopWords.has(word);
  }

  /**
   * Summarize state for display
   */
  _summarizeState(state) {
    if (typeof state === 'string') {
      return state.substring(0, 100);
    }
    return JSON.stringify(state).substring(0, 100);
  }

  /**
   * Detect curiosity patterns from extracted data
   */
  async _detectCuriosityPatterns() {
    // 1. Topics with high uncertainty = should learn more
    for (const [topic, uncertainty] of this.uncertainTopics) {
      if (uncertainty > 1.0) { // Multiple uncertain responses
        this.curiosityTriggers.push({
          type: 'uncertainty',
          topic,
          score: uncertainty,
          priority: Math.min(0.9, 0.5 + uncertainty * 0.2),
          reason: `Low confidence in responses about ${topic}`
        });
      }
    }

    // 2. Repeated concepts = user cares about this
    for (const [concept, frequency] of this.repeatedConcepts) {
      if (frequency >= 5) { // Mentioned 5+ times
        this.curiosityTriggers.push({
          type: 'repeated',
          concept,
          frequency,
          priority: Math.min(0.8, 0.4 + frequency * 0.05),
          reason: `User frequently discusses ${concept} (${frequency} times)`
        });
      }
    }

    // 3. New domains = explore thoroughly
    for (const [domain, firstSeen] of this.newDomains) {
      const age = Date.now() - firstSeen;
      if (age < 7 * 24 * 60 * 60 * 1000) { // Within last week
        this.curiosityTriggers.push({
          type: 'new_domain',
          domain,
          firstSeen,
          priority: 0.7,
          reason: `New domain introduced recently: ${domain}`
        });
      }
    }

    // 4. User interests = align learning with user needs
    const topInterests = Array.from(this.userInterests.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    for (const [interest, count] of topInterests) {
      this.curiosityTriggers.push({
        type: 'user_interest',
        interest,
        frequency: count,
        priority: 0.6,
        reason: `User primary interest: ${interest} (${count} queries)`
      });
    }
  }

  /**
   * Generate curiosity questions from patterns
   */
  async _generateCuriosityQuestions() {
    const questions = [];

    for (const trigger of this.curiosityTriggers) {
      let question;

      switch (trigger.type) {
        case 'uncertainty':
          question = `I was uncertain about ${trigger.topic} - what should I learn to improve?`;
          break;

        case 'repeated':
          question = `The user talks about ${trigger.concept} often - how can I become an expert?`;
          break;

        case 'new_domain':
          question = `We started discussing ${trigger.domain} - what fundamentals should I master?`;
          break;

        case 'user_interest':
          question = `The user is interested in ${trigger.interest} - what advanced topics should I explore?`;
          break;
      }

      if (question) {
        const q = {
          type: 'conversation_driven',
          question,
          priority: trigger.priority,
          source: 'conversation_analysis',
          trigger
        };

        questions.push(q);

        // Feed to CuriosityEngine
        if (this.curiosityEngine) {
          this.curiosityEngine.addToCuriosityQueue(q);
        }
      }
    }

    this.stats.curiosityQuestionsGenerated = questions.length;

    if (this.curiosityEngine) {
      console.log(`[${this.name}]    → Added ${questions.length} conversation-driven questions to CuriosityEngine`);
    }

    return questions;
  }

  /**
   * Get top curiosity triggers
   */
  getTopTriggers(count = 10) {
    return this.curiosityTriggers
      .sort((a, b) => b.priority - a.priority)
      .slice(0, count);
  }

  /**
   * Get summary
   */
  getSummary() {
    return {
      stats: this.stats,
      topTriggers: this.getTopTriggers(10),
      uncertainTopics: Array.from(this.uncertainTopics.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      topConcepts: Array.from(this.repeatedConcepts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      userInterests: Array.from(this.userInterests.entries())
        .sort((a, b) => b[1] - a[1])
    };
  }
}

export default ConversationCuriosityExtractor;
