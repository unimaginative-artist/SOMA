/**
 * CausalityArbiter.js
 *
 * Builds causal models from experience to understand "why" things happen.
 * Distinguishes correlation from causation and enables counterfactual reasoning.
 *
 * This is a critical component for AGI - without causality, SOMA can only
 * correlate patterns but can't truly understand or predict outcomes.
 *
 * Key Capabilities:
 * - Causal graph construction from observations
 * - Intervention vs observation distinction
 * - Counterfactual reasoning ("what if I had done X?")
 * - Causal hypothesis generation and testing
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

export class CausalityArbiter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'CausalityArbiter';
    this.messageBroker = config.messageBroker || null;

    this.config = {
      minObservations: 10,          // Min observations before inferring causation
      confidenceThreshold: 0.7,     // Min confidence for causal link
      interventionWeight: 2.0,      // Weight interventions higher than observations
      decayRate: 0.95,              // Decay old causal beliefs
      maxGraphSize: 1000,           // Max nodes in causal graph
      ...config
    };

    // Causal graph: Map of node -> { causes: [], effects: [], strength: {} }
    this.causalGraph = new Map();

    // Observation history: Track co-occurrences
    this.observations = new Map(); 

    // Intervention history: Track deliberate actions and outcomes
    this.interventions = [];

    // Counterfactuals: "What if" scenarios
    this.counterfactuals = new Map();

    // Causal hypotheses being tested
    this.hypotheses = [];

    // Statistics
    this.stats = {
      totalObservations: 0,
      totalInterventions: 0,
      causalLinksDiscovered: 0,
      hypothesesTested: 0
    };

    console.log('🔗 [CausalityArbiter] Initialized');
  }

  /**
   * Initialize the arbiter
   */
  async initialize({ experienceBuffer, metaLearning, mnemonic, mnemonicArbiter } = {}) {
    this.experienceBuffer = experienceBuffer;
    this.metaLearning = metaLearning;
    // Accept both 'mnemonic' (direct) and 'mnemonicArbiter' (ArbiterLoader standard key)
    this.mnemonic = mnemonic || mnemonicArbiter || null;

    // Load existing causal graph
    await this.loadCausalGraph();

    // Register with MessageBroker — correct 2-argument signature
    if (this.messageBroker) {
      try {
        this.messageBroker.registerArbiter(this.name, {
          instance: this,
          type: 'causality',
          capabilities: ['observe', 'recordIntervention', 'queryCausalChains', 'generateCounterfactual']
        });
        console.log(`🔗 [${this.name}] Registered with MessageBroker`);
      } catch (error) {
        console.error(`❌ [${this.name}] Failed to register with MessageBroker:`, error.message);
      }
    }

    // Auto-save causal graph every 5 minutes so learning survives restarts
    this._saveTimer = setInterval(() => {
      this.saveCausalGraph().catch(() => {});
    }, 5 * 60_000);
    if (this._saveTimer.unref) this._saveTimer.unref();

    console.log('✅ [CausalityArbiter] Ready');
    console.log(`   📊 Causal nodes: ${this.causalGraph.size}`);
    console.log(`   🔗 Causal links: ${this.stats.causalLinksDiscovered}`);

    return true;
  }

  /**
   * Observe an event and update causal model
   */
  // Produces a stable JSON key regardless of property insertion order.
  // Without this, {a:1,b:2} and {b:2,a:1} would create duplicate observation entries.
  _stableKey(obj) {
    if (typeof obj !== 'object' || obj === null) return String(obj);
    return JSON.stringify(obj, Object.keys(obj).sort());
  }

  async observe(observation) {
    const { event, context = {}, outcome = {} } = observation;
    this.stats.totalObservations++;

    const variables = this.extractVariables(context);

    for (const variable of variables) {
      const key = `${variable},${this._stableKey(outcome)}`;

      if (!this.observations.has(key)) {
        if (this.observations.size >= 50000) {
          this._pruneObservations();
        }
        this.observations.set(key, { count: 0, contexts: [] });
      }

      const obs = this.observations.get(key);
      obs.count++;
      obs.contexts.push({ timestamp: Date.now(), context });

      if (obs.contexts.length > 100) {
        obs.contexts.shift();
      }
    }

    if (this.stats.totalObservations % this.config.minObservations === 0) {
      await this.inferCausalLinks();
    }
  }

  _pruneObservations() {
    const entries = Array.from(this.observations.entries());
    entries.sort((a, b) => a[1].count - b[1].count);
    const toRemove = Math.floor(entries.length * 0.1);
    for (let i = 0; i < toRemove; i++) {
      this.observations.delete(entries[i][0]);
    }
    console.log(`[${this.name}] Pruned ${toRemove} low-count observations (${this.observations.size} remaining)`);
  }

  async recordIntervention(intervention) {
    const { action, context = {}, outcome = {}, success = false } = intervention;
    this.stats.totalInterventions++;

    this.interventions.push({
      action,
      context,
      outcome,
      success,
      timestamp: Date.now()
    });

    if (this.interventions.length > 1000) {
      this.interventions.shift();
    }

    await this.updateCausalGraphFromIntervention(action, outcome, success);
    await this.testHypotheses(intervention);
  }

  async updateCausalGraphFromIntervention(action, outcome, success) {
    if (!this.causalGraph.has(action)) {
      this.causalGraph.set(action, { causes: [], effects: [], strength: {} });
    }

    const outcomeKey = this._stableKey(outcome);
    if (!this.causalGraph.has(outcomeKey)) {
      this.causalGraph.set(outcomeKey, { causes: [], effects: [], strength: {} });
    }

    const actionNode = this.causalGraph.get(action);
    const outcomeNode = this.causalGraph.get(outcomeKey);

    if (!actionNode.effects.includes(outcomeKey)) {
      actionNode.effects.push(outcomeKey);
    }

    if (!outcomeNode.causes.includes(action)) {
      outcomeNode.causes.push(action);
    }

    const currentStrength = actionNode.strength[outcomeKey] || 0;
    const delta = success ? 1 : -0.5;
    const newStrength = Math.max(0, Math.min(1,
      currentStrength + (delta * this.config.interventionWeight) / 10
    ));
    
    actionNode.strength[outcomeKey] = newStrength;
    this.stats.causalLinksDiscovered++;

    console.log(`🔗 [Causality] ${action} → ${outcomeKey.substring(0, 50)} (strength: ${newStrength.toFixed(2)})`);
    
    // 🔱 POSEIDON: Broadcast discovery to the nervous system
    if (this.messageBroker) {
        this.messageBroker.publish('causality.link_discovered', {
            cause: action,
            effect: outcome,
            strength: newStrength
        });
    }
  }

  async inferCausalLinks() {
    this.log('info', `Checking ${this.observations.size} observation pairs for causal patterns...`);

    for (const [key, obs] of this.observations.entries()) {
      if (obs.count < this.config.minObservations) continue;

      const [variable, outcomeStr] = key.split(',', 2);
      const pOutcomeGivenVar = this.calculateConditionalProbability(variable, outcomeStr);
      const pOutcome = this.calculateBaseProbability(outcomeStr);

      if (pOutcomeGivenVar > pOutcome * 1.5) { 
        const confidence = Math.min(0.9, (pOutcomeGivenVar - pOutcome) / pOutcome);

        if (confidence >= this.config.confidenceThreshold) {
          const explanation = await this._verifyLinkWithBrain(variable, outcomeStr);

          if (explanation.logical) {
            console.log(`✅ [Causality] Brain confirmed link: ${variable} -> ${outcomeStr}`);
            await this.addCausalLink(variable, outcomeStr, confidence * explanation.weight, explanation.reasoning);
          } else {
            console.log(`❌ [Causality] Brain rejected link: ${variable} -> ${outcomeStr} (Reason: ${explanation.reasoning})`);
          }
        }
      }
    }
  }

  async _verifyLinkWithBrain(cause, effect) {
    // No broker → reject the link rather than auto-approve every correlation
    if (!this.messageBroker) return { logical: false, weight: 0, reasoning: 'No broker — link rejected' };

    try {
        const prompt = `[CAUSAL ANALYSIS]
        I have detected a statistical correlation: "${cause}" often precedes "${effect}".

        TASK:
        Evaluate if this is likely a real CAUSAL relationship or just noise.

        Return JSON:
        {
          "is_logical": true/false,
          "reasoning": "brief explanation",
          "causal_weight": 0.1-1.0
        }`;

        const response = await this.messageBroker.sendMessage({
            to: 'SomaBrain',
            type: 'reason',
            payload: { query: prompt, context: { mode: 'fast', brain: 'PROMETHEUS' } }
        });

        if (response && response.text) {
            const cleanText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleanText);
            return {
                logical: result.is_logical,
                weight: result.causal_weight || 0.7,
                reasoning: result.reasoning
            };
        }
    } catch (e) {
        console.warn(`[Causality] Brain verification failed: ${e.message}`);
    }
    // Brain call failed — reject rather than auto-approve; statistical correlation alone
    // is not sufficient to declare causation. The link will be re-evaluated next cycle.
    return { logical: false, weight: 0, reasoning: 'Brain verification failed — link rejected pending retry' };
  }

  async addCausalLink(cause, effect, strength, reasoning = '') {
    // Enforce maxGraphSize — drop weakest nodes when at capacity
    if (this.causalGraph.size >= this.config.maxGraphSize && !this.causalGraph.has(cause) && !this.causalGraph.has(effect)) {
      const entries = Array.from(this.causalGraph.entries());
      const weakest = entries
        .filter(([, n]) => n.causes.length === 0 && n.effects.length === 0)
        .sort((a, b) => (Object.values(a[1].strength)[0] || 0) - (Object.values(b[1].strength)[0] || 0));
      if (weakest.length > 0) this.causalGraph.delete(weakest[0][0]);
      else return; // graph full and no orphans to remove — skip this link
    }

    if (!this.causalGraph.has(cause)) {
      this.causalGraph.set(cause, { causes: [], effects: [], strength: {}, reasoning: {} });
    }
    if (!this.causalGraph.has(effect)) {
      this.causalGraph.set(effect, { causes: [], effects: [], strength: {}, reasoning: {} });
    }

    const causeNode = this.causalGraph.get(cause);
    const effectNode = this.causalGraph.get(effect);

    if (!causeNode.effects.includes(effect)) {
      causeNode.effects.push(effect);
    }
    if (!effectNode.causes.includes(cause)) {
      effectNode.causes.push(cause);
    }

    causeNode.strength[effect] = strength;
    if (reasoning) {
        causeNode.reasoning[effect] = reasoning;
    }

    this.emit('causalLinkDiscovered', { cause, effect, strength, reasoning });
    
    // 🔱 POSEIDON: Broadcast discovery to the nervous system
    if (this.messageBroker) {
        this.messageBroker.publish('causality.link_discovered', {
            cause, effect, strength
        });
    }
  }

  log(level, msg) {
      console.log(`[${level.toUpperCase()}] [${this.name}] ${msg}`);
  }

  generateCounterfactual(situation, alternativeAction) {
    const { actualAction, context, actualOutcome } = situation;
    const predicted = this.predictOutcome(alternativeAction, context);

    const counterfactual = {
      actualAction,
      alternativeAction,
      context,
      actualOutcome,
      predictedOutcome: predicted.outcome,
      confidence: predicted.confidence,
      timestamp: Date.now()
    };

    const key = `${actualAction}→${alternativeAction}`;
    if (!this.counterfactuals.has(key)) {
      this.counterfactuals.set(key, []);
    }
    this.counterfactuals.get(key).push(counterfactual);

    console.log(`🤔 [Counterfactual] What if "${alternativeAction}" instead of "${actualAction}"?`);
    return counterfactual;
  }

  predictOutcome(action, context) {
    if (!this.causalGraph.has(action)) {
      return { outcome: {}, confidence: 0 };
    }

    const actionNode = this.causalGraph.get(action);
    let bestOutcome = null;
    let bestStrength = 0;

    for (const effect of actionNode.effects) {
      const strength = actionNode.strength[effect] || 0;
      if (strength > bestStrength) {
        bestStrength = strength;
        try {
          bestOutcome = JSON.parse(effect);
        } catch (e) {
          bestOutcome = { result: effect };
        }
      }
    }

    return {
      outcome: bestOutcome || {},
      confidence: bestStrength
    };
  }

  generateHypothesis() {
    const candidates = [];
    for (const [key, obs] of this.observations.entries()) {
      if (obs.count < this.config.minObservations) continue;
      const [variable, outcome] = key.split(',', 2);
      const node = this.causalGraph.get(variable);
      if (node && node.strength[outcome] > 0.8) continue;
      candidates.push({ cause: variable, effect: outcome, observationCount: obs.count });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.observationCount - a.observationCount);
    const hypothesis = candidates[0];
    hypothesis.id = `hyp_${Date.now()}`;
    hypothesis.generated = Date.now();
    hypothesis.status = 'pending';
    this.hypotheses.push(hypothesis);
    console.log(`💡 [Hypothesis] Does "${hypothesis.cause}" cause "${hypothesis.effect.substring(0, 50)}"?`); 
    return hypothesis;
  }

  async testHypotheses(intervention) {
    for (const hypothesis of this.hypotheses) {
      if (hypothesis.status !== 'pending') continue;
      const { action, outcome } = intervention;
      const outcomeStr = this._stableKey(outcome);
      if (hypothesis.cause === action && hypothesis.effect === outcomeStr) {
        hypothesis.status = 'confirmed';
        hypothesis.confirmedAt = Date.now();
        this.stats.hypothesesTested++;
        console.log(`✅ [Hypothesis Confirmed] "${hypothesis.cause}" → "${hypothesis.effect.substring(0, 50)}"`);
        this.emit('hypothesisConfirmed', hypothesis);
      }
    }
  }

  queryCausalChains(concept, options = {}) {
    const { maxDepth = 2, minConfidence = 0.3 } = options;
    const chains = [];
    const matchingNodes = [];
    for (const nodeId of this.causalGraph.keys()) {
      if (nodeId.toLowerCase().includes(concept.toLowerCase())) {
        matchingNodes.push(nodeId);
      }
    }
    if (matchingNodes.length === 0) return [];
    for (const startNode of matchingNodes) {
      this._traverseCausalChains(startNode, [], chains, maxDepth, minConfidence);
    }
    chains.sort((a, b) => b.confidence - a.confidence);
    return chains.slice(0, 10);
  }

  _traverseCausalChains(currentNode, path, chains, maxDepth, minConfidence, depth = 0) {
    if (depth >= maxDepth) return;
    const node = this.causalGraph.get(currentNode);
    if (!node) return;
    for (const effect of node.effects) {
      const strength = node.strength[effect] || 0;
      if (strength >= minConfidence) {
        chains.push({ cause: currentNode, effect: effect, confidence: strength, depth: depth + 1, path: [...path, currentNode] });
        if (depth + 1 < maxDepth) {
          this._traverseCausalChains(effect, [...path, currentNode], chains, maxDepth, minConfidence, depth + 1);
        }
      }
    }
  }

  explainOutcome(outcome) {
    const outcomeKey = this._stableKey(outcome);
    if (!this.causalGraph.has(outcomeKey)) return [];
    const outcomeNode = this.causalGraph.get(outcomeKey);
    const explanations = [];
    for (const cause of outcomeNode.causes) {
      const causeNode = this.causalGraph.get(cause);
      const strength = causeNode?.strength[outcomeKey] || 0;
      if (strength > 0.3) {
        explanations.push({ cause, confidence: strength, type: this.interventions.some(i => i.action === cause) ? 'intervention' : 'observation' });
      }
    }
    explanations.sort((a, b) => b.confidence - a.confidence);
    return explanations;
  }

  extractVariables(context) {
    const variables = [];
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        variables.push(`${key}:${value}`);
      }
    }
    return variables;
  }

  calculateConditionalProbability(variable, outcome) {
    const key = `${variable},${outcome}`;
    const obs = this.observations.get(key);
    if (!obs) return 0;
    let totalWithVariable = 0;
    for (const [k, o] of this.observations.entries()) {
      if (k.startsWith(variable + ',')) {
        totalWithVariable += o.count;
      }
    }
    return totalWithVariable > 0 ? obs.count / totalWithVariable : 0;
  }

  calculateBaseProbability(outcome) {
    let totalOutcomeCount = 0;
    let totalCount = 0;
    for (const [k, obs] of this.observations.entries()) {
      if (k.endsWith(',' + outcome)) {
        totalOutcomeCount += obs.count;
      }
      totalCount += obs.count;
    }
    return totalCount > 0 ? totalOutcomeCount / totalCount : 0;
  }

  async loadCausalGraph() {
    try {
      const dataPath = path.join(process.cwd(), 'SOMA', 'causality');
      await fs.mkdir(dataPath, { recursive: true });
      const graphPath = path.join(dataPath, 'causal-graph.json');
      const data = await fs.readFile(graphPath, 'utf8');
      const saved = JSON.parse(data);
      this.causalGraph = new Map(saved.graph);
      this.observations = new Map(saved.observations);
      this.interventions = saved.interventions || [];
      this.stats = saved.stats || this.stats;
      console.log('📂 [CausalityArbiter] Loaded existing causal graph');
    } catch (error) {
      console.log('📂 [CausalityArbiter] Starting with empty causal graph');
    }
  }

  async saveCausalGraph() {
    try {
      const dataPath = path.join(process.cwd(), 'SOMA', 'causality');
      await fs.mkdir(dataPath, { recursive: true });
      const graphPath = path.join(dataPath, 'causal-graph.json');
      const data = {
        graph: Array.from(this.causalGraph.entries()),
        observations: Array.from(this.observations.entries()),
        interventions: this.interventions.slice(-1000),
        stats: this.stats,
        savedAt: new Date().toISOString()
      };
      await fs.writeFile(graphPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('❌ [CausalityArbiter] Failed to save causal graph:', error);
    }
  }

  getStats() {
    return {
      ...this.stats,
      graphNodes: this.causalGraph.size,
      observations: this.observations.size,
      interventions: this.interventions.length,
      pendingHypotheses: this.hypotheses.filter(h => h.status === 'pending').length,
      confirmedHypotheses: this.hypotheses.filter(h => h.status === 'confirmed').length
    };
  }

  exportGraph() {
    const nodes = [];
    const edges = [];
    for (const [nodeId, node] of this.causalGraph.entries()) {
      nodes.push({ id: nodeId, label: nodeId.substring(0, 30) });
      for (const effect of node.effects) {
        edges.push({ from: nodeId, to: effect, strength: node.strength[effect] || 0 });
      }
    }
    return { nodes, edges };
  }
}

export default CausalityArbiter;
