/**
 * test-intelligent-optimization.mjs - Demonstrate SOMA Actually Using Learning
 *
 * This test shows:
 * 1. SelfModificationArbiter asks StrategyOptimizer which strategy to use
 * 2. StrategyOptimizer recommends based on past success
 * 3. Results are recorded back to improve future recommendations
 * 4. Over time, SOMA gets smarter about which strategies work best
 */

import { getOutcomeTracker } from '../arbiters/OutcomeTracker.js';
import { getStrategyOptimizer } from '../arbiters/StrategyOptimizer.js';

console.log('='.repeat(70));
console.log('  SOMA INTELLIGENT DECISION-MAKING DEMO');
console.log('  Showing: SOMA Actually Uses Learning to Make Choices');
console.log('='.repeat(70));

// Initialize systems
const outcomeTracker = getOutcomeTracker({
  storageDir: './data/test-outcomes',
  maxInMemory: 1000,
  enablePersistence: false
});

const strategyOptimizer = getStrategyOptimizer();

console.log('\n[STEP 1] INITIALIZING LEARNING SYSTEMS...\n');
await outcomeTracker.initialize();
await strategyOptimizer.initialize();

console.log('  ✅ OutcomeTracker ready');
console.log('  ✅ StrategyOptimizer ready');

// Simulate historical learning data
console.log('\n[STEP 2] LOADING HISTORICAL DATA (Simulating past optimizations)...\n');

const historicalData = [
  { strategy: 'memoization', success: true, reward: 0.42 },
  { strategy: 'memoization', success: true, reward: 0.38 },
  { strategy: 'memoization', success: true, reward: 0.35 },
  { strategy: 'batching', success: true, reward: 0.15 },
  { strategy: 'batching', success: false, reward: -0.05 },
  { strategy: 'parallelization', success: false, reward: -0.12 },
  { strategy: 'parallelization', success: false, reward: -0.08 },
  { strategy: 'lazyEvaluation', success: true, reward: 0.28 },
];

for (const data of historicalData) {
  outcomeTracker.recordOutcome({
    agent: 'SelfModificationArbiter',
    action: 'code_optimization',
    context: { strategy: data.strategy },
    result: {},
    reward: data.reward,
    success: data.success,
    metadata: { strategyUsed: data.strategy }
  });

  strategyOptimizer.recordOutcome('code_optimization', data.strategy, {
    success: data.success,
    reward: data.reward
  });
}

// Reload optimizer with historical data
await strategyOptimizer.loadHistoricalData();

console.log('  📚 Loaded 8 historical optimization attempts');
console.log('  📊 StrategyOptimizer has learned from past experience\n');

// Show what the optimizer learned
const stats = strategyOptimizer.getDomainStats('code_optimization');
console.log('[STEP 3] WHAT SOMA LEARNED FROM HISTORY:\n');

for (const strategy of stats.strategies) {
  const emoji = strategy.successRate > 0.7 ? '✅' : strategy.successRate > 0.4 ? '⚠️' : '❌';
  console.log(`  ${emoji} ${strategy.name}:`);
  console.log(`     Success Rate: ${(strategy.successRate * 100).toFixed(0)}%`);
  console.log(`     Avg Reward: ${(strategy.avgReward * 100).toFixed(1)}%`);
  console.log(`     Trials: ${strategy.trials}`);
}

// Now simulate SOMA making intelligent decisions
console.log('\n' + '='.repeat(70));
console.log('[STEP 4] SOMA MAKES INTELLIGENT DECISIONS (Using Learning)\n');
console.log('='.repeat(70));

const availableStrategies = ['memoization', 'batching', 'parallelization', 'lazyEvaluation'];

console.log('\n  Scenario: SOMA needs to optimize a slow function\n');
console.log('  Question: Which optimization strategy should she use?\n');
console.log('  Available strategies:', availableStrategies.join(', '));
console.log('\n  SOMA asks StrategyOptimizer for recommendation...\n');

// Get recommendation
const recommendation = strategyOptimizer.getRecommendation(
  'code_optimization',
  { functionName: 'processData' },
  availableStrategies
);

console.log('  🧠 StrategyOptimizer Response:');
console.log(`     ⭐ RECOMMENDED: ${recommendation.strategy}`);
console.log(`     💡 REASON: ${recommendation.reason}`);
console.log(`     📊 CONFIDENCE: ${(recommendation.confidence * 100).toFixed(1)}%`);
console.log(`     📈 Expected success: ${(recommendation.stats.successRate * 100).toFixed(0)}%`);
console.log(`     💰 Expected reward: ${(recommendation.stats.avgReward * 100).toFixed(1)}%`);

console.log('\n  🎯 SOMA DECISION: Using "' + recommendation.strategy + '" (based on learning!)');

// Simulate execution and recording result
console.log('\n[STEP 5] EXECUTING OPTIMIZATION & LEARNING FROM RESULT...\n');

const executionSuccess = Math.random() < recommendation.stats.successRate;
const executionReward = executionSuccess
  ? recommendation.stats.avgReward + (Math.random() - 0.5) * 0.1
  : -0.1;

console.log(`  🔧 Applying "${recommendation.strategy}" optimization...`);
console.log(`  ⏱️  Testing performance...`);
console.log(`  ${executionSuccess ? '✅' : '❌'} Result: ${executionSuccess ? 'SUCCESS' : 'FAILED'}`);
console.log(`  💰 Reward: ${(executionReward * 100).toFixed(1)}%`);

// Record the outcome so SOMA learns
strategyOptimizer.recordOutcome('code_optimization', recommendation.strategy, {
  success: executionSuccess,
  reward: executionReward
});

console.log(`\n  📊 Outcome recorded to StrategyOptimizer`);
console.log(`  🧠 SOMA's knowledge of "${recommendation.strategy}" updated!`);

// Show updated stats
const updatedStats = strategyOptimizer.getDomainStats('code_optimization');
const updatedStrategy = updatedStats.strategies.find(s => s.name === recommendation.strategy);

console.log(`\n  Updated stats for "${recommendation.strategy}":`);
console.log(`     Trials: ${updatedStrategy.trials} (was ${recommendation.stats.trials})`);
console.log(`     Success Rate: ${(updatedStrategy.successRate * 100).toFixed(0)}%`);
console.log(`     Avg Reward: ${(updatedStrategy.avgReward * 100).toFixed(1)}%`);

// Final summary
console.log('\n' + '='.repeat(70));
console.log('  DEMONSTRATION COMPLETE');
console.log('='.repeat(70));

console.log('\n✅ SOMA now ACTIVELY USES learning to make decisions!');
console.log('✅ StrategyOptimizer recommends best strategy based on history');
console.log('✅ Each outcome is recorded to improve future decisions');
console.log('✅ Over time, SOMA gets smarter and more effective');

console.log('\n📝 HOW IT WORKS:');
console.log('   1. SelfModificationArbiter needs to optimize code');
console.log('   2. Instead of random/fixed choice, it asks StrategyOptimizer');
console.log('   3. StrategyOptimizer uses UCB1 algorithm to recommend best strategy');
console.log('   4. SOMA executes the recommended optimization');
console.log('   5. Result is recorded back to StrategyOptimizer');
console.log('   6. Future recommendations become more accurate');

console.log('\n🎯 REAL-WORLD IMPACT:');
console.log('   - Avoids strategies that historically fail');
console.log('   - Favors strategies with highest success rates');
console.log('   - Balances exploration (trying new things) vs exploitation (using what works)');
console.log('   - Continuously improves decision-making quality\n');
