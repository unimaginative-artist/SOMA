// ════════════════════════════════════════════════════════════════════════════
// Theory of Mind Arbiter Test Suite
// ════════════════════════════════════════════════════════════════════════════
// Tests user mental state modeling, intent inference, and perspective-taking
// ════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load CommonJS modules
const TheoryOfMindArbiter = require('../arbiters/TheoryOfMindArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');

// ════════════════════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const TEST_USER_ID = 'test-user-123';

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('\n' + '═'.repeat(80));
  console.log('🧠 THEORY OF MIND ARBITER TEST SUITE');
  console.log('═'.repeat(80));
  console.log();

  let passedTests = 0;
  let totalTests = 0;

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 1: Intent Inference
  // ══════════════════════════════════════════════════════════════════════════

  console.log('📋 TEST 1: Intent Inference\n');

  try {
    const arbiter = new TheoryOfMindArbiter('theory-of-mind-test', {
      intentConfidenceThreshold: 0.7
    });

    await arbiter.onActivate();

    // Test question intent
    const questionIntent = await arbiter.inferUserIntent({
      userId: TEST_USER_ID,
      message: 'What is the temporal query arbiter?',
      context: {}
    });

    console.log(`  🔍 Question Detection:`);
    console.log(`     Intent: ${questionIntent.primary}`);
    console.log(`     Confidence: ${questionIntent.confidence.toFixed(2)}`);
    console.log(`     Expected: seek_information`);

    if (questionIntent.primary === 'seek_information' && questionIntent.confidence > 0.7) {
      console.log(`     ✅ PASS - Correctly identified question intent\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Intent inference failed\n`);
    }
    totalTests++;

    // Test command intent
    const commandIntent = await arbiter.inferUserIntent({
      userId: TEST_USER_ID,
      message: 'Create a new arbiter for audio processing',
      context: {}
    });

    console.log(`  🔍 Command Detection:`);
    console.log(`     Intent: ${commandIntent.primary}`);
    console.log(`     Confidence: ${commandIntent.confidence.toFixed(2)}`);
    console.log(`     Expected: request_action`);

    if (commandIntent.primary === 'request_action' && commandIntent.confidence > 0.7) {
      console.log(`     ✅ PASS - Correctly identified command intent\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Command intent inference failed\n`);
    }
    totalTests++;

    // Test confusion intent
    const confusionIntent = await arbiter.inferUserIntent({
      userId: TEST_USER_ID,
      message: 'I don\'t understand how this works',
      context: {}
    });

    console.log(`  🔍 Confusion Detection:`);
    console.log(`     Intent: ${confusionIntent.primary}`);
    console.log(`     Confidence: ${confusionIntent.confidence.toFixed(2)}`);
    console.log(`     Expected: seek_clarification`);

    if (confusionIntent.primary === 'seek_clarification' && confusionIntent.confidence > 0.7) {
      console.log(`     ✅ PASS - Correctly identified confusion intent\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Confusion intent inference failed\n`);
    }
    totalTests++;

    await arbiter.onDeactivate();

  } catch (error) {
    console.log(`  ❌ FAIL - Test crashed: ${error.message}\n`);
    totalTests += 3;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 2: User Knowledge Modeling
  // ══════════════════════════════════════════════════════════════════════════

  console.log('📋 TEST 2: User Knowledge Modeling\n');

  try {
    const arbiter = new TheoryOfMindArbiter('theory-of-mind-test-2', {
      maxInteractionHistory: 100
    });

    await arbiter.onActivate();

    // Simulate beginner interactions
    arbiter.interactionLog = [
      { userId: TEST_USER_ID, message: 'What is an arbiter?', timestamp: Date.now() },
      { userId: TEST_USER_ID, message: 'How do I start the server?', timestamp: Date.now() },
      { userId: TEST_USER_ID, message: 'Can you explain what AGI means?', timestamp: Date.now() }
    ];

    const beginnerKnowledge = await arbiter.modelUserKnowledge(TEST_USER_ID);

    console.log(`  📚 Beginner Knowledge Estimation:`);
    console.log(`     Level: ${beginnerKnowledge.level}`);
    console.log(`     Confidence: ${beginnerKnowledge.confidence.toFixed(2)}`);
    console.log(`     Questions Asked: ${beginnerKnowledge.signals.questionsAsked}`);

    if (beginnerKnowledge.level === 'beginner') {
      console.log(`     ✅ PASS - Correctly identified beginner level\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Knowledge level estimation failed\n`);
    }
    totalTests++;

    // Simulate expert interactions
    arbiter.interactionLog = [
      { userId: 'expert-user', message: 'I\'ll implement the causal inference using do-calculus', timestamp: Date.now() },
      { userId: 'expert-user', message: 'The meta-learning architecture should use MAML', timestamp: Date.now() },
      { userId: 'expert-user', message: 'I refactored the temporal indexing for O(log n) lookup', timestamp: Date.now() },
      { userId: 'expert-user', message: 'I optimized the episodic memory consolidation pipeline', timestamp: Date.now() }
    ];

    const expertKnowledge = await arbiter.modelUserKnowledge('expert-user');

    console.log(`  📚 Expert Knowledge Estimation:`);
    console.log(`     Level: ${expertKnowledge.level}`);
    console.log(`     Confidence: ${expertKnowledge.confidence.toFixed(2)}`);
    console.log(`     Technical Terms: ${expertKnowledge.signals.technicalTermsUsed}`);
    console.log(`     Problem Solving: ${expertKnowledge.signals.independentProblemSolving}`);

    if (expertKnowledge.level === 'expert' || expertKnowledge.level === 'advanced') {
      console.log(`     ✅ PASS - Correctly identified advanced/expert level\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Expert knowledge level estimation failed\n`);
    }
    totalTests++;

    await arbiter.onDeactivate();

  } catch (error) {
    console.log(`  ❌ FAIL - Test crashed: ${error.message}\n`);
    totalTests += 2;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 3: Confusion Detection
  // ══════════════════════════════════════════════════════════════════════════

  console.log('📋 TEST 3: Confusion Detection\n');

  try {
    const arbiter = new TheoryOfMindArbiter('theory-of-mind-test-3', {
      confusionThreshold: 0.6
    });

    await arbiter.onActivate();

    // Test explicit confusion
    const explicitConfusion = await arbiter.identifyUserConfusion({
      userId: TEST_USER_ID,
      message: 'I\'m confused about how temporal queries work',
      context: {}
    });

    console.log(`  🤔 Explicit Confusion:`);
    console.log(`     Detected: ${explicitConfusion.isConfused}`);
    console.log(`     Confidence: ${explicitConfusion.confidence.toFixed(2)}`);
    console.log(`     Indicators: ${explicitConfusion.indicators.length}`);

    if (explicitConfusion.isConfused && explicitConfusion.confidence > 0.6) {
      console.log(`     ✅ PASS - Detected explicit confusion\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Failed to detect explicit confusion\n`);
    }
    totalTests++;

    // Test repeated question confusion
    arbiter.interactionLog = [
      { userId: TEST_USER_ID, message: 'How do I query temporal data?', timestamp: Date.now() - 5000 },
      { userId: TEST_USER_ID, message: 'How do I query temporal data?', timestamp: Date.now() }
    ];

    const repeatedConfusion = await arbiter.identifyUserConfusion({
      userId: TEST_USER_ID,
      message: 'How do I query temporal data?',
      context: {}
    });

    console.log(`  🤔 Repeated Question Confusion:`);
    console.log(`     Detected: ${repeatedConfusion.isConfused}`);
    console.log(`     Confidence: ${repeatedConfusion.confidence.toFixed(2)}`);
    console.log(`     Source: ${repeatedConfusion.likelySource || 'Unknown'}`);

    if (repeatedConfusion.isConfused) {
      console.log(`     ✅ PASS - Detected confusion from repeated questions\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Failed to detect repeated question confusion\n`);
    }
    totalTests++;

    // Test clarification generation
    if (explicitConfusion.suggestedClarification) {
      console.log(`  💡 Clarification Generation:`);
      console.log(`     Suggested: "${explicitConfusion.suggestedClarification.substring(0, 60)}..."`);
      console.log(`     ✅ PASS - Generated clarifying response\n`);
      passedTests++;
    } else {
      console.log(`  ❌ FAIL - No clarification generated\n`);
    }
    totalTests++;

    await arbiter.onDeactivate();

  } catch (error) {
    console.log(`  ❌ FAIL - Test crashed: ${error.message}\n`);
    totalTests += 3;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 4: User Profile Building
  // ══════════════════════════════════════════════════════════════════════════

  console.log('📋 TEST 4: User Profile Building\n');

  try {
    const arbiter = new TheoryOfMindArbiter('theory-of-mind-test-4', {
      maxInteractionHistory: 100
    });

    await arbiter.onActivate();

    // Build profile
    const profile = await arbiter.buildUserProfile(TEST_USER_ID);

    console.log(`  👤 Profile Creation:`);
    console.log(`     User ID: ${profile.userId}`);
    console.log(`     Interactions: ${profile.totalInteractions}`);
    console.log(`     Preferences Set: ${Object.keys(profile.preferences).length > 0}`);

    if (profile && profile.userId === TEST_USER_ID) {
      console.log(`     ✅ PASS - Profile created successfully\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Profile creation failed\n`);
    }
    totalTests++;

    // Update profile
    await arbiter.updateUserModel(TEST_USER_ID, {
      message: 'Create a temporal query system',
      context: {}
    });

    const updatedProfile = arbiter.getUserProfile(TEST_USER_ID);

    console.log(`  👤 Profile Update:`);
    console.log(`     Total Interactions: ${updatedProfile.totalInteractions}`);
    console.log(`     Recent Topics: ${updatedProfile.recentTopics.length}`);

    if (updatedProfile.totalInteractions > profile.totalInteractions) {
      console.log(`     ✅ PASS - Profile updated successfully\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Profile update failed\n`);
    }
    totalTests++;

    await arbiter.onDeactivate();

  } catch (error) {
    console.log(`  ❌ FAIL - Test crashed: ${error.message}\n`);
    totalTests += 2;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 5: Response Adaptation
  // ══════════════════════════════════════════════════════════════════════════

  console.log('📋 TEST 5: Response Adaptation\n');

  try {
    const arbiter = new TheoryOfMindArbiter('theory-of-mind-test-5', {});

    await arbiter.onActivate();

    // Build beginner profile
    arbiter.interactionLog = [
      { userId: TEST_USER_ID, message: 'What is an API?', timestamp: Date.now() },
      { userId: TEST_USER_ID, message: 'How do I start?', timestamp: Date.now() }
    ];

    await arbiter.modelUserKnowledge(TEST_USER_ID);

    const technicalContent = 'The temporal query arbiter uses bucket-based indexing for O(1) lookups.';
    const adapted = await arbiter.adaptToUserLevel(TEST_USER_ID, technicalContent);

    console.log(`  🎯 Content Adaptation:`);
    console.log(`     Original: "${adapted.original.substring(0, 50)}..."`);
    console.log(`     Adapted for: ${adapted.level}`);
    console.log(`     Simplified: ${adapted.adapted.length > adapted.original.length}`);

    if (adapted.adapted !== adapted.original && adapted.level === 'beginner') {
      console.log(`     ✅ PASS - Content adapted for beginner level\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Content adaptation failed\n`);
    }
    totalTests++;

    await arbiter.onDeactivate();

  } catch (error) {
    console.log(`  ❌ FAIL - Test crashed: ${error.message}\n`);
    totalTests++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 6: Perspective-Taking
  // ══════════════════════════════════════════════════════════════════════════

  console.log('📋 TEST 6: Perspective-Taking\n');

  try {
    const arbiter = new TheoryOfMindArbiter('theory-of-mind-test-6', {});

    await arbiter.onActivate();

    // Simulate expert user
    arbiter.interactionLog = [
      { userId: 'expert-user', message: 'I implemented MAML for meta-learning', timestamp: Date.now() },
      { userId: 'expert-user', message: 'The causal inference uses do-calculus', timestamp: Date.now() }
    ];

    await arbiter.modelUserKnowledge('expert-user');

    const perspective = await arbiter.simulateUserPerspective(
      'expert-user',
      'Implementing a new temporal indexing system'
    );

    console.log(`  🔮 Perspective Simulation:`);
    console.log(`     User: expert-user`);
    console.log(`     Understanding: ${perspective.likelyUnderstanding}`);
    console.log(`     Predicted Questions: ${perspective.predictedQuestions.length}`);
    console.log(`     Approach: ${perspective.recommendedApproach.substring(0, 50)}...`);

    if (perspective.likelyUnderstanding === 'deep' && perspective.predictedQuestions.length > 0) {
      console.log(`     ✅ PASS - Perspective simulation successful\n`);
      passedTests++;
    } else {
      console.log(`     ❌ FAIL - Perspective simulation failed\n`);
    }
    totalTests++;

    await arbiter.onDeactivate();

  } catch (error) {
    console.log(`  ❌ FAIL - Test crashed: ${error.message}\n`);
    totalTests++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL RESULTS
  // ══════════════════════════════════════════════════════════════════════════

  console.log('═'.repeat(80));
  console.log('📊 TEST RESULTS');
  console.log('═'.repeat(80));
  console.log();

  const successRate = ((passedTests / totalTests) * 100).toFixed(1);

  console.log(`Tests Passed: ${passedTests}/${totalTests}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log();

  if (passedTests === totalTests) {
    console.log('🎉 ALL TESTS PASSED! Theory of Mind system is operational!');
    console.log();
    console.log('✅ Intent Inference: WORKING');
    console.log('✅ Knowledge Modeling: WORKING');
    console.log('✅ Confusion Detection: WORKING');
    console.log('✅ User Profiling: WORKING');
    console.log('✅ Response Adaptation: WORKING');
    console.log('✅ Perspective-Taking: WORKING');
    console.log();
    console.log('🧠 Theory of Mind Arbiter: FULLY OPERATIONAL');
  } else {
    console.log('⚠️  SOME TESTS FAILED');
    console.log(`   Failed: ${totalTests - passedTests} tests`);
  }

  console.log('═'.repeat(80));
  console.log();

  process.exit(passedTests === totalTests ? 0 : 1);
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
