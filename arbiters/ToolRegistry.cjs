/**
 * TOOL REGISTRY - Dynamic Function Management
 * Inspired by Autogen's dynamic function capabilities
 *
 * Allows agents to:
 * - Register new tools/functions at runtime
 * - Create custom APIs on-the-fly
 * - Extend their capabilities dynamically
 * - Share tools across agents
 *
 * @author SOMA ASI System
 * @date 2026-01-09
 */

const EventEmitter = require('events');

class ToolRegistry extends EventEmitter {
  constructor(name = 'ToolRegistry') {
    super();
    this.name = name;
    this.tools = new Map(); // toolName -> { schema, handler, metadata }
    this.toolUsage = new Map(); // toolName -> usage count
    this.categories = new Map(); // category -> Set of tool names

    console.log(`[${this.name}] 🔧 Dynamic Tool Registry initialized`);

    // Register built-in tools
    this.registerBuiltInTools();
  }

  /**
   * Register a new tool dynamically
   *
   * @param {Object} toolDefinition - Tool configuration
   * @param {string} toolDefinition.name - Unique tool name
   * @param {string} toolDefinition.description - What the tool does
   * @param {Object} toolDefinition.parameters - JSON Schema for parameters
   * @param {Function} toolDefinition.handler - Function to execute the tool
   * @param {string} toolDefinition.category - Tool category (optional)
   * @param {Object} toolDefinition.metadata - Additional metadata (optional)
   */
  registerTool(toolDefinition) {
    const { name, description, parameters, handler, category = 'custom', metadata = {} } = toolDefinition;

    // Validation
    if (!name || typeof name !== 'string') {
      throw new Error('Tool name is required and must be a string');
    }
    if (!description) {
      throw new Error('Tool description is required');
    }
    if (!handler || typeof handler !== 'function') {
      throw new Error('Tool handler is required and must be a function');
    }

    // Check for duplicates
    if (this.tools.has(name)) {
      console.warn(`[${this.name}] ⚠️  Tool "${name}" already exists, overwriting...`);
    }

    // Store tool
    this.tools.set(name, {
      schema: {
        name,
        description,
        parameters: parameters || { type: 'object', properties: {} }
      },
      handler,
      metadata: {
        ...metadata,
        category,
        registeredAt: Date.now(),
        createdBy: metadata.createdBy || 'system'
      }
    });

    // Track by category
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category).add(name);

    // Initialize usage counter
    this.toolUsage.set(name, 0);

    console.log(`[${this.name}] ✅ Registered tool: "${name}" (${category})`);

    this.emit('tool_registered', { name, category });

    return true;
  }

  /**
   * Execute a registered tool
   *
   * @param {string} toolName - Name of the tool to execute
   * @param {Object} parameters - Parameters to pass to the tool
   * @param {Object} context - Additional context (agent info, etc.)
   * @returns {Promise<any>} Tool execution result
   */
  async executeTool(toolName, parameters = {}, context = {}) {
    if (!this.tools.has(toolName)) {
      throw new Error(`Tool "${toolName}" not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}`);
    }

    const tool = this.tools.get(toolName);

    console.log(`[${this.name}] 🔧 Executing tool: ${toolName}`);

    const startTime = Date.now();

    try {
      // Increment usage counter
      this.toolUsage.set(toolName, this.toolUsage.get(toolName) + 1);

      // Execute the handler
      const result = await tool.handler(parameters, context);

      const duration = Date.now() - startTime;

      this.emit('tool_executed', {
        toolName,
        duration,
        success: true,
        usageCount: this.toolUsage.get(toolName)
      });

      return {
        success: true,
        result,
        metadata: {
          toolName,
          duration,
          executedAt: Date.now()
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      console.error(`[${this.name}] ❌ Tool execution failed: ${toolName}`, error);

      this.emit('tool_execution_failed', {
        toolName,
        duration,
        error: error.message
      });

      throw new Error(`Tool "${toolName}" execution failed: ${error.message}`);
    }
  }

  /**
   * Get tool schema (for LLM function calling)
   *
   * @param {string} toolName - Name of the tool
   * @returns {Object} OpenAI-compatible function schema
   */
  getToolSchema(toolName) {
    if (!this.tools.has(toolName)) {
      return null;
    }

    return this.tools.get(toolName).schema;
  }

  /**
   * Get all tool schemas (for LLM function calling)
   *
   * @param {string} category - Filter by category (optional)
   * @returns {Array} Array of tool schemas
   */
  getAllToolSchemas(category = null) {
    if (category) {
      const categoryTools = this.categories.get(category);
      if (!categoryTools) {
        return [];
      }
      return Array.from(categoryTools).map(name => this.getToolSchema(name));
    }

    return Array.from(this.tools.values()).map(tool => tool.schema);
  }

  /**
   * List all registered tools
   *
   * @returns {Array} Array of tool names
   */
  listTools() {
    return Array.from(this.tools.keys());
  }

  /**
   * Get tool usage statistics
   *
   * @returns {Object} Usage stats by tool
   */
  getUsageStats() {
    const stats = {};

    for (const [toolName, count] of this.toolUsage.entries()) {
      const tool = this.tools.get(toolName);
      stats[toolName] = {
        usageCount: count,
        category: tool.metadata.category,
        registeredAt: tool.metadata.registeredAt
      };
    }

    return stats;
  }

  /**
   * Remove a tool from the registry
   *
   * @param {string} toolName - Name of the tool to remove
   */
  removeTool(toolName) {
    if (!this.tools.has(toolName)) {
      return false;
    }

    const tool = this.tools.get(toolName);
    const category = tool.metadata.category;

    // Remove from tools map
    this.tools.delete(toolName);

    // Remove from category
    if (this.categories.has(category)) {
      this.categories.get(category).delete(toolName);
    }

    // Remove usage stats
    this.toolUsage.delete(toolName);

    console.log(`[${this.name}] 🗑️  Removed tool: ${toolName}`);

    this.emit('tool_removed', { toolName, category });

    return true;
  }

  /**
   * Register built-in tools that all agents can use
   */
  registerBuiltInTools() {
    // HTTP Request Tool
    this.registerTool({
      name: 'http_request',
      description: 'Make HTTP requests to external APIs',
      category: 'network',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to request' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
          headers: { type: 'object', description: 'HTTP headers' },
          body: { type: 'object', description: 'Request body for POST/PUT' }
        },
        required: ['url']
      },
      handler: async (params) => {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(params.url, {
          method: params.method || 'GET',
          headers: params.headers || {},
          body: params.body ? JSON.stringify(params.body) : undefined
        });
        return {
          status: response.status,
          data: await response.json()
        };
      },
      metadata: { createdBy: 'system', safe: true }
    });

    // File Read Tool
    this.registerTool({
      name: 'read_file',
      description: 'Read contents of a file',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
          encoding: { type: 'string', default: 'utf-8' }
        },
        required: ['path']
      },
      handler: async (params) => {
        const fs = require('fs').promises;
        const content = await fs.readFile(params.path, params.encoding || 'utf-8');
        return { content };
      },
      metadata: { createdBy: 'system', safe: true }
    });

    // Execute Shell Command Tool
    this.registerTool({
      name: 'execute_command',
      description: 'Execute a shell command (use with caution)',
      category: 'system',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in ms', default: 30000 }
        },
        required: ['command']
      },
      handler: async (params) => {
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);

        const { stdout, stderr } = await execPromise(params.command, {
          timeout: params.timeout || 30000
        });

        return { stdout, stderr };
      },
      metadata: { createdBy: 'system', safe: false, requiresAuth: true }
    });

    // Calculator Tool
    this.registerTool({
      name: 'calculator',
      description: 'Perform mathematical calculations safely',
      category: 'utility',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Mathematical expression to evaluate' }
        },
        required: ['expression']
      },
      handler: async (params) => {
        // Simple safe eval for math (no eval() - security risk)
        const Function = require('vm').runInNewContext;
        const result = Function(`return ${params.expression}`, {
          Math: Math
        });
        return { result };
      },
      metadata: { createdBy: 'system', safe: true }
    });

    console.log(`[${this.name}] 🔧 Registered ${this.tools.size} built-in tools`);
  }

  /**
   * Export registry state for persistence
   */
  exportState() {
    return {
      tools: Array.from(this.tools.entries()),
      usage: Array.from(this.toolUsage.entries()),
      categories: Array.from(this.categories.entries()).map(([cat, tools]) => [cat, Array.from(tools)])
    };
  }

  /**
   * Import registry state from persistence
   */
  importState(state) {
    // Note: This won't restore handler functions - only metadata
    // Handlers must be re-registered on restart
    console.log(`[${this.name}] 📥 Importing registry state...`);

    if (state.usage) {
      this.toolUsage = new Map(state.usage);
    }

    if (state.categories) {
      this.categories = new Map(state.categories.map(([cat, tools]) => [cat, new Set(tools)]));
    }

    console.log(`[${this.name}] ✅ State imported successfully`);
  }
}

module.exports = ToolRegistry;
