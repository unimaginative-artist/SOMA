// ════════════════════════════════════════════════════════════════════════════
// CognitiveBridge — Bridge between Cognitive Components
// ════════════════════════════════════════════════════════════════════════════
// PURPOSE: Learning, pattern recognition, knowledge acquisition, predictive routing
// ════════════════════════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');

class CognitiveBridge extends BaseArbiter {
  constructor(broker, config = {}) {
    super(broker, {
      name: 'CognitiveBridge',
      role: 'cognitive-learning',
      ...config
    });

    this.memoryPath = config.memoryPath || './cognitive-memory';
    this.learningData = {
      concepts: new Map(),
      patterns: new Map(),
      experiences: [],
      knowledgeIndex: new Map()
    };
    
    this.isLearning = true;
    this.metrics = {
      conceptsLearned: 0,
      patternsDiscovered: 0,
      autonomyLevel: 0.3,
      totalInteractions: 0
    };
  }

  async initialize() {
    await super.initialize();
    this.log('info', '🧠 CognitiveBridge initializing...');
    
    await fs.mkdir(this.memoryPath, { recursive: true });
    await this.loadCognitiveState();
    
    this.log('info', `   Concepts: ${this.learningData.concepts.size}`);
    this.log('info', `   Patterns: ${this.learningData.patterns.size}`);
    this.log('info', `   Autonomy: ${(this.metrics.autonomyLevel * 100).toFixed(1)}%`);
    
    // Subscribe to messages
    this.subscribe('cognitive.learn', this.learnFromInteraction.bind(this));
    this.subscribe('cognitive.predict', this.predictRoute.bind(this));
    this.subscribe('cognitive.acquire', this.acquireKnowledge.bind(this));
  }

  // ==================== LEARNING FROM INTERACTIONS ====================

  async learnFromInteraction(data) {
    const { query, response, context = {} } = data;
    this.log('info', '📚 Learning from interaction...');
    
    // Extract concepts
    const concepts = this.extractConcepts(query + ' ' + (response.result?.response || ''));
    concepts.forEach(concept => {
      if (!this.learningData.concepts.has(concept)) {
        this.learningData.concepts.set(concept, {
          count: 1,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          context: []
        });
        this.metrics.conceptsLearned++;
      } else {
        const data = this.learningData.concepts.get(concept);
        data.count++;
        data.lastSeen = Date.now();
      }
    });

    // Discover patterns
    const pattern = this.discoverPattern(query, response, context);
    if (pattern) {
      const patternKey = pattern.signature;
      if (!this.learningData.patterns.has(patternKey)) {
        this.learningData.patterns.set(patternKey, pattern);
        this.metrics.patternsDiscovered++;
      } else {
        const existing = this.learningData.patterns.get(patternKey);
        existing.count++;
        existing.successRate = (existing.successRate * (existing.count - 1) + (response.success ? 1 : 0)) / existing.count;
      }
    }

    // Store experience
    this.learningData.experiences.push({
      query,
      response: response.result?.response?.substring(0, 200) || '',
      hemisphere: response.hemisphere,
      arbiter: response.arbiterRoute?.arbiter || 'none',
      success: response.success !== false,
      timestamp: Date.now()
    });

    // Keep only recent experiences
    if (this.learningData.experiences.length > 100) {
      this.learningData.experiences = this.learningData.experiences.slice(-100);
    }

    this.metrics.totalInteractions++;
    this.metrics.autonomyLevel = Math.min(0.95, this.metrics.autonomyLevel + 0.001);

    // Save periodically
    if (this.metrics.totalInteractions % 10 === 0) {
      await this.saveCognitiveState();
    }
    
    return { success: true, metrics: this.metrics };
  }

  extractConcepts(text) {
    const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'were', 'will', 'would', 'could', 'should']);
    
    const concepts = words
      .filter(w => !stopWords.has(w))
      .reduce((acc, word) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
      }, {});

    return Object.entries(concepts)
      .filter(([_, count]) => count > 1)
      .map(([word]) => word)
      .slice(0, 5);
  }

  discoverPattern(query, response, context) {
    const queryLower = query.toLowerCase();
    
    const actions = ['create', 'generate', 'build', 'write', 'analyze', 'fetch', 'store', 'compress', 'summarize'];
    const foundAction = actions.find(action => queryLower.includes(action));
    
    const objects = ['code', 'file', 'data', 'arbiter', 'content', 'article', 'website'];
    const foundObject = objects.find(obj => queryLower.includes(obj));

    if (foundAction || foundObject) {
      return {
        signature: `${foundAction || 'generic'}_${foundObject || 'unknown'}`,
        action: foundAction,
        object: foundObject,
        hemisphere: response.hemisphere,
        arbiter: response.arbiterRoute?.arbiter,
        count: 1,
        successRate: response.success !== false ? 1.0 : 0.0,
        confidence: response.confidence || 0.5,
        timestamp: Date.now()
      };
    }

    return null;
  }

  // ==================== PREDICTIVE ROUTING ====================

  predictRoute(data) {
    const { query } = data;
    this.log('info', '🎯 Predicting route from learned patterns...');
    
    const queryLower = query.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const [signature, pattern] of this.learningData.patterns) {
      let score = 0;

      if (pattern.action && queryLower.includes(pattern.action)) {
        score += 3;
      }
      if (pattern.object && queryLower.includes(pattern.object)) {
        score += 3;
      }

      score *= pattern.successRate;
      score *= Math.log(pattern.count + 1);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }

    if (bestMatch && bestScore > 2) {
      return {
        predicted: true,
        hemisphere: bestMatch.hemisphere,
        arbiter: bestMatch.arbiter,
        confidence: Math.min(bestMatch.successRate * (bestScore / 10), 0.95),
        pattern: bestMatch.signature
      };
    }

    return { predicted: false };
  }

  // ==================== KNOWLEDGE ACQUISITION ====================

  async acquireKnowledge(data) {
    const { topic } = data;
    this.log('info', `🕷️ Acquiring knowledge about: ${topic}`);
    
    try {
      const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
      const response = await fetch(searchUrl);
      
      if (response.ok) {
        const apiData = await response.json();
        
        const knowledge = {
          topic,
          title: apiData.title,
          summary: apiData.extract,
          url: apiData.content_urls?.desktop?.page,
          acquiredAt: Date.now()
        };

        this.learningData.knowledgeIndex.set(topic, knowledge);
        
        this.log('info', `✅ Acquired knowledge: ${topic}`);
        return { success: true, knowledge };
      }
    } catch (error) {
      this.log('warn', `⚠️ Knowledge acquisition failed: ${error.message}`);
    }

    return { success: false };
  }

  // ==================== PERSISTENCE ====================

  async saveCognitiveState() {
    try {
      const state = {
        concepts: Array.from(this.learningData.concepts.entries()),
        patterns: Array.from(this.learningData.patterns.entries()),
        experiences: this.learningData.experiences,
        knowledgeIndex: Array.from(this.learningData.knowledgeIndex.entries()),
        metrics: this.metrics,
        savedAt: Date.now()
      };

      const filepath = path.join(this.memoryPath, 'cognitive-state.json');
      await fs.writeFile(filepath, JSON.stringify(state, null, 2), 'utf8');
      
      this.log('info', '💾 Cognitive state saved');
    } catch (error) {
      this.log('error', `Failed to save cognitive state: ${error.message}`);
    }
  }

  async loadCognitiveState() {
    try {
      const filepath = path.join(this.memoryPath, 'cognitive-state.json');
      const data = await fs.readFile(filepath, 'utf8');
      const state = JSON.parse(data);

      this.learningData.concepts = new Map(state.concepts || []);
      this.learningData.patterns = new Map(state.patterns || []);
      this.learningData.experiences = state.experiences || [];
      this.learningData.knowledgeIndex = new Map(state.knowledgeIndex || []);
      this.metrics = { ...this.metrics, ...state.metrics };

      this.log('info', '📚 Cognitive state loaded');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.log('warn', `Failed to load cognitive state: ${error.message}`);
      }
    }
  }

  getInsights() {
    const topConcepts = Array.from(this.learningData.concepts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([concept, data]) => ({ concept, count: data.count }));

    const topPatterns = Array.from(this.learningData.patterns.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(p => ({
        signature: p.signature,
        count: p.count,
        successRate: (p.successRate * 100).toFixed(1) + '%',
        hemisphere: p.hemisphere,
        arbiter: p.arbiter
      }));

    return {
      topConcepts,
      topPatterns,
      totalLearned: this.metrics.conceptsLearned,
      autonomyLevel: (this.metrics.autonomyLevel * 100).toFixed(1) + '%'
    };
  }

  getStatus() {
    return {
      ...super.getStatus(),
      metrics: {
        ...this.metrics,
        concepts: this.learningData.concepts.size,
        patterns: this.learningData.patterns.size,
        experiences: this.learningData.experiences.length,
        knowledge: this.learningData.knowledgeIndex.size
      },
      isLearning: this.isLearning
    };
  }

  // ==================== DREAM AUDIT ====================

  async dreamAudit() {
    console.log('💭 Running Dream Audit...');

    // Analyze what's changed recently
    const now = Date.now();
    const recentThreshold = 24 * 60 * 60 * 1000; // Last 24 hours

    // Count recent concepts
    let recentConcepts = 0;
    for (const [_, data] of this.learningData.concepts) {
      if (now - data.lastSeen < recentThreshold) {
        recentConcepts++;
      }
    }

    // Count recent patterns
    let recentPatterns = 0;
    for (const [_, pattern] of this.learningData.patterns) {
      if (now - pattern.timestamp < recentThreshold) {
        recentPatterns++;
      }
    }

    // Recent experiences
    const recentExperiences = this.learningData.experiences.filter(
      exp => now - exp.timestamp < recentThreshold
    );

    // Calculate changes
    const changes = recentConcepts + recentPatterns;

    // Get top performing patterns
    const topPatterns = Array.from(this.learningData.patterns.values())
      .filter(p => now - p.timestamp < recentThreshold)
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 3)
      .map(p => ({
        signature: p.signature,
        successRate: (p.successRate * 100).toFixed(1) + '%'
      }));

    const insights = {
      changes,
      recentConcepts,
      recentPatterns,
      recentExperiences: recentExperiences.length,
      topPatterns,
      autonomyLevel: this.metrics.autonomyLevel,
      totalConcepts: this.learningData.concepts.size,
      totalPatterns: this.learningData.patterns.size,
      timestamp: now
    };

    console.log(`✅ Dream Audit complete: ${changes} changes detected`);

    return insights;
  }
}

module.exports = CognitiveBridge;






