/**
 * IdeaCaptureArbiter.js
 *
 * Thin intake layer for Mode A (total capture).
 * Captures ALL inputs (text, voice metadata, file refs) and builds memory nodes.
 *
 * Responsibilities:
 *  - Accept raw inputs from any source
 *  - Build canonical MemoryNode package
 *  - Send to processing pipelines via broker
 *  - Persist to MnemonicArbiter/Storage
 *  - Create triggers for resurfacing (memory resonance)
 *  - Expose hooks for muse-generation
 *
 * Integration with SOMA:
 *  - Uses MnemonicArbiter for storage
 *  - Uses MessageBroker for event distribution
 *  - Triggers MuseEngine via 'muse.trigger' topic
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

class IdeaCaptureArbiter extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'IdeaCaptureArbiter';

    // Dependencies
    this.broker = opts.broker || opts.messageBroker;
    this.mnemonic = opts.mnemonic || opts.mnemonicArbiter; // MnemonicArbiter for storage
    this.reflections = opts.reflections;
    this.museEngine = opts.museEngine;
    this.learningPipeline = opts.learningPipeline; // UniversalLearningPipeline for learning
    this.embeddingFn = opts.embeddingFn; // async(text) => vector
    this.summarizerFn = opts.summarizerFn || this._defaultSummarize;
    this.emotionFn = opts.emotionFn || this._simpleEmotionTag;

    // Configuration
    this.impulserTopic = opts.impulserTopic || 'impulser.process';
    this.museTriggerTopic = opts.museTriggerTopic || 'muse.trigger';

    // In-memory index for quick resonance lookups
    this.embeddingIndex = new Map(); // id -> embedding
    this.resonanceBuffer = [];       // Recent nodes for resonance scanning
    this.heartbeatInterval = 400;    // 🔱 THE OMEGA PULSE: 400ms Resonance Rhythm
    this._heartbeatTimer = null;
    this._lastPulseAt = Date.now();

    this.resonanceConfig = {
      topK: 6,
      similarityThreshold: 0.65
    };

    // Statistics
    this.stats = {
      totalCaptured: 0,
      bySource: { ui: 0, voice: 0, file: 0, system: 0 },
      resonanceTriggers: 0,
      museTriggers: 0
    };

    // Wire broker subscriptions
    if (this.broker && typeof this.broker.subscribe === 'function') {
      this.broker.subscribe('idea.capture', msg => {
        this.handleRawInput(msg.payload || msg).catch(err => this.emit('error', err));
      });
    }

    console.log(`[${this.name}] Initialized - listening on 'idea.capture' topic`);
  }

  /**
   * Initialize and start the Resonance Heartbeat
   */
  async initialize() {
    console.info(`[${this.name}] Resonance Heartbeat ACTIVE (${this.heartbeatInterval}ms)`);
    
    // Start high-precision pulse loop
    this._precisePulseLoop();
    
    return true;
  }

  /**
   * Precise self-correcting pulse loop to eliminate drift
   */
  _precisePulseLoop() {
    const nextPulseIn = Math.max(0, this.heartbeatInterval - (Date.now() - this._lastPulseAt));
    
    this._heartbeatTimer = setTimeout(() => {
        if (this._lastPulseAt !== 0) { // Skip first calculation
            this._emitResonancePulse();
        } else {
            this._lastPulseAt = Date.now();
        }
        this._precisePulseLoop();
    }, nextPulseIn);
    this._heartbeatTimer.unref?.();
  }

  /**
   * The downbeat of SOMA's heartbeat.
   * Periodically emits resonance data to the CNS.
   */
  _emitResonancePulse() {
    const now = Date.now();
    const drift = now - this._lastPulseAt - this.heartbeatInterval;
    this._lastPulseAt = now;

    // Calculate Resonance Score (0.0 to 1.0)
    // Based on buffer density and system activity
    const density = Math.min(1.0, this.resonanceBuffer.length / 10);
    const resonanceScore = 0.5 + (density * 0.5); // Baseline 0.5

    const pulse = {
      timestamp: now,
      score: parseFloat(resonanceScore.toFixed(4)),
      driftMs: drift,
      bufferSize: this.resonanceBuffer.length,
      focus: 'general'
    };

    // Broadcast to the Graymatter Network / MessageBroker
    if (this.broker && typeof this.broker.publish === 'function') {
      this.broker.publish('system.resonance.pulse', pulse);
    }

    // Decay resonance buffer slowly to maintain rhythm
    if (this.resonanceBuffer.length > 0 && Math.random() > 0.7) {
        this.resonanceBuffer.shift();
    }
  }

  /**
   * Main entry point - accept raw input and process
   *
   * @param {Object} payload
   *   - text: string (required)
   *   - source: 'voice'|'ui'|'file'|'system' (default: 'ui')
   *   - sourceRef: optional reference (file ID, audio ID, etc)
   *   - voiceMeta: { pitch, rate, prosody, questionProb } for voice inputs
   *   - author: string (default: 'user')
   *   - metadata: additional metadata object
   */
  async handleRawInput(payload = {}) {
    const startTime = Date.now();
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();

    try {
      // Extract payload fields
      const text = payload.text || '';
      const source = payload.source || 'ui';
      const sourceRef = payload.sourceRef || null;
      const author = payload.author || 'user';
      const voiceMeta = payload.voiceMeta || null;

      if (!text) {
        console.warn(`[${this.name}] Empty text input ignored`);
        return { ok: false, reason: 'empty_text' };
      }

      this.stats.totalCaptured++;
      this.stats.bySource[source] = (this.stats.bySource[source] || 0) + 1;

      // 1. Generate immediate lightweight tags
      const emotion = this.emotionFn(text);
      const summary = await this.summarizerFn(text);
      const embedding = this.embeddingFn ? await this.embeddingFn(text) : null;

      // 2. Build canonical memory node
      const node = {
        id,
        createdAt: ts,
        updatedAt: ts,
        author,
        source,
        sourceRef,
        originalText: text,
        summary,
        emotion,
        embedding,
        voiceMeta,
        meta: {
          capturedBy: this.name,
          mode: 'ModeA_totalCapture',
          ...payload.metadata
        },
        relatedIds: [],
        relevance: 1.0
      };

      // 3. Persist to MnemonicArbiter
      if (this.mnemonic && typeof this.mnemonic.remember === 'function') {
        try {
          await this.mnemonic.remember(node.originalText, {
            type: 'idea_capture',
            id: id,
            createdAt: node.createdAt,
            author: node.author,
            source: node.source,
            summary: node.summary,
            emotion: node.emotion,
            ...node.meta
          });
          this.emit('stored', { id, node });
        } catch (err) {
          console.error(`[${this.name}] Failed to store node:`, err);
          this.emit('warn', { message: 'Storage failed', id, err });
        }
      }

      // 4. Notify processing pipelines via broker
      if (this.broker && typeof this.broker.publish === 'function') {
        try {
          this.broker.publish(this.impulserTopic, {
            type: 'idea_capture',
            nodeId: id,
            payload: node
          });
        } catch (err) {
          console.error(`[${this.name}] Failed to publish to impulser:`, err);
        }
      }

      // 5. Index embedding for resonance
      if (embedding) {
        this.embeddingIndex.set(id, embedding);
      }

      // 6. Run lightweight resonance scan (non-blocking)
      this._runResonance(node).catch(err => this.emit('error', err));

      // 6b. Worthy idea path: trigger Muse and seed Reflections without blocking chat.
      if (this._shouldStartReflection(node)) {
        this._startReflectionSeed(node).catch(err => this.emit('warn', {
          message: 'reflection_seed_failed',
          nodeId: node.id,
          error: err.message
        }));
      }

      // 7. Emit captured event
      this.emit('captured', { id, node });

      const elapsed = Date.now() - startTime;
      console.log(`[${this.name}] Captured idea ${id} (${elapsed}ms) - source: ${source}`);

      // Log this interaction for learning
      if (this.learningPipeline && this.learningPipeline.initialized) {
        await this.learningPipeline.logInteraction({
          type: 'idea_capture',
          agent: this.name,
          input: { text, source, voiceMeta },
          output: node,
          context: {
            emotion,
            summary,
            hasEmbedding: !!embedding
          },
          metadata: {
            success: true,
            elapsedMs: elapsed,
            author,
            sourceType: source
          }
        });
      }

      return { ok: true, id, node, elapsedMs: elapsed };

    } catch (err) {
      console.error(`[${this.name}] Error in handleRawInput:`, err);
      this.emit('error', err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Handle file upload
   */
  async handleFileUpload(payload = {}) {
    const text = payload.notes || `Uploaded file: ${payload.filename} (${payload.mime})`;
    return this.handleRawInput({
      text,
      source: 'file',
      sourceRef: payload.fileRef,
      author: payload.author || 'user',
      metadata: {
        filename: payload.filename,
        mime: payload.mime,
        size: payload.size
      }
    });
  }

  /**
   * Handle voice input with prosody metadata
   */
  async handleVoiceInput(payload = {}) {
    const vm = payload.voiceMeta || {};
    const text = payload.text || payload.transcript || '';

    // Classify voice intention
    const voiceTag = {
      prosody: vm,
      detectedIntention: vm.questionProb > 0.6 ? 'question-like' : 'statement-like',
      excitement: vm.excitement || 0.5,
      curiosity: vm.curiosity || 0.5
    };

    const result = await this.handleRawInput({
      text,
      source: 'voice',
      sourceRef: payload.audioRef || null,
      author: payload.author || 'user',
      voiceMeta: voiceTag
    });

    // Emit voice-specific event
    if (result.ok) {
      this.emit('voice:captured', { nodeId: result.id, voiceTag });
    }

    return result;
  }

  /**
   * Internal: Run resonance scan to find related memories
   */
  async _runResonance(node) {
    if (!node.embedding || !this.embeddingIndex.size) return;

    const results = [];

    // Calculate similarity with all indexed embeddings
    for (const [id, emb] of this.embeddingIndex.entries()) {
      if (id === node.id) continue;

      const score = this._cosineSimilarity(node.embedding, emb);
      results.push({ id, score });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Filter by threshold and take top K
    const matches = results
      .filter(r => r.score >= this.resonanceConfig.similarityThreshold)
      .slice(0, this.resonanceConfig.topK);

    if (matches.length > 0) {
      // Update relatedIds
      node.relatedIds = matches.map(m => m.id);
      node.updatedAt = new Date().toISOString();

      // Update in mnemonic if possible
      if (this.mnemonic && typeof this.mnemonic.remember === 'function') {
        try {
          await this.mnemonic.remember(node.originalText, {
            type: 'idea_capture',
            id: node.id,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            author: node.author,
            source: node.source,
            summary: node.summary,
            emotion: node.emotion,
            relatedIds: node.relatedIds,
            ...node.meta
          });
        } catch (err) {
          this.emit('warn', { message: 'Failed updating relatedIds', nodeId: node.id, err });
        }
      }

      // Emit resonance event
      this.emit('resonance', { node, matches });
      this.stats.resonanceTriggers++;

      // Trigger muse engine
      if (this.broker && typeof this.broker.publish === 'function') {
        try {
          this.broker.publish(this.museTriggerTopic, {
            nodeId: node.id,
            matches,
            node
          });
          this.stats.museTriggers++;
        } catch (err) {
          console.error(`[${this.name}] Failed to trigger muse:`, err);
        }
      }
    }
  }

  _shouldStartReflection(node) {
    const text = node?.originalText || '';
    if (text.length < 80) return false;
    if (node?.meta?.skipReflection) return false;
    if (node?.source && ['system', 'file'].includes(node.source)) return false;
    return /\b(idea|what if|maybe|should|architecture|design|reflection|muse|story|chapter|research|hypothesis|improve|build|create|discover|plan|next)\b/i.test(text);
  }

  async _startReflectionSeed(node) {
    const title = this._titleFromText(node.originalText);
    const payload = {
      nodeId: node.id,
      node,
      matches: [],
      source: 'idea_capture_reflection_seed',
      persistReflection: true
    };

    if (this.broker && typeof this.broker.publish === 'function') {
      await this.broker.publish(this.museTriggerTopic, payload);
      this.stats.museTriggers++;
      return { ok: true, mode: 'muse_trigger' };
    }

    if (this.museEngine && typeof this.museEngine._onTrigger === 'function') {
      await this.museEngine._onTrigger(payload);
      this.stats.museTriggers++;
      return { ok: true, mode: 'muse_direct' };
    }

    if (this.reflections && typeof this.reflections.appendQuickNote === 'function') {
      await this.reflections.appendQuickNote(node.originalText, {
        title,
        context: 'idea-capture-reflection-seed',
        source: 'IdeaCaptureArbiter',
        tags: ['idea-capture', 'muse-pending']
      });
      return { ok: true, mode: 'reflection_seed' };
    }

    return { ok: false, reason: 'no_muse_or_reflections' };
  }

  _titleFromText(text = '') {
    const cleaned = String(text)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);
    return cleaned || 'Captured Idea';
  }

  /**
   * Quick semantic search over local index
   */
  async quickSearchByText(text, topK = 8) {
    if (!this.embeddingFn) {
      throw new Error('Embedding function not configured');
    }

    const queryEmbedding = await this.embeddingFn(text);
    const results = [];

    for (const [id, emb] of this.embeddingIndex.entries()) {
      const score = this._cosineSimilarity(queryEmbedding, emb);
      results.push({ id, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Fetch full nodes by IDs (for muse engine context)
   */
  async fetchNodesContext(ids = []) {
    const nodes = [];

    for (const id of ids) {
      try {
        if (this.mnemonic && typeof this.mnemonic.retrieve === 'function') {
          const node = await this.mnemonic.retrieve(id);
          if (node) nodes.push(node);
        }
      } catch (err) {
        console.warn(`[${this.name}] Failed to fetch node ${id}:`, err);
      }
    }

    return nodes;
  }

  /**
   * Configure resonance parameters
   */
  setResonanceConfig(cfg = {}) {
    this.resonanceConfig = { ...this.resonanceConfig, ...cfg };
    console.log(`[${this.name}] Resonance config updated:`, this.resonanceConfig);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      embeddingIndexSize: this.embeddingIndex.size
    };
  }

  /**
   * Default summarizer (simple truncate)
   */
  async _defaultSummarize(text) {
    if (!text) return '';
    const trimmed = text.trim();
    const firstSentence = trimmed.split(/[.?!]\s/)[0];
    return firstSentence.length < 200 ? firstSentence : trimmed.slice(0, 200) + '…';
  }

  /**
   * Simple emotion tagger
   */
  _simpleEmotionTag(text) {
    if (!text) return 'neutral';

    const t = text.toLowerCase();

    if (/\b(angry|annoy|hate|frustrat)\b/.test(t)) return 'angry';
    if (/\b(happy|love|joy|excite|yay)\b/.test(t)) return 'joyful';
    if (/\b(sad|depress|lonely)\b/.test(t)) return 'sad';
    if (/\b(wonder|curious|what if|imagine)\b/.test(t)) return 'curious';
    if (/\b(worried|anxious|concern|nervous)\b/.test(t)) return 'anxious';

    return 'neutral';
  }

  /**
   * Cosine similarity helper
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Shutdown cleanup
   */
  shutdown() {
    console.log(`[${this.name}] Shutting down...`);
    this.embeddingIndex.clear();
    this.removeAllListeners();
  }
}

export { IdeaCaptureArbiter };
