// ═══════════════════════════════════════════════════════════
// FILE: BaseDendrite.cjs
// Foundation for web crawlers / data gatherers (Dendrites)
// Full queue management, load balancing, auto-scaling
// ═══════════════════════════════════════════════════════════

const messageBroker = require('../core/MessageBroker.cjs');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class BaseDendrite extends EventEmitter {
  constructor(config = {}) {
    super();

    this.id = crypto.randomUUID();
    this.name = config.name || `dendrite-${this.id.slice(0, 8)}`;
    this.type = config.type || 'generic-dendrite';
    this.capabilities = config.capabilities || [];

    // Load management
    this.state = {
      queueSize: 0,
      processing: 0,
      maxConcurrent: config.maxConcurrent || 5,
      maxQueue: config.maxQueue || 1000,
      isOverloaded: false,
      helpers: [], // names of helper EdgeWorkers or clones
      totalProcessed: 0,
      totalErrors: 0,
      startTime: Date.now(),
      lastActive: Date.now()
    };

    // Task queue (priority-based)
    // Each entry: { taskId, task, priority, addedAt, attempts, callback }
    this.queue = [];
    this.processingSet = new Set();

    // Performance tracking
    this.metrics = {
      avgProcessingTime: 0,
      successRate: 100,
      throughput: 0
    };

    // Configurable behavior
    this.maxHelpers = config.maxHelpers || 5;
    this.helperCloneLimit = config.helperCloneLimit || 5;
    this.retryDelayBaseMs = config.retryDelayBaseMs || 500;
    this.logger = config.logger || console;

    // Register with message broker
    this.registerWithBroker();

    // Subscribe to relevant messages
    this.subscribeToMessages();

    // Monitoring interval
    this._monitorInterval = setInterval(
      () => this._monitor(),
      config.monitorIntervalMs || 5000
    );

    this.logger.info(`[${this.name}] 🕷️ Dendrite initialized (id=${this.id.slice(0, 8)})`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ BROKER REGISTRATION ░░
  // ═══════════════════════════════════════════════════════════

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: this.type,
        capabilities: this.capabilities
      });
      this.logger.info(`[${this.name}] ✅ Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  subscribeToMessages() {
    messageBroker.subscribe(this.name, 'help_available');
    messageBroker.subscribe(this.name, 'clone_ready');
    messageBroker.subscribe(this.name, 'task_complete');
    messageBroker.subscribe(this.name, 'status_check');
    messageBroker.subscribe(this.name, 'task_batch');
    messageBroker.subscribe(this.name, 'release');
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ QUEUE MANAGEMENT ░░
  // ═══════════════════════════════════════════════════════════

  _pushToQueue(task, options = {}) {
    const entry = {
      taskId: options.taskId || crypto.randomUUID(),
      task,
      priority: options.priority || 'normal', // 'high'|'normal'|'low'
      addedAt: Date.now(),
      attempts: 0,
      callback: options.callback
    };

    // Priority-based insertion: high -> normal -> low
    if (entry.priority === 'high') {
      const i = this.queue.findIndex(e => e.priority !== 'high');
      if (i === -1) this.queue.push(entry);
      else this.queue.splice(i, 0, entry);
    } else if (entry.priority === 'low') {
      this.queue.push(entry);
    } else {
      // normal
      const i = this.queue.findIndex(e => e.priority === 'low');
      if (i === -1) this.queue.push(entry);
      else this.queue.splice(i, 0, entry);
    }

    this.state.queueSize = this.queue.length;
    return entry.taskId;
  }

  async addTask(task, options = {}) {
    if (!task) throw new Error('task required');

    // Check queue capacity
    if (this.queue.length >= this.state.maxQueue) {
      this.logger.warn(`[${this.name}] Queue full (${this.queue.length} >= ${this.state.maxQueue})`);
      await this.requestHelp('queue_full');
      return { success: false, reason: 'queue_full' };
    }

    const taskId = this._pushToQueue(task, options);

    // Start processing immediately if under concurrency limit
    this._drainQueue();

    return { success: true, taskId };
  }

  async _drainQueue() {
    while (this.state.processing < this.state.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift();
      this.state.queueSize = this.queue.length;
      this.state.processing++;
      this.processingSet.add(entry.taskId);

      // Process without awaiting (allows concurrency)
      this._runTaskEntry(entry).catch(err => {
        this.logger.error(`[${this.name}] _runTaskEntry error: ${err?.message || err}`);
      });
    }

    // Update overload status
    const load = this.checkLoad();
    this.state.isOverloaded = load.isOverloaded;
  }

  async _runTaskEntry(entry) {
    const start = Date.now();
    try {
      entry.attempts++;
      const result = await this.processTask(entry.task, {
        taskId: entry.taskId,
        callback: entry.callback
      });
      const duration = Date.now() - start;

      this.state.totalProcessed++;
      this.updateMetrics(duration, true);
      this.emit('task:done', { taskId: entry.taskId, result });

      // Send result back to callback if specified
      if (entry.callback) {
        await messageBroker.sendMessage({
          from: this.name,
          to: entry.callback,
          type: 'task_complete',
          payload: { taskId: entry.taskId, result }
        });
      }

      return result;
    } catch (err) {
      const duration = Date.now() - start;
      this.state.totalErrors++;
      this.updateMetrics(duration, false);

      this.logger.warn(
        `[${this.name}] task ${entry.taskId} error (attempt ${entry.attempts}): ${err?.message || err}`
      );

      // Retry with exponential backoff
      if (entry.attempts < (entry.task.maxAttempts || 3)) {
        const backoff = this.retryDelayBaseMs * Math.pow(2, entry.attempts - 1);
        setTimeout(() => {
          this.queue.unshift(entry); // Requeue to front
          this.state.queueSize = this.queue.length;
          this._drainQueue();
        }, backoff);
      } else {
        // Permanently failed - notify orchestrator
        await messageBroker.sendMessage({
          from: this.name,
          to: 'EdgeWorkerOrchestrator',
          type: 'task_failed',
          payload: {
            taskId: entry.taskId,
            error: (err && err.message) || String(err),
            attempts: entry.attempts
          }
        }).catch(() => {});
      }
      throw err;
    } finally {
      this.processingSet.delete(entry.taskId);
      this.state.processing = Math.max(0, this.state.processing - 1);
      this._drainQueue();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ LOAD MANAGEMENT & HELPERS ░░
  // ═══════════════════════════════════════════════════════════

  checkLoad() {
    const queueLoad = this.state.maxQueue > 0 ? (this.state.queueSize / this.state.maxQueue) : 0;
    const processingLoad = this.state.maxConcurrent > 0 ? (this.state.processing / this.state.maxConcurrent) : 0;
    const overall = (queueLoad + processingLoad) / 2;
    const overloaded = queueLoad > 0.8 || processingLoad > 0.9;
    return { queue: queueLoad, processing: processingLoad, overall, isOverloaded: overloaded };
  }

  async requestHelp(reason = 'overload') {
    try {
      const load = this.checkLoad();

      // Don't spam if we already have helpers
      if (this.state.helpers.length > 0) {
        this.logger.info(`[${this.name}] Already have ${this.state.helpers.length} helpers`);
        return { success: true, message: 'helpers_present' };
      }

      const needed = Math.min(this.helperCloneLimit, Math.max(1, Math.ceil(this.state.queueSize / 20)));

      this.logger.info(`[${this.name}] Requesting help (reason=${reason}) — need ${needed} clones`);

      // Query MessageBroker for edge workers
      const responses = await messageBroker.requestHelp(this.name, 'edge_worker', {
        reason,
        load,
        queueSize: this.state.queueSize,
        neededClones: needed,
        taskType: this.type,
        capabilities: this.capabilities
      });

      const successful = [];
      for (const r of responses) {
        if (r.res && r.res.success) successful.push(r.from);
      }

      if (successful.length) {
        this.logger.info(`[${this.name}] EdgeWorkers responded: ${successful.join(', ')}`);
        
        // Send explicit help request to selected helpers
        for (const helperName of successful.slice(0, this.maxHelpers)) {
          await messageBroker.sendMessage({
            from: this.name,
            to: helperName,
            type: 'help_request',
            payload: { reason, neededClones: 1, callback: this.name }
          });
        }
        return { success: true, helpers: successful };
      } else {
        this.logger.warn(`[${this.name}] No helpers available`);
        return { success: false, reason: 'no_helpers' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] requestHelp failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ MESSAGE HANDLING ░░
  // ═══════════════════════════════════════════════════════════

  async handleMessage(message) {
    try {
      this.state.lastActive = Date.now();
      const { type, from, payload } = message || {};
      
      switch (type) {
        case 'help_available':
          return await this.handleHelpAvailable(message);
        case 'clone_ready':
          return await this.handleCloneReady(message);
        case 'task_complete':
          return await this.handleTaskComplete(message);
        case 'task_batch':
          return await this.handleTaskBatch(message);
        case 'status_check':
          return this.getStatus();
        case 'release':
          return this._handleRelease(message);
        default:
          return this.handleCustomMessage(message);
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err?.message || err}`);
      return { success: false, error: err?.message || 'handler_error' };
    }
  }

  async handleHelpAvailable(message) {
    const clones = (message.payload && message.payload.clones) || [];
    this.logger.info(`[${this.name}] 🎉 Help available: ${clones.length} clones`);
    
    for (const c of clones) {
      if (!this.state.helpers.includes(c)) this.state.helpers.push(c);
    }
    
    await this.distributeWorkToHelpers();
    return { success: true };
  }

  async handleCloneReady(message) {
    const from = message.from;
    this.logger.info(`[${this.name}] ✅ Clone ready from ${from}`);
    if (!this.state.helpers.includes(from)) this.state.helpers.push(from);
    return { success: true };
  }

  async handleTaskComplete(message) {
    const from = message.from;
    this.logger.info(`[${this.name}] ✅ Task completed by ${from}`);
    
    if (message.payload && message.payload.result) {
      try {
        await this.processHelperResult(message.payload.result, from);
      } catch (err) {
        this.logger.warn(`[${this.name}] processHelperResult failed: ${err.message}`);
      }
    }
    
    this.state.totalProcessed++;
    return { success: true };
  }

  async handleTaskBatch(message) {
    const { tasks, callback } = (message.payload || {});
    
    if (Array.isArray(tasks) && tasks.length > 0) {
      for (const t of tasks) {
        this._pushToQueue(t, { priority: 'low', callback });
      }
      this._drainQueue();
    }
    
    return { success: true };
  }

  async processHelperResult(result, from) {
    this.logger.info(`[${this.name}] 📥 Processing helper result from ${from || 'helper'}`);
    // Override in child classes
  }

  async distributeWorkToHelpers() {
    if (this.state.helpers.length === 0 || this.queue.length === 0) {
      return { success: false, reason: 'no_helpers_or_no_tasks' };
    }

    this.logger.info(
      `[${this.name}] 📤 Distributing ${this.queue.length} tasks to ${this.state.helpers.length} helpers`
    );

    const tasksPerHelper = Math.ceil(this.queue.length / this.state.helpers.length);
    
    for (let i = 0; i < this.state.helpers.length && this.queue.length > 0; i++) {
      const helperName = this.state.helpers[i];
      const tasks = [];
      
      for (let j = 0; j < tasksPerHelper && this.queue.length > 0; j++) {
        tasks.push(this.queue.shift().task);
      }
      
      this.state.queueSize = this.queue.length;

      await messageBroker.sendMessage({
        from: this.name,
        to: helperName,
        type: 'task_batch',
        payload: { tasks, callback: this.name },
        priority: 'high'
      }).catch(err => {
        this.logger.warn(`[${this.name}] failed to send tasks to ${helperName}: ${err.message}`);
      });
    }

    return { success: true };
  }

  async handleCustomMessage(message) {
    this.logger.warn(`[${this.name}] ❓ Unhandled message type: ${message && message.type}`);
    return { success: false, error: 'unknown_message_type' };
  }

  async _handleRelease(message) {
    const reason = message.payload?.reason || 'unknown';
    this.logger.info(`[${this.name}] Received release: ${reason}`);
    this.queue = [];
    this.state.queueSize = 0;
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATUS & METRICS ░░
  // ═══════════════════════════════════════════════════════════

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      state: {
        queueSize: this.state.queueSize,
        processing: this.state.processing,
        totalProcessed: this.state.totalProcessed,
        totalErrors: this.state.totalErrors,
        helpers: this.state.helpers.slice()
      },
      metrics: this.metrics,
      load: this.checkLoad(),
      uptimeMs: Date.now() - this.state.startTime
    };
  }

  updateMetrics(processingTimeMs, success) {
    const alpha = 0.1;
    this.metrics.avgProcessingTime = 
      (1 - alpha) * (this.metrics.avgProcessingTime || 0) + alpha * (processingTimeMs || 0);
    
    const totalAttempts = Math.max(1, this.state.totalProcessed + this.state.totalErrors);
    this.metrics.successRate = (this.state.totalProcessed / totalAttempts) * 100;
    
    const uptimeMin = Math.max(0.0001, (Date.now() - this.state.startTime) / (1000 * 60));
    this.metrics.throughput = this.state.totalProcessed / uptimeMin;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ MONITORING & CLEANUP ░░
  // ═══════════════════════════════════════════════════════════

  async _monitor() {
    try {
      const load = this.checkLoad();
      
      if (load.isOverloaded && this.state.helpers.length === 0) {
        await this.requestHelp('periodic_overload_check');
      }
      
      this.emit('metrics', { name: this.name, metrics: this.metrics, load });
    } catch (err) {
      this.logger.warn(`[${this.name}] monitor error: ${err.message}`);
    }
  }

  async releaseHelpers() {
    if (!this.state.helpers.length) return;
    
    this.logger.info(`[${this.name}] 👋 Releasing ${this.state.helpers.length} helpers`);
    
    for (const helper of this.state.helpers) {
      await messageBroker.sendMessage({
        from: this.name,
        to: helper,
        type: 'release',
        payload: { reason: 'work_complete' }
      }).catch(() => {});
    }
    
    this.state.helpers = [];
  }

  async shutdown() {
    clearInterval(this._monitorInterval);
    await this.releaseHelpers();
    this.logger.info(`[${this.name}] shutdown complete`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ ABSTRACT METHOD (IMPLEMENT IN CHILD CLASS) ░░
  // ═══════════════════════════════════════════════════════════

  async processTask(task, ctx = {}) {
    throw new Error('processTask must be implemented by child class');
  }
}

module.exports = { BaseDendrite };
