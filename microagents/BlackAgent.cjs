// BlackAgent.cjs - System Health Monitor
// Ghost in the Shell inspired: Heavy ops, system monitoring, predictive failure detection
// "Someone's gotta watch the vitals while you're out there playing hero."

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class BlackAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ 
      ...config, 
      type: 'system-health',
      ttl: Infinity,
      idleTimeout: Infinity 
    });
    
    this.name = 'Black';
    this.personality = 'tactical-ops';
    
    // Monitoring configuration
    this.monitoringInterval = config.monitoringInterval || 30000; // 30 seconds
    this.alertThresholds = {
      cpuLoad: config.cpuLoadThreshold || 0.85,        // 85% CPU
      memoryUsed: config.memoryThreshold || 0.90,      // 90% RAM
      diskUsed: config.diskThreshold || 0.85,          // 85% disk
      tempWarning: config.tempWarning || 75,           // 75°C
      tempCritical: config.tempCritical || 85          // 85°C
    };
    
    // Monitoring state
    this.currentMetrics = {
      cpu: { load: 0, cores: os.cpus().length, temps: [] },
      memory: { total: 0, free: 0, used: 0, usedPercent: 0 },
      disk: { total: 0, free: 0, used: 0, usedPercent: 0 },
      uptime: 0,
      platform: os.platform()
    };
    
    // Cache disk metrics (slow to fetch, changes infrequently)
    this.diskMetricsCache = null;
    this.diskMetricsCacheTime = 0;
    this.diskMetricsCacheDuration = config.diskCacheDuration || 30000; // 30 seconds
    
    // Health history for trend analysis
    this.metricsHistory = [];
    this.maxHistoryLength = config.maxHistoryLength || 100;
    
    // Alert state
    this.alerts = [];
    this.lastAlertTime = {};
    this.alertCooldown = config.alertCooldown || 60000; // 1 minute between duplicate alerts
    
    // Background monitoring
    this.monitoringActive = false;
    this.monitoringTimer = null;
    
    this.logger.info(`[Black] 💪 System ops ready. Watching ${os.cpus().length} cores, ${this.formatBytes(os.totalmem())} RAM`);
  }
  
  async initialize() {
    await super.initialize();
    
    // Start background monitoring
    this.startMonitoring();
    
    // Defer initial system scan to avoid blocking initialization
    // (disk metrics can be slow on some systems)
    setTimeout(() => {
      this.scanSystem().catch(err => {
        this.logger.warn(`[Black] Initial scan failed: ${err.message}`);
      });
    }, 100);
    
    this.logger.info(`[Black] Monitoring active. Scan interval: ${this.monitoringInterval}ms`);
  }
  
  async execute(task) {
    try {
      // Validate task
      if (!task || typeof task !== 'object') {
        throw new Error('Invalid task: expected non-null object');
      }

      const { type, payload } = task;

      switch (type) {
        case 'scan':
          return await this.scanSystem();

        case 'health-check':
          return await this.healthCheck();

        case 'get-metrics':
          return this.getCurrentMetrics();

        case 'get-alerts':
          return this.getActiveAlerts();

        case 'predict-failure':
          return await this.predictFailure();

        case 'optimize':
          return await this.optimizeSystem(payload);

        case 'set-threshold':
          return this.setThreshold(payload.metric, payload.value);

        default:
          throw new Error(`Unknown task type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`[Black] Execute failed: ${error.message}`);
      return { success: false, error: error.message, stack: error.stack };
    }
  }
  
  // ==================== SYSTEM MONITORING ====================
  
  startMonitoring() {
    if (this.monitoringActive) return;
    
    this.monitoringActive = true;
    this.monitoringTimer = setInterval(async () => {
      try {
        await this.scanSystem();
      } catch (err) {
        this.logger.error(`[Black] Monitoring error: ${err.message}`);
      }
    }, this.monitoringInterval);
    
    this.logger.info('[Black] Background monitoring started');
  }
  
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    this.monitoringActive = false;
    this.logger.info('[Black] Background monitoring stopped');
  }
  
  async scanSystem() {
    const metrics = {
      timestamp: Date.now(),
      cpu: await this.getCPUMetrics(),
      memory: this.getMemoryMetrics(),
      disk: await this.getDiskMetrics(),
      uptime: os.uptime(),
      loadAverage: os.loadavg()
    };
    
    this.currentMetrics = metrics;
    
    // Add to history
    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > this.maxHistoryLength) {
      this.metricsHistory.shift();
    }
    
    // Check thresholds and generate alerts
    await this.checkThresholds(metrics);
    
    this.emit('metrics', metrics);
    
    return { success: true, metrics };
  }
  
  async getCPUMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Calculate current load (1-minute average normalized by core count)
    const load = loadAvg[0] / cpus.length;
    
    return {
      cores: cpus.length,
      model: cpus[0].model,
      load: Math.min(load, 1.0),  // Cap at 100%
      loadAvg1: loadAvg[0],
      loadAvg5: loadAvg[1],
      loadAvg15: loadAvg[2]
    };
  }
  
  getMemoryMetrics() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const usedPercent = used / total;
    
    return {
      total,
      free,
      used,
      usedPercent,
      totalFormatted: this.formatBytes(total),
      freeFormatted: this.formatBytes(free),
      usedFormatted: this.formatBytes(used)
    };
  }
  
  async getDiskMetrics() {
    // Use cache if fresh (disk metrics are slow to fetch, change infrequently)
    const now = Date.now();
    if (this.diskMetricsCache && (now - this.diskMetricsCacheTime) < this.diskMetricsCacheDuration) {
      return this.diskMetricsCache;
    }
    
    // Platform-specific disk usage
    try {
      let metrics;
      if (os.platform() === 'win32') {
        metrics = await this.getDiskMetricsWindows();
      } else {
        metrics = await this.getDiskMetricsUnix();
      }
      
      // Cache the result
      this.diskMetricsCache = metrics;
      this.diskMetricsCacheTime = now;
      
      return metrics;
    } catch (err) {
      this.logger.warn(`[Black] Disk metrics unavailable: ${err.message}`);
      const fallback = { total: 0, free: 0, used: 0, usedPercent: 0 };
      
      // Cache fallback too
      this.diskMetricsCache = fallback;
      this.diskMetricsCacheTime = now;
      
      return fallback;
    }
  }
  
  async getDiskMetricsWindows() {
    try {
      const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption');
      const lines = stdout.trim().split('\n').slice(1); // Skip header
      
      let total = 0;
      let free = 0;
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const freeSpace = parseInt(parts[1]) || 0;
          const size = parseInt(parts[2]) || 0;
          total += size;
          free += freeSpace;
        }
      }
      
      const used = total - free;
      const usedPercent = total > 0 ? used / total : 0;
      
      return { total, free, used, usedPercent };
    } catch (err) {
      return { total: 0, free: 0, used: 0, usedPercent: 0 };
    }
  }
  
  async getDiskMetricsUnix() {
    try {
      const { stdout } = await execAsync('df -k / | tail -1');
      const parts = stdout.trim().split(/\s+/);
      
      const total = parseInt(parts[1]) * 1024;  // Convert KB to bytes
      const used = parseInt(parts[2]) * 1024;
      const free = parseInt(parts[3]) * 1024;
      const usedPercent = used / total;
      
      return { total, free, used, usedPercent };
    } catch (err) {
      return { total: 0, free: 0, used: 0, usedPercent: 0 };
    }
  }
  
  // ==================== HEALTH CHECKS & ALERTS ====================
  
  async checkThresholds(metrics) {
    const newAlerts = [];
    
    // CPU check
    if (metrics.cpu.load > this.alertThresholds.cpuLoad) {
      newAlerts.push({
        severity: 'warning',
        type: 'cpu',
        message: `High CPU load: ${(metrics.cpu.load * 100).toFixed(1)}%`,
        value: metrics.cpu.load,
        threshold: this.alertThresholds.cpuLoad,
        timestamp: Date.now()
      });
    }
    
    // Memory check
    if (metrics.memory.usedPercent > this.alertThresholds.memoryUsed) {
      newAlerts.push({
        severity: metrics.memory.usedPercent > 0.95 ? 'critical' : 'warning',
        type: 'memory',
        message: `High memory usage: ${(metrics.memory.usedPercent * 100).toFixed(1)}%`,
        value: metrics.memory.usedPercent,
        threshold: this.alertThresholds.memoryUsed,
        timestamp: Date.now()
      });
    }
    
    // Disk check
    if (metrics.disk.usedPercent > this.alertThresholds.diskUsed) {
      newAlerts.push({
        severity: metrics.disk.usedPercent > 0.95 ? 'critical' : 'warning',
        type: 'disk',
        message: `High disk usage: ${(metrics.disk.usedPercent * 100).toFixed(1)}%`,
        value: metrics.disk.usedPercent,
        threshold: this.alertThresholds.diskUsed,
        timestamp: Date.now()
      });
    }
    
    // Process new alerts (with cooldown to prevent spam)
    for (const alert of newAlerts) {
      const alertKey = `${alert.type}_${alert.severity}`;
      const lastTime = this.lastAlertTime[alertKey] || 0;
      
      if (Date.now() - lastTime > this.alertCooldown) {
        this.alerts.push(alert);
        this.lastAlertTime[alertKey] = Date.now();
        this.emit('alert', alert);
        this.logger.warn(`[Black] 🚨 ${alert.severity.toUpperCase()}: ${alert.message}`);
      }
    }
    
    // Prune old alerts (keep last 50)
    if (this.alerts.length > 50) {
      this.alerts = this.alerts.slice(-50);
    }
  }
  
  async healthCheck() {
    const metrics = this.currentMetrics;
    
    const health = {
      status: 'healthy',
      score: 100,
      issues: [],
      timestamp: Date.now()
    };
    
    // CPU health
    if (metrics.cpu.load > this.alertThresholds.cpuLoad) {
      health.score -= 20;
      health.issues.push('High CPU load');
      if (metrics.cpu.load > 0.95) health.status = 'critical';
      else health.status = 'degraded';
    }
    
    // Memory health
    if (metrics.memory.usedPercent > this.alertThresholds.memoryUsed) {
      health.score -= 30;
      health.issues.push('High memory usage');
      if (metrics.memory.usedPercent > 0.95) health.status = 'critical';
      else if (health.status === 'healthy') health.status = 'degraded';
    }
    
    // Disk health
    if (metrics.disk.usedPercent > this.alertThresholds.diskUsed) {
      health.score -= 20;
      health.issues.push('High disk usage');
      if (metrics.disk.usedPercent > 0.95) health.status = 'critical';
      else if (health.status === 'healthy') health.status = 'degraded';
    }
    
    health.score = Math.max(health.score, 0);
    
    return { success: true, health };
  }
  
  // ==================== PREDICTIVE ANALYSIS ====================
  
  async predictFailure() {
    if (this.metricsHistory.length < 10) {
      return {
        success: true,
        prediction: 'insufficient_data',
        message: 'Need at least 10 data points for prediction'
      };
    }
    
    const predictions = [];
    
    // Analyze trends
    const cpuTrend = this.analyzeTrend('cpu.load');
    const memoryTrend = this.analyzeTrend('memory.usedPercent');
    const diskTrend = this.analyzeTrend('disk.usedPercent');
    
    if (cpuTrend.increasing && cpuTrend.rate > 0.01) {
      const timeToLimit = (this.alertThresholds.cpuLoad - cpuTrend.current) / cpuTrend.rate;
      if (timeToLimit > 0 && timeToLimit < 3600) { // Within 1 hour
        predictions.push({
          type: 'cpu',
          severity: 'warning',
          message: `CPU load increasing at ${(cpuTrend.rate * 100).toFixed(2)}%/scan`,
          estimatedTimeToThreshold: Math.round(timeToLimit * this.monitoringInterval / 1000) + ' seconds'
        });
      }
    }
    
    if (memoryTrend.increasing && memoryTrend.rate > 0.005) {
      const timeToLimit = (this.alertThresholds.memoryUsed - memoryTrend.current) / memoryTrend.rate;
      if (timeToLimit > 0 && timeToLimit < 3600) {
        predictions.push({
          type: 'memory',
          severity: 'warning',
          message: `Memory usage increasing at ${(memoryTrend.rate * 100).toFixed(2)}%/scan`,
          estimatedTimeToThreshold: Math.round(timeToLimit * this.monitoringInterval / 1000) + ' seconds'
        });
      }
    }
    
    return {
      success: true,
      prediction: predictions.length > 0 ? 'potential_issues' : 'stable',
      predictions,
      trends: { cpu: cpuTrend, memory: memoryTrend, disk: diskTrend }
    };
  }
  
  analyzeTrend(metricPath) {
    const values = this.metricsHistory.map(m => this.getNestedValue(m, metricPath));
    
    if (values.length < 2) {
      return { increasing: false, rate: 0, current: values[0] || 0 };
    }
    
    // Simple linear regression
    const n = values.length;
    const xSum = (n * (n - 1)) / 2;  // Sum of 0..n-1
    const ySum = values.reduce((a, b) => a + b, 0);
    const xySum = values.reduce((sum, y, x) => sum + x * y, 0);
    const x2Sum = (n * (n - 1) * (2 * n - 1)) / 6;  // Sum of squares
    
    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum);
    const current = values[values.length - 1];
    
    return {
      increasing: slope > 0,
      rate: slope,
      current,
      samples: n
    };
  }
  
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj) || 0;
  }
  
  // ==================== OPTIMIZATION ====================
  
  async optimizeSystem(options = {}) {
    const optimizations = [];
    
    // Suggest optimizations based on current state
    if (this.currentMetrics.memory.usedPercent > 0.80) {
      optimizations.push({
        type: 'memory',
        action: 'garbage_collection',
        priority: 'high',
        message: 'High memory usage detected - suggest running garbage collection'
      });
      
      // Trigger Node.js GC if available
      if (global.gc) {
        global.gc();
        optimizations[optimizations.length - 1].executed = true;
      }
    }
    
    if (this.currentMetrics.cpu.load > 0.80) {
      optimizations.push({
        type: 'cpu',
        action: 'reduce_load',
        priority: 'medium',
        message: 'High CPU load - suggest reducing concurrent operations'
      });
    }
    
    return {
      success: true,
      optimizations,
      executed: optimizations.filter(o => o.executed).length
    };
  }
  
  // ==================== UTILITIES ====================
  
  getCurrentMetrics() {
    return {
      success: true,
      metrics: this.currentMetrics,
      timestamp: Date.now()
    };
  }
  
  getActiveAlerts() {
    const recentAlerts = this.alerts.filter(a => Date.now() - a.timestamp < 300000); // Last 5 minutes
    return {
      success: true,
      alerts: recentAlerts,
      count: recentAlerts.length
    };
  }
  
  setThreshold(metric, value) {
    if (this.alertThresholds.hasOwnProperty(metric)) {
      this.alertThresholds[metric] = value;
      this.logger.info(`[Black] Threshold updated: ${metric} = ${value}`);
      return { success: true, metric, value };
    }
    throw new Error(`Unknown threshold metric: ${metric}`);
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  async terminate(reason = 'manual') {
    this.stopMonitoring();
    return super.terminate(reason);
  }
  
  getStatus() {
    const baseStatus = super.getStatus();
    return {
      ...baseStatus,
      monitoring: this.monitoringActive,
      currentMetrics: this.currentMetrics,
      activeAlerts: this.alerts.filter(a => Date.now() - a.timestamp < 60000).length,
      historySize: this.metricsHistory.length
    };
  }
}

module.exports = BlackAgent;
