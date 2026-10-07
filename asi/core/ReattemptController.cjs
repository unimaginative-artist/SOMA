// ═══════════════════════════════════════════════════════════
// FILE: asi/core/ReattemptController.cjs
// Integrated with SOMA architecture - orchestrates the full ASI loop
// ═══════════════════════════════════════════════════════════

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

/**
 * ReattemptController - Orchestrates the GENERATE → CRITIQUE → REWRITE → REFLECT loop
 *
 * Integration with SOMA:
 * - Uses Thalamus's CriticBrain (frontal lobe) for evaluation
 * - Uses RewriteBrain (routes through Thalamus)
 * - Uses SelfReflectBrain (stores in Archivist)
 * - Publishes all events through MessageBroker
 * - Can re-insert nodes into TreeSearch
 */
class ReattemptController extends EventEmitter {
  constructor(opts = {}) {
    super();

    // SOMA infrastructure
    this.thalamus = opts.thalamus; // Required - has critique() method
    this.rewrite = opts.rewriteBrain; // Required - RewriteBrain instance
    this.reflect = opts.reflectBrain; // Required - SelfReflectBrain instance
    this.sandbox = opts.sandboxRunner; // Optional but recommended
    this.tree = opts.treeSearch; // Optional - for reinsertion
    this.broker = opts.messageBroker; // Required - event bus
    this.logger = opts.logger || console;

    // Configuration
    this.maxCycles = opts.maxCycles || 3;
    this.cooldownMs = opts.cooldownMs || 250;
    this.autoApply = opts.autoApply !== false; // Default true
    this.provenanceDir = opts.provenanceDir || null;
    this.debug = !!opts.debug;
  }

  /**
   * Persist provenance for auditing
   */
  async _persistProvenance(record) {
    if (!this.provenanceDir) return;

    try {
      const dir = path.resolve(this.provenanceDir);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const fname = `attempt_${Date.now()}_${(record.nodeId || 'node').replace(/[^a-z0-9]/gi, '_')}.json`;
      const filepath = path.join(dir, fname);

      fs.writeFileSync(filepath, JSON.stringify(record, null, 2));
      this.logger.debug(`[Reattempt] Provenance saved: ${filepath}`);
    } catch (e) {
      if (this.debug) {
        this.logger.warn('[Reattempt] Persist provenance failed:', e.message);
      }
    }
  }

  /**
   * Main reattempt loop - the heart of the ASI reasoning system
   */
  async handleFailure(node, criticFeedback = {}, failingTests = [], task = null) {
    if (!this.thalamus || !this.rewrite || !this.reflect) {
      throw new Error('ReattemptController requires Thalamus, RewriteBrain, and SelfReflectBrain');
    }

    const nodeId = node.id || 'unknown';
    const cycleResults = [];

    // Publish loop start
    if (this.broker) {
      await this.broker.publish('asi.reattempt.start', {
        nodeId,
        maxCycles: this.maxCycles,
        timestamp: Date.now()
      });
    }

    this.logger.info(`[Reattempt] Starting repair loop for node ${nodeId}, max ${this.maxCycles} cycles`);

    // MAIN LOOP: REWRITE → TEST → REFLECT → REPEAT
    for (let cycle = 0; cycle < this.maxCycles; cycle++) {
      this.logger.info(`[Reattempt] 🔄 Cycle ${cycle + 1}/${this.maxCycles} for node ${nodeId}`);

      // 1. REWRITE - Fix the code using quad-brain system
      const rewriteOutcome = await this.rewrite.rewriteNode(
        node,
        criticFeedback,
        failingTests,
        { cycle }
      );

      const candidate = rewriteOutcome.best;
      if (!candidate) {
        this.logger.warn(`[Reattempt] No candidate produced in cycle ${cycle + 1}`);
        cycleResults.push({
          cycle,
          nodeId,
          status: 'no_candidate',
          timestamp: new Date().toISOString()
        });
        continue;
      }

      // 2. TEST - Run in sandbox (if not already validated)
      let sandboxRes = candidate.validation;
      if (!sandboxRes && this.sandbox && failingTests && failingTests.length > 0) {
        try {
          sandboxRes = await this.sandbox.run(candidate.code, { tests: failingTests });
          candidate.validation = sandboxRes;
        } catch (e) {
          sandboxRes = { passed: false, error: String(e) };
          candidate.validation = sandboxRes;
        }
      }

      // 3. REFLECT - Meta-analyze the attempt
      const reflection = await this.reflect.reflect({
        task,
        node,
        criticFeedback,
        sandboxResults: sandboxRes,
        repairSummary: rewriteOutcome.attempts || []
      });

      // 4. Record cycle
      const record = {
        cycle,
        nodeId,
        rewriteOutcome,
        candidate: {
          id: candidate.id,
          code: candidate.code?.substring(0, 500),
          paradigm: candidate.paradigm,
          validation: sandboxRes
        },
        reflection: {
          rootCause: reflection.rootCause,
          lessonsCount: reflection.lessons?.length || 0,
          hintsCount: reflection.patchHints?.length || 0
        },
        timestamp: new Date().toISOString()
      };

      await this._persistProvenance(record);
      cycleResults.push(record);

      // 5. Thalamus oversight - can veto candidates
      if (this.thalamus && typeof this.thalamus.evaluateCandidate === 'function') {
        try {
          const decision = await this.thalamus.evaluateCandidate(candidate, { reflection });
          if (decision && decision.veto) {
            this.logger.warn(`[Reattempt] Thalamus vetoed candidate in cycle ${cycle + 1}`);
            if (decision.abort) {
              this.logger.warn('[Reattempt] Thalamus requested abort');
              break;
            }
            continue; // Try next cycle
          }
        } catch (e) {
          this.logger.warn('[Reattempt] Thalamus oversight error:', e.message);
        }
      }

      // 6. SUCCESS - Tests passed!
      if (sandboxRes && sandboxRes.passed) {
        this.logger.info(`[Reattempt] ✅ SUCCESS in cycle ${cycle + 1}!`);

        // Auto-apply: replace in tree
        if (this.autoApply && this.tree && typeof this.tree.replaceNode === 'function') {
          try {
            await this.tree.replaceNode(nodeId, candidate);
            this.logger.info(`[Reattempt] Replaced node ${nodeId} in tree`);
          } catch (e) {
            this.logger.warn('[Reattempt] Tree replacement failed:', e.message);
          }
        }

        // Publish success
        if (this.broker) {
          await this.broker.publish('asi.reattempt.success', {
            nodeId,
            cycle: cycle + 1,
            candidate: {
              id: candidate.id,
              paradigm: candidate.paradigm
            },
            reflection: {
              rootCause: reflection.rootCause,
              lessons: reflection.lessons
            },
            timestamp: Date.now()
          });
        }

        this.emit('reattempt:success', { nodeId, candidate, cycleResults, reflection });

        return {
          success: true,
          candidate,
          cycleResults,
          reflection,
          cycles: cycle + 1
        };
      }

      // 7. FAILURE - Publish hints for next cycle
      this.logger.warn(`[Reattempt] ❌ Cycle ${cycle + 1} failed`);

      // Publish patch hints for other components
      if (this.broker && reflection.patchHints && reflection.patchHints.length > 0) {
        await this.broker.publish('asi.reattempt.hints', {
          nodeId,
          cycle: cycle + 1,
          patchHints: reflection.patchHints,
          brainRecommendations: reflection.brainRecommendations,
          timestamp: Date.now()
        });
      }

      this.emit('reattempt:cycle_complete', {
        nodeId,
        cycle: cycle + 1,
        passed: false,
        reflection
      });

      // Small cooldown before next cycle
      await new Promise(res => setTimeout(res, this.cooldownMs));
    }

    // EXHAUSTED CYCLES - All attempts failed
    this.logger.error(`[Reattempt] ❌ Failed after ${this.maxCycles} cycles for node ${nodeId}`);

    if (this.broker) {
      await this.broker.publish('asi.reattempt.failed', {
        nodeId,
        cycles: this.maxCycles,
        cycleResults,
        timestamp: Date.now()
      });
    }

    this.emit('reattempt:failed', { nodeId, cycleResults });

    return {
      success: false,
      cycleResults,
      cycles: this.maxCycles
    };
  }

  /**
   * Batch process multiple failing nodes
   */
  async handleBatch(failingNodes, critiques, tests, task) {
    const results = [];

    for (let i = 0; i < failingNodes.length; i++) {
      const node = failingNodes[i];
      const critique = critiques[i] || {};
      const nodeTests = tests[i] || tests;

      try {
        const result = await this.handleFailure(node, critique, nodeTests, task);
        results.push(result);
      } catch (e) {
        this.logger.error(`[Reattempt] Batch processing failed for node ${node.id}:`, e.message);
        results.push({
          success: false,
          error: e.message,
          nodeId: node.id
        });
      }
    }

    return results;
  }
}

module.exports = ReattemptController;
