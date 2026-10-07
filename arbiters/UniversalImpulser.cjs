// FILE: UniversalImpulser.cjs
// Complete single-file implementation - converted from ES6 to CommonJS

const messageBroker = require('../core/MessageBroker.cjs');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

// ==================== UNIVERSAL IMPULSER ====================

class UniversalImpulser extends EventEmitter {
  constructor(config = {}) {
    super();
    this.id = crypto.randomUUID();
    this.name = config.name || 'UniversalImpulser';
    this.type = 'universal_impulser';
    this.capabilities = ['categorize', 'summarize', 'index', 'relate', 'quality', 'dedupe'];
    this.config = config;
    this.state = {
      queueSize: 0, processing: 0, maxConcurrent: config.maxConcurrent || 5, maxQueue: config.maxQueue || 500,
      isOverloaded: false, helpers: [], totalProcessed: 0, totalErrors: 0, startTime: Date.now()
    };
    this.queue = [];
    this.queueIndex = new Set();
    this.processingSet = new Set();
    this.hippocampusPath = config.hippocampusPath || path.join(process.cwd(), 'hippocampus');
    this.hippocampusIndexPath = path.join(this.hippocampusPath, 'index.json');
    this.metrics = { avgProcessingTime: 0, successRate: 100, throughput: 0, byProcessor: {} };
    this.maxHelpers = config.maxHelpers || 4;
    this.retryDelayBaseMs = config.retryDelayBaseMs || 500;
    this.logger = config.logger || console;
    this.processors = new Map();
    this.processorStats = new Map();
    this._monitorInterval = null;
    this._indexWriteLock = Promise.resolve();
    this._draining = false; // Queue drain lock to prevent race conditions
    
    // Memory Buffering to prevent IO/RAM Spikes
    this._hippocampusBuffer = [];
    this._bufferFlushLock = false;
    this._bufferFlushInterval = setInterval(() => this._flushHippocampusBuffer(), 10000); // Flush every 10s
  }

  // Helper to ensure sequential index updates
  async _updateIndex(entries) {
    if (!Array.isArray(entries)) entries = [entries];
    if (entries.length === 0) return;

    // Chain onto the lock promise
    this._indexWriteLock = this._indexWriteLock.then(async () => {
      try {
        let idx = [];
        try {
          const raw = await fs.readFile(this.hippocampusIndexPath, 'utf8');
          if (raw.trim()) idx = JSON.parse(raw);
        } catch (readErr) {
          this.logger.warn(`[${this.name}] Index read/parse error (resetting): ${readErr.message}`);
          idx = [];
        }

        idx.push(...entries);
        // Keep last 10k entries to prevent infinite growth
        if (idx.length > 10000) idx = idx.slice(-10000);

        // Atomic-ish write: Write to temp then rename
        const tempPath = `${this.hippocampusIndexPath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(idx, null, 2), 'utf8');
        await fs.rename(tempPath, this.hippocampusIndexPath);
        
      } catch (e) { 
        this.logger.warn(`[${this.name}] hippocampus index write failed: ${e.message}`); 
      }
    });
    
    return this._indexWriteLock;
  }

  async _flushHippocampusBuffer() {
      if (this._bufferFlushLock || this._hippocampusBuffer.length === 0) return;
      this._bufferFlushLock = true;
      
      const batch = [...this._hippocampusBuffer];
      this._hippocampusBuffer = []; // Clear immediately to allow new entries
      
      const indexEntries = [];
      
      try {
          // Write batch to append-only impulses.jsonl to prevent thousands of small files
          const jsonlPath = path.join(this.hippocampusPath, 'impulses.jsonl');
          const lines = batch.map(record => {
              const fileId = `${this.type}_${Date.now()}_${crypto.randomUUID().slice(0,6)}`;
              indexEntries.push({ 
                  id: fileId, 
                  createdAt: Date.now(), 
                  type: this.type, 
                  processorType: record.processorType || 'unknown', 
                  summary: record.summary || null 
              });
              return JSON.stringify({ id: fileId, createdAt: Date.now(), record });
          }).join('\n') + '\n';
          
          await fs.appendFile(jsonlPath, lines, 'utf8');
          
          if (indexEntries.length > 0) {
              await this._updateIndex(indexEntries);
          }
          this.logger.info(`[${this.name}] Flushed ${batch.length} records to hippocampus/impulses.jsonl`);
      } catch (e) {
          this.logger.error(`[${this.name}] Error flushing hippocampus buffer: ${e.message}`);
          // Put them back if we failed completely
          this._hippocampusBuffer.push(...batch); 
      } finally {
          this._bufferFlushLock = false;
      }
  }

  async initialize() {
    this.registerProcessor('categorize', new CategoryProcessor(this.config || {}));
    this.registerProcessor('summarize', new SummaryProcessor(this.config || {}));
    this.registerProcessor('index', new IndexProcessor(this.config || {}));
    this.registerProcessor('relate', new RelationshipProcessor(this.config || {}));
    this.registerProcessor('quality', new QualityProcessor(this.config || {}));
    this.registerProcessor('dedupe', new DeduplicationProcessor(this.config || {}));
    for (const [name] of this.processors) this.processorStats.set(name, { processed: 0, errors: 0, avgTimeMs: 0 });
    this.registerWithBroker();
    this._subscribeBrokerMessages();
    await this._ensureHippocampusExists().catch(err => this.logger.warn(`[${this.name}] hippocampus init failed: ${err.message}`));
    this._monitorInterval = setInterval(() => this._monitor(), (this.config && this.config.monitorIntervalMs) || 5000);
    this.logger.info(`[${this.name}] 🧠 UniversalImpulser initialized with ${this.processors.size} processors`);
  }
  registerProcessor(name, processor) {
    if (!this.processors) this.processors = new Map();
    if (!this.processorStats) this.processorStats = new Map();
    this.processors.set(name, processor);
    this.processorStats.set(name, { processed: 0, errors: 0, avgTimeMs: 0 });
    processor.impulser = this;
    this.logger.info(`[${this.name}] Registered processor: ${name}`);
    return this;
  }
  getProcessor(type) {
    const processor = this.processors.get(type);
    if (!processor) throw new Error(`No processor registered for type: ${type}`);
    return processor;
  }
  detectProcessor(task) {
    if (task.type && this.processors.has(task.type)) return task.type;
    const data = task.data || task;
    if (data.article || data.content) return 'categorize';
    if (data.text && data.text.length > 500) return 'summarize';
    if (data.items || data.documents) return 'dedupe';
    if (data.nodes || data.entities) return 'relate';
    return 'categorize';
  }
  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, {
        instance: this,
        type: this.type,
        capabilities: this.capabilities
      });
      this.logger.info(`[${this.name}] Registered with broker`);
    } catch (err) {
      this.logger.error(`[${this.name}] registerWithBroker error: ${err.message}`);
      throw err;
    }
  }
  _subscribeBrokerMessages() {
    messageBroker.subscribe(this.name, 'impulser_help_request');
    messageBroker.subscribe(this.name, 'help_accepted');
    messageBroker.subscribe(this.name, 'task_batch');
    messageBroker.subscribe(this.name, 'task_complete');
    messageBroker.subscribe(this.name, 'status_check');
    for (const processorType of this.processors.keys()) messageBroker.subscribe(this.name, processorType);
  }
  async _ensureHippocampusExists() {
    await fs.mkdir(this.hippocampusPath, { recursive: true });
    try { await fs.access(this.hippocampusIndexPath); } 
    catch { await fs.writeFile(this.hippocampusIndexPath, JSON.stringify([], null, 2), 'utf8'); }
  }
  async storeInHippocampus(record) {
    try {
      this._hippocampusBuffer.push(record);
      
      // Flush if we hit batch size
      if (this._hippocampusBuffer.length >= 50) {
        // Run async without blocking the task processing loop
        this._flushHippocampusBuffer().catch(() => {});
      }
      
      // Broadcast high-quality knowledge for downstream consumption
      // (TrainingDataCollector, KnowledgeGraphFusion)
      if (record.result && (record.result.quality?.level === 'high' || record.result.summary)) {
          messageBroker.sendMessage({
              from: this.name,
              to: 'broadcast', // Listeners: TrainingDataCollector, KnowledgeGraphFusion
              type: 'knowledge_indexed',
              payload: {
                  source: 'UniversalImpulser',
                  topic: record.result.topic || 'general',
                  content: [{
                      snippet: record.result.summary || record.result.content,
                      url: record.result.url,
                      metadata: record.result.metadata
                  }],
                  original: record.result
              }
          }).catch(() => {});
      }

      return { success: true, buffered: true };
    } catch (err) {
      this.logger.error(`[${this.name}] storeInHippocampus error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
  _pushToQueue(task, opts = {}) {
    const taskId = opts.taskId || task.taskId || crypto.randomUUID();
    const fingerprint = opts.fingerprint || taskId;
    if (this.queueIndex.has(fingerprint)) return { success: false, reason: 'duplicate' };
    const entry = { taskId, type: task.type || this.detectProcessor(task), data: task.data || task, priority: opts.priority || 'normal', attempts: 0, addedAt: Date.now(), callback: opts.callback || null, fingerprint };
    if (entry.priority === 'high') {
      let i = this.queue.findIndex(e => e.priority !== 'high');
      if (i === -1) this.queue.push(entry); else this.queue.splice(i, 0, entry);
    } else if (entry.priority === 'low') {
      this.queue.push(entry);
    } else {
      let i = this.queue.findIndex(e => e.priority === 'low');
      if (i === -1) this.queue.push(entry); else this.queue.splice(i, 0, entry);
    }
    this.queueIndex.add(fingerprint);
    this.state.queueSize = this.queue.length;
    this.state.isOverloaded = this.checkLoad().isOverloaded;
    return { success: true, taskId: entry.taskId };
  }
  async addTask(task, opts = {}) {
    if (!task) throw new Error('invalid task');
    if (this.queue.length >= this.state.maxQueue) {
      this.logger.warn(`[${this.name}] queue full; requesting help`);
      await this.requestHelp('queue_full').catch(() => {});
      return { success: false, reason: 'queue_full' };
    }
    const res = this._pushToQueue(task, opts);
    if (!res.success) return res;
    this._drainQueue();
    return res;
  }
  async process(task, opts = {}) {
    if (!task) throw new Error('invalid task');
    const type = task.type || this.detectProcessor(task);
    const processor = this.getProcessor(type);
    const data = task.data !== undefined ? task.data : task;
    const taskId = opts.taskId || task.taskId || crypto.randomUUID();
    const start = Date.now();
    try {
      const result = await processor.process(data, { taskId, impulser: this });
      const duration = Date.now() - start;
      this.state.totalProcessed++;
      this.updateMetrics(duration, true, type);
      return { processed: 1, success: true, result };
    } catch (err) {
      const duration = Date.now() - start;
      this.state.totalErrors++;
      this.updateMetrics(duration, false, type);
      this.logger.warn(`[${this.name}] direct process error for ${type}: ${err.message}`);
      return { processed: 0, success: false, error: err.message };
    }
  }
  async _drainQueue() {
    // Prevent concurrent drain calls (race condition fix)
    if (this._draining) return;
    this._draining = true;

    try {
      while (this.state.processing < this.state.maxConcurrent && this.queue.length > 0) {
        const entry = this.queue.shift();
        this.state.queueSize = this.queue.length;
        this.state.processing++;
        this.processingSet.add(entry.taskId);
        this._processEntry(entry).catch(err => this.logger.warn(`[${this.name}] entry process error: ${(err && err.message) || err}`));
      }
    } finally {
      this._draining = false;
    }

    this.state.isOverloaded = this.checkLoad().isOverloaded;
  }
  async _processEntry(entry) {
    const start = Date.now();
    try {
      entry.attempts++;
      const processor = this.getProcessor(entry.type);
      const result = await processor.process(entry.data, { taskId: entry.taskId, impulser: this });
      const duration = Date.now() - start;
      this.state.totalProcessed++;
      this.updateMetrics(duration, true, entry.type);
      this.queueIndex.delete(entry.fingerprint);
      if (entry.callback) {
        await messageBroker.sendMessage({ from: this.name, to: entry.callback, type: 'task_complete', payload: { taskId: entry.taskId, result, processorType: entry.type } }).catch(() => {});
      }
      this.emit('task:done', { taskId: entry.taskId, result, processorType: entry.type });
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      this.state.totalErrors++;
      this.updateMetrics(duration, false, entry.type);
      this.logger.warn(`[${this.name}] task ${entry.taskId} failed (attempt ${entry.attempts}): ${(err && err.message) || err}`);
      if (entry.attempts < (entry.maxAttempts || 3)) {
        const backoff = this.retryDelayBaseMs * Math.pow(2, entry.attempts - 1);
        setTimeout(() => { this.queue.unshift(entry); this.state.queueSize = this.queue.length; this._drainQueue(); }, backoff);
      } else {
        await messageBroker.sendMessage({ from: this.name, to: 'ASIOrchestrator', type: 'task_failed', payload: { taskId: entry.taskId, error: (err && err.message) || String(err), attempts: entry.attempts, processorType: entry.type } }).catch(() => {});
        this.queueIndex.delete(entry.fingerprint);
      }
      throw err;
    } finally {
      this.processingSet.delete(entry.taskId);
      this.state.processing = Math.max(0, this.state.processing - 1);
      this._drainQueue();
    }
  }
  checkLoad() {
    const queueLoad = this.state.maxQueue > 0 ? (this.state.queueSize / this.state.maxQueue) : 0;
    const processingLoad = this.state.maxConcurrent > 0 ? (this.state.processing / this.state.maxConcurrent) : 0;
    const overall = (queueLoad + processingLoad) / 2;
    const isOverloaded = queueLoad > 0.8 || processingLoad > 0.9;
    return { queue: queueLoad, processing: processingLoad, overall, isOverloaded };
  }
  async requestHelp(reason = 'overload') {
    try {
      const load = this.checkLoad();
      if (this.state.helpers.length > 0) return { success: true, message: 'helpers_present' };
      this.logger.info(`[${this.name}] requesting help (${reason})`);
      await messageBroker.sendMessage({ from: this.name, to: 'broadcast', type: 'impulser_help_request', payload: { reason, load, queueSize: this.state.queueSize, taskType: this.type, capabilities: this.capabilities } });
      return { success: true };
    } catch (err) {
      this.logger.warn(`[${this.name}] requestHelp error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
  async handleMessage(message = {}) {
    try {
      this.state.lastActive = Date.now();
      const { type, from, payload } = message;
      if (this.processors.has(type)) return await this.addTask({ type, data: payload }, { callback: from });
      switch (type) {
        case 'impulser_help_request': return this.handleHelpRequest(message);
        case 'help_accepted': return this.handleHelpAccepted(message);
        case 'task_batch': return this.handleTaskBatch(message);
        case 'task_complete': return this.handleTaskComplete(message);
        case 'status_check': return { success: true, status: this.getStatus() };
        case 'release': return this._handleRelease(message);
        default: this.logger.warn(`[${this.name}] Unknown message type: ${type}`); return { success: false, error: 'unknown_message_type' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${(err && err.message) || err}`);
      return { success: false, error: (err && err.message) || 'handler_error' };
    }
  }
  async handleHelpRequest(message) {
    const from = message.from;
    if (from === this.name) return { success: false, reason: 'self' };
    const myLoad = this.checkLoad();
    if (myLoad.isOverloaded) return { success: false, reason: 'overloaded' };
    const canHelp = (message.payload && message.payload.capabilities || []).some(c => this.capabilities.includes(c));
    if (!canHelp) return { success: false, reason: 'incompatible' };
    await messageBroker.sendMessage({ from: this.name, to: from, type: 'help_accepted', payload: { helper: this.name, availableCapacity: this.state.maxConcurrent - this.state.processing } }).catch(() => {});
    return { success: true, helping: from };
  }
  async handleHelpAccepted(message) {
    this.logger.info(`[${this.name}] help accepted by ${message.from}`);
    if (!this.state.helpers.includes(message.from)) this.state.helpers.push(message.from);
    await this.distributeWorkToHelpers().catch(() => {});
    return { success: true };
  }
  async handleTaskBatch(message) {
    const tasks = (message.payload && message.payload.tasks) || [];
    const callback = message.payload && message.payload.callback;
    let queued = 0;
    for (const t of tasks) {
      const r = this._pushToQueue(t, { priority: 'normal', callback });
      if (r.success) queued++;
    }
    this._drainQueue();
    return { success: true, queued };
  }
  async handleTaskComplete(message) {
    if (message.payload && message.payload.result) this.state.totalProcessed++;
    return { success: true };
  }
  async distributeWorkToHelpers() {
    if (this.state.helpers.length === 0 || this.queue.length === 0) return { success: false, reason: 'no_helpers_or_tasks' };
    const tasksPer = Math.ceil(this.queue.length / this.state.helpers.length);
    for (let i = 0; i < this.state.helpers.length && this.queue.length > 0; i++) {
      const helper = this.state.helpers[i];
      const batch = [];
      for (let j = 0; j < tasksPer && this.queue.length > 0; j++) {
        const entry = this.queue.shift();
        batch.push({ type: entry.type, data: entry.data });
      }
      this.state.queueSize = this.queue.length;
      await messageBroker.sendMessage({ from: this.name, to: helper, type: 'task_batch', payload: { tasks: batch, callback: this.name }, priority: 'high' }).catch(e => this.logger.warn(`[${this.name}] distributeWorkToHelpers error: ${(e && e.message) || e}`));
    }
    return { success: true };
  }
  async _handleRelease(message) {
    const reason = message.payload?.reason || 'unknown';
    this.logger.info(`[${this.name}] Received release: ${reason}`);
    this.queue = []; this.queueIndex.clear(); this.state.queueSize = 0;
    return { success: true };
  }
  async releaseHelpers() {
    if (!this.state.helpers.length) return;
    for (const h of this.state.helpers) {
      await messageBroker.sendMessage({ from: this.name, to: h, type: 'release', payload: { reason: 'work_complete' } }).catch(() => {});
    }
    this.state.helpers = [];
    return { success: true };
  }
  async updateMetrics(processingTimeMs, success, processorType) {
    const alpha = 0.1;
    this.metrics.avgProcessingTime = (1 - alpha) * (this.metrics.avgProcessingTime || 0) + alpha * (processingTimeMs || 0);
    const totalAttempts = Math.max(1, this.state.totalProcessed + this.state.totalErrors);
    this.metrics.successRate = (this.state.totalProcessed / totalAttempts) * 100;
    const uptimeMin = Math.max(0.0001, (Date.now() - this.state.startTime) / (1000 * 60));
    this.metrics.throughput = this.state.totalProcessed / uptimeMin;
    if (processorType && this.processorStats.has(processorType)) {
      const stats = this.processorStats.get(processorType);
      if (success) { stats.processed++; stats.avgTimeMs = (stats.avgTimeMs * (stats.processed - 1) + processingTimeMs) / stats.processed; } 
      else { stats.errors++; }
    }
  }
  async _monitor() {
    try {
      const load = this.checkLoad();
      if (load.isOverloaded && this.state.helpers.length === 0) await this.requestHelp('periodic_overload_check').catch(() => {});
      await messageBroker.sendMessage({ from: this.name, to: 'ASIOrchestrator', type: 'impulser_metrics', payload: { name: this.name, metrics: this.metrics, load, processorStats: Object.fromEntries(this.processorStats) } }).catch(() => {});
    } catch (e) { this.logger.warn(`[${this.name}] monitor error: ${e.message}`); }
  }
  getStatus() {
    return {
      id: this.id, name: this.name, type: this.type, processors: Array.from(this.processors.keys()),
      state: { queueSize: this.state.queueSize, processing: this.state.processing, totalProcessed: this.state.totalProcessed, totalErrors: this.state.totalErrors, helpers: this.state.helpers.length },
      metrics: this.metrics, processorStats: Object.fromEntries(this.processorStats), load: this.checkLoad(), uptimeMs: Date.now() - this.state.startTime
    };
  }
  startAutonomousImpulseLoop(intervalMs = 90000) {
    if (this._impulseTimer) clearInterval(this._impulseTimer);
    this._impulseTimer = setInterval(() => this._triggerSpontaneousImpulse(), intervalMs);
    this._impulseTimer.unref?.();
    this.logger.info(`[${this.name}] ⚡ Autonomous impulse loop started (${Math.round(intervalMs / 1000)}s interval)`);
  }

  async _triggerSpontaneousImpulse() {
    try {
      if (this.queue.length > 5 || this.state.processing > 0) return; // Only run when idle
      const topics = ['metacognition', 'reasoning', 'trading-dynamics', 'system-optimization', 'agent-autonomy', 'knowledge-synthesis'];
      const topic = topics[Math.floor(Math.random() * topics.length)];
      
      this.emit('impulse:spontaneous', { topic, timestamp: Date.now() });
      if (messageBroker && typeof messageBroker.sendMessage === 'function') {
        await messageBroker.sendMessage({
          from: this.name,
          to: 'broadcast',
          type: 'cognitive_impulse',
          payload: { topic, origin: 'UniversalImpulser', timestamp: Date.now() }
        }).catch(() => {});
      }
    } catch (e) {
      this.logger.warn(`[${this.name}] Spontaneous impulse skipped: ${e.message}`);
    }
  }

  async shutdown() {
    if (this._monitorInterval) clearInterval(this._monitorInterval);
    if (this._bufferFlushInterval) clearInterval(this._bufferFlushInterval);
    if (this._impulseTimer) clearInterval(this._impulseTimer);
    await this._flushHippocampusBuffer().catch(() => {});
    await this.releaseHelpers().catch(() => {});
    this.logger.info(`[${this.name}] shutdown complete`);
  }
}

// ==================== BASE PROCESSOR ====================

class BaseProcessor {
  constructor(config = {}) { this.config = config; this.impulser = null; this.logger = config.logger || console; }
  async process(data, context) { throw new Error('process() must be implemented by child class'); }
  async storeResult(result) {
    if (this.impulser) return await this.impulser.storeInHippocampus({ processorType: this.constructor.name, result, timestamp: Date.now() });
    return { success: false, error: 'no_impulser' };
  }
  async sendTo(arbiter, type, payload) {
    return await messageBroker.sendMessage({ from: this.impulser?.name || 'UnknownProcessor', to: arbiter, type, payload }).catch(() => ({ success: false }));
  }
}

// ==================== PROCESSORS ====================

class CategoryProcessor extends BaseProcessor {
  constructor(config = {}) {
    super(config);
    this.taxonomy = config.taxonomy || {
      Science: ['Physics', 'Chemistry', 'Biology'], Technology: ['AI', 'Programming', 'Networks'],
      Arts: ['Music', 'Literature', 'Visual Arts'], History: ['Ancient', 'Medieval', 'Modern']
    };
    this.categoryStats = {}; this.tagFrequency = new Map();
  }
  async process(data, context) {
    const article = data.article || data;
    let primary = 'General';
    let tags = [];

    // Try LLM-powered categorization if brain is available
    if (this.impulser && this.impulser.config && this.impulser.config.brain) {
      try {
        const brain = this.impulser.config.brain;
        const content = (article.content || article.text || '').slice(0, 2000);
        const categories = Object.keys(this.taxonomy).join(', ');
        const response = await brain.reason({
          query: `Categorize this content into one primary category and suggest 3-5 relevant tags.\n\nCategories: ${categories}\n\nTitle: ${article.title || 'N/A'}\nContent: ${content}\n\nRespond in format: "Category: X | Tags: tag1, tag2, tag3"`,
          context: { task: 'categorization' }
        });
        const answerText = response.answer || response.response || '';
        const categoryMatch = answerText.match(/Category:\s*([^\|]+)/i);
        const tagsMatch = answerText.match(/Tags:\s*(.+)/i);
        if (categoryMatch) primary = categoryMatch[1].trim();
        if (tagsMatch) tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
      } catch (err) {
        if (this.logger && this.logger.warn) this.logger.warn(`[CategoryProcessor] Brain categorization failed: ${err.message}, falling back to basic`);
      }
    }

    // Fallback: basic keyword extraction
    if (!tags.length) {
      const keywords = this.extractKeywords(article);
      primary = this.assignPrimaryCategory(keywords, article.categories || []);
      tags = this.generateTags(keywords, article);
    }

    const categorized = { ...article, categorization: { primary, tags, categorizedAt: new Date().toISOString() } };
    this.categoryStats[primary] = (this.categoryStats[primary] || 0) + 1;
    await this.storeResult({ summary: article.title, primary });
    return categorized;
  }
  extractKeywords(article) {
    const text = `${article.title || ''} ${article.content || ''}`.toLowerCase();
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but']);
    const words = text.match(/\b[a-z]{3,}\b/g) || [];
    const freq = new Map();
    for (const w of words) if (!stopWords.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k]) => k);
  }
  assignPrimaryCategory(keywords, existingCategories = []) {
    const scores = {};
    for (const [category, subcats] of Object.entries(this.taxonomy)) {
      let score = 0;
      const terms = [category.toLowerCase(), ...subcats.map(s => s.toLowerCase())];
      keywords.forEach(k => terms.forEach(t => { if (t.includes(k)) score += 1; }));
      scores[category] = score;
    }
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return sorted[0] && sorted[0][1] > 0 ? sorted[0][0] : 'General';
  }
  generateTags(keywords, article) {
    return keywords.slice(0, 10);
  }
}

class SummaryProcessor extends BaseProcessor {
  async process(data, context) {
    const article = data.article || data;
    const maxLength = data.maxLength || 200;
    const text = article.content || article.text || '';

    let summary = '';

    // Try LLM-powered summarization if brain is available
    if (this.impulser && this.impulser.config && this.impulser.config.brain) {
      try {
        const brain = this.impulser.config.brain;
        const response = await brain.reason({
          query: `Summarize this content in ${maxLength} characters or less. Focus on key insights and main points:\n\n${text.slice(0, 5000)}`,
          context: { task: 'summarization', maxLength }
        });
        summary = response.answer || response.response || '';
        if (summary.length > maxLength) {
          summary = summary.slice(0, maxLength - 3) + '...';
        }
      } catch (err) {
        if (this.logger && this.logger.warn) this.logger.warn(`[SummaryProcessor] Brain summarization failed: ${err.message}, falling back to basic`);
        // Fall through to basic summarization
      }
    }

    // Fallback: basic sentence extraction
    if (!summary) {
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
      for (const sentence of sentences) {
        if ((summary + sentence).length > maxLength) break;
        summary += sentence;
      }
      summary = summary.trim() || text.slice(0, maxLength);
    }

    const result = { ...article, summary, summarizedAt: new Date().toISOString() };
    await this.storeResult({ summary: result.summary, title: article.title });
    return result;
  }
}

class IndexProcessor extends BaseProcessor {
  constructor(config = {}) {
    super(config);
    this.index = new Map();
    this.documents = new Map();
  }
  async process(data, context) {
    const article = data.article || data;
    const docId = article.id || article.url || crypto.randomUUID();
    this.documents.set(docId, article);
    const terms = this.extractTerms(article);
    for (const term of terms.keys()) {
      if (!this.index.has(term)) this.index.set(term, []);
      this.index.get(term).push(docId);
    }
    await this.storeResult({ docId, termCount: terms.size });
    return { docId, terms: Array.from(terms.keys()), indexedAt: new Date().toISOString() };
  }
  extractTerms(article) {
    const text = `${article.title || ''} ${article.content || ''}`.toLowerCase();
    const words = text.match(/\b[a-z]{3,}\b/g) || [];
    const terms = new Map();
    words.forEach((word, index) => {
      if (!terms.has(word)) terms.set(word, []);
      terms.get(word).push(index);
    });
    return terms;
  }
}

class RelationshipProcessor extends BaseProcessor {
  async process(data, context) {
    const article = data.article || data;
    const entities = this.extractEntities(article);
    const relationships = [];
    const result = { ...article, relationships, entities: Array.from(entities), processedAt: new Date().toISOString() };
    await this.storeResult({ relationships: relationships.length, entities: entities.size });
    return result;
  }
  extractEntities(article) {
    const text = `${article.title || ''} ${article.content || ''}`;
    const matches = text.match(/\b[A-Z][a-z]+\b/g) || [];
    return new Set(matches);
  }
}

class QualityProcessor extends BaseProcessor {
  async process(data, context) {
    const article = data.article || data;
    let score = 0;
    let qualityLevel = 'low';
    let aiAssessment = null;

    // Try LLM-powered quality assessment if brain is available
    if (this.impulser && this.impulser.config && this.impulser.config.brain) {
      try {
        const brain = this.impulser.config.brain;
        const content = (article.content || article.text || '').slice(0, 2000);
        const response = await brain.reason({
          query: `Assess the quality of this content on a scale of 0-100. Consider: accuracy, depth, clarity, usefulness. Respond with just a number and brief reason.\n\nTitle: ${article.title || 'N/A'}\nContent: ${content}`,
          context: { task: 'quality_assessment' }
        });
        const answerText = response.answer || response.response || '';
        const scoreMatch = answerText.match(/\b(\d{1,3})\b/);
        if (scoreMatch) {
          score = Math.min(100, parseInt(scoreMatch[1], 10));
          qualityLevel = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
          aiAssessment = answerText;
        }
      } catch (err) {
        if (this.logger && this.logger.warn) this.logger.warn(`[QualityProcessor] Brain assessment failed: ${err.message}, falling back to basic`);
      }
    }

    // Fallback: basic heuristic scoring
    if (score === 0) {
      if (article.title) score += 20;
      if (article.content && article.content.length > 100) score += 30;
      if (article.url) score += 10;
      qualityLevel = score >= 50 ? 'high' : 'low';
    }

    const result = {
      ...article,
      quality: {
        score,
        level: qualityLevel,
        aiAssessment,
        checkedAt: new Date().toISOString()
      }
    };
    await this.storeResult({ score, level: qualityLevel });
    return result;
  }
}

class DeduplicationProcessor extends BaseProcessor {
  constructor(config = {}) {
    super(config);
    this.hashes = new Map();
  }
  async process(data, context) {
    const items = data.items || data.documents || [data];
    const results = { checked: items.length, duplicates: [], unique: [] };
    for (const item of items) {
      const hash = this.hashContent(item);
      if (this.hashes.has(hash)) {
        results.duplicates.push({ duplicate: item.id || item.url, original: this.hashes.get(hash), hash });
      } else {
        this.hashes.set(hash, item.id || item.url || crypto.randomUUID());
        results.unique.push(item);
      }
    }
    await this.storeResult({ duplicates: results.duplicates.length, unique: results.unique.length });
    return results;
  }
  hashContent(item) {
    const content = `${item.title || ''} ${item.content || item.text || ''}`;
    return crypto.createHash('sha256').update(content.toLowerCase().trim()).digest('hex');
  }
}

module.exports = UniversalImpulser;
