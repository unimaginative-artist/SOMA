// ═══════════════════════════════════════════════════════════
// FILE: asi/core/RewriteBrain.cjs
// Integrated with SOMA architecture - uses Thalamus routing
// ═══════════════════════════════════════════════════════════

/**
 * RewriteBrain - Takes critique and produces fixed code
 *
 * Integration with SOMA:
 * - Uses Thalamus to route to appropriate brain for fixing
 * - Publishes through MessageBroker
 * - Validated through SandboxRunner
 */
class RewriteBrain {
  constructor(opts = {}) {
    // SOMA infrastructure
    this.thalamus = opts.thalamus; // Required - routes to quad-brains
    this.broker = opts.messageBroker; // Required - publishes events
    this.sandbox = opts.sandboxRunner; // Optional but recommended
    this.logger = opts.logger || console;

    // Configuration
    this.maxAttempts = opts.maxAttempts || 3;
    this.repairTemperature = opts.repairTemperature || 0.12;
    this.debug = !!opts.debug;
  }

  /**
   * Determine which SOMA brain to use for rewriting
   */
  _selectBrainForRewrite(critique, paradigm) {
    // Map to actual SOMA brain names: LOGOS, AURORA, PROMETHEUS, THALAMUS

    // Logic errors → LOGOS (Analytical)
    if (critique.bugs && critique.bugs.some(b =>
      typeof b === 'string' && (b.includes('logic') || b.includes('algorithm'))
    )) {
      return 'LOGOS';
    }

    // Performance/optimization → PROMETHEUS (Strategic/Technical)
    if (critique.bugs && critique.bugs.some(b =>
      typeof b === 'string' && (b.includes('performance') || b.includes('efficiency'))
    )) {
      return 'PROMETHEUS';
    }

    // Edge cases, creative solutions → AURORA (Creative)
    if (critique.edgeCases && critique.edgeCases.length > 0) {
      return 'AURORA';
    }

    // Default: use paradigm to choose
    if (paradigm === 'recursive' || paradigm === 'mathematical') {
      return 'LOGOS';
    }
    if (paradigm === 'functional' || paradigm === 'heuristic') {
      return 'AURORA';
    }

    return 'PROMETHEUS'; // Default fallback
  }

  /**
   * Build repair prompt for SOMA brains
   */
  _buildRepairPrompt(originalCode, critique, tests) {
    return `You are fixing broken code. Be precise and focused.

ORIGINAL CODE (with bugs):
\`\`\`javascript
${originalCode}
\`\`\`

PROBLEMS FOUND:
${critique.bugs ? `Bugs: ${critique.bugs.join(', ')}` : ''}
${critique.edgeCases ? `Missing edge cases: ${critique.edgeCases.join(', ')}` : ''}
${critique.feedback ? `Feedback: ${critique.feedback}` : ''}

FAILING TESTS:
${JSON.stringify(tests, null, 2)}

TASK: Return ONLY the fixed JavaScript code. No explanations. The code must:
1. Fix all identified bugs
2. Handle all edge cases
3. Pass all tests

Return format:
\`\`\`javascript
// Fixed code here
\`\`\``;
  }

  /**
   * Extract code from response
   */
  _extractCode(response) {
    // Ensure response is a string
    if (!response || typeof response !== 'string') {
      this.logger.warn('[RewriteBrain] Invalid response type:', typeof response);
      return null;
    }

    // Try to extract from code block
    const codeBlockMatch = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Fallback: try to find function definition
    const functionMatch = response.match(/function\s+\w+[\s\S]*?\n}/);
    if (functionMatch) {
      return functionMatch[0];
    }

    // Last resort: return cleaned response
    return response.replace(/```/g, '').trim();
  }

  /**
   * REWRITE (Generic Text Override)
   * Allows SOMArbiterV3 to fix non-code responses
   */
  async rewrite(text, feedback) {
    this.logger.debug('[RewriteBrain] Rewriting text based on critique feedback...');
    
    const prompt = `You are SOMA. Your previous response was critiqued. 
    
    PREVIOUS RESPONSE:
    "${text}"
    
    CRITIQUE FEEDBACK:
    "${feedback}"
    
    TASK: Provide a REVISED response that addresses the feedback while maintaining your personality. 
    Return ONLY the revised text. No preamble.`;

    try {
        // Route to LOGOS for logical text refinement
        const response = await this.thalamus.callBrain('LOGOS', prompt, { temperature: 0.4 });
        return { text: response.text || response };
    } catch (e) {
        this.logger.error('[RewriteBrain] Text rewrite failed:', e.message);
        return { text }; // Return original if fail
    }
  }

  /**
   * Rewrite node using SOMA infrastructure
   */
  async rewriteNode(node, criticFeedback = {}, failingTests = [], opts = {}) {
    if (!this.thalamus) {
      throw new Error('RewriteBrain requires Thalamus for brain routing');
    }

    const originalCode = node.code || node.solution?.code || '// no code';
    const paradigm = node.approach?.paradigm || node.paradigm || 'unknown';
    const attempts = [];
    let best = null;

    // Publish rewrite start
    if (this.broker) {
      await this.broker.publish('asi.rewrite.start', {
        nodeId: node.id,
        paradigm,
        timestamp: Date.now()
      });
    }

    for (let i = 0; i < this.maxAttempts; i++) {
      try {
        // 1. Select which brain to use
        const brainChoice = this._selectBrainForRewrite(criticFeedback, paradigm);

        this.logger.debug(`[RewriteBrain] Attempt ${i+1}/${this.maxAttempts}, using ${brainChoice} brain`);

        // 2. Build prompt
        const prompt = this._buildRepairPrompt(originalCode, criticFeedback, failingTests);

        // 3. Route through Thalamus to appropriate brain
        const response = await this.thalamus.route({
          brain: brainChoice,
          task: 'rewrite_code',
          prompt,
          temperature: this.repairTemperature,
          context: {
            nodeId: node.id,
            attempt: i + 1,
            originalParadigm: paradigm
          }
        });

        // 4. Extract code
        const fixedCode = this._extractCode(response);

        if (!fixedCode || fixedCode.length < 10) {
          attempts.push({
            ok: false,
            reason: 'empty_response',
            brain: brainChoice,
            attempt: i + 1
          });
          continue;
        }

        // 5. Create candidate node
        const candidateNode = {
          id: `${node.id}_repair_${i}`,
          code: fixedCode,
          paradigm: paradigm,
          provenance: {
            parent: node.id,
            method: 'rewrite',
            brain: brainChoice,
            attempt: i + 1
          }
        };

        // 6. Validate with sandbox (if available)
        let validation = { passed: null, results: null, error: null };
        if (this.sandbox && failingTests && failingTests.length > 0) {
          try {
            validation = await this.sandbox.run(fixedCode, { tests: failingTests });
          } catch (se) {
            validation.error = se.message || String(se);
            validation.passed = false;
          }
        }

        candidateNode.validation = validation;
        attempts.push({
          ok: !!validation.passed,
          node: candidateNode,
          brain: brainChoice,
          attempt: i + 1
        });

        // 7. Track best candidate
        if (!best) best = candidateNode;
        if (validation.passed && (!best.validation || !best.validation.passed)) {
          best = candidateNode;
        }

        // 8. Publish attempt result
        if (this.broker) {
          await this.broker.publish('asi.rewrite.attempt', {
            nodeId: node.id,
            attempt: i + 1,
            brain: brainChoice,
            passed: validation.passed,
            timestamp: Date.now()
          });
        }

        // 9. Early exit if passed
        if (validation.passed) {
          this.logger.info(`[RewriteBrain] ✅ Fixed code on attempt ${i+1} using ${brainChoice} brain`);
          break;
        }

      } catch (err) {
        this.logger.error(`[RewriteBrain] Attempt ${i+1} failed:`, err.message);
        attempts.push({
          ok: false,
          reason: 'exception',
          error: String(err),
          attempt: i + 1
        });
      }
    }

    // Publish final result
    if (this.broker) {
      await this.broker.publish('asi.rewrite.complete', {
        nodeId: node.id,
        success: best?.validation?.passed || false,
        attempts: attempts.length,
        timestamp: Date.now()
      });
    }

    return {
      attempts,
      best,
      nodeId: node.id,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = RewriteBrain;
