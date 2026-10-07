// ════════════════════════════════════════════════════════════════════════════
// EdgeWorkerArbiter v2.5 — Autonomous Self-Managing Web Crawler
// ════════════════════════════════════════════════════════════════════════════
// PURPOSE: Autonomous web data gathering with adaptive crawling, knowledge mesh,
//          clone lifecycle management, and merge protocols
// ════════════════════════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { URL } = require('url');
const crypto = require('crypto');

class EdgeWorkerArbiter extends BaseArbiter {
  constructor(broker, config = {}) {
    super(broker, {
      name: 'EdgeWorker',
      role: 'autonomous-web-crawler',
      ...config
    });

    // Knowledge Mesh - distributed knowledge graph
    this.knowledgeMesh = {
      nodes: new Map(),      // URL -> knowledge node
      edges: new Map(),      // relationships between knowledge
      clusters: new Map(),   // topic clusters
      importance: new Map()  // node importance scores
    };

    // Clone Management
    this.clones = new Map();  // active worker clones
    this.cloneGeneration = 0;
    this.maxClones = config.maxClones || 10;

    // Crawl Strategy
    this.crawlQueue = [];
    this.visited = new Set();
    this.crawlDepth = config.crawlDepth || 3;
    this.respectRobotsTxt = config.respectRobotsTxt !== false;

    // Adaptive Learning
    this.urlPatterns = new Map();  // learned URL patterns
    this.contentPatterns = new Map();  // content extraction patterns
    this.successRates = new Map();  // URL pattern success rates

    // Merge Protocol
    this.pendingMerges = [];
    this.mergeThreshold = config.mergeThreshold || 0.7;

    this.setupSubscriptions();
  }

  setupSubscriptions() {
    // Listen for crawl requests
    this.subscribe('crawl.request', this.handleCrawlRequest.bind(this));
    
    // Listen for clone lifecycle events
    this.subscribe('clone.ready', this.handleCloneReady.bind(this));
    this.subscribe('clone.complete', this.handleCloneComplete.bind(this));
    this.subscribe('clone.failed', this.handleCloneFailed.bind(this));
    
    // Listen for merge requests
    this.subscribe('knowledge.merge', this.handleKnowledgeMerge.bind(this));
  }

  async initialize() {
    await super.initialize();
    
    this.log('info', '🌐 EdgeWorker v2.5 initialized');
    this.log('info', `   Max clones: ${this.maxClones}`);
    this.log('info', `   Crawl depth: ${this.crawlDepth}`);
    
    // Start autonomous crawl cycle
    this.startAutonomousCrawl();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLONE LIFECYCLE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async spawnClone(mission) {
    if (this.clones.size >= this.maxClones) {
      this.log('warn', '⚠️  Max clones reached, queueing mission');
      this.crawlQueue.push(mission);
      return null;
    }

    const cloneId = `clone-${++this.cloneGeneration}`;
    const clone = {
      id: cloneId,
      mission,
      spawnTime: Date.now(),
      status: 'active',
      discovered: [],
      knowledge: new Map()
    };

    this.clones.set(cloneId, clone);
    
    this.log('info', `👥 Spawned ${cloneId} for: ${mission.url}`);
    
    // Execute clone mission
    this.executeCloneMission(clone);
    
    return cloneId;
  }

  async executeCloneMission(clone) {
    try {
      const result = await this.crawlUrl(clone.mission.url, clone.mission.depth || 0);
      
      clone.discovered = result.links;
      clone.knowledge = result.knowledge;
      clone.status = 'complete';
      
      this.publish('clone.complete', { cloneId: clone.id, result });
      
    } catch (error) {
      clone.status = 'failed';
      clone.error = error.message;
      
      this.publish('clone.failed', { cloneId: clone.id, error: error.message });
    }
  }

  async handleCloneComplete({ cloneId, result }) {
    const clone = this.clones.get(cloneId);
    if (!clone) return;

    // Merge knowledge into mesh
    await this.mergeKnowledgeIntoMesh(clone.knowledge);
    
    // Queue discovered URLs
    for (const link of clone.discovered) {
      if (!this.visited.has(link) && this.shouldCrawl(link)) {
        this.crawlQueue.push({
          url: link,
          depth: clone.mission.depth + 1,
          parent: clone.mission.url
        });
      }
    }

    // Retire clone
    this.clones.delete(cloneId);
    
    this.log('info', `✅ Clone ${cloneId} completed: ${clone.discovered.length} links, ${clone.knowledge.size} knowledge nodes`);
    
    // Spawn next mission if queue has work
    if (this.crawlQueue.length > 0) {
      const nextMission = this.crawlQueue.shift();
      await this.spawnClone(nextMission);
    }
  }

  async handleCloneFailed({ cloneId, error }) {
    const clone = this.clones.get(cloneId);
    if (!clone) return;

    this.log('error', `❌ Clone ${cloneId} failed: ${error}`);
    
    // Learn from failure
    this.recordFailure(clone.mission.url, error);
    
    // Retire failed clone
    this.clones.delete(cloneId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADAPTIVE CRAWLING
  // ═══════════════════════════════════════════════════════════════════════════

  async crawlUrl(url, depth = 0) {
    if (depth > this.crawlDepth) {
      return { links: [], knowledge: new Map() };
    }

    this.visited.add(url);
    
    try {
      // Check robots.txt if enabled
      if (this.respectRobotsTxt && !(await this.canCrawl(url))) {
        this.log('info', `🚫 Blocked by robots.txt: ${url}`);
        return { links: [], knowledge: new Map() };
      }

      // Fetch page
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'SOMABot/2.5 (Autonomous Learning Agent)'
        },
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract knowledge
      const knowledge = this.extractKnowledge($, url);
      
      // Extract links
      const links = this.extractLinks($, url);
      
      // Learn patterns
      this.learnPatterns(url, $, knowledge.size > 0);
      
      // Record success
      this.recordSuccess(url);

      return { links, knowledge };

    } catch (error) {
      this.log('error', `Failed to crawl ${url}: ${error.message}`);
      this.recordFailure(url, error.message);
      return { links: [], knowledge: new Map() };
    }
  }

  extractKnowledge($, url) {
    const knowledge = new Map();

    // Extract structured data
    $('script[type="application/ld+json"]').each((i, elem) => {
      try {
        const data = JSON.parse($(elem).html());
        knowledge.set(`structured-${i}`, {
          type: 'structured-data',
          content: data,
          source: url
        });
      } catch (e) {
        // Invalid JSON
      }
    });

    // Extract semantic content
    $('article, main, [role="main"]').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text.length > 100) {
        knowledge.set(`content-${i}`, {
          type: 'semantic-content',
          content: text,
          source: url,
          hash: this.hashContent(text)
        });
      }
    });

    // Extract metadata
    const title = $('title').text();
    const description = $('meta[name="description"]').attr('content');
    const keywords = $('meta[name="keywords"]').attr('content');

    if (title || description || keywords) {
      knowledge.set('metadata', {
        type: 'metadata',
        title,
        description,
        keywords: keywords?.split(',').map(k => k.trim()),
        source: url
      });
    }

    return knowledge;
  }

  extractLinks($, baseUrl) {
    const links = [];
    const base = new URL(baseUrl);

    $('a[href]').each((i, elem) => {
      try {
        const href = $(elem).attr('href');
        const resolved = new URL(href, baseUrl);
        
        // Only follow http/https links
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
          links.push(resolved.href);
        }
      } catch (e) {
        // Invalid URL
      }
    });

    return [...new Set(links)];  // deduplicate
  }

  shouldCrawl(url) {
    try {
      const parsed = new URL(url);
      
      // Skip common non-content URLs
      const skipExtensions = ['.pdf', '.zip', '.exe', '.jpg', '.png', '.gif', '.mp4'];
      if (skipExtensions.some(ext => parsed.pathname.endsWith(ext))) {
        return false;
      }

      // Use learned patterns to predict value
      const pattern = this.getUrlPattern(url);
      const successRate = this.successRates.get(pattern) || 0.5;
      
      return successRate > 0.3;  // threshold for crawling
      
    } catch (e) {
      return false;
    }
  }

  async canCrawl(url) {
    // Simplified robots.txt check (in production, use proper robots.txt parser)
    try {
      const parsed = new URL(url);
      const robotsUrl = `${parsed.origin}/robots.txt`;
      
      // Cache robots.txt per domain (not implemented here for brevity)
      // In production, implement caching
      
      return true;  // simplified
    } catch (e) {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE MESH
  // ═══════════════════════════════════════════════════════════════════════════

  async mergeKnowledgeIntoMesh(knowledge) {
    for (const [key, node] of knowledge.entries()) {
      const nodeId = this.hashContent(JSON.stringify(node));
      
      // Check for duplicates
      if (this.knowledgeMesh.nodes.has(nodeId)) {
        // Update existing node
        const existing = this.knowledgeMesh.nodes.get(nodeId);
        existing.sources = existing.sources || [];
        existing.sources.push(node.source);
        existing.lastSeen = Date.now();
      } else {
        // Add new node
        this.knowledgeMesh.nodes.set(nodeId, {
          ...node,
          id: nodeId,
          created: Date.now(),
          lastSeen: Date.now(),
          sources: [node.source]
        });
      }

      // Build edges (relationships)
      this.buildKnowledgeEdges(nodeId, node);
      
      // Update importance scores
      this.updateImportance(nodeId);
      
      // Cluster related knowledge
      this.clusterKnowledge(nodeId, node);
    }

    this.log('info', `📊 Knowledge mesh: ${this.knowledgeMesh.nodes.size} nodes, ${this.knowledgeMesh.edges.size} edges`);
  }

  buildKnowledgeEdges(nodeId, node) {
    // Find related nodes based on content similarity
    for (const [otherId, otherNode] of this.knowledgeMesh.nodes.entries()) {
      if (otherId === nodeId) continue;

      const similarity = this.calculateSimilarity(node, otherNode);
      
      if (similarity > this.mergeThreshold) {
        const edgeKey = `${nodeId}-${otherId}`;
        this.knowledgeMesh.edges.set(edgeKey, {
          from: nodeId,
          to: otherId,
          weight: similarity,
          type: 'similarity'
        });
      }
    }
  }

  calculateSimilarity(node1, node2) {
    // Simplified similarity calculation
    // In production, use proper NLP/embedding similarity
    
    if (node1.type !== node2.type) return 0;
    
    const text1 = JSON.stringify(node1.content).toLowerCase();
    const text2 = JSON.stringify(node2.content).toLowerCase();
    
    // Simple word overlap
    const words1 = new Set(text1.split(/\s+/));
    const words2 = new Set(text2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;  // Jaccard similarity
  }

  updateImportance(nodeId) {
    // Calculate importance based on:
    // 1. Number of incoming edges
    // 2. Number of sources
    // 3. Recency
    
    const node = this.knowledgeMesh.nodes.get(nodeId);
    if (!node) return;

    const incomingEdges = Array.from(this.knowledgeMesh.edges.values())
      .filter(edge => edge.to === nodeId).length;
    
    const sources = node.sources?.length || 1;
    const recency = 1 - (Date.now() - node.lastSeen) / (1000 * 60 * 60 * 24 * 7); // decay over week
    
    const importance = (incomingEdges * 0.4) + (sources * 0.3) + (recency * 0.3);
    
    this.knowledgeMesh.importance.set(nodeId, importance);
  }

  clusterKnowledge(nodeId, node) {
    // Simple clustering based on content type and keywords
    const clusterKey = node.type || 'uncategorized';
    
    if (!this.knowledgeMesh.clusters.has(clusterKey)) {
      this.knowledgeMesh.clusters.set(clusterKey, new Set());
    }
    
    this.knowledgeMesh.clusters.get(clusterKey).add(nodeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN LEARNING
  // ═══════════════════════════════════════════════════════════════════════════

  learnPatterns(url, $, successful) {
    const pattern = this.getUrlPattern(url);
    
    // Update URL pattern success rates
    if (!this.urlPatterns.has(pattern)) {
      this.urlPatterns.set(pattern, { attempts: 0, successes: 0 });
    }
    
    const stats = this.urlPatterns.get(pattern);
    stats.attempts++;
    if (successful) stats.successes++;
    
    this.successRates.set(pattern, stats.successes / stats.attempts);

    // Learn content extraction patterns
    if (successful) {
      this.learnContentPatterns($, url);
    }
  }

  getUrlPattern(url) {
    try {
      const parsed = new URL(url);
      // Generalize URL to pattern (e.g., github.com/*/* -> github.com/{user}/{repo})
      const pathSegments = parsed.pathname.split('/').filter(s => s);
      const pattern = parsed.hostname + '/' + pathSegments.map(() => '*').join('/');
      return pattern;
    } catch (e) {
      return 'unknown';
    }
  }

  learnContentPatterns($, url) {
    // Learn which selectors are most valuable for this URL pattern
    const pattern = this.getUrlPattern(url);
    
    if (!this.contentPatterns.has(pattern)) {
      this.contentPatterns.set(pattern, {
        selectors: new Map(),
        confidence: 0
      });
    }

    const patternData = this.contentPatterns.get(pattern);
    
    // Track which selectors yielded content
    const selectors = ['article', 'main', '[role="main"]', '.content', '#content'];
    for (const selector of selectors) {
      const found = $(selector).length > 0;
      if (!patternData.selectors.has(selector)) {
        patternData.selectors.set(selector, { found: 0, total: 0 });
      }
      const stats = patternData.selectors.get(selector);
      stats.total++;
      if (found) stats.found++;
    }

    // Update confidence
    patternData.confidence = Math.min(patternData.confidence + 0.1, 1.0);
  }

  recordSuccess(url) {
    const pattern = this.getUrlPattern(url);
    this.log('debug', `✅ Crawl success: ${pattern}`);
  }

  recordFailure(url, error) {
    const pattern = this.getUrlPattern(url);
    this.log('debug', `❌ Crawl failure: ${pattern} - ${error}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTONOMOUS OPERATION
  // ═══════════════════════════════════════════════════════════════════════════

  async startAutonomousCrawl() {
    setInterval(async () => {
      // Spawn new clones if we have capacity and work
      while (this.clones.size < this.maxClones && this.crawlQueue.length > 0) {
        const mission = this.crawlQueue.shift();
        await this.spawnClone(mission);
      }

      // Publish mesh stats
      this.publishStats();
      
    }, 5000);  // every 5 seconds
  }

  publishStats() {
    this.publish('edge.stats', {
      clones: this.clones.size,
      queueDepth: this.crawlQueue.length,
      knowledgeNodes: this.knowledgeMesh.nodes.size,
      edges: this.knowledgeMesh.edges.size,
      clusters: this.knowledgeMesh.clusters.size,
      visited: this.visited.size,
      patterns: this.urlPatterns.size
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  async handleCrawlRequest({ url, depth = 0, callback }) {
    this.log('info', `📥 Crawl request: ${url}`);
    
    this.crawlQueue.push({ url, depth });
    
    // Spawn clone if capacity available
    if (this.clones.size < this.maxClones) {
      const mission = this.crawlQueue.shift();
      await this.spawnClone(mission);
    }
  }

  async handleKnowledgeMerge({ sourceCloneId, knowledge }) {
    this.log('info', `🔀 Merging knowledge from ${sourceCloneId}`);
    await this.mergeKnowledgeIntoMesh(knowledge);
  }

  async handleCloneReady({ cloneId }) {
    this.log('info', `✅ Clone ready: ${cloneId}`);
    // Clone is ready to start working
  }

  async handleCloneComplete({ cloneId, results }) {
    this.log('info', `✅ Clone complete: ${cloneId}`);
    // Clone finished its mission
    if (this.clones.has(cloneId)) {
      this.clones.delete(cloneId);
    }
  }

  async handleCloneFailed({ cloneId, error }) {
    this.log('warn', `❌ Clone failed: ${cloneId} - ${error}`);
    // Clone encountered an error
    if (this.clones.has(cloneId)) {
      this.clones.delete(cloneId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      clones: this.clones.size,
      maxClones: this.maxClones,
      queueDepth: this.crawlQueue.length,
      knowledgeNodes: this.knowledgeMesh.nodes.size,
      knowledgeEdges: this.knowledgeMesh.edges.size,
      clusters: this.knowledgeMesh.clusters.size,
      visited: this.visited.size,
      learnedPatterns: this.urlPatterns.size
    };
  }
}

module.exports = EdgeWorkerArbiter;






