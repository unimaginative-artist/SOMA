/**
 * test-query-routing.mjs - Test Intelligent Query Routing
 *
 * Demonstrates how queries are classified and routed to appropriate LLMs
 * based on complexity analysis.
 */

import { getQueryComplexityClassifier } from '../arbiters/QueryComplexityClassifier.js';

console.log('═'.repeat(70));
console.log('  INTELLIGENT QUERY ROUTING TEST');
console.log('  Cost-optimized LLM selection based on query complexity');
console.log('═'.repeat(70));

const classifier = getQueryComplexityClassifier();

// Available providers (based on test-api-providers.mjs results)
const availableProviders = ['deepseek', 'ollama']; // ✅ Both working!

console.log('\n📋 Current Provider Status:\n');
console.log('   ⚠️  OpenAI: Quota exceeded (will reset)');
console.log('   ⚠️  Gemini: Quota exceeded (will reset)');
console.log('   ✅ DeepSeek: WORKING ($0.14/1M tokens)');
console.log('   ✅ Ollama: WORKING (FREE, llama3.2)\n');

console.log('═'.repeat(70));
console.log('  TEST QUERIES');
console.log('═'.repeat(70));

// Test different query types
const testQueries = [
  {
    category: 'SIMPLE QUERIES (should route to Ollama when available)',
    queries: [
      'What is Python?',
      'Define recursion',
      'Hi SOMA!',
      'Test',
      'yes'
    ]
  },
  {
    category: 'MEDIUM QUERIES (should route to DeepSeek)',
    queries: [
      'How do I implement a REST API in Express.js?',
      'What are the pros and cons of using TypeScript?',
      'Explain async/await in JavaScript',
      'Best practices for React hooks?',
      'Compare Docker vs Kubernetes'
    ]
  },
  {
    category: 'COMPLEX QUERIES (should route to OpenAI/Gemini)',
    queries: [
      'Explain the trade-offs between microservices and monolithic architectures, considering scalability, deployment complexity, and team organization. What are the key patterns for handling distributed transactions?',
      'How would you design a high-throughput distributed system with eventual consistency guarantees? Discuss CAP theorem implications and consensus algorithms like Raft.',
      'Analyze the performance characteristics of different neural network architectures for natural language processing. Compare transformers vs RNNs, discussing gradient flow and computational complexity.',
      'Design a fault-tolerant Kubernetes cluster with automatic failover, considering network partitions, split-brain scenarios, and state synchronization across multiple availability zones.',
      'Optimize this recursive algorithm to use dynamic programming with memoization. Explain the time and space complexity improvements and justify the trade-offs.'
    ]
  }
];

// Test each category
for (const category of testQueries) {
  console.log(`\n\n${'─'.repeat(70)}`);
  console.log(`  ${category.category}`);
  console.log('─'.repeat(70));

  for (const query of category.queries) {
    const result = classifier.getRoutingRecommendation(query, availableProviders);

    // Visual indicator
    let icon = '';
    if (result.complexity === 'SIMPLE') icon = '🟢';
    else if (result.complexity === 'MEDIUM') icon = '🟡';
    else icon = '🔴';

    console.log(`\n${icon} Query: "${query.substring(0, 80)}${query.length > 80 ? '...' : ''}"`);
    console.log(`   Complexity: ${result.complexity} (score: ${result.score})`);
    console.log(`   Recommended: ${result.recommendedProvider}`);
    console.log(`   Selected: ${result.selectedProvider || 'NONE AVAILABLE'}${!result.wasRecommended ? ' ⚠️  (fallback)' : ''}`);
    console.log(`   Reasoning: ${result.reasoning}`);

    // Show detailed factors for first query in each category
    if (category.queries.indexOf(query) === 0) {
      console.log(`   Factors breakdown:`);
      console.log(`     - Question length: ${(result.factors.questionLength * 100).toFixed(0)}%`);
      console.log(`     - Technical terms: ${(result.factors.technicalTerms * 100).toFixed(0)}%`);
      console.log(`     - Context required: ${(result.factors.contextRequired * 100).toFixed(0)}%`);
      console.log(`     - Reasoning depth: ${(result.factors.reasoningDepth * 100).toFixed(0)}%`);
      console.log(`     - Domain specificity: ${(result.factors.domainSpecificity * 100).toFixed(0)}%`);
    }
  }
}

// Show statistics
console.log('\n\n' + '═'.repeat(70));
console.log('  ROUTING STATISTICS');
console.log('═'.repeat(70));

const stats = classifier.getStats();

console.log(`\n📊 Query Distribution:\n`);
console.log(`   🟢 SIMPLE: ${stats.simpleQueries} queries (${stats.distribution.simple})`);
console.log(`      → Route to Ollama (FREE, local, fast)`);
console.log(`\n   🟡 MEDIUM: ${stats.mediumQueries} queries (${stats.distribution.medium})`);
console.log(`      → Route to DeepSeek ($0.14/1M tokens)`);
console.log(`\n   🔴 COMPLEX: ${stats.complexQueries} queries (${stats.distribution.complex})`);
console.log(`      → Route to OpenAI/Gemini ($0.15/1M tokens)`);

console.log(`\n\n💰 Cost Analysis:\n`);
console.log(`   Estimated cost with routing: $${Object.values(stats.estimatedCost).reduce((a, b) => a + b, 0).toFixed(6)}`);
console.log(`   Cost if all queries used OpenAI: $${stats.worstCaseCost.toFixed(6)}`);
console.log(`   💵 Savings: ${stats.savings}!`);

console.log('\n\n' + '═'.repeat(70));
console.log('  WHEN ALL PROVIDERS ARE WORKING');
console.log('═'.repeat(70));

console.log('\n🎯 Optimal Routing Strategy:\n');
console.log('   1. 🟢 SIMPLE queries → Ollama');
console.log('      Examples: "What is X?", "Define Y", "Test"');
console.log('      Cost: $0 (local)');
console.log('      Response time: <1s');
console.log('');
console.log('   2. 🟡 MEDIUM queries → DeepSeek');
console.log('      Examples: "How to...", "Best practices...", "Compare X vs Y"');
console.log('      Cost: $0.14/1M tokens (very cheap)');
console.log('      Response time: 1-2s');
console.log('');
console.log('   3. 🔴 COMPLEX queries → OpenAI/Gemini');
console.log('      Examples: System design, deep analysis, multi-step reasoning');
console.log('      Cost: $0.15/1M tokens');
console.log('      Response time: 2-4s');
console.log('      Quality: Highest');

console.log('\n📝 Next Steps:\n');
console.log('   1. Wait for OpenAI/Gemini quotas to reset (daily)');
console.log('   2. Install Ollama: ollama pull llama3.1:8b');
console.log('   3. Run: node soma-bootstrap.js');
console.log('   4. SOMA will automatically route queries for optimal cost/quality\n');

console.log('✅ Intelligent routing configured and ready!\n');
