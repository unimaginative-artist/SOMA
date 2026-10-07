// ═══════════════════════════════════════════════════════════
// FILE: asi/core/DivergentGenerator.cjs
// Force cognitive diversity by explicitly requiring different paradigms
// ═══════════════════════════════════════════════════════════

const { parseStructured, ApproachesSchema } = require('./StructuredOutput.cjs');

/**
 * DivergentGenerator - Forces LLM to generate truly different solution approaches
 *
 * Key Innovation: Instead of letting LLM homogenize solutions, we FORCE diversity
 * by explicitly specifying paradigms (recursive, iterative, functional, etc.)
 *
 * This addresses the core bottleneck: weak LLMs generating similar solutions
 * across all tree branches. By forcing paradigms, we get diversity even from llama3.2.
 */
class DivergentGenerator {
  constructor(config = {}) {
    this.llm = config.llm;
    this.logger = config.logger || console;

    // Core paradigms that force different thinking styles
    this.paradigms = config.paradigms || [
      'recursive',      // Break into smaller subproblems
      'iterative',      // Loop-based solution
      'functional',     // Map/reduce/filter patterns
      'mathematical',   // Mathematical transform or formula
      'memoization',    // Cache intermediate results
      'heuristic'       // Domain-specific optimization
    ];

    // PRODUCTION: Circuit breaker for API failures
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: 0,
      state: 'closed', // closed, open, half-open
      threshold: config.circuitBreakerThreshold || 5,
      timeout: config.circuitBreakerTimeout || 60000, // 1 min
      halfOpenAttempts: 0
    };

    // PRODUCTION: Metrics tracking
    this.metrics = {
      totalGenerations: 0,
      successfulGenerations: 0,
      failedGenerations: 0,
      totalParseTime: 0,
      averageQualityScore: 0
    };

    this.maxVariants = config.maxVariants || 6;
    this.diversityPrompt = config.diversityPrompt !== false; // Default true
  }

  /**
   * Build a prompt that FORCES a specific paradigm
   */
  _buildParadigmPrompt(problem, paradigm, existingApproaches = []) {
    const signature = problem.signature || 'function solution(input)';
    const description = problem.description || problem.name || 'Solve the problem';

    // Explicitly forbid copying existing approaches
    const existingNote = existingApproaches.length > 0
      ? `\n\n⚠️ IMPORTANT: Do NOT repeat these existing approaches:\n${existingApproaches.map((a, i) => `${i+1}. ${a.name} - ${a.strategy}`).join('\n')}\n\nYou MUST generate a FUNDAMENTALLY DIFFERENT approach.`
      : '';

    const paradigmInstructions = {
      recursive: 'Use RECURSIVE approach: break the problem into smaller subproblems and call the function on itself.',
      iterative: 'Use ITERATIVE approach: solve with loops (for/while) and accumulation, NO recursion.',
      functional: 'Use FUNCTIONAL approach: use map(), reduce(), filter(), or other functional patterns.',
      mathematical: 'Use MATHEMATICAL approach: find a formula, transform, or mathematical insight that avoids direct computation.',
      memoization: 'Use MEMOIZATION/CACHING approach: cache intermediate results to avoid recomputation.',
      heuristic: 'Use HEURISTIC approach: domain-specific tricks, optimizations, or shortcuts specific to this problem.'
    };

    const instruction = paradigmInstructions[paradigm] || `Use ${paradigm} approach`;

    return `Generate a coding approach for this problem using ONLY the ${paradigm.toUpperCase()} paradigm.

Problem: ${description}
Signature: ${signature}

${instruction}

${existingNote}

Return ONLY valid JSON in this exact format:
[
  {
    "name": "Brief descriptive name (include paradigm)",
    "strategy": "High-level strategy using ${paradigm} approach",
    "steps": ["Step 1", "Step 2", "Step 3"],
    "strengths": "Why ${paradigm} is good here",
    "weaknesses": "Potential drawbacks of ${paradigm}"
  }
]

IMPORTANT GUIDELINES:
- If any required field is missing, infer and fill it rather than omitting it
- Steps must be a flat array of strings. If unsure, produce at least 3 steps
- Each step should be a single string, not nested arrays or objects
- Strategy should be at least one sentence describing the high-level approach

Example for "reverse a string" using ITERATIVE paradigm:
[
  {
    "name": "Two-pointer iterative swap",
    "strategy": "Use two pointers from start and end, swap characters iteratively",
    "steps": ["Initialize pointers at 0 and n-1", "Swap characters", "Move pointers inward", "Continue until pointers meet"],
    "strengths": "In-place, O(1) space, simple loop",
    "weaknesses": "Requires mutable string/array"
  }
]

Now generate ONE approach for: ${description}
Using ONLY the ${paradigm.toUpperCase()} paradigm.
Return ONLY the JSON array, nothing else:`;
  }

  /**
   * Generate N divergent approaches by forcing different paradigms
   *
   * @param {Object} problem - Problem specification
   * @param {number} count - Number of approaches to generate
   * @param {Array} existingApproaches - Approaches to avoid duplicating
   * @param {Object} options - Temperature, etc.
   * @returns {Promise<Array>} - Array of approach objects
   */
  /**
   * PRODUCTION: Check circuit breaker state before API calls
   */
  _checkCircuitBreaker() {
    const cb = this.circuitBreaker;
    const now = Date.now();

    if (cb.state === 'open') {
      // Check if timeout has elapsed
      if (now - cb.lastFailureTime >= cb.timeout) {
        cb.state = 'half-open';
        cb.halfOpenAttempts = 0;
        this.logger.info('[DivergentGenerator] Circuit breaker: OPEN → HALF-OPEN (timeout elapsed)');
      } else {
        const waitTime = Math.ceil((cb.timeout - (now - cb.lastFailureTime)) / 1000);
        throw new Error(`Circuit breaker OPEN. Wait ${waitTime}s before retry.`);
      }
    }
  }

  /**
   * PRODUCTION: Record API failure for circuit breaker
   */
  _recordFailure() {
    const cb = this.circuitBreaker;
    cb.failures++;
    cb.lastFailureTime = Date.now();

    if (cb.state === 'half-open') {
      // Failed during half-open, trip breaker again
      cb.state = 'open';
      this.logger.warn('[DivergentGenerator] Circuit breaker: HALF-OPEN → OPEN (failure during test)');
    } else if (cb.failures >= cb.threshold) {
      cb.state = 'open';
      this.logger.error(`[DivergentGenerator] Circuit breaker TRIPPED (${cb.failures} failures)`);
    }

    this.metrics.failedGenerations++;
  }

  /**
   * PRODUCTION: Record API success for circuit breaker
   */
  _recordSuccess() {
    const cb = this.circuitBreaker;

    if (cb.state === 'half-open') {
      cb.halfOpenAttempts++;
      if (cb.halfOpenAttempts >= 3) {
        // Successful test, close breaker
        cb.state = 'closed';
        cb.failures = 0;
        this.logger.info('[DivergentGenerator] Circuit breaker: HALF-OPEN → CLOSED (recovered)');
      }
    } else if (cb.state === 'closed') {
      // Gradually reduce failure count on success
      cb.failures = Math.max(0, cb.failures - 1);
    }

    this.metrics.successfulGenerations++;
  }

  async generate(problem, count = 6, existingApproaches = [], options = {}) {
    const startTime = Date.now();
    const temperature = options.temperature || 0.7;
    this.metrics.totalGenerations++;

    try {
      // PRODUCTION: Check circuit breaker before expensive API calls
      this._checkCircuitBreaker();

      // Select paradigms to enforce (cycle through list)
      const selectedParadigms = [];
      for (let i = 0; i < count; i++) {
        selectedParadigms.push(this.paradigms[i % this.paradigms.length]);
      }

      this.logger.info(`🎨 Generating ${count} divergent approaches across paradigms: ${selectedParadigms.join(', ')}`);

      // Generate approaches in parallel (one per paradigm)
      // PRODUCTION: Use Promise.allSettled instead of Promise.all to handle partial failures
      const settled = await Promise.allSettled(
        selectedParadigms.map(async (paradigm, idx) => {
          try {
          const prompt = this._buildParadigmPrompt(problem, paradigm, existingApproaches);

          const response = await this.llm.generate(prompt, {
            temperature,
            maxTokens: 800,
            role: 'strategic' // Divergent approaches require strategic thinking
          });

          // Parse with structured output system
          const parsed = parseStructured(response, ApproachesSchema, {
            repair: true,
            fallback: []
          });

          // IMMUNE SYSTEM: Accept all approaches with scores (don't reject!)
          if (!parsed.success || !parsed.data || parsed.data.length === 0) {
            this.logger.warn(`⚠️ No data from ${paradigm} parser, using minimal fallback`);
            return {
              name: `${paradigm} approach (minimal)`,
              strategy: `Use ${paradigm} method to solve the problem`,
              steps: ['Analyze problem', 'Implement solution', 'Test solution'],
              strengths: 'Standard approach',
              weaknesses: 'May not be optimal',
              paradigm,
              _validityScore: 0.3,
              _fallback: true
            };
          }

          // Take first approach and tag with paradigm
          const approach = parsed.data[0];
          approach.paradigm = paradigm;
          approach._repaired = parsed.repaired || false;

          // Log quality score
          if (approach._validityScore < 0.6) {
            this.logger.info(`📊 ${paradigm}: Low quality (score: ${approach._validityScore.toFixed(2)}) - will route to RewriteBrain`);
          } else {
            this.logger.info(`✅ ${paradigm}: Good quality (score: ${approach._validityScore.toFixed(2)})`);
          }

          return approach;

        } catch (error) {
          this.logger.error(`Error generating ${paradigm} approach:`, error.message);
          return {
            name: `${paradigm} fallback`,
            strategy: `${paradigm} based approach`,
            steps: ['Implement solution'],
            strengths: 'Fallback',
            weaknesses: 'Error during generation',
            paradigm,
            _error: true
          };
        }
      })
    );

    // PRODUCTION: Process settled results (fulfilled vs rejected)
    const results = [];
    let fulfilledCount = 0;
    let rejectedCount = 0;

    settled.forEach((result, idx) => {
      const paradigm = selectedParadigms[idx];

      if (result.status === 'fulfilled') {
        fulfilledCount++;
        results.push(result.value);
        this._recordSuccess(); // Circuit breaker tracking
      } else {
        rejectedCount++;
        this.logger.error(`❌ ${paradigm} generation rejected:`, result.reason?.message || result.reason);
        this._recordFailure(); // Circuit breaker tracking

        // Add error fallback
        results.push({
          name: `${paradigm} error fallback`,
          strategy: `${paradigm} approach failed during generation`,
          steps: ['Analyze problem', 'Implement basic solution', 'Test'],
          strengths: 'Minimal fallback',
          weaknesses: `Generation failed: ${result.reason?.message || 'unknown error'}`,
          paradigm,
          _error: true,
          _rejected: true,
          _validityScore: 0.1
        });
      }
    });

    const duration = Date.now() - startTime;
    const successful = results.filter(r => !r._error && !r._fallback);
    const repaired = results.filter(r => r._repaired).length;
    const fallbacks = results.filter(r => r._fallback).length;
    const errors = results.filter(r => r._error).length;

    // PRODUCTION: Update metrics
    this.metrics.totalParseTime += duration;
    const avgScore = successful.length > 0
      ? successful.reduce((sum, r) => sum + (r._validityScore || 0), 0) / successful.length
      : 0;
    this.metrics.averageQualityScore = avgScore;

    // PRODUCTION: Comprehensive status logging
    this.logger.info(`✅ Generated ${successful.length}/${count} high-quality approaches in ${duration}ms`);
    if (repaired > 0) {
      this.logger.warn(`⚙️  Auto-repaired ${repaired} responses`);
    }
    if (fallbacks > 0) {
      this.logger.warn(`⚠️  ${fallbacks} minimal fallbacks used`);
    }
    if (errors > 0) {
      this.logger.error(`❌ ${errors} generation errors (circuit breaker: ${this.circuitBreaker.state})`);
    }

    // Log circuit breaker state if approaching threshold
    if (this.circuitBreaker.failures > 0) {
      this.logger.warn(`🔌 Circuit breaker: ${this.circuitBreaker.failures}/${this.circuitBreaker.threshold} failures (state: ${this.circuitBreaker.state})`);
    }

    return results;
    
    } catch (error) {
      this.logger.error(`[DivergentGenerator] Critical error in generate: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate approaches with automatic deduplication
   */
  async generateUnique(problem, count = 6, maxAttempts = 2, options = {}) {
    const allApproaches = [];
    let attempts = 0;

    while (allApproaches.length < count && attempts < maxAttempts) {
      attempts++;
      const needed = count - allApproaches.length;

      this.logger.debug(`Attempt ${attempts}: generating ${needed} more approaches`);

      const newApproaches = await this.generate(
        problem,
        needed,
        allApproaches,
        options
      );

      // Deduplicate by strategy similarity
      for (const approach of newApproaches) {
        const isDuplicate = allApproaches.some(existing =>
          this._isSimilar(existing.strategy, approach.strategy)
        );

        if (!isDuplicate) {
          allApproaches.push(approach);
        } else {
          this.logger.debug(`Skipping duplicate approach: ${approach.name}`);
        }
      }
    }

    return allApproaches.slice(0, count);
  }

  /**
   * Check if two strategies are too similar
   */
  _isSimilar(strategy1, strategy2, threshold = 0.6) {
    if (!strategy1 || !strategy2) return false;

    const words1 = strategy1.toLowerCase().split(/\s+/);
    const words2 = strategy2.toLowerCase().split(/\s+/);

    const common = words1.filter(w => words2.includes(w)).length;
    const similarity = common / Math.max(words1.length, words2.length);

    return similarity > threshold;
  }
}

module.exports = DivergentGenerator;
