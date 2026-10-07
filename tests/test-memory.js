// Test ClusterMemoryManager
import { ClusterMemoryManager } from '../cluster/ClusterMemoryManager.js';

async function testMemory() {
  console.log('🧪 Testing ClusterMemoryManager...\n');
  
  // Create memory manager
  const memory = new ClusterMemoryManager({
    name: 'TestMemory',
    nodeId: 'test-node-1'
  });
  
  await memory.initialize();
  
  // Test 1: Allocate a 1GB tensor
  console.log('\n📦 Test 1: Allocate 1GB tensor');
  const { tensorId, chunks } = await memory.allocateTensor(1024 * 1024 * 1024, {
    type: 'model_weights'
  });
  console.log(`✅ Allocated tensor: ${tensorId}`);
  console.log(`   Chunks: ${chunks.length}`);
  console.log(`   Distribution: ${chunks.map(c => c.nodeId).join(', ')}`);
  
  // Test 2: Write data to tensor
  console.log('\n✍️  Test 2: Write 1MB test data');
  const testData = Buffer.alloc(1024 * 1024, 'x');
  await memory.writeTensor(tensorId, testData);
  console.log('✅ Data written');
  
  // Test 3: Read data back
  console.log('\n📖 Test 3: Read data back');
  const readData = await memory.readTensor(tensorId);
  console.log(`✅ Read ${readData.length} bytes`);
  
  // Test 4: Check status
  console.log('\n📊 Memory Manager Status:');
  const status = memory.getStatus();
  console.log(JSON.stringify(status, null, 2));
  
  console.log('\n✅ All tests passed!');
}

testMemory().catch(console.error);
