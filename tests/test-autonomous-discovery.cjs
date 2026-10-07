#!/usr/bin/env node
/**
 * Test Autonomous Knowledge Discovery
 * 
 * Flow: KnowledgeDiscoveryWorker → Dendrite → Impulser → Memory
 */

const { KnowledgeDiscoveryWorker } = require('../workers/KnowledgeDiscoveryWorker.cjs');

async function testDiscovery() {
  console.log('🧪 Testing Autonomous Knowledge Discovery\n');
  console.log('═'.repeat(60));
  
  // Create worker with limited scope for testing
  const worker = new KnowledgeDiscoveryWorker({
    workerId: 'test_kdw',
    topics: [
      'quantum computing 2024',
      'large language models'
    ],
    searchTypes: ['web', 'news'],  // Skip videos for faster test
    maxResultsPerTopic: 3
  });
  
  console.log('\n🚀 Starting discovery session...\n');
  
  const result = await worker.discover();
  
  console.log('\n' + '═'.repeat(60));
  console.log('\n📊 Final Results:');
  console.log(`   Success: ${result.success}`);
  console.log(`   Discoveries: ${result.discoveries.length} batches`);
  console.log(`   Total items: ${result.metrics.totalDiscoveries}`);
  console.log(`   Sent to Impulser: ${result.metrics.sentToImpulser}`);
  console.log(`   Errors: ${result.metrics.errors}`);
  
  console.log('\n🔍 Sample Discoveries:');
  result.discoveries.slice(0, 2).forEach((d, i) => {
    console.log(`\n   [${i + 1}] ${d.topic} (${d.searchType})`);
    d.results.slice(0, 2).forEach((r, j) => {
      console.log(`      ${j + 1}. ${r.title.substring(0, 70)}...`);
    });
  });
  
  console.log('\n' + '═'.repeat(60));
  console.log('\n✅ Test complete! SOMA can now learn autonomously.\n');
}

testDiscovery().catch(console.error);
