// ═══════════════════════════════════════════════════════════
// FILE: asi/core/CriticBrain.cjs
// Independent evaluator with different perspective than generator
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { parseStructured, SolutionSchema } = require('./StructuredOutput.cjs');

/**
 * CriticBrain - Independent evaluator that thinks differently than the generator
 *
 * Key Innovation: Separate brain with different:
 * - System role (critic vs generator)
 * - Temperature (lower for critical thinking)
 * - Objective (find flaws vs create solutions)
 * - Evaluation criteria (correctness, edge cases, bugs)
 *
 * Combines:
 * - Deterministic evaluation (sandbox execution, unit tests)
 * - LLM-based critique (code review, edge case identification)
 */
class CriticBrain {
  constructor(config = {}) {
    this.llm = config.llm;
    this.evaluator = config.evaluator; // SolutionEvaluator for deterministic scoring
    this.sandbox = config.sandbox;     // SandboxRunner for code execution
    this.causalityArbiter = config.causalityArbiter; // Causal reasoning integration
    this.logger = config.logger || console;

    // Critic uses lower temperature for more focused analysis
    this.temperature = config.temperature || 0.2; // vs 0.7 for generator

    // Weights for hybrid scoring
    this.weights = config.weights || {
      deterministic: 0.7,  // Sandbox + unit tests
      llmCritique: 0.3     // LLM code review
    };

    // Load learned critique patterns (Anti-Patterns)
    this.learnedPatterns = [];
    this.learningsPath = config.learningsPath || path.join(__dirname, '../learning/critic-alignment-dataset.jsonl');
    this._loadLearnings();
  }

  _loadLearnings() {
    try {
      if (fs.existsSync(this.learningsPath)) {
        const content = fs.readFileSync(this.learningsPath, 'utf8');
        this.learnedPatterns = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line))
          .slice(-10); // Keep last 10 most recent lessons for prompt context
        
        this.logger.info(`[CriticBrain] Loaded ${this.learnedPatterns.length} learned critique patterns`);
      }
    } catch (err) {
      this.logger.warn(`[CriticBrain] Failed to load learnings: ${err.message}`);
    }
  }

  /**
   * Evaluate a solution node with hybrid approach
   */
  async evaluate(node, problem) {
    const startTime = Date.now();

    // Normalise problem text
    const problemText = typeof problem === 'string' ? problem : (problem.description || problem.name || JSON.stringify(problem));

    // 1. Fetch causal insights if arbiter is available
    let causalInsights = null;
    if (this.causalityArbiter && typeof this.causalityArbiter.queryCausalChains === 'function') {
        // Robust keyword extraction
        const keywords = problemText
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
            .split(/\s+/)
            .filter(w => w.length > 3 && !['what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how', 'does', 'this', 'that', 'with', 'from'].includes(w));
            
        // Query top 3 keywords
        if (keywords.length > 0) {
            try {
                // Query in parallel
                const chainPromises = keywords.slice(0, 3).map(k => this.causalityArbiter.queryCausalChains(k));
                const results = await Promise.all(chainPromises);
                causalInsights = results.flat().slice(0, 5); // Take top 5 unique insights
            } catch (err) {
                // Ignore causality errors
            }
        }
    }

    // Step 1: Deterministic evaluation (sandbox + tests)
    let deterministicScore = 0;
    let testResults = null;

    if (this.evaluator && node.solution) {
      try {
        const evaluation = await this.evaluator.evaluate(node.solution, problem);
        deterministicScore = evaluation.score || 0;
        testResults = evaluation.scores;
      } catch (error) {
        this.logger.warn(`Deterministic evaluation failed: ${error.message}`);
        deterministicScore = 0;
      }
    }

    // Step 2: LLM critique (code review, edge cases)
    let critiqueScore = 0;
    let critique = null;

    if (this.llm && node.solution) {
      try {
        critique = await this._llmCritique(node, problem, causalInsights);
        critiqueScore = critique.score || 0;
      } catch (error) {
        this.logger.warn(`LLM critique failed: ${error.message}`);
        critiqueScore = deterministicScore; // Fallback to deterministic
      }
    }

    // Step 3: Combine scores
    const finalScore =
      (deterministicScore * this.weights.deterministic) +
      (critiqueScore * this.weights.llmCritique);

    const duration = Date.now() - startTime;

    return {
      score: finalScore,
      breakdown: {
        deterministic: deterministicScore,
        llmCritique: critiqueScore,
        testResults,
        causalAware: !!(causalInsights && causalInsights.length > 0)
      },
      critique: critique?.feedback,
      duration
    };
  }

  /**
   * LLM-based code critique
   * Uses CRITIC role with lower temperature for focused analysis
   */
  async _llmCritique(node, problem, causalInsights = null) {
    const prompt = this._buildCritiquePrompt(node, problem, causalInsights);

    const response = await this.llm.generate(prompt, {
      temperature: this.temperature, // Lower than generator
      maxTokens: 500,
      role: 'critic' // Different role
    });

    // Parse critique response
    const critique = this._parseCritique(response);

    return critique;
  }

  /**
   * Build critique prompt - asks LLM to find flaws, bugs, edge cases
   */
  _buildCritiquePrompt(node, problem, causalInsights = null) {
    const code = node.solution?.code || node.code || node.solution || '<no code>';
    const approach = node.approach?.name || 'Unknown';
    const paradigm = node.approach?.paradigm || 'Unknown';
    const problemText = typeof problem === 'string' ? problem : (problem.description || problem.name || 'Unknown Problem');

    let prompt = `You are a CRITIC reviewing code. Your job is to find bugs, edge cases, and weaknesses.

Problem: ${problemText}
Approach: ${approach} (${paradigm})

Code:
\`\`\`javascript
${code}
\`\`\`
`;

    // INJECT LEARNED WISDOM (Self-Correction)
    if (this.learnedPatterns && this.learnedPatterns.length > 0) {
        prompt += `
PREVIOUS MISTAKES TO AVOID (LEARNED WISDOM):
The following are examples where previous critics FAILED by being too harsh or missing the point. Do not repeat these mistakes:
`;
        this.learnedPatterns.forEach((pattern, i) => {
             const summary = pattern.output.groundTruthFeedback || "Focus on functional correctness over style.";
             prompt += `${i + 1}. LESSON: ${summary.substring(0, 150)}...\n`;
        });
    }

    if (causalInsights && causalInsights.length > 0) {
        prompt += `
CAUSAL INSIGHTS (Learn from SOMA's experience):
${causalInsights.map(c => `  - ${c.cause} often leads to ${c.effect} (confidence: ${(c.confidence * 100).toFixed(0)}%)`).join('\n')}
Use these causal links to identify if the current code might trigger known failure modes or performance bottlenecks.
`;
    }

    prompt += `
Analyze this code and return JSON:
{
  "score": 0.0-1.0,
  "feedback": "Your critical analysis",
  "bugs": ["List of bugs found"],
  "edgeCases": ["Edge cases not handled"],
  "strengths": ["What works well"]
}

Focus on:
1. Correctness - Does it solve the problem?
2. Edge cases - What inputs will break it?
3. Bugs - Logic errors, off-by-one, null checks
4. Performance - Time/space complexity issues

Be critical but fair. Return ONLY valid JSON:`;

    return prompt;
  }

  /**
   * Parse LLM critique response
   */
  _parseCritique(response) {
    // Try to extract JSON
    const result = parseStructured(response, {
      type: 'object',
      required: ['score'],
      properties: {
        score: { type: 'number', minimum: 0, maximum: 1 },
        feedback: { type: 'string' },
        bugs: { type: 'array', items: { type: 'string' } },
        edgeCases: { type: 'array', items: { type: 'string' } },
        strengths: { type: 'array', items: { type: 'string' } }
      }
    }, {
      repair: true,
      fallback: { score: 0.5, feedback: 'Could not parse critique' }
    });

    if (result.success) {
      return result.data;
    }

    // Fallback: try to extract score from text
    const scoreMatch = response.match(/score[\"']?\s*:\s*([0-9.]+)/i);
    if (scoreMatch) {
      return {
        score: parseFloat(scoreMatch[1]),
        feedback: response.substring(0, 200),
        bugs: [],
        edgeCases: [],
        strengths: []
      };
    }

    return {
      score: 0.5,
      feedback: 'Failed to parse critique',
      bugs: [],
      edgeCases: [],
      strengths: []
    };
  }

  /**
   * Batch evaluate multiple nodes in parallel
   */
  async evaluateBatch(nodes, problem, options = {}) {
    const parallel = options.parallel !== false; // Default true
    const maxConcurrency = options.maxConcurrency || 8;

    if (!parallel) {
      const results = [];
      for (const node of nodes) {
        const result = await this.evaluate(node, problem);
        results.push({ node, ...result });
      }
      return results;
    }

    // Parallel evaluation with concurrency limit
    const results = [];
    const chunks = [];

    for (let i = 0; i < nodes.length; i += maxConcurrency) {
      chunks.push(nodes.slice(i, i + maxConcurrency));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (node) => {
          const result = await this.evaluate(node, problem);
          return { node, ...result };
        })
      );
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Compare two solutions and explain which is better
   */
  async compare(nodeA, nodeB, problem) {
    const [evalA, evalB] = await Promise.all([
      this.evaluate(nodeA, problem),
      this.evaluate(nodeB, problem)
    ]);

    const winner = evalA.score > evalB.score ? 'A' : 'B';
    const delta = Math.abs(evalA.score - evalB.score);

    return {
      winner,
      delta,
      scoreA: evalA.score,
      scoreB: evalB.score,
      breakdownA: evalA.breakdown,
      breakdownB: evalB.breakdown
    };
  }

  /**
   * Generate counterexamples that break the code
   */
  async generateCounterexamples(node, problem, count = 3) {
    if (!this.llm) {
      return [];
    }

    const code = node.solution?.code || node.code || '<no code>';

    const prompt = `You are a TESTER finding edge cases that break code.

Problem: ${problem.description || problem.name}

Code:
\`\`\`javascript
${code}
\`\`\`

Generate ${count} test inputs that will likely FAIL or expose bugs.

Return JSON array:
[
  {
    "input": "test input value",
    "reason": "why this might break the code"
  }
]

Return ONLY valid JSON array:`;

    try {
      const response = await this.llm.generate(prompt, {
        temperature: 0.3,
        maxTokens: 400
      });

      const result = parseStructured(response, {
        type: 'array',
        items: {
          type: 'object',
          required: ['input', 'reason'],
          properties: {
            input: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      }, {
        repair: true,
        fallback: []
      });

      return result.success ? result.data : [];

    } catch (error) {
      this.logger.warn(`Counterexample generation failed: ${error.message}`);
      return [];
    }
  }
}

module.exports = CriticBrain;
