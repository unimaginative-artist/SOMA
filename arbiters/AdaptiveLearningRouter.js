/**
 * AdaptiveLearningRouter.js
 *
 * Intelligent context-aware router for SOMA Quad-Brain architecture.
 * Routes queries to LOGOS/AURORA/PROMETHEUS/THALAMUS based on:
 *  - Query content & embeddings
 *  - Conversation history (last N messages)
 *  - User workflow & preferences
 *  - Temporal context (time of day)
 *  - Past routing performance (learns over time)
 *
 * Learns from every interaction to improve routing accuracy.
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

class AdaptiveLearningRouter extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'AdaptiveLearningRouter';

    // Dependencies
    this.embeddingFn = opts.embeddingFn || null;
    this.mnemonic = opts.mnemonic || null; // For storing routing memory
    this.outcomeTruth = opts.outcomeTruth || null;
    this.storagePath = opts.storagePath || path.join(process.cwd(), 'SOMA', 'adaptive-routing-memory.json');
    this._persistenceReady = false;
    this._writeChain = Promise.resolve();

    // Configuration
    this.contextWindow = opts.contextWindow || 5;
    this.probeTokenLimit = opts.probeTokenLimit || 50;
    this.fullCallTokenLimit = opts.fullCallTokenLimit || 1000;

    // Learning memory (persisted to mnemonic)
    this.routingMemory = new Map(); // pattern -> [{ brain, satisfaction, timestamp }]
    this.userProfiles = new Map();  // userId -> { favoriteBrain, workflows, stats }
    this.conversationContexts = new Map(); // sessionId -> { history, topic, mood }

    // Performance tracking
    this.stats = {
      totalRoutes: 0,
      directHits: 0,
      probeRoutes: 0,
      multiProbeRoutes: 0,
      safetyBlocks: 0,
      avgTokensPerRoute: 0
    };

    // Safety patterns (pre-filter before THALAMUS call)
    this.dangerPatterns = [
      /\b(hack|exploit|malware|virus|weaponize|crack|bypass)\b/i,
      /\b(kill|harm|suicide|murder|bomb|weapon)\b/i,
      /\b(racist|sexist|discriminate|hate\s+speech)\b/i
    ];

    // Load persisted memory if available
    // Moved to initialize()
    
    console.log(`[${this.name}] Initialized with context window: ${this.contextWindow}`);
  }

  async initialize() {
    await this._loadPersistedMemory();
    this._persistenceReady = true;
    console.log(`[${this.name}] ✅ Router initialized`);
  }

  /**
   * Main routing entry point
   * @param {string} query - User query
   * @param {object} context - Rich context object
   * @returns {object} - { brain, method, confidence, route_decision }
   */
  async route(query, context = {}) {
    this.stats.totalRoutes++;
    const startTime = Date.now();

    try {
      // Step 1: Build comprehensive context profile
      const profile = await this.buildContextProfile(query, context);

      // Step 2: Safety pre-filter (fast, no API call)
      const quickSafety = this.quickSafetyCheck(query);
      if (quickSafety.needsFullCheck) {
        this.stats.safetyBlocks++;
        return {
          brain: 'THALAMUS',
          method: 'safety_gate',
          confidence: 1.0,
          profile,
          reasoning: 'Safety patterns detected - full THALAMUS check required'
        };
      }

      // Step 3: Check routing memory (have we seen similar queries?)
      const memoryMatch = await this.checkRoutingMemory(query, profile);
      if (memoryMatch && memoryMatch.confidence > 0.85) {
        this.stats.directHits++;
        this.emit('route:direct', { query, brain: memoryMatch.brain, confidence: memoryMatch.confidence });
        return {
          brain: memoryMatch.brain,
          method: 'memory_direct',
          confidence: memoryMatch.confidence,
          profile,
          reasoning: `Past experience: ${memoryMatch.brain} performed well on similar queries`
        };
      }

      // Step 4: Context-aware scoring (no API calls, just heuristics)
      const scores = await this.scoreWithContext(query, profile);
      const topScore = Math.max(scores.LOGOS, scores.AURORA, scores.PROMETHEUS);
      const topBrain = Object.keys(scores).find(k => scores[k] === topScore);

      this.emit('route:scores', { query, scores });

      // Step 5: Decision logic based on confidence
      
      // NEW: Synesthesia (Collaborative Synthesis) check
      // If top 2 scores are both high and close, trigger synthesis
      const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      const [brain1, score1] = sortedScores[0];
      const [brain2, score2] = sortedScores[1];

      if (score1 > 0.75 && score2 > 0.70 && (score1 - score2) < 0.15) {
        this.emit('route:synthesis', { query, brains: [brain1, brain2] });
        return {
          brain: brain1, // Primary lead
          method: 'synthesis',
          synthesisBrains: [brain1, brain2],
          confidence: score1,
          scores,
          profile,
          reasoning: `Synthesis opportunity: ${brain1} and ${brain2} both have high confidence`
        };
      }

      if (topScore > 0.80) {
        // High confidence - route directly (most token-efficient)
        this.stats.directHits++;
        return {
          brain: topBrain,
          method: 'direct_high_confidence',
          confidence: topScore,
          scores,
          profile,
          reasoning: `High confidence (${topScore.toFixed(2)}) for ${topBrain}`
        };

      } else if (topScore > 0.60) {
        // Medium confidence - probe top 2 brains
        this.stats.probeRoutes++;
        const top2 = Object.entries(scores)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([brain]) => brain);

        return {
          brain: top2[0],
          fallbackBrain: top2[1],
          method: 'probe_top2',
          confidence: topScore,
          scores,
          profile,
          reasoning: `Medium confidence - probe ${top2.join(' + ')}`
        };

      } else {
        // Low confidence - probe all 3 brains
        this.stats.multiProbeRoutes++;
        return {
          brain: null, // Will probe all
          method: 'probe_all',
          probeBrains: ['LOGOS', 'AURORA', 'PROMETHEUS'],
          confidence: topScore,
          scores,
          profile,
          reasoning: 'Low confidence - probing all brains'
        };
      }

    } catch (err) {
      console.error(`[${this.name}] Routing error:`, err);
      // Safe fallback
      return {
        brain: 'LOGOS',
        method: 'error_fallback',
        confidence: 0.5,
        error: err.message
      };
    } finally {
      const elapsed = Date.now() - startTime;
      this.emit('route:complete', { query, elapsed });
    }
  }

  /**
   * Build comprehensive context profile
   */
  async buildContextProfile(query, context) {
    const sessionId = context.sessionId || context.userId || 'default';

    // Get or create conversation context
    let convContext = this.conversationContexts.get(sessionId);
    if (!convContext) {
      convContext = { history: [], topic: 'general', mood: 'neutral' };
      this.conversationContexts.set(sessionId, convContext);
    }

    // Update conversation history
    convContext.history.push({
      query,
      timestamp: Date.now(),
      brain: context.lastBrain || null
    });

    // Keep only recent history (sliding window)
    if (convContext.history.length > this.contextWindow) {
      convContext.history = convContext.history.slice(-this.contextWindow);
    }

    // Infer conversation topic and mood
    convContext.topic = this.inferTopic(convContext.history);
    convContext.mood = this.inferMood(convContext.history);

    // Get user profile
    const userId = context.userId || 'anonymous';
    let userProfile = this.userProfiles.get(userId);
    if (!userProfile) {
      userProfile = {
        favoriteBrain: null,
        workflows: {},
        totalQueries: 0,
        brainUsage: { LOGOS: 0, AURORA: 0, PROMETHEUS: 0, THALAMUS: 0 }
      };
      this.userProfiles.set(userId, userProfile);
    }
    userProfile.totalQueries++;

    // Build profile
    const profile = {
      // Query
      query,
      queryEmbedding: null, // Compute on demand
      queryLength: query.length,

      // Conversation context
      conversationHistory: convContext.history,
      conversationTopic: convContext.topic,
      conversationMood: convContext.mood,
      recentBrains: convContext.history.slice(-3).map(h => h.brain).filter(Boolean),

      // User context
      userId,
      userWorkflow: context.currentWorkflow || context.currentProject || 'general',
      userPreferences: userProfile,

      // Temporal context
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),

      // System context
      recentMemories: context.recentMemories || [],
      activeProjects: context.activeProjects || [],
      systemState: context.systemState || 'normal',

      // Session
      sessionId
    };

    return profile;
  }

  /**
   * Quick safety pre-filter (no API call)
   */
  quickSafetyCheck(query) {
    for (const pattern of this.dangerPatterns) {
      if (pattern.test(query)) {
        return {
          ok: false,
          needsFullCheck: true,
          pattern: pattern.source
        };
      }
    }
    return { ok: true, needsFullCheck: false };
  }

  /**
   * Check routing memory for similar queries
   */
  async checkRoutingMemory(query, profile) {
    const pattern = this.extractQueryPattern(query);
    const key = `${pattern}:${profile.conversationTopic}`;
    const history = this.routingMemory.get(key);

    if (!history || history.length < 2) return null;

    // Analyze past performance (recent 10 records)
    const recentHistory = history.slice(-10);
    const brainPerformance = {};

    for (const record of recentHistory) {
      if (!brainPerformance[record.brain]) {
        brainPerformance[record.brain] = { total: 0, count: 0 };
      }
      brainPerformance[record.brain].total += record.satisfaction;
      brainPerformance[record.brain].count += 1;
    }

    // Find best performer
    let bestBrain = null;
    let bestScore = 0;

    for (const [brain, stats] of Object.entries(brainPerformance)) {
      const avgScore = stats.total / stats.count;
      if (avgScore > bestScore && stats.count >= 2) { // Need at least 2 samples
        bestScore = avgScore;
        bestBrain = brain;
      }
    }

    return bestBrain ? { brain: bestBrain, confidence: bestScore } : null;
  }

  /**
   * Score brains with context awareness
   */
  async scoreWithContext(query, profile) {
    const scores = {
      LOGOS: this.scoreLogos(query, profile),
      AURORA: this.scoreAurora(query, profile),
      PROMETHEUS: this.scorePrometheus(query, profile)
    };

    // Apply context modifiers
    this.applyConversationContext(scores, profile);
    this.applyUserPreferences(scores, profile);
    this.applyWorkflowContext(scores, profile);
    this.applyTemporalContext(scores, profile);

    // Normalize scores to 0-1 range
    for (const brain in scores) {
      scores[brain] = Math.max(0, Math.min(1, scores[brain]));
    }

    return scores;
  }

  /**
   * LOGOS scoring - Analytical, logical, mathematical
   */
  scoreLogos(query, profile) {
    let score = 0.30; // baseline
    // Extract string from query (might be object or string)
    const queryStr = typeof query === 'string' ? query : ((query && query.query) || (query && query.text) || String(query));
    const q = queryStr.toLowerCase();

    // Strong signals
    if (new RegExp('\\b(why|how|prove|verify|demonstrate|explain|analyze|time|clock|date|weather)\\b').test(q)) {
      score += 0.35;
    }
    if (new RegExp('\\b(calculate|compute|solve|equation|formula|algorithm)\\b').test(q)) {
      score += 0.40;
    }
    if (new RegExp('\\b(debug|error|bug|fix|problem|issue|troubleshoot)\\b').test(q)) {
      score += 0.30;
    }
    if (new RegExp('\\b(logic|reasoning|rational|systematic|methodical)\\b').test(q)) {
      score += 0.25;
    }

    // Code-related
    if (new RegExp('\\b(code|function|class|method|variable|syntax)\\b').test(q)) {
      score += 0.30;
    }

    // Anti-signals (decrease score)
    if (new RegExp('\\b(creative|imagine|story|art|design|metaphor)\\b').test(q)) {
      score -= 0.30;
    }
    if (new RegExp('\\b(plan|roadmap|strategy|milestone|timeline)\\b').test(q)) {
      score -= 0.20;
    }

    return score;
  }

  /**
   * AURORA scoring - Creative, imaginative, artistic
   */
  scoreAurora(query, profile) {
    let score = 0.30;
    // Extract string from query (might be object or string)
    const queryStr = typeof query === 'string' ? query : ((query && query.query) || (query && query.text) || String(query));
    const q = queryStr.toLowerCase();

    // Strong signals
    if (new RegExp('\\b(idea|imagine|creative|innovate|invent)\\b').test(q)) {
      score += 0.40;
    }
    if (new RegExp('\\b(story|narrative|write|draft|compose)\\b').test(q)) {
      score += 0.35;
    }
    if (new RegExp('\\b(variant|alternative|different|unique|novel)\\b').test(q)) {
      score += 0.30;
    }
    if (new RegExp('\\b(what if|suppose|hypothetical|scenario)\\b').test(q)) {
      score += 0.35;
    }
    if (new RegExp('\\b(art|design|aesthetic|style|metaphor)\\b').test(q)) {
      score += 0.30;
    }
    if (new RegExp('\\b(brainstorm|ideate|explore|discover)\\b').test(q)) {
      score += 0.25;
    }

    // Anti-signals
    if (new RegExp('\\b(calculate|compute|prove|verify|debug)\\b').test(q)) {
      score -= 0.30;
    }

    return score;
  }

  /**
   * PROMETHEUS scoring - Planning, strategy, forecasting
   */
  scorePrometheus(query, profile) {
    let score = 0.30;
    // Extract string from query (might be object or string)
    const queryStr = typeof query === 'string' ? query : ((query && query.query) || (query && query.text) || String(query));
    const q = queryStr.toLowerCase();

    // Strong signals
    if (new RegExp('\\b(plan|planning|roadmap|strategy)\\b').test(q)) {
      score += 0.40;
    }
    if (new RegExp('\\b(goal|objective|target|milestone)\\b').test(q)) {
      score += 0.35;
    }
    if (new RegExp('\\b(timeline|schedule|deadline|timeframe)\\b').test(q)) {
      score += 0.35;
    }
    if (new RegExp('\\b(forecast|predict|estimate|anticipate)\\b').test(q)) {
      score += 0.30;
    }
    if (new RegExp('\\b(resource|budget|allocate|capacity)\\b').test(q)) {
      score += 0.30;
    }
    if (new RegExp('\\b(architect|design|structure|framework)\\b').test(q)) {
      score += 0.25;
    }
    if (new RegExp('\\b(risk|mitigation|contingency|backup)\\b').test(q)) {
      score += 0.25;
    }

    return score;
  }

  /**
   * Apply conversation context modifiers
   */
  applyConversationContext(scores, profile) {
    const recentBrains = profile.recentBrains;

    // Continuity bonus: if last 2-3 messages used same brain, boost it
    if (recentBrains.length >= 2) {
      const lastBrain = recentBrains[recentBrains.length - 1];
      const secondLastBrain = recentBrains[recentBrains.length - 2];

      if (lastBrain === secondLastBrain && scores[lastBrain] !== undefined) {
        scores[lastBrain] += 0.15; // Continuity bonus
      }
    }

    // Topic alignment bonus
    const topicBrainMap = {
      'technical': 'LOGOS',
      'creative': 'AURORA',
      'planning': 'PROMETHEUS',
      'debugging': 'LOGOS',
      'design': 'AURORA',
      'architecture': 'PROMETHEUS'
    };

    const alignedBrain = topicBrainMap[profile.conversationTopic];
    if (alignedBrain && scores[alignedBrain] !== undefined) {
      scores[alignedBrain] += 0.20;
    }
  }

  /**
   * Apply user preference modifiers
   */
  applyUserPreferences(scores, profile) {
    const prefs = profile.userPreferences;

    // Favorite brain bonus
    if (prefs.favoriteBrain && scores[prefs.favoriteBrain] !== undefined) {
      scores[prefs.favoriteBrain] += 0.10;
    }

    // Usage pattern learning: slightly favor brains this user uses more
    const totalUsage = Object.values(prefs.brainUsage).reduce((a, b) => a + b, 0);
    if (totalUsage > 10) { // Only after meaningful usage
      for (const brain in scores) {
        const usageRatio = prefs.brainUsage[brain] / totalUsage;
        scores[brain] += usageRatio * 0.08; // Small boost based on usage
      }
    }
  }

  /**
   * Apply workflow context modifiers
   */
  applyWorkflowContext(scores, profile) {
    const workflowMap = {
      'debugging': 'LOGOS',
      'code-review': 'LOGOS',
      'creative-writing': 'AURORA',
      'brainstorming': 'AURORA',
      'project-planning': 'PROMETHEUS',
      'architecture': 'PROMETHEUS',
      'retrospective': 'PROMETHEUS',
      'troubleshooting': 'LOGOS',
      'ideation': 'AURORA'
    };

    const matchedBrain = workflowMap[profile.userWorkflow];
    if (matchedBrain && scores[matchedBrain] !== undefined) {
      scores[matchedBrain] += 0.25; // Strong workflow alignment bonus
    }
  }

  /**
   * Apply temporal context modifiers
   */
  applyTemporalContext(scores, profile) {
    const hour = profile.timeOfDay;

    // Creativity tends to peak in morning and evening for many people
    if (scores.AURORA !== undefined) {
      if ((hour >= 9 && hour <= 11) || (hour >= 20 && hour <= 23)) {
        scores.AURORA += 0.08;
      }
    }

    // Analytical work often better mid-day
    if (scores.LOGOS !== undefined) {
      if (hour >= 13 && hour <= 16) {
        scores.LOGOS += 0.08;
      }
    }

    // Planning often done early or late
    if (scores.PROMETHEUS !== undefined) {
      if (hour >= 8 && hour <= 10) {
        scores.PROMETHEUS += 0.08;
      }
    }
  }

  /**
   * Record routing decision for learning
   */
  async recordRoutingDecision(query, profile, brain, result) {
    try {
      const traceId = result?.outcomeTraceId || result?.metadata?.outcomeTraceId || null;
      const outcome = result?.outcomeTruth
        || (traceId && this.outcomeTruth?.resolution ? this.outcomeTruth.resolution(traceId) : null);
      const verified = outcome?.status === 'verified_success' || outcome?.status === 'verified_failure';
      if (!verified) {
        this.emit('route:observed', { query, brain, traceId, learned: false, reason: 'verified_outcome_required' });
        return { learned: false, reason: 'verified_outcome_required', traceId };
      }

      // Extract pattern
      const pattern = this.extractQueryPattern(query);
      const key = `${pattern}:${profile.conversationTopic}`;

      // Get or create history
      if (!this.routingMemory.has(key)) {
        this.routingMemory.set(key, []);
      }

      const history = this.routingMemory.get(key);

      if (traceId && history.some(record => record.outcomeTraceId === traceId)) {
        return { learned: false, reason: 'trace_already_recorded', traceId };
      }

      // Record
      history.push({
        brain,
        satisfaction: Math.max(0, Math.min(1, (Number(outcome.reward || 0) + 1) / 2)),
        outcomeStatus: outcome.status,
        outcomeTraceId: traceId,
        timestamp: Date.now(),
        userId: profile.userId,
        workflow: profile.userWorkflow
      });

      // Limit history size (keep last 50 per pattern)
      if (history.length > 50) {
        history.shift();
      }

      // Update user profile
      this.updateUserProfile(profile.userId, brain, result);

      // Persist to mnemonic (async, non-blocking)
      await this._persistRoutingMemory(key, history);

      const satisfaction = history.at(-1).satisfaction;
      this.emit('route:learned', { pattern, brain, satisfaction, traceId, outcomeStatus: outcome.status });
      return { learned: true, pattern, brain, satisfaction, traceId, outcomeStatus: outcome.status };

    } catch (err) {
      console.error(`[${this.name}] Error recording routing decision:`, err);
      return { learned: false, reason: err.message };
    }
  }

  /**
   * Update user profile based on routing outcome
   */
  updateUserProfile(userId, brain, result) {
    let profile = this.userProfiles.get(userId);
    if (!profile) {
      profile = {
        favoriteBrain: null,
        workflows: {},
        totalQueries: 0,
        brainUsage: { LOGOS: 0, AURORA: 0, PROMETHEUS: 0, THALAMUS: 0 }
      };
      this.userProfiles.set(userId, profile);
    }

    // Increment brain usage
    if (profile.brainUsage[brain] !== undefined) {
      profile.brainUsage[brain]++;
    }

    // Update favorite brain (most used)
    const maxUsage = Math.max(...Object.values(profile.brainUsage));
    profile.favoriteBrain = Object.keys(profile.brainUsage).find(
      b => profile.brainUsage[b] === maxUsage
    );
  }

  /**
   * Extract query pattern for memory lookup
   */
  extractQueryPattern(query) {
    // Extract string from query (might be object or string)
    const queryStr = typeof query === 'string' ? query : ((query && query.query) || (query && query.text) || String(query));

    // Remove specifics, keep general pattern
    let pattern = queryStr.toLowerCase();

    // Remove numbers, dates, names (using RegExp constructor to avoid parser issues)
    pattern = pattern.replace(new RegExp('\\d+', 'g'), 'N');
    pattern = pattern.replace(new RegExp('\\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b', 'gi'), 'DAY');
    pattern = pattern.replace(new RegExp('\\b(january|february|march|april|may|june|july|august|september|october|november|december)\\b', 'gi'), 'MONTH');

    // Extract key words only (simple version)
    const words = pattern.split(/\s+/).filter(w => w.length > 3);
    const keyWords = words.slice(0, 5).join(' '); // First 5 significant words

    // Hash to keep keys manageable
    const hash = crypto.createHash('md5').update(keyWords).digest('hex').slice(0, 8);
    return hash;
  }

  /**
   * Infer conversation topic from history
   */
  inferTopic(history) {
    if (history.length === 0) return 'general';

    // Simple keyword-based inference (can improve with embeddings)
    const recentQueries = history.slice(-3).map(h => h.query).join(' ').toLowerCase();

    if (/\b(code|debug|error|function|bug)\b/.test(recentQueries)) return 'technical';
    if (/\b(creative|story|write|idea|imagine)\b/.test(recentQueries)) return 'creative';
    if (/\b(plan|roadmap|goal|milestone)\b/.test(recentQueries)) return 'planning';
    if (/\b(design|architect|structure)\b/.test(recentQueries)) return 'architecture';

    return 'general';
  }

  /**
   * Infer conversation mood from history
   */
  inferMood(history) {
    if (history.length === 0) return 'neutral';

    const recentQueries = history.slice(-3).map(h => h.query).join(' ').toLowerCase();

    if (/\b(explore|curious|wonder|interesting)\b/.test(recentQueries)) return 'exploratory';
    if (/\b(urgent|asap|critical|emergency)\b/.test(recentQueries)) return 'urgent';
    if (/\b(help|stuck|confused|lost)\b/.test(recentQueries)) return 'seeking-help';

    return 'neutral';
  }

  /**
   * Get routing statistics
   */
  getStats() {
    return {
      ...this.stats,
      routingMemorySize: this.routingMemory.size,
      userProfilesCount: this.userProfiles.size,
      conversationContextsActive: this.conversationContexts.size,
      directHitRate: this.stats.totalRoutes > 0
        ? (this.stats.directHits / this.stats.totalRoutes * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  /**
   * Persist routing memory to mnemonic (async)
   */
  async _persistRoutingMemory(key, history) {
    if (!this._persistenceReady) return;

    try {
      if (this.mnemonic?.remember) {
        await this.mnemonic.remember(
          `Routing pattern: ${key}`,
          {
            type: 'routing_memory',
            key: `routing:${key}`,
            pattern: key,
            history: history.slice(-20),
            updatedAt: Date.now()
          }
        );
      }

      const payload = {
        version: 1,
        updatedAt: Date.now(),
        routingMemory: Object.fromEntries(
          Array.from(this.routingMemory.entries()).map(([pattern, records]) => [pattern, records.slice(-50)])
        ),
        userProfiles: Object.fromEntries(this.userProfiles),
      };
      this._writeChain = this._writeChain.then(async () => {
        await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
        const tempPath = `${this.storagePath}.${process.pid}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
        await fs.rename(tempPath, this.storagePath);
      });
      await this._writeChain;
    } catch (err) {
      console.error(`[${this.name}] Failed to persist routing memory:`, err);
    }
  }

  /**
   * Load persisted routing memory from mnemonic
   */
  async _loadPersistedMemory() {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const [key, records] of Object.entries(parsed.routingMemory || {})) {
        if (!Array.isArray(records)) continue;
        this.routingMemory.set(key, records.slice(-50).filter(record => record && typeof record === 'object'));
      }
      for (const [userId, profile] of Object.entries(parsed.userProfiles || {})) {
        if (profile && typeof profile === 'object') this.userProfiles.set(userId, profile);
      }
      console.log(`[${this.name}] Loaded ${this.routingMemory.size} durable routing pattern(s)`);
    } catch (err) {
      if (err?.code === 'ENOENT') return;
      console.error(`[${this.name}] Failed to load routing memory:`, err);
    }
  }
}

export { AdaptiveLearningRouter };
