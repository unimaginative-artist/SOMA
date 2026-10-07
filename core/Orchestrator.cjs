// FILE: core/Orchestrator.js
const { EventEmitter } = require('events');

class Orchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.arbiters = new Map();
    this.taskQueue = [];
    this.processing = false;
    this.logger = config.logger || console;
    this.logger.info('[Orchestrator] Initialized');
  }

  registerArbiter(name, arbiter) {
    this.arbiters.set(name, arbiter);
    this.logger.info(`[Orchestrator] Registered arbiter: ${name}`);
  }

  async submitTask(task) {
    this.taskQueue.push(task);
    this.logger.info(`[Orchestrator] Task submitted: ${task.type}`);
    if (!this.processing) await this.processQueue();
  }

  async processQueue() {
    this.processing = true;
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      try {
        const result = await this.routeTask(task);
        this.emit('task:complete', { task, result });
      } catch (error) {
        this.logger.error(`[Orchestrator] Task failed:`, error);
        this.emit('task:failed', { task, error });
      }
    }
    this.processing = false;
  }

  async routeTask(task) {
    const arbiter = this.arbiters.get(task.arbiter || 'StorageArbiter');
    if (!arbiter) throw new Error(`Arbiter not found: ${task.arbiter}`);
    return await arbiter.processTask(task);
  }

  getStatus() {
    return {
      arbiters: Array.from(this.arbiters.keys()),
      queueSize: this.taskQueue.length,
      processing: this.processing
    };
  }
}

module.exports = Orchestrator;
module.exports.Orchestrator = Orchestrator;
