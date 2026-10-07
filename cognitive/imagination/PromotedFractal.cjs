// cognitive/imagination/PromotedFractal.cjs
// Represents a "soft truth" or concept that has survived the imagination engine
// and is ready for integration into the main ThoughtNetwork.

const crypto = require("crypto");
const { clamp } = require("../../core/utils.cjs");

function now() {
  return Date.now();
}

class PromotedFractal {
  constructor({ label, sourceEmergent }) {
    this.id = crypto.randomUUID();
    this.label = label; // The concept's name or description
    this.sourceEmergentId = sourceEmergent.id; // The Emergent it came from

    this.authority = 1.0; // How much it's been validated/reinforced
    this.entropy = 0.3;   // How much uncertainty or room for mutation it has
    this.validationCount = 1; // How many times it has been reinforced

    this.createdAt = now();
  }

  reinforce() {
    this.validationCount++;
    this.authority = clamp(this.authority + 0.15, 0, 10);
    this.entropy = clamp(this.entropy * 0.9, 0, 10); // Entropy decreases with reinforcement
  }

  challenge() {
    this.entropy = clamp(this.entropy + 0.15, 0, 10);
    this.authority = clamp(this.authority * 0.95, 0, 10); // Authority decreases with challenge
  }

  imaginationAllowance() {
    // A concept with high entropy but low authority is fertile ground for new imagination
    return clamp(this.entropy - this.authority, 0, 1);
  }

  // Simple serialization
  toJSON() {
    return {
      id: this.id,
      label: this.label,
      sourceEmergentId: this.sourceEmergentId,
      authority: this.authority,
      entropy: this.entropy
    };
  }
}

class PromotedFractalRegistry {
  constructor() {
    this.fractals = new Map(); // id -> PromotedFractal
  }

  add(f) {
    this.fractals.set(f.id, f);
  }

  get(id) {
    return this.fractals.get(id);
  }

  remove(id) {
    this.fractals.delete(id);
  }

  getAll() {
    return [...this.fractals.values()];
  }
}

module.exports = { PromotedFractal, PromotedFractalRegistry };
