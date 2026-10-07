/**
 * BraveSearchAdapter.cjs v2.0 - Web search neural extension for SOMA (ENHANCED)
 *
 * Acts as external knowledge gatherer when models lack information.
 * Uses Brave Search API (production-grade, 2000 free queries/month).
 *
 * NEW in v2.0:
 * - ✅ Automatic retry with exponential backoff
 * - ✅ Standardized error handling
 * - ✅ Secure logging (API keys redacted)
 * - ✅ Rate limit handling
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

// Phase 1 enhancements
const logger = require('../core/SecureLogger.cjs');
const { withRetry } = require('../core/RetryUtils.cjs');
const { withErrorHandling, RateLimitError } = require('../core/ToolErrorHandler.cjs');

class BraveSearchAdapter {
  constructor(config = {}) {
    this.name = 'BraveSearchAdapter';
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
      totalResults: 0,
      rateLimitHits: 0,
      retries: 0
    };

    logger.info(`🌐 ${this.name} v2.0 initialized (Brave Search API with retry & error handling)`);
  }

  /**
   * Web search (default) - Enhanced with retry and error handling
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<object>} Search results
   */
  async search(query, options = {}) {
    return await this.searchWeb(query, options);
  }

  /**
   * Web search for general information - Enhanced
   * @param {string} query - Search query
   * @param {object} options - Search options
   * @returns {Promise<object>} Search results
   */
  async searchWeb(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    const safeSearch = withErrorHandling(
      withRetry(
        async () => {
          logger.info(`[${this.name}] Searching: "${query}"`);

          // Brave Search API
          const results = await this._searchBrave(query, options);

          const elapsed = Date.now() - startTime;
          this.metrics.successfulSearches++;
          this.metrics.totalResponseTime += elapsed;
          this.metrics.totalResults += results.length;
          this.metrics.avgResponseTime = Math.round(
            this.metrics.totalResponseTime / this.metrics.successfulSearches
          );

          logger.info(`[${this.name}] Found ${results.length} results in ${elapsed}ms`);

          return {
            success: true,
            query,
            results,
            count: results.length,
            elapsed,
            timestamp: new Date().toISOString()
          };
        },
        {
          maxRetries: 3,
          baseDelay: 2000,
          maxDelay: 10000,
          onRetryAttempt: (attempt, maxRetries, delay, error) => {
            this.metrics.retries++;
            logger.warn(`[${this.name}] Retry ${attempt}/${maxRetries} for "${query}" after ${delay}ms`);
          }
        }
      ),
      {
        toolName: 'brave_search_web',
        context: `Web search: ${query}`
      }
    );

    const result = await safeSearch();

    if (!result.success) {
      this.metrics.failedSearches++;
      logger.error(`[${this.name}] Search failed: ${result.error}`);
    }

    return result;
  }

  /**
   * Brave Search API implementation with rate limit detection
   * @private
   */
  async _searchBrave(query, options = {}) {
    const count = options.maxResults || this.maxResults;

    // Brave Search Web Search API
    const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

    const response = await this._httpsRequest(endpoint, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey
      }
    });

    const data = JSON.parse(response.body);

    // Check for rate limit
    if (response.statusCode === 429) {
      this.metrics.rateLimitHits++;
      const retryAfter = response.headers['retry-after'] || '60';
      throw new RateLimitError('Brave Search rate limit exceeded', parseInt(retryAfter, 10));
    }

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
   * News search - Enhanced
   */
  async searchNews(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    const safeSearch = withErrorHandling(
      withRetry(
        async () => {
          logger.info(`[${this.name}:News] Searching: "${query}"`);

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

          // Check rate limit
          if (response.statusCode === 429) {
            this.metrics.rateLimitHits++;
            const retryAfter = response.headers['retry-after'] || '60';
            throw new RateLimitError('Brave Search rate limit exceeded', parseInt(retryAfter, 10));
          }

          const data = JSON.parse(response.body);
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

          logger.info(`[${this.name}:News] Found ${results.length} news items in ${elapsed}ms`);

          return {
            success: true,
            type: 'news',
            query,
            results,
            count: results.length,
            elapsed,
            timestamp: new Date().toISOString()
          };
        },
        {
          maxRetries: 3,
          baseDelay: 2000,
          onRetryAttempt: (attempt, maxRetries, delay) => {
            this.metrics.retries++;
            logger.warn(`[${this.name}:News] Retry ${attempt}/${maxRetries} after ${delay}ms`);
          }
        }
      ),
      {
        toolName: 'brave_search_news',
        context: `News search: ${query}`
      }
    );

    const result = await safeSearch();

    if (!result.success) {
      this.metrics.failedSearches++;
    }

    return result;
  }

  /**
   * Image search - Enhanced
   */
  async searchImages(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    const safeSearch = withErrorHandling(
      withRetry(
        async () => {
          logger.info(`[${this.name}:Images] Searching: "${query}"`);

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

          // Check rate limit
          if (response.statusCode === 429) {
            this.metrics.rateLimitHits++;
            const retryAfter = response.headers['retry-after'] || '60';
            throw new RateLimitError('Brave Search rate limit exceeded', parseInt(retryAfter, 10));
          }

          const data = JSON.parse(response.body);
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

          logger.info(`[${this.name}:Images] Found ${results.length} images in ${elapsed}ms`);

          return {
            success: true,
            type: 'image',
            query,
            results,
            count: results.length,
            elapsed,
            timestamp: new Date().toISOString()
          };
        },
        {
          maxRetries: 3,
          baseDelay: 2000,
          onRetryAttempt: (attempt, maxRetries, delay) => {
            this.metrics.retries++;
            logger.warn(`[${this.name}:Images] Retry ${attempt}/${maxRetries} after ${delay}ms`);
          }
        }
      ),
      {
        toolName: 'brave_search_images',
        context: `Image search: ${query}`
      }
    );

    const result = await safeSearch();

    if (!result.success) {
      this.metrics.failedSearches++;
    }

    return result;
  }

  /**
   * Video search - Enhanced
   */
  async searchVideos(query, options = {}) {
    const startTime = Date.now();
    this.metrics.totalSearches++;

    const safeSearch = withErrorHandling(
      withRetry(
        async () => {
          logger.info(`[${this.name}:Videos] Searching: "${query}"`);

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

          // Check rate limit
          if (response.statusCode === 429) {
            this.metrics.rateLimitHits++;
            const retryAfter = response.headers['retry-after'] || '60';
            throw new RateLimitError('Brave Search rate limit exceeded', parseInt(retryAfter, 10));
          }

          const data = JSON.parse(response.body);
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

          logger.info(`[${this.name}:Videos] Found ${results.length} videos in ${elapsed}ms`);

          return {
            success: true,
            type: 'video',
            query,
            results,
            count: results.length,
            elapsed,
            timestamp: new Date().toISOString()
          };
        },
        {
          maxRetries: 3,
          baseDelay: 2000,
          onRetryAttempt: (attempt, maxRetries, delay) => {
            this.metrics.retries++;
            logger.warn(`[${this.name}:Videos] Retry ${attempt}/${maxRetries} after ${delay}ms`);
          }
        }
      ),
      {
        toolName: 'brave_search_videos',
        context: `Video search: ${query}`
      }
    );

    const result = await safeSearch();

    if (!result.success) {
      this.metrics.failedSearches++;
    }

    return result;
  }

  /**
   * HTTPS request helper - Enhanced to return full response
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
            const body = Buffer.concat(chunks).toString('utf8');

            // Return full response with headers
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body
            });
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
   * Get metrics - Enhanced with new fields
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
        : 0,
      rateLimitHits: this.metrics.rateLimitHits,
      totalRetries: this.metrics.retries
    };
  }
}

// Export for compatibility
module.exports = {
  BraveSearchAdapter,
  Dendrite: BraveSearchAdapter // Alias for backward compatibility
};
