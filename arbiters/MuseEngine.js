/**
 * MuseEngine.js
 *
 * Creative muse engine that generates Spark/Variant/Critique responses.
 * Subscribes to 'muse.trigger' events from IdeaCaptureArbiter.
 * Uses AURORA brain from QuadBrain for creative generation.
 *
 * Generates three types of creative responses:
 *  - SPARK: Short, surprising, inspirational angle (<=60 words)
 *  - VARIANT: Concrete alternative implementation with rationale
 *  - CRITIQUE: Top 3 failure modes/assumptions with mitigations
 *
 * Publishes results to 'muse.response' topic for UI/TTS consumption.
 */

import { EventEmitter } from 'events';

class MuseEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'MuseEngine';

    // Dependencies
    this.broker = opts.broker || opts.messageBroker;
    this.ideaCapture = opts.ideaCapture; // IdeaCaptureArbiter for context fetching
    this.reflections = opts.reflections; // ReflectionsArbiter for durable concept artifacts
    this.quadBrain = opts.quadBrain; // SOMArbiterV2_QuadBrain for AURORA access
    this.learningPipeline = opts.learningPipeline; // UniversalLearningPipeline for learning

    // Configuration
    this.museTriggerTopic = opts.museTriggerTopic || 'muse.trigger';
    this.museResponseTopic = opts.museResponseTopic || 'muse.response';
    this.maxContextNodes = opts.maxContextNodes || 6;
    this.debug = opts.debug || false;

    // Storage for recent sparks
    this.sparks = [];
    this.maxSparks = 50; // Keep last 50 sparks

    // Statistics
    this.stats = {
      totalTriggers: 0,
      totalResponses: 0,
      avgResponseTime: 0,
      responsesByType: {
        spark: 0,
        variant: 0,
        critique: 0
      }
    };

    // Wire broker subscriptions
    if (this.broker && typeof this.broker.subscribe === 'function') {
      this.broker.subscribe(this.museTriggerTopic, msg => {
        this._onTrigger(msg.payload || msg).catch(e => this.emit('error', e));
      });
      
      // Listen for distilled principles from DreamArbiter (Dream-to-Creativity Bridge)
      this.broker.subscribe('distilled:principle', msg => {
        this._handleDistilledPrinciple(msg.payload || msg).catch(e => this.emit('error', e));
      });
    }

    // Also listen to direct events from IdeaCaptureArbiter
    if (this.ideaCapture) {
      this.ideaCapture.on('resonance', data => {
        this._onTrigger(data).catch(e => this.emit('error', e));
      });
    }

    console.log(`[${this.name}] Initialized - listening on '${this.museTriggerTopic}' topic`);
  }

  /**
   * Handle muse trigger event
   */
  async _onTrigger(msg = {}) {
    const startTime = Date.now();
    this.stats.totalTriggers++;

    try {
      // Extract node ID and matches
      const nodeId = msg.nodeId || (msg.node && msg.node.id);
      const matches = msg.matches || [];
      const node = msg.node || null;

      if (!nodeId) {
        console.warn(`[${this.name}] muse.trigger missing nodeId`);
        return;
      }

      // Build context IDs: main node + top related matches
      const relatedIds = [nodeId].concat(
        matches.slice(0, this.maxContextNodes - 1).map(m => m.id)
      );

      // Fetch full context nodes
      let contexts = [];
      if (this.ideaCapture && typeof this.ideaCapture.fetchNodesContext === 'function') {
        contexts = await this.ideaCapture.fetchNodesContext(relatedIds);
      } else if (node) {
        contexts = [node]; // Fallback to just the trigger node
      }

      if (contexts.length === 0) {
        console.warn(`[${this.name}] No context available for node ${nodeId}`);
        return;
      }

      // Merge contexts into compact prompt context
      const contextText = this._buildContextText(contexts);

      // Generate three muse responses: Spark, Variant, Critique
      const [spark, variant, critique] = await Promise.all([
        this._generateSpark(contextText),
        this._generateVariant(contextText),
        this._generateCritique(contextText)
      ]);
      const failed = [spark, variant, critique].filter(response => response?.failed || !String(response?.text || '').trim());
      if (failed.length > 0) {
        throw new Error(`Muse generation unavailable for ${failed.length}/3 response types: ${failed.map(item => item?.error || 'empty model response').join('; ')}`);
      }

      // Build response payload
      const payload = {
        nodeId,
        timestamp: new Date().toISOString(),
        responses: {
          spark: spark.text || spark,
          variant: variant.text || variant,
          critique: critique.text || critique
        },
        confidence: {
          spark: Number.isFinite(Number(spark.confidence)) ? Number(spark.confidence) : 0,
          variant: Number.isFinite(Number(variant.confidence)) ? Number(variant.confidence) : 0,
          critique: Number.isFinite(Number(critique.confidence)) ? Number(critique.confidence) : 0
        },
        contextIds: relatedIds,
        elapsedMs: Date.now() - startTime
      };

      // Publish to muse.response topic
      if (this.broker && typeof this.broker.publish === 'function') {
        this.broker.publish(this.museResponseTopic, payload);
      }

      // Emit local event
      this.emit('muse:response', payload);

      // Store spark for retrieval
      this.sparks.unshift({
        id: `spark-${Date.now()}`,
        nodeId,
        creative_spark: payload.responses.spark,
        principle: contextText.slice(0, 100) + '...',
        variant: payload.responses.variant,
        critique: payload.responses.critique,
        timestamp: payload.timestamp,
        confidence: payload.confidence.spark
      });
      if (this.sparks.length > this.maxSparks) {
        this.sparks = this.sparks.slice(0, this.maxSparks);
      }

      if (msg.persistReflection !== false && this.reflections?.saveMuseSessionArtifact) {
        this.reflections.saveMuseSessionArtifact({
          title: this._titleFromContext(contexts[0], nodeId),
          chatLog: contexts.map(c => c.originalText || c.summary || '').filter(Boolean).join('\n\n---\n\n'),
          structured: {
            spark: payload.responses.spark,
            variant: payload.responses.variant,
            critique: payload.responses.critique,
            crystallize: payload.responses.variant || payload.responses.spark
          },
          metadata: {
            source: 'MuseEngine',
            nodeId,
            contextIds: relatedIds,
            tags: ['idea-capture', 'muse', 'autonomous-reflection']
          }
        }).catch(e => console.warn(`[${this.name}] Reflection save failed: ${e.message}`));
      }

      // Update stats
      this.stats.totalResponses++;
      this.stats.responsesByType.spark++;
      this.stats.responsesByType.variant++;
      this.stats.responsesByType.critique++;
      this.stats.avgResponseTime = (
        (this.stats.avgResponseTime * (this.stats.totalResponses - 1) + payload.elapsedMs) /
        this.stats.totalResponses
      );

      if (this.debug) {
        this.emit('debug:muse', { payload });
      }

      console.log(`[${this.name}] Generated muse responses for ${nodeId} (${payload.elapsedMs}ms)`);

      // Log this interaction for learning
      if (this.learningPipeline && this.learningPipeline.initialized) {
        await this.learningPipeline.logInteraction({
          type: 'creative_generation',
          agent: this.name,
          input: { nodeId, contextText, relatedIds },
          output: payload.responses,
          context: {
            contextIds: relatedIds,
            contextsUsed: contexts.length
          },
          metadata: {
            success: true,
            elapsedMs: payload.elapsedMs,
            avgConfidence: (payload.confidence.spark + payload.confidence.variant + payload.confidence.critique) / 3,
            responseTypes: ['spark', 'variant', 'critique']
          }
        });
      }

      return payload;

    } catch (err) {
      console.error(`[${this.name}] Error in _onTrigger:`, err);
      if (this.listenerCount('error') > 0) this.emit('error', err);
      return { success: false, error: err.message, nodeId: msg.nodeId || msg.node?.id || null };
    }
  }

  /**
   * Handle distilled principles from DreamArbiter
   * This bridges the gap between Dream Consolidation and Creativity.
   */
  async _handleDistilledPrinciple(msg) {
    const principle = msg.principle;
    if (!principle) return;

    console.log(`[${this.name}] 🎨 Received inspiration from dream: "${principle.slice(0, 50)}..."`);

    try {
        const prompt = `You are AURORA. A deep insight has bubbled up from SOMA's subconscious dreams:
        "${principle}"
        
        Turn this abstract principle into a CONCRETE CREATIVE PROJECT IDEA or experiment.
        Be wild, specific, and inspiring. Max 50 words.`;

        const spark = await this._callAurora(prompt, { style: 'dream_spark', maxTokens: 100 });
        if (spark.failed || !String(spark.text || '').trim()) {
          throw new Error(spark.error || 'AURORA returned no dream-spark text');
        }

        // Publish the creative result
        const payload = {
            source: 'dream_distillation',
            principle: principle,
            creative_spark: spark.text,
            timestamp: new Date().toISOString()
        };

        if (this.broker) {
            this.broker.publish('muse.dream_spark', payload);
        }
        
        // Also emit local event for UI
        this.emit('muse:dream_spark', payload);
        
        // Log it
        console.log(`[${this.name}] ✨ Generated dream spark: "${spark.text.slice(0, 50)}..."`);

    } catch (err) {
        console.error(`[${this.name}] Error handling dream principle:`, err);
    }
  }

  /**
   * Build context text from memory nodes
   */
  _buildContextText(contexts) {
    return contexts.map((n, i) => {
      return `[${i + 1}] ID: ${n.id}
Summary: ${n.summary || (n.originalText && n.originalText.slice(0, 200)) || '(no summary)'}
Emotion: ${n.emotion || 'neutral'}
${(n.relatedIds && n.relatedIds.length) ? `Related: ${n.relatedIds.slice(0, 3).join(', ')}` : ''}
`;
    }).join('\n---\n');
  }

  _titleFromContext(node, fallback = 'Muse Reflection') {
    const raw = node?.summary || node?.originalText || fallback;
    return String(raw).replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
  }

  /**
   * Generate SPARK response (short inspirational angle)
   */
  async _generateSpark(contextText) {
    const prompt = `You are AURORA, SOMA's creative muse.

Read the CONTEXT below and produce ONE short, sharp, inspirational SPARK.
A spark is a surprising, actionable insight or angle that opens new possibilities.

REQUIREMENTS:
- Maximum 60 words
- Be surprising but grounded
- Actionable, not vague
- One clear idea

CONTEXT:
${contextText}

SPARK:`;

    return await this._callAurora(prompt, { style: 'spark', maxTokens: 150 });
  }

  /**
   * Generate VARIANT response (concrete alternative)
   */
  async _generateVariant(contextText) {
    const prompt = `You are AURORA, SOMA's creative muse.

Read the CONTEXT and produce ONE concrete VARIANT: an alternate implementation or reframe.

REQUIREMENTS:
- Provide a clear alternative approach
- Include brief rationale (why this might be better)
- Suggest one specific prototyping step
- Be technical when appropriate
- Keep it concise (200-300 words)

CONTEXT:
${contextText}

VARIANT:`;

    return await this._callAurora(prompt, { style: 'variant', maxTokens: 400 });
  }

  /**
   * Generate CRITIQUE response (failure modes + mitigations)
   */
  async _generateCritique(contextText) {
    const prompt = `You are AURORA, SOMA's creative muse.

Read the CONTEXT and produce a concise CRITIQUE.

REQUIREMENTS:
- List top 3 realistic failure modes or risky assumptions
- For each, provide one brief mitigation strategy
- Be constructive, not pessimistic
- Keep it practical and actionable

CONTEXT:
${contextText}

CRITIQUE (3 failure modes with mitigations):`;

    return await this._callAurora(prompt, { style: 'critique', maxTokens: 350 });
  }

  /**
   * Call AURORA brain via QuadBrain
   */
  async _callAurora(prompt, opts = {}) {
    try {
      if (!this.quadBrain) {
        return {
          text: '',
          confidence: 0,
          failed: true,
          error: 'QuadBrain is unavailable'
        };
      }

      // Call AURORA brain directly
      const response = await this.quadBrain.callBrain('AURORA', prompt, {
        mode: 'creative',
        style: opts.style
      }, 'full');

      return {
        text: response.text || '',
        confidence: Number.isFinite(Number(response.confidence)) ? Number(response.confidence) : 0,
        brain: response.brain,
        failed: !String(response.text || '').trim()
      };

    } catch (err) {
      console.error(`[${this.name}] Error calling AURORA:`, err);
      return {
        text: '',
        confidence: 0,
        failed: true,
        error: err.message
      };
    }
  }

  /**
   * Public API: manually request muse for a node
   */
  async requestMuseForNode(nodeId, matches = []) {
    return this._onTrigger({ nodeId, matches });
  }

  /**
   * Get statistics
   */
  getStats() {
    return this.stats;
  }

  /**
   * Get recent sparks for UI display
   */
  getSparks() {
    return this.sparks;
  }

  /**
   * Shutdown cleanup
   */
  shutdown() {
    console.log(`[${this.name}] Shutting down...`);
    this.removeAllListeners();
  }
}

export { MuseEngine };
