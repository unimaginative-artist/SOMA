// AutomationAgent.cjs
// Autonomous task scheduling - runs things on its own!

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');

class AutomationAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'automation', ttl: 0 }); // No TTL - runs indefinitely
    
    this.schedules = new Map(); // scheduleId -> schedule config
    this.timers = new Map(); // scheduleId -> timer
    this.pool = config.pool || null;
    this.history = []; // Execution history
    this.maxHistory = config.maxHistory || 100;
  }
  
  /**
   * Execute automation task
   * Task format:
   * {
   *   operation: 'schedule' | 'cancel' | 'list' | 'history',
   *   schedule: {
   *     id: 'unique-id',
   *     type: 'interval' | 'cron' | 'once',
   *     interval: 60000, // ms (for interval type)
   *     time: '2025-10-28T20:00:00', // ISO string (for once type)
   *     agent: 'fetch',
   *     task: {...}
   *   }
   * }
   */
  async execute(task) {
    const { operation, schedule, scheduleId } = task;
    
    if (!operation) {
      throw new Error('Task must include operation');
    }
    
    this.logger.info(`[AutomationAgent:${this.id}] ${operation} operation`);
    
    switch (operation) {
      case 'schedule':
        return this._schedule(schedule);
      
      case 'cancel':
        return this._cancel(scheduleId);
      
      case 'cancelAll':
        return this._cancelAll();
      
      case 'list':
        return this._list();
      
      case 'history':
        return this._history();
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  _schedule(schedule) {
    if (!schedule || !schedule.id) {
      throw new Error('Schedule requires id');
    }
    
    if (!schedule.agent || !schedule.task) {
      throw new Error('Schedule requires agent and task');
    }
    
    if (!this.pool) {
      throw new Error('AutomationAgent requires pool reference');
    }
    
    const { id, type, interval, time, agent, task, retries = 0 } = schedule;
    
    // Cancel existing if present
    if (this.schedules.has(id)) {
      this._cancel(id);
    }
    
    this.schedules.set(id, {
      ...schedule,
      createdAt: Date.now(),
      nextRun: null,
      lastRun: null,
      runCount: 0
    });
    
    this.logger.info(`[AutomationAgent:${this.id}] Scheduled ${type} task: ${id}`);
    
    // Setup timer based on type
    switch (type) {
      case 'interval':
        this._scheduleInterval(id, interval, agent, task, retries);
        break;
      
      case 'once':
        this._scheduleOnce(id, time, agent, task, retries);
        break;
      
      case 'cron':
        // For now, use interval as fallback (proper cron needs node-cron)
        this._scheduleInterval(id, interval || 60000, agent, task, retries);
        break;
      
      default:
        throw new Error(`Unknown schedule type: ${type}`);
    }
    
    return {
      scheduled: true,
      id,
      type,
      nextRun: this.schedules.get(id).nextRun
    };
  }
  
  _scheduleInterval(id, interval, agent, task, retries) {
    const schedule = this.schedules.get(id);
    schedule.nextRun = Date.now() + interval;
    
    const timer = setInterval(async () => {
      await this._executeScheduled(id, agent, task, retries);
      
      // Update next run
      const sched = this.schedules.get(id);
      if (sched) {
        sched.nextRun = Date.now() + interval;
      }
    }, interval);
    
    this.timers.set(id, timer);
  }
  
  _scheduleOnce(id, time, agent, task, retries) {
    const schedule = this.schedules.get(id);
    const targetTime = new Date(time).getTime();
    const delay = targetTime - Date.now();
    
    if (delay < 0) {
      throw new Error('Scheduled time is in the past');
    }
    
    schedule.nextRun = targetTime;
    
    const timer = setTimeout(async () => {
      await this._executeScheduled(id, agent, task, retries);
      
      // Remove after execution
      this.schedules.delete(id);
      this.timers.delete(id);
    }, delay);
    
    this.timers.set(id, timer);
  }
  
  async _executeScheduled(id, agent, task, retries) {
    const schedule = this.schedules.get(id);
    if (!schedule) return;
    
    this.logger.info(`[AutomationAgent:${this.id}] Executing scheduled task: ${id}`);
    
    schedule.lastRun = Date.now();
    schedule.runCount++;
    
    let attempt = 0;
    let result = null;
    let error = null;
    
    while (attempt <= retries) {
      try {
        result = await this.pool.executeTask(agent, task, { autoTerminate: true });
        error = null;
        break;
      } catch (err) {
        error = err.message;
        attempt++;
        
        if (attempt <= retries) {
          this.logger.info(`[AutomationAgent:${this.id}] Retry ${attempt}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    // Add to history
    this._addHistory({
      scheduleId: id,
      agent,
      timestamp: Date.now(),
      success: !error,
      result: result?.result,
      error,
      attempts: attempt + 1
    });
  }
  
  _cancel(scheduleId) {
    if (!scheduleId) {
      throw new Error('Cancel requires scheduleId');
    }
    
    const timer = this.timers.get(scheduleId);
    if (timer) {
      clearInterval(timer);
      clearTimeout(timer);
      this.timers.delete(scheduleId);
    }
    
    const existed = this.schedules.has(scheduleId);
    this.schedules.delete(scheduleId);
    
    this.logger.info(`[AutomationAgent:${this.id}] Cancelled schedule: ${scheduleId}`);
    
    return {
      cancelled: existed,
      id: scheduleId
    };
  }
  
  _cancelAll() {
    const count = this.schedules.size;
    
    for (const [id, timer] of this.timers.entries()) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    
    this.schedules.clear();
    this.timers.clear();
    
    this.logger.info(`[AutomationAgent:${this.id}] Cancelled all ${count} schedules`);
    
    return {
      cancelled: count
    };
  }
  
  _list() {
    const schedules = [];
    
    for (const [id, schedule] of this.schedules.entries()) {
      schedules.push({
        id,
        type: schedule.type,
        agent: schedule.agent,
        interval: schedule.interval,
        createdAt: schedule.createdAt,
        nextRun: schedule.nextRun,
        lastRun: schedule.lastRun,
        runCount: schedule.runCount
      });
    }
    
    return {
      count: schedules.length,
      schedules
    };
  }
  
  _history() {
    return {
      count: this.history.length,
      history: this.history.slice(-50) // Last 50 executions
    };
  }
  
  _addHistory(entry) {
    this.history.push(entry);
    
    // Keep only maxHistory entries
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }
  
  async terminate(reason = 'manual') {
    // Cancel all schedules before terminating
    this._cancelAll();
    return super.terminate(reason);
  }
}

module.exports = { AutomationAgent };
