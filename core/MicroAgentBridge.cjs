// ═══════════════════════════════════════════════════════════
// FILE: core/MicroAgentBridge.cjs
// Bridge between MicroAgents and Arbiter-based orchestration
// Allows microagents to integrate seamlessly with ASI Orchestrator
// ═══════════════════════════════════════════════════════════

const messageBroker = require('./MessageBroker.cjs');

class MicroAgentBridge {
  constructor() {
    this.agents = new Map();  // agentName -> microagent instance
    this.registered = new Set();
    
    this.logger = console;
  }

  /**
   * Register a microagent with the message broker as if it were an arbiter
   * @param {string} name - Agent name for broker registration (e.g. 'BlackAgent')
   * @param {BaseMicroAgent} agent - The microagent instance
   */
  registerAgent(name, agent) {
    if (this.registered.has(name)) {
      this.logger.warn(`[MicroAgentBridge] Agent ${name} already registered`);
      return false;
    }

    this.agents.set(name, agent);

    // Create arbiter-like interface for the agent
    const arbiterInterface = {
      name,
      handleMessage: async (message) => {
        this.logger.info(`[MicroAgentBridge] ${name} received message: ${message.type}`);
        const response = await this.handleMessageForAgent(name, message);
        this.logger.info(`[MicroAgentBridge] ${name} responding:`, response ? 'success' : 'null');
        return response;
      }
    };

    try {
      // Register with message broker - pass instance as part of metadata
      messageBroker.registerArbiter(name, {
        instance: arbiterInterface,
        type: 'microagent-bridge',
        capabilities: ['execute-tasks', 'status-check']
      });

      this.registered.add(name);
      this.logger.info(`[MicroAgentBridge] Registered ${name} with MessageBroker`);
      
      return true;
    } catch (err) {
      this.logger.error(`[MicroAgentBridge] Failed to register ${name}: ${err.message}`);
      return false;
    }
  }

  /**
   * Handle messages for a specific agent
   * Translates arbiter-style messages to microagent tasks
   */
  async handleMessageForAgent(agentName, message = {}) {
    const agent = this.agents.get(agentName);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Extract type and payload from message (could be envelope or direct)
    const type = message.type || message.payload?.type;
    const payload = message.payload || {};

    try {
      switch (type) {
        case 'status_check':
          return this.getAgentStatus(agent);

        case 'execute_task':
          return await agent.executeTask(payload);

        case 'get_metrics':
          return {
            success: true,
            metrics: agent.metrics
          };

        case 'run_diagnostics':
          // For agents like Jetstream that support diagnostics
          if (typeof agent.execute === 'function') {
            return await agent.execute({ type: 'health-check', payload: {} });
          }
          return { success: true, diagnostics: 'healthy' };

        case 'pattern_analysis':
          // For Kuze pattern analysis
          if (typeof agent.execute === 'function') {
            return await agent.execute({ type: 'analyze', payload });
          }
          return { success: true };

        case 'threat_scan':
          // For Batou security scans
          if (typeof agent.execute === 'function') {
            return await agent.execute({ type: 'scan', payload: {} });
          }
          return { success: true, threats: 0 };

        default:
          // Generic task execution
          if (typeof agent.execute === 'function') {
            return await agent.execute({ type, payload });
          }
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[MicroAgentBridge] ${agentName} error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get standardized status for an agent
   */
  getAgentStatus(agent) {
    const status = agent.getStatus();
    
    return {
      success: true,
      status: {
        id: agent.id,
        name: agent.name || 'unnamed',
        type: agent.type,
        state: agent.state,
        uptime: Date.now() - agent.createdAt,
        metrics: agent.metrics,
        ...status
      }
    };
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(name) {
    if (!this.registered.has(name)) {
      return false;
    }

    try {
      messageBroker.unregisterArbiter(name);
      this.agents.delete(name);
      this.registered.delete(name);
      
      this.logger.info(`[MicroAgentBridge] Unregistered ${name}`);
      return true;
    } catch (err) {
      this.logger.error(`[MicroAgentBridge] Failed to unregister ${name}: ${err.message}`);
      return false;
    }
  }

  /**
   * Unregister all agents
   */
  unregisterAll() {
    const agents = Array.from(this.registered);
    for (const name of agents) {
      this.unregisterAgent(name);
    }
  }

  /**
   * Get all registered agents
   */
  getRegisteredAgents() {
    return Array.from(this.registered);
  }

  /**
   * Check if an agent is registered
   */
  isRegistered(name) {
    return this.registered.has(name);
  }
}

// Singleton instance
const bridge = new MicroAgentBridge();

module.exports = bridge;
