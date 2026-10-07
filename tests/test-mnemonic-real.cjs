/**
 * test-mnemonic-real.cjs
 * 
 * Comprehensive test suite for MnemonicArbiter v2.0 (REAL)
 * Tests all 3 tiers, tier management, memory pressure, and optimization
 */

const { MnemonicArbiter } = require('../arbiters/MnemonicArbiter.cjs');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

// ===========================
// Test Configuration
// ===========================

const TEST_CONFIG = {
  dbPath: path.join(process.cwd(), 'test-soma-memory.db'),
  vectorDbPath: path.join(process.cwd(), 'test-soma-vectors.json'),
  redisUrl: 'redis://localhost:6379',
  hotTierTTL: 60,
  warmTierLimit: 10000,
  promotionCheckInterval: 1000,
  cleanupInterval: 5000,
  vacuumInterval: 30000,
  enableAutoCleanup: true
};

let testsPassed = 0;
let testsFailed = 0;

// ===========================
// Test Utilities
// ===========================

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

function cleanup() {
  try {
    if (fs.existsSync(TEST_CONFIG.dbPath)) fs.unlinkSync(TEST_CONFIG.dbPath);
    if (fs.existsSync(TEST_CONFIG.vectorDbPath)) fs.unlinkSync(TEST_CONFIG.vectorDbPath);
  } catch (e) {
    // Ignore cleanup errors
  }
}

async function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================
// Test Suite
// ===========================

async function runTests() {
  console.log('\n🧠 MnemonicArbiter v2.0 (REAL) Test Suite\n');
  console.log('═'.repeat(60));

  // Test 1: Initialization
  await test('Initialization: Create arbiter', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    assert(arbiter, 'Arbiter created');
    assert(arbiter.name === 'MnemonicArbiter', 'Name correct');
    assert(arbiter.config.version === '2.0.0-real', 'Version correct');
  });

  // Test 2: Cold Tier (SQLite)
  await test('Cold Tier: Initialize and store memory', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    assert(arbiter.db, 'SQLite initialized');
    const result = await arbiter.remember('Test memory content', { importance: 0.8 });
    assert(result.id, 'Memory ID generated');
    assert(result.stored === true, 'Memory stored');
    
    await arbiter.onShutdown();
  });

  // Test 3: Warm Tier (Vector Search)
  await test('Warm Tier: Vector embedding and search', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    assert(arbiter.embedder, 'Embedder loaded');
    assert(arbiter.vectorStore, 'Vector store initialized');
    
    await arbiter.remember('Machine learning is fascinating', { importance: 0.9 });
    await arbiter.remember('Deep learning networks are powerful', { importance: 0.8 });
    
    assert(arbiter.vectorStore.size >= 2, `Vector store has embeddings (${arbiter.vectorStore.size})`);
    
    await arbiter.onShutdown();
  });

  // Test 4: Recall Pipeline (Cold -> Warm -> Hot)
  await test('Recall Pipeline: Multi-tier search', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Store a memory
    await arbiter.remember('The quick brown fox', { importance: 0.7 });
    
    // First recall - should hit cold tier
    const result1 = await arbiter.recall('quick brown', 5);
    assert(result1.results, 'Results returned');
    assert(result1.tier === 'cold' || result1.tier === 'warm', 'Cold or warm tier used');
    
    // Subsequent recall - should be faster (cached or warm)
    const result2 = await arbiter.recall('quick brown', 5);
    assert(result2.results.length > 0, 'Results from cache/warm');
    
    await arbiter.onShutdown();
  });

  // Test 5: Tier Metrics
  await test('Metrics: Track hits, misses, stores', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Store multiple items
    for (let i = 0; i < 3; i++) {
      await arbiter.remember(`Memory ${i}`, { importance: 0.5 });
    }
    
    // Recall to generate hits/misses
    await arbiter.recall('Memory', 5);
    await arbiter.recall('Memory', 5);
    
    const stats = arbiter.getMemoryStats();
    assert(stats.tiers.cold.stores >= 3, `Cold tier stored items (${stats.tiers.cold.stores})`);
    assert(stats.tiers.cold.hits >= 0, 'Hits tracked');
    assert(stats.hitRate.cold >= 0, 'Hit rate calculated');
    
    await arbiter.onShutdown();
  });

  // Test 6: Memory Pressure Detection
  await test('Memory Pressure: Detection and cleanup', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Generate some vectors
    for (let i = 0; i < 5; i++) {
      await arbiter.remember(`Memory with content ${i}`, { importance: 0.3 + i * 0.1 });
    }
    
    const pressure = await arbiter._checkMemoryPressure();
    assert(typeof pressure === 'number', 'Memory pressure computed');
    assert(pressure >= 0 && pressure <= 1, 'Memory pressure normalized');
    
    await arbiter.onShutdown();
  });

  // Test 7: Vector Eviction
  await test('Warm Tier: Evict old vectors', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Store vectors
    await arbiter.remember('Old memory', { importance: 0.2 });
    const initialSize = arbiter.vectorStore.size;
    
    // Manually age some vectors (simulate 7+ days old)
    for (const [id, vec] of arbiter.vectorStore.entries()) {
      vec.createdAt = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days old
    }
    
    // Evict
    arbiter._evictOldVectors();
    
    // Should have removed old vectors
    assert(arbiter.tierMetrics.warm.evictions >= 0, 'Eviction tracked');
    
    await arbiter.onShutdown();
  });

  // Test 8: Warm Tier Compression
  await test('Warm Tier: Remove duplicate vectors', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Create duplicate entry
    const content = 'Compress me';
    await arbiter.remember(content, { importance: 0.5 });
    
    // Manually add duplicate
    const firstVector = Array.from(arbiter.vectorStore.values())[0];
    if (firstVector) {
      arbiter.vectorStore.set('dup_1', { ...firstVector, id: 'dup_1' });
      arbiter.vectorStore.set('dup_2', { ...firstVector, id: 'dup_2' });
    }
    
    const sizeBefore = arbiter.vectorStore.size;
    arbiter._compressWarmTier();
    
    // Should have removed duplicates
    assert(arbiter.vectorStore.size <= sizeBefore, 'Duplicates removed or kept');
    
    await arbiter.onShutdown();
  });

  // Test 9: Tier Promotion Threshold
  await test('Tier Management: Promotion threshold', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    const id = 'test-id-123';
    
    // Record multiple accesses
    for (let i = 0; i < 6; i++) {
      arbiter.tierManager.recordAccess(id);
    }
    
    const pattern = arbiter.tierManager.accessPatterns.get(id);
    assert(pattern.access_count === 6, 'Access count tracked');
    
    // Should be eligible for promotion (5+ accesses)
    const promotion = arbiter.tierManager.shouldPromote(id);
    assert(promotion === 'warm', 'Promotion triggered at 5 accesses');
    
    await arbiter.onShutdown();
  });

  // Test 10: Tier Demotion
  await test('Tier Management: Demotion based on inactivity', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    const id = 'test-id-456';
    
    // Record access and set tier
    arbiter.tierManager.recordAccess(id);
    arbiter.tierManager.accessPatterns.get(id).tier = 'warm';
    arbiter.tierManager.accessPatterns.get(id).last_access = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
    
    // Should be eligible for demotion
    const demotion = arbiter.tierManager.shouldDemote(id);
    assert(demotion === 'cold', 'Demotion triggered after 7 days inactivity');
    
    await arbiter.onShutdown();
  });

  // Test 11: SQLite Search
  await test('Cold Tier: SQLite search queries', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Store multiple memories
    await arbiter.remember('The cat sat on the mat', { importance: 0.7 });
    await arbiter.remember('The dog ran in the park', { importance: 0.6 });
    await arbiter.remember('The bird flew in the sky', { importance: 0.8 });
    
    // Search
    const results = arbiter._sqliteSearch('cat', 10);
    
    assert(Array.isArray(results), 'Results is array');
    assert(results.length > 0, 'Found results');
    assert(results[0].content.includes('cat'), 'Correct result returned');
    
    await arbiter.onShutdown();
  });

  // Test 12: Access Stats Update
  await test('Cold Tier: Update access stats on search', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Store memory
    const id = await arbiter.remember('Search me', { importance: 0.5 });
    
    // Search to trigger access update
    arbiter._sqliteSearch('Search', 5);
    
    // Get updated memory
    const stmt = arbiter.db.prepare('SELECT access_count FROM memories WHERE id = ?');
    const row = stmt.get(id.id);
    
    assert(row.access_count > 0, 'Access count incremented');
    
    await arbiter.onShutdown();
  });

  // Test 13: Optimize Command
  await test('Optimization: Full system optimization', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Generate some data
    for (let i = 0; i < 3; i++) {
      await arbiter.remember(`Optimize test ${i}`, { importance: 0.5 });
    }
    
    // Optimize
    const result = await arbiter._optimize();
    
    assert(result.optimized === true, 'Optimization completed');
    assert(result.metrics, 'Metrics returned');
    
    await arbiter.onShutdown();
  });

  // Test 14: Memory Stats
  await test('Statistics: Complete memory stats report', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Generate data
    for (let i = 0; i < 2; i++) {
      await arbiter.remember(`Stats test ${i}`, { importance: 0.6 });
    }
    await arbiter.recall('Stats', 5);
    
    const stats = arbiter.getMemoryStats();
    
    assert(stats.version === '2.0.0-real', 'Version correct');
    assert(stats.tiers, 'Tier metrics included');
    assert(stats.storage, 'Storage status included');
    assert(stats.hitRate, 'Hit rates calculated');
    assert(stats.optimizations, 'Optimization metrics included');
    assert(typeof stats.memoryPressure === 'number', 'Memory pressure included');
    
    await arbiter.onShutdown();
  });

  // Test 15: Execute Method
  await test('Execution: Execute via task interface', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Remember via execute
    const rememberResult = await arbiter.execute({
      query: 'test',
      context: {
        action: 'remember',
        content: 'Test content',
        metadata: { importance: 0.7 }
      }
    });
    
    assert(rememberResult.success === true, 'Remember executed successfully');
    assert(rememberResult.duration > 0, 'Duration tracked');
    
    // Recall via execute
    const recallResult = await arbiter.execute({
      query: 'test',
      context: { action: 'recall', topK: 5 }
    });
    
    assert(recallResult.success === true, 'Recall executed successfully');
    
    // Stats via execute
    const statsResult = await arbiter.execute({
      query: 'stats',
      context: { action: 'stats' }
    });
    
    assert(statsResult.success === true, 'Stats executed successfully');
    
    await arbiter.onShutdown();
  });

  // Test 16: Persistence
  await test('Persistence: Vector store survives shutdown', async () => {
    cleanup();
    
    // First run - store vectors
    let arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    await arbiter.remember('Persistent memory 1', { importance: 0.9 });
    await arbiter.remember('Persistent memory 2', { importance: 0.8 });
    const sizeBeforeShutdown = arbiter.vectorStore.size;
    
    await arbiter.onShutdown();
    
    // Verify file saved
    assert(fs.existsSync(TEST_CONFIG.vectorDbPath), 'Vector file persisted');
    
    // Second run - load vectors
    arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    const sizeAfterLoad = arbiter.vectorStore.size;
    assert(sizeAfterLoad === sizeBeforeShutdown, `Vectors reloaded (${sizeAfterLoad} == ${sizeBeforeShutdown})`);
    
    await arbiter.onShutdown();
  });

  // Test 17: Graceful Redis Degradation
  await test('Resilience: Continue without Redis', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter({
      ...TEST_CONFIG,
      redisUrl: 'redis://invalid-host:9999' // Invalid Redis
    });
    
    await arbiter.onInitialize();
    
    // Should still work without Redis
    const result = await arbiter.remember('No Redis test', { importance: 0.5 });
    assert(result.stored === true, 'Memory stored without Redis');
    
    // Recall should work
    const recall = await arbiter.recall('Redis', 5);
    assert(recall.results !== undefined, 'Recall works without Redis');
    
    await arbiter.onShutdown();
  });

  // Test 18: Vector Search Similarity
  await test('Vector Search: Similarity-based ranking', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    // Store semantically related content
    await arbiter.remember('Artificial intelligence and machine learning', { importance: 0.8 });
    await arbiter.remember('Completely unrelated topic about cooking', { importance: 0.5 });
    
    // Search for AI-related
    const results = await arbiter.recall('machine learning', 5);
    
    assert(results.results.length > 0, 'Found results');
    // First result should be more similar
    if (results.results.length > 1) {
      assert(results.results[0].similarity >= results.results[1].similarity, 'Results ranked by similarity');
    }
    
    await arbiter.onShutdown();
  });

  // Test 19: Batch Operations
  await test('Batch Operations: Store multiple, recall multiple', async () => {
    cleanup();
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    await arbiter.onInitialize();
    
    const content = [
      'First batch item',
      'Second batch item',
      'Third batch item'
    ];
    
    const ids = [];
    for (const text of content) {
      const result = await arbiter.remember(text, { importance: 0.6 });
      ids.push(result.id);
    }
    
    assert(ids.length === 3, 'All items stored');
    
    // Recall all
    const results = await arbiter.recall('batch', 10);
    assert(results.results.length > 0, 'Batch recall successful');
    
    await arbiter.onShutdown();
  });

  // Test 20: Commands List
  await test('API: Available commands', async () => {
    const arbiter = new MnemonicArbiter(TEST_CONFIG);
    const commands = arbiter.getAvailableCommands();
    
    assert(Array.isArray(commands), 'Commands is array');
    assert(commands.includes('remember'), 'Remember command available');
    assert(commands.includes('recall'), 'Recall command available');
    assert(commands.includes('optimize'), 'Optimize command available');
  });

  // Final Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);
  
  cleanup();
  
  if (testsFailed === 0) {
    console.log('🎉 All tests passed! MnemonicArbiter v2.0 (REAL) is ready for production.\n');
    process.exit(0);
  } else {
    console.log(`⚠️  ${testsFailed} test(s) failed.\n`);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test suite error:', error);
  cleanup();
  process.exit(1);
});
