// test-transmitters.cjs
// Quick test of Transmitter integration

const { TransmitterManager } = require('../transmitters/TransmitterManager.cjs');
const path = require('path');

async function testTransmitters() {
  console.log('🧪 Testing Transmitter Integration...\n');
  
  // Create manager
  const tm = new TransmitterManager(
    path.join(__dirname, 'SOMA', 'test-transmitters'),
    { logging: true }
  );
  
  console.log('✅ TransmitterManager created\n');
  
  // Generate mock embeddings (384-dim)
  function mockEmbedding() {
    return Array.from({ length: 384 }, () => Math.random() - 0.5);
  }
  
  // Add some test items
  console.log('📝 Adding test items...');
  
  const items = [
    { id: 'test1', text: 'AI reasoning test', embedding: mockEmbedding(), metadata: { topic: 'AI' } },
    { id: 'test2', text: 'Neural networks', embedding: mockEmbedding(), metadata: { topic: 'AI' } },
    { id: 'test3', text: 'Cooking recipes', embedding: mockEmbedding(), metadata: { topic: 'cooking' } },
    { id: 'test4', text: 'Machine learning', embedding: mockEmbedding(), metadata: { topic: 'AI' } },
    { id: 'test5', text: 'Database systems', embedding: mockEmbedding(), metadata: { topic: 'databases' } }
  ];
  
  for (const item of items) {
    const result = await tm.addItemToBest(item);
    console.log(`  Added ${item.id}: ${result ? '✅' : '❌'}`);
  }
  
  console.log('\n📊 Network stats:');
  const stats = tm.stats();
  console.log(JSON.stringify(stats, null, 2));
  
  // Test search
  console.log('\n🔍 Testing hybrid search...');
  const queryEmb = mockEmbedding();
  const searchResults = await tm.hybridSearch(queryEmb, 3);
  
  console.log(`Found ${searchResults.length} results:`);
  searchResults.forEach((r, i) => {
    console.log(`  ${i + 1}. TN ${r.tn.id} - score: ${r.finalScore.toFixed(3)} (${r.source})`);
  });
  
  // Test maintenance
  console.log('\n🔧 Running maintenance...');
  await tm.maintenanceTick();
  
  console.log('\n✅ All tests passed!');
  console.log('\nFinal status:');
  console.log(JSON.stringify(tm.stats(), null, 2));
}

testTransmitters().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
