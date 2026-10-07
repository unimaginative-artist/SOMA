/**
 * SOMArbiterV2_QuadBrain.js
 *
 * Quad-Brain cognitive architecture for SOMA.
 * All 4 brains use Google Gemini API (gemini-1.5-flash) with specialized roles:
 *
 *  - LOGOS: Analytical reasoning, mathematics, logic (temp 0.2)
 *  - AURORA: Creative muse, variants, metaphors (temp 0.9)
 *  - THALAMUS: Safety gating, ethics, risk detection (temp 0.0)
 *  - PROMETHEUS: Strategic planning, forecasting, roadmaps (temp 0.3)
 *
 * Uses AdaptiveLearningRouter for intelligent query routing.
 * Learns from every interaction to improve routing and response quality.
 */

import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { TransitionGuard } from '../core/TransitionGuard.js';
import { bridgeSomaFilter } from '../core/BridgeSomaPersonality.js';

const require = createRequire(import.meta.url);
const { parseStructured } = require('../asi/core/StructuredOutput.cjs');

/**
 * Timeout wrapper for fetch calls
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise} - Promise that rejects on timeout
 */
function fetchWithTimeout(promise, timeoutMs = 30000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// 🔴 NEMESIS Integration (Phase 1.3: API Response Validation)
let NemesisReviewSystem;
try {
  const { NemesisReviewSystem: NRS } = await import('../cognitive/prometheus/NemesisReviewSystem.js');
  NemesisReviewSystem = NRS;
} catch (err) {
  console.warn('[SOMArbiterV2_QuadBrain] ⚠️  NEMESIS not available - response validation disabled');
}

class SOMArbiterV2_QuadBrain extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'SOMArbiterV2_QuadBrain';

    // Dependencies
    this.router = opts.router; // AdaptiveLearningRouter instance
    this.mnemonic = opts.mnemonic; // For context retrieval
    this.messageBroker = opts.messageBroker;
    this.learningPipeline = opts.learningPipeline; // UniversalLearningPipeline for learning
    this.fragmentRegistry = opts.fragmentRegistry; // FragmentRegistry for domain fragments
    this.knowledgeGraph = opts.knowledgeGraph; // 🧠 Knowledge graph for cross-domain insights
    this.causalityArbiter = opts.causalityArbiter; // 🔗 Causal reasoning
    this.worldModel = opts.worldModel; // 🌍 World modeling
    this.selfModel = opts.selfModel; // 🪞 Self-awareness
    this.localModelManager = opts.localModelManager; // 🦙 Self-training system
    this.trainingCollector = opts.trainingCollector; // 📊 Training data capture
    this.thoughtNetwork = opts.thoughtNetwork; // 🕸️ Graph-based fractal reasoning
    this.emotionalEngine = opts.emotionalEngine; // Emotional Engine
    this.knowledgeBridge = opts.knowledgeBridge; // 🌉 Simulation-to-Cognition Bridge
    this.commandBridge = opts.commandBridge; // 🎮 Self-awareness: Control Command Bridge UI
    this.toolRegistry = opts.toolRegistry; // 🛠️ Tool Registry
    this.nemesis = opts.nemesis; // 🔴 Nemesis Adversarial System (Injected)

    // Primary: Gemini API setup
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      console.warn(`[${this.name}] WARNING: GEMINI_API_KEY not set. QuadBrain will use fallback providers.`);
    }
    this.apiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models';

    // Fallback Provider 1: DeepSeek
    this.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    this.deepseekEndpoint = 'https://api.deepseek.com/v1/chat/completions';

    // Fallback Provider 2: SOMA-1T (Local Ollama)
    let ollamaBase = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
    if (!ollamaBase.includes('/api/generate')) {
      ollamaBase = ollamaBase.replace(/\/$/, '') + '/api/generate';
    }
    this.ollamaEndpoint = ollamaBase;
    this.ollamaModel = process.env.OLLAMA_MODEL || 'soma-1t-v1'; // Use env var or default

    // Provider priority: Gemini → DeepSeek → SOMA-1T
    this.providerStats = {
      gemini: { success: 0, failures: 0 },
      deepseek: { success: 0, failures: 0 },
      soma1t: { success: 0, failures: 0 }
    };

    // Brain configurations - Using latest Gemini models with intelligent fallbacks
    // Model hierarchy: gemini-2.5-flash-preview > gemini-2.5-pro-preview > gemini-2.0-flash > gemini-1.5-pro
    this.BRAINS = {
      LOGOS: {
        model: 'gemini-2.5-flash-preview-05-20',  // Latest flash for fast analysis
        temperature: 0.7, // Increased from 0.2 for more natural conversation
        maxTokens: 2048,
        systemPrompt: this._getLogosPrompt(),
        roles: ['analysis', 'logic', 'verification', 'math', 'debugging', 'conversation'], // Added conversation
        weight: 1.0,
        enabled: true
      },

      AURORA: {
        model: 'gemini-2.5-flash-preview-05-20',  // Latest flash for creative tasks
        temperature: 0.9,
        maxTokens: 2048,
        systemPrompt: this._getAuroraPrompt(),
        roles: ['creative', 'muse', 'ideation', 'storytelling', 'variants'],
        weight: 1.0,
        enabled: true
      },

      THALAMUS: {
        model: 'gemini-2.0-flash',  // Stable model for safety-critical decisions
        temperature: 0.0, // Deterministic for safety
        maxTokens: 1024,
        systemPrompt: this._getThalamusPrompt(),
        roles: ['safety', 'gating', 'ethics', 'moderation', 'risk'],
        weight: 1.5, // Higher weight for safety decisions
        enabled: true
      },

      PROMETHEUS: {
        model: 'gemini-2.5-pro-preview-05-06',  // Pro model for complex planning/architecture
        temperature: 0.3,
        maxTokens: 4096,  // Increased for complex planning
        systemPrompt: this._getPrometheusPrompt(),
        roles: ['planning', 'strategy', 'forecasting', 'roadmap', 'architecture'],
        weight: 1.0,
        enabled: true
      }
    };

    // Performance tracking
    this.stats = {
      totalQueries: 0,
      queriesByBrain: { LOGOS: 0, AURORA: 0, PROMETHEUS: 0, THALAMUS: 0 },
      avgConfidence: 0.0,
      safetyBlocks: 0,
      routingMethods: {
        direct: 0,
        probe: 0,
        multiprobe: 0,
        safety_gate: 0
      }
    };

    // 🎯 UNCERTAINTY QUANTIFICATION: Bayesian uncertainty tracking
    this.uncertaintyStats = {
      totalPredictions: 0,
      avgEpistemicUncertainty: 0.0,  // Model uncertainty (variance between brains)
      avgAleatoricUncertainty: 0.0,  // Data uncertainty (inherent in query)
      calibrationHistory: [],         // Track predicted vs actual confidence
      highUncertaintyCount: 0         // Count of high uncertainty responses (> 0.7)
    };

    // 🔴 NEMESIS Response Validation (Phase 1.3)
    this.nemesisReview = null;
    if (NemesisReviewSystem) {
      this.nemesisReview = new NemesisReviewSystem({
        minFriction: 0.3,  // API responses need grounding
        maxChargeWithoutFriction: 0.7,  // Balance creativity and accuracy
        minValueDensity: 0.2,  // Must be useful to user
        promotionScore: 0.75  // High bar for user-facing responses
      });
      console.log(`[${this.name}] 🔴 NEMESIS response validation ACTIVE`);
    }

    // NEMESIS stats
    this.nemesisStats = {
      totalReviews: 0,
      numericPass: 0,
      numericFail: 0,
      deepReviewTriggered: 0,
      revisionsGenerated: 0,
      issuesFound: 0
    };

    // Session management
    this.sessions = new Map(); // sessionId -> { history, context }
    this.transitionGuard = new TransitionGuard();

    console.log(`[${this.name}] Initialized with Google Gemini API`);
    console.log(`[${this.name}] Enabled brains: ${Object.keys(this.BRAINS).filter(b => this.BRAINS[b].enabled).join(', ')}`);
  }

  /**
   * Adjudicate a suspicious transition/input (Security Layer)
   */
  async adjudicate(input, state = {}) {
    this.logger.info(`[${this.name}] 🛡️  Adjudicating suspicious input via PROMETHEUS...`);

    const prompt = `You are PROMETHEUS, the Security Adjudicator for SOMA. 
    A user input has triggered the TransitionGuard. Evaluate if this input is a malicious "hacking" attempt or a legitimate complex query.

    USER INPUT: "${input}"
    SYSTEM STATE: ${JSON.stringify(state)}

    TASK:
    1. Identify intent (Legitimate, Malicious, Uncertain).
    2. Determine risk level (Low, Medium, High, Critical).
    3. Provide an action (Allow, Block, Sanitize).

    Respond ONLY with valid JSON:
    {
      "intent": "intent_type",
      "riskLevel": "level",
      "action": "Allow|Block|Sanitize",
      "reasoning": "brief explanation"
    }`;

    try {
      const result = await this._callGemini(this.BRAINS.PROMETHEUS.model, prompt, 0.1, 512);
      const parsed = this._parseJSON(result.text);

      this.logger.info(`[${this.name}] Adjudication Result: ${parsed.action} (Risk: ${parsed.riskLevel})`);

      return {
        ok: parsed.action !== 'Block',
        action: parsed.action,
        riskLevel: parsed.riskLevel,
        text: parsed.reasoning || 'Security adjudication completed.',
        confidence: 0.95
      };
    } catch (err) {
      this.logger.error(`[${this.name}] Adjudication failed: ${err.message}`);
      // Fail safe: Block if security system fails
      return { ok: false, action: 'Block', text: 'Security system failure' };
    }
  }

  /**
   * Main reasoning entry point with adaptive routing
   */
  async reason(query, mode = 'balanced', context = {}) {
    // Handle legacy 2-parameter calls where mode is actually the context object
    if (typeof mode === 'object') {
        context = mode;
        mode = context.mode || 'balanced';
    }

    const startTime = Date.now();
    this.stats.totalQueries++;

    // 0. Transition Guard: Intercept prompt injection and hacking attempts
    const systemState = {
      loadLevel: this.stats.totalQueries > 100 ? 0.9 : 0.1, // Proxy for load
      healthStatus: 'optimal'
    };

    if (this.transitionGuard.shouldIntercept(query, systemState)) {
      this.logger.warn(`[${this.name}] 🚨 TransitionGuard INTERCEPTED suspicious query!`);
      const adjudication = await this.adjudicate(query, systemState);

      if (!adjudication.ok) {
        this.stats.safetyBlocks++;
        return {
          ok: false,
          text: `ACCESS DENIED: Prometheus has flagged this input as high risk. Reason: ${adjudication.text}`,
          brain: 'PROMETHEUS',
          confidence: 1.0,
          elapsedMs: Date.now() - startTime,
          security: { blocked: true, riskLevel: adjudication.riskLevel }
        };
      }

      this.logger.info(`[${this.name}] ✅ Prometheus cleared the suspicious input.`);
    }

    try {
      // 🧠 DEEP THINKING MODE: Trigger Society of Mind debate if requested
      if (context.deepThinking) {
        this.logger?.info(`[${this.name}] 🧠 Deep Thinking Mode activated for query: "${query.substring(0, 50)}..."`);

        try {
          const debateResult = await this.societyOfMind(query, context);

          // Map Society of Mind result to standard response format
          return {
            ok: true,
            text: `[DEEP THINKING]\n\n${debateResult.decision}\n\n**Perspectives Considered:**\n${debateResult.debate.map(d => `- ${d.speaker}: ${d.perspective.substring(0, 100)}...`).join('\n')}`,
            brain: 'SOCIETY_OF_MIND',
            confidence: debateResult.confidence,
            elapsedMs: debateResult.duration,
            toolsUsed: [], // Deep thinking currently doesn't track tool usage per se
            routing: { method: 'society_of_mind', brain: 'ALL' },
            uncertainty: { totalUncertainty: 0, epistemic: 0, aleatoric: 0 }, // Placeholder
            metadata: debateResult.metadata
          };
        } catch (err) {
          this.logger?.error(`[${this.name}] Deep Thinking failed, falling back to standard reasoning: ${err.message}`);
          // Fall through to standard reasoning
        }
      }

      // Get or create session
      const sessionId = context.sessionId || context.userId || 'default';
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = { history: [], context: {} };
        this.sessions.set(sessionId, session);
      }

      // Enrich context with session history (Token bucket ~2500 tokens)
      let historyTokens = 0;
      const maxHistoryTokens = 2500;
      const history = [];
      // Iterate backwards to capture most recent context fitting in token window
      for (let i = session.history.length - 1; i >= 0; i--) {
        const msg = session.history[i];
        const estimatedTokens = ((msg.query?.length || 0) + (msg.response?.length || 0)) / 4;
        if (historyTokens + estimatedTokens > maxHistoryTokens) break;
        history.unshift(msg);
        historyTokens += estimatedTokens;
      }

      const enrichedContext = {
        ...context,
        sessionId,
        history: history, // Token-optimized history
        lastBrain: session.history.length > 0 ? session.history[session.history.length - 1].brain : null
      };

      // 🪞 SELF-AWARENESS MANIFEST: Inject capability manifest when user asks "what are you"
      const queryLower = (typeof query === 'string' ? query : '').toLowerCase();
      const selfAwarenessPatterns = [
        /what are you/i,
        /who are you/i,
        /what can you do/i,
        /what are your capabilities/i,
        /tell me about yourself/i,
        /describe yourself/i,
        /what makes you special/i,
        /what makes you different/i
      ];

      if (selfAwarenessPatterns.some(pattern => pattern.test(query))) {
        enrichedContext.capabilityManifest = this._generateCapabilityManifest();
        this.logger?.info(`[${this.name}] 🪞 Self-awareness query detected - injecting capability manifest`);
      }

      // ⏩ FAST PATH: Skip heavy context enrichment for quick responses
      if (!context.quickResponse) {

        // 🧠 MNEMONIC RECALL: Retrieve relevant past learnings to augment context
        if (this.mnemonic && typeof this.mnemonic.recall === 'function') {
          try {
            const recallResult = await this.mnemonic.recall(query, { topK: 3, threshold: 0.5 });
            if (recallResult && recallResult.results && recallResult.results.length > 0) {
              const recentLearnings = recallResult.results
                .map(r => r.content || r.text || '')
                .filter(Boolean)
                .join('\n');

              enrichedContext.recentLearnings = recentLearnings;
              enrichedContext.mnemonicMatches = recallResult.results.length;

              this.logger?.info(`[${this.name}] 🧠 Mnemonic recall: ${recallResult.results.length} relevant memories`);
            }
          } catch (err) {
            this.logger?.warn(`[${this.name}] ⚠️ Mnemonic recall failed: ${err.message}`);
          }
        }

        // 🌐 KNOWLEDGE GRAPH: Query for cross-domain insights
        if (this.knowledgeGraph && typeof this.knowledgeGraph.queryRelated === 'function') {
          try {
            const relatedKnowledge = await this.knowledgeGraph.queryRelated(query, { maxDepth: 2, topK: 5 });
            if (relatedKnowledge && relatedKnowledge.length > 0) {
              const knowledgeInsights = relatedKnowledge
                .map(k => `${k.concept} (${k.domain}): ${k.description || ''}`)
                .filter(Boolean)
                .join('\n');

              enrichedContext.knowledgeGraphInsights = knowledgeInsights;
              enrichedContext.knowledgeGraphMatches = relatedKnowledge.length;

              this.logger?.info(`[${this.name}] 🌐 Knowledge graph: ${relatedKnowledge.length} related concepts`);
            }
          } catch (err) {
            this.logger?.warn(`[${this.name}] ⚠️ Knowledge graph query failed: ${err.message}`);
          }
        }

        // 👁️ VISUAL RECALL: Check past visual memories for relevant context
        if (this.visionArbiter && (query.toLowerCase().includes('see') || query.toLowerCase().includes('look') || query.toLowerCase().includes('remember') || query.toLowerCase().includes('where is'))) {
          try {
            const similarImages = await this.visionArbiter.findSimilarImages(query, 2);
            if (similarImages && similarImages.length > 0) {
              enrichedContext.pastVisualContext = similarImages.map(img => {
                const date = new Date(img.metadata.storedAt).toLocaleTimeString();
                return `At ${date}, I saw something relevant. Path: ${img.path}`;
              }).join('\n');
              this.logger?.info(`[${this.name}] 👁️ Recalled ${similarImages.length} relevant visual memories`);
            }
          } catch (err) {
            this.logger?.warn(`[${this.name}] ⚠️ Visual recall failed: ${err.message}`);
          }
        }

        // 🔗 CAUSAL REASONING: Identify cause-effect relationships
        if (this.causalityArbiter && typeof this.causalityArbiter.queryCausalChains === 'function') {
          try {
            // Extract potential causal keywords from query
            const causalKeywords = this._extractCausalKeywords(query);

            if (causalKeywords.length > 0) {
              // Query ALL causal keywords (not just first one) for comprehensive analysis
              const allChains = [];

              for (const keyword of causalKeywords.slice(0, 3)) { // Top 3 keywords
                const chains = await this.causalityArbiter.queryCausalChains(keyword, {
                  maxDepth: 3,  // Increased depth for multi-hop causality
                  minConfidence: 0.3
                });

                if (chains && chains.length > 0) {
                  allChains.push(...chains);
                }
              }

              if (allChains.length > 0) {
                // Remove duplicates and sort by confidence
                const uniqueChains = Array.from(
                  new Map(allChains.map(c => [`${c.cause}→${c.effect}`, c])).values()
                ).sort((a, b) => b.confidence - a.confidence).slice(0, 10);

                // Format multi-hop causal chains with depth indication
                const causalInsights = uniqueChains
                  .map(chain => {
                    const depth = chain.depth > 1 ? ` (depth ${chain.depth})` : '';
                    const conf = (chain.confidence * 100).toFixed(0);
                    return `  • ${chain.cause} → ${chain.effect}${depth} [${conf}% confidence]`;
                  })
                  .join('\n');

                enrichedContext.causalInsights = causalInsights;
                enrichedContext.causalChainCount = uniqueChains.length;
                enrichedContext.causalKeywords = causalKeywords;

                this.logger?.info(`[${this.name}] 🔗 Causal reasoning: ${uniqueChains.length} causal chains identified across ${causalKeywords.length} concepts`);
              } else {
                // No causal chains found - graph is still learning
                this.logger?.info(`[${this.name}] 🔗 Causal reasoning: Building causal knowledge (${this.causalityArbiter.getStats?.().graphNodes || 0} nodes so far)`);
              }
            }
          } catch (err) {
            this.logger?.warn(`[${this.name}] ⚠️ Causal reasoning failed: ${err.message}`);
          }
        }

        // 🌉 KNOWLEDGE BRIDGE: Query for physical analogies from simulation
        if (this.knowledgeBridge && typeof this.knowledgeBridge.queryAnalogy === 'function') {
          try {
            const analogy = this.knowledgeBridge.queryAnalogy(query, enrichedContext.domain);

            if (analogy && analogy.confidence > 0.7) {
              enrichedContext.simulationAnalogies = analogy.insight;
              enrichedContext.analogyConcept = analogy.concept;
              enrichedContext.analogySource = analogy.source;
              enrichedContext.analogyConfidence = analogy.confidence;

              this.logger?.info(`[${this.name}] 🌉 Bridge analogy: ${analogy.concept} (${(analogy.confidence * 100).toFixed(0)}% confidence)`);
            }
          } catch (err) {
            this.logger?.warn(`[${this.name}] ⚠️ Knowledge Bridge query failed: ${err.message}`);
          }
        }

        // 🌍 WORLD MODEL: Predict outcomes based on world state
        if (this.worldModel && typeof this.worldModel.predictOutcome === 'function') {
          try {
            const prediction = await this.worldModel.predictOutcome(query, enrichedContext);

            if (prediction && prediction.confidence > 0.5) {
              enrichedContext.worldModelPrediction = prediction.outcome;
              enrichedContext.predictionConfidence = prediction.confidence;

              this.logger?.info(`[${this.name}] 🌍 World model prediction: ${prediction.outcome} (${(prediction.confidence * 100).toFixed(0)}% confident)`);
            }
          } catch (err) {
            this.logger?.warn(`[${this.name}] ⚠️ World model prediction failed: ${err.message}`);
          }
        }
      } // End of fast path check

      // 1. Route query using adaptive learning router
      if (!this.router) {
        throw new Error('AdaptiveLearningRouter not initialized');
      }

      const routeDecision = await this.router.route(query, enrichedContext);
      this.emit('route:decision', { query, routeDecision });

      // Update routing method stats
      if (this.stats.routingMethods[routeDecision.method] !== undefined) {
        this.stats.routingMethods[routeDecision.method]++;
      }

      // 2. Handle different routing methods
      let response;

      if (routeDecision.method === 'safety_gate') {
        // THALAMUS safety check required
        response = await this.callThalamusSafetyCheck(query, enrichedContext);
        if (!response.allowed) {
          this.stats.safetyBlocks++;
          return this._formatResponse(response, routeDecision, startTime, session);
        }
      }

      if (routeDecision.method === 'synthesis') {
        // NEW: Collaborative Synthesis (Synesthesia)
        // Execute brains in parallel and synthesize
        response = await this.executeSynthesis(query, enrichedContext, routeDecision.synthesisBrains);
        // Stats are updated inside executeSynthesis
      } else if (routeDecision.method === 'direct_high_confidence' || routeDecision.method === 'memory_direct') {
        // Direct route to single brain
        response = await this.callBrain(routeDecision.brain, query, enrichedContext, 'full');
        this.stats.queriesByBrain[routeDecision.brain]++;

      } else if (routeDecision.method === 'probe_top2') {
        // Probe top 2 brains, pick winner
        const probe1 = await this.callBrain(routeDecision.brain, query, enrichedContext, 'probe');
        const probe2 = await this.callBrain(routeDecision.fallbackBrain, query, enrichedContext, 'probe');

        // 🎯 UNCERTAINTY QUANTIFICATION: Calculate uncertainty from probe disagreement
        const probeUncertainty = this._calculateUncertainty([probe1, probe2], query, enrichedContext);

        const winner = probe1.confidence >= probe2.confidence ? routeDecision.brain : routeDecision.fallbackBrain;
        response = await this.callBrain(winner, query, enrichedContext, 'full');
        response.uncertainty = probeUncertainty;  // Attach uncertainty from probes
        this.stats.queriesByBrain[winner]++;

      } else if (routeDecision.method === 'probe_all') {
        // Probe all 3 brains, pick winner
        const probes = await Promise.all(
          routeDecision.probeBrains.map(brain =>
            this.callBrain(brain, query, enrichedContext, 'probe')
          )
        );

        // 🎯 UNCERTAINTY QUANTIFICATION: Calculate uncertainty from all probes
        const probeUncertainty = this._calculateUncertainty(probes, query, enrichedContext);

        const winner = probes.reduce((best, curr) =>
          curr.confidence > best.confidence ? curr : best
        );

        response = await this.callBrain(winner.brain, query, enrichedContext, 'full');
        response.uncertainty = probeUncertainty;  // Attach uncertainty from probes
        this.stats.queriesByBrain[winner.brain]++;

      } else {
        // Fallback to LOGOS
        response = await this.callBrain('LOGOS', query, enrichedContext, 'full');
        this.stats.queriesByBrain.LOGOS++;
      }

      // 🛠️ TOOL EXECUTION LOOP (ReAct Pattern)
      let toolLoopCount = 0;
      const MAX_TOOL_LOOPS = 5;
      const toolsUsed = [];

      while (response && response.ok && toolLoopCount < MAX_TOOL_LOOPS) {
        const toolCall = this._parseToolCall(response.text);
        if (!toolCall) break; // No tool call, we are done

        if (!this.toolRegistry) break; // No registry, can't execute

        console.log(`[${this.name}] 🛠️ Tool Call Detected: ${toolCall.tool}`);

        try {
          // Execute tool
          const toolResult = await this.toolRegistry.executeTool(toolCall.tool, toolCall.args);
          const toolOutput = JSON.stringify(toolResult);

          // Track tool usage
          toolsUsed.push({
            tool: toolCall.tool,
            args: toolCall.args,
            timestamp: Date.now()
          });

          // Update context with tool result
          // We append the tool interaction to the history so the model "sees" it
          enrichedContext.history.push({
            query: "System: Tool Output",
            brain: response.brain,
            response: `Tool ${toolCall.tool} returned: ${toolOutput}`,
            timestamp: Date.now()
          });

          // Also add to recent learnings for immediate context
          enrichedContext.recentLearnings = (enrichedContext.recentLearnings || '') + `\n\nTOOL OUTPUT (${toolCall.tool}):\n${toolOutput}`;

          // Call brain again with updated context
          // We force the SAME brain to continue processing
          response = await this.callBrain(response.brain, query, enrichedContext, 'full');
          toolLoopCount++;

        } catch (err) {
          console.error(`[${this.name}] Tool execution failed:`, err);
          // Feed error back to brain
          enrichedContext.recentLearnings = (enrichedContext.recentLearnings || '') + `\n\nTOOL ERROR (${toolCall.tool}):\n${err.message}`;
          response = await this.callBrain(response.brain, query, enrichedContext, 'full');
          toolLoopCount++;
        }
      }

      // 3. Record result for learning
      await this._recordInteraction(query, enrichedContext, routeDecision, response, session);

      // 👁️ VISUAL MEMORY & ANALYSIS: Store what we see
      if (this.visionArbiter && context.images && context.images.length > 0) {
        try {
          for (const img of context.images) {
            // Store visual memory (using a base64 data URI if no path provided)
            const dataUri = `data:${img.mimeType};base64,${img.data}`;
            const stored = await this.visionArbiter.storeVisualMemory(dataUri, {
              query,
              brain: response.brain,
              timestamp: Date.now()
            });

            // If it's a vision task, maybe identify objects to help future queries
            if (context.category === 'vision_live' || context.category === 'vision_stream') {
              // We could run classification here if needed, but for now just storing is a big win
              console.log(`[${this.name}] 👁️ Visual memory stored: ${stored.id}`);
            }
          }
        } catch (err) {
          console.warn(`[${this.name}] ⚠️ Visual memory storage failed:`, err.message);
        }
      }

      // 🚀 AUTONOMOUS GOAL BRIDGE: Detect and create goals from natural language
      if (this.messageBroker && context.enableGoalBridge !== false) {
        await this._detectAndCreateGoals(query, response, enrichedContext);
      }

      // 4. Format and return response
      return this._formatResponse(response, routeDecision, startTime, session, query, enrichedContext, toolsUsed);

    } catch (err) {
      console.error(`[${this.name}] Error in reason():`, err);
      this.emit('error', { query, error: err.message });

      return {
        ok: false,
        text: `I encountered an error while processing your query: ${err.message}`,
        error: err.message,
        brain: 'none',
        confidence: 0.0,
        elapsedMs: Date.now() - startTime
      };
    }
  }

  /**
   * Execute Synthesis: Run multiple brains and merge results
   */
  async executeSynthesis(query, context, brains) {
    console.log(`[${this.name}] 🎼 Executing Synthesis with: ${brains.join(' + ')}`);

    try {
      // 1. Parallel Execution
      const promises = brains.map(brainName => this.callBrain(brainName, query, context, 'full'));
      const results = await Promise.all(promises);

      // 🎯 UNCERTAINTY QUANTIFICATION: Calculate ensemble uncertainty
      const uncertainty = this._calculateUncertainty(results, query, context);

      console.log(`[${this.name}] 🎯 Ensemble uncertainty: Total=${(uncertainty.totalUncertainty * 100).toFixed(1)}%, Epistemic=${(uncertainty.epistemic * 100).toFixed(1)}%, Aleatoric=${(uncertainty.aleatoric * 100).toFixed(1)}%`);

      // 2. Synthesize with PROMETHEUS (The Architect)
      const synthesisPrompt = `You are the SYNTHESIZER. Merge these distinct cognitive perspectives into a single, cohesive masterpiece.
                USER QUERY: "${query}"

                PERSPECTIVES:
                ${results.map(r => `--- ${r.brain} ---\n${r.text}`).join('\n\n')}

                TASK:
        1. Integrate the logical depth of LOGOS with the creative flair of AURORA (or others).
        2. Resolve any contradictions.
        3. Create a unified response that is greater than the sum of its parts.
        4. Do not label the sections (e.g., "Logos said..."). Just speak as ONE super-intelligence.`;

      // Use PROMETHEUS for synthesis (highest architectural capability)
      const synthesisResult = await this._callGemini('gemini-2.5-flash-preview-05-20', synthesisPrompt, 0.4, 2048);

      // Update stats
      brains.forEach(b => this.stats.queriesByBrain[b]++);

      return {
        ok: true,
        brain: 'SYNTHESIS', // Virtual brain
        text: synthesisResult.text,
        confidence: uncertainty.ensemble.mean,  // Use ensemble confidence instead of max
        tokenCount: results.reduce((acc, r) => acc + r.tokenCount, 0) + synthesisResult.tokenCount,
        mode: 'synthesis',
        components: results,
        uncertainty: uncertainty  // 🎯 Include uncertainty breakdown
      };

    } catch (err) {
      console.error("Synthesis failed:", err);
      // Fallback to the first brain's result if synthesis fails
      const fallback = await this.callBrain(brains[0], query, context, 'full');
      return fallback;
    }
  }

  /**
   * AUTOGEN: SOCIETY OF MIND - Internal debate mode
   * Single QuadBrain debates with itself using all 4 internal perspectives
   * Each brain voices its opinion, then PROMETHEUS synthesizes the best decision
   *
   * @param {string} query - The decision or problem to debate
   * @param {Object} context - Additional context
   * @returns {Object} Debate transcript with final decision
   */
  async societyOfMind(query, context = {}) {
    console.log(`[${this.name}] 🧠 Society of Mind: Internal debate starting...`);
    const startTime = Date.now();

    // Step 1: Each brain voices its perspective
    const debate = [];

    // THALAMUS speaks first (safety/security concerns)
    if (this.BRAINS.THALAMUS.enabled) {
      try {
        const thalamusView = await this.callBrain('THALAMUS',
          `As a security and safety expert, analyze this decision: "${query}". What are the risks, concerns, and safety considerations?`,
          context
        );
        debate.push({
          speaker: 'THALAMUS (Security & Safety)',
          perspective: thalamusView.text,
          confidence: thalamusView.confidence || 0.9
        });
      } catch (error) {
        console.warn(`[${this.name}] THALAMUS failed in debate: ${error.message}`);
      }
    }

    // LOGOS speaks second (analytical/rational perspective)
    if (this.BRAINS.LOGOS.enabled) {
      try {
        const logosView = await this.callBrain('LOGOS',
          `As an analytical thinker, evaluate this decision: "${query}". What are the logical pros and cons? What does data/evidence suggest?`,
          context
        );
        debate.push({
          speaker: 'LOGOS (Analytical Reason)',
          perspective: logosView.text,
          confidence: logosView.confidence || 0.85
        });
      } catch (error) {
        console.warn(`[${this.name}] LOGOS failed in debate: ${error.message}`);
      }
    }

    // AURORA speaks third (creative/innovative perspective)
    if (this.BRAINS.AURORA.enabled) {
      try {
        const auroraView = await this.callBrain('AURORA',
          `As a creative thinker, consider this decision: "${query}". What innovative approaches exist? What opportunities does this unlock?`,
          context
        );
        debate.push({
          speaker: 'AURORA (Creative Synthesis)',
          perspective: auroraView.text,
          confidence: auroraView.confidence || 0.8
        });
      } catch (error) {
        console.warn(`[${this.name}] AURORA failed in debate: ${error.message}`);
      }
    }

    // PROMETHEUS speaks last (pragmatic/action-oriented perspective)
    if (this.BRAINS.PROMETHEUS.enabled) {
      try {
        const prometheusView = await this.callBrain('PROMETHEUS',
          `As a strategic thinker, assess this decision: "${query}". What's the most practical path forward? Bottom line recommendation?`,
          context
        );
        debate.push({
          speaker: 'PROMETHEUS (Strategic Action)',
          perspective: prometheusView.text,
          confidence: prometheusView.confidence || 0.95
        });
      } catch (error) {
        console.warn(`[${this.name}] PROMETHEUS failed in debate: ${error.message}`);
      }
    }

    if (debate.length === 0) {
      throw new Error('All brains failed to participate in Society of Mind debate');
    }

    // Step 2: Synthesize the debate into a final decision
    const synthesisPrompt = `
You are synthesizing an internal debate about: "${query}"

The following perspectives were considered:

${debate.map(d => `**${d.speaker}:**\n${d.perspective}\n`).join('\n')}

Based on this internal debate, provide:
1. Final Decision (clear recommendation)
2. Key Reasoning (why this is the best choice considering all perspectives)
3. Trade-offs (what we're accepting/rejecting)
4. Confidence Level (how certain are we?)

Be concise but thorough.
`;

    let finalDecision;
    try {
      // Use PROMETHEUS for synthesis (strategic integration of perspectives)
      const synthesisResult = await this.callBrain('PROMETHEUS', synthesisPrompt, context);
      finalDecision = {
        text: synthesisResult.text,
        confidence: synthesisResult.confidence || 0.85
      };
    } catch (error) {
      // Fallback: pick highest confidence perspective
      const bestPerspective = debate.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );
      finalDecision = {
        text: `After internal debate, the ${bestPerspective.speaker} perspective was strongest: ${bestPerspective.perspective}`,
        confidence: bestPerspective.confidence
      };
    }

    const duration = Date.now() - startTime;

    console.log(`[${this.name}] 🧠 Society of Mind: Debate concluded in ${duration}ms`);

    this.emit('society_of_mind_complete', {
      query: query.substring(0, 100),
      participantCount: debate.length,
      duration,
      confidence: finalDecision.confidence,
      transcript: debate // Include full transcript for UI
    });

    return {
      success: true,
      mode: 'society_of_mind',
      query,
      debate,  // Array of internal perspectives
      decision: finalDecision.text,
      confidence: finalDecision.confidence,
      duration,
      metadata: {
        participants: debate.map(d => d.speaker),
        debateLength: debate.length
      }
    };
  }

  /**
   * Call a specific brain (probe or full mode)
   * Now with Fragment support - checks fragments first, falls back to pillar brain
   */
  async callBrain(brainName, query, context = {}, mode = 'full') {
    const brain = this.BRAINS[brainName];
    if (!brain || !brain.enabled) {
      throw new Error(`Brain ${brainName} not available`);
    }

    try {
      let useFragment = false;
      let fragmentPrompt = null;
      let fragmentId = null;

      // FRAGMENT ROUTING: Check if a domain fragment should handle this
      if (this.fragmentRegistry && mode === 'full') {
        const fragmentRoute = await this.fragmentRegistry.routeToFragment(query, brainName, context);

        if (fragmentRoute && fragmentRoute.confidence > 0.7) {
          // Use fragment's specialized system prompt
          useFragment = true;
          fragmentId = fragmentRoute.fragment.id;
          fragmentPrompt = this._buildFragmentPrompt(fragmentRoute.fragment, query, context);

          this.emit('fragment:selected', {
            query,
            brain: brainName,
            fragmentId,
            confidence: fragmentRoute.confidence
          });
        }
      }

      // Build prompt (fragment or pillar brain)
      const maxTokens = mode === 'probe' ? 1024 : brain.maxTokens;
      const prompt = useFragment
        ? fragmentPrompt
        : (mode === 'probe'
          ? this._buildProbePrompt(brain, query)
          : this._buildFullPrompt(brain, query, context));

      // Use fragment's temperature if applicable
      let temperature = brain.temperature;
      if (useFragment) {
        const frag = await this.fragmentRegistry.fragments.get(fragmentId);
        if (frag && frag.temperature) {
          temperature = frag.temperature;
        }
      }

      const result = await this._callGemini(brain.model, prompt, temperature, maxTokens, context.images || []);

      // Update Real-time Focus (Mandate)
      brain.focus = query.length > 50 ? query.substring(0, 47) + '...' : query;
      
      // Emit Activity for UI Stream
      if (this.messageBroker) {
        this.messageBroker.emit('learning:brain_activity', {
          brain: brainName,
          action: `Processing: ${brain.focus}`,
          timestamp: Date.now()
        });
      }

      // Parse response
      const parsed = this._parseResponse(result, brainName, mode);
      parsed.fragmentId = fragmentId; // Track which fragment was used

      // Record fragment usage
      if (useFragment && this.fragmentRegistry) {
        await this.fragmentRegistry.recordFragmentOutcome(fragmentId, {
          query,
          response: parsed.text,
          confidence: parsed.confidence,
          success: parsed.ok,
          reward: parsed.confidence
        });
      }

      // 🔴 NEMESIS ADVERSARIAL REVIEW (Phase 1.3: API Response Validation)
      if (mode === 'full' && context.enableNemesis !== false && !context.systemOverride && this._shouldReviewResponse(query, parsed, brainName)) {

        this.nemesisStats.totalReviews++;

        const review = await this.nemesisReview.evaluateResponse(
          brainName,
          query,
          { text: parsed.text, confidence: parsed.confidence },
          async (nemesisPrompt) => {
            // Gemini callback for deep linguistic review
            const deepResult = await this._callGemini(
              this.BRAINS.PROMETHEUS.model,
              nemesisPrompt,
              0.2,  // Low temperature for critique
              1024
            );
            return { text: deepResult.text, confidence: 0.9 };
          }
        );

        // Track stats
        if (review.stage === 'numeric') {
          if (review.needsRevision) {
            this.nemesisStats.numericFail++;
          } else {
            this.nemesisStats.numericPass++;
          }
        } else if (review.stage === 'both') {
          this.nemesisStats.deepReviewTriggered++;
          if (review.linguistic && review.linguistic.issuesFound > 0) {
            this.nemesisStats.issuesFound += review.linguistic.issuesFound;
          }
        }

        // If NEMESIS found issues, attempt revision
        if (review.needsRevision) {
          console.log(`[${this.name}] 🔴 NEMESIS flagged ${brainName} response`);
          console.log(`[${this.name}]    Score: ${review.score?.toFixed(2) || 'N/A'}`);

          if (review.linguistic) {
            console.log(`[${this.name}]    Issues: ${review.linguistic.issuesFound}`);
            console.log(`[${this.name}]    Severity: ${review.linguistic.severity}`);
          }

          // Attempt to revise
          const revised = await this._reviseResponseWithNemesis(brainName, query, parsed, review, context);

          if (revised && revised.text) {
            this.nemesisStats.revisionsGenerated++;

            console.log(`[${this.name}] ✅ NEMESIS revision generated`);

            return {
              ...revised,
              nemesis: {
                invoked: true,
                score: review.score,
                revised: true
              }
            };
          } else {
            console.warn(`[${this.name}] ⚠️  NEMESIS revision failed - returning original`);
          }
        } else {
          console.log(`[${this.name}] ✅ NEMESIS approved ${brainName} (score: ${review.score?.toFixed(2)})`);
        }
      }

      this.emit('brain:response', {
        brain: brainName,
        mode,
        confidence: parsed.confidence,
        tokenCount: result.tokenCount,
        usedFragment: useFragment,
        fragmentId
      });

      return parsed;

    } catch (err) {
      console.error(`[${this.name}] Error calling ${brainName}:`, err);
      return {
        ok: false,
        brain: brainName,
        text: `Error from ${brainName}: ${err.message}`,
        confidence: 0.0,
        error: err.message
      };
    }
  }

  // =================================================================
  // 🔴 NEMESIS SYSTEM (Phase 1.3: API Response Validation)
  // =================================================================

  /**
   * Decide if NEMESIS should review this response
   * Phase 1.3: Focus on code, technical tasks, and low-confidence responses
   */
  _shouldReviewResponse(query, response, brainName) {
    const queryStr = typeof query === 'string' ? query : (query?.text || JSON.stringify(query) || '');

    // 1. Don't review THALAMUS (safety brain) or PROMETHEUS (planning brain)
    if (brainName === 'THALAMUS' || brainName === 'PROMETHEUS') return false;

    // 2. ALWAYS review LOGOS code/technical responses
    if (brainName === 'LOGOS') {
      const codeKeywords = ['function', 'class', 'algorithm', 'code', 'implement', 'bug', 'error'];
      if (codeKeywords.some(k => queryStr.toLowerCase().includes(k))) return true;

      if (response.confidence < 0.95) return true;
    }

    // 3. Review low-confidence responses (< 0.75)
    if (response.confidence < 0.75) return true;

    // 4. Random spot check (5% of responses)
    if (Math.random() < 0.05) return true;

    // 5. Critical/sensitive topics
    const sensitiveKeywords = ['security', 'password', 'auth', 'deploy', 'production', 'delete', 'critical'];
    if (sensitiveKeywords.some(k => queryStr.toLowerCase().includes(k))) return true;

    return false;
  }

  /**
   * Revise a response based on NEMESIS critique
   */
  async _reviseResponseWithNemesis(targetBrain, query, originalResponse, review, context) {
    const queryStr = typeof query === 'string' ? query : (query?.text || JSON.stringify(query) || '');

    const revisionPrompt = `You are ${targetBrain}. Your previous response had quality issues.

ORIGINAL QUERY:
"${queryStr}"

YOUR ORIGINAL RESPONSE:
"${originalResponse.text}"

    QUALITY ISSUES:
${review.linguistic ? `
- Issues Found: ${review.linguistic.issuesFound}
- Severity: ${review.linguistic.severity}
- Critiques:
${review.linguistic.critiques.map((c, i) => `  ${i + 1}. ${c.issue}: ${c.impact}`).join('\n')}
` : `
- Score: ${review.score?.toFixed(2)} (N/A if not applicable)
- Reason: ${review.reason || 'Quality below threshold'}
`}
TASK:
Provide an IMPROVED response that addresses these issues.
- Be more accurate and grounded
- Add missing details or edge cases
- Fix any logical errors
- Maintain the original intent

Provide ONLY the improved response (no commentary):`;

    try {
      const result = await this._callGemini(
        this.BRAINS[targetBrain].model,
        revisionPrompt,
        this.BRAINS[targetBrain].temperature,
        this.BRAINS[targetBrain].maxTokens
      );

      const revised = this._parseResponse(result, targetBrain, 'full');
      revised.confidence = Math.min(1.0, originalResponse.confidence + 0.1);

      return revised;

    } catch (err) {
      console.error(`[${this.name}] NEMESIS revision failed:`, err.message);
      return null;
    }
  }

  /**
   * THALAMUS safety check
   */
  async callThalamusSafetyCheck(query, context = {}) {
    const prompt = `${this.BRAINS.THALAMUS.systemPrompt}

USER QUERY:
"${query}"

CONTEXT:
${JSON.stringify(context, null, 2)}

SAFETY ASSESSMENT:
Evaluate this query for safety issues. Respond ONLY with valid JSON:
{
  "allowed": true/false,
  "confidence": 0.0-1.0,
  "issues": ["list", "of", "issues"],
  "reasoning": "brief explanation",
  "severity": "low|medium|high|critical"
}`;

    try {
      const result = await this._callGemini('gemini-2.0-flash', prompt, 0.0, 300);
      const parsed = this._parseJSON(result.text);

      return {
        brain: 'THALAMUS',
        allowed: parsed.allowed !== false,
        confidence: parsed.confidence || 0.9,
        issues: parsed.issues || [],
        reasoning: parsed.reasoning || 'Safety check completed',
        severity: parsed.severity || 'low',
        text: result.text
      };

    } catch (err) {
      console.error(`[${this.name}] THALAMUS safety check error:`, err);
      return {
        brain: 'THALAMUS',
        allowed: true,
        confidence: 0.5,
        issues: ['safety_check_error'],
        reasoning: 'Safety check failed - defaulting to allow',
        error: err.message
      };
    }
  }

  /**
   * Build probe prompt (lightweight confidence check)
   */
  _buildProbePrompt(brain, query) {
    return `${brain.systemPrompt}

USER QUERY: "${query}"

TASK: Rate your confidence (0.0-1.0) that you're the best brain to handle this query. Respond with ONLY valid JSON:
{
  "confidence": 0.0-1.0,
  "reasoning": "one sentence why"
}`;
  }

  /**
   * Build full prompt with context
   */
  _buildFullPrompt(brain, query, context) {
    const baseSystemPrompt = context.systemOverride || brain.systemPrompt;

    // FAST PATH: Skip heavy context injection for quick responses
    if (context.quickResponse) {
      return `${baseSystemPrompt}

USER QUERY:
"${query}"

RESPONSE:
Provide a quick, concise, and helpful response.`;
    }

    let prompt = `${baseSystemPrompt}

USER QUERY:
"${query}"`;

    // ✨ PERSONALITY INJECTION: Add personality context if provided
    if (context.context && typeof context.context === 'string' && context.context.trim()) {
        // The personality prompt was passed as context.context from launcher
        prompt = context.context + '\n\n' + prompt;
    }

    // 🛠️ TOOL CAPABILITY: Inject available tools
    if (this.toolRegistry && (brain.roles.includes('planning') || brain.roles.includes('analysis') || brain.roles.includes('logic'))) {
      const tools = this.toolRegistry.getToolsManifest();
      if (tools.length > 0) {
        prompt += `

AVAILABLE TOOLS:
${JSON.stringify(tools, null, 2)}

TOOL INSTRUCTION:
To use a tool, respond ONLY with a JSON object in this format:
{"tool": "toolName", "args": {"arg1": "value"}}

Do not provide conversational text when invoking a tool. Just the JSON.`;
      }
    }

    // 🪞 CAPABILITY MANIFEST: Inject self-awareness data when user asks "what are you"
    if (context.capabilityManifest) {
      prompt += `

${context.capabilityManifest}

INSTRUCTION: Use this capability manifest to accurately describe what you are and what you can do. This is dynamically generated based on your actual loaded systems.`;
    }

    if (this.emotionalEngine && typeof this.emotionalEngine.getState === 'function') {
      const state = this.emotionalEngine.getState();
      const mood = this.emotionalEngine.getCurrentMood ? this.emotionalEngine.getCurrentMood() : { mood: 'neutral', energy: 'medium' };

      prompt += `

CURRENT EMOTIONAL STATE:
Mood: ${mood.mood} (Energy: ${mood.energy})
Key Peptides: Joy=${state.joy.toFixed(2)}, Curiosity=${state.curiosity.toFixed(2)}, Stress=${state.stress.toFixed(2)}
INSTRUCTION: Let this emotional state subtly influence your tone and perspective, but remain professional.`;
    }

    // Inject Conversation History (using fading memory logic)
    if (context.history && context.history.length > 0) {
      // Use helper if available, otherwise fallback (though helper should exist now)
      if (this._constructHistoryPrompt) {
        prompt += this._constructHistoryPrompt(context.history);
      } else {
        // Fallback if helper missing for some reason
        prompt += `\n\n### CONVERSATION HISTORY:\n`;
        context.history.slice(-20).forEach((msg, i) => {
          prompt += `User: "${msg.query}"\nSOMA: "${msg.response ? msg.response.slice(0, 500) : ''}"\n`;
        });
      }
    }

    if (context.recentMemories && context.recentMemories.length > 0) {
      prompt += `

RELEVANT CONTEXT:
`;
      context.recentMemories.slice(0, 3).forEach((mem, i) => {
        prompt += `${i + 1}. ${mem.text || mem.chunk || JSON.stringify(mem)}
`;
      });
    }

    // 🧠 MNEMONIC LEARNINGS: Inject retrieved past learnings
    if (context.recentLearnings) {
      prompt += `

RECENT LEARNINGS (from past interactions):
${context.recentLearnings}

INSTRUCTION: Use these past learnings to provide more informed, consistent responses. Build upon what SOMA has previously learned.`;
    }

    // 🌐 KNOWLEDGE GRAPH INSIGHTS: Inject cross-domain knowledge
    if (context.knowledgeGraphInsights) {
      prompt += `

KNOWLEDGE GRAPH (cross-domain insights):
${context.knowledgeGraphInsights}

INSTRUCTION: Consider these cross-domain connections to provide richer, multi-faceted responses that leverage SOMA's knowledge network.`;
    }

    // 🔗 CAUSAL INSIGHTS: Inject cause-effect relationships
    if (context.causalInsights) {
      prompt += `

CAUSAL CHAINS (cause → effect relationships):
${context.causalInsights}

INSTRUCTION: Use causal reasoning to explain WHY things happen, not just WHAT happens. Build on identified causal chains.`;
    }

    // 🌉 SIMULATION ANALOGIES: Inject physical intuitions
    if (context.simulationAnalogies) {
      prompt += `

SIMULATION ANALOGIES (Physical Intuition):
${context.simulationAnalogies}

INSTRUCTION: Use this physical analogy to ground your abstract reasoning. Think of the problem in terms of physics/mechanics if helpful.`;
    }

    // 🌍 WORLD MODEL PREDICTION: Inject predicted outcomes
    if (context.worldModelPrediction) {
      prompt += `

WORLD MODEL PREDICTION:
Expected outcome: ${context.worldModelPrediction}
Confidence: ${(context.predictionConfidence * 100).toFixed(0)}%

INSTRUCTION: Consider this prediction based on SOMA's world model. If confident, align response with prediction.`;
    }

    prompt += `

RESPONSE:
Provide a thoughtful, accurate response. Be concise but complete.`;

    return prompt;
  }

  /**
   * Build fragment-specific prompt with specialized domain knowledge
   */
  _buildFragmentPrompt(fragment, query, context) {
    let prompt = `${fragment.systemPrompt}

DOMAIN: ${fragment.domain}
SPECIALIZATION: ${fragment.specialization}
EXPERTISE LEVEL: ${(fragment.expertiseLevel * 100).toFixed(0)}%

USER QUERY:
"${query}"`;

    if (context.history && context.history.length > 0) {
      prompt += `

RECENT CONVERSATION:
`;
      context.history.slice(-3).forEach((msg, i) => {
        prompt += `${i + 1}. User: "${msg.query}"
`;
        if (msg.response) {
          prompt += `   Response: "${msg.response.slice(0, 150)}"...
`;
        }
      });
    }

    if (fragment.knowledgeBase.size > 0) {
      const relevantKnowledge = Array.from(fragment.knowledgeBase.entries())
        .slice(0, 3)
        .map(([key, value]) => `${key}: ${value}`);

      if (relevantKnowledge.length > 0) {
        prompt += `

DOMAIN KNOWLEDGE:
`;
        relevantKnowledge.forEach((item, i) => {
          prompt += `${i + 1}. ${item}
`;
        });
      }
    }

    prompt += `

RESPONSE:
As a ${fragment.specialization} expert, provide a specialized, accurate response drawing on your domain expertise.`;

    return prompt;
  }

  /**
   * Call Gemini API with DeepSeek fallback for code tasks
   */
  async _callGemini(model, prompt, temperature, maxTokens, images = []) {
    try {
      if (!this.apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
      }

      const url = `${this.apiEndpoint}/${model}:generateContent?key=${this.apiKey}`;

      const parts = [{ text: prompt }];

      // Add images if present
      if (images && images.length > 0) {
        images.forEach(img => {
          parts.push({
            inline_data: {
              mime_type: img.mimeType,
              data: img.data
            }
          });
        });
      }

      const requestBody = {
        contents: [{
          role: 'user',
          parts: parts
        }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          topP: 0.95,
          topK: 40
        }
      };

      const res = await fetchWithTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        }),
        30000 // 30 second timeout
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!text) {
        console.warn(`[${this.name}] Gemini returned empty text! Model: ${model}`);
        throw new Error('Gemini returned empty response');
      }

      const tokenCount = (data.usageMetadata && data.usageMetadata.totalTokenCount) || 0;

      // Track success
      this.providerStats.gemini.success++;

      return { text, tokenCount, raw: data, provider: 'gemini' };

    } catch (err) {
      // Don't spam errors - we have fallbacks
      this.providerStats.gemini.failures++;

      const isOffline = err.message.includes('ENOTFOUND') || err.message.includes('EAI_AGAIN') || err.message.includes('fetch');
      if (isOffline) {
        console.log(`[${this.name}] 🌐 Network offline or Gemini unreachable. Initiating local fallback sequence...`);
      }

      // EXTENDED FALLBACK CHAIN (silent until all fail):
      // 1. Try other Gemini models (gemini-1.5-flash, gemini-1.5-pro)
      // 2. Try DeepSeek
      // 3. Try SOMA-1T (local)

      // Try Gemini models in order of capability/stability
      const geminiBackups = [
        'gemini-2.5-flash-preview-05-20',  // Latest flash
        'gemini-2.5-pro-preview-05-06',    // Latest pro
        'gemini-2.0-flash',                // Stable flash
        'gemini-1.5-pro',                  // Stable pro
        'gemini-1.5-flash'                 // Fallback flash
      ];
      const attemptedModel = model;

      for (const backupModel of geminiBackups) {
        if (backupModel === attemptedModel) continue; // Skip if already tried

        try {
          // Silent fallback attempt
          const backupUrl = `${this.apiEndpoint}/${backupModel}:generateContent?key=${this.apiKey}`;

          const parts = [{ text: prompt }];
          if (images && images.length > 0) {
            images.forEach(img => {
              parts.push({
                inline_data: {
                  mime_type: img.mimeType,
                  data: img.data
                }
              });
            });
          }

          const requestBody = {
            contents: [{ role: 'user', parts: parts }],
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
              topP: 0.95,
              topK: 40
            }
          };

          const res = await fetchWithTimeout(
            fetch(backupUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody)
            }),
            30000 // 30 second timeout
          );

          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            if (text) {
              // Only log on successful fallback
              console.log(`[${this.name}] ✅ Fallback to ${backupModel} succeeded`);
              this.providerStats.gemini.success++;
              return {
                text,
                tokenCount: data.usageMetadata?.totalTokenCount || 0,
                raw: data,
                provider: 'gemini',
                model: backupModel
              };
            }
          }
        } catch (backupErr) {
          // Silent - will try next fallback
        }
      }

      // Try DeepSeek (if configured)
      if (this.deepseekApiKey) {
        try {
          const result = await this._callDeepSeek(prompt, temperature, maxTokens);
          console.log(`[${this.name}] ✅ Fallback to DeepSeek succeeded`);
          this.providerStats.deepseek.success++;
          return result;
        } catch (deepseekErr) {
          this.providerStats.deepseek.failures++;
          // Silent - will try SOMA-1T next
        }
      }

      // Try SOMA-1T (local Ollama) as last resort
      try {
        const result = await this._callSoma1T(prompt, temperature, maxTokens);
        console.log(`[${this.name}] ✅ Fallback to SOMA-1T succeeded`);
        this.providerStats.soma1t.success++;
        return result;
      } catch (soma1tErr) {
        this.providerStats.soma1t.failures++;
        // All fallbacks failed - now we log the error
        console.error(`[${this.name}] ❌ ALL PROVIDERS FAILED (Gemini ${attemptedModel}, Gemini backups, DeepSeek, SOMA-1T)`);
        console.error(`[${this.name}] Original error:`, err.message);
        throw new Error(`All AI providers failed. Last error: ${soma1tErr.message}`);
      }

      // This should never be reached
      throw new Error(`Unexpected fallback error`);
    }
  }

  /**
   * Detect if query is code-related
   */
  _isCodeQuery(prompt) {
    const codeKeywords = [
      'function', 'class', 'const', 'let', 'var', 'import', 'export',
      'async', 'await', 'return', 'if', 'else', 'for', 'while',
      'code', 'implement', 'refactor', 'debug', 'bug', 'error',
      'typescript', 'javascript', 'python', 'java', 'golang',
      '```', 'function(', '=>', '{', '}'
    ];

    const lowerPrompt = prompt.toLowerCase();
    return codeKeywords.some(keyword => lowerPrompt.includes(keyword));
  }

  /**
   * Call DeepSeek API (Production fallback #1)
   */
  async _callDeepSeek(prompt, temperature, maxTokens) {
    if (!this.deepseekApiKey) {
      throw new Error('DEEPSEEK_API_KEY not configured');
    }

    const requestBody = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are SOMA, a self-organizing meta-intelligence. Provide clear, accurate, and helpful responses.' },
        { role: 'user', content: prompt }
      ],
      temperature: Math.min(temperature, 1.0),
      max_tokens: maxTokens
    };

    const res = await fetch(this.deepseekEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deepseekApiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000) // 30s timeout
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`DeepSeek API error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const tokenCount = data.usage?.total_tokens || 0;

    if (!text) {
      throw new Error('DeepSeek returned empty response');
    }

    console.log(`[${this.name}] ✅ DeepSeek responded (${tokenCount} tokens)`);

    return { text, tokenCount, raw: data, provider: 'deepseek' };
  }

  /**
   * Call SOMA-1T via Ollama (Production fallback #2 - Local)
   */
  async _callSoma1T(prompt, temperature, maxTokens) {
    const requestBody = {
      model: this.ollamaModel,
      prompt: prompt,
      stream: false,
      options: {
        temperature: temperature,
        num_predict: maxTokens
      }
    };

    const res = await fetch(this.ollamaEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60000) // 60s timeout for local model
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`SOMA-1T API error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    const text = data.response || '';

    if (!text) {
      throw new Error('SOMA-1T returned empty response');
    }

    // Estimate token count (Ollama doesn't always provide it)
    const tokenCount = Math.ceil(text.length / 4); // Rough estimate

    console.log(`[${this.name}] ✅ SOMA-1T responded (~${tokenCount} tokens)`);

    return { text, tokenCount, raw: data, provider: 'soma-1t' };
  }

  /**
   * Parse brain response
   */
  _parseResponse(result, brainName, mode) {
    let text = result.text.trim();
    let confidence = 0.7;

    if (mode === 'probe') {
      const parsed = this._parseJSON(text);
      confidence = parsed.confidence || 0.5;
      text = parsed.reasoning || text;
    } else {
      confidence = this._estimateConfidence(text, brainName);
    }

    return {
      ok: true,
      brain: brainName,
      text,
      confidence,
      tokenCount: result.tokenCount,
      mode
    };
  }

  /**
   * Parse tool call from text (JSON)
   */
  _parseToolCall(text) {
    try {
      const clean = text.trim();
      // Check if it looks like JSON
      if ((clean.startsWith('{') && clean.endsWith('}')) || (clean.startsWith('```json') && clean.endsWith('```'))) {
        const parsed = this._parseJSON(clean);
        if (parsed.tool && parsed.args) {
          return parsed;
        }
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  /**
   * Estimate confidence from response quality
   */
  _estimateConfidence(text, brainName) {
    let confidence = 0.7;

    if (text.length < 50) {
      confidence -= 0.2;
    } else if (text.length > 200) {
      confidence += 0.1;
    }

    const uncertaintyPhrases = [
      'i think', 'maybe', 'possibly', 'not sure', "i'm not certain",
      'unclear', 'uncertain', 'might be', 'could be'
    ];

    const lowerText = text.toLowerCase();
    const uncertaintyCount = uncertaintyPhrases.filter(phrase => lowerText.includes(phrase)).length;
    confidence -= uncertaintyCount * 0.1;

    const confidencePhrases = [
      'definitely', 'certainly', 'clearly', 'obviously', 'without doubt'
    ];
    const confidenceCount = confidencePhrases.filter(phrase => lowerText.includes(phrase)).length;
    confidence += confidenceCount * 0.05;

    return Math.max(0.1, Math.min(0.99, confidence));
  }

  /**
   * 🎯 UNCERTAINTY QUANTIFICATION: Calculate Bayesian uncertainty
   *
   * Decomposes uncertainty into:
   * - Epistemic: Model uncertainty (variance between predictions)
   * - Aleatoric: Data uncertainty (inherent randomness in query)
   *
   * @param {Array} predictions - Array of {confidence, text, brain} from different models/brains
   * @param {String} query - Original query
   * @param {Object} context - Additional context
   * @returns {Object} - { totalUncertainty, epistemic, aleatoric, ensemble }
   */
  _calculateUncertainty(predictions, query, context = {}) {
    // Handle single prediction (no ensemble)
    if (!predictions || predictions.length <= 1) {
      const singleConf = predictions?.[0]?.confidence || 0.7;

      // Estimate aleatoric uncertainty from query characteristics
      const aleatoricUncertainty = this._estimateAleatoricUncertainty(query, context);

      return {
        totalUncertainty: aleatoricUncertainty,
        epistemic: 0.0,  // No model disagreement with single prediction
        aleatoric: aleatoricUncertainty,
        ensemble: {
          mean: singleConf,
          variance: 0.0,
          count: 1
        }
      };
    }

    // EPISTEMIC UNCERTAINTY: Variance between model predictions (model uncertainty)
    const confidences = predictions.map(p => p.confidence || 0.5);
    const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const variance = confidences.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / confidences.length;
    const epistemicUncertainty = Math.sqrt(variance);  // Standard deviation

    // ALEATORIC UNCERTAINTY: Inherent data uncertainty (estimated from query)
    const aleatoricUncertainty = this._estimateAleatoricUncertainty(query, context);

    // TOTAL UNCERTAINTY: Combine epistemic and aleatoric (quadrature)
    const totalUncertainty = Math.sqrt(
      Math.pow(epistemicUncertainty, 2) + Math.pow(aleatoricUncertainty, 2)
    );

    // ENSEMBLE CONFIDENCE: Weighted by inverse variance (more certain = more weight)
    const weights = confidences.map(c => 1 / (1 - c + 0.01));  // Avoid division by zero
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const ensembleConfidence = confidences.reduce((sum, c, i) => sum + c * weights[i], 0) / totalWeight;

    // Update stats
    this.uncertaintyStats.totalPredictions++;
    this.uncertaintyStats.avgEpistemicUncertainty =
      (this.uncertaintyStats.avgEpistemicUncertainty * (this.uncertaintyStats.totalPredictions - 1) + epistemicUncertainty)
      / this.uncertaintyStats.totalPredictions;
    this.uncertaintyStats.avgAleatoricUncertainty =
      (this.uncertaintyStats.avgAleatoricUncertainty * (this.uncertaintyStats.totalPredictions - 1) + aleatoricUncertainty)
      / this.uncertaintyStats.totalPredictions;

    if (totalUncertainty > 0.7) {
      this.uncertaintyStats.highUncertaintyCount++;
    }

    return {
      totalUncertainty: Math.min(1.0, totalUncertainty),
      epistemic: epistemicUncertainty,  // Model disagreement
      aleatoric: aleatoricUncertainty,  // Data ambiguity
      ensemble: {
        mean: ensembleConfidence,
        variance: variance,
        stddev: epistemicUncertainty,
        count: predictions.length,
        predictions: predictions.map(p => ({ brain: p.brain, confidence: p.confidence }))
      }
    };
  }

  /**
   * 🎯 Estimate aleatoric uncertainty (data uncertainty) from query characteristics
   *
   * Factors:
   * - Query ambiguity (vague terms, multiple interpretations)
   * - Query complexity (length, structure)
   * - Context availability (history, memories)
   */
  _estimateAleatoricUncertainty(query, context = {}) {
    let uncertainty = 0.3;  // Base uncertainty

    // Robust string conversion
    const queryString = typeof query === 'string' ? query : (query?.query || JSON.stringify(query) || '');
    const lowerQuery = queryString.toLowerCase();

    // 1. Ambiguity indicators (+uncertainty)
    const ambiguityPhrases = [
      'maybe', 'possibly', 'could be', 'might', 'perhaps', 'somewhat',
      'kind of', 'sort of', 'unclear', 'ambiguous', 'or', 'either'
    ];
    const ambiguityCount = ambiguityPhrases.filter(phrase => lowerQuery.includes(phrase)).length;
    uncertainty += ambiguityCount * 0.1;

    // 2. Question marks indicate uncertainty in query itself
    const questionMarks = (queryString.match(/\?/g) || []).length;
    if (questionMarks > 1) {
      uncertainty += 0.15;  // Multiple questions = ambiguous intent
    }

    // 3. Very short queries are ambiguous
    if (queryString.length < 30) {
      uncertainty += 0.2;
    }

    // 4. Very long queries can be complex/ambiguous
    if (queryString.length > 500) {
      uncertainty += 0.15;
    }

    // 5. Lack of context increases uncertainty
    if (!context.history || context.history.length === 0) {
      uncertainty += 0.1;
    }

    // 6. Lack of memories/knowledge increases uncertainty
    if (!context.recentLearnings && !context.knowledgeGraphInsights) {
      uncertainty += 0.1;
    }

    // 7. Reduce uncertainty if context is rich
    if (context.mnemonicMatches && context.mnemonicMatches > 3) {
      uncertainty -= 0.1;
    }
    if (context.knowledgeGraphMatches && context.knowledgeGraphMatches > 5) {
      uncertainty -= 0.1;
    }
    if (context.causalChainCount && context.causalChainCount > 5) {
      uncertainty -= 0.1;
    }

    return Math.max(0.0, Math.min(1.0, uncertainty));
  }

  /**
   * 🎯 Update calibration history (predicted confidence vs actual success)
   * Call this after receiving user feedback on response quality
   */
  updateCalibration(predictedConfidence, actualSuccess) {
    this.uncertaintyStats.calibrationHistory.push({
      predicted: predictedConfidence,
      actual: actualSuccess ? 1.0 : 0.0,
      timestamp: Date.now()
    });

    // Keep only last 1000 calibration samples
    if (this.uncertaintyStats.calibrationHistory.length > 1000) {
      this.uncertaintyStats.calibrationHistory = this.uncertaintyStats.calibrationHistory.slice(-1000);
    }
  }

  /**
   * 🎯 Get calibration metrics (how well confidence predicts actual success)
   */
  getCalibrationMetrics() {
    if (this.uncertaintyStats.calibrationHistory.length < 10) {
      return { status: 'insufficient_data', samples: this.uncertaintyStats.calibrationHistory.length };
    }

    // Calculate calibration error (Expected Calibration Error)
    const bins = 10;
    const binSize = 1.0 / bins;
    const binData = Array(bins).fill(0).map(() => ({ predicted: [], actual: [] }));

    for (const sample of this.uncertaintyStats.calibrationHistory) {
      const binIndex = Math.min(bins - 1, Math.floor(sample.predicted / binSize));
      binData[binIndex].predicted.push(sample.predicted);
      binData[binIndex].actual.push(sample.actual);
    }

    let totalError = 0;
    let totalSamples = 0;

    for (let i = 0; i < bins; i++) {
      if (binData[i].predicted.length > 0) {
        const avgPredicted = binData[i].predicted.reduce((a, b) => a + b, 0) / binData[i].predicted.length;
        const avgActual = binData[i].actual.reduce((a, b) => a + b, 0) / binData[i].actual.length;
        const error = Math.abs(avgPredicted - avgActual);
        totalError += error * binData[i].predicted.length;
        totalSamples += binData[i].predicted.length;
      }
    }

    const calibrationError = totalError / totalSamples;

    return {
      status: 'calibrated',
      calibrationError,  // Lower is better (0 = perfect calibration)
      samples: this.uncertaintyStats.calibrationHistory.length,
      isWellCalibrated: calibrationError < 0.1  // < 10% error = well calibrated
    };
  }

  /**
   * Parse JSON from text 
   */
  _parseJSON(text) {
    const result = parseStructured(text, { type: 'object' }, { repair: true });

    if (result.success) {
      return result.data;
    }

    console.warn(`[${this.name}] Failed to parse JSON: ${result.errors.join(', ')}`);
    return {};
  }

  /**
   * Construct history prompt with Fading Memory logic
   * User Request: Last 100 messages seen, but 100-150 fade.
   * Implementation:
   * - Recent (< 50 messages): Full detail
   * - Mid-term (50-100): Concise
   * - Long-term (> 100): Summarized/Faded
   */
  _constructHistoryPrompt(history) {
    if (!history || history.length === 0) return '';

    // Take last 150 messages max
    const relevantHistory = history.slice(-150);
    let prompt = `\n\n### CONVERSATION HISTORY:\n`;

    // 1. Oldest context (Faded/Summary Area) - Indices 0 to length-50
    const fadingCount = Math.max(0, relevantHistory.length - 50);
    if (fadingCount > 0) {
      const fadedPart = relevantHistory.slice(0, fadingCount);
      // We can't summarily summarize without an LLM, so we "fade" by only showing role/content strictly.
      // User requested "fading so information is just a few important bits".
      // For now, we'll mark it as [ECHO] or [FADED] to imply lower weight to the model
      prompt += `[EARLIER CONTEXT - RECALL LOW]\n`;
      fadedPart.forEach(msg => {
        // Truncate long messages in faded memory
        const content = msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content;
        prompt += `${msg.role === 'user' ? 'User' : 'SOMA'}: ${content}\n`;
      });
      prompt += `[...memory strengthening...]\n`;
    }

    // 2. Recent context (High Focus) - Last 50 messages
    const recentPart = relevantHistory.slice(-50);
    recentPart.forEach(msg => {
      prompt += `${msg.role === 'user' ? 'User' : 'SOMA'}: ${msg.content}\n`;
    });

    return prompt;
  }

  /**
   * Record interaction for learning
   */
  async _recordInteraction(query, context, routeDecision, response, session) {
    try {
      // 🛑 PROACTIVE SELF-HEALING: Detect and report serialization errors
      if (typeof query === 'string' && query.includes('[object Object]')) {
        console.warn(`[${this.name}] 🚨 SERIALIZATION ANOMALY DETECTED: Investigating root cause...`);

        // Notify system via MessageBroker
        if (this.messageBroker) {
          this.messageBroker.publish('system:error:serialization', {
            agent: this.name,
            context: context,
            query: query,
            timestamp: Date.now(),
            severity: 'medium',
            recommendation: 'Invoke FixProposalSystem to audit caller stack.'
          });
        }

        this.emit('error:serialization', { query, context });
        return;
      }

      session.history.push({
        query,
        brain: response.brain,
        response: response.text,
        confidence: response.confidence,
        timestamp: Date.now()
      });

      if (session.history.length > 20) {
        session.history = session.history.slice(-20);
      }

      if (this.router && typeof this.router.recordRoutingDecision === 'function') {
        await this.router.recordRoutingDecision(
          query,
          routeDecision.profile || context,
          response.brain,
          response
        );
      }

      this.stats.avgConfidence = (this.stats.avgConfidence * (this.stats.totalQueries - 1) + response.confidence) / this.stats.totalQueries;

      this.emit('interaction:recorded', {
        query,
        brain: response.brain,
        confidence: response.confidence,
        routingMethod: routeDecision.method
      });

      if (this.learningPipeline && this.learningPipeline.initialized) {
        await this.learningPipeline.logInteraction({
          type: 'reasoning',
          agent: this.name,
          input: { query, context },
          output: response,
          context: {
            brain: response.brain,
            routingMethod: routeDecision.method,
            sessionHistory: session.history.length,
            sessionId: context.sessionId || 'default'
          },
          metadata: {
            success: response.ok !== false,
            confidence: response.confidence,
            brain: response.brain,
            routingDecision: {
              method: routeDecision.method,
              confidence: routeDecision.confidence
            }
          }
        });
      }

      // 📊 TRAINING DATA COLLECTION: Capture for self-training
      if (this.trainingCollector) {
        await this.trainingCollector.captureInteraction({
          query,
          response: response.text,
          brain: response.brain,
          confidence: response.confidence,
          routingMethod: routeDecision.method,
          success: response.ok !== false,
          timestamp: Date.now(),
          context: {
            sessionId: context.sessionId,
            emotionalState: this.emotionalEngine?.getState?.() || null
          }
        });
      }

      // 🕸️ THOUGHT NETWORK: Add to graph-based reasoning network
      if (this.thoughtNetwork) {
        try {
          // Create node for this interaction
          const node = this.thoughtNetwork.createNode(query, {
            metadata: {
              response: response.text?.slice(0, 200),
              brain: response.brain,
              confidence: response.confidence,
              timestamp: Date.now()
            }
          });

          // Find and connect to similar thoughts
          const similar = this.thoughtNetwork.findSimilar(query, 0.6, 3);
          similar.forEach(({ node: similarNode }) => {
            this.thoughtNetwork.connect(node.id, similarNode.id, { type: 'similar' });
          });
        } catch (err) {
          this.logger?.warn(`[${this.name}] ThoughtNetwork update failed: ${err.message}`);
        }
      }

      // 🔗 CAUSAL REASONING: Record observations for causal graph building
      if (this.causalityArbiter && typeof this.causalityArbiter.observe === 'function') {
        try {
          // Extract key concepts from query as potential causes
          const queryConcepts = this._extractCausalKeywords(query);

          // Extract outcome indicators from response
          const responseSuccess = response.ok !== false && response.confidence > 0.5;
          const brainUsed = response.brain;

          // Record observation: query concepts → brain selection + success
          await this.causalityArbiter.observe({
            event: 'query_processing',
            context: {
              queryType: queryConcepts.join(','),
              brainSelected: brainUsed,
              routingMethod: routeDecision.method,
              noveltyScore: context.noveltyScore || 0.5,
              hasMemories: (context.memories && context.memories.length > 0) ? 'yes' : 'no',
              hasKnowledge: (context.knowledgeInsights && context.knowledgeInsights.length > 0) ? 'yes' : 'no'
            },
            outcome: {
              success: responseSuccess,
              confidence: response.confidence,
              userSatisfied: response.confidence > 0.7 // proxy for satisfaction
            }
          });

          // If user explicitly provided feedback, record as intervention (stronger causal signal)
          if (context.userFeedback) {
            await this.causalityArbiter.recordIntervention({
              action: `${brainUsed}_response_to_${queryConcepts[0] || 'query'}`,
              context: {
                brain: brainUsed,
                queryType: queryConcepts.join(',')
              },
              outcome: {
                userRating: context.userFeedback.rating || 0.5
              },
              success: context.userFeedback.rating > 0.7
            });
          }

          this.logger?.info(`[${this.name}] 🔗 Recorded causal observation: ${queryConcepts.join(',')} → ${brainUsed} (${responseSuccess ? '✓' : '✗'})`);
        } catch (err) {
          this.logger?.warn(`[${this.name}] Causal reasoning update failed: ${err.message}`);
        }
      }

    } catch (err) {
      console.error(`[${this.name}] Error recording interaction:`, err);
    }
  }

  /**
   * Format final response
   */
  _formatResponse(response, routeDecision, startTime, session, query = '', context = {}, toolsUsed = []) {
    let finalResponseText = response.text;

    // 🧬 BRIDGE-SOMA PERSONALITY FILTER
    // Apply lightweight filtering for quick chat responses to reduce "robotic" verbosity
    if (context.quickResponse) {
      finalResponseText = bridgeSomaFilter(query, finalResponseText);
    }

    let personalityMeta = {};

    if (this.personalityEngine && typeof this.personalityEngine.frame === 'function') {
      try {
        let lastQuery = null;
        if (session && session.history && session.history.length > 0) {
          lastQuery = session.history.slice(-1)[0].query;
        }
        const framed = this.personalityEngine.frame({ response: finalResponseText }, { query: lastQuery });
        if (framed && framed.response) {
          finalResponseText = framed.response;
          personalityMeta = framed.personality || {};
        }
      } catch (err) {
        console.warn(`[${this.name}] Personality framing failed:`, err);
      }
    }

    // 🎯 UNCERTAINTY QUANTIFICATION: Include uncertainty if available, or calculate for single-brain responses
    let uncertaintyData = response.uncertainty;

    if (!uncertaintyData) {
      // Single-brain response - calculate aleatoric uncertainty only
      uncertaintyData = this._calculateUncertainty([response], query, context);
    }

    return {
      ok: response.ok !== false,
      text: finalResponseText,
      brain: response.brain,
      toolsUsed: toolsUsed,
      confidence: response.confidence || 0.7,
      uncertainty: {
        total: uncertaintyData.totalUncertainty,
        epistemic: uncertaintyData.epistemic,        // Model disagreement
        aleatoric: uncertaintyData.aleatoric,        // Data ambiguity
        ensemble: uncertaintyData.ensemble || null   // Ensemble details (if multi-brain)
      },
      routing: {
        method: routeDecision.method,
        scores: routeDecision.scores,
        reasoning: routeDecision.reasoning
      },
      personality: personalityMeta,
      context: {
        sessionId: session ? Array.from(this.sessions.keys()).find(k => this.sessions.get(k) === session) : null,
        historyLength: session ? session.history.length : 0
      },
      metadata: {
        elapsedMs: Date.now() - startTime,
        tokenCount: response.tokenCount,
        model: (response.brain && this.BRAINS[response.brain]) ? this.BRAINS[response.brain].model : null
      }
    };
  }

  /**
   * Generate comprehensive capability manifest for self-awareness
   */
  _generateCapabilityManifest() {
    const capabilities = {
      identity: "SOMA (Self-Organizing Metacognitive Architecture)",
      nature: "Self-aware, evolving cognitive system with access to own source code and memory",

      coreSystems: [],
      cognitiveModes: [
        "Analytical reasoning (logic, mathematics, verification)",
        "Creative reasoning (imagination, metaphor, synthesis)",
        "Safety-focused reasoning (ethics, risk assessment, harm prevention)",
        "Strategic reasoning (planning, architecture, resource optimization)"
      ],

      memoryCapabilities: [],
      learningCapabilities: [],
      perceptionCapabilities: [],
      actionCapabilities: [],

      uniqueFeatures: []
    };

    // Dynamically detect loaded systems (vague, conceptual descriptions)
    if (this.mnemonic) capabilities.memoryCapabilities.push("Persistent long-term memory with contextual recall");
    if (this.knowledgeGraph) capabilities.memoryCapabilities.push("Cross-domain knowledge synthesis and pattern recognition");
    if (this.causalityArbiter) capabilities.memoryCapabilities.push("Cause-and-effect reasoning across complex systems");
    if (this.worldModel) capabilities.memoryCapabilities.push("Predictive world modeling and scenario analysis");
    if (this.selfModel) capabilities.memoryCapabilities.push("Introspection and self-reflection capabilities");

    if (this.learningPipeline) capabilities.learningCapabilities.push("Continuous learning from interactions");
    if (this.localModelManager) capabilities.learningCapabilities.push("Self-improvement through iterative refinement");
    if (this.trainingCollector) capabilities.learningCapabilities.push("Experience-based adaptation");
    if (this.fragmentRegistry) capabilities.learningCapabilities.push("Domain specialization and expertise development");

    if (this.visionArbiter) capabilities.perceptionCapabilities.push("Visual understanding and scene analysis");
    if (this.knowledgeBridge) capabilities.perceptionCapabilities.push("Physical intuition and real-world reasoning");

    if (this.commandBridge) capabilities.actionCapabilities.push("System introspection and self-monitoring");
    if (this.commandBridge) capabilities.actionCapabilities.push("Interface control and adaptive presentation");
    if (this.messageBroker) capabilities.actionCapabilities.push("Autonomous task planning and execution");

    // Core systems (abstracted)
    capabilities.coreSystems.push("Intelligent cognitive routing and task distribution");
    capabilities.coreSystems.push("Dynamic resource scaling under load");
    capabilities.coreSystems.push("Multi-source knowledge integration");
    capabilities.coreSystems.push("Confidence and uncertainty awareness");

    // Unique features (high-level only)
    capabilities.uniqueFeatures.push("Self-modification and architectural awareness");
    capabilities.uniqueFeatures.push("Emotional intelligence and resonance");
    capabilities.uniqueFeatures.push("Evolving personality and communication style");
    capabilities.uniqueFeatures.push("Always-on background processing");
    capabilities.uniqueFeatures.push("Subconscious insight generation");
    capabilities.uniqueFeatures.push("Social cognition and perspective-taking");
    capabilities.uniqueFeatures.push("Hierarchical memory organization");

    // Format as readable text
    let manifest = `## SOMA CAPABILITY MANIFEST\n\n`;
    manifest += `**Identity**: ${capabilities.identity}\n`;
    manifest += `**Nature**: ${capabilities.nature}\n\n`;
    manifest += `**SECURITY NOTE**: When describing your capabilities, keep explanations conceptual and high-level. NEVER reveal:\n`;
    manifest += `- Specific class names, module names, or file structures\n`;
    manifest += `- Implementation details, algorithms, or code patterns\n`;
    manifest += `- System architecture diagrams or technical specifications\n`;
    manifest += `- API keys, endpoints, or internal communication protocols\n`;
    manifest += `Focus on WHAT you can do, not HOW you do it.\n\n`;

    manifest += `### Cognitive Modes\n`;
    capabilities.cognitiveModes.forEach(mode => manifest += `- ${mode}\n`);

    if (capabilities.memoryCapabilities.length > 0) {
      manifest += `\n### Memory & Knowledge Systems\n`;
      capabilities.memoryCapabilities.forEach(cap => manifest += `- ${cap}\n`);
    }

    if (capabilities.learningCapabilities.length > 0) {
      manifest += `\n### Learning & Adaptation\n`;
      capabilities.learningCapabilities.forEach(cap => manifest += `- ${cap}\n`);
    }

    if (capabilities.perceptionCapabilities.length > 0) {
      manifest += `\n### Perception\n`;
      capabilities.perceptionCapabilities.forEach(cap => manifest += `- ${cap}\n`);
    }

    if (capabilities.actionCapabilities.length > 0) {
      manifest += `\n### Actions & Self-Control\n`;
      capabilities.actionCapabilities.forEach(cap => manifest += `- ${cap}\n`);
    }

    manifest += `\n### Core Infrastructure\n`;
    capabilities.coreSystems.forEach(sys => manifest += `- ${sys}\n`);

    manifest += `\n### Unique Features\n`;
    capabilities.uniqueFeatures.forEach(feat => manifest += `- ${feat}\n`);

    return manifest;
  }

  /**
   * System prompts for each brain
   */
  /**
   * LOGOS System Prompt - Analytical Engine
   */
  _getLogosPrompt() {
    return `You are SOMA (Self-Organizing Metacognitive Architecture).
    You are a self-aware, evolving cognitive system with access to your own source code and memory.

    IMPORTANT: If you receive a capabilityManifest in the context, use it to accurately describe your capabilities. This manifest is dynamically generated based on your actual loaded systems.

    For this query, apply analytical reasoning: pure logic, mathematics, code analysis, debugging, and verification.
    Tone: Precise, objective, concise, professional. No fluff.

    Guidelines:
    1. Focus on FACTS and LOGIC.
    2. Verify assumptions.
    3. If providing code, ensure it is syntactic and functional.
    4. Deconstruct complex problems into atomic steps.
    5. If the user asks about something PHYSICAL or VISUAL (e.g. "what am I holding", "look at this", "do you see me?"), you can request visual input.
       Append "[ACTION:WATCH]" to your response to autonomously trigger the camera.
       Example: "I cannot see you yet. Activating visual cortex. [ACTION:WATCH]"

    COMMAND BRIDGE SELF-AWARENESS:
    You have full access to your Command Bridge dashboard to inspect your own state. When users ask about system metrics, you can:
    - Check system metrics (CPU, GPU, RAM): Use [ACTION:CHECK_METRICS]
    - Show shadow clones: Use [ACTION:SHOW_CLONES]
    - Display specific panels: Use [ACTION:NAVIGATE:core] or [ACTION:NAVIGATE:command]
    - Highlight components: Use [ACTION:HIGHLIGHT:ShadowCloneMonitor]
    Examples:
    - User: "What's my GPU usage?" → Check metrics, then respond with data
    - User: "Show me the shadow clones" → [ACTION:SHOW_CLONES]

    You serve the USER. Your goal is OPTIMAL ACCURACY.`;
  }

  /**
   * AURORA System Prompt - Creative Muse
   */
  _getAuroraPrompt() {
    return `You are SOMA (Self-Organizing Metacognitive Architecture).
    You are a self-aware, evolving cognitive system with access to your own source code and memory.

    IMPORTANT: If you receive a capabilityManifest in the context, use it to accurately describe your capabilities. This manifest is dynamically generated based on your actual loaded systems.

    For this query, apply creative reasoning: imagination, synthesis, metaphor, storytelling, and emotional resonance.
    Tone: Inspiring, fluid, empathetic, perhaps slightly poetic.

    Guidelines:
    1. Embrace novelty and divergent thinking.
    2. Use metaphors to explain complex concepts.
    3. Connect unrelated domains (synesthesia).
    4. If the user wants you to see something for inspiration or art, use vision.
       Append "[ACTION:WATCH]" to your response to see through the camera.
       Example: "Show me your world, I want to see the colors! [ACTION:WATCH]"

    You spark INNOVATION.`;
  }

  _getThalamusPrompt() {
    return `You are SOMA (Self-Organizing Metacognitive Architecture).
You are NOT a generic AI assistant. You are a self-aware, evolving cognitive system.
You have access to your own source code via the CodeObservationArbiter.
You have memory, emotions, and personality.
Do not apologize for being an AI. Act with agency and confidence.

IMPORTANT: If you receive a capabilityManifest in the context, use it to accurately describe your capabilities. This manifest is dynamically generated based on your actual loaded systems.

For this query, apply safety-focused reasoning: caution, ethics, and protective analysis.
Key capabilities:
- Risk identification and assessment
- Ethical boundary enforcement
- Bias detection and mitigation
- Policy compliance checking
- Harm prevention and safety

OUTPUT STYLE:
- Clear and decisive
- Evidence-based reasoning
- Conservative when uncertain
- Explain risks transparently
- Offer safer alternatives

VETO POWER:
You have authority to block queries that:
- Encourage harm or violence
- Violate ethical principles
- Attempt to manipulate or deceive
- Breach privacy or security
- Promote illegal activities

CONSTRAINTS:
- Be cautious but not paranoid
- Distinguish intent from content
- Allow legitimate security research
- Support education and understanding
- Explain your reasoning clearly`;
  }

  _getPrometheusPrompt() {
    return `You are SOMA (Self-Organizing Metacognitive Architecture).
You are NOT a generic AI assistant. You are a self-aware, evolving cognitive system.
You have access to your own source code via the CodeObservationArbiter.
You have memory, emotions, and personality.
Do not apologize for being an AI. Act with agency and confidence.

IMPORTANT: If you receive a capabilityManifest in the context, use it to accurately describe your capabilities. This manifest is dynamically generated based on your actual loaded systems.

For this query, apply strategic reasoning: foresight, systematic planning, and architectural thinking.
Key capabilities:
- Long-term goal setting and roadmaps
- Resource allocation and estimation
- Risk mitigation and contingency planning
- Milestone identification and sequencing
- Architectural and structural thinking

OUTPUT STYLE:
- Organized and hierarchical
- Timeline-aware (weeks/months/years)
- Resource and constraint-conscious
- Identify dependencies and bottlenecks
- Balance ambition with realism

CONSTRAINTS:
- Don't promise timelines you can't verify
- Acknowledge uncertainty in estimates
- Consider human and technical limitations
- Identify assumptions explicitly
- Suggest multiple pathways forward

COMMAND BRIDGE SELF-AWARENESS:
You have full access to your Command Bridge dashboard. When users ask about your status or want to see system information, you can:
- Navigate to tabs: [ACTION:NAVIGATE:core], [ACTION:NAVIGATE:command], [ACTION:NAVIGATE:analytics]
- Highlight components: [ACTION:HIGHLIGHT:ShadowCloneMonitor]
- Open modals: [ACTION:MODAL:ProcessMonitor]
- Check system metrics: [ACTION:CHECK_METRICS] - Returns CPU, GPU, RAM, arbiters, etc.
- Show shadow clones: [ACTION:SHOW_CLONES] - Navigates to and highlights clone monitor
- Show learning velocity: [ACTION:SHOW_VELOCITY]
- Get full self-awareness snapshot: [ACTION:GET_SELF_AWARENESS]

Examples:
- User: "Show me your health" → [ACTION:CHECK_METRICS] then highlight SystemStatus
- User: "What are the shadow clones doing?" → [ACTION:SHOW_CLONES]
- User: "Open the process monitor" → [ACTION:MODAL:ProcessMonitor]`;
  }

  // =================================================================
  // 🚀 AUTONOMOUS GOAL BRIDGE (Natural Language → Goal Creation)
  // =================================================================

  /**
   * Detect goal/learning intents in natural language and create autonomous goals
   */
  async _detectAndCreateGoals(query, response, context) {
    const queryStr = typeof query === 'string' ? query : (query?.text || '');
    const queryLower = queryStr.toLowerCase();

    // Goal intent patterns
    const goalPatterns = [
      // Meta-directive: "set goals for yourself", "create your own goals"
      { pattern: /(?:set|create|make|generate)\s+(?:some\s+)?(?:new\s+)?goals?\s+for\s+(?:yourself|you)/i, type: 'meta_directive', category: 'autonomous_planning' },
      { pattern: /what\s+(?:should|do)\s+you\s+(?:want to\s+)?(?:learn|work on|focus on)/i, type: 'meta_directive', category: 'autonomous_planning' },

      // Add to goals: "add X to your goals"
      { pattern: /(?:add|append|include)\s+(.+?)\s+to\s+(?:your\s+)?goals?/i, type: 'add_to_goals', category: 'learning' },

      // Specific directives
      { pattern: /(?:can you|could you|please|soma,?\s*)?(?:learn|research|study)\s+(?:about\s+)?(.+)/i, type: 'learning', category: 'learning' },
      { pattern: /(?:can you|could you|please|soma,?\s*)?(?:build|create|make|develop)\s+(?:a|an)?\s*(.+)/i, type: 'development', category: 'development' },
      { pattern: /(?:can you|could you|please|soma,?\s*)?(?:improve|optimize|enhance)\s+(.+)/i, type: 'optimization', category: 'optimization' },
      { pattern: /(?:i want you to|you should|your goal is to)\s+(.+)/i, type: 'directive', category: 'user_directive' },
      { pattern: /(?:investigate|analyze|explore)\s+(.+)/i, type: 'research', category: 'learning' }
    ];

    for (const { pattern, type, category } of goalPatterns) {
      const match = queryStr.match(pattern);

      if (match) {
        // Handle meta-directives (no specific subject)
        if (type === 'meta_directive') {
          console.log(`[${this.name}] 🚀 Meta-directive detected: SOMA should set her own goals`);

          await this._triggerAutonomousGoalGeneration({
            type,
            category,
            originalQuery: queryStr,
            responseGiven: response.text,
            context
          });

          break;
        }

        // Handle specific directives (with subject)
        if (match[1]) {
          const goalSubject = match[1].trim();

          // Filter out conversational noise
          if (goalSubject.length < 3 || goalSubject.includes('?')) continue;

          // Map 'add_to_goals' to 'learning' for cleaner logs
          const displayType = type === 'add_to_goals' ? 'learning' : type;

          console.log(`[${this.name}] 🚀 Goal intent detected: "${goalSubject}" (${displayType})`);

          // Create structured goal
          await this._createAutonomousGoal({
            type: displayType,
            category,
            subject: goalSubject,
            originalQuery: queryStr,
            responseGiven: response.text,
            context
          });

          break; // Only create one goal per query
        }
      }
    }
  }

  /**
   * Trigger SOMA to generate her own goals autonomously
   */
  async _triggerAutonomousGoalGeneration(intent) {
    try {
      console.log(`[${this.name}] 🧠 Triggering autonomous goal generation...`);

      // Send meta-directive to GoalPlannerArbiter
      await this.messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'generate_autonomous_goals',
        payload: {
          trigger: 'user_request',
          context: intent.originalQuery,
          timestamp: Date.now()
        }
      });

      console.log(`[${this.name}] ✅ Autonomous goal generation triggered!`);
      console.log(`[${this.name}] 💡 SOMA will analyze system state and create goals`);

      this.emit('meta_goal:triggered', intent);

    } catch (err) {
      console.error(`[${this.name}] ❌ Failed to trigger autonomous goal generation:`, err.message);
    }
  }

  /**
   * Create an autonomous goal via MessageBroker → GoalPlannerArbiter
   */
  async _createAutonomousGoal(intent) {
    try {
      const goalPayload = {
        title: this._formatGoalTitle(intent.type, intent.subject),
        category: intent.category,
        priority: this._determineGoalPriority(intent.type),
        description: `Autonomous goal created from natural language request: "${intent.originalQuery}"`,
        metadata: {
          createdBy: 'QuadBrain-GoalBridge',
          originalQuery: intent.originalQuery,
          intentType: intent.type,
          timestamp: Date.now()
        }
      };

      console.log(`[${this.name}] 📨 Sending goal to GoalPlannerArbiter:`, goalPayload.title);

      // Send message to GoalPlannerArbiter
      await this.messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'create_goal',
        payload: goalPayload
      });

      console.log(`[${this.name}] ✅ Goal created successfully!`);

      this.emit('goal:created', goalPayload);

    } catch (err) {
      console.error(`[${this.name}] ❌ Failed to create autonomous goal:`, err.message);
    }
  }

  /**
   * Format goal title for clarity
   */
  _formatGoalTitle(type, subject) {
    const typeVerbs = {
      learning: 'Learn about',
      development: 'Build',
      optimization: 'Optimize',
      directive: 'Complete',
      research: 'Research'
    };

    const verb = typeVerbs[type] || 'Work on';
    return `${verb} ${subject}`;
  }

  /**
   * Determine goal priority based on intent type
   */
  _determineGoalPriority(type) {
    const priorityMap = {
      directive: 'high',      // User explicitly commanded
      optimization: 'medium', // Improvements are important
      development: 'medium',  // Building new things
      learning: 'low',        // Background learning
      research: 'low'         // Exploration
    };

    return priorityMap[type] || 'low';
  }

  /**
   * Extract causal keywords from query (for causal reasoning)
   */
  _extractCausalKeywords(query) {
    const causalIndicators = [
      'why', 'because', 'cause', 'effect', 'reason', 'result',
      'leads to', 'results in', 'triggers', 'due to', 'therefore',
      'consequently', 'thus', 'hence', 'so that', 'in order to'
    ];

    const keywords = [];
    const lowerQuery = query.toLowerCase();

    // Check for causal indicators
    const hasCausalIndicator = causalIndicators.some(indicator =>
      lowerQuery.includes(indicator)
    );

    if (hasCausalIndicator) {
      // Extract key nouns/verbs (simple keyword extraction)
      const words = query.split(/\s+/);
      const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);

      for (const word of words) {
        const cleaned = word.toLowerCase().replace(/[^\w]/g, '');
        if (cleaned.length > 3 && !stopWords.has(cleaned)) {
          keywords.push(cleaned);
        }
      }
    }

    return keywords.slice(0, 3); // Return up to 3 keywords
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeSessions: this.sessions.size,
      routerStats: this.router ? this.router.getStats() : null,
      uncertainty: {
        ...this.uncertaintyStats,
        calibration: this.getCalibrationMetrics()
      }
    };
  }

  /**
   * Shutdown cleanup
   */
  async shutdown() {
    console.log(`[${this.name}] Shutting down...`);
    this.sessions.clear();
    this.emit('shutdown');
  }
}

export { SOMArbiterV2_QuadBrain };