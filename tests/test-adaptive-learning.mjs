/**
 * test-adaptive-learning.mjs - Demonstrate Intelligent Learning Topic Selection
 *
 * Shows how SOMA decides WHAT to learn based on:
 * - Knowledge gaps (what she doesn't know)
 * - User interests (what you ask about)
 * - Success rates (what topics help her succeed)
 * - Recency (avoiding stale knowledge)
 */

import { getAdaptiveLearningPlanner } from '../arbiters/AdaptiveLearningPlanner.js';
import { getOutcomeTracker } from '../arbiters/OutcomeTracker.js';
import { getStrategyOptimizer } from '../arbiters/StrategyOptimizer.js';

console.log('='.repeat(70));
console.log('  ADAPTIVE LEARNING - How SOMA Decides WHAT to Learn');
console.log('='.repeat(70));

// Initialize systems
const outcomeTracker = getOutcomeTracker({
  storageDir: './data/test-outcomes',
  maxInMemory: 1000,
  enablePersistence: false
});

const strategyOptimizer = getStrategyOptimizer();
const learningPlanner = getAdaptiveLearningPlanner();

await outcomeTracker.initialize();
await strategyOptimizer.initialize();

// ============================================================
// PHASE 1: Simulate Historical Learning
// ============================================================

console.log('\n[PHASE 1] SIMULATING HISTORICAL LEARNING...\n');

// Simulate past learning outcomes
const historicalLearning = [
  // TypeScript learning was very successful
  { topic: 'typescript', success: true, reward: 0.45 },
  { topic: 'typescript', success: true, reward: 0.42 },
  { topic: 'typescript', success: true, reward: 0.38 },

  // Python learning moderately successful
  { topic: 'python', success: true, reward: 0.25 },
  { topic: 'python', success: true, reward: 0.28 },

  // React learning had mixed results
  { topic: 'react', success: true, reward: 0.15 },
  { topic: 'react', success: false, reward: -0.05 },

  // Rust learning failed
  { topic: 'rust', success: false, reward: -0.12 },
  { topic: 'rust', success: false, reward: -0.08 }
];

for (const learning of historicalLearning) {
  outcomeTracker.recordOutcome({
    agent: 'NighttimeLearningOrchestrator',
    action: 'autonomous_learning',
    context: { topic: learning.topic },
    result: { learned: learning.success },
    reward: learning.reward,
    success: learning.success,
    metadata: { topic: learning.topic }
  });
}

console.log('  ✅ Simulated 9 historical learning sessions');

// ============================================================
// PHASE 2: Simulate User Interactions
// ============================================================

console.log('\n[PHASE 2] SIMULATING USER INTERACTIONS (to learn interests)...\n');

// User frequently asks about Python and Docker
const userInteractions = [
  { topics: ['python', 'fastapi'] },
  { topics: ['python', 'pytorch'] },
  { topics: ['python', 'tensorflow'] },
  { topics: ['docker', 'kubernetes'] },
  { topics: ['docker', 'containers'] },
  { topics: ['typescript', 'react'] },
  { topics: ['javascript', 'node'] }
];

for (const interaction of userInteractions) {
  outcomeTracker.recordOutcome({
    agent: 'user_interaction',
    action: 'user_query',
    context: interaction,
    result: { answered: true },
    reward: 0.5,
    success: true
  });
}

console.log('  ✅ Simulated 7 user interactions');
console.log('  📊 Top user interests: python (3x), docker (2x), typescript (1x)');

// ============================================================
// PHASE 3: Simulate Recent Failures (Knowledge Gaps)
// ============================================================

console.log('\n[PHASE 3] SIMULATING RECENT TASK FAILURES (to identify gaps)...\n');

// Recent failures that indicate knowledge gaps
const recentFailures = [
  {
    error: 'API endpoint not found - missing API documentation',
    context: { task: 'integrate_external_api' }
  },
  {
    error: 'Type error: cannot read property of undefined',
    context: { task: 'refactor_typescript_code' }
  },
  {
    error: 'Performance timeout - need optimization knowledge',
    context: { task: 'optimize_query' }
  }
];

for (const failure of recentFailures) {
  outcomeTracker.recordOutcome({
    agent: 'SelfModificationArbiter',
    action: 'task_execution',
    context: failure.context,
    result: { error: failure.error },
    reward: -0.2,
    success: false
  });
}

console.log('  ✅ Simulated 3 recent failures');
console.log('  🔍 Knowledge gaps identified:');
console.log('     - API documentation (API error)');
console.log('     - TypeScript advanced (type errors)');
console.log('     - Performance optimization (timeout)');

// ============================================================
// PHASE 4: Initialize Adaptive Learning Planner
// ============================================================

console.log('\n[PHASE 4] INITIALIZING ADAPTIVE LEARNING PLANNER...\n');

await learningPlanner.initialize();

console.log('  ✅ AdaptiveLearningPlanner initialized');

const stats = learningPlanner.getStats();
console.log(`  📊 Knowledge graph: ${stats.knownTopics} topics tracked`);
console.log(`  👤 User interests: ${stats.userInterests} topics`);
console.log(`  🔍 Knowledge gaps: ${stats.knowledgeGaps} gaps identified`);

// ============================================================
// PHASE 5: Select Learning Topics (INTELLIGENT DECISION)
// ============================================================

console.log('\n[PHASE 5] SOMA INTELLIGENTLY SELECTS WHAT TO LEARN...\n');

console.log('  🧠 AdaptiveLearningPlanner analyzing:');
console.log('     ✓ Historical success rates');
console.log('     ✓ User interaction patterns');
console.log('     ✓ Knowledge gaps from failures');
console.log('     ✓ Topic recency');
console.log('');

const selectedTopics = learningPlanner.selectLearningTopics(null, 5);

console.log('  🎯 TOP 5 RECOMMENDED LEARNING TOPICS:\n');

for (let i = 0; i < selectedTopics.length; i++) {
  const topic = selectedTopics[i];
  const rank = i + 1;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';

  console.log(`  ${medal} #${rank} ${topic.topic.toUpperCase()}`);
  console.log(`       Priority Score: ${(topic.score * 100).toFixed(1)}%`);
  console.log(`       Reason: ${topic.reason}`);

  if (topic.recencyScore) {
    console.log(`       Breakdown:`);
    console.log(`         - Recency: ${(topic.recencyScore * 100).toFixed(0)}%`);
    console.log(`         - Usefulness: ${(topic.usefulnessScore * 100).toFixed(0)}%`);
    console.log(`         - Success rate: ${(topic.successScore * 100).toFixed(0)}%`);
    console.log(`         - User interest: ${(topic.interestScore * 100).toFixed(0)}%`);
    console.log(`         - Knowledge gap: ${(topic.gapScore * 100).toFixed(0)}%`);
  }
  console.log('');
}

// ============================================================
// PHASE 6: Get Recommended Crawler Targets
// ============================================================

console.log('\n[PHASE 6] TRANSLATING TOPICS TO CRAWLER TARGETS...\n');

const crawlerRecommendation = learningPlanner.getRecommendedCrawlerTargets(5);

console.log('  🕷️  RECOMMENDED EDGE CRAWLER TARGETS:\n');

for (const target of crawlerRecommendation.targets) {
  console.log(`     ✓ ${target}`);
}

console.log('\n  💡 REASONING:\n');
for (const reasoning of crawlerRecommendation.reasoning) {
  console.log(`     ${reasoning}`);
}

// ============================================================
// PHASE 7: Show Learning Evolution
// ============================================================

console.log('\n[PHASE 7] TRACKING LEARNING EVOLUTION...\n');

console.log('  📈 Top knowledge by success rate:\n');

for (let i = 0; i < Math.min(3, stats.topKnowledge.length); i++) {
  const knowledge = stats.topKnowledge[i];
  console.log(`     ${i + 1}. ${knowledge.topic}:`);
  console.log(`        Success rate: ${knowledge.successRate}`);
  console.log(`        Avg reward: ${knowledge.avgReward}`);
  console.log(`        Use count: ${knowledge.useCount}`);
}

// ============================================================
// SUMMARY
// ============================================================

console.log('\n' + '='.repeat(70));
console.log('  HOW SOMA DECIDES WHAT TO LEARN');
console.log('='.repeat(70));

console.log('\n✅ Multi-Criteria Decision Making:\n');
console.log('   1️⃣  RECENCY (30% weight)');
console.log('      - Prioritizes topics not learned recently');
console.log('      - Avoids stale knowledge\n');

console.log('   2️⃣  USEFULNESS (40% weight)');
console.log('      - Tracks how often each topic is used');
console.log('      - Prioritizes frequently needed knowledge\n');

console.log('   3️⃣  KNOWLEDGE GAPS (30% weight)');
console.log('      - Analyzes recent failures');
console.log('      - Identifies missing knowledge that caused errors');
console.log('      - Prioritizes gap-filling learning\n');

console.log('   4️⃣  USER INTERESTS (20% weight)');
console.log('      - Tracks what the user asks about');
console.log('      - Prioritizes topics relevant to user\n');

console.log('   5️⃣  SUCCESS RATE (20% weight)');
console.log('      - Favors topics with high learning success');
console.log('      - Avoids topics that historically don\'t help\n');

console.log('🎯 RESULT: SOMA LEARNS WHAT ACTUALLY MATTERS\n');

console.log('Instead of learning random topics, SOMA:');
console.log('  ✓ Fills knowledge gaps from failures');
console.log('  ✓ Focuses on user-relevant topics');
console.log('  ✓ Prioritizes high-value knowledge');
console.log('  ✓ Adapts over time as needs change');
console.log('  ✓ Continuously improves topic selection\n');

console.log('📝 HOW TO USE:\n');
console.log('1. Set "useIntelligentSelection": true in nighttime-learning.json');
console.log('2. AdaptiveLearningPlanner automatically:');
console.log('   - Analyzes your interaction patterns');
console.log('   - Identifies knowledge gaps from errors');
console.log('   - Recommends best topics to learn');
console.log('   - Updates recommendations based on outcomes');
console.log('3. Edge crawlers gather data on intelligent targets');
console.log('4. Learning becomes increasingly effective over time\n');
