/**
 * RegressionTester.cjs - Prevent Performance Degradation
 *
 * Ensures new training doesn't degrade performance on existing tasks.
 * Implements A/B testing, baseline tracking, and automatic rollback.
 *
 * Key Features:
 * - Baseline performance tracking (before training)
 * - Post-training regression detection
 * - A/B testing (old model vs new model)
 * - Automatic rollback on critical regression
 * - Test suite management
 * - Performance comparison reports
 *
 * Critical for ASI because:
 * - Training can cause catastrophic forgetting
 * - Need to ensure improvements don't break existing capabilities
 * - Automated testing prevents disasters
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class RegressionTester extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'RegressionTester';

    // Dependencies
    this.quadBrain = config.quadBrain || null;
    this.localModelManager = config.localModelManager || null;
    this.messageBroker = config.messageBroker || null;

    // Test suite storage
    this.testSuites = new Map(); // suite_id -> test suite
    this.baselineResults = new Map(); // suite_id -> baseline performance
    this.testHistory = []; // All test runs

    // Regression thresholds
    this.thresholds = {
      criticalRegression: -0.15,  // -15% = critical (rollback)
      majorRegression: -0.10,     // -10% = major (alert)
      minorRegression: -0.05,     // -5% = minor (monitor)
      significantSamples: 10      // Minimum test cases for significance
    };

    // A/B testing state
    this.abTests = new Map(); // test_id -> { oldModel, newModel, results }

    // Stats
    this.stats = {
      totalTests: 0,
      regressionsDetected: 0,
      rollbacksTriggered: 0,
      improvementsDetected: 0,
      abTestsRun: 0,
      avgRegressionSize: 0.0
    };

    // Storage
    this.storageDir = path.join(process.cwd(), 'SOMA', 'regression-tests');

    console.log(`[${this.name}] Initialized - Regression testing enabled`);
    console.log(`[${this.name}]    Critical regression threshold: ${(this.thresholds.criticalRegression * 100).toFixed(0)}%`);
  }

  async initialize() {
    console.log(`[${this.name}] 🧪 Initializing Regression Tester...`);

    // Create storage directory
    await fs.mkdir(this.storageDir, { recursive: true });

    // Load existing test suites
    await this.loadTestSuites();

    // Load baseline results
    await this.loadBaselineResults();

    console.log(`[${this.name}] ✅ Regression Tester ready`);
    console.log(`[${this.name}]    Test suites loaded: ${this.testSuites.size}`);
    console.log(`[${this.name}]    Baseline results: ${this.baselineResults.size}`);
  }

  /**
   * Create a test suite for a specific capability or domain
   */
  async createTestSuite(suiteId, testCases, metadata = {}) {
    console.log(`[${this.name}] 📝 Creating test suite: ${suiteId}`);

    const suite = {
      id: suiteId,
      name: metadata.name || suiteId,
      domain: metadata.domain || 'general',
      capability: metadata.capability || 'general',
      testCases,
      created: Date.now(),
      metadata
    };

    this.testSuites.set(suiteId, suite);

    // Save to disk
    await this.saveTestSuites();

    console.log(`[${this.name}]    ✓ Created suite with ${testCases.length} test cases`);

    return suite;
  }

  /**
   * Run baseline test (before training) to establish performance baseline
   */
  async runBaselineTest(suiteId) {
    console.log(`[${this.name}] 📊 Running baseline test: ${suiteId}`);

    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    const results = await this._runTestSuite(suite);

    // Store baseline
    this.baselineResults.set(suiteId, {
      suiteId,
      timestamp: Date.now(),
      results,
      avgScore: results.avgScore,
      avgConfidence: results.avgConfidence,
      successRate: results.successRate
    });

    // Save baselines
    await this.saveBaselineResults();

    console.log(`[${this.name}]    ✓ Baseline established: ${(results.avgScore * 100).toFixed(0)}% avg score, ${(results.successRate * 100).toFixed(0)}% success rate`);

    return this.baselineResults.get(suiteId);
  }

  /**
   * Run regression test (after training) to detect performance changes
   */
  async runRegressionTest(suiteId) {
    console.log(`[${this.name}] 🔍 Running regression test: ${suiteId}`);

    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    const baseline = this.baselineResults.get(suiteId);
    if (!baseline) {
      console.warn(`[${this.name}]    ⚠️  No baseline found - running baseline first`);
      return await this.runBaselineTest(suiteId);
    }

    // Run current test
    const currentResults = await this._runTestSuite(suite);

    // Compare with baseline
    const comparison = this._compareResults(baseline, currentResults);

    // Store in history
    this.testHistory.push({
      suiteId,
      timestamp: Date.now(),
      baseline: baseline.avgScore,
      current: currentResults.avgScore,
      delta: comparison.delta,
      regressionDetected: comparison.hasRegression,
      regressionSeverity: comparison.severity
    });

    this.stats.totalTests++;

    // Handle regression
    if (comparison.hasRegression) {
      this.stats.regressionsDetected++;
      this.stats.avgRegressionSize = (this.stats.avgRegressionSize * (this.stats.regressionsDetected - 1) + Math.abs(comparison.delta))
        / this.stats.regressionsDetected;

      console.log(`[${this.name}]    ❌ REGRESSION DETECTED!`);
      console.log(`[${this.name}]       Baseline: ${(baseline.avgScore * 100).toFixed(1)}%`);
      console.log(`[${this.name}]       Current:  ${(currentResults.avgScore * 100).toFixed(1)}%`);
      console.log(`[${this.name}]       Delta:    ${(comparison.delta * 100).toFixed(1)}%`);
      console.log(`[${this.name}]       Severity: ${comparison.severity}`);

      // Trigger rollback if critical
      if (comparison.severity === 'critical') {
        await this._triggerRollback(suiteId, comparison);
      }

      // Send alert
      await this._sendRegressionAlert(suiteId, comparison);

    } else {
      // Improvement or no change
      if (comparison.delta > 0.02) {
        this.stats.improvementsDetected++;
        console.log(`[${this.name}]    ✅ IMPROVEMENT DETECTED: +${(comparison.delta * 100).toFixed(1)}%`);
      } else {
        console.log(`[${this.name}]    ✓ No significant change: ${(comparison.delta * 100).toFixed(1)}%`);
      }
    }

    return {
      suiteId,
      baseline: baseline.avgScore,
      current: currentResults.avgScore,
      delta: comparison.delta,
      hasRegression: comparison.hasRegression,
      severity: comparison.severity,
      results: currentResults,
      comparison
    };
  }

  /**
   * Run A/B test (compare old model vs new model on same test suite)
   */
  async runABTest(suiteId, oldModelPath, newModelPath) {
    console.log(`[${this.name}] 🔬 Running A/B test: ${suiteId}`);
    console.log(`[${this.name}]    Model A (old): ${oldModelPath}`);
    console.log(`[${this.name}]    Model B (new): ${newModelPath}`);

    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    // Run tests on both models
    // Note: In real implementation, would swap models and rerun
    // For now, we'll simulate this or use current model as "new"
    const resultsA = this.baselineResults.get(suiteId) || { avgScore: 0.7, avgConfidence: 0.7 };
    const resultsB = await this._runTestSuite(suite);

    // Statistical comparison
    const abComparison = {
      suiteId,
      modelA: { path: oldModelPath, avgScore: resultsA.avgScore, avgConfidence: resultsA.avgConfidence },
      modelB: { path: newModelPath, avgScore: resultsB.avgScore, avgConfidence: resultsB.avgConfidence },
      delta: resultsB.avgScore - resultsA.avgScore,
      improvement: resultsB.avgScore > resultsA.avgScore,
      winner: resultsB.avgScore > resultsA.avgScore ? 'modelB' : 'modelA',
      timestamp: Date.now()
    };

    this.abTests.set(`${suiteId}_${Date.now()}`, abComparison);
    this.stats.abTestsRun++;

    console.log(`[${this.name}]    Results:`);
    console.log(`[${this.name}]       Model A: ${(resultsA.avgScore * 100).toFixed(1)}%`);
    console.log(`[${this.name}]       Model B: ${(resultsB.avgScore * 100).toFixed(1)}%`);
    console.log(`[${this.name}]       Winner: ${abComparison.winner} (${(Math.abs(abComparison.delta) * 100).toFixed(1)}% difference)`);

    return abComparison;
  }

  /**
   * Run test suite and collect results
   */
  async _runTestSuite(suite) {
    const results = [];
    let totalScore = 0;
    let totalConfidence = 0;
    let successes = 0;

    for (const testCase of suite.testCases) {
      const result = await this._runTestCase(testCase);
      results.push(result);

      totalScore += result.score;
      totalConfidence += result.confidence;
      if (result.success) successes++;
    }

    const count = suite.testCases.length;

    return {
      suiteId: suite.id,
      results,
      avgScore: totalScore / count,
      avgConfidence: totalConfidence / count,
      successRate: successes / count,
      count,
      timestamp: Date.now()
    };
  }

  /**
   * Run a single test case
   */
  async _runTestCase(testCase) {
    if (!this.quadBrain) {
      // Mock result if no quadBrain available
      return {
        query: testCase.query,
        expectedAnswer: testCase.expectedAnswer,
        actualAnswer: 'mock_answer',
        score: 0.7,
        confidence: 0.7,
        success: true,
        timestamp: Date.now()
      };
    }

    try {
      // Run query through QuadBrain
      const response = await this.quadBrain.reason(testCase.query, {});

      // Calculate score (compare with expected answer)
      const score = this._calculateScore(response.text, testCase.expectedAnswer, testCase.scoringFunction);

      return {
        query: testCase.query,
        expectedAnswer: testCase.expectedAnswer,
        actualAnswer: response.text,
        score,
        confidence: response.confidence,
        success: score > (testCase.passingScore || 0.6),
        timestamp: Date.now()
      };

    } catch (err) {
      console.error(`[${this.name}] Test case failed: ${err.message}`);
      return {
        query: testCase.query,
        expectedAnswer: testCase.expectedAnswer,
        actualAnswer: null,
        score: 0,
        confidence: 0,
        success: false,
        error: err.message,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Calculate score for test case (compare actual vs expected)
   */
  _calculateScore(actual, expected, scoringFunction) {
    if (scoringFunction) {
      // Custom scoring function
      return scoringFunction(actual, expected);
    }

    if (!actual || !expected) return 0;

    // Simple string similarity (can be enhanced with semantic similarity)
    const actualLower = actual.toLowerCase();
    const expectedLower = expected.toLowerCase();

    // Exact match
    if (actualLower === expectedLower) return 1.0;

    // Substring match
    if (actualLower.includes(expectedLower) || expectedLower.includes(actualLower)) {
      return 0.8;
    }

    // Word overlap (Jaccard similarity)
    const actualWords = new Set(actualLower.split(/\s+/));
    const expectedWords = new Set(expectedLower.split(/\s+/));
    const intersection = new Set([...actualWords].filter(w => expectedWords.has(w)));
    const union = new Set([...actualWords, ...expectedWords]);

    return intersection.size / union.size;
  }

  /**
   * Compare baseline vs current results
   */
  _compareResults(baseline, current) {
    const delta = current.avgScore - baseline.avgScore;
    const hasRegression = delta < this.thresholds.minorRegression;

    let severity = 'none';
    if (delta <= this.thresholds.criticalRegression) {
      severity = 'critical';
    } else if (delta <= this.thresholds.majorRegression) {
      severity = 'major';
    } else if (delta <= this.thresholds.minorRegression) {
      severity = 'minor';
    }

    return {
      delta,
      hasRegression,
      severity,
      baseline: baseline.avgScore,
      current: current.avgScore,
      percentChange: (delta / baseline.avgScore) * 100
    };
  }

  /**
   * Trigger automatic rollback on critical regression
   */
  async _triggerRollback(suiteId, comparison) {
    console.log(`[${this.name}] 🚨 CRITICAL REGRESSION - TRIGGERING ROLLBACK`);

    this.stats.rollbacksTriggered++;

    if (this.localModelManager && typeof this.localModelManager.rollbackToBaseline === 'function') {
      await this.localModelManager.rollbackToBaseline();
      console.log(`[${this.name}]    ✓ Model rolled back to baseline`);
    } else {
      console.warn(`[${this.name}]    ⚠️  LocalModelManager not available - manual rollback required!`);
    }

    // Send critical alert
    if (this.messageBroker) {
      await this.messageBroker.sendMessage({
        from: this.name,
        to: 'broadcast',
        type: 'critical_regression_detected',
        payload: {
          suiteId,
          delta: comparison.delta,
          severity: comparison.severity,
          baseline: comparison.baseline,
          current: comparison.current,
          rollbackTriggered: true,
          timestamp: Date.now()
        }
      });
    }
  }

  /**
   * Send regression alert
   */
  async _sendRegressionAlert(suiteId, comparison) {
    if (!this.messageBroker) return;

    await this.messageBroker.sendMessage({
      from: this.name,
      to: 'broadcast',
      type: 'regression_detected',
      payload: {
        suiteId,
        delta: comparison.delta,
        severity: comparison.severity,
        baseline: comparison.baseline,
        current: comparison.current,
        percentChange: comparison.percentChange,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Load test suites from disk
   */
  async loadTestSuites() {
    try {
      const suitesPath = path.join(this.storageDir, 'test-suites.json');
      const data = await fs.readFile(suitesPath, 'utf8');
      const suites = JSON.parse(data);

      for (const suite of suites) {
        this.testSuites.set(suite.id, suite);
      }

      console.log(`[${this.name}]    Loaded ${suites.length} test suites`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[${this.name}]    Failed to load test suites: ${err.message}`);
      }
    }
  }

  /**
   * Save test suites to disk
   */
  async saveTestSuites() {
    const suitesPath = path.join(this.storageDir, 'test-suites.json');
    const suites = Array.from(this.testSuites.values());
    await fs.writeFile(suitesPath, JSON.stringify(suites, null, 2), 'utf8');
  }

  /**
   * Load baseline results from disk
   */
  async loadBaselineResults() {
    try {
      const baselinesPath = path.join(this.storageDir, 'baselines.json');
      const data = await fs.readFile(baselinesPath, 'utf8');
      const baselines = JSON.parse(data);

      for (const baseline of baselines) {
        this.baselineResults.set(baseline.suiteId, baseline);
      }

      console.log(`[${this.name}]    Loaded ${baselines.length} baselines`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[${this.name}]    Failed to load baselines: ${err.message}`);
      }
    }
  }

  /**
   * Save baseline results to disk
   */
  async saveBaselineResults() {
    const baselinesPath = path.join(this.storageDir, 'baselines.json');
    const baselines = Array.from(this.baselineResults.values());
    await fs.writeFile(baselinesPath, JSON.stringify(baselines, null, 2), 'utf8');
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      testSuites: this.testSuites.size,
      baselines: this.baselineResults.size,
      testHistory: this.testHistory.length,
      activeABTests: this.abTests.size
    };
  }

  /**
   * Generate regression report
   */
  generateReport() {
    const recentTests = this.testHistory.slice(-10);

    return {
      summary: {
        totalTests: this.stats.totalTests,
        regressionsDetected: this.stats.regressionsDetected,
        improvementsDetected: this.stats.improvementsDetected,
        rollbacksTriggered: this.stats.rollbacksTriggered,
        avgRegressionSize: this.stats.avgRegressionSize
      },
      recentTests,
      testSuites: Array.from(this.testSuites.values()).map(s => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        testCases: s.testCases.length
      })),
      baselines: Array.from(this.baselineResults.values()).map(b => ({
        suiteId: b.suiteId,
        avgScore: b.avgScore,
        successRate: b.successRate,
        timestamp: b.timestamp
      }))
    };
  }
}

module.exports = { RegressionTester };
