/**
 * Watchdog.js - SOMA Self-Healing System
 * 
 * Monitors system health, diagnoses issues, and automatically repairs.
 * Can call tools, request help from other arbiters, and learn from failures.
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export class Watchdog extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.name = 'Watchdog';
    this.checkInterval = config.checkInterval || 30000; // 30 seconds
    this.maxRecoveryAttempts = config.maxRecoveryAttempts || 3;
    
    // Persistence path for learned fixes
    this.persistPath = config.persistPath || join(process.cwd(), '.soma', 'watchdog-knowledge.json');
    
    this.components = new Map();
    this.recoveryAttempts = new Map();
    this.timer = null;
    this.running = false;
    
    // Repair tools and helpers
    this.repairTools = new Map();
    this.helperArbiters = new Map();
    
    // Error patterns and known fixes (load persisted + defaults)
    this.knownFixes = new Map([
      ['EADDRINUSE', { action: 'kill_port', description: 'Port already in use' }],
      ['ECONNREFUSED', { action: 'restart_service', description: 'Connection refused' }],
      ['ENOMEM', { action: 'clear_cache', description: 'Out of memory' }],
      ['match is not a function', { action: 'type_coercion', description: 'Type mismatch' }],
      ['store is not a function', { action: 'method_alias', description: 'Missing method' }],
      ['Cannot read properties of undefined', { action: 'null_check', description: 'Null reference' }],
      ['timeout', { action: 'increase_timeout', description: 'Operation timed out' }]
    ]);
    
    // Repair history for learning
    this.repairHistory = [];
    
    // Load persisted knowledge
    this._loadKnowledge();
    
    console.log(`[Watchdog] 🐕 Self-Healing Watchdog initialized`);
  }

  /**
   * Load persisted knowledge from disk
   */
  _loadKnowledge() {
    try {
      if (existsSync(this.persistPath)) {
        const data = JSON.parse(readFileSync(this.persistPath, 'utf8'));
        
        // Restore learned fixes
        if (data.learnedFixes && Array.isArray(data.learnedFixes)) {
          for (const [pattern, fix] of data.learnedFixes) {
            if (!this.knownFixes.has(pattern)) {
              this.knownFixes.set(pattern, { ...fix, learned: true, restored: true });
            }
          }
          console.log(`[Watchdog] 🧠 Restored ${data.learnedFixes.length} learned fix patterns`);
        }
        
        // Restore repair history (last 100)
        if (data.repairHistory && Array.isArray(data.repairHistory)) {
          this.repairHistory = data.repairHistory.slice(-100);
          console.log(`[Watchdog] 📚 Restored ${this.repairHistory.length} repair history entries`);
        }
      }
    } catch (e) {
      console.warn(`[Watchdog] ⚠️ Could not load persisted knowledge: ${e.message}`);
    }
  }

  /**
   * Save learned knowledge to disk
   */
  _saveKnowledge() {
    try {
      // Ensure directory exists
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      // Only save learned fixes (not built-in ones)
      const learnedFixes = [];
      for (const [pattern, fix] of this.knownFixes) {
        if (fix.learned) {
          learnedFixes.push([pattern, fix]);
        }
      }
      
      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        learnedFixes,
        repairHistory: this.repairHistory.slice(-100) // Keep last 100
      };
      
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
      console.log(`[Watchdog] 💾 Saved ${learnedFixes.length} learned fixes to disk`);
    } catch (e) {
      console.warn(`[Watchdog] ⚠️ Could not save knowledge: ${e.message}`);
    }
  }

  /**
   * Register a component to watch
   */
  watch(name, healthCheck, recoveryFn = null) {
    this.components.set(name, {
      name,
      healthCheck,
      recoveryFn,
      lastStatus: 'unknown',
      lastCheck: null
    });
    this.recoveryAttempts.set(name, 0);
    
    console.log(`[Watchdog] 👁️ Now watching: ${name}`);
  }

  /**
   * Start the watchdog
   */
  start() {
    if (this.running) return;
    
    this.running = true;
    console.log(`[Watchdog] 🚀 Watchdog started (checking every ${this.checkInterval/1000}s)`);
    
    // Initial check
    this.checkAll();
    
    // Periodic checks
    this.timer = setInterval(() => this.checkAll(), this.checkInterval);
  }

  /**
   * Stop the watchdog
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log(`[Watchdog] 🛑 Watchdog stopped`);
  }

  /**
   * Check all components
   */
  async checkAll() {
    const results = {
      healthy: [],
      unhealthy: [],
      recovered: [],
      failed: []
    };

    for (const [name, component] of this.components) {
      try {
        const healthy = await this._checkComponent(name, component);
        
        if (healthy) {
          results.healthy.push(name);
          component.lastStatus = 'healthy';
          this.recoveryAttempts.set(name, 0);
        } else {
          results.unhealthy.push(name);
          component.lastStatus = 'unhealthy';
          
          // Attempt recovery
          if (component.recoveryFn) {
            const recovered = await this._attemptRecovery(name, component);
            if (recovered) {
              results.recovered.push(name);
            } else {
              results.failed.push(name);
            }
          }
        }
        
        component.lastCheck = Date.now();
      } catch (error) {
        console.error(`[Watchdog] ❌ Error checking ${name}: ${error.message}`);
        results.unhealthy.push(name);
      }
    }

    // Emit status update
    this.emit('status', results);
    
    // Log summary if issues found
    if (results.unhealthy.length > 0 || results.recovered.length > 0) {
      console.log(`[Watchdog] 📊 Health Check: ${results.healthy.length} healthy, ${results.unhealthy.length} unhealthy, ${results.recovered.length} recovered`);
    }

    return results;
  }

  /**
   * Check a single component
   */
  async _checkComponent(name, component) {
    try {
      const result = await component.healthCheck();
      return result === true || (result && result.healthy);
    } catch {
      return false;
    }
  }

  /**
   * Attempt to recover a component
   */
  async _attemptRecovery(name, component) {
    const attempts = this.recoveryAttempts.get(name) || 0;
    
    if (attempts >= this.maxRecoveryAttempts) {
      console.error(`[Watchdog] 💀 ${name} exceeded max recovery attempts (${this.maxRecoveryAttempts})`);
      this.emit('component_failed', { name, attempts });
      return false;
    }

    console.log(`[Watchdog] 🔄 Attempting recovery for ${name} (attempt ${attempts + 1}/${this.maxRecoveryAttempts})`);
    this.recoveryAttempts.set(name, attempts + 1);

    try {
      await component.recoveryFn();
      
      // Verify recovery worked
      const healthy = await this._checkComponent(name, component);
      
      if (healthy) {
        console.log(`[Watchdog] ✅ ${name} recovered successfully!`);
        this.emit('component_recovered', { name });
        this.recoveryAttempts.set(name, 0);
        return true;
      }
    } catch (error) {
      console.error(`[Watchdog] ❌ Recovery failed for ${name}: ${error.message}`);
    }

    return false;
  }

  /**
   * Get current status
   */
  getStatus() {
    const status = {};
    
    for (const [name, component] of this.components) {
      status[name] = {
        status: component.lastStatus,
        lastCheck: component.lastCheck,
        recoveryAttempts: this.recoveryAttempts.get(name) || 0
      };
    }
    
    return status;
  }

  // ============================================
  // SELF-HEALING CAPABILITIES
  // ============================================

  /**
   * Register a repair tool
   */
  registerTool(name, toolFn) {
    this.repairTools.set(name, toolFn);
    console.log(`[Watchdog] 🔧 Registered repair tool: ${name}`);
  }

  /**
   * Register a helper arbiter that can assist with repairs
   */
  registerHelper(name, arbiter) {
    this.helperArbiters.set(name, arbiter);
    console.log(`[Watchdog] 🤝 Registered helper arbiter: ${name}`);
  }

  /**
   * Diagnose an error and find potential fixes
   */
  diagnose(error) {
    const errorStr = error?.message || error?.toString() || String(error);
    const diagnosis = {
      error: errorStr,
      patterns: [],
      suggestedFixes: [],
      confidence: 0
    };

    // Check known error patterns
    for (const [pattern, fix] of this.knownFixes) {
      if (errorStr.includes(pattern)) {
        diagnosis.patterns.push(pattern);
        diagnosis.suggestedFixes.push(fix);
        diagnosis.confidence = Math.max(diagnosis.confidence, 0.8);
      }
    }

    // Check repair history for similar errors
    const similarRepairs = this.repairHistory.filter(r => 
      r.error.includes(errorStr.substring(0, 50)) && r.success
    );
    
    if (similarRepairs.length > 0) {
      diagnosis.previousFixes = similarRepairs.map(r => r.action);
      diagnosis.confidence = Math.max(diagnosis.confidence, 0.9);
    }

    return diagnosis;
  }

  /**
   * Attempt to repair an error using available tools and helpers
   */
  async repair(componentName, error) {
    console.log(`[Watchdog] 🔬 Diagnosing error in ${componentName}...`);
    
    const diagnosis = this.diagnose(error);
    console.log(`[Watchdog] 📋 Diagnosis: ${diagnosis.suggestedFixes.length} potential fixes (confidence: ${(diagnosis.confidence * 100).toFixed(0)}%)`);

    // Try suggested fixes
    for (const fix of diagnosis.suggestedFixes) {
      console.log(`[Watchdog] 🔧 Attempting fix: ${fix.action} (${fix.description})`);
      
      const repaired = await this._executeFix(fix.action, componentName, error);
      
      // Record attempt
      this.repairHistory.push({
        timestamp: Date.now(),
        component: componentName,
        error: error?.message || String(error),
        action: fix.action,
        success: repaired
      });

      if (repaired) {
        console.log(`[Watchdog] ✅ Fix successful: ${fix.action}`);
        this.emit('repair_success', { component: componentName, fix: fix.action });
        return true;
      }
    }

    // If no fixes worked, ask helper arbiters for assistance
    if (this.helperArbiters.size > 0) {
      console.log(`[Watchdog] 🆘 Requesting help from arbiters...`);
      return await this._requestArbiterHelp(componentName, error, diagnosis);
    }

    console.log(`[Watchdog] ❌ Could not repair ${componentName}`);
    return false;
  }

  /**
   * Execute a specific fix action
   */
  async _executeFix(action, componentName, error) {
    try {
      // Check if we have a tool for this action
      if (this.repairTools.has(action)) {
        const tool = this.repairTools.get(action);
        await tool(componentName, error);
        return true;
      }

      // Built-in fixes
      switch (action) {
        case 'kill_port':
          return await this._killPort(error);
        
        case 'clear_cache':
          return await this._clearCache(componentName);
        
        case 'restart_service':
          const component = this.components.get(componentName);
          if (component?.recoveryFn) {
            await component.recoveryFn();
            return true;
          }
          return false;
        
        case 'type_coercion':
        case 'method_alias':
        case 'null_check':
          // These need code changes - log for later
          console.log(`[Watchdog] ⚠️ ${action} requires code fix - logging for review`);
          this.emit('code_fix_needed', { component: componentName, action, error: error?.message });
          return false;
        
        case 'increase_timeout':
          console.log(`[Watchdog] ⏱️ Timeout issue detected - will retry with longer timeout`);
          return false; // Can't fix timeout directly
        
        default:
          console.log(`[Watchdog] ⚠️ Unknown fix action: ${action}`);
          return false;
      }
    } catch (e) {
      console.error(`[Watchdog] ❌ Fix ${action} failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Request help from registered helper arbiters using escalation hierarchy
   * Order: ImmuneSystem → MicroAgentPool → FragmentRegistry → QuadBrain
   */
  async _requestArbiterHelp(componentName, error, diagnosis) {
    // Define escalation order (most specific to most general)
    const escalationOrder = [
      'ImmuneSystem',      // First: Try self-healing system
      'MicroAgentPool',    // Second: Spawn swarm agent
      'FragmentRegistry',  // Third: Find specialist
      'QuadBrain'          // Last resort: Reason about fix
    ];

    // Try helpers in escalation order
    for (const helperName of escalationOrder) {
      const arbiter = this.helperArbiters.get(helperName);
      if (!arbiter) continue;

      try {
        console.log(`[Watchdog] 🔄 Escalating to ${helperName}...`);
        const result = await this._tryHelper(helperName, arbiter, componentName, error, diagnosis);
        
        if (result) {
          console.log(`[Watchdog] ✅ ${helperName} successfully repaired ${componentName}`);
          this.learnFromRepair(error, `helper_${helperName.toLowerCase()}`, true);
          return true;
        }
      } catch (e) {
        console.error(`[Watchdog] ❌ ${helperName} failed: ${e.message}`);
      }
    }

    // Try any other registered helpers not in escalation order
    for (const [name, arbiter] of this.helperArbiters) {
      if (escalationOrder.includes(name)) continue; // Already tried
      
      try {
        console.log(`[Watchdog] 🤖 Asking ${name} for help...`);
        const result = await this._tryHelper(name, arbiter, componentName, error, diagnosis);
        if (result) return true;
      } catch (e) {
        console.error(`[Watchdog] ❌ ${name} failed: ${e.message}`);
      }
    }

    return false;
  }

  /**
   * Try a specific helper arbiter for repair
   */
  async _tryHelper(name, arbiter, componentName, error, diagnosis) {
    // Check if arbiter can help
    if (arbiter.canHelp && !await arbiter.canHelp(componentName, error)) {
      return false;
    }

    // Different helpers have different interfaces
    switch (name) {
      case 'ImmuneSystem':
        if (arbiter.heal) {
          const result = await arbiter.heal(componentName, error);
          return result?.healed || result?.success || result === true;
        }
        if (arbiter.diagnoseAndHeal) {
          const result = await arbiter.diagnoseAndHeal({ component: componentName, error });
          return result?.healed || result?.success;
        }
        break;

      case 'MicroAgentPool':
        if (arbiter.spawn) {
          const agent = await arbiter.spawn({
            task: 'repair',
            target: componentName,
            error: error?.message,
            diagnosis,
            priority: 'critical'
          });
          // Wait for agent to complete
          if (agent?.id && arbiter.waitForCompletion) {
            const result = await arbiter.waitForCompletion(agent.id, 30000);
            return result?.success;
          }
          return agent?.success || agent?.spawned;
        }
        break;

      case 'FragmentRegistry':
        if (arbiter.findExpert) {
          const expert = await arbiter.findExpert(componentName);
          if (expert?.repair) {
            const result = await expert.repair(error, diagnosis);
            return result?.success || result === true;
          }
          if (expert?.handle) {
            const result = await expert.handle({ action: 'repair', target: componentName, error });
            return result?.success;
          }
        }
        if (arbiter.delegateTask) {
          const result = await arbiter.delegateTask({
            type: 'repair',
            component: componentName,
            error: error?.message
          });
          return result?.success;
        }
        break;

      case 'QuadBrain':
        if (arbiter.reason) {
          const query = `SYSTEM REPAIR NEEDED: Component "${componentName}" has error: ${error?.message}. 
Diagnosis: ${JSON.stringify(diagnosis.suggestedFixes)}.
What specific steps should I take to fix this? Respond with actionable repair steps.`;
          
          const result = await arbiter.reason(query, 'fast');
          
          // QuadBrain provides guidance, not direct fix
          // Log the suggestion and emit event
          if (result?.text) {
            console.log(`[Watchdog] 🧠 QuadBrain suggests: ${result.text.substring(0, 200)}...`);
            this.emit('repair_suggestion', { 
              component: componentName, 
              suggestion: result.text,
              confidence: result.confidence 
            });
            // QuadBrain can't directly fix, but provides valuable info
            return false; // Return false so we don't claim success
          }
        }
        break;

      default:
        // Generic helper interface
        if (arbiter.repair) {
          const result = await arbiter.repair(componentName, error, diagnosis);
          return result?.success || result?.fixed || result === true;
        }
        if (arbiter.handle) {
          const result = await arbiter.handle({ action: 'repair', component: componentName, error });
          return result?.success;
        }
    }

    return false;
  }

  /**
   * Built-in: Kill process on port
   */
  async _killPort(error) {
    const portMatch = error?.message?.match(/port (\d+)/i);
    if (!portMatch) return false;
    
    const port = portMatch[1];
    console.log(`[Watchdog] 🔪 Attempting to kill process on port ${port}`);
    
    // This would need OS-specific implementation
    // For now, just emit an event
    this.emit('kill_port_requested', { port });
    return false; // Can't actually kill without shell access
  }

  /**
   * Built-in: Clear cache for component
   */
  async _clearCache(componentName) {
    const component = this.components.get(componentName);
    if (!component?.instance) return false;

    // Try common cache clearing methods
    const methods = ['clearCache', 'flushCache', 'reset', 'clear'];
    
    for (const method of methods) {
      if (typeof component.instance[method] === 'function') {
        try {
          await component.instance[method]();
          console.log(`[Watchdog] 🧹 Cleared cache via ${method}()`);
          return true;
        } catch (e) {
          // Try next method
        }
      }
    }

    return false;
  }

  /**
   * Learn from successful repairs to improve future diagnostics
   */
  learnFromRepair(error, action, success) {
    if (success) {
      const errorKey = error?.message?.substring(0, 50) || String(error).substring(0, 50);
      
      // Add to known fixes if not already there
      if (!this.knownFixes.has(errorKey)) {
        this.knownFixes.set(errorKey, {
          action,
          description: `Learned fix for: ${errorKey}`,
          learned: true,
          learnedAt: new Date().toISOString(),
          successCount: 1
        });
        console.log(`[Watchdog] 🧠 Learned new fix pattern: ${errorKey} -> ${action}`);
        
        // Persist immediately
        this._saveKnowledge();
      } else {
        // Increment success count for existing fix
        const fix = this.knownFixes.get(errorKey);
        if (fix.learned) {
          fix.successCount = (fix.successCount || 0) + 1;
          fix.lastUsed = new Date().toISOString();
        }
      }
    }
  }

  /**
   * Get repair history
   */
  getRepairHistory(limit = 50) {
    return this.repairHistory.slice(-limit);
  }
}

export default Watchdog;
