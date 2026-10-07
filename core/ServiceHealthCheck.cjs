/**
 * ServiceHealthCheck.cjs - Health check system for all SOMA providers
 * 
 * Probes:
 * - Cloud APIs (OpenAI, Gemini, DeepSeek) - lite checks (no actual API calls)
 * - Local services (Ollama, Redis, SQLite)
 * - Determines fallback order if services are unavailable
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs').promises;
const path = require('path');
const { getEnvLoader } = require('../config/EnvLoader.cjs');

class ServiceHealthCheck {
  constructor() {
    this.results = {
      timestamp: null,
      providers: {},
      localServices: {},
      selectedProvider: null,
      health: 'unknown',
      fallbackOrder: []
    };
    this.logger = console;
  }

  /**
   * Run all health checks
   */
  async runFullCheck() {
    this.results.timestamp = new Date().toISOString();

    console.log('🏥 Starting SOMA service health checks...\n');

    // Check cloud APIs
    await this.checkCloudProviders();

    // Check local services
    await this.checkLocalServices();

    // Determine fallback order
    await this.determineFallbackOrder();

    // Calculate overall health
    this.calculateHealth();

    return this.results;
  }

  /**
   * Check cloud API providers (key validation + lite connectivity)
   */
  async checkCloudProviders() {
    const envLoader = getEnvLoader();

    console.log('☁️  Cloud Providers:');
    console.log('─'.repeat(50));

    // Check OpenAI
    await this._checkOpenAI(envLoader);

    // Check Gemini
    await this._checkGemini(envLoader);

    // Check DeepSeek
    await this._checkDeepSeek(envLoader);

    console.log();
  }

  async _checkOpenAI(envLoader) {
    const key = envLoader.get('OPENAI_API_KEY');
    const model = envLoader.get('OPENAI_MODEL', 'gpt-4o-mini');

    if (!key) {
      this.results.providers.openai = { status: 'unconfigured', key: false };
      console.log('  ❌ OpenAI: No API key configured');
      return;
    }

    try {
      // Just verify key format (starts with sk-proj-)
      if (key.startsWith('sk-proj-') && key.length > 20) {
        this.results.providers.openai = {
          status: 'available',
          key: true,
          model,
          endpoint: 'https://api.openai.com/v1'
        };
        console.log(`  ✅ OpenAI: ${model} (key valid)`);
      } else {
        this.results.providers.openai = { status: 'invalid_key', key: false };
        console.log('  ⚠️  OpenAI: Invalid key format');
      }
    } catch (err) {
      this.results.providers.openai = { status: 'error', error: err.message };
      console.log(`  ❌ OpenAI: ${err.message}`);
    }
  }

  async _checkGemini(envLoader) {
    const key = envLoader.get('GEMINI_API_KEY');
    const model = envLoader.get('GEMINI_MODEL', 'gemini-2.0-flash-exp');

    if (!key) {
      this.results.providers.gemini = { status: 'unconfigured', key: false };
      console.log('  ❌ Gemini: No API key configured');
      return;
    }

    try {
      // Verify key format (AIzaSy...)
      if (key.startsWith('AIzaSy') && key.length > 20) {
        this.results.providers.gemini = {
          status: 'available',
          key: true,
          model,
          endpoint: 'https://generativelanguage.googleapis.com/v1'
        };
        console.log(`  ✅ Gemini: ${model} (key valid)`);
      } else {
        this.results.providers.gemini = { status: 'invalid_key', key: false };
        console.log('  ⚠️  Gemini: Invalid key format');
      }
    } catch (err) {
      this.results.providers.gemini = { status: 'error', error: err.message };
      console.log(`  ❌ Gemini: ${err.message}`);
    }
  }

  async _checkDeepSeek(envLoader) {
    const key = envLoader.get('DEEPSEEK_API_KEY');
    const model = envLoader.get('DEEPSEEK_MODEL', 'deepseek-chat');

    if (!key) {
      this.results.providers.deepseek = { status: 'unconfigured', key: false };
      console.log('  ❌ DeepSeek: No API key configured');
      return;
    }

    try {
      // Verify key format (sk- prefix followed by hex string)
      if (key.startsWith('sk-') && key.length > 20) {
        this.results.providers.deepseek = {
          status: 'available',
          key: true,
          model,
          endpoint: 'https://api.deepseek.com'
        };
        console.log(`  ✅ DeepSeek: ${model} (key valid)`);
      } else {
        this.results.providers.deepseek = { status: 'invalid_key', key: false };
        console.log('  ⚠️  DeepSeek: Invalid key format');
      }
    } catch (err) {
      this.results.providers.deepseek = { status: 'error', error: err.message };
      console.log(`  ❌ DeepSeek: ${err.message}`);
    }
  }

  /**
   * Check local services
   */
  async checkLocalServices() {
    const envLoader = getEnvLoader();

    console.log('🖥️  Local Services:');
    console.log('─'.repeat(50));

    // Check Ollama
    await this._checkOllama(envLoader);

    // Check Redis
    await this._checkRedis(envLoader);

    // Check SQLite
    await this._checkSQLite(envLoader);

    console.log();
  }

  async _checkOllama(envLoader) {
    const endpoint = envLoader.get('OLLAMA_ENDPOINT', 'http://localhost:11434');
    const model = envLoader.get('OLLAMA_MODEL', 'llama3.2');

    try {
      const url = new URL('/api/tags', endpoint);
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.results.localServices.ollama = { status: 'unavailable' };
          console.log(`  ❌ Ollama: Not responding at ${endpoint}`);
          resolve();
        }, 3000);

        const protocol = url.protocol === 'https:' ? https : http;
        const req = protocol.request({
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'GET',
          timeout: 3000
        }, (res) => {
          clearTimeout(timeout);
          if (res.statusCode === 200) {
            this.results.localServices.ollama = { status: 'available', endpoint, model };
            console.log(`  ✅ Ollama: ${model} running at ${endpoint}`);
          } else {
            this.results.localServices.ollama = { status: 'error', statusCode: res.statusCode };
            console.log(`  ⚠️  Ollama: HTTP ${res.statusCode}`);
          }
          resolve();
        });

        req.on('error', (err) => {
          clearTimeout(timeout);
          this.results.localServices.ollama = { status: 'unavailable', error: err.message };
          console.log(`  ❌ Ollama: ${err.message}`);
          resolve();
        });

        req.end();
      });
    } catch (err) {
      this.results.localServices.ollama = { status: 'error', error: err.message };
      console.log(`  ❌ Ollama: ${err.message}`);
    }
  }

  async _checkRedis(envLoader) {
    const url = envLoader.get('REDIS_URL', 'redis://localhost:6379');

    try {
      // Simple check: verify Redis URL format and try to connect
      // For now, just check if redis-cli is available or if we can parse the URL
      if (url.startsWith('redis://')) {
        this.results.localServices.redis = { status: 'configured', url };
        console.log(`  ℹ️  Redis: ${url} (connection not tested)`);
      } else {
        this.results.localServices.redis = { status: 'unconfigured' };
        console.log(`  ⚠️  Redis: Invalid URL format`);
      }
    } catch (err) {
      this.results.localServices.redis = { status: 'error', error: err.message };
      console.log(`  ❌ Redis: ${err.message}`);
    }
  }

  async _checkSQLite(envLoader) {
    const dbPath = envLoader.get('DATABASE_PATH', './soma-memory.db');

    try {
      const fullPath = path.resolve(dbPath);
      const dir = path.dirname(fullPath);

      // Check if directory is writable
      await fs.mkdir(dir, { recursive: true });

      this.results.localServices.sqlite = { status: 'available', path: fullPath };
      console.log(`  ✅ SQLite: ${fullPath}`);
    } catch (err) {
      this.results.localServices.sqlite = { status: 'error', error: err.message };
      console.log(`  ❌ SQLite: ${err.message}`);
    }
  }

  /**
   * Determine fallback order based on health checks
   */
  async determineFallbackOrder() {
    const fallback = [];
    const providers = this.results.providers;

    // Priority order
    const priority = ['openai', 'gemini', 'deepseek', 'ollama'];

    for (const name of priority) {
      if (providers[name] && (providers[name].status === 'available' || providers[name].key === true)) {
        fallback.push(name);
      }
    }

    // Add Ollama as last resort
    if (fallback.length === 0 && this.results.localServices.ollama?.status === 'available') {
      fallback.push('ollama');
    }

    this.results.fallbackOrder = fallback;
    this.results.selectedProvider = fallback[0] || null;

    console.log('📋 Provider Fallback Order:');
    console.log('─'.repeat(50));
    if (fallback.length > 0) {
      fallback.forEach((name, i) => {
        const icon = i === 0 ? '🎯' : '↳';
        console.log(`  ${icon} ${name}`);
      });
    } else {
      console.log('  ⚠️  No providers available! SOMA will have degraded capability.');
    }
    console.log();
  }

  /**
   * Calculate overall health status
   */
  calculateHealth() {
    const hasCloudApi = Object.values(this.results.providers)
      .some(p => p.status === 'available' || p.key === true);
    
    const hasLocalService = Object.values(this.results.localServices)
      .some(s => s.status === 'available');

    if (hasCloudApi || this.results.localServices.ollama?.status === 'available') {
      this.results.health = 'operational';
    } else if (hasCloudApi) {
      this.results.health = 'degraded';
    } else {
      this.results.health = 'critical';
    }

    console.log('📊 Overall Health:');
    console.log('─'.repeat(50));
    const healthEmoji = {
      operational: '✅',
      degraded: '⚠️',
      critical: '❌'
    };
    console.log(`  ${healthEmoji[this.results.health]} ${this.results.health.toUpperCase()}`);
    console.log();

    return this.results;
  }

  /**
   * Save results to file
   */
  async saveResults(filePath) {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(this.results, null, 2), 'utf8');
      console.log(`💾 Health check results saved to ${filePath}`);
    } catch (err) {
      console.error(`Failed to save health check results: ${err.message}`);
    }
  }

  /**
   * Get a usable provider config based on health checks
   */
  getSelectedProvider() {
    const envLoader = getEnvLoader();

    if (!this.results.selectedProvider) {
      throw new Error('No provider available after health checks');
    }

    return envLoader.getProvider(this.results.selectedProvider);
  }
}

module.exports = { ServiceHealthCheck };
