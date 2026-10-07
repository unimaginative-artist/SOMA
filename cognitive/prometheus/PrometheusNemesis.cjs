// =====================================================
// cognitive/prometheus/PrometheusNemesis.cjs
// PROMETHEUS — NEMESIS BRAIN (FOUNDATION)
// =====================================================
// Purpose:
// Adversarial evaluation of emergent ideas using
// deterministic, numeric pressure — not language.
// =====================================================

class PrometheusNemesis {
  constructor(config = {}) {
    this.thresholds = {
      minFriction: config.minFriction ?? 0.25,
      maxChargeWithoutFriction: config.maxChargeWithoutFriction ?? 0.75,
      minValueDensity: config.minValueDensity ?? 0.15,
      promotionScore: config.promotionScore ?? 0.85
    };

    // Memory of failure patterns
    this.graveyardSignatures = new Map(); // signature -> count
  }

  // ---------------------------------------------------
  // ENTRY POINT
  // ---------------------------------------------------
  evaluateEmergent(emergent) {
    const scores = {
      reality: this.realityStressTest(emergent),
      loop: this.loopTest(emergent),
      domain: this.domainLeakTest(emergent),
      value: this.valueDensityTest(emergent),
      curiosity: this.curiosityIntegrityTest(emergent)
    };

    const aggregate = this.aggregateScore(scores);

    const fate = this.determineFate(aggregate);

    if (fate === "KILL") {
      this.recordFailure(emergent);
    }

    return {
      fate,
      aggregateScore: aggregate,
      breakdown: scores
    };
  }

  // ---------------------------------------------------
  // TESTS
  // ---------------------------------------------------

  // Does it have enough resistance to be real?
  realityStressTest({ triography }) {
    return triography.friction >= this.thresholds.minFriction ? 1 : 0;
  }

  // Has this exact idea died too many times?
  loopTest({ signature }) {
    const deaths = this.graveyardSignatures.get(signature) ?? 0;
    return deaths > 3 ? 0 : 1;
  }

  // Is it leaking across too many domains (hallucination drift)?
  domainLeakTest(emergent) {
    // Check emergent.sourceIds or tags if available, else assume focused
    // If sourceIds > 3, penalty
    return (emergent.sourceIds && emergent.sourceIds.length > 3) ? 0.5 : 1;
  }

  // Is the novelty worth the effort?
  valueDensityTest({ triography }) {
    const density =
      triography.mass /
      (triography.charge + triography.friction + 0.0001);
    return density >= this.thresholds.minValueDensity ? 1 : 0;
  }

  // Is it "pure curiosity" without grounding? (Fantasy)
  curiosityIntegrityTest({ triography }) {
    if (
      triography.charge > this.thresholds.maxChargeWithoutFriction &&
      triography.friction < this.thresholds.minFriction
    ) {
      return 0; // Reject fantasy
    }
    return 1;
  }

  // ---------------------------------------------------
  // AGGREGATION
  // ---------------------------------------------------

  aggregateScore(scores) {
    const values = Object.values(scores);
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  // ---------------------------------------------------
  // FATE DETERMINATION
  // ---------------------------------------------------

  determineFate(score) {
    if (score < 0.3) return "KILL";
    if (score < 0.5) return "MUTATE";
    if (score < 0.7) return "QUARANTINE";
    if (score < this.thresholds.promotionScore) return "ALLOW"; // Keep alive but don't promote
    return "PROMOTE";
  }

  // ---------------------------------------------------
  // MEMORY
  // ---------------------------------------------------

  recordFailure({ signature }) {
    const count = this.graveyardSignatures.get(signature) ?? 0;
    this.graveyardSignatures.set(signature, count + 1);
  }
}

module.exports = { PrometheusNemesis };
