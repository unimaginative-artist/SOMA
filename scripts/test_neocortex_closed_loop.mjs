import path from 'path';
import fs from 'fs/promises';
import { NeocortexFollowthrough } from '../core/executive/NeocortexFollowthrough.js';
import { NeocortexHarness } from '../core/executive/NeocortexHarness.js';

console.log('\n======================================================');
console.log('🔄 TEST: Neocortex Closed-Loop Executive Followthrough');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

async function run() {
  const testDir = path.join(process.cwd(), 'scratch', 'test-closed-loop');
  await fs.mkdir(testDir, { recursive: true });

  const testReceiptsPath = path.join(testDir, 'test-receipts.jsonl');
  const dummyArtifactPath = path.join(testDir, 'test-backtest-result.json');

  // Create a realistic completion artifact
  await fs.writeFile(dummyArtifactPath, JSON.stringify({
    summary: 'BTC & ETH Trend-Following Multi-Timeframe Simulation',
    metrics: {
      trades: 98,
      winRate: 39.8,
      totalReturn: 112.58,
      profitFactor: 1.76,
      maxDrawdown: 16.20
    }
  }, null, 2));

  // Mock Discord Arbiter
  let lastDiscordMessage = null;
  const mockDiscord = {
    sendMessage: async ({ channelId, message }) => {
      lastDiscordMessage = { channelId, message };
      return { success: true, messageId: 'msg_12345' };
    }
  };

  // Mock Working Memory
  const workingMemoryState = {
    actions: [],
    discoveries: [],
    preoccupation: null
  };
  const mockWorkingMemory = {
    addAction: (what, result) => workingMemoryState.actions.push({ what, result }),
    addDiscovery: (topic, insight, source) => workingMemoryState.discoveries.push({ topic, insight, source }),
    setPreoccupation: (text) => { workingMemoryState.preoccupation = text; }
  };

  // Mock Broadcast
  let lastBroadcast = null;
  const mockBroadcast = (type, payload) => {
    lastBroadcast = { type, payload };
  };

  const mockSystem = {
    discordArbiter: mockDiscord,
    workingMemory: mockWorkingMemory,
    broadcast: mockBroadcast
  };

  // ── [Test 1] Intent Registration & Tracking ──────────────────────────
  console.log('[Test 1] Followthrough Intent Registration');
  const followthrough = new NeocortexFollowthrough({
    system: mockSystem,
    receiptsPath: testReceiptsPath
  });
  await followthrough.initialize();

  const intent = followthrough.registerIntent({
    goalId: 'goal_backtest_001',
    taskTitle: 'Run Bitcoin & Ethereum trend-following backtest',
    channel: 'discord',
    channelId: 'channel_1092837465',
    user: 'Owner',
    expectedArtifact: dummyArtifactPath
  });

  assert(intent !== null, 'Intent registered successfully');
  assert(intent.goalId === 'goal_backtest_001', 'Intent retains goal ID');
  assert(intent.channelId === 'channel_1092837465', 'Intent captures origin channel ID');

  // ── [Test 2] Evidence & Findings Extraction ─────────────────────────
  console.log('\n[Test 2] Evidence & Findings Extraction');
  const extracted = followthrough.extractFindings({
    id: 'goal_backtest_001',
    metadata: { expectedArtifact: dummyArtifactPath }
  });

  assert(extracted.findings.length >= 3, 'Extracted multiple structured findings from artifact');
  assert(extracted.findings.some(f => f.includes('Win Rate: 39.8%')), 'Extracted win rate metric');
  assert(extracted.findings.some(f => f.includes('Net Return: 112.58%')), 'Extracted return metric');
  assert(extracted.findings.some(f => f.includes('Profit Factor: 1.76')), 'Extracted profit factor metric');

  // ── [Test 3] Goal Completion & Multi-Channel Dispatch ───────────────
  console.log('\n[Test 3] Goal Completed Report-Back Dispatch');
  const completionReceipt = await followthrough.handleGoalCompleted({
    goal: {
      id: 'goal_backtest_001',
      title: 'Run Bitcoin & Ethereum trend-following backtest',
      metadata: { expectedArtifact: dummyArtifactPath }
    },
    result: { success: true }
  });

  assert(completionReceipt.status === 'completed', 'Completion receipt generated');
  assert(lastDiscordMessage !== null, 'Report-back dispatched to Discord');
  assert(lastDiscordMessage.channelId === 'channel_1092837465', 'Report-back sent to correct Discord channel');
  assert(lastDiscordMessage.message.includes('Hey Owner, I finished executing'), 'Report opens with personal conversational anchor');
  assert(lastDiscordMessage.message.includes('Profit Factor: 1.76'), 'Report includes quantitative findings');
  assert(lastDiscordMessage.message.includes(dummyArtifactPath), 'Report includes artifact evidence link');

  // ── [Test 4] Working Memory Present-Tense Ingestion ──────────────────
  console.log('\n[Test 4] Working Memory Context Ingestion');
  assert(workingMemoryState.actions.length > 0, 'Action logged to Working Memory');
  assert(workingMemoryState.discoveries.length > 0, 'Discovery logged to Working Memory');
  assert(workingMemoryState.preoccupation.includes('Finished Run Bitcoin & Ethereum'), 'Preoccupation reflects completed task');

  // ── [Test 5] Command Bridge Broadcast Verification ──────────────────
  console.log('\n[Test 5] Command Bridge Broadcast Verification');
  assert(lastBroadcast !== null, 'WebSocket broadcast emitted');
  assert(lastBroadcast.payload.message.includes('Hey Owner, I finished executing'), 'Pulse notification matches executive report');

  // ── [Test 6] Blocker / Failure Truthful Reporting ───────────────────
  console.log('\n[Test 6] Blocker & Failure Truthful Reporting');
  followthrough.registerIntent({
    goalId: 'goal_blocked_002',
    taskTitle: 'Deploy experimental trading model to mainnet',
    channel: 'discord',
    channelId: 'channel_1092837465'
  });

  const failureReceipt = await followthrough.handleGoalFailed({
    goal: { id: 'goal_blocked_002', title: 'Deploy experimental trading model to mainnet' },
    reason: 'ConstitutionalCore blocked mainnet live promotion without 14-day canary hold'
  });

  assert(failureReceipt.status === 'failed', 'Failure receipt recorded');
  assert(lastDiscordMessage.message.includes('Hey Owner, I hit a blocker'), 'Failure message truthful and direct');
  assert(lastDiscordMessage.message.includes('ConstitutionalCore blocked mainnet'), 'Failure cites exact structural blocker');

  // ── [Test 7] Fail-Open Isolation ─────────────────────────────────────
  console.log('\n[Test 7] Fail-Open Transport Isolation');
  const brokenDiscord = {
    sendMessage: async () => { throw new Error('Discord Gateway Disconnected (503)'); }
  };
  const resilientFollowthrough = new NeocortexFollowthrough({
    system: { discordArbiter: brokenDiscord },
    receiptsPath: testReceiptsPath
  });

  let threw = false;
  try {
    await resilientFollowthrough.handleGoalCompleted({
      goal: { id: 'goal_crash_test', title: 'Test Resilience' }
    });
  } catch {
    threw = true;
  }
  assert(!threw, 'Followthrough failed open safely when transport threw an exception');

  // ── [Test 8] End-to-End Harness Wiring ──────────────────────────────
  console.log('\n[Test 8] End-to-End NeocortexHarness Integration');
  const mockBroker = {
    listeners: new Map(),
    on(event, fn) { this.listeners.set(event, fn); },
    off(event) { this.listeners.delete(event); },
    emit(event, data) { if (this.listeners.has(event)) this.listeners.get(event)(data); }
  };

  const harness = new NeocortexHarness({
    system: { messageBroker: mockBroker, ...mockSystem },
    mode: 'active'
  });
  await harness.start();

  // Simulate an action gap turn that registers a followthrough intent
  const userQuery = 'Can you optimize the trading risk parameters?';
  const draftResponse = 'I will optimize the risk parameters right away Owner!';
  const evalResult = harness.evaluateOutput(draftResponse, { channel: 'discord', channelId: 'ch_999' }, userQuery);

  assert(evalResult.actionGap?.hasGap === true, 'Harness detected action gap');
  assert(evalResult.text.includes('[QUEUE_GOAL:'), 'Harness attached queue goal directive in active mode');

  // Simulate GoalPlanner emitting goal_completed event over message broker
  mockBroker.emit('goal_completed', {
    goal: { id: 'exec_opt_01', title: userQuery },
    result: { summary: 'Risk parameters optimized: MaxDD dropped to 12.4%' }
  });

  // Small tick for async event handling
  await new Promise(r => setTimeout(r, 50));

  assert(lastDiscordMessage !== null, 'Harness message broker listener successfully closed the loop');
  assert(lastDiscordMessage.message.includes('Risk parameters optimized'), 'Dispatched synthesized findings from broker event');

  harness.stop();

  // Cleanup test scratch files
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================');
  console.log(`Closed-Loop Suite Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('❌ Closed-loop test crashed:', err);
  process.exit(1);
});
