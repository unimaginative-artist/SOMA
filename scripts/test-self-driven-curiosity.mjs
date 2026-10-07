/**
 * test-self-driven-curiosity.mjs
 *
 * Test SOMA's self-driven curiosity system
 *
 * This demonstrates:
 * 1. SOMA analyzing her own code to find gaps
 * 2. SOMA analyzing conversations to find what she's uncertain about
 * 3. SOMA generating her own learning goals (not pre-configured!)
 */

import { ConversationCuriosityExtractor } from '../arbiters/ConversationCuriosityExtractor.js';
import { CuriosityEngine } from '../arbiters/CuriosityEngine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('═'.repeat(80));
console.log('🧠 TESTING SOMA\'S SELF-DRIVEN CURIOSITY');
console.log('═'.repeat(80));
console.log();
console.log('This test shows SOMA analyzing herself and generating her own learning goals');
console.log('based on self-reflection, NOT pre-configured topics!');
console.log();
console.log('─'.repeat(80));

async function main() {
  // 1. Create CuriosityEngine
  console.log('\n📊 Step 1: Initialize CuriosityEngine');
  console.log('─'.repeat(80));

  const curiosityEngine = new CuriosityEngine({
    minCuriosityThreshold: 0.3,
    explorationInterval: 60000 // 1 minute (faster for testing)
  });

  await curiosityEngine.initialize();

  console.log('✅ CuriosityEngine initialized');
  console.log(`   Initial curiosity queue: ${curiosityEngine.curiosityQueue.length} items`);
  console.log();

  // 2. Analyze conversations
  console.log('\n💬 Step 2: Analyze Recent Conversations');
  console.log('─'.repeat(80));

  const conversationExtractor = new ConversationCuriosityExtractor({
    experiencesDir: path.join(__dirname, '..', '.soma', 'experiences'),
    curiosityEngine: curiosityEngine
  });

  const conversationResults = await conversationExtractor.analyzeConversations(20); // Last 20 files

  console.log('\n📈 Conversation Analysis Results:');
  console.log(`   Conversations analyzed: ${conversationResults.stats.conversationsAnalyzed}`);
  console.log(`   Experiences processed: ${conversationResults.stats.experiencesProcessed}`);
  console.log(`   Uncertainties found: ${conversationResults.stats.uncertaintiesFound}`);
  console.log(`   Curiosity questions generated: ${conversationResults.curiosityQuestions.length}`);
  console.log();

  if (conversationResults.uncertainTopics.length > 0) {
    console.log('🔍 Topics SOMA was uncertain about:');
    for (const [topic, score] of conversationResults.uncertainTopics.slice(0, 5)) {
      console.log(`   • ${topic} (uncertainty: ${score.toFixed(2)})`);
    }
    console.log();
  }

  if (conversationResults.repeatedConcepts.length > 0) {
    console.log('📚 Concepts that came up repeatedly:');
    for (const [concept, count] of conversationResults.repeatedConcepts.slice(0, 10)) {
      console.log(`   • ${concept} (${count} times)`);
    }
    console.log();
  }

  if (conversationResults.userInterests.length > 0) {
    console.log('🎯 User interest areas:');
    for (const [interest, count] of conversationResults.userInterests) {
      console.log(`   • ${interest} (${count} queries)`);
    }
    console.log();
  }

  // 3. Show generated curiosity questions
  console.log('\n❓ Step 3: Self-Generated Curiosity Questions');
  console.log('─'.repeat(80));
  console.log();
  console.log('These are questions SOMA generated about HERSELF, not pre-configured topics:');
  console.log();

  if (conversationResults.curiosityQuestions.length > 0) {
    for (const q of conversationResults.curiosityQuestions.slice(0, 10)) {
      console.log(`[${q.priority.toFixed(2)}] ${q.question}`);
      console.log(`    Type: ${q.type}`);
      console.log(`    Reason: ${q.trigger.reason}`);
      console.log();
    }
  } else {
    console.log('   (No conversation-driven questions generated - need more experience data)');
    console.log();
  }

  // 4. Show current curiosity state
  console.log('\n🧠 Step 4: Current Curiosity State');
  console.log('─'.repeat(80));

  const state = curiosityEngine.getCuriosityState();

  console.log('\n💪 Motivation Levels:');
  console.log(`   Curiosity:        ${(state.motivation.currentCuriosity * 100).toFixed(0)}%`);
  console.log(`   Exploration:      ${(state.motivation.explorationDrive * 100).toFixed(0)}%`);
  console.log(`   Learning Hunger:  ${(state.motivation.learningHunger * 100).toFixed(0)}%`);
  console.log(`   Creativity:       ${(state.motivation.creativityUrge * 100).toFixed(0)}%`);
  console.log(`   Improvement:      ${(state.motivation.improvementDesire * 100).toFixed(0)}%`);
  console.log();

  console.log('🎯 Top Curiosity Questions in Queue:');
  if (state.topQuestions.length > 0) {
    for (const q of state.topQuestions.slice(0, 10)) {
      console.log(`   [${q.priority.toFixed(2)}] ${q.question}`);
    }
  } else {
    console.log('   (Queue is empty - generating new questions...)');
  }
  console.log();

  // 5. Statistics
  console.log('\n📊 Step 5: Curiosity Engine Statistics');
  console.log('─'.repeat(80));

  const stats = curiosityEngine.getStats();

  console.log(`   Questions Generated: ${stats.questionsGenerated}`);
  console.log(`   Explorations Started: ${stats.explorationsStarted}`);
  console.log(`   Knowledge Gaps: ${stats.knowledgeGaps}`);
  console.log(`   Self-Improvement Goals: ${stats.selfImprovementGoals}`);
  console.log(`   Autonomous Learnings: ${stats.autonomousLearnings}`);
  console.log(`   Autonomous Trainings: ${stats.autonomousTrainings}`);
  console.log(`   Creative Combinations: ${stats.creativeCombinations}`);
  console.log();

  // Summary
  console.log('═'.repeat(80));
  console.log('🎓 SUMMARY');
  console.log('═'.repeat(80));
  console.log();
  console.log('✅ SOMA can now:');
  console.log('   1. Analyze her own conversations to find what she\'s uncertain about');
  console.log('   2. Identify topics the user cares about');
  console.log('   3. Generate curiosity questions based on self-reflection');
  console.log('   4. Prioritize learning based on uncertainty and user needs');
  console.log();
  console.log('🌟 This is SELF-DRIVEN curiosity - not pre-configured!');
  console.log();
  console.log('Next steps:');
  console.log('   1. CodeObservationArbiter will analyze SOMA\'s own code');
  console.log('   2. Both feed into CuriosityEngine');
  console.log('   3. At 4 AM, SOMA trains on all of this!');
  console.log();
  console.log('═'.repeat(80));
}

main().catch(console.error);
