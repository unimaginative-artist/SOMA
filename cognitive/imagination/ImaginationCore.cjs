// cognitive/imagination/ImaginationCore.cjs
// Core logic for the Imagination Engine (Aurora's domain).
// Ties together Triography, Emergents, Fractals, Graveyard, and the Cognitive Gatekeeper.

const crypto = require("crypto");
const { Triography } = require("./Triography.cjs");
const { Emergent, EmergentRegistry } = require("./Emergent.cjs");
const { PromotedFractal, PromotedFractalRegistry } = require("./PromotedFractal.cjs");
const { CognitivePersistence } = require("./CognitivePersistence.cjs"); 
const { PrometheusNemesis } = require("../prometheus/PrometheusNemesis.cjs"); // NEW
const { clamp } = require("../../core/utils.cjs");

function now() {
  return Date.now();
}

// ============================================================================
// Brain Adapters 
// ============================================================================

class AuroraBrainAdapter {
  constructor(triBrain) { this.triBrain = triBrain; }
  async imagine(seedContent, lineage, triography, origin) {
    const prompt = `Based on these concepts: ${seedContent.join(', ')}.
    And with a triographic pull of novelty=${triography.mass.toFixed(1)}, curiosity=${triography.charge.toFixed(1)}, resistance=${triography.friction.toFixed(1)}.
    Generate a highly speculative, yet coherent new concept or idea.
    It should embody the triographic properties. Keep it to 1-2 sentences.`;
    
    try {
      const result = await this.triBrain.callAurora(prompt);
      return result.response || result.text || `Speculative concept from ${seedContent.join(', ')}`;
    } catch (e) {
      console.warn(`Aurora imagine failed: ${e.message}`);
      return `Speculative concept from ${seedContent.join(', ')} (Aurora error)`;
    }
  }
}

class LogosBrainAdapter {
  constructor(triBrain) { this.triBrain = triBrain; }
  async validate(emergent) {
    const prompt = `You are a Logic and Structural Plausibility Validator.
    Is the following speculative concept logically coherent and structurally plausible based on known principles, even if it's novel?
    CONCEPT: "${emergent.content}"
    TRIOGRAPHY: Novelty: ${emergent.triography.mass.toFixed(1)}, Curiosity: ${emergent.triography.charge.toFixed(1)}, Resistance: ${emergent.triography.friction.toFixed(1)}.
    Give a score from 0.0 (impossible) to 1.0 (highly plausible).
    Output JSON: { "score": 0.0-1.0, "reason": "brief explanation" }`;
    
    try {
      const result = await this.triBrain.callLogos(prompt);
      const json = JSON.parse(result.response || result.text);
      return clamp(json.score, 0, 1);
    } catch (error) {
      console.warn(`Logos validation failed for ${emergent.content}: ${error.message}`);
      return Math.max(0, 1 - emergent.triography.friction / 2); 
    }
  }
}

// PrometheusBrainAdapter REMOVED (Replaced by Deterministic Nemesis)

// ============================================================================
// Cognitive Gatekeeper
// ============================================================================

class CognitiveGatekeeper {
  constructor(emergents, promotedFractals, triBrain, persistence) { 
    this.emergents = emergents;
    this.promotedFractals = promotedFractals;
    this.logos = new LogosBrainAdapter(triBrain);
    this.prometheus = new PrometheusNemesis(); // Deterministic Adversary
    this.persistence = persistence; 

    this.decayLambda = 0.00000005; 
    this.minSurvivalWeight = -0.5; 
    this.mutationThreshold = 0.2; 
    this.promotionCycles = 3;    
    this.minValidationScore = 0.6; 
  }

  async processCycle() {
    for (const e of this.emergents.getAlive()) {
      // 1. Prometheus Evaluation (The Nemesis Check)
      // This is now deterministic and happens FIRST
      const nemesisResult = this.prometheus.evaluateEmergent(e);
      const fate = nemesisResult.fate;
      e.riskScore = 1.0 - nemesisResult.aggregateScore; // Inverse for compatibility

      if (fate === "KILL") {
          this.emergents.kill(e, "prometheus_execution");
          this.persistence.logEmergentSummary(e);
          console.log(`[Imagination] 💀 PROMETHEUS EXECUTED: ${e.content.substring(0,30)}... (Score: ${nemesisResult.aggregateScore.toFixed(2)})`);
          continue;
      }

      // Apply penalties from graveyard
      const penalty = this.emergents.getPenalty(e.signature);
      if (penalty) {
        e.triography.applyPenalty(penalty);
        e.baseWeight = e.triography.score();
      }

      e.evaluate(this.decayLambda);

      // Kill ideas that are too weak (natural decay)
      if (e.currentWeight < this.minSurvivalWeight) {
        this.emergents.kill(e, "decay");
        this.persistence.logEmergentSummary(e); 
        continue;
      }

      // Mutate unstable ideas OR if Prometheus mandated it
      if (e.currentWeight < this.mutationThreshold || fate === "MUTATE") {
        e.mutate();
      }

      // Validate (LOGOS - Logic Check)
      // Only check logic if it survived Prometheus
      e.validationScore = await this.logos.validate(e);

      e.survivalCycles++;

      // Promote ideas that are stable, plausible, and approved by Prometheus
      if (
        !e.promoted &&
        fate === "PROMOTE" && 
        e.survivalCycles >= this.promotionCycles &&
        e.validationScore >= this.minValidationScore
      ) {
        this.promotedFractals.add(new PromotedFractal({ label: e.content, sourceEmergent: e }));
        e.promoted = true;
        this.persistence.logEmergentSummary(e); 
        this.emergents.remove(e.id); 
        console.log(`[Imagination] 💡 PROMOTED: ${e.content} (Score: ${e.validationScore.toFixed(2)})`);
      }
    }
  }
}

// ============================================================================
// Aurora Imagination Engine
// Generates new emergent ideas from existing knowledge (Fractals)
// ============================================================================

class AuroraImaginationEngine {
  constructor({ triBrain, promotedFractals, maxOutput = 5, initialApprovalRate = 0.05 }) {
    this.aurora = new AuroraBrainAdapter(triBrain);
    this.promotedFractals = promotedFractals;
    this.maxOutput = maxOutput;
    this.currentApprovalRate = initialApprovalRate; // Probability of an idea being "approved" by Aurora
  }

  async imagine(seedMemoryNodeIds) {
    const ideas = [];
    const seedContent = [];

    // Get content for seedMemoryNodeIds (from MnemonicArbiter or ThoughtNetwork)
    // For now, we'll assume the seed IDs map to abstract concepts
    // In future, this would query MnemonicArbiter/ThoughtNetwork for actual content.
    seedMemoryNodeIds.forEach(id => seedContent.push(`Concept-${id.substring(0, 4)}`));


    for (const f of this.promotedFractals.getAll()) {
      const allowance = f.imaginationAllowance();
      
      // Imagination Allowance: More stable & high-entropy fractals inspire more ideas
      if (Math.random() > allowance * (f.authority * 0.1 + 0.9)) continue; // Higher authority means it's a solid base

      // Random chance to approve an idea
      if (Math.random() < this.currentApprovalRate) {
        const triography = new Triography({
          mass: clamp(Math.random() * allowance * 2, 0.1, 10), // Novelty scaled by allowance
          charge: clamp(Math.random() * allowance * 2, 0.1, 10), // Curiosity scaled by allowance
          friction: clamp(1.2 - allowance, 0, 10), // Resistance inversely scaled
        });
        
        // Use Aurora to actually generate the idea's content
        const content = await this.aurora.imagine(seedContent.concat(f.label), f.id, triography, "aurora");

        const idea = new Emergent({
          content: content,
          sourceIds: [f.id],
          triography,
          origin: "aurora",
        });
        ideas.push(idea);
      }

      if (ideas.length >= this.maxOutput) break;
    }

    if (ideas.length === 0 && seedMemoryNodeIds.length > 0) {
      // If no fractals, just imagine directly from seed
      const triography = new Triography({
        mass: Math.random() * 5,
        charge: Math.random() * 5,
        friction: Math.random() * 5
      });
      const content = await this.aurora.imagine(seedContent, "system_seed", triography, "aurora_direct");
      ideas.push(new Emergent({
        content: content,
        sourceIds: seedMemoryNodeIds,
        triography,
        origin: "aurora_direct",
      }));
    }

    return ideas;
  }
}

// ============================================================================
// Main Imagination Engine Orchestrator
// ============================================================================

class ImaginationEngine {
  constructor({ triBrain, messageBroker }) {
    this.triBrain = triBrain;
    this.messageBroker = messageBroker;
    this.emergents = new EmergentRegistry();
    this.promotedFractals = new PromotedFractalRegistry(); 
    this.persistence = new CognitivePersistence(); // NEW: Persistence Layer
    
    this.gatekeeper = new CognitiveGatekeeper(this.emergents, this.promotedFractals, this.triBrain, this.persistence);
    this.auroraEngine = new AuroraImaginationEngine({ triBrain: this.triBrain, promotedFractals: this.promotedFractals });

    this.cycleInterval = 60000;
    this.cycleCount = 0; // Track cycles for periodic saves
    this.imagineBurstSize = 3;
    this.distilledPrinciplesCache = [];
    this.imaginationLoopTimer = null;  // Timer cleanup

    console.log('[ImaginationEngine] Initialized: The stage for emergent ideas is set.');
  }

  async initialize() {
    // Load persisted state
    const fractals = this.persistence.loadFractals();
    if (fractals && fractals.length > 0) {
        fractals.forEach(f => {
            // Rehydrate PromotedFractal objects
            const pf = new PromotedFractal({ label: f.label, sourceEmergent: { id: f.sourceEmergentId } });
            pf.id = f.id;
            pf.authority = f.authority;
            pf.entropy = f.entropy;
            this.promotedFractals.add(pf);
        });
        console.log(`[ImaginationEngine] Loaded ${fractals.length} promoted fractals from disk.`);
    }

    const meta = this.persistence.loadMeta();
    if (meta && meta.size > 0) {
        this.emergents.graveyardStats = meta;
        console.log(`[ImaginationEngine] Loaded graveyard stats (${meta.size} entries).`);
    }

    // Subscribe to events
    this.messageBroker.subscribe('curiosity:exploring', this._handleCuriosityExploration.bind(this));
    this.messageBroker.subscribe('dream:report', this._handleDreamReport.bind(this));
    this.messageBroker.subscribe('distilled:principle', this._handleDistilledPrinciple.bind(this));
    
    this.startImaginationLoop();
  }

  startImaginationLoop() {
    this.imaginationLoopTimer = setInterval(async () => {
      await this.imagineCycle();
    }, this.cycleInterval);
    console.log(`[ImaginationEngine] Imagination loop started (every ${this.cycleInterval / 1000}s)`);
  }

  async imagineCycle() {
    console.log('[ImaginationEngine] Running imagination cycle...');
    
    // Step 1: Aurora generates new emergent ideas
    const newEmergents = await this.auroraEngine.imagine(this._getImaginationSeed());
    newEmergents.forEach(e => this.emergents.add(e));
    
    // Step 2: Gatekeeper processes all current emergents (validates, mutates, promotes, kills)
    await this.gatekeeper.processCycle();

    // Step 3: Integrate promoted fractals into ThoughtNetwork
    this._integratePromotedFractals();
    
    // Periodic Save
    this.cycleCount++;
    if (this.cycleCount % 5 === 0) {
        this.persistence.saveFractals(this.promotedFractals.getAll());
        this.persistence.saveMeta(this.emergents.graveyardStats);
        console.log('[ImaginationEngine] Persisted state to disk.');
    }
    
    console.log(`[ImaginationEngine] Cycle complete. Alive emergents: ${this.emergents.getAlive().length}, Promoted fractals: ${this.promotedFractals.getAll().length}`);
  }

  _getImaginationSeed() {
      // Prioritize recently distilled principles as seeds for imagination
      if (this.distilledPrinciplesCache.length > 0) {
          const seed = this.distilledPrinciplesCache.shift(); // Use and remove
          return [seed.principle];
      }
      // Fallback to a generic seed if no new principles are available
      return ["general_conceptual_seed"];
  }

  _integratePromotedFractals() {
    // This is the bridge to the ThoughtNetwork (Fractal Mind)
    // Here, promoted PromotedFractals (soft truths) are added as proper FractalNodes
    // to SOMA's long-term conceptual map.
    for (const pf of this.promotedFractals.getAll()) {
        // Publish to message broker so ThoughtNetwork can pick it up
        this.messageBroker.publish('thought_network:integrate_concept', {
            concept: pf.label,
            source: 'imagination_engine',
            confidence: pf.authority,
            tags: ['promoted_imagination', pf.id]
        });
        this.promotedFractals.remove(pf.id); // Remove from imagination's promoted list
        console.log(`[ImaginationEngine] Published new concept for integration: "${pf.label}"`);
    }
  }

  _handleCuriosityExploration(message) {
      const { question, type, priority } = message.payload;
      console.log(`[ImaginationEngine] Curiosity stimulated by: "${question}"`);
      // Add the question itself as a seed for imagination
      this.distilledPrinciplesCache.push({ principle: question, confidence: priority });
      this.imagineCycle(); // Immediately trigger a cycle
  }

  _handleDreamReport(message) {
      const { summary, details } = message.payload;
      console.log(`[ImaginationEngine] Dream report received. Dream quality: ${summary.dream_quality}`);
      // Dream reports can inform imagination, especially proposals
      // Trigger an imagination cycle after a dream for synthesis
      this.imagineCycle();
  }

  _handleDistilledPrinciple(message) {
      const { principle, confidence } = message.payload;
      console.log(`[ImaginationEngine] Received distilled principle: "${principle.substring(0, 50)}..."`);
      this.distilledPrinciplesCache.push(message.payload);
  }

  shutdown() {
      if (this.imaginationLoopTimer) {
          clearInterval(this.imaginationLoopTimer);
          this.imaginationLoopTimer = null;
          console.log('[ImaginationEngine] Imagination loop stopped');
      }
  }
}

module.exports = { ImaginationEngine };
