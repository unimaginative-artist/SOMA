/**
 * OutcomeTracker.js - SOMA Outcome Tracking System
 *
 * THE KEYSTONE FOR LEARNING - Tracks every action's outcome so SOMA can learn what works.
 *
 * Central system that records:
 * - What action was taken
 * - Who took it (which agent/arbiter)
 * - What was the result
 * - What was the reward/fitness score
 * - Context and metadata
 *
 * Used by:
 * - GenomeArbiter: Learn which genome parameters work
 * - SelfModificationArbiter: Learn which optimization strategies work
 * - CognitiveLoopEngine: Learn which reasoning approaches work
 * - TrainingSwarmArbiter: Learn which node allocations work
 * - ALL arbiters: Learn from every decision
 */

import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class OutcomeTracker extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      storageDir: config.storageDir || path.join(__dirname, '../data/outcomes'),
      maxInMemory: config.maxInMemory || 10000,
      persistInterval: config.persistInterval || 60000, // 1 minute
      enablePersistence: config.enablePersistence !== false,
      ...config
    };

    // In-memory outcome storage (fast access)
    this.outcomes = new Map(); // outcome_id -> outcome
    this.outcomesByAgent = new Map(); // agent_id -> Set of outcome_ids
    this.outcomesByAction = new Map(); // action_type -> Set of outcome_ids
    this.outcomesByTimestamp = []; // sorted array of {timestamp, outcome_id}

    // Metrics
    this.stats = {
      totalOutcomes: 0,
      successfulOutcomes: 0,
      failedOutcomes: 0,
      averageReward: 0,
      outcomesByType: {},
      outcomesByAgent: {},
      lastPersist: null
    };

    // Persistence
    this.persistTimer = null;
    this.initialized = false;
  }

  /**
   * Initialize the tracker
   */
  async initialize() {
    if (this.initialized) return;

    console.log('[OutcomeTracker] Initializing...');

    // Create storage directory
    if (this.config.enablePersistence) {
      try {
        await fs.mkdir(this.config.storageDir, { recursive: true });
        console.log(`[OutcomeTracker] Storage directory ready: ${this.config.storageDir}`);
      } catch (error) {
        console.error('[OutcomeTracker] Failed to create storage directory:', error);
      }
    }

    // Load existing outcomes
    await this.loadOutcomes();

    // Clean up old timestamped outcome files (keep only outcomes_current.json)
    await this.cleanupOldOutcomeFiles();

    // Start persistence timer
    if (this.config.enablePersistence) {
      this.persistTimer = setInterval(() => {
        this.persistOutcomes().catch(err =>
          console.error('[OutcomeTracker] Auto-persist failed:', err)
        );
      }, this.config.persistInterval);
    }

    this.initialized = true;
    console.log('[OutcomeTracker] Initialized successfully');
    this.emit('initialized', { stats: this.stats });
  }

  /**
   * Record an outcome
   *
   * @param {Object} outcome - The outcome to record
   * @param {string} outcome.agent - Agent/arbiter that took the action
   * @param {string} outcome.action - Action type (e.g., "optimize", "train", "think")
   * @param {Object} outcome.context - Input state/context when action was taken
   * @param {*} outcome.result - Result of the action
   * @param {number} outcome.reward - Reward/fitness score (-1 to 1, or custom scale)
   * @param {boolean} outcome.success - Whether action was successful
   * @param {number} [outcome.duration] - How long action took (ms)
   * @param {Object} [outcome.metadata] - Additional metadata
   * @returns {string} outcome_id
   */
  recordOutcome(outcome) {
    // Validate required fields
    if (!outcome.agent || !outcome.action) {
      throw new Error('OutcomeTracker: agent and action are required');
    }

    // Generate unique ID
    const outcomeId = `outcome_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    // Create standardized outcome
    const standardizedOutcome = {
      id: outcomeId,
      agent: outcome.agent,
      action: outcome.action,
      context: outcome.context || {},
      result: outcome.result,
      reward: outcome.reward !== undefined ? outcome.reward : (outcome.success ? 1 : -1),
      success: outcome.success !== undefined ? outcome.success : (outcome.reward > 0),
      duration: outcome.duration || null,
      metadata: outcome.metadata || {},
      timestamp,
      recorded: new Date(timestamp).toISOString()
    };

    // Store in memory
    this.outcomes.set(outcomeId, standardizedOutcome);

    // Index by agent
    if (!this.outcomesByAgent.has(outcome.agent)) {
      this.outcomesByAgent.set(outcome.agent, new Set());
    }
    this.outcomesByAgent.get(outcome.agent).add(outcomeId);

    // Index by action type
    if (!this.outcomesByAction.has(outcome.action)) {
      this.outcomesByAction.set(outcome.action, new Set());
    }
    this.outcomesByAction.get(outcome.action).add(outcomeId);

    // Index by timestamp (maintain sorted order)
    this.outcomesByTimestamp.push({ timestamp, id: outcomeId });

    // Keep sorted (only sort if getting too large)
    if (this.outcomesByTimestamp.length % 100 === 0) {
      this.outcomesByTimestamp.sort((a, b) => a.timestamp - b.timestamp);
    }

    // Update stats
    this.stats.totalOutcomes++;
    if (standardizedOutcome.success) {
      this.stats.successfulOutcomes++;
    } else {
      this.stats.failedOutcomes++;
    }

    // Update average reward (running average)
    const n = this.stats.totalOutcomes;
    this.stats.averageReward = ((this.stats.averageReward * (n - 1)) + standardizedOutcome.reward) / n;

    // Update type stats
    if (!this.stats.outcomesByType[outcome.action]) {
      this.stats.outcomesByType[outcome.action] = { count: 0, successRate: 0, avgReward: 0 };
    }
    const typeStats = this.stats.outcomesByType[outcome.action];
    typeStats.count++;
    typeStats.successRate = (typeStats.successRate * (typeStats.count - 1) + (standardizedOutcome.success ? 1 : 0)) / typeStats.count;
    typeStats.avgReward = (typeStats.avgReward * (typeStats.count - 1) + standardizedOutcome.reward) / typeStats.count;

    // Update agent stats
    if (!this.stats.outcomesByAgent[outcome.agent]) {
      this.stats.outcomesByAgent[outcome.agent] = { count: 0, successRate: 0, avgReward: 0 };
    }
    const agentStats = this.stats.outcomesByAgent[outcome.agent];
    agentStats.count++;
    agentStats.successRate = (agentStats.successRate * (agentStats.count - 1) + (standardizedOutcome.success ? 1 : 0)) / agentStats.count;
    agentStats.avgReward = (agentStats.avgReward * (agentStats.count - 1) + standardizedOutcome.reward) / agentStats.count;

    // Enforce memory limit
    if (this.outcomes.size > this.config.maxInMemory) {
      this.evictOldestOutcomes(Math.floor(this.config.maxInMemory * 0.1)); // Evict 10%
    }

    // Emit event
    this.emit('outcome', standardizedOutcome);

    console.log(`[OutcomeTracker] Recorded: ${outcome.agent} -> ${outcome.action} | Success: ${standardizedOutcome.success} | Reward: ${standardizedOutcome.reward.toFixed(3)}`);

    return outcomeId;
  }

  /**
   * Query outcomes
   *
   * @param {Object} query - Query parameters
   * @param {string} [query.agent] - Filter by agent
   * @param {string} [query.action] - Filter by action type
   * @param {boolean} [query.success] - Filter by success/failure
   * @param {number} [query.minReward] - Minimum reward threshold
   * @param {number} [query.maxReward] - Maximum reward threshold
   * @param {number} [query.since] - Timestamp to query from
   * @param {number} [query.until] - Timestamp to query until
   * @param {number} [query.limit] - Max results to return
   * @param {string} [query.sortBy] - Sort by: 'timestamp', 'reward'
   * @param {string} [query.order] - Sort order: 'asc', 'desc'
   * @returns {Array} Matching outcomes
   */
  queryOutcomes(query = {}) {
    let results = [];

    // Start with agent or action filter if provided (most efficient)
    if (query.agent) {
      const outcomeIds = this.outcomesByAgent.get(query.agent) || [];
      results = Array.from(outcomeIds).map(id => this.outcomes.get(id)).filter(o => o);
    } else if (query.action) {
      const outcomeIds = this.outcomesByAction.get(query.action) || [];
      results = Array.from(outcomeIds).map(id => this.outcomes.get(id)).filter(o => o);
    } else {
      // No index available, scan all
      results = Array.from(this.outcomes.values());
    }

    // Apply filters
    if (query.success !== undefined) {
      results = results.filter(o => o.success === query.success);
    }

    if (query.minReward !== undefined) {
      results = results.filter(o => o.reward >= query.minReward);
    }

    if (query.maxReward !== undefined) {
      results = results.filter(o => o.reward <= query.maxReward);
    }

    if (query.since !== undefined) {
      results = results.filter(o => o.timestamp >= query.since);
    }

    if (query.until !== undefined) {
      results = results.filter(o => o.timestamp <= query.until);
    }

    // If both agent and action specified, filter by action too
    if (query.agent && query.action) {
      results = results.filter(o => o.action === query.action);
    }

    // Sort
    const sortBy = query.sortBy || 'timestamp';
    const order = query.order || 'desc';

    results.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      return order === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      memoryUsage: {
        outcomes: this.outcomes.size,
        maxInMemory: this.config.maxInMemory,
        utilizationPercent: (this.outcomes.size / this.config.maxInMemory * 100).toFixed(1)
      }
    };
  }

  /**
   * Get recent outcomes for an agent
   */
  getAgentHistory(agent, limit = 50) {
    return this.queryOutcomes({ agent, limit, sortBy: 'timestamp', order: 'desc' });
  }

  /**
   * Get success rate for agent/action combo
   */
  getSuccessRate(agent, action = null, windowMs = 3600000) { // Default 1 hour window
    const since = Date.now() - windowMs;
    const query = { agent, since };
    if (action) query.action = action;

    const outcomes = this.queryOutcomes(query);
    if (outcomes.length === 0) return null;

    const successCount = outcomes.filter(o => o.success).length;
    return successCount / outcomes.length;
  }

  /**
   * Get average reward for agent/action combo
   */
  getAverageReward(agent, action = null, windowMs = 3600000) {
    const since = Date.now() - windowMs;
    const query = { agent, since };
    if (action) query.action = action;

    const outcomes = this.queryOutcomes(query);
    if (outcomes.length === 0) return null;

    const totalReward = outcomes.reduce((sum, o) => sum + o.reward, 0);
    return totalReward / outcomes.length;
  }

  /**
   * Persist outcomes to disk — overwrites a single file instead of creating
   * new timestamped files every minute (prevents unbounded disk growth).
   */
  async persistOutcomes() {
    if (!this.config.enablePersistence) return;

    // Always overwrite the same file — no more accumulating thousands of timestamped files
    const filename = 'outcomes_current.json';
    const filepath = path.join(this.config.storageDir, filename);

    try {
      const data = {
        stats: this.stats,
        outcomes: Array.from(this.outcomes.values()),
        persistedAt: new Date().toISOString()
      };

      await fs.writeFile(filepath, JSON.stringify(data));
      this.stats.lastPersist = Date.now();
      console.log(`[OutcomeTracker] Persisted ${this.outcomes.size} outcomes to ${filename}`);
    } catch (error) {
      console.error('[OutcomeTracker] Failed to persist outcomes:', error);
    }
  }

  /**
   * Delete old timestamped outcome files (outcomes_TIMESTAMP.json) created before
   * the single-file approach. Runs once on init to reclaim disk space.
   */
  async cleanupOldOutcomeFiles() {
    try {
      const files = await fs.readdir(this.config.storageDir);
      // Match only timestamped files (outcomes_<13-digit-timestamp>.json), not outcomes_current.json
      const oldFiles = files.filter(f => /^outcomes_\d{13}\.json$/.test(f));

      if (oldFiles.length === 0) return;

      console.log(`[OutcomeTracker] 🧹 Cleaning up ${oldFiles.length} old timestamped outcome files...`);
      let deleted = 0;
      for (const file of oldFiles) {
        try {
          await fs.unlink(path.join(this.config.storageDir, file));
          deleted++;
        } catch (_) { /* skip locked files */ }
      }
      console.log(`[OutcomeTracker] ✅ Deleted ${deleted} old outcome files (freed ~${Math.round(deleted * 0.2)}MB)`);
    } catch (err) {
      console.warn(`[OutcomeTracker] Cleanup error: ${err.message}`);
    }
  }

  /**
   * Load outcomes from disk
   */
  async loadOutcomes() {
    if (!this.config.enablePersistence) return;

    try {
      const files = await fs.readdir(this.config.storageDir);
      const outcomeFiles = files.filter(f => f.startsWith('outcomes_') && f.endsWith('.json'));

      if (outcomeFiles.length === 0) {
        console.log('[OutcomeTracker] No existing outcomes found');
        return;
      }

      // Try to load files from newest to oldest until we find a valid one
      const sortedFiles = outcomeFiles.sort().reverse();
      let loaded = false;
      
      for (const file of sortedFiles) {
        const filepath = path.join(this.config.storageDir, file);
        
        try {
          const content = await fs.readFile(filepath, 'utf-8');
          
          // Validate JSON before parsing
          if (!content || content.trim().length === 0) {
            console.warn(`[OutcomeTracker] Skipping empty file: ${file}`);
            continue;
          }
          
          const data = JSON.parse(content);
          
          // Validate data structure
          if (!data.outcomes || !Array.isArray(data.outcomes)) {
            console.warn(`[OutcomeTracker] Invalid data structure in ${file}, skipping`);
            continue;
          }

          // Restore outcomes
          for (const outcome of data.outcomes) {
            this.outcomes.set(outcome.id, outcome);

            // Rebuild indexes
            if (!this.outcomesByAgent.has(outcome.agent)) {
              this.outcomesByAgent.set(outcome.agent, new Set());
            }
            this.outcomesByAgent.get(outcome.agent).add(outcome.id);

            if (!this.outcomesByAction.has(outcome.action)) {
              this.outcomesByAction.set(outcome.action, new Set());
            }
            this.outcomesByAction.get(outcome.action).add(outcome.id);

            this.outcomesByTimestamp.push({ timestamp: outcome.timestamp, id: outcome.id });
          }

          // Sort timestamp index
          this.outcomesByTimestamp.sort((a, b) => a.timestamp - b.timestamp);

          // Restore stats
          if (data.stats) {
            this.stats = data.stats;
          }

          console.log(`[OutcomeTracker] ✅ Loaded ${this.outcomes.size} outcomes from ${file}`);
          loaded = true;
          break; // Successfully loaded, stop trying
          
        } catch (fileError) {
          console.warn(`[OutcomeTracker] ⚠️  Corrupted file ${file}: ${fileError.message}, trying next...`);
          // Move corrupted file to .corrupted subdirectory
          try {
            const corruptedDir = path.join(this.config.storageDir, '.corrupted');
            await fs.mkdir(corruptedDir, { recursive: true });
            const corruptedPath = path.join(corruptedDir, file);
            await fs.rename(filepath, corruptedPath);
          } catch (moveError) {
            // If move fails, just continue
          }
          continue; // Try next file
        }
      }
      
      if (!loaded) {
        console.log('[OutcomeTracker] ℹ️  No valid outcome files found, starting fresh');
      }
      
    } catch (error) {
      // Directory doesn't exist or other error - start fresh
      if (error.code === 'ENOENT') {
        console.log('[OutcomeTracker] ℹ️  Outcomes directory not found, starting fresh');
      } else {
        console.warn('[OutcomeTracker] ⚠️  Error loading outcomes, starting fresh:', error.message);
      }
    }
  }

  /**
   * Evict oldest outcomes to free memory
   */
  evictOldestOutcomes(count) {
    const toEvict = this.outcomesByTimestamp.slice(0, count);

    for (const { id } of toEvict) {
      const outcome = this.outcomes.get(id);
      if (!outcome) continue;

      // Remove from main storage
      this.outcomes.delete(id);

      // Remove from agent index (O(1) with Set)
      const agentOutcomes = this.outcomesByAgent.get(outcome.agent);
      if (agentOutcomes) {
        agentOutcomes.delete(id);
      }

      // Remove from action index (O(1) with Set)
      const actionOutcomes = this.outcomesByAction.get(outcome.action);
      if (actionOutcomes) {
        actionOutcomes.delete(id);
      }
    }

    // Remove from timestamp index
    this.outcomesByTimestamp = this.outcomesByTimestamp.slice(count);

    console.log(`[OutcomeTracker] Evicted ${count} oldest outcomes`);
  }

  /**
   * Clear all outcomes (use with caution!)
   */
  clear() {
    this.outcomes.clear();
    this.outcomesByAgent.clear();
    this.outcomesByAction.clear();
    this.outcomesByTimestamp = [];

    this.stats = {
      totalOutcomes: 0,
      successfulOutcomes: 0,
      failedOutcomes: 0,
      averageReward: 0,
      outcomesByType: {},
      outcomesByAgent: {},
      lastPersist: null
    };

    console.log('[OutcomeTracker] Cleared all outcomes');
    this.emit('cleared');
  }

  /**
   * Shutdown tracker
   */
  async shutdown() {
    console.log('[OutcomeTracker] Shutting down...');

    // Stop persistence timer
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    // Final persist
    await this.persistOutcomes();

    this.emit('shutdown');
    console.log('[OutcomeTracker] Shutdown complete');
  }
}

// Singleton instance
let trackerInstance = null;

export function getOutcomeTracker(config = {}) {
  if (!trackerInstance) {
    trackerInstance = new OutcomeTracker(config);
  }
  return trackerInstance;
}

export default OutcomeTracker;
