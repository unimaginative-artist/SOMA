// ═══════════════════════════════════════════════════════════
// AsyncGradientArbiter.js - Asynchronous Gradient Updates
// Non-blocking gradient synchronization for distributed training
// Target: 1.2-1.3x additional speedup via async updates
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from 'events';

/**
 * AsyncGradientArbiter
 *
 * Asynchronous gradient update system for distributed training
 * - Non-blocking gradient synchronization
 * - Stale gradient tolerance
 * - Gradient buffering and pipelining
 * - Overlap computation and communication
 * - Reduced synchronization overhead
 */
export class AsyncGradientArbiter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'AsyncGradientArbiter';
    this.trainingSwarm = config.trainingSwarm || null;

    // Async configuration
    this.asyncMode = config.asyncMode || 'hogwild'; // 'hogwild', 'delayed', 'elastic'
    this.staleTolerance = config.staleTolerance || 3; // Max gradient staleness
    this.bufferSize = config.bufferSize || 5; // Gradient buffer size
    this.updateFrequency = config.updateFrequency || 1; // Updates per iteration

    // Gradient buffers
    this.gradientBuffer = [];
    this.pendingUpdates = new Map();
    this.completedUpdates = 0;

    // Staleness tracking
    this.gradientStaleness = new Map();
    this.maxObservedStaleness = 0;

    // Metrics
    this.metrics = {
      totalUpdates: 0,
      asyncUpdates: 0,
      syncUpdates: 0,
      averageStaleness: 0,
      blockingTime: 0,
      overlapTime: 0,
      communicationOverhead: 0
    };

    console.log(`[${this.name}] ⚡ Async Gradient Arbiter initialized`);
    console.log(`[${this.name}]    Mode: ${this.asyncMode}`);
    console.log(`[${this.name}]    Stale Tolerance: ${this.staleTolerance}`);
  }

  async initialize() {
    console.log(`[${this.name}] Initializing async gradient system...`);

    try {
      console.log(`[${this.name}]    Async Mode: ${this.asyncMode.toUpperCase()}`);
      console.log(`[${this.name}]    Buffer Size: ${this.bufferSize}`);
      console.log(`[${this.name}]    Stale Tolerance: ${this.staleTolerance} iterations`);

      console.log(`[${this.name}] ✅ Async gradient system ready`);
      this.emit('initialized');

      return {
        success: true,
        mode: this.asyncMode
      };
    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to initialize:`, error.message);
      throw error;
    }
  }

  /**
   * Train with asynchronous gradient updates
   */
  async trainAsync(data, config = {}) {
    const iterations = config.iterations || 100;
    const batchSize = config.batchSize || 32;

    console.log(`\n[${this.name}] 🚀 Starting async gradient training...`);
    console.log(`[${this.name}]    Iterations: ${iterations}`);
    console.log(`[${this.name}]    Batch Size: ${batchSize}`);
    console.log(`[${this.name}]    Mode: ${this.asyncMode}\n`);

    const startTime = Date.now();
    let totalBlockingTime = 0;

    for (let i = 0; i < iterations; i++) {
      // Simulate forward pass
      const forwardStart = Date.now();
      await this.simulateForwardPass(batchSize);
      const forwardTime = Date.now() - forwardStart;

      // Compute gradients
      const gradients = this.computeGradients(batchSize);

      // Async gradient update (non-blocking)
      const updateStart = Date.now();
      await this.asyncGradientUpdate(gradients, i);
      const updateTime = Date.now() - updateStart;

      // Check if we need to wait (staleness limit)
      if (this.needsSynchronization(i)) {
        const syncStart = Date.now();
        await this.synchronize();
        totalBlockingTime += Date.now() - syncStart;
      }

      if ((i + 1) % 10 === 0) {
        console.log(`[${this.name}]    Iteration ${i + 1}/${iterations} - Staleness: ${this.getCurrentStaleness()}`);
      }
    }

    const totalTime = Date.now() - startTime;
    const avgStaleness = this.calculateAverageStaleness();

    this.metrics.totalUpdates += iterations;
    this.metrics.averageStaleness = avgStaleness;
    this.metrics.blockingTime = totalBlockingTime;
    this.metrics.overlapTime = totalTime - totalBlockingTime;

    console.log(`\n[${this.name}] ✅ Async gradient training complete`);
    console.log(`[${this.name}]    Total Time: ${totalTime}ms`);
    console.log(`[${this.name}]    Blocking Time: ${totalBlockingTime}ms (${(totalBlockingTime / totalTime * 100).toFixed(1)}%)`);
    console.log(`[${this.name}]    Overlap Time: ${(totalTime - totalBlockingTime)}ms (${((totalTime - totalBlockingTime) / totalTime * 100).toFixed(1)}%)`);
    console.log(`[${this.name}]    Avg Staleness: ${avgStaleness.toFixed(2)} iterations`);
    console.log(`[${this.name}]    Max Staleness: ${this.maxObservedStaleness} iterations\n`);

    return {
      success: true,
      totalTime,
      blockingTime: totalBlockingTime,
      overlapTime: totalTime - totalBlockingTime,
      averageStaleness: avgStaleness
    };
  }

  /**
   * Train with synchronous gradient updates (for comparison)
   */
  async trainSync(data, config = {}) {
    const iterations = config.iterations || 100;
    const batchSize = config.batchSize || 32;

    console.log(`\n[${this.name}] 🔄 Starting sync gradient training...`);
    console.log(`[${this.name}]    Iterations: ${iterations}`);
    console.log(`[${this.name}]    Batch Size: ${batchSize}\n`);

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      // Simulate forward pass
      await this.simulateForwardPass(batchSize);

      // Compute gradients
      const gradients = this.computeGradients(batchSize);

      // Synchronous gradient update (blocking)
      await this.syncGradientUpdate(gradients);

      if ((i + 1) % 10 === 0) {
        console.log(`[${this.name}]    Iteration ${i + 1}/${iterations}`);
      }
    }

    const totalTime = Date.now() - startTime;

    console.log(`\n[${this.name}] ✅ Sync gradient training complete`);
    console.log(`[${this.name}]    Total Time: ${totalTime}ms\n`);

    return {
      success: true,
      totalTime
    };
  }

  /**
   * Asynchronous gradient update (non-blocking)
   */
  async asyncGradientUpdate(gradients, iteration) {
    // Add to buffer
    this.gradientBuffer.push({
      gradients,
      iteration,
      timestamp: Date.now()
    });

    // Track staleness
    this.gradientStaleness.set(iteration, 0);

    this.metrics.asyncUpdates++;

    // Non-blocking: fire and forget
    // In real impl, would send to parameter server without waiting
    return Promise.resolve();
  }

  /**
   * Synchronous gradient update (blocking)
   */
  async syncGradientUpdate(gradients) {
    // Simulate communication latency
    await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 5));

    this.metrics.syncUpdates++;
    this.metrics.communicationOverhead += 7; // Average communication time
  }

  /**
   * Check if synchronization is needed
   */
  needsSynchronization(iteration) {
    // Check if any gradient is too stale
    for (const [iter, staleness] of this.gradientStaleness) {
      if (iteration - iter > this.staleTolerance) {
        return true;
      }
    }

    return false;
  }

  /**
   * Force synchronization
   */
  async synchronize() {
    // Wait for pending gradients
    const syncTime = 10 + Math.random() * 10;
    await new Promise(resolve => setTimeout(resolve, syncTime));

    // Clear old gradients
    const currentIter = this.completedUpdates;
    for (const [iter, staleness] of this.gradientStaleness) {
      if (currentIter - iter > this.staleTolerance) {
        this.gradientStaleness.delete(iter);
      }
    }

    this.completedUpdates++;
  }

  /**
   * Get current gradient staleness
   */
  getCurrentStaleness() {
    if (this.gradientStaleness.size === 0) return 0;

    const stalenesses = Array.from(this.gradientStaleness.values());
    const maxStaleness = Math.max(...stalenesses);

    this.maxObservedStaleness = Math.max(this.maxObservedStaleness, maxStaleness);

    return maxStaleness;
  }

  /**
   * Calculate average staleness
   */
  calculateAverageStaleness() {
    if (this.gradientStaleness.size === 0) return 0;

    const stalenesses = Array.from(this.gradientStaleness.values());
    const sum = stalenesses.reduce((a, b) => a + b, 0);

    return sum / stalenesses.length;
  }

  /**
   * Simulate forward pass
   */
  async simulateForwardPass(batchSize) {
    // Simulate computation time
    const computeTime = 15 + Math.random() * 10;
    await new Promise(resolve => setTimeout(resolve, computeTime));
  }

  /**
   * Compute gradients
   */
  computeGradients(batchSize) {
    return Array.from({ length: 10 }, () => Math.random() - 0.5);
  }

  /**
   * Run benchmark comparing sync vs async
   */
  async runBenchmark(config = {}) {
    const iterations = config.iterations || 100;
    const batchSize = config.batchSize || 32;

    console.log(`\n[${this.name}] Running Sync vs Async benchmark...`);
    console.log(`[${this.name}]    Iterations: ${iterations}`);
    console.log(`[${this.name}]    Batch Size: ${batchSize}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Benchmark sync
    const syncResult = await this.trainSync([], { iterations, batchSize });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Reset metrics
    this.gradientBuffer = [];
    this.gradientStaleness.clear();
    this.maxObservedStaleness = 0;

    // Benchmark async
    const asyncResult = await this.trainAsync([], { iterations, batchSize });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Calculate speedup
    const speedup = syncResult.totalTime / asyncResult.totalTime;
    const timeReduction = syncResult.totalTime - asyncResult.totalTime;
    const percentFaster = (timeReduction / syncResult.totalTime * 100);

    console.log(`[${this.name}] ⚡ Performance Comparison:`);
    console.log(`[${this.name}]    Sync Time: ${syncResult.totalTime}ms`);
    console.log(`[${this.name}]    Async Time: ${asyncResult.totalTime}ms`);
    console.log(`[${this.name}]    Speedup: ${speedup.toFixed(2)}x faster`);
    console.log(`[${this.name}]    Time Saved: ${timeReduction}ms (${percentFaster.toFixed(1)}% faster)`);
    console.log(`[${this.name}]    Overlap Efficiency: ${(asyncResult.overlapTime / asyncResult.totalTime * 100).toFixed(1)}%\n`);

    return {
      sync: syncResult,
      async: asyncResult,
      speedup,
      timeReduction
    };
  }

  /**
   * Get arbiter status
   */
  getStatus() {
    return {
      name: this.name,
      mode: this.asyncMode,
      staleTolerance: this.staleTolerance,
      bufferSize: this.bufferSize,
      gradientBufferUsage: this.gradientBuffer.length,
      currentStaleness: this.getCurrentStaleness(),
      maxStaleness: this.maxObservedStaleness,
      metrics: this.metrics
    };
  }

  async shutdown() {
    console.log(`[${this.name}] Shutting down async gradient arbiter...`);

    this.gradientBuffer = [];
    this.pendingUpdates.clear();
    this.gradientStaleness.clear();

    this.emit('shutdown');
    return { success: true };
  }
}

export default AsyncGradientArbiter;
