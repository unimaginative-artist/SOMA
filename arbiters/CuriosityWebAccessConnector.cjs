/**
 * CuriosityWebAccessConnector.cjs
 *
 * THE MISSING LINK: Connects SOMA's Curiosity Systems to Web Access Tools
 *
 * Wires Together:
 * - CuriosityEngine (generates questions)
 * - SelfDrivenCuriosityConnector (self-analysis)
 * - ConversationCuriosityExtractor (user interests)
 * ↓
 * WITH:
 * ↓
 * - BraveSearchAdapter (quick answers)
 * - WebScraperDendrite (deep content)
 * - EdgeWorkerArbiter (autonomous exploration)
 *
 * SOMA can now satisfy her own curiosity autonomously! 🧠✨
 */

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const { BraveSearchAdapter } = require('../cognitive/BraveSearchAdapter.cjs');
const { WebScraperDendrite } = require('../cognitive/WebScraperDendrite.cjs');
const logger = require('../core/SecureLogger.cjs');

class CuriosityWebAccessConnector extends BaseArbiter {
  constructor(broker, config = {}) {
    super(broker, {
      name: 'CuriosityWebAccessConnector',
      role: 'curiosity-web-bridge',
      ...config
    });

    // Web access systems (enhanced with Phase 1 utilities)
    this.braveSearch = new BraveSearchAdapter({
      maxResults: config.maxSearchResults || 10,
      timeout: 15000
    });

    this.webScraper = new WebScraperDendrite({
      name: 'curiosity-scraper',
      stealthMode: config.stealthMode !== false,
      maxConcurrent: 3,
      mcpTools: config.mcpTools || broker.mcpTools,
      messageBroker: broker
    });

    // References to SOMA's learning systems (injected)
    this.curiosityEngine = config.curiosityEngine || null;
    this.selfDrivenConnector = config.selfDrivenConnector || null;
    this.conversationExtractor = config.conversationExtractor || null;
    this.mnemonic = config.mnemonic || null;
    this.knowledgeGraph = config.knowledgeGraph || null;
    this.selfModel = config.selfModel || null;

    // Curiosity level thresholds
    this.thresholds = {
      casual: 0.3,      // Quick search
      interested: 0.6,  // Deep scrape
      fascinated: 0.8   // Auto-explore
    };

    // Stats
    this.stats = {
      totalCuriositiesHandled: 0,
      quickSearches: 0,
      deepScrapes: 0,
      autoExplorations: 0,
      knowledgeStored: 0,
      capabilitiesImproved: 0
    };

    this.setupSubscriptions();
  }

  setupSubscriptions() {
    // Listen for curiosity events from CuriosityEngine
    this.subscribe('curiosity:exploring', this.handleCuriosity.bind(this));

    // Listen for learning requests from SelfDrivenCuriosityConnector
    this.subscribe('self_driven:gap_detected', this.handleSelfGap.bind(this));

    // Listen for conversation insights
    this.subscribe('conversation:interest_detected', this.handleUserInterest.bind(this));
  }

  async initialize() {
    await super.initialize();

    // Initialize web scraper
    await this.webScraper.initialize();

    logger.info(`[${this.name}] 🌐 Curiosity Web Access Bridge initialized`);
    logger.info(`[${this.name}]    BraveSearch: ✅ Ready`);
    logger.info(`[${this.name}]    WebScraper: ✅ Ready (Stealth: ${this.webScraper.stealthMode})`);
    logger.info(`[${this.name}]    Listening for SOMA's curiosity...`);
  }

  /**
   * Main handler: SOMA is curious about something!
   */
  async handleCuriosity(event) {
    this.stats.totalCuriositiesHandled++;

    const { question, type, priority } = event;

    logger.info(`[${this.name}] 💭 SOMA is curious: "${question}"`);

    // Detect curiosity level
    const level = this.detectCuriosityLevel(question, priority);

    let knowledge = null;

    try {
      switch (level) {
        case 'casual':
          knowledge = await this.handleCasualCuriosity(question);
          break;

        case 'interested':
          knowledge = await this.handleDeepInterest(question);
          break;

        case 'fascinated':
          knowledge = await this.handleFascination(question);
          break;
      }

      // Store knowledge in SOMA's memory
      if (knowledge && this.mnemonic) {
        await this.storeKnowledge(question, knowledge, level);
      }

      // Update self-model if relevant
      if (knowledge && this.selfModel) {
        await this.updateSelfKnowledge(question, knowledge);
      }

      logger.info(`[${this.name}] ✅ Curiosity satisfied: "${question}"`);

    } catch (err) {
      logger.error(`[${this.name}] Failed to satisfy curiosity: ${err.message}`);
    }
  }

  /**
   * Level 1: Casual curiosity - quick answer
   */
  async handleCasualCuriosity(question) {
    this.stats.quickSearches++;

    logger.info(`[${this.name}] 🔍 Quick search: "${question}"`);

    // Try web scraping first (free) - construct likely URLs
    const tryUrls = this.constructLikelyUrls(question);

    for (const url of tryUrls) {
      try {
        const scrapedData = await this.webScraper.scrapeURL(url, {
          extractors: { mainContent: 'article, main, .content' },
          timeout: 20000
        });

        if (scrapedData.success) {
          logger.info(`[${this.name}]    ✅ Found answer via scraping (free): ${url}`);
          return {
            type: 'quick_scrape',
            query: question,
            url: url,
            content: scrapedData.extractedData,
            timestamp: Date.now()
          };
        }
      } catch (err) {
        // Continue to next URL
      }
    }

    // FALLBACK: Use BraveSearch only if scraping fails
    logger.warn(`[${this.name}]    ⚠️ Scraping failed, using Brave API (last resort)`);
    const results = await this.braveSearch.searchWeb(question);

    if (results.success) {
      logger.info(`[${this.name}]    Found ${results.count} results in ${results.elapsed}ms`);

      return {
        type: 'quick_search',
        query: question,
        results: results.results,
        count: results.count,
        timestamp: Date.now()
      };
    }

    return null;
  }

  /**
   * Level 2: Deep interest - detailed content
   */
  async handleDeepInterest(question) {
    this.stats.deepScrapes++;

    logger.info(`[${this.name}] 🕷️ Deep interest: "${question}"`);

    // Try likely URLs first (free scraping)
    const tryUrls = this.constructLikelyUrls(question);

    for (const url of tryUrls) {
      try {
        const scrapedData = await this.webScraper.scrapeURL(url, {
          extractors: {
            mainContent: 'article, main, .content, .post-content',
            headings: 'h1, h2, h3',
            lists: 'ul li, ol li',
            codeBlocks: 'pre code'
          },
          timeout: 30000
        });

        if (scrapedData.success) {
          logger.info(`[${this.name}]    ✅ Deep scraped ${url} (free)`);
          return {
            type: 'deep_scrape',
            query: question,
            url: url,
            title: scrapedData.title,
            extractedData: scrapedData.extractedData,
            html: scrapedData.html,
            timestamp: Date.now()
          };
        }
      } catch (err) {
        // Continue to next URL
      }
    }

    // FALLBACK: Use Brave Search only if direct scraping fails
    logger.warn(`[${this.name}]    ⚠️ Direct scraping failed, using Brave API (last resort)`);
    const searchResults = await this.braveSearch.searchWeb(question);

    if (!searchResults.success || searchResults.count === 0) {
      logger.warn(`[${this.name}]    No search results found`);
      return null;
    }

    // Take top result and scrape it deeply
    const topUrl = searchResults.results[0].url;
    logger.info(`[${this.name}]    Deep scraping: ${topUrl}`);

    const scrapedData = await this.webScraper.scrapeURL(topUrl, {
      extractors: {
        mainContent: 'article, main, .content, .post-content',
        headings: 'h1, h2, h3',
        lists: 'ul li, ol li',
        codeBlocks: 'pre code'
      },
      timeout: 30000
    });

    if (scrapedData.success) {
      logger.info(`[${this.name}]    ✅ Scraped ${topUrl} successfully`);

      return {
        type: 'deep_scrape',
        query: question,
        url: topUrl,
        title: scrapedData.title,
        extractedData: scrapedData.extractedData,
        html: scrapedData.html,
        timestamp: Date.now()
      };
    }

    return null;
  }

  /**
   * Level 3: Fascination - comprehensive exploration
   */
  async handleFascination(question) {
    this.stats.autoExplorations++;

    logger.info(`[${this.name}] 🌐 FASCINATED! Exploring everything about: "${question}"`);

    // Try likely URLs first (free)
    const tryUrls = this.constructLikelyUrls(question);
    let startUrl = null;

    for (const url of tryUrls) {
      try {
        const scrapedData = await this.webScraper.scrapeURL(url, { timeout: 20000 });
        if (scrapedData.success) {
          startUrl = url;
          logger.info(`[${this.name}]    ✅ Found starting point (free): ${url}`);
          break;
        }
      } catch (err) {
        // Continue to next URL
      }
    }

    // FALLBACK: Use Brave Search only if no valid starting point found
    if (!startUrl) {
      logger.warn(`[${this.name}]    ⚠️ No direct URL worked, using Brave API (last resort)`);
      const searchResults = await this.braveSearch.searchWeb(question);

      if (!searchResults.success || searchResults.count === 0) {
        logger.warn(`[${this.name}]    No starting point found`);
        return null;
      }

      startUrl = searchResults.results[0].url;
    }

    // Dispatch to EdgeWorkerArbiter for autonomous exploration
    // (EdgeWorkerArbiter will use WebScraperDendrite when integrated)
    await this.publish('edge_worker:explore_request', {
      startUrl: startUrl,
      query: question,
      depth: 3,
      maxPages: 20,
      source: 'curiosity_fascination'
    });

    logger.info(`[${this.name}]    🚀 Autonomous exploration started`);

    return {
      type: 'autonomous_exploration',
      query: question,
      startUrl: startUrl,
      status: 'in_progress',
      timestamp: Date.now()
    };
  }

  /**
   * Handle self-detected gaps (from SelfDrivenCuriosityConnector)
   */
  async handleSelfGap(event) {
    const { gap, gapType, severity } = event;

    logger.info(`[${this.name}] 🔍 SOMA detected gap in herself: ${gap} (${gapType})`);

    // Generate search query from gap
    const query = this.generateQueryFromGap(gap, gapType);

    // Research the gap (always deep interest for self-improvement)
    const knowledge = await this.handleDeepInterest(query);

    if (knowledge) {
      this.stats.capabilitiesImproved++;

      // Update self-model
      if (this.selfModel) {
        await this.selfModel.updateCapability(gap, 0.5); // Boost capability
        logger.info(`[${this.name}]    ✅ Improved capability: ${gap}`);
      }
    }
  }

  /**
   * Handle user interest patterns (from ConversationCuriosityExtractor)
   */
  async handleUserInterest(event) {
    const { topic, userInterest, somaConfidence } = event;

    // Only learn if users are interested but SOMA is weak
    if (userInterest > 0.7 && somaConfidence < 0.5) {
      logger.info(`[${this.name}] 📚 Users love "${topic}" but SOMA is weak. Learning NOW!`);

      // Deep dive on user's favorite topic
      const knowledge = await this.handleDeepInterest(topic);

      if (knowledge && this.selfModel) {
        await this.selfModel.updateCapability(topic, 0.8);
        logger.info(`[${this.name}]    ✅ Now expert on: ${topic}`);
      }
    }
  }

  /**
   * Detect curiosity level from question + priority
   */
  detectCuriosityLevel(question, priority = 0.5) {
    // Check question patterns
    const casualPatterns = [
      /^what is/i,
      /^who is/i,
      /^where is/i,
      /^when did/i,
      /^define/i
    ];

    const interestedPatterns = [
      /^how does/i,
      /^why does/i,
      /^explain/i,
      /^what causes/i,
      /^describe/i
    ];

    const fascinatedPatterns = [
      /everything about/i,
      /all.*about/i,
      /comprehensive/i,
      /explore/i,
      /research.*thoroughly/i
    ];

    // Check patterns
    if (fascinatedPatterns.some(p => p.test(question))) {
      return 'fascinated';
    }
    if (interestedPatterns.some(p => p.test(question))) {
      return 'interested';
    }
    if (casualPatterns.some(p => p.test(question))) {
      return 'casual';
    }

    // Fall back to priority
    if (priority >= this.thresholds.fascinated) return 'fascinated';
    if (priority >= this.thresholds.interested) return 'interested';
    return 'casual';
  }

  /**
   * Store knowledge in SOMA's memory systems
   */
  async storeKnowledge(question, knowledge, level) {
    this.stats.knowledgeStored++;

    // Extract text content from knowledge object
    let knowledgeText = '';
    if (typeof knowledge === 'string') {
      knowledgeText = knowledge;
    } else if (knowledge && typeof knowledge === 'object') {
      // Try to find the most relevant text field
      knowledgeText = knowledge.content || 
                      knowledge.extractedData || 
                      (knowledge.results ? JSON.stringify(knowledge.results) : '') ||
                      JSON.stringify(knowledge);
    }

    // Ensure it's a string
    if (typeof knowledgeText !== 'string') {
      knowledgeText = JSON.stringify(knowledgeText);
    }

    // Store in MnemonicArbiter (Johnny Mnemonic)
    if (this.mnemonic) {
      try {
        // Check if mnemonic has remember method
        if (typeof this.mnemonic.remember === 'function') {
          await this.mnemonic.remember(
            `[Curiosity ${level}] ${question}\n\nLearned: ${knowledgeText.substring(0, 500)}...`,
            {
              type: 'curiosity_satisfied',
              question,
              level,
              source: 'autonomous_learning',
              timestamp: Date.now()
            }
          );
        } else {
           logger.warn(`[${this.name}] MnemonicArbiter missing 'remember' method`);
        }
      } catch (e) {
        logger.warn(`[${this.name}] Failed to store in mnemonic: ${e.message}`);
      }
    }

    // Store in KnowledgeGraph
    if (this.knowledgeGraph) {
      try {
        if (typeof this.knowledgeGraph.addKnowledge === 'function') {
          await this.knowledgeGraph.addKnowledge({
            topic: question,
            content: knowledge, // Pass full object to KG if possible, or knowledgeText
            source: 'curiosity_engine',
            timestamp: Date.now()
          });
        } else {
           logger.warn(`[${this.name}] KnowledgeGraph missing 'addKnowledge' method`);
        }
      } catch (e) {
        logger.warn(`[${this.name}] Failed to store in KnowledgeGraph: ${e.message}`);
      }
    }

    logger.info(`[${this.name}]    💾 Knowledge stored in memory`);
  }

  /**
   * Update SOMA's self-knowledge based on learning
   */
  async updateSelfKnowledge(question, knowledge) {
    // Extract topic from question
    const topic = this.extractTopic(question);

    if (topic && this.selfModel) {
      // Boost confidence in this topic
      const currentLevel = this.selfModel.capabilities.get(topic) || 0.3;
      const newLevel = Math.min(1.0, currentLevel + 0.2);

      await this.selfModel.updateCapability(topic, newLevel);

      logger.info(`[${this.name}]    🧠 Updated self-knowledge: ${topic} (${(newLevel * 100).toFixed(0)}%)`);
    }
  }

  /**
   * Generate search query from self-detected gap
   */
  generateQueryFromGap(gap, gapType) {
    switch (gapType) {
      case 'capability_gap':
        return `how to improve at ${gap}`;
      case 'limitation':
        return `how to overcome ${gap}`;
      case 'fragment_expertise_gap':
        return `${gap} tutorial comprehensive guide`;
      default:
        return gap;
    }
  }

  /**
   * Extract main topic from question
   */
  extractTopic(question) {
    // Simple extraction: remove question words
    return question
      .replace(/^(what|who|where|when|why|how|explain|describe)\s+/i, '')
      .replace(/\?$/, '')
      .trim()
      .split(' ')
      .slice(0, 3) // First 3 words
      .join('_')
      .toLowerCase();
  }

  /**
   * Construct likely URLs to try before using Brave Search API
   * This saves API calls by intelligently guessing common documentation/wiki sites
   */
  constructLikelyUrls(question) {
    const urls = [];
    const query = question.toLowerCase();

    // Extract key terms (remove question words)
    const terms = query
      .replace(/^(what|who|where|when|why|how|can|explain|describe|tell me about|show me)\s+/i, '')
      .replace(/\?$/, '')
      .trim();

    // Programming/tech queries → Try documentation sites
    if (query.includes('javascript') || query.includes('js') || query.includes('node')) {
      urls.push(`https://developer.mozilla.org/en-US/docs/Web/JavaScript`);
      urls.push(`https://nodejs.org/docs/latest/api/`);
    }
    if (query.includes('python')) {
      urls.push(`https://docs.python.org/3/`);
      urls.push(`https://www.python.org/`);
    }
    if (query.includes('react')) {
      urls.push(`https://react.dev/`);
    }

    // General knowledge → Try Wikipedia
    if (!query.includes('how to') && !query.includes('tutorial')) {
      const wikiTerm = terms.split(' ').slice(0, 3).join('_');
      urls.push(`https://en.wikipedia.org/wiki/${wikiTerm}`);
    }

    // Business/professional → Try reputable sources
    if (query.includes('business') || query.includes('marketing') || query.includes('management')) {
      urls.push(`https://hbr.org/`);
      urls.push(`https://www.inc.com/`);
    }

    // Limit to 3 tries to avoid excessive scraping
    return urls.slice(0, 3);
  }

  /**
   * Get connector stats
   */
  getStats() {
    return {
      ...this.stats,
      braveSearch: this.braveSearch.getMetrics(),
      webScraper: this.webScraper.getStatus()
    };
  }

  /**
   * Cleanup
   */
  async shutdown() {
    await this.webScraper.shutdown();
    await super.shutdown();
  }
}

module.exports = { CuriosityWebAccessConnector };
