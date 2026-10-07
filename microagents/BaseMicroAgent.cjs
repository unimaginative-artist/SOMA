// BaseMicroAgent.cjs
// Foundation for ephemeral task executors

const crypto = require('crypto');
const EventEmitter = require('events');

const DEFAULT_TTL = 60000; // 1 minute
const DEFAULT_IDLE_TIMEOUT = 30000; // 30 seconds

class BaseMicroAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.id = config.id || `ma_${crypto.randomBytes(6).toString('hex')}`;
    this.type = config.type || 'generic';
    this.parentId = config.parentId || null;
    
    // Lifecycle
    this.state = 'initializing'; // initializing, idle, working, completing, terminated
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    this.terminatedAt = null;
    
    // TTL and timeouts
    this.ttl = config.ttl || DEFAULT_TTL;
    this.idleTimeout = config.idleTimeout || DEFAULT_IDLE_TIMEOUT;
    this.maxRetries = config.maxRetries || 3;
    
    // Task tracking
    this.task = null;
    this.result = null;
    this.error = null;
    this.retryCount = 0;
    
    // Timers
    this._ttlTimer = null;
    this._idleTimer = null;
    
    // Metrics
    this.metrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalExecutionTime: 0,
      avgExecutionTime: 0
    };
    
    // Logging
    this.logger = config.logger || console;
    
    this.logger.info(`[MicroAgent:${this.id}] Created (type: ${this.type})`);
  }
  
  async initialize() {
    // Idempotency check
    if (this.state !== 'initializing') {
      this.logger.warn(`[MicroAgent:${this.id}] Already initialized (state: ${this.state})`);
      return;
    }

    this.state = 'idle';
    this.startedAt = Date.now();

    // Clear any existing timers first
    this._clearTimers();

    // Start TTL countdown
    this._startTTLTimer();

    // Start idle timer
    this._resetIdleTimer();

    this.emit('initialized', { id: this.id, type: this.type });
    this.logger.info(`[MicroAgent:${this.id}] Initialized`);
  }

  // Handle messages from MessageBroker (for ASIOrchestrator integration)
  async handleMessage(message = {}) {
    const { type, payload } = message;

    switch (type) {
      case 'status_check':
        return {
          success: true,
          status: this.state,
          id: this.id,
          type: this.type,
          metrics: this.metrics,
          uptime: Date.now() - this.createdAt
        };

      case 'task_assign':
        return await this.executeTask(payload);

      case 'terminate':
        this.terminate('requested');
        return { success: true, message: 'Terminating' };

      default:
        return { success: true, message: 'Message acknowledged' };
    }
  }
  
  _startTTLTimer() {
    this._clearTimer('_ttlTimer');
    
    // Node.js setTimeout limit is 2147483647ms (~24.8 days)
    // If TTL is Infinity or exceeds this, skip the timer to avoid overflow warnings.
    if (!Number.isFinite(this.ttl) || this.ttl > 2147483647 || this.ttl <= 0) {
      return;
    }

    this._ttlTimer = setTimeout(() => {
      this.logger.warn(`[MicroAgent:${this.id}] TTL expired, terminating`);
      this.terminate('ttl_expired');
    }, this.ttl);
  }
  
  _resetIdleTimer() {
    this._clearTimer('_idleTimer');
    
    if (!Number.isFinite(this.idleTimeout) || this.idleTimeout > 2147483647 || this.idleTimeout <= 0) {
      return;
    }

    this._idleTimer = setTimeout(() => {
      if (this.state === 'idle') {
        this.logger.info(`[MicroAgent:${this.id}] Idle timeout, terminating`);
        this.terminate('idle_timeout');
      }
    }, this.idleTimeout);
  }
  
  _clearTimer(timerKey) {
    if (this[timerKey]) {
      clearTimeout(this[timerKey]);
      this[timerKey] = null;
    }
  }

  _clearTimers() {
    this._clearTimer('_ttlTimer');
    this._clearTimer('_idleTimer');
  }
  
  async executeTask(task) {
    // Validate task parameter
    if (!task || typeof task !== 'object') {
      throw new Error('Invalid task: expected non-null object');
    }

    if (this.state === 'terminated') {
      throw new Error('Cannot execute task on terminated MicroAgent');
    }

    if (this.state === 'working') {
      throw new Error('MicroAgent is already working on a task');
    }

    this.state = 'working';
    this.task = task;
    this._resetIdleTimer();

    const startTime = Date.now();

    this.logger.info(`[MicroAgent:${this.id}] Executing task: ${task.type || 'unknown'}`);
    this.emit('task_started', { id: this.id, task });
    
    try {
      // Call the implemented execute method
      this.result = await this.execute(task);
      
      const executionTime = Date.now() - startTime;
      this.metrics.tasksCompleted++;
      this.metrics.totalExecutionTime += executionTime;
      this.metrics.avgExecutionTime = this.metrics.totalExecutionTime / this.metrics.tasksCompleted;
      
      this.logger.info(`[MicroAgent:${this.id}] Task completed in ${executionTime}ms`);
      this.emit('task_completed', { id: this.id, result: this.result, executionTime });
      
      this.state = 'completing';
      return { success: true, result: this.result };
      
    } catch (err) {
      this.error = err;
      this.metrics.tasksFailed++;
      
      this.logger.error(`[MicroAgent:${this.id}] Task failed: ${err.message}`);
      this.emit('task_failed', { id: this.id, error: err });
      
      // Retry logic
      if (this.retryCount < this.maxRetries && task.retryable !== false) {
        this.retryCount++;
        this.logger.info(`[MicroAgent:${this.id}] Retrying (${this.retryCount}/${this.maxRetries})`);
        this.state = 'idle';
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount)); // Exponential backoff
        return this.executeTask(task);
      }
      
      this.state = 'completing';
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Override this method in subclasses to implement task execution
   */
  async execute(task) {
    throw new Error('execute() must be implemented by subclass');
  }
  
  async terminate(reason = 'manual') {
    if (this.state === 'terminated') {
      return { success: false, reason: 'already_terminated' };
    }
    
    this.logger.info(`[MicroAgent:${this.id}] Terminating (reason: ${reason})`);
    
    this._clearTimers();
    
    this.state = 'terminated';
    this.terminatedAt = Date.now();
    this.completedAt = Date.now();
    
    const lifetime = this.terminatedAt - this.createdAt;
    
    this.emit('terminated', { 
      id: this.id, 
      reason, 
      lifetime,
      metrics: this.metrics 
    });
    
    // Clean up
    this.removeAllListeners();
    
    return { 
      success: true, 
      reason, 
      lifetime,
      metrics: this.metrics 
    };
  }
  
  getStatus() {
    const now = Date.now();
    const age = now - this.createdAt;
    const ttlRemaining = this.ttl - age;
    
    return {
      id: this.id,
      type: this.type,
      parentId: this.parentId,
      state: this.state,
      age,
      ttlRemaining: Math.max(0, ttlRemaining),
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      task: this.task ? {
        type: this.task.type,
        startedAt: this.task.startedAt
      } : null,
      metrics: this.metrics,
      retryCount: this.retryCount
    };
  }
  
  isAlive() {
    return this.state !== 'terminated';
  }
  
  isIdle() {
    return this.state === 'idle';
  }
  
  isWorking() {
    return this.state === 'working';
  }
}

module.exports = { BaseMicroAgent };
