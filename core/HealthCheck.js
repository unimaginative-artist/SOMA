/**
 * HealthCheck.js - Dependency Health Checking System
 *
 * Validates that all required services are running before SOMA starts
 * Provides detailed diagnostics and helpful error messages
 */

import http from 'http';
import { createClient } from 'redis';
import WebSocket from 'ws';

export class HealthCheckResult {
  constructor(service, status, message, details = {}) {
    this.service = service;
    this.status = status; // 'ok', 'warning', 'error'
    this.message = message;
    this.details = details;
    this.timestamp = Date.now();
  }

  get isHealthy() {
    return this.status === 'ok';
  }

  get isWarning() {
    return this.status === 'warning';
  }

  get isError() {
    return this.status === 'error';
  }
}

export class HealthChecker {
  constructor(config = {}) {
    this.config = {
      ollamaUrl: config.ollamaUrl || 'http://localhost:11434',
      redisUrl: config.redisUrl || 'redis://localhost:6379',
      memoryHubUrl: config.memoryHubUrl || 'ws://localhost:3001',
      timeout: config.timeout || 5000,
      ...config
    };

    this.results = new Map();
  }

  /**
   * Run all health checks
   */
  async checkAll() {
    console.log('🔍 Running SOMA health checks...\n');

    const checks = [
      this.checkOllama(),
      this.checkRedis(),
      this.checkMemoryHub()
    ];

    await Promise.all(checks);

    return this.getReport();
  }

  /**
   * Check if Ollama (Local LLM) is running
   */
  async checkOllama() {
    const serviceName = 'Ollama (Local LLM)';
    console.log(`⏳ Checking ${serviceName}...`);

    try {
      const response = await this._httpGet(this.config.ollamaUrl + '/api/tags', this.config.timeout);

      if (response.statusCode === 200) {
        const data = JSON.parse(response.body);
        const models = data.models || [];

        if (models.length === 0) {
          this.results.set('ollama', new HealthCheckResult(
            serviceName,
            'warning',
            'Ollama is running but no models are installed',
            {
              url: this.config.ollamaUrl,
              solution: 'Run: ollama pull llama3 (or your preferred model)'
            }
          ));
          console.log(`⚠️  ${serviceName}: Running but no models installed`);
        } else {
          this.results.set('ollama', new HealthCheckResult(
            serviceName,
            'ok',
            `Running with ${models.length} model(s)`,
            {
              url: this.config.ollamaUrl,
              models: models.map(m => m.name)
            }
          ));
          console.log(`✅ ${serviceName}: OK (${models.length} models available)`);
        }
      } else {
        throw new Error(`Unexpected status code: ${response.statusCode}`);
      }
    } catch (error) {
      this.results.set('ollama', new HealthCheckResult(
        serviceName,
        'error',
        'Not running or not accessible',
        {
          url: this.config.ollamaUrl,
          error: error.message,
          solution: [
            '1. Install Ollama: https://ollama.com/download',
            '2. Run: ollama serve',
            '3. Pull a model: ollama pull llama3'
          ].join('\n')
        }
      ));
      console.log(`❌ ${serviceName}: Not accessible`);
    }
  }

  /**
   * Check if Redis is running (for hot-tier memory caching)
   */
  async checkRedis() {
    const serviceName = 'Redis (Hot Tier Cache)';
    console.log(`⏳ Checking ${serviceName}...`);

    let client = null;

    try {
      client = createClient({ url: this.config.redisUrl, socket: { connectTimeout: this.config.timeout } });

      await client.connect();
      await client.ping();

      const info = await client.info('memory');
      const memoryMatch = info.match(/used_memory_human:(\S+)/);
      const memory = memoryMatch ? memoryMatch[1] : 'unknown';

      this.results.set('redis', new HealthCheckResult(
        serviceName,
        'ok',
        'Running and accessible',
        {
          url: this.config.redisUrl,
          memory: memory
        }
      ));
      console.log(`✅ ${serviceName}: OK (Memory: ${memory})`);

      await client.quit();
    } catch (error) {
      this.results.set('redis', new HealthCheckResult(
        serviceName,
        'warning',
        'Not running (will use degraded mode)',
        {
          url: this.config.redisUrl,
          error: error.message,
          impact: 'Hot-tier caching disabled, memory performance degraded',
          solution: [
            'Optional but recommended:',
            'Windows: Download from https://github.com/microsoftarchive/redis/releases',
            'Mac: brew install redis && brew services start redis',
            'Linux: sudo apt install redis-server && sudo systemctl start redis'
          ].join('\n')
        }
      ));
      console.log(`⚠️  ${serviceName}: Not running (degraded mode)`);

      if (client) {
        try {
          await client.quit();
        } catch (e) {
          // Ignore
        }
      }
    }
  }

  /**
   * Check if Memory Hub is running (for distributed memory)
   */
  async checkMemoryHub() {
    const serviceName = 'Memory Hub';
    console.log(`⏳ Checking ${serviceName}...`);

    try {
      const connected = await this._checkWebSocket(this.config.memoryHubUrl, this.config.timeout);

      if (connected) {
        this.results.set('memoryHub', new HealthCheckResult(
          serviceName,
          'ok',
          'Running and accessible',
          {
            url: this.config.memoryHubUrl
          }
        ));
        console.log(`✅ ${serviceName}: OK`);
      } else {
        throw new Error('Connection failed');
      }
    } catch (error) {
      this.results.set('memoryHub', new HealthCheckResult(
        serviceName,
        'warning',
        'Not running (cluster features disabled)',
        {
          url: this.config.memoryHubUrl,
          error: error.message,
          impact: 'Distributed memory coordination unavailable',
          solution: [
            'Optional (only needed for cluster mode):',
            'Run: node memory-hub.cjs',
            'Or disable cluster features in config'
          ].join('\n')
        }
      ));
      console.log(`⚠️  ${serviceName}: Not running (standalone mode)`);
    }
  }

  /**
   * Get comprehensive health report
   */
  getReport() {
    const report = {
      timestamp: Date.now(),
      overall: 'ok',
      services: {},
      criticalIssues: [],
      warnings: [],
      recommendations: []
    };

    for (const [key, result] of this.results) {
      report.services[key] = {
        status: result.status,
        message: result.message,
        details: result.details
      };

      if (result.isError) {
        report.overall = 'error';
        report.criticalIssues.push({
          service: result.service,
          message: result.message,
          solution: result.details.solution
        });
      } else if (result.isWarning) {
        if (report.overall === 'ok') {
          report.overall = 'warning';
        }
        report.warnings.push({
          service: result.service,
          message: result.message,
          impact: result.details.impact,
          solution: result.details.solution
        });
      }
    }

    // Add recommendations
    if (report.criticalIssues.length > 0) {
      report.recommendations.push('Fix critical issues before starting SOMA for full functionality');
    }

    if (report.warnings.length > 0) {
      report.recommendations.push('SOMA can run in degraded mode, but some features will be limited');
    }

    return report;
  }

  /**
   * Print formatted report to console
   */
  printReport(report) {
    console.log('\n' + '='.repeat(60));
    console.log('SOMA HEALTH CHECK REPORT');
    console.log('='.repeat(60));

    if (report.overall === 'ok') {
      console.log('✅ Overall Status: HEALTHY');
      console.log('All systems operational!');
    } else if (report.overall === 'warning') {
      console.log('⚠️  Overall Status: DEGRADED');
      console.log('System can operate with reduced functionality');
    } else {
      console.log('❌ Overall Status: CRITICAL');
      console.log('Critical services are offline');
    }

    console.log('\n' + '-'.repeat(60));
    console.log('Service Status:');
    console.log('-'.repeat(60));

    for (const [key, service] of Object.entries(report.services)) {
      const icon = service.status === 'ok' ? '✅' : service.status === 'warning' ? '⚠️ ' : '❌';
      console.log(`${icon} ${key}: ${service.message}`);
    }

    if (report.criticalIssues.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log('❌ CRITICAL ISSUES:');
      console.log('-'.repeat(60));
      report.criticalIssues.forEach((issue, i) => {
        console.log(`\n${i + 1}. ${issue.service}`);
        console.log(`   Problem: ${issue.message}`);
        console.log(`   Solution:\n   ${issue.solution.split('\n').join('\n   ')}`);
      });
    }

    if (report.warnings.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log('⚠️  WARNINGS:');
      console.log('-'.repeat(60));
      report.warnings.forEach((warning, i) => {
        console.log(`\n${i + 1}. ${warning.service}`);
        console.log(`   Issue: ${warning.message}`);
        console.log(`   Impact: ${warning.impact}`);
        console.log(`   Solution:\n   ${warning.solution.split('\n').join('\n   ')}`);
      });
    }

    if (report.recommendations.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log('💡 RECOMMENDATIONS:');
      console.log('-'.repeat(60));
      report.recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }

  // Helper methods

  _httpGet(url, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error('Connection timeout'));
      }, timeout);

      const req = http.get(url, (res) => {
        clearTimeout(timer);

        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  _checkWebSocket(url, timeout) {
    return new Promise((resolve) => {
      let ws;

      const timer = setTimeout(() => {
        if (ws) {
          try { ws.close(); } catch (e) {}
        }
        resolve(false);
      }, timeout);

      try {
        ws = new WebSocket(url);

        ws.on('open', () => {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        });

        ws.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }
}

export default HealthChecker;
