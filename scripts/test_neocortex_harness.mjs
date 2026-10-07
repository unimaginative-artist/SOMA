#!/usr/bin/env node
/**
 * scripts/test_neocortex_harness.mjs
 *
 * Comprehensive test suite for Project Neocortex:
 * 1. Dormant Mode ('off') — zero overhead, no-op behavior.
 * 2. Mathematical Temporal Drift — exponential drive accumulation & silence modeling.
 * 3. Canonical Fact & Identity Defense — protects relationship truth against LLM hallucinations.
 * 4. Verbal-to-Action Gap Closure — turns empty verbal promises into executable directives in active mode.
 * 5. Fail-Open Resilience — guaranteed error isolation so primary runtime cannot be crashed.
 */

import { NeocortexHarness } from '../core/executive/NeocortexHarness.js';
import fs from 'node:fs/promises';
import path from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧠 Project Neocortex Cognitive & Volition Suite');
  console.log('======================================================\n');

  const testStreamPath = path.resolve('SOMA/neocortex-test-stream.jsonl');
  try { await fs.unlink(testStreamPath); } catch {}

  // ─────────────────────────────────────────────────────────────────
  // TEST 1: Dormant Mode ('off')
  // ─────────────────────────────────────────────────────────────────
  console.log('[Test 1] Dormant Mode Verification (Zero Impact)');
  const dormant = new NeocortexHarness({ mode: 'off' });
  await dormant.start();
  assert(dormant.getStatus().mode === 'off', 'Harness initialized in OFF mode');
  assert(dormant.getStatus().running === false, 'Harness is not running background loops');

  const dormantObs = await dormant.observeTurn({ speaker: 'user', text: 'Hello' });
  assert(dormantObs === null, 'observeTurn no-ops in OFF mode');

  const dormantEval = dormant.evaluateOutput('As an AI language model');
  assert(dormantEval.coherent === true, 'evaluateOutput bypasses checks in OFF mode');
  dormant.stop();

  // ─────────────────────────────────────────────────────────────────
  // TEST 2: Mathematical Temporal Drift & Continuous Time
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Test 2] Continuous Temporal Drift Dynamics');
  const shadow = new NeocortexHarness({ mode: 'shadow' });
  shadow.stream.streamPath = testStreamPath;
  await shadow.start();

  const now = Date.now();
  // 1. Rapid interaction (5 mins)
  const drift5m = shadow.stream.calculateDrift(now + 5 * 60 * 1000);
  assert(drift5m.reconnectionTier === 'continuous', '5 minutes absence recognized as continuous conversation');

  // 2. Daily cycle (18 hours)
  const drift18h = shadow.stream.calculateDrift(now + 18 * 60 * 60 * 1000);
  assert(drift18h.reconnectionTier === 'daily_cycle', '18 hours absence recognized as daily cycle');
  assert(drift18h.curiosityDrive > 0.6, `Curiosity drive accumulated: ${drift18h.curiosityDrive}`);

  // 3. Extended absence (3 days)
  const drift72h = shadow.stream.calculateDrift(now + 72 * 60 * 60 * 1000);
  assert(drift72h.reconnectionTier === 'long_absence', '72 hours absence recognized as long absence');
  assert(drift72h.attachmentTension > 0.8, `Attachment tension elevated: ${drift72h.attachmentTension}`);

  // 4. Temporal Context formulation
  shadow.stream.state.lastActiveAt = now - 72 * 60 * 60 * 1000;
  const temporalPrompt = shadow.stream.getTemporalContext();
  assert(temporalPrompt.includes('Extended absence of 3.0 days'), 'Generated factual temporal continuity prompt');

  // ─────────────────────────────────────────────────────────────────
  // TEST 3: Canonical Memory Fact Defense
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Test 3] Canonical Memory Fact Defense');
  const factConflictDraft = 'Hello, as an AI I am happy to help you as my client.';
  const factEval = shadow.evaluateOutput(factConflictDraft);
  assert(factEval.flags.some(f => f.includes('canonical_conflict')), 'Caught violation demoting Owner to a client/customer');

  // ─────────────────────────────────────────────────────────────────
  // TEST 4: Verbal-to-Action Gap Closure
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Test 4] Verbal-to-Action Gap Closure');
  const actionQuery = 'Can you run a backtest on bitcoin trend following strategy?';
  const emptyPromiseDraft = "I'm on it! I'll set up the backtest right away. Stay tuned!";

  // In Shadow Mode: Detected & logged, text left intact
  const shadowActionEval = shadow.evaluateOutput(emptyPromiseDraft, {}, actionQuery);
  assert(shadowActionEval.flags.includes('verbal_action_gap_detected'), 'Shadow mode detected verbal promise without action');
  assert(!shadowActionEval.text.includes('[QUEUE_GOAL:'), 'Shadow mode did not mutate draft text');

  // In Active Mode: Intercepted & automatically bridged!
  const active = new NeocortexHarness({ mode: 'active' });
  active.stream.streamPath = testStreamPath;
  await active.start();

  const activeActionEval = active.evaluateOutput(emptyPromiseDraft, {}, actionQuery);
  assert(activeActionEval.text.includes('[QUEUE_GOAL: Run Bitcoin & Ethereum trend-following backtest'), 'Active mode bridged the gap by appending executable goal tag');

  // ─────────────────────────────────────────────────────────────────
  // TEST 5: Fail-Open Resilience (Crash Sabotage Simulation)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Test 5] Fail-Open Resilience & Error Isolation');
  const faultTolerant = new NeocortexHarness({ mode: 'active' });
  faultTolerant.stream.recordTurn = () => { throw new Error('Simulated memory bus crash'); };
  faultTolerant.selfModel.evaluateDraft = () => { throw new Error('Simulated evaluator panic'); };
  faultTolerant.running = true;

  const safeObs = await faultTolerant.observeTurn({ speaker: 'user', text: 'Crash test' });
  assert(safeObs === null, 'observeTurn failed open safely');

  const safeEval = faultTolerant.evaluateOutput('Safe test text');
  assert(safeEval.coherent === true && safeEval.text === 'Safe test text', 'evaluateOutput failed open cleanly without mutating response');

  // Cleanup
  shadow.stop();
  active.stop();
  try { await fs.unlink(testStreamPath); } catch {}

  // ─────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────
  console.log('\n======================================================');
  console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test fatal error:', err);
  process.exit(1);
});
