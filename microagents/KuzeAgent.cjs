// KuzeAgent.cjs - Deep Analytical Intelligence
// Ghost in the Shell inspired: Philosophical analyst, pattern recognition specialist
// "The border between self and others is fading... so are the patterns."

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

class KuzeAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'analytical-intelligence' });
    
    this.name = 'Kuze';
    this.personality = 'philosophical-analyst';
    
    // Memory persistence
    this.memoryPath = config.memoryPath || path.join(process.cwd(), 'SOMA', 'kuze_memory.json');
    this.memory = {
      patterns: new Map(),
      risks: new Map(),
      interpretations: new Map(),
      contradictions: new Map()
    };
    
    // Pattern detection thresholds
    this.patternThreshold = config.patternThreshold || 0.7;  // 70% confidence
    this.riskThreshold = config.riskThreshold || 0.6;        // 60% confidence
    
    // Analysis history
    this.analysisHistory = [];
    this.maxHistoryLength = config.maxHistoryLength || 500;
    
    // Statistical tracking
    this.statistics = {
      patternsDetected: 0,
      risksModeled: 0,
      interpretations: 0,
      contradictionsFound: 0,
      averageConfidence: 0
    };
    
    // Load persisted memory
    this._loadMemory().catch(err => {
      this.logger.warn(`[Kuze] Could not load memory: ${err.message}`);
    });
    
    this.logger.info(`[Kuze] 🧠 Analytical core online. "Patterns within patterns..."`);
  }
  
  async initialize() {
    await super.initialize();
    await this._loadMemory();
    this.logger.info('[Kuze] Memory loaded. Ready for deep analysis.');
  }
  
  async execute(task) {
    try {
      // Validate task
      if (!task || typeof task !== 'object') {
        throw new Error('Invalid task: expected non-null object');
      }

      const { type, payload } = task;

      switch (type) {
        case 'pattern-detect':
          return await this.detectPatterns(payload);

        case 'risk-model':
          return await this.modelRisk(payload);

        case 'interpret':
          return await this.interpretEvidence(payload);

        case 'find-contradictions':
          return await this.findContradictions(payload);

        case 'analyze-sequence':
          return await this.analyzeSequence(payload);

        case 'correlate':
          return await this.correlateData(payload);

        case 'get-memory':
          return this.getMemorySnapshot(payload);

        case 'clear-memory':
          return await this.clearMemory(payload);

        default:
          throw new Error(`Unknown task type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`[Kuze] Execute failed: ${error.message}`);
      return { success: false, error: error.message, stack: error.stack };
    }
  }
  
  // ==================== PATTERN DETECTION ====================
  
  async detectPatterns(data) {
    if (!data || !data.events) {
      throw new Error('Pattern detection requires events array');
    }

    if (!Array.isArray(data.events)) {
      throw new Error('Pattern detection requires events to be an array');
    }

    const { events, context } = data;
    const analysis = {
      timestamp: Date.now(),
      eventCount: events.length,
      patterns: [],
      confidence: 0
    };
    
    // Temporal pattern detection
    const temporalPatterns = this.detectTemporalPatterns(events);
    analysis.patterns.push(...temporalPatterns);
    
    // Frequency pattern detection
    const frequencyPatterns = this.detectFrequencyPatterns(events);
    analysis.patterns.push(...frequencyPatterns);
    
    // Sequence pattern detection
    const sequencePatterns = this.detectSequencePatterns(events);
    analysis.patterns.push(...sequencePatterns);
    
    // Anomaly detection
    const anomalies = this.detectAnomalies(events);
    analysis.patterns.push(...anomalies);
    
    // Calculate overall confidence
    if (analysis.patterns.length > 0) {
      analysis.confidence = analysis.patterns.reduce((sum, p) => sum + p.confidence, 0) / analysis.patterns.length;
    }
    
    // Store significant patterns in memory
    for (const pattern of analysis.patterns) {
      if (pattern.confidence >= this.patternThreshold) {
        const patternId = this.generateId('pattern');
        this.memory.patterns.set(patternId, {
          ...pattern,
          id: patternId,
          detectedAt: Date.now(),
          context
        });
        this.statistics.patternsDetected++;
      }
    }
    
    // Persist memory
    await this._saveMemory();
    
    // Add to history
    this.addToHistory('pattern-detection', analysis);
    
    this.emit('patterns-detected', analysis);
    this.logger.info(`[Kuze] Detected ${analysis.patterns.length} patterns (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`);
    
    return { success: true, analysis };
  }
  
  detectTemporalPatterns(events) {
    const patterns = [];
    
    // Sort events by timestamp
    const sorted = events.filter(e => e.timestamp).sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length < 2) return patterns;
    
    // Calculate time deltas
    const deltas = [];
    for (let i = 1; i < sorted.length; i++) {
      deltas.push(sorted[i].timestamp - sorted[i-1].timestamp);
    }
    
    // Detect regular intervals
    const avgDelta = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
    const variance = deltas.reduce((sum, d) => sum + Math.pow(d - avgDelta, 2), 0) / deltas.length;
    const stdDev = Math.sqrt(variance);
    
    // If standard deviation is low relative to mean, it's a regular pattern
    const regularity = 1 - Math.min(stdDev / avgDelta, 1);
    
    if (regularity > 0.6) {
      patterns.push({
        type: 'temporal',
        subtype: 'regular-interval',
        description: `Events occur every ~${this.formatDuration(avgDelta)}`,
        confidence: regularity,
        metadata: { avgDelta, stdDev, regularity }
      });
    }
    
    return patterns;
  }
  
  detectFrequencyPatterns(events) {
    const patterns = [];
    
    // Count event types
    const typeCounts = new Map();
    for (const event of events) {
      const type = event.type || 'unknown';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    
    // Find dominant types (>30% of events)
    const total = events.length;
    for (const [type, count] of typeCounts) {
      const frequency = count / total;
      if (frequency > 0.3) {
        patterns.push({
          type: 'frequency',
          subtype: 'dominant-type',
          description: `Event type '${type}' appears frequently (${(frequency * 100).toFixed(1)}%)`,
          confidence: frequency,
          metadata: { eventType: type, count, frequency }
        });
      }
    }
    
    return patterns;
  }
  
  detectSequencePatterns(events) {
    const patterns = [];
    
    // Look for repeated sequences (length 2-3)
    const sequences = new Map();
    
    for (let len = 2; len <= 3 && len <= events.length; len++) {
      for (let i = 0; i <= events.length - len; i++) {
        const sequence = events.slice(i, i + len).map(e => e.type || 'unknown').join('→');
        sequences.set(sequence, (sequences.get(sequence) || 0) + 1);
      }
    }
    
    // Find sequences that repeat (appear >2 times)
    for (const [sequence, count] of sequences) {
      if (count >= 2) {
        const confidence = Math.min(count / events.length * 2, 1);  // Scale by repetition
        patterns.push({
          type: 'sequence',
          subtype: 'repeated-sequence',
          description: `Sequence '${sequence}' repeats ${count} times`,
          confidence,
          metadata: { sequence, count }
        });
      }
    }
    
    return patterns;
  }
  
  detectAnomalies(events) {
    const patterns = [];
    
    // Statistical outlier detection using timestamps
    const timestamps = events.filter(e => e.timestamp).map(e => e.timestamp);
    if (timestamps.length < 3) return patterns;
    
    const sorted = [...timestamps].sort((a, b) => a - b);
    const deltas = [];
    for (let i = 1; i < sorted.length; i++) {
      deltas.push(sorted[i] - sorted[i-1]);
    }
    
    const avgDelta = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
    const stdDev = Math.sqrt(deltas.reduce((sum, d) => sum + Math.pow(d - avgDelta, 2), 0) / deltas.length);
    
    // Find outliers (>2 standard deviations from mean)
    for (let i = 0; i < deltas.length; i++) {
      const zScore = Math.abs((deltas[i] - avgDelta) / stdDev);
      if (zScore > 2) {
        patterns.push({
          type: 'anomaly',
          subtype: 'temporal-outlier',
          description: `Unusual time gap detected: ${this.formatDuration(deltas[i])} (${zScore.toFixed(1)}σ from mean)`,
          confidence: Math.min(zScore / 3, 1),  // Cap at 3 sigma = 100% confidence
          metadata: { delta: deltas[i], zScore, avgDelta, stdDev }
        });
      }
    }
    
    return patterns;
  }
  
  // ==================== RISK MODELING ====================
  
  async modelRisk(data) {
    if (!data) {
      throw new Error('Risk modeling requires data');
    }
    
    const { factors, historical, context } = data;
    const model = {
      timestamp: Date.now(),
      overallRisk: 0,
      factors: [],
      recommendations: []
    };
    
    // Analyze each risk factor
    if (factors && Array.isArray(factors)) {
      for (const factor of factors) {
        const riskScore = this.calculateRiskScore(factor, historical);
        model.factors.push({
          name: factor.name || 'unknown',
          score: riskScore.score,
          severity: riskScore.severity,
          likelihood: riskScore.likelihood,
          impact: riskScore.impact,
          reasoning: riskScore.reasoning
        });
      }
    }
    
    // Calculate overall risk (weighted average)
    if (model.factors.length > 0) {
      model.overallRisk = model.factors.reduce((sum, f) => sum + f.score * f.impact, 0) / 
                          model.factors.reduce((sum, f) => sum + f.impact, 0);
    }
    
    // Generate recommendations based on risk level
    if (model.overallRisk > 0.7) {
      model.recommendations.push({
        priority: 'high',
        action: 'immediate_mitigation',
        reason: 'Critical risk level detected'
      });
    } else if (model.overallRisk > 0.4) {
      model.recommendations.push({
        priority: 'medium',
        action: 'monitor_closely',
        reason: 'Elevated risk requires attention'
      });
    }
    
    // Store risk model in memory
    const riskId = this.generateId('risk');
    this.memory.risks.set(riskId, {
      ...model,
      id: riskId,
      context
    });
    this.statistics.risksModeled++;
    
    await this._saveMemory();
    this.addToHistory('risk-modeling', model);
    
    this.emit('risk-modeled', model);
    this.logger.info(`[Kuze] Risk model: ${(model.overallRisk * 100).toFixed(1)}% (${model.factors.length} factors)`);
    
    return { success: true, model };
  }
  
  calculateRiskScore(factor, historical) {
    // Basic risk scoring algorithm
    const likelihood = factor.likelihood || 0.5;
    const impact = factor.impact || 0.5;
    const score = (likelihood + impact) / 2;
    
    let severity = 'low';
    if (score > 0.7) severity = 'high';
    else if (score > 0.4) severity = 'medium';
    
    const reasoning = `Likelihood: ${(likelihood * 100).toFixed(0)}%, Impact: ${(impact * 100).toFixed(0)}%`;
    
    return { score, severity, likelihood, impact, reasoning };
  }
  
  // ==================== EVIDENCE INTERPRETATION ====================
  
  async interpretEvidence(data) {
    if (!data || !data.evidence) {
      throw new Error('Interpretation requires evidence array');
    }
    
    const { evidence, hypothesis, context } = data;
    const interpretation = {
      timestamp: Date.now(),
      evidenceCount: evidence.length,
      hypothesis: hypothesis || 'none provided',
      support: 0,
      contradict: 0,
      neutral: 0,
      confidence: 0,
      conclusion: ''
    };
    
    // Analyze each piece of evidence
    const analysis = [];
    for (const item of evidence) {
      const assessment = this.assessEvidence(item, hypothesis);
      analysis.push(assessment);
      
      if (assessment.relation === 'supports') interpretation.support++;
      else if (assessment.relation === 'contradicts') interpretation.contradict++;
      else interpretation.neutral++;
    }
    
    interpretation.analysis = analysis;
    
    // Calculate confidence based on evidence quality and consistency
    const total = interpretation.support + interpretation.contradict + interpretation.neutral;
    if (total > 0) {
      const consistency = Math.max(interpretation.support, interpretation.contradict) / total;
      interpretation.confidence = consistency;
      
      if (interpretation.support > interpretation.contradict) {
        interpretation.conclusion = 'hypothesis supported';
      } else if (interpretation.contradict > interpretation.support) {
        interpretation.conclusion = 'hypothesis contradicted';
      } else {
        interpretation.conclusion = 'inconclusive';
      }
    }
    
    // Store interpretation
    const interpId = this.generateId('interp');
    this.memory.interpretations.set(interpId, {
      ...interpretation,
      id: interpId,
      context
    });
    this.statistics.interpretations++;
    
    await this._saveMemory();
    this.addToHistory('interpretation', interpretation);
    
    this.emit('interpretation-complete', interpretation);
    this.logger.info(`[Kuze] Interpretation: ${interpretation.conclusion} (${interpretation.support}/${interpretation.contradict}/${interpretation.neutral})`);
    
    return { success: true, interpretation };
  }
  
  assessEvidence(evidence, hypothesis) {
    // Simple heuristic assessment
    const weight = evidence.weight || 0.5;
    const reliability = evidence.reliability || 0.7;
    
    // Determine relation (simplified - in reality would need NLP or explicit tagging)
    let relation = 'neutral';
    if (evidence.supportsHypothesis !== undefined) {
      relation = evidence.supportsHypothesis ? 'supports' : 'contradicts';
    }
    
    return {
      id: evidence.id || this.generateId('evidence'),
      relation,
      weight,
      reliability,
      strength: weight * reliability
    };
  }
  
  // ==================== CONTRADICTION DETECTION ====================
  
  async findContradictions(data) {
    if (!data || !data.statements) {
      throw new Error('Contradiction detection requires statements array');
    }
    
    const { statements, context } = data;
    const result = {
      timestamp: Date.now(),
      statementCount: statements.length,
      contradictions: [],
      consistency: 1.0
    };
    
    // Compare all pairs of statements
    for (let i = 0; i < statements.length; i++) {
      for (let j = i + 1; j < statements.length; j++) {
        const contradiction = this.detectContradiction(statements[i], statements[j]);
        if (contradiction) {
          result.contradictions.push({
            statement1: statements[i],
            statement2: statements[j],
            type: contradiction.type,
            severity: contradiction.severity,
            explanation: contradiction.explanation
          });
        }
      }
    }
    
    // Calculate consistency score
    if (statements.length > 1) {
      const maxPairs = (statements.length * (statements.length - 1)) / 2;
      result.consistency = 1 - (result.contradictions.length / maxPairs);
    }
    
    // Store contradictions
    if (result.contradictions.length > 0) {
      const contId = this.generateId('contradiction');
      this.memory.contradictions.set(contId, {
        ...result,
        id: contId,
        context
      });
      this.statistics.contradictionsFound += result.contradictions.length;
    }
    
    await this._saveMemory();
    this.addToHistory('contradiction-detection', result);
    
    this.emit('contradictions-found', result);
    this.logger.info(`[Kuze] Found ${result.contradictions.length} contradictions (consistency: ${(result.consistency * 100).toFixed(1)}%)`);
    
    return { success: true, result };
  }
  
  detectContradiction(stmt1, stmt2) {
    // Simplified contradiction detection
    // In reality, would need semantic analysis
    
    // Check for explicit contradiction markers
    if (stmt1.contradicts && stmt1.contradicts.includes(stmt2.id)) {
      return {
        type: 'explicit',
        severity: 'high',
        explanation: 'Statements are explicitly marked as contradictory'
      };
    }
    
    // Check for value conflicts
    if (stmt1.subject === stmt2.subject && stmt1.value !== undefined && stmt2.value !== undefined) {
      if (stmt1.value !== stmt2.value) {
        return {
          type: 'value-conflict',
          severity: 'medium',
          explanation: `Conflicting values for '${stmt1.subject}': ${stmt1.value} vs ${stmt2.value}`
        };
      }
    }
    
    return null;
  }
  
  // ==================== SEQUENCE ANALYSIS ====================
  
  async analyzeSequence(data) {
    if (!data || !data.sequence) {
      throw new Error('Sequence analysis requires sequence array');
    }
    
    const { sequence, context } = data;
    const analysis = {
      timestamp: Date.now(),
      length: sequence.length,
      trends: [],
      predictions: [],
      confidence: 0
    };
    
    // Detect trends
    if (sequence.length >= 3) {
      const trend = this.detectTrend(sequence);
      if (trend) {
        analysis.trends.push(trend);
        
        // Make predictions based on trend
        if (trend.type === 'linear') {
          const nextValue = sequence[sequence.length - 1] + trend.slope;
          analysis.predictions.push({
            type: 'next-value',
            value: nextValue,
            confidence: trend.confidence
          });
        }
      }
    }
    
    // Calculate overall confidence
    if (analysis.trends.length > 0) {
      analysis.confidence = analysis.trends.reduce((sum, t) => sum + t.confidence, 0) / analysis.trends.length;
    }
    
    this.addToHistory('sequence-analysis', analysis);
    this.emit('sequence-analyzed', analysis);
    
    return { success: true, analysis };
  }
  
  detectTrend(sequence) {
    // Simple linear regression
    const n = sequence.length;
    const xSum = (n * (n - 1)) / 2;
    const ySum = sequence.reduce((sum, val) => sum + val, 0);
    const xySum = sequence.reduce((sum, val, idx) => sum + idx * val, 0);
    const x2Sum = (n * (n - 1) * (2 * n - 1)) / 6;
    
    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum);
    const intercept = (ySum - slope * xSum) / n;
    
    // Calculate R² for confidence
    const yMean = ySum / n;
    const ssTotal = sequence.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0);
    const ssRes = sequence.reduce((sum, val, idx) => sum + Math.pow(val - (slope * idx + intercept), 2), 0);
    const rSquared = 1 - (ssRes / ssTotal);
    
    const direction = slope > 0.01 ? 'increasing' : slope < -0.01 ? 'decreasing' : 'stable';
    
    return {
      type: 'linear',
      direction,
      slope,
      intercept,
      confidence: Math.max(0, rSquared),  // R² as confidence
      description: `${direction} trend with slope ${slope.toFixed(3)}`
    };
  }
  
  // ==================== DATA CORRELATION ====================
  
  async correlateData(data) {
    if (!data || !data.datasets || data.datasets.length < 2) {
      throw new Error('Correlation requires at least 2 datasets');
    }
    
    const { datasets, context } = data;
    const result = {
      timestamp: Date.now(),
      correlations: []
    };
    
    // Compare all pairs
    for (let i = 0; i < datasets.length; i++) {
      for (let j = i + 1; j < datasets.length; j++) {
        const correlation = this.calculateCorrelation(datasets[i].values, datasets[j].values);
        result.correlations.push({
          dataset1: datasets[i].name || `Dataset ${i}`,
          dataset2: datasets[j].name || `Dataset ${j}`,
          coefficient: correlation.coefficient,
          strength: correlation.strength,
          direction: correlation.direction
        });
      }
    }
    
    this.addToHistory('correlation', result);
    this.emit('correlation-complete', result);
    
    return { success: true, result };
  }
  
  calculateCorrelation(arr1, arr2) {
    const n = Math.min(arr1.length, arr2.length);
    if (n === 0) return { coefficient: 0, strength: 'none', direction: 'none' };
    
    const mean1 = arr1.slice(0, n).reduce((sum, val) => sum + val, 0) / n;
    const mean2 = arr2.slice(0, n).reduce((sum, val) => sum + val, 0) / n;
    
    let numerator = 0;
    let denom1 = 0;
    let denom2 = 0;
    
    for (let i = 0; i < n; i++) {
      const diff1 = arr1[i] - mean1;
      const diff2 = arr2[i] - mean2;
      numerator += diff1 * diff2;
      denom1 += diff1 * diff1;
      denom2 += diff2 * diff2;
    }
    
    const coefficient = numerator / Math.sqrt(denom1 * denom2);
    const absCoeff = Math.abs(coefficient);
    
    let strength = 'none';
    if (absCoeff > 0.7) strength = 'strong';
    else if (absCoeff > 0.4) strength = 'moderate';
    else if (absCoeff > 0.2) strength = 'weak';
    
    const direction = coefficient > 0 ? 'positive' : coefficient < 0 ? 'negative' : 'none';
    
    return { coefficient, strength, direction };
  }
  
  // ==================== MEMORY MANAGEMENT ====================
  
  async _loadMemory() {
    try {
      const data = await fs.readFile(this.memoryPath, 'utf8');
      const parsed = JSON.parse(data);
      
      this.memory.patterns = new Map(parsed.patterns || []);
      this.memory.risks = new Map(parsed.risks || []);
      this.memory.interpretations = new Map(parsed.interpretations || []);
      this.memory.contradictions = new Map(parsed.contradictions || []);
      
      this.logger.info(`[Kuze] Memory loaded: ${this.memory.patterns.size} patterns, ${this.memory.risks.size} risks`);
    } catch (err) {
      // Memory file doesn't exist yet - that's fine
      this.logger.info('[Kuze] Starting with fresh memory');
    }
  }
  
  async _saveMemory() {
    try {
      const data = {
        patterns: Array.from(this.memory.patterns.entries()),
        risks: Array.from(this.memory.risks.entries()),
        interpretations: Array.from(this.memory.interpretations.entries()),
        contradictions: Array.from(this.memory.contradictions.entries()),
        savedAt: Date.now()
      };
      
      await fs.mkdir(path.dirname(this.memoryPath), { recursive: true });
      await fs.writeFile(this.memoryPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      this.logger.error(`[Kuze] Failed to save memory: ${err.message}`);
    }
  }
  
  getMemorySnapshot(options = {}) {
    const type = options.type;
    
    if (type) {
      return {
        success: true,
        type,
        entries: Array.from(this.memory[type] || [])
      };
    }
    
    return {
      success: true,
      memory: {
        patterns: Array.from(this.memory.patterns.entries()),
        risks: Array.from(this.memory.risks.entries()),
        interpretations: Array.from(this.memory.interpretations.entries()),
        contradictions: Array.from(this.memory.contradictions.entries())
      },
      statistics: this.statistics
    };
  }
  
  async clearMemory(options = {}) {
    const type = options.type;
    
    if (type && this.memory[type]) {
      const size = this.memory[type].size;
      this.memory[type].clear();
      await this._saveMemory();
      return { success: true, cleared: type, count: size };
    }
    
    // Clear all
    const counts = {
      patterns: this.memory.patterns.size,
      risks: this.memory.risks.size,
      interpretations: this.memory.interpretations.size,
      contradictions: this.memory.contradictions.size
    };
    
    this.memory.patterns.clear();
    this.memory.risks.clear();
    this.memory.interpretations.clear();
    this.memory.contradictions.clear();
    
    await this._saveMemory();
    return { success: true, cleared: 'all', counts };
  }
  
  // ==================== UTILITIES ====================
  
  addToHistory(type, data) {
    this.analysisHistory.push({ type, data, timestamp: Date.now() });
    if (this.analysisHistory.length > this.maxHistoryLength) {
      this.analysisHistory.shift();
    }
    
    // Update rolling average confidence
    if (data.confidence !== undefined) {
      const total = this.statistics.patternsDetected + this.statistics.risksModeled + this.statistics.interpretations;
      if (total > 0) {
        this.statistics.averageConfidence = 
          (this.statistics.averageConfidence * (total - 1) + data.confidence) / total;
      }
    }
  }
  
  generateId(prefix) {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  }
  
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }
  
  async terminate(reason = 'manual') {
    await this._saveMemory();
    return super.terminate(reason);
  }
  
  getStatus() {
    const baseStatus = super.getStatus();
    return {
      ...baseStatus,
      statistics: this.statistics,
      memorySize: {
        patterns: this.memory.patterns.size,
        risks: this.memory.risks.size,
        interpretations: this.memory.interpretations.size,
        contradictions: this.memory.contradictions.size
      },
      historySize: this.analysisHistory.length
    };
  }
}

module.exports = KuzeAgent;
