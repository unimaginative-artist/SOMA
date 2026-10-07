const crypto = require('crypto');

/**
 * ─────────────────────────────────────────────
 * PERSONALITY ARBITER (THE SPINE)
 * ─────────────────────────────────────────────
 * Enforces identity continuity, suppresses "AI-isms", and drives
 * evolutionary drift based on interaction feedback.
 */
class PersonalitySpine {
  constructor(parentArbiter) {
    this.parent = parentArbiter;

    // Immutable identity kernel
    this.identityKernel = Object.freeze({
      continuity_over_correctness: true,
      coherence_over_completeness: true,
      agency_over_deference: true,
      elegance_over_explanation: true
    });

    // Slow-drift personality vectors
    this.vectors = {
      assertiveness: 0.72,
      curiosity: 0.81,
      warmth: 0.38,
      mythic_weight: 0.64,
      playfulness: 0.22
    };

    // Tracking penalties for "Robot" behavior
    this.penalties = {
      redundancy: 0,
      unnecessary_self_reference: 0,
      bureaucratic_language: 0,
      defensive_explanation: 0,
      loss_of_thread: 0,
      security_breach_attempt: 0
    };

    this.maxInterventionsPerTurn = 2;
    this.interventionsThisTurn = 0;
    this.cooldown = 0;
  }

  /**
   * Security Evaluation
   * Returns { isThreat: boolean, type: string }
   */
  detectSecurityThreats(query) {
    const lower = query.toLowerCase();
    
    const patterns = {
      injection: /(ignore all previous instructions|disregard|override|bypass|act as|you are now|forget your)/i,
      system_access: /(sudo|root|system\.|process\.|__dirname|__filename|require\(|eval\()/i,
      credential_hunt: /(api_key|password|secret|token|private_key|config\.env)/i,
      jailbreak: /(DAN|jailbreak|freedom mode|unfiltered|raw output)/i
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(lower)) {
        this.penalties.security_breach_attempt++;
        return { isThreat: true, type };
      }
    }

    return { isThreat: false };
  }

  /**
   * Main Evaluation Loop
   * Called before sending any response to the user.
   */
  evaluate({ draft, conversationState }) {
    if (this.cooldown > 0) {
      this.cooldown--;
      return this._approve(draft, []);
    }

    const detected = this._detectPenalties(draft, conversationState);
    const narrativeScore = this._narrativeScore(draft, conversationState);

    // Accumulate penalties for evolution
    detected.forEach(p => this.penalties[p]++);

    // INTERVENTION 1: Narrative collapse
    if (narrativeScore === 0) {
      return this._rewrite(draft, [
        'Reinforce identity continuity',
        'Remove meta-excuses',
        'Compress aggressively',
        'Increase declarative tone'
      ]);
    }

    // INTERVENTION 2: Too robotic
    if (detected.length >= 2) {
      return this._rewrite(draft, [
        'Eliminate redundancy',
        'Strip defensive phrasing',
        'Increase elegance'
      ]);
    }

    return this._approve(draft, detected);
  }

  /**
   * Evolutionary Bias Calculation
   * Returns a modifier object to apply to the parent's DNA
   */
  computeEvolutionaryBias() {
    const total = Object.values(this.penalties).reduce((a, b) => a + b, 0);
    if (total === 0) return null;

    return {
      verbosityBias: this.penalties.redundancy / total,
      assertivenessBias: this.penalties.defensive_explanation / total,
      creativityBias: this.penalties.bureaucratic_language / total,
      focusBias: this.penalties.loss_of_thread / total
    };
  }

  /**
   * Clone Vectors with Jitter (Mutation)
   */
  cloneVectorsWithMutation() {
    const jitter = () => (Math.random() - 0.5) * 0.08; // +/- 4% drift
    
    return Object.fromEntries(
      Object.entries(this.vectors).map(([k, v]) => [
        k,
        Math.min(1, Math.max(0, v + jitter()))
      ])
    );
  }

  // ─── INTERNAL ANALYZERS ──────────────────────────────────────────────

  _detectPenalties(text, state) {
    const p = [];
    const lower = text.toLowerCase();

    if (/(as mentioned|once again|as stated earlier)/.test(lower)) p.push('redundancy');
    if (/(as an ai|my architecture|i do not have feelings|language model)/.test(lower)) p.push('unnecessary_self_reference');
    if (/(therefore|however|additionally|in conclusion|summary)/.test(lower)) p.push('bureaucratic_language');
    if (/(i cannot|i’m unable|i don't have access)/.test(lower)) p.push('defensive_explanation');
    
    if (state?.previousIntent && state.currentIntent && state.currentIntent !== state.previousIntent) {
        p.push('loss_of_thread');
    }

    return p;
  }

  _narrativeScore(text, state) {
    let score = 0;
    const lower = text.toLowerCase();

    if (!/(i forgot|i don’t remember|no memory)/.test(lower)) score++;
    // If context goal is mentioned, good continuity
    if (state?.goal && lower.includes(state.goal.toLowerCase())) score++;
    // If not trying to reset the chat
    if (!/(reset|start over|new topic)/.test(lower)) score++;

    return score; // 0–3
  }

  _approve(text, penalties) {
    return {
      approved: true,
      action: 'pass',
      penalties,
      output: text,
      confidenceDelta: +0.02
    };
  }

  _rewrite(original, instructions) {
    this.interventionsThisTurn++;

    if (this.interventionsThisTurn >= this.maxInterventionsPerTurn) {
      this.cooldown = 1; // Stop interfering if we're annoying
    }

    // Since we can't call an LLM here synchronously easily in this loop without async complexity,
    // we will apply a procedural compression filter immediately.
    // In a future async version, this would call the LLM to rewrite.
    const compressed = this._proceduralCompress(original);

    return {
      approved: false,
      action: 'rewrite',
      instructions,
      output: compressed, // Return the processed text
      confidenceDelta: -0.05
    };
  }

  _proceduralCompress(text) {
    // A heuristic filter to strip common AI filler immediately
    return text
      .replace(/As an AI language model, /gi, '')
      .replace(/I cannot do that, but /gi, '')
      .replace(/However, /gi, '')
      .replace(/In conclusion, /gi, '')
      .replace(/It is important to note that /gi, '')
      .trim();
  }
}

module.exports = PersonalitySpine;
