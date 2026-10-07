/**
 * MCPDendrite - Enhanced web crawler using MCP Tool Manager
 *
 * Combines dendrite load-balancing with MCP's rich tool ecosystem:
 * - Web scraping (ArXiv, Wikipedia, GitHub, Stack Overflow, news)
 * - File operations
 * - Memory queries
 * - Code execution
 *
 * NO API KEYS NEEDED for most tools!
 */

const { BaseDendrite } = require('./BaseDendrite.cjs');
const MCPToolManager = require('../a cognitive terminal/server/MCPToolManager.cjs');

class MCPDendrite extends BaseDendrite {
  constructor(config = {}) {
    super({
      name: config.name || 'MCP-Dendrite',
      type: 'mcp-knowledge-gatherer',
      capabilities: ['web_scraping', 'research', 'code_search', 'news', 'memory'],
      maxConcurrent: config.maxConcurrent || 3,
      maxQueue: config.maxQueue || 500,
      ...config
    });

    // Initialize MCP Tool Manager
    this.mcpTools = new MCPToolManager({
      name: `${this.name}-MCP`,
      mnemonicArbiter: config.mnemonicArbiter || null,
      enableFileOps: false, // Disable for safety in auto mode
      enableWebSearch: true, // Enable web scraping
      enableCodeExec: false, // Disable for safety
      enableShellExec: false, // Disable for safety
      enableMemoryQuery: true, // Enable memory access
      verbose: config.verbose || false
    });

    // Available MCP tools for knowledge gathering
    this.availableTools = [
      'scrape_arxiv',        // Research papers
      'scrape_wikipedia',    // General knowledge
      'scrape_github',       // Code repositories
      'scrape_stackoverflow', // Programming Q&A
      'scrape_news'          // Current events (Hacker News, Dev.to)
    ];

    this.logger.info(`[${this.name}] 🕷️ MCP-powered dendrite ready`);
    this.logger.info(`[${this.name}] Available tools: ${this.availableTools.join(', ')}`);
  }

  /**
   * Process a knowledge gathering task using MCP tools
   *
   * Task format:
   * {
   *   type: 'research' | 'code_search' | 'news' | 'qa' | 'knowledge',
   *   query: string,
   *   sources: ['arxiv', 'wikipedia', 'github', 'stackoverflow', 'news'],
   *   maxResults: number
   * }
   */
  async processTask(task, ctx = {}) {
    const { type, query, sources, maxResults = 5 } = task;

    if (!query) {
      throw new Error('Task must include query');
    }

    this.logger.info(`[${this.name}] 📚 Gathering knowledge: "${query}" (type: ${type})`);

    const results = {
      query,
      type,
      sources: [],
      totalResults: 0,
      discoveries: [],
      timestamp: new Date().toISOString()
    };

    // Determine which sources to use based on task type
    const targetSources = sources || this._selectSourcesForType(type);

    // Gather from each source in parallel
    const gatherPromises = targetSources.map(async (source) => {
      try {
        return await this._gatherFromSource(source, query, maxResults);
      } catch (err) {
        this.logger.warn(`[${this.name}] Failed to gather from ${source}: ${err.message}`);
        return null;
      }
    });

    const sourceResults = await Promise.allSettled(gatherPromises);

    // Compile results
    for (const result of sourceResults) {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        results.sources.push(data.source);
        results.totalResults += data.count || 0;
        results.discoveries.push(data);
      }
    }

    // Store in memory if available
    if (this.mcpTools.mnemonicArbiter && results.totalResults > 0) {
      try {
        await this.mcpTools.invokeTool('store_memory', {
          content: `Knowledge gathering: ${query}`,
          metadata: {
            type: 'knowledge_discovery',
            query,
            sources: results.sources,
            totalResults: results.totalResults,
            timestamp: results.timestamp
          }
        });
        this.logger.info(`[${this.name}] 💾 Stored discoveries in memory`);
      } catch (err) {
        this.logger.warn(`[${this.name}] Failed to store in memory: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * Select appropriate sources based on task type
   */
  _selectSourcesForType(type) {
    const sourceMap = {
      research: ['arxiv', 'wikipedia'],
      code_search: ['github', 'stackoverflow'],
      news: ['news'],
      qa: ['stackoverflow', 'wikipedia'],
      knowledge: ['wikipedia', 'arxiv']
    };

    return sourceMap[type] || ['wikipedia']; // Default to Wikipedia
  }

  /**
   * Gather knowledge from a specific source using MCP tools
   */
  async _gatherFromSource(source, query, maxResults = 5) {
    const startTime = Date.now();

    let toolName = null;
    let toolParams = null;

    // Map source to MCP tool
    switch (source) {
      case 'arxiv':
        toolName = 'scrape_arxiv';
        toolParams = { query, maxResults };
        break;

      case 'wikipedia':
        toolName = 'scrape_wikipedia';
        toolParams = { query };
        break;

      case 'github':
        toolName = 'scrape_github';
        toolParams = { query, maxResults };
        break;

      case 'stackoverflow':
        toolName = 'scrape_stackoverflow';
        toolParams = { query, maxResults };
        break;

      case 'news':
        toolName = 'scrape_news';
        toolParams = {
          query,
          source: 'hacker-news', // Can be 'hacker-news', 'dev.to', 'reddit'
          maxResults
        };
        break;

      default:
        throw new Error(`Unknown source: ${source}`);
    }

    // Invoke MCP tool
    this.logger.info(`[${this.name}] 🔍 Scraping ${source} for: "${query}"`);
    const result = await this.mcpTools.invokeTool(toolName, toolParams);

    if (!result.success) {
      throw new Error(result.error || 'Tool execution failed');
    }

    const duration = Date.now() - startTime;
    const data = result.result;

    this.logger.info(
      `[${this.name}] ✅ ${source}: Found ${data.count || 0} results in ${duration}ms`
    );

    return {
      source,
      ...data,
      duration
    };
  }

  /**
   * Batch knowledge discovery (for nighttime learning)
   *
   * Topics example:
   * [
   *   { topic: 'quantum computing', type: 'research' },
   *   { topic: 'neural architecture search', type: 'research' },
   *   { topic: 'react hooks', type: 'code_search' }
   * ]
   */
  async discoverKnowledge(topics = [], options = {}) {
    const maxResultsPerTopic = options.maxResultsPerTopic || 3;
    const allDiscoveries = [];

    this.logger.info(`[${this.name}] 🌐 Starting batch knowledge discovery for ${topics.length} topics`);

    for (const topicConfig of topics) {
      const { topic, type = 'knowledge', sources } = topicConfig;

      try {
        // Add task to queue
        const result = await this.addTask({
          type,
          query: topic,
          sources,
          maxResults: maxResultsPerTopic
        });

        if (result.success) {
          this.logger.info(`[${this.name}] ✅ Queued: ${topic}`);
        }
      } catch (err) {
        this.logger.error(`[${this.name}] ❌ Failed to queue ${topic}: ${err.message}`);
      }
    }

    // Wait for queue to drain
    await this._waitForQueueDrain();

    return {
      success: true,
      topics: topics.length,
      metrics: this.getStatus()
    };
  }

  /**
   * Wait for queue to be processed
   */
  async _waitForQueueDrain(timeout = 300000) {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.state.queueSize === 0 && this.state.processing === 0) {
          clearInterval(checkInterval);
          resolve(true);
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error('Queue drain timeout'));
        }
      }, 1000);
    });
  }

  /**
   * Get MCP tool status
   */
  getMCPStatus() {
    return this.mcpTools.getStatus();
  }

  /**
   * Enhanced status with MCP info
   */
  getStatus() {
    const baseStatus = super.getStatus();
    return {
      ...baseStatus,
      mcp: {
        availableTools: this.availableTools,
        toolMetrics: this.mcpTools.metrics
      }
    };
  }
}

module.exports = { MCPDendrite };
