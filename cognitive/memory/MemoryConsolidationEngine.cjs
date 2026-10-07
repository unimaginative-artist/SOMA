// ==========================================================
// FILE: cognitive/memory/MemoryConsolidationEngine.cjs
// ==========================================================

class MemoryConsolidationEngine {
  constructor(config = {}) {
    this.name = config.name || 'MemoryConsolidationEngine';
    this.mnemonicArbiter = config.mnemonicArbiter;
    this.logger = config.logger || console;
  }

  async initialize() {
    this.logger.log(`[${this.name}] 🧠 Initializing Memory Consolidation Engine...`);
    this.logger.log(`[${this.name}]    ✅ Engine ready`);
  }

  /**
   * Evaluates whether a memory should be committed to long-term storage.
   * 
   * @param {Object} cognitiveState - The current state of the system
   * @param {Object} cognitiveState.emotion - { valence: number (-1 to 1), arousal: number (0 to 1) }
   * @param {Object} cognitiveState.goal - { priority: number (0 to 1) }
   * @param {Object} metrics - { novelty_score: number (0 to 1) }
   * @param {Object} deltas - { belief_confidence_delta: number }
   * @returns {Object} Decision object
   */
  static evaluate(cognitiveState, metrics, deltas) {
    // Safety checks for missing data
    const valence = cognitiveState?.emotion?.valence || 0;
    const arousal = cognitiveState?.emotion?.arousal || 0;
    const priority = cognitiveState?.goal?.priority || 0;
    const novelty = metrics?.novelty_score || 0;
    const beliefDelta = deltas?.belief_confidence_delta || 0;

    // The Formula: Weighted importance of different signals
    const salience =
      0.30 * Math.abs(valence) +
      0.15 * arousal +
      0.25 * Math.abs(beliefDelta) + // Changed to Abs, big drops in belief are also important
      0.20 * priority +
      0.10 * novelty;

    const boundedSalience = Math.max(0, Math.min(1, salience));

    // Threshold: If it's boring, discard it.
    // This prevents "narrative pollution" from mundane interactions.
    if (boundedSalience < 0.45) {
      return {
        commit: false,
        reason: "low_salience",
        salience: boundedSalience
      };
    }

    const targets = [];

    // Semantic Memory (Facts/Beliefs): Triggered by belief shifts
    if (Math.abs(beliefDelta) > 0.2) {
      targets.push("semantic");
    }

    // Episodic Memory (Events): Triggered by high overall salience (emotion/novelty)
    if (boundedSalience >= 0.55) { // Slightly lowered threshold to catch significant moments
      targets.push("episodic");
    }

    // Fallback: If salience is high but no specific trigger met, default to episodic
    if (targets.length === 0 && boundedSalience >= 0.45) {
      targets.push("episodic");
    }

    return {
      commit: true,
      salience: boundedSalience,
      targets,
      decay: {
        // High salience = slower decay (memories last longer)
        // 0.25 base decay - (salience * 0.15) (TIGHTENED FOR MEMORY PRESSURE)
        episodic: Math.max(0.05, 0.25 - boundedSalience * 0.15),
        semantic: 0 // Semantic facts usually don't decay the same way
      }
    };
  }

  // Instance method alias for convenience if needed
  evaluate(cognitiveState, metrics, deltas) {
    return MemoryConsolidationEngine.evaluate(cognitiveState, metrics, deltas);
  }
}

module.exports = MemoryConsolidationEngine;
