// ==========================================================
// FILE: cognitive/memory/MemoryCommitPlan.js
// ==========================================================

class MemoryCommitPlan {
  /**
   * Deterministic plan for memory commitment.
   * This object is serializable and can be logged/replayed.
   */
  constructor({ salience, targets, decay }) {
    this.timestamp = Date.now();
    this.salience = salience;
    this.targets = targets; // ['episodic', 'semantic']
    this.decay = decay;     // { episodic: number, semantic: number }
  }
}

module.exports = MemoryCommitPlan;
