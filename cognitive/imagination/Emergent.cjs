// cognitive/imagination/Emergent.cjs
// Represents a speculative idea (an "emergent") undergoing selection.

const crypto = require("crypto");
const { Triography } = require("./Triography.cjs");
const { expDecay, clamp } = require("../../core/utils.cjs");

function now() {
  return Date.now();
}

function hashSignature(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

class Emergent {
  constructor({ content, sourceIds = [], triography, origin = "aurora" }) {
    this.id = crypto.randomUUID();
    this.content = content;
    this.sourceIds = sourceIds; // IDs of MemoryNodes or Fractals that inspired this
    this.triography = triography; // Instance of Triography
    this.origin = origin; // e.g., "aurora", "logos_inference", "dream_synthesis"

    this.baseWeight = this.triography.score(); // Initial perceived value
    this.currentWeight = this.baseWeight; // Decays over time

    this.createdAt = now();
    this.ageMs = 0;

    this.mutationCount = 0; // How many times it has been mutated
    this.survivalCycles = 0; // How many cycles it has survived

    this.validationScore = 0; // From Logos: how logically plausible it is
    this.riskScore = 0;       // From Prometheus: how dangerous/problematic it is

    this.alive = true;
    this.promoted = false;    // Has it been accepted into the Fractal network?

    this.signature = hashSignature(content); // Unique hash of its content for graveyard tracking
  }

  evaluate(decayLambda) {
    this.ageMs = now() - this.createdAt;
    this.currentWeight = expDecay(
      this.baseWeight,
      decayLambda,
      this.ageMs
    );
  }

  mutate() {
    // Small random changes to triography, to explore variations
    this.triography.mass += clamp(Math.random() * 0.2 - 0.1, -this.triography.mass, 10 - this.triography.mass); // +/- 0.1
    this.triography.charge += clamp(Math.random() * 0.2 - 0.1, -this.triography.charge, 10 - this.triography.charge);
    this.triography.friction += clamp(Math.random() * 0.1 - 0.05, -this.triography.friction, 10 - this.triography.friction); // Smaller change for friction
    this.triography.mass = clamp(this.triography.mass, 0, 10);
    this.triography.charge = clamp(this.triography.charge, 0, 10);
    this.triography.friction = clamp(this.triography.friction, 0, 10);
    
    this.baseWeight = this.triography.score(); // Recalculate base weight
    this.mutationCount++;
  }

  kill(reason) {
    this.alive = false;
    this.deathReason = reason;
    this.killedAt = now();
  }

  // Simple serialization for logging/persistence
  toJSON() {
    return {
      id: this.id,
      content: this.content,
      triography: this.triography.toJSON(),
      currentWeight: this.currentWeight,
      alive: this.alive,
      promoted: this.promoted,
      signature: this.signature
    };
  }
}

class EmergentRegistry {
  constructor() {
    this.emergents = new Map(); // id -> Emergent
    this.graveyardStats = new Map(); // signature -> { deaths: number, triographySignature: string }
  }

  add(e) {
    this.emergents.set(e.id, e);
  }

  remove(id) {
    this.emergents.delete(id);
  }

  getAlive() {
    return [...this.emergents.values()].filter(e => e.alive);
  }

  // Records an emergent's death and updates graveyard stats
  kill(e, reason) {
    e.kill(reason);
    const s = this.graveyardStats.get(e.signature) || { deaths: 0, triography: e.triography.toJSON() };
    s.deaths++;
    this.graveyardStats.set(e.signature, s);
  }

  // Returns a penalty based on how often this emergent's signature has died
  getPenalty(signature) {
    const stat = this.graveyardStats.get(signature);
    if (!stat) return null;
    const k = Math.log(stat.deaths + 1) * 0.05; // Logarithmic penalty scale
    return { mass: k, charge: k * 0.5, friction: k }; // Penalize mass & charge, increase friction
  }

  list() {
    return [...this.emergents.values()];
  }
}

module.exports = { Emergent, EmergentRegistry };
