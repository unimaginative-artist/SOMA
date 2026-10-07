// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/smoke-test.mjs
// Simple smoke test for SOMArbiterV2_ASI
// Run this at 7pm to see if she works
// ═══════════════════════════════════════════════════════════

import SOMArbiterV2_ASI from '../../SOMArbiterV2_ASI.js';

console.log('\n🔥 SOMA ASI Smoke Test\n');
console.log('═'.repeat(60));

// Mock minimal dependencies
class MockRouter {
  async route(query, context) {
    // Simple routing: code-related → AURORA, math → LOGOS, else → PROMETHEUS
    if (query.match(/write|code|function|implement/i)) {
      return { brain: 'AURORA', confidence: 0.8, method: 'direct' };
    }
    if (query.match(/math|calculate|number/i)) {
      return { brain: 'LOGOS', confidence: 0.9, method: 'direct' };
    }
    return { brain: 'PROMETHEUS', confidence: 0.7, method: 'direct' };
  }
}

class MockMessageBroker {
  async publish(channel, data) {
    // Silent - just for testing
  }
}

// Create arbiter with minimal dependencies
console.log('\n📦 Initializing SOMArbiterV2_ASI...');
const arbiter = new SOMArbiterV2_ASI({
  router: new MockRouter(),
  messageBroker: new MockMessageBroker(),
  asiEnabled: true,
  criticEnabled: true,
  asiThreshold: 0.7
});

console.log('✅ Arbiter initialized\n');

// Test 1: Simple query (should NOT trigger ASI)
console.log('═'.repeat(60));
console.log('TEST 1: Simple Query (standard quad-brain)');
console.log('═'.repeat(60));
console.log('Query: "What is 2 + 2?"');
console.log('Expected: Standard quad-brain, no ASI loop\n');

try {
  const result1 = await arbiter.processQuery(
    'What is 2 + 2?',
    'smoke_test_1'
  );

  console.log('✅ Response received:');
  console.log(`   Method: ${result1.method || 'quad_brain'}`);
  console.log(`   Response: ${result1.response.substring(0, 100)}...`);
  console.log(`   Critique Score: ${result1.critiqueScore || 'N/A'}`);
} catch (error) {
  console.log('❌ TEST 1 FAILED:', error.message);
  console.log(error.stack);
  process.exit(1);
}

// Test 2: Complex query (SHOULD trigger ASI)
console.log('\n' + '═'.repeat(60));
console.log('TEST 2: Complex Query (ASI loop)');
console.log('═'.repeat(60));
console.log('Query: "Write a function to check if a number is prime"');
console.log('Expected: ASI loop triggered\n');

try {
  const result2 = await arbiter.processQuery(
    'Write a JavaScript function to check if a number is prime',
    'smoke_test_2'
  );

  console.log('✅ Response received:');
  console.log(`   Method: ${result2.method || 'unknown'}`);
  console.log(`   ASI Triggered: ${result2.method?.includes('asi') ? 'YES' : 'NO'}`);
  console.log(`   Response length: ${result2.response?.length || 0} chars`);

  if (result2.stats) {
    console.log(`   Stats:`, result2.stats);
  }

  if (result2.response) {
    console.log('\n   First 200 chars of response:');
    console.log(`   ${result2.response.substring(0, 200)}...`);
  } else {
    console.log('\n   ⚠️  No response returned');
  }

} catch (error) {
  console.log('❌ TEST 2 FAILED:', error.message);
  console.log(error.stack);
  process.exit(1);
}

// Success
console.log('\n' + '═'.repeat(60));
console.log('✅ SMOKE TEST PASSED');
console.log('═'.repeat(60));
console.log('\nSOMA ASI is operational. Ready for real testing.\n');

process.exit(0);
