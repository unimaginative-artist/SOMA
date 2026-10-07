// ═══════════════════════════════════════════════════════════
// FILE: workers/WebCrawlerWorker.cjs
// Real web crawler for EdgeWorkers - Gathers knowledge from the internet
// Targets: Stack Overflow, GitHub, Documentation sites, Technical blogs
// ═══════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const crypto = require('crypto');

class WebCrawlerWorker {
  constructor(config = {}) {
    this.workerId = config.workerId || `crawler_${Date.now()}`;
    this.maxPages = config.maxPages || 10;
    this.maxDepth = config.maxDepth || 2;
    this.timeout = config.timeout || 10000;
    this.visitedUrls = new Set();
    this.crawledData = [];

    // Rate limiting
    this.requestDelay = config.requestDelay || 1000; // 1 second between requests
    this.lastRequestTime = 0;

    // Crawl targets configuration
    this.targets = config.targets || this.getDefaultTargets();
  }

  getDefaultTargets() {
    return {
      stackoverflow: {
        baseUrl: 'https://stackoverflow.com',
        searchQueries: [
          'javascript async await',
          'python type hints',
          'react hooks',
          'kubernetes deployment',
          'docker best practices',
          'nodejs performance',
          'database indexing',
          'microservices architecture'
        ],
        enabled: true,
        priority: 'high'
      },
      github: {
        baseUrl: 'https://github.com',
        topics: [
          'awesome-lists',
          'javascript',
          'python',
          'machine-learning',
          'devops'
        ],
        enabled: true,
        priority: 'medium'
      },
      mdn: {
        baseUrl: 'https://developer.mozilla.org',
        paths: [
          '/en-US/docs/Web/JavaScript',
          '/en-US/docs/Web/API'
        ],
        enabled: true,
        priority: 'high'
      },
      devto: {
        baseUrl: 'https://dev.to',
        tags: [
          'javascript',
          'python',
          'webdev',
          'programming',
          'tutorial'
        ],
        enabled: true,
        priority: 'medium'
      }
    };
  }

  async crawl(taskData) {
    const { target, query, maxPages } = taskData;

    console.log(`[${this.workerId}] Starting crawl: ${target} - ${query || 'default'}`);

    this.crawledData = [];
    this.visitedUrls.clear();

    try {
      if (target === 'stackoverflow') {
        await this.crawlStackOverflow(query, maxPages || this.maxPages);
      } else if (target === 'github') {
        await this.crawlGitHub(query, maxPages || this.maxPages);
      } else if (target === 'mdn') {
        await this.crawlMDN(query, maxPages || this.maxPages);
      } else if (target === 'devto') {
        await this.crawlDevTo(query, maxPages || this.maxPages);
      } else if (target === 'documentation') {
        await this.crawlDocumentation(query, maxPages || this.maxPages);
      } else if (target === 'portal') {
        await this.crawlPortalQuery(query, maxPages || this.maxPages);
      } else if (target === 'general') {
        await this.crawlGeneral(query, maxPages || this.maxPages);
      }

      console.log(`[${this.workerId}] Crawl complete: ${this.crawledData.length} items`);

      return {
        success: true,
        workerId: this.workerId,
        target,
        query,
        itemsCollected: this.crawledData.length,
        data: this.crawledData
      };

    } catch (err) {
      console.error(`[${this.workerId}] Crawl error:`, err.message);
      return {
        success: false,
        workerId: this.workerId,
        error: err.message,
        itemsCollected: this.crawledData.length,
        data: this.crawledData // Return partial data
      };
    }
  }

  async crawlGeneral(query, maxPages) {
    // Intelligent routing for general queries
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('code') || lowerQuery.includes('function') || lowerQuery.includes('error')) {
        console.log(`[${this.workerId}] Routing 'general' query to StackOverflow: ${query}`);
        await this.crawlStackOverflow(query, maxPages);
    } else if (lowerQuery.includes('library') || lowerQuery.includes('module') || lowerQuery.includes('repo')) {
        console.log(`[${this.workerId}] Routing 'general' query to GitHub: ${query}`);
        await this.crawlGitHub(query, maxPages);
    } else if (lowerQuery.includes('doc') || lowerQuery.includes('api')) {
        console.log(`[${this.workerId}] Routing 'general' query to Documentation: ${query}`);
        await this.crawlDocumentation(query, maxPages);
    } else {
        // Default fallback for technical queries
        console.log(`[${this.workerId}] Defaulting 'general' query to StackOverflow: ${query}`);
        await this.crawlStackOverflow(query, maxPages);
    }
  }

  async crawlStackOverflow(query, maxPages) {
    // Search Stack Overflow for questions/answers
    const searchUrl = `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`;

    try {
      const html = await this.fetchWithDelay(searchUrl);
      const $ = cheerio.load(html);

      // Extract question links
      const questionLinks = [];
      $('.s-post-summary--content h3 a').each((i, el) => {
        if (questionLinks.length >= maxPages) return false;
        const href = $(el).attr('href');
        if (href) {
          questionLinks.push(`https://stackoverflow.com${href}`);
        }
      });

      // Crawl each question page
      for (const link of questionLinks.slice(0, maxPages)) {
        await this.crawlStackOverflowQuestion(link);
      }

    } catch (err) {
      console.error(`[${this.workerId}] Stack Overflow crawl error:`, err.message);
    }
  }

  async crawlStackOverflowQuestion(url) {
    if (this.visitedUrls.has(url)) return;
    this.visitedUrls.add(url);

    try {
      const html = await this.fetchWithDelay(url);
      const $ = cheerio.load(html);

      // Extract question
      const questionTitle = $('.question-header h1').text().trim();
      const questionBody = $('.s-prose.js-post-body').first().text().trim();

      // Extract answers
      const answers = [];
      $('.answer .s-prose.js-post-body').each((i, el) => {
        answers.push($(el).text().trim());
      });

      // Extract tags
      const tags = [];
      $('.post-tag').each((i, el) => {
        tags.push($(el).text().trim());
      });

      if (questionTitle && questionBody) {
        this.crawledData.push({
          id: this.generateId(url),
          source: 'stackoverflow',
          type: 'qa',
          url,
          title: questionTitle,
          question: questionBody.substring(0, 2000),
          answers: answers.slice(0, 3).map(a => a.substring(0, 1000)),
          tags,
          crawledAt: new Date().toISOString()
        });
      }

    } catch (err) {
      console.error(`[${this.workerId}] Error crawling SO question:`, err.message);
    }
  }

  async crawlGitHub(topic, maxPages) {
    // Crawl GitHub awesome lists and READMEs
    const searchUrl = `https://github.com/search?q=awesome+${encodeURIComponent(topic)}`;

    try {
      const html = await this.fetchWithDelay(searchUrl);
      const $ = cheerio.load(html);

      // Extract repo links (simplified - GitHub's actual structure may vary)
      const repoLinks = [];
      $('a[href*="/"]').each((i, el) => {
        if (repoLinks.length >= maxPages) return false;
        const href = $(el).attr('href');
        if (href && href.includes('awesome')) {
          repoLinks.push(`https://github.com${href}`);
        }
      });

      // Note: Full GitHub crawling would need API or more sophisticated scraping
      // This is a simplified version

      this.crawledData.push({
        id: this.generateId(searchUrl),
        source: 'github',
        type: 'search_results',
        topic,
        results: repoLinks,
        crawledAt: new Date().toISOString()
      });

    } catch (err) {
      console.error(`[${this.workerId}] GitHub crawl error:`, err.message);
    }
  }

  async crawlMDN(path, maxPages) {
    const baseUrl = 'https://developer.mozilla.org';
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

    if (this.visitedUrls.has(url)) return;
    this.visitedUrls.add(url);

    try {
      const html = await this.fetchWithDelay(url);
      const $ = cheerio.load(html);

      // Extract main content
      const title = $('h1').first().text().trim();
      const content = $('.main-page-content').text().trim();

      // Extract code examples
      const codeExamples = [];
      $('pre code').each((i, el) => {
        codeExamples.push($(el).text().trim());
      });

      if (title && content) {
        this.crawledData.push({
          id: this.generateId(url),
          source: 'mdn',
          type: 'documentation',
          url,
          title,
          content: content.substring(0, 5000),
          codeExamples: codeExamples.slice(0, 5),
          crawledAt: new Date().toISOString()
        });
      }

    } catch (err) {
      console.error(`[${this.workerId}] MDN crawl error:`, err.message);
    }
  }

  async crawlDevTo(tag, maxPages) {
    const searchUrl = `https://dev.to/t/${tag}`;

    try {
      const html = await this.fetchWithDelay(searchUrl);
      const $ = cheerio.load(html);

      // Extract article links
      const articleLinks = [];
      $('a[id*="article-link"]').each((i, el) => {
        if (articleLinks.length >= maxPages) return false;
        const href = $(el).attr('href');
        if (href) {
          // Check if href is already a full URL
          const fullUrl = href.startsWith('http') ? href : `https://dev.to${href}`;
          articleLinks.push(fullUrl);
        }
      });

      // Crawl each article
      for (const link of articleLinks.slice(0, maxPages)) {
        await this.crawlDevToArticle(link);
      }

    } catch (err) {
      console.error(`[${this.workerId}] Dev.to crawl error:`, err.message);
    }
  }

  async crawlDevToArticle(url) {
    if (this.visitedUrls.has(url)) return;
    this.visitedUrls.add(url);

    try {
      const html = await this.fetchWithDelay(url);
      const $ = cheerio.load(html);

      const title = $('h1').first().text().trim();
      const content = $('#article-body').text().trim();
      const tags = [];
      $('.tag').each((i, el) => {
        tags.push($(el).text().trim());
      });

      if (title && content) {
        this.crawledData.push({
          id: this.generateId(url),
          source: 'devto',
          type: 'article',
          url,
          title,
          content: content.substring(0, 5000),
          tags,
          crawledAt: new Date().toISOString()
        });
      }

    } catch (err) {
      console.error(`[${this.workerId}] Error crawling Dev.to article:`, err.message);
    }
  }

  async crawlDocumentation(topic, maxPages) {
    // Generic documentation crawler
    // Can be configured for specific doc sites
    const docSites = {
      'nodejs': 'https://nodejs.org/api/',
      'python': 'https://docs.python.org/3/',
      'react': 'https://react.dev/reference/react'
    };

    const baseUrl = docSites[topic] || topic;

    try {
      const html = await this.fetchWithDelay(baseUrl);
      const $ = cheerio.load(html);

      const title = $('h1, title').first().text().trim();
      const content = $('main, article, .content').first().text().trim();

      if (content) {
        this.crawledData.push({
          id: this.generateId(baseUrl),
          source: 'documentation',
          type: 'docs',
          topic,
          url: baseUrl,
          title,
          content: content.substring(0, 5000),
          crawledAt: new Date().toISOString()
        });
      }

    } catch (err) {
      console.error(`[${this.workerId}] Documentation crawl error:`, err.message);
    }
  }

  async crawlPortalQuery(query, maxPages) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return;

    const directUrl = this.normalizeUrl(cleanQuery);
    if (directUrl) {
      await this.crawlGenericPage(directUrl);
      return;
    }

    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    try {
      const html = await this.fetchWithDelay(searchUrl);
      const $ = cheerio.load(html);
      const links = [];

      $('a.result__a, a[href*="uddg="], a[href^="http"]').each((_, el) => {
        if (links.length >= maxPages) return false;
        const href = $(el).attr('href');
        const url = this.extractSearchResultUrl(href);
        if (url && !links.includes(url)) links.push(url);
      });

      for (const link of links.slice(0, maxPages)) {
        await this.crawlGenericPage(link);
      }
    } catch (err) {
      console.error(`[${this.workerId}] Portal crawl error:`, err.message);
    }
  }

  async crawlGenericPage(url) {
    const normalized = this.normalizeUrl(url);
    if (!normalized || this.visitedUrls.has(normalized)) return;
    this.visitedUrls.add(normalized);

    try {
      const html = await this.fetchWithDelay(normalized);
      const $ = cheerio.load(html);

      $('script, style, noscript, svg, nav, footer, header').remove();
      const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || $('h1').first().text() || normalized).trim();
      const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();
      const content = ($('main').text() || $('article').text() || $('body').text() || '')
        .replace(/\s+/g, ' ')
        .trim();

      if (content.length < 80) return;

      this.crawledData.push({
        id: this.generateId(normalized),
        source: 'portal',
        type: 'web_page',
        url: normalized,
        title: title.substring(0, 250),
        description: description.substring(0, 500),
        content: content.substring(0, 120000),
        crawledAt: new Date().toISOString()
      });
    } catch (err) {
      console.error(`[${this.workerId}] Generic page crawl error (${normalized}):`, err.message);
    }
  }

  async fetchWithDelay(url) {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.requestDelay) {
      await this.sleep(this.requestDelay - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();

    // Fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (SOMA Learning Bot) AppleWebKit/537.36'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();

    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  generateId(url) {
    return crypto.createHash('md5').update(url).digest('hex').substring(0, 16);
  }

  normalizeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.hash = '';
      return url.toString();
    } catch {
      return null;
    }
  }

  extractSearchResultUrl(href) {
    if (!href) return null;
    try {
      const raw = href.startsWith('//') ? `https:${href}` : href;
      const parsed = new URL(raw, 'https://duckduckgo.com');
      const redirected = parsed.searchParams.get('uddg');
      return this.normalizeUrl(redirected || parsed.href);
    } catch {
      return this.normalizeUrl(href);
    }
  }

  getStats() {
    return {
      workerId: this.workerId,
      itemsCollected: this.crawledData.length,
      urlsVisited: this.visitedUrls.size
    };
  }
}

module.exports = { WebCrawlerWorker };
