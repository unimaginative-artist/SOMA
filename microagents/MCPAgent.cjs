// MCPAgent.cjs
// Connects SOMA to MCP (Model Context Protocol) servers
// Makes MCP tools available as MicroAgent tasks!

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');
const fetch = require('node-fetch');

class MCPAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'mcp' });
    
    this.servers = new Map(); // serverUrl -> { tools, connected }
    this.discoveryUrls = config.discoveryUrls || [];
    this.timeout = config.timeout || 30000; // 30 seconds
  }
  
  /**
   * Execute MCP task
   * Task format:
   * {
   *   operation: 'call' | 'discover' | 'list_tools' | 'list_servers',
   *   server: 'http://imac.local:3000/mcp/github',
   *   tool: 'search_repositories',
   *   args: { query: 'AI', limit: 10 }
   * }
   */
  async execute(task) {
    const { operation = 'call', server, tool, args } = task;
    
    this.logger.info(`[MCPAgent:${this.id}] ${operation} operation`);
    
    switch (operation) {
      case 'call':
        return await this._callTool(server, tool, args);
      
      case 'discover':
        return await this._discover(task.urls);
      
      case 'list_tools':
        return await this._listTools(server);
      
      case 'list_servers':
        return this._listServers();
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  async _callTool(serverUrl, tool, args = {}) {
    if (!serverUrl) {
      throw new Error('MCP call requires server URL');
    }
    
    if (!tool) {
      throw new Error('MCP call requires tool name');
    }
    
    this.logger.info(`[MCPAgent:${this.id}] Calling ${tool} on ${serverUrl}`);
    
    try {
      // Ensure server is discovered
      if (!this.servers.has(serverUrl)) {
        await this._connectServer(serverUrl);
      }
      
      // Build MCP request
      const mcpRequest = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: tool,
          arguments: args
        }
      };
      
      // Call MCP server
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(mcpRequest),
        timeout: this.timeout
      });
      
      if (!response.ok) {
        throw new Error(`MCP server error: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.error) {
        throw new Error(`MCP tool error: ${result.error.message || JSON.stringify(result.error)}`);
      }
      
      this.logger.info(`[MCPAgent:${this.id}] Tool ${tool} completed successfully`);
      
      return {
        success: true,
        server: serverUrl,
        tool,
        result: result.result,
        timestamp: Date.now()
      };
      
    } catch (err) {
      this.logger.error(`[MCPAgent:${this.id}] Tool call failed: ${err.message}`);
      throw err;
    }
  }
  
  async _connectServer(serverUrl) {
    this.logger.info(`[MCPAgent:${this.id}] Connecting to MCP server: ${serverUrl}`);
    
    try {
      // Request server info and available tools
      const infoRequest = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          clientInfo: {
            name: 'SOMA-MCPAgent',
            version: '1.0.0'
          }
        }
      };
      
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(infoRequest),
        timeout: this.timeout
      });
      
      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.status} ${response.statusText}`);
      }
      
      const serverInfo = await response.json();
      
      // Get available tools
      const toolsRequest = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/list',
        params: {}
      };
      
      const toolsResponse = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(toolsRequest),
        timeout: this.timeout
      });
      
      const toolsData = await toolsResponse.json();
      const tools = toolsData.result?.tools || [];
      
      this.servers.set(serverUrl, {
        connected: true,
        serverInfo: serverInfo.result,
        tools,
        connectedAt: Date.now()
      });
      
      this.logger.info(`[MCPAgent:${this.id}] Connected to ${serverUrl} - ${tools.length} tools available`);
      
      return { success: true, tools: tools.length };
      
    } catch (err) {
      this.logger.error(`[MCPAgent:${this.id}] Connection failed: ${err.message}`);
      throw err;
    }
  }
  
  async _discover(urls) {
    const discoveryList = urls || this.discoveryUrls;
    
    if (discoveryList.length === 0) {
      throw new Error('No discovery URLs provided');
    }
    
    this.logger.info(`[MCPAgent:${this.id}] Discovering MCP servers...`);
    
    const results = [];
    
    for (const url of discoveryList) {
      try {
        await this._connectServer(url);
        results.push({ url, success: true });
      } catch (err) {
        results.push({ url, success: false, error: err.message });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    this.logger.info(`[MCPAgent:${this.id}] Discovery complete: ${successCount}/${discoveryList.length} servers`);
    
    return {
      discovered: successCount,
      total: discoveryList.length,
      results
    };
  }
  
  async _listTools(serverUrl) {
    if (!serverUrl) {
      // List tools from all servers
      const allTools = {};
      
      for (const [url, server] of this.servers.entries()) {
        allTools[url] = server.tools;
      }
      
      return {
        servers: this.servers.size,
        tools: allTools
      };
    }
    
    // List tools from specific server
    const server = this.servers.get(serverUrl);
    
    if (!server) {
      throw new Error(`Server not connected: ${serverUrl}`);
    }
    
    return {
      server: serverUrl,
      tools: server.tools,
      count: server.tools.length
    };
  }
  
  _listServers() {
    const servers = [];
    
    for (const [url, server] of this.servers.entries()) {
      servers.push({
        url,
        connected: server.connected,
        tools: server.tools.length,
        connectedAt: server.connectedAt,
        serverInfo: {
          name: server.serverInfo?.serverInfo?.name,
          version: server.serverInfo?.serverInfo?.version
        }
      });
    }
    
    return {
      count: servers.length,
      servers
    };
  }
  
  async initialize() {
    await super.initialize();
    
    // Auto-discover servers on initialization
    if (this.discoveryUrls.length > 0) {
      try {
        await this._discover();
      } catch (err) {
        this.logger.warn(`[MCPAgent:${this.id}] Auto-discovery failed: ${err.message}`);
      }
    }
  }
}

module.exports = { MCPAgent };
