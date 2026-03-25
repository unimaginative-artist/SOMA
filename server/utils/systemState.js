import os from 'os';

let lastCpuInfo = os.cpus();
let lastNeuralLoad = { load1: 0, load5: 0, load15: 0 };

const calcCpuDelta = (prev, curr) => {
  let totalTick = 0;
  let totalIdle = 0;

  for (const type in curr) {
    totalTick += (curr[type] || 0) - (prev[type] || 0);
  }
  totalIdle += (curr.idle || 0) - (prev.idle || 0);

  const usage = totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
  return { usage, totalTick, totalIdle };
};

const resolveAgentLoad = (agent) => {
  if (!agent || typeof agent !== 'object') return 0;
  if (typeof agent.getLoad === 'function') {
    const load = agent.getLoad();
    if (typeof load === 'number' && Number.isFinite(load)) return Math.max(0, Math.min(100, Math.round(load)));
  }
  if (typeof agent.load === 'number' && Number.isFinite(agent.load)) {
    return Math.max(0, Math.min(100, Math.round(agent.load)));
  }
  if (typeof agent.stats?.load === 'number' && Number.isFinite(agent.stats.load)) {
    return Math.max(0, Math.min(100, Math.round(agent.stats.load)));
  }
  if (Array.isArray(agent.queue)) {
    return Math.max(0, Math.min(100, agent.queue.length));
  }
  return 0;
};

const sanitizeStats = (stats) => {
  if (!stats || typeof stats !== 'object') return null;
  const out = {};
  const entries = Object.entries(stats).filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean');
  for (const [key, value] of entries.slice(0, 20)) {
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
};

const buildAgentsList = (system) => {
  const agentsList = [];
  for (const [key, value] of Object.entries(system)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (!(value.name || key.includes('Arbiter') || key.includes('Engine') || key.includes('Cortex') || key.includes('Pipeline') || key.includes('Pool'))) {
      continue;
    }

    const agentType = key.includes('Cortex') ? 'cortex'
      : key.includes('Engine') ? 'engine'
      : key.includes('Pipeline') ? 'pipeline'
      : key.includes('Pool') ? 'worker'
      : 'arbiter';

    agentsList.push({
      id: key,
      name: value.name || key,
      type: agentType,
      status: typeof value.getStatus === 'function' ? value.getStatus() : 'active',
      load: resolveAgentLoad(value),
      stats: sanitizeStats(value.stats)
    });
  }
  return agentsList;
};

const estimateContextWindow = (system) => {
  const maxTokens = system.conversationCompressor?.thresholds?.archive
    || system.conversationCompressor?.thresholds?.keyFacts
    || 1048576;

  let used = 0;
  try {
    const history = system.conversationHistory?.getRecentMessages?.(200) || [];
    const estimateTokens = (text) => (text ? Math.ceil(text.length / 4) : 0);
    used = history.reduce((acc, msg) => acc + estimateTokens(msg.content || msg.text || ''), 0);
  } catch {
    used = 0;
  }

  const percentage = maxTokens > 0 ? Math.min(100, (used / maxTokens) * 100) : 0;
  return { maxTokens, used, percentage };
};

const estimateNeuralLoad = (cpuPercent) => {
  const osLoad = os.loadavg ? os.loadavg() : [0, 0, 0];
  const hasRealLoad = osLoad.some(v => v > 0);
  if (hasRealLoad) {
    lastNeuralLoad = { load1: osLoad[0], load5: osLoad[1], load15: osLoad[2] };
    return lastNeuralLoad;
  }
  const cores = os.cpus().length || 1;
  const synthetic = (cpuPercent / 100) * cores;
  lastNeuralLoad = { load1: synthetic, load5: synthetic * 0.9, load15: synthetic * 0.8 };
  return lastNeuralLoad;
};

export function buildSystemSnapshot(system = {}) {
  const currentCpuInfo = os.cpus();
  const prevCpuInfo = lastCpuInfo;
  lastCpuInfo = currentCpuInfo;

  let totalUsage = 0;
  const perCore = currentCpuInfo.map((core, i) => {
    const prev = prevCpuInfo[i]?.times || {};
    const curr = core.times || {};
    const delta = calcCpuDelta(prev, curr);
    totalUsage += delta.usage;
    return { core: i, usage: delta.usage };
  });
  const cpuPercent = perCore.length ? Math.round(totalUsage / perCore.length) : 0;

  const ramPercent = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  const memUsage = process.memoryUsage();
  const neuralLoad = estimateNeuralLoad(cpuPercent);
  const contextWindow = estimateContextWindow(system);

  return {
    status: system.ready ? 'online' : 'initializing',
    ready: !!system.ready,
    uptime: process.uptime(),
    cpu: cpuPercent,
    ram: ramPercent,
    gpu: null,
    network: null,
    memory: {
      rss: Math.round(memUsage.rss / 1048576),
      heapUsed: Math.round(memUsage.heapUsed / 1048576),
      heapTotal: Math.round(memUsage.heapTotal / 1048576)
    },
    neuralLoad,
    contextWindow,
    systemDetail: {
      cpu: {
        cores: currentCpuInfo.length,
        model: currentCpuInfo[0]?.model || 'Unknown',
        usage: cpuPercent,
        perCore
      },
      memory: {
        totalGB: (os.totalmem() / 1073741824).toFixed(1),
        usedGB: ((os.totalmem() - os.freemem()) / 1073741824).toFixed(1),
        freeGB: (os.freemem() / 1073741824).toFixed(1),
        percentage: ramPercent,
        nodeRSS: Math.round(memUsage.rss / 1048576),
        nodeHeapUsed: Math.round(memUsage.heapUsed / 1048576),
        nodeHeapTotal: Math.round(memUsage.heapTotal / 1048576)
      },
      network: {
        interfaces: Object.entries(os.networkInterfaces()).map(([name, addrs]) => ({
          name,
          addresses: (addrs || []).filter(a => a.family === 'IPv4').map(a => a.address)
        })).filter(n => n.addresses.length > 0)
      }
    },
    agents: buildAgentsList(system),
    counts: (() => {
      const agents = buildAgentsList(system);
      const arbiterCount = agents.filter(a => ['arbiter','engine','cortex','pipeline','worker'].includes(a.type)).length;
      const fragmentCount = system.fragmentRegistry?.listFragments?.()?.length || 0;
      const microAgentPool = system.microAgentPool;
      const namedMicroAgents = microAgentPool?.spawnedAgents?.size || 0;
      const workerAgents = microAgentPool?.workers?.length || 0;
      return {
        arbiters: arbiterCount,
        fragments: fragmentCount,
        microAgents: namedMicroAgents + workerAgents
      };
    })(),
    cognitive: {
      goals: {
        active: system.goalPlanner?.activeGoals?.size || 0,
        completed: system.goalPlanner?.stats?.goalsCompleted || 0,
        failed: system.goalPlanner?.stats?.goalsFailed || 0
      },
      curiosity: {
        level: system.curiosityEngine?.motivation?.currentCuriosity || 0,
        queueSize: system.curiosityEngine?.curiosityQueue?.length || 0,
        explorations: system.curiosityEngine?.stats?.explorationsStarted || 0,
        knowledgeGaps: system.curiosityEngine?.knowledgeGaps?.size || 0
      },
      codeHealth: {
        totalFiles: system.codeObserver?.codebase?.metrics?.totalFiles || 0,
        issues: system.codeObserver?.health?.issues?.length || 0,
        opportunities: system.codeObserver?.health?.opportunities?.length || 0,
        lastScan: system.codeObserver?.codebase?.metrics?.lastScan || null
      },
      timekeeper: {
        rhythms: system.timekeeper?.stats?.rhythmsExecuted || 0,
        pulses: system.timekeeper?.stats?.pulsesEmitted || 0
      },
      learning: {
        sessions: system.nighttimeLearning?.metrics?.totalSessions || 0,
        active: system.nighttimeLearning?.activeSessions?.size || 0
      },
      drive: {
        tension:      system.drive?.tension      ?? null,
        satisfaction: system.drive?.satisfaction ?? null
      }
    }
  };
}

export function buildPulsePayload(snapshot) {
  return {
    system: {
      cpu: snapshot.cpu,
      ram: snapshot.ram,
      uptime: snapshot.uptime,
      status: snapshot.status
    },
    agents: snapshot.agents,
    brains: {
      quadBrain: true,
      totalArbiters: snapshot.agents.length,
      ready: snapshot.ready
    },
    knowledge: {
      nodes: snapshot.cognitive?.codeHealth?.totalFiles || 0
    },
    neuralLoad: snapshot.neuralLoad,
    contextWindow: snapshot.contextWindow,
    systemDetail: snapshot.systemDetail,
    events: []
  };
}
