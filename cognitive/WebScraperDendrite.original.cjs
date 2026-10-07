// ═══════════════════════════════════════════════════════════
// FILE: WebScraperDendrite.cjs
// Web scraping dendrite extending BaseDendrite
// Routes tasks to MCP scraping tools (no rate limits)
// Targets: ArXiv, Wikipedia, GitHub, Stack Overflow, News
// ═══════════════════════════════════════════════════════════

const { BaseDendrite } = require('./BaseDendrite.cjs');

class WebScraperDendrite extends BaseDendrite {
  constructor(config = {}) {
    super({
      name: config.name || `web-scraper-${Date.now()}`,
      type: 'web-scraper',
      capabilities: ['arxiv', 'wikipedia', 'github', 'stackoverflow', 'news'],
      maxConcurrent: config.maxConcurrent || 5,
      maxQueue: config.maxQueue || 500,
      ...config
    });

    // MCP Tool Manager reference (will be injected)
    this.mcpTools = config.mcpTools || null;

    // Scraping targets configuration
    this.targets = config.targets || {
      arxiv: { enabled: true, priority: 'high' },
      wikipedia: { enabled: true, priority: 'high' },
      github: { enabled: true, priority: 'medium' },
      stackoverflow: { enabled: true, priority: 'high' },
      news: { enabled: true, priority: 'medium' },
      url: { enabled: true, priority: 'high' }
    };

    // Results storage
    this.scrapedData = [];
    this.maxStoredResults = config.maxStoredResults || 1000;
    
    // Message Broker reference (for handling requests from other arbiters)
    this.messageBroker = config.messageBroker || null;

    this.logger.info(`[${this.name}] 🕷️ WebScraperDendrite ready`);
    this.logger.info(`[${this.name}] Enabled targets: ${Object.keys(this.targets).filter(t => this.targets[t].enabled).join(', ')}`);
  }
  
  async initialize() {
    // Register with message broker if available
    if (this.messageBroker) {
      try {
        this.messageBroker.registerArbiter(this.name, {
          instance: this,
          type: 'web-scraper',
          capabilities: ['web_search']
        });
        
        this.messageBroker.subscribe('web_search', this._handleSearchRequest.bind(this));
        
        this.logger.info(`[${this.name}] 📬 Listening for search requests`);
      } catch (err) {
        this.logger.warn(`[${this.name}] Message broker registration failed: ${err.message}`);
      }
    }
  }
  
  async _handleSearchRequest(message) {
    const { query, target, context } = message.payload;
    const searchTarget = target || 'google'; // Default to google/brave if not specified
    
    this.logger.info(`[${this.name}] 📨 Received search request: "${query}" (${searchTarget}) from ${message.from}`);
    
    try {
      // Execute the search using MCP tools or Dendrite fallback
      let results;
      
      if (searchTarget === 'stackoverflow' || searchTarget === 'github' || searchTarget === 'arxiv') {
        // Use existing processTask flow for specialized targets
        const taskResult = await this.processTask({ 
          target: searchTarget, 
          query, 
          maxResults: 5 
        });
        results = taskResult.results;
      } else {
        // General web search (using Brave/Google via Dendrite if available, or fallback)
        // Since we don't have a direct "google" tool in processTask yet, we'll try to use the MCP tool "brave_search" if available
        // OR simply reuse the 'wikipedia' logic if it's a general info request
        
        // For now, map 'general' or 'google' to 'wikipedia' + 'stackoverflow' combo if strictly limited,
        // BUT better to assume an MCP tool exists for general search if mcpTools is set.
        
        if (this.mcpTools && await this.mcpTools.hasTool('brave_search')) {
             const mcpRes = await this.mcpTools.invokeTool('brave_search', { query, count: 5 });
             results = mcpRes.result;
        } else {
             // Fallback: try stackoverflow for code questions
             const taskResult = await this.processTask({ 
                target: 'stackoverflow', 
                query, 
                maxResults: 5 
             });
             results = taskResult.results;
        }
      }
      
      // Reply to sender
      await this.messageBroker.sendMessage({
        from: this.name,
        to: message.from,
        type: 'search_results',
        payload: {
          query,
          results: results || [],
          context
        }
      });
      
    } catch (err) {
      this.logger.error(`[${this.name}] Search request failed: ${err.message}`);
      await this.messageBroker.sendMessage({
        from: this.name,
        to: message.from,
        type: 'search_failed',
        payload: { error: err.message, query }
      });
    }
  }

  /**
   * Set MCP Tools reference (injected by EdgeWorkerOrchestrator)
   */
  setMCPTools(mcpTools) {
    this.mcpTools = mcpTools;
    this.logger.info(`[${this.name}] MCP Tools connected`);
  }

  /**
   * Process scraping task
   * Task format: { target: 'arxiv|wikipedia|github|stackoverflow|news', query: string, maxResults?: number }
   */
  async processTask(task, ctx = {}) {
    if (!this.mcpTools) {
      throw new Error('MCP Tools not configured');
    }

    const { target, query, maxResults, source } = task;

    if (!target || !query) {
      throw new Error('Task must have target and query');
    }

    // Check if target is enabled
    if (!this.targets[target] || !this.targets[target].enabled) {
      throw new Error(`Target not enabled: ${target}`);
    }

    this.logger.info(`[${this.name}] Scraping ${target}: "${query}"`);

    let toolName;
    let params = { query };

    // Map task target to MCP tool
    switch (target) {
      case 'arxiv':
        toolName = 'scrape_arxiv';
        params.maxResults = maxResults || 5;
        break;

      case 'wikipedia':
        toolName = 'scrape_wikipedia';
        break;

      case 'github':
        toolName = 'scrape_github';
        params.maxResults = maxResults || 5;
        break;

      case 'stackoverflow':
        toolName = 'scrape_stackoverflow';
        params.maxResults = maxResults || 5;
        break;

      case 'news':
        toolName = 'scrape_news';
        params.maxResults = maxResults || 10;
        params.source = source || 'hacker-news';
        break;

      case 'url':
        toolName = 'browse_url';
        params.url = query;
        break;

      default:
        throw new Error(`Unknown target: ${target}`);
    }

    // Invoke MCP tool
    const result = await this.mcpTools.invokeTool(toolName, params);

    if (result.success) {
      // Store result
      this._storeResult({
        target,
        query,
        data: result.result,
        timestamp: Date.now(),
        taskId: ctx.taskId
      });

      this.logger.info(`[${this.name}] ✅ Scraped ${target}: ${result.result.count || 0} results`);

      return {
        success: true,
        target,
        query,
        results: result.result.results || result.result,
        count: result.result.count || 0,
        duration: result.duration
      };
    } else {
      throw new Error(`Scraping failed: ${result.error}`);
    }
  }

  /**
   * Store scraped results (with size limit)
   */
  _storeResult(result) {
    this.scrapedData.push(result);

    // Prune old results if exceeding limit
    if (this.scrapedData.length > this.maxStoredResults) {
      this.scrapedData = this.scrapedData.slice(-this.maxStoredResults);
    }
  }

  /**
   * Get all scraped data
   */
  getScrapedData() {
    return {
      count: this.scrapedData.length,
      data: this.scrapedData
    };
  }

  /**
   * Get scraped data by target
   */
  getScrapedDataByTarget(target) {
    return this.scrapedData.filter(item => item.target === target);
  }

  /**
   * Clear scraped data
   */
  clearScrapedData() {
    const count = this.scrapedData.length;
    this.scrapedData = [];
    this.logger.info(`[${this.name}] Cleared ${count} scraped results`);
    return { cleared: count };
  }

  /**
   * Override processHelperResult to aggregate results from helpers
   */
  async processHelperResult(result, from) {
    await super.processHelperResult(result, from);

    if (result && result.results) {
      this._storeResult({
        target: result.target,
        query: result.query,
        data: result,
        timestamp: Date.now(),
        source: from
      });

      this.logger.info(`[${this.name}] 📥 Aggregated ${result.count || 0} results from ${from}`);
    }
  }

  /**
   * Enhanced status with scraping metrics
   */
  getStatus() {
    const baseStatus = super.getStatus();

    return {
      ...baseStatus,
      scraping: {
        totalScraped: this.scrapedData.length,
        byTarget: {
          arxiv: this.getScrapedDataByTarget('arxiv').length,
          wikipedia: this.getScrapedDataByTarget('wikipedia').length,
          github: this.getScrapedDataByTarget('github').length,
          stackoverflow: this.getScrapedDataByTarget('stackoverflow').length,
          news: this.getScrapedDataByTarget('news').length
        },
        targets: this.targets,
        mcpConnected: this.mcpTools !== null
      }
    };
  }
}

module.exports = { WebScraperDendrite };
