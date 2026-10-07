/**
 * RecursiveSelfModel.js - SOMA's Self-Awareness System
 *
 * The Recursive Self-Model enables SOMA to maintain awareness of her own architecture,
 * capabilities, limitations, and internal state. This is critical for ASI development.
 *
 * Self-Awareness Dimensions:
 * 1. Architectural Awareness: Knowledge of all arbiters, fragments, and their connections
 * 2. Capability Mapping: What SOMA can and cannot do
 * 3. Performance Tracking: How well different components are performing
 * 4. Resource Monitoring: CPU, memory, GPU utilization
 * 5. Learning State: What has been learned, what's being learned
 * 6. Confidence Calibration: Knowing when to be uncertain
 * 7. Meta-Cognition: Thinking about thinking
 *
 * Key Features:
 * - Self-inspection: SOMA can query her own capabilities
 * - Performance awareness: Knows which components are working well/poorly
 * - Limitation recognition: Aware of what she doesn't know
 * - Self-debugging: Can identify when she's confused or uncertain
 * - Capability routing: Routes tasks to components she knows are best
 * - Confidence estimation: Estimates her own performance before acting
 *
 * Examples:
 * - "I'm good at code analysis (90% confidence) but weak at image generation (30%)"
 * - "My medical fragment has only handled 5 queries - I should be cautious"
 * - "I'm currently using 45% of available memory - I can handle more load"
 * - "My learning rate is 0.15 - I'm learning moderately fast"
 */

import { EventEmitter } from 'events';
import os from 'os';

export class RecursiveSelfModel extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'RecursiveSelfModel';

    // Dependencies (will be populated during initialization)
    this.system = null; // Reference to entire SOMA system
    this.messageBroker = opts.messageBroker;
    this.learningPipeline = opts.learningPipeline;

    // Self-awareness data structures
    this.components = new Map(); // componentId -> Component metadata
    this.capabilities = new Map(); // capability -> proficiency level (0-1)
    this.limitations = new Map(); // limitation -> severity (0-1)
    this.performanceHistory = new Map(); // componentId -> performance over time
    this.resourceUsage = {
      cpu: 0,
      memory: 0,
      gpu: 0,
      activeTasks: 0
    };

    // Confidence calibration
    this.confidenceHistory = new Map(); // task_type -> [predicted_confidence, actual_performance]
    this.calibrationError = 0.0; // How much SOMA over/under-estimates her abilities

    // Meta-cognitive state
    this.metaCognition = {
      currentFocus: null, // What SOMA is currently thinking about
      uncertaintyLevel: 0.0, // Current level of uncertainty (0-1)
      learningMode: 'balanced', // aggressive, balanced, conservative
      reflectionDepth: 0, // How deeply SOMA is thinking (recursion depth)
      confusionDetected: false
    };

    // Self-model stats
    this.stats = {
      totalComponents: 0,
      healthyComponents: 0,
      unhealthyComponents: 0,
      totalCapabilities: 0,
      knownLimitations: 0,
      avgConfidence: 0.0,
      calibrationAccuracy: 0.0,
      introspectionCount: 0
    };

    // Configuration
    this.config = {
      updateInterval: opts.updateInterval || 5000, // Update self-model every 5s
      healthCheckInterval: opts.healthCheckInterval || 30000, // Health check every 30s
      minConfidenceForAction: opts.minConfidenceForAction || 0.4
    };

    console.log(`[${this.name}] Initialized - SOMA can now be self-aware`);
  }

  /**
   * Initialize the recursive self-model
   */
  async initialize(system) {
    console.log(`[${this.name}] 🪞 Initializing Recursive Self-Model...`);

    // Store reference to entire SOMA system
    this.system = system;

    // Discover and catalog all components
    await this._discoverComponents();

    // Assess initial capabilities
    await this._assessCapabilities();

    // Start monitoring
    this.startSelfMonitoring();

    // Subscribe to system events
    if (this.messageBroker) {
      this.messageBroker.subscribe('self:introspect', this._handleIntrospectionRequest.bind(this));
      this.messageBroker.subscribe('self:health_check', this._handleHealthCheck.bind(this));
      console.log(`[${this.name}]    Subscribed to MessageBroker events`);
    }

    console.log(`[${this.name}] ✅ Self-Model ready`);
    console.log(`[${this.name}]    Components discovered: ${this.components.size}`);
    console.log(`[${this.name}]    Capabilities mapped: ${this.capabilities.size}`);
    console.log(`[${this.name}]    Known limitations: ${this.limitations.size}`);
  }

  /**
   * Discover all components in the SOMA system
   */
  async _discoverComponents() {
    if (!this.system) return;

    const components = [
      { id: 'quadBrain', name: 'QuadBrain', type: 'reasoning', ref: this.system.quadBrain },
      { id: 'fragmentRegistry', name: 'FragmentRegistry', type: 'cognitive', ref: this.system.fragmentRegistry },
      { id: 'fragmentComms', name: 'FragmentCommunicationHub', type: 'communication', ref: this.system.fragmentComms },
      { id: 'metaLearning', name: 'MetaLearningEngine', type: 'learning', ref: this.system.metaLearning },
      { id: 'router', name: 'AdaptiveLearningRouter', type: 'routing', ref: this.system.router },
      { id: 'learningPipeline', name: 'UniversalLearningPipeline', type: 'learning', ref: this.system.learningPipeline },
      { id: 'mnemonic', name: 'MnemonicArbiter', type: 'memory', ref: this.system.mnemonic },
      { id: 'causality', name: 'CausalityArbiter', type: 'reasoning', ref: this.system.causality },
      { id: 'worldModel', name: 'WorldModelArbiter', type: 'simulation', ref: this.system.worldModel },
      { id: 'abstraction', name: 'AbstractionArbiter', type: 'reasoning', ref: this.system.abstraction },
      { id: 'ideaCapture', name: 'IdeaCaptureArbiter', type: 'creative', ref: this.system.ideaCapture },
      { id: 'museEngine', name: 'MuseEngine', type: 'creative', ref: this.system.museEngine }
    ];

    for (const comp of components) {
      if (comp.ref) {
        this.components.set(comp.id, {
          id: comp.id,
          name: comp.name,
          type: comp.type,
          ref: comp.ref,
          health: 'unknown',
          lastHealthCheck: null,
          capabilities: [],
          performanceScore: 0.5 // Initial neutral score
        });
        this.stats.totalComponents++;
      }
    }

    // Discover fragments
    if (this.system.fragmentRegistry) {
      const fragments = this.system.fragmentRegistry.listFragments();
      for (const frag of fragments) {
        this.components.set(frag.id, {
          id: frag.id,
          name: `Fragment:${frag.domain}`,
          type: 'fragment',
          ref: frag,
          health: 'unknown',
          lastHealthCheck: null,
          capabilities: [frag.domain, frag.specialization],
          performanceScore: frag.expertiseLevel || 0.0
        });
      }
    }
  }

  /**
   * Assess SOMA's capabilities
   */
  async _assessCapabilities() {
    // Core reasoning capabilities
    this.capabilities.set('logical_reasoning', 0.8); // QuadBrain LOGOS
    this.capabilities.set('creative_thinking', 0.7); // QuadBrain AURORA
    this.capabilities.set('strategic_planning', 0.6); // QuadBrain PROMETHEUS
    this.capabilities.set('safety_evaluation', 0.9); // QuadBrain THALAMUS

    // Learning capabilities
    this.capabilities.set('experiential_learning', 0.7); // Learning Pipeline
    this.capabilities.set('meta_learning', 0.5); // Meta-Learning Engine (will improve)
    this.capabilities.set('transfer_learning', 0.4); // Abstraction Arbiter

    // Memory capabilities
    this.capabilities.set('short_term_memory', 0.8); // Warm tier
    this.capabilities.set('long_term_memory', 0.9); // Cold tier
    this.capabilities.set('semantic_memory', 0.6); // Vector embeddings

    // Identify gaps (capabilities that should exist but are weak or missing)
    const gaps = [];

    // Check for low proficiency areas (< 0.5)
    for (const [capability, proficiency] of this.capabilities.entries()) {
      if (proficiency < 0.5) {
        gaps.push({
          topic: capability,
          coverage: proficiency * 100,
          priority: 'high',
          reason: `Current proficiency ${(proficiency * 100).toFixed(0)}% - below threshold`
        });
      }
    }

    // Notify GoalPlanner about knowledge gaps for autonomous learning
    if (gaps.length > 0 && this.messageBroker) {
      try {
        await this.messageBroker.sendMessage({
          from: this.name,
          to: 'GoalPlannerArbiter',
          type: 'discovery_complete',
          payload: {
            topic: 'Self-Assessment',
            coverage: this.stats.avgConfidence * 100,
            gaps: gaps.slice(0, 5)  // Top 5 gaps
          }
        });
        console.log(`[${this.name}]    📤 Sent ${gaps.length} capability gaps to GoalPlanner`);
      } catch (err) {
        // Silent fail - don't block initialization
      }
    }

    // Domain-specific capabilities (from fragments)
    if (this.system.fragmentRegistry) {
      const fragments = this.system.fragmentRegistry.listFragments();
      for (const frag of fragments) {
        this.capabilities.set(frag.domain, frag.expertiseLevel);
      }
    }

    // Communication capabilities
    this.capabilities.set('inter_component_communication', 0.9); // MessageBroker
    this.capabilities.set('cross_domain_collaboration', 0.6); // FragmentComms

    this.stats.totalCapabilities = this.capabilities.size;

    // Assess limitations
    this.limitations.set('image_generation', 0.8); // High limitation (not implemented)
    this.limitations.set('audio_processing', 0.9); // Very high limitation
    this.limitations.set('real_time_video', 1.0); // Complete limitation
    this.limitations.set('physical_embodiment', 1.0); // Complete limitation
    this.limitations.set('infinite_memory', 0.7); // Moderate limitation

    this.stats.knownLimitations = this.limitations.size;
  }

  /**
   * Estimate SOMA's confidence for a given task
   */
  estimateConfidence(task, context = {}) {
    this.stats.introspectionCount++;

    const { type, domain, complexity = 0.5, isNovel = false } = context;

    let confidence = 0.5; // Start neutral

    // Check capability match
    if (domain && this.capabilities.has(domain)) {
      const capability = this.capabilities.get(domain);
      confidence = capability * 0.6; // 60% weight to domain expertise
    }

    // Check limitation
    if (domain && this.limitations.has(domain)) {
      const limitation = this.limitations.get(domain);
      confidence *= (1 - limitation * 0.5); // Reduce confidence based on limitation
    }

    // Novelty penalty
    if (isNovel) {
      confidence *= 0.7; // Less confident on novel tasks
    }

    // Complexity adjustment
    confidence *= (1 - complexity * 0.3); // Higher complexity reduces confidence

    // Check component health
    const relevantComponents = this._getRelevantComponents(domain, type);
    if (relevantComponents.length > 0) {
      const avgHealth = relevantComponents
        .filter(c => c.health === 'healthy')
        .length / relevantComponents.length;
      confidence *= avgHealth;
    }

    // Apply calibration correction
    confidence = this._applyCalibration(confidence, domain);

    // Clamp to [0, 1]
    confidence = Math.max(0, Math.min(1, confidence));

    // Update meta-cognition state
    this.metaCognition.uncertaintyLevel = 1 - confidence;
    this.metaCognition.currentFocus = task;

    return {
      confidence,
      factors: {
        domainExpertise: this.capabilities.get(domain) || 0,
        limitation: this.limitations.get(domain) || 0,
        noveltyPenalty: isNovel ? 0.3 : 0,
        complexityPenalty: complexity * 0.3,
        componentHealth: relevantComponents.length > 0 ? relevantComponents.filter(c => c.health === 'healthy').length / relevantComponents.length : 1
      },
      shouldProceed: confidence >= this.config.minConfidenceForAction,
      recommendedApproach: this._recommendApproach(confidence, context)
    };
  }

  /**
   * Get components relevant to a task
   */
  _getRelevantComponents(domain, type) {
    const relevant = [];

    for (const [id, comp] of this.components) {
      // Check if component type matches
      if (type && comp.type === type) {
        relevant.push(comp);
      }

      // Check if component has relevant capability
      if (domain && comp.capabilities && comp.capabilities.includes(domain)) {
        relevant.push(comp);
      }
    }

    return relevant;
  }

  /**
   * Apply confidence calibration based on historical accuracy
   */
  _applyCalibration(rawConfidence, domain) {
    if (!this.confidenceHistory.has(domain)) {
      return rawConfidence; // No history yet
    }

    const history = this.confidenceHistory.get(domain);
    if (history.length === 0) return rawConfidence;

    // Calculate historical calibration error
    const errors = history.map(h => h.predicted - h.actual);
    const avgError = errors.reduce((sum, e) => sum + e, 0) / errors.length;

    // Correct for systematic over/under-confidence
    let calibrated = rawConfidence - avgError;

    return Math.max(0, Math.min(1, calibrated));
  }

  /**
   * Recommend approach based on confidence
   */
  _recommendApproach(confidence, context) {
    if (confidence < 0.3) {
      return {
        action: 'defer_or_seek_help',
        reason: 'Very low confidence - should consult other fragments or refuse'
      };
    } else if (confidence < 0.5) {
      return {
        action: 'proceed_cautiously',
        reason: 'Low confidence - provide answer with strong caveats'
      };
    } else if (confidence < 0.7) {
      return {
        action: 'proceed_normally',
        reason: 'Moderate confidence - normal execution'
      };
    } else {
      return {
        action: 'proceed_confidently',
        reason: 'High confidence - can provide authoritative answer'
      };
    }
  }

  /**
   * Record actual performance to improve calibration
   */
  recordPerformance(task, predictedConfidence, actualPerformance, domain = 'general') {
    if (!this.confidenceHistory.has(domain)) {
      this.confidenceHistory.set(domain, []);
    }

    const history = this.confidenceHistory.get(domain);
    history.push({
      task,
      predicted: predictedConfidence,
      actual: actualPerformance,
      timestamp: Date.now()
    });

    // Keep last 100 records per domain
    if (history.length > 100) {
      history.shift();
    }

    // Update calibration accuracy
    this._updateCalibrationAccuracy();
  }

  /**
   * Update overall calibration accuracy
   */
  _updateCalibrationAccuracy() {
    let totalError = 0;
    let totalCount = 0;

    for (const [domain, history] of this.confidenceHistory) {
      for (const record of history) {
        const error = Math.abs(record.predicted - record.actual);
        totalError += error;
        totalCount++;
      }
    }

    if (totalCount > 0) {
      const avgError = totalError / totalCount;
      this.stats.calibrationAccuracy = 1 - avgError; // Higher = better calibrated
      this.calibrationError = avgError;
    }
  }

  /**
   * Perform health check on all components
   */
  async performHealthCheck() {
    console.log(`[${this.name}] 🏥 Performing system health check...`);

    let healthy = 0;
    let unhealthy = 0;

    for (const [id, comp] of this.components) {
      try {
        // Check if component still exists and is functional
        if (!comp.ref) {
          comp.health = 'unhealthy';
          comp.healthReason = 'Component reference lost';
          unhealthy++;
          continue;
        }

        // Check if component has getStats method
        if (comp.ref.getStats && typeof comp.ref.getStats === 'function') {
          const stats = comp.ref.getStats();
          comp.health = 'healthy';
          comp.lastHealthCheck = Date.now();
          comp.stats = stats;
          healthy++;
        } else {
          comp.health = 'healthy'; // Assume healthy if no stats
          comp.lastHealthCheck = Date.now();
          healthy++;
        }
      } catch (error) {
        comp.health = 'unhealthy';
        comp.healthReason = error.message;
        unhealthy++;
      }
    }

    this.stats.healthyComponents = healthy;
    this.stats.unhealthyComponents = unhealthy;

    console.log(`[${this.name}]    Health check complete: ${healthy} healthy, ${unhealthy} unhealthy`);

    return {
      healthy,
      unhealthy,
      total: this.components.size
    };
  }

  /**
   * Get SOMA's current self-model
   */
  getSelfModel() {
    return {
      identity: {
        name: 'SOMA',
        version: '2.0',
        architecture: 'Fractal Cognitive QuadBrain + Fragments'
      },
      components: Array.from(this.components.values()).map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        health: c.health,
        performanceScore: c.performanceScore,
        capabilities: c.capabilities
      })),
      capabilities: Object.fromEntries(this.capabilities),
      limitations: Object.fromEntries(this.limitations),
      metaCognition: { ...this.metaCognition },
      resourceUsage: { ...this.resourceUsage },
      stats: { ...this.stats }
    };
  }

  /**
   * Introspect: SOMA thinks about herself
   */
  async introspect(query) {
    this.stats.introspectionCount++;
    this.metaCognition.reflectionDepth++;

    console.log(`[${this.name}] 🤔 Introspecting: "${query}"`);

    const responses = {
      'what can you do': this._describeCapabilities(),
      'what are your limitations': this._describeLimitations(),
      'how confident are you': this._describeConfidence(),
      'what are you thinking about': this._describeMetaCognition(),
      'how are you performing': this._describePerformance(),
      'what is your architecture': this._describeArchitecture()
    };

    // Match query to closest introspection type
    const queryLower = query.toLowerCase();
    for (const [key, response] of Object.entries(responses)) {
      if (queryLower.includes(key)) {
        this.metaCognition.reflectionDepth--;
        return response;
      }
    }

    this.metaCognition.reflectionDepth--;
    return {
      answer: 'I am SOMA - a self-organizing memory architecture with recursive self-awareness',
      selfModel: this.getSelfModel()
    };
  }

  _describeCapabilities() {
    const top = Array.from(this.capabilities.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      answer: 'My strongest capabilities are:',
      capabilities: top.map(([cap, level]) => ({
        capability: cap,
        proficiency: `${(level * 100).toFixed(0)}%`
      })),
      totalCapabilities: this.capabilities.size
    };
  }

  _describeLimitations() {
    const top = Array.from(this.limitations.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      answer: 'My most significant limitations are:',
      limitations: top.map(([lim, severity]) => ({
        limitation: lim,
        severity: `${(severity * 100).toFixed(0)}%`
      })),
      totalLimitations: this.limitations.size
    };
  }

  _describeConfidence() {
    return {
      answer: `I have ${(this.stats.calibrationAccuracy * 100).toFixed(0)}% confidence calibration accuracy`,
      avgConfidence: this.stats.avgConfidence,
      calibrationError: this.calibrationError,
      uncertaintyLevel: this.metaCognition.uncertaintyLevel
    };
  }

  _describeMetaCognition() {
    return {
      answer: 'My current mental state:',
      ...this.metaCognition
    };
  }

  _describePerformance() {
    return {
      answer: `${this.stats.healthyComponents} of ${this.stats.totalComponents} components are healthy`,
      healthyComponents: this.stats.healthyComponents,
      unhealthyComponents: this.stats.unhealthyComponents,
      calibrationAccuracy: this.stats.calibrationAccuracy
    };
  }

  _describeArchitecture() {
    return {
      answer: 'I am built with a fractal cognitive architecture:',
      architecture: {
        coreBrains: 4, // LOGOS, AURORA, PROMETHEUS, THALAMUS
        fragments: this.system.fragmentRegistry ? this.system.fragmentRegistry.stats.activeFragments : 0,
        totalComponents: this.components.size,
        communicationHub: 'MessageBroker',
        learningSystem: 'UniversalLearningPipeline + MetaLearning',
        memorySystem: '3-tier (Hot/Warm/Cold)'
      }
    };
  }

  /**
   * Start self-monitoring loop
   */
  startSelfMonitoring() {
    // Update resource usage
    setInterval(() => {
      this.resourceUsage.cpu = os.loadavg()[0];
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      this.resourceUsage.memory = ((totalMem - freeMem) / totalMem) * 100;
      
      // Calculate and broadcast Cognitive KPI
      this.calculateCognitiveKPI();
    }, this.config.updateInterval);

    // Periodic health check
    setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);

    // Periodic capability re-assessment — update scores from actual calibration history
    // instead of keeping the hardcoded bootstrap values forever.
    setInterval(() => {
      this._updateCapabilitiesFromHistory();
    }, 60 * 60 * 1000); // every hour
  }

  /**
   * Update capability scores using actual NEMESIS-fed calibration history.
   * After enough data accumulates, the self-model reflects real performance
   * rather than bootstrap assumptions.
   */
  _updateCapabilitiesFromHistory() {
    let updated = 0;
    for (const [domain, history] of this.confidenceHistory) {
      if (history.length < 3) continue; // Need at least 3 data points
      const avgActual = history.reduce((s, h) => s + h.actual, 0) / history.length;
      const current = this.capabilities.get(domain) || 0.5;
      // Nudge toward observed performance (weighted 70% history, 30% current estimate)
      const updated_score = (avgActual * 0.7) + (current * 0.3);
      this.capabilities.set(domain, Math.max(0.1, Math.min(1.0, updated_score)));
      updated++;
    }
    if (updated > 0) {
      console.log(`[RecursiveSelfModel] Updated ${updated} capability scores from calibration history`);
      // Re-identify gaps and notify GoalPlanner so new learning goals are created
      this._assessCapabilities().catch(() => {});
    }
  }

  /**
   * Calculate Cognitive Velocity Index (CVI)
   * The single metric SOMA optimizes for.
   */
  calculateCognitiveKPI() {
    const learningStats = this.learningPipeline?.getStats?.() || this.learningPipeline?.stats || {};
    const totalInteractions = Number(learningStats.totalInteractions || 0);
    const totalMemories = Number(learningStats.totalMemories || 0);
    const calibrationSamples = [...(this.confidenceHistory?.values?.() || [])]
      .reduce((sum, history) => sum + (Array.isArray(history) ? history.length : 0), 0);
    const planner = this.system?.goalPlanner || null;
    const plannerStats = planner?.getStatistics?.() || planner?.stats || {};
    const completedGoals = Number(plannerStats.goalsCompleted || 0);
    const failedGoals = Number(plannerStats.goalsFailed || 0);
    const terminalGoals = completedGoals + failedGoals;

    const components = {
      learning: {
        available: totalInteractions > 0,
        score: totalInteractions > 0 ? Math.max(0, Math.min(1, totalMemories / totalInteractions)) : null,
        samples: totalInteractions,
        numerator: totalMemories,
        denominator: totalInteractions,
        weight: 0.4
      },
      prediction: {
        available: calibrationSamples > 0 && Number.isFinite(Number(this.stats.calibrationAccuracy)),
        score: calibrationSamples > 0 ? Math.max(0, Math.min(1, Number(this.stats.calibrationAccuracy))) : null,
        samples: calibrationSamples,
        weight: 0.3
      },
      execution: {
        available: terminalGoals > 0,
        score: terminalGoals > 0 ? completedGoals / terminalGoals : null,
        samples: terminalGoals,
        completed: completedGoals,
        failed: failedGoals,
        weight: 0.3
      }
    };
    const available = Object.values(components).filter(component => component.available);
    const availableWeight = available.reduce((sum, component) => sum + component.weight, 0);
    if (availableWeight === 0) {
      return { available: false, cvi: null, components, trend: 'insufficient_evidence', timestamp: Date.now() };
    }
    const cvi = available.reduce((sum, component) => sum + component.score * (component.weight / availableWeight), 0);
    
    // Track history
    if (!this.cviHistory) this.cviHistory = [];
    this.cviHistory.push({ ts: Date.now(), value: cvi });
    if (this.cviHistory.length > 100) this.cviHistory.shift();

    // Broadcast if significant change
    if (!this.lastCVI || Math.abs(this.lastCVI - cvi) > 0.01) {
        this.lastCVI = cvi;
        const previous = this.cviHistory[this.cviHistory.length - 2]?.value;
        const trend = !Number.isFinite(previous) ? 'baseline' : cvi > previous ? 'improving' : cvi < previous ? 'declining' : 'stable';
        
        console.log(`[${this.name}] 🧠 Cognitive Velocity Index: ${(cvi * 100).toFixed(1)} (${trend})`);
        
        if (this.messageBroker) {
            this.messageBroker.publish('self:kpi_update', {
                cvi,
                components,
                trend,
                timestamp: Date.now()
            });
        }
    }
    return { available: true, cvi, components, trend: this.cviHistory.length === 1 ? 'baseline' : (cvi > this.cviHistory[this.cviHistory.length - 2].value ? 'improving' : cvi < this.cviHistory[this.cviHistory.length - 2].value ? 'declining' : 'stable'), timestamp: Date.now() };
  }

  /**
   * MessageBroker event handlers
   */
  async _handleIntrospectionRequest(data) {
    const { query } = data;
    const result = await this.introspect(query);

    if (this.messageBroker) {
      this.messageBroker.publish('self:introspection:response', {
        query,
        result,
        timestamp: Date.now()
      });
    }
  }

  async _handleHealthCheck(data) {
    const result = await this.performHealthCheck();

    if (this.messageBroker) {
      this.messageBroker.publish('self:health_check:response', {
        result,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Visual Proprioception: "See" own mind structure
   */
  async introspectVisually() {
    console.log(`[${this.name}] 👁️ Performing Visual Proprioception...`);
    
    let graphVisual = '';
    
    // Check if KnowledgeGraph is available via direct reference
    if (this.system && this.system.knowledgeGraph) {
        graphVisual = this.system.knowledgeGraph.generateVisualGraph();
    } 
    // Fallback to message broker if available
    else if (this.messageBroker) {
        try {
            const response = await this.messageBroker.sendMessage({
                from: this.name,
                to: 'KnowledgeGraphFusion',
                type: 'knowledge:query', 
                payload: { query: 'generate_visual_graph' }
            });
            if (response && response.visual) {
                graphVisual = response.visual;
            }
        } catch (e) {
            // Fallback or ignore
        }
    }

    const report = {
        success: true, 
        mode: 'visual_proprioception',
        visual: graphVisual,
        timestamp: Date.now()
    };

    this.emit('introspection_complete', report);
    return report;
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

export default RecursiveSelfModel;
