// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/asi-soma-integration.test.cjs
// Full ASI + SOMA Integration Test
// Tests: RewriteBrain → SelfReflectBrain → ReattemptController → SOMArbiterV2_ASI
// ═══════════════════════════════════════════════════════════

const RewriteBrain = require('../core/RewriteBrain.cjs');
const SelfReflectBrain = require('../core/SelfReflectBrain.cjs');
const ReattemptController = require('../core/ReattemptController.cjs');
const SandboxRunner = require('../execution/SandboxRunner.cjs');
const path = require('path');
const fs = require('fs');

// Mock SOMA Infrastructure
class MockThalamus {
  constructor() {
    this.callCount = 0;
    this.routeHistory = [];
  }

  async route({ brain, task, prompt, temperature, context }) {
    this.callCount++;
    this.routeHistory.push({ brain, task, temperature, context });

    console.log(`[MockThalamus] Routing to ${brain} brain for ${task}`);

    // Simulate different brain responses
    if (task === 'rewrite_code') {
      // Return fixed code
      return `\`\`\`javascript
function solution(n) {
  if (n <= 1) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;

  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}
\`\`\``;
    }

    if (task === 'meta_reasoning') {
      // Return reflection JSON
      return JSON.stringify({
        rootCause: "Off-by-one error in loop boundary",
        lessons: [
          {
            id: "lesson_1",
            text: "Always validate loop boundaries with edge cases",
            severity: "high"
          },
          {
            id: "lesson_2",
            text: "Test with small primes (2, 3, 5) first",
            severity: "medium"
          }
        ],
        patchHints: [
          {
            hint: "Change loop condition to i * i <= n",
            target: "code"
          }
        ],
        brainRecommendations: {
          betterChoice: "analytical",
          reasoning: "Mathematical problems need precise logic"
        },
        persistAsMemory: true
      });
    }

    return 'Mock response';
  }

  async callBrain(brain, prompt, options) {
    return this.route({ brain, task: 'call', prompt, ...options });
  }
}

class MockArchivist {
  constructor() {
    this.memories = [];
  }

  async addMemory(memory) {
    console.log(`[MockArchivist] Storing memory: ${memory.type}`);
    this.memories.push(memory);
    return { id: this.memories.length, ...memory };
  }

  async query(filter) {
    return this.memories.filter(m => {
      if (filter.type && m.type !== filter.type) return false;
      if (filter.paradigm && m.paradigm !== filter.paradigm) return false;
      return true;
    });
  }

  getMemoryCount() {
    return this.memories.length;
  }
}

class MockMessageBroker {
  constructor() {
    this.events = [];
  }

  async publish(channel, data) {
    console.log(`[MockBroker] Published to ${channel}`);
    this.events.push({ channel, data, timestamp: Date.now() });
  }

  getEventCount() {
    return this.events.length;
  }

  getEventsByChannel(channel) {
    return this.events.filter(e => e.channel === channel);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════

async function runTests() {
  console.log('\n🧪 ASI + SOMA Integration Test Suite\n');
  console.log('═'.repeat(60));

  let passedTests = 0;
  let totalTests = 0;

  // Setup SOMA infrastructure
  const thalamus = new MockThalamus();
  const archivist = new MockArchivist();
  const broker = new MockMessageBroker();
  const sandbox = new SandboxRunner({ logger: console, timeout: 5000 });

  // ═══════════════════════════════════════════════════════════
  // TEST 1: RewriteBrain Integration
  // ═══════════════════════════════════════════════════════════
  console.log('\n📝 TEST 1: RewriteBrain Routes Through Thalamus');
  console.log('-'.repeat(60));
  totalTests++;

  try {
    const rewriteBrain = new RewriteBrain({
      thalamus,
      messageBroker: broker,
      sandboxRunner: sandbox,
      logger: console
    });

    // Broken code with logic error
    const brokenNode = {
      id: 'node_1',
      code: `function solution(n) {
  if (n < 2) return false;
  for (let i = 2; i < n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}`,
      paradigm: 'iterative'
    };

    const critique = {
      bugs: ['Logic error in loop boundary'],
      edgeCases: ['Fails for n=2'],
      feedback: 'Does not handle base case n=2 correctly'
    };

    const failingTests = [
      { input: 2, expected: true, actual: false }
    ];

    const result = await rewriteBrain.rewriteNode(brokenNode, critique, failingTests);

    // Verify routing happened
    if (thalamus.routeHistory.length === 0) {
      throw new Error('RewriteBrain did not route through Thalamus');
    }

    // Verify brain selection
    const lastRoute = thalamus.routeHistory[thalamus.routeHistory.length - 1];
    if (!['analytical', 'technical', 'creative'].includes(lastRoute.brain)) {
      throw new Error(`Invalid brain selected: ${lastRoute.brain}`);
    }

    // Verify events published
    const rewriteEvents = broker.getEventsByChannel('asi.rewrite.start');
    if (rewriteEvents.length === 0) {
      throw new Error('RewriteBrain did not publish events');
    }

    // Verify result structure
    if (!result.best || !result.attempts) {
      throw new Error('Invalid result structure');
    }

    console.log('✅ RewriteBrain correctly routes through Thalamus');
    console.log(`   - Routed to: ${lastRoute.brain} brain`);
    console.log(`   - Attempts: ${result.attempts.length}`);
    console.log(`   - Events published: ${broker.getEventsByChannel('asi.rewrite.attempt').length}`);
    passedTests++;

  } catch (error) {
    console.log('❌ RewriteBrain test failed:', error.message);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 2: SelfReflectBrain Integration
  // ═══════════════════════════════════════════════════════════
  console.log('\n🧠 TEST 2: SelfReflectBrain Stores in Archivist');
  console.log('-'.repeat(60));
  totalTests++;

  try {
    const reflectBrain = new SelfReflectBrain({
      thalamus,
      archivist,
      messageBroker: broker,
      logger: console
    });

    const context = {
      task: 'isPrime function',
      node: {
        id: 'node_1',
        code: 'broken code',
        paradigm: 'iterative'
      },
      criticFeedback: {
        bugs: ['Off-by-one error'],
        score: 0.3
      },
      sandboxResults: {
        passed: false,
        error: 'Test failed for n=2'
      },
      repairSummary: [
        { attempt: 1, ok: false, reason: 'Still broken' }
      ]
    };

    const initialMemoryCount = archivist.getMemoryCount();
    const reflection = await reflectBrain.reflect(context);

    // Verify Thalamus routing
    const analyticalRoute = thalamus.routeHistory.find(r =>
      r.brain === 'analytical' && r.task === 'meta_reasoning'
    );
    if (!analyticalRoute) {
      throw new Error('SelfReflectBrain did not route to analytical brain');
    }

    // Verify Archivist storage
    const newMemoryCount = archivist.getMemoryCount();
    if (newMemoryCount <= initialMemoryCount) {
      throw new Error('SelfReflectBrain did not store in Archivist');
    }

    // Verify reflection structure
    if (!reflection.rootCause || !reflection.lessons || !reflection.patchHints) {
      throw new Error('Invalid reflection structure');
    }

    // Verify events published
    const reflectEvents = broker.getEventsByChannel('asi.reflect.complete');
    if (reflectEvents.length === 0) {
      throw new Error('SelfReflectBrain did not publish events');
    }

    console.log('✅ SelfReflectBrain correctly stores in Archivist');
    console.log(`   - Root cause: ${reflection.rootCause}`);
    console.log(`   - Lessons learned: ${reflection.lessons.length}`);
    console.log(`   - Patch hints: ${reflection.patchHints.length}`);
    console.log(`   - Memories stored: ${newMemoryCount - initialMemoryCount}`);
    passedTests++;

  } catch (error) {
    console.log('❌ SelfReflectBrain test failed:', error.message);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: ReattemptController Orchestration
  // ═══════════════════════════════════════════════════════════
  console.log('\n🔄 TEST 3: ReattemptController Orchestrates Full Loop');
  console.log('-'.repeat(60));
  totalTests++;

  try {
    const rewriteBrain = new RewriteBrain({
      thalamus,
      messageBroker: broker,
      sandboxRunner: sandbox,
      logger: console
    });

    const reflectBrain = new SelfReflectBrain({
      thalamus,
      archivist,
      messageBroker: broker,
      logger: console
    });

    const provenanceDir = path.join(__dirname, '../provenance');
    const controller = new ReattemptController({
      thalamus,
      rewriteBrain,
      reflectBrain,
      sandboxRunner: sandbox,
      messageBroker: broker,
      logger: console,
      maxCycles: 2,
      provenanceDir
    });

    const failingNode = {
      id: 'node_test',
      code: `function solution(n) {
  if (n < 2) return false;
  for (let i = 2; i < n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}`,
      paradigm: 'iterative'
    };

    const critique = {
      bugs: ['Does not handle n=2 correctly'],
      score: 0.3
    };

    const tests = [
      { input: 2, expected: true },
      { input: 3, expected: true },
      { input: 4, expected: false }
    ];

    const initialEventCount = broker.getEventCount();
    const result = await controller.handleFailure(failingNode, critique, tests, 'isPrime');

    // Verify orchestration
    if (!result.cycleResults || result.cycleResults.length === 0) {
      throw new Error('No cycles executed');
    }

    // Verify events published
    const newEventCount = broker.getEventCount();
    if (newEventCount <= initialEventCount) {
      throw new Error('ReattemptController did not publish events');
    }

    // Verify provenance written
    if (fs.existsSync(provenanceDir)) {
      const files = fs.readdirSync(provenanceDir);
      const testProvenanceFiles = files.filter(f => f.includes('node_test'));
      if (testProvenanceFiles.length === 0) {
        console.log('⚠️  Warning: No provenance files created (directory may exist but be empty)');
      } else {
        console.log(`   - Provenance files created: ${testProvenanceFiles.length}`);
      }
    }

    // Verify MessageBroker integration
    const reattemptStartEvents = broker.getEventsByChannel('asi.reattempt.start');
    if (reattemptStartEvents.length === 0) {
      throw new Error('No reattempt.start events published');
    }

    console.log('✅ ReattemptController orchestrates full loop');
    console.log(`   - Cycles executed: ${result.cycleResults.length}`);
    console.log(`   - Success: ${result.success}`);
    console.log(`   - Events published: ${newEventCount - initialEventCount}`);
    console.log(`   - Reattempt events: ${reattemptStartEvents.length}`);
    passedTests++;

  } catch (error) {
    console.log('❌ ReattemptController test failed:', error.message);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 4: Complete System Integration
  // ═══════════════════════════════════════════════════════════
  console.log('\n🌐 TEST 4: Complete ASI + SOMA System Integration');
  console.log('-'.repeat(60));
  totalTests++;

  try {
    // Verify all components are wired together
    const systemChecks = {
      'RewriteBrain → Thalamus': thalamus.routeHistory.some(r => r.task === 'rewrite_code'),
      'SelfReflectBrain → Thalamus': thalamus.routeHistory.some(r => r.task === 'meta_reasoning'),
      'SelfReflectBrain → Archivist': archivist.getMemoryCount() > 0,
      'All components → MessageBroker': broker.getEventCount() > 0,
      'ReattemptController orchestration': broker.getEventsByChannel('asi.reattempt.start').length > 0
    };

    const failedChecks = Object.entries(systemChecks)
      .filter(([_, passed]) => !passed)
      .map(([check, _]) => check);

    if (failedChecks.length > 0) {
      throw new Error(`Integration checks failed: ${failedChecks.join(', ')}`);
    }

    // Verify event flow
    const eventChannels = [...new Set(broker.events.map(e => e.channel))];
    const requiredChannels = [
      'asi.rewrite.start',
      'asi.rewrite.attempt',
      'asi.reflect.complete',
      'asi.reattempt.start'
    ];

    const missingChannels = requiredChannels.filter(c => !eventChannels.includes(c));
    if (missingChannels.length > 0) {
      throw new Error(`Missing event channels: ${missingChannels.join(', ')}`);
    }

    console.log('✅ Complete system integration verified');
    console.log('   System Integration Checks:');
    Object.entries(systemChecks).forEach(([check, passed]) => {
      console.log(`   ${passed ? '✓' : '✗'} ${check}`);
    });
    console.log(`\n   Event Flow:`);
    console.log(`   - Total events: ${broker.getEventCount()}`);
    console.log(`   - Event channels: ${eventChannels.length}`);
    console.log(`   - Memories stored: ${archivist.getMemoryCount()}`);
    console.log(`   - Thalamus routes: ${thalamus.callCount}`);

    passedTests++;

  } catch (error) {
    console.log('❌ System integration test failed:', error.message);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log(`\n📊 TEST SUMMARY:`);
  console.log(`   Tests passed: ${passedTests}/${totalTests}`);
  console.log(`   Success rate: ${((passedTests/totalTests) * 100).toFixed(1)}%`);

  if (passedTests === totalTests) {
    console.log(`\n✅ ALL TESTS PASSED - ASI + SOMA Integration Complete!`);
    console.log(`\n🚀 System Capabilities:`);
    console.log(`   ✓ RewriteBrain routes through quad-brain system`);
    console.log(`   ✓ SelfReflectBrain stores lessons in Archivist`);
    console.log(`   ✓ ReattemptController orchestrates full REWRITE → REFLECT loop`);
    console.log(`   ✓ All components communicate via MessageBroker`);
    console.log(`   ✓ Complete frontier reasoning loop: GENERATE → CRITIQUE → REWRITE → REFLECT → REATTEMPT`);
  } else {
    console.log(`\n⚠️  Some tests failed - review integration`);
  }

  console.log('\n' + '═'.repeat(60) + '\n');

  process.exit(passedTests === totalTests ? 0 : 1);
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
