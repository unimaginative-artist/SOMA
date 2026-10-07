// ═══════════════════════════════════════════════════════════
// SOMA ASI BENCHMARK SUITE
// Comprehensive performance testing of all 9 systems
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
console.log('║                        SOMA ASI BENCHMARK SUITE                                ║');
console.log('║                  Performance Testing All 9 Systems                             ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
console.log('');

const BENCHMARK_CONFIG = {
  // Test parameters
  learningTasks: 100,          // Number of learning tasks to deploy
  agentRequests: 50,           // Requests per agent
  impulseTasks: 200,           // Tasks for UniversalImpulser
  selfModAttempts: 10,         // Code optimization attempts
  
  // Load testing
  concurrentWorkers: 8,
  stressDuration: 30000,       // 30 seconds stress test
  
  // Timing
  warmupTime: 2000,
  cooldownTime: 1000
};

const RESULTS = {
  initialization: {},
  integration: {},
  distributedLearning: {},
  agentCoordination: {},
  impulseProcessing: {},
  selfModification: {},
  stressTest: {},
  overall: {}
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
  return (bytes / 1024).toFixed(2) + ' KB';
}

function formatDuration(ms) {
  return ms.toFixed(2) + 'ms';
}

async function runBenchmark() {
  const systems = {
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
  };

  const startTime = Date.now();

  try {
    // ═══════════════════════════════════════════════════════════
    // BENCHMARK 1: INITIALIZATION PERFORMANCE
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('[BENCHMARK 1] ⚡ INITIALIZATION PERFORMANCE');
    console.log('═'.repeat(80));
    console.log('');

    const initStart = Date.now();
    const initTimes = {};

    // Support systems
    let t = Date.now();
    systems.timekeeper = new TimekeeperArbiter({ name: 'TimekeeperArbiter' });
    await systems.timekeeper.initialize();
    initTimes.timekeeper = Date.now() - t;
    console.log(`  ✓ TimekeeperArbiter: ${formatDuration(initTimes.timekeeper)}`);

    t = Date.now();
    systems.impulser = new UniversalImpulser({ 
      name: 'UniversalImpulser',
      maxConcurrent: 10,
      maxQueue: 1000
    });
    await systems.impulser.initialize();
    initTimes.impulser = Date.now() - t;
    console.log(`  ✓ UniversalImpulser: ${formatDuration(initTimes.impulser)}`);

    // Learning systems
    t = Date.now();
    systems.velocityTracker = new LearningVelocityTracker({ name: 'LearningVelocityTracker' });
    await systems.velocityTracker.initialize();
    initTimes.velocityTracker = Date.now() - t;
    console.log(`  ✓ LearningVelocityTracker: ${formatDuration(initTimes.velocityTracker)}`);

    t = Date.now();
    systems.edgeWorker = new EdgeWorkerOrchestrator({ 
      name: 'EdgeWorkerOrchestrator',
      maxWorkers: BENCHMARK_CONFIG.concurrentWorkers
    });
    await systems.edgeWorker.initialize();
    initTimes.edgeWorker = Date.now() - t;
    console.log(`  ✓ EdgeWorkerOrchestrator: ${formatDuration(initTimes.edgeWorker)}`);

    // Agents
    t = Date.now();
    systems.black = new BlackAgent({ name: 'BlackAgent' });
    await systems.black.initialize();
    microAgentBridge.registerAgent('BlackAgent', systems.black);
    initTimes.black = Date.now() - t;
    console.log(`  ✓ BlackAgent: ${formatDuration(initTimes.black)}`);

    t = Date.now();
    systems.jetstream = new JetstreamAgent({ name: 'JetstreamAgent' });
    await systems.jetstream.initialize();
    microAgentBridge.registerAgent('JetstreamAgent', systems.jetstream);
    initTimes.jetstream = Date.now() - t;
    console.log(`  ✓ JetstreamAgent: ${formatDuration(initTimes.jetstream)}`);

    t = Date.now();
    systems.kuze = new KuzeAgent({ name: 'KuzeAgent' });
    await systems.kuze.initialize();
    microAgentBridge.registerAgent('KuzeAgent', systems.kuze);
    initTimes.kuze = Date.now() - t;
    console.log(`  ✓ KuzeAgent: ${formatDuration(initTimes.kuze)}`);

    t = Date.now();
    systems.batou = new BatouAgent({ name: 'BatouAgent' });
    await systems.batou.initialize();
    microAgentBridge.registerAgent('BatouAgent', systems.batou);
    initTimes.batou = Date.now() - t;
    console.log(`  ✓ BatouAgent: ${formatDuration(initTimes.batou)}`);

    // Meta systems
    t = Date.now();
    systems.selfMod = new SelfModificationArbiter({ 
      name: 'SelfModificationArbiter',
      sandboxMode: true,
      requireApproval: false
    });
    await systems.selfMod.initialize();
    initTimes.selfMod = Date.now() - t;
    console.log(`  ✓ SelfModificationArbiter: ${formatDuration(initTimes.selfMod)}`);

    t = Date.now();
    systems.orchestrator = new ASIOrchestrator({ name: 'ASIOrchestrator' });
    await systems.orchestrator.initialize();
    initTimes.orchestrator = Date.now() - t;
    console.log(`  ✓ ASIOrchestrator: ${formatDuration(initTimes.orchestrator)}`);

    const totalInitTime = Date.now() - initStart;
    RESULTS.initialization = {
      total: totalInitTime,
      perSystem: initTimes,
      avgPerSystem: totalInitTime / 9
    };

    console.log('');
    console.log(`  📊 Total Initialization: ${formatDuration(totalInitTime)}`);
    console.log(`  📈 Average per system: ${formatDuration(totalInitTime / 9)}`);
    console.log('');

    // Warmup
    console.log(`⏳ Warming up systems (${BENCHMARK_CONFIG.warmupTime}ms)...`);
    await sleep(BENCHMARK_CONFIG.warmupTime);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // BENCHMARK 2: INTEGRATION SPEED
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('[BENCHMARK 2] 🔗 INTEGRATION SPEED');
    console.log('═'.repeat(80));
    console.log('');

    const integrationStart = Date.now();
    const integration = await systems.orchestrator.handleMessage({
      type: 'start_integration',
      payload: {}
    });
    const integrationTime = Date.now() - integrationStart;

    RESULTS.integration = {
      duration: integrationTime,
      systemsOnline: integration.systemsOnline,
      synergies: integration.results.phase4?.synergiesEstablished || 0,
      success: integration.success
    };

    console.log(`  ✓ Integration complete: ${formatDuration(integrationTime)}`);
    console.log(`  📊 Systems online: ${integration.systemsOnline}/9`);
    console.log(`  🔗 Synergies: ${integration.results.phase4?.synergiesEstablished || 0}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // BENCHMARK 3: DISTRIBUTED LEARNING THROUGHPUT
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('[BENCHMARK 3] 🧠 DISTRIBUTED LEARNING THROUGHPUT');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`  Deploying ${BENCHMARK_CONFIG.learningTasks} tasks...`);

    const learningStart = Date.now();
    const learningPromises = [];
    let learningSuccesses = 0;
    let learningFailures = 0;

    for (let i = 0; i < BENCHMARK_CONFIG.learningTasks; i++) {
      const promise = systems.edgeWorker.handleMessage({
        type: 'deploy_learning_task',
        payload: {
          taskId: `benchmark_task_${i}`,
          type: ['pattern_recognition', 'code_optimization', 'neural_networks'][i % 3],
          priority: i % 5 === 0 ? 'high' : 'normal'
        }
      }).then(() => learningSuccesses++).catch(() => learningFailures++);
      
      learningPromises.push(promise);
    }

    await Promise.all(learningPromises);
    const learningTime = Date.now() - learningStart;

    // Get final status
    await sleep(2000); // Let consolidation happen
    const velocityStatus = await systems.velocityTracker.handleMessage({
      type: 'velocity_query',
      payload: {}
    });

    RESULTS.distributedLearning = {
      totalTasks: BENCHMARK_CONFIG.learningTasks,
      duration: learningTime,
      throughput: (BENCHMARK_CONFIG.learningTasks / (learningTime / 1000)).toFixed(2),
      successes: learningSuccesses,
      failures: learningFailures,
      successRate: ((learningSuccesses / BENCHMARK_CONFIG.learningTasks) * 100).toFixed(2),
      velocity: velocityStatus.velocity || 0,
      knowledgeBase: velocityStatus.knowledgeBase || 0
    };

    console.log(`  ✓ Completed in: ${formatDuration(learningTime)}`);
    console.log(`  📊 Throughput: ${RESULTS.distributedLearning.throughput} tasks/sec`);
    console.log(`  ✅ Success rate: ${RESULTS.distributedLearning.successRate}%`);
    console.log(`  ⚡ Learning velocity: ${typeof RESULTS.distributedLearning.velocity === 'number' ? RESULTS.distributedLearning.velocity.toFixed(2) : RESULTS.distributedLearning.velocity}x`);
    console.log(`  💾 Knowledge base: ${formatBytes(velocityStatus.knowledgeBase || 0)}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // BENCHMARK 4: AGENT COORDINATION LATENCY
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('[BENCHMARK 4] 🤖 AGENT COORDINATION LATENCY');
    console.log('═'.repeat(80));
    console.log('');

    const agents = [
      { name: 'BlackAgent', agent: systems.black, taskType: 'scan' },
      { name: 'JetstreamAgent', agent: systems.jetstream, taskType: 'diagnostics' },
      { name: 'KuzeAgent', agent: systems.kuze, taskType: 'pattern-detect' },
      { name: 'BatouAgent', agent: systems.batou, taskType: 'scan-threats' }
    ];

    const agentResults = {};

    for (const { name, agent, taskType } of agents) {
      console.log(`  Testing ${name}...`);
      
      const latencies = [];
      let successes = 0;
      
      for (let i = 0; i < BENCHMARK_CONFIG.agentRequests; i++) {
        const start = Date.now();
        try {
          // Format task data based on agent type
          let taskPayload = { target: `benchmark_${i}` };
          
          if (name === 'KuzeAgent') {
            // Kuze needs events array for pattern detection
            taskPayload = {
              events: [
                { type: 'test', timestamp: Date.now() - 1000, value: Math.random() },
                { type: 'test', timestamp: Date.now() - 500, value: Math.random() },
                { type: 'test', timestamp: Date.now(), value: Math.random() }
              ],
              context: 'benchmark'
            };
          } else if (name === 'BatouAgent') {
            // Batou scan options
            taskPayload = { scope: 'system' };
          }
          
          await agent.executeTask({
            type: taskType,
            payload: taskPayload
          });
          latencies.push(Date.now() - start);
          successes++;
        } catch (err) {
          latencies.push(Date.now() - start);
        }
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const minLatency = Math.min(...latencies);
      const maxLatency = Math.max(...latencies);

      agentResults[name] = {
        requests: BENCHMARK_CONFIG.agentRequests,
        successes,
        avgLatency,
        minLatency,
        maxLatency
      };

      console.log(`    ✓ Avg latency: ${formatDuration(avgLatency)}`);
      console.log(`    📊 Min: ${formatDuration(minLatency)} | Max: ${formatDuration(maxLatency)}`);
      console.log(`    ✅ Success: ${successes}/${BENCHMARK_CONFIG.agentRequests}`);
    }

    RESULTS.agentCoordination = agentResults;
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // BENCHMARK 5: IMPULSE PROCESSING SPEED
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('[BENCHMARK 5] 🧠 IMPULSE PROCESSING SPEED');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`  Processing ${BENCHMARK_CONFIG.impulseTasks} tasks...`);

    const impulseStart = Date.now();
    const impulsePromises = [];

    for (let i = 0; i < BENCHMARK_CONFIG.impulseTasks; i++) {
      const types = ['categorize', 'summarize', 'index', 'relate', 'quality', 'dedupe'];
      const type = types[i % types.length];
      
      impulsePromises.push(
        systems.impulser.addTask({
          type,
          data: {
            article: {
              title: `Benchmark Article ${i}`,
              content: `This is test content for benchmark ${i}. `.repeat(20)
            }
          }
        })
      );
    }

    await Promise.all(impulsePromises);
    await sleep(3000); // Let processing complete

    const impulseTime = Date.now() - impulseStart;
    const impulseStatus = systems.impulser.getStatus();

    RESULTS.impulseProcessing = {
      totalTasks: BENCHMARK_CONFIG.impulseTasks,
      duration: impulseTime,
      throughput: (BENCHMARK_CONFIG.impulseTasks / (impulseTime / 1000)).toFixed(2),
      processed: impulseStatus.state.totalProcessed,
      errors: impulseStatus.state.totalErrors,
      queueSize: impulseStatus.state.queueSize
    };

    console.log(`  ✓ Completed in: ${formatDuration(impulseTime)}`);
    console.log(`  📊 Throughput: ${RESULTS.impulseProcessing.throughput} tasks/sec`);
    console.log(`  ✅ Processed: ${impulseStatus.state.totalProcessed}`);
    console.log(`  ❌ Errors: ${impulseStatus.state.totalErrors}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // BENCHMARK 6: SELF-MODIFICATION PERFORMANCE
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('[BENCHMARK 6] 🧬 SELF-MODIFICATION PERFORMANCE');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`  Running ${BENCHMARK_CONFIG.selfModAttempts} optimization cycles...`);

    const selfModStart = Date.now();
    let optimizations = 0;
    let improvements = 0;

    for (let i = 0; i < BENCHMARK_CONFIG.selfModAttempts; i++) {
      try {
        const result = await systems.selfMod.handleMessage({
          type: 'optimize_function',
          payload: {
            filepath: 'arbiters/LearningVelocityTracker.cjs',
            functionName: 'consolidateKnowledge',
            strategy: ['memoization', 'batching', 'parallelization'][i % 3]
          }
        });
        
        if (result.success) {
          optimizations++;
          if (result.deployed) improvements++;
        }
      } catch (err) {
        // Count attempt
      }
    }

    const selfModTime = Date.now() - selfModStart;
    const selfModStatus = systems.selfMod.getStatus();

    RESULTS.selfModification = {
      attempts: BENCHMARK_CONFIG.selfModAttempts,
      duration: selfModTime,
      avgPerOptimization: selfModTime / BENCHMARK_CONFIG.selfModAttempts,
      successful: optimizations,
      deployed: improvements,
      successRate: ((optimizations / BENCHMARK_CONFIG.selfModAttempts) * 100).toFixed(2),
      totalMods: selfModStatus.metrics.totalModifications
    };

    console.log(`  ✓ Completed in: ${formatDuration(selfModTime)}`);
    console.log(`  📊 Avg per optimization: ${formatDuration(selfModTime / BENCHMARK_CONFIG.selfModAttempts)}`);
    console.log(`  ✅ Success rate: ${RESULTS.selfModification.successRate}%`);
    console.log(`  🚀 Deployed improvements: ${improvements}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // BENCHMARK 7: STRESS TEST
    // ═══════════════════════════════════════════════════════════
    console.log('═'.repeat(80));
    console.log('[BENCHMARK 7] 🔥 STRESS TEST (30 seconds)');
    console.log('═'.repeat(80));
    console.log('');
    console.log('  Running high-load concurrent operations...');

    const stressStart = Date.now();
    const stressEnd = stressStart + BENCHMARK_CONFIG.stressDuration;
    let stressTasks = 0;
    let stressErrors = 0;

    while (Date.now() < stressEnd) {
      const promises = [];
      
      // Learning tasks
      for (let i = 0; i < 5; i++) {
        promises.push(
          systems.edgeWorker.handleMessage({
            type: 'deploy_learning_task',
            payload: { taskId: `stress_${stressTasks++}`, type: 'pattern_recognition' }
          }).catch(() => stressErrors++)
        );
      }

      // Agent tasks
      promises.push(
        systems.black.executeTask({ type: 'scan', payload: { target: 'stress' } }).catch(() => stressErrors++)
      );

      // Impulse tasks
      promises.push(
        systems.impulser.addTask({
          type: 'categorize',
          data: { article: { title: 'Stress', content: 'Test' } }
        }).catch(() => stressErrors++)
      );

      await Promise.all(promises);
      await sleep(100);
    }

    const stressTime = Date.now() - stressStart;
    const finalReport = await systems.orchestrator.handleMessage({
      type: 'performance_report',
      payload: {}
    });

    RESULTS.stressTest = {
      duration: stressTime,
      totalTasks: stressTasks,
      errors: stressErrors,
      throughput: (stressTasks / (stressTime / 1000)).toFixed(2),
      systemHealth: finalReport.performance.systemHealth,
      systemsOnline: finalReport.asi.systemsOnline
    };

    console.log(`  ✓ Stress test complete: ${formatDuration(stressTime)}`);
    console.log(`  📊 Total operations: ${stressTasks}`);
    console.log(`  📈 Throughput: ${RESULTS.stressTest.throughput} ops/sec`);
    console.log(`  ❌ Errors: ${stressErrors}`);
    console.log(`  💚 System health: ${finalReport.performance.systemHealth}%`);
    console.log(`  🟢 Systems online: ${finalReport.asi.systemsOnline}/9`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // FINAL RESULTS
    // ═══════════════════════════════════════════════════════════
    
    const totalTime = Date.now() - startTime;
    RESULTS.overall = {
      totalDuration: totalTime,
      systemsOnline: finalReport.asi.systemsOnline,
      finalHealth: finalReport.performance.systemHealth,
      timestamp: new Date().toISOString()
    };

    console.log('═'.repeat(80));
    console.log('                         BENCHMARK RESULTS SUMMARY');
    console.log('═'.repeat(80));
    console.log('');
    console.log('📊 INITIALIZATION');
    console.log(`   Total: ${formatDuration(RESULTS.initialization.total)}`);
    console.log(`   Average per system: ${formatDuration(RESULTS.initialization.avgPerSystem)}`);
    console.log('');
    console.log('🔗 INTEGRATION');
    console.log(`   Duration: ${formatDuration(RESULTS.integration.duration)}`);
    console.log(`   Systems: ${RESULTS.integration.systemsOnline}/9`);
    console.log(`   Synergies: ${RESULTS.integration.synergies}`);
    console.log('');
    console.log('🧠 DISTRIBUTED LEARNING');
    console.log(`   Tasks: ${RESULTS.distributedLearning.totalTasks}`);
    console.log(`   Throughput: ${RESULTS.distributedLearning.throughput} tasks/sec`);
    console.log(`   Success rate: ${RESULTS.distributedLearning.successRate}%`);
    console.log(`   Learning velocity: ${typeof RESULTS.distributedLearning.velocity === 'number' ? RESULTS.distributedLearning.velocity.toFixed(2) : RESULTS.distributedLearning.velocity}x`);
    console.log('');
    console.log('🤖 AGENT COORDINATION');
    for (const [name, data] of Object.entries(RESULTS.agentCoordination)) {
      console.log(`   ${name}: ${formatDuration(data.avgLatency)} avg latency`);
    }
    console.log('');
    console.log('🧠 IMPULSE PROCESSING');
    console.log(`   Tasks: ${RESULTS.impulseProcessing.totalTasks}`);
    console.log(`   Throughput: ${RESULTS.impulseProcessing.throughput} tasks/sec`);
    console.log(`   Errors: ${RESULTS.impulseProcessing.errors}`);
    console.log('');
    console.log('🧬 SELF-MODIFICATION');
    console.log(`   Attempts: ${RESULTS.selfModification.attempts}`);
    console.log(`   Success rate: ${RESULTS.selfModification.successRate}%`);
    console.log(`   Avg per optimization: ${formatDuration(RESULTS.selfModification.avgPerOptimization)}`);
    console.log('');
    console.log('🔥 STRESS TEST');
    console.log(`   Duration: ${formatDuration(RESULTS.stressTest.duration)}`);
    console.log(`   Operations: ${RESULTS.stressTest.totalTasks}`);
    console.log(`   Throughput: ${RESULTS.stressTest.throughput} ops/sec`);
    console.log(`   Final health: ${RESULTS.stressTest.systemHealth}%`);
    console.log('');
    console.log('═'.repeat(80));
    console.log(`🎯 TOTAL BENCHMARK TIME: ${formatDuration(totalTime)}`);
    console.log(`✅ FINAL SYSTEM HEALTH: ${RESULTS.overall.finalHealth}%`);
    console.log(`🟢 SYSTEMS OPERATIONAL: ${RESULTS.overall.systemsOnline}/9`);
    console.log('═'.repeat(80));
    console.log('');

    // Cleanup
    console.log('🔄 Shutting down systems...');
    await systems.orchestrator.shutdown();
    await systems.selfMod.shutdown();
    microAgentBridge.unregisterAll();
    for (const agent of [systems.black, systems.jetstream, systems.kuze, systems.batou]) {
      await agent.terminate('benchmark_complete');
    }
    for (const system of [systems.timekeeper, systems.impulser, systems.velocityTracker, systems.edgeWorker]) {
      await system.shutdown();
    }
    
    console.log('✅ Benchmark complete\n');

  } catch (err) {
    console.error('\n❌ BENCHMARK ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run benchmark
runBenchmark().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
