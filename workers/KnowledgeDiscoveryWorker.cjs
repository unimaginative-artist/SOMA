/**
 * KnowledgeDiscoveryWorker.cjs - Autonomous knowledge discovery via web search
 *
 * DUAL MODE SUPPORT:
 * 1. Brave Search (requires API key) - web, news, images, videos
 * 2. MCP Tools (NO API KEY) - ArXiv, Wikipedia, GitHub, Stack Overflow, news
 *
 * Falls back to MCP tools if Brave API not available!
 *
 * Runs during night learning cycles to discover:
 * - Latest research papers and articles (ArXiv, Brave)
 * - Technical documentation (Wikipedia, GitHub)
 * - Code examples (GitHub, Stack Overflow)
 * - News (Hacker News, Dev.to, Brave News)
 *
 * Feeds discoveries to Impulser for processing and memory storage
 */

const { Dendrite } = require('../cognitive/BraveSearchAdapter.cjs');
const { MCPDendrite } = require('../cognitive/MCPDendrite.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

class KnowledgeDiscoveryWorker {
  constructor(config = {}) {
    this.workerId = config.workerId || `kdw_${Date.now()}`;

    // Try Brave Search first, fall back to MCP tools
    this.useMCP = false;
    try {
      this.dendrite = new Dendrite(config.dendriteConfig);
      console.log(`🔍 ${this.workerId} initialized with Brave Search`);
    } catch (err) {
      // Brave API key not available - use MCP tools instead
      console.log(`🔍 ${this.workerId} Brave API not available, using MCP tools (NO API KEY NEEDED!)`);
      this.useMCP = true;
      this.mcpDendrite = new MCPDendrite({
        name: `${this.workerId}-MCP`,
        mnemonicArbiter: config.mnemonicArbiter || null,
        verbose: false
      });
    }

    // Discovery configuration
    this.topics = config.topics || [
      // AI & ML
      'artificial intelligence research 2025',
      'large language model architecture optimization',
      'sparse mixture of experts (MoE)',
      'state space models (Mamba/S4)',
      'reinforcement learning from human feedback (RLHF)',
      'constitutional AI safety',
      'multimodal fusion techniques',
      'active retrieval augmented generation (RAG)',
      
      // Neuroscience & Cognition
      'computational neuroscience perception',
      'synaptic plasticity algorithms',
      'predictive coding theory',
      'global neuronal workspace theory',
      'integrated information theory',
      'hippocampal replay mechanisms',
      
      // Distributed Systems
      'byzantine fault tolerance',
      'crdt conflict resolution',
      'federated learning protocols',
      'gossip protocols in distributed networks',
      'cryptographic verification methods',
      
      // Math & Theory
      'category theory in computer science',
      'graph theory centrality algorithms',
      'information geometry',
      'algorithmic information theory',
      'non-euclidean geometry in ML',

      // 🏥 Cancer Research (High Priority)
      'immunotherapy breakthroughs 2025',
      'oncology genetic sequencing and AI',
      'spiking neural networks in tumor detection',
      'precision medicine for aggressive carcinomas',
      'latest cancer clinical trial results 2025',

      // 📈 Finance (Audit & Tax)
      'IFRS 2025 audit standards',
      'generative AI in tax compliance and optimization',
      'fraud detection causal modeling in auditing',
      'SEC financial reporting automation',
      'corporate tax law changes 2025',
      'internal control assessment using neural agents'
    ];

    this.searchTypes = config.searchTypes || ['web', 'news'];
    this.maxResultsPerTopic = config.maxResultsPerTopic || 20; // Increased throughput
    this.continuous = config.continuous || false; // Infinite loop mode

    // Metrics
    this.metrics = {
      totalDiscoveries: 0,
      byType: { web: 0, news: 0, images: 0, videos: 0, mcp: 0 },
      sentToImpulser: 0,
      errors: 0,
      mode: this.useMCP ? 'MCP (no API key)' : 'Brave Search',
      cycles: 0
    };

    console.log(`   Mode: ${this.metrics.mode}`);
    console.log(`   Topics: ${this.topics.length}`);
    console.log(`   Search types: ${this.searchTypes.join(', ')}`);
    console.log(`   Continuous Learning: ${this.continuous ? 'ENABLED (Infinite Loop)' : 'Disabled'}`);
  }

  /**
   * Initialize the worker
   */
  async initialize() {
    // Initialization logic if needed
    console.log(`[${this.workerId}] ✅ KnowledgeDiscoveryWorker initialized`);
    return Promise.resolve();
  }

  /**
   * Run discovery session
   */
  async discover() {
    console.log(`\n[${this.workerId}] 🌐 Starting knowledge discovery session...`);
    console.log(`   Mode: ${this.useMCP ? '🔧 MCP Tools (NO API KEY)' : '🔑 Brave Search'}`);

    // Continuous loop if enabled
    if (this.continuous) {
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5;
        const baseDelay = 300000; // 5 minutes

        while (true) {
            // Prevent metrics.cycles overflow (cap at safe integer)
            if (this.metrics.cycles >= Number.MAX_SAFE_INTEGER - 1) {
                this.metrics.cycles = 0;
            }
            this.metrics.cycles++;
            console.log(`\n[${this.workerId}] 🔄 Cycle ${this.metrics.cycles} started`);

            try {
                if (this.useMCP) {
                    await this._discoverWithMCP();
                } else {
                    await this._discoverWithBrave();
                }

                // Success - reset error counter
                consecutiveErrors = 0;

                // Rest to avoid rate limits
                console.log(`[${this.workerId}] 💤 Resting for 5 minutes...`);
                await this._sleep(baseDelay);

            } catch (error) {
                consecutiveErrors++;
                this.metrics.errors++;

                console.error(`[${this.workerId}] ❌ Discovery error (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

                // Exponential backoff: 5min, 10min, 20min, 40min, 80min
                const backoffDelay = Math.min(baseDelay * Math.pow(2, consecutiveErrors - 1), baseDelay * 16);

                if (consecutiveErrors >= maxConsecutiveErrors) {
                    console.error(`[${this.workerId}] 🚨 Max consecutive errors reached. Stopping continuous discovery.`);
                    throw new Error(`Continuous discovery failed after ${maxConsecutiveErrors} attempts`);
                }

                console.log(`[${this.workerId}] ⏳ Backing off for ${Math.round(backoffDelay / 60000)} minutes...`);
                await this._sleep(backoffDelay);
            }
        }
    } else {
        // Single run - let errors propagate
        if (this.useMCP) {
            return await this._discoverWithMCP();
        } else {
            return await this._discoverWithBrave();
        }
    }
  }

  /**
   * Discover using Brave Search API
   * @private
   */
  async _discoverWithBrave() {
    const discoveries = [];

    for (const topic of this.topics) {
      console.log(`\n[${this.workerId}] 📚 Topic: "${topic}"`);

      for (const searchType of this.searchTypes) {
        try {
          let results;

          switch (searchType) {
            case 'web':
              results = await this.dendrite.searchWeb(topic, { maxResults: this.maxResultsPerTopic });
              break;
            case 'news':
              results = await this.dendrite.searchNews(topic, { maxResults: this.maxResultsPerTopic });
              break;
            case 'images':
              results = await this.dendrite.searchImages(topic, { maxResults: this.maxResultsPerTopic });
              break;
            case 'videos':
              results = await this.dendrite.searchVideos(topic, { maxResults: this.maxResultsPerTopic });
              break;
            default:
              continue;
          }

          if (results.success && results.count > 0) {
            discoveries.push({
              topic,
              searchType,
              results: results.results,
              count: results.count,
              timestamp: results.timestamp
            });

            this.metrics.totalDiscoveries += results.count;
            this.metrics.byType[searchType] += results.count;

            console.log(`   ✓ ${searchType}: ${results.count} results`);
          }

          // Rate limiting
          await this._sleep(1000);

        } catch (error) {
          console.error(`   ✗ ${searchType} failed: ${error.message}`);
          this.metrics.errors++;
        }
      }
    }

    console.log(`\n[${this.workerId}] 📊 Discovery complete:`);
    console.log(`   Total: ${this.metrics.totalDiscoveries}`);
    console.log(`   Web: ${this.metrics.byType.web}, News: ${this.metrics.byType.news}`);

    if (discoveries.length > 0) {
      await this._sendToImpulser(discoveries);
    }

    return { success: true, discoveries, metrics: this.metrics };
  }

  /**
   * Discover using MCP tools (ArXiv, Wikipedia, GitHub, Stack Overflow, News)
   * NO API KEY REQUIRED!
   * @private
   */
  async _discoverWithMCP() {
    console.log(`[${this.workerId}] 🔧 Using MCP tools - ArXiv, Wikipedia, GitHub, StackOverflow, News`);

    const topicConfigs = this.topics.map(topic => {
      // Auto-detect best sources for each topic
      const topicLower = topic.toLowerCase();
      let type = 'knowledge';
      let sources = ['wikipedia'];

      if (topicLower.includes('research') || topicLower.includes('paper') ||
          topicLower.includes('quantum') || topicLower.includes('neural')) {
        type = 'research';
        sources = ['arxiv', 'wikipedia'];
      } else if (topicLower.includes('code') || topicLower.includes('programming') ||
                 topicLower.includes('library') || topicLower.includes('framework')) {
        type = 'code_search';
        sources = ['github', 'stackoverflow'];
      } else if (topicLower.includes('news') || topicLower.includes('latest') ||
                 topicLower.includes('trend')) {
        type = 'news';
        sources = ['news'];
      }

      return { topic, type, sources };
    });

    // Run discovery
    const result = await this.mcpDendrite.discoverKnowledge(topicConfigs, {
      maxResultsPerTopic: this.maxResultsPerTopic
    });

    const status = this.mcpDendrite.getStatus();

    this.metrics.totalDiscoveries = status.state.totalProcessed;
    this.metrics.byType.mcp = status.state.totalProcessed;

    console.log(`\n[${this.workerId}] 📊 MCP Discovery complete:`);
    console.log(`   Topics: ${result.topics}`);
    console.log(`   Discoveries: ${status.state.totalProcessed}`);
    console.log(`   Success rate: ${status.metrics.successRate}%`);

    return {
      success: true,
      mode: 'MCP',
      topics: result.topics,
      discoveries: status.state.totalProcessed,
      metrics: this.metrics
    };
  }

  /**
   * Send discoveries to Impulser for processing
   * @private
   */
  async _sendToImpulser(discoveries) {
    try {
      console.log(`\n[${this.workerId}] 📤 Sending ${discoveries.length} discovery batches to Impulser...`);
      
      for (const discovery of discoveries) {
        // Format for Impulser processing
        const task = {
          type: 'categorize',  // UniversalImpulser will categorize and index
          data: {
            topic: discovery.topic,
            searchType: discovery.searchType,
            content: discovery.results.map(r => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet || r.source,
              metadata: {
                source: r.source,
                publishedAt: r.publishedAt,
                discoveredAt: discovery.timestamp
              }
            })),
            meta: {
              discoverySource: 'KnowledgeDiscoveryWorker',
              workerId: this.workerId,
              topic: discovery.topic,
              searchType: discovery.searchType
            }
          }
        };
        
        try {
          const targetArbiter = 'UniversalImpulser';
          await messageBroker.sendMessage({
            from: this.workerId,
            to: targetArbiter,
            type: discovery.searchType,  // categorize, index, etc.
            payload: task
          }).catch(async (e) => {
              // FALLBACK: Broadcast if direct targeting fails
              if (e.message.includes('not found')) {
                  await messageBroker.sendMessage({
                      from: this.workerId,
                      to: 'broadcast',
                      type: 'discovery_complete',
                      payload: task.data
                  });
              }
          });
          
          this.metrics.sentToImpulser++;
          console.log(`   ✓ Sent: ${discovery.topic} (${discovery.searchType})`);
          
        } catch (err) {
          console.error(`   ✗ Failed to send to Impulser: ${err.message}`);
        }
        
        // Rate limiting
        await this._sleep(500);
      }
      
      console.log(`[${this.workerId}] ✅ Sent ${this.metrics.sentToImpulser} batches to Impulser`);
      
    } catch (error) {
      console.error(`[${this.workerId}] ❌ Impulser integration failed: ${error.message}`);
    }
  }

  /**
   * Sleep helper
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      dendriteMetrics: this.dendrite.getMetrics()
    };
  }
}

module.exports = { KnowledgeDiscoveryWorker };
