/**
 * SafeArbiter.js - Error Boundary Wrapper for Arbiters
 * 
 * Wraps any arbiter to prevent crashes from propagating.
 * Failed arbiters degrade gracefully instead of killing SOMA.
 * 
 * NEW: Integrates with Watchdog for automatic self-healing chain:
 * SafeArbiter → Watchdog → ImmuneSystem → MicroAgentPool
 */

export class SafeArbiter {
  constructor(arbiterClass, config = {}, dependencies = {}) {
    this.arbiterClass = arbiterClass;
    this.config = config;
    this.dependencies = dependencies;
    this.instance = null;
    this.healthy = false;
    this.errorCount = 0;
    this.lastError = null;
    this.name = config.name || arbiterClass.name || 'UnknownArbiter';
    
    // Watchdog integration for self-healing
    this.watchdog = null;
    this.autoHeal = config.autoHeal !== false; // Enable by default
    this.healingInProgress = false;
  }

  /**
   * Connect to Watchdog for automatic healing
   */
  setWatchdog(watchdog) {
    this.watchdog = watchdog;
    console.log(`[SafeArbiter] 🐕 ${this.name} connected to Watchdog`);
  }

  /**
   * Safely initialize the arbiter
   */
  async initialize() {
    try {
      this.instance = new this.arbiterClass(this.config);
      
      if (this.instance.initialize) {
        await this.instance.initialize(this.dependencies);
      }
      
      this.healthy = true;
      console.log(`[SafeArbiter] ✅ ${this.name} initialized successfully`);
      return true;
    } catch (error) {
      this.healthy = false;
      this.lastError = error;
      this.errorCount++;
      console.error(`[SafeArbiter] ❌ ${this.name} failed to initialize: ${error.message}`);
      return false;
    }
  }

  /**
   * Safely call any method on the arbiter
   */
  async call(method, ...args) {
    if (!this.healthy || !this.instance) {
      console.warn(`[SafeArbiter] ⚠️ ${this.name} is unhealthy, returning fallback`);
      
      // Trigger healing if not already in progress
      if (this.autoHeal && !this.healingInProgress) {
        this._triggerHealing(this.lastError || new Error('Arbiter unhealthy'));
      }
      
      return this._getFallback(method);
    }

    if (typeof this.instance[method] !== 'function') {
      console.warn(`[SafeArbiter] ⚠️ ${this.name}.${method} is not a function`);
      return this._getFallback(method);
    }

    try {
      const result = await this.instance[method](...args);
      this.errorCount = Math.max(0, this.errorCount - 1); // Recover on success
      return result;
    } catch (error) {
      this.errorCount++;
      this.lastError = error;
      console.error(`[SafeArbiter] ❌ ${this.name}.${method}() failed: ${error.message}`);
      
      // Mark unhealthy after 3 consecutive errors
      if (this.errorCount >= 3) {
        this.healthy = false;
        console.error(`[SafeArbiter] 🔴 ${this.name} marked unhealthy after ${this.errorCount} errors`);
        
        // Trigger Watchdog → ImmuneSystem healing chain
        if (this.autoHeal) {
          this._triggerHealing(error);
        }
      }
      
      return this._getFallback(method);
    }
  }

  /**
   * Trigger the self-healing chain: SafeArbiter → Watchdog → ImmuneSystem
   */
  async _triggerHealing(error) {
    if (this.healingInProgress) return;
    this.healingInProgress = true;
    
    console.log(`[SafeArbiter] 🏥 Triggering self-healing for ${this.name}...`);
    
    try {
      // If Watchdog is connected, use full healing chain
      if (this.watchdog) {
        console.log(`[SafeArbiter] 🐕 Calling Watchdog.repair() for ${this.name}`);
        const repaired = await this.watchdog.repair(this.name, error);
        
        if (repaired) {
          console.log(`[SafeArbiter] ✅ ${this.name} healed by Watchdog chain!`);
          // Attempt to reinitialize
          await this.recover();
        }
      } else {
        // No Watchdog - try direct recovery
        console.log(`[SafeArbiter] 🔄 No Watchdog connected, attempting direct recovery...`);
        await this.recover();
      }
    } catch (healError) {
      console.error(`[SafeArbiter] ❌ Healing failed for ${this.name}: ${healError.message}`);
    } finally {
      this.healingInProgress = false;
    }
  }

  /**
   * Get fallback response for failed calls
   */
  _getFallback(method) {
    // Common fallbacks based on method name patterns
    if (method.startsWith('get') || method.startsWith('fetch')) {
      return null;
    }
    if (method.includes('list') || method.includes('List')) {
      return [];
    }
    if (method === 'reason' || method === 'think' || method === 'analyze') {
      return { 
        text: `I'm having trouble with my ${this.name} right now. Let me try a simpler approach.`,
        fallback: true,
        error: this.lastError?.message 
      };
    }
    return { success: false, fallback: true };
  }

  /**
   * Attempt to recover a failed arbiter
   */
  async recover() {
    console.log(`[SafeArbiter] 🔄 Attempting to recover ${this.name}...`);
    this.errorCount = 0;
    return await this.initialize();
  }

  /**
   * Get health status
   */
  getStatus() {
    return {
      name: this.name,
      healthy: this.healthy,
      errorCount: this.errorCount,
      lastError: this.lastError?.message || null
    };
  }

  /**
   * Proxy access to the underlying instance
   */
  get raw() {
    return this.instance;
  }
}

/**
 * Helper to wrap multiple arbiters
 */
export function wrapArbiters(arbiters) {
  const wrapped = {};
  
  for (const [name, { Class, config, deps }] of Object.entries(arbiters)) {
    wrapped[name] = new SafeArbiter(Class, { name, ...config }, deps);
  }
  
  return wrapped;
}

export default SafeArbiter;
