/**
 * Dendrite.cjs - Web search neural extension for SOMA
 * 
 * Acts as external knowledge gatherer when models lack information.
 * Uses Brave Search API (production-grade, 2000 free queries/month).
 * 
 * Flow:
 * 1. Query hits model (Ollama/DeepSeek/etc)
 * 2. Model responds "I don't know" or low confidence
 * 3. Dendrite searches web via Brave Search
 * 4. Returns top results to model for synthesis
 * 5. Model generates informed response
 */

const https = require('https');
const zlib = require('zlib');
const { getEnvLoader } = require('../config/EnvLoader.cjs');

class Dendrite {
  constructor(config = {}) {
    this.name = 'Dendrite';
    this.maxResults = config.maxResults || 5;
    this.timeout = config.timeout || 15000;
    
    // Load API key from environment
    const envLoader = getEnvLoader();
    this.apiKey = config.apiKey || envLoader.get('BRAVE_SEARCH_API_KEY');
    
    if (!this.apiKey) {
      throw new Error('Brave Search API key required. Set BRAVE_SEARCH_API_KEY in .env');
    }
    
    // Metrics
    this.metrics = {
      totalSearches: 0,
      successfulSearches: 0,
      failedSearches: 0,
      avgResponseTime: 0,
      totalResponseTime: 0,
      totalResults: 0
    };
    
    console.log(`🌐 ${this.name} initialized (Brave Search API)`);
  }

  /**
   * Web search (default)
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<object>} Search results
   */
  async search(query, options = {}) {
    return await this.searchWeb(query, options);
  }

  /**
   * Web search for general information
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<object>} Search results
   */
  async searchWeb(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    try {
      console.log(`[Dendrite] Searching: "${query}"`);
      
      // Brave Search API (production-ready)
      const results = await this._searchBrave(query, options);
      
      const elapsed = Date.now() - startTime;
      this.metrics.successfulSearches++;
      this.metrics.totalResponseTime += elapsed;
      this.metrics.totalResults += results.length;
      this.metrics.avgResponseTime = Math.round(
        this.metrics.totalResponseTime / this.metrics.successfulSearches
      );

      console.log(`[Dendrite] Found ${results.length} results in ${elapsed}ms`);

      return {
        success: true,
        query,
        results,
        count: results.length,
        elapsed,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.metrics.failedSearches++;
      console.error(`[Dendrite] Search failed: ${error.message}`);
      
      return {
        success: false,
        query,
        results: [],
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Brave Search API implementation
   * @private
   */
  async _searchBrave(query, options = {}) {
    const count = options.maxResults || this.maxResults;
    
    // Brave Search Web Search API
    // Docs: https://api.search.brave.com/app/documentation/web-search/get-started
    const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    
    const response = await this._httpsRequest(endpoint, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey
      }
    });

    const data = JSON.parse(response);
    
    // Parse Brave Search response
    const results = [];
    
    if (data.web && data.web.results) {
      for (const result of data.web.results) {
        results.push({
          title: result.title,
          url: result.url,
          snippet: result.description || result.extra_snippets?.[0] || '',
          source: 'Brave Search'
        });
      }
    }
    
    return results;
  }

  /**
   * News search for real-time information
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<object>} News results
   */
  async searchNews(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    try {
      console.log(`[Dendrite:News] Searching: "${query}"`);
      
      const count = options.maxResults || this.maxResults;
      const endpoint = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${count}`;
      
      const response = await this._httpsRequest(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey
        }
      });

      const data = JSON.parse(response);
      const results = [];
      
      if (data.results) {
        for (const result of data.results) {
          results.push({
            title: result.title,
            url: result.url,
            snippet: result.description || '',
            source: result.source || 'Unknown',
            publishedAt: result.age || result.published_at || null,
            thumbnail: result.thumbnail?.src || null
          });
        }
      }

      const elapsed = Date.now() - startTime;
      this.metrics.successfulSearches++;
      this.metrics.totalResponseTime += elapsed;
      this.metrics.totalResults += results.length;

      console.log(`[Dendrite:News] Found ${results.length} news items in ${elapsed}ms`);

      return {
        success: true,
        type: 'news',
        query,
        results,
        count: results.length,
        elapsed,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.metrics.failedSearches++;
      console.error(`[Dendrite:News] Search failed: ${error.message}`);
      
      return {
        success: false,
        type: 'news',
        query,
        results: [],
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Image search for visual content
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<object>} Image results
   */
  async searchImages(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    try {
      console.log(`[Dendrite:Images] Searching: "${query}"`);
      
      const count = options.maxResults || this.maxResults;
      const endpoint = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=${count}`;
      
      const response = await this._httpsRequest(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey
        }
      });

      const data = JSON.parse(response);
      const results = [];
      
      if (data.results) {
        for (const result of data.results) {
          results.push({
            title: result.title,
            url: result.url,
            thumbnail: result.thumbnail?.src || result.properties?.url || null,
            source: result.source || 'Unknown',
            width: result.properties?.width || null,
            height: result.properties?.height || null
          });
        }
      }

      const elapsed = Date.now() - startTime;
      this.metrics.successfulSearches++;
      this.metrics.totalResponseTime += elapsed;
      this.metrics.totalResults += results.length;

      console.log(`[Dendrite:Images] Found ${results.length} images in ${elapsed}ms`);

      return {
        success: true,
        type: 'image',
        query,
        results,
        count: results.length,
        elapsed,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.metrics.failedSearches++;
      console.error(`[Dendrite:Images] Search failed: ${error.message}`);
      
      return {
        success: false,
        type: 'image',
        query,
        results: [],
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Video search for educational/research content
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<object>} Video results
   */
  async searchVideos(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    try {
      console.log(`[Dendrite:Videos] Searching: "${query}"`);
      
      const count = options.maxResults || this.maxResults;
      const endpoint = `https://api.search.brave.com/res/v1/videos/search?q=${encodeURIComponent(query)}&count=${count}`;
      
      const response = await this._httpsRequest(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey
        }
      });

      const data = JSON.parse(response);
      const results = [];
      
      if (data.results) {
        for (const result of data.results) {
          results.push({
            title: result.title,
            url: result.url,
            thumbnail: result.thumbnail?.src || null,
            source: result.source || result.creator || 'Unknown',
            duration: result.duration || null,
            publishedAt: result.age || result.published_at || null,
            views: result.meta_url?.views || null
          });
        }
      }

      const elapsed = Date.now() - startTime;
      this.metrics.successfulSearches++;
      this.metrics.totalResponseTime += elapsed;
      this.metrics.totalResults += results.length;

      console.log(`[Dendrite:Videos] Found ${results.length} videos in ${elapsed}ms`);

      return {
        success: true,
        type: 'video',
        query,
        results,
        count: results.length,
        elapsed,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.metrics.failedSearches++;
      console.error(`[Dendrite:Videos] Search failed: ${error.message}`);
      
      return {
        success: false,
        type: 'video',
        query,
        results: [],
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * HTTPS request helper for Brave API
   * @private
   */
  _httpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: this.timeout
      };

      const req = https.request(requestOptions, (res) => {
        let chunks = [];
        
        // Handle gzip encoding
        let stream = res;
        if (res.headers['content-encoding'] === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        }
        
        stream.on('data', chunk => {
          chunks.push(chunk);
        });
        
        stream.on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode === 200) {
              resolve(data);
            } else {
              reject(new Error(`Brave API error: HTTP ${res.statusCode} - ${data.substring(0, 200)}`));
            }
          } catch (err) {
            reject(new Error(`Failed to decode response: ${err.message}`));
          }
        });
        
        stream.on('error', (err) => {
          reject(new Error(`Stream error: ${err.message}`));
        });
      });

      req.on('error', (err) => {
        reject(new Error(`HTTPS request failed: ${err.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Format search results for model consumption
   */
  formatForModel(searchResults) {
    if (!searchResults.success || searchResults.results.length === 0) {
      return 'No web search results found.';
    }

    let formatted = `Web search results for "${searchResults.query}":\n\n`;
    
    searchResults.results.forEach((result, index) => {
      formatted += `[${index + 1}] ${result.title}\n`;
      formatted += `    ${result.snippet}\n`;
      formatted += `    Source: ${result.url}\n\n`;
    });

    return formatted;
  }

  /**
   * Get metrics
   */
  getMetrics() {
    const successRate = this.metrics.totalSearches > 0
      ? (this.metrics.successfulSearches / this.metrics.totalSearches * 100).toFixed(1)
      : 0;

    return {
      totalSearches: this.metrics.totalSearches,
      successfulSearches: this.metrics.successfulSearches,
      failedSearches: this.metrics.failedSearches,
      successRate: `${successRate}%`,
      avgResponseTime: `${this.metrics.avgResponseTime}ms`,
      totalResults: this.metrics.totalResults,
      avgResultsPerSearch: this.metrics.totalSearches > 0 
        ? (this.metrics.totalResults / this.metrics.totalSearches).toFixed(1)
        : 0
    };
  }
}

module.exports = { Dendrite };
