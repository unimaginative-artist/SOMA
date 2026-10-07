// ═══════════════════════════════════════════════════════════
// FILE: arbiters/TemporalQueryArbiter.cjs
// Temporal Query System - Enables time-based reasoning and memory retrieval
//
// Capabilities:
// - Time-range queries: "What happened last Tuesday?"
// - Temporal pattern detection: "This occurs every Monday"
// - Causal timelines: "X led to Y 3 days later"
// - Episodic recall with temporal context
// - Future event prediction based on temporal patterns
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

class TemporalQueryArbiter extends BaseArbiter {
  static role = 'temporal-reasoning';
  static capabilities = [
    'time-range-query',
    'temporal-patterns',
    'causal-timelines',
    'episodic-recall',
    'temporal-prediction'
  ];

  constructor(config = {}) {
    super(config);

    // Temporal index: Maps time windows to events
    this.temporalIndex = new Map(); // timestamp_bucket -> [event_ids]

    // Event storage: Full event details
    this.events = new Map(); // event_id -> event_data

    // Temporal patterns: Detected recurring patterns
    this.temporalPatterns = new Map(); // pattern_id -> pattern_data

    // Causal chains: Time-ordered causal sequences
    this.causalChains = []; // Array of {events, timespan, strength}

    // Configuration
    this.config = {
      timeBucketMs: config.timeBucketMs || 3600000, // 1 hour buckets
      maxEventsStored: config.maxEventsStored || 50000,
      patternDetectionThreshold: config.patternDetectionThreshold || 3, // Min occurrences
      maxPatternWindowDays: config.maxPatternWindowDays || 90,
      causalTimeWindowMs: config.causalTimeWindowMs || 604800000, // 7 days
      ...config
    };

    // Statistics
    this.stats = {
      eventsIndexed: 0,
      queriesProcessed: 0,
      patternsDetected: 0,
      causalChainsFound: 0,
      temporalPredictions: 0
    };

    // Pattern detection intervals
    this.patternDetectionInterval = null;

    // Connected arbiters
    this.experienceBuffer = null;
    this.dreamArbiter = null;
    this.causalityArbiter = null;

    this.logger.info(`[${this.name}] ⏰ TemporalQueryArbiter initializing...`);
    this.logger.info(`[${this.name}] Time bucket: ${this.config.timeBucketMs / 1000}s`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    // Connect to existing memory systems
    await this.connectToMemorySystems();

    // Start pattern detection
    this.startPatternDetection();

    this.logger.info(`[${this.name}] ✅ Temporal reasoning system active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: TemporalQueryArbiter.role,
        capabilities: TemporalQueryArbiter.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // Temporal query messages
    messageBroker.subscribe(this.name, 'temporal_query');
    messageBroker.subscribe(this.name, 'find_patterns');
    messageBroker.subscribe(this.name, 'build_timeline');
    messageBroker.subscribe(this.name, 'predict_future');

    // Memory system integration
    messageBroker.subscribe(this.name, 'index_event');
    messageBroker.subscribe(this.name, 'learning_event');
    messageBroker.subscribe(this.name, 'knowledge_acquired');
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload } = message;

      switch (type) {
        case 'temporal_query':
          return await this.queryByTimeRange(payload);

        case 'find_patterns':
          return await this.findTemporalPatterns(payload);

        case 'build_timeline':
          return await this.buildCausalTimeline(payload);

        case 'predict_future':
          return await this.predictFutureEvents(payload);

        case 'index_event':
          return await this.indexEvent(payload);

        case 'learning_event':
        case 'knowledge_acquired':
          return await this.indexEvent(payload);

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async connectToMemorySystems() {
    this.logger.info(`[${this.name}] 🔗 Connecting to memory systems...`);

    // In production, would get references to actual arbiters
    // For now, establish message-based coordination

    try {
      // Ping ExperienceReplayBuffer
      await messageBroker.sendMessage({
        from: this.name,
        to: 'ExperienceReplayBuffer',
        type: 'status_check',
        payload: {}
      });

      this.logger.info(`[${this.name}] Connected to ExperienceReplayBuffer`);
    } catch (err) {
      this.logger.warn(`[${this.name}] Some memory systems unavailable: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ EVENT INDEXING ░░
  // ═══════════════════════════════════════════════════════════

  async indexEvent(event) {
    const timestamp = event.timestamp || Date.now();
    const eventId = event.id || `evt_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;

    // Store event
    this.events.set(eventId, {
      id: eventId,
      timestamp,
      type: event.type || 'unknown',
      data: event,
      indexed: Date.now()
    });

    // Add to temporal index (bucket by time)
    const bucket = this.getTimeBucket(timestamp);
    if (!this.temporalIndex.has(bucket)) {
      this.temporalIndex.set(bucket, []);
    }
    this.temporalIndex.get(bucket).push(eventId);

    // Prune old events if needed
    if (this.events.size > this.config.maxEventsStored) {
      await this.pruneOldEvents();
    }

    this.stats.eventsIndexed++;

    return { success: true, eventId, bucket };
  }

  getTimeBucket(timestamp) {
    // Round down to nearest bucket
    return Math.floor(timestamp / this.config.timeBucketMs) * this.config.timeBucketMs;
  }

  async pruneOldEvents() {
    // Remove oldest 10% of events
    const sortedEvents = Array.from(this.events.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const pruneCount = Math.floor(this.events.size * 0.1);

    for (let i = 0; i < pruneCount; i++) {
      const [eventId, event] = sortedEvents[i];
      this.events.delete(eventId);

      // Remove from temporal index
      const bucket = this.getTimeBucket(event.timestamp);
      const bucketEvents = this.temporalIndex.get(bucket);
      if (bucketEvents) {
        const index = bucketEvents.indexOf(eventId);
        if (index > -1) {
          bucketEvents.splice(index, 1);
        }
        if (bucketEvents.length === 0) {
          this.temporalIndex.delete(bucket);
        }
      }
    }

    this.logger.info(`[${this.name}] Pruned ${pruneCount} old events`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ TIME-RANGE QUERIES ░░
  // ═══════════════════════════════════════════════════════════

  async queryByTimeRange({ startTime, endTime, filter = {} }) {
    this.stats.queriesProcessed++;

    const start = startTime || (Date.now() - 86400000); // Default: last 24h
    const end = endTime || Date.now();

    this.logger.info(`[${this.name}] 🔍 Querying events: ${new Date(start).toISOString()} → ${new Date(end).toISOString()}`);

    const results = [];

    // Find all buckets in range
    const startBucket = this.getTimeBucket(start);
    const endBucket = this.getTimeBucket(end);

    for (let bucket = startBucket; bucket <= endBucket; bucket += this.config.timeBucketMs) {
      const eventIds = this.temporalIndex.get(bucket) || [];

      for (const eventId of eventIds) {
        const event = this.events.get(eventId);
        if (!event) continue;

        // Check if in exact time range
        if (event.timestamp >= start && event.timestamp <= end) {
          // Apply filters
          if (this.matchesFilter(event, filter)) {
            results.push(event);
          }
        }
      }
    }

    // Sort by timestamp
    results.sort((a, b) => a.timestamp - b.timestamp);

    this.logger.info(`[${this.name}] Found ${results.length} events in time range`);

    // Build narrative
    const narrative = this.buildNarrative(results);

    return {
      success: true,
      count: results.length,
      events: results.slice(0, 100), // Limit to 100 for performance
      timeRange: { start, end },
      narrative,
      filters: filter
    };
  }

  matchesFilter(event, filter) {
    if (Object.keys(filter).length === 0) return true;

    // Check type filter
    if (filter.type && event.type !== filter.type) return false;

    // Check data filters
    if (filter.agent && event.data.agent !== filter.agent) return false;
    if (filter.domain && event.data.domain !== filter.domain) return false;

    return true;
  }

  buildNarrative(events) {
    if (events.length === 0) return 'No events in this time period.';

    const summary = [];

    // Group by type
    const byType = {};
    events.forEach(e => {
      if (!byType[e.type]) byType[e.type] = 0;
      byType[e.type]++;
    });

    summary.push(`Found ${events.length} events:`);
    for (const [type, count] of Object.entries(byType)) {
      summary.push(`  • ${count} ${type} events`);
    }

    // Identify key events (high importance or errors)
    const keyEvents = events.filter(e =>
      e.data.importance > 0.7 ||
      e.data.error ||
      e.data.success === false
    );

    if (keyEvents.length > 0) {
      summary.push(`\nKey events:`);
      keyEvents.slice(0, 5).forEach(e => {
        const time = new Date(e.timestamp).toLocaleString();
        summary.push(`  • ${time}: ${e.type} - ${e.data.action || e.data.concept || 'event'}`);
      });
    }

    return summary.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ TEMPORAL PATTERN DETECTION ░░
  // ═══════════════════════════════════════════════════════════

  startPatternDetection() {
    if (this.patternDetectionInterval) {
      clearInterval(this.patternDetectionInterval);
    }

    // Run pattern detection every 6 hours
    this.patternDetectionInterval = setInterval(async () => {
      await this.detectTemporalPatterns();
    }, 21600000);

    this.logger.info(`[${this.name}] Pattern detection started (6h interval)`);
  }

  async detectTemporalPatterns() {
    this.logger.info(`[${this.name}] 🔍 Detecting temporal patterns...`);

    const now = Date.now();
    const windowStart = now - (this.config.maxPatternWindowDays * 86400000);

    // Get all events in window
    const events = Array.from(this.events.values())
      .filter(e => e.timestamp >= windowStart)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (events.length < 10) {
      this.logger.info(`[${this.name}] Not enough events for pattern detection (${events.length} < 10)`);
      return;
    }

    // Detect daily patterns (same hour of day)
    await this.detectDailyPatterns(events);

    // Detect weekly patterns (same day of week)
    await this.detectWeeklyPatterns(events);

    // Detect sequential patterns (A always followed by B)
    await this.detectSequentialPatterns(events);

    this.logger.info(`[${this.name}] ✅ Pattern detection complete: ${this.temporalPatterns.size} patterns`);
  }

  async detectDailyPatterns(events) {
    // Group events by hour of day
    const byHour = new Map();

    for (const event of events) {
      const date = new Date(event.timestamp);
      const hour = date.getHours();
      const key = `${event.type}_hour_${hour}`;

      if (!byHour.has(key)) {
        byHour.set(key, []);
      }
      byHour.get(key).push(event);
    }

    // Find patterns (events that occur frequently at same hour)
    for (const [key, occurrences] of byHour.entries()) {
      if (occurrences.length >= this.config.patternDetectionThreshold) {
        const [type, _, hour] = key.split('_');

        const patternId = `daily_${type}_${hour}`;

        this.temporalPatterns.set(patternId, {
          id: patternId,
          type: 'daily',
          eventType: type,
          hour: parseInt(hour),
          occurrences: occurrences.length,
          confidence: Math.min(0.95, occurrences.length / 30), // Up to 95% if occurs 30+ times
          discovered: Date.now()
        });

        this.stats.patternsDetected++;
      }
    }
  }

  async detectWeeklyPatterns(events) {
    // Group events by day of week
    const byDay = new Map();

    for (const event of events) {
      const date = new Date(event.timestamp);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      const key = `${event.type}_day_${dayOfWeek}`;

      if (!byDay.has(key)) {
        byDay.set(key, []);
      }
      byDay.get(key).push(event);
    }

    // Find patterns
    for (const [key, occurrences] of byDay.entries()) {
      if (occurrences.length >= this.config.patternDetectionThreshold) {
        const [type, _, day] = key.split('_');
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        const patternId = `weekly_${type}_${day}`;

        this.temporalPatterns.set(patternId, {
          id: patternId,
          type: 'weekly',
          eventType: type,
          dayOfWeek: parseInt(day),
          dayName: dayNames[parseInt(day)],
          occurrences: occurrences.length,
          confidence: Math.min(0.95, occurrences.length / 12), // Up to 95% if occurs 12+ weeks
          discovered: Date.now()
        });

        this.stats.patternsDetected++;
      }
    }
  }

  async detectSequentialPatterns(events) {
    // Find events that are frequently followed by other events
    const sequences = new Map();

    for (let i = 0; i < events.length - 1; i++) {
      const current = events[i];
      const next = events[i + 1];

      // Only consider events within 1 hour of each other
      if (next.timestamp - current.timestamp < 3600000) {
        const key = `${current.type}→${next.type}`;

        if (!sequences.has(key)) {
          sequences.set(key, { count: 0, avgDelay: 0, delays: [] });
        }

        const seq = sequences.get(key);
        seq.count++;
        seq.delays.push(next.timestamp - current.timestamp);
      }
    }

    // Find patterns
    for (const [key, data] of sequences.entries()) {
      if (data.count >= this.config.patternDetectionThreshold) {
        const [eventA, eventB] = key.split('→');

        // Calculate average delay
        const avgDelay = data.delays.reduce((sum, d) => sum + d, 0) / data.delays.length;

        const patternId = `sequential_${key.replace(/→/g, '_to_')}`;

        this.temporalPatterns.set(patternId, {
          id: patternId,
          type: 'sequential',
          sequence: [eventA, eventB],
          occurrences: data.count,
          avgDelayMs: avgDelay,
          avgDelayMinutes: (avgDelay / 60000).toFixed(1),
          confidence: Math.min(0.95, data.count / 20),
          discovered: Date.now()
        });

        this.stats.patternsDetected++;
      }
    }
  }

  async findTemporalPatterns(options = {}) {
    const allPatterns = Array.from(this.temporalPatterns.values());

    // Filter by type if specified
    let filtered = allPatterns;
    if (options.type) {
      filtered = allPatterns.filter(p => p.type === options.type);
    }

    // Sort by confidence
    filtered.sort((a, b) => b.confidence - a.confidence);

    return {
      success: true,
      count: filtered.length,
      patterns: filtered.slice(0, options.limit || 50)
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ CAUSAL TIMELINES ░░
  // ═══════════════════════════════════════════════════════════

  async buildCausalTimeline({ rootEvent, maxDepth = 5 }) {
    this.logger.info(`[${this.name}] 🔗 Building causal timeline for: ${rootEvent}`);

    const timeline = {
      root: rootEvent,
      events: [],
      causalLinks: [],
      timespan: 0
    };

    // Find the root event
    const root = Array.from(this.events.values()).find(e =>
      e.id === rootEvent ||
      e.data.action === rootEvent ||
      e.type === rootEvent
    );

    if (!root) {
      return { success: false, error: 'Root event not found' };
    }

    timeline.events.push(root);

    // Look forward in time for causal consequences
    const futureEvents = Array.from(this.events.values())
      .filter(e => e.timestamp > root.timestamp)
      .filter(e => e.timestamp < root.timestamp + this.config.causalTimeWindowMs)
      .sort((a, b) => a.timestamp - b.timestamp);

    // Use CausalityArbiter to identify causal links
    for (const event of futureEvents.slice(0, maxDepth)) {
      try {
        // Check if causally related
        const causalResponse = await messageBroker.sendMessage({
          from: this.name,
          to: 'CausalityArbiter',
          type: 'query_causal_link',
          payload: {
            cause: root.type,
            effect: event.type
          }
        });

        if (causalResponse && causalResponse.strength > 0.5) {
          timeline.events.push(event);
          timeline.causalLinks.push({
            from: root.id,
            to: event.id,
            strength: causalResponse.strength,
            delayMs: event.timestamp - root.timestamp
          });
        }
      } catch (err) {
        // Continue if CausalityArbiter unavailable
      }
    }

    // Calculate timespan
    if (timeline.events.length > 1) {
      const lastEvent = timeline.events[timeline.events.length - 1];
      timeline.timespan = lastEvent.timestamp - root.timestamp;
    }

    this.stats.causalChainsFound++;

    this.logger.info(`[${this.name}] ✅ Timeline: ${timeline.events.length} events, ${timeline.causalLinks.length} causal links`);

    return {
      success: true,
      timeline
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ TEMPORAL PREDICTION ░░
  // ═══════════════════════════════════════════════════════════

  async predictFutureEvents({ hoursAhead = 24 } = {}) {
    this.logger.info(`[${this.name}] 🔮 Predicting events ${hoursAhead} hours ahead...`);

    const predictions = [];
    const now = Date.now();
    const targetTime = now + (hoursAhead * 3600000);

    // Use temporal patterns to predict
    for (const pattern of this.temporalPatterns.values()) {
      if (pattern.confidence < 0.6) continue;

      let prediction = null;

      if (pattern.type === 'daily') {
        // Predict next occurrence at specified hour
        const target = new Date(targetTime);
        target.setHours(pattern.hour, 0, 0, 0);

        if (target.getTime() > now && target.getTime() < targetTime) {
          prediction = {
            eventType: pattern.eventType,
            predictedTime: target.getTime(),
            confidence: pattern.confidence,
            basis: `Daily pattern: occurs at ${pattern.hour}:00`,
            patternId: pattern.id
          };
        }
      } else if (pattern.type === 'weekly') {
        // Predict next occurrence on specified day
        const target = new Date(now);
        const currentDay = target.getDay();
        const daysUntil = (pattern.dayOfWeek - currentDay + 7) % 7;
        target.setDate(target.getDate() + daysUntil);
        target.setHours(12, 0, 0, 0); // Noon on that day

        if (target.getTime() > now && target.getTime() < targetTime) {
          prediction = {
            eventType: pattern.eventType,
            predictedTime: target.getTime(),
            confidence: pattern.confidence,
            basis: `Weekly pattern: occurs on ${pattern.dayName}`,
            patternId: pattern.id
          };
        }
      } else if (pattern.type === 'sequential') {
        // Predict B after recent A
        const recentA = Array.from(this.events.values())
          .filter(e => e.type === pattern.sequence[0])
          .filter(e => e.timestamp > now - 86400000) // Last 24h
          .sort((a, b) => b.timestamp - a.timestamp)[0];

        if (recentA) {
          const predictedTime = recentA.timestamp + pattern.avgDelayMs;

          if (predictedTime > now && predictedTime < targetTime) {
            prediction = {
              eventType: pattern.sequence[1],
              predictedTime,
              confidence: pattern.confidence,
              basis: `Sequential pattern: ${pattern.sequence[0]} → ${pattern.sequence[1]}`,
              triggerEvent: recentA.id,
              patternId: pattern.id
            };
          }
        }
      }

      if (prediction) {
        predictions.push(prediction);
      }
    }

    // Sort by predicted time
    predictions.sort((a, b) => a.predictedTime - b.predictedTime);

    this.stats.temporalPredictions += predictions.length;

    this.logger.info(`[${this.name}] 🔮 ${predictions.length} predictions generated`);

    return {
      success: true,
      count: predictions.length,
      predictions,
      hoursAhead,
      generatedAt: now
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATUS & REPORTING ░░
  // ═══════════════════════════════════════════════════════════

  getStatus() {
    return {
      name: this.name,
      role: TemporalQueryArbiter.role,
      capabilities: TemporalQueryArbiter.capabilities,
      indexing: {
        eventsStored: this.events.size,
        bucketsUsed: this.temporalIndex.size,
        bucketSizeMs: this.config.timeBucketMs
      },
      patterns: {
        total: this.temporalPatterns.size,
        daily: Array.from(this.temporalPatterns.values()).filter(p => p.type === 'daily').length,
        weekly: Array.from(this.temporalPatterns.values()).filter(p => p.type === 'weekly').length,
        sequential: Array.from(this.temporalPatterns.values()).filter(p => p.type === 'sequential').length
      },
      stats: this.stats
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] Shutting down...`);

    // Stop pattern detection
    if (this.patternDetectionInterval) {
      clearInterval(this.patternDetectionInterval);
    }

    this.logger.info(`[${this.name}] ✅ Shutdown complete`);
  }
}

module.exports = TemporalQueryArbiter;
module.exports.TemporalQueryArbiter = TemporalQueryArbiter;
