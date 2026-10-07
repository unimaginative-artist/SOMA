/**
 * ExperienceReplayBuffer.js - SOMA Experience Replay System
 *
 * THE LEARNING ENGINE - Stores experiences and samples them for training.
 *
 * Reinforcement Learning concept: Instead of learning from each experience once,
 * store them and replay them multiple times to learn more efficiently.
 *
 * Stores experiences as (state, action, outcome, reward, next_state) tuples.
 *
 * Supports multiple sampling strategies:
 * - Uniform: Random sampling (all experiences equal weight)
 * - Prioritized: Sample high-reward experiences more often
 * - Temporal: Sample recent experiences more often
 * - Stratified: Ensure balanced mix of success/failure
 *
 * Used by:
 * - GenomeArbiter: Learn from past evolution outcomes
 * - SelfModificationArbiter: Learn which optimizations work
 * - CognitiveLoopEngine: Learn from reasoning traces
 * - StrategyOptimizer: Learn which strategies work best
 */

import { BaseArbiter } from '../core/BaseArbiter.cjs';

class ExperienceReplayBuffer extends BaseArbiter {
  constructor(config = {}) {
    super({
      name: 'ExperienceReplayBuffer',
      role: 'memory_buffer',
      capabilities: ['store_experience', 'sample_experience'],
      ...config
    });

    this.config = {
      maxSize: config.maxSize || 50000,
      minSize: config.minSize || 100, // Min before sampling allowed
      priorityAlpha: config.priorityAlpha || 0.6, // How much to prioritize (0=uniform, 1=fully prioritized)
      priorityBeta: config.priorityBeta || 0.4, // Importance sampling correction
      priorityEpsilon: config.priorityEpsilon || 0.01, // Small constant to ensure non-zero priority
      temporalDecay: config.temporalDecay || 0.995, // Decay factor for temporal sampling
      stratifiedCategories: config.stratifiedCategories || ['success', 'failure'],
      ...config
    };

    // Experience storage
    this.experiences = []; // Array of experience objects
    this.priorities = []; // Priority weights for each experience
    this.sumTree = null; // Sum tree for efficient prioritized sampling (lazy init)

    // Indexes for fast lookup
    this.experiencesByAgent = new Map(); // agent -> [indices]
    this.experiencesByAction = new Map(); // action -> [indices]
    this.experiencesByCategory = new Map(); // category -> [indices]

    // Stats
    this.stats = {
      totalAdded: 0,
      totalSampled: 0,
      averageReward: 0,
      averagePriority: 0,
      categoryCounts: {},
      agentCounts: {},
      actionCounts: {}
    };

    // Persistence
    this.autoSaveInterval = null;
  }

  async initialize() {
    if (this._erInitialized) return; // Idempotent — may be called by both safeLoad and ULP
    this._erInitialized = true;
    await super.initialize();
    console.log(`[${this.name}] ✅ Experience Replay Buffer initialized`);
  }

  /**
   * Get current buffer size
   */
  size() {
    return this.experiences.length;
  }

  /**
   * Add an experience to the buffer
   *
   * @param {Object} experience
   * @param {Object} experience.state - State when action was taken
   * @param {string} experience.action - Action taken
   * @param {string} experience.agent - Agent that took action
   * @param {*} experience.outcome - Result of action
   * @param {number} experience.reward - Reward received
   * @param {Object} experience.nextState - State after action
   * @param {boolean} [experience.terminal] - Whether episode ended
   * @param {Object} [experience.metadata] - Additional data
   * @param {number} [experience.priority] - Manual priority override
   */
  addExperience(experience) {
    // Validate
    if (!experience.state || !experience.action || !experience.agent) {
      throw new Error('ExperienceReplayBuffer: state, action, and agent are required');
    }

    const traceId = experience.metadata?.outcomeTraceId;
    const resolutionFingerprint = experience.metadata?.resolutionFingerprint;
    if (traceId && resolutionFingerprint) {
      const existingIndex = this.experiences.findIndex(item =>
        item.metadata?.outcomeTraceId === traceId
        && item.metadata?.resolutionFingerprint === resolutionFingerprint
      );
      if (existingIndex >= 0) return existingIndex;
    }

    // Standardize experience
    const standardized = {
      state: experience.state,
      action: experience.action,
      agent: experience.agent,
      outcome: experience.outcome,
      reward: experience.reward !== undefined ? experience.reward : 0,
      nextState: experience.nextState || null,
      terminal: experience.terminal || false,
      metadata: experience.metadata || {},
      timestamp: Date.now(),
      category: experience.reward > 0 ? 'success' : 'failure'
    };

    // Calculate priority
    let priority;
    if (experience.priority !== undefined) {
      priority = experience.priority;
    } else {
      // Priority based on absolute reward (higher reward = higher priority)
      // Add epsilon to ensure non-zero priority
      priority = Math.abs(standardized.reward) + this.config.priorityEpsilon;
    }

    // If buffer is full, remove oldest experience
    if (this.experiences.length >= this.config.maxSize) {
      this._removeOldest();
    }

    // Add to buffer
    const index = this.experiences.length;
    this.experiences.push(standardized);
    // Surgical disk persistence append
    try {
      const fs = require('fs');
      const dataDir = require('path').join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(require('path').join(dataDir, 'experience_replay.jsonl'), JSON.stringify(standardized) + '\n');
    } catch (e) { /* ignore write warnings */ }
    this.priorities.push(priority);

    // Update indexes
    this._addToIndex(this.experiencesByAgent, standardized.agent, index);
    this._addToIndex(this.experiencesByAction, standardized.action, index);
    this._addToIndex(this.experiencesByCategory, standardized.category, index);

    // Update stats
    this.stats.totalAdded++;

    const n = this.stats.totalAdded;
    this.stats.averageReward = ((this.stats.averageReward * (n - 1)) + standardized.reward) / n;
    this.stats.averagePriority = ((this.stats.averagePriority * (n - 1)) + priority) / n;

    this.stats.categoryCounts[standardized.category] = (this.stats.categoryCounts[standardized.category] || 0) + 1;
    this.stats.agentCounts[standardized.agent] = (this.stats.agentCounts[standardized.agent] || 0) + 1;
    this.stats.actionCounts[standardized.action] = (this.stats.actionCounts[standardized.action] || 0) + 1;

    // Invalidate sum tree (will be rebuilt on next prioritized sample)
    this.sumTree = null;

    this.emit('experience_added', { index, experience: standardized, priority });

    // 🚀 ONLINE LEARNING: Immediate update to MetaLearningEngine
    if (this.metaLearningEngine && standardized.reward !== null) {
      // Don't await - fire and forget for performance
      this.metaLearningEngine.updateFromExperience({
        context: standardized.state,
        action: standardized.action,
        agent: standardized.agent,
        reward: standardized.reward,
        outcome: standardized.outcome,
        metadata: standardized.metadata
      }).catch(err => {
        console.warn(`[${this.constructor.name}] Online learning update failed:`, err.message);
      });
    }

    return index;
  }

  /**
   * Sample experiences from buffer
   *
   * @param {number} batchSize - Number of experiences to sample
   * @param {string} strategy - Sampling strategy: 'uniform', 'prioritized', 'temporal', 'stratified'
   * @param {Object} options - Strategy-specific options
   * @returns {Object} { experiences, indices, weights }
   */
  sample(batchSize, strategy = 'uniform', options = {}) {
    if (this.experiences.length < this.config.minSize) {
      throw new Error(`ExperienceReplayBuffer: Not enough experiences (${this.experiences.length} < ${this.config.minSize})`);
    }

    batchSize = Math.min(batchSize, this.experiences.length);

    let sampled;

    switch (strategy) {
      case 'uniform':
        sampled = this._sampleUniform(batchSize);
        break;
      case 'prioritized':
        sampled = this._samplePrioritized(batchSize, options);
        break;
      case 'temporal':
        sampled = this._sampleTemporal(batchSize, options);
        break;
      case 'stratified':
        sampled = this._sampleStratified(batchSize, options);
        break;
      default:
        throw new Error(`ExperienceReplayBuffer: Unknown strategy: ${strategy}`);
    }

    this.stats.totalSampled += batchSize;
    this.emit('experiences_sampled', { batchSize, strategy, count: sampled.experiences.length });

    return sampled;
  }

  /**
   * Uniform random sampling
   */
  _sampleUniform(batchSize) {
    const indices = [];
    const experiences = [];
    const weights = [];

    for (let i = 0; i < batchSize; i++) {
      const index = Math.floor(Math.random() * this.experiences.length);
      indices.push(index);
      experiences.push(this.experiences[index]);
      weights.push(1.0); // All weights equal
    }

    return { experiences, indices, weights };
  }

  /**
   * Prioritized experience replay
   * High-reward experiences sampled more often
   */
  _samplePrioritized(batchSize, options = {}) {
    // Build sum tree if not built
    if (!this.sumTree) {
      this._buildSumTree();
    }

    const indices = [];
    const experiences = [];
    const weights = [];

    const totalPriority = this.sumTree[0];
    const segment = totalPriority / batchSize;

    for (let i = 0; i < batchSize; i++) {
      // Sample from segment
      const a = segment * i;
      const b = segment * (i + 1);
      const value = a + Math.random() * (b - a);

      const index = this._retrieveFromSumTree(value);
      const priority = this.priorities[index];

      indices.push(index);
      experiences.push(this.experiences[index]);

      // Importance sampling weight: (1 / N * 1 / P(i))^beta
      const probability = priority / totalPriority;
      const weight = Math.pow(this.experiences.length * probability, -this.config.priorityBeta);
      weights.push(weight);
    }

    // Normalize weights
    const maxWeight = Math.max(...weights);
    const normalizedWeights = weights.map(w => w / maxWeight);

    return {
      experiences,
      indices,
      weights: normalizedWeights
    };
  }

  /**
   * Temporal sampling - recent experiences more likely
   */
  _sampleTemporal(batchSize, options = {}) {
    const decay = options.decay || this.config.temporalDecay;
    const indices = [];
    const experiences = [];
    const weights = [];

    // Calculate temporal weights (exponential decay from most recent)
    const temporalWeights = [];
    let sumWeights = 0;

    for (let i = 0; i < this.experiences.length; i++) {
      const age = this.experiences.length - i - 1; // 0 = most recent
      const weight = Math.pow(decay, age);
      temporalWeights.push(weight);
      sumWeights += weight;
    }

    // Normalize to probabilities
    const probabilities = temporalWeights.map(w => w / sumWeights);

    // Sample using roulette wheel
    for (let i = 0; i < batchSize; i++) {
      const rand = Math.random();
      let cumulative = 0;
      let selectedIndex = 0;

      for (let j = 0; j < probabilities.length; j++) {
        cumulative += probabilities[j];
        if (rand <= cumulative) {
          selectedIndex = j;
          break;
        }
      }

      indices.push(selectedIndex);
      experiences.push(this.experiences[selectedIndex]);
      weights.push(1.0); // No importance sampling correction for temporal
    }

    return { experiences, indices, weights };
  }

  /**
   * Stratified sampling - ensure balanced mix of categories
   */
  _sampleStratified(batchSize, options = {}) {
    const categories = options.categories || this.config.stratifiedCategories;
    const samplesPerCategory = Math.floor(batchSize / categories.length);
    const remainder = batchSize % categories.length;

    const indices = [];
    const experiences = [];
    const weights = [];

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      const categoryIndices = this.experiencesByCategory.get(category) || [];

      if (categoryIndices.length === 0) continue;

      // Samples for this category (distribute remainder)
      const n = samplesPerCategory + (i < remainder ? 1 : 0);

      // Random sample from category
      for (let j = 0; j < n && categoryIndices.length > 0; j++) {
        const randomIdx = Math.floor(Math.random() * categoryIndices.length);
        const index = categoryIndices[randomIdx];

        indices.push(index);
        experiences.push(this.experiences[index]);
        weights.push(1.0);
      }
    }

    return { experiences, indices, weights };
  }

  /**
   * Update priority for an experience (used during learning)
   */
  updatePriority(index, newPriority) {
    if (index < 0 || index >= this.experiences.length) {
      throw new Error(`ExperienceReplayBuffer: Invalid index ${index}`);
    }

    this.priorities[index] = newPriority;

    // Invalidate sum tree
    this.sumTree = null;
  }

  /**
   * Get experiences by agent
   */
  getByAgent(agent, limit = null) {
    const indices = this.experiencesByAgent.get(agent) || [];
    const experiences = indices.map(i => this.experiences[i]);

    if (limit) {
      return experiences.slice(-limit); // Most recent
    }

    return experiences;
  }

  /**
   * Get experiences by action
   */
  getByAction(action, limit = null) {
    const indices = this.experiencesByAction.get(action) || [];
    const experiences = indices.map(i => this.experiences[i]);

    if (limit) {
      return experiences.slice(-limit);
    }

    return experiences;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentSize: this.experiences.length,
      maxSize: this.config.maxSize,
      utilizationPercent: (this.experiences.length / this.config.maxSize * 100).toFixed(1),
      readyForSampling: this.experiences.length >= this.config.minSize
    };
  }

  /**
   * Clear buffer
   */
  clear() {
    this.experiences = [];
    this.priorities = [];
    this.sumTree = null;
    this.experiencesByAgent.clear();
    this.experiencesByAction.clear();
    this.experiencesByCategory.clear();

    this.stats = {
      totalAdded: 0,
      totalSampled: 0,
      averageReward: 0,
      averagePriority: 0,
      categoryCounts: {},
      agentCounts: {},
      actionCounts: {}
    };

    this.emit('cleared');
  }

  /**
   * Persist experiences to disk
   * @param {string} storageDir - Directory to save experiences
   * @returns {Promise<Object>} Result with filepath and count
   */
  async persistExperiences(storageDir = './.soma/experiences') {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      // Ensure directory exists
      await fs.mkdir(storageDir, { recursive: true });

      // Single-file approach — always overwrite experiences_current.json
      // (avoids accumulating timestamped files that waste disk space)
      const filename = 'experiences_current.json';
      const filepath = path.join(storageDir, filename);
      const tempPath = filepath + '.tmp';

      const data = {
        experiences: this.experiences,
        priorities: this.priorities,
        stats: this.stats,
        persistedAt: new Date().toISOString(),
        version: '1.0'
      };

      // Atomic write (temp → rename)
      await fs.writeFile(tempPath, JSON.stringify(data));
      await fs.rename(tempPath, filepath);

      // Clean up any old timestamped files from previous runs
      try {
        const allFiles = await fs.readdir(storageDir);
        const oldFiles = allFiles.filter(f => /^experiences_\d{13}\.json$/.test(f));
        for (const f of oldFiles) {
          await fs.unlink(path.join(storageDir, f)).catch(() => {});
        }
        if (oldFiles.length > 0) console.log(`[ExperienceReplayBuffer] 🗑️ Cleaned up ${oldFiles.length} old timestamped experience files`);
      } catch (cleanErr) { /* cleanup errors are non-fatal */ }

      console.log(`[ExperienceReplayBuffer] ✅ Persisted ${this.experiences.length} experiences to ${filename}`);

      return {
        success: true,
        filepath,
        count: this.experiences.length
      };
    } catch (error) {
      console.error(`[ExperienceReplayBuffer] ❌ Failed to persist experiences: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Load experiences from disk
   * @param {string} storageDir - Directory to load from
   * @returns {Promise<Object>} Result with loaded count
   */
  async loadExperiences(storageDir = './.soma/experiences') {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      // Check if directory exists
      try {
        await fs.access(storageDir);
      } catch (error) {
        console.log(`[ExperienceReplayBuffer] No existing experiences directory found`);
        return { success: true, count: 0, reason: 'no_directory' };
      }

      // Get all experience files
      const files = await fs.readdir(storageDir);
      const experienceFiles = files.filter(f => f.startsWith('experiences_') && f.endsWith('.json'));

      if (experienceFiles.length === 0) {
        console.log(`[ExperienceReplayBuffer] No existing experiences found`);
        return { success: true, count: 0, reason: 'no_files' };
      }

      // Load most recent file
      const latestFile = experienceFiles.sort().reverse()[0];
      const filepath = path.join(storageDir, latestFile);

      // Skip large files to prevent memory exhaustion during parse
      // 10K experiences at ~2.5KB each ≈ 25MB max reasonable file size
      const fileStats = await fs.stat(filepath);
      const fileSizeMB = fileStats.size / 1024 / 1024;
      if (fileSizeMB > 30) {
        console.warn(`[ExperienceReplayBuffer] ⚠️ Experience file too large (${fileSizeMB.toFixed(0)}MB) — skipping disk load, starting fresh`);
        // Clean up oversized files to prevent future attempts
        try {
          await fs.unlink(filepath);
          console.log(`[ExperienceReplayBuffer] 🗑️ Deleted oversized file: ${latestFile}`);
        } catch (unlinkErr) { /* ignore */ }
        return { success: true, count: 0, reason: 'file_too_large', sizeMB: fileSizeMB };
      }

      const fileContent = await fs.readFile(filepath, 'utf-8');
      const data = JSON.parse(fileContent);

      // Restore experiences and priorities (cap to maxSize to prevent memory bloat)
      let loadedExperiences = data.experiences || [];
      let loadedPriorities = data.priorities || [];

      if (loadedExperiences.length > this.config.maxSize) {
        const trimCount = loadedExperiences.length - this.config.maxSize;
        console.log(`[ExperienceReplayBuffer] Trimming ${trimCount} old experiences (${loadedExperiences.length} → ${this.config.maxSize})`);
        loadedExperiences = loadedExperiences.slice(-this.config.maxSize);
        loadedPriorities = loadedPriorities.slice(-this.config.maxSize);
      }

      this.experiences = loadedExperiences;
      this.priorities = loadedPriorities;

      // Rebuild indexes
      this.experiencesByAgent.clear();
      this.experiencesByAction.clear();
      this.experiencesByCategory.clear();

      for (let i = 0; i < this.experiences.length; i++) {
        const exp = this.experiences[i];
        this._addToIndex(this.experiencesByAgent, exp.agent, i);
        this._addToIndex(this.experiencesByAction, exp.action, i);
        this._addToIndex(this.experiencesByCategory, exp.category, i);
      }

      // Restore stats if available
      if (data.stats) {
        this.stats = data.stats;
      }

      // Invalidate sum tree (will be rebuilt on next sample)
      this.sumTree = null;

      console.log(`[ExperienceReplayBuffer] ✅ Loaded ${this.experiences.length} experiences from ${latestFile}`);

      return {
        success: true,
        count: this.experiences.length,
        filepath,
        persistedAt: data.persistedAt
      };
    } catch (error) {
      console.error(`[ExperienceReplayBuffer] ❌ Failed to load experiences: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start auto-save interval
   * @param {number} intervalMs - Save interval in milliseconds (default 5 minutes)
   * @param {string} storageDir - Directory to save to
   */
  startAutoSave(intervalMs = 300000, storageDir = './.soma/experiences') {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      if (this.experiences.length > 0) {
        await this.persistExperiences(storageDir);
      }
    }, intervalMs);

    console.log(`[ExperienceReplayBuffer] 🔄 Auto-save enabled (every ${intervalMs / 1000}s)`);
  }

  /**
   * Stop auto-save and do final save
   */
  async stopAutoSave(storageDir = './.soma/experiences') {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    // Final save
    if (this.experiences.length > 0) {
      await this.persistExperiences(storageDir);
    }

    console.log(`[ExperienceReplayBuffer] 🛑 Auto-save stopped`);
  }

  // ============================================================
  // Internal Methods
  // ============================================================

  _addToIndex(indexMap, key, value) {
    if (!indexMap.has(key)) {
      indexMap.set(key, []);
    }
    indexMap.get(key).push(value);
  }

  _removeBatch(batchSize) {
    if (this.experiences.length === 0) return;
    batchSize = Math.min(batchSize, this.experiences.length);

    this.experiences.splice(0, batchSize);
    this.priorities.splice(0, batchSize);

    // Rebuild all indexes (expensive but necessary)
    this.experiencesByAgent.clear();
    this.experiencesByAction.clear();
    this.experiencesByCategory.clear();

    for (let i = 0; i < this.experiences.length; i++) {
      const exp = this.experiences[i];
      this._addToIndex(this.experiencesByAgent, exp.agent, i);
      this._addToIndex(this.experiencesByAction, exp.action, i);
      this._addToIndex(this.experiencesByCategory, exp.category, i);
    }

    // Invalidate sum tree
    this.sumTree = null;
  }

  _removeOldest() {
    // Remove 10% of buffer at once to reduce index rebuild frequency
    const batchSize = Math.max(1, Math.floor(this.config.maxSize * 0.1));
    this._removeBatch(batchSize);
  }

  _buildSumTree() {
    // Build a sum tree for O(log n) sampling
    // Sum tree is a binary tree where each node = sum of children
    const n = this.priorities.length;
    const treeSize = 2 * n - 1;
    this.sumTree = new Float32Array(treeSize);

    // Copy priorities to leaf nodes
    for (let i = 0; i < n; i++) {
      this.sumTree[treeSize - 1 - i] = Math.pow(this.priorities[n - 1 - i], this.config.priorityAlpha);
    }

    // Build tree bottom-up
    for (let i = treeSize - n - 1; i >= 0; i--) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      this.sumTree[i] = this.sumTree[left] + (right < treeSize ? this.sumTree[right] : 0);
    }
  }

  _retrieveFromSumTree(value) {
    let idx = 0;
    const n = this.priorities.length;
    const treeSize = this.sumTree.length;

    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      // Leaf node
      if (left >= treeSize) {
        // Convert tree index to priority index
        return treeSize - 1 - idx;
      }

      // Traverse tree
      if (value <= this.sumTree[left]) {
        idx = left;
      } else {
        value -= this.sumTree[left];
        idx = right;
      }
    }
  }
}

// Singleton instance
let bufferInstance = null;

export function getExperienceReplayBuffer(config = {}) {
  if (!bufferInstance) {
    bufferInstance = new ExperienceReplayBuffer(config);
  }
  return bufferInstance;
}

export default ExperienceReplayBuffer;
