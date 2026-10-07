/**
 * SOMArbiterV2_ASI.js
 *
 * ASI-Enhanced SOMA Arbiter with integrated CriticBrain frontal lobe
 *
 * Extends SOMArbiterV2_QuadBrain with:
 * - CriticBrain as frontal lobe (self-critique before responding)
 * - Integration with RewriteBrain, SelfReflectBrain, ReattemptController
 * - Full ASI reasoning loop for complex tasks
 * - Seamless fallback to standard quad-brain for simple tasks
 */

import { SOMArbiterV2_QuadBrain } from './SOMArbiterV2_QuadBrain.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ASI Components
const RewriteBrain = require('../asi/core/RewriteBrain.cjs');
const SelfReflectBrain = require('../asi/core/SelfReflectBrain.cjs');
const ReattemptController = require('../asi/core/ReattemptController.cjs');
const TreeSearchEngine = require('../asi/core/TreeSearchEngine.cjs');
const DivergentGenerator = require('../asi/core/DivergentGenerator.cjs');
const RecombinationEngine = require('../asi/core/RecombinationEngine.cjs');
const SolutionEvaluator = require('../asi/evaluation/SolutionEvaluator.cjs');
const SandboxRunner = require('../asi/execution/SandboxRunner.cjs');
const PerformancePredictor = require('../asi/meta/PerformancePredictor.cjs');

class SOMArbiterV2_ASI extends SOMArbiterV2_QuadBrain {
  constructor(opts = {}) {
    super(opts);

    this.name = 'SOMArbiterV2_ASI';

    // Advanced Reasoning Dependencies
    this.reasoning = opts.reasoning; // ReasoningChamber instance

    // ASI Configuration
    this.asiEnabled = opts.asiEnabled !== false; // Default enabled
    this.asiThreshold = opts.asiThreshold || 0.7; // Complexity threshold for ASI
    this.criticEnabled = opts.criticEnabled !== false; // CriticBrain frontal lobe

    // Initialize ASI components if enabled
    if (this.asiEnabled) {
      this._initializeASI(opts);
    }

    console.log(`[${this.name}] Initialized with ASI capabilities`);
    console.log(`  ASI Enabled: ${this.asiEnabled}`);
    console.log(`  CriticBrain (frontal lobe): ${this.criticEnabled}`);
    if (this.reasoning) console.log(`  🧩 ReasoningChamber: CONNECTED`);
  }

  _initializeASI(opts) {
    // Sandbox for code execution
    this.sandbox = new SandboxRunner({
      logger: console,
      timeout: 5000
    });

    // Evaluator for solutions
    this.evaluator = new SolutionEvaluator({
      sandbox: this.sandbox,
      logger: console
    });

    // Performance Predictor
    this.performancePredictor = new PerformancePredictor({
      archivist: this.mnemonic,
      logger: console
    });
    this.performancePredictor.initialize();

    // Rewrite Brain (uses quad-brain routing)
    this.rewriteBrain = new RewriteBrain({
      thalamus: this, // Routes through quad-brain system
      messageBroker: this.messageBroker,
      sandboxRunner: this.sandbox,
      logger: console
    });

    // Self-Reflect Brain (uses Archivist)
    this.reflectBrain = new SelfReflectBrain({
      thalamus: this,
      archivist: this.mnemonic, // Use Mnemonic as memory store
      messageBroker: this.messageBroker,
      logger: console
    });

    // Reattempt Controller (orchestrates the loop)
    this.reattemptController = new ReattemptController({
      thalamus: this,
      rewriteBrain: this.rewriteBrain,
      reflectBrain: this.reflectBrain,
      sandboxRunner: this.sandbox,
      messageBroker: this.messageBroker,
      logger: console,
      maxCycles: 3,
      provenanceDir: './asi/provenance'
    });

    // Tree Search Engine (for complex reasoning)
    this.treeSearch = new TreeSearchEngine({
      maxDepth: 2,
      branchingFactor: 6,
      strategy: 'beam',
      evaluator: this.evaluator,
      reasoningChamber: this.reasoning, // Pass reasoning chamber
      causalityArbiter: this.causalityArbiter, // Pass causality arbiter
      llm: {
        generate: (prompt, opts) => this._llmGenerate(prompt, opts)
      },
      logger: console,
      useCognitiveDiversity: true
    });

    console.log(`[${this.name}] ASI components initialized`);
  }

  /**
   * FRONTAL LOBE: CriticBrain function
   * Self-critique before responding to user
   */
  async _critique(response, originalQuery, context = {}) {
    if (!this.criticEnabled) {
      return {
        passed: true,
        score: 1.0,
        feedback: 'Critic disabled',
        suggestions: []
      };
    }

    try {
      // Use LOGOS brain (analytical) for self-critique
      const critiquePrompt = `You are a CRITIC reviewing a response before it's sent to the user.

USER QUERY:
${originalQuery}

PROPOSED RESPONSE:
${response}

CRITIQUE TASKS:
1. Is the response accurate and helpful?
2. Are there any errors or inconsistencies?
3. Are there missing details the user might need?
4. Could the response be clearer or more concise?

Return JSON:
{
  "passed": true|false,
  "score": 0.0-1.0,
  "feedback": "overall assessment",
  "bugs": ["list of errors if any"],
  "suggestions": ["list of improvements"],
  "edgeCases": ["missing considerations"]
}

Return ONLY valid JSON:`;

      const critiqueResult = await this.callBrain('LOGOS', critiquePrompt, {
        temperature: 0.1, // Very focused
        context: { role: 'critic', ...context }
      });

      // Extract text from result
      const critiqueResponse = critiqueResult.text || critiqueResult;

      // PARSE CRITIQUE (ROBUST)
      let critiqueText = critiqueResponse;
      
      // Remove markdown fences if present
      const fenceMatch = critiqueText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
          critiqueText = fenceMatch[1];
      }
      
      // Find JSON object
      const jsonMatch = critiqueText.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const critique = JSON.parse(jsonMatch[0]);

        // Publish critique result
        if (this.messageBroker) {
          await this.messageBroker.publish('soma.critique', {
            query: originalQuery.substring(0, 100),
            passed: critique.passed,
            score: critique.score,
            timestamp: Date.now()
          });
        }

        return critique;
      }

      // Fallback: assume pass
      return {
        passed: true,
        score: 0.8,
        feedback: 'Critique parse failed',
        suggestions: []
      };

    } catch (error) {
      console.warn(`[${this.name}] Critique failed:`, error.message);
      return {
        passed: true, // Fail open
        score: 0.5,
        feedback: `Critique error: ${error.message}`,
        suggestions: []
      };
    }
  }

  /**
   * Determine if query is complex enough for ASI loop
   */
  _shouldUseASI(query, sessionContext = {}) {
    // Check for code generation requests
    if (query.match(/write|generate|create.*function|implement|code|algorithm/i)) {
      return true;
    }

    // Check for complex reasoning requests
    if (query.match(/solve|figure out|analyze|debug|optimize|refactor/i)) {
      return true;
    }

    // Check session history for repeated failures
    if (sessionContext.failureCount && sessionContext.failureCount > 1) {
      return true;
    }

    return false;
  }

  /**
   * ASI Reasoning Loop for complex tasks
   */
  async _asiLoop(query, sessionContext = {}) {
    console.log(`[${this.name}] 🧠 Triggering ASI reasoning loop`);

    try {
      // 1. Predict performance and select strategy
      const prediction = await this.performancePredictor.predict(query, sessionContext);
      
      if (!prediction.useASI) {
          console.log(`[${this.name}] ⏩ Predictor suggests standard QuadBrain is sufficient.`);
          return null;
      }

      console.log(`[${this.name}] 🎯 Predictor selected strategy: ${prediction.recommendedStrategy} (est. success: ${(prediction.successProbability * 100).toFixed(0)}%)`);

      // Convert query to problem format (simple string for now)
      // TreeSearch will handle the formatting internally
      const problem = query;

      // Update tree search strategy
      this.treeSearch.strategy = prediction.recommendedStrategy;

      // Run tree search with cognitive diversity
      const result = await this.treeSearch.search(problem);

      if (result.success && result.solution) {
        // Record outcome for predictor learning
        this.performancePredictor.recordOutcome(prediction.metadata.problemType, result.solution.score);
        
        // Solution found!
        console.log(`[${this.name}] ✅ ASI found solution (score: ${result.solution.score})`);

        // If score is low, trigger reattempt loop
        if (result.solution.score < 0.7) {
          console.log(`[${this.name}] Score low, triggering reattempt loop...`);

          const critique = await this._critique(
            result.solution.code || result.solution.solution,
            query
          );

          const improved = await this.reattemptController.handleFailure(
            result.solution,
            critique,
            [], // No tests for now
            query
          );

          if (improved.success) {
            return {
              response: improved.candidate.code || improved.candidate.solution,
              method: 'asi_reattempt',
              stats: {
                nodesExplored: result.stats.totalNodes,
                cycles: improved.cycles,
                finalScore: improved.candidate.validation?.passed ? 1.0 : improved.candidate.score
              }
            };
          }
        }

        return {
          response: result.solution.code || result.solution.solution,
          method: 'asi_tree_search',
          stats: result.stats
        };
      }

      // ASI failed, fallback to standard quad-brain
      console.warn(`[${this.name}] ASI failed, falling back to quad-brain`);
      return null;

    } catch (error) {
      console.error(`[${this.name}] ASI loop error:`, error.message);
      return null;
    }
  }

  /**
   * Enhanced query processing with ASI integration
   */
  async processQuery(query, sessionId = null, options = {}) {
    const sessionContext = this.sessions.get(sessionId) || {};

    // 1. Check if we should use ASI loop
    const useASI = this.asiEnabled && this._shouldUseASI(query, sessionContext);

    if (useASI) {
      // Try ASI loop first
      const asiResult = await this._asiLoop(query, sessionContext);
      if (asiResult) {
        // ASI succeeded, apply frontal lobe critique
        if (this.criticEnabled) {
          const critique = await this._critique(asiResult.response, query);

          // If critique fails, try to fix
          if (!critique.passed && critique.suggestions.length > 0) {
            console.log(`[${this.name}] Frontal lobe critique suggests improvements`);
            // Could trigger another rewrite cycle here
          }
        }

        return {
          response: asiResult.response,
          sessionId,
          method: asiResult.method,
          stats: asiResult.stats
        };
      }
    }

    // 2. Standard quad-brain processing
    const response = await super.reason(query, options);

    // CHECK FOR DELEGATION (New Feature)
    if (response.result && response.method === 'delegated' && response.delegateTo) {
        console.log(`[${this.name}] 🔀 Delegation requested to brain: ${response.delegateTo}`);
        
        // Execute delegated call
        const delegatedResult = await this.callBrain(response.delegateTo, query, {
            temperature: 0.7, // Allow creativity for delegated tasks
            context: { ...options.context, delegated: true }
        });
        
        return {
            response: delegatedResult.text || delegatedResult,
            sessionId,
            method: `delegated_${response.delegateTo.toLowerCase()}`,
            brain: response.delegateTo,
            confidence: response.confidence
        };
    }

    // 3. Apply frontal lobe critique even for standard responses
    if (this.criticEnabled && response && response.text) {
      const critique = await this._critique(response.text, query);

      if (!critique.passed) {
        console.warn(`[${this.name}] Frontal lobe flagged response (score: ${critique.score})`);
        // Could enhance response based on critique
        response.critiqueScore = critique.score;
        response.critiqueFeedback = critique.feedback;
      }
    }

    // Return in consistent format
    return {
      response: response.text || response,
      sessionId,
      method: 'quad_brain',
      brain: response.brain,
      confidence: response.confidence,
      critiqueScore: response.critiqueScore,
      critiqueFeedback: response.critiqueFeedback
    };
  }

  /**
   * Helper to generate text using quad-brain (for ASI components)
   */
  async _llmGenerate(prompt, opts = {}) {
    const brain = opts.role === 'critic' ? 'LOGOS' :
                 opts.role === 'creative' ? 'AURORA' :
                 opts.role === 'strategic' ? 'PROMETHEUS' : 'LOGOS';

    const response = await this.callBrain(brain, prompt, {
      temperature: opts.temperature || 0.7,
      maxTokens: opts.maxTokens || 2048
    });

    // ASI components expect just the text string, not the full response object
    return response.text || response;
  }

  /**
   * Route to specific brain (for RewriteBrain integration)
   */
  async route({ brain, task, prompt, temperature, context }) {
    const brainName = brain.toUpperCase();

    if (!this.BRAINS[brainName]) {
      throw new Error(`Unknown brain: ${brainName}`);
    }

    const result = await this.callBrain(brainName, prompt, {
      temperature,
      context
    });

    // ASI components expect just the text, not the full result object
    return result.text || result;
  }
}

export default SOMArbiterV2_ASI;
