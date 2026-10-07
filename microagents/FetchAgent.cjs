// FetchAgent.cjs
// Specialized MicroAgent for HTTP fetch operations

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');
const fetch = require('node-fetch');

class FetchAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'fetch' });
    
    this.maxRedirects = config.maxRedirects || 5;
    this.timeout = config.timeout || 10000; // 10 seconds
    this.userAgent = config.userAgent || 'SOMA-MicroAgent/1.0';
  }
  
  /**
   * Execute fetch task
   * Task format:
   * {
   *   url: 'https://example.com',
   *   method: 'GET',
   *   headers: {},
   *   body: {},
   *   parse: 'json' | 'text' | 'buffer'
   * }
   */
  async execute(task) {
    const { url, method = 'GET', headers = {}, body, parse = 'json' } = task;
    
    if (!url) {
      throw new Error('Task must include url');
    }
    
    this.logger.info(`[FetchAgent:${this.id}] Fetching: ${method} ${url}`);
    
    const options = {
      method,
      headers: {
        'User-Agent': this.userAgent,
        ...headers
      },
      timeout: this.timeout,
      redirect: 'follow',
      follow: this.maxRedirects
    };
    
    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      if (typeof body === 'object') {
        options.body = JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
      } else {
        options.body = body;
      }
    }
    
    try {
      const response = await fetch(url, options);
      
      const result = {
        url,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        ok: response.ok,
        data: null
      };
      
      // Parse response
      if (parse === 'json') {
        result.data = await response.json();
      } else if (parse === 'text') {
        result.data = await response.text();
      } else if (parse === 'buffer') {
        result.data = await response.buffer();
      }
      
      this.logger.info(`[FetchAgent:${this.id}] Fetch complete: ${response.status}`);
      
      return result;
    } catch (err) {
      this.logger.error(`[FetchAgent:${this.id}] Fetch failed: ${err.message}`);
      throw err;
    }
  }
}

module.exports = { FetchAgent };
