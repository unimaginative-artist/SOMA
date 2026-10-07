// ═══════════════════════════════════════════════════════════
// FILE: asi/evaluation/SolutionEvaluator.cjs
// Evaluates and scores solution quality
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

class SolutionEvaluator {
  constructor(config = {}) {
    this.weights = config.weights || {
      correctness: 0.8,    // Does it work? (CRITICAL)
      efficiency: 0.1,     // Is it fast?
      elegance: 0.05,      // Is it clean/readable?
      completeness: 0.05   // Does it handle edge cases?
    };

    this.sandboxRunner = config.sandboxRunner;
    this.testSuite = config.testSuite;
    this.logger = config.logger || console;
    this.logPath = config.logPath || path.join(__dirname, '../tests/validation-results.json');
  }

  /**
   * Main evaluation entry point
   */
  async evaluate(solution, problem, options = {}) {
    this.logger.debug(`[SolutionEvaluator] Evaluating solution...`);

    const scores = {
      correctness: 0,
      efficiency: 0,
      elegance: 0,
      completeness: 0
    };

    const details = {};

    try {
      // 1. Evaluate correctness (most important)
      if (this.sandboxRunner && this.testSuite) {
        const testResults = await this._evaluateCorrectness(solution, problem);
        scores.correctness = testResults.score;
        details.testResults = testResults;
      } else {
        // Fallback: Static analysis
        scores.correctness = this._staticAnalysis(solution);
      }

      // 2. Evaluate efficiency
      scores.efficiency = this._evaluateEfficiency(solution, details.testResults);

      // 3. Evaluate elegance (code quality)
      scores.elegance = this._evaluateElegance(solution);

      // 4. Evaluate completeness (edge cases, error handling)
      scores.completeness = this._evaluateCompleteness(solution);

      // 5. Calculate weighted score
      const finalScore = Object.entries(scores).reduce((sum, [key, value]) => {
        return sum + (value * this.weights[key]);
      }, 0);

      this.logger.debug(`  Final score: ${finalScore.toFixed(3)}`);
      this.logger.debug(`  Breakdown: ${JSON.stringify(scores)}`);

      const result = {
        score: finalScore,
        scores,
        details,
        timestamp: Date.now()
      };

      // 6. Log result for Operation Mirror (Self-Correction)
      this._logEvaluation(problem, solution, result);

      return result;

    } catch (error) {
      this.logger.error(`[SolutionEvaluator] Evaluation failed: ${error.message}`);
      return {
        score: 0,
        error: error.message,
        scores,
        details
      };
    }
  }

  /**
   * Log evaluation result to file for Operation Mirror analysis
   */
  _logEvaluation(problem, solution, result) {
    if (!this.logPath) return;

    try {
      const problemName = typeof problem === 'string' ? problem.substring(0, 50) : (problem.name || 'Unknown Problem');
      const problemDesc = typeof problem === 'string' ? problem : (problem.description || problem.name);

      const entry = {
        id: `eval_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: problemName,
        description: problemDesc,
        solution: solution,
        evaluation: {
          score: result.score,
          breakdown: result.scores,
          details: result.details
        },
        timestamp: new Date().toISOString()
      };

      // Ensure directory exists
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Read existing or init new
      let data = { results: [] };
      if (fs.existsSync(this.logPath)) {
        try {
          const content = fs.readFileSync(this.logPath, 'utf8');
          data = JSON.parse(content);
        } catch (e) {
          // corrupted file, start fresh
        }
      }

      // Append
      data.results.push(entry);

      // Keep file size manageable (last 1000 entries)
      if (data.results.length > 1000) {
        data.results = data.results.slice(-1000);
      }

      fs.writeFileSync(this.logPath, JSON.stringify(data, null, 2), 'utf8');

    } catch (err) {
      this.logger.warn(`Failed to log evaluation: ${err.message}`);
    }
  }

  /**
   * Evaluate correctness by running tests
   */
  async _evaluateCorrectness(solution, problem) {
    const tests = this.testSuite.getTestsForProblem(problem);

    if (tests.length === 0) {
      this.logger.warn('No tests available for problem');
      return { score: 0.5, reason: 'no_tests' };
    }

    let passed = 0;
    const results = [];

    for (const test of tests) {
      try {
        // Use runTest which handles code wrapping and output capture
        const result = await this.sandboxRunner.runTest(solution, test.input, test.expected);

        if (result.passed) {
          passed++;
        }

        results.push({
          test: test.name,
          input: test.input,
          expected: test.expected,
          actual: result.actual,
          passed: result.passed,
          executionTime: result.executionTime
        });

      } catch (error) {
        results.push({
          test: test.name,
          passed: false,
          error: error.message
        });
      }
    }

    const score = passed / tests.length;

    return {
      score,
      passed,
      total: tests.length,
      results
    };
  }

  /**
   * Static analysis when we can't run code
   */
  _staticAnalysis(solution) {
    // Very basic heuristics
    let score = 0.5; // Start at 50%

    // Has actual code (not just comments)
    const codeLines = solution.split('\n').filter(line =>
      line.trim() && !line.trim().startsWith('//')
    );
    if (codeLines.length > 0) score += 0.1;

    // Has function definition
    if (/function\s+\w+|const\s+\w+\s*=.*=>/.test(solution)) score += 0.1;

    // Has return statement or export
    if (/return\s+|export\s+(default\s+)?/.test(solution)) score += 0.1;

    // Not just a placeholder
    if (!solution.includes('placeholder') && !solution.includes('TODO')) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Evaluate efficiency (time/space complexity)
   */
  _evaluateEfficiency(solution, testResults) {
    if (!testResults || !testResults.results) {
      // Estimate from code analysis
      return this._estimateComplexity(solution);
    }

    // Average execution time across tests
    const times = testResults.results
      .filter(r => r.executionTime)
      .map(r => r.executionTime);

    if (times.length === 0) return 0.5;

    const avgTime = times.reduce((a, b) => a + b) / times.length;

    // Score based on time (lower is better)
    // < 1ms = 1.0, > 1000ms = 0.0
    const timeScore = Math.max(0, 1 - (avgTime / 1000));

    return timeScore;
  }

  /**
   * Estimate complexity from code
   */
  _estimateComplexity(solution) {
    let score = 1.0;

    // Nested loops (bad for efficiency)
    const nestedLoopCount = (solution.match(/for.*\{[^}]*for/gs) || []).length;
    score -= nestedLoopCount * 0.2;

    // Recursive calls
    const recursionCount = (solution.match(/function\s+\w+[^}]*\1\(/g) || []).length;
    if (recursionCount > 0) score -= 0.1; // Recursion can be inefficient

    // Array operations (generally efficient)
    const arrayOps = (solution.match(/\.(map|filter|reduce|forEach)/g) || []).length;
    if (arrayOps > 0) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Evaluate elegance (code quality)
   */
  _evaluateElegance(solution) {
    let score = 0.5;

    // Good practices
    if (solution.includes('const ') || solution.includes('let ')) score += 0.1;
    if (/\/\*\*[\s\S]*?\*\//.test(solution)) score += 0.1; // Has JSDoc
    if (solution.split('\n').some(line => line.trim().startsWith('//'))) score += 0.05; // Has comments

    // Clean structure
    const avgLineLength = solution.split('\n').reduce((sum, line) => sum + line.length, 0) / solution.split('\n').length;
    if (avgLineLength < 80) score += 0.1; // Reasonable line length

    // Not too complex
    const complexity = this._calculateCyclomaticComplexity(solution);
    if (complexity < 10) score += 0.15;

    return Math.min(score, 1.0);
  }

  /**
   * Calculate cyclomatic complexity
   */
  _calculateCyclomaticComplexity(code) {
    // Simple approximation: count decision points
    const decisions = [
      /if\s*\(/g,
      /else\s+if/g,
      /\?\s*[^:]*:/g,  // Ternary
      /for\s*\(/g,
      /while\s*\(/g,
      /case\s+/g,
      /catch\s*\(/g,
      /&&|\|\|/g  // Logical operators
    ];

    let complexity = 1; // Start at 1

    for (const pattern of decisions) {
      const matches = code.match(pattern);
      if (matches) complexity += matches.length;
    }

    return complexity;
  }

  /**
   * Evaluate completeness (edge cases, error handling)
   */
  _evaluateCompleteness(solution) {
    let score = 0.5;

    // Error handling
    if (solution.includes('try') || solution.includes('catch')) score += 0.2;
    if (solution.includes('throw')) score += 0.1;

    // Input validation
    if (/if\s*\(.*null|undefined|!/.test(solution)) score += 0.1;

    // Edge case handling (checks for empty, zero, negative, etc.)
    if (/===\s*0|===\s*null|===\s*undefined|\.length\s*===\s*0/.test(solution)) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Compare actual vs expected output
   */
  _compareOutputs(actual, expected) {
    // Handle different types
    if (typeof actual !== typeof expected) return false;

    // Deep equality for objects/arrays
    if (typeof actual === 'object') {
      return JSON.stringify(actual) === JSON.stringify(expected);
    }

    // Primitive comparison
    return actual === expected;
  }

  /**
   * Get evaluation summary
   */
  getSummary(evaluation) {
    return {
      score: evaluation.score,
      grade: this._getGrade(evaluation.score),
      strengths: this._getStrengths(evaluation.scores),
      weaknesses: this._getWeaknesses(evaluation.scores)
    };
  }

  /**
   * Convert score to letter grade
   */
  _getGrade(score) {
    if (score >= 0.9) return 'A';
    if (score >= 0.8) return 'B';
    if (score >= 0.7) return 'C';
    if (score >= 0.6) return 'D';
    return 'F';
  }

  /**
   * Identify strengths
   */
  _getStrengths(scores) {
    return Object.entries(scores)
      .filter(([_, score]) => score >= 0.8)
      .map(([category, _]) => category);
  }

  /**
   * Identify weaknesses
   */
  _getWeaknesses(scores) {
    return Object.entries(scores)
      .filter(([_, score]) => score < 0.6)
      .map(([category, _]) => category);
  }
}

module.exports = SolutionEvaluator;
