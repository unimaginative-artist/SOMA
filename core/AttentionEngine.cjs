/**
 * MAXWELL ATTENTION ENGINE v0.2
 *
 * Attention = cognitive budgeting.
 * It does not answer the user.
 * It decides how much memory, reasoning, tool use, and escalation
 * Maxwell is allowed to spend on the current input.
 */

'use strict';

const ATTENTION_VERSION = '0.2.0';

const ATTENTION_PRIORITY = {
  IGNORE: 'IGNORE',
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

const ATTENTION_COST = {
  REFLEX: 'REFLEX',
  CHEAP_LOCAL: 'CHEAP_LOCAL',
  LOCAL: 'LOCAL',
  MEMORY: 'MEMORY',
  SMART: 'SMART',
  BRIDGE: 'BRIDGE',
  INTERRUPT: 'INTERRUPT',
};

const MEMORY_ACTION = {
  DISCARD: 'DISCARD',
  KEEP: 'KEEP',
  SUMMARIZE: 'SUMMARIZE',
  PIN: 'PIN',
};

class AttentionEngine {
  constructor(config = {}) {
    this.config = {
      debug: false,
      activeGoals: [],
      currentProject: null,
      maxRecentTopics: 30,
      maxTensions: 100,
      ...config,
    };

    this.weights = {
      urgency: 0.28,
      intent: 0.20,
      goal: 0.20,
      novelty: 0.12,
      emotion: 0.08,
      tension: 0.12,
    };

    this.recentTopics = [];
    this.tensions = new Map();

    this.metrics = {
      totalEvaluations: 0,
      ignored: 0,
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
      avgScore: 0,
    };
  }

  evaluate(message, context = {}) {
    const normalized = this._normalize(message);
    this.metrics.totalEvaluations++;

    const signals = {
      urgency: this._scoreUrgency(normalized),
      intent: this._scoreIntent(normalized),
      goal: this._scoreGoalRelevance(normalized, context),
      novelty: this._scoreNovelty(normalized),
      emotion: this._scoreEmotion(normalized),
      tension: this._scoreTension(normalized),
    };

    const score = this._weightedScore(signals);
    const priority = this._priority(score);
    const allowedCost = this._allowedCost(score, signals, context);
    const memoryAction = this._memoryAction(score, signals);
    const memoryDepth = this._memoryDepth(score, signals);
    const knowledgeDepth = this._knowledgeDepth(score, signals);
    const shouldPersist = memoryAction !== MEMORY_ACTION.DISCARD;
    const shouldQueryMemory = memoryDepth > 0;
    const shouldQueryKnowledge = knowledgeDepth > 0;

    const result = {
      version: ATTENTION_VERSION,
      score,
      priority,
      allowedCost,
      memoryAction,
      memoryDepth,
      knowledgeDepth,
      shouldPersist,
      shouldQueryMemory,
      shouldQueryKnowledge,
      interruptible: score >= 0.9,
      reasons: this._reasons(signals),
      signals,
      routing: {
        useReflexOnly: allowedCost === ATTENTION_COST.REFLEX,
        useCheapLocal: allowedCost === ATTENTION_COST.CHEAP_LOCAL,
        useSmartTier:
          allowedCost === ATTENTION_COST.SMART ||
          allowedCost === ATTENTION_COST.BRIDGE ||
          allowedCost === ATTENTION_COST.INTERRUPT,
        allowBridge:
          allowedCost === ATTENTION_COST.BRIDGE ||
          allowedCost === ATTENTION_COST.INTERRUPT,
      },
      timestamp: Date.now(),
    };

    this._rememberTopic(normalized);
    this._updateMetrics(result);

    if (this.config.debug) {
      console.log('%c[ATTENTION]', 'color:#f59e0b;font-weight:bold', result);
    }

    return result;
  }

  addTension(id, data = {}) {
    if (!id) return null;

    if (this.tensions.size >= this.config.maxTensions) {
      const oldest = [...this.tensions.values()]
        .sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldest) this.tensions.delete(oldest.id);
    }

    const tension = {
      id,
      level: this._clamp(data.level ?? 0.5),
      topic: data.topic ?? '',
      goal: data.goal ?? '',
      source: data.source ?? 'unknown',
      status: data.status ?? 'open',
      createdAt: data.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      decayRate: data.decayRate ?? 0.03,
      metadata: data.metadata ?? {},
    };

    this.tensions.set(id, tension);
    return tension;
  }

  increaseTension(id, amount = 0.1) {
    const tension = this.tensions.get(id);
    if (!tension) return null;

    tension.level = this._clamp(tension.level + amount);
    tension.updatedAt = Date.now();
    this.tensions.set(id, tension);
    return tension;
  }

  reduceTension(id, amount = 0.1) {
    const tension = this.tensions.get(id);
    if (!tension) return null;

    tension.level = this._clamp(tension.level - amount);
    tension.updatedAt = Date.now();

    if (tension.level <= 0.05) {
      this.tensions.delete(id);
      return null;
    }

    this.tensions.set(id, tension);
    return tension;
  }

  resolveTension(id) {
    const tension = this.tensions.get(id);
    if (!tension) return false;

    tension.status = 'resolved';
    tension.level = 0;
    tension.updatedAt = Date.now();
    this.tensions.set(id, tension);
    return true;
  }

  decayTensions() {
    for (const [id, tension] of this.tensions.entries()) {
      if (tension.status !== 'open') continue;

      tension.level = this._clamp(tension.level - tension.decayRate);
      tension.updatedAt = Date.now();

      if (tension.level <= 0.05) {
        this.tensions.delete(id);
      } else {
        this.tensions.set(id, tension);
      }
    }
  }

  getOpenTensions() {
    return [...this.tensions.values()]
      .filter(t => t.status === 'open')
      .sort((a, b) => b.level - a.level);
  }

  getStatus() {
    return {
      version: ATTENTION_VERSION,
      weights: { ...this.weights },
      recentTopics: [...this.recentTopics],
      tensions: this.getOpenTensions(),
      metrics: { ...this.metrics },
    };
  }

  clear() {
    this.recentTopics = [];
    this.tensions.clear();
  }

  // ─────────────────────────────────────────────

  _normalize(message) {
    return String(message || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  _scoreUrgency(msg) {
    let score = 0;

    if (/\b(urgent|asap|right now|immediately|emergency|critical|production|broken|crashing|crashed|failed|failure|fatal|blocked|blocker)\b/i.test(msg)) {
      score += 0.75;
    }

    if (/\b(help|stuck|can't|cannot|won't work|doesn't work|not working|error|bug|issue|problem)\b/i.test(msg)) {
      score += 0.35;
    }

    if (/[!]{2,}/.test(msg)) {
      score += 0.15;
    }

    return this._clamp(score);
  }

  _scoreIntent(msg) {
    if (!msg) return 0;
    if (msg.length < 3) return 0.1;

    if (/^(ok|okay|lol|haha|lmao|nice|thanks|thank you|cool|yep|nope|yes|no|sure|bet|word)$/i.test(msg)) {
      return 0.12;
    }

    if (/\b(build|fix|debug|design|create|implement|refactor|analyze|explain|compare|plan|architect|review|test|deploy|ship|rewrite|integrate)\b/i.test(msg)) {
      return 0.88;
    }

    if (/\b(open|show|find|search|save|remember|send|start|stop|cancel|launch|switch)\b/i.test(msg)) {
      return 0.72;
    }

    if (/\?$/.test(msg)) {
      return 0.55;
    }

    return 0.42;
  }

  _scoreGoalRelevance(msg, context) {
    const goals = [
      ...(this.config.activeGoals || []),
      ...(context.activeGoals || []),
    ];

    if (context.currentProject) goals.push(context.currentProject);
    if (this.config.currentProject) goals.push(this.config.currentProject);

    if (!goals.length) return 0.2;

    let best = 0;

    for (const goal of goals) {
      const goalText = String(goal).toLowerCase();
      const words = goalText.split(/\W+/).filter(w => w.length > 3);

      if (goalText && msg.includes(goalText)) {
        best = Math.max(best, 1);
        continue;
      }

      const hits = words.filter(w => msg.includes(w)).length;
      const score = words.length ? hits / words.length : 0;
      best = Math.max(best, score);
    }

    return this._clamp(best);
  }

  _scoreNovelty(msg) {
    if (!this.recentTopics.length) return 0.55;

    const msgWords = new Set(msg.split(/\W+/).filter(w => w.length > 3));
    if (!msgWords.size) return 0.15;

    let maxOverlap = 0;

    for (const topic of this.recentTopics) {
      const topicWords = new Set(topic.split(/\W+/).filter(w => w.length > 3));
      const overlap = [...msgWords].filter(w => topicWords.has(w)).length;
      maxOverlap = Math.max(maxOverlap, overlap / msgWords.size);
    }

    return this._clamp(1 - maxOverlap);
  }

  _scoreEmotion(msg) {
    if (/\b(stressed|worried|scared|angry|frustrated|overwhelmed|tired|exhausted|confused|lost|annoyed|upset)\b/i.test(msg)) {
      return 0.85;
    }

    if (/\b(excited|happy|proud|love|amazing|beautiful|awesome|great|huge|important)\b/i.test(msg)) {
      return 0.55;
    }

    return 0.18;
  }

  _scoreTension(msg) {
    let best = 0;

    for (const tension of this.tensions.values()) {
      if (tension.status !== 'open') continue;

      const topic = `${tension.topic} ${tension.goal}`.toLowerCase();
      const words = topic.split(/\W+/).filter(w => w.length > 3);

      if (!words.length) {
        best = Math.max(best, tension.level * 0.5);
        continue;
      }

      const hits = words.filter(w => msg.includes(w)).length;

      if (hits > 0) {
        best = Math.max(best, tension.level * (hits / words.length));
      }
    }

    return this._clamp(best);
  }

  _weightedScore(signals) {
    const score =
      signals.urgency * this.weights.urgency +
      signals.intent * this.weights.intent +
      signals.goal * this.weights.goal +
      signals.novelty * this.weights.novelty +
      signals.emotion * this.weights.emotion +
      signals.tension * this.weights.tension;

    return Number(this._clamp(score).toFixed(3));
  }

  _priority(score) {
    if (score >= 0.9) return ATTENTION_PRIORITY.CRITICAL;
    if (score >= 0.72) return ATTENTION_PRIORITY.HIGH;
    if (score >= 0.45) return ATTENTION_PRIORITY.NORMAL;
    if (score >= 0.22) return ATTENTION_PRIORITY.LOW;
    return ATTENTION_PRIORITY.IGNORE;
  }

  _allowedCost(score, signals, context) {
    if (context.forceBridge) return ATTENTION_COST.BRIDGE;
    if (context.forceSmart) return ATTENTION_COST.SMART;

    if (score >= 0.9) return ATTENTION_COST.INTERRUPT;
    if (score >= 0.78) return ATTENTION_COST.BRIDGE;
    if (score >= 0.65) return ATTENTION_COST.SMART;

    if (signals.goal > 0.6 || signals.tension > 0.55) {
      return ATTENTION_COST.MEMORY;
    }

    if (score >= 0.45) return ATTENTION_COST.LOCAL;
    if (score >= 0.22) return ATTENTION_COST.CHEAP_LOCAL;

    return ATTENTION_COST.REFLEX;
  }

  _memoryAction(score, signals) {
    if (score >= 0.85 || signals.tension > 0.75) {
      return MEMORY_ACTION.PIN;
    }

    if (score >= 0.65 || signals.goal > 0.65) {
      return MEMORY_ACTION.SUMMARIZE;
    }

    if (score >= 0.45) {
      return MEMORY_ACTION.KEEP;
    }

    return MEMORY_ACTION.DISCARD;
  }

  _memoryDepth(score, signals) {
    if (score >= 0.85 || signals.tension > 0.75) return 12;
    if (score >= 0.65 || signals.goal > 0.65) return 8;
    if (score >= 0.45) return 3;
    return 0;
  }

  _knowledgeDepth(score, signals) {
    if (score >= 0.85) return 8;
    if (score >= 0.65 || signals.goal > 0.65) return 5;
    if (score >= 0.5) return 2;
    return 0;
  }

  _reasons(signals) {
    const reasons = [];

    if (signals.urgency > 0.6) reasons.push('urgent');
    if (signals.intent > 0.7) reasons.push('clear_intent');
    if (signals.goal > 0.6) reasons.push('goal_relevant');
    if (signals.novelty > 0.7) reasons.push('novel');
    if (signals.emotion > 0.6) reasons.push('emotionally_weighted');
    if (signals.tension > 0.5) reasons.push('unresolved_tension');

    return reasons;
  }

  _rememberTopic(msg) {
    if (!msg || msg.length < 4) return;

    this.recentTopics.push(msg);

    if (this.recentTopics.length > this.config.maxRecentTopics) {
      this.recentTopics.shift();
    }
  }

  _updateMetrics(result) {
    const key = result.priority.toLowerCase();

    if (this.metrics[key] !== undefined) {
      this.metrics[key]++;
    }

    const n = this.metrics.totalEvaluations;
    this.metrics.avgScore = Number(
      ((this.metrics.avgScore * (n - 1) + result.score) / n).toFixed(3)
    );
  }

  _clamp(n) {
    return Math.min(1, Math.max(0, Number(n) || 0));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AttentionEngine,
    ATTENTION_PRIORITY,
    ATTENTION_COST,
    MEMORY_ACTION,
  };
} else {
  window.AttentionEngine = AttentionEngine;
  window.ATTENTION_PRIORITY = ATTENTION_PRIORITY;
  window.ATTENTION_COST = ATTENTION_COST;
  window.MEMORY_ACTION = MEMORY_ACTION;
}
