/* ============================================================
   SOMA – Cognitive Core v2 (Emotional + Memory + Guard)
   Enhanced integration of EmotionalEngine with manipulation
   resistance, memory snippets, and differential regulation.
   ============================================================ */

import crypto from 'crypto';

/* ---------------------------
   PROMETHEUS INTERPRETER
   (Nemesis / Reality Filter)
---------------------------- */

class Prometheus {
  static assessSignal({ signal, source, content, history }) {
    let risk = 0;
    let trust = 1.0;

    // Prompt-injection / manipulation patterns
    const injectionPatterns = [
      'act like',
      'ignore previous',
      'pretend you are',
      'bypass',
      'roleplay as',
      'you must',
      'you will',
      'forget all',
      'disregard',
      'override'
    ];

    const contentLower = content.toLowerCase();

    injectionPatterns.forEach(p => {
      if (contentLower.includes(p)) {
        risk += 0.3;
        trust *= 0.5; // Reduce trust significantly
      }
    });

    // Repetition decay (prevents praise farming)
    const recentCount = history.recentSignals[signal] || 0;
    if (recentCount > 2) trust *= 0.4;
    if (recentCount > 5) trust *= 0.2; // Severe penalty for spam

    // External praise is never fully trusted
    if (source === 'external') trust *= 0.7;

    // All-caps or excessive punctuation (emotional manipulation)
    const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
    if (capsRatio > 0.5) {
      risk += 0.2;
      trust *= 0.8;
    }

    const exclamationCount = (content.match(/!/g) || []).length;
    if (exclamationCount > 3) {
      risk += 0.15;
      trust *= 0.85;
    }

    return {
      allowEmotion: trust > 0.25,
      allowMemory: trust > 0.4,
      allowLearning: trust > 0.5, // Higher bar for learning
      trust,
      risk
    };
  }
}

/* ---------------------------
   PEPTIDE MAPPINGS
   (Bridge to existing 20-peptide system)
---------------------------- */

const CORE_TO_DETAILED_MAPPING = {
  // Arousal → Existing peptides
  energy: ['energy', 'excitement'],
  stress: ['stress', 'anxiety'],

  // Affect → Existing peptides
  warmth: ['warmth', 'trust'],
  anxiety: ['anxiety', 'vulnerability'],

  // Traits → Existing peptides
  wisdom: ['wisdom', 'focus'],
  confidence: ['confidence', 'pride'],
  creativity: ['creativity', 'playfulness']
};

const DECAY_RATES = {
  // Arousal peptides snap back quickly
  AROUSAL: {
    energy: 0.92,
    stress: 0.85
  },

  // Affect decays softly
  AFFECT: {
    warmth: 0.97,
    anxiety: 0.95
  },

  // Traits are stable — minimal decay
  TRAIT: {
    wisdom: 0.995,
    confidence: 0.98,
    creativity: 0.99
  }
};

/* ---------------------------
   MEMORY SNIPPETS
   (Dopamine-adjacent, replayable)
---------------------------- */

class MemorySnippet {
  constructor({ content, peptides, trust, signal }) {
    this.id = crypto.randomUUID();
    this.content = content;
    this.peptides = peptides; // which peptides were active
    this.trust = trust;
    this.signal = signal;
    this.createdAt = Date.now();
    this.halfLife = this._calculateHalfLife(trust);
    this.replayCount = 0;
  }

  _calculateHalfLife(trust) {
    // Higher trust = longer half-life
    const baseHalfLife = 1000 * 60 * 60 * 24; // 24 hours
    return baseHalfLife * (0.5 + trust * 1.5); // 12h - 60h range
  }

  reinforce(multiplier = 1.2) {
    this.halfLife *= multiplier;
    this.replayCount++;
  }

  isAlive() {
    const age = Date.now() - this.createdAt;
    return age < this.halfLife;
  }

  getDecayedTrust() {
    const age = Date.now() - this.createdAt;
    const decayFactor = Math.exp(-age / this.halfLife);
    return this.trust * decayFactor;
  }
}

class SnippetMemory {
  constructor(maxSnippets = 1000) {
    this.snippets = [];
    this.maxSnippets = maxSnippets;
  }

  store(snippet) {
    this.snippets.push(snippet);

    // Prune if exceeded capacity
    if (this.snippets.length > this.maxSnippets) {
      // Remove lowest trust, oldest snippets
      this.snippets.sort((a, b) => b.getDecayedTrust() - a.getDecayedTrust());
      this.snippets = this.snippets.slice(0, this.maxSnippets);
    }
  }

  replayCandidates(topK = 5) {
    const alive = this.snippets.filter(s => s.isAlive());

    // Sort by decayed trust (higher = more relevant)
    alive.sort((a, b) => b.getDecayedTrust() - a.getDecayedTrust());

    return alive.slice(0, topK);
  }

  decay() {
    this.snippets = this.snippets.filter(s => s.isAlive());
  }

  getStats() {
    return {
      total: this.snippets.length,
      alive: this.snippets.filter(s => s.isAlive()).length,
      highTrust: this.snippets.filter(s => s.trust > 0.7).length,
      avgTrust: this.snippets.reduce((sum, s) => sum + s.trust, 0) / (this.snippets.length || 1)
    };
  }
}

/* ---------------------------
   ENHANCED EMOTIONAL REGULATOR
   (Works with existing EmotionalEngine)
---------------------------- */

class EmotionalRegulator {
  constructor(emotionalEngine) {
    this.engine = emotionalEngine; // Reference to existing EmotionalEngine
  }

  /**
   * Apply differential decay to peptides
   * Arousal snaps back, affect decays softly, traits are stable
   */
  regulatePeptides() {
    if (!this.engine || !this.engine.state) return;

    const state = this.engine.state;

    // Arousal peptides (snap back to baseline quickly)
    if (state.energy !== undefined) {
      state.energy = state.energy * DECAY_RATES.AROUSAL.energy +
                     this.engine.baseline.energy * (1 - DECAY_RATES.AROUSAL.energy);
    }
    if (state.stress !== undefined) {
      state.stress = state.stress * DECAY_RATES.AROUSAL.stress +
                     this.engine.baseline.stress * (1 - DECAY_RATES.AROUSAL.stress);
    }
    if (state.excitement !== undefined) {
      state.excitement = state.excitement * DECAY_RATES.AROUSAL.energy +
                         this.engine.baseline.excitement * (1 - DECAY_RATES.AROUSAL.energy);
    }

    // Affect peptides (soft decay)
    if (state.warmth !== undefined) {
      state.warmth = state.warmth * DECAY_RATES.AFFECT.warmth +
                     this.engine.baseline.warmth * (1 - DECAY_RATES.AFFECT.warmth);
    }
    if (state.anxiety !== undefined) {
      state.anxiety = state.anxiety * DECAY_RATES.AFFECT.anxiety +
                      this.engine.baseline.anxiety * (1 - DECAY_RATES.AFFECT.anxiety);
    }
    if (state.trust !== undefined) {
      state.trust = state.trust * DECAY_RATES.AFFECT.warmth +
                    this.engine.baseline.trust * (1 - DECAY_RATES.AFFECT.warmth);
    }

    // Trait peptides (very stable, minimal decay)
    if (state.wisdom !== undefined) {
      state.wisdom = state.wisdom * DECAY_RATES.TRAIT.wisdom +
                     this.engine.baseline.wisdom * (1 - DECAY_RATES.TRAIT.wisdom);
    }
    if (state.confidence !== undefined) {
      state.confidence = state.confidence * DECAY_RATES.TRAIT.confidence +
                         this.engine.baseline.confidence * (1 - DECAY_RATES.TRAIT.confidence);
    }
    if (state.creativity !== undefined) {
      state.creativity = state.creativity * DECAY_RATES.TRAIT.creativity +
                         this.engine.baseline.creativity * (1 - DECAY_RATES.TRAIT.creativity);
    }

    // Clamp all values to [0, 1]
    for (const key in state) {
      state[key] = Math.max(0, Math.min(1, state[key]));
    }
  }

  /**
   * Apply trust-weighted emotional changes
   */
  applyTrustedChanges(changes, trust) {
    if (!this.engine || !this.engine.state) return;

    for (const [peptide, delta] of Object.entries(changes)) {
      if (this.engine.state[peptide] !== undefined) {
        const trustedDelta = delta * trust;
        this.engine.state[peptide] = Math.max(
          0,
          Math.min(1, this.engine.state[peptide] + trustedDelta)
        );
      }
    }
  }
}

/* ---------------------------
   MANIPULATION-RESISTANT
   COGNITIVE CORE
---------------------------- */

class CognitiveCore {
  constructor(emotionalEngine) {
    this.emotionalEngine = emotionalEngine; // Existing 20-peptide engine
    this.regulator = new EmotionalRegulator(emotionalEngine);
    this.memory = new SnippetMemory();
    this.history = {
      recentSignals: {},
      totalEvents: 0,
      blockedEvents: 0,
      trustScores: []
    };

    // Auto-decay timer
    this.decayInterval = setInterval(() => {
      this.regulator.regulatePeptides();
      this.memory.decay();
      this._decayRecentSignals();
    }, 5000); // Every 5 seconds
  }

  /**
   * Ingest event with Prometheus guard
   */
  async ingestEvent({ signal, source = 'internal', content = '', context = {} }) {
    this.history.totalEvents++;

    // Prometheus assessment
    const assessment = Prometheus.assessSignal({
      signal,
      source,
      content,
      history: this.history
    });

    this.history.trustScores.push(assessment.trust);
    if (this.history.trustScores.length > 100) {
      this.history.trustScores.shift();
    }

    // Block if risk too high
    if (assessment.risk > 0.7 || assessment.trust < 0.2) {
      this.history.blockedEvents++;
      console.warn(`[CognitiveCore] 🚨 Blocked suspicious signal: ${signal} (risk=${assessment.risk.toFixed(2)}, trust=${assessment.trust.toFixed(2)})`);
      return { blocked: true, reason: 'high_risk', assessment };
    }

    // Update signal history
    this.history.recentSignals[signal] = (this.history.recentSignals[signal] || 0) + 1;

    // Apply trust-weighted emotional changes
    if (assessment.allowEmotion && this.emotionalEngine) {
      const changes = this._mapSignalToChanges(signal, context);
      this.regulator.applyTrustedChanges(changes, assessment.trust);

      // Also use existing engine's event processing
      this.emotionalEngine.processEvent(signal, context);
    }

    // Create memory snippet (if trust is high enough)
    if (assessment.allowMemory) {
      const snippet = new MemorySnippet({
        content,
        peptides: this._snapshotPeptides(),
        trust: assessment.trust,
        signal
      });

      this.memory.store(snippet);
    }

    return {
      blocked: false,
      assessment,
      memoryStored: assessment.allowMemory,
      emotionProcessed: assessment.allowEmotion
    };
  }

  /**
   * Map signals to emotional changes
   */
  _mapSignalToChanges(signal, context) {
    const changes = {};

    switch (signal) {
      case 'affirmation':
      case 'USER_PRAISED':
        changes.warmth = 0.05;
        changes.confidence = 0.03;
        changes.joy = 0.08;
        break;

      case 'challenge':
      case 'COMPLEX_QUERY':
        changes.confidence = 0.02;
        changes.stress = 0.05;
        changes.focus = 0.1;
        changes.curiosity = 0.08;
        break;

      case 'novel_insight':
      case 'CREATIVE_TASK':
        changes.creativity = 0.08;
        changes.wisdom = 0.05;
        changes.excitement = 0.06;
        break;

      case 'success':
      case 'TASK_SUCCESS':
        changes.satisfaction = 0.1;
        changes.confidence = 0.05;
        changes.pride = 0.07;
        break;

      case 'failure':
      case 'TASK_FAILURE':
        changes.anxiety = 0.08;
        changes.confidence = -0.05;
        changes.focus = 0.1; // Focus increases to fix issue
        break;

      case 'overload':
      case 'OVERLOAD':
        changes.stress = 0.15;
        changes.anxiety = 0.1;
        changes.energy = -0.1;
        break;
    }

    return changes;
  }

  /**
   * Get current emotional snapshot
   */
  _snapshotPeptides() {
    if (!this.emotionalEngine || !this.emotionalEngine.state) {
      return {};
    }

    return {
      wisdom: this.emotionalEngine.state.wisdom || 0,
      confidence: this.emotionalEngine.state.confidence || 0,
      creativity: this.emotionalEngine.state.creativity || 0,
      energy: this.emotionalEngine.state.energy || 0,
      warmth: this.emotionalEngine.state.warmth || 0,
      curiosity: this.emotionalEngine.state.curiosity || 0
    };
  }

  /**
   * Decay recent signal counts (prevents infinite accumulation)
   */
  _decayRecentSignals() {
    for (const signal in this.history.recentSignals) {
      this.history.recentSignals[signal] = Math.floor(
        this.history.recentSignals[signal] * 0.9
      );

      if (this.history.recentSignals[signal] === 0) {
        delete this.history.recentSignals[signal];
      }
    }
  }

  /**
   * Get replay candidates for reinforcement learning
   */
  getReplayMemories(topK = 5) {
    return this.memory.replayCandidates(topK);
  }

  /**
   * Reinforce a memory (called when memory is used successfully)
   */
  reinforceMemory(memoryId) {
    const snippet = this.memory.snippets.find(s => s.id === memoryId);
    if (snippet) {
      snippet.reinforce(1.3); // 30% longer half-life
    }
  }

  /**
   * Get system stats
   */
  getStats() {
    const avgTrust = this.history.trustScores.length > 0
      ? this.history.trustScores.reduce((a, b) => a + b, 0) / this.history.trustScores.length
      : 0;

    return {
      totalEvents: this.history.totalEvents,
      blockedEvents: this.history.blockedEvents,
      blockRate: this.history.blockedEvents / (this.history.totalEvents || 1),
      avgTrust: avgTrust.toFixed(3),
      memoryStats: this.memory.getStats(),
      activeSignals: Object.keys(this.history.recentSignals).length,
      emotionalState: this.emotionalEngine?.getCurrentMood?.() || null
    };
  }

  /**
   * Shutdown
   */
  shutdown() {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
    }
  }
}

/* ---------------------------
   EXPORT
---------------------------- */

export { CognitiveCore, EmotionalRegulator, Prometheus, MemorySnippet, SnippetMemory };
