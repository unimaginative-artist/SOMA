// ═══════════════════════════════════════════════════════════
// FILE: core/DreamAuditBroker.js
// Production-grade Dream Audit Communication & Synthesis System
// Connects CognitiveBridge and NighttimeLearningOrchestrator dream audits
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * DreamAuditBroker - Enterprise-grade dream audit coordination system
 *
 * Features:
 * - Cross-system insight sharing between cognitive and learning audits
 * - Temporal correlation analysis
 * - Insight persistence and historical tracking
 * - Event-driven architecture for real-time updates
 * - Automatic conflict resolution and synthesis
 * - Circuit breaker pattern for fault tolerance
 * - Metrics and observability
 */
export class DreamAuditBroker extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = 'DreamAuditBroker';
    this.storagePath = config.storagePath || path.join(process.cwd(), '.soma', 'dream-audits');

    // Registered audit systems
    this.systems = new Map();

    // Audit history
    this.auditHistory = [];
    this.maxHistorySize = config.maxHistorySize || 1000;

    // Synthesis cache
    this.synthesisCache = new Map();
    this.cacheTTL = config.cacheTTL || 3600000; // 1 hour

    // Circuit breaker for fault tolerance
    this.circuitBreaker = {
      failures: 0,
      threshold: config.circuitBreakerThreshold || 5,
      resetTimeout: config.circuitBreakerReset || 60000, // 1 minute
      state: 'closed', // closed, open, half-open
      lastFailure: null
    };

    // Metrics
    this.metrics = {
      totalAudits: 0,
      totalSyntheses: 0,
      crossCorrelations: 0,
      failedAudits: 0,
      avgSynthesisTime: 0,
      lastAuditTime: null,
      systemHealth: 1.0
    };

    // Correlation engine config
    this.correlationConfig = {
      timeWindowMs: config.correlationWindow || 300000, // 5 minutes
      minConfidence: config.minCorrelationConfidence || 0.6,
      enableAutoSynthesis: config.autoSynthesis !== false
    };

    this.initialized = false;
  }

  /**
   * Initialize the broker - create storage, load history
   */
  async initialize() {
    if (this.initialized) return;

    console.log(`[${this.name}] 🌙 Initializing Dream Audit Broker...`);

    try {
      // Ensure storage exists
      await fs.mkdir(this.storagePath, { recursive: true });

      // Load historical audits
      await this._loadHistory();

      // Start cleanup tasks
      this._startMaintenanceTasks();

      this.initialized = true;
      console.log(`[${this.name}] ✅ Dream Audit Broker ready`);
      console.log(`[${this.name}]    Systems: ${this.systems.size}`);
      console.log(`[${this.name}]    History: ${this.auditHistory.length} audits`);

      this.emit('initialized');
    } catch (error) {
      console.error(`[${this.name}] ❌ Initialization failed:`, error);
      throw error;
    }
  }

  /**
   * Register a dream audit system
   */
  registerSystem(systemId, config = {}) {
    if (this.systems.has(systemId)) {
      console.warn(`[${this.name}] ⚠️  System ${systemId} already registered, updating...`);
    }

    this.systems.set(systemId, {
      id: systemId,
      type: config.type || 'unknown', // 'cognitive' or 'learning'
      capabilities: config.capabilities || [],
      registeredAt: Date.now(),
      lastAudit: null,
      auditCount: 0,
      avgConfidence: 0,
      status: 'active'
    });

    console.log(`[${this.name}] 📝 Registered system: ${systemId} (${config.type})`);
    this.emit('system-registered', { systemId, type: config.type });

    return this._getSystemAPI(systemId);
  }

  /**
   * Submit a dream audit from a system
   */
  async submitAudit(systemId, auditData) {
    if (!this.systems.has(systemId)) {
      throw new Error(`System ${systemId} not registered`);
    }

    // Check circuit breaker
    if (this.circuitBreaker.state === 'open') {
      const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailure;
      if (timeSinceFailure < this.circuitBreaker.resetTimeout) {
        console.warn(`[${this.name}] ⚠️  Circuit breaker OPEN, rejecting audit`);
        return { success: false, error: 'Circuit breaker open' };
      }
      // Try to recover
      this.circuitBreaker.state = 'half-open';
      console.log(`[${this.name}] 🔄 Circuit breaker entering HALF-OPEN state`);
    }

    const startTime = Date.now();

    try {
      // Enrich audit with metadata
      const enrichedAudit = {
        id: crypto.randomUUID(),
        systemId,
        systemType: this.systems.get(systemId).type,
        timestamp: Date.now(),
        data: auditData,
        correlations: [],
        syntheses: []
      };

      // Add to history
      this.auditHistory.push(enrichedAudit);
      if (this.auditHistory.length > this.maxHistorySize) {
        this.auditHistory.shift();
      }

      // Update system stats
      const system = this.systems.get(systemId);
      system.lastAudit = enrichedAudit.timestamp;
      system.auditCount++;

      // Update metrics
      this.metrics.totalAudits++;
      this.metrics.lastAuditTime = enrichedAudit.timestamp;

      // Emit event
      this.emit('audit-submitted', enrichedAudit);

      // Look for correlations with recent audits from other systems
      const correlations = await this._findCorrelations(enrichedAudit);
      enrichedAudit.correlations = correlations;

      // Auto-synthesize if enabled and correlations found
      if (this.correlationConfig.enableAutoSynthesis && correlations.length > 0) {
        const synthesis = await this._synthesizeInsights(enrichedAudit, correlations);
        enrichedAudit.syntheses.push(synthesis);
        this.emit('synthesis-created', synthesis);
      }

      // Persist
      await this._persistAudit(enrichedAudit);

      // Circuit breaker recovery
      if (this.circuitBreaker.state === 'half-open') {
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failures = 0;
        console.log(`[${this.name}] ✅ Circuit breaker CLOSED`);
      }

      const duration = Date.now() - startTime;
      this._updateAvgSynthesisTime(duration);

      return {
        success: true,
        auditId: enrichedAudit.id,
        correlations: correlations.length,
        syntheses: enrichedAudit.syntheses.length,
        duration
      };

    } catch (error) {
      console.error(`[${this.name}] ❌ Audit submission failed:`, error);
      this.metrics.failedAudits++;

      // Circuit breaker logic
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailure = Date.now();

      if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
        this.circuitBreaker.state = 'open';
        console.error(`[${this.name}] 🔴 Circuit breaker OPEN after ${this.circuitBreaker.failures} failures`);
        this.emit('circuit-breaker-open');
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * Get synthesis of recent audits across all systems
   */
  async getSynthesis(options = {}) {
    const cacheKey = JSON.stringify(options);

    // Check cache
    if (this.synthesisCache.has(cacheKey)) {
      const cached = this.synthesisCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    const timeWindow = options.timeWindow || 3600000; // 1 hour
    const now = Date.now();
    const recentAudits = this.auditHistory.filter(
      audit => now - audit.timestamp < timeWindow
    );

    if (recentAudits.length === 0) {
      return { insights: [], message: 'No recent audits found' };
    }

    // Group by system type
    const auditsByType = {
      cognitive: recentAudits.filter(a => a.systemType === 'cognitive'),
      learning: recentAudits.filter(a => a.systemType === 'learning'),
      other: recentAudits.filter(a => !['cognitive', 'learning'].includes(a.systemType))
    };

    // Synthesize insights
    const synthesis = {
      timestamp: now,
      timeWindow,
      totalAudits: recentAudits.length,
      auditsByType: {
        cognitive: auditsByType.cognitive.length,
        learning: auditsByType.learning.length,
        other: auditsByType.other.length
      },
      insights: [],
      trends: [],
      recommendations: []
    };

    // Cognitive insights
    if (auditsByType.cognitive.length > 0) {
      const cognitiveInsights = this._analyzeCognitiveAudits(auditsByType.cognitive);
      synthesis.insights.push(...cognitiveInsights);
    }

    // Learning insights
    if (auditsByType.learning.length > 0) {
      const learningInsights = this._analyzeLearningAudits(auditsByType.learning);
      synthesis.insights.push(...learningInsights);
    }

    // Cross-system correlations
    if (auditsByType.cognitive.length > 0 && auditsByType.learning.length > 0) {
      const crossInsights = this._analyzeCrossSystemInsights(
        auditsByType.cognitive,
        auditsByType.learning
      );
      synthesis.insights.push(...crossInsights);
      synthesis.trends = this._detectTrends(recentAudits);
    }

    // Generate recommendations
    synthesis.recommendations = this._generateRecommendations(synthesis);

    // Cache the result
    this.synthesisCache.set(cacheKey, {
      timestamp: now,
      data: synthesis
    });

    this.metrics.totalSyntheses++;

    return synthesis;
  }

  /**
   * Get system-specific API for submitting audits
   */
  _getSystemAPI(systemId) {
    return {
      submitAudit: (data) => this.submitAudit(systemId, data),
      getHistory: (limit = 10) => this._getSystemHistory(systemId, limit),
      getCorrelations: () => this._getSystemCorrelations(systemId),
      getMetrics: () => this._getSystemMetrics(systemId)
    };
  }

  /**
   * Find correlations between audits
   */
  async _findCorrelations(audit) {
    const correlations = [];
    const timeWindow = this.correlationConfig.timeWindowMs;

    // Look for recent audits from OTHER systems
    const recentAudits = this.auditHistory.filter(a =>
      a.systemId !== audit.systemId &&
      Math.abs(a.timestamp - audit.timestamp) < timeWindow
    );

    for (const otherAudit of recentAudits) {
      const confidence = this._calculateCorrelation(audit, otherAudit);

      if (confidence >= this.correlationConfig.minConfidence) {
        correlations.push({
          auditId: otherAudit.id,
          systemId: otherAudit.systemId,
          confidence,
          timeDelta: Math.abs(audit.timestamp - otherAudit.timestamp),
          type: this._classifyCorrelation(audit, otherAudit)
        });

        this.metrics.crossCorrelations++;
      }
    }

    return correlations;
  }

  /**
   * Calculate correlation confidence between two audits
   */
  _calculateCorrelation(audit1, audit2) {
    let confidence = 0.5; // Base confidence

    // Temporal proximity
    const timeDelta = Math.abs(audit1.timestamp - audit2.timestamp);
    const timeScore = Math.max(0, 1 - (timeDelta / this.correlationConfig.timeWindowMs));
    confidence += timeScore * 0.3;

    // Data similarity (basic implementation)
    const data1 = audit1.data;
    const data2 = audit2.data;

    if (data1.changes && data2.changes) {
      // If both have changes, check magnitude similarity
      const changeRatio = Math.min(data1.changes, data2.changes) /
                          Math.max(data1.changes, data2.changes);
      confidence += changeRatio * 0.2;
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Classify the type of correlation
   */
  _classifyCorrelation(audit1, audit2) {
    const timeDelta = Math.abs(audit1.timestamp - audit2.timestamp);

    if (timeDelta < 60000) return 'simultaneous'; // < 1 minute
    if (timeDelta < 300000) return 'cascading'; // < 5 minutes
    return 'related';
  }

  /**
   * Synthesize insights from correlated audits
   */
  async _synthesizeInsights(audit, correlations) {
    const synthesis = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      sourceAudit: audit.id,
      correlatedAudits: correlations.map(c => c.auditId),
      insights: [],
      confidence: 0
    };

    // Analyze patterns across correlated audits
    const allAudits = [
      audit,
      ...this.auditHistory.filter(a =>
        correlations.some(c => c.auditId === a.id)
      )
    ];

    // Pattern: Simultaneous activity across systems
    const simultaneousAudits = correlations.filter(c => c.type === 'simultaneous');
    if (simultaneousAudits.length > 0) {
      synthesis.insights.push({
        type: 'cross-system-activity',
        message: 'Multiple systems are processing insights simultaneously',
        systems: [audit.systemId, ...simultaneousAudits.map(c => c.systemId)],
        confidence: 0.8
      });
    }

    // Pattern: Learning convergence
    const cognitiveAudits = allAudits.filter(a => a.systemType === 'cognitive');
    const learningAudits = allAudits.filter(a => a.systemType === 'learning');

    if (cognitiveAudits.length > 0 && learningAudits.length > 0) {
      synthesis.insights.push({
        type: 'learning-convergence',
        message: 'Cognitive patterns aligning with learning outcomes',
        confidence: 0.75
      });
    }

    // Calculate overall confidence
    synthesis.confidence = synthesis.insights.reduce((sum, i) => sum + i.confidence, 0) /
                          Math.max(1, synthesis.insights.length);

    return synthesis;
  }

  /**
   * Analyze cognitive audit patterns
   */
  _analyzeCognitiveAudits(audits) {
    const insights = [];

    const totalChanges = audits.reduce((sum, a) => sum + (a.data.changes || 0), 0);
    const avgChanges = totalChanges / audits.length;

    insights.push({
      type: 'cognitive-activity',
      metric: 'pattern-evolution',
      value: avgChanges,
      message: `Cognitive system evolved ${totalChanges} patterns across ${audits.length} audits`,
      trend: this._calculateTrend(audits.map(a => a.data.changes || 0))
    });

    return insights;
  }

  /**
   * Analyze learning audit patterns
   */
  _analyzeLearningAudits(audits) {
    const insights = [];

    // Extract confidence scores if available
    const confidenceScores = audits
      .map(a => a.data.confidence)
      .filter(c => c !== undefined);

    if (confidenceScores.length > 0) {
      const avgConfidence = confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;

      insights.push({
        type: 'learning-performance',
        metric: 'confidence',
        value: avgConfidence,
        message: `Learning system maintaining ${(avgConfidence * 100).toFixed(1)}% avg confidence`,
        trend: this._calculateTrend(confidenceScores)
      });
    }

    return insights;
  }

  /**
   * Analyze cross-system insights
   */
  _analyzeCrossSystemInsights(cognitiveAudits, learningAudits) {
    const insights = [];

    // Temporal alignment
    const cogTimes = cognitiveAudits.map(a => a.timestamp);
    const learnTimes = learningAudits.map(a => a.timestamp);

    const avgTimeDelta = this._calculateAvgTimeDelta(cogTimes, learnTimes);

    if (avgTimeDelta < 60000) { // < 1 minute
      insights.push({
        type: 'temporal-alignment',
        message: 'Cognitive and learning systems are highly synchronized',
        timeDelta: avgTimeDelta,
        quality: 'excellent'
      });
    }

    return insights;
  }

  /**
   * Detect trends in audit data
   */
  _detectTrends(audits) {
    const trends = [];

    // Sort by time
    const sorted = [...audits].sort((a, b) => a.timestamp - b.timestamp);

    // Check for increasing activity
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

    if (secondHalf.length > firstHalf.length * 1.5) {
      trends.push({
        type: 'increasing-activity',
        message: 'Dream audit frequency is increasing',
        confidence: 0.8
      });
    }

    return trends;
  }

  /**
   * Generate recommendations based on synthesis
   */
  _generateRecommendations(synthesis) {
    const recommendations = [];

    // Low activity recommendation
    if (synthesis.totalAudits < 5) {
      recommendations.push({
        priority: 'low',
        message: 'Consider increasing dream audit frequency for better pattern detection',
        action: 'adjust-frequency'
      });
    }

    // Imbalanced systems
    const cogCount = synthesis.auditsByType.cognitive;
    const learnCount = synthesis.auditsByType.learning;

    if (cogCount > 0 && learnCount === 0) {
      recommendations.push({
        priority: 'medium',
        message: 'Learning system not contributing to dream audits',
        action: 'check-learning-system'
      });
    } else if (learnCount > 0 && cogCount === 0) {
      recommendations.push({
        priority: 'medium',
        message: 'Cognitive system not contributing to dream audits',
        action: 'check-cognitive-system'
      });
    }

    return recommendations;
  }

  /**
   * Helper: Calculate trend direction
   */
  _calculateTrend(values) {
    if (values.length < 2) return 'stable';

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (secondAvg > firstAvg * 1.1) return 'increasing';
    if (secondAvg < firstAvg * 0.9) return 'decreasing';
    return 'stable';
  }

  /**
   * Helper: Calculate average time delta between two sets of timestamps
   */
  _calculateAvgTimeDelta(times1, times2) {
    if (times1.length === 0 || times2.length === 0) return Infinity;

    let totalDelta = 0;
    let count = 0;

    for (const t1 of times1) {
      for (const t2 of times2) {
        totalDelta += Math.abs(t1 - t2);
        count++;
      }
    }

    return count > 0 ? totalDelta / count : Infinity;
  }

  /**
   * Update average synthesis time metric
   */
  _updateAvgSynthesisTime(duration) {
    const alpha = 0.2; // Exponential moving average factor
    this.metrics.avgSynthesisTime =
      this.metrics.avgSynthesisTime * (1 - alpha) + duration * alpha;
  }

  /**
   * Get system-specific history
   */
  _getSystemHistory(systemId, limit = 10) {
    return this.auditHistory
      .filter(a => a.systemId === systemId)
      .slice(-limit);
  }

  /**
   * Get system-specific correlations
   */
  _getSystemCorrelations(systemId) {
    const systemAudits = this.auditHistory.filter(a => a.systemId === systemId);
    const correlations = systemAudits.flatMap(a => a.correlations);

    return {
      total: correlations.length,
      byType: correlations.reduce((acc, c) => {
        acc[c.type] = (acc[c.type] || 0) + 1;
        return acc;
      }, {}),
      avgConfidence: correlations.length > 0
        ? correlations.reduce((sum, c) => sum + c.confidence, 0) / correlations.length
        : 0
    };
  }

  /**
   * Get system-specific metrics
   */
  _getSystemMetrics(systemId) {
    const system = this.systems.get(systemId);
    if (!system) return null;

    return {
      id: systemId,
      type: system.type,
      auditCount: system.auditCount,
      lastAudit: system.lastAudit,
      status: system.status,
      uptime: Date.now() - system.registeredAt
    };
  }

  /**
   * Persist audit to disk
   */
  async _persistAudit(audit) {
    try {
      const filename = `audit-${audit.id}.json`;
      const filepath = path.join(this.storagePath, filename);
      await fs.writeFile(filepath, JSON.stringify(audit, null, 2), 'utf8');
    } catch (error) {
      console.error(`[${this.name}] ⚠️  Failed to persist audit:`, error.message);
      // Non-critical, don't throw
    }
  }

  /**
   * Load audit history from disk (limited to most recent 50 for fast boot)
   */
  async _loadHistory() {
    try {
      const files = await fs.readdir(this.storagePath);
      const auditFiles = files.filter(f => f.startsWith('audit-') && f.endsWith('.json'));

      // Only load the most recent 50 audits during boot to avoid blocking startup
      const recentFiles = auditFiles.slice(-50);

      for (const file of recentFiles) {
        try {
          const filepath = path.join(this.storagePath, file);
          const data = await fs.readFile(filepath, 'utf8');
          const audit = JSON.parse(data);
          this.auditHistory.push(audit);
        } catch (err) {
          // Skip corrupted files silently
        }
      }

      // Sort by timestamp
      this.auditHistory.sort((a, b) => a.timestamp - b.timestamp);

      // Clean up old files in background (keep only last 200)
      if (auditFiles.length > 200) {
        const toDelete = auditFiles.slice(0, auditFiles.length - 200);
        setImmediate(async () => {
          for (const file of toDelete) {
            try {
              await fs.unlink(path.join(this.storagePath, file));
            } catch (e) { /* ignore */ }
          }
          console.log(`[${this.name}] 🧹 Cleaned up ${toDelete.length} old audit files`);
        });
      }

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`[${this.name}] ⚠️  Failed to load history:`, error.message);
      }
    }
  }

  /**
   * Start maintenance tasks
   */
  _startMaintenanceTasks() {
    // Clean up old cache entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, cached] of this.synthesisCache.entries()) {
        if (now - cached.timestamp > this.cacheTTL) {
          this.synthesisCache.delete(key);
        }
      }
    }, 300000);

    // Update system health every minute
    setInterval(() => {
      this._updateSystemHealth();
    }, 60000);
  }

  /**
   * Update system health metric
   */
  _updateSystemHealth() {
    const totalAudits = this.metrics.totalAudits;
    const failedAudits = this.metrics.failedAudits;

    if (totalAudits === 0) {
      this.metrics.systemHealth = 1.0;
    } else {
      this.metrics.systemHealth = 1.0 - (failedAudits / totalAudits);
    }
  }

  /**
   * Get broker metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      systems: this.systems.size,
      historySize: this.auditHistory.length,
      cacheSize: this.synthesisCache.size,
      circuitBreakerState: this.circuitBreaker.state,
      uptime: this.initialized ? Date.now() - this.metrics.lastAuditTime : 0
    };
  }

  /**
   * Shutdown gracefully
   */
  async shutdown() {
    console.log(`[${this.name}] 🌙 Shutting down Dream Audit Broker...`);

    // Persist any remaining audits
    const unsavedAudits = this.auditHistory.filter(a => !a.persisted);
    for (const audit of unsavedAudits) {
      await this._persistAudit(audit);
    }

    this.emit('shutdown');
    console.log(`[${this.name}] ✅ Shutdown complete`);
  }
}

// Singleton instance
let brokerInstance = null;

export function getDreamAuditBroker(config = {}) {
  if (!brokerInstance) {
    brokerInstance = new DreamAuditBroker(config);
  }
  return brokerInstance;
}

export default DreamAuditBroker;
