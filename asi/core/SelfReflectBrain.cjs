// ═══════════════════════════════════════════════════════════
// FILE: asi/core/SelfReflectBrain.cjs
// Integrated with SOMA architecture - uses Archivist for memory
// ═══════════════════════════════════════════════════════════

/**
 * SelfReflectBrain - Meta-reasoning and learning from failures
 *
 * Integration with SOMA:
 * - Uses Thalamus (Analytical brain) for reflection
 * - Stores lessons in Archivist (existing memory system)
 * - Publishes insights through MessageBroker
 */
class SelfReflectBrain {
  constructor(opts = {}) {
    // SOMA infrastructure
    this.thalamus = opts.thalamus; // Required - for meta-reasoning
    this.archivist = opts.archivist; // Required - for memory storage
    this.broker = opts.messageBroker; // Required - for publishing insights
    this.logger = opts.logger || console;

    // Configuration
    this.reflectTemp = opts.reflectTemp || 0.08;
    this.maxHints = opts.maxHints || 5;
    this.debug = !!opts.debug;
  }

  /**
   * Build reflection prompt for Thalamus
   */
  _buildReflectionPrompt(context) {
    const { node, criticFeedback, sandboxResults, repairSummary } = context;

    return `You are performing meta-analysis on a failed reasoning attempt. Analyze WHY it failed and extract learnings.

CONTEXT:
- Task: ${context.task || 'Code generation'}
- Node ID: ${node.id}
- Paradigm: ${node.paradigm || node.approach?.paradigm || 'unknown'}
- Original Code: ${node.code?.substring(0, 200) || 'N/A'}...

CRITIC FEEDBACK:
${JSON.stringify(criticFeedback, null, 2)}

SANDBOX RESULTS:
${JSON.stringify(sandboxResults, null, 2)}

REPAIR ATTEMPTS:
${JSON.stringify(repairSummary, null, 2)}

ANALYSIS TASKS:
1. What was the root cause of failure? (logic error, edge case, paradigm limitation?)
2. What pattern should we learn from this?
3. Which SOMA brain would have been better for this task?
4. What hints can guide future attempts?

Return JSON:
{
  "rootCause": "specific reason for failure",
  "lessons": [
    {"id": "lesson_1", "text": "concrete learning", "severity": "high|medium|low"}
  ],
  "patchHints": [
    {"hint": "specific improvement", "target": "code|paradigm|tests"}
  ],
  "brainRecommendations": {
    "betterChoice": "analytical|technical|creative",
    "reasoning": "why that brain would be better"
  },
  "persistAsMemory": true
}

Return ONLY valid JSON:`;
  }

  /**
   * Parse reflection response robustly
   */
  _parseReflection(raw, defaultNodeId) {
    try {
      // Try direct JSON parse
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Normalize structure
        return {
          nodeId: defaultNodeId,
          rootCause: parsed.rootCause || 'unknown',
          lessons: parsed.lessons || [],
          patchHints: parsed.patchHints || [],
          brainRecommendations: parsed.brainRecommendations || {},
          persistAsMemory: parsed.persistAsMemory !== false
        };
      }
    } catch (e) {
      this.logger.warn('[SelfReflect] JSON parse failed, using defaults');
    }

    // Fallback: return minimal structure
    return {
      nodeId: defaultNodeId,
      rootCause: 'parse_failure',
      lessons: [],
      patchHints: [],
      brainRecommendations: {},
      persistAsMemory: false
    };
  }

  /**
   * Reflect on failure and extract learnings
   */
  async reflect(context = {}) {
    if (!this.thalamus) {
      throw new Error('SelfReflectBrain requires Thalamus for meta-reasoning');
    }

    const { node } = context;
    const nodeId = node?.id || 'unknown';

    // Publish reflection start
    if (this.broker) {
      await this.broker.publish('asi.reflect.start', {
        nodeId,
        timestamp: Date.now()
      });
    }

    try {
      // 1. Build reflection prompt
      const prompt = this._buildReflectionPrompt(context);

      // 2. Route to LOGOS brain (analytical - best for meta-reasoning)
      const response = await this.thalamus.route({
        brain: 'LOGOS',
        task: 'meta_reasoning',
        prompt,
        temperature: this.reflectTemp,
        context: {
          nodeId,
          type: 'reflection'
        }
      });

      // 3. Parse reflection
      const reflection = this._parseReflection(response, nodeId);

      // 4. Store in Archivist if requested
      if (this.archivist && reflection.persistAsMemory) {
        try {
          await this.archivist.addMemory({
            type: 'asi_reflection',
            nodeId,
            paradigm: node?.paradigm || node?.approach?.paradigm,
            rootCause: reflection.rootCause,
            lessons: reflection.lessons,
            patchHints: reflection.patchHints,
            brainRecommendations: reflection.brainRecommendations,
            timestamp: Date.now(),
            metadata: {
              task: context.task,
              criticFeedback: context.criticFeedback
            }
          });

          this.logger.info(`[SelfReflect] ✅ Stored ${reflection.lessons.length} lessons in Archivist`);
        } catch (e) {
          this.logger.warn('[SelfReflect] Failed to store in Archivist:', e.message);
        }
      }

      // 5. Publish reflection complete with insights
      if (this.broker) {
        await this.broker.publish('asi.reflect.complete', {
          nodeId,
          rootCause: reflection.rootCause,
          lessonsCount: reflection.lessons.length,
          hintsCount: reflection.patchHints.length,
          brainRecommendations: reflection.brainRecommendations,
          timestamp: Date.now()
        });

        // Publish specific lessons for other components to learn from
        if (reflection.lessons.length > 0) {
          await this.broker.publish('asi.reflect.lessons', {
            nodeId,
            lessons: reflection.lessons,
            timestamp: Date.now()
          });
        }

        // Publish hints for DivergentGenerator / TreeSearch
        if (reflection.patchHints.length > 0) {
          await this.broker.publish('asi.reflect.hints', {
            nodeId,
            hints: reflection.patchHints,
            timestamp: Date.now()
          });
        }
      }

      return reflection;

    } catch (error) {
      this.logger.error('[SelfReflect] Reflection failed:', error.message);

      // Publish failure
      if (this.broker) {
        await this.broker.publish('asi.reflect.failed', {
          nodeId,
          error: error.message,
          timestamp: Date.now()
        });
      }

      // Return minimal reflection
      return {
        nodeId,
        rootCause: 'reflection_error',
        lessons: [],
        patchHints: [],
        brainRecommendations: {},
        persistAsMemory: false
      };
    }
  }

  /**
   * Query Archivist for similar past failures
   */
  async queryPastLearnings(paradigm, taskType) {
    if (!this.archivist) {
      return [];
    }

    try {
      const memories = await this.archivist.query({
        type: 'asi_reflection',
        paradigm,
        metadata: { task: taskType }
      });

      return memories.map(m => ({
        rootCause: m.rootCause,
        lessons: m.lessons,
        hints: m.patchHints
      }));
    } catch (e) {
      this.logger.warn('[SelfReflect] Failed to query past learnings:', e.message);
      return [];
    }
  }
}

module.exports = SelfReflectBrain;
