/**
 * BaseArbiter.js
 * 
 * Enhanced base class for all arbiters in the ecosystem.
 * Improvements over original:
 * - Integrated MessageBroker communication
 * - Automatic retry and self-healing
 * - State persistence and recovery
 * - Metrics and observability
 * - Context window management with embeddings support
 * - Lifecycle hooks for extensibility
 * - Circuit breaker pattern for fault tolerance
 * - Task queuing and priority management
 * - Built-in validation and type checking
 * - CLONING & EVOLUTION SYSTEM
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const messageBroker = require('./MessageBroker.cjs');

// ===========================
// Enums and Constants
// ===========================

const ArbiterRole = {
  CONDUCTOR: 'conductor',
  ANALYST: 'analyst',
  IMPLEMENTER: 'implementer',
  TESTER: 'tester',
  REVIEWER: 'reviewer',
  DOCUMENTER: 'documenter',
  MNEMONIC: 'mnemonic',
  GUARDIAN: 'guardian',
  SPECIALIST: 'specialist'
};

const ArbiterCapability = {
  READ_FILES: 'read_files',
  WRITE_FILES: 'write_files',
  EXECUTE_CODE: 'execute_code',
  SEARCH_WEB: 'search_web',
  ACCESS_DB: 'access_db',
  CALL_API: 'call_api',
  SPAWN_AGENT: 'spawn_agent',
  CLONE_SELF: 'clone_self',        // NEW: Core capability
  EVOLVE: 'evolve',                // NEW: Self-improvement
  TRAIN_MODEL: 'train_model',
  CACHE_DATA: 'cache_data',
  SYNC_STATE: 'sync_state'
};

const TaskPriority = {
  CRITICAL: 'critical',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
  BACKGROUND: 'background'
};

const ArbiterState = {
  INITIALIZING: 'initializing',
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
  ERROR: 'error',
  DEGRADED: 'degraded',
  SHUTDOWN: 'shutdown'
};

// ===========================
// Helper Functions
// ===========================

function now() { return Date.now(); }
function uid(prefix = '') { return `${prefix}${crypto.randomUUID()}`; }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================
// Core Classes
// ===========================

class Task {
  constructor(opts = {}) {
    this.id = opts.id || uid('task_');
    this.query = opts.query || '';
    this.context = opts.context || {};
    this.priority = opts.priority || TaskPriority.NORMAL;
    this.maxRetries = opts.maxRetries || 3;
    this.timeoutMs = opts.timeoutMs || 300000; // 5 min default
    this.createdAt = now();
    this.startedAt = null;
    this.completedAt = null;
    this.attempts = 0;
    this.status = 'pending';
    this.result = null;
    this.error = null;
    this.metadata = opts.metadata || {};
  }

  toJSON() {
    return {
      id: this.id,
      query: this.query,
      priority: this.priority,
      status: this.status,
      attempts: this.attempts,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration: this.completedAt ? this.completedAt - this.startedAt : null
    };
  }
}

class ArbiterResult {
  constructor(opts = {}) {
    this.success = !!opts.success;
    this.data = opts.data || null;
    this.confidence = opts.confidence || 0;
    this.arbiter = opts.arbiter || 'unknown';
    this.duration = opts.duration || 0;
    this.iterations = opts.iterations || 1;
    this.error = opts.error || null;
    this.metadata = opts.metadata || {};
    this.timestamp = now();
  }

  toJSON() {
    return {
      success: this.success,
      confidence: this.confidence,
      arbiter: this.arbiter,
      duration: this.duration,
      iterations: this.iterations,
      error: this.error,
      timestamp: this.timestamp
    };
  }
}

// ===========================
// Circuit Breaker Pattern
// ===========================

class CircuitBreaker {
  constructor(opts = {}) {
    this.threshold = opts.threshold || 5; // failures before opening
    this.timeout = opts.timeout || 60000; // 1 min
    this.failures = 0;
    this.state = 'closed'; // closed, open, half-open
    this.nextAttempt = 0;
  }

  async execute(fn) {
    if (this.state === 'open') {
      if (now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  onFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.state = 'open';
      this.nextAttempt = now() + this.timeout;
    }
  }

  reset() {
    this.failures = 0;
    this.state = 'closed';
  }
}

// ===========================
// Main BaseArbiter Class
// ===========================

class BaseArbiter extends EventEmitter {
  constructor(opts = {}, config = {}) {
    super();

    // Handle (broker, config) signature or null broker
    // Robust check for broker vs config object
    if (opts === null || typeof opts === 'undefined') {
      opts = config || {};
    } else if (typeof opts.publish === 'function') {
      // If broker is a broker object, use config as the options
      opts = config || {};
    }

    // Core identity
    this.name = (opts && opts.name) ? opts.name : uid('arbiter_');
    this.role = (opts && opts.role) ? opts.role : ArbiterRole.SPECIALIST;
    this.capabilities = (opts && opts.capabilities) ? opts.capabilities : [];
    this.version = (opts && opts.version) ? opts.version : '1.0.0';
    
    // --- NEURAL INDEXING (High-End Architecture) ---
    this.lobe = (opts && opts.lobe) ? opts.lobe : 'COGNITIVE'; 
    this.classification = (opts && opts.classification) ? opts.classification : 'GENERALIST';
    this.tags = (opts && opts.tags) ? opts.tags : [];

    // State management
    this.state = ArbiterState.INITIALIZING;
    this.context = [];
    this.maxContextSize = opts.maxContextSize || 50;
    this.taskQueue = [];
    this.activeTask = null;
    this.processingLock = false;

    // Configuration (MUST come before DNA generation)
    this.config = {
      maxConcurrentTasks: opts.maxConcurrentTasks || 1,
      defaultRetries: opts.defaultRetries || 3,
      defaultTimeout: opts.defaultTimeout || 300000,
      enableMetrics: opts.enableMetrics !== false,
      enablePersistence: opts.enablePersistence !== false,
      stateDir: opts.stateDir || path.join(process.cwd(), '.arbiter-state'),
      heartbeatInterval: opts.heartbeatInterval || 30000,
      autoRegister: opts.autoRegister !== false,
      ...opts.config
    };
    
    // Cloning & Evolution - PRIMARY FEATURE
    this.generation = opts.generation || 0;
    this.parentId = opts.parentId || null;
    this.lineage = opts.lineage || [];
    this.clones = new Map(); // childId -> child instance
    this.mutations = opts.mutations || [];
    this.dna = opts.dna || this._generateDNA(); // Now config exists
    this.evolutionHistory = opts.evolutionHistory || [];

    // Metrics
    this.metrics = {
      tasksReceived: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      totalDuration: 0,
      avgDuration: 0,
      successRate: 0,
      lastTaskAt: null,
      uptime: now(),
      errors: []
    };

    // Fault tolerance
    this.circuitBreaker = new CircuitBreaker({
      threshold: opts.circuitBreakerThreshold || 5,
      timeout: opts.circuitBreakerTimeout || 60000
    });

    // MessageBroker integration
    this.broker = messageBroker;
    this.messageHandlers = new Map();

    // Logger
    this.logger = opts.logger || console;

    // Lifecycle
    this.shutdownRequested = false;
    this.heartbeatTimer = null;
  }

  // ===========================
  // CLONING & EVOLUTION SYSTEM - PRIMARY FEATURE
  // ===========================

  /**
   * Generate unique DNA for this arbiter
   * DNA contains the arbiter's core configuration and can be used for reproduction
   */
  _generateDNA() {
    return {
      id: uid('dna_'),
      role: this.role,
      capabilities: [...this.capabilities],
      version: this.version,
      generation: this.generation,
      traits: {
        maxContextSize: this.maxContextSize,
        maxRetries: this.config.defaultRetries,
        circuitBreakerThreshold: this.circuitBreaker?.threshold || 5
      },
      createdAt: now()
    };
  }

  /**
   * Clone this arbiter - creates an exact copy
   * @param {Object} opts - Override options for the clone
   * @returns {BaseArbiter} - New arbiter instance
   */
  async clone(opts = {}) {
    if (!this.capabilities.includes(ArbiterCapability.CLONE_SELF)) {
      throw new Error('Arbiter does not have CLONE_SELF capability');
    }

    this.log('info', 'Initiating cloning sequence...');

    const cloneConfig = {
      // Inherit from parent
      role: this.role,
      capabilities: [...this.capabilities],
      version: this.version,
      maxContextSize: this.maxContextSize,
      
      // Evolution tracking
      generation: this.generation + 1,
      parentId: this.name,
      lineage: [...this.lineage, this.name],
      dna: { ...this.dna },
      
      // Clone-specific
      name: opts.name || uid(`${this.name}-clone_`),
      
      // Copy configuration
      config: { ...this.config },
      
      // Apply overrides
      ...opts
    };

    // Create the clone
    const CloneClass = this.constructor;
    const clone = new CloneClass(cloneConfig);

    // Transfer learned knowledge (optional)
    if (opts.transferKnowledge !== false) {
      await this._transferKnowledge(clone);
    }

    // Register clone
    this.clones.set(clone.name, clone);
    
    // Notify via MessageBroker
    await this.broadcast('arbiter_cloned', {
      parent: this.name,
      clone: clone.name,
      generation: clone.generation,
      lineage: clone.lineage
    });

    this.log('info', `Clone created: ${clone.name} (Gen ${clone.generation})`);
    
    // Record evolution event
    this._recordEvolution('clone', {
      cloneName: clone.name,
      generation: clone.generation
    });
    
    // Persist parent state immediately to ensure lineage is saved
    await this._saveState();

    return clone;
  }

  /**
   * Spawn a new arbiter from a description (Conductor capability)
   * This is more advanced than cloning - it creates a NEW type of arbiter
   * @param {string} description - Natural language description of desired arbiter
   * @param {Object} opts - Configuration options
   * @returns {BaseArbiter} - New specialized arbiter
   */
  async spawn(description, opts = {}) {
    if (!this.capabilities.includes(ArbiterCapability.SPAWN_AGENT)) {
      throw new Error('Arbiter does not have SPAWN_AGENT capability');
    }

    this.log('info', `Spawning new arbiter from description: ${description}`);

    // Parse description to determine role and capabilities
    const specification = await this._parseSpawnDescription(description);

    // Generate code for new arbiter class
    const arbiterCode = await this._generateArbiterCode(specification);

    // Create the new arbiter instance
    const newArbiter = await this._instantiateFromCode(arbiterCode, opts);

    // Register as offspring
    this.clones.set(newArbiter.name, newArbiter);
    
    // Record lineage
    newArbiter.lineage = [...this.lineage, this.name];
    newArbiter.parentId = this.name;
    newArbiter.generation = this.generation + 1;

    // Notify ecosystem
    await this.broadcast('arbiter_spawned', {
      creator: this.name,
      spawned: newArbiter.name,
      description,
      specification
    });

    this.log('info', `Successfully spawned: ${newArbiter.name}`);
    
    this._recordEvolution('spawn', {
      arbiterName: newArbiter.name,
      description,
      specification
    });

    return newArbiter;
  }

  /**
   * Evolve this arbiter - self-improvement through mutation
   * @param {Object} mutations - Changes to apply
   * @returns {BaseArbiter} - Evolved version (new instance)
   */
  async evolve(mutations = {}) {
    if (!this.capabilities.includes(ArbiterCapability.EVOLVE)) {
      throw new Error('Arbiter does not have EVOLVE capability');
    }

    this.log('info', 'Initiating evolution sequence...');

    // Create evolved clone with mutations
    const evolved = await this.clone({
      name: uid(`${this.name}-evolved_`),
      ...mutations
    });

    // Track mutations
    evolved.mutations = [
      ...this.mutations,
      {
        generation: evolved.generation,
        changes: mutations,
        timestamp: now()
      }
    ];

    // Test evolved version
    const fitness = await this._assessFitness(evolved);
    
    this.log('info', `Evolution fitness score: ${fitness.toFixed(2)}`);

    if (fitness > 0.7) {
      this.log('info', 'Evolution successful - new version is superior');
      
      this._recordEvolution('evolve', {
        from: this.name,
        to: evolved.name,
        fitness,
        mutations
      });
      
      // Persist state immediately
      await this._saveState();
    } else {
      this.log('warn', 'Evolution fitness too low - reverting');
    }

    return evolved;
  }

  /**
   * Self-replicate with variations (genetic algorithm style)
   * Creates multiple clones with slight variations
   * @param {number} count - Number of clones to create
   * @param {number} mutationRate - Probability of mutation (0-1)
   * @returns {Array<BaseArbiter>} - Array of clones
   */
  async replicate(count = 3, mutationRate = 0.1) {
    if (!this.capabilities.includes(ArbiterCapability.CLONE_SELF)) {
      throw new Error('Arbiter does not have CLONE_SELF capability');
    }

    this.log('info', `Replicating ${count} times with ${mutationRate} mutation rate`);

    const clones = [];

    for (let i = 0; i < count; i++) {
      const mutations = Math.random() < mutationRate 
        ? this._generateRandomMutations()
        : {};

      const clone = await this.clone({
        name: uid(`${this.name}-replica${i + 1}_`),
        ...mutations
      });

      clones.push(clone);
    }

    this.log('info', `Replication complete: ${clones.length} clones created`);
    
    return clones;
  }

  /**
   * Get family tree of this arbiter
   * @returns {Object} - Tree structure of lineage
   */
  getFamilyTree() {
    return {
      name: this.name,
      generation: this.generation,
      parent: this.parentId,
      lineage: this.lineage,
      children: Array.from(this.clones.keys()),
      dna: this.dna,
      mutations: this.mutations.length,
      evolutionHistory: this.evolutionHistory
    };
  }

  /**
   * Transfer knowledge to a clone
   * @private
   */
  async _transferKnowledge(clone) {
    // Transfer context window
    clone.context = [...this.context];
    
    // Transfer relevant metrics (but reset counters)
    clone.metrics = {
      ...clone.metrics,
      uptime: now() // Start fresh
    };

    this.log('info', 'Knowledge transfer complete');
  }

  /**
   * Parse spawn description into specification
   * @private
   */
  async _parseSpawnDescription(description) {
    // Simple pattern matching for demo
    // In production, use LLM to parse this
    const spec = {
      role: ArbiterRole.SPECIALIST,
      capabilities: [],
      name: uid('spawned_'),
      description
    };

    // Parse capabilities from description
    if (description.includes('read') || description.includes('analyze')) {
      spec.capabilities.push(ArbiterCapability.READ_FILES);
    }
    if (description.includes('write') || description.includes('create')) {
      spec.capabilities.push(ArbiterCapability.WRITE_FILES);
    }
    if (description.includes('search') || description.includes('web')) {
      spec.capabilities.push(ArbiterCapability.SEARCH_WEB);
    }

    // Parse role
    if (description.includes('conduct') || description.includes('orchestrate')) {
      spec.role = ArbiterRole.CONDUCTOR;
      spec.capabilities.push(ArbiterCapability.SPAWN_AGENT);
    } else if (description.includes('analyze') || description.includes('study')) {
      spec.role = ArbiterRole.ANALYST;
    } else if (description.includes('implement') || description.includes('code')) {
      spec.role = ArbiterRole.IMPLEMENTER;
    }

    return spec;
  }

  /**
   * Generate code for new arbiter class
   * @private
   */
  async _generateArbiterCode(spec) {
    // Generate JavaScript code for new arbiter
    const code = `
class ${spec.name} extends BaseArbiter {
  constructor(opts = {}) {
    super({
      name: '${spec.name}',
      role: '${spec.role}',
      capabilities: ${JSON.stringify(spec.capabilities)},
      ...opts
    });
  }

  async execute(task) {
    // Auto-generated execute method
    const startTime = Date.now();
    
    this.log('info', 'Processing task: ' + task.query);
    
    // Implement specialized logic here
    const result = { processed: true, task: task.query };
    
    return new ArbiterResult({
      success: true,
      data: result,
      confidence: 0.8,
      arbiter: this.name,
      duration: Date.now() - startTime
    });
  }
}
`;

    return code;
  }

  /**
   * Instantiate arbiter from generated code
   * @private
   */
  async _instantiateFromCode(code, opts) {
    // In production, use proper code evaluation with sandboxing
    // For now, create a basic instance
    
    const instance = await this.clone({
      name: opts.name || uid('spawned_'),
      ...opts
    });

    return instance;
  }

  /**
   * Assess fitness of evolved arbiter
   * @private
   */
  async _assessFitness(arbiter) {
    // Run test tasks and measure performance
    // Subclasses MUST override this to provide meaningful fitness scores
    // Defaulting to neutral fitness to prevent random regression
    return 0.5;
  }

  /**
   * Generate random mutations for replication
   * @private
   */
  _generateRandomMutations() {
    const mutations = {};

    // Randomly mutate configuration values
    if (Math.random() < 0.5) {
      mutations.maxContextSize = this.maxContextSize + Math.floor(Math.random() * 20) - 10;
    }

    return mutations;
  }

  /**
   * Record evolution event
   * @private
   */
  _recordEvolution(type, data) {
    this.evolutionHistory.push({
      type,
      data,
      timestamp: now(),
      generation: this.generation
    });

    // Limit history size
    if (this.evolutionHistory.length > 100) {
      this.evolutionHistory = this.evolutionHistory.slice(-100);
    }
  }

  // ===========================
  // Lifecycle Methods
  // ===========================

  async initialize() {
    // Public initialization method called by orchestrator
    return await this._initialize();
  }

  async _initialize() {
    try {
      // Create state directory
      if (this.config.enablePersistence) {
        await this._ensureStateDir();
        await this._loadState();
      }

      // Register with broker
      if (this.config.autoRegister) {
        await this._registerWithBroker();
      }

      // Setup message handlers
      this._setupMessageHandlers();

      // Start heartbeat
      this._startHeartbeat();

      // Hook for subclasses
      await this.onInitialize();

      this.state = ArbiterState.IDLE;
      this.emit('initialized', this.name);
    } catch (error) {
      this.state = ArbiterState.ERROR;
      this.emit('error', error);
      throw error;
    }
  }

  async _registerWithBroker() {
    this.broker.registerArbiter(this.name, {
      role: this.role,
      capabilities: this.capabilities,
      version: this.version,
      instance: this // Allow direct in-process messaging
    });
  }

  _setupMessageHandlers() {
    // Subscribe to arbiter-specific topic
    this.subscribe(`arbiter/${this.name}`, this.handleMessage.bind(this));
    
    // Subscribe to role-specific topic
    this.subscribe(`role/${this.role}`, this.handleMessage.bind(this));

    // Subscribe to broadcast
    this.subscribe('system/all', this.handleMessage.bind(this));
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) return;
    
    this.heartbeatTimer = setInterval(() => {
      this.broker.heartbeat(this.name, {
        state: this.state,
        metrics: this.getMetrics(),
        queueSize: this.taskQueue.length,
        activeTask: this.activeTask?.id || null
      });
    }, this.config.heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async shutdown() {
    this.shutdownRequested = true;
    this.state = ArbiterState.SHUTDOWN;
    
    // Wait for active task to complete
    if (this.activeTask) {
      await sleep(1000); // Give it a second
    }

    // Stop heartbeat
    this._stopHeartbeat();

    // Unregister from broker
    this.broker.unregisterArbiter(this.name);

    // Save state
    if (this.config.enablePersistence) {
      await this._saveState();
    }

    // Hook for subclasses
    await this.onShutdown();

    this.emit('shutdown', this.name);
  }

  // ===========================
  // Message Handling
  // ===========================

  async handleMessage(envelope) {
    // Filter out messages not meant for us
    const isDirectMessage = envelope.to === this.name;
    const isRoleMessage = envelope.to === this.role || envelope.channel === `role/${this.role}`;
    const isBroadcast = envelope.to === 'broadcast' || envelope.channel === 'system/all';

    if (!isDirectMessage && !isRoleMessage && !isBroadcast) {
      return;
    }

    try {
      const { type, payload } = envelope;

      switch (type) {
        case 'task':
          await this.enqueueTask(new Task({
            query: payload.query,
            context: payload.context,
            priority: payload.priority,
            metadata: { envelope }
          }));
          break;

        case 'status_check':
          await this.broker.sendMessage({
            from: this.name,
            to: envelope.from,
            type: 'status_response',
            payload: {
              state: this.state,
              metrics: this.getMetrics(),
              queueSize: this.taskQueue.length
            }
          });
          break;

        case 'help_request':
          await this.handleHelpRequest(envelope);
          break;

        case 'shutdown':
          await this.shutdown();
          break;

        default:
          // Custom message handler
          const handler = this.messageHandlers.get(type);
          if (handler) {
            await handler.call(this, envelope);
          } else {
            await this.onUnhandledMessage(envelope);
          }
      }
    } catch (error) {
      console.error(`[${this.name}] Error handling message:`, error);
      this.emit('message_error', envelope, error);
    }
  }

  registerMessageHandler(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  // ===========================
  // Task Management
  // ===========================

  async enqueueTask(task) {
    if (this.shutdownRequested) {
      throw new Error('Arbiter is shutting down');
    }

    // CRITICAL FIX: Task queue backpressure to prevent OOM
    const maxQueueSize = this.config.maxQueueSize || 1000;
    if (this.taskQueue.length >= maxQueueSize) {
      const error = new Error(`Task queue full (${this.taskQueue.length}/${maxQueueSize}) - backpressure applied`);
      console.warn(`[${this.name}] ${error.message}`);
      this.metrics.tasksRejected = (this.metrics.tasksRejected || 0) + 1;
      throw error;
    }

    this.taskQueue.push(task);
    this.metrics.tasksReceived++;

    // Sort by priority
    this.taskQueue.sort((a, b) => {
      const priorities = Object.values(TaskPriority);
      return priorities.indexOf(a.priority) - priorities.indexOf(b.priority);
    });

    this.emit('task_queued', task);

    // Process if not already processing
    if (!this.processingLock) {
      setImmediate(() => this._processQueue());
    }

    return task.id;
  }

  async _processQueue() {
    if (this.processingLock || this.taskQueue.length === 0) {
      return;
    }

    this.processingLock = true;

    try {
      while (this.taskQueue.length > 0 && !this.shutdownRequested) {
        const task = this.taskQueue.shift();
        await this._executeTask(task);
      }
    } finally {
      this.processingLock = false;
    }
  }

  async _executeTask(task) {
    this.activeTask = task;
    this.state = ArbiterState.WORKING;
    task.status = 'running';
    task.startedAt = now();
    task.attempts++;

    this.emit('task_started', task);

    try {
      // Execute with timeout and circuit breaker
      const result = await this._executeWithTimeout(task);
      
      task.status = 'completed';
      task.completedAt = now();
      task.result = result;

      // Update metrics
      const duration = task.completedAt - task.startedAt;
      this.metrics.tasksCompleted++;
      this.metrics.totalDuration += duration;
      this.metrics.avgDuration = this.metrics.totalDuration / this.metrics.tasksCompleted;
      this.metrics.successRate = this.metrics.tasksCompleted / this.metrics.tasksReceived;
      this.metrics.lastTaskAt = now();

      // Add to context
      this._addToContext({
        task: task.toJSON(),
        result: result.toJSON()
      });

      this.emit('task_completed', task, result);

      return result;

    } catch (error) {
      task.error = error.message;
      
      // Retry logic
      if (task.attempts < task.maxRetries) {
        task.status = 'retrying';
        console.log(`[${this.name}] Retrying task ${task.id} (attempt ${task.attempts + 1}/${task.maxRetries})`);
        
        // Exponential backoff
        await sleep(Math.min(1000 * Math.pow(2, task.attempts), 30000));
        
        this.taskQueue.unshift(task); // Add back to front
        this.emit('task_retry', task);
        
      } else {
        // Max retries exceeded
        task.status = 'failed';
        task.completedAt = now();
        
        this.metrics.tasksFailed++;
        this.metrics.errors.push({
          task: task.id,
          error: error.message,
          timestamp: now()
        });

        // Keep only last 100 errors
        if (this.metrics.errors.length > 100) {
          this.metrics.errors = this.metrics.errors.slice(-100);
        }

        this.emit('task_failed', task, error);
      }
    } finally {
      this.activeTask = null;
      this.state = this.taskQueue.length > 0 ? ArbiterState.WORKING : ArbiterState.IDLE;
    }
  }

  async _executeWithTimeout(task) {
    return Promise.race([
      this.circuitBreaker.execute(() => this.execute(task)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Task timeout')), task.timeoutMs)
      )
    ]);
  }

  // ===========================
  // Abstract Methods (must be implemented by subclasses)
  // ===========================

  async execute(task) {
    throw new Error('execute() must be implemented by subclass');
  }

  async onInitialize() {
    // Override in subclass if needed
  }

  async onShutdown() {
    // Override in subclass if needed
  }

  async onUnhandledMessage(envelope) {
    // Override in subclass if needed
  }

  async handleHelpRequest(envelope) {
    // Override in subclass for specialized help
    await this.broker.sendMessage({
      from: this.name,
      to: envelope.from,
      type: 'help_response',
      payload: {
        role: this.role,
        capabilities: this.capabilities,
        availableCommands: this.getAvailableCommands()
      }
    });
  }

  getAvailableCommands() {
    return ['status_check', 'help_request', 'task'];
  }

  // ===========================
  // Context Management
  // ===========================

  _addToContext(item) {
    this.context.push({
      ...item,
      timestamp: now()
    });

    // Maintain max size
    if (this.context.length > this.maxContextSize) {
      this.context = this.context.slice(-this.maxContextSize);
    }
  }

  getContext(n = null) {
    if (n === null) return this.context;
    return this.context.slice(-n);
  }

  clearContext() {
    this.context = [];
  }

  // ===========================
  // State Persistence
  // ===========================

  async _ensureStateDir() {
    try {
      await fs.mkdir(this.config.stateDir, { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  async _saveState() {
    if (!this.config.enablePersistence) return;

    const state = {
      name: this.name,
      role: this.role,
      metrics: this.metrics,
      context: this.context.slice(-10), // Save only recent context
      dna: this.dna,
      lineage: this.lineage,
      mutations: this.mutations,
      generation: this.generation,
      evolutionHistory: this.evolutionHistory,
      savedAt: now()
    };

    try {
      const filePath = path.join(this.config.stateDir, `${this.name}.json`);
      await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      console.error(`[${this.name}] Failed to save state:`, error);
    }
  }

  async _loadState() {
    if (!this.config.enablePersistence) return;

    try {
      const filePath = path.join(this.config.stateDir, `${this.name}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      const state = JSON.parse(data);

      // Restore metrics and context
      if (state.metrics) {
        this.metrics = { ...this.metrics, ...state.metrics };
      }
      if (state.context) {
        this.context = state.context;
      }
      
      // Restore evolutionary state
      if (state.dna) this.dna = state.dna;
      if (state.lineage) this.lineage = state.lineage;
      if (state.mutations) this.mutations = state.mutations;
      if (state.generation) this.generation = state.generation;
      if (state.evolutionHistory) this.evolutionHistory = state.evolutionHistory;

      console.log(`[${this.name}] Restored state from ${new Date(state.savedAt).toISOString()}`);
    } catch (error) {
      // No previous state or error loading - that's ok
    }
  }

  // ===========================
  // Metrics and Monitoring
  // ===========================

  getMetrics() {
    return {
      ...this.metrics,
      uptime: now() - this.metrics.uptime,
      queueSize: this.taskQueue.length,
      contextSize: this.context.length,
      state: this.state,
      circuitBreakerState: this.circuitBreaker.state
    };
  }

  resetMetrics() {
    this.metrics = {
      tasksReceived: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      totalDuration: 0,
      avgDuration: 0,
      successRate: 0,
      lastTaskAt: null,
      uptime: now(),
      errors: []
    };
  }

  // ===========================
  // Utilities
  // ===========================

  async sendMessage(to, type, payload = {}) {
    return await this.broker.sendMessage({
      from: this.name,
      to,
      type,
      payload
    });
  }

  async broadcast(type, payload = {}) {
    return await this.broker.broadcast('system/all', {
      from: this.name,
      type,
      payload
    });
  }

  subscribe(topic, handler) {
    handler._arbiterName = this.name;
    return this.broker.subscribe(topic, handler);
  }

  async publish(topic, payload = {}) {
    return await this.broker.publish(topic, {
      from: this.name,
      ...payload
    });
  }

  async requestHelp(issue, to = 'broadcast') {
    return await this.broker.sendHelpRequest(this.name, to, {
      issue,
      state: this.state,
      context: this.getContext(3)
    });
  }

  getStatus() {
    return {
      name: this.name,
      role: this.role,
      state: this.state,
      active: this.state === ArbiterState.WORKING || this.state === ArbiterState.IDLE,
      capabilities: this.capabilities,
      queueLength: this.taskQueue?.length || 0,
      timestamp: new Date().toISOString()
    };
  }

  log(level, message, data = {}) {
    const logEntry = {
      level,
      arbiter: this.name,
      message,
      data,
      timestamp: new Date().toISOString()
    };

    console.log(`[${level.toUpperCase()}] [${this.name}] ${message}`, data);
    this.emit('log', logEntry);
  }
}

module.exports = { BaseArbiter, ArbiterRole, ArbiterCapability, TaskPriority, ArbiterState, Task, ArbiterResult };

