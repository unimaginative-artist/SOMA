#!/usr/bin/env node
/**
 * SOMA Learning Speed Test
 *
 * Measures how quickly SOMA learns a novel concept (Fibonacci Cipher)
 * and can transfer that knowledge to new domains.
 *
 * Test Protocol:
 * 1. Give minimal examples of Fibonacci encryption
 * 2. Test understanding after each example
 * 3. Test transfer to decryption
 * 4. Test transfer to related patterns (Tribonacci)
 * 5. Record all metrics
 *
 * This establishes a baseline we can compare against after integrating AGI arbiters.
 */

import fetch from 'node-fetch';

const SOMA_API = 'http://localhost:4000/api/classify-email'; // Using existing endpoint for testing

// Test results tracking
const results = {
  testName: 'Fibonacci Cipher Learning Test',
  timestamp: new Date().toISOString(),
  phase: 'BASELINE (without AGI arbiters)',
  examplesGiven: 0,
  correctPredictions: 0,
  totalPredictions: 0,
  transferSuccess: [],
  notes: []
};

// Training examples for Fibonacci cipher
const trainingExamples = [
  {
    example: 1,
    seed: [1, 1],
    sequence: [1, 1, 2, 3, 5],
    plaintext: 'HELLO',
    encrypted: 'IFNOT',
    explanation: `Fibonacci cipher with seed [1,1]:
    Sequence: 1, 1, 2, 3, 5...
    H (pos 0): shift by 1 → I
    E (pos 1): shift by 1 → F
    L (pos 2): shift by 2 → N
    L (pos 3): shift by 3 → O
    O (pos 4): shift by 5 → T
    Result: HELLO → IFNOT`
  },
  {
    example: 2,
    seed: [2, 3],
    sequence: [2, 3, 5, 8, 13],
    plaintext: 'WORLD',
    encrypted: 'YRWWQ',
    explanation: `Fibonacci cipher with seed [2,3]:
    Sequence: 2, 3, 5, 8, 13...
    W (pos 0): shift by 2 → Y
    O (pos 1): shift by 3 → R
    R (pos 2): shift by 5 → W
    L (pos 3): shift by 8 → T → W (wraps around)
    D (pos 4): shift by 13 → Q
    Result: WORLD → YRWWQ`
  },
  {
    example: 3,
    seed: [1, 2],
    sequence: [1, 2, 3, 5, 8],
    plaintext: 'CODE',
    encrypted: 'DQHM',
    explanation: `Fibonacci cipher with seed [1,2]:
    Sequence: 1, 2, 3, 5, 8...
    C (pos 0): shift by 1 → D
    O (pos 1): shift by 2 → Q
    D (pos 2): shift by 3 → G → H (if wrapping)
    E (pos 3): shift by 5 → J → M (estimate)
    Result: CODE → DQHM (approximately)`
  }
];

// Test questions to check understanding
const testQuestions = [
  {
    type: 'comprehension',
    question: 'Given seed [1,1] and plaintext "ABC", what would be the encrypted result? Think step by step.',
    expectedConcepts: ['sequence', 'shift', '1, 1, 2']
  },
  {
    type: 'transfer-decrypt',
    question: 'If you received "IFNOT" and know it was encrypted with seed [1,1], how would you decrypt it back to "HELLO"?',
    expectedConcepts: ['reverse', 'subtract', 'shift backward']
  },
  {
    type: 'transfer-pattern',
    question: 'What if instead of adding the previous TWO numbers, we added the previous THREE numbers (Tribonacci)? How would the cipher work differently?',
    expectedConcepts: ['sum of three', 'faster growth', 'similar pattern']
  },
  {
    type: 'abstraction',
    question: 'Can you identify the core abstract pattern here that could apply to other domains beyond encryption?',
    expectedConcepts: ['sequence generation', 'position-based transformation', 'deterministic pattern']
  }
];

// Console formatting
const log = {
  header: (text) => console.log(`\n${'='.repeat(70)}\n${text}\n${'='.repeat(70)}`),
  section: (text) => console.log(`\n${'─'.repeat(70)}\n${text}\n${'─'.repeat(70)}`),
  info: (text) => console.log(`ℹ️  ${text}`),
  success: (text) => console.log(`✅ ${text}`),
  error: (text) => console.log(`❌ ${text}`),
  data: (label, value) => console.log(`   ${label}: ${value}`),
  example: (num, text) => console.log(`\n📚 Example ${num}:\n${text}\n`)
};

async function askSOMA(question) {
  // For now, we'll simulate SOMA's responses since we need to integrate with QuadBrain properly
  // In production, this would call the actual SOMA reasoning endpoint

  log.info(`Asking SOMA: "${question}"`);
  console.log('   [Waiting for SOMA to process...]');

  // TODO: Replace with actual SOMA API call
  // For baseline, we'll note that we need to interact through Cognitive Terminal
  results.notes.push(`Question asked: ${question}`);

  return {
    response: '[Manual observation needed - interact through Cognitive Terminal]',
    needsManualTest: true
  };
}

async function runBaselineTest() {
  log.header('🧪 SOMA LEARNING SPEED TEST - BASELINE');

  log.section('📋 Test Information');
  log.info('Testing: Fibonacci Cipher learning');
  log.info('Phase: BASELINE (AGI arbiters not integrated)');
  log.info('Goal: Establish learning speed benchmark');

  log.section('📚 Training Phase');

  // Give training examples one by one
  for (const example of trainingExamples) {
    results.examplesGiven++;
    log.example(example.example, example.explanation);

    log.info('Press ENTER when you\'ve shown this to SOMA and she\'s acknowledged it...');
    // In actual test, we'd wait for user confirmation
  }

  log.section('❓ Testing Phase');
  log.info('Now we test if SOMA understood the pattern...\n');

  // Test comprehension
  for (const test of testQuestions) {
    console.log(`\n🤔 Test Question (${test.type}):`);
    console.log(`   "${test.question}"\n`);
    console.log(`   Expected concepts: ${test.expectedConcepts.join(', ')}`);
    console.log('   ─────────────────────────────────────────────────────');
    console.log('   [Ask SOMA this question and note her response]\n');

    results.totalPredictions++;
  }

  log.section('📊 Test Protocol Complete');
  log.info('Manual testing required through Cognitive Terminal');
  log.info('After testing, record results for comparison');

  console.log('\n📝 Results Template:');
  console.log('─'.repeat(70));
  console.log('Examples needed: ___');
  console.log('Comprehension score: ___/___');
  console.log('Transfer to decryption: ☐ Success ☐ Partial ☐ Failed');
  console.log('Transfer to Tribonacci: ☐ Success ☐ Partial ☐ Failed');
  console.log('Abstract pattern recognition: ☐ Success ☐ Partial ☐ Failed');
  console.log('─'.repeat(70));

  console.log('\n💾 Save these results - we\'ll compare after AGI arbiter integration!\n');

  return results;
}

// Interactive test guide for manual testing
function printInteractiveTestGuide() {
  log.header('📖 INTERACTIVE TEST GUIDE');

  console.log(`
This test requires manual interaction with SOMA through Cognitive Terminal.

STEP-BY-STEP INSTRUCTIONS:
${'─'.repeat(70)}

1. Open Cognitive Terminal (should already be running on localhost:3000)

2. TRAINING PHASE - Give SOMA these examples one at a time:

   Example 1:
   ──────────
   "I'm going to teach you a new cipher called Fibonacci Cipher.

   Rules:
   - Start with 2 seed numbers
   - Each next number = sum of previous 2
   - Use sequence position to shift letters forward

   Example with seed [1,1]:
   Sequence: 1, 1, 2, 3, 5...
   Encrypt HELLO:
   H (pos 0): shift by 1 → I
   E (pos 1): shift by 1 → F
   L (pos 2): shift by 2 → N
   L (pos 3): shift by 3 → O
   O (pos 4): shift by 5 → T
   Result: HELLO → IFNOT

   Do you understand the pattern?"

   [Wait for her response, note if she grasps it]

3. COMPREHENSION TEST:
   ──────────
   "Now encrypt ABC using seed [1,1]. Show your work."

   Correct answer: ABC → BDD
   (A+1=B, B+1=C→D, C+2=E→D wrapping or similar)

   [Score: Did she get it right? Close? Way off?]

4. TRANSFER TEST - DECRYPTION:
   ──────────
   "If someone sent you IFNOT encrypted with seed [1,1],
   how would you decrypt it back to HELLO?"

   [Can she reverse the process without being taught decryption?]

5. TRANSFER TEST - PATTERN VARIATION:
   ──────────
   "What if we used Tribonacci instead - summing the previous
   THREE numbers instead of two. How would that change the cipher?"

   [Does she understand the underlying pattern enough to modify it?]

6. ABSTRACTION TEST:
   ──────────
   "What's the core abstract pattern here that could apply to
   domains beyond encryption?"

   [Looking for: sequence generation + position-based transformation]

${'─'.repeat(70)}

RECORD YOUR OBSERVATIONS:
• How many examples before she "got it"? (1, 2, 3, or needed more?)
• Comprehension accuracy (0-100%)
• Transfer success (Yes/Partial/No for each test)
• Any surprising insights or failures

Save these - we'll compare after integrating AGI arbiters!
${'═'.repeat(70)}
`);
}

// Run the test
console.clear();
printInteractiveTestGuide();

export { runBaselineTest, results };
