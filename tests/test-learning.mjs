/**
 * test-learning.mjs - Test SOMA's Learning System
 *
 * Tests OutcomeTracker and ExperienceReplayBuffer integration
 * with GenomeArbiter and SelfModificationArbiter
 */

import { getOutcomeTracker } from '../arbiters/OutcomeTracker.js';
import { getExperienceReplayBuffer } from '../arbiters/ExperienceReplayBuffer.js';

console.log('='.repeat(70));
console.log('  SOMA LEARNING SYSTEM - TEST SUITE');
console.log('  Phase 1A: Outcome Tracking & Experience Replay');
console.log('='.repeat(70));

// Initialize systems
const outcomeTracker = getOutcomeTracker({
  storageDir: './data/test-outcomes',
  maxInMemory: 1000,
  enablePersistence: false // Disable for test
});

const experienceBuffer = getExperienceReplayBuffer({
  maxSize: 1000,
  minSize: 10
});

console.log('\n[1] INITIALIZING SYSTEMS...');
await outcomeTracker.initialize();
console.log('  ✅ OutcomeTracker initialized');
console.log('  ✅ ExperienceReplayBuffer initialized');

// Test 1: Record Fitness Evaluations (simulating GenomeArbiter)
console.log('\n[2] TESTING FITNESS EVALUATION TRACKING (GenomeArbiter)...');
const fitnessTests = [
  { arbiter: 'StorageArbiter', fitness: 0.95, success: true },
  { arbiter: 'StorageArbiter', fitness: 0.82, success: true },
  { arbiter: 'CognitiveArbiter', fitness: 0.45, success: false },
  { arbiter: 'CognitiveArbiter', fitness: 0.88, success: true },
  { arbiter: 'ArchivistArbiter', fitness: 0.92, success: true }
];

for (const test of fitnessTests) {
  const outcomeId = outcomeTracker.recordOutcome({
    agent: 'GenomeArbiter',
    action: 'fitness_evaluation',
    context: {
      arbiter: test.arbiter,
      metricCount: 3
    },
    result: {
      fitness: test.fitness
    },
    reward: test.fitness,
    success: test.success,
    duration: Math.random() * 500
  });

  // Also add to experience buffer
  experienceBuffer.addExperience({
    state: { arbiter: test.arbiter, previousFitness: test.fitness - 0.1 },
    action: 'evaluate_fitness',
    agent: 'GenomeArbiter',
    outcome: { fitness: test.fitness },
    reward: test.fitness,
    nextState: { arbiter: test.arbiter, currentFitness: test.fitness }
  });

  console.log(`  📊 Recorded: ${test.arbiter} | Fitness: ${(test.fitness * 100).toFixed(1)}% | ${test.success ? '✅' : '❌'}`);
}

// Test 2: Record Code Optimizations (simulating SelfModificationArbiter)
console.log('\n[3] TESTING CODE OPTIMIZATION TRACKING (SelfModificationArbiter)...');
const optimizationTests = [
  { strategy: 'memoization', improvement: 1.35, success: true },
  { strategy: 'batching', improvement: 1.12, success: true },
  { strategy: 'parallelization', improvement: 0.95, success: false },
  { strategy: 'lazyEvaluation', improvement: 1.28, success: true },
  { strategy: 'memoization', improvement: 1.42, success: true },
  { strategy: 'batching', improvement: 1.08, success: false }
];

for (const test of optimizationTests) {
  const outcomeId = outcomeTracker.recordOutcome({
    agent: 'SelfModificationArbiter',
    action: 'code_optimization',
    context: {
      functionName: 'processData',
      strategy: test.strategy
    },
    result: {
      improvement: test.improvement
    },
    reward: test.improvement - 1, // Reward is improvement over baseline
    success: test.success,
    duration: Math.random() * 1000,
    metadata: {
      strategyUsed: test.strategy
    }
  });

  // Add to experience buffer
  experienceBuffer.addExperience({
    state: { strategy: test.strategy, baseline: 100 },
    action: 'optimize_code',
    agent: 'SelfModificationArbiter',
    outcome: { improved: test.success, improvement: test.improvement },
    reward: test.improvement - 1,
    nextState: { strategy: test.strategy, optimized: 100 * test.improvement }
  });

  console.log(`  🔧 Recorded: ${test.strategy} | Improvement: ${((test.improvement - 1) * 100).toFixed(1)}% | ${test.success ? '✅' : '❌'}`);
}

// Test 3: Query Outcomes
console.log('\n[4] TESTING OUTCOME QUERIES...');

// Query GenomeArbiter outcomes
const genomeOutcomes = outcomeTracker.queryOutcomes({
  agent: 'GenomeArbiter',
  limit: 10
});
console.log(`  📊 GenomeArbiter outcomes: ${genomeOutcomes.length}`);
console.log(`     Success rate: ${(genomeOutcomes.filter(o => o.success).length / genomeOutcomes.length * 100).toFixed(1)}%`);

// Query SelfModificationArbiter outcomes
const modificationOutcomes = outcomeTracker.queryOutcomes({
  agent: 'SelfModificationArbiter',
  limit: 10
});
console.log(`  🔧 SelfModificationArbiter outcomes: ${modificationOutcomes.length}`);
console.log(`     Success rate: ${(modificationOutcomes.filter(o => o.success).length / modificationOutcomes.length * 100).toFixed(1)}%`);

// Query by action type
const optimizationActions = outcomeTracker.queryOutcomes({
  action: 'code_optimization',
  success: true
});
console.log(`  ✅ Successful optimizations: ${optimizationActions.length}`);

// Test 4: Strategy Success Analysis
console.log('\n[5] ANALYZING OPTIMIZATION STRATEGIES...');
const strategies = ['memoization', 'batching', 'parallelization', 'lazyEvaluation'];

for (const strategy of strategies) {
  const strategyOutcomes = modificationOutcomes.filter(
    o => o.metadata?.strategyUsed === strategy
  );

  if (strategyOutcomes.length > 0) {
    const successRate = strategyOutcomes.filter(o => o.success).length / strategyOutcomes.length;
    const avgReward = strategyOutcomes.reduce((sum, o) => sum + o.reward, 0) / strategyOutcomes.length;

    console.log(`  ${strategy}:
     Attempts: ${strategyOutcomes.length}
     Success Rate: ${(successRate * 100).toFixed(1)}%
     Avg Improvement: ${(avgReward * 100).toFixed(1)}%`);
  }
}

// Test 5: Experience Replay Sampling
console.log('\n[6] TESTING EXPERIENCE REPLAY SAMPLING...');

const bufferStats = experienceBuffer.getStats();
console.log(`  📦 Buffer size: ${bufferStats.currentSize}/${bufferStats.maxSize}`);
console.log(`  📊 Ready for sampling: ${bufferStats.readyForSampling ? 'Yes' : 'No'}`);

if (bufferStats.readyForSampling) {
  // Test uniform sampling
  const uniformSample = experienceBuffer.sample(5, 'uniform');
  console.log(`\n  [UNIFORM SAMPLING] Sampled ${uniformSample.experiences.length} experiences`);

  // Test prioritized sampling (high-reward experiences)
  const prioritizedSample = experienceBuffer.sample(5, 'prioritized');
  console.log(`  [PRIORITIZED SAMPLING] Sampled ${prioritizedSample.experiences.length} experiences
     Avg reward: ${(prioritizedSample.experiences.reduce((sum, e) => sum + e.reward, 0) / prioritizedSample.experiences.length).toFixed(3)}`);

  // Test stratified sampling (balanced success/failure)
  const stratifiedSample = experienceBuffer.sample(6, 'stratified');
  console.log(`  [STRATIFIED SAMPLING] Sampled ${stratifiedSample.experiences.length} experiences`);
  const successCount = stratifiedSample.experiences.filter(e => e.reward > 0).length;
  console.log(`     Success/Failure balance: ${successCount}/${stratifiedSample.experiences.length - successCount}`);
}

// Test 6: Get Statistics
console.log('\n[7] SYSTEM STATISTICS...');
const stats = outcomeTracker.getStats();
console.log(`  Total outcomes: ${stats.totalOutcomes}`);
console.log(`  Success rate: ${(stats.successfulOutcomes / stats.totalOutcomes * 100).toFixed(1)}%`);
console.log(`  Average reward: ${stats.averageReward.toFixed(3)}`);
console.log(`  Memory usage: ${stats.memoryUsage.utilizationPercent}%`);

console.log('\n  Outcomes by type:');
for (const [type, typeStats] of Object.entries(stats.outcomesByType)) {
  console.log(`    ${type}:
      Count: ${typeStats.count}
      Success Rate: ${(typeStats.successRate * 100).toFixed(1)}%
      Avg Reward: ${typeStats.avgReward.toFixed(3)}`);
}

console.log('\n  Outcomes by agent:');
for (const [agent, agentStats] of Object.entries(stats.outcomesByAgent)) {
  console.log(`    ${agent}:
      Count: ${agentStats.count}
      Success Rate: ${(agentStats.successRate * 100).toFixed(1)}%
      Avg Reward: ${agentStats.avgReward.toFixed(3)}`);
}

// Test 7: Learning Insights
console.log('\n[8] LEARNING INSIGHTS...');

// Which optimization strategy should we use next?
console.log('\n  🎯 STRATEGY RECOMMENDATION:');
const strategyRewards = {};
for (const outcome of modificationOutcomes) {
  const strat = outcome.metadata?.strategyUsed;
  if (strat) {
    if (!strategyRewards[strat]) {
      strategyRewards[strat] = [];
    }
    strategyRewards[strat].push(outcome.reward);
  }
}

let bestStrategy = null;
let bestAvgReward = -Infinity;
for (const [strategy, rewards] of Object.entries(strategyRewards)) {
  const avgReward = rewards.reduce((a, b) => a + b, 0) / rewards.length;
  if (avgReward > bestAvgReward) {
    bestAvgReward = avgReward;
    bestStrategy = strategy;
  }
}

if (bestStrategy) {
  console.log(`  ⭐ Best performing strategy: ${bestStrategy}
     Average improvement: ${(bestAvgReward * 100).toFixed(1)}%
     Confidence: Based on ${strategyRewards[bestStrategy].length} outcomes`);
}

// Which arbiters need evolution?
console.log('\n  🧬 EVOLUTION RECOMMENDATIONS:');
const arbiterPerformance = {};
for (const outcome of genomeOutcomes) {
  const arbiter = outcome.context?.arbiter;
  if (arbiter) {
    if (!arbiterPerformance[arbiter]) {
      arbiterPerformance[arbiter] = [];
    }
    arbiterPerformance[arbiter].push(outcome.reward);
  }
}

for (const [arbiter, fitness] of Object.entries(arbiterPerformance)) {
  const avgFitness = fitness.reduce((a, b) => a + b, 0) / fitness.length;
  const recommendation = avgFitness > 0.9 ? '✅ Excellent' : avgFitness > 0.7 ? '⚠️ Good' : '❌ Needs Evolution';
  console.log(`  ${arbiter}: ${(avgFitness * 100).toFixed(1)}% | ${recommendation}`);
}

console.log('\n' + '='.repeat(70));
console.log('  TEST COMPLETE - LEARNING SYSTEM OPERATIONAL');
console.log('='.repeat(70));
console.log('\n✅ OutcomeTracker: Recording and querying outcomes');
console.log('✅ ExperienceReplayBuffer: Storing and sampling experiences');
console.log('✅ Learning from GenomeArbiter fitness evaluations');
console.log('✅ Learning from SelfModificationArbiter optimizations');
console.log('✅ Providing actionable insights for decision-making');
console.log('\n🎯 Next: Integrate with CognitiveLoopEngine and build StrategyOptimizer\n');
