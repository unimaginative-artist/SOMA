// ═══════════════════════════════════════════════════════════
// FILE: arbiters/ResourceBudgetArbiter.cjs
// Resource scarcity manager - creates productive tension through limitations
// Forces SOMA to prioritize, optimize, and make strategic decisions
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

class ResourceBudgetArbiter extends BaseArbiter {
  static role = 'resource-budget';
  static capabilities = ['enforce-limits', 'track-usage', 'allocate-resources', 'pressure-generation'];

  constructor(config = {}) {
    super(config);

    // Daily resource budgets (resets at midnight)
    this.budgets = {
      apiCalls: {
        daily: config.dailyAPICallBudget || 1000,
        remaining: config.dailyAPICallBudget || 1000,
        used: 0,
        resetTime: this._getNextMidnight()
      },
      memory: {
        budgetMB: config.memoryBudgetMB || 5000,
        usedMB: 0,
        warningThreshold: 0.80, // 80%
        criticalThreshold: 0.95 // 95%
      },
      compute: {
        dailySeconds: config.computeBudgetSeconds || 3600, // 1 hour
        usedSeconds: 0,
        remaining: config.computeBudgetSeconds || 3600,
        resetTime: this._getNextMidnight()
      }
    };

    // Resource allocation priorities (arbiter weights)
    this.allocationWeights = new Map([
      // Critical systems (always get resources)
      ['THALAMUS', 1.0],
      ['BeliefSystemArbiter', 0.9],
      ['MessageBroker', 0.9],

      // High priority
      ['LOGOS', 0.8],
      ['GoalPlannerArbiter', 0.8],
      ['EngineeringSwarmArbiter', 0.7],

      // Medium priority
      ['AURORA', 0.6],
      ['PROMETHEUS', 0.6],
      ['CuriosityEngine', 0.5],

      // Low priority (can be throttled)
      ['EdgeWorkers', 0.3],
      ['DreamArbiter', 0.2]
    ]);

    // Pressure metrics
    this.pressureMetrics = {
      apiPressure: 0.0,      // 0-1 scale
      memoryPressure: 0.0,   // 0-1 scale
      computePressure: 0.0,  // 0-1 scale
      overallPressure: 0.0   // Weighted average
    };

    // Request tracking
    this.requests = {
      approved: 0,
      denied: 0,
      throttled: 0,
      byArbiter: new Map()
    };

    // Statistics
    this.stats = {
      totalRequestsProcessed: 0,
      approvalRate: 1.0,
      denialsByResource: {
        apiCalls: 0,
        memory: 0,
        compute: 0
      },
      pressureTriggeredOptimizations: 0
    };

    this.resetInterval = null;

    this.logger.info(`[${this.name}] 💰 ResourceBudgetArbiter initializing...`);
    this.logger.info(`[${this.name}] API Budget: ${this.budgets.apiCalls.daily} calls/day`);
    this.logger.info(`[${this.name}] Memory Budget: ${this.budgets.memory.budgetMB} MB`);
    this.logger.info(`[${this.name}] Compute Budget: ${this.budgets.compute.dailySeconds}s/day`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    // Start daily budget reset timer
    this.startBudgetResetTimer();

    // Start pressure monitoring
    this.startPressureMonitoring();

    this.logger.info(`[${this.name}] ✅ Resource budget system active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: ResourceBudgetArbiter.role,
        capabilities: ResourceBudgetArbiter.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // Resource requests
    messageBroker.subscribe(this.name, 'request_api_call');
    messageBroker.subscribe(this.name, 'request_memory');
    messageBroker.subscribe(this.name, 'request_compute');
    messageBroker.subscribe(this.name, 'resource_query');

    // Usage tracking
    messageBroker.subscribe(this.name, 'api_call_complete');
    messageBroker.subscribe(this.name, 'memory_allocated');
    messageBroker.subscribe(this.name, 'memory_freed');
    messageBroker.subscribe(this.name, 'compute_used');

    this.logger.info(`[${this.name}] Subscribed to message types`);
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload, from } = message;

      switch (type) {
        case 'request_api_call':
          return await this.requestAPICall(from, payload);

        case 'request_memory':
          return await this.requestMemory(from, payload);

        case 'request_compute':
          return await this.requestCompute(from, payload);

        case 'resource_query':
          return this.getResourceStatus();

        case 'api_call_complete':
          return this.recordAPICall(from);

        case 'memory_allocated':
          return this.recordMemoryAllocation(payload.sizeMB);

        case 'memory_freed':
          return this.recordMemoryFreed(payload.sizeMB);

        case 'compute_used':
          return this.recordComputeUsage(payload.seconds);

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ RESOURCE REQUEST APPROVAL ░░
  // ═══════════════════════════════════════════════════════════

  async requestAPICall(requester, options = {}) {
    this.stats.totalRequestsProcessed++;

    const priority = this.allocationWeights.get(requester) || 0.5;
    const urgency = options.urgency || 0.5; // 0-1 scale

    // Check if we have budget
    if (this.budgets.apiCalls.remaining <= 0) {
      // Out of budget - only critical requests allowed
      if (priority < 0.9 || urgency < 0.9) {
        this.requests.denied++;
        this.stats.denialsByResource.apiCalls++;

        this.logger.warn(`[${this.name}] ❌ API call denied for ${requester} - budget exhausted (priority: ${priority})`);

        // Trigger optimization pressure
        await this._triggerOptimizationPressure('apiCalls');

        return {
          success: false,
          approved: false,
          reason: 'API call budget exhausted',
          remaining: 0,
          resetTime: this.budgets.apiCalls.resetTime
        };
      }
    }

    // Check pressure levels
    const pressure = this.pressureMetrics.apiPressure;

    // Throttle low-priority requests when under pressure
    if (pressure > 0.7 && priority < 0.5) {
      this.requests.throttled++;

      this.logger.warn(`[${this.name}] ⏸️  API call throttled for ${requester} (pressure: ${(pressure * 100).toFixed(0)}%)`);

      return {
        success: true,
        approved: false,
        throttled: true,
        reason: 'High API pressure - low priority request throttled',
        retryAfter: 300000 // 5 minutes
      };
    }

    // Approve request
    this.budgets.apiCalls.remaining--;
    this.budgets.apiCalls.used++;
    this.requests.approved++;

    // Track by requester
    if (!this.requests.byArbiter.has(requester)) {
      this.requests.byArbiter.set(requester, { approved: 0, denied: 0 });
    }
    this.requests.byArbiter.get(requester).approved++;

    this._updatePressureMetrics();

    return {
      success: true,
      approved: true,
      remaining: this.budgets.apiCalls.remaining,
      pressure: this.pressureMetrics.apiPressure
    };
  }

  async requestMemory(requester, options = {}) {
    const sizeMB = options.sizeMB || 0;
    const priority = this.allocationWeights.get(requester) || 0.5;

    const projectedUsage = this.budgets.memory.usedMB + sizeMB;
    const usagePercent = projectedUsage / this.budgets.memory.budgetMB;

    // Deny if over budget (unless critical)
    if (usagePercent > 1.0 && priority < 0.9) {
      this.requests.denied++;
      this.stats.denialsByResource.memory++;

      this.logger.error(`[${this.name}] ❌ Memory request denied for ${requester} - budget exceeded (${sizeMB}MB)`);

      await this._triggerOptimizationPressure('memory');

      return {
        success: false,
        approved: false,
        reason: 'Memory budget exceeded',
        requested: sizeMB,
        available: Math.max(0, this.budgets.memory.budgetMB - this.budgets.memory.usedMB)
      };
    }

    // Approve
    this.budgets.memory.usedMB += sizeMB;
    this.requests.approved++;

    this._updatePressureMetrics();

    // Warn if crossing thresholds
    if (usagePercent > this.budgets.memory.criticalThreshold) {
      this.logger.error(`[${this.name}] 🚨 CRITICAL: Memory usage at ${(usagePercent * 100).toFixed(0)}%!`);
      await this._triggerOptimizationPressure('memory');
    } else if (usagePercent > this.budgets.memory.warningThreshold) {
      this.logger.warn(`[${this.name}] ⚠️  Memory usage at ${(usagePercent * 100).toFixed(0)}%`);
    }

    return {
      success: true,
      approved: true,
      allocated: sizeMB,
      usedMB: this.budgets.memory.usedMB,
      budgetMB: this.budgets.memory.budgetMB,
      pressure: this.pressureMetrics.memoryPressure
    };
  }

  async requestCompute(requester, options = {}) {
    const estimatedSeconds = options.estimatedSeconds || 1;
    const priority = this.allocationWeights.get(requester) || 0.5;

    // Check if we have budget
    if (this.budgets.compute.remaining < estimatedSeconds && priority < 0.9) {
      this.requests.denied++;
      this.stats.denialsByResource.compute++;

      this.logger.warn(`[${this.name}] ❌ Compute denied for ${requester} - budget low (need ${estimatedSeconds}s, have ${this.budgets.compute.remaining}s)`);

      await this._triggerOptimizationPressure('compute');

      return {
        success: false,
        approved: false,
        reason: 'Compute budget insufficient',
        requested: estimatedSeconds,
        remaining: this.budgets.compute.remaining
      };
    }

    // Approve
    this.requests.approved++;

    return {
      success: true,
      approved: true,
      estimatedSeconds,
      remaining: this.budgets.compute.remaining,
      pressure: this.pressureMetrics.computePressure
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ USAGE TRACKING ░░
  // ═══════════════════════════════════════════════════════════

  recordAPICall(requester) {
    // Already decremented in requestAPICall
    this._updatePressureMetrics();
    return { success: true };
  }

  recordMemoryAllocation(sizeMB) {
    this.budgets.memory.usedMB += sizeMB;
    this._updatePressureMetrics();
    return { success: true };
  }

  recordMemoryFreed(sizeMB) {
    this.budgets.memory.usedMB = Math.max(0, this.budgets.memory.usedMB - sizeMB);
    this._updatePressureMetrics();
    return { success: true };
  }

  recordComputeUsage(seconds) {
    this.budgets.compute.usedSeconds += seconds;
    this.budgets.compute.remaining = Math.max(0, this.budgets.compute.remaining - seconds);
    this._updatePressureMetrics();
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PRESSURE METRICS ░░
  // ═══════════════════════════════════════════════════════════

  _updatePressureMetrics() {
    // API pressure (based on remaining calls)
    this.pressureMetrics.apiPressure = 1.0 - (this.budgets.apiCalls.remaining / this.budgets.apiCalls.daily);

    // Memory pressure (based on usage)
    this.pressureMetrics.memoryPressure = this.budgets.memory.usedMB / this.budgets.memory.budgetMB;

    // Compute pressure (based on remaining time)
    this.pressureMetrics.computePressure = this.budgets.compute.usedSeconds / this.budgets.compute.dailySeconds;

    // Overall pressure (weighted average - memory most critical)
    this.pressureMetrics.overallPressure =
      (this.pressureMetrics.apiPressure * 0.3) +
      (this.pressureMetrics.memoryPressure * 0.5) +
      (this.pressureMetrics.computePressure * 0.2);

    // Broadcast pressure updates if significant change
    if (this.pressureMetrics.overallPressure > 0.7) {
      messageBroker.publish({
        type: 'resource_pressure_high',
        payload: {
          pressure: this.pressureMetrics.overallPressure,
          metrics: this.pressureMetrics
        },
        from: this.name
      });
    }
  }

  async _triggerOptimizationPressure(resourceType) {
    this.stats.pressureTriggeredOptimizations++;

    this.logger.warn(`[${this.name}] 🔥 Triggering optimization pressure for: ${resourceType}`);

    // Send to GoalPlanner to create optimization goals
    await messageBroker.sendMessage({
      from: this.name,
      to: 'GoalPlannerArbiter',
      type: 'resource_pressure_critical',
      payload: {
        resourceType,
        pressure: this.pressureMetrics[`${resourceType}Pressure`] || this.pressureMetrics.overallPressure,
        budget: this.budgets[resourceType],
        urgency: 'high'
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ BUDGET MANAGEMENT ░░
  // ═══════════════════════════════════════════════════════════

  startBudgetResetTimer() {
    const now = Date.now();
    const nextMidnight = this._getNextMidnight();
    const msUntilMidnight = nextMidnight - now;

    // Schedule reset at midnight
    setTimeout(() => {
      this.resetDailyBudgets();

      // Then schedule daily resets
      this.resetInterval = setInterval(() => {
        this.resetDailyBudgets();
      }, 24 * 60 * 60 * 1000); // Every 24 hours

    }, msUntilMidnight);

    this.logger.info(`[${this.name}] Budget reset scheduled for ${new Date(nextMidnight).toLocaleString()}`);
  }

  resetDailyBudgets() {
    const apiUsagePercent = (this.budgets.apiCalls.used / this.budgets.apiCalls.daily * 100).toFixed(1);
    const computeUsagePercent = (this.budgets.compute.usedSeconds / this.budgets.compute.dailySeconds * 100).toFixed(1);

    this.logger.info(`[${this.name}] 🔄 Resetting daily budgets...`);
    this.logger.info(`[${this.name}]    API calls: ${this.budgets.apiCalls.used}/${this.budgets.apiCalls.daily} (${apiUsagePercent}%)`);
    this.logger.info(`[${this.name}]    Compute: ${this.budgets.compute.usedSeconds}/${this.budgets.compute.dailySeconds}s (${computeUsagePercent}%)`);

    // Reset API calls
    this.budgets.apiCalls.remaining = this.budgets.apiCalls.daily;
    this.budgets.apiCalls.used = 0;
    this.budgets.apiCalls.resetTime = this._getNextMidnight();

    // Reset compute
    this.budgets.compute.remaining = this.budgets.compute.dailySeconds;
    this.budgets.compute.usedSeconds = 0;
    this.budgets.compute.resetTime = this._getNextMidnight();

    // Update pressure
    this._updatePressureMetrics();

    // Broadcast reset
    messageBroker.publish({
      type: 'resource_budgets_reset',
      payload: {
        budgets: this.budgets,
        stats: this.stats
      },
      from: this.name
    });
  }

  _getNextMidnight() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  startPressureMonitoring() {
    setInterval(() => {
      this._updatePressureMetrics();

      // Log pressure status every hour
      const pressure = this.pressureMetrics.overallPressure;
      const emoji = pressure > 0.8 ? '🔴' : pressure > 0.5 ? '🟡' : '🟢';

      this.logger.info(`[${this.name}] ${emoji} Resource pressure: ${(pressure * 100).toFixed(0)}%`);
    }, 60 * 60 * 1000); // Every hour
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ QUERIES ░░
  // ═══════════════════════════════════════════════════════════

  getResourceStatus() {
    return {
      success: true,
      budgets: {
        apiCalls: {
          daily: this.budgets.apiCalls.daily,
          used: this.budgets.apiCalls.used,
          remaining: this.budgets.apiCalls.remaining,
          resetTime: this.budgets.apiCalls.resetTime
        },
        memory: {
          budgetMB: this.budgets.memory.budgetMB,
          usedMB: this.budgets.memory.usedMB,
          availableMB: this.budgets.memory.budgetMB - this.budgets.memory.usedMB,
          usagePercent: (this.budgets.memory.usedMB / this.budgets.memory.budgetMB * 100).toFixed(1)
        },
        compute: {
          dailySeconds: this.budgets.compute.dailySeconds,
          usedSeconds: this.budgets.compute.usedSeconds,
          remainingSeconds: this.budgets.compute.remaining,
          resetTime: this.budgets.compute.resetTime
        }
      },
      pressure: this.pressureMetrics,
      stats: {
        ...this.stats,
        approvalRate: (this.requests.approved / Math.max(1, this.stats.totalRequestsProcessed) * 100).toFixed(1) + '%'
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ LIFECYCLE ░░
  // ═══════════════════════════════════════════════════════════

  async shutdown() {
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
    }

    this.logger.info(`[${this.name}] Shutting down...`);
    await super.shutdown();
  }
}

module.exports = { ResourceBudgetArbiter };
