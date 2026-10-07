// ═══════════════════════════════════════════════════════════
// FILE: WebScraperDendrite.cjs (ENHANCED v2.0 with Stealth Mode)
// Web scraping dendrite extending BaseDendrite
// NEW: Puppeteer stealth mode for Cloudflare bypass
// Routes tasks to MCP scraping tools (no rate limits)
// Targets: ArXiv, Wikipedia, GitHub, Stack Overflow, News, URL
// ═══════════════════════════════════════════════════════════

const { BaseDendrite } = require('./BaseDendrite.cjs');
const logger = require('../core/SecureLogger.cjs');
const { withRetry } = require('../core/RetryUtils.cjs');
const { withErrorHandling } = require('../core/ToolErrorHandler.cjs');

class WebScraperDendrite extends BaseDendrite {
  constructor(config = {}) {
    super({
      name: config.name || `web-scraper-${Date.now()}`,
      type: 'web-scraper',
      capabilities: ['arxiv', 'wikipedia', 'github', 'stackoverflow', 'news', 'url'],
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

    // ═══════════════════════════════════════════════════════════
    // NEW: STEALTH MODE CONFIGURATION
    // ═══════════════════════════════════════════════════════════
    this.stealthMode = config.stealthMode !== false; // Default: enabled
    this.puppeteerBrowser = null;
    this.browserLaunching = false;

    // User agent rotation pool
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    ];

    // Stealth settings
    this.stealthConfig = {
      minDelay: config.minDelay || 1000,      // Min delay between actions (ms)
      maxDelay: config.maxDelay || 3000,      // Max delay between actions (ms)
      scrollSteps: config.scrollSteps || 5,   // Number of scroll steps
      scrollDelay: config.scrollDelay || 200, // Delay between scrolls (ms)
      enableScreenshots: config.enableScreenshots || false
    };

    logger.info(`[${this.name}] 🕷️ WebScraperDendrite v2.0 ready (Stealth: ${this.stealthMode ? 'ON' : 'OFF'})`);
    logger.info(`[${this.name}] Enabled targets: ${Object.keys(this.targets).filter(t => this.targets[t].enabled).join(', ')}`);
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

        logger.info(`[${this.name}] 📬 Listening for search requests`);
      } catch (err) {
        logger.warn(`[${this.name}] Message broker registration failed: ${err.message}`);
      }
    }

    // Initialize Puppeteer if stealth mode is enabled
    if (this.stealthMode) {
      try {
        await this._initPuppeteer();
      } catch (err) {
        logger.warn(`[${this.name}] Puppeteer init failed (falling back to MCP): ${err.message}`);
        this.stealthMode = false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEALTH MODE - PUPPETEER INITIALIZATION
  // ═══════════════════════════════════════════════════════════

  async _initPuppeteer() {
    if (this.puppeteerBrowser || this.browserLaunching) {
      return;
    }

    this.browserLaunching = true;

    try {
      // Try puppeteer-extra with stealth plugin first
      let puppeteer;
      try {
        puppeteer = require('puppeteer-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        puppeteer.use(StealthPlugin());
        logger.info(`[${this.name}] 🥷 Puppeteer-extra with stealth plugin loaded`);
      } catch (err) {
        // Fallback to regular puppeteer
        puppeteer = require('puppeteer');
        logger.info(`[${this.name}] 🤖 Regular Puppeteer loaded (no stealth plugin)`);
      }

      this.puppeteerBrowser = await puppeteer.launch({
        headless: 'new', // Use new headless mode
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });

      logger.info(`[${this.name}] ✅ Puppeteer browser launched`);
    } catch (err) {
      logger.error(`[${this.name}] Failed to launch Puppeteer: ${err.message}`);
      throw err;
    } finally {
      this.browserLaunching = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEALTH MODE - HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Random delay between min and max ms
   */
  async _randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Get random user agent
   */
  _getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  /**
   * Human-like scrolling behavior
   */
  async _humanScroll(page) {
    const scrollSteps = this.stealthConfig.scrollSteps;
    const scrollDelay = this.stealthConfig.scrollDelay;

    for (let i = 0; i < scrollSteps; i++) {
      await page.evaluate((step, total) => {
        const scrollHeight = document.documentElement.scrollHeight;
        const position = (scrollHeight / total) * step;
        window.scrollTo(0, position);
      }, i, scrollSteps);

      await this._randomDelay(scrollDelay, scrollDelay * 2);
    }

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  /**
   * Detect Cloudflare challenge page
   */
  _isCloudflareChallenge(content) {
    const indicators = [
      'Checking your browser',
      'Just a moment',
      'cf-browser-verification',
      'cf_captcha_kind',
      'cloudflare',
      'cf-challenge-form'
    ];

    return indicators.some(indicator =>
      content.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  // ═══════════════════════════════════════════════════════════
  // STEALTH MODE - CORE SCRAPING
  // ═══════════════════════════════════════════════════════════

  /**
   * Scrape URL with stealth mode (Puppeteer)
   * Bypasses Cloudflare and bot detection
   */
  async scrapeWithStealth(url, options = {}) {
    if (!this.puppeteerBrowser) {
      await this._initPuppeteer();
    }

    const {
      waitForSelector = null,
      extractors = null,
      timeout = 30000,
      screenshot = this.stealthConfig.enableScreenshots
    } = options;

    logger.info(`[${this.name}] 🥷 Stealth scraping: ${url}`);

    const page = await this.puppeteerBrowser.newPage();

    try {
      // Set random user agent
      const userAgent = this._getRandomUserAgent();
      await page.setUserAgent(userAgent);

      // Set viewport to common resolution
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1
      });

      // Set extra headers to look more human
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      });

      // Random delay before navigation
      await this._randomDelay(
        this.stealthConfig.minDelay,
        this.stealthConfig.maxDelay
      );

      // Navigate to URL
      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout
      });

      // Check for Cloudflare challenge
      const content = await page.content();
      if (this._isCloudflareChallenge(content)) {
        logger.warn(`[${this.name}] 🛡️ Cloudflare challenge detected, waiting...`);
        await this._randomDelay(5000, 8000); // Wait for challenge to resolve

        // Check again
        const newContent = await page.content();
        if (this._isCloudflareChallenge(newContent)) {
          throw new Error('Cloudflare challenge not resolved');
        }
      }

      // Wait for specific selector if provided
      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout });
      }

      // Human-like scrolling
      await this._humanScroll(page);

      // Take screenshot if enabled
      let screenshotPath = null;
      if (screenshot) {
        screenshotPath = `./screenshots/${Date.now()}-${url.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.info(`[${this.name}] 📸 Screenshot saved: ${screenshotPath}`);
      }

      // Extract data
      let extractedData = {};
      if (extractors && typeof extractors === 'object') {
        for (const [key, selector] of Object.entries(extractors)) {
          try {
            extractedData[key] = await page.$$eval(selector, elements =>
              elements.map(el => el.textContent.trim())
            );
          } catch (err) {
            logger.warn(`[${this.name}] Failed to extract ${key}: ${err.message}`);
            extractedData[key] = null;
          }
        }
      }

      // Get final HTML
      const html = await page.content();

      // Get page title
      const title = await page.title();

      return {
        success: true,
        url,
        title,
        html,
        extractedData,
        screenshot: screenshotPath,
        status: response.status(),
        userAgent,
        timestamp: Date.now()
      };

    } catch (err) {
      logger.error(`[${this.name}] Stealth scraping failed for ${url}: ${err.message}`);
      throw err;
    } finally {
      await page.close();
    }
  }

  /**
   * Scrape URL with fallback: try stealth first, then MCP
   */
  async scrapeURL(url, options = {}) {
    const safeUrlScrape = withErrorHandling(
      withRetry(
        async () => {
          // Try stealth mode first if enabled
          if (this.stealthMode) {
            try {
              return await this.scrapeWithStealth(url, options);
            } catch (stealthErr) {
              logger.warn(`[${this.name}] Stealth mode failed, falling back to MCP: ${stealthErr.message}`);

              // Fall back to MCP if stealth fails
              if (this.mcpTools) {
                const result = await this.mcpTools.invokeTool('browse_url', { url });
                if (result.success) {
                  return result.result;
                }
              }

              // If both fail, throw original error
              throw stealthErr;
            }
          } else {
            // Use MCP directly if stealth disabled
            if (this.mcpTools) {
              const result = await this.mcpTools.invokeTool('browse_url', { url });
              if (result.success) {
                return result.result;
              }
              throw new Error(result.error);
            }
            throw new Error('No scraping method available');
          }
        },
        {
          maxRetries: 3,
          baseDelay: 2000,
          onRetryAttempt: (attempt, maxRetries, delay, error) => {
            logger.warn(`[${this.name}] Retry ${attempt}/${maxRetries} for ${url} after ${delay}ms`);
          }
        }
      ),
      {
        toolName: 'url_scraper',
        context: `Scrape ${url}`
      }
    );

    return await safeUrlScrape();
  }

  // ═══════════════════════════════════════════════════════════
  // EXISTING METHODS (Enhanced with new utilities)
  // ═══════════════════════════════════════════════════════════

  async _handleSearchRequest(message) {
    const { query, target, context } = message.payload;
    const searchTarget = target || 'google';

    logger.info(`[${this.name}] 📨 Received search request: "${query}" (${searchTarget}) from ${message.from}`);

    try {
      let results;

      if (searchTarget === 'stackoverflow' || searchTarget === 'github' || searchTarget === 'arxiv') {
        const taskResult = await this.processTask({
          target: searchTarget,
          query,
          maxResults: 5
        });
        results = taskResult.results;
      } else {
        if (this.mcpTools && await this.mcpTools.hasTool('brave_search')) {
          const mcpRes = await this.mcpTools.invokeTool('brave_search', { query, count: 5 });
          results = mcpRes.result;
        } else {
          const taskResult = await this.processTask({
            target: 'stackoverflow',
            query,
            maxResults: 5
          });
          results = taskResult.results;
        }
      }

      await this.messageBroker.sendMessage({
        from: this.name,
        to: message.from,
        type: 'search_results',
        payload: { query, results: results || [], context }
      });

    } catch (err) {
      logger.error(`[${this.name}] Search request failed: ${err.message}`);
      await this.messageBroker.sendMessage({
        from: this.name,
        to: message.from,
        type: 'search_failed',
        payload: { error: err.message, query }
      });
    }
  }

  setMCPTools(mcpTools) {
    this.mcpTools = mcpTools;
    logger.info(`[${this.name}] MCP Tools connected`);
  }

  async processTask(task, ctx = {}) {
    const { target, query, maxResults, source, url, extractors } = task;

    // Handle URL scraping with stealth mode
    if (target === 'url' && url) {
      const result = await this.scrapeURL(url, { extractors });

      this._storeResult({
        target: 'url',
        query: url,
        data: result,
        timestamp: Date.now(),
        taskId: ctx.taskId
      });

      return {
        success: true,
        target: 'url',
        query: url,
        results: result,
        count: 1
      };
    }

    // Handle MCP tool-based scraping
    if (!this.mcpTools) {
      throw new Error('MCP Tools not configured');
    }

    if (!target || !query) {
      throw new Error('Task must have target and query');
    }

    if (!this.targets[target] || !this.targets[target].enabled) {
      throw new Error(`Target not enabled: ${target}`);
    }

    logger.info(`[${this.name}] Scraping ${target}: "${query}"`);

    let toolName;
    let params = { query };

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
      default:
        throw new Error(`Unknown target: ${target}`);
    }

    const result = await this.mcpTools.invokeTool(toolName, params);

    if (result.success) {
      this._storeResult({
        target,
        query,
        data: result.result,
        timestamp: Date.now(),
        taskId: ctx.taskId
      });

      logger.info(`[${this.name}] ✅ Scraped ${target}: ${result.result.count || 0} results`);

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

  _storeResult(result) {
    this.scrapedData.push(result);
    if (this.scrapedData.length > this.maxStoredResults) {
      this.scrapedData = this.scrapedData.slice(-this.maxStoredResults);
    }
  }

  getScrapedData() {
    return {
      count: this.scrapedData.length,
      data: this.scrapedData
    };
  }

  getScrapedDataByTarget(target) {
    return this.scrapedData.filter(item => item.target === target);
  }

  clearScrapedData() {
    const count = this.scrapedData.length;
    this.scrapedData = [];
    logger.info(`[${this.name}] Cleared ${count} scraped results`);
    return { cleared: count };
  }

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

      logger.info(`[${this.name}] 📥 Aggregated ${result.count || 0} results from ${from}`);
    }
  }

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
          news: this.getScrapedDataByTarget('news').length,
          url: this.getScrapedDataByTarget('url').length
        },
        targets: this.targets,
        mcpConnected: this.mcpTools !== null,
        stealthMode: this.stealthMode,
        puppeteerReady: this.puppeteerBrowser !== null
      }
    };
  }

  /**
   * Cleanup Puppeteer browser on shutdown
   */
  async shutdown() {
    if (this.puppeteerBrowser) {
      logger.info(`[${this.name}] Closing Puppeteer browser...`);
      await this.puppeteerBrowser.close();
      this.puppeteerBrowser = null;
    }
    await super.shutdown();
  }
}

module.exports = { WebScraperDendrite };
