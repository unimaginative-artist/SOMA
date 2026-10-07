/**
 * UniversalLearningPipeline.js - SOMA's Central Learning System
 *
 * THE BRAIN STEM - Observes everything; learns only from verified outcomes
 *
 * This arbiter acts as middleware that:
 * 1. Intercepts ALL interactions
 * 2. Logs to ExperienceReplayBuffer
 * 3. Records to OutcomeTracker
 * 4. Stores to MnemonicArbiter
 * 5. Feeds AdaptiveLearningPlanner
 * 6. Triggers nighttime learning updates
 *
 * Captures everything as observation, while reinforcement and distilled lessons
 * require evidence outside the generating model:
 * - User queries and responses
 * - Arbiter decisions
 * - Task outcomes
 * - Error patterns
 * - Performance metrics
 * - Self-modification results
 */

import EventEmitter from 'events';
import { createRequire } from 'module';
import ExperienceReplayBuffer from './ExperienceReplayBuffer.js';
import OutcomeTracker from './OutcomeTracker.js';

const require = createRequire(import.meta.url);
const { defaultLearningSpine } = require('../core/LearningSpine.cjs');

export class UniversalLearningPipeline extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'UniversalLearningPipeline';
    this.config = config; // Store config for later use
    this.messageBroker = config.messageBroker || null;
    this.outcomeTruth = config.outcomeTruth || null;

    // Connected arbiters
    this.mnemonicArbiter = null;
    this.adaptivePlanner = null;
    this.adaptiveRouter = config.adaptiveRouter || null;
    this.fragmentRegistry = config.fragmentRegistry || null;
    this.tribrain = null;
    this._truthResolutionListener = null;
    this._truthInFlight = new Set();
    this.truthConsumerId = config.truthConsumerId || 'universal_learning_pipeline_v1';

    // Learning systems — accept injected instances to avoid duplicate timers/files.
    // If a shared outcomeTracker already exists (from cognitive.js early boot), use it.
    this.experienceBuffer = config.experienceBuffer || new ExperienceReplayBuffer({
      maxSize: config.maxExperiences || 2000, // Reduced from 10K (each experience ~1KB = 2MB max)
      minSize: config.minExperiences || 2,
      priorityAlpha: 0.7
    });

    this.outcomeTracker = config.outcomeTracker || new OutcomeTracker({
      storageDir: config.storageDir || process.cwd() + '/.soma/outcomes',
      enablePersistence: true,
      persistInterval: 60000 // 1 minute (was 30s — was creating zombie timer when tracker got replaced)
    });

    // Interaction log — capped at 1000 entries (was 10000, each entry could be ~84KB = 840MB max)
    this.interactionLog = [];
    this.maxLogSize = config.maxLogSize || 1000;

    // Stats
    this.stats = {
      totalInteractions: 0,
      totalExperiences: 0,
      totalOutcomes: 0,
      totalMemories: 0,
      learningRate: 0,
      lastLearningSession: null
    };

    // Learning triggers
    this.learningTriggers = {
      experienceThreshold: config.experienceThreshold || 100, // Learn after N experiences
      timeThreshold: config.timeThreshold || 3600000, // Learn every hour
      immediatePatterns: config.immediatePatterns || ['error', 'failure', 'success']
    };

    this.initialized = false;
  }

  /**
   * Initialize the learning pipeline
   */
  async initialize(arbiters = {}) {
    console.log(`[${this.name}] 🧠 Initializing Universal Learning Pipeline...`);

    // Connect to arbiters
    this.mnemonicArbiter = arbiters.mnemonic || arbiters.mnemonicArbiter || this.mnemonicArbiter;
    this.adaptivePlanner = arbiters.planner || arbiters.learningPlanner || this.adaptivePlanner;
    this.adaptiveRouter = arbiters.adaptiveRouter || this.adaptiveRouter;
    this.fragmentRegistry = arbiters.fragmentRegistry || this.fragmentRegistry;
    this.outcomeTruth = arbiters.outcomeTruth || this.outcomeTruth;
    this.tribrain = arbiters.tribrain || this.tribrain;
    if (arbiters.experienceBuffer && !this.experienceBuffer?._erInitialized) {
      this.experienceBuffer = arbiters.experienceBuffer;
    }
    if (arbiters.outcomeTracker && !this.outcomeTracker?.initialized) {
      this.outcomeTracker = arbiters.outcomeTracker;
    }
    this.quadBrain = arbiters.quadBrain || (global.__SOMA_SYSTEM && global.__SOMA_SYSTEM.quadBrain) || null;

    // Initialize sub-systems
    await this.outcomeTracker.initialize();
    await this.experienceBuffer.initialize(); // Register as Arbiter

    // Load existing experiences from disk
    const storageDir = this.config.storageDir || process.cwd() + '/.soma';
    const experiencesDir = storageDir + '/experiences';
    const loadResult = await this.experienceBuffer.loadExperiences(experiencesDir);
    if (loadResult.success && loadResult.count > 0) {
      console.log(`[${this.name}]    ✅ Loaded ${loadResult.count} experiences from disk`);
      this.stats.totalExperiences = loadResult.count;
    }

    // Start auto-save for experiences (every 5 minutes)
    this.experienceBuffer.startAutoSave(300000, experiencesDir);

    console.log(`[${this.name}]    ✅ ExperienceReplayBuffer ready (capacity: ${this.experienceBuffer.config.maxSize})`);
    console.log(`[${this.name}]    ✅ OutcomeTracker ready (storage: ${this.outcomeTracker.config.storageDir})`);

    if (this.mnemonicArbiter) {
      console.log(`[${this.name}]    ✅ Connected to MnemonicArbiter`);
    }

    if (this.adaptivePlanner) {
      console.log(`[${this.name}]    ✅ Connected to AdaptiveLearningPlanner`);
    }

    if (this.tribrain) {
      console.log(`[${this.name}]    ✅ Connected to TriBrain`);
    }

    // Set up event listeners
    this.setupEventListeners();

    this.initialized = true;
    if (this.outcomeTruth) await this.attachOutcomeTruth(this.outcomeTruth);
    console.log(`[${this.name}] ✅ Universal Learning Pipeline ready - observing all interactions; learning from verified outcomes only`);

    this.emit('initialized', { stats: this.stats });
  }

  /**
   * Log an interaction - THE MAIN ENTRY POINT
   * Call this for EVERY user query, arbiter decision, task execution
   */
  async logInteraction(interaction) {
    if (!this.initialized) {
      console.warn(`[${this.name}] Not initialized yet, buffering interaction`);
      return;
    }

    const timestamp = Date.now();
    this.stats.totalInteractions++;

    // Standardize interaction format
    const standardized = {
      id: `interaction_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      type: interaction.type || 'unknown',
      agent: interaction.agent || 'unknown',
      input: interaction.input || null,
      output: interaction.output || null,
      context: interaction.context || {},
      metadata: interaction.metadata || {},
      ...interaction
    };

    // Add to interaction log
    this.interactionLog.push(standardized);
    if (this.interactionLog.length > this.maxLogSize) {
      this.interactionLog.shift(); // Remove oldest
    }

    // Process in parallel. Individual learning sinks fail closed when the
    // interaction has not been resolved by authoritative outcome evidence.
    await Promise.all([
      this.storeAsExperience(standardized),
      this.trackOutcome(standardized),
      this.storeInMemory(standardized),
      this.updateLearningPlanner(standardized),
      this.storeDistilledLesson(standardized)
    ]);

    // Emit event for real-time learning
    this.emit('interaction', standardized);

    // 🧠 KNOWLEDGE EXTRACTION: Extract concepts and notify LearningVelocityTracker
    if (this.messageBroker && standardized.input && standardized.output && this.isAuthoritativelyResolved(standardized)) {
      // Background extraction to prevent blocking the fast interaction loop
      setImmediate(async () => {
        try {
          // Extract potential concepts from the interaction using LLM
          const concepts = await this._extractConceptsFromInteraction(standardized);

          if (concepts && concepts.length > 0) {
            for (const concept of concepts) {
              await this.messageBroker.sendMessage({
                from: this.name,
                to: 'LearningVelocityTracker',
                type: 'knowledge_acquired',
                payload: {
                  concept: concept.name,
                  domain: concept.domain || 'general',
                  confidence: concept.confidence || 0.7,
                  size: JSON.stringify(standardized).length,
                  source: 'interaction_log',
                  timestamp,
                  interaction_id: standardized.id
                }
              });
            }
          }
        } catch (err) {
          console.warn(`[${this.name}] Failed to extract concepts: ${err.message}`);
        }
      });
    }

    // Check if we should trigger learning
    this.checkLearningTriggers();

    return standardized.id;
  }

  async attachOutcomeTruth(outcomeTruth) {
    if (!outcomeTruth) return { attached: false, reason: 'outcome_truth_unavailable' };
    if (this.outcomeTruth && this._truthResolutionListener && this.outcomeTruth !== outcomeTruth) {
      this.outcomeTruth.off?.('trace_resolved', this._truthResolutionListener);
    }
    this.outcomeTruth = outcomeTruth;
    if (!this._truthResolutionListener) {
      this._truthResolutionListener = event => {
        this.ingestVerifiedTrace(event.traceId, event.resolutionFingerprint).catch(error =>
          console.warn(`[${this.name}] Verified trace ingestion failed: ${error.message}`)
        );
      };
    }
    outcomeTruth.off?.('trace_resolved', this._truthResolutionListener);
    outcomeTruth.on?.('trace_resolved', this._truthResolutionListener);
    if (!this.initialized) return { attached: true, drained: 0 };
    const drained = await this.drainVerifiedOutcomeBacklog();
    return { attached: true, drained };
  }

  async drainVerifiedOutcomeBacklog(limit = 100) {
    if (!this.outcomeTruth?.pendingTrainingCandidates) return 0;
    const candidates = this.outcomeTruth.pendingTrainingCandidates({ consumerId: this.truthConsumerId, limit });
    let consumed = 0;
    for (const candidate of candidates) {
      const result = await this.ingestVerifiedTrace(candidate.trace, candidate.resolutionFingerprint);
      if (result?.learned) consumed++;
    }
    return consumed;
  }

  async ingestVerifiedTrace(traceOrId, resolutionFingerprint = null) {
    if (!this.initialized) return { learned: false, reason: 'pipeline_not_initialized' };
    const trace = typeof traceOrId === 'string' ? this.outcomeTruth?.getTrace?.(traceOrId) : traceOrId;
    if (!trace || !['verified_success', 'verified_failure'].includes(String(trace.status || ''))) {
      return { learned: false, reason: 'verified_trace_required' };
    }
    const fingerprint = resolutionFingerprint || this.outcomeTruth?.resolutionFingerprint?.(trace.trace_id);
    if (!fingerprint) return { learned: false, reason: 'resolution_fingerprint_required' };
    const lockKey = `${trace.trace_id}:${fingerprint}`;
    if (this._truthInFlight.has(lockKey)) return { learned: false, reason: 'already_in_flight' };

    const pending = this.outcomeTruth?.pendingTrainingCandidates?.({ consumerId: this.truthConsumerId, limit: 1000 }) || [];
    if (!pending.some(candidate => candidate.trace?.trace_id === trace.trace_id && candidate.resolutionFingerprint === fingerprint)) {
      return { learned: false, reason: 'already_consumed' };
    }

    this._truthInFlight.add(lockKey);
    try {
      const success = trace.status === 'verified_success';
      const reward = Number(trace.resolution?.reward ?? (success ? 1 : -1));
      const model = trace.components?.find(component => component.component_kind === 'model')?.component_id || trace.source || 'unknown';
      const interaction = {
        id: `truth_${fingerprint}`,
        type: `verified_${trace.source || 'interaction'}_outcome`,
        agent: model,
        input: trace.input_excerpt || '',
        output: trace.output_excerpt || '',
        context: { sessionId: trace.session_id || null, outcomeTraceId: trace.trace_id },
        metadata: {
          success,
          reward,
          userSatisfaction: (Math.max(-1, Math.min(1, reward)) + 1) / 2,
          userCorrected: !success && trace.signals?.some(signal => signal.signal_type === 'explicit_user_feedback'),
          externallyVerified: true,
          outcomeTruthAuthoritative: true,
          outcomeTruthStatus: trace.status,
          outcomeTraceId: trace.trace_id,
          resolutionFingerprint: fingerprint,
          source: trace.source,
          critical: true,
        },
      };
      await this.logInteraction(interaction);

      if (this.adaptiveRouter?.recordRoutingDecision) {
        await this.adaptiveRouter.recordRoutingDecision(
          interaction.input || interaction.type,
          {
            conversationTopic: trace.source || 'verified_outcome',
            userId: trace.session_id || 'system',
            userWorkflow: trace.source || 'system',
          },
          model,
          { outcomeTraceId: trace.trace_id, outcomeTruth: trace.resolution }
        );
      }

      const fragments = trace.components?.filter(component => component.component_kind === 'fragment') || [];
      for (const component of fragments) {
        await this.fragmentRegistry?.recordFragmentOutcome?.(component.component_id, {
          query: interaction.input,
          response: interaction.output,
          reward,
          outcomeTruthAuthoritative: true,
          outcomeTruthStatus: trace.status,
          metadata: interaction.metadata,
        });
      }

      this.outcomeTruth?.markTrainingCandidateConsumed?.(
        this.truthConsumerId,
        trace.trace_id,
        fingerprint,
        { interactionType: interaction.type, model, fragments: fragments.length }
      );
      this.emit('verified_trace_consumed', { traceId: trace.trace_id, fingerprint, model, fragments: fragments.length });
      return { learned: true, traceId: trace.trace_id, fingerprint, model, fragments: fragments.length };
    } finally {
      this._truthInFlight.delete(lockKey);
    }
  }

  /**
   * Store interaction as experience for reinforcement learning
   */
  async storeAsExperience(interaction) {
    try {
      if (!this.isAuthoritativelyResolved(interaction)) {
        this.emit('observation_unverified', {
          interactionId: interaction.id,
          outcomeTraceId: interaction.metadata?.outcomeTraceId || null,
          sink: 'experience_replay',
        });
        return false;
      }
      // Convert interaction to experience format
      // Trim state to prevent bloat — only store summary of recent interactions, not full text
      const recentSummary = this.interactionLog.slice(-5).map(i => ({
        type: i.type,
        agent: i.agent,
        timestamp: i.timestamp
      }));
      // Truncate helper — handles both strings and objects safely
      const truncate = (val, limit) => {
        if (val === null || val === undefined) return null;
        if (typeof val === 'string') return val.substring(0, limit);
        // For objects, stringify and truncate to prevent storing huge contexts
        try { return JSON.stringify(val).substring(0, limit); } catch { return String(val).substring(0, limit); }
      };
      const experience = {
        state: {
          // Strip context to avoid storing enrichedContext (history, recentLearnings, etc.)
          context: { sessionId: interaction.context?.sessionId, brain: interaction.context?.brain },
          timestamp: interaction.timestamp,
          recentInteractions: recentSummary
        },
        action: interaction.type,
        agent: interaction.agent,
        outcome: truncate(interaction.output, 300),
        reward: this.calculateReward(interaction),
        priority: this.calculateImportance(interaction), // Inject PER priority
        nextState: null, // Will be filled by next interaction
        metadata: {
          input: truncate(interaction.input, 200),
          ...interaction.metadata
        }
      };

      // Auto-critic is advisory only. A model reviewing its own prose is not an
      // environmental reward and must never overwrite grounded outcome evidence.
      if (this.quadBrain && (interaction.input?.length > 100 || interaction.output?.length > 100)) {
         setImmediate(async () => {
             try {
                const criticPrompt = `Evaluate the following interaction. Was it a highly successful action, a neutral action, or a failure? Score it from -1.0 (total failure) to 1.0 (perfect success). Respond ONLY with a JSON object: {"score": 0.5, "reason": "why"}. Interaction: Agent: ${interaction.agent}, Action: ${interaction.type}, Input: ${truncate(interaction.input, 300)}, Output: ${truncate(interaction.output, 300)}`;
                const response = await this.quadBrain.reason(criticPrompt, { 
                    task: 'critic_eval', 
                    lobe: 'LOGOS', 
                    forceBrain: 'NEMESIS', 
                    toolsAvailable: false 
                });
                
                if (response && response.text) {
                   const match = response.text.match(/\{[\s\S]*\}/);
                   if (match) {
                      const parsed = JSON.parse(match[0]);
                      if (typeof parsed.score === 'number') {
                          experience.metadata.criticAssessment = {
                              score: Math.max(-1, Math.min(1, parsed.score)),
                              reason: String(parsed.reason || '').slice(0, 300),
                              advisoryOnly: true
                          };
                      }
                   }
                }
             } catch (e) {
                 // Ignore background critic errors
             }
         });
      }

      this.experienceBuffer.addExperience(experience);
      this.stats.totalExperiences++;

      console.log(`[${this.name}] 📝 Experience stored: ${interaction.type} (reward: ${experience.reward.toFixed(2)})`);
      return true;
    } catch (error) {
      console.error(`[${this.name}] Failed to store experience:`, error.message);
    }
  }

  /**
   * Track outcome for learning
   */
  async trackOutcome(interaction) {
    try {
      const outcome = {
        agent: interaction.agent,
        action: interaction.type,
        result: interaction.output,
        reward: this.calculateReward(interaction),
        success: this.isSuccessful(interaction),
        context: interaction.context,
        metadata: interaction.metadata
      };

      await this.outcomeTracker.recordOutcome(outcome);
      this.stats.totalOutcomes++;
    } catch (error) {
      console.error(`[${this.name}] Failed to track outcome:`, error.message);
    }
  }

  /**
   * Store in long-term memory
   */
  async storeInMemory(interaction) {
    if (!this.mnemonicArbiter) return;

    try {
      // Determine importance
      const importance = this.calculateImportance(interaction);

      // Only store important interactions
      if (importance > 0.3) {
        // Build human-readable memory — raw JSON.stringify() creates garbage the pruner has to clean
        const agentLabel  = interaction.agent  ? `[${interaction.agent}] ` : '';
        const typeLabel   = interaction.type   ? `Type: ${interaction.type}` : 'Interaction';
        const inputText   = typeof interaction.input  === 'string' ? interaction.input  : JSON.stringify(interaction.input  ?? '');
        const outputText  = typeof interaction.output === 'string' ? interaction.output : JSON.stringify(interaction.output ?? '');
        const memoryContent = `${agentLabel}${typeLabel}\nInput: ${inputText.substring(0, 200)}\nResult: ${outputText.substring(0, 300)}`.trim();

        await this.mnemonicArbiter.remember(memoryContent, {
          importance,
          category: 'interaction',
          agent: interaction.agent,
          timestamp: interaction.timestamp,
          ...interaction.metadata
        });

        this.stats.totalMemories++;
        console.log(`[${this.name}] 💾 Stored in memory (importance: ${importance.toFixed(2)})`);
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to store in memory:`, error.message);
    }
  }

  /**
   * Update adaptive learning planner
   */
  async updateLearningPlanner(interaction) {
    if (!this.adaptivePlanner) return;
    if (!this.isAuthoritativelyResolved(interaction)) return;

    try {
      // Extract learning signals
      const learningSignal = {
        topic: interaction.type,
        outcome: interaction.output,
        success: this.isSuccessful(interaction),
        timestamp: interaction.timestamp
      };

      if (typeof this.adaptivePlanner.recordLearningOutcome !== 'function') {
        throw new Error('AdaptiveLearningPlanner.recordLearningOutcome is unavailable');
      }
      await this.adaptivePlanner.recordLearningOutcome(learningSignal.topic, {
        success: learningSignal.success,
        reward: this.calculateReward(interaction),
        result: learningSignal.outcome,
        context: interaction.context,
        evidence: interaction.metadata?.resolutionFingerprint || interaction.metadata?.outcomeTraceId || null,
      });
      this.emit('learning_signal', learningSignal);
    } catch (error) {
      console.error(`[${this.name}] Failed to update learning planner:`, error.message);
    }
  }

  /**
   * Store a compact, redacted lesson for retrieval and training export.
   * Raw interactions are noisy; this bridge turns them into reusable learning.
   */
  async storeDistilledLesson(interaction) {
    try {
      if (!this.isAuthoritativelyResolved(interaction)) {
        this.emit('observation_unverified', {
          interactionId: interaction.id,
          outcomeTraceId: interaction.metadata?.outcomeTraceId || null,
          sink: 'distilled_lesson',
        });
        return null;
      }
      const lesson = defaultLearningSpine.recordInteractionOutcome(interaction);
      this.stats.totalDistilledLessons = (this.stats.totalDistilledLessons || 0) + 1;
      this.emit('distilled_lesson', lesson);
      if (this.messageBroker?.publish && (lesson.trainingValue || 0) >= 0.65) {
        this.messageBroker.publish('insight.generated', {
          insight: `${lesson.signal} ${lesson.lesson}`,
          content: `${lesson.signal}\n\nLesson: ${lesson.lesson}\nNext step: ${lesson.nextStep}`,
          source: 'experience_learning_spine',
          lobe: lesson.lobe,
          category: lesson.category,
          interactionId: lesson.interactionId
        }).catch(() => {});
      }
      return lesson;
    } catch (error) {
      console.error(`[${this.name}] Failed to store distilled lesson:`, error.message);
      return null;
    }
  }

  /**
   * Calculate reward for reinforcement learning
   */
  calculateReward(interaction) {
    let reward = 0;
    const metadata = interaction.metadata || {};
    const evidence = metadata.evidence || metadata.completionEvidence || null;
    const receiptBacked = Boolean(
      (metadata.outcomeTruthAuthoritative === true
        && ['verified_success', 'verified_failure'].includes(String(metadata.outcomeTruthStatus || ''))) ||
      metadata.externallyVerified === true ||
      metadata.testPassed === true ||
      metadata.toolReceiptId ||
      metadata.userAccepted === true ||
      evidence?.passed === true ||
      evidence?.passed === false
    );

    // Unknown observations carry zero reward in both directions. Otherwise a
    // slow response, confident answer, or model-labelled error could still
    // become reinforcement without an external outcome.
    if (!receiptBacked) return 0;

    // Positive task reward requires evidence outside the generating model.
    if (receiptBacked && metadata.success !== false) reward += 1.0;
    if (receiptBacked && Number.isFinite(Number(metadata.userSatisfaction))) {
      reward += Number(metadata.userSatisfaction);
    }
    if (receiptBacked && metadata.taskCompleted) reward += 0.5;
    if (receiptBacked && metadata.efficient) reward += 0.3;

    // Negative rewards
    if (metadata.error || metadata.success === false) reward -= 1.0;
    if (metadata.slow) reward -= 0.2;
    if (metadata.userCorrected) reward -= 0.5;

    // Empty output is observable failure. Non-empty prose earns no reward by itself.
    if (interaction.output) {
      const outputLength = JSON.stringify(interaction.output).length;
      if (outputLength === 0) reward -= 0.5; // Empty output
    }

    return Math.max(-2, Math.min(2, reward)); // Clamp to [-2, 2]
  }

  /**
   * Learning authority is granted only by the Outcome Truth ledger or a
   * concrete external receipt. Confidence, output length, and critic scores
   * are observations and can never satisfy this gate.
   */
  isAuthoritativelyResolved(interaction) {
    const metadata = interaction?.metadata || {};
    const evidence = metadata.evidence || metadata.completionEvidence || null;
    const truthResolved = metadata.outcomeTruthAuthoritative === true
      && ['verified_success', 'verified_failure'].includes(String(metadata.outcomeTruthStatus || ''));
    const receiptResolved = Boolean(
      metadata.externallyVerified === true
      || metadata.testPassed === true
      || metadata.toolReceiptId
      || metadata.userAccepted === true
      || evidence?.passed === true
      || evidence?.passed === false
    );
    return truthResolved || receiptResolved;
  }

  /**
   * Calculate importance for memory storage
   */
  calculateImportance(interaction) {
    let importance = 0.5; // Base importance

    // High importance triggers
    if (interaction.metadata && interaction.metadata.critical) importance += 0.3;
    if (interaction.metadata && interaction.metadata.userQuery) importance += 0.2;
    if (interaction.metadata && interaction.metadata.error) importance += 0.3;
    if (interaction.metadata && interaction.metadata.success) importance += 0.1;
    if (interaction.metadata && interaction.metadata.novel) importance += 0.2;
    if (interaction.metadata && interaction.metadata.noveltyScore) importance += interaction.metadata.noveltyScore; // From LearningVelocityTracker

    // AutoCritic dynamic grading hook
    if (interaction.metadata && interaction.metadata.criticScore) {
       importance += Math.abs(interaction.metadata.criticScore); // High variance = High importance
    }

    // Recency bonus
    const age = Date.now() - interaction.timestamp;
    if (age < 3600000) importance += 0.1; // Last hour

    return Math.max(0, Math.min(1, importance)); // Clamp to [0, 1]
  }

  /**
   * Determine if interaction was successful
   */
  isSuccessful(interaction) {
    if (!this.isAuthoritativelyResolved(interaction)) return null;
    if (interaction.metadata && interaction.metadata.success !== undefined && interaction.metadata.success !== null) {
      return interaction.metadata.success;
    }

    // Non-empty prose, model confidence, and critic agreement are not outcomes.
    return null;
  }

  /**
   * Check if we should trigger a learning session
   */
  checkLearningTriggers() {
    const experienceCount = this.experienceBuffer.experiences.length;

    // Trigger on experience threshold
    if (experienceCount >= this.learningTriggers.experienceThreshold) {
      this.emit('trigger_learning', {
        reason: 'experience_threshold',
        experienceCount
      });
    }

    // Trigger on time
    const timeSinceLastLearning = Date.now() - (this.stats.lastLearningSession || 0);
    if (timeSinceLastLearning >= this.learningTriggers.timeThreshold) {
      this.emit('trigger_learning', {
        reason: 'time_threshold',
        timeSinceLastLearning
      });
    }
  }

  /**
   * Sample experiences for learning
   */
  sampleExperiences(count = 100, strategy = 'prioritized') {
    try {
      return this.experienceBuffer.sample(count, strategy);
    } catch (error) {
      // Not enough experiences yet - return empty array
      console.log(`[${this.name}] Cannot sample yet: ${error.message}`);
      return { experiences: [], indices: [], weights: [] };
    }
  }

  /**
   * Get recent outcomes
   */
  getRecentOutcomes(count = 100) {
    try {
      return this.outcomeTracker.queryOutcomes({ limit: count, sortBy: 'timestamp', order: 'desc' });
    } catch (error) {
      console.log(`[${this.name}] Cannot get outcomes: ${error.message}`);
      return [];
    }
  }

  /**
   * Get learning statistics
   */
  getStats() {
    return {
      ...this.stats,
      experienceBufferSize: this.experienceBuffer.experiences.length,
      outcomeTrackerSize: this.outcomeTracker.outcomes.size,
      interactionLogSize: this.interactionLog.length,
      learningRate: this.stats.totalInteractions > 0
        ? this.stats.totalMemories / this.stats.totalInteractions
        : 0
    };
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for learning triggers
    this.on('trigger_learning', async (data) => {
      console.log(`[${this.name}] 🎓 Learning triggered: ${data.reason}`);
      this.stats.lastLearningSession = Date.now();

      // Emit for nighttime learning to pick up
      const payload = {
        experiences: this.sampleExperiences(500),
        outcomes: this.getRecentOutcomes(500),
        stats: this.getStats()
      };
      
      this.emit('learning_ready', payload);
      
      if (this.messageBroker) {
        this.messageBroker.publish('learning_ready', payload);
      }
    });
  }

  /**
   * Extract concepts from an interaction for knowledge graph
   * Uses QuadBrain for dynamic zero-shot entity extraction
   */
  async _extractConceptsFromInteraction(interaction) {
    const concepts = [];

    try {
      if (!this.quadBrain) return concepts;

      const text = `${interaction.input} ${interaction.output}`;
      if (text.length < 50) return concepts; // Skip trivial interactions

      const prompt = `Extract ONE core entity or concept from the following interaction. Respond ONLY in valid JSON format: {"name": "ConceptName", "domain": "Category"}. Interaction: ${text.substring(0, 500)}`;

      const response = await this.quadBrain.reason(prompt, {
        task: 'concept_extraction',
        lobe: 'KNOWLEDGE',
        forceBrain: 'NEMESIS',
        toolsAvailable: false
      });

      if (response && response.text) {
        try {
          const match = response.text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.name && parsed.domain) {
              concepts.push({
                name: parsed.name,
                domain: parsed.domain,
                confidence: 0.8,
                source: 'llm_extraction'
              });
            }
          }
        } catch (parseError) {
          // Ignore JSON parse errors for background task
        }
      }
    } catch (err) {
      console.warn(`[${this.name}] Concept extraction error: ${err.message}`);
    }

    return concepts;
  }

  /**
   * Shutdown
   */
  async shutdown() {
    console.log(`[${this.name}] Shutting down learning pipeline...`);

    // Stop auto-save and do final save for experiences
    const storageDir = this.config.storageDir || process.cwd() + '/.soma';
    const experiencesDir = storageDir + '/experiences';
    await this.experienceBuffer.stopAutoSave(experiencesDir);

    // Persist outcomes
    await this.outcomeTracker.persistOutcomes();

    console.log(`[${this.name}] ✅ All learning data persisted`);
    this.emit('shutdown');
  }
}

export default UniversalLearningPipeline;
