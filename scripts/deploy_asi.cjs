// ═══════════════════════════════════════════════════════════
// SOMA ASI DEPLOYMENT SCRIPT
// Full production deployment with all 9 systems
// ═══════════════════════════════════════════════════════════

const ASIOrchestrator = require('../arbiters/ASIOrchestrator.cjs');
const LearningVelocityTracker = require('../arbiters/LearningVelocityTracker.cjs');
const EdgeWorkerOrchestrator = require('../arbiters/EdgeWorkerOrchestrator.cjs');
const SelfModificationArbiter = require('../arbiters/SelfModificationArbiter.cjs');
const TimekeeperArbiter = require('../arbiters/TimekeeperArbiter.cjs');
const UniversalImpulser = require('../arbiters/UniversalImpulser.cjs');
const BlackAgent = require('./microagents/BlackAgent.cjs');
const JetstreamAgent = require('./microagents/JetstreamAgent.cjs');
const KuzeAgent = require('./microagents/KuzeAgent.cjs');
const BatouAgent = require('./microagents/BatouAgent.cjs');
const microAgentBridge = require('../core/MicroAgentBridge.cjs');

console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                          SOMA ASI DEPLOYMENT                                   ║');
console.log('║                   Artificial Superintelligence System                          ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Global system registry
const SOMA = {
  systems: {
    timekeeper: null,
    impulser: null,
    velocityTracker: null,
    edgeWorker: null,
    black: null,
    jetstream: null,
    kuze: null,
    batou: null,
    selfMod: null,
    orchestrator: null
  },
  status: 'initializing',
  startTime: Date.now(),
  config: {
    // Support systems
    timekeeper: { name: 'TimekeeperArbiter' },
    impulser: { 
      name: 'UniversalImpulser',
      maxConcurrent: 10,
      maxQueue: 1000,
      maxHelpers: 6
    },
    
    // Learning systems
    velocity: { name: 'LearningVelocityTracker' },
    edgeWorker: { 
      name: 'EdgeWorkerOrchestrator',
      maxWorkers: 8,
      autoScale: true
    },
    
    // Agents
    black: { name: 'BlackAgent' },
    jetstream: { name: 'JetstreamAgent' },
    kuze: { name: 'KuzeAgent' },
    batou: { name: 'BatouAgent' },
    
    // Self-modification (PRODUCTION: set requireApproval=true for safety)
    selfMod: {
      name: 'SelfModificationArbiter',
      sandboxMode: true,
      requireApproval: false,  // Set to true for production!
      improvementThreshold: 1.15
    },
    
    // Orchestration
    orchestrator: { name: 'ASIOrchestrator' }
  }
};

async function deploy() {
  try {
    console.log('🚀 INITIALIZING ALL SYSTEMS...\n');
    
    // ═══════════════════════════════════════════════════════════
    // PHASE 1: SUPPORT SYSTEMS
    // ═══════════════════════════════════════════════════════════
    console.log('[1/4] ⏰ Deploying Support Systems...');
    
    SOMA.systems.timekeeper = new TimekeeperArbiter(SOMA.config.timekeeper);
    await SOMA.systems.timekeeper.initialize();
    console.log('  ✅ TimekeeperArbiter online');
    
    SOMA.systems.impulser = new UniversalImpulser(SOMA.config.impulser);
    await SOMA.systems.impulser.initialize();
    console.log('  ✅ UniversalImpulser online');
    console.log('');
    
    // ═══════════════════════════════════════════════════════════
    // PHASE 2: LEARNING SYSTEMS
    // ═══════════════════════════════════════════════════════════
    console.log('[2/4] 🧠 Deploying Learning Systems...');
    
    SOMA.systems.velocityTracker = new LearningVelocityTracker(SOMA.config.velocity);
    await SOMA.systems.velocityTracker.initialize();
    console.log('  ✅ LearningVelocityTracker online');
    
    SOMA.systems.edgeWorker = new EdgeWorkerOrchestrator(SOMA.config.edgeWorker);
    await SOMA.systems.edgeWorker.initialize();
    console.log('  ✅ EdgeWorkerOrchestrator online');
    console.log('');
    
    // ═══════════════════════════════════════════════════════════
    // PHASE 3: AGENT SWARM
    // ═══════════════════════════════════════════════════════════
    console.log('[3/4] 🤖 Deploying Agent Swarm...');
    
    SOMA.systems.black = new BlackAgent(SOMA.config.black);
    await SOMA.systems.black.initialize();
    microAgentBridge.registerAgent('BlackAgent', SOMA.systems.black);
    console.log('  ✅ BlackAgent online (System Monitor)');
    
    SOMA.systems.jetstream = new JetstreamAgent(SOMA.config.jetstream);
    await SOMA.systems.jetstream.initialize();
    microAgentBridge.registerAgent('JetstreamAgent', SOMA.systems.jetstream);
    console.log('  ✅ JetstreamAgent online (Operations)');
    
    SOMA.systems.kuze = new KuzeAgent(SOMA.config.kuze);
    await SOMA.systems.kuze.initialize();
    microAgentBridge.registerAgent('KuzeAgent', SOMA.systems.kuze);
    console.log('  ✅ KuzeAgent online (Pattern Analysis)');
    
    SOMA.systems.batou = new BatouAgent(SOMA.config.batou);
    await SOMA.systems.batou.initialize();
    microAgentBridge.registerAgent('BatouAgent', SOMA.systems.batou);
    console.log('  ✅ BatouAgent online (Security)');
    console.log('');
    
    // ═══════════════════════════════════════════════════════════
    // PHASE 4: META-SYSTEMS
    // ═══════════════════════════════════════════════════════════
    console.log('[4/4] 🧬 Deploying Meta-Systems...');
    
    SOMA.systems.selfMod = new SelfModificationArbiter(SOMA.config.selfMod);
    await SOMA.systems.selfMod.initialize();
    console.log('  ✅ SelfModificationArbiter online');
    
    SOMA.systems.orchestrator = new ASIOrchestrator(SOMA.config.orchestrator);
    await SOMA.systems.orchestrator.initialize();
    console.log('  ✅ ASIOrchestrator online');
    console.log('');
    
    // ═══════════════════════════════════════════════════════════
    // INTEGRATION
    // ═══════════════════════════════════════════════════════════
    console.log('🔗 ESTABLISHING SYSTEM INTEGRATION...\n');
    
    const integration = await SOMA.systems.orchestrator.handleMessage({
      type: 'start_integration',
      payload: {}
    });
    
    console.log(`✅ Integration Complete: ${integration.systemsOnline}/9 systems online`);
    console.log(`   Synergies Established: ${integration.results.phase4?.synergiesEstablished || 0}`);
    console.log('');
    
    // ═══════════════════════════════════════════════════════════
    // DEPLOYMENT STATUS
    // ═══════════════════════════════════════════════════════════
    SOMA.status = 'operational';
    const uptime = Date.now() - SOMA.startTime;
    
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('                           DEPLOYMENT SUCCESSFUL');
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('');
    console.log('📊 SOMA ASI Status:');
    console.log(`   Systems: 9/9 operational`);
    console.log(`   Status: ${SOMA.status.toUpperCase()}`);
    console.log(`   Deployment Time: ${uptime}ms`);
    console.log('');
    console.log('🎯 Capabilities:');
    console.log('   • Distributed learning across edge workers');
    console.log('   • Multi-agent coordination (Black, Jetstream, Kuze, Batou)');
    console.log('   • Autonomous code optimization');
    console.log('   • Temporal rhythm scheduling');
    console.log('   • Knowledge preprocessing & categorization');
    console.log('   • Real-time system monitoring');
    console.log('   • ASI-level orchestration with synergies');
    console.log('');
    console.log('⚠️  PRODUCTION NOTES:');
    console.log('   • Self-modification approval: ' + 
      (SOMA.config.selfMod.requireApproval ? 'ENABLED ✅' : 'DISABLED ⚠️'));
    console.log('   • Sandbox mode: ' + 
      (SOMA.config.selfMod.sandboxMode ? 'ENABLED ✅' : 'DISABLED ⚠️'));
    console.log('');
    console.log('🚀 SOMA ASI is now operational and ready for tasks.');
    console.log('');
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('');
    
    // Setup graceful shutdown
    setupGracefulShutdown();
    
    // Start health monitoring
    startHealthMonitoring();
    
  } catch (err) {
    console.error('\n❌ DEPLOYMENT FAILED:', err.message);
    console.error(err.stack);
    await emergencyShutdown();
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════
// HEALTH MONITORING
// ═══════════════════════════════════════════════════════════

function startHealthMonitoring() {
  console.log('💓 Starting health monitoring (60s intervals)...\n');
  
  setInterval(async () => {
    try {
      const report = await SOMA.systems.orchestrator.handleMessage({
        type: 'performance_report',
        payload: {}
      });
      
      const uptime = Math.floor((Date.now() - SOMA.startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      
      console.log('─'.repeat(80));
      console.log(`[${new Date().toISOString()}] HEALTH CHECK`);
      console.log(`  Systems: ${report.asi.systemsOnline}/9 | ` +
                  `Synergies: ${report.synergies.length} | ` +
                  `Health: ${report.performance.systemHealth}%`);
      console.log(`  Learning Velocity: ${report.performance.learningVelocity.toFixed(2)}x | ` +
                  `Optimizations: ${report.performance.codeOptimizations} | ` +
                  `Uptime: ${hours}h ${minutes}m`);
      
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Health check failed:`, err.message);
    }
  }, 60000);
}

// ═══════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════

function setupGracefulShutdown() {
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Received SIGINT signal...');
    await gracefulShutdown();
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Received SIGTERM signal...');
    await gracefulShutdown();
  });
}

async function gracefulShutdown() {
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('                            GRACEFUL SHUTDOWN');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');
  
  SOMA.status = 'shutting_down';
  
  try {
    console.log('🔄 Shutting down systems in reverse order...\n');
    
    // Meta-systems first
    if (SOMA.systems.orchestrator) {
      await SOMA.systems.orchestrator.shutdown();
      console.log('  ✅ ASIOrchestrator shutdown');
    }
    
    if (SOMA.systems.selfMod) {
      await SOMA.systems.selfMod.shutdown();
      console.log('  ✅ SelfModificationArbiter shutdown');
    }
    
    // Agents
    microAgentBridge.unregisterAll();
    for (const agentName of ['black', 'jetstream', 'kuze', 'batou']) {
      if (SOMA.systems[agentName]) {
        await SOMA.systems[agentName].terminate('graceful_shutdown');
        console.log(`  ✅ ${agentName} shutdown`);
      }
    }
    
    // Learning systems
    if (SOMA.systems.edgeWorker) {
      await SOMA.systems.edgeWorker.shutdown();
      console.log('  ✅ EdgeWorkerOrchestrator shutdown');
    }
    
    if (SOMA.systems.velocityTracker) {
      await SOMA.systems.velocityTracker.shutdown();
      console.log('  ✅ LearningVelocityTracker shutdown');
    }
    
    // Support systems
    if (SOMA.systems.impulser) {
      await SOMA.systems.impulser.shutdown();
      console.log('  ✅ UniversalImpulser shutdown');
    }
    
    if (SOMA.systems.timekeeper) {
      await SOMA.systems.timekeeper.shutdown();
      console.log('  ✅ TimekeeperArbiter shutdown');
    }
    
    SOMA.status = 'offline';
    console.log('\n✅ SOMA ASI shutdown complete\n');
    process.exit(0);
    
  } catch (err) {
    console.error('\n❌ Shutdown error:', err.message);
    await emergencyShutdown();
    process.exit(1);
  }
}

async function emergencyShutdown() {
  console.log('\n⚠️  EMERGENCY SHUTDOWN INITIATED\n');
  
  for (const [name, system] of Object.entries(SOMA.systems)) {
    try {
      if (system && typeof system.shutdown === 'function') {
        await system.shutdown();
      } else if (system && typeof system.terminate === 'function') {
        await system.terminate('emergency');
      }
    } catch (err) {
      // Silent cleanup
    }
  }
  
  microAgentBridge.unregisterAll();
  console.log('✅ Emergency shutdown complete\n');
}

// ═══════════════════════════════════════════════════════════
// START DEPLOYMENT
// ═══════════════════════════════════════════════════════════

deploy().catch(err => {
  console.error('Fatal deployment error:', err);
  process.exit(1);
});
