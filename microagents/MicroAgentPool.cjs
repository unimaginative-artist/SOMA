// MicroAgentPool.cjs
// Spawns and manages pools of ephemeral MicroAgents

const EventEmitter = require('events');

class MicroAgentPool extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.parentId = config.parentId || 'unknown';
    this.maxPoolSize = config.maxPoolSize || 50;
    this.defaultTTL = config.defaultTTL || 60000; // 1 minute
    this.defaultIdleTimeout = config.defaultIdleTimeout || 30000; // 30 seconds
    
    // Agent storage
    this.agents = new Map(); // agentId -> agent instance
    this.agentTypes = new Map(); // type -> AgentClass
    
    // Metrics
    this.metrics = {
      totalSpawned: 0,
      totalTerminated: 0,
      currentActive: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      avgLifetime: 0
    };
    
    // Cleanup interval
    this._cleanupInterval = setInterval(() => this._cleanup(), 5000); // Every 5 seconds
    
    this.logger = config.logger || console;
    this.logger.info(`[MicroAgentPool:${this.parentId}] Initialized (max: ${this.maxPoolSize})`);
  }
  
  /**
   * Register a MicroAgent type
   */
  registerAgentType(type, AgentClass) {
    this.agentTypes.set(type, AgentClass);
    this.logger.info(`[MicroAgentPool:${this.parentId}] Registered agent type: ${type}`);
  }
  
  /**
   * Spawn a new MicroAgent
   */
  async spawn(type, config = {}) {
    if (this.agents.size >= this.maxPoolSize) {
      throw new Error(`Pool at maximum capacity (${this.maxPoolSize})`);
    }
    
    const AgentClass = this.agentTypes.get(type);
    if (!AgentClass) {
      throw new Error(`Unknown agent type: ${type}`);
    }
    
    // Create agent
    const agent = new AgentClass({
      ...config,
      type,
      parentId: this.parentId,
      ttl: config.ttl || this.defaultTTL,
      idleTimeout: config.idleTimeout || this.defaultIdleTimeout,
      logger: this.logger
    });
    
    // Initialize
    await agent.initialize();
    
    // Track agent
    this.agents.set(agent.id, agent);
    this.metrics.totalSpawned++;
    this.metrics.currentActive++;
    
    // Listen to termination
    agent.once('terminated', (data) => {
      this._handleAgentTerminated(agent, data);
    });
    
    this.logger.info(`[MicroAgentPool:${this.parentId}] Spawned ${type} agent: ${agent.id}`);
    this.emit('agent_spawned', { agentId: agent.id, type });
    
    return agent;
  }
  
  /**
   * Spawn and execute a task immediately
   */
  async spawnAndExecute(type, task, config = {}) {
    const agent = await this.spawn(type, config);
    
    try {
      const result = await agent.executeTask(task);
      
      // Auto-terminate after task completion
      if (config.autoTerminate !== false) {
        await agent.terminate('task_completed');
      }
      
      return result;
    } catch (err) {
      await agent.terminate('task_failed');
      throw err;
    }
  }
  
  /**
   * Get an idle agent of a specific type, or spawn a new one
   */
  async getOrSpawn(type, config = {}) {
    // Find idle agent of this type
    for (const agent of this.agents.values()) {
      if (agent.type === type && agent.isIdle()) {
        this.logger.info(`[MicroAgentPool:${this.parentId}] Reusing idle agent: ${agent.id}`);
        return agent;
      }
    }
    
    // Spawn new agent
    return this.spawn(type, config);
  }
  
  /**
   * Execute task using available or new agent
   */
  async executeTask(type, task, config = {}) {
    const agent = await this.getOrSpawn(type, config);
    
    try {
      const result = await agent.executeTask(task);
      
      // If agent is done with work and set to auto-terminate
      if (config.autoTerminate !== false && agent.state === 'completing') {
        await agent.terminate('task_completed');
      }
      
      return result;
    } catch (err) {
      if (agent.isAlive()) {
        await agent.terminate('task_failed');
      }
      throw err;
    }
  }
  
  /**
   * Terminate a specific agent
   */
  async terminateAgent(agentId, reason = 'manual') {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }
    
    return agent.terminate(reason);
  }
  
  /**
   * Terminate all agents
   */
  async terminateAll(reason = 'pool_shutdown') {
    const terminations = [];
    
    for (const agent of this.agents.values()) {
      if (agent.isAlive()) {
        terminations.push(agent.terminate(reason));
      }
    }
    
    await Promise.all(terminations);
    this.logger.info(`[MicroAgentPool:${this.parentId}] All agents terminated`);
  }
  
  /**
   * Get agent by ID
   */
  getAgent(agentId) {
    return this.agents.get(agentId);
  }
  
  /**
   * Get all agents of a specific type
   */
  getAgentsByType(type) {
    return Array.from(this.agents.values()).filter(a => a.type === type);
  }
  
  /**
   * Get all idle agents
   */
  getIdleAgents() {
    return Array.from(this.agents.values()).filter(a => a.isIdle());
  }
  
  /**
   * Get all working agents
   */
  getWorkingAgents() {
    return Array.from(this.agents.values()).filter(a => a.isWorking());
  }
  
  /**
   * Cleanup terminated agents
   */
  _cleanup() {
    const terminated = [];
    
    for (const [id, agent] of this.agents.entries()) {
      if (!agent.isAlive()) {
        terminated.push(id);
      }
    }
    
    if (terminated.length > 0) {
      terminated.forEach(id => this.agents.delete(id));
      this.logger.info(`[MicroAgentPool:${this.parentId}] Cleaned up ${terminated.length} terminated agents`);
    }
  }
  
  /**
   * Handle agent termination
   */
  _handleAgentTerminated(agent, data) {
    this.metrics.totalTerminated++;
    this.metrics.currentActive--;
    this.metrics.totalTasksCompleted += agent.metrics.tasksCompleted;
    this.metrics.totalTasksFailed += agent.metrics.tasksFailed;
    
    // Update average lifetime
    const lifetimes = this.metrics.totalTerminated;
    const prevAvg = this.metrics.avgLifetime;
    this.metrics.avgLifetime = (prevAvg * (lifetimes - 1) + data.lifetime) / lifetimes;
    
    this.emit('agent_terminated', { agentId: agent.id, type: agent.type, reason: data.reason });
  }
  
  /**
   * Get pool status
   */
  getStatus() {
    const agents = Array.from(this.agents.values());
    const byType = {};
    const byState = { idle: 0, working: 0, completing: 0, terminated: 0 };
    
    agents.forEach(agent => {
      byType[agent.type] = (byType[agent.type] || 0) + 1;
      byState[agent.state] = (byState[agent.state] || 0) + 1;
    });
    
    return {
      parentId: this.parentId,
      totalAgents: this.agents.size,
      maxPoolSize: this.maxPoolSize,
      utilization: ((this.agents.size / this.maxPoolSize) * 100).toFixed(1) + '%',
      metrics: this.metrics,
      byType,
      byState,
      registeredTypes: Array.from(this.agentTypes.keys())
    };
  }
  
  /**
   * Get detailed status with agent info
   */
  getDetailedStatus() {
    return {
      ...this.getStatus(),
      agents: Array.from(this.agents.values()).map(a => a.getStatus())
    };
  }
  
  /**
   * Shutdown pool
   */
  async shutdown() {
    this.logger.info(`[MicroAgentPool:${this.parentId}] Shutting down...`);
    
    clearInterval(this._cleanupInterval);
    await this.terminateAll('pool_shutdown');
    this.agents.clear();
    this.removeAllListeners();
    
    this.logger.info(`[MicroAgentPool:${this.parentId}] Shutdown complete`);
  }
}

module.exports = { MicroAgentPool };
