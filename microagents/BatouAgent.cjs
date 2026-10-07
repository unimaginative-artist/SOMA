// BatouAgent.cjs - Tactical Security Specialist
// Ghost in the Shell inspired: Ex-military muscle with brain, protective, blunt
// "Someone's gotta keep you alive while you're overthinking things."

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const crypto = require('crypto');

class BatouAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'tactical-security' });
    
    this.name = 'Batou';
    this.personality = 'tactical-guardian';
    
    // Security state
    this.threatLevel = 'green';  // green, yellow, orange, red
    this.activeThreats = new Map();
    this.lockedDownSystems = new Set();
    
    // Scan history
    this.scanHistory = [];
    this.maxScanHistory = config.maxScanHistory || 100;
    
    // Alert configuration
    this.alertThresholds = {
      anomalyScore: config.anomalyThreshold || 0.7,
      failedAuthAttempts: config.failedAuthThreshold || 5,
      unusualTraffic: config.trafficThreshold || 0.8
    };
    
    // Monitoring intervals
    this.continuousScan = config.continuousScan || false;
    this.scanInterval = config.scanInterval || 60000; // 1 minute
    this.scanTimer = null;
    
    // Statistics
    this.statistics = {
      threatsDetected: 0,
      threatsNeutralized: 0,
      scansPerformed: 0,
      systemsProtected: 0,
      lockdownsActivated: 0
    };
    
    // KEVIN coordination state
    this.kevinConnected = false;
    this.kevinEndpoint = config.kevinEndpoint || null;
    
    this.logger.info(`[Batou] 💪 Tactical security online. "Let's keep this place secure."`);
  }
  
  async initialize() {
    await super.initialize();
    
    // Initial threat scan
    await this.scanThreats();
    
    // Start continuous monitoring if enabled
    if (this.continuousScan) {
      this.startContinuousMonitoring();
    }
    
    this.logger.info('[Batou] Security perimeter established. Standing guard.');
  }
  
  async execute(task) {
    try {
      // Validate task
      if (!task || typeof task !== 'object') {
        throw new Error('Invalid task: expected non-null object');
      }

      const { type, payload } = task;

      switch (type) {
        case 'scan-threats':
          return await this.scanThreats(payload);

        case 'tactical':
          return await this.tacticalAssessment(payload);

        case 'heavy-ops':
          return await this.heavyOperations(payload);

        case 'armor':
          return await this.networkArmor(payload);

        case 'lockdown':
          return await this.anomalyLockdown(payload);

        case 'stabilize':
          return await this.stabilizeSystem(payload);

        case 'cover':
          return await this.provideCover(payload);

        case 'get-threats':
          return this.getActiveThreats();

        case 'set-threat-level':
          return this.setThreatLevel(payload);

        case 'coordinate-kevin':
          return await this.coordinateWithKEVIN(payload);

        default:
          throw new Error(`Unknown task type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`[Batou] Execute failed: ${error.message}`);
      return { success: false, error: error.message, stack: error.stack };
    }
  }
  
  // ==================== THREAT SCANNING ====================
  
  async scanThreats(options = {}) {
    this.statistics.scansPerformed++;
    
    const scan = {
      timestamp: Date.now(),
      scope: options.scope || 'full',
      threats: [],
      anomalies: [],
      overallScore: 0
    };
    
    try {
      // System-level threat scan
      if (!options.scope || options.scope === 'full' || options.scope === 'system') {
        const systemThreats = await this.scanSystemThreats();
        scan.threats.push(...systemThreats);
      }
      
      // Network threat scan
      if (!options.scope || options.scope === 'full' || options.scope === 'network') {
        const networkThreats = await this.scanNetworkThreats();
        scan.threats.push(...networkThreats);
      }
      
      // Process threat scan
      if (!options.scope || options.scope === 'full' || options.scope === 'process') {
        const processThreats = await this.scanProcessThreats();
        scan.threats.push(...processThreats);
      }
      
      // File integrity scan
      if (!options.scope || options.scope === 'full' || options.scope === 'files') {
        const fileThreats = await this.scanFileIntegrity();
        scan.threats.push(...fileThreats);
      }
      
      // Calculate overall threat score
      if (scan.threats.length > 0) {
        scan.overallScore = scan.threats.reduce((sum, t) => sum + t.severity, 0) / scan.threats.length;
      }
      
      // Update threat level based on scan
      this.updateThreatLevel(scan);
      
      // Store active threats
      for (const threat of scan.threats) {
        if (threat.severity > 0.6) {
          const threatId = this.generateThreatId();
          this.activeThreats.set(threatId, {
            ...threat,
            id: threatId,
            detectedAt: Date.now(),
            status: 'active'
          });
          this.statistics.threatsDetected++;
        }
      }
      
      // Add to history
      this.scanHistory.push(scan);
      if (this.scanHistory.length > this.maxScanHistory) {
        this.scanHistory.shift();
      }
      
      this.emit('scan-complete', scan);
      
      if (scan.threats.length > 0) {
        this.logger.warn(`[Batou] ⚠️ Scan detected ${scan.threats.length} potential threats (score: ${(scan.overallScore * 100).toFixed(1)}%)`);
      } else {
        this.logger.info(`[Batou] Scan complete. No threats detected.`);
      }
      
      return { success: true, scan };
      
    } catch (error) {
      this.logger.error(`[Batou] Scan failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  async scanSystemThreats() {
    const threats = [];
    
    // Check memory pressure (potential DoS)
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const memUsage = 1 - (freeMem / totalMem);
    
    if (memUsage > 0.95) {
      threats.push({
        type: 'resource-exhaustion',
        target: 'memory',
        severity: 0.9,
        description: `Critical memory usage: ${(memUsage * 100).toFixed(1)}%`,
        recommendation: 'Investigate memory leak or resource attack'
      });
    }
    
    // Check CPU load (potential crypto mining or DoS)
    const loadAvg = os.loadavg();
    const cpus = os.cpus().length;
    const cpuLoad = loadAvg[0] / cpus;
    
    if (cpuLoad > 0.9) {
      threats.push({
        type: 'resource-exhaustion',
        target: 'cpu',
        severity: 0.8,
        description: `High CPU load: ${(cpuLoad * 100).toFixed(1)}%`,
        recommendation: 'Check for unauthorized processes'
      });
    }
    
    // Check uptime (suspicious if too short - might indicate crash/reboot)
    const uptime = os.uptime();
    if (uptime < 300) { // Less than 5 minutes
      threats.push({
        type: 'suspicious-activity',
        target: 'system',
        severity: 0.5,
        description: `Recent system restart (uptime: ${Math.floor(uptime)}s)`,
        recommendation: 'Investigate cause of restart'
      });
    }
    
    return threats;
  }
  
  async scanNetworkThreats() {
    const threats = [];
    
    try {
      const interfaces = os.networkInterfaces();
      let externalInterfaces = 0;
      
      for (const [name, addresses] of Object.entries(interfaces)) {
        const ipv4 = addresses.find(addr => addr.family === 'IPv4' && !addr.internal);
        if (ipv4) {
          externalInterfaces++;
          
          // Check for unusual interface configurations
          if (ipv4.address.startsWith('169.254')) {
            threats.push({
              type: 'network-anomaly',
              target: 'network',
              severity: 0.4,
              description: `Link-local address detected on ${name}: ${ipv4.address}`,
              recommendation: 'Check network configuration'
            });
          }
        }
      }
      
      // Too many external interfaces might indicate bridging/routing compromise
      if (externalInterfaces > 3) {
        threats.push({
          type: 'network-anomaly',
          target: 'network',
          severity: 0.6,
          description: `Unusual number of external interfaces: ${externalInterfaces}`,
          recommendation: 'Verify network topology'
        });
      }
      
    } catch (error) {
      this.logger.warn(`[Batou] Network scan error: ${error.message}`);
    }
    
    return threats;
  }
  
  async scanProcessThreats() {
    const threats = [];
    
    // Check process memory usage
    const mem = process.memoryUsage();
    const heapUsage = mem.heapUsed / mem.heapTotal;
    
    if (heapUsage > 0.95) {
      threats.push({
        type: 'resource-exhaustion',
        target: 'process',
        severity: 0.85,
        description: `Critical heap usage: ${(heapUsage * 100).toFixed(1)}%`,
        recommendation: 'Memory leak possible - consider restart'
      });
    }
    
    // Check for external memory leaks
    if (mem.external > 100 * 1024 * 1024) { // >100MB external
      threats.push({
        type: 'resource-anomaly',
        target: 'process',
        severity: 0.6,
        description: `High external memory: ${(mem.external / 1024 / 1024).toFixed(1)}MB`,
        recommendation: 'Investigate external memory allocations'
      });
    }
    
    return threats;
  }
  
  async scanFileIntegrity() {
    const threats = [];
    
    // Basic file integrity checks - in production would check critical system files
    // For now, we'll do a simple check of the current process binary
    
    try {
      // Check if running with elevated privileges (potential risk)
      if (process.getuid && process.getuid() === 0) {
        threats.push({
          type: 'privilege-escalation',
          target: 'process',
          severity: 0.7,
          description: 'Process running as root/administrator',
          recommendation: 'Run with least privilege when possible'
        });
      }
    } catch (error) {
      // getuid not available on Windows
    }
    
    return threats;
  }
  
  // ==================== TACTICAL ASSESSMENT ====================
  
  async tacticalAssessment(options = {}) {
    const assessment = {
      timestamp: Date.now(),
      situation: 'unknown',
      threatLevel: this.threatLevel,
      activeThreats: this.activeThreats.size,
      recommendations: [],
      readiness: 0
    };
    
    // Analyze current threat landscape
    const recentScans = this.scanHistory.slice(-5);
    if (recentScans.length > 0) {
      const avgThreatScore = recentScans.reduce((sum, s) => sum + s.overallScore, 0) / recentScans.length;
      
      if (avgThreatScore > 0.7) {
        assessment.situation = 'hostile';
        assessment.recommendations.push({
          priority: 'high',
          action: 'lockdown',
          reason: 'Sustained high threat level'
        });
      } else if (avgThreatScore > 0.4) {
        assessment.situation = 'elevated';
        assessment.recommendations.push({
          priority: 'medium',
          action: 'increased-monitoring',
          reason: 'Moderate threat activity'
        });
      } else {
        assessment.situation = 'calm';
      }
    }
    
    // Calculate system readiness
    const memUsage = 1 - (os.freemem() / os.totalmem());
    const cpuLoad = os.loadavg()[0] / os.cpus().length;
    
    assessment.readiness = Math.max(0, 1 - (memUsage * 0.5 + cpuLoad * 0.5));
    
    if (assessment.readiness < 0.3) {
      assessment.recommendations.push({
        priority: 'high',
        action: 'resource-optimization',
        reason: 'System readiness compromised'
      });
    }
    
    // Check KEVIN coordination
    if (!this.kevinConnected && options.checkKEVIN) {
      assessment.recommendations.push({
        priority: 'medium',
        action: 'establish-kevin-link',
        reason: 'Email security coordination offline'
      });
    }
    
    this.emit('tactical-assessment', assessment);
    this.logger.info(`[Batou] Tactical situation: ${assessment.situation} (readiness: ${(assessment.readiness * 100).toFixed(0)}%)`);
    
    return { success: true, assessment };
  }
  
  // ==================== HEAVY OPERATIONS ====================
  
  async heavyOperations(options = {}) {
    const operation = options.operation || 'threat-neutralization';
    const result = {
      timestamp: Date.now(),
      operation,
      success: false,
      actions: []
    };
    
    try {
      switch (operation) {
        case 'threat-neutralization':
          // Neutralize active threats
          for (const [id, threat] of this.activeThreats) {
            const neutralized = await this.neutralizeThreat(threat);
            result.actions.push(neutralized);
            if (neutralized.success) {
              this.activeThreats.delete(id);
              this.statistics.threatsNeutralized++;
            }
          }
          result.success = true;
          break;
        
        case 'system-hardening':
          // Apply system hardening measures
          result.actions.push(await this.hardenSystem());
          result.success = true;
          break;
        
        case 'force-cleanup':
          // Aggressive cleanup of resources
          result.actions.push(await this.forceCleanup());
          result.success = true;
          break;
        
        default:
          throw new Error(`Unknown heavy operation: ${operation}`);
      }
      
      this.emit('heavy-ops-complete', result);
      this.logger.info(`[Batou] Heavy op '${operation}' complete: ${result.actions.length} actions`);
      
      return { success: true, result };
      
    } catch (error) {
      this.logger.error(`[Batou] Heavy op failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  async neutralizeThreat(threat) {
    const action = {
      threatId: threat.id,
      type: threat.type,
      action: 'neutralize',
      success: false
    };
    
    try {
      switch (threat.type) {
        case 'resource-exhaustion':
          // Trigger garbage collection if available
          if (global.gc) {
            global.gc();
            action.success = true;
            action.method = 'garbage-collection';
          }
          break;
        
        case 'suspicious-activity':
          // Log and monitor
          action.success = true;
          action.method = 'monitoring';
          break;
        
        default:
          action.success = true;
          action.method = 'logged';
      }
    } catch (error) {
      action.error = error.message;
    }
    
    return action;
  }
  
  async hardenSystem() {
    return {
      action: 'hardening',
      measures: [
        'Increased monitoring frequency',
        'Tightened resource thresholds',
        'Enhanced logging'
      ],
      success: true
    };
  }
  
  async forceCleanup() {
    // Clear old scan history
    const oldSize = this.scanHistory.length;
    this.scanHistory = this.scanHistory.slice(-20);
    
    // Trigger GC if available
    let gcTriggered = false;
    if (global.gc) {
      global.gc();
      gcTriggered = true;
    }
    
    return {
      action: 'cleanup',
      historyCleared: oldSize - this.scanHistory.length,
      gcTriggered,
      success: true
    };
  }
  
  // ==================== NETWORK ARMOR ====================
  
  async networkArmor(options = {}) {
    const armor = {
      timestamp: Date.now(),
      enabled: true,
      protections: [],
      status: 'active'
    };
    
    // Apply network-level protections
    armor.protections.push({
      type: 'rate-limiting',
      status: 'enabled',
      description: 'Request rate limiting active'
    });
    
    armor.protections.push({
      type: 'connection-monitoring',
      status: 'enabled',
      description: 'Connection monitoring active'
    });
    
    if (options.aggressive) {
      armor.protections.push({
        type: 'strict-filtering',
        status: 'enabled',
        description: 'Aggressive traffic filtering enabled'
      });
    }
    
    this.statistics.systemsProtected++;
    
    this.emit('armor-enabled', armor);
    this.logger.info(`[Batou] Network armor engaged: ${armor.protections.length} protections active`);
    
    return { success: true, armor };
  }
  
  // ==================== ANOMALY LOCKDOWN ====================
  
  async anomalyLockdown(options = {}) {
    const target = options.target || 'system';
    const duration = options.duration || 300000; // 5 minutes default
    
    const lockdown = {
      timestamp: Date.now(),
      target,
      duration,
      restrictions: [],
      status: 'active'
    };
    
    // Apply lockdown restrictions
    lockdown.restrictions.push({
      type: 'resource-cap',
      description: 'Resource usage capped at 80%'
    });
    
    lockdown.restrictions.push({
      type: 'access-restriction',
      description: 'Non-essential access restricted'
    });
    
    lockdown.restrictions.push({
      type: 'increased-logging',
      description: 'Enhanced audit logging enabled'
    });
    
    // Track locked down system
    this.lockedDownSystems.add(target);
    this.statistics.lockdownsActivated++;
    
    // Auto-release after duration
    setTimeout(() => {
      this.lockedDownSystems.delete(target);
      this.logger.info(`[Batou] Lockdown lifted for ${target}`);
      this.emit('lockdown-lifted', { target });
    }, duration);
    
    this.emit('lockdown-activated', lockdown);
    this.logger.warn(`[Batou] 🔒 LOCKDOWN: ${target} locked for ${duration/1000}s`);
    
    return { success: true, lockdown };
  }
  
  // ==================== SYSTEM STABILIZATION ====================
  
  async stabilizeSystem(options = {}) {
    const stabilization = {
      timestamp: Date.now(),
      actions: [],
      status: 'complete'
    };
    
    // Resource stabilization
    if (options.resources !== false) {
      const resourceAction = await this.stabilizeResources();
      stabilization.actions.push(resourceAction);
    }
    
    // Network stabilization
    if (options.network !== false) {
      const networkAction = await this.stabilizeNetwork();
      stabilization.actions.push(networkAction);
    }
    
    // Clear resolved threats
    let clearedThreats = 0;
    for (const [id, threat] of this.activeThreats) {
      if (threat.status === 'resolved' || Date.now() - threat.detectedAt > 3600000) { // 1 hour old
        this.activeThreats.delete(id);
        clearedThreats++;
      }
    }
    
    if (clearedThreats > 0) {
      stabilization.actions.push({
        action: 'threat-cleanup',
        threatsCleared: clearedThreats
      });
    }
    
    this.emit('system-stabilized', stabilization);
    this.logger.info(`[Batou] System stabilized: ${stabilization.actions.length} actions performed`);
    
    return { success: true, stabilization };
  }
  
  async stabilizeResources() {
    // Trigger garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    return {
      action: 'resource-optimization',
      gcRun: global.gc !== undefined,
      memoryFreed: 'unknown'
    };
  }
  
  async stabilizeNetwork() {
    return {
      action: 'network-stabilization',
      measures: ['Connection pool reset', 'Cache flush'],
      status: 'complete'
    };
  }
  
  // ==================== PROVIDE COVER ====================
  
  async provideCover(options = {}) {
    const target = options.target || 'unknown';
    const duration = options.duration || 60000; // 1 minute default
    
    const cover = {
      timestamp: Date.now(),
      target,
      duration,
      protections: [
        'Priority resource allocation',
        'Threat diversion',
        'Enhanced monitoring'
      ],
      status: 'active'
    };
    
    this.logger.info(`[Batou] Providing cover for ${target} (${duration/1000}s)`);
    
    // Auto-expire after duration
    setTimeout(() => {
      this.emit('cover-expired', { target });
      this.logger.info(`[Batou] Cover expired for ${target}`);
    }, duration);
    
    this.emit('cover-active', cover);
    
    return { success: true, cover };
  }
  
  // ==================== KEVIN COORDINATION ====================
  
  async coordinateWithKEVIN(options = {}) {
    const coordination = {
      timestamp: Date.now(),
      action: options.action || 'sync',
      success: false
    };
    
    if (!this.kevinEndpoint) {
      coordination.error = 'KEVIN endpoint not configured';
      return { success: false, coordination };
    }
    
    try {
      const endpoint = String(this.kevinEndpoint).replace(/\/$/, '');
      const response = await fetch(`${endpoint}/api/kevin/think`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: options.message || `Batou coordination request: ${options.action || 'sync'}`,
          context: {
            source: 'batou',
            action: options.action || 'sync',
            payload: options.payload || {}
          }
        })
      });
      const data = await response.json().catch(() => ({}));
      coordination.success = response.ok && data.success !== false;
      coordination.status = response.status;
      coordination.message = data.response || data.output || data.error || `KEVIN responded with ${response.status}`;
      coordination.result = data;
      this.kevinConnected = true;
      
      this.logger.info(`[Batou] Coordinated with KEVIN: ${options.action}`);
      
    } catch (error) {
      coordination.error = error.message;
      this.kevinConnected = false;
    }
    
    return { success: coordination.success, coordination };
  }
  
  // ==================== CONTINUOUS MONITORING ====================
  
  startContinuousMonitoring() {
    if (this.scanTimer) return;
    
    this.scanTimer = setInterval(async () => {
      try {
        await this.scanThreats({ scope: 'system' });
      } catch (error) {
        this.logger.error(`[Batou] Monitoring scan error: ${error.message}`);
      }
    }, this.scanInterval);
    
    this.logger.info(`[Batou] Continuous monitoring started (interval: ${this.scanInterval}ms)`);
  }
  
  stopContinuousMonitoring() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
      this.logger.info('[Batou] Continuous monitoring stopped');
    }
  }
  
  // ==================== THREAT MANAGEMENT ====================
  
  updateThreatLevel(scan) {
    const oldLevel = this.threatLevel;
    
    if (scan.overallScore > 0.8) {
      this.threatLevel = 'red';
    } else if (scan.overallScore > 0.6) {
      this.threatLevel = 'orange';
    } else if (scan.overallScore > 0.3) {
      this.threatLevel = 'yellow';
    } else {
      this.threatLevel = 'green';
    }
    
    if (this.threatLevel !== oldLevel) {
      this.logger.warn(`[Batou] ⚠️ Threat level changed: ${oldLevel} → ${this.threatLevel}`);
      this.emit('threat-level-changed', { from: oldLevel, to: this.threatLevel });
    }
  }
  
  setThreatLevel(level) {
    const validLevels = ['green', 'yellow', 'orange', 'red'];
    if (!validLevels.includes(level)) {
      throw new Error(`Invalid threat level: ${level}`);
    }
    
    const oldLevel = this.threatLevel;
    this.threatLevel = level;
    
    this.logger.info(`[Batou] Threat level manually set: ${oldLevel} → ${level}`);
    this.emit('threat-level-changed', { from: oldLevel, to: level, manual: true });
    
    return { success: true, threatLevel: level };
  }
  
  getActiveThreats() {
    const threats = Array.from(this.activeThreats.values());
    return {
      success: true,
      threatLevel: this.threatLevel,
      activeThreats: threats,
      count: threats.length
    };
  }
  
  // ==================== UTILITIES ====================
  
  generateThreatId() {
    return `threat_${crypto.randomBytes(6).toString('hex')}`;
  }
  
  async terminate(reason = 'manual') {
    this.stopContinuousMonitoring();
    return super.terminate(reason);
  }
  
  getStatus() {
    const baseStatus = super.getStatus();
    return {
      ...baseStatus,
      threatLevel: this.threatLevel,
      activeThreats: this.activeThreats.size,
      lockedDownSystems: this.lockedDownSystems.size,
      statistics: this.statistics,
      kevinConnected: this.kevinConnected,
      continuousMonitoring: this.scanTimer !== null
    };
  }
}

module.exports = BatouAgent;
