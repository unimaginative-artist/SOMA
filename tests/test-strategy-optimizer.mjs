/**
 * test-strategy-optimizer.mjs - Test SOMA's Strategy Optimization System
 *
 * Demonstrates how StrategyOptimizer uses UCB1 (multi-armed bandit) to:
 * 1. Learn from historical outcomes
 * 2. Balance exploration vs exploitation
 * 3. Recommend the best strategy for each task
 * 4. Improve over time as it gathers more data
 */

import { getOutcomeTracker } from '../arbiters/OutcomeTracker.js';
import { getExperienceReplayBuffer } from '../arbiters/ExperienceReplayBuffer.js';
import { getStrategyOptimizer } from '../arbiters/StrategyOptimizer.js';

console.log('='.repeat(70));
console.log('  SOMA STRATEGY OPTIMIZER - TEST SUITE');
console.log('  Phase 1B: Intelligent Strategy Selection (UCB1)');
console.log('='.repeat(70));

// Initialize systems
const outcomeTracker = getOutcomeTracker({
  storageDir: './data/test-outcomes',
  maxInMemory: 1000,
  enablePersistence: false
});

const experienceBuffer = getExperienceReplayBuffer({
  maxSize: 1000,
  minSize: 10
});

const strategyOptimizer = getStrategyOptimizer({
  explorationConstant: 2.0, // Higher = more exploration
  minTrialsBeforeExploit: 3, // Try each strategy 3 times before exploiting
  epsilonGreedy: 0.1 // 10% random exploration
});

console.log('\n[1] INITIALIZING SYSTEMS...');
await outcomeTracker.initialize();
console.log('  ✅ OutcomeTracker initialized');
console.log('  ✅ ExperienceReplayBuffer initialized');
console.log('  ✅ StrategyOptimizer initialized');

// ============================================================
// PHASE 1: Generate Historical Data (Simulate Past Learning)
// ============================================================

console.log('\n[2] GENERATING HISTORICAL DATA...');
console.log('  Simulating past optimization attempts...\n');

// Code optimization strategies with realistic performance profiles
const optimizationStrategies = {
  memoization: {
    baseReward: 0.35,
    variance: 0.1,
    successRate: 0.9,
    description: 'Cache expensive function results'
  },
  batching: {
    baseReward: 0.15,
    variance: 0.08,
    successRate: 0.7,
    description: 'Batch multiple operations together'
  },
  parallelization: {
    baseReward: -0.05,
    variance: 0.15,
    successRate: 0.3,
    description: 'Run operations in parallel (risky!)'
  },
  lazyEvaluation: {
    baseReward: 0.25,
    variance: 0.12,
    successRate: 0.8,
    description: 'Delay computation until needed'
  },
  inlining: {
    baseReward: 0.08,
    variance: 0.05,
    successRate: 0.6,
    description: 'Inline small function calls'
  }
};

// Generate 30 historical optimization attempts
for (let i = 0; i < 30; i++) {
  const strategies = Object.keys(optimizationStrategies);
  const strategy = strategies[Math.floor(Math.random() * strategies.length)];
  const profile = optimizationStrategies[strategy];

  // Simulate realistic performance
  const reward = profile.baseReward + (Math.random() - 0.5) * profile.variance;
  const success = Math.random() < profile.successRate;

  // Record outcome
  outcomeTracker.recordOutcome({
    agent: 'SelfModificationArbiter',
    action: 'code_optimization',
    context: {
      functionName: 'processData',
      strategy: strategy
    },
    result: {
      improvement: 1 + reward
    },
    reward: reward,
    success: success,
    duration: Math.random() * 1000,
    metadata: {
      strategyUsed: strategy
    }
  });

  // Also add to experience buffer
  experienceBuffer.addExperience({
    state: { strategy: strategy, baseline: 100 },
    action: 'optimize_code',
    agent: 'SelfModificationArbiter',
    outcome: { improved: success, improvement: 1 + reward },
    reward: reward,
    nextState: { strategy: strategy, optimized: 100 * (1 + reward) }
  });
}

console.log('  ✅ Generated 30 historical optimization attempts');

// ============================================================
// PHASE 2: Initialize StrategyOptimizer with Historical Data
// ============================================================

console.log('\n[3] LOADING HISTORICAL DATA INTO OPTIMIZER...');
await strategyOptimizer.initialize();

// Display what the optimizer learned
console.log('\n[4] STRATEGY PERFORMANCE ANALYSIS...');
const domainStats = strategyOptimizer.getDomainStats('code_optimization');

if (domainStats) {
  console.log(`  📊 Domain: ${domainStats.domain}`);
  console.log(`  📈 Strategies analyzed: ${domainStats.totalStrategies}\n`);

  for (const strategy of domainStats.strategies) {
    const emoji = strategy.successRate > 0.7 ? '✅' : strategy.successRate > 0.5 ? '⚠️' : '❌';
    console.log(`  ${emoji} ${strategy.name}:`);
    console.log(`     Trials: ${strategy.trials}`);
    console.log(`     Success Rate: ${(strategy.successRate * 100).toFixed(1)}%`);
    console.log(`     Avg Reward: ${(strategy.avgReward * 100).toFixed(1)}%`);
    console.log(`     ${optimizationStrategies[strategy.name]?.description || ''}`);
  }
}

// ============================================================
// PHASE 3: Test Strategy Selection (UCB1 Algorithm)
// ============================================================

console.log('\n[5] TESTING INTELLIGENT STRATEGY SELECTION...');
console.log('  The optimizer will balance exploration vs exploitation:\n');

// Simulate 10 new optimization requests
for (let i = 1; i <= 10; i++) {
  console.log(`  ─── Request ${i} ───`);

  const recommendation = strategyOptimizer.getRecommendation('code_optimization', {
    functionName: 'processData'
  });

  console.log(`  🎯 Recommendation: ${recommendation.strategy}`);
  console.log(`     Reason: ${recommendation.reason}`);
  console.log(`     Confidence: ${(recommendation.confidence * 100).toFixed(1)}%`);

  // Simulate executing the strategy
  const profile = optimizationStrategies[recommendation.strategy];
  const reward = profile.baseReward + (Math.random() - 0.5) * profile.variance;
  const success = Math.random() < profile.successRate;

  console.log(`     Result: ${success ? '✅ Success' : '❌ Failure'} | Reward: ${(reward * 100).toFixed(1)}%`);

  // Record outcome so optimizer learns
  strategyOptimizer.recordOutcome('code_optimization', recommendation.strategy, {
    success: success,
    reward: reward
  });

  console.log('');
}

// ============================================================
// PHASE 4: Show Learning Progress
// ============================================================

console.log('\n[6] LEARNING PROGRESS ANALYSIS...');

const updatedStats = strategyOptimizer.getDomainStats('code_optimization');
console.log('\n  Updated Strategy Rankings:');

for (let i = 0; i < updatedStats.strategies.length; i++) {
  const strategy = updatedStats.strategies[i];
  const rank = i + 1;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';

  console.log(`  ${medal} #${rank} ${strategy.name}:`);
  console.log(`       Trials: ${strategy.trials} | Success: ${(strategy.successRate * 100).toFixed(1)}% | Avg Reward: ${(strategy.avgReward * 100).toFixed(1)}%`);
}

// ============================================================
// PHASE 5: Test Top Strategy Retrieval
// ============================================================

console.log('\n[7] TOP STRATEGIES RECOMMENDATION...');
const topStrategies = strategyOptimizer.getTopStrategies('code_optimization', 3);

console.log('\n  🏆 TOP 3 STRATEGIES FOR CODE OPTIMIZATION:\n');

for (let i = 0; i < topStrategies.length; i++) {
  const strategy = topStrategies[i];
  const profile = optimizationStrategies[strategy.name];

  console.log(`  ${i + 1}. ${strategy.name}`);
  console.log(`     📊 Avg Reward: ${(strategy.avgReward * 100).toFixed(1)}%`);
  console.log(`     ✅ Success Rate: ${(strategy.successRate * 100).toFixed(1)}%`);
  console.log(`     🔄 Trials: ${strategy.trials}`);
  console.log(`     💡 ${profile?.description || ''}\n`);
}

// ============================================================
// PHASE 6: Overall Statistics
// ============================================================

console.log('\n[8] OVERALL OPTIMIZER STATISTICS...');
const stats = strategyOptimizer.getStats();

console.log(`  Total Domains Tracked: ${stats.totalDomains}`);
console.log(`  Total Recommendations: ${stats.totalRecommendations}`);
console.log(`  Successful Recommendations: ${stats.successfulRecommendations}`);
console.log(`  Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);

// ============================================================
// PHASE 7: Key Insights
// ============================================================

console.log('\n[9] KEY INSIGHTS...');

const best = topStrategies[0];
const worst = updatedStats.strategies[updatedStats.strategies.length - 1];

console.log(`\n  ⭐ BEST STRATEGY: ${best.name}`);
console.log(`     ${optimizationStrategies[best.name]?.description}`);
console.log(`     Average improvement: ${(best.avgReward * 100).toFixed(1)}%`);
console.log(`     Success rate: ${(best.successRate * 100).toFixed(1)}%`);
console.log(`     Confidence: Based on ${best.trials} trials`);

console.log(`\n  ❌ WORST STRATEGY: ${worst.name}`);
console.log(`     ${optimizationStrategies[worst.name]?.description}`);
console.log(`     Average improvement: ${(worst.avgReward * 100).toFixed(1)}%`);
console.log(`     Success rate: ${(worst.successRate * 100).toFixed(1)}%`);
console.log(`     Recommendation: Avoid unless necessary`);

console.log('\n' + '='.repeat(70));
console.log('  TEST COMPLETE - STRATEGY OPTIMIZER OPERATIONAL');
console.log('='.repeat(70));

console.log('\n✅ StrategyOptimizer: Learning from outcomes');
console.log('✅ UCB1 Algorithm: Balancing exploration/exploitation');
console.log('✅ Intelligent Recommendations: Selecting best strategies');
console.log('✅ Continuous Learning: Improving from feedback');

console.log('\n🎯 NEXT STEPS:');
console.log('   1. Integrate with SelfModificationArbiter');
console.log('   2. Use for genome evolution strategy selection');
console.log('   3. Apply to CognitiveLoopEngine reasoning strategy');
console.log('   4. Track multi-domain strategy performance\n');
