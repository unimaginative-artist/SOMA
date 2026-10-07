// JetstreamAgent.cjs - Operational Diagnostics & Routing
// Cowboy Bebop/Edgerunners inspired: "Old warhorse with upgraded parts"
// Calm under pressure, knows the system inside-out

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');
const os = require('os');
const { performance } = require('perf_hooks');

class JetstreamAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'ops-diagnostics' });
    
    this.name = 'Jetstream';
    this.personality = 'calm-veteran';
    
    // Agent registry for stability checks
    this.agentRegistry = new Map();
    
    // Diagnostic history
    this.diagnosticHistory = [];
    this.maxHistoryLength = config.maxHistoryLength || 200;
    
    // Intel cache
    this.intelCache = new Map();
    this.intelCacheTTL = config.intelCacheTTL || 300000; // 5 minutes
    
    // Risk scores
    this.riskFactors = new Map();
    
    // Performance tracking
    this.performanceMetrics = {
      diagnosticsRun: 0,
      routingDecisions: 0,
      intelSweeps: 0,
      riskAssessments: 0,
      avgDiagnosticTime: 0
    };
    
    this.logger.info(`[Jetstream] 🛠️ Ops ready. "Let's see what we're working with..."`);
  }
  
  async initialize() {
    await super.initialize();
    
    // Run initial system diagnostics
    await this.diagnostics();
    
    this.logger.info('[Jetstream] Systems nominal. Standing by.');
  }
  
  async execute(task) {
    try {
      // Validate task
      if (!task || typeof task !== 'object') {
        throw new Error('Invalid task: expected non-null object');
      }

      const { type, payload } = task;

      switch (type) {
        case 'diagnostics':
          return await this.diagnostics(payload);

        case 'ops-route':
          return await this.routeOperation(payload);

        case 'intel':
          return await this.intelSweep(payload);

        case 'risk':
          return await this.riskAssessment(payload);

        case 'agent-check':
          return await this.checkAgentStability(payload);

        case 'register-agent':
          return this.registerAgent(payload);

        case 'unregister-agent':
          return this.unregisterAgent(payload);

        case 'get-history':
          return this.getDiagnosticHistory(payload);

        case 'clear-cache':
          return this.clearIntelCache();

        default:
          throw new Error(`Unknown task type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`[Jetstream] Execute failed: ${error.message}`);
      return { success: false, error: error.message, stack: error.stack };
    }
  }
  
  // ==================== DIAGNOSTICS ====================
  
  async diagnostics(options = {}) {
    const startTime = performance.now();
    
    const diagnostic = {
      timestamp: Date.now(),
      scope: options.scope || 'full',
      results: {}
    };
    
    try {
      // System level diagnostics
      if (!options.scope || options.scope === 'full' || options.scope === 'system') {
        diagnostic.results.system = await this.diagnoseSystem();
      }
      
      // Network diagnostics
      if (!options.scope || options.scope === 'full' || options.scope === 'network') {
        diagnostic.results.network = await this.diagnoseNetwork();
      }
      
      // Process diagnostics
      if (!options.scope || options.scope === 'full' || options.scope === 'process') {
        diagnostic.results.process = await this.diagnoseProcess();
      }
      
      // Agent diagnostics
      if (!options.scope || options.scope === 'full' || options.scope === 'agents') {
        diagnostic.results.agents = await this.diagnoseAgents();
      }
      
      const executionTime = performance.now() - startTime;
      diagnostic.executionTime = executionTime;
      diagnostic.status = 'complete';
      
      // Update metrics
      this.performanceMetrics.diagnosticsRun++;
      this.performanceMetrics.avgDiagnosticTime = 
        (this.performanceMetrics.avgDiagnosticTime * (this.performanceMetrics.diagnosticsRun - 1) + executionTime) 
        / this.performanceMetrics.diagnosticsRun;
      
      // Add to history
      this.diagnosticHistory.push(diagnostic);
      if (this.diagnosticHistory.length > this.maxHistoryLength) {
        this.diagnosticHistory.shift();
      }
      
      this.emit('diagnostic', diagnostic);
      
      return { success: true, diagnostic };
      
    } catch (error) {
      diagnostic.status = 'failed';
      diagnostic.error = error.message;
      this.logger.error(`[Jetstream] Diagnostic failed: ${error.message}`);
      return { success: false, diagnostic, error: error.message };
    }
  }
  
  async diagnoseSystem() {
    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      memoryUsage: 1 - (os.freemem() / os.totalmem()),
      cpus: os.cpus().length,
      loadAverage: os.loadavg(),
      nodeVersion: process.version,
      status: 'healthy'
    };
  }
  
  async diagnoseNetwork() {
    const interfaces = os.networkInterfaces();
    const networkInfo = {
      interfaces: {},
      totalInterfaces: 0,
      activeInterfaces: 0
    };
    
    for (const [name, addresses] of Object.entries(interfaces)) {
      networkInfo.totalInterfaces++;
      const ipv4 = addresses.find(addr => addr.family === 'IPv4' && !addr.internal);
      if (ipv4) {
        networkInfo.activeInterfaces++;
        networkInfo.interfaces[name] = {
          address: ipv4.address,
          netmask: ipv4.netmask,
          mac: ipv4.mac
        };
      }
    }
    
    networkInfo.status = networkInfo.activeInterfaces > 0 ? 'connected' : 'disconnected';
    return networkInfo;
  }
  
  async diagnoseProcess() {
    const mem = process.memoryUsage();
    return {
      pid: process.pid,
      uptime: process.uptime(),
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        heapUtilization: mem.heapUsed / mem.heapTotal,
        rss: mem.rss,
        external: mem.external
      },
      cpu: process.cpuUsage(),
      status: mem.heapUsed / mem.heapTotal < 0.9 ? 'healthy' : 'strained'
    };
  }
  
  async diagnoseAgents() {
    const agentStatuses = [];
    
    for (const [id, agent] of this.agentRegistry) {
      const status = {
        id,
        name: agent.name || 'unknown',
        lastHeartbeat: agent.lastHeartbeat || 0,
        age: Date.now() - (agent.lastHeartbeat || Date.now()),
        responsive: Date.now() - (agent.lastHeartbeat || Date.now()) < 60000, // 1 minute
        state: agent.state || 'unknown'
      };
      
      agentStatuses.push(status);
    }
    
    return {
      totalAgents: agentStatuses.length,
      responsiveAgents: agentStatuses.filter(a => a.responsive).length,
      agents: agentStatuses,
      status: agentStatuses.every(a => a.responsive) ? 'healthy' : 'degraded'
    };
  }
  
  // ==================== OPERATIONS ROUTING ====================
  
  async routeOperation(operation) {
    this.performanceMetrics.routingDecisions++;
    
    const { type, priority, requirements } = operation;
    
    // Analyze operation requirements
    const analysis = {
      type,
      priority: priority || 'normal',
      requirements: requirements || {},
      timestamp: Date.now()
    };
    
    // Determine optimal routing based on system state and agent availability
    const systemState = await this.diagnoseSystem();
    const agentState = await this.diagnoseAgents();
    
    // Route based on operation type
    let route = null;
    
    if (type === 'compute-intensive') {
      // Check CPU availability
      if (systemState.loadAverage[0] < systemState.cpus * 0.7) {
        route = { target: 'local', reason: 'CPU available' };
      } else {
        route = { target: 'queue', reason: 'CPU busy, deferred' };
      }
    } else if (type === 'memory-intensive') {
      // Check memory availability
      if (systemState.memoryUsage < 0.8) {
        route = { target: 'local', reason: 'Memory available' };
      } else {
        route = { target: 'queue', reason: 'Memory constrained' };
      }
    } else if (type === 'agent-task') {
      // Route to specific agent
      const targetAgent = requirements.agentId || requirements.agentType;
      if (targetAgent) {
        const agent = this.findAgent(targetAgent);
        if (agent && agent.responsive) {
          route = { target: agent.id, reason: 'Agent available' };
        } else {
          route = { target: 'fallback', reason: 'Agent unavailable' };
        }
      }
    }
    
    // Default routing
    if (!route) {
      route = { target: 'default', reason: 'Standard routing' };
    }
    
    analysis.route = route;
    
    this.emit('route', analysis);
    this.logger.info(`[Jetstream] Routing ${type} → ${route.target} (${route.reason})`);
    
    return { success: true, route: analysis };
  }
  
  // ==================== INTEL SWEEP ====================
  
  async intelSweep(options = {}) {
    this.performanceMetrics.intelSweeps++;
    
    const target = options.target || 'system';
    const cacheKey = `intel_${target}_${Date.now()}`;
    
    // Check cache first
    if (!options.forceRefresh) {
      const cached = this.getFromIntelCache(target);
      if (cached) {
        this.logger.info(`[Jetstream] Intel cache hit: ${target}`);
        return { success: true, intel: cached, cached: true };
      }
    }
    
    const intel = {
      target,
      timestamp: Date.now(),
      data: {}
    };
    
    try {
      switch (target) {
        case 'system':
          intel.data = await this.gatherSystemIntel();
          break;
        
        case 'agents':
          intel.data = await this.gatherAgentIntel();
          break;
        
        case 'performance':
          intel.data = await this.gatherPerformanceIntel();
          break;
        
        case 'risks':
          intel.data = await this.gatherRiskIntel();
          break;
        
        default:
          intel.data = { message: `Unknown intel target: ${target}` };
      }
      
      // Cache the intel
      this.addToIntelCache(target, intel);
      
      this.emit('intel', intel);
      
      return { success: true, intel, cached: false };
      
    } catch (error) {
      this.logger.error(`[Jetstream] Intel sweep failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  async gatherSystemIntel() {
    const diagnostic = await this.diagnoseSystem();
    return {
      summary: `${diagnostic.cpus} cores, ${this.formatBytes(diagnostic.totalMemory)} RAM`,
      load: diagnostic.loadAverage[0] / diagnostic.cpus,
      memoryPressure: diagnostic.memoryUsage,
      uptime: diagnostic.uptime,
      health: diagnostic.status
    };
  }
  
  async gatherAgentIntel() {
    const diagnostic = await this.diagnoseAgents();
    return {
      summary: `${diagnostic.responsiveAgents}/${diagnostic.totalAgents} agents responsive`,
      agents: diagnostic.agents,
      health: diagnostic.status
    };
  }
  
  async gatherPerformanceIntel() {
    return {
      summary: `${this.performanceMetrics.diagnosticsRun} diagnostics run`,
      metrics: this.performanceMetrics,
      avgDiagnosticTime: this.performanceMetrics.avgDiagnosticTime.toFixed(2) + 'ms'
    };
  }
  
  async gatherRiskIntel() {
    const risks = Array.from(this.riskFactors.entries()).map(([factor, score]) => ({
      factor,
      score,
      severity: score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low'
    }));
    
    return {
      summary: `${risks.filter(r => r.severity === 'high').length} high-risk factors`,
      risks,
      overallRisk: risks.length > 0 ? 
        risks.reduce((sum, r) => sum + r.score, 0) / risks.length : 0
    };
  }
  
  // ==================== RISK ASSESSMENT ====================
  
  async riskAssessment(options = {}) {
    this.performanceMetrics.riskAssessments++;
    
    const assessment = {
      timestamp: Date.now(),
      factors: [],
      overallScore: 0,
      severity: 'low'
    };
    
    try {
      // Assess system risks
      const systemDiag = await this.diagnoseSystem();
      if (systemDiag.memoryUsage > 0.9) {
        const risk = { factor: 'memory', score: systemDiag.memoryUsage, message: 'Critical memory usage' };
        assessment.factors.push(risk);
        this.riskFactors.set('memory', systemDiag.memoryUsage);
      }
      
      const cpuLoad = systemDiag.loadAverage[0] / systemDiag.cpus;
      if (cpuLoad > 0.85) {
        const risk = { factor: 'cpu', score: cpuLoad, message: 'High CPU load' };
        assessment.factors.push(risk);
        this.riskFactors.set('cpu', cpuLoad);
      }
      
      // Assess agent risks
      const agentDiag = await this.diagnoseAgents();
      if (agentDiag.status === 'degraded') {
        const unresponsiveRatio = 1 - (agentDiag.responsiveAgents / agentDiag.totalAgents);
        const risk = { factor: 'agents', score: unresponsiveRatio, message: 'Unresponsive agents detected' };
        assessment.factors.push(risk);
        this.riskFactors.set('agents', unresponsiveRatio);
      }
      
      // Assess process risks
      const processDiag = await this.diagnoseProcess();
      if (processDiag.memory.heapUtilization > 0.9) {
        const risk = { factor: 'heap', score: processDiag.memory.heapUtilization, message: 'Heap pressure' };
        assessment.factors.push(risk);
        this.riskFactors.set('heap', processDiag.memory.heapUtilization);
      }
      
      // Calculate overall score
      if (assessment.factors.length > 0) {
        assessment.overallScore = assessment.factors.reduce((sum, f) => sum + f.score, 0) / assessment.factors.length;
      }
      
      // Determine severity
      if (assessment.overallScore > 0.8) assessment.severity = 'critical';
      else if (assessment.overallScore > 0.6) assessment.severity = 'high';
      else if (assessment.overallScore > 0.4) assessment.severity = 'medium';
      else assessment.severity = 'low';
      
      this.emit('risk-assessment', assessment);
      
      if (assessment.severity === 'critical' || assessment.severity === 'high') {
        this.logger.warn(`[Jetstream] ⚠️ ${assessment.severity.toUpperCase()} risk detected: ${assessment.factors.length} factors`);
      }
      
      return { success: true, assessment };
      
    } catch (error) {
      this.logger.error(`[Jetstream] Risk assessment failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  // ==================== AGENT STABILITY CHECKS ====================
  
  async checkAgentStability(options = {}) {
    const agentId = options.agentId || options.agent;
    
    if (agentId) {
      // Check specific agent
      const agent = this.agentRegistry.get(agentId);
      if (!agent) {
        return { success: false, error: `Agent not found: ${agentId}` };
      }
      
      const stability = this.assessAgentStability(agent);
      return { success: true, agentId, stability };
    } else {
      // Check all agents
      const results = [];
      for (const [id, agent] of this.agentRegistry) {
        const stability = this.assessAgentStability(agent);
        results.push({ agentId: id, stability });
      }
      return { success: true, agents: results };
    }
  }
  
  assessAgentStability(agent) {
    const now = Date.now();
    const age = now - (agent.createdAt || now);
    const timeSinceHeartbeat = now - (agent.lastHeartbeat || now);
    
    let score = 100;
    let issues = [];
    
    // Check heartbeat freshness
    if (timeSinceHeartbeat > 60000) {
      score -= 50;
      issues.push('No recent heartbeat');
    } else if (timeSinceHeartbeat > 30000) {
      score -= 20;
      issues.push('Delayed heartbeat');
    }
    
    // Check state
    if (agent.state === 'terminated') {
      score = 0;
      issues.push('Agent terminated');
    } else if (agent.state === 'working' && timeSinceHeartbeat > 120000) {
      score -= 30;
      issues.push('Stuck in working state');
    }
    
    const status = score > 80 ? 'stable' : score > 50 ? 'degraded' : 'unstable';
    
    return {
      score,
      status,
      issues,
      age,
      timeSinceHeartbeat
    };
  }
  
  registerAgent(agentInfo) {
    const { id, name, state } = agentInfo;
    this.agentRegistry.set(id, {
      id,
      name,
      state,
      createdAt: Date.now(),
      lastHeartbeat: Date.now()
    });
    
    this.logger.info(`[Jetstream] Agent registered: ${name} (${id})`);
    return { success: true, registered: id };
  }
  
  unregisterAgent(agentInfo) {
    const id = agentInfo.id || agentInfo;
    if (this.agentRegistry.delete(id)) {
      this.logger.info(`[Jetstream] Agent unregistered: ${id}`);
      return { success: true, unregistered: id };
    }
    return { success: false, error: 'Agent not found' };
  }
  
  findAgent(idOrType) {
    // Try exact ID match first
    let agent = this.agentRegistry.get(idOrType);
    if (agent) return agent;
    
    // Try type match
    for (const [id, agentData] of this.agentRegistry) {
      if (agentData.type === idOrType || agentData.name === idOrType) {
        return agentData;
      }
    }
    return null;
  }
  
  // ==================== INTEL CACHE ====================
  
  addToIntelCache(key, intel) {
    this.intelCache.set(key, {
      data: intel,
      timestamp: Date.now(),
      ttl: this.intelCacheTTL
    });
  }
  
  getFromIntelCache(key) {
    const cached = this.intelCache.get(key);
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    if (age > cached.ttl) {
      this.intelCache.delete(key);
      return null;
    }
    
    return cached.data;
  }
  
  clearIntelCache() {
    const size = this.intelCache.size;
    this.intelCache.clear();
    this.logger.info(`[Jetstream] Intel cache cleared (${size} entries)`);
    return { success: true, cleared: size };
  }
  
  // ==================== UTILITIES ====================
  
  getDiagnosticHistory(options = {}) {
    const limit = options.limit || 50;
    const history = this.diagnosticHistory.slice(-limit);
    return {
      success: true,
      history,
      count: history.length,
      total: this.diagnosticHistory.length
    };
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  getStatus() {
    const baseStatus = super.getStatus();
    return {
      ...baseStatus,
      registeredAgents: this.agentRegistry.size,
      diagnosticsRun: this.performanceMetrics.diagnosticsRun,
      avgDiagnosticTime: this.performanceMetrics.avgDiagnosticTime.toFixed(2) + 'ms',
      intelCacheSize: this.intelCache.size,
      riskFactors: this.riskFactors.size
    };
  }
}

module.exports = JetstreamAgent;
