/**
 * test-dream-integration.cjs
 * 
 * Quick integration test for DreamArbiter + MCP Server
 * 
 * Usage: node tests/test-dream-integration.cjs
 */

const { DreamArbiter } = require('../arbiters/DreamArbiter.cjs');
const { MCPServer } = require('../server/mcp-server-soma-dreams.js');

async function testDreamArbiter() {
  console.log('='.repeat(60));
  console.log('TEST 1: DreamArbiter Initialization');
  console.log('='.repeat(60));

  // Create mock transmitter
  const mockTransmitter = {
    getRecentInteractions: async (hours) => {
      console.log(`  ✓ Mock transmitter called: getRecentInteractions(${hours}h)`);
      return [
        {
          id: 'test_1',
          text: 'User asked about machine learning models',
          meta: { source: 'interaction', confidence: 0.8 },
          embedding: Array(128).fill(0).map(() => Math.random() * 2 - 1)
        },
        {
          id: 'test_2',
          text: 'Discussed neural network architectures',
          meta: { source: 'interaction', confidence: 0.9 },
          embedding: Array(128).fill(0).map(() => Math.random() * 2 - 1)
        },
        {
          id: 'test_3',
          text: 'Reviewed embedding generation techniques',
          meta: { source: 'interaction', confidence: 0.75 },
          embedding: Array(128).fill(0).map(() => Math.random() * 2 - 1)
        }
      ];
    },
    search: async (query, embedding, topK) => {
      console.log(`  ✓ Mock transmitter called: search("${query}", topK=${topK})`);
      return [];
    },
    addItem: async (item) => {
      console.log(`  ✓ Mock transmitter called: addItem`);
      return { id: `stored_${Date.now()}`, ...item };
    }
  };

  // Create DreamArbiter
  const dreamArbiter = new DreamArbiter({
    transmitter: mockTransmitter,
    name: 'DreamArbiter-Test',
    max_fragments: 10,
    recursive_depth: 1,
    human_review: false  // Auto-apply for testing
  });

  console.log('✓ DreamArbiter created');

  // Initialize
  try {
    await dreamArbiter.initialize();
    console.log('✓ DreamArbiter initialized successfully\n');
  } catch (error) {
    console.error('✗ Initialization failed:', error.message);
    return false;
  }

  // Run dream cycle
  console.log('='.repeat(60));
  console.log('TEST 2: Dream Cycle Execution');
  console.log('='.repeat(60));

  try {
    const result = await dreamArbiter.run(24, false);

    if (result.error) {
      console.error('✗ Dream cycle failed:', result.error);
      return false;
    }

    console.log('\n✓ Dream cycle completed successfully!');
    console.log('\nResults:');
    console.log(`  - Fragments analyzed: ${result.summary.fragments_count}`);
    console.log(`  - Proposals generated: ${result.summary.proposals_count}`);
    console.log(`  - Proposals applied: ${result.summary.applied_count}`);
    console.log(`  - Proposals queued: ${result.summary.queued_count}`);
    console.log(`  - Dream quality: ${result.summary.dream_quality}`);
    console.log(`  - Elapsed time: ${result.summary.elapsed_seconds}s\n`);

    if (result.summary.fragments_count === 0) {
      console.warn('⚠ Warning: No fragments collected');
      return false;
    }

    if (result.summary.proposals_count === 0) {
      console.log('ℹ Info: No proposals generated (normal for small test)');
    }

  } catch (error) {
    console.error('✗ Dream cycle error:', error.message);
    console.error(error.stack);
    return false;
  }

  // Shutdown
  await dreamArbiter.shutdown();
  console.log('✓ DreamArbiter shutdown complete\n');

  return true;
}

async function testMCPServer() {
  console.log('='.repeat(60));
  console.log('TEST 3: MCP Server');
  console.log('='.repeat(60));

  const mockTransmitter = {
    getRecentInteractions: async (hours) => {
      return [
        { id: 'mcp_test_1', text: 'MCP test fragment', meta: {} }
      ];
    },
    search: async (query, embedding, topK) => [],
    addItem: async (item) => ({ id: `mcp_${Date.now()}`, ...item })
  };

  const dreamArbiter = new DreamArbiter({
    transmitter: mockTransmitter,
    name: 'DreamArbiter-MCP-Test',
    human_review: false
  });

  await dreamArbiter.initialize();

  const server = new MCPServer({
    port: 3002,  // Use different port for testing
    host: 'localhost',
    dreamArbiter,
    transmitter: mockTransmitter
  });

  try {
    await server.start();
    console.log('✓ MCP Server started successfully');
    console.log(`  Listening on localhost:3002`);
    console.log(`  Available tools: ${server.tools.length}`);

    // List tools
    console.log('\n  Tools exposed:');
    server.tools.forEach(tool => {
      console.log(`    - ${tool.name}`);
    });

    // Test tool call (internal)
    try {
      const status = await server._toolDreamStatus({});
      console.log('\n✓ Tool call test passed (dream_status)');
      console.log(`  Status: ${status.state}, Dreams: ${status.dream_count}`);
    } catch (error) {
      console.error('✗ Tool call test failed:', error.message);
      return false;
    }

    // Shutdown
    await server.stop();
    await dreamArbiter.shutdown();
    console.log('\n✓ MCP Server shutdown complete\n');

    return true;
  } catch (error) {
    console.error('✗ MCP Server error:', error.message);
    console.error(error.stack);
    return false;
  }
}

async function runTests() {
  console.log('\n🌙 SOMA Lucid Dream Mode - Integration Tests\n');

  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Test 1: DreamArbiter
    if (await testDreamArbiter()) {
      testsPassed++;
    } else {
      testsFailed++;
    }

    // Test 2: MCP Server
    if (await testMCPServer()) {
      testsPassed++;
    } else {
      testsFailed++;
    }

  } catch (error) {
    console.error('\n💥 Fatal test error:', error.message);
    console.error(error.stack);
    testsFailed++;
  }

  // Summary
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✓ Tests passed: ${testsPassed}`);
  console.log(`✗ Tests failed: ${testsFailed}`);
  console.log('='.repeat(60));

  if (testsFailed === 0) {
    console.log('\n🎉 All tests passed! Dream integration ready to deploy.\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Check errors above.\n');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testDreamArbiter, testMCPServer };
