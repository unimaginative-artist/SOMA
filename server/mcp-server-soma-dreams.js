#!/usr/bin/env node

/**
 * mcp-server-soma-dreams.js
 * 
 * MCP Server exposing SOMA DreamArbiter to tri-brain models
 * 
 * Tools:
 * - run_dream_cycle: Execute lucid dream cycle (since_hours, human_review)
 * - get_dream_reports: Retrieve recent dream reports
 * - queue_belief_update: Review and apply belief proposals
 * - dream_status: Get current dream engine status
 * 
 * Usage:
 *   node mcp-server-soma-dreams.js
 * 
 * Connect from Claude/Gemini/DeepSeek with MCP client pointing to this server
 */

const net = require('net');
const { EventEmitter } = require('events');
const path = require('path');

// ===========================
// MCP Protocol Implementation
// ===========================

class MCPServer extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.port = opts.port || 3001;
    this.host = opts.host || 'localhost';
    this.dreamArbiter = opts.dreamArbiter || null;
    this.transmitter = opts.transmitter || null;
    this.tools = this._buildTools();
    this.server = null;
    this.clients = new Set();
  }

  // ===========================
  // Server Lifecycle
  // ===========================

  async start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this._handleConnection(socket);
      });

      this.server.listen(this.port, this.host, () => {
        console.log(`[MCP] Server listening on ${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }

  // ===========================
  // Connection Handling
  // ===========================

  _handleConnection(socket) {
    console.log(`[MCP] Client connected from ${socket.remoteAddress}:${socket.remotePort}`);
    this.clients.add(socket);

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            this._handleMessage(socket, message);
          } catch (error) {
            console.error('[MCP] Parse error:', error.message);
            this._sendError(socket, 'parse_error', error.message);
          }
        }
      }
    });

    socket.on('end', () => {
      console.log(`[MCP] Client disconnected`);
      this.clients.delete(socket);
    });

    socket.on('error', (error) => {
      console.error('[MCP] Socket error:', error.message);
      this.clients.delete(socket);
    });

    // Send server info
    this._sendMessage(socket, {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocol_version: '2024-11-20',
        capabilities: {
          tools: {}
        },
        server_info: {
          name: 'soma-dreams',
          version: '1.0.0'
        }
      }
    });
  }

  // ===========================
  // Message Handling
  // ===========================

  async _handleMessage(socket, message) {
    const { jsonrpc, id, method, params } = message;

    try {
      let result;

      switch (method) {
        case 'tools/list':
          result = this._listTools();
          break;

        case 'tools/call':
          result = await this._callTool(params.name, params.arguments);
          break;

        case 'initialize':
          result = { ok: true, message: 'Server initialized' };
          break;

        default:
          throw new Error(`Unknown method: ${method}`);
      }

      this._sendMessage(socket, {
        jsonrpc: '2.0',
        id,
        result
      });
    } catch (error) {
      this._sendError(socket, id, error.message);
    }
  }

  // ===========================
  // Tools Definition
  // ===========================

  _buildTools() {
    return [
      {
        name: 'run_dream_cycle',
        description: 'Execute a lucid dream cycle on collected memories',
        inputSchema: {
          type: 'object',
          properties: {
            since_hours: {
              type: 'number',
              description: 'How many hours back to collect fragments (default: 24)',
              default: 24
            },
            human_review: {
              type: 'boolean',
              description: 'Require human review for all proposals (default: true)',
              default: true
            }
          },
          required: []
        }
      },
      {
        name: 'get_dream_reports',
        description: 'Retrieve recent dream cycle reports and insights',
        inputSchema: {
          type: 'object',
          properties: {
            count: {
              type: 'number',
              description: 'Number of recent reports to retrieve (default: 5)',
              default: 5
            }
          },
          required: []
        }
      },
      {
        name: 'queue_belief_update',
        description: 'Review and apply belief update proposals from dreams',
        inputSchema: {
          type: 'object',
          properties: {
            proposal_id: {
              type: 'string',
              description: 'ID of the proposal to review'
            },
            action: {
              type: 'string',
              enum: ['approve', 'reject', 'revise'],
              description: 'Action to take on the proposal'
            },
            confidence_threshold: {
              type: 'number',
              description: 'Minimum confidence (0-1) to auto-apply (default: 0.8)',
              default: 0.8
            }
          },
          required: ['proposal_id', 'action']
        }
      },
      {
        name: 'dream_status',
        description: 'Get current status of dream engine',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'start_background_dreams',
        description: 'Start automatic nightly dream cycles',
        inputSchema: {
          type: 'object',
          properties: {
            interval_hours: {
              type: 'number',
              description: 'Hours between dream cycles (default: 24)',
              default: 24
            }
          },
          required: []
        }
      },
      {
        name: 'stop_background_dreams',
        description: 'Stop automatic dream cycles',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }

  _listTools() {
    return { tools: this.tools };
  }

  // ===========================
  // Tool Execution
  // ===========================

  async _callTool(toolName, args = {}) {
    console.log(`[MCP] Executing tool: ${toolName}`, args);

    try {
      switch (toolName) {
        case 'run_dream_cycle':
          return await this._toolRunDreamCycle(args);

        case 'get_dream_reports':
          return await this._toolGetDreamReports(args);

        case 'queue_belief_update':
          return await this._toolQueueBeliefUpdate(args);

        case 'dream_status':
          return await this._toolDreamStatus(args);

        case 'start_background_dreams':
          return await this._toolStartBackgroundDreams(args);

        case 'stop_background_dreams':
          return await this._toolStopBackgroundDreams(args);

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    } catch (error) {
      console.error(`[MCP] Tool error in ${toolName}:`, error.message);
      throw error;
    }
  }

  // ===========================
  // Tool Implementations
  // ===========================

  async _toolRunDreamCycle(args) {
    if (!this.dreamArbiter) {
      throw new Error('DreamArbiter not available');
    }

    const since_hours = args.since_hours || 24;
    const human_review = args.human_review !== false;

    console.log(`[Dream] Starting cycle (${since_hours}h, review=${human_review})`);

    const result = await this.dreamArbiter.run(since_hours, human_review);

    return {
      success: !result.error,
      dream_id: result.summary?.id,
      fragments_analyzed: result.summary?.fragments_count || 0,
      proposals_generated: result.summary?.proposals_count || 0,
      proposals_applied: result.summary?.applied_count || 0,
      proposals_queued: result.summary?.queued_count || 0,
      dream_quality: result.summary?.dream_quality || 0,
      elapsed_seconds: result.summary?.elapsed_seconds || 0,
      error: result.error || null
    };
  }

  async _toolGetDreamReports(args) {
    if (!this.dreamArbiter) {
      throw new Error('DreamArbiter not available');
    }

    const count = args.count || 5;
    const reports = this.dreamArbiter.dream_reports.slice(-count);

    const fs = require('fs').promises;
    const contents = [];

    for (const reportPath of reports) {
      try {
        const content = await fs.readFile(reportPath, 'utf8');
        const data = JSON.parse(content);
        contents.push({
          path: reportPath,
          timestamp: data.summary?.ts,
          summary: data.summary
        });
      } catch (error) {
        console.warn(`[Dream] Failed to read report ${reportPath}:`, error.message);
      }
    }

    return {
      count: contents.length,
      reports: contents
    };
  }

  async _toolQueueBeliefUpdate(args) {
    const { proposal_id, action, confidence_threshold } = args;

    if (!proposal_id || !action) {
      throw new Error('proposal_id and action required');
    }

    // This would integrate with the actual proposal queue
    // For now, return a structured response
    return {
      proposal_id,
      action,
      status: 'processed',
      confidence_threshold: confidence_threshold || 0.8,
      message: `Proposal ${proposal_id} marked for ${action}`
    };
  }

  async _toolDreamStatus(args) {
    if (!this.dreamArbiter) {
      throw new Error('DreamArbiter not available');
    }

    return {
      name: this.dreamArbiter.name,
      state: this.dreamArbiter.state,
      running: this.dreamArbiter._running,
      dream_count: this.dreamArbiter.dream_reports.length,
      metrics: {
        tasks_completed: this.dreamArbiter.metrics.tasksCompleted,
        avg_duration_ms: Math.round(this.dreamArbiter.metrics.avgDuration),
        success_rate: Math.round(this.dreamArbiter.metrics.successRate * 100) + '%'
      }
    };
  }

  async _toolStartBackgroundDreams(args) {
    if (!this.dreamArbiter) {
      throw new Error('DreamArbiter not available');
    }

    const interval_hours = args.interval_hours || 24;
    this.dreamArbiter.start_background(interval_hours);

    return {
      status: 'started',
      interval_hours,
      message: `Background dreams started - cycle every ${interval_hours} hours`
    };
  }

  async _toolStopBackgroundDreams(args) {
    if (!this.dreamArbiter) {
      throw new Error('DreamArbiter not available');
    }

    this.dreamArbiter.stop_background();

    return {
      status: 'stopped',
      message: 'Background dream cycles stopped'
    };
  }

  // ===========================
  // Message Transport
  // ===========================

  _sendMessage(socket, message) {
    try {
      socket.write(JSON.stringify(message) + '\n');
    } catch (error) {
      console.error('[MCP] Send error:', error.message);
    }
  }

  _sendError(socket, id, message) {
    this._sendMessage(socket, {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message
      }
    });
  }
}

// ===========================
// Standalone Server
// ===========================

async function startServer() {
  console.log('🌙 SOMA MCP Dream Server v1.0.0');
  console.log('=====================================\n');

  // Import DreamArbiter
  const { DreamArbiter } = require('../arbiters/DreamArbiter.cjs');

  // Create mock transmitter if needed
  const transmitter = {
    getRecentInteractions: async (hours) => {
      console.log(`[Mock Transmitter] getRecentInteractions(${hours}h)`);
      return [
        {
          id: 'mock_1',
          text: 'SOMA learned about embeddings today',
          meta: { source: 'interaction' }
        },
        {
          id: 'mock_2',
          text: 'Discussed prediction accuracy improvements',
          meta: { source: 'interaction' }
        }
      ];
    },
    search: async (query, embedding, topK) => {
      console.log(`[Mock Transmitter] search("${query}", topK=${topK})`);
      return [];
    },
    addItem: async (item) => {
      console.log(`[Mock Transmitter] addItem`, item);
      return { id: `stored_${Date.now()}`, ...item };
    }
  };

  // Create DreamArbiter
  const dreamArbiter = new DreamArbiter({
    transmitter,
    name: 'DreamArbiter-MCP'
  });

  // Initialize arbiter
  try {
    await dreamArbiter.initialize();
    console.log('✅ DreamArbiter initialized\n');
  } catch (error) {
    console.error('❌ Failed to initialize DreamArbiter:', error.message);
    process.exit(1);
  }

  // Create and start MCP server
  const server = new MCPServer({
    port: process.env.MCP_PORT || 3001,
    host: '0.0.0.0',
    dreamArbiter,
    transmitter
  });

  try {
    await server.start();
    console.log(`✅ MCP Server started on port ${server.port}\n`);
    console.log('Available tools:');
    server.tools.forEach(tool => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    console.log('\nWaiting for connections...\n');
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n[MCP] Shutting down...');
    await dreamArbiter.shutdown();
    await server.stop();
    process.exit(0);
  });
}

// Start if run directly
if (require.main === module) {
  startServer().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { MCPServer };
