import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import strategyHuntDaemon, { StrategyHuntDaemon } from '../daemons/StrategyHuntDaemon.js';
import missionControlRuntime from '../server/finance/MissionControlRuntime.js';

after(async () => {
  await strategyHuntDaemon.stop();
});

function aggregate({ running = true, wins = 0, losses = 0, openPositions = [] } = {}) {
  return {
    isRunning: running,
    instances: [{
      stats: { sessionPnL: 0, wins, losses },
      openPositions,
      lastSignal: { regime: 'ranging' }
    }]
  };
}

test('a zero-trade hunt trial rotates after the normal trial window and excludes itself', async () => {
  const daemon = new StrategyHuntDaemon({ trialWindowMs: 1_000, zeroTradeRotationMs: 1_000 });
  daemon._state = {
    currentTrial: {
      strategyId: 'swarm_architecture', startTime: Date.now() - 2_000,
      startSessionPnl: 0, startTradeCount: 0, startCapital: 10_000
    },
    trialHistory: [], provenStrategies: [], consecutiveWins: 0
  };
  daemon.setAggregateStatusFn(() => aggregate());
  const originalSelect = missionControlRuntime.selectTradingStrategy;
  const originalStatus = missionControlRuntime.getStatus;
  const originalEvaluate = missionControlRuntime._evaluateLiveEvidence;
  let selectionOptions;
  missionControlRuntime._evaluateLiveEvidence = () => ({ allowed: true, reasons: [] });
  missionControlRuntime.getStatus = () => ({ paperCapital: 10_000 });
  missionControlRuntime.selectTradingStrategy = (_regime, _symbol, options) => {
    selectionOptions = options;
    return 'standard_portfolio';
  };
  try {
    await daemon.onTick();
    assert.deepEqual(selectionOptions.excludeStrategyIds, ['swarm_architecture']);
    assert.equal(daemon._state.currentTrial.strategyId, 'standard_portfolio');
    assert.equal(daemon._state.trialHistory.at(-1).trades, 0);
  } finally {
    missionControlRuntime.selectTradingStrategy = originalSelect;
    missionControlRuntime.getStatus = originalStatus;
    missionControlRuntime._evaluateLiveEvidence = originalEvaluate;
  }
});

test('stale proven strategies are revoked when authoritative evidence fails', () => {
  const daemon = new StrategyHuntDaemon();
  daemon._state = {
    currentTrial: null, trialHistory: [], consecutiveWins: 0,
    provenStrategies: [{ strategyId: 'full_aggression', avgDailyPnl: 20 }],
    lockedStrategy: 'full_aggression', lockedStrategyLabel: 'Full Aggression'
  };
  const originalEvaluate = missionControlRuntime._evaluateLiveEvidence;
  missionControlRuntime._evaluateLiveEvidence = () => ({
    allowed: false, reasons: ['negative authoritative paper P&L']
  });
  try {
    daemon._auditProvenStrategies();
    assert.equal(daemon._state.provenStrategies.length, 0);
    assert.equal(daemon._state.lockedStrategy, null);
    assert.equal(daemon._state.revokedStrategies[0].strategyId, 'full_aggression');
  } finally {
    missionControlRuntime._evaluateLiveEvidence = originalEvaluate;
  }
});

test('hunt rotation waits for open positions so strategy attribution stays intact', async () => {
  const daemon = new StrategyHuntDaemon({ trialWindowMs: 1_000, zeroTradeRotationMs: 1_000 });
  daemon._state = {
    currentTrial: {
      strategyId: 'standard_portfolio', startTime: Date.now() - 2_000,
      startSessionPnl: 0, startTradeCount: 0, startCapital: 10_000
    },
    trialHistory: [], provenStrategies: [], consecutiveWins: 0
  };
  daemon.setAggregateStatusFn(() => aggregate({
    openPositions: [{ symbol: 'BTC-USD', strategyId: 'standard_portfolio' }]
  }));
  const originalEvaluate = missionControlRuntime._evaluateLiveEvidence;
  missionControlRuntime._evaluateLiveEvidence = () => ({ allowed: true, reasons: [] });
  try {
    await daemon.onTick();
    assert.equal(daemon._state.currentTrial.strategyId, 'standard_portfolio');
    assert.equal(daemon._state.currentTrial.rotationDeferredUntilFlat, true);
    assert.equal(daemon._state.trialHistory.length, 0);
  } finally {
    missionControlRuntime._evaluateLiveEvidence = originalEvaluate;
  }
});
