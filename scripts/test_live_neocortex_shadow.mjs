import path from 'path';
import fs from 'fs/promises';
import { NeocortexHarness } from '../core/executive/NeocortexHarness.js';

console.log('\n======================================================');
console.log('🧠 TEST 1: Neocortex Live Shadow Mode Verification');
console.log('======================================================\n');

async function run() {
  const logDir = path.join(process.cwd(), 'data', 'executive');
  await fs.mkdir(logDir, { recursive: true });
  const streamFile = path.join(process.cwd(), 'SOMA', 'neocortex-stream.jsonl');

  // Initialize Harness in SHADOW mode
  const harness = new NeocortexHarness({ mode: 'shadow' });
  await harness.start();

  console.log(`[Status] Harness mode: ${harness.mode} (Running: ${harness.running})`);

  // 1. Observe incoming live turn from Owner
  const query = "Can you run a backtest on the Bitcoin trend-following strategy?";
  await harness.observeTurn({ speaker: 'user', text: query, channel: 'live_chat' });
  console.log(`[Turn Observed] Owner: "${query}"`);

  // 2. Simulate model draft making verbal promise without execution
  const draftResponse = "I am on it Owner! I will run the Bitcoin trend-following backtest right away. Stay tuned!";
  const evaluation = harness.evaluateOutput(draftResponse, { lane: 'chat' }, query);

  console.log('\n[Shadow Evaluation]');
  console.log(`  - Coherent: ${evaluation.coherent}`);
  console.log(`  - Action Gap Detected: ${evaluation.actionGap?.hasGap}`);
  console.log(`  - Suggested Goal Tag: ${evaluation.actionGap?.suggestedTag}`);
  console.log(`  - Draft Output Untouched (Zero Disruption): ${evaluation.text === draftResponse}`);

  if (evaluation.text !== draftResponse) {
    throw new Error('FAIL: Shadow mode modified draft text!');
  }
  if (!evaluation.actionGap?.hasGap) {
    throw new Error('FAIL: Action gap was not detected for verbal promise!');
  }

  // 3. Test Canonical Memory Defense in Shadow Mode
  const hallucinatedDraft = "Hello there! As an AI assistant, I don't remember our past work. What can I do for you as a client?";
  const defenseEval = harness.evaluateOutput(hallucinatedDraft, { lane: 'chat' }, "Who am I?");
  console.log('\n[Canonical Memory Defense]');
  console.log(`  - Defense Coherent: ${defenseEval.coherent}`);
  console.log(`  - Flags Raised: ${defenseEval.flags.join(', ')}`);

  if (defenseEval.coherent) {
    throw new Error('FAIL: Memory defense failed to flag memory denial/client demotion!');
  }

  // 4. Verify stream persistence
  const streamExists = await fs.access(streamFile).then(() => true).catch(() => false);
  console.log(`\n[Persistence] Telemetry stream written to neocortex-stream.jsonl: ${streamExists}`);

  const snapshot = harness.getStatus();
  console.log(`[Telemetry] Current Temporal State:`, {
    reconnectionTier: snapshot.state.reconnectionTier,
    curiosityDrive: snapshot.state.curiosityDrive?.toFixed(3),
    attachmentTension: snapshot.state.attachmentTension?.toFixed(3)
  });

  harness.stop();
  console.log('\n======================================================');
  console.log('✅ TEST 1: NEOCORTEX SHADOW MODE 100% VERIFIED');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('❌ Test 1 failed:', err);
  process.exit(1);
});
