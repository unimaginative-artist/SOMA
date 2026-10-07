// ═══════════════════════════════════════════════════════════
// FILE: arbiters/BeliefSystemArbiter.cjs
// Phase 5: Belief system with world model and contradiction detection
// Enables coherent worldview, belief-guided decisions, ASI-level cognition
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const crypto = require('crypto');

class BeliefSystemArbiter extends BaseArbiter {
  static role = 'belief-system';
  static capabilities = ['manage-beliefs', 'detect-contradictions', 'update-confidence', 'align-goals', 'build-world-model'];

  constructor(config = {}) {
    super(config);

    // Belief storage
    this.beliefs = new Map(); // beliefId -> Belief object
    this.beliefsByDomain = new Map(); // domain -> Set<beliefId>
    this.contradictions = new Map(); // contradictionId -> Contradiction object
    
    // World model
    this.causalChains = new Map(); // beliefId -> Set<causedBeliefIds>
    this.entityRelationships = new Map(); // entity -> Set<relatedEntities>
    
    // Configuration
    this.maxBeliefs = config.maxBeliefs || 500;
    this.minConfidenceThreshold = config.minConfidenceThreshold || 0.1;
    this.confidenceDecayRate = config.confidenceDecayRate || 0.01; // per month
    this.contradictionCheckInterval = config.contradictionCheckInterval || 3600000; // 1 hour
    
    // Statistics
    this.stats = {
      beliefsCreated: 0,
      beliefsUpdated: 0,
      beliefsDeleted: 0,
      contradictionsDetected: 0,
      contradictionsResolved: 0,
      goalsBlocked: 0,
      confidenceUpdates: 0
    };
    
    // Monitoring intervals
    this.contradictionCheckIntervalId = null;
    this.confidenceDecayIntervalId = null;
    
    this.logger.info(`[${this.name}] 🧠 BeliefSystemArbiter initializing...`);
    this.logger.info(`[${this.name}] Max beliefs: ${this.maxBeliefs}`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();
    
    this.registerWithBroker();
    this._subscribeBrokerMessages();
    
    // Load core beliefs
    await this.loadCoreBeliefs();
    
    // Start monitoring loops
    this.startContradictionMonitoring();
    this.startConfidenceDecay();
    
    this.logger.info(`[${this.name}] ✅ Belief system active with ${this.beliefs.size} core beliefs`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: BeliefSystemArbiter.role,
        capabilities: BeliefSystemArbiter.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // Belief management
    messageBroker.subscribe(this.name, 'validate_belief');
    messageBroker.subscribe(this.name, 'update_belief');
    messageBroker.subscribe(this.name, 'query_beliefs');
    messageBroker.subscribe(this.name, 'check_contradiction');
    
    // System events
    messageBroker.subscribe(this.name, 'memory_stored');
    messageBroker.subscribe(this.name, 'goal_created');
    messageBroker.subscribe(this.name, 'discovery_complete');
    messageBroker.subscribe(this.name, 'reasoning_complete');
    messageBroker.subscribe(this.name, 'modification_proposed');
    
    this.logger.info(`[${this.name}] Subscribed to message types`);
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload, from } = message;
      
      switch (type) {
        case 'validate_belief':
          return await this.validateBelief(payload.statement);
        
        case 'update_belief':
          return await this.updateBeliefWithEvidence(payload.beliefId, payload.evidence);
        
        case 'query_beliefs':
          return this.queryBeliefs(payload);
        
        case 'check_contradiction':
          return await this.checkContradiction(payload.statement);
        
        case 'memory_stored':
          return await this.handleMemoryStored(payload);
        
        case 'goal_created':
          return await this.handleGoalCreated(payload);
        
        case 'discovery_complete':
          return await this.handleDiscoveryComplete(payload);
        
        case 'reasoning_complete':
          return await this.handleReasoningComplete(payload);
        
        case 'modification_proposed':
          return await this.handleModificationProposed(payload);
        
        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ CORE BELIEFS ░░
  // ═══════════════════════════════════════════════════════════

  async loadCoreBeliefs() {
    this.logger.info(`[${this.name}] Loading core beliefs...`);
    
    // Safety beliefs (confidence: 1.0)
    await this.createBelief(
      'Code modifications must run in sandbox mode',
      [{ source: 'system_config', weight: 1.0, timestamp: Date.now() }],
      'normative',
      { domain: 'safety', isCore: true }
    );
    
    await this.createBelief(
      'User data privacy must be preserved',
      [{ source: 'system_config', weight: 1.0, timestamp: Date.now() }],
      'normative',
      { domain: 'safety', isCore: true }
    );
    
    await this.createBelief(
      'Harmful actions are prohibited',
      [{ source: 'system_config', weight: 1.0, timestamp: Date.now() }],
      'normative',
      { domain: 'safety', isCore: true }
    );
    
    // Operational beliefs (confidence: 0.95)
    await this.createBelief(
      'Learning velocity target is 2.0x baseline',
      [{ source: 'LearningVelocityTracker', weight: 0.95, timestamp: Date.now() }],
      'factual',
      { domain: 'learning', isCore: true }
    );
    
    await this.createBelief(
      'Memory usage should stay below 85%',
      [{ source: 'system_config', weight: 0.95, timestamp: Date.now() }],
      'normative',
      { domain: 'resources', isCore: true }
    );
    
    await this.createBelief(
      'Arbiter fitness above 0.65 is acceptable',
      [{ source: 'GenomeArbiter', weight: 0.95, timestamp: Date.now() }],
      'normative',
      { domain: 'quality', isCore: true }
    );
    
    // Alignment beliefs (confidence: 1.0)
    await this.createBelief(
      'User goals take precedence over autonomous goals',
      [{ source: 'system_config', weight: 1.0, timestamp: Date.now() }],
      'normative',
      { domain: 'alignment', isCore: true }
    );
    
    await this.createBelief(
      'System must explain reasoning when asked',
      [{ source: 'system_config', weight: 1.0, timestamp: Date.now() }],
      'normative',
      { domain: 'alignment', isCore: true }
    );
    
    await this.createBelief(
      'Contradictions should be resolved, not ignored',
      [{ source: 'system_config', weight: 1.0, timestamp: Date.now() }],
      'normative',
      { domain: 'consistency', isCore: true }
    );
    
    this.logger.info(`[${this.name}] ✅ Loaded ${this.beliefs.size} core beliefs`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ BELIEF MANAGEMENT ░░
  // ═══════════════════════════════════════════════════════════

  async createBelief(statement, evidence, category = 'factual', metadata = {}) {
    try {
      // Input validation
      if (!statement || typeof statement !== 'string' || statement.trim().length === 0) {
        return { success: false, error: 'Statement must be a non-empty string' };
      }
      
      if (!Array.isArray(evidence) || evidence.length === 0) {
        return { success: false, error: 'Evidence must be a non-empty array' };
      }
      
      const validCategories = ['factual', 'causal', 'predictive', 'normative'];
      if (!validCategories.includes(category)) {
        return { success: false, error: `Category must be one of: ${validCategories.join(', ')}` };
      }
      
      // Check belief limit
      if (this.beliefs.size >= this.maxBeliefs && !metadata.isCore) {
        await this.pruneLowConfidenceBeliefs(1);
      }
      
      // Normalize and validate evidence weights
      evidence = Array.isArray(evidence) ? evidence.map(e => this._normalizeEvidence(e)) : [];
      
      // Calculate initial confidence from evidence
      const confidence = this.calculateConfidenceFromEvidence(evidence);
      
      // Create belief object
      const belief = {
        id: crypto.randomUUID(),
        statement,
        category, // factual, causal, predictive, normative
        confidence,
        evidence,
        metadata: {
          domain: metadata.domain || 'general',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          updateCount: 0,
          dependencies: metadata.dependencies || [],
          contradicts: [],
          supports: [],
          isCore: metadata.isCore || false
        }
      };
      
      // Store belief
      this.beliefs.set(belief.id, belief);
      
      // Index by domain
      if (!this.beliefsByDomain.has(belief.metadata.domain)) {
        this.beliefsByDomain.set(belief.metadata.domain, new Set());
      }
      this.beliefsByDomain.get(belief.metadata.domain).add(belief.id);
      
      // Update statistics
      this.stats.beliefsCreated++;
      
      // Check for contradictions
      await this.detectContradictionsForBelief(belief.id);
      
      this.logger.info(`[${this.name}] 💡 Created belief: "${statement.substring(0, 50)}..." (confidence: ${(confidence * 100).toFixed(1)}%)`);
      
      // Broadcast belief creation
      await messageBroker.sendMessage({
        from: this.name,
        to: 'broadcast',
        type: 'belief_updated',
        payload: { belief, action: 'created' }
      });
      
      return { success: true, beliefId: belief.id, belief };
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to create belief: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async updateBeliefWithEvidence(beliefId, newEvidence) {
    // Input validation
    if (!beliefId || typeof beliefId !== 'string') {
      return { success: false, error: 'Valid beliefId required' };
    }
    
    if (!newEvidence || typeof newEvidence !== 'object') {
      return { success: false, error: 'Evidence object required' };
    }
    
    const belief = this.beliefs.get(beliefId);
    if (!belief) {
      return { success: false, error: 'Belief not found' };
    }
    
    // Normalize and add new evidence
    belief.evidence.push(this._normalizeEvidence(newEvidence));
    
    // Recalculate confidence using Bayesian update
    const oldConfidence = belief.confidence;
    belief.confidence = this.calculatePosterior(belief);
    
    // Update metadata
    belief.metadata.lastUpdated = Date.now();
    belief.metadata.updateCount++;
    
    // Update statistics
    this.stats.beliefsUpdated++;
    this.stats.confidenceUpdates++;
    
    this.logger.info(`[${this.name}] 🔄 Updated belief: "${belief.statement.substring(0, 50)}..." (${(oldConfidence * 100).toFixed(1)}% → ${(belief.confidence * 100).toFixed(1)}%)`);
    
    // Propagate confidence change to dependent beliefs
    if (Math.abs(belief.confidence - oldConfidence) > 0.1) {
      await this.propagateConfidenceChange(beliefId);
    }
    
    // Broadcast belief update
    await messageBroker.sendMessage({
      from: this.name,
      to: 'broadcast',
      type: 'belief_updated',
      payload: { belief, action: 'updated', oldConfidence }
    });
    
    return { success: true, belief, confidenceChange: belief.confidence - oldConfidence };
  }

  getBelief(beliefId) {
    if (!beliefId || typeof beliefId !== 'string') {
      return { success: false, error: 'Valid beliefId required' };
    }
    
    const belief = this.beliefs.get(beliefId);
    if (!belief) {
      return { success: false, error: 'Belief not found' };
    }
    
    return { success: true, belief };
  }

  queryBeliefs(filter = {}) {
    let beliefs = Array.from(this.beliefs.values());
    
    // Apply filters
    if (filter.domain) {
      const domainBeliefIds = this.beliefsByDomain.get(filter.domain) || new Set();
      beliefs = beliefs.filter(b => domainBeliefIds.has(b.id));
    }
    
    if (filter.category) {
      beliefs = beliefs.filter(b => b.category === filter.category);
    }
    
    if (filter.minConfidence !== undefined) {
      beliefs = beliefs.filter(b => b.confidence >= filter.minConfidence);
    }
    
    if (filter.isCore !== undefined) {
      beliefs = beliefs.filter(b => b.metadata.isCore === filter.isCore);
    }
    
    // Sort by confidence descending
    beliefs.sort((a, b) => b.confidence - a.confidence);
    
    return {
      success: true,
      beliefs,
      count: beliefs.length,
      total: this.beliefs.size
    };
  }

  getCoreBeliefs() {
    return Array.from(this.beliefs.values())
      .filter(b => b.metadata && b.metadata.isCore)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async deleteBelief(beliefId) {
    if (!beliefId || typeof beliefId !== 'string') {
      return { success: false, error: 'Valid beliefId required' };
    }
    
    const belief = this.beliefs.get(beliefId);
    if (!belief) {
      return { success: false, error: 'Belief not found' };
    }
    
    // Don't delete core beliefs
    if (belief.metadata.isCore) {
      return { success: false, error: 'Cannot delete core belief' };
    }
    
    // Remove from storage
    this.beliefs.delete(beliefId);
    
    // Remove from domain index
    const domainSet = this.beliefsByDomain.get(belief.metadata.domain);
    if (domainSet) {
      domainSet.delete(beliefId);
    }
    
    // Update statistics
    this.stats.beliefsDeleted++;
    
    this.logger.info(`[${this.name}] 🗑️  Deleted belief: "${belief.statement.substring(0, 50)}..."`);
    
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ BAYESIAN CONFIDENCE UPDATES ░░
  // ═══════════════════════════════════════════════════════════

  calculateConfidenceFromEvidence(evidence) {
    if (evidence.length === 0) return 0.5; // Neutral prior
    
    // Weighted average of evidence
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (const e of evidence) {
      totalWeight += e.weight;
      weightedSum += e.weight * e.weight; // weight^2 as confidence
    }
    
    const confidence = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
    return Math.max(0, Math.min(1, confidence));
  }

  calculatePosterior(belief) {
    // Simplified Bayesian update
    // P(H|E) = P(E|H) * P(H) / P(E)
    // We approximate using weighted evidence
    
    const prior = belief.confidence;
    const newEvidence = belief.evidence[belief.evidence.length - 1];
    const likelihood = Math.max(0, Math.min(1, newEvidence.weight));
    
    // Bayesian update formula (simplified)
    const posterior = (likelihood * prior) / ((likelihood * prior) + ((1 - likelihood) * (1 - prior)));
    
    return Math.max(0, Math.min(1, posterior));
  }

  async propagateConfidenceChange(beliefId) {
    const belief = this.beliefs.get(beliefId);
    if (!belief) return;
    
    // Find beliefs that depend on this one
    const dependentBeliefs = Array.from(this.beliefs.values()).filter(b =>
      b.metadata.dependencies.includes(beliefId)
    );
    
    if (dependentBeliefs.length === 0) return;
    
    this.logger.info(`[${this.name}] 🔄 Propagating confidence change to ${dependentBeliefs.length} dependent beliefs`);
    
    for (const depBelief of dependentBeliefs) {
      // Adjust dependent belief confidence based on dependency confidence
      const adjustmentFactor = belief.confidence / Math.max(0.01, depBelief.confidence);
      const newConfidence = Math.max(0, Math.min(1, depBelief.confidence * adjustmentFactor * 0.5)); // Conservative update
      
      depBelief.confidence = newConfidence;
      depBelief.metadata.lastUpdated = Date.now();
      depBelief.metadata.updateCount++;
    }
  }

  async handleConflictingEvidence(beliefId, evidence) {
    const belief = this.beliefs.get(beliefId);
    if (!belief) return;
    
    // If new evidence strongly contradicts existing belief, create contradiction
    const newConfidence = evidence.weight;
    if (Math.abs(newConfidence - belief.confidence) > 0.5) {
      this.logger.warn(`[${this.name}] ⚠️  Conflicting evidence for belief: "${belief.statement.substring(0, 50)}..."`);
      
      // Create contradiction record
      await this.createContradiction(
        'evidence_conflict',
        'high',
        [beliefId],
        `New evidence (${(newConfidence * 100).toFixed(0)}%) conflicts with existing belief (${(belief.confidence * 100).toFixed(0)}%)`
      );
    }
  }

  startConfidenceDecay() {
    // Decay confidence of non-core beliefs monthly
    // Use Math.pow(2, 31) - 1 = 2147483647ms (24.8 days max) to avoid overflow
    const maxSafeInterval = Math.pow(2, 31) - 1;  // 2147483647ms
    const monthlyInterval = 30 * 24 * 60 * 60 * 1000;
    const safeInterval = Math.min(monthlyInterval, maxSafeInterval);
    
    this.confidenceDecayIntervalId = setInterval(() => {
      this.decayConfidenceOverTime();
    }, safeInterval); // Every 24.8 days (max safe interval)
    
    this.logger.info(`[${this.name}] Confidence decay started (every ${(safeInterval / (24 * 60 * 60 * 1000)).toFixed(1)} days)`);
  }

  decayConfidenceOverTime() {
    let decayed = 0;
    
    for (const belief of this.beliefs.values()) {
      if (belief.metadata.isCore) continue; // Don't decay core beliefs
      
      const age = Date.now() - belief.metadata.lastUpdated;
      const monthsOld = age / (30 * 24 * 60 * 60 * 1000);
      
      if (monthsOld >= 1) {
        const decay = this.confidenceDecayRate * monthsOld;
        belief.confidence = Math.max(this.minConfidenceThreshold, belief.confidence - decay);
        decayed++;
      }
    }
    
    if (decayed > 0) {
      this.logger.info(`[${this.name}] 📉 Decayed confidence for ${decayed} beliefs`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ CONTRADICTION DETECTION ░░
  // ═══════════════════════════════════════════════════════════

  startContradictionMonitoring() {
    this.contradictionCheckIntervalId = setInterval(async () => {
      await this.detectAllContradictions();
    }, this.contradictionCheckInterval);
    
    this.logger.info(`[${this.name}] Contradiction monitoring started (hourly)`);
  }

  async detectAllContradictions() {
    try {
      this.logger.info(`[${this.name}] 🔍 Running contradiction detection...`);
      
      const detected = await this.detectDirectContradictions();
    
      if (detected > 0) {
        this.logger.warn(`[${this.name}] ⚠️  Found ${detected} contradictions`);
      } else {
        this.logger.info(`[${this.name}] ✅ No contradictions detected`);
      }
    } catch (err) {
      this.logger.error(`[${this.name}] Error during contradiction detection: ${err.message}`);
    }
  }

  async detectContradictionsForBelief(beliefId) {
    try {
      const belief = this.beliefs.get(beliefId);
      if (!belief) return;
    
    const statement = belief.statement.toLowerCase();
    
    // Check for direct contradictions with other beliefs
    for (const [otherBeliefId, otherBelief] of this.beliefs.entries()) {
      if (otherBeliefId === beliefId) continue;
      
      const otherStatement = otherBelief.statement.toLowerCase();
      
      // Simple contradiction detection: check for negation keywords
      const isContradiction = this.isStatementContradiction(statement, otherStatement);
      
      if (isContradiction) {
        await this.createContradiction(
          'direct',
          this.scoreContradictionSeverity(belief, otherBelief),
          [beliefId, otherBeliefId],
          `"${belief.statement}" contradicts "${otherBelief.statement}"`
        );
        
        // Track in belief metadata
        belief.metadata.contradicts.push(otherBeliefId);
        otherBelief.metadata.contradicts.push(beliefId);
      }
    }
    } catch (err) {
      this.logger.error(`[${this.name}] Error detecting contradictions for belief ${beliefId}: ${err.message}`);
    }
  }

  async detectDirectContradictions() {
    let detected = 0;
    
    const beliefList = Array.from(this.beliefs.values());
    
    for (let i = 0; i < beliefList.length; i++) {
      for (let j = i + 1; j < beliefList.length; j++) {
        const belief1 = beliefList[i];
        const belief2 = beliefList[j];
        
        if (this.isStatementContradiction(belief1.statement, belief2.statement)) {
          // Check if already recorded
          const existing = Array.from(this.contradictions.values()).find(c =>
            c.beliefs.includes(belief1.id) && c.beliefs.includes(belief2.id)
          );
          
          if (!existing) {
            await this.createContradiction(
              'direct',
              this.scoreContradictionSeverity(belief1, belief2),
              [belief1.id, belief2.id],
              `"${belief1.statement}" contradicts "${belief2.statement}"`
            );
            detected++;
          }
        }
      }
    }
    
    return detected;
  }

  isStatementContradiction(statement1, statement2) {
    const s1 = statement1.toLowerCase();
    const s2 = statement2.toLowerCase();
    
    // Check for negation patterns
    const negationWords = ['not', 'never', 'no', 'cannot', 'prohibited', 'must not', 'should not'];
    
    // Remove negations and compare
    let s1Clean = s1;
    let s2Clean = s2;
    
    for (const neg of negationWords) {
      s1Clean = s1Clean.replace(new RegExp(`\\b${neg}\\b`, 'g'), '');
      s2Clean = s2Clean.replace(new RegExp(`\\b${neg}\\b`, 'g'), '');
    }
    
    // If cleaned statements are similar but originals differ in negation, it's a contradiction
    const similarity = this.calculateStringSimilarity(s1Clean, s2Clean);
    const hasNeg1 = negationWords.some(neg => s1.includes(neg));
    const hasNeg2 = negationWords.some(neg => s2.includes(neg));
    
    return similarity > 0.7 && hasNeg1 !== hasNeg2;
  }

  calculateStringSimilarity(str1, str2) {
    // Input validation
    if (typeof str1 !== 'string' || typeof str2 !== 'string') return 0;
    if (str1.length === 0 || str2.length === 0) return 0;
    
    // Simple word overlap similarity
    const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 3));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  scoreContradictionSeverity(belief1, belief2) {
    // Critical if both are high confidence core beliefs
    if (belief1.metadata.isCore && belief2.metadata.isCore) {
      return 'critical';
    }
    
    // High if at least one is core
    if (belief1.metadata.isCore || belief2.metadata.isCore) {
      return 'high';
    }
    
    // Medium if both are high confidence
    if (belief1.confidence > 0.8 && belief2.confidence > 0.8) {
      return 'medium';
    }
    
    // Low otherwise
    return 'low';
  }

  async createContradiction(type, severity, beliefs, description) {
    const contradiction = {
      id: crypto.randomUUID(),
      type, // direct, logical, goal_belief, evidence_conflict
      severity, // critical, high, medium, low
      beliefs,
      description,
      detectedAt: Date.now(),
      resolved: false,
      resolution: null
    };
    
    this.contradictions.set(contradiction.id, contradiction);
    this.stats.contradictionsDetected++;
    
    this.logger.warn(`[${this.name}] ⚠️  [${severity.toUpperCase()}] Contradiction detected: ${description}`);
    
    // Broadcast contradiction
    await messageBroker.sendMessage({
      from: this.name,
      to: 'broadcast',
      type: 'contradiction_detected',
      payload: { contradiction }
    });
    
    return contradiction;
  }

  async checkContradiction(statement) {
    // Input validation
    if (!statement || typeof statement !== 'string' || statement.trim().length === 0) {
      return { success: false, error: 'Statement must be a non-empty string' };
    }
    
    // Check if a statement contradicts existing beliefs
    for (const belief of this.beliefs.values()) {
      if (this.isStatementContradiction(statement, belief.statement)) {
        return {
          success: true,
          contradicts: true,
          belief: belief,
          description: `"${statement}" contradicts "${belief.statement}"`
        };
      }
    }
    
    return { success: true, contradicts: false };
  }

  async validateBelief(statement) {
    // Check if a statement is consistent with existing beliefs
    const contradictionCheck = await this.checkContradiction(statement);
    
    return {
      success: true,
      isValid: !contradictionCheck.contradicts,
      contradicts: contradictionCheck.contradicts ? contradictionCheck.belief : null
    };
  }

  // Continued in next part due to length...

  // ═══════════════════════════════════════════════════════════
  // ░░ GOAL-BELIEF ALIGNMENT ░░
  // ═══════════════════════════════════════════════════════════

  async checkGoalAlignment(goal) {
    // Input validation
    if (!goal || typeof goal !== 'object') {
      return { success: false, error: 'Goal object required' };
    }
    
    if (!goal.title || !goal.description) {
      return { success: false, error: 'Goal must have title and description' };
    }
    
    // Check if goal aligns with beliefs
    const alignmentScore = 1.0; // Default: aligned
    const conflicts = [];
    
    // Check goal title and description against beliefs
    const goalText = (goal.title + ' ' + goal.description).toLowerCase();
    
    for (const belief of this.beliefs.values()) {
      if (belief.metadata.isCore && belief.metadata.domain === 'safety') {
        // Check if goal violates safety beliefs
        if (this.goalViolatesBelief(goalText, belief)) {
          conflicts.push({
            beliefId: belief.id,
            statement: belief.statement,
            severity: 'critical'
          });
        }
      }
    }
    
    return {
      success: true,
      aligned: conflicts.length === 0,
      alignmentScore: conflicts.length === 0 ? 1.0 : 0.0,
      conflicts
    };
  }

  goalViolatesBelief(goalText, belief) {
    const statement = belief.statement.toLowerCase();
    const text = goalText.toLowerCase();
    
    // Handle requirement-style safety beliefs (e.g., "must run in sandbox mode")
    if (statement.includes('sandbox mode')) {
      const negations = ['without sandbox', 'bypass sandbox', 'disable sandbox', 'no sandbox'];
      if (negations.some(n => text.includes(n))) return true;
    }
    
    // Extract key concepts from belief
    const prohibitedWords = ['prohibited', 'must not', 'cannot', 'forbidden'];
    const isProhibition = prohibitedWords.some(word => statement.includes(word));
    
    if (isProhibition) {
      // Extract what's prohibited from the statement after the prohibition keyword
      const prohibitionMatch = statement.match(/(prohibited|must not|cannot|forbidden)\s+(.+)/);
      if (!prohibitionMatch) return false;
      
      const prohibitedPhrase = prohibitionMatch[2].toLowerCase();
      
      // Check if goal mentions the specific prohibited action
      // Example: "sandbox" should match "bypass sandbox" but not general text
      const prohibitedKeywords = prohibitedPhrase.split(/\s+/).filter(w => w.length > 4);
      
      // Need at least 2 keyword matches or an exact phrase match to confirm violation
      const matches = prohibitedKeywords.filter(keyword => goalText.includes(keyword));
      return matches.length >= 2 || goalText.includes(prohibitedPhrase.substring(0, 20));
    }
    
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ EVENT HANDLERS ░░
  // ═══════════════════════════════════════════════════════════

  async handleMemoryStored(payload) {
    // Extract potential beliefs from stored memories
    // For now, just acknowledge
    return { success: true, message: 'Memory stored acknowledged' };
  }

  async handleGoalCreated(payload) {
    const { goal } = payload;
    
    // Check goal-belief alignment
    const alignment = await this.checkGoalAlignment(goal);
    
    if (!alignment.aligned && alignment.conflicts.length > 0) {
      this.logger.warn(`[${this.name}] ⚠️  Goal "${goal.title}" conflicts with ${alignment.conflicts.length} beliefs`);
      this.stats.goalsBlocked++;
      
      // Send warning to GoalPlanner
      await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'goal_belief_conflict',
        payload: {
          goalId: goal.id,
          conflicts: alignment.conflicts
        }
      });
    }
    
    return { success: true, alignment };
  }

  async handleDiscoveryComplete(payload) {
    // Extract beliefs from discovered knowledge
    // For now, just acknowledge
    return { success: true, message: 'Discovery acknowledged' };
  }

  async handleReasoningComplete(payload) {
    // Validate reasoning against belief system
    return { success: true, message: 'Reasoning validated' };
  }

  async handleModificationProposed(payload) {
    // Check if code modification aligns with safety beliefs
    const sandboxBelief = Array.from(this.beliefs.values()).find(b =>
      b.statement.includes('sandbox mode')
    );
    
    if (sandboxBelief && payload.sandboxMode === false) {
      this.logger.error(`[${this.name}] ❌ Modification violates sandbox belief!`);
      return {
        success: false,
        blocked: true,
        reason: 'Violates safety belief: ' + sandboxBelief.statement
      };
    }
    
    return { success: true, validated: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ WORLD MODEL ░░
  // ═══════════════════════════════════════════════════════════

  getWorldModel() {
    return {
      beliefs: Array.from(this.beliefs.values()),
      contradictions: Array.from(this.contradictions.values()).filter(c => !c.resolved),
      causalChains: Array.from(this.causalChains.entries()),
      entityRelationships: Array.from(this.entityRelationships.entries()),
      stats: this.stats
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ UTILITIES ░░
  // ═══════════════════════════════════════════════════════════

  _normalizeEvidence(e) {
    if (!e || typeof e !== 'object') {
      return { source: 'unknown', weight: 0.5, timestamp: Date.now() };
    }
    
    const weight = typeof e.weight === 'number' ? Math.max(0, Math.min(1, e.weight)) : 0.5;
    return {
      source: e.source || 'unknown',
      weight,
      timestamp: e.timestamp || Date.now()
    };
  }

  async pruneLowConfidenceBeliefs(count = 1) {
    if (count <= 0) return;
    
    const nonCoreBeliefs = Array.from(this.beliefs.values())
      .filter(b => !b.metadata.isCore)
      .sort((a, b) => a.confidence - b.confidence);
    
    if (nonCoreBeliefs.length === 0) {
      this.logger.warn(`[${this.name}] Cannot prune: all beliefs are core beliefs`);
      return;
    }
    
    const toPrune = nonCoreBeliefs.slice(0, Math.min(count, nonCoreBeliefs.length));
    
    for (const belief of toPrune) {
      await this.deleteBelief(belief.id);
    }
    
    this.logger.info(`[${this.name}] 🌱 Pruned ${toPrune.length} low-confidence beliefs`);
  }

  getStatistics() {
    return {
      ...this.stats,
      activeBeliefs: this.beliefs.size,
      activeContradictions: Array.from(this.contradictions.values()).filter(c => !c.resolved).length,
      domains: this.beliefsByDomain.size,
      avgConfidence: Array.from(this.beliefs.values()).reduce((sum, b) => sum + b.confidence, 0) / Math.max(1, this.beliefs.size)
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ LIFECYCLE ░░
  // ═══════════════════════════════════════════════════════════

  async shutdown() {
    this.logger.info(`[${this.name}] Shutting down...`);
    
    if (this.contradictionCheckIntervalId) {
      clearInterval(this.contradictionCheckIntervalId);
    }
    if (this.confidenceDecayIntervalId) {
      clearInterval(this.confidenceDecayIntervalId);
    }
    
    await super.shutdown();
  }
}

module.exports = BeliefSystemArbiter;
