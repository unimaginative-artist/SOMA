/**
 * MessageBroker.js
 * 
 * Central message routing system for arbiter communication
 * Supports pub/sub, direct messaging, and broadcast patterns
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const SignalCompressor = require('./SignalCompressor.cjs');
const SignalRegistry = require('./SignalSchema.cjs').default;

class MessageBroker extends EventEmitter {
  constructor() {
    super();

    // 🔱 Sovereign CNS: Physically lock state across all module boundaries
    if (!global.__SOMA_CNS__) {
        global.__SOMA_CNS__ = {
            arbiters: new Map(),
            lobeIndex: new Map(),
            tierIndex: new Map(),   // 'strategic' | 'cognitive' | 'operational'
            classificationIndex: new Map(),
            discoveryIndex: new Map(),
            subscriptions: new Map(),
            tieredSubscriptions: new Map(), // topic -> { strategic: Set, cognitive: Set, operational: Set }
            recentPublishes: [],
            messageHistory: [],
            metrics: {
                messagesSent: 0,
                messagesDelivered: 0,
                messagesFailed: 0,
                startTime: Date.now()
            }
        };
    }

    // Backfill tieredSubscriptions for instances created before this field existed
    if (!global.__SOMA_CNS__.tieredSubscriptions) {
        global.__SOMA_CNS__.tieredSubscriptions = new Map();
    }

    const cns = global.__SOMA_CNS__;
    this.arbiters = cns.arbiters;
    this.lobeIndex = cns.lobeIndex;
    this.tierIndex = cns.tierIndex;
    this.classificationIndex = cns.classificationIndex;
    this.discoveryIndex = cns.discoveryIndex;
    this.subscriptions = cns.subscriptions;
    this.tieredSubscriptions = cns.tieredSubscriptions;
    this._recentPublishes = cns.recentPublishes;
    this.messageHistory = cns.messageHistory;
    this.metrics = cns.metrics;

    // CNS: Impulse Compression & Validation
    this.signalRegistry = SignalRegistry;
    this.compressor = new SignalCompressor({
      windowMs: Number(process.env.SOMA_SIGNAL_COMPRESS_MS || 1000),
      onCompressed: (signal) => this._deliverSignal(signal)
    });
    this.arbiterLoader = null; // Hook for on-the-fly expansion
    this.handlerFailures = new Map(); // handler key -> { count, firstAt, lastAt }
    this.handlerFailureThreshold = Number(process.env.SOMA_BROKER_HANDLER_FAILURE_THRESHOLD || 3);
    this.handlerFailureWindowMs = Number(process.env.SOMA_BROKER_HANDLER_FAILURE_WINDOW_MS || 60000);

    // Circular Buffer State
    this.maxHistorySize = 500;
    this.historyWriteIndex = 0;
    this.historyFull = false;
  }

  /**
   * Set the ArbiterLoader instance for on-the-fly expansion.
   */
  setArbiterLoader(loader) {
    this.arbiterLoader = loader;
    console.log('[MessageBroker] 📚 ArbiterLoader integrated for on-the-fly expansion.');
  }

  // ===========================
  // Arbiter Registration
  // ===========================

  registerArbiter(name, metadata = {}) {
    const entry = {
      name,
      ...metadata,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now()
    };
    
    this.arbiters.set(name, entry);

    // Update Neural Indices
    if (metadata.lobe) {
      if (!this.lobeIndex.has(metadata.lobe)) this.lobeIndex.set(metadata.lobe, new Set());
      this.lobeIndex.get(metadata.lobe).add(name);
    }

    if (metadata.tier) {
      if (!this.tierIndex.has(metadata.tier)) this.tierIndex.set(metadata.tier, new Set());
      this.tierIndex.get(metadata.tier).add(name);
    }

    if (metadata.classification) {
      if (!this.classificationIndex.has(metadata.classification)) this.classificationIndex.set(metadata.classification, new Set());
      this.classificationIndex.get(metadata.classification).add(name);
    }

    this.emit('arbiter_registered', name, metadata);
    const tierTag = metadata.tier ? ` | Tier: ${metadata.tier}` : '';
    console.log(`[MessageBroker] Arbiter registered: ${name} [Lobe: ${metadata.lobe || 'N/A'}${tierTag}]`);
  }

  unregisterArbiter(name) {
    const arbiter = this.arbiters.get(name);
    if (arbiter) {
      if (arbiter.lobe) this.lobeIndex.get(arbiter.lobe)?.delete(name);
      if (arbiter.tier) this.tierIndex.get(arbiter.tier)?.delete(name);
      if (arbiter.classification) this.classificationIndex.get(arbiter.classification)?.delete(name);
    }
    this.arbiters.delete(name);
    this.emit('arbiter_unregistered', name);
    console.log(`[MessageBroker] Arbiter unregistered: ${name}`);
  }

  getArbitersByLobe(lobe) {
    const names = this.lobeIndex.get(lobe) || new Set();
    return Array.from(names).map(name => this.arbiters.get(name));
  }

  getArbitersByTier(tier) {
    const names = this.tierIndex.get(tier) || new Set();
    return Array.from(names).map(name => this.arbiters.get(name));
  }

  getTierBreakdown() {
    const breakdown = { strategic: 0, cognitive: 0, operational: 0, untiered: 0 };
    for (const [, arbiter] of this.arbiters) {
      const t = arbiter.tier;
      if (t === 'strategic' || t === 'cognitive' || t === 'operational') breakdown[t]++;
      else breakdown.untiered++;
    }
    return breakdown;
  }

  getArbitersByClassification(cls) {
    const names = this.classificationIndex.get(cls) || new Set();
    return Array.from(names).map(name => this.arbiters.get(name));
  }

  /**
   * Scan disk for arbiters that exist but aren't currently registered/active.
   */
  async scanForUnusedArbiters(dir = null) {
    const arbiterDir = dir || path.join(process.cwd(), 'arbiters');
    try {
      const files = await fs.readdir(arbiterDir);
      for (const file of files) {
        if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.mjs')) {
          const name = file.replace(/\.(js|cjs|mjs)$/, '');
          if (!this.arbiters.has(name)) {
            this.discoveryIndex.set(name, {
              filename: file,
              path: path.join(arbiterDir, file),
              status: 'inactive'
            });
          }
        }
      }
      console.log(`[MessageBroker] Discovery: Found ${this.discoveryIndex.size} inactive arbiters on disk.`);
      return Array.from(this.discoveryIndex.keys());
    } catch (e) {
      console.error(`[MessageBroker] Discovery scan failed: ${e.message}`);
      return [];
    }
  }

  getDiscoveryList() {
    return Array.from(this.discoveryIndex.values());
  }

  getArbiter(name) {
    return this.arbiters.get(name);
  }

  getArbiters() {
    return Array.from(this.arbiters.values());
  }

  // Alias for getArbiters (used by metrics broadcasting)
  getRegisteredArbiters() {
    return this.getArbiters();
  }

  getArbiterList() {
    return this.getArbiters().map(a => ({
      id: a.name, // Frontend uses ID
      name: a.name,
      role: a.role || 'unknown',
      status: a.status || 'active',
      type: a.type || 'arbiter'
    }));
  }

  getArbitersByRole(role) {
    return this.getArbiters().filter(a => a.role === role);
  }

  getArbitersByCapability(capability) {
    return this.getArbiters().filter(a =>
      a.capabilities && a.capabilities.includes(capability)
    );
  }

  // ===========================
  // Pub/Sub System
  // ===========================

  subscribe(topicOrSubscriber, handlerOrTopic, options = {}) {
    // 🔱 Dual-signature normalizer:
    // Overload 1 (Legacy arbiter style): subscribe(subscriberName, topicName) where both are strings
    if (typeof topicOrSubscriber === 'string' && typeof handlerOrTopic === 'string') {
      const subscriberName = topicOrSubscriber;
      const topic = handlerOrTopic;
      const handler = (envelope) => {
        const arbiterEntry = this.arbiters.get(subscriberName);
        const arbiter = arbiterEntry?.instance || arbiterEntry;
        if (arbiter && typeof arbiter.handleMessage === 'function') {
          arbiter.handleMessage(envelope);
        } else if (arbiter && typeof arbiter.receiveMessage === 'function') {
          arbiter.receiveMessage(envelope);
        } else if (arbiter && typeof arbiter.emit === 'function') {
          arbiter.emit(topic, envelope?.payload || envelope);
        }
      };
      handler.__subscriberName = subscriberName;
      handler.__arbiterId = subscriberName;
      return this.subscribe(topic, handler, options);
    }

    // Overload 2 (Standard pub/sub): subscribe(topic, handlerFunction, options)
    const topic = topicOrSubscriber;
    const handler = handlerOrTopic;

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }

    if (options.arbiterId && typeof handler === 'function') handler.__arbiterId = options.arbiterId;
    if (typeof handler === 'function') {
      this.subscriptions.get(topic).add(handler);
    }

    return () => this.unsubscribe(topic, handler);
  }

  unsubscribe(topic, handler) {
    const handlers = this.subscriptions.get(topic);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscriptions.delete(topic);
      }
    }
  }

  /**
   * Lobe-scoped subscription — handler only fires if the signal was published
   * by an arbiter registered in the given lobe (or if the signal has no source lobe).
   * This prevents 178 arbiters from all reacting to every signal.
   *
   * @param {string} lobe   - e.g. 'limbic', 'prefrontal', 'motor_cortex'
   * @param {string} topic  - the signal topic
   * @param {Function} handler - (envelope) => void
   * @returns {Function} unsubscribe
   */
  subscribeByLobe(lobe, topic, handler) {
    const filtered = (envelope) => {
      // If the signal has a source, check whether it's from the target lobe
      if (envelope.source) {
        const sourceMeta = this.arbiters.get(envelope.source);
        if (sourceMeta && sourceMeta.lobe && sourceMeta.lobe !== lobe) return; // wrong lobe — skip
      }
      if (typeof handler === 'function') {
        handler(envelope);
      } else {
        console.warn(`[MessageBroker] 🛡️ Blocked invalid handler in lobe subscription: ${lobe}/${topic}`);
      }
    };
    return this.subscribe(topic, filtered);
  }

  /**
   * Tier-scoped subscription — handler fires after all handlers in higher tiers resolve.
   * Dispatch order: strategic → cognitive → operational → untiered (flat subscriptions).
   *
   * @param {'strategic'|'cognitive'|'operational'} tier
   * @param {string} topic
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  subscribeTiered(tier, topic, handler, options = {}) {
    const VALID = ['strategic', 'cognitive', 'operational'];
    if (!VALID.includes(tier)) throw new Error(`[MessageBroker] Unknown tier: ${tier}`);
    if (!this.tieredSubscriptions.has(topic)) {
      this.tieredSubscriptions.set(topic, { strategic: new Set(), cognitive: new Set(), operational: new Set() });
    }
    if (options.arbiterId && typeof handler === 'function') handler.__arbiterId = options.arbiterId;
    this.tieredSubscriptions.get(topic)[tier].add(handler);
    return () => this.unsubscribeTiered(tier, topic, handler);
  }

  _inferHandlerArbiterId(handler, fallback = null) {
    if (!handler) return fallback;
    if (handler.__arbiterId) return handler.__arbiterId;
    const name = String(handler.name || '');
    if (this.arbiters.has(name)) return name;
    const bound = name.match(/^bound\s+(.+)$/i)?.[1];
    if (bound && this.arbiters.has(bound)) return bound;
    return fallback;
  }

  _recordHandlerFailure({ topic = 'unknown', handler = null, error = null, tier = 'flat', arbiterId = null } = {}) {
    const inferredArbiterId = arbiterId || this._inferHandlerArbiterId(handler);
    const handlerName = String(handler?.name || inferredArbiterId || 'anonymous');
    const key = `${topic}:${tier}:${inferredArbiterId || handlerName}`;
    const now = Date.now();
    const prior = this.handlerFailures.get(key);
    const record = prior && (now - prior.firstAt) <= this.handlerFailureWindowMs
      ? { ...prior, count: prior.count + 1, lastAt: now }
      : { count: 1, firstAt: now, lastAt: now };
    this.handlerFailures.set(key, record);

    const payload = {
      topic,
      tier,
      handlerName,
      arbiterId: inferredArbiterId,
      count: record.count,
      threshold: this.handlerFailureThreshold,
      error: error?.message || String(error || 'handler failed'),
      firstAt: record.firstAt,
      lastAt: record.lastAt,
    };
    this.emit('broker.handler_failed', payload);

    if (inferredArbiterId && record.count >= this.handlerFailureThreshold) {
      this.handlerFailures.delete(key);
      const restartPayload = {
        arbiterId: inferredArbiterId,
        reason: 'broker_handler_failure_threshold',
        topic,
        tier,
        failures: record.count,
        error: payload.error,
      };
      console.warn(`[MessageBroker] ♻️ Requesting restart for ${inferredArbiterId} after ${record.count} handler failures on ${topic}`);
      this.emit('arbiter.restart', restartPayload);
      if (topic !== 'arbiter.restart') {
        setImmediate(() => this.publish('arbiter.restart', restartPayload).catch(() => {}));
      }
    }
    return payload;
  }

  unsubscribeTiered(tier, topic, handler) {
    const buckets = this.tieredSubscriptions.get(topic);
    if (buckets && buckets[tier]) buckets[tier].delete(handler);
  }

  async publish(topic, message) {
    // Track in ring buffer for perception dashboard
    this._recentPublishes.push({ topic, ts: Date.now(), preview: JSON.stringify(message).slice(0, 80) });
    if (this._recentPublishes.length > 20) this._recentPublishes.shift();

    const tieredBuckets = this.tieredSubscriptions.get(topic);
    const flatHandlers = this.subscriptions.get(topic);
    const hasTiered = tieredBuckets && (
      tieredBuckets.strategic.size > 0 ||
      tieredBuckets.cognitive.size > 0 ||
      tieredBuckets.operational.size > 0
    );
    const hasEventEmitterListeners = this.listenerCount(topic) > 0;

    if (!hasTiered && (!flatHandlers || flatHandlers.size === 0) && !hasEventEmitterListeners) {
      return 0;
    }

    const envelope = this._createEnvelope(message, topic);
    let delivered = 0;

    // Emit standard EventEmitter event
    try {
      if (hasEventEmitterListeners) {
        this.emit(topic, envelope);
        delivered += this.listenerCount(topic);
      }
    } catch (err) {
      console.error(`[MessageBroker] Error in EventEmitter dispatch for ${topic}:`, err);
    }

    // Tier-ordered dispatch: strategic → cognitive → operational (sequential, each awaited)
    if (hasTiered) {
      for (const tier of ['strategic', 'cognitive', 'operational']) {
        const handlers = tieredBuckets[tier];
        if (!handlers || handlers.size === 0) continue;
        const handlerList = Array.from(handlers).filter(h => typeof h === 'function');
        const results = await Promise.allSettled(handlerList.map(h => Promise.resolve().then(() => h(envelope))));
        results.forEach((r, index) => {
          if (r.status === 'fulfilled') delivered++;
          else {
            console.error(`[MessageBroker] Error in ${tier}-tier handler for ${topic}:`, r.reason);
            this._recordHandlerFailure({ topic, handler: handlerList[index], error: r.reason, tier });
            this.metrics.messagesFailed++;
          }
        });
      }
    }

    // Untiered flat subscriptions — parallel, existing behavior
    if (flatHandlers && flatHandlers.size > 0) {
      const handlerList = Array.from(flatHandlers).filter(h => typeof h === 'function');
      const results = await Promise.allSettled(handlerList.map(handler => Promise.resolve().then(() => handler(envelope))));
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          delivered++;
        } else {
          console.error(`[MessageBroker] Error delivering to ${topic}:`, result.reason);
          this._recordHandlerFailure({ topic, handler: handlerList[index], error: result.reason, tier: 'flat' });
          this.metrics.messagesFailed++;
        }
      });
    }

    this.metrics.messagesDelivered += delivered;
    return delivered;
  }

  // ===========================
  // Direct Messaging
  // ===========================

  async sendMessage(message) {
    this.metrics.messagesSent++;

    const envelope = this._createEnvelope(message);
    this._addToHistory(envelope);

    const { to } = message;

    // Handle broadcast
    if (to === 'broadcast' || to === 'all') {
      return await this.broadcast('system/all', message);
    }

    // Direct arbiter message - use fuzzy search with suggestions
    let findResult = this.findArbiter(to, { exact: false, suggest: true });

    // 🔱 ON-THE-FLY EXPANSION: If not found, try to load from disk
    if (!findResult.found && this.arbiterLoader) {
      console.log(`[MessageBroker] 🔌 Missing arbiter '${to}' — attempting on-the-fly expansion...`);
      try {
        const instance = await this.arbiterLoader.loadByFile(`${to}.js`);
        if (instance) {
          // Success! Broadcast activity
          this.publish('soma.activity', {
            type: 'expansion',
            title: `Dynamic Materialization: ${to}`,
            summary: `CNS intercepted request for missing capability and initialized ${to} from disk in real-time.`,
            source: 'CNS'
          });
          
          // Re-find the now-registered arbiter
          findResult = this.findArbiter(to, { exact: true });
        }
      } catch (loadErr) {
        console.warn(`[MessageBroker] ⚠️ Expansion failed for '${to}': ${loadErr.message}`);
      }
    }

    if (!findResult.found) {
      // Not found - provide helpful suggestions
      const suggestionText = findResult.suggestions && findResult.suggestions.length > 0
        ? `Did you mean: ${findResult.suggestions.map(s => s.name).join(', ')}?`
        : 'No similar arbiters found.';

      console.warn(`[MessageBroker] Arbiter not found: ${to}. ${suggestionText}`);
      this.metrics.messagesFailed++;

      // Emit event for anomaly detector with suggestions
      this.emit('message_failed', {
        to,
        type: message.type,
        error: `Arbiter not found: ${to}`,
        suggestions: findResult.suggestions || []
      });

      return false;
    }

    const arbiter = findResult.arbiter;

    // Log if we used fuzzy matching
    if (findResult.matchType !== 'exact') {
      console.log(`[MessageBroker] Used ${findResult.matchType} match: "${to}" → "${arbiter.name}"`);
    }

    // If arbiter has instance, deliver directly
    if (arbiter.instance) {
      if (message.type === 'reason' && typeof arbiter.instance.reason === 'function') {
        try {
          const query = message.payload?.query || message.payload || '';
          const context = message.payload?.context || {};
          const response = await arbiter.instance.reason(query, context);
          this.metrics.messagesDelivered++;
          return response;
        } catch (error) {
          console.error(`[MessageBroker] Error calling reason on target ${to}:`, error);
          this._recordHandlerFailure({ topic: `direct:${message.type || 'reason'}`, arbiterId: arbiter.name || to, error, tier: 'direct' });
          this.metrics.messagesFailed++;
          return null;
        }
      } else if (typeof arbiter.instance.handleMessage === 'function') {
        try {
          const response = await arbiter.instance.handleMessage(envelope);
          this.metrics.messagesDelivered++;
          return response;
        } catch (error) {
          console.error(`[MessageBroker] Error delivering to ${to}:`, error);
          this._recordHandlerFailure({ topic: `direct:${message.type || 'handleMessage'}`, arbiterId: arbiter.name || to, error, tier: 'direct' });
          this.metrics.messagesFailed++;
          return null;
        }
      }
    }

    // Otherwise publish to arbiter-specific topic
    const delivered = await this.publish(`arbiter/${to}`, envelope);
    return delivered > 0;
  }

  async request(to, typeOrMsg, payload = {}) {
    let message;
    if (typeOrMsg && typeof typeOrMsg === 'object') {
      message = {
        from: 'system',
        to,
        ...typeOrMsg
      };
    } else {
      message = {
        from: 'system',
        to,
        type: typeOrMsg,
        payload
      };
    }
    return await this.sendMessage(message);
  }

  async broadcast(topic, message) {
    const envelope = this._createEnvelope({ ...message, to: 'broadcast' }, topic);
    this._addToHistory(envelope);

    let delivered = 0;

    // 🔱 Strict Topic-Based Routing for 'system/all' or 'broadcast'
    if (topic === 'system/all' || topic === 'broadcast') {
        const targetCapability = message.payload?.targetCapability || message.targetCapability;
        const targetTier = message.payload?.targetTier || message.targetTier;
        const msgType = message.type || '';
        
        let targets = this.getArbiters();
        
        // Filter noise: Only route if it matches a capability, tier, or heuristic
        if (targetCapability) {
            targets = targets.filter(a => a.capabilities && a.capabilities.includes(targetCapability));
        } else if (targetTier) {
            targets = targets.filter(a => a.tier === targetTier);
        } else {
             // Heuristic routing to prevent exponential scaling noise
             if (msgType.includes('audit') || msgType.includes('forensic')) {
                 targets = targets.filter(a => a.tier === 'operational' || a.name.includes('Audit') || a.name.includes('Forensic'));
             } else if (msgType.includes('impulser') || msgType.includes('task')) {
                 targets = targets.filter(a => a.name === 'UniversalImpulser' || (a.capabilities && a.capabilities.includes('data_processing')));
             } else if (msgType.includes('learning') || msgType.includes('dream')) {
                 targets = targets.filter(a => a.tier === 'cognitive' || (a.capabilities && a.capabilities.includes('learning')));
             } else if (msgType === 'system_metrics' || msgType === 'status_check') {
                 targets = targets.filter(a => a.tier === 'strategic'); // Only strategic needs to process global status
             }
        }
        
        // Deliver directly via handleMessage to targeted arbiters
        const results = await Promise.allSettled(
            targets.map(async arbiter => {
                if (arbiter.instance && typeof arbiter.instance.handleMessage === 'function') {
                    return await arbiter.instance.handleMessage(envelope);
                }
            })
        );
        
        delivered = results.filter(r => r.status === 'fulfilled' && r.value !== undefined).length;
        
        // Also fallback to publish for generic subscribers just in case
        const publishedDelivered = await this.publish(topic, envelope);
        delivered += publishedDelivered;
    } else {
        // Normal pub/sub topic
        delivered = await this.publish(topic, envelope);
    }

    console.log(`[MessageBroker] Smart Broadcast to ${topic}: ${delivered} recipients (Type: ${message.type || 'unknown'})`);
    return delivered;
  }

  // ===========================
  // Specialized Messages
  // ===========================

  async sendTask(from, to, task) {
    return await this.sendMessage({
      from,
      to,
      type: 'task',
      payload: task
    });
  }

  async sendHelpRequest(from, to, issue) {
    return await this.sendMessage({
      from,
      to,
      type: 'help_request',
      payload: issue
    });
  }

  async requestStatus(from, to) {
    return await this.sendMessage({
      from,
      to,
      type: 'status_check',
      payload: {}
    });
  }

  // ===========================
  // Heartbeat System
  // ===========================

  heartbeat(arbiterName, status = {}) {
    const arbiter = this.arbiters.get(arbiterName);
    if (arbiter) {
      arbiter.lastHeartbeat = Date.now();
      arbiter.status = status;
      this.emit('heartbeat', arbiterName, status);
    }
  }

  getStaleArbiters(timeoutMs = 60000) {
    const now = Date.now();
    return this.getArbiters().filter(a =>
      now - a.lastHeartbeat > timeoutMs
    );
  }

  // ===========================
  // Message History
  // ===========================

  _createEnvelope(message, channel = null) {
    return {
      id: this._generateMessageId(),
      timestamp: Date.now(),
      channel,
      ...message
    };
  }

  _addToHistory(envelope) {
    // Circular buffer: O(1) instead of O(n) array slicing
    this.messageHistory[this.historyWriteIndex] = envelope;
    this.historyWriteIndex++;

    if (this.historyWriteIndex >= this.maxHistorySize) {
      this.historyWriteIndex = 0;
      this.historyFull = true;
    }
  }

  getHistory(limit = 100) {
    // Read from circular buffer in correct order
    const actualSize = this.historyFull ? this.maxHistorySize : this.historyWriteIndex;
    const count = Math.min(limit, actualSize);

    if (count === 0) return [];

    const result = [];
    let readIndex = this.historyWriteIndex - count;

    // Handle wrap-around
    if (readIndex < 0) {
      readIndex += this.maxHistorySize;
    }

    for (let i = 0; i < count; i++) {
      result.push(this.messageHistory[readIndex]);
      readIndex = (readIndex + 1) % this.maxHistorySize;
    }

    return result;
  }

  getHistoryByArbiter(arbiterName, limit = 100) {
    // Get all valid history first, then filter
    const allHistory = this.getHistory(this.maxHistorySize);
    return allHistory
      .filter(m => m.from === arbiterName || m.to === arbiterName)
      .slice(-limit);
  }

  clearHistory() {
    this.messageHistory = [];
    this.historyWriteIndex = 0;
    this.historyFull = false;
  }

  // ===========================
  // Metrics
  // ===========================

  getMetrics() {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      registeredArbiters: this.arbiters.size,
      activeSubscriptions: this.subscriptions.size,
      historySize: this.messageHistory.length,
      tiers: this.getTierBreakdown(),
      recentCount: this._recentPublishes.length,
    };
  }

  resetMetrics() {
    this.metrics = {
      messagesSent: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      startTime: Date.now()
    };
  }

  // ===========================
  // CNS: Structured Signals
  // ===========================

  /**
   * Emit a structured COS Signal.
   * Signals are buffered and compressed before delivery.
   */
  emitSignal(type, payload = {}, priority = 'normal', source = 'MessageBroker') {
    if (type && typeof type === 'object') {
      const signalLike = type;
      type = signalLike.type;
      payload = signalLike.payload || {};
      priority = signalLike.priority || priority;
      source = signalLike.source || source;
    }

    const signal = {
      id: this._generateMessageId(),
      type,
      payload,
      priority,
      timestamp: Date.now(),
      source
    };

    try {
      this.signalRegistry?.validate?.(signal);
    } catch (err) {
      this.metrics.messagesFailed++;
      this.emit('signal_invalid', { signal, error: err.message });
      console.warn(`[MessageBroker] Invalid signal blocked: ${type} — ${err.message}`);
      return false;
    }

    // CNS: Impulse Compression
    let swallowed = false;
    if (this.compressor && typeof this.compressor.process === 'function') {
      swallowed = this.compressor.process(signal);
    }

    if (!swallowed) {
      return this._deliverSignal(signal);
    }
    return true;
  }

  /**
   * Internal method to deliver signals to subscribers.
   * Attention Engine v2: uses evaluateSignal() for soft scoring.
   * Score bands: ≥0.7 immediate, 0.3–0.69 normal, <0.3 deferred 200 ms batch.
   */
  async _deliverSignal(signal) {
    if (this.attentionEngine) {
      let pass = true;
      let score = 1.0;

      if (typeof this.attentionEngine.evaluateSignal === 'function') {
        ({ pass, score } = this.attentionEngine.evaluateSignal(signal));
      } else if (typeof this.attentionEngine.shouldNotice === 'function') {
        pass = this.attentionEngine.shouldNotice(signal);
      }

      if (!pass) {
        console.log(`[MessageBroker] 🙈 Suppressed: ${signal.type} (score: ${score.toFixed(2)})`);
        return 0;
      }

      // Soft bandwidth: low-relevance signals deferred to 200 ms batch
      if (score < 0.3) {
        this._queueLowPrioritySignal(signal, score);
        return 0;
      }

      signal._attentionScore = score;
    }

    this.metrics.messagesSent++;
    this._addToHistory(signal);
    return await this.publish(signal.type, signal);
  }

  _queueLowPrioritySignal(signal, score) {
    if (!this._lpQueue) this._lpQueue = [];
    this._lpQueue.push({ signal, score });
    if (!this._lpTimer) {
      this._lpTimer = setTimeout(() => this._flushLowPriorityQueue(), 200);
    }
  }

  async _flushLowPriorityQueue() {
    this._lpTimer = null;
    if (!this._lpQueue?.length) return;
    const batch = this._lpQueue.sort((a, b) => b.score - a.score);
    this._lpQueue = [];
    for (const { signal, score } of batch) {
      signal._attentionScore = score;
      this.metrics.messagesSent++;
      this._addToHistory(signal);
      await this.publish(signal.type, signal);
    }
  }

  // ===========================
  // Arbiter Discovery & Search
  // ===========================

  /**
   * Find arbiter with fuzzy matching and suggestions
   * Prevents "Arbiter not found" errors by suggesting similar names
   */
  findArbiter(nameOrPattern, options = {}) {
    const { exact = false, suggest = true } = options;

    // Try exact match first
    const exactMatch = this.arbiters.get(nameOrPattern);
    if (exactMatch) {
      return {
        found: true,
        arbiter: exactMatch,
        matchType: 'exact'
      };
    }

    // If exact match required, stop here
    if (exact) {
      return suggest
        ? {
            found: false,
            suggestions: this.suggestArbiters(nameOrPattern)
          }
        : { found: false };
    }

    // Try case-insensitive match
    const lowerName = nameOrPattern.toLowerCase();
    for (const [name, arbiter] of this.arbiters) {
      if (name.toLowerCase() === lowerName) {
        return {
          found: true,
          arbiter,
          matchType: 'case-insensitive'
        };
      }
    }

    // Try partial match (contains)
    for (const [name, arbiter] of this.arbiters) {
      if (name.toLowerCase().includes(lowerName) || lowerName.includes(name.toLowerCase())) {
        return {
          found: true,
          arbiter,
          matchType: 'partial',
          warning: `Used partial match: requested "${nameOrPattern}", found "${name}"`
        };
      }
    }

    // No match found - return suggestions
    return suggest
      ? {
          found: false,
          suggestions: this.suggestArbiters(nameOrPattern)
        }
      : { found: false };
  }

  /**
   * Search arbiters by name, role, or capability
   * Returns ranked results
   */
  searchArbiters(query) {
    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const [name, arbiter] of this.arbiters) {
      let score = 0;
      let matches = [];

      // Name match (highest priority)
      if (name.toLowerCase() === lowerQuery) {
        score += 100;
        matches.push('exact name');
      } else if (name.toLowerCase().includes(lowerQuery)) {
        score += 50;
        matches.push('partial name');
      }

      // Role match
      if (arbiter.role && arbiter.role.toLowerCase().includes(lowerQuery)) {
        score += 30;
        matches.push('role');
      }

      // Capability match
      if (arbiter.capabilities) {
        const capMatch = arbiter.capabilities.some(cap =>
          cap.toLowerCase().includes(lowerQuery)
        );
        if (capMatch) {
          score += 20;
          matches.push('capability');
        }
      }

      if (score > 0) {
        results.push({
          arbiter,
          score,
          matches
        });
      }
    }

    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score);

    return {
      query,
      found: results.length,
      results: results.map(r => ({
        name: r.arbiter.name,
        role: r.arbiter.role,
        matchReason: r.matches.join(', '),
        arbiter: r.arbiter
      }))
    };
  }

  /**
   * Suggest similar arbiter names when one is not found
   * Uses Levenshtein distance for fuzzy matching
   */
  suggestArbiters(attemptedName, maxSuggestions = 5) {
    const suggestions = [];

    for (const [name, arbiter] of this.arbiters) {
      const distance = this._levenshteinDistance(
        attemptedName.toLowerCase(),
        name.toLowerCase()
      );

      suggestions.push({
        name,
        role: arbiter.role,
        distance,
        similarity: 1 - distance / Math.max(attemptedName.length, name.length)
      });
    }

    // Sort by similarity (closest first)
    suggestions.sort((a, b) => a.distance - b.distance);

    // Return top N suggestions
    return suggestions.slice(0, maxSuggestions).filter(s => s.similarity > 0.3);
  }

  /**
   * Calculate Levenshtein distance (edit distance) between two strings
   */
  _levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Get or find arbiter (with auto-suggestions on failure)
   * Use this instead of getArbiter() for better error handling
   */
  getOrFindArbiter(name) {
    const result = this.findArbiter(name, { exact: false, suggest: true });

    if (result.found) {
      if (result.warning) {
        console.warn(`[MessageBroker] ${result.warning}`);
      }
      return result.arbiter;
    }

    // Not found - log suggestions
    if (result.suggestions && result.suggestions.length > 0) {
      console.warn(`[MessageBroker] Arbiter "${name}" not found. Did you mean:`);
      result.suggestions.forEach(s => {
        console.warn(`  - ${s.name} (role: ${s.role}, ${(s.similarity * 100).toFixed(0)}% match)`);
      });
    } else {
      console.warn(`[MessageBroker] Arbiter "${name}" not found and no similar arbiters exist.`);
    }

    return null;
  }

  // ===========================
  // Utilities
  // ===========================

  _generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ===========================
  // Debugging
  // ===========================

  getStatus() {
    return {
      arbiters: this.getArbiters().map(a => ({
        name: a.name,
        role: a.role,
        status: a.status,
        lastHeartbeat: a.lastHeartbeat
      })),
      subscriptions: Array.from(this.subscriptions.keys()),
      metrics: this.getMetrics()
    };
  }

  printStatus() {
    console.log('\n=== MessageBroker Status ===');
    console.log(`Registered Arbiters: ${this.arbiters.size}`);
    console.log(`Active Subscriptions: ${this.subscriptions.size}`);
    console.log(`Messages Sent: ${this.metrics.messagesSent}`);
    console.log(`Messages Delivered: ${this.metrics.messagesDelivered}`);
    console.log(`Messages Failed: ${this.metrics.messagesFailed}`);
    console.log(`History Size: ${this.messageHistory.length}`);
    console.log('============================\n');
  }

  // ===========================
  // Network Bridge (Remote Agents)
  // ===========================
  // Starts a WebSocket server so external processes (MAX, Agent0, etc.)
  // can register as virtual arbiters and participate in the signal flow.
  //
  // Protocol (all JSON):
  //   client → server:  { type: 'register', name, subscriptions: [topic, ...] }
  //   client → server:  { type: 'publish', topic, payload }
  //   client → server:  { type: 'message_response', id, result }
  //   client → server:  { type: 'ping' }
  //   server → client:  { type: 'registered', name }
  //   server → client:  { type: 'signal', topic, payload }     ← pub/sub delivery
  //   server → client:  { type: 'message', id, envelope }      ← direct sendMessage delivery
  //   server → client:  { type: 'pong' }

  startNetworkBridge(port = 4201) {
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ port });

    // topic → Set<WebSocket>  (which remotes subscribed to which topics)
    const topicSubs = new Map();
    // ws → agentName
    const agentNames = new Map();
    // pending direct-message responses: id → { resolve, timer }
    const pending = new Map();

    // Wire a single broker subscription per topic that fans out to all remote subscribers.
    // Called once when the first remote agent subscribes to a topic.
    const wireTopicForward = (topic) => {
      this.subscribe(topic, (envelope) => {
        const clients = topicSubs.get(topic);
        if (!clients || clients.size === 0) return;
        const msg = JSON.stringify({
          type: 'signal',
          topic,
          payload: envelope.payload ?? envelope
        });
        for (const ws of clients) {
          if (ws.readyState === 1) {
            try { ws.send(msg); } catch { /* dead socket */ }
          }
        }
      });
    };

    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // ── register ─────────────────────────────────────────────────
        if (msg.type === 'register') {
          const name = msg.name;
          agentNames.set(ws, name);

          // Register as a virtual arbiter — sendMessage({ to: name }) will call handleMessage
          this.registerArbiter(name, {
            instance: {
              name,
              remote: true,
              handleMessage: (envelope) => new Promise((resolve) => {
                if (ws.readyState !== 1) { resolve(null); return; }
                const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const timer = setTimeout(() => {
                  pending.delete(id);
                  resolve(null);
                }, 30000);
                pending.set(id, { resolve, timer });
                ws.send(JSON.stringify({ type: 'message', id, envelope }));
              })
            },
            role: 'remote_agent',
            classification: 'bridge',
            lobe: 'network'
          });

          // Subscribe remote to requested topics
          for (const topic of (msg.subscriptions || [])) {
            if (!topicSubs.has(topic)) {
              topicSubs.set(topic, new Set());
              wireTopicForward(topic);
            }
            topicSubs.get(topic).add(ws);
          }

          ws.send(JSON.stringify({ type: 'registered', name }));
          console.log(`[MessageBroker] 🌐 Remote agent "${name}" connected (subscribed to ${(msg.subscriptions || []).length} topics)`);
        }

        // ── publish ───────────────────────────────────────────────────
        if (msg.type === 'publish' && agentNames.has(ws)) {
          this.publish(msg.topic, {
            from: agentNames.get(ws),
            payload: msg.payload
          });
        }

        // ── message_response ──────────────────────────────────────────
        if (msg.type === 'message_response' && pending.has(msg.id)) {
          const { resolve, timer } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          resolve(msg.result);
        }

        // ── ping ──────────────────────────────────────────────────────
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      });

      ws.on('close', () => {
        const name = agentNames.get(ws);
        if (name) {
          for (const clients of topicSubs.values()) clients.delete(ws);
          this.unregisterArbiter(name);
          agentNames.delete(ws);
          console.log(`[MessageBroker] 🌐 Remote agent "${name}" disconnected`);
        }
      });

      ws.on('error', () => { /* close fires after error */ });
    });

    this._networkBridge = wss;
    console.log(`[MessageBroker] 🌐 Network bridge listening on ws://localhost:${port}`);
    return wss;
  }
}

// 🔱 Sovereign Singleton: Ensure one master broker across all CJS/ESM boundaries
if (!global.__SOMA_BROKER__) {
    global.__SOMA_BROKER__ = new MessageBroker();
}
const messageBroker = global.__SOMA_BROKER__;
module.exports = messageBroker;
