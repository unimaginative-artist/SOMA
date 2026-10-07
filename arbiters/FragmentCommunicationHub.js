/**
 * FragmentCommunicationHub.js - Inter-Fragment Communication System
 *
 * Enables fragments to consult each other, creating emergent intelligence through collaboration.
 *
 * Examples:
 * - Medical fragment asks Legal fragment about medical malpractice
 * - Code fragment asks Business fragment about software licensing
 * - Legal fragment asks Medical fragment about healthcare regulations
 *
 * Features:
 * - Async messaging between fragments
 * - Consultation routing (fragment A asks fragment B for advice)
 * - Consensus formation when multiple fragments collaborate
 * - Communication logs for learning
 * - Prevents infinite loops (max consultation depth)
 * - Weighted voting based on fragment expertise
 */

import { EventEmitter } from 'events';

export class FragmentCommunicationHub extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'FragmentCommunicationHub';

    // Dependencies
    this.fragmentRegistry = opts.fragmentRegistry;
    this.learningPipeline = opts.learningPipeline;
    this.messageBroker = opts.messageBroker; // Use MessageBroker for pub/sub

    // Communication tracking
    this.messageQueue = []; // Pending messages
    this.consultationHistory = new Map(); // fragmentId -> [consultations]
    this.activeCommunications = new Map(); // communicationId -> Communication
    this.pendingConsultations = new Map(); // consultationId -> Promise resolver

    // Communication patterns (learned over time)
    this.collaborationPatterns = new Map(); // "fragmentA->fragmentB" -> successRate

    // Configuration
    this.config = {
      maxConsultationDepth: opts.maxConsultationDepth || 3, // Prevent infinite loops
      consultationTimeout: opts.consultationTimeout || 10000, // 10 seconds
      minExpertiseForConsultation: opts.minExpertiseForConsultation || 0.3,
      consensusThreshold: opts.consensusThreshold || 0.7 // 70% agreement needed
    };

    // Stats
    this.stats = {
      totalConsultations: 0,
      successfulConsultations: 0,
      consensusReached: 0,
      collaborationPatterns: 0,
      avgConsultationTime: 0,
      messagesSent: 0,
      messagesReceived: 0
    };

    console.log(`[${this.name}] Initialized - fragments can now communicate`);
  }

  /**
   * Initialize the communication hub
   */
  async initialize() {
    console.log(`[${this.name}] 🔗 Initializing Fragment Communication Hub...`);

    if (!this.fragmentRegistry) {
      console.warn(`[${this.name}] WARNING: FragmentRegistry not provided`);
    }

    // Subscribe to MessageBroker events for inter-fragment communication
    if (this.messageBroker) {
      this.messageBroker.subscribe('fragment:consultation:request', this._handleConsultationRequest.bind(this));
      this.messageBroker.subscribe('fragment:consultation:response', this._handleConsultationResponse.bind(this));
      this.messageBroker.subscribe('fragment:broadcast', this._handleBroadcast.bind(this));
      console.log(`[${this.name}]    Subscribed to MessageBroker events`);
    }

    // Start message processor
    this.startMessageProcessor();

    console.log(`[${this.name}] ✅ Communication Hub ready`);
  }

  /**
   * Fragment A consults Fragment B for expertise
   *
   * @param {string} requestingFragmentId - Fragment asking for help
   * @param {string} query - Question to ask
   * @param {object} context - Additional context
   * @returns {object} - Response from consulted fragment(s)
   */
  async consultFragment(requestingFragmentId, query, context = {}) {
    const startTime = Date.now();
    this.stats.totalConsultations++;

    const requestingFragment = this.fragmentRegistry.fragments.get(requestingFragmentId);
    if (!requestingFragment) {
      throw new Error(`Fragment ${requestingFragmentId} not found`);
    }

    // Check consultation depth (prevent infinite loops)
    const depth = context.consultationDepth || 0;
    if (depth >= this.config.maxConsultationDepth) {
      console.warn(`[${this.name}] Max consultation depth reached`);
      return {
        success: false,
        reason: 'max_depth_exceeded',
        depth
      };
    }

    // Find best fragment(s) to consult
    const candidates = await this.findConsultationCandidates(
      requestingFragment,
      query,
      context
    );

    if (candidates.length === 0) {
      return {
        success: false,
        reason: 'no_suitable_fragments',
        query
      };
    }

    // Create consultation
    const consultationId = `consult_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const consultation = {
      id: consultationId,
      requestingFragment: requestingFragmentId,
      query,
      candidates,
      responses: [],
      startTime,
      depth,
      context
    };

    this.activeCommunications.set(consultationId, consultation);

    // Consult top candidates (parallel)
    const topCandidates = candidates.slice(0, 3); // Top 3
    const consultPromises = topCandidates.map(candidate =>
      this.sendConsultationRequest(
        candidate.fragmentId,
        query,
        { ...context, consultationDepth: depth + 1, consultedBy: requestingFragmentId }
      )
    );

    const responses = await Promise.allSettled(consultPromises);

    // Process responses
    const successfulResponses = responses
      .filter(r => r.status === 'fulfilled' && r.value.success)
      .map(r => r.value);

    consultation.responses = successfulResponses;
    consultation.endTime = Date.now();
    consultation.elapsed = consultation.endTime - startTime;

    // Record in history
    if (!this.consultationHistory.has(requestingFragmentId)) {
      this.consultationHistory.set(requestingFragmentId, []);
    }
    this.consultationHistory.get(requestingFragmentId).push(consultation);

    // Update collaboration patterns
    for (const candidate of topCandidates) {
      const patternKey = `${requestingFragmentId}->${candidate.fragmentId}`;
      if (!this.collaborationPatterns.has(patternKey)) {
        this.collaborationPatterns.set(patternKey, { successes: 0, attempts: 0 });
      }
      const pattern = this.collaborationPatterns.get(patternKey);
      pattern.attempts++;
      if (successfulResponses.length > 0) {
        pattern.successes++;
      }
    }

    // Form consensus if multiple responses
    let finalResponse;
    if (successfulResponses.length > 1) {
      finalResponse = await this.formConsensus(successfulResponses, query);
      if (finalResponse.consensusReached) {
        this.stats.consensusReached++;
      }
    } else if (successfulResponses.length === 1) {
      finalResponse = successfulResponses[0];
    } else {
      finalResponse = {
        success: false,
        reason: 'no_responses',
        query
      };
    }

    // Log to learning pipeline
    if (this.learningPipeline) {
      await this.learningPipeline.logInteraction({
        type: 'fragment_consultation',
        agent: this.name,
        input: { requestingFragment: requestingFragmentId, query },
        output: finalResponse,
        context: { candidatesConsulted: topCandidates.length, responsesReceived: successfulResponses.length },
        metadata: {
          success: finalResponse.success,
          elapsedMs: consultation.elapsed,
          consensusReached: finalResponse.consensusReached || false
        }
      });
    }

    if (finalResponse.success) {
      this.stats.successfulConsultations++;
    }

    // Update avg consultation time
    this.stats.avgConsultationTime =
      (this.stats.avgConsultationTime * (this.stats.totalConsultations - 1) + consultation.elapsed) /
      this.stats.totalConsultations;

    this.activeCommunications.delete(consultationId);

    this.emit('consultation:complete', {
      consultationId,
      requestingFragment: requestingFragmentId,
      success: finalResponse.success,
      elapsed: consultation.elapsed
    });

    return finalResponse;
  }

  /**
   * Find fragments best suited to help with this query
   */
  async findConsultationCandidates(requestingFragment, query, context) {
    const candidates = [];

    // Exclude requesting fragment's pillar (consult different perspectives)
    const excludePillar = context.requireDifferentPillar !== false;

    for (const [fragmentId, fragment] of this.fragmentRegistry.fragments) {
      // Skip self
      if (fragmentId === requestingFragment.id) continue;

      // Skip same pillar if required
      if (excludePillar && fragment.pillar === requestingFragment.pillar) continue;

      // Skip if not active
      if (!fragment.active) continue;

      // Check expertise threshold
      if (fragment.expertiseLevel < this.config.minExpertiseForConsultation) continue;

      // Score fragment relevance
      const score = this.scoreFragmentRelevance(fragment, query, requestingFragment);

      if (score > 0.3) {
        candidates.push({
          fragmentId,
          fragment,
          score,
          pillar: fragment.pillar,
          domain: fragment.domain
        });
      }
    }

    // Sort by score
    candidates.sort((a, b) => b.score - a.score);

    // Boost candidates with successful collaboration history
    for (const candidate of candidates) {
      const patternKey = `${requestingFragment.id}->${candidate.fragmentId}`;
      const pattern = this.collaborationPatterns.get(patternKey);
      if (pattern && pattern.attempts > 2) {
        const successRate = pattern.successes / pattern.attempts;
        candidate.score = candidate.score * 0.7 + successRate * 0.3; // Blend
      }
    }

    // Re-sort after boost
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  }

  /**
   * Score how relevant a fragment is to the query
   */
  scoreFragmentRelevance(fragment, query, requestingFragment) {
    let score = 0.0;
    const queryLower = query.toLowerCase();

    // Keyword matching
    const matchedKeywords = fragment.keywords.filter(kw =>
      queryLower.includes(kw.toLowerCase())
    );
    score += (matchedKeywords.length / fragment.keywords.length) * 0.5;

    // Expertise boost
    score += fragment.expertiseLevel * 0.3;

    // Domain complementarity (different domains often have useful perspectives)
    if (fragment.domain !== requestingFragment.domain) {
      score += 0.2;
    }

    return Math.min(1.0, score);
  }

  /**
   * Send consultation request to a fragment — calls the real model
   */
  async sendConsultationRequest(fragmentId, query, context) {
    const fragment = this.fragmentRegistry.fragments.get(fragmentId);
    if (!fragment) {
      return { success: false, reason: 'fragment_not_found' };
    }

    // Record that this fragment was consulted
    fragment.stats.activationCount++;

    // Build consultation prompt using fragment's own system prompt + domain expertise
    const consultationPrompt = `${fragment.systemPrompt}

DOMAIN: ${fragment.domain}
SPECIALIZATION: ${fragment.specialization}
EXPERTISE LEVEL: ${(fragment.expertiseLevel * 100).toFixed(0)}%

You are being consulted by another specialist for your domain perspective.

CONSULTATION QUERY:
"${query}"

Provide a concise, expert response from your ${fragment.domain} perspective. Be specific and draw on your domain expertise.`;

    // Call the real model via the fragment's pillar brain
    let responseText = null;
    try {
      const quadBrain = this.fragmentRegistry.quadBrain;
      if (quadBrain) {
        const pillar = fragment.pillar || 'LOGOS';
        const result = await quadBrain.callBrain(
          pillar,
          consultationPrompt,
          { ...context, systemOverride: true, enableNemesis: false, isConsultation: true },
          'full'
        );
        responseText = result?.text || null;
      }
    } catch (err) {
      console.warn(`[${this.name}] Consultation call failed for ${fragmentId}: ${err.message}`);
    }

    if (!responseText) {
      return { success: false, reason: 'no_response', fragmentId };
    }

    const response = {
      success: true,
      fragmentId,
      domain: fragment.domain,
      specialization: fragment.specialization,
      expertiseLevel: fragment.expertiseLevel,
      response: responseText,
      confidence: fragment.expertiseLevel * 0.8 + (responseText.length > 100 ? 0.2 : 0.05),
      timestamp: Date.now()
    };

    this.emit('fragment:consulted', {
      fragmentId,
      query,
      consultedBy: context.consultedBy
    });

    return response;
  }

  /**
   * Form consensus from multiple fragment responses
   */
  async formConsensus(responses, query) {
    if (responses.length === 0) {
      return { success: false, reason: 'no_responses' };
    }

    if (responses.length === 1) {
      return { ...responses[0], consensusReached: true, consensusStrength: 1.0 };
    }

    // Weighted voting based on expertise
    const weightedResponses = responses.map(r => ({
      ...r,
      weight: r.expertiseLevel * r.confidence
    }));

    // Calculate total weight
    const totalWeight = weightedResponses.reduce((sum, r) => sum + r.weight, 0);

    // Find dominant response (highest weight)
    weightedResponses.sort((a, b) => b.weight - a.weight);
    const dominant = weightedResponses[0];

    // Calculate consensus strength (how much of total weight agrees)
    const consensusStrength = dominant.weight / totalWeight;

    // Combine insights from all responses
    const combinedResponse = {
      success: true,
      response: this.synthesizeResponses(weightedResponses, query),
      confidence: consensusStrength,
      consensusReached: consensusStrength >= this.config.consensusThreshold,
      consensusStrength,
      contributingFragments: responses.map(r => ({
        fragmentId: r.fragmentId,
        domain: r.domain,
        weight: weightedResponses.find(wr => wr.fragmentId === r.fragmentId).weight
      })),
      perspective: 'multi-domain-consensus'
    };

    return combinedResponse;
  }

  /**
   * Synthesize multiple fragment perspectives into coherent response
   */
  synthesizeResponses(weightedResponses, query) {
    const perspectives = weightedResponses.map(r =>
      `${r.domain} (${(r.weight * 100).toFixed(0)}%): ${r.response}`
    );

    return `Consensus from ${weightedResponses.length} domain experts:\n\n${perspectives.join('\n\n')}`;
  }

  /**
   * Start background message processor
   */
  startMessageProcessor() {
    setInterval(() => {
      if (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        this.processMessage(message);
      }
    }, 100); // Process every 100ms
  }

  /**
   * Process a queued message
   */
  async processMessage(message) {
    // Future: Handle async messages between fragments
    this.emit('message:processed', message);
  }

  /**
   * MessageBroker handlers for pub/sub communication
   */
  async _handleConsultationRequest(data) {
    this.stats.messagesReceived++;
    const { consultationId, requestingFragmentId, targetFragmentId, query, context } = data;

    // Check if this is for one of our fragments
    if (!this.fragmentRegistry.fragments.has(targetFragmentId)) {
      return; // Not for us
    }

    // Send consultation and publish response
    const response = await this.sendConsultationRequest(targetFragmentId, query, context);

    if (this.messageBroker) {
      this.messageBroker.publish('fragment:consultation:response', {
        consultationId,
        requestingFragmentId,
        targetFragmentId,
        response,
        timestamp: Date.now()
      });
      this.stats.messagesSent++;
    }
  }

  async _handleConsultationResponse(data) {
    this.stats.messagesReceived++;
    const { consultationId, response } = data;

    // Resolve pending consultation
    const resolver = this.pendingConsultations.get(consultationId);
    if (resolver) {
      resolver(response);
      this.pendingConsultations.delete(consultationId);
    }
  }

  async _handleBroadcast(data) {
    this.stats.messagesReceived++;
    // Handle fragment broadcasts (future: knowledge sharing, alerts, etc.)
    this.emit('fragment:broadcast:received', data);
  }

  /**
   * Publish consultation request via MessageBroker
   */
  async _publishConsultationRequest(consultationId, requestingFragmentId, targetFragmentId, query, context) {
    if (!this.messageBroker) {
      return null; // Fallback to direct call
    }

    this.stats.messagesSent++;
    this.messageBroker.publish('fragment:consultation:request', {
      consultationId,
      requestingFragmentId,
      targetFragmentId,
      query,
      context,
      timestamp: Date.now()
    });

    // Wait for response (with timeout)
    return new Promise((resolve) => {
      this.pendingConsultations.set(consultationId, resolve);

      setTimeout(() => {
        if (this.pendingConsultations.has(consultationId)) {
          this.pendingConsultations.delete(consultationId);
          resolve({ success: false, reason: 'timeout' });
        }
      }, this.config.consultationTimeout);
    });
  }

  /**
   * Get consultation statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeConsultations: this.activeCommunications.size,
      queuedMessages: this.messageQueue.length,
      successRate: this.stats.totalConsultations > 0
        ? (this.stats.successfulConsultations / this.stats.totalConsultations) * 100
        : 0,
      collaborationPatterns: this.collaborationPatterns.size
    };
  }

  /**
   * Get collaboration patterns (which fragments work well together)
   */
  getCollaborationPatterns() {
    const patterns = [];
    for (const [key, stats] of this.collaborationPatterns) {
      const [from, to] = key.split('->');
      patterns.push({
        from,
        to,
        attempts: stats.attempts,
        successes: stats.successes,
        successRate: stats.attempts > 0 ? stats.successes / stats.attempts : 0
      });
    }
    return patterns.sort((a, b) => b.successRate - a.successRate);
  }
}

export default FragmentCommunicationHub;
