// ═══════════════════════════════════════════════════════════
// LOAD MANAGER
// Handles stress, backpressure, and load shedding for SOMA ASI
// ═══════════════════════════════════════════════════════════

const { EventEmitter } = require('events');

class LoadManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.name = 'LoadManager';
    this.logger = config.logger || console;
    
    // Load thresholds
    this.thresholds = {
      normal: 0.6,      // < 60% load is normal
      warning: 0.75,    // 60-75% load triggers warnings
      critical: 0.85,   // 75-85% load triggers backpressure
      overload: 0.95    // > 95% triggers load shedding
    };
    
    // Current system state
    this.currentLoad = {
      cpu: 0,
      memory: 0,
      queue: 0,
      connections: 0,
      overall: 0
    };
    
    this.loadState = 'normal'; // normal, warning, critical, overload
    
    // Load shedding configuration
    this.loadSheddingActive = false;
    this.sheddingStrategy = config.sheddingStrategy || 'priority'; // priority, fifo, random
    this.sheddingRate = 0; // 0-1, percentage of requests to shed
    
    // Backpressure configuration
    this.backpressureActive = false;
    this.backpressureDelay = 0; // ms to delay requests
    
    // Circuit breaker per system
    this.circuitBreakers = new Map();
    this.circuitBreakerThreshold = config.circuitBreakerThreshold || 5; // failures before open
    this.circuitBreakerTimeout = config.circuitBreakerTimeout || 30000; // 30s cooldown
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      shedRequests: 0,
      delayedRequests: 0,
      circuitOpenEvents: 0
    };
    
    this.logger.info('[LoadManager] Initialized with adaptive load management');
  }
  
  // ═══════════════════════════════════════════════════════════
  // LOAD MONITORING
  // ═══════════════════════════════════════════════════════════
  
  updateLoad(source, loadValue) {
    this.currentLoad[source] = Math.max(0, Math.min(1, loadValue));
    
    // Calculate overall load (weighted average)
    const weights = { cpu: 0.3, memory: 0.3, queue: 0.3, connections: 0.1 };
    this.currentLoad.overall = 
      this.currentLoad.cpu * weights.cpu +
      this.currentLoad.memory * weights.memory +
      this.currentLoad.queue * weights.queue +
      this.currentLoad.connections * weights.connections;
    
    // Update load state
    const prevState = this.loadState;
    this.loadState = this.calculateLoadState(this.currentLoad.overall);
    
    if (prevState !== this.loadState) {
      this.emit('load-state-changed', {
        from: prevState,
        to: this.loadState,
        load: this.currentLoad.overall
      });
      this.logger.info(`[LoadManager] Load state: ${prevState} → ${this.loadState} (${(this.currentLoad.overall * 100).toFixed(1)}%)`);
      
      // Adjust strategies based on new state
      this.adjustStrategies();
    }
  }
  
  calculateLoadState(load) {
    if (load >= this.thresholds.overload) return 'overload';
    if (load >= this.thresholds.critical) return 'critical';
    if (load >= this.thresholds.warning) return 'warning';
    return 'normal';
  }
  
  adjustStrategies() {
    switch (this.loadState) {
      case 'overload':
        // Aggressive load shedding
        this.loadSheddingActive = true;
        this.sheddingRate = 0.3; // Drop 30% of low-priority requests
        this.backpressureActive = true;
        this.backpressureDelay = 100; // 100ms delay
        this.logger.warn('[LoadManager] ⚠️ OVERLOAD - Shedding 30% of requests');
        break;
        
      case 'critical':
        // Moderate load shedding + backpressure
        this.loadSheddingActive = true;
        this.sheddingRate = 0.1; // Drop 10% of low-priority requests
        this.backpressureActive = true;
        this.backpressureDelay = 50; // 50ms delay
        this.logger.warn('[LoadManager] ⚠️ CRITICAL - Applying backpressure');
        break;
        
      case 'warning':
        // Light backpressure only
        this.loadSheddingActive = false;
        this.sheddingRate = 0;
        this.backpressureActive = true;
        this.backpressureDelay = 20; // 20ms delay
        this.logger.info('[LoadManager] ⚡ WARNING - Light backpressure active');
        break;
        
      case 'normal':
        // No restrictions
        this.loadSheddingActive = false;
        this.sheddingRate = 0;
        this.backpressureActive = false;
        this.backpressureDelay = 0;
        break;
    }
  }
  
  // ═══════════════════════════════════════════════════════════
  // REQUEST PROCESSING
  // ═══════════════════════════════════════════════════════════
  
  async processRequest(request, options = {}) {
    this.metrics.totalRequests++;
    
    const priority = options.priority || 'normal'; // high, normal, low
    const system = options.system || 'unknown';
    
    // Check circuit breaker
    if (this.isCircuitOpen(system)) {
      this.logger.warn(`[LoadManager] Circuit breaker open for ${system}`);
      return {
        allowed: false,
        reason: 'circuit_breaker',
        retryAfter: this.getCircuitBreakerRetryTime(system)
      };
    }
    
    // Load shedding - drop low priority requests
    if (this.loadSheddingActive && priority === 'low') {
      if (Math.random() < this.sheddingRate) {
        this.metrics.shedRequests++;
        this.emit('request-shed', { system, priority, load: this.currentLoad.overall });
        return {
          allowed: false,
          reason: 'load_shed',
          loadState: this.loadState
        };
      }
    }
    
    // Backpressure - delay normal and low priority
    if (this.backpressureActive && priority !== 'high') {
      if (this.backpressureDelay > 0) {
        this.metrics.delayedRequests++;
        await this.delay(this.backpressureDelay);
      }
    }
    
    return {
      allowed: true,
      delayed: this.backpressureActive,
      delayMs: this.backpressureDelay
    };
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // ═══════════════════════════════════════════════════════════
  // CIRCUIT BREAKER
  // ═══════════════════════════════════════════════════════════
  
  recordSuccess(system) {
    const breaker = this.circuitBreakers.get(system);
    if (breaker && breaker.state === 'half-open') {
      // Successful request in half-open state -> close circuit
      breaker.state = 'closed';
      breaker.failures = 0;
      this.logger.info(`[LoadManager] Circuit breaker closed for ${system}`);
    }
  }
  
  recordFailure(system) {
    if (!this.circuitBreakers.has(system)) {
      this.circuitBreakers.set(system, {
        state: 'closed',
        failures: 0,
        openedAt: null
      });
    }
    
    const breaker = this.circuitBreakers.get(system);
    
    if (breaker.state === 'closed') {
      breaker.failures++;
      
      if (breaker.failures >= this.circuitBreakerThreshold) {
        // Open the circuit
        breaker.state = 'open';
        breaker.openedAt = Date.now();
        this.metrics.circuitOpenEvents++;
        this.emit('circuit-opened', { system, failures: breaker.failures });
        this.logger.warn(`[LoadManager] ⚠️ Circuit breaker OPEN for ${system} (${breaker.failures} failures)`);
        
        // Schedule half-open attempt
        setTimeout(() => {
          if (breaker.state === 'open') {
            breaker.state = 'half-open';
            this.logger.info(`[LoadManager] Circuit breaker HALF-OPEN for ${system}`);
          }
        }, this.circuitBreakerTimeout);
      }
    } else if (breaker.state === 'half-open') {
      // Failure in half-open state -> back to open
      breaker.state = 'open';
      breaker.openedAt = Date.now();
      this.logger.warn(`[LoadManager] Circuit breaker re-opened for ${system}`);
    }
  }
  
  isCircuitOpen(system) {
    const breaker = this.circuitBreakers.get(system);
    return breaker && breaker.state === 'open';
  }
  
  getCircuitBreakerRetryTime(system) {
    const breaker = this.circuitBreakers.get(system);
    if (!breaker || !breaker.openedAt) return 0;
    
    const elapsed = Date.now() - breaker.openedAt;
    return Math.max(0, this.circuitBreakerTimeout - elapsed);
  }
  
  // ═══════════════════════════════════════════════════════════
  // STATUS & METRICS
  // ═══════════════════════════════════════════════════════════
  
  getStatus() {
    return {
      loadState: this.loadState,
      currentLoad: { ...this.currentLoad },
      loadShedding: {
        active: this.loadSheddingActive,
        rate: this.sheddingRate
      },
      backpressure: {
        active: this.backpressureActive,
        delayMs: this.backpressureDelay
      },
      circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([system, breaker]) => ({
        system,
        state: breaker.state,
        failures: breaker.failures
      })),
      metrics: { ...this.metrics }
    };
  }
  
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      shedRequests: 0,
      delayedRequests: 0,
      circuitOpenEvents: 0
    };
  }
}

// Singleton
let instance = null;

module.exports = {
  getInstance(config) {
    if (!instance) {
      instance = new LoadManager(config);
    }
    return instance;
  },
  
  LoadManager
};
