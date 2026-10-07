// ═══════════════════════════════════════════════════════════
// FILE: asi/core/RecombinationEngine.cjs
// Cognitive crossover - merge best parts of different solutions
// ═══════════════════════════════════════════════════════════

/**
 * RecombinationEngine - Cognitive Crossover for Breakthrough Reasoning
 *
 * Key Innovation: Like genetic algorithms, but for ideas
 * - Take best parts of solution A
 * - Merge with insights from solution B
 * - Add critique elements from solution C
 * - Creates truly NEW pathways, not incremental variations
 *
 * This is where human-level reasoning emerges from search.
 */
class RecombinationEngine {
  constructor(config = {}) {
    this.llm = config.llm;
    this.logger = config.logger || console;
    this.maxRecombinations = config.maxRecombinations || 3;
  }

  /**
   * Recombine top solutions into new hybrid candidates
   *
   * @param {Array} topNodes - Best performing nodes to recombine
   * @param {Object} problem - Problem specification
   * @param {number} targetCount - How many recombinations to create
   * @returns {Promise<Array>} - Array of recombined nodes
   */
  async recombine(topNodes, problem, targetCount = 3) {
    if (!topNodes || topNodes.length < 2) {
      this.logger.warn('Need at least 2 nodes to recombine');
      return [];
    }

    const startTime = Date.now();
    this.logger.info(`🧬 Recombining top ${topNodes.length} solutions into ${targetCount} hybrids`);

    const recombinations = [];

    // Strategy 1: Pairwise merging (A + B)
    for (let i = 0; i < Math.min(topNodes.length, 3); i++) {
      for (let j = i + 1; j < Math.min(topNodes.length, 3); j++) {
        if (recombinations.length >= targetCount) break;

        const nodeA = topNodes[i];
        const nodeB = topNodes[j];

        const hybrid = await this._mergePair(nodeA, nodeB, problem);
        if (hybrid) {
          recombinations.push(hybrid);
        }
      }
      if (recombinations.length >= targetCount) break;
    }

    // Strategy 2: Three-way fusion (if we need more)
    if (recombinations.length < targetCount && topNodes.length >= 3) {
      const fusion = await this._fuseThree(topNodes[0], topNodes[1], topNodes[2], problem);
      if (fusion) {
        recombinations.push(fusion);
      }
    }

    const duration = Date.now() - startTime;
    this.logger.info(`✅ Created ${recombinations.length} recombinations in ${duration}ms`);

    return recombinations.slice(0, targetCount);
  }

  /**
   * Merge two solutions using LLM
   */
  async _mergePair(nodeA, nodeB, problem) {
    const approachA = nodeA.approach || {};
    const approachB = nodeB.approach || {};

    // SIMPLIFIED PROMPT FOR ROBUST PARSING
    const prompt = `You are a SYNTHESIS ENGINE. Merge two approaches into ONE superior hybrid.

Problem: ${problem.description || problem.name}

Approach A: ${approachA.name || 'Unknown'} (${approachA.paradigm || 'Unknown'})
Strategy A: ${approachA.strategy || 'Standard'}

Approach B: ${approachB.name || 'Unknown'} (${approachB.paradigm || 'Unknown'})
Strategy B: ${approachB.strategy || 'Standard'}

TASK: Create a HYBRID approach that combines the best of both.
- If A is recursive and B is memoization, create "Memoized Recursion"
- If A is iterative and B is math, create "Iterative Math"

Return JSON Array (1 item):
[
  {
    "name": "Hybrid Name",
    "strategy": "Combined strategy description",
    "steps": ["Step 1", "Step 2"],
    "strengths": "Why it is better",
    "weaknesses": "Any trade-offs"
  }
]

Return ONLY valid JSON:`;

    try {
      const response = await this.llm.generate(prompt, {
        temperature: 0.6, // Moderate creativity for synthesis
        maxTokens: 800
      });

      // Parse with structured output
      const { parseStructured, ApproachesSchema } = require('./StructuredOutput.cjs');
      const result = parseStructured(response, ApproachesSchema, {
        repair: true,
        fallback: []
      });

      if (!result.success || result.data.length === 0) {
        this.logger.warn('Failed to parse recombination');
        return null;
      }

      const hybridApproach = result.data[0];

      // Create new node
      const SolutionNode = require('./SolutionNode.cjs');
      const hybrid = new SolutionNode({
        id: `recomb_${nodeA.id.substring(0,4)}_${nodeB.id.substring(0,4)}`,
        parent: null,
        approach: {
          ...hybridApproach,
          paradigm: `hybrid_${approachA.paradigm}_${approachB.paradigm}`,
          _recombinedFrom: [nodeA.id, nodeB.id]
        },
        depth: Math.max(nodeA.depth, nodeB.depth) + 1,
        metadata: {
          recombination: true,
          parents: [nodeA.id, nodeB.id],
          parentScores: [nodeA.score, nodeB.score]
        }
      });

      return hybrid;

    } catch (error) {
      this.logger.error(`Recombination failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Fuse three solutions (for complex synthesis)
   */
  async _fuseThree(nodeA, nodeB, nodeC, problem) {
    const approachA = nodeA.approach || {};
    const approachB = nodeB.approach || {};
    const approachC = nodeC.approach || {};

    // SIMPLIFIED PROMPT FOR ROBUST PARSING
    const prompt = `You are a MASTER SYNTHESIZER. Fuse THREE approaches into ONE breakthrough solution.

Problem: ${problem.description || problem.name}

A: ${approachA.name}
B: ${approachB.name}
C: ${approachC.name}

TASK: Create a FUSION that is better than the sum of its parts.
- Combine the structure of A
- With the optimization of B
- And the insight of C

Return JSON Array (1 item):
[
  {
    "name": "Fusion Name",
    "strategy": "Novel strategy combining A, B, and C",
    "steps": ["Step 1", "Step 2"],
    "strengths": "Synergistic benefits",
    "weaknesses": "Complexity trade-offs"
  }
]

Return ONLY valid JSON:`;

    try {
      const response = await this.llm.generate(prompt, {
        temperature: 0.7, // Higher creativity for complex synthesis
        maxTokens: 1000
      });

      const { parseStructured, ApproachesSchema } = require('./StructuredOutput.cjs');
      const result = parseStructured(response, ApproachesSchema, {
        repair: true,
        fallback: []
      });

      if (!result.success || result.data.length === 0) {
        return null;
      }

      const fusedApproach = result.data[0];

      const SolutionNode = require('./SolutionNode.cjs');
      const fusion = new SolutionNode({
        id: `fusion_${Date.now().toString(36)}`,
        parent: null,
        approach: {
          ...fusedApproach,
          paradigm: 'fusion_triple',
          _fusedFrom: [nodeA.id, nodeB.id, nodeC.id]
        },
        depth: Math.max(nodeA.depth, nodeB.depth, nodeC.depth) + 1,
        metadata: {
          fusion: true,
          parents: [nodeA.id, nodeB.id, nodeC.id],
          parentScores: [nodeA.score, nodeB.score, nodeC.score]
        }
      });

      return fusion;

    } catch (error) {
      this.logger.error(`Three-way fusion failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Simple code splicing (for deterministic recombination without LLM)
   */
  _spliceCode(codeA, codeB) {
    if (!codeA && !codeB) return null;
    if (!codeA) return codeB;
    if (!codeB) return codeA;

    // Naive but safe: create wrapper that tries both approaches
    const wrapped = `
// Hybrid solution - tries multiple approaches
function hybridSolution(input) {
  // Approach A
  try {
    ${this._indentCode(codeA, 4)}
  } catch (e) {
    console.warn('Approach A failed:', e.message);
  }

  // Approach B
  try {
    ${this._indentCode(codeB, 4)}
  } catch (e) {
    console.warn('Approach B failed:', e.message);
  }

  // Fallback
  return null;
}
`.trim();

    return wrapped;
  }

  /**
   * Indent code by N spaces
   */
  _indentCode(code, spaces) {
    const indent = ' '.repeat(spaces);
    return code.split('\n').map(line => indent + line).join('\n');
  }

  /**
   * Extract best fragments from multiple code solutions
   * (Advanced: can use AST parsing for intelligent extraction)
   */
  _extractBestFragments(codes) {
    // Simple heuristic: find unique helper functions, combine them
    const fragments = new Set();

    for (const code of codes) {
      if (!code) continue;

      // Extract function definitions
      const funcMatches = code.match(/function\s+\w+\s*\([^)]*\)\s*\{/g) || [];
      fragments.add(...funcMatches);

      // Extract const/let declarations
      const constMatches = code.match(/(?:const|let)\s+\w+\s*=/g) || [];
      fragments.add(...constMatches);
    }

    return Array.from(fragments);
  }
}

module.exports = RecombinationEngine;
