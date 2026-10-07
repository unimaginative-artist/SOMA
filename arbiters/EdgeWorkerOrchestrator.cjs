// ═══════════════════════════════════════════════════════════
// FILE: arbiters/EdgeWorkerOrchestrator.cjs
// Coordinates distributed learning across edge workers/dendrites
// Integrates with Impulsers for knowledge processing
// Target: Enable autonomous night learning across distributed nodes
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const { fork } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { WebCrawlerWorker } = require('../workers/WebCrawlerWorker.cjs');

class EdgeWorkerOrchestrator extends BaseArbiter {
  static role = 'edge-orchestration';
  static capabilities = ['deploy-workers', 'aggregate-learnings', 'coordinate-distributed', 'night-learning'];

  constructor(config = {}) {
    super(config);

    // Worker management
    this.workers = new Map();  // workerId -> worker metadata
    this.maxWorkers = config.maxWorkers || Math.max(2, os.cpus().length - 2);  // Leave 2 cores for SOMA
    this.workerPool = [];
    this.activeWorkers = 0;

    // Learning task queue
    this.learningQueue = [];
    this.maxQueueSize = config.maxQueueSize || 1000;
    this.distributedLearningActive = false;

    // Integration points
    this.impulserConnected = false;
    this.velocityTrackerConnected = false;
    this.timekeeperConnected = false;

    // Learning metrics
    this.metrics = {
      tasksDeployed: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      workersSpawned: 0,
      workersTerminated: 0,
      learningsAggregated: 0,
      totalKnowledgeBytes: 0,
      avgTaskDuration: 0
    };

    // Night learning schedule
    this.nightLearningEnabled = config.nightLearningEnabled !== false;
    this.nightLearningInterval = null;

    // Fault tolerance
    this.workerRetryLimit = config.workerRetryLimit || 3;
    this.workerRetries = new Map();

    // Performance tracking
    this.taskTimes = [];
    this.maxTaskTimeHistory = 1000;

    // Web crawling configuration
    this.crawlTargets = this.loadCrawlTargets();
    this.webCrawlingEnabled = config.webCrawlingEnabled !== false;

    this.logger.info(`[${this.name}] 🌐 EdgeWorkerOrchestrator initializing...`);
    this.logger.info(`[${this.name}] 🎯 Max workers: ${this.maxWorkers}`);
    this.logger.info(`[${this.name}] 🕸️  Web crawling: ${this.webCrawlingEnabled ? 'ENABLED' : 'DISABLED'}`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    // Connect to integration points
    await this.connectToImpulser();
    await this.connectToVelocityTracker();
    await this.connectToTimekeeper();

    // Start worker pool
    await this.initializeWorkerPool();

    // Start night learning if enabled
    if (this.nightLearningEnabled) {
      this.enableNightLearning();
    }

    this.logger.info(`[${this.name}] ✅ Edge orchestration active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: EdgeWorkerOrchestrator.role,
        capabilities: EdgeWorkerOrchestrator.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  loadCrawlTargets() {
    try {
      const configPath = path.join(__dirname, '../config/crawl-targets.json');

      if (!fs.existsSync(configPath)) {
        this.logger.warn(`[${this.name}] Crawl targets config not found: ${configPath}`);
        return { targets: [] };
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      this.logger.info(`[${this.name}] Loaded ${config.targets.length} crawl targets`);

      return config;
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to load crawl targets: ${err.message}`);
      return { targets: [] };
    }
  }

  _subscribeBrokerMessages() {
    messageBroker.subscribe(this.name, 'deploy_learning_task');
    messageBroker.subscribe(this.name, 'worker_result');
    messageBroker.subscribe(this.name, 'start_night_learning');
    messageBroker.subscribe(this.name, 'stop_night_learning');
    messageBroker.subscribe(this.name, 'worker_status');
    messageBroker.subscribe(this.name, 'aggregate_learnings');
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload } = message;

      switch (type) {
        case 'deploy_learning_task':
          return await this.deployLearningTask(payload);

        case 'worker_result':
          return await this.handleWorkerResult(payload);

        case 'start_night_learning':
          return await this.startNightLearning(payload);

        case 'stop_night_learning':
          return await this.stopNightLearning();

        case 'worker_status':
          return this.getWorkerStatus();

        case 'aggregate_learnings':
          return await this.aggregateLearnings(payload);

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INTEGRATION ░░
  // ═══════════════════════════════════════════════════════════

  async connectToImpulser() {
    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'UniversalImpulser',
        type: 'status_check',
        payload: {}
      });

      this.impulserConnected = true;
      this.logger.info(`[${this.name}] Connected to Impulser (knowledge processing)`);
    } catch (err) {
      this.logger.warn(`[${this.name}] Impulser unavailable: ${err.message}`);
    }
  }

  async connectToVelocityTracker() {
    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'LearningVelocityTracker',
        type: 'velocity_query',
        payload: {}
      });

      this.velocityTrackerConnected = true;
      this.logger.info(`[${this.name}] Connected to LearningVelocityTracker`);
    } catch (err) {
      this.logger.warn(`[${this.name}] VelocityTracker unavailable: ${err.message}`);
    }
  }

  async connectToTimekeeper() {
    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'TimekeeperArbiter',
        type: 'register_rhythm',
        payload: {
          rhythm: 'nightLearningCycle',
          pattern: '0 1 * * *',  // 1 AM daily
          callback: this.name,
          action: 'start_night_learning'
        }
      });

      this.timekeeperConnected = true;
      this.logger.info(`[${this.name}] Registered with Timekeeper (night learning)`);
    } catch (err) {
      this.logger.warn(`[${this.name}] Timekeeper unavailable: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ WORKER POOL MANAGEMENT ░░
  // ═══════════════════════════════════════════════════════════

  async initializeWorkerPool() {
    this.logger.info(`[${this.name}] Initializing worker pool (${this.maxWorkers} workers)...`);

    // Start with 2 workers, scale up on demand
    const initialWorkers = Math.min(2, this.maxWorkers);

    for (let i = 0; i < initialWorkers; i++) {
      await this.spawnWorker();
    }

    this.logger.info(`[${this.name}] Worker pool initialized: ${this.workers.size}/${this.maxWorkers} workers`);
  }

  async spawnWorker(taskType = 'generic') {
    if (this.workers.size >= this.maxWorkers) {
      this.logger.warn(`[${this.name}] Cannot spawn worker: max limit reached (${this.maxWorkers})`);
      return null;
    }

    const workerId = `worker_${crypto.randomBytes(4).toString('hex')}`;

    try {
      // In production, would fork actual worker process
      // For now, simulate worker with metadata
      const worker = {
        id: workerId,
        type: taskType,
        status: 'idle',
        tasksCompleted: 0,
        tasksFailed: 0,
        spawnedAt: Date.now(),
        lastActive: Date.now(),
        currentTask: null
      };

      this.workers.set(workerId, worker);
      this.metrics.workersSpawned++;
      this.activeWorkers++;

      this.logger.info(`[${this.name}] Spawned worker: ${workerId} (type: ${taskType})`);

      return workerId;
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to spawn worker: ${err.message}`);
      return null;
    }
  }

  async terminateWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return { success: false, error: 'Worker not found' };
    }

    this.logger.info(`[${this.name}] Terminating worker: ${workerId}`);

    // In production, would kill actual process
    this.workers.delete(workerId);
    this.metrics.workersTerminated++;
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);

    return { success: true, workerId };
  }

  async scaleWorkers(targetCount) {
    const current = this.workers.size;
    const target = Math.min(targetCount, this.maxWorkers);

    if (target > current) {
      // Scale up
      const toSpawn = target - current;
      this.logger.info(`[${this.name}] Scaling up: spawning ${toSpawn} workers`);

      for (let i = 0; i < toSpawn; i++) {
        await this.spawnWorker();
      }
    } else if (target < current) {
      // Scale down
      const toTerminate = current - target;
      this.logger.info(`[${this.name}] Scaling down: terminating ${toTerminate} workers`);

      const idleWorkers = Array.from(this.workers.values())
        .filter(w => w.status === 'idle')
        .map(w => w.id);

      for (let i = 0; i < Math.min(toTerminate, idleWorkers.length); i++) {
        await this.terminateWorker(idleWorkers[i]);
      }
    }

    return { success: true, current: this.workers.size, target };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ LEARNING TASK DEPLOYMENT ░░
  // ═══════════════════════════════════════════════════════════

  async deployLearningTask(taskData) {
    if (this.learningQueue.length >= this.maxQueueSize) {
      this.logger.warn(`[${this.name}] Learning queue full (${this.maxQueueSize})`);
      return { success: false, error: 'queue_full' };
    }

    const taskId = crypto.randomUUID();
    const task = {
      id: taskId,
      type: taskData.type || 'learning',
      data: taskData.data || taskData,
      priority: taskData.priority || 'normal',
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: taskData.maxAttempts || 3
    };

    this.learningQueue.push(task);
    this.metrics.tasksDeployed++;

    this.logger.info(`[${this.name}] Queued learning task: ${taskId} (type: ${task.type})`);

    // Try to assign immediately
    await this.assignTasksToWorkers();

    return { success: true, taskId };
  }

  async assignTasksToWorkers() {
    if (this.learningQueue.length === 0) {
      return { success: true, assigned: 0 };
    }

    let assigned = 0;

    // Find idle workers
    const idleWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'idle');

    // If no idle workers and below max, spawn more
    if (idleWorkers.length === 0 && this.workers.size < this.maxWorkers) {
      await this.spawnWorker();
      return this.assignTasksToWorkers();  // Retry after spawning
    }

    // Assign tasks to idle workers
    for (const worker of idleWorkers) {
      if (this.learningQueue.length === 0) break;

      const task = this.learningQueue.shift();
      task.attempts++;
      task.assignedTo = worker.id;
      task.startedAt = Date.now();

      worker.status = 'working';
      worker.currentTask = task.id;
      worker.lastActive = Date.now();

      this.logger.info(`[${this.name}] Assigned task ${task.id} to worker ${worker.id}`);

      // Execute real or simulated work
      this.executeRealWorkerTask(worker, task);

      assigned++;
    }

    return { success: true, assigned };
  }

  async executeRealWorkerTask(worker, task) {
    const startTime = Date.now();

    try {
      // If web crawling is enabled and task has crawl data, use WebCrawlerWorker
      if (this.webCrawlingEnabled && task.data && task.data.crawlTarget) {
        const crawlData = task.data.crawlTarget;

        this.logger.info(`[${this.name}] Worker ${worker.id} starting web crawl: ${crawlData.name}`);

        // Create WebCrawlerWorker instance
        const crawler = new WebCrawlerWorker({
          workerId: worker.id,
          maxPages: crawlData.maxPages || 10,
          maxDepth: this.crawlTargets.crawlLimits?.maxDepth || 2,
          timeout: this.crawlTargets.crawlLimits?.timeout || 10000,
          requestDelay: this.crawlTargets.crawlLimits?.requestDelay || 1000
        });

        // Execute crawl based on target type
        const taskData = {
          target: crawlData.type,
          query: this.selectQueryForTarget(crawlData),
          maxPages: crawlData.maxPages || 10
        };

        const crawlResult = await crawler.crawl(taskData);
        const duration = Date.now() - startTime;

        if (crawlResult.success) {
          // Convert crawled data to learnings format
          const learnings = {
            type: `web_crawl_${crawlData.type}`,
            knowledge: JSON.stringify(crawlResult.data),
            size: JSON.stringify(crawlResult.data).length,
            patterns: crawlResult.itemsCollected,
            insights: crawlResult.itemsCollected,
            source: crawlData.name,
            crawledItems: crawlResult.data
          };

          const result = {
            taskId: task.id,
            workerId: worker.id,
            learnings,
            duration,
            completedAt: Date.now()
          };

          await this.handleWorkerResult(result);
        } else {
          await this.handleWorkerFailure(worker, task, crawlResult.error || 'crawl_failed');
        }
      } else {
        // Fallback to simulated task for non-crawl tasks
        this.simulateWorkerTask(worker, task);
      }
    } catch (err) {
      this.logger.error(`[${this.name}] Worker ${worker.id} task failed: ${err.message}`);
      await this.handleWorkerFailure(worker, task, err.message);
    }
  }

  selectQueryForTarget(crawlTarget) {
    // Select a query/path/tag based on target type
    if (crawlTarget.queries && crawlTarget.queries.length > 0) {
      // For Stack Overflow - rotate through queries
      const index = Math.floor(Math.random() * crawlTarget.queries.length);
      return crawlTarget.queries[index];
    } else if (crawlTarget.tags && crawlTarget.tags.length > 0) {
      // For Dev.to - rotate through tags
      const index = Math.floor(Math.random() * crawlTarget.tags.length);
      return crawlTarget.tags[index];
    } else if (crawlTarget.paths && crawlTarget.paths.length > 0) {
      // For MDN - rotate through paths
      const index = Math.floor(Math.random() * crawlTarget.paths.length);
      return crawlTarget.paths[index];
    } else if (crawlTarget.topics && crawlTarget.topics.length > 0) {
      // For GitHub/Documentation - rotate through topics
      const index = Math.floor(Math.random() * crawlTarget.topics.length);
      return crawlTarget.topics[index];
    }
    return 'general';
  }

  async simulateWorkerTask(worker, task) {
    // Simulate learning work (fallback for non-crawl tasks)
    const duration = 1000 + Math.random() * 3000;  // 1-4 seconds

    setTimeout(async () => {
      // Simulate success/failure
      const success = Math.random() > 0.1;  // 90% success rate

      if (success) {
        const result = {
          taskId: task.id,
          workerId: worker.id,
          learnings: {
            type: task.type,
            knowledge: `Learned from task ${task.id}`,
            size: Math.floor(10240 + Math.random() * 100000),  // 10KB - 100KB
            patterns: Math.floor(Math.random() * 10),
            insights: Math.floor(Math.random() * 5)
          },
          duration,
          completedAt: Date.now()
        };

        await this.handleWorkerResult(result);
      } else {
        await this.handleWorkerFailure(worker, task, 'simulated_failure');
      }
    }, duration);
  }

  async handleWorkerResult(result) {
    const worker = this.workers.get(result.workerId);
    if (!worker) {
      this.logger.warn(`[${this.name}] Result from unknown worker: ${result.workerId}`);
      return { success: false, error: 'unknown_worker' };
    }

    worker.status = 'idle';
    worker.currentTask = null;
    worker.tasksCompleted++;
    worker.lastActive = Date.now();

    this.metrics.tasksCompleted++;
    this.metrics.learningsAggregated++;
    this.metrics.totalKnowledgeBytes += result.learnings.size || 0;

    // Track task duration
    this.taskTimes.push(result.duration);
    if (this.taskTimes.length > this.maxTaskTimeHistory) {
      this.taskTimes.shift();
    }
    this.metrics.avgTaskDuration = this.taskTimes.reduce((sum, t) => sum + t, 0) / this.taskTimes.length;

    this.logger.info(`[${this.name}] Worker ${result.workerId} completed task ${result.taskId} (${result.duration}ms)`);

    // Process learnings through Impulser
    if (this.impulserConnected) {
      await this.processLearningsThroughImpulser(result.learnings);
    }

    // Report to LearningVelocityTracker
    if (this.velocityTrackerConnected) {
      await this.reportToVelocityTracker(result.learnings);
    }

    // Assign next task
    await this.assignTasksToWorkers();

    return { success: true };
  }

  async handleWorkerFailure(worker, task, reason) {
    worker.status = 'idle';
    worker.currentTask = null;
    worker.tasksFailed++;
    this.metrics.tasksFailed++;

    this.logger.warn(`[${this.name}] Worker ${worker.id} failed task ${task.id}: ${reason}`);

    // Retry logic
    if (task.attempts < task.maxAttempts) {
      this.logger.info(`[${this.name}] Retrying task ${task.id} (attempt ${task.attempts + 1}/${task.maxAttempts})`);
      this.learningQueue.unshift(task);  // Priority retry
    } else {
      this.logger.error(`[${this.name}] Task ${task.id} exhausted retries, dropping`);
    }

    // If worker is consistently failing, replace it
    const failureRate = worker.tasksFailed / (worker.tasksCompleted + worker.tasksFailed);
    if (failureRate > 0.5 && (worker.tasksCompleted + worker.tasksFailed) > 5) {
      this.logger.warn(`[${this.name}] Worker ${worker.id} has high failure rate, replacing`);
      await this.terminateWorker(worker.id);
      await this.spawnWorker();
    }

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ IMPULSER INTEGRATION ░░
  // ═══════════════════════════════════════════════════════════

  async processLearningsThroughImpulser(learnings) {
    try {
      // Send to Impulser for processing
      await messageBroker.sendMessage({
        from: this.name,
        to: 'UniversalImpulser',
        type: 'categorize',
        payload: {
          article: {
            title: `Learning: ${learnings.type}`,
            content: learnings.knowledge,
            metadata: {
              patterns: learnings.patterns,
              insights: learnings.insights,
              size: learnings.size
            }
          }
        }
      });

      // Deduplicate
      await messageBroker.sendMessage({
        from: this.name,
        to: 'UniversalImpulser',
        type: 'dedupe',
        payload: {
          items: [learnings]
        }
      });

      this.logger.info(`[${this.name}] Learnings processed through Impulser`);
    } catch (err) {
      this.logger.error(`[${this.name}] Impulser processing failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ VELOCITY TRACKER INTEGRATION ░░
  // ═══════════════════════════════════════════════════════════

  async reportToVelocityTracker(learnings) {
    try {
      // Report knowledge acquisition
      await messageBroker.sendMessage({
        from: this.name,
        to: 'LearningVelocityTracker',
        type: 'knowledge_acquired',
        payload: {
          type: learnings.type,
          size: learnings.size,
          patterns: learnings.patterns,
          source: 'edge_worker'
        }
      });

      // Report learning event
      await messageBroker.sendMessage({
        from: this.name,
        to: 'LearningVelocityTracker',
        type: 'learning_event',
        payload: {
          type: 'distributed_learning',
          complexity: 1.0 + (learnings.patterns / 10),  // Higher pattern count = higher complexity
          source: 'edge_worker'
        }
      });

      this.logger.info(`[${this.name}] Reported learnings to VelocityTracker`);
    } catch (err) {
      this.logger.error(`[${this.name}] VelocityTracker report failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ NIGHT LEARNING ░░
  // ═══════════════════════════════════════════════════════════

  enableNightLearning() {
    this.logger.info(`[${this.name}] Night learning enabled`);
    // Will be triggered by Timekeeper at 1 AM
  }

  async startNightLearning(options = {}) {
    if (this.distributedLearningActive) {
      this.logger.warn(`[${this.name}] Night learning already active`);
      return { success: false, error: 'already_active' };
    }

    this.distributedLearningActive = true;
    this.logger.info(`[${this.name}] 🌙 Starting night learning cycle...`);

    // Scale up workers for night learning
    await this.scaleWorkers(this.maxWorkers);

    let taskCount = 0;

    // Deploy real web crawling tasks if enabled
    if (this.webCrawlingEnabled && this.crawlTargets.targets && this.crawlTargets.targets.length > 0) {
      const enabledTargets = this.crawlTargets.targets.filter(t => t.enabled !== false);

      this.logger.info(`[${this.name}] 🕸️  Deploying ${enabledTargets.length} web crawl tasks...`);

      for (const target of enabledTargets) {
        // Create task for each enabled crawl target
        await this.deployLearningTask({
          type: 'web_crawl',
          data: {
            crawlTarget: target,
            source: 'night_learning_crawl'
          },
          priority: target.priority || 'normal'
        });
        taskCount++;
      }

      this.logger.info(`[${this.name}] 🕸️  Deployed ${taskCount} web crawl tasks`);
    } else {
      // Fallback to simulated learning tasks
      const simulatedTaskCount = options.taskCount || 100;
      const learningTopics = [
        'pattern_recognition',
        'code_optimization',
        'system_architecture',
        'distributed_algorithms',
        'neural_networks',
        'data_structures'
      ];

      this.logger.info(`[${this.name}] 🧪 Web crawling disabled, deploying ${simulatedTaskCount} simulated tasks...`);

      for (let i = 0; i < simulatedTaskCount; i++) {
        const topic = learningTopics[Math.floor(Math.random() * learningTopics.length)];
        await this.deployLearningTask({
          type: topic,
          data: {
            topic,
            depth: 'deep',
            source: 'night_learning_simulated'
          },
          priority: 'normal'
        });
        taskCount++;
      }
    }

    this.logger.info(`[${this.name}] Deployed ${taskCount} night learning tasks across ${this.workers.size} workers`);

    return { success: true, taskCount, workers: this.workers.size, webCrawling: this.webCrawlingEnabled };
  }

  async stopNightLearning() {
    this.distributedLearningActive = false;
    this.logger.info(`[${this.name}] Stopping night learning cycle...`);

    // Scale down to baseline workers
    await this.scaleWorkers(2);

    // Aggregate remaining learnings
    await this.aggregateLearnings();

    this.logger.info(`[${this.name}] Night learning cycle complete`);

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ LEARNING AGGREGATION ░░
  // ═══════════════════════════════════════════════════════════

  async aggregateLearnings(options = {}) {
    this.logger.info(`[${this.name}] Aggregating distributed learnings...`);

    const summary = {
      timestamp: Date.now(),
      totalLearnings: this.metrics.learningsAggregated,
      totalKnowledge: this.metrics.totalKnowledgeBytes,
      workers: this.workers.size,
      tasksCompleted: this.metrics.tasksCompleted,
      tasksFailed: this.metrics.tasksFailed,
      avgTaskDuration: this.metrics.avgTaskDuration
    };

    // Request consolidation from VelocityTracker
    if (this.velocityTrackerConnected) {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'LearningVelocityTracker',
        type: 'consolidate_request',
        payload: summary
      });
    }

    this.logger.info(`[${this.name}] Learnings aggregated: ${summary.totalLearnings} items, ${this.formatBytes(summary.totalKnowledge)}`);

    return { success: true, summary };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATUS & UTILITIES ░░
  // ═══════════════════════════════════════════════════════════

  getWorkerStatus() {
    const workers = Array.from(this.workers.values()).map(w => ({
      id: w.id,
      type: w.type,
      status: w.status,
      tasksCompleted: w.tasksCompleted,
      tasksFailed: w.tasksFailed,
      currentTask: w.currentTask,
      uptime: Date.now() - w.spawnedAt
    }));

    return {
      success: true,
      workers,
      totalWorkers: this.workers.size,
      maxWorkers: this.maxWorkers,
      activeWorkers: this.activeWorkers,
      queueSize: this.learningQueue.length,
      nightLearningActive: this.distributedLearningActive
    };
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getStatus() {
    return {
      name: this.name,
      role: EdgeWorkerOrchestrator.role,
      capabilities: EdgeWorkerOrchestrator.capabilities,
      workers: {
        total: this.workers.size,
        max: this.maxWorkers,
        active: this.activeWorkers
      },
      queue: {
        size: this.learningQueue.length,
        maxSize: this.maxQueueSize
      },
      metrics: this.metrics,
      integration: {
        impulser: this.impulserConnected,
        velocityTracker: this.velocityTrackerConnected,
        timekeeper: this.timekeeperConnected
      },
      nightLearning: {
        enabled: this.nightLearningEnabled,
        active: this.distributedLearningActive
      }
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] Shutting down...`);

    // Stop night learning
    if (this.distributedLearningActive) {
      await this.stopNightLearning();
    }

    // Terminate all workers
    for (const workerId of this.workers.keys()) {
      await this.terminateWorker(workerId);
    }

    this.logger.info(`[${this.name}] ✅ Shutdown complete`);
  }
}

module.exports = EdgeWorkerOrchestrator;
