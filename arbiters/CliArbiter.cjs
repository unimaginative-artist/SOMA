// ═══════════════════════════════════════════════════════════
// FILE: arbiters/CliArbiter.cjs
// Command Line Interface Arbiter
// Routes CLI commands to appropriate arbiters via MessageBroker
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

class CliArbiter extends BaseArbiter {
  static role = 'cli-interface';
  static capabilities = ['command-routing', 'output-formatting', 'interactive-mode'];

  constructor(config = {}) {
    super(config);

    // Command history
    this.commandHistory = [];
    this.maxHistorySize = 1000;

    // Response formatters
    this.formatters = {
      table: this._formatTable.bind(this),
      list: this._formatList.bind(this),
      json: this._formatJson.bind(this),
      status: this._formatStatus.bind(this),
      error: this._formatError.bind(this)
    };

    // Command registry
    this.commands = new Map();
    this._registerCommands();

    this.logger.info(`[${this.name}] 🖥️ CLI Arbiter initializing...`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    this.logger.info(`[${this.name}] ✅ CLI interface ready`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: CliArbiter.role,
        capabilities: CliArbiter.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // CLI-specific messages
    messageBroker.subscribe(this.name, 'cli_command');
    messageBroker.subscribe(this.name, 'cli_notification');

    // Status updates from other arbiters
    messageBroker.subscribe(this.name, 'goal_created');
    messageBroker.subscribe(this.name, 'goal_completed');
    messageBroker.subscribe(this.name, 'skill_degraded');
    messageBroker.subscribe(this.name, 'knowledge_acquired');
    messageBroker.subscribe(this.name, 'research_complete');
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ COMMAND REGISTRATION ░░
  // ═══════════════════════════════════════════════════════════

  _registerCommands() {
    // Goals commands
    this.commands.set('goals:list', {
      target: 'GoalPlannerArbiter',
      message: 'list_goals',
      formatter: 'table'
    });
    this.commands.set('goals:status', {
      target: 'GoalPlannerArbiter',
      message: 'get_goal_status',
      formatter: 'status'
    });
    this.commands.set('goals:create', {
      target: 'GoalPlannerArbiter',
      message: 'create_goal',
      formatter: 'status'
    });
    this.commands.set('goals:active', {
      target: 'GoalPlannerArbiter',
      message: 'list_active_goals',
      formatter: 'list'
    });

    // Research commands
    this.commands.set('research:start', {
      target: 'EdgeWorkerOrchestrator',
      message: 'start_research',
      formatter: 'status'
    });
    this.commands.set('research:status', {
      target: 'EdgeWorkerOrchestrator',
      message: 'get_research_status',
      formatter: 'status'
    });
    this.commands.set('research:history', {
      target: 'EdgeWorkerOrchestrator',
      message: 'get_research_history',
      formatter: 'list'
    });

    // Skills commands
    this.commands.set('skills:list', {
      target: 'SkillAcquisitionArbiter',
      message: 'list_skills',
      formatter: 'table'
    });
    this.commands.set('skills:practice', {
      target: 'SkillAcquisitionArbiter',
      message: 'start_practice',
      formatter: 'status'
    });
    this.commands.set('skills:gaps', {
      target: 'SkillAcquisitionArbiter',
      message: 'get_knowledge_gaps',
      formatter: 'list'
    });
    this.commands.set('skills:certified', {
      target: 'SkillAcquisitionArbiter',
      message: 'list_certified_skills',
      formatter: 'list'
    });

    // Schedule commands
    this.commands.set('schedule:list', {
      target: 'TimekeeperArbiter',
      message: 'list_rhythms',
      formatter: 'table'
    });
    this.commands.set('schedule:next', {
      target: 'TimekeeperArbiter',
      message: 'get_next_event',
      formatter: 'status'
    });
    this.commands.set('schedule:load', {
      target: 'TimekeeperArbiter',
      message: 'get_load_status',
      formatter: 'status'
    });

    // Codebase commands
    this.commands.set('codebase:scan', {
      target: 'CodeObservationArbiter',
      message: 'trigger_scan',
      formatter: 'status'
    });
    this.commands.set('codebase:health', {
      target: 'CodeObservationArbiter',
      message: 'get_health_metrics',
      formatter: 'status'
    });
    this.commands.set('codebase:opportunities', {
      target: 'CodeObservationArbiter',
      message: 'get_improvements',
      formatter: 'list'
    });

    // Prediction commands
    this.commands.set('predict:next', {
      target: 'ForecasterArbiter',
      message: 'predict_next_action',
      formatter: 'status'
    });
    this.commands.set('suggest', {
      target: 'ForecasterArbiter',
      message: 'get_suggestions',
      formatter: 'list'
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ COMMAND PROCESSING ░░
  // ═══════════════════════════════════════════════════════════

  async processCommand(commandString, options = {}) {
    try {
      // Parse command
      const { command, args } = this._parseCommand(commandString);

      // Add to history
      this.commandHistory.push({
        command: commandString,
        timestamp: Date.now(),
        args
      });

      if (this.commandHistory.length > this.maxHistorySize) {
        this.commandHistory.shift();
      }

      // Get command mapping
      const cmdMap = this.commands.get(command);
      if (!cmdMap) {
        return this._formatError(`Unknown command: ${command}`);
      }

      // Route to target arbiter
      const response = await this._routeCommand(cmdMap, args);

      // Format response
      const formatter = this.formatters[cmdMap.formatter] || this.formatters.json;
      return formatter(response, options);

    } catch (err) {
      this.logger.error(`[${this.name}] Command failed: ${err.message}`);
      return this._formatError(err.message);
    }
  }

  _parseCommand(commandString) {
    const parts = commandString.trim().split(/\s+/);
    const command = parts[0];
    const args = {};

    // Parse flags and arguments
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('--')) {
        const key = part.slice(2);
        const value = parts[i + 1] && !parts[i + 1].startsWith('--') ? parts[i + 1] : true;
        args[key] = value;
        if (value !== true) i++;
      } else if (!part.startsWith('-')) {
        args._positional = args._positional || [];
        args._positional.push(part);
      }
    }

    return { command, args };
  }

  async _routeCommand(cmdMap, args) {
    const { target, message } = cmdMap;

    // Publish message to target arbiter
    const response = await messageBroker.request(target, message, args);

    return response;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ OUTPUT FORMATTERS ░░
  // ═══════════════════════════════════════════════════════════

  _formatTable(data, options = {}) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return 'No data to display.';
    }

    const columns = options.columns || Object.keys(data[0]);
    const widths = {};

    // Calculate column widths
    columns.forEach(col => {
      widths[col] = Math.max(
        col.length,
        ...data.map(row => String(row[col] || '').length)
      );
    });

    // Header
    let output = '\n';
    output += columns.map(col => col.padEnd(widths[col])).join('  ');
    output += '\n';
    output += columns.map(col => '─'.repeat(widths[col])).join('──');
    output += '\n';

    // Rows
    data.forEach(row => {
      output += columns.map(col => String(row[col] || '').padEnd(widths[col])).join('  ');
      output += '\n';
    });

    return output;
  }

  _formatList(data, options = {}) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return 'No items to display.';
    }

    let output = '\n';
    data.forEach((item, idx) => {
      if (typeof item === 'string') {
        output += `  ${idx + 1}. ${item}\n`;
      } else if (item.title || item.name) {
        output += `  ${idx + 1}. ${item.title || item.name}`;
        if (item.status) output += ` [${item.status}]`;
        output += '\n';
      } else {
        output += `  ${idx + 1}. ${JSON.stringify(item)}\n`;
      }
    });

    return output;
  }

  _formatJson(data, options = {}) {
    return '\n' + JSON.stringify(data, null, 2) + '\n';
  }

  _formatStatus(data, options = {}) {
    if (!data) return 'No status data available.';

    let output = '\n';
    if (data.title) output += `${data.title}\n`;
    if (data.status) output += `Status: ${data.status}\n`;
    if (data.message) output += `${data.message}\n`;

    if (data.details) {
      output += '\nDetails:\n';
      for (const [key, value] of Object.entries(data.details)) {
        output += `  ${key}: ${value}\n`;
      }
    }

    return output;
  }

  _formatError(message) {
    return `\n❌ Error: ${message}\n`;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ NOTIFICATION HANDLING ░░
  // ═══════════════════════════════════════════════════════════

  async handleMessage(message) {
    const { type, payload } = message;

    switch (type) {
      case 'goal_created':
        this._notifyGoalCreated(payload);
        break;
      case 'goal_completed':
        this._notifyGoalCompleted(payload);
        break;
      case 'skill_degraded':
        this._notifySkillDegraded(payload);
        break;
      case 'knowledge_acquired':
        this._notifyKnowledgeAcquired(payload);
        break;
      case 'research_complete':
        this._notifyResearchComplete(payload);
        break;
    }
  }

  _notifyGoalCreated(payload) {
    console.log(`🎯 New goal created: ${payload.title}`);
  }

  _notifyGoalCompleted(payload) {
    console.log(`✅ Goal completed: ${payload.title}`);
  }

  _notifySkillDegraded(payload) {
    console.log(`⚠️  Skill degraded: ${payload.skill} (${payload.proficiency}%)`);
  }

  _notifyKnowledgeAcquired(payload) {
    console.log(`📚 Knowledge acquired: ${payload.topic}`);
  }

  _notifyResearchComplete(payload) {
    console.log(`🔬 Research complete: ${payload.topic} (${payload.resultsCount} results)`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATS & HEALTH ░░
  // ═══════════════════════════════════════════════════════════

  getStats() {
    return {
      commandsExecuted: this.commandHistory.length,
      commandsRegistered: this.commands.size,
      recentCommands: this.commandHistory.slice(-10)
    };
  }

  async shutdown() {
    this.logger.info(`[${this.name}] Shutting down CLI interface...`);
    await super.shutdown();
  }
}

module.exports = { CliArbiter };
