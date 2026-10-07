// test-microagents.cjs
// Test script for MicroAgent functionality

const { MicroAgentPool } = require('../microagents/MicroAgentPool.cjs');
const { FetchAgent } = require('../microagents/FetchAgent.cjs');
const { TransformAgent } = require('../microagents/TransformAgent.cjs');
const { AnalyzeAgent } = require('../microagents/AnalyzeAgent.cjs');

async function testMicroAgents() {
  console.log('🧪 Testing MicroAgent System...\n');
  
  // Create pool
  const pool = new MicroAgentPool({
    parentId: 'test-parent',
    maxPoolSize: 10,
    defaultTTL: 120000, // 2 minutes for testing
    defaultIdleTimeout: 60000 // 1 minute for testing
  });
  
  // Register agent types
  pool.registerAgentType('fetch', FetchAgent);
  pool.registerAgentType('transform', TransformAgent);
  pool.registerAgentType('analyze', AnalyzeAgent);
  
  console.log('✅ Pool created and agent types registered\n');
  
  // ========== TEST 1: Transform Agent ==========
  console.log('📝 Test 1: Transform Agent - Filter & Map');
  try {
    const data = [
      { id: 1, name: 'Alice', age: 30, score: 85 },
      { id: 2, name: 'Bob', age: 25, score: 92 },
      { id: 3, name: 'Charlie', age: 35, score: 78 },
      { id: 4, name: 'David', age: 28, score: 88 }
    ];
    
    // Filter: age >= 28
    const filterResult = await pool.executeTask('transform', {
      operation: 'filter',
      data,
      params: { key: 'age', value: 28, operator: '>=' }
    }, { autoTerminate: true });
    
    console.log('  Filter result (age >= 28):', filterResult.result.length, 'items');
    
    // Map: extract names
    const mapResult = await pool.executeTask('transform', {
      operation: 'map',
      data: filterResult.result,
      params: { key: 'name' }
    }, { autoTerminate: true });
    
    console.log('  Map result (names):', mapResult.result);
    
    // Aggregate statistics
    const statsResult = await pool.executeTask('transform', {
      operation: 'aggregate',
      data,
      params: { 
        operations: { 
          count: true, 
          avg: 'score', 
          min: 'score', 
          max: 'score' 
        } 
      }
    }, { autoTerminate: true });
    
    console.log('  Statistics:', statsResult.result);
    console.log('  ✅ Transform Agent tests passed\n');
  } catch (err) {
    console.error('  ❌ Transform Agent failed:', err.message, '\n');
  }
  
  // ========== TEST 2: Analyze Agent ==========
  console.log('📊 Test 2: Analyze Agent - Sentiment & Keywords');
  try {
    const text = 'This is an amazing product! I love the design and it works perfectly. Great quality and excellent customer service.';
    
    // Sentiment analysis
    const sentimentResult = await pool.executeTask('analyze', {
      analysis: 'sentiment',
      data: text
    }, { autoTerminate: true });
    
    console.log('  Sentiment:', sentimentResult.result);
    
    // Keyword extraction
    const keywordResult = await pool.executeTask('analyze', {
      analysis: 'keywords',
      data: text,
      params: { topN: 5, minLength: 4 }
    }, { autoTerminate: true });
    
    console.log('  Keywords:', keywordResult.result.keywords);
    console.log('  ✅ Analyze Agent tests passed\n');
  } catch (err) {
    console.error('  ❌ Analyze Agent failed:', err.message, '\n');
  }
  
  // ========== TEST 3: Statistical Analysis ==========
  console.log('📈 Test 3: Analyze Agent - Statistics');
  try {
    const numbers = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    
    const statsResult = await pool.executeTask('analyze', {
      analysis: 'statistics',
      data: numbers
    }, { autoTerminate: true });
    
    console.log('  Statistics:', {
      mean: statsResult.result.mean,
      median: statsResult.result.median,
      stdDev: statsResult.result.stdDev.toFixed(2),
      range: statsResult.result.range
    });
    console.log('  ✅ Statistical analysis passed\n');
  } catch (err) {
    console.error('  ❌ Statistical analysis failed:', err.message, '\n');
  }
  
  // ========== TEST 4: Chaining Operations ==========
  console.log('🔗 Test 4: Chaining Multiple MicroAgents');
  try {
    const rawData = [
      { product: 'Widget A', sales: 100, rating: 4.5 },
      { product: 'Widget B', sales: 150, rating: 4.8 },
      { product: 'Widget C', sales: 80, rating: 3.9 },
      { product: 'Widget D', sales: 200, rating: 4.9 },
      { product: 'Widget E', sales: 120, rating: 4.2 }
    ];
    
    // Step 1: Sort by sales (desc)
    const sorted = await pool.executeTask('transform', {
      operation: 'sort',
      data: rawData,
      params: { key: 'sales', order: 'desc' }
    }, { autoTerminate: true });
    
    console.log('  1. Sorted by sales (top 3):');
    sorted.result.slice(0, 3).forEach(item => 
      console.log(`     ${item.product}: ${item.sales} sales, ${item.rating}⭐`)
    );
    
    // Step 2: Filter high performers (rating >= 4.5)
    const highPerformers = await pool.executeTask('transform', {
      operation: 'filter',
      data: sorted.result,
      params: { key: 'rating', value: 4.5, operator: '>=' }
    }, { autoTerminate: true });
    
    console.log(`  2. High performers (rating >= 4.5): ${highPerformers.result.length} products`);
    
    // Step 3: Analyze structure
    const structure = await pool.executeTask('analyze', {
      analysis: 'structure',
      data: highPerformers.result
    }, { autoTerminate: true });
    
    console.log('  3. Data structure:', structure.result);
    console.log('  ✅ Chained operations passed\n');
  } catch (err) {
    console.error('  ❌ Chained operations failed:', err.message, '\n');
  }
  
  // ========== TEST 5: Pool Management ==========
  console.log('⚙️  Test 5: Pool Management & Status');
  
  // Clean up any existing agents first
  await pool.terminateAll('pre_test_cleanup');
  await new Promise(resolve => setTimeout(resolve, 6000)); // Wait for cleanup cycle (5s interval)
  
  // Spawn multiple agents
  console.log('  Spawning 3 agents...');
  const agents = [];
  for (let i = 0; i < 3; i++) {
    const agent = await pool.spawn('transform');
    agents.push(agent);
  }
  
  const status = pool.getStatus();
  console.log('  Pool status:', {
    totalAgents: status.totalAgents,
    utilization: status.utilization,
    metrics: status.metrics
  });
  
  // Terminate all
  console.log('  Terminating all agents...');
  await pool.terminateAll('test_complete');
  
  const finalStatus = pool.getStatus();
  console.log('  Final pool status:', {
    totalAgents: finalStatus.totalAgents,
    terminated: finalStatus.metrics.totalTerminated
  });
  console.log('  ✅ Pool management passed\n');
  
  // Shutdown pool
  await pool.shutdown();
  
  console.log('✅ All MicroAgent tests passed!');
  console.log('\n📊 Final Statistics:');
  console.log(JSON.stringify(finalStatus.metrics, null, 2));
}

testMicroAgents().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
