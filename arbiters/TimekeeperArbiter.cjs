// ═══════════════════════════════════════════════════════════
// FILE: arbiters/TimekeeperArbiter.js (CommonJS)
// Temporal orchestration with self-cloning and helper coordination
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const cron = require('node-cron');
const crypto = require('crypto');
const http = require('http');

class TimekeeperArbiter extends BaseArbiter {
  static role = 'timekeeper';
  static capabilities = ['schedule', 'synchronize', 'recover', 'evolve', 'temporal_pulse'];

  constructor(config = {}) {
    super(config);

    // Queue management (standard pattern)
    this.taskQueue = [];
    this.queueIndex = new Set();
    this.processing = 0;
    this.maxConcurrent = config.maxConcurrent || 5;
    this.maxQueue = config.maxQueue || 100;
    
    // Helper management
    this.helpers = [];
    this.maxHelpers = config.maxHelpers || 3;
    
    // Temporal systems
    this.version = config.version || 1;
    this.lastActive = Date.now();
    this.temporalLedger = [];
    this.avgSystemLoad = 0.0;
    this.pulseInterval = null;
    this.recoveryInterval = null;
    this.auditInterval = null;
    
    // Cron jobs
    this.cronJobs = new Map();
    this.learningSchedule = {};
    
    // Stats
    this.stats = {
      totalScheduled: 0,
      totalExecuted: 0,
      totalFailed: 0,
      rhythmsExecuted: 0,
      pulsesEmitted: 0,
      recoveryEvents: 0,
      helpersUsed: 0
    };

    this.logger.info(`[${this.name}] ⏳ TimekeeperArbiter initializing...`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.initializeRhythms();
    this.startTemporalPulse();
    this.startSelfRecoveryLoop();
    this.startSelfAuditLoop();

    this._subscribeBrokerMessages();

    this.logger.info(`[${this.name}] ✅ Temporal cycles active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, { 
        type: TimekeeperArbiter.role,
        capabilities: TimekeeperArbiter.capabilities 
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    messageBroker.subscribe(this.name, 'schedule');
    messageBroker.subscribe(this.name, 'synchronize');
    messageBroker.subscribe(this.name, 'recover');
    messageBroker.subscribe(this.name, 'evolve');
    messageBroker.subscribe(this.name, 'system_metrics');
    messageBroker.subscribe(this.name, 'task_batch');
    messageBroker.subscribe(this.name, 'help_request');
    messageBroker.subscribe(this.name, 'help_accepted');
    messageBroker.subscribe(this.name, 'status_check');
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload } = message;
      
      switch (type) {
        case 'schedule':
          return await this.addTask({ type: 'schedule', data: payload });
        
        case 'synchronize':
          return await this.addTask({ type: 'synchronize', data: payload });
        
        case 'recover':
          return await this.addTask({ type: 'recover', data: payload });
        
        case 'evolve':
          return await this.evolveRhythms(payload);
        
        case 'system_metrics':
          return await this.evolveRhythms(payload);
        
        case 'task_batch':
          return await this.handleTaskBatch(message);
        
        case 'help_request':
          return await this.handleHelpRequest(message);
        
        case 'help_accepted':
          return await this.handleHelpAccepted(message);
        
        case 'status_check':
          return this.getStatus();
        
        default:
          this.recordEvent('message_received', message);
          return { success: true, message: 'Event recorded' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ QUEUE MANAGEMENT (STANDARD PATTERN) ░░
  // ═══════════════════════════════════════════════════════════

  async addTask(task) {
    const taskId = task.taskId || crypto.randomUUID();
    
    if (this.queueIndex.has(taskId)) {
      return { success: false, reason: 'duplicate' };
    }
    
    if (this.taskQueue.length >= this.maxQueue) {
      this.logger.warn(`[${this.name}] Queue full, requesting help...`);
      await this.requestHelp('queue_full');
      return { success: false, reason: 'queue_full' };
    }
    
    this.taskQueue.push({ ...task, taskId, addedAt: Date.now() });
    this.queueIndex.add(taskId);
    this.stats.totalScheduled++;
    
    this._drainQueue();
    
    return { success: true, taskId };
  }

  async _drainQueue() {
    while (this.processing < this.maxConcurrent && this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      this.queueIndex.delete(task.taskId);
      this.processing++;
      
      this._processTask(task).catch(err => {
        this.logger.error(`[${this.name}] Task error: ${err.message}`);
      });
    }
    
    const load = this.checkLoad();
    if (load.isOverloaded && this.helpers.length === 0) {
      await this.requestHelp('overloaded');
    }
  }

  async _processTask(task) {
    try {
      this.logger.info(`[${this.name}] 🎯 Processing task: ${task.type}`);
      
      let result;
      
      switch (task.type) {
        case 'schedule':
          result = await this.executeScheduleTask(task.data);
          break;
        case 'synchronize':
          result = await this.executeSyncTask(task.data);
          break;
        case 'recover':
          result = await this.executeRecoveryTask(task.data);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }
      
      this.stats.totalExecuted++;
      this.recordEvent('task_completed', { taskId: task.taskId, type: task.type });
      
      return result;
    } catch (error) {
      this.stats.totalFailed++;
      this.recordEvent('task_failed', { taskId: task.taskId, error: error.message });
      throw error;
    } finally {
      this.processing--;
      this._drainQueue();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ LOAD MANAGEMENT (STANDARD PATTERN) ░░
  // ═══════════════════════════════════════════════════════════

  checkLoad() {
    const queueLoad = this.maxQueue > 0 ? (this.taskQueue.length / this.maxQueue) : 0;
    const processingLoad = this.maxConcurrent > 0 ? (this.processing / this.maxConcurrent) : 0;
    const overall = (queueLoad + processingLoad) / 2;
    const isOverloaded = queueLoad > 0.8 || processingLoad > 0.9;
    
    return { queue: queueLoad, processing: processingLoad, overall, isOverloaded };
  }

  async requestHelp(reason = 'overload') {
    if (this.helpers.length > 0) {
      return { success: true, message: 'helpers_present' };
    }
    
    this.logger.info(`[${this.name}] 📢 Requesting help: ${reason}`);
    
    await messageBroker.sendMessage({
      from: this.name,
      to: 'broadcast',
      type: 'help_request',
      payload: {
        reason,
        load: this.checkLoad(),
        queueSize: this.taskQueue.length,
        capabilities: TimekeeperArbiter.capabilities
      }
    });
    
    return { success: true };
  }

  async handleHelpRequest(message) {
    const from = message.from;
    
    if (from === this.name) {
      return { success: false, reason: 'self' };
    }
    
    const myLoad = this.checkLoad();
    if (myLoad.isOverloaded) {
      return { success: false, reason: 'also_busy' };
    }
    
    const theirCapabilities = message.payload.capabilities || [];
    const canHelp = theirCapabilities.some(c => TimekeeperArbiter.capabilities.includes(c));
    
    if (!canHelp) {
      return { success: false, reason: 'incompatible' };
    }
    
    this.logger.info(`[${this.name}] 🤝 Accepting help request from ${from}`);
    
    await messageBroker.sendMessage({
      from: this.name,
      to: from,
      type: 'help_accepted',
      payload: {
        helper: this.name,
        availableCapacity: this.maxConcurrent - this.processing
      }
    });
    
    return { success: true, helping: from };
  }

  async handleHelpAccepted(message) {
    const helper = message.from;
    
    this.logger.info(`[${this.name}] ✅ Help accepted by ${helper}`);
    
    if (!this.helpers.includes(helper)) {
      this.helpers.push(helper);
      this.stats.helpersUsed++;
    }
    
    await this.distributeWorkToHelpers();
    
    return { success: true };
  }

  async distributeWorkToHelpers() {
    if (this.helpers.length === 0 || this.taskQueue.length === 0) {
      return { success: false, reason: 'nothing_to_distribute' };
    }
    
    this.logger.info(`[${this.name}] 📤 Distributing ${this.taskQueue.length} tasks to ${this.helpers.length} helpers`);
    
    const tasksPer = Math.ceil(this.taskQueue.length / this.helpers.length);
    
    for (const helper of this.helpers) {
      const batch = [];
      
      for (let i = 0; i < tasksPer && this.taskQueue.length > 0; i++) {
        const task = this.taskQueue.shift();
        this.queueIndex.delete(task.taskId);
        batch.push(task);
      }
      
      if (batch.length > 0) {
        await messageBroker.sendMessage({
          from: this.name,
          to: helper,
          type: 'task_batch',
          payload: { tasks: batch, callback: this.name }
        });
      }
    }
    
    return { success: true };
  }

  async handleTaskBatch(message) {
    const tasks = message.payload.tasks || [];
    
    this.logger.info(`[${this.name}] 📥 Received ${tasks.length} tasks from ${message.from}`);
    
    let processed = 0;
    
    for (const task of tasks) {
      try {
        await this._processTask(task);
        processed++;
      } catch (error) {
        this.logger.error(`[${this.name}] Batch task failed: ${error.message}`);
      }
    }
    
    return { success: true, processed };
  }

  async releaseHelpers() {
    if (this.helpers.length === 0) return;
    
    for (const helper of this.helpers) {
      await messageBroker.sendMessage({
        from: this.name,
        to: helper,
        type: 'release',
        payload: { reason: 'work_complete' }
      });
    }
    
    this.helpers = [];
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ TEMPORAL SYSTEM (ORIGINAL LOGIC) ░░
  // ═══════════════════════════════════════════════════════════

  initializeRhythms() {
    this.learningSchedule = {
      memoryConsolidation: '0 2 * * *',
      selfOptimization: '0 6 * * *',
      syncWithDreams: '0 3 * * *',
      distributionWave: '0 */6 * * *',
      goalPlanning: '0 */6 * * *',  // Every 6 hours for autonomous goal planning
      resolveBets: '0 4 * * *',      // 4 AM: Grade Prophet Engine Homework
      processSoulCycle: '0 */6 * * *', // 6 hours: Distill wisdom from Limbic Weather
      dreamFusion: '0 3 * * *',       // 3 AM: Nightly Persona Innovation Debate
      dailyReport: '0 8 * * *'        // 8 AM: Generate daily status report
    };

    Object.entries(this.learningSchedule).forEach(([key, pattern]) => {
      const job = cron.schedule(pattern, async () => {
        await this.executeRhythm(key);
      });
      
      this.cronJobs.set(key, job);
    });
    
    this.logger.info(`[${this.name}] ⏰ ${this.cronJobs.size} rhythms scheduled`);
  }

  startTemporalPulse() {
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
    }
    
    this.pulseInterval = setInterval(async () => {
      const timestamp = Date.now();
      
      await messageBroker.sendMessage({
        from: this.name,
        to: 'broadcast',
        type: 'time_pulse',
        payload: { timestamp, version: this.version }
      });
      
      this.stats.pulsesEmitted++;
      this.recordEvent('pulse', { timestamp });
    }, 30000); // Every 30 seconds
    
    this.logger.info(`[${this.name}] 💓 Temporal pulse started (30s interval)`);
  }

  async executeRhythm(key, retryCount = 0) {
    const maxRetries = 3;
    const retryDelays = [5000, 15000, 60000]; // 5s, 15s, 60s backoff

    this.logger.info(`[${this.name}] 🎵 Executing rhythm: ${key}${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);

    const tasks = {
      memoryConsolidation: () => this.sendRhythmMessage('ArchivistArbiter', 'optimize_memory'),
      selfOptimization: () => this.sendRhythmMessage('SOMArbiter', 'trigger_learning'),
      syncWithDreams: () => this.sendRhythmMessage('DreamArbiter', 'sync_cycle'),
      distributionWave: () => this.sendRhythmMessage('DeploymentArbiter', 'deploy_update'),
      goalPlanning: () => this.sendRhythmMessage('GoalPlannerArbiter', 'planning_pulse'),
      resolveBets: () => this.triggerBetResolution(),
      processSoulCycle: () => this.sendRhythmMessage('InternalInstinctCore', 'process_soul_cycle'),
      dreamFusion: () => this.sendRhythmMessage('SomaBrain', 'trigger_dream_fusion'),
      dailyReport: () => this.sendRhythmMessage('ReportingArbiter', 'generate_daily_report')
    };

    if (tasks[key]) {
      try {
        await tasks[key]();
        this.stats.rhythmsExecuted++;
        // Clear failure count on success
        if (this._rhythmFailures) this._rhythmFailures.delete(key);
        this.recordEvent('execute_rhythm', { key, success: true, retryCount });
      } catch (error) {
        this.stats.totalFailed++;
        this.logger.error(`[${this.name}] Rhythm failed: ${key} - ${error.message}`);
        this.recordEvent('execute_rhythm', { key, success: false, error: error.message, retryCount });

        // Track consecutive failures per rhythm
        if (!this._rhythmFailures) this._rhythmFailures = new Map();
        const failures = (this._rhythmFailures.get(key) || 0) + 1;
        this._rhythmFailures.set(key, failures);

        // Retry with exponential backoff
        if (retryCount < maxRetries) {
          const delay = retryDelays[retryCount] || 60000;
          this.logger.warn(`[${this.name}] ⏳ Retrying ${key} in ${delay / 1000}s...`);
          setTimeout(() => this.executeRhythm(key, retryCount + 1), delay);
        } else {
          // Max retries exhausted — escalate to GoalPlanner
          this.logger.error(`[${this.name}] ❌ Rhythm ${key} failed after ${maxRetries} retries (${failures} total failures)`);
          try {
            await messageBroker.sendMessage({
              from: this.name,
              to: 'GoalPlannerArbiter',
              type: 'create_goal',
              payload: {
                title: `Fix failing rhythm: ${key}`,
                category: 'system-health',
                type: 'operational',
                description: `Rhythm "${key}" has failed ${failures} times. Last error: ${error.message}`,
                priority: 80,
                rationale: `Autonomous escalation from TimekeeperArbiter after ${maxRetries} retries`
              }
            });
            this.logger.warn(`[${this.name}] 📋 Escalated ${key} failure to GoalPlanner`);
          } catch (e) {
            this.logger.error(`[${this.name}] Failed to escalate: ${e.message}`);
          }
        }
      }
    }
  }

    async sendRhythmMessage(to, type) {

      await messageBroker.sendMessage({

        from: this.name,

        to,

        type,

        payload: { 

          version: this.version, 

          timestamp: Date.now(), 

          rhythmSource: true

        }

      });

    }

  

    async triggerBetResolution() {

      this.logger.info(`[${this.name}] 🎲 Triggering Daily Bet Resolution (Prophet Engine)...`);

      

      return new Promise((resolve, reject) => {

          const req = http.request({

              hostname: '127.0.0.1',

              port: 5000,

              path: '/api/admin/resolve',

              method: 'POST',

              headers: { 'Content-Type': 'application/json' }

          }, (res) => {

              let data = '';

              res.on('data', chunk => data += chunk);

              res.on('end', () => {

                  if (res.statusCode === 200) {

                      this.logger.info(`[${this.name}] ✅ Bet Resolution Complete: ${data}`);

                      resolve();

                  } else {

                      reject(new Error(`Resolution failed: ${res.statusCode}`));

                  }

              });

          });

          

          req.on('error', (e) => {

              this.logger.warn(`[${this.name}] ⚠️ Prophet Engine Offline (Port 5000) - Skipping Resolution`);

              // Don't crash arbiter if python backend is down

              resolve(); 

          });

          

          req.end();

      });

    }

  

    // ═══════════════════════════════════════════════════════════

  
  // ░░ SELF-HEALING LOOPS ░░
  // ═══════════════════════════════════════════════════════════

  startSelfRecoveryLoop() {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }
    
    this.recoveryInterval = setInterval(async () => {
      try {
        // Check for missed messages (if MessageBroker supports this)
        const missed = await messageBroker.getMissedMessagesSince?.(this.lastActive);
        
        if (missed && missed.length) {
          this.logger.info(`[${this.name}] 🩹 Recovering ${missed.length} missed events...`);
          
          for (const msg of missed) {
            await this.handleMessage(msg);
          }
          
          this.stats.recoveryEvents++;
        }
        
        this.lastActive = Date.now();
      } catch (error) {
        this.logger.error(`[${this.name}] Recovery loop error: ${error.message}`);
      }
    }, 60000); // Every 60 seconds
  }

  startSelfAuditLoop() {
    if (this.auditInterval) {
      clearInterval(this.auditInterval);
    }
    
    this.auditInterval = setInterval(() => {
      const inactiveTime = Date.now() - this.lastActive;
      
      if (inactiveTime > 120000) { // 2 minutes
        this.logger.warn(`[${this.name}] ⚠️ Inactivity detected (${(inactiveTime / 1000).toFixed(0)}s) - restarting pulse`);
        this.startTemporalPulse();
      }
      
      // Check if helpers are idle
      if (this.helpers.length > 0 && this.taskQueue.length === 0 && this.processing === 0) {
        this.logger.info(`[${this.name}] 🗑️ Releasing idle helpers`);
        this.releaseHelpers();
      }
    }, 120000); // Every 2 minutes
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ TASK EXECUTION ░░
  // ═══════════════════════════════════════════════════════════

  async executeScheduleTask(data) {
    this.logger.info(`[${this.name}] 📅 Executing schedule task`);
    // Schedule logic implementation
    return { success: true, executed: 'schedule' };
  }

  async executeSyncTask(data) {
    this.logger.info(`[${this.name}] 🔄 Executing sync task`);
    // Sync logic implementation
    return { success: true, executed: 'sync' };
  }

  async executeRecoveryTask(data) {
    this.logger.info(`[${this.name}] 🩹 Executing recovery task`);
    // Recovery logic implementation
    return { success: true, executed: 'recovery' };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ RHYTHM EVOLUTION ░░
  // ═══════════════════════════════════════════════════════════

  async evolveRhythms(metrics) {
    const avgLoad = metrics?.avgLoad ?? 0.5;
    this.avgSystemLoad = avgLoad;
    
    this.logger.info(`[${this.name}] 🧬 Evolving rhythms based on load: ${(avgLoad * 100).toFixed(1)}%`);
    
    // Adjust optimization frequency based on load
    if (avgLoad > 0.8) {
      this.updateRhythm('selfOptimization', '*/10 * * * *'); // Every 10 minutes
      this.logger.info(`[${this.name}] ⚡ High load - increased optimization frequency`);
    } else if (avgLoad < 0.3) {
      this.updateRhythm('selfOptimization', '0 0 * * *'); // Once daily
      this.logger.info(`[${this.name}] 🌙 Low load - reduced optimization frequency`);
    }
    
    this.recordEvent('rhythm_evolution', { avgLoad });
    
    return { success: true, avgLoad, evolved: true };
  }

  updateRhythm(key, newPattern) {
    // Stop old cron job
    if (this.cronJobs.has(key)) {
      this.cronJobs.get(key).stop();
    }
    
    // Start new cron job
    const job = cron.schedule(newPattern, async () => {
      await this.executeRhythm(key);
    });
    
    this.cronJobs.set(key, job);
    this.learningSchedule[key] = newPattern;
    
    this.logger.info(`[${this.name}] 🔄 Updated rhythm: ${key} → ${newPattern}`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ EVENT LEDGER ░░
  // ═══════════════════════════════════════════════════════════

  recordEvent(event, data = {}) {
    this.temporalLedger.push({ 
      event, 
      timestamp: Date.now(), 
      data 
    });
    
    // Keep only last 1000 events
    if (this.temporalLedger.length > 1000) {
      this.temporalLedger.shift();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ AUTOPILOT CONTROL ░░
  // ═══════════════════════════════════════════════════════════

  pauseAutonomousRhythms() {
    if (this._rhythmsPaused) return;
    this._rhythmsPaused = true;
    this._pausedRhythms = [];

    // Non-essential rhythms to pause
    const nonEssential = ['goalPlanning', 'distributionWave', 'processSoulCycle', 'dreamFusion', 'selfOptimization', 'resolveBets'];
    for (const key of nonEssential) {
      const job = this.cronJobs.get(key);
      if (job) { job.stop(); this._pausedRhythms.push(key); }
    }

    this.logger.info(`[${this.name}] ⏸️  Autonomous rhythms PAUSED (${this._pausedRhythms.length} paused, essentials still running)`);
  }

  resumeAutonomousRhythms() {
    if (!this._rhythmsPaused) return;
    this._rhythmsPaused = false;

    for (const key of (this._pausedRhythms || [])) {
      const job = this.cronJobs.get(key);
      if (job) job.start();
    }

    this.logger.info(`[${this.name}] ▶️  Autonomous rhythms RESUMED (${(this._pausedRhythms || []).length} restarted)`);
    this._pausedRhythms = [];
  }

  isAutonomousActive() {
    return !this._rhythmsPaused;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATUS & SHUTDOWN ░░
  // ═══════════════════════════════════════════════════════════

  getStatus() {
    return {
      name: this.name,
      role: TimekeeperArbiter.role,
      capabilities: TimekeeperArbiter.capabilities,
      version: this.version,
      queue: {
        size: this.taskQueue.length,
        processing: this.processing,
        maxConcurrent: this.maxConcurrent
      },
      load: this.checkLoad(),
      helpers: this.helpers.length,
      stats: this.stats,
      temporal: {
        lastActive: this.lastActive,
        avgSystemLoad: this.avgSystemLoad,
        rhythmsActive: this.cronJobs.size,
        ledgerSize: this.temporalLedger.length
      },
      rhythms: Object.keys(this.learningSchedule)
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] ⏳ Shutting down temporal systems...`);
    
    // Stop intervals
    if (this.pulseInterval) clearInterval(this.pulseInterval);
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    if (this.auditInterval) clearInterval(this.auditInterval);
    
    // Stop cron jobs
    for (const [key, job] of this.cronJobs) {
      job.stop();
      this.logger.info(`[${this.name}]   Stopped rhythm: ${key}`);
    }
    
    // Release helpers
    await this.releaseHelpers();
    
    this.logger.info(`[${this.name}] ✅ Shutdown complete`);
  }
}

module.exports = TimekeeperArbiter;





