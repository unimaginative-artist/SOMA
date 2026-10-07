#!/usr/bin/env node
/**
 * Test script to verify SOMA's learning system is capturing interactions
 */

import { UniversalLearningPipeline } from '../arbiters/UniversalLearningPipeline.js';
import MnemonicArbiter from '../arbiters/MnemonicArbiter.js';

console.log('🧪 Testing SOMA Learning Capture System\n');
console.log('='.repeat(70));

// Initialize MnemonicArbiter
const mnemonic = new MnemonicArbiter({
  name: 'TestMnemonicArbiter',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379'
});

await new Promise(resolve => mnemonic.once('initialized', resolve));
console.log('✅ MnemonicArbiter initialized\n');

// Initialize Learning Pipeline
const learningPipeline = new UniversalLearningPipeline({
  name: 'TestLearningPipeline',
  maxExperiences: 10000,
  storageDir: process.cwd() + '/.soma',
  experienceThreshold: 2, // Lower threshold for testing
  timeThreshold: 10000 // Shorter time for testing
});

await learningPipeline.initialize({
  mnemonic: mnemonic,
  planner: null,
  tribrain: null
});

console.log('✅ Learning Pipeline initialized\n');
console.log('='.repeat(70));

// Test 1: Log a user interaction
console.log('\n📝 TEST 1: Logging user interaction...');
await learningPipeline.logInteraction({
  type: 'user_query',
  agent: 'TestAgent',
  input: { text: 'What is machine learning?', source: 'test' },
  output: { response: 'Machine learning is a subset of AI...', confidence: 0.9 },
  context: { sessionId: 'test-session-1' },
  metadata: {
    success: true,
    elapsedMs: 150,
    userSatisfaction: 1.0
  }
});
console.log('   ✅ User interaction logged');

// Test 2: Log a reasoning interaction
console.log('\n📝 TEST 2: Logging reasoning interaction...');
await learningPipeline.logInteraction({
  type: 'reasoning',
  agent: 'QuadBrain',
  input: { query: 'Explain causality', brain: 'LOGOS' },
  output: { text: 'Causality is the relationship between cause and effect...', confidence: 0.85 },
  context: { brain: 'LOGOS', routingMethod: 'direct' },
  metadata: {
    success: true,
    confidence: 0.85,
    brain: 'LOGOS'
  }
});
console.log('   ✅ Reasoning interaction logged');

// Test 3: Log a creative generation
console.log('\n📝 TEST 3: Logging creative generation...');
await learningPipeline.logInteraction({
  type: 'creative_generation',
  agent: 'MuseEngine',
  input: { nodeId: 'test-node-123', contextText: 'AI creativity' },
  output: {
    spark: 'Creativity is the synthesis of unexpected connections',
    variant: 'Alternative approach: pattern recombination',
    critique: 'Risk: May lack depth in technical domains'
  },
  context: { contextsUsed: 3 },
  metadata: {
    success: true,
    elapsedMs: 250,
    avgConfidence: 0.8
  }
});
console.log('   ✅ Creative generation logged');

// Test 4: Log an idea capture
console.log('\n📝 TEST 4: Logging idea capture...');
await learningPipeline.logInteraction({
  type: 'idea_capture',
  agent: 'IdeaCaptureArbiter',
  input: { text: 'SOMA should learn continuously', source: 'ui' },
  output: { id: 'idea-456', stored: true },
  context: { emotion: 'determined', summary: 'Continuous learning requirement' },
  metadata: {
    success: true,
    elapsedMs: 75,
    author: 'user',
    sourceType: 'ui'
  }
});
console.log('   ✅ Idea capture logged');

// Test 5: Check stats
console.log('\n' + '='.repeat(70));
console.log('📊 LEARNING STATISTICS:\n');
const stats = learningPipeline.getStats();
console.log(`   Total Interactions: ${stats.totalInteractions}`);
console.log(`   Total Experiences: ${stats.totalExperiences}`);
console.log(`   Total Outcomes: ${stats.totalOutcomes}`);
console.log(`   Total Memories Stored: ${stats.totalMemories}`);
console.log(`   Experience Buffer Size: ${stats.experienceBufferSize}`);
console.log(`   Learning Rate: ${(stats.learningRate * 100).toFixed(1)}%`);

// Test 6: Manually trigger save
console.log('\n' + '='.repeat(70));
console.log('💾 TEST 5: Manually saving experiences and outcomes...\n');

const expResult = await learningPipeline.experienceBuffer.persistExperiences();
console.log(`   ✅ Experiences saved: ${expResult.count} experiences`);
console.log(`   📁 File: ${expResult.filepath}`);

await learningPipeline.outcomeTracker.persistOutcomes();
console.log('   ✅ Outcomes saved');

// Shutdown
console.log('\n' + '='.repeat(70));
console.log('🛑 Shutting down...\n');
await learningPipeline.shutdown();
console.log('✅ Learning Pipeline shutdown complete');
console.log('✅ All learning data saved to disk\n');

console.log('='.repeat(70));
console.log('🎉 TEST COMPLETE - Check .soma/ directory for saved data');
console.log('='.repeat(70) + '\n');

process.exit(0);
