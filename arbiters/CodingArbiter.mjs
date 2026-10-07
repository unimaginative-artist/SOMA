/**
 * CodingArbiter.mjs
 * 
 * High-end coding arbiter that combines:
 * - Transmitter Nodes (TNs) for memory/pattern storage
 * - Micro-agent spawning for parallel task execution
 * - Self-cloning under load
 * - Learning from past coding sessions
 * 
 * This is the "brain" of the coding system.
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// ========== UTILITIES ==========

const now = () => Date.now();
const iso = (t = Date.now()) => new Date(t).toISOString();
const uid = (prefix = 'id') => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

// ========== CODING ARBITER ==========

export class CodingArbiter extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Identity
    this.id = config.id || uid('arbiter');
    this.name = config.name || 'CodeMaster';
    this.generation = config.generation || 0;
    this.parentId = config.parentId || null;
    
    // Memory (Transmitter Manager)
    this.memory = config.memory || null;
    
    // Micro-agents
    this.microAgents = new Map();
    this.agentResults = [];
    this.maxConcurrentAgents = config.maxConcurrentAgents || 10;
    
    // Performance
    this.metrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      agentsSpawned: 0,
      avgTaskTime: 0,
      clonesCreated: 0,
      patternsLearned: 0
    };
    
    // State
    this.busy = false;
    this.loadLevel = 0;
    this.cloneThreshold = config.cloneThreshold || 0.8;
    
    // Knowledge
    this.learnedPatterns = new Map();
    this.commonErrors = new Map();
    this.successfulSolutions = [];
    
    console.log(`[${this.name}] Initialized (Gen ${this.generation})`);
    }

    getStatus() {
    return {
      id: this.id,
      name: this.name,
      generation: this.generation,
      busy: this.busy,
      patterns: this.learnedPatterns.size,
      errors: this.commonErrors.size,
      solutions: this.successfulSolutions.length,
      metrics: this.metrics,
      lastOptimization: this.metrics.lastOptimization || null,
      activeTasks: Array.from(this.microAgents.keys()).map(id => ({ id, type: 'refactor' }))
    };
    }

    // ========== MAIN EXECUTION ==========  
  async execute(task) {
    const startTime = now();
    this.busy = true;
    this.emit('task_started', { task, arbiter: this.name });
    
    try {
      // 1. GATHER: Recall relevant patterns from memory
      const relevantPatterns = await this.recallPatterns(task);
      
      // 2. ANALYZE: Break down the task
      const analysis = await this.analyzeTask(task, relevantPatterns);
      
      // 3. PLAN: Determine execution strategy
      const plan = await this.planExecution(analysis);
      
      // 4. EXECUTE: Run with micro-agents or self
      const result = await this.executePlan(plan);
      
      // 5. VERIFY: Check result quality
      const verified = await this.verifyResult(result);
      
      // 6. LEARN: Store patterns in TNs
      await this.learnFromResult(task, verified);
      
      // Update metrics
      const duration = now() - startTime;
      this.metrics.tasksCompleted++;
      this.metrics.avgTaskTime = 
        (this.metrics.avgTaskTime * (this.metrics.tasksCompleted - 1) + duration) / 
        this.metrics.tasksCompleted;
      
      this.busy = false;
      this.emit('task_completed', { task, result: verified, duration });
      
      return {
        success: true,
        result: verified.data,
        confidence: verified.confidence,
        duration,
        arbiter: this.name,
        generation: this.generation
      };
      
    } catch (error) {
      this.metrics.tasksFailed++;
      this.busy = false;
      this.emit('task_failed', { task, error: error.message });
      
      return {
        success: false,
        error: error.message,
        arbiter: this.name
      };
    }
  }
  
  // ========== MEMORY INTEGRATION ==========
  
  async recallPatterns(task) {
    if (!this.memory) return [];
    
    try {
      // Generate embedding for the task
      const taskEmbedding = await this.generateTaskEmbedding(task);
      
      // Search TNs for similar past tasks
      const similar = await this.memory.hybridSearch(taskEmbedding, 5);
      
      return similar.map(s => ({
        pattern: s.tn.meta.payload,
        similarity: s.finalScore,
        tnId: s.tn.id
      }));
      
    } catch (err) {
      console.warn(`[${this.name}] Pattern recall failed:`, err.message);
      return [];
    }
  }
  
  async learnFromResult(task, result) {
    if (!this.memory || !result.success) return;
    
    try {
      const taskEmbedding = await this.generateTaskEmbedding(task);
      
      // Store successful pattern in TNs
      await this.memory.addItemToBest({
        embedding: taskEmbedding,
        payload: {
          task: task.description,
          solution: result.data,
          confidence: result.confidence,
          timestamp: iso(),
          arbiter: this.name,
          generation: this.generation
        },
        metadata: {
          type: 'coding_pattern',
          language: task.language || 'javascript',
          success: true
        }
      });
      
      this.metrics.patternsLearned++;
      this.emit('pattern_learned', { task, result });
      
    } catch (err) {
      console.warn(`[${this.name}] Pattern storage failed:`, err.message);
    }
  }
  
  async generateTaskEmbedding(task) {
    // Simple embedding generation (in production, use a real model)
    // For now, create a deterministic vector from task properties
    const text = JSON.stringify(task);
    const hash = crypto.createHash('sha256').update(text).digest();
    
    // Convert to 1536-dim vector (common size)
    const embedding = new Array(1536).fill(0);
    for (let i = 0; i < hash.length; i++) {
      embedding[i % 1536] += hash[i] / 255;
    }
    
    // Normalize
    const mag = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / mag);
  }
  
  // ========== TASK ANALYSIS ==========
  
  async analyzeTask(task, patterns) {
    // Determine task complexity and requirements
    return {
      type: task.type || 'generic',
      complexity: this.estimateComplexity(task),
      language: task.language || 'javascript',
      requiresParallel: this.requiresParallelExecution(task),
      estimatedTime: this.estimateTime(task),
      similarPatterns: patterns,
      suggestedApproach: this.suggestApproach(task, patterns)
    };
  }
  
  estimateComplexity(task) {
    // Simple heuristic
    const desc = task.description || '';
    const fileCount = task.files?.length || 1;
    
    if (desc.includes('refactor') || fileCount > 10) return 'high';
    if (desc.includes('fix') || fileCount > 3) return 'medium';
    return 'low';
  }
  
  requiresParallelExecution(task) {
    const keywords = ['lint all', 'test all', 'format all', 'parallel'];
    const desc = (task.description || '').toLowerCase();
    return keywords.some(kw => desc.includes(kw));
  }
  
  estimateTime(task) {
    const complexity = this.estimateComplexity(task);
    const fileCount = task.files?.length || 1;
    
    const baseTime = {
      low: 5000,
      medium: 15000,
      high: 45000
    }[complexity];
    
    return baseTime * (1 + fileCount * 0.1);
  }
  
  suggestApproach(task, patterns) {
    if (patterns.length > 0 && patterns[0].similarity > 0.8) {
      return 'use_pattern';
    }
    
    if (this.requiresParallelExecution(task)) {
      return 'spawn_agents';
    }
    
    return 'direct_execution';
  }
  
  // ========== PLANNING ==========
  
  async planExecution(analysis) {
    const plan = {
      approach: analysis.suggestedApproach,
      steps: [],
      needsClone: false,
      agentsNeeded: 0
    };
    
    // Check if we need to clone due to load
    this.loadLevel = this.microAgents.size / this.maxConcurrentAgents;
    if (this.loadLevel > this.cloneThreshold) {
      plan.needsClone = true;
    }
    
    // Determine micro-agent needs
    if (analysis.requiresParallel) {
      plan.agentsNeeded = Math.min(
        analysis.task?.files?.length || 5,
        this.maxConcurrentAgents
      );
    }
    
    return plan;
  }
  
  // ========== EXECUTION ==========
  
  async executePlan(plan) {
    if (plan.needsClone) {
      await this.considerCloning();
    }
    
    if (plan.agentsNeeded > 0) {
      return await this.executeWithAgents(plan);
    }
    
    return await this.executeDirect(plan);
  }
  
  async executeWithAgents(plan) {
    console.log(`[${this.name}] Spawning ${plan.agentsNeeded} micro-agents`);
    
    const agents = [];
    for (let i = 0; i < plan.agentsNeeded; i++) {
      const agent = await this.spawnMicroAgent({
        task: plan.steps[i],
        index: i
      });
      agents.push(agent);
    }
    
    // Wait for all agents to complete
    const results = await Promise.all(
      agents.map(agent => agent.execute())
    );
    
    return {
      success: true,
      data: results,
      agentsUsed: agents.length
    };
  }
  
  async executeDirect(plan) {
    // Direct execution by arbiter
    console.log(`[${this.name}] Executing directly`);
    
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      success: true,
      data: {
        message: 'Task completed successfully',
        approach: 'direct'
      }
    };
  }
  
  // ========== MICRO-AGENT SPAWNING ==========
  
  async spawnMicroAgent(config) {
    const agent = new MicroAgent({
      ...config,
      arbiter: this.name,
      spawnedAt: now()
    });
    
    this.microAgents.set(agent.id, agent);
    this.metrics.agentsSpawned++;
    
    // Auto-cleanup when done
    agent.once('completed', () => {
      this.agentResults.push(agent.result);
      this.microAgents.delete(agent.id);
    });
    
    this.emit('agent_spawned', { agent: agent.id });
    return agent;
  }
  
  // ========== VERIFICATION ==========
  
  async verifyResult(result) {
    // Basic verification
    const verified = {
      ...result,
      verified: true,
      confidence: result.success ? 0.9 : 0.1,
      timestamp: iso()
    };
    
    return verified;
  }
  
  // ========== CLONING ==========
  
  async considerCloning() {
    console.log(`[${this.name}] Load at ${(this.loadLevel * 100).toFixed(1)}%, considering cloning...`);
    
    const clone = new CodingArbiter({
      name: `${this.name}-clone`,
      generation: this.generation + 1,
      parentId: this.id,
      memory: this.memory,  // Shared memory!
      maxConcurrentAgents: this.maxConcurrentAgents,
      cloneThreshold: this.cloneThreshold
    });
    
    this.metrics.clonesCreated++;
    this.emit('clone_created', { clone: clone.id, parent: this.id });
    
    return clone;
  }
  
  // ========== STATUS ==========
  
  status() {
    return {
      id: this.id,
      name: this.name,
      generation: this.generation,
      busy: this.busy,
      loadLevel: this.loadLevel,
      activeAgents: this.microAgents.size,
      metrics: this.metrics,
      patternsKnown: this.learnedPatterns.size,
      memoryConnected: !!this.memory
    };
  }
}

// ========== MICRO-AGENT ==========

class MicroAgent extends EventEmitter {
  constructor(config) {
    super();
    
    this.id = uid('agent');
    this.task = config.task;
    this.arbiter = config.arbiter;
    this.spawnedAt = config.spawnedAt;
    this.ttl = config.ttl || 60000; // 1 minute
    this.result = null;
    this.status = 'spawned';
    
    // Auto-kill after TTL
    this.killTimer = setTimeout(() => this.kill(), this.ttl);
  }
  
  async execute() {
    this.status = 'executing';
    const startTime = now();
    
    try {
      // Simulate work
      await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));
      
      this.result = {
        success: true,
        data: {
          message: `Agent ${this.id} completed task`,
          duration: now() - startTime
        },
        agentId: this.id
      };
      
      this.status = 'completed';
      this.emit('completed', this.result);
      
      clearTimeout(this.killTimer);
      return this.result;
      
    } catch (error) {
      this.result = {
        success: false,
        error: error.message,
        agentId: this.id
      };
      
      this.status = 'failed';
      this.emit('failed', this.result);
      
      clearTimeout(this.killTimer);
      return this.result;
    }
  }
  
  kill() {
    if (this.status === 'executing') {
      this.status = 'killed';
      this.emit('killed');
    }
    clearTimeout(this.killTimer);
  }
}
