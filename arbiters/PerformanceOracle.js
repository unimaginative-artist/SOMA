/**
 * PerformanceOracle.js - Predictive Performance Optimization
 *
 * The Performance Oracle predicts which brain/fragment will perform best for a given task
 * BEFORE execution. This enables smarter routing, pre-optimization, and adaptive task allocation.
 *
 * Instead of just routing based on keywords (reactive), SOMA can now predict performance
 * based on historical patterns (proactive).
 *
 * Key Capabilities:
 * 1. Performance Prediction: Predict which component will perform best
 * 2. Confidence Estimation: How confident is the prediction
 * 3. Context-Aware Routing: Route based on task context, not just keywords
 * 4. Performance Pattern Learning: Learn what works well when
 * 5. Adaptive Optimization: Optimize routing strategy over time
 * 6. Prediction Accuracy Tracking: Learn from prediction errors
 *
 * Prediction Factors:
 * - Historical performance of component on similar tasks
 * - Component's current state (load, expertise level, recent performance)
 * - Task characteristics (complexity, domain, novelty)
 * - Time of day, user patterns, system load
 * - Cross-component synergies
 *
 * Example Predictions:
 * - "LOGOS brain will perform 85% on this analytical query (confidence: 0.92)"
 * - "medical_fragment better than general LOGOS for this medical query (confidence: 0.88)"
 * - "AURORA creative mode will outperform PROMETHEUS for this task (confidence: 0.76)"
 */

import { EventEmitter } from 'events';

export class PerformanceOracle extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'PerformanceOracle';

    // Dependencies
    this.quadBrain = opts.quadBrain;
    this.fragmentRegistry = opts.fragmentRegistry;
    this.learningPipeline = opts.learningPipeline;
    this.selfModel = opts.selfModel;
    this.messageBroker = opts.messageBroker;

    // Performance history
    this.performanceHistory = new Map(); // componentId -> [performance records]
    this.taskPerformanceMatrix = new Map(); // "taskType:componentId" -> avgPerformance
    this.predictions = new Map(); // predictionId -> prediction record
    this.predictionAccuracy = new Map(); // componentId -> accuracy stats

    // Performance models (learned patterns)
    this.performanceModels = new Map(); // componentId -> performance model
    this.contextualFactors = new Map(); // factor -> weight

    // Prediction cache (avoid re-predicting identical queries)
    this.predictionCache = new Map(); // queryHash -> cached prediction

    // Stats
    this.stats = {
      totalPredictions: 0,
      accuratePredictions: 0,
      inaccuratePredictions: 0,
      avgPredictionAccuracy: 0.0,
      cacheHits: 0,
      cacheMisses: 0,
      optimizationGains: 0.0 // Performance improvement from oracle routing
    };

    // Configuration
    this.config = {
      minHistoryForPrediction: opts.minHistoryForPrediction || 5,
      predictionCacheSize: opts.predictionCacheSize || 1000,
      predictionCacheTTL: opts.predictionCacheTTL || 300000, // 5 minutes
      accuracyThreshold: opts.accuracyThreshold || 0.7
    };

    console.log(`[${this.name}] Initialized - performance prediction enabled`);
  }

  /**
   * Initialize performance oracle
   */
  async initialize() {
    console.log(`[${this.name}] 🔮 Initializing Performance Oracle...`);

    // Build initial performance models from history
    await this.buildPerformanceModels();

    // Subscribe to events
    if (this.messageBroker) {
      this.messageBroker.registerArbiter(this.name, {
          instance: this,
          type: 'performance-oracle',
          capabilities: ['predict_performance', 'learn_patterns', 'adaptive_routing']
      });
      this.messageBroker.subscribe('performance:record', this._handlePerformanceRecord.bind(this));
      this.messageBroker.subscribe('oracle:predict', this._handlePredictionRequest.bind(this));
      console.log(`[${this.name}]    Subscribed to MessageBroker events`);
    }

    // Start periodic model updates
    this.startModelUpdates();

    console.log(`[${this.name}] ✅ Performance Oracle ready`);
    console.log(`[${this.name}]    Prediction models: ${this.performanceModels.size}`);
    console.log(`[${this.name}]    Historical records: ${this.performanceHistory.size}`);
  }

  /**
   * Build performance models from historical data
   */
  async buildPerformanceModels() {
    // Get historical performance data from learning pipeline
    if (!this.learningPipeline || !this.learningPipeline.experienceBuffer) {
      console.log(`[${this.name}]    No historical data available yet`);
      return;
    }

    // Try to sample experiences, but handle case where buffer is empty
    let experiences;
    try {
      experiences = this.learningPipeline.experienceBuffer.sample(1000) || [];
    } catch (error) {
      // Buffer doesn't have enough experiences yet - this is normal on first startup
      console.log(`[${this.name}]    No historical data available yet (buffer empty)`);
      return;
    }

    // Check if experiences is iterable
    if (!Array.isArray(experiences)) {
      console.log(`[${this.name}]    No historical data available yet (empty buffer)`);
      return;
    }

    for (const exp of experiences) {
      if (exp.metadata && exp.metadata.component && exp.reward !== undefined) {
        this.recordPerformance({
          componentId: exp.metadata.component,
          taskType: exp.metadata.taskType || 'unknown',
          context: exp.context || {},
          performance: exp.reward,
          timestamp: exp.timestamp || Date.now()
        });
      }
    }

    // Build models for each component
    for (const [componentId, history] of this.performanceHistory) {
      this.performanceModels.set(componentId, this._buildComponentModel(componentId, history));
    }

    console.log(`[${this.name}]    Built ${this.performanceModels.size} performance models`);
  }

  /**
   * Build performance model for a component
   */
  _buildComponentModel(componentId, history) {
    if (history.length === 0) {
      return {
        avgPerformance: 0.5,
        variance: 0.0,
        sampleSize: 0,
        taskSpecialization: new Map()
      };
    }

    // Calculate average performance
    const performances = history.map(h => h.performance);
    const avg = performances.reduce((sum, p) => sum + p, 0) / performances.length;

    // Calculate variance
    const variance = performances.reduce((sum, p) => sum + (p - avg) ** 2, 0) / performances.length;

    // Task specialization (which task types this component excels at)
    const taskSpecialization = new Map();
    const taskGroups = {};

    for (const record of history) {
      if (!taskGroups[record.taskType]) {
        taskGroups[record.taskType] = [];
      }
      taskGroups[record.taskType].push(record.performance);
    }

    for (const [taskType, perfs] of Object.entries(taskGroups)) {
      const taskAvg = perfs.reduce((sum, p) => sum + p, 0) / perfs.length;
      taskSpecialization.set(taskType, {
        avgPerformance: taskAvg,
        sampleSize: perfs.length,
        relativeStrength: taskAvg - avg // How much better/worse than average
      });
    }

    return {
      avgPerformance: avg,
      variance,
      sampleSize: history.length,
      taskSpecialization,
      recentTrend: this._calculateTrend(history.slice(-10)) // Recent performance trend
    };
  }

  /**
   * Calculate performance trend (improving/declining)
   */
  _calculateTrend(recentHistory) {
    if (recentHistory.length < 3) return 0;

    const performances = recentHistory.map(h => h.performance);
    const n = performances.length;
    const xMean = (n - 1) / 2;
    const yMean = performances.reduce((sum, y) => sum + y, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (performances[i] - yMean);
      denominator += (i - xMean) ** 2;
    }

    return denominator > 0 ? numerator / denominator : 0; // Slope (positive = improving)
  }

  /**
   * Predict performance for a task
   */
  async predict(query, context = {}) {
    this.stats.totalPredictions++;

    // Check cache
    const queryHash = this._hashQuery(query, context);
    const cached = this.predictionCache.get(queryHash);
    if (cached && Date.now() - cached.timestamp < this.config.predictionCacheTTL) {
      this.stats.cacheHits++;
      return cached.prediction;
    }
    this.stats.cacheMisses++;

    // Get available components
    const components = this._getAvailableComponents();

    if (components.length === 0) {
      return {
        predictions: [],
        bestComponent: null,
        confidence: 0.0,
        reason: 'no_components_available'
      };
    }

    // Predict performance for each component
    const predictions = [];

    for (const comp of components) {
      const prediction = this._predictComponentPerformance(comp, query, context);
      predictions.push({
        componentId: comp.id,
        componentName: comp.name,
        componentType: comp.type,
        predictedPerformance: prediction.performance,
        confidence: prediction.confidence,
        factors: prediction.factors
      });
    }

    // Sort by predicted performance
    predictions.sort((a, b) => b.predictedPerformance - a.predictedPerformance);

    const best = predictions[0];
    const result = {
      predictions,
      bestComponent: best,
      alternatives: predictions.slice(1, 3),
      confidence: best.confidence,
      timestamp: Date.now()
    };

    // Cache prediction
    this.predictionCache.set(queryHash, {
      prediction: result,
      timestamp: Date.now()
    });

    // Clean old cache entries
    if (this.predictionCache.size > this.config.predictionCacheSize) {
      const oldestKeys = Array.from(this.predictionCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, this.config.predictionCacheSize / 2)
        .map(([key]) => key);

      oldestKeys.forEach(key => this.predictionCache.delete(key));
    }

    this.emit('prediction:made', result);

    return result;
  }

  /**
   * Predict how well a specific component will perform
   */
  _predictComponentPerformance(component, query, context) {
    const model = this.performanceModels.get(component.id);

    // If no model yet, use neutral prediction
    if (!model || model.sampleSize < this.config.minHistoryForPrediction) {
      return {
        performance: 0.5,
        confidence: 0.3,
        factors: { reason: 'insufficient_history', sampleSize: (model && model.sampleSize) || 0 }
      };
    }

    let predictedPerformance = model.avgPerformance;
    let confidence = 0.7; // Base confidence

    // Factor 1: Task type specialization
    const taskType = context.taskType || this._inferTaskType(query);
    if (model.taskSpecialization.has(taskType)) {
      const spec = model.taskSpecialization.get(taskType);
      predictedPerformance = spec.avgPerformance;
      confidence += spec.sampleSize > 10 ? 0.15 : 0.05;
    }

    // Factor 2: Recent performance trend
    if (model.recentTrend) {
      predictedPerformance += model.recentTrend * 0.1; // Slight adjustment based on trend
      if (model.recentTrend > 0) confidence += 0.05; // More confident if improving
    }

    // Factor 3: Component state (if available from selfModel)
    if (this.selfModel && this.selfModel.components.has(component.id)) {
      const compState = this.selfModel.components.get(component.id);
      if (compState.health === 'unhealthy') {
        predictedPerformance *= 0.7; // Penalize unhealthy components
        confidence *= 0.8;
      }
    }

    // Factor 4: Complexity match
    const complexity = context.complexity || 0.5;
    if (complexity > 0.7 && model.avgPerformance > 0.7) {
      // High-performing components do better on complex tasks
      predictedPerformance *= 1.1;
    } else if (complexity < 0.3 && model.avgPerformance < 0.5) {
      // Even weak components can handle simple tasks
      predictedPerformance *= 1.15;
    }

    // Clamp
    predictedPerformance = Math.max(0, Math.min(1, predictedPerformance));
    confidence = Math.max(0, Math.min(1, confidence));

    return {
      performance: predictedPerformance,
      confidence,
      factors: {
        basePerformance: model.avgPerformance,
        taskSpecialization: model.taskSpecialization.has(taskType),
        recentTrend: model.recentTrend,
        sampleSize: model.sampleSize
      }
    };
  }

  /**
   * Infer task type from query
   */
  _inferTaskType(query) {
    const queryLower = query.toLowerCase();

    const taskPatterns = {
      analytical: ['analyze', 'calculate', 'debug', 'logic', 'reason'],
      creative: ['create', 'imagine', 'design', 'story', 'art'],
      strategic: ['plan', 'strategy', 'goal', 'optimize', 'achieve'],
      safety: ['safe', 'risk', 'dangerous', 'harmful', 'ethical']
    };

    for (const [type, keywords] of Object.entries(taskPatterns)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        return type;
      }
    }

    return 'general';
  }

  /**
   * Get available components for prediction
   */
  _getAvailableComponents() {
    const components = [];

    // QuadBrain brains
    if (this.quadBrain) {
      for (const [brainName, brain] of Object.entries(this.quadBrain.BRAINS)) {
        if (brain.enabled) {
          components.push({
            id: `brain_${brainName}`,
            name: brainName,
            type: 'brain'
          });
        }
      }
    }

    // Fragments
    if (this.fragmentRegistry) {
      const fragments = this.fragmentRegistry.listFragments();
      for (const frag of fragments) {
        components.push({
          id: frag.id,
          name: frag.domain,
          type: 'fragment'
        });
      }
    }

    return components;
  }

  /**
   * Record actual performance (for learning)
   */
  recordPerformance(record) {
    const { componentId, taskType, performance, context = {}, timestamp = Date.now() } = record;

    // Store in history
    if (!this.performanceHistory.has(componentId)) {
      this.performanceHistory.set(componentId, []);
    }

    const history = this.performanceHistory.get(componentId);
    history.push({
      taskType,
      performance,
      context,
      timestamp
    });

    // Keep history size manageable (last 1000 records)
    if (history.length > 1000) {
      history.shift();
    }

    // Update task performance matrix
    const matrixKey = `${taskType}:${componentId}`;
    const existing = this.taskPerformanceMatrix.get(matrixKey) || { sum: 0, count: 0 };
    existing.sum += performance;
    existing.count++;
    existing.avg = existing.sum / existing.count;
    this.taskPerformanceMatrix.set(matrixKey, existing);

    // Rebuild model for this component
    this.performanceModels.set(componentId, this._buildComponentModel(componentId, history));
  }

  /**
   * Validate prediction (check if prediction was accurate)
   */
  validatePrediction(predictionId, actualPerformance) {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) return;

    const error = Math.abs(prediction.predictedPerformance - actualPerformance);
    const accurate = error < 0.2; // Within 20%

    if (accurate) {
      this.stats.accuratePredictions++;
    } else {
      this.stats.inaccuratePredictions++;
    }

    this.stats.avgPredictionAccuracy =
      this.stats.accuratePredictions / (this.stats.accuratePredictions + this.stats.inaccuratePredictions);

    // Update component accuracy tracking
    if (!this.predictionAccuracy.has(prediction.componentId)) {
      this.predictionAccuracy.set(prediction.componentId, { correct: 0, total: 0 });
    }

    const acc = this.predictionAccuracy.get(prediction.componentId);
    acc.total++;
    if (accurate) acc.correct++;
    acc.accuracy = acc.correct / acc.total;
  }

  /**
   * Hash query for caching
   */
  _hashQuery(query, context) {
    return `${query}_${JSON.stringify(context)}`.replace(/\s+/g, '_');
  }

  /**
   * MessageBroker event handlers
   */
  async _handlePerformanceRecord(data) {
    this.recordPerformance(data);
  }

  async _handlePredictionRequest(data) {
    const { query, context } = data;
    const prediction = await this.predict(query, context);

    if (this.messageBroker) {
      this.messageBroker.publish('oracle:prediction', {
        query,
        prediction,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Start periodic model updates
   */
  startModelUpdates() {
    setInterval(() => {
      // Rebuild all models from latest history
      for (const [componentId, history] of this.performanceHistory) {
        this.performanceModels.set(componentId, this._buildComponentModel(componentId, history));
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      modelsBuilt: this.performanceModels.size,
      componentsTracked: this.performanceHistory.size,
      cachedPredictions: this.predictionCache.size,
      predictionAccuracy: this.stats.avgPredictionAccuracy
    };
  }

  /**
   * Get performance insights
   */
  getInsights() {
    const insights = [];

    // Find best performing components
    const componentPerformances = [];
    for (const [componentId, model] of this.performanceModels) {
      if (model.sampleSize >= this.config.minHistoryForPrediction) {
        componentPerformances.push({
          componentId,
          avgPerformance: model.avgPerformance,
          sampleSize: model.sampleSize,
          trend: model.recentTrend
        });
      }
    }

    componentPerformances.sort((a, b) => b.avgPerformance - a.avgPerformance);

    insights.push({
      type: 'top_performers',
      components: componentPerformances.slice(0, 5)
    });

    // Find improving components
    const improving = componentPerformances.filter(c => c.trend > 0.01).slice(0, 3);
    if (improving.length > 0) {
      insights.push({
        type: 'improving_components',
        components: improving
      });
    }

    // Find declining components
    const declining = componentPerformances.filter(c => c.trend < -0.01).slice(0, 3);
    if (declining.length > 0) {
      insights.push({
        type: 'declining_components',
        components: declining
      });
    }

    return insights;
  }
}

export default PerformanceOracle;
