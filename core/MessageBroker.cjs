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

    // Registered arbiters
    this.arbiters = new Map();

    // CNS: Impulse Compression & Validation
    this.signalRegistry = SignalRegistry;
    this.compressor = new SignalCompressor({
      windowMs: 1000,
      onCompressed: (signal) => this._deliverSignal(signal)
    });

    // Neural Indices
    this.lobeIndex = new Map(); // lobe -> Set(names)
    this.classificationIndex = new Map(); // classification -> Set(names)

    // CNS: Attention & Focus Gate
    this.attentionEngine = null;

    // Discovery (Unused list)
    this.discoveryIndex = new Map(); // filename -> metadata

    // Topic subscriptions
    this.subscriptions = new Map();

    // Message history for replay/debugging (circular buffer)
    this.messageHistory = [];
    this.maxHistorySize = 1000;
    this.historyWriteIndex = 0;  // Circular buffer write pointer
    this.historyFull = false;     // Track if buffer has wrapped

    // Metrics
    this.metrics = {
      messagesSent: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      startTime: Date.now()
    };
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
    
    if (metadata.classification) {
      if (!this.classificationIndex.has(metadata.classification)) this.classificationIndex.set(metadata.classification, new Set());
      this.classificationIndex.get(metadata.classification).add(name);
    }

    this.emit('arbiter_registered', name, metadata);
    console.log(`[MessageBroker] Arbiter registered: ${name} [Lobe: ${metadata.lobe || 'N/A'}]`);
  }

  unregisterArbiter(name) {
    const arbiter = this.arbiters.get(name);
    if (arbiter) {
      if (arbiter.lobe) this.lobeIndex.get(arbiter.lobe)?.delete(name);
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

  subscribe(topic, handler) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }

    this.subscriptions.get(topic).add(handler);
    console.log(`[MessageBroker] Subscribed to topic: ${topic}`);

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

  async publish(topic, message) {
    const handlers = this.subscriptions.get(topic);
    if (!handlers || handlers.size === 0) {
      return 0;
    }

    const envelope = this._createEnvelope(message, topic);

    // PERFORMANCE FIX: Parallelize handler execution with Promise.allSettled
    // Previous: Sequential await (10 handlers @ 100ms each = 1 second)
    // Now: Parallel execution (10 handlers @ 100ms each = ~100ms)
    const results = await Promise.allSettled(
      Array.from(handlers).map(handler => handler(envelope))
    );

    // Count successes and failures
    let delivered = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        delivered++;
      } else {
        console.error(`[MessageBroker] Error delivering to ${topic}:`, result.reason);
        this.metrics.messagesFailed++;
      }
    });

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
    const findResult = this.findArbiter(to, { exact: false, suggest: true });

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
    if (arbiter.instance && typeof arbiter.instance.handleMessage === 'function') {
      try {
        const response = await arbiter.instance.handleMessage(envelope);
        this.metrics.messagesDelivered++;
        return response;
      } catch (error) {
        console.error(`[MessageBroker] Error delivering to ${to}:`, error);
        this.metrics.messagesFailed++;
        return null;
      }
    }

    // Otherwise publish to arbiter-specific topic
    const delivered = await this.publish(`arbiter/${to}`, envelope);
    return delivered > 0;
  }

  async broadcast(topic, message) {
    const envelope = this._createEnvelope({ ...message, to: 'broadcast' }, topic);
    this._addToHistory(envelope);

    const delivered = await this.publish(topic, envelope);
    console.log(`[MessageBroker] Broadcast to ${topic}: ${delivered} recipients`);

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
      historySize: this.messageHistory.length
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
  emitSignal(type, payload, priority = 'normal') {
    const signal = {
      id: this._generateMessageId(),
      type,
      payload,
      priority,
      timestamp: Date.now(),
      source: 'MessageBroker' // Source is set by the emitter, but we default here
    };

    // CNS: Impulse Compression
    const swallowed = this.compressor.process(signal);
    if (!swallowed) {
      this._deliverSignal(signal);
    }
  }

  /**
   * Internal method to deliver signals to subscribers.
   */
  async _deliverSignal(signal) {
    // CNS: Attention & Focus Gate (The Amygdala)
    if (this.attentionEngine && typeof this.attentionEngine.shouldNotice === 'function') {
      if (!this.attentionEngine.shouldNotice(signal)) {
        console.log(`[MessageBroker] 🙈 Attention Gate suppressed signal: ${signal.type}`);
        return 0;
      }
    }

    this.metrics.messagesSent++;
    this._addToHistory(signal);

    // Signals are published to topics matching their type
    // e.g. signal 'repo.file.changed' -> topic 'repo.file.changed'
    return await this.publish(signal.type, signal);
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

// Singleton instance
const messageBroker = new MessageBroker();
module.exports = messageBroker;
