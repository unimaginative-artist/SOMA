// ═══════════════════════════════════════════════════════════
// FILE: asi/core/TreeSearchEngine.cjs
// Core tree search engine for exploring solution spaces
// Implements beam search, best-first search, and breadth-first search
// ═══════════════════════════════════════════════════════════

const SolutionNode = require('./SolutionNode.cjs');
const EventEmitter = require('events');
const { ApproachesSchema, parseStructured } = require('./StructuredOutput.cjs');

// Week 4: Cognitive Diversity + Critique + Recombination
const DivergentGenerator = require('./DivergentGenerator.cjs');
const CriticBrain = require('./CriticBrain.cjs');
const RecombinationEngine = require('./RecombinationEngine.cjs');

class TreeSearchEngine extends EventEmitter {
  constructor(config = {}) {
    super();

    // Configuration
    this.maxDepth = config.maxDepth || 5;
    this.branchingFactor = config.branchingFactor || 10;
    this.strategy = config.strategy || 'beam'; // beam, best-first, breadth-first
    this.pruneThreshold = config.pruneThreshold || 0.2;
    this.maxNodes = config.maxNodes || 1000;
    this.timeout = config.timeout || 300000; // 5 minutes

    // Dependencies
    this.evaluator = config.evaluator;
    this.llm = config.llm; // LLM for generating approaches
    this.reasoningChamber = config.reasoningChamber; // Advanced reasoning integration
    this.logger = config.logger || console;

    // Week 4: Cognitive engines
    this.useCognitiveDiversity = config.useCognitiveDiversity !== false; // Default true
    if (this.useCognitiveDiversity && this.llm) {
      this.divergentGenerator = new DivergentGenerator({
        llm: this.llm,
        logger: this.logger
      });
      this.criticBrain = new CriticBrain({
        llm: this.llm,
        evaluator: this.evaluator,
        causalityArbiter: config.causalityArbiter, // Inject causality for advanced critique
        logger: this.logger
      });
      this.recombiner = new RecombinationEngine({
        llm: this.llm,
        logger: this.logger
      });
      this.logger.info('  🧠 Cognitive diversity: ENABLED');
    } else {
      this.divergentGenerator = null;
      this.criticBrain = null;
      this.recombiner = null;
      this.logger.info('  🧠 Cognitive diversity: DISABLED');
    }

    // Search state
    this.root = null;
    this.currentDepth = 0;
    this.totalNodes = 0;
    this.evaluatedNodes = 0;
    this.prunedNodes = 0;
    this.startTime = null;
    this.problemAnalysis = null; // Stored analysis from ReasoningChamber

    // Results
    this.solutions = [];
    this.bestSolution = null;

    this.logger.info('[TreeSearchEngine] Initialized');
    this.logger.info(`  Strategy: ${this.strategy}`);
    this.logger.info(`  Max depth: ${this.maxDepth}`);
    this.logger.info(`  Branching factor: ${this.branchingFactor}`);
    if (this.reasoningChamber) this.logger.info('  🧩 ReasoningChamber: CONNECTED');
  }

  /**
   * Pre-analyze the problem to determine the best reasoning strategy
   */
  async _preAnalyzeProblem(problem) {
    if (!this.reasoningChamber) return null;

    this.logger.info('  🔍 Performing pre-search analysis via ReasoningChamber...');
    try {
        const analysis = await this.reasoningChamber.reason({ query: problem });
        this.problemAnalysis = analysis;
        this.logger.info(`  🎯 Problem Type: ${analysis.reasoningType} (Strategy: ${analysis.strategy})`);
        
        // APPLY STRATEGY: Actually use the analysis to guide the search
        // Map ReasoningChamber strategies to TreeSearch strategies
        if (analysis.reasoningType === 'analytical' || analysis.reasoningType === 'causal') {
            this.logger.info(`  🔄 Switching to Beam Search (width 8) for ${analysis.reasoningType} problem`);
            this.strategy = 'beam';
            this.branchingFactor = 8;
        } else if (analysis.reasoningType === 'generative') {
            this.logger.info(`  🔄 Switching to Best-First Search for generative problem`);
            this.strategy = 'best-first';
        }
        
        return analysis;
    } catch (err) {
        this.logger.warn(`  ⚠️ Pre-analysis failed: ${err.message}`);
        return null;
    }
  }

  /**
   * Main search entry point
   */
  async search(problem, options = {}) {
    this.logger.info('[TreeSearchEngine] Starting search...');
    this.logger.info(`  Problem: ${problem.substring(0, 100)}...`);

    this.startTime = Date.now();
    this.totalNodes = 0;
    this.evaluatedNodes = 0;
    this.prunedNodes = 0;
    this.solutions = [];

    // 1. ADVANCED REASONING: Pre-analyze the problem (this now updates strategy)
    await this._preAnalyzeProblem(problem);

    try {
      // 2. Generate initial approaches (root children)
      this.root = new SolutionNode({
        approach: 'root',
        solution: null,
        depth: 0
      });

      const initialApproaches = await this.generateApproaches(problem, options);
      this.logger.info(`  Generated ${initialApproaches.length} initial approaches`);

      // 2. Create child nodes for each approach
      for (const approach of initialApproaches) {
        this.root.addChild({
          approach: approach.name,
          solution: approach.solution,
          reasoning: approach.reasoning,
          metadata: approach.metadata || {}
        });
      }

      this.totalNodes += this.root.children.length;

      // 3. Search based on strategy
      switch (this.strategy) {
        case 'beam':
          await this.beamSearch(problem, options);
          break;
        case 'best-first':
          await this.bestFirstSearch(problem, options);
          break;
        case 'breadth-first':
          await this.breadthFirstSearch(problem, options);
          break;
        default:
          throw new Error(`Unknown strategy: ${this.strategy}`);
      }

      // 4. Find best solution
      this.bestSolution = this.findBestSolution();

      const elapsed = Date.now() - this.startTime;
      this.logger.info('[TreeSearchEngine] Search complete');
      this.logger.info(`  Time: ${(elapsed / 1000).toFixed(2)}s`);
      this.logger.info(`  Nodes explored: ${this.totalNodes}`);
      this.logger.info(`  Nodes evaluated: ${this.evaluatedNodes}`);
      this.logger.info(`  Nodes pruned: ${this.prunedNodes}`);
      this.logger.info(`  Solutions found: ${this.solutions.length}`);
      this.logger.info(`  Best score: ${this.bestSolution?.score || 'N/A'}`);

      return {
        success: true,
        solution: this.bestSolution,
        alternatives: this.solutions,
        stats: this.getSearchStats(),
        tree: this.root
      };

    } catch (error) {
      this.logger.error(`[TreeSearchEngine] Search failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        partialResults: this.solutions,
        stats: this.getSearchStats()
      };
    }
  }

  /**
   * Beam search: Keep top N nodes at each level
   */
  async beamSearch(problem, options = {}) {
    let currentLevel = this.root.children;

    for (let depth = 1; depth <= this.maxDepth; depth++) {
      this.logger.info(`[BeamSearch] Depth ${depth}, exploring ${currentLevel.length} nodes`);

      // 1. Evaluate all nodes at current level (in parallel!)
      await Promise.all(
        currentLevel.map(node => {
          if (this._shouldStop()) return Promise.resolve();
          return this.evaluateNode(node, problem);
        })
      );

      // 2. Check for solutions
      this._collectSolutions(currentLevel);

      // 3. Prune low-scoring nodes
      const unpruned = currentLevel.filter(node => {
          const keep = !node.shouldPrune(this.pruneThreshold);
          if (!keep) {
              this.logger.debug(`  PRUNED node: ${node.approach} (Score: ${node.score?.toFixed(2) || 'N/A'})`);
              if (node.evaluation && node.evaluation.error) {
                  this.logger.debug(`    Reason: Evaluation Error -> ${node.evaluation.error}`);
              } else if (node.error) {
                  this.logger.debug(`    Reason: Node Error -> ${node.error}`);
              } else {
                  this.logger.debug(`    Reason: Low Score (Threshold: ${this.pruneThreshold})`);
              }
          }
          return keep;
      });
      this.prunedNodes += currentLevel.length - unpruned.length;

      // 4. Keep top N nodes (beam width = branchingFactor)
      const topNodes = unpruned
        .sort((a, b) => b.score - a.score)
        .slice(0, this.branchingFactor);

      this.logger.info(`  Keeping top ${topNodes.length} nodes`);

      // 4.5. Week 4: Recombine top nodes (cognitive crossover!)
      let recombinedNodes = [];
      if (this.recombiner && topNodes.length >= 2) {
        try {
          const targetRecombinations = Math.max(1, Math.floor(this.branchingFactor / 3));
          recombinedNodes = await this.recombiner.recombine(topNodes, problem, targetRecombinations);
          if (recombinedNodes.length > 0) {
            this.logger.info(`  🧬 Created ${recombinedNodes.length} recombined hybrids`);
          }
        } catch (error) {
          this.logger.warn(`Recombination failed: ${error.message}`);
        }
      }

      // 5. Expand top nodes (in parallel!)
      const expansions = await Promise.all(
        topNodes
          .filter(node => !this._shouldStop() && node.score >= this.pruneThreshold)
          .map(node => this.expandNode(node, problem))
      );

      const nextLevel = [...expansions.flat(), ...recombinedNodes];

      if (nextLevel.length === 0) {
        this.logger.info(`  No more nodes to explore at depth ${depth}`);
        break;
      }

      currentLevel = nextLevel;
      this.totalNodes += currentLevel.length;
    }
  }

  /**
   * Best-first search: Always expand highest-scoring node
   */
  async bestFirstSearch(problem, options = {}) {
    // Priority queue ordered by score
    const queue = [...this.root.children];

    // Evaluate initial nodes
    for (const node of queue) {
      await this.evaluateNode(node, problem);
    }

    while (queue.length > 0 && !this._shouldStop()) {
      // Sort by score (highest first)
      queue.sort((a, b) => b.score - a.score);

      // Expand best node
      const best = queue.shift();

      if (best.shouldPrune(this.pruneThreshold)) {
        this.prunedNodes++;
        continue;
      }

      // Check if solution
      if (this._isSolution(best)) {
        this.solutions.push(best);
      }

      // Expand if not at max depth
      if (best.depth < this.maxDepth) {
        const children = await this.expandNode(best, problem);

        // Evaluate children and add to queue
        for (const child of children) {
          await this.evaluateNode(child, problem);
          queue.push(child);
        }

        this.totalNodes += children.length;
      }

      // Limit queue size
      if (queue.length > this.maxNodes) {
        const removed = queue.splice(this.maxNodes);
        this.prunedNodes += removed.length;
      }
    }
  }

  /**
   * Breadth-first search: Explore all nodes at each level
   */
  async breadthFirstSearch(problem, options = {}) {
    const queue = [...this.root.children];

    while (queue.length > 0 && !this._shouldStop()) {
      const node = queue.shift();

      // Evaluate node
      await this.evaluateNode(node, problem);

      // Check for solution
      if (this._isSolution(node)) {
        this.solutions.push(node);
      }

      // Prune if score too low
      if (node.shouldPrune(this.pruneThreshold)) {
        this.prunedNodes++;
        continue;
      }

      // Expand if not at max depth
      if (node.depth < this.maxDepth) {
        const children = await this.expandNode(node, problem);
        queue.push(...children);
        this.totalNodes += children.length;
      }
    }
  }

  /**
   * Generate initial approaches using LLM
   * Week 4: Uses DivergentGenerator for forced paradigm diversity
   */
  async generateApproaches(problem, options = {}) {
    if (!this.llm) {
      // Fallback: Return a single default approach
      return [{
        name: 'default',
        solution: `// Placeholder solution for: ${problem.substring(0, 50)}...`,
        reasoning: 'No LLM configured, using fallback'
      }];
    }

    // Week 4: Use DivergentGenerator for cognitive diversity
    if (this.divergentGenerator) {
      try {
        const approaches = await this.divergentGenerator.generate(
          problem,
          this.branchingFactor,
          [],
          { temperature: options.temperature || 0.7 }
        );

        // MIDDLE GROUND: Add a "Direct" approach if not present
        const hasDirect = approaches.some(a => a.paradigm === 'direct' || a.strategy.toLowerCase().includes('simple'));
        if (!hasDirect) {
            approaches.unshift({
                name: 'Direct Solution',
                strategy: 'Solve the problem using standard, idiomatic code without over-engineering.',
                steps: ['Analyze requirements', 'Implement straightforward logic'],
                strengths: 'Simple, readable, efficient',
                weaknesses: 'May not handle extreme edge cases',
                paradigm: 'direct'
            });
        }

        // CRITICAL FIX: Generate solution code for all approaches immediately
        // Nodes cannot be evaluated without executable substance.
        return await Promise.all(
            approaches.map(async (approach) => {
                const solution = await this._generateSolution(problem, approach);
                return {
                    name: approach.name,
                    strategy: approach.strategy,
                    steps: approach.steps,
                    strengths: approach.strengths,
                    weaknesses: approach.weaknesses,
                    paradigm: approach.paradigm,
                    solution: solution, // Actually generated now
                    reasoning: `Paradigm: ${approach.paradigm}\nStrategy: ${approach.strategy}`
                };
            })
        );
      } catch (error) {
        this.logger.error(`DivergentGenerator failed: ${error.message}, falling back to standard generation`);
        // Fall through to standard generation
      }
    }

    // Standard generation (fallback or if cognitive diversity disabled)

    const prompt = `Generate ${this.branchingFactor} different coding approaches for this problem.

Problem: ${problem}

Return ONLY valid JSON, no other text. Format:
[
  {
    "name": "Approach name",
    "strategy": "Brief strategy description",
    "steps": ["step1", "step2"],
    "strengths": "What's good about this",
    "weaknesses": "What's not ideal"
  }
]

Example for "reverse a string":
[
  {
    "name": "Built-in reverse",
    "strategy": "Use array reverse method",
    "steps": ["Split to array", "Reverse array", "Join back"],
    "strengths": "Simple and readable",
    "weaknesses": "Creates intermediate arrays"
  },
  {
    "name": "Two-pointer swap",
    "strategy": "Swap characters from both ends",
    "steps": ["Convert to array", "Swap i and n-i", "Return string"],
    "strengths": "In-place, efficient",
    "weaknesses": "More complex code"
  }
]

Now generate ${this.branchingFactor} approaches for: ${problem}

Return ONLY the JSON array, nothing else:`;

    try {
      const response = await this.llm.generate(prompt, { role: 'strategic' });
      const approaches = this._parseApproaches(response);

      // Generate solution code for each approach
      const withSolutions = await Promise.all(
        approaches.map(async (approach) => {
          const solution = await this._generateSolution(problem, approach);
          return {
            name: approach.name,
            solution,
            reasoning: `${approach.strategy}\nSteps: ${approach.steps.join(', ')}`,
            metadata: {
              strengths: approach.strengths,
              weaknesses: approach.weaknesses,
              steps: approach.steps
            }
          };
        })
      );

      return withSolutions;

    } catch (error) {
      this.logger.error(`Failed to generate approaches: ${error.message}`);
      // Fallback
      return [{
        name: 'fallback',
        solution: `// Solution for: ${problem}`,
        reasoning: 'LLM generation failed, using fallback'
      }];
    }
  }

  /**
   * Generate solution code for an approach
   */
  async _generateSolution(problem, approach) {
    if (!this.llm) {
      return `// Placeholder solution\n// Approach: ${approach.name}`;
    }

    const prompt = `Write JavaScript code to solve this problem using the specified approach.

Problem: ${problem}

Approach: ${approach.name}
Strategy: ${approach.strategy}
Steps: ${approach.steps.join(' → ')}

Requirements:
- Write ONLY the function code, no explanations
- Use proper JavaScript syntax
- **The function MUST be named "solution"** (e.g., function solution(args) { ... })
- Return the result matching the problem requirements

Example format:
function solution(param) {
  // Brief logic description if complex
  return result;
}

Your code:`;

    try {
      let solution = await this.llm.generate(prompt, { role: 'logic' });

      // Clean the solution
      const rawSolution = solution;
      solution = this._cleanCode(solution);

      this.logger.debug(`=== GENERATED CODE ===\n${solution}\n=== END ===`);

      // Validate syntax
      if (!this._validateSyntax(solution)) {
        this.logger.warn(`  Generated code has syntax errors, marking low quality`);
      }

      return solution;
    } catch (error) {
      return `// Failed to generate solution: ${error.message}`;
    }
  }

  /**
   * Clean generated code - Robust Extraction Strategy
   */
  _cleanCode(code) {
    if (!code || typeof code !== 'string') return "";

    // 1. Try to extract specific language blocks (Best Quality)
    const specificRegex = /```(?:javascript|js|typescript|ts)\s*([\s\S]*?)```/gi;
    const specificMatches = [...code.matchAll(specificRegex)];
    
    if (specificMatches.length > 0) {
      // Return the longest specific code block
      return specificMatches.sort((a, b) => b[1].length - a[1].length)[0][1].trim();
    }

    // 2. Fallback: Any code block
    const fenceRegex = /```\s*([\s\S]*?)```/gi;
    const matches = [...code.matchAll(fenceRegex)];

    if (matches.length > 0) {
      // Prefer the LARGEST fenced block (most likely the solution)
      return matches.sort((a, b) => b[1].length - a[1].length)[0][1].trim();
    } 
    
    // 3. No fences — assume raw output IS the code
    const cleanedCode = code.trim();

    // 2. Sanity validation (Optional: could be strict or loose)
    // If we can't find the function, it's not a valid solution
    if (!cleanedCode.includes("function solution")) {
        this.logger.warn("Invalid solution generated: 'function solution' not found");
    }

    return cleanedCode;
  }

  /**
   * Basic syntax validation
   */
  _validateSyntax(code) {
    try {
      // Try to parse as JavaScript
      new Function(code);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Expand a node by generating child nodes
   */
  async expandNode(node, problem) {
    this.logger.debug(`  Expanding node: ${node.approach} (score: ${node.score})`);

    node.status = 'expanded';

    // Generate variations or refinements
    const prompt = `Given this partial solution, generate ${Math.min(this.branchingFactor, 5)} variations or improvements:

Problem: ${problem}

Current approach: ${node.approach}
Current solution:
${node.solution}

Current score: ${node.score}

Generate variations that might score higher. For each, provide:
- Variation name
- What changed
- Why it might be better

Format as JSON array.`;

    try {
      if (!this.llm) {
        // No refinements without LLM
        return [];
      }

      const response = await this.llm.generate(prompt);
      const variations = this._parseVariations(response);

      const children = [];
      for (const variation of variations.slice(0, this.branchingFactor)) {
        const child = node.addChild({
          approach: `${node.approach} → ${variation.name}`,
          solution: variation.solution || node.solution,
          reasoning: variation.reasoning,
          metadata: { ...node.metadata, variation: variation.name }
        });
        children.push(child);
      }

      return children;

    } catch (error) {
      this.logger.error(`Failed to expand node: ${error.message}`);
      return [];
    }
  }

  /**
   * Evaluate a node using the evaluator
   */
  async evaluateNode(node, problem) {
    if (node.evaluated) return;

    // Week 4: Use CriticBrain for hybrid evaluation
    if (this.criticBrain) {
      try {
        const evaluation = await this.criticBrain.evaluate(node, problem);

        node.score = evaluation.score;
        node.evaluation = evaluation.breakdown;
        node.critique = evaluation.critique;
        node.evaluated = true;
        this.evaluatedNodes++;
        node.status = 'evaluated';

        this.emit('node:evaluated', { node, evaluation });
        return;

      } catch (error) {
        this.logger.warn(`CriticBrain failed: ${error.message}, falling back to standard evaluation`);
        // Fall through to standard evaluation
      }
    }

    // Standard evaluation (fallback or if cognitive diversity disabled)
    if (!this.evaluator) {
      // Fallback: Random score
      node.score = Math.random();
      node.evaluated = true;
      this.evaluatedNodes++;
      return;
    }

    try {
      const evaluation = await this.evaluator.evaluate(node.solution, problem);

      // MIDDLE GROUND: Simplicity Boost
      // If code is correct and simple, boost it so it survives pruning
      // This prevents "over-thinking" on easy problems
      let simplicityBoost = 0;
      if (evaluation.score > 0.8) {
          const lineCount = node.solution.split('\n').length;
          // Bonus for concise code (under 20 lines)
          if (lineCount < 20) simplicityBoost += 0.1;
          // Bonus for direct paradigm
          if (node.metadata && node.metadata.paradigm === 'direct') simplicityBoost += 0.1;
      }

      node.score = Math.min(1.0, evaluation.score + simplicityBoost);
      node.evaluation = evaluation;
      node.evaluated = true;
      this.evaluatedNodes++;

      node.status = 'evaluated';

      this.emit('node:evaluated', { node, evaluation });

    } catch (error) {
      this.logger.error(`Failed to evaluate node: ${error.message}`);
      node.score = 0;
      node.evaluated = true;
      node.error = error.message;
    }
  }

  /**
   * Check if a node is a solution
   */
  _isSolution(node) {
    // A node is a solution if:
    // 1. It has been evaluated
    // 2. Score is above threshold
    // 3. It's been tested (if applicable)
    return node.evaluated &&
           node.score !== null &&
           node.score >= 0.7; // Arbitrary threshold
  }

  /**
   * Collect solutions from a set of nodes
   */
  _collectSolutions(nodes) {
    for (const node of nodes) {
      if (this._isSolution(node)) {
        this.solutions.push(node);
      }
    }
  }

  /**
   * Find the best solution across all found solutions
   */
  findBestSolution() {
    if (this.solutions.length === 0) {
      // No solutions found, return best evaluated node
      const allNodes = this.root.getDescendants();
      const evaluated = allNodes.filter(n => n.evaluated && n.score !== null);

      if (evaluated.length === 0) return null;

      return evaluated.reduce((best, node) =>
        node.score > best.score ? node : best
      );
    }

    return this.solutions.reduce((best, node) =>
      node.score > best.score ? node : best
    );
  }

  /**
   * Check if search should stop
   */
  _shouldStop() {
    if (Date.now() - this.startTime > this.timeout) {
      this.logger.warn('[TreeSearchEngine] Timeout reached');
      return true;
    }

    if (this.totalNodes >= this.maxNodes) {
      this.logger.warn('[TreeSearchEngine] Max nodes reached');
      return true;
    }

    return false;
  }

  /**
   * Parse approach JSON from LLM response (STRUCTURED OUTPUT - Production Grade)
   */
  _parseApproaches(response) {
    // Use structured output parser with schema validation
    const result = parseStructured(response, ApproachesSchema, {
      repair: true,  // Auto-fix common issues
      fallback: []   // Return empty array if all fails
    });

    if (!result.success) {
      this.logger.error(`Failed to parse approaches: ${result.errors?.join(', ')}`);
      this.logger.debug(`Response was: ${response.substring(0, 500)}...`);
      return [];
    }

    if (result.repaired) {
      this.logger.warn(`Approaches required auto-repair`);
    }

    if (result.fallback) {
      this.logger.warn(`Using fallback for approaches (parsing completely failed)`);
    }

    this.logger.debug(`✅ Parsed ${result.data.length} approaches successfully`);
    return result.data;
  }

  /**
   * Parse variations JSON from LLM response
   */
  _parseVariations(response) {
    // Same format as approaches, use same parser
    return this._parseApproaches(response);
  }

  /**
   * Get search statistics
   */
  getSearchStats() {
    return {
      totalNodes: this.totalNodes,
      evaluatedNodes: this.evaluatedNodes,
      prunedNodes: this.prunedNodes,
      solutionsFound: this.solutions.length,
      bestScore: this.bestSolution?.score || null,
      timeElapsed: Date.now() - this.startTime,
      strategy: this.strategy,
      maxDepth: this.maxDepth,
      branchingFactor: this.branchingFactor
    };
  }

  /**
   * Export search tree for visualization
   */
  exportTree() {
    return {
      root: this.root.toJSON(),
      stats: this.getSearchStats(),
      solutions: this.solutions.map(s => s.toJSON()),
      bestSolution: this.bestSolution?.toJSON()
    };
  }
}

module.exports = TreeSearchEngine;
