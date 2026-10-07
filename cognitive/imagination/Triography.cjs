// cognitive/imagination/Triography.cjs
// Models the 'physics' of an emergent idea

const { clamp } = require('../../core/utils.cjs'); // Assuming a clamp utility exists or adding it

class Triography {
  constructor({ mass = 0, charge = 0, friction = 0 }) {
    this.mass = clamp(mass, 0, 10);       // novelty, how much newness it brings
    this.charge = clamp(charge, 0, 10);   // curiosity pull, how engaging/interesting it is
    this.friction = clamp(friction, 0, 10); // reality resistance, how hard it is to integrate/validate
  }

  score() {
    // A balanced idea with strong pull and low resistance is good
    return (this.mass * 0.4) + (this.charge * 0.6) - (this.friction * 0.8);
  }

  applyPenalty(p) {
    if (p) {
      this.mass = clamp(this.mass - p.mass, 0, 10);
      this.charge = clamp(this.charge - p.charge, 0, 10);
      this.friction = clamp(this.friction + p.friction, 0, 10);
    }
  }

  // Simple serialization for logging/persistence
  toJSON() {
    return { mass: this.mass, charge: this.charge, friction: this.friction };
  }
}

module.exports = { Triography };
