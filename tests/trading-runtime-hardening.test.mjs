import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessDecisionDataFreshness,
  maxDecisionAgeForTimeframe
} from '../server/finance/TradingDataFreshness.js';
import { buildCoinbaseCandles, buildYahooCandles } from '../server/finance/marketDataService.js';
import {
  buildTradingResearchStatus,
  isAuthorizedPaperCandidateSession,
  selectExecutablePaperCandidate,
  selectQualifiedOfflinePaperCandidate
} from '../server/finance/PaperCandidateSelector.js';
import { simulationPriorityScore } from '../core/signals/generator/SimToLiveReconciler.js';
import {
  learningEvidenceDelta,
  SimulationLearningEngine
} from '../server/finance/SimulationLearningEngine.js';
import { MissionControlRuntime } from '../server/finance/MissionControlRuntime.js';
import { TradingPerformanceGuard } from '../server/finance/TradingPerformanceGuard.js';
import { PaperExecutionSimulator } from '../server/finance/PaperExecutionSimulator.js';
import {
  ALPACA_CRYPTO_FEES,
  enforceVenueCompatibility,
  paperCapitalTierForEvidence,
  TRADING_ECONOMICS_VERSION
} from '../server/finance/TradingResearchPolicy.js';
import { buildQualifiedPaperAutostartPlan } from '../server/finance/TradingAutostartPolicy.js';
import { TradingResearchDaemon, researchMemoryGate } from '../server/finance/TradingResearchDaemon.js';
import { writeJsonAtomicSafe } from '../server/utils/SafeJsonPersistence.js';
import { requestSupervisorRestart } from '../server/services/SupervisorRestart.js';
import { buildExecutionStoppedMessage } from '../server/finance/TradingStatusMessaging.js';

function currentPolicy() {
  return {
    economicsVersion: TRADING_ECONOMICS_VERSION,
    costModel: {
      makerFeeBps: ALPACA_CRYPTO_FEES.makerBps,
      takerFeeBps: ALPACA_CRYPTO_FEES.takerBps
    }
  };
}

test('freshness gate accepts current bars and rejects stale cached bars', () => {
  const now = Date.now();
  assert.equal(assessDecisionDataFreshness([
    { timestamp: now - 30000, close: 100 }
  ], { now }).validForEntry, true);

  const stale = assessDecisionDataFreshness([
    { timestamp: new Date(now - 180000).toISOString(), close: 100, isCached: true }
  ], { now, maxAgeMs: 120000 });
  assert.equal(stale.validForEntry, false);
  assert.equal(stale.cached, true);
  assert.equal(stale.ageMs, 180000);
});

test('five-minute decisions allow a completed candle but not an old feed', () => {
  assert.equal(maxDecisionAgeForTimeframe('5Min'), 660000);
});

test('Yahoo normalization selects the latest bars instead of the oldest bars', () => {
  const candles = buildYahooCandles({
    timestamp: [1, 2, 3, 4],
    indicators: {
      quote: [{
        open: [10, 20, 30, 40],
        high: [11, 21, 31, 41],
        low: [9, 19, 29, 39],
        close: [10.5, 20.5, 30.5, 40.5],
        volume: [1, 2, 3, 4]
      }]
    }
  }, 2);
  assert.deepEqual(candles.map(candle => candle.timestamp), [3000, 4000]);
  assert.deepEqual(candles.map(candle => candle.close), [30.5, 40.5]);
});

test('Coinbase candles are normalized from newest-first into chronological bars', () => {
  const candles = buildCoinbaseCandles([
    [300, 9, 12, 10, 11, 5],
    [100, 7, 10, 8, 9, 3],
    [200, 8, 11, 9, 10, 4]
  ], 2);
  assert.deepEqual(candles.map(bar => bar.timestamp), [200000, 300000]);
  assert.deepEqual(candles.map(bar => bar.close), [10, 11]);
});

test('paper candidate executor selects a bounded paper-only exact pair', () => {
  const candidate = enforceVenueCompatibility({
    id: 'candidate-1',
    state: 'paper_candidate',
    strategyId: 'standard_portfolio',
    symbol: 'ETH-USD',
    compiledStrategy: { paperOnly: true, dsl: { execution: { style: 'taker_market' } } }
  });
  const selected = selectExecutablePaperCandidate({
    policy: currentPolicy(),
    paperQueue: [
      { state: 'rejected_in_simulation', strategyId: 'bad', symbol: 'ETH-USD' },
      candidate
    ]
  });
  assert.equal(selected.id, 'candidate-1');
});

test('paper candidate executor rejects stale economics', () => {
  assert.equal(selectExecutablePaperCandidate({
    policy: currentPolicy(),
    paperQueue: [{
      id: 'legacy', state: 'paper_candidate', strategyId: 'legacy', symbol: 'ETH-USD',
      compiledStrategy: { paperOnly: true, dsl: { entry: { direction: 'long_only' }, execution: { style: 'taker_market' } } }
    }]
  }), null);
});

test('boot trading fails closed instead of starting a generic losing preset', () => {
  assert.deepEqual(buildQualifiedPaperAutostartPlan({
    selection: null,
    requestedSymbols: ['ETH', 'ETH-USD']
  }), {
    allowed: false,
    reason: 'no_qualified_paper_candidate',
    requestedSymbols: ['ETH-USD']
  });
});

test('boot trading binds execution to the exact qualified research candidate', () => {
  const plan = buildQualifiedPaperAutostartPlan({
    selection: {
      selectedBy: 'offline_forward_qualified',
      candidate: {
        id: 'candidate-7',
        key: 'trend:BTC-USD:7',
        strategyId: 'SOMA_TREND_RESEARCH',
        symbol: 'BTC'
      }
    },
    requestedSymbols: ['ETH-USD']
  });
  assert.equal(plan.allowed, true);
  assert.equal(plan.symbol, 'BTC-USD');
  assert.equal(plan.strategyId, 'soma_trend_research');
  assert.equal(plan.candidateKey, 'trend:BTC-USD:7');
  assert.equal(plan.selectedBy, 'offline_forward_qualified');
});

test('trading research state persistence degrades safely when the disk is full', () => {
  const diskFull = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
  const daemon = new TradingResearchDaemon({
    statePath: 'data/test/research-state.json',
    fileSystem: {
      readFileSync() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      mkdirSync() {},
      writeFileSync() { throw diskFull; },
      renameSync() { throw new Error('rename must not run after a failed write'); },
      rmSync() {}
    }
  });
  assert.equal(daemon._save(), false);
  assert.match(daemon.state.lastPersistenceError, /ENOSPC/);
  assert.ok(daemon.state.lastPersistenceFailureAt);
});

test('research memory gate defers heavy cycles under system RAM pressure', () => {
  const GiB = 1024 ** 3;
  assert.equal(researchMemoryGate({ freeBytes: GiB, totalBytes: 32 * GiB }).allowed, false);
  assert.equal(researchMemoryGate({ freeBytes: 6 * GiB, totalBytes: 32 * GiB }).allowed, true);
  assert.equal(researchMemoryGate({ freeBytes: NaN, totalBytes: 32 * GiB }).reason, 'system_memory_unavailable');

  let persisted = null;
  const daemon = new TradingResearchDaemon({
    statePath: 'data/test/research-resource-state.json',
    resourceSnapshot: () => ({ freeBytes: GiB, totalBytes: 32 * GiB }),
    resourceRetryMs: 60_000,
    fileSystem: {
      readFileSync() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      mkdirSync() {},
      writeFileSync(_path, value) { persisted = JSON.parse(value); },
      renameSync() {}
    }
  });
  try {
    const result = daemon.runNow();
    assert.equal(result.deferred, true);
    assert.match(result.reason, /system_ram_pressure/);
    assert.equal(daemon.child, null);
    assert.equal(persisted.lastDeferredReason, result.reason);
    assert.ok(daemon.resourceRetryTimer);
  } finally {
    daemon.stop();
  }
  assert.equal(daemon.resourceRetryTimer, null);
});

test('research daemon adopts a newer externally completed cycle before its next save', () => {
  let persisted = JSON.stringify({ running: false, lastRunAt: '2026-08-13T10:00:00.000Z', experimentIndex: 4 });
  const daemon = new TradingResearchDaemon({
    statePath: 'data/test/research-state.json',
    fileSystem: { readFileSync: () => persisted }
  });
  persisted = JSON.stringify({
    running: false, lastRunAt: '2026-08-13T11:00:00.000Z', lastExitCode: 0,
    experimentIndex: 5, lastMeaningfulOutcome: 'verified external cycle'
  });
  const status = daemon.getStatus();
  assert.equal(status.experimentIndex, 5);
  assert.equal(status.lastMeaningfulOutcome, 'verified external cycle');
});

test('shared JSON persistence preserves the process when a ledger write fails', () => {
  let reported = null;
  const result = writeJsonAtomicSafe('data/test/ledger.json', { ok: true }, {
    fileSystem: {
      mkdirSync() {},
      writeFileSync() { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
      renameSync() { throw new Error('rename must not run'); },
      rmSync() {}
    },
    onError: error => { reported = error; }
  });
  assert.equal(result.success, false);
  assert.equal(result.code, 'ENOSPC');
  assert.equal(reported.code, 'ENOSPC');
});

test('maintenance restart delegates to Marionette instead of relying on a slow crash loop', async () => {
  let request = null;
  const result = await requestSupervisorRestart({
    service: 'soma',
    baseUrl: 'http://127.0.0.1:9000/',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ status: 'restarting' }) };
    }
  });
  assert.equal(result.accepted, true);
  assert.equal(request.url, 'http://127.0.0.1:9000/reset/soma');
  assert.equal(request.options.method, 'POST');
});

test('execution-stop messaging distinguishes a flat paper engine from active research', () => {
  const message = buildExecutionStoppedMessage({
    symbol: 'ETH-USD', reason: 'candidate_invalidated',
    research: { candidateAvailable: false, blockedReason: 'forward_gate_failed' }
  });
  assert.match(message.title, /Execution Stopped/);
  assert.match(message.title, /Research Active/);
  assert.match(message.body, /Paper execution stopped/);
  assert.match(message.body, /No candidate currently qualifies: forward_gate_failed/);
});

test('portfolio-pruner stop messaging explains the quarantine instead of claiming an operator stop', () => {
  const message = buildExecutionStoppedMessage({
    symbol: 'BTC-USD',
    reason: 'portfolio_pruner: auto-cut: 43 trades, 34.9% win rate, $-9.82',
    research: { candidateAvailable: false, blockedReason: 'forward_gate_failed' }
  });
  assert.match(message.title, /Paper Engine Pruned/);
  assert.match(message.body, /automatically pruned/);
  assert.match(message.body, /quarantined from canary restarts/);
  assert.doesNotMatch(message.body, /operator_requested/);
});

test('an invalidated sim-to-live candidate cannot open another paper position', () => {
  const config = {
    selectedBy: 'mission_control_sim_to_live',
    selectedCandidateKey: 'standard_portfolio:TLT'
  };
  assert.equal(isAuthorizedPaperCandidateSession({
    config,
    activeStrategy: null,
    symbol: 'TLT',
    strategyId: 'standard_portfolio'
  }), false);
  assert.equal(isAuthorizedPaperCandidateSession({
    config,
    activeStrategy: {
      source: 'sim_to_live',
      candidateKey: 'standard_portfolio:TLT',
      symbol: 'TLT',
      strategyId: 'standard_portfolio'
    },
    symbol: 'TLT',
    strategyId: 'standard_portfolio'
  }), true);
});

test('offline paper selector requires both development and frozen-forward evidence', () => {
  const candidate = enforceVenueCompatibility({
    id: 'offline-1', strategyId: 'vortex', symbol: 'ETH',
    compiledStrategy: { paperOnly: true, dsl: { execution: { style: 'taker_market' } } }
  });
  assert.equal(selectQualifiedOfflinePaperCandidate({
    policy: currentPolicy(),
    qualifiedCandidates: [{ qualified: false, evaluation: { supported: true }, finalHoldout: { supported: true }, candidate }]
  }), null);
  const selected = selectQualifiedOfflinePaperCandidate({
    policy: currentPolicy(),
    qualifiedCandidates: [{
      qualified: true,
      evaluation: { supported: true, trades: 120 },
      finalHoldout: {
        supported: true, trades: 30, segmentGatePassed: true, excessPnlVsNoTrade: 10,
        executionStyle: 'taker_market', deflatedSharpe: { probability: 0.99 }, pbo: { probability: 0.25 }
      },
      candidate
    }]
  });
  assert.equal(selected.id, 'offline-1');
  assert.equal(selected.offlineEvidence.forward.trades, 30);
  assert.equal(selected.paperCanaryMaxTradeValue, 5000);
});

test('offline paper canary starts at $250 and does not enable live trading', () => {
  const runtime = new MissionControlRuntime();
  runtime.hydrateFromMarketLab = () => runtime.state.activeStrategy;
  runtime.state.paperCapital = 10000;
  runtime.state.activeTier = 'paper';
  runtime.state.activeStrategy = {
    source: 'offline_forward_qualified',
    strategyId: 'paper_canary_test',
    symbol: 'ETH-USD',
    paperCanaryMaxTradeValue: 5000,
    compiledStrategy: {
      paperOnly: true,
      dsl: {
        sizing: { maxPositionPct: 0.028, maxPaperTradeValue: 1000 },
        exit: { stopLossPct: 0.01, takeProfitPct: 0.02, trailingStopPct: 0.01, maxPositionAgeMs: 3600000 }
      }
    }
  };
  const profile = runtime.getActiveExecutionProfile({ symbol: 'ETH-USD' });
  assert.equal(profile.config.maxPaperTradeValue, 250);
  assert.equal(profile.config.maxTradeValue, 250);
  assert.equal(profile.paperScaling.tierNotional, 250);
  assert.equal(profile.liveTradingEnabled, false);
});

test('trading research status is isolated, paper-only, and truthful when no strategy qualifies', () => {
  const status = buildTradingResearchStatus({ simToLiveReport: { policy: currentPolicy(), paperQueue: [] } });
  assert.equal(status.isolatedFromGeneralAutonomy, true);
  assert.equal(status.livePromotionAllowed, false);
  assert.equal(status.candidateAvailable, false);
  assert.equal(status.blockedReason, 'no_candidate_passed_current_economics_and_frozen_forward_gates');
});

test('paper capital grows only after exact-candidate evidence clears each tier', () => {
  assert.equal(paperCapitalTierForEvidence({ closedTrades: 29, netPnl: 50, profitFactor: 2, maxDrawdownPct: 1 }).notional, 250);
  assert.equal(paperCapitalTierForEvidence({ closedTrades: 60, netPnl: 50, profitFactor: 1.3, maxDrawdownPct: 4 }).notional, 1000);
  assert.equal(paperCapitalTierForEvidence({ closedTrades: 150, netPnl: 50, profitFactor: 1.4, maxDrawdownPct: 4 }).notional, 5000);
});

test('paper simulator charges fees on filled quantity and supports atomic exits', () => {
  const simulator = new PaperExecutionSimulator({ rejectProbability: 0, partialFillThreshold: 1 });
  const partial = simulator.simulateFill({ symbol: 'ETH-USD', side: 'buy', qty: 10, referencePrice: 100 });
  assert.ok(partial.filledQty <= 10);
  assert.equal(partial.liquidity, 'taker');
  assert.equal(partial.feeBps, 25);
  assert.ok(Math.abs(partial.fee - partial.filledPrice * partial.filledQty * 0.0025) < 1e-9);
  const exit = simulator.simulateFill({ symbol: 'ETH-USD', side: 'sell', qty: 10, referencePrice: 100, allowPartialFill: false });
  assert.equal(exit.filledQty, 10);
  assert.equal(exit.status, 'filled');
});

test('paper cost model honors observed spread without becoming optimistic', () => {
  const simulator = new PaperExecutionSimulator({ baseSpreadBps: 2, volatilitySpreadMultiplier: 0 });
  const cost = simulator.estimateCostPct({
    referencePrice: 100, qty: 1,
    bars: [{ close: 100, bid: 99.9, ask: 100.1 }, { close: 100, spreadBps: 18 }]
  });
  assert.ok(Math.abs(cost.observedSpreadBps - 19) < 1e-9);
  assert.ok(Math.abs(cost.spreadBps - 19) < 1e-9);
  assert.equal(cost.spreadSource, 'observed_floor_plus_model');
});

test('maker simulation models missed limits instead of granting free fills', () => {
  const simulator = new PaperExecutionSimulator({ rejectProbability: 0, partialFillThreshold: 1 });
  const missed = simulator.simulateFill({
    symbol: 'ETH-USD', side: 'buy', qty: 1, referencePrice: 100,
    orderType: 'limit', limitPrice: 99, bar: { low: 99.5, high: 101 }
  });
  assert.equal(missed.status, 'not_filled');
  assert.equal(missed.reason, 'missed_limit_fill');
  const filled = simulator.simulateFill({
    symbol: 'ETH-USD', side: 'buy', qty: 1, referencePrice: 100,
    orderType: 'limit', limitPrice: 99, bar: { low: 98.8, high: 101 }, allowPartialFill: false
  });
  assert.equal(filled.status, 'filled');
  assert.equal(filled.liquidity, 'maker');
  assert.equal(filled.feeBps, 15);
});

test('offline canary authorization is bound to its active source and exact key', () => {
  const config = { selectedBy: 'offline_forward_qualified', selectedCandidateKey: 'vortex:ETH:abc' };
  const activeStrategy = { source: 'offline_forward_qualified', candidateKey: 'vortex:ETH:abc', symbol: 'ETH-USD', strategyId: 'vortex' };
  assert.equal(isAuthorizedPaperCandidateSession({ config, activeStrategy, symbol: 'ETH-USD', strategyId: 'vortex' }), true);
  assert.equal(isAuthorizedPaperCandidateSession({ config, activeStrategy: { ...activeStrategy, candidateKey: 'wrong' }, symbol: 'ETH-USD', strategyId: 'vortex' }), false);
});

test('simulation priority bounds extreme backtest metrics', () => {
  const priority = simulationPriorityScore({
    prometheusScore: 0.88,
    metrics: { winRate: 0.72, profitFactor: 23.4 },
    paperAccount: { averageDollarPnl: 1000000 }
  });
  assert.ok(priority < 300, `priority should be bounded, received ${priority}`);
});

test('learning evidence prevents repeated tuning of the same closed trades', () => {
  const rows = [{ id: 10 }, { id: 11 }, { id: 12 }];
  assert.deepEqual(learningEvidenceDelta(rows, {
    lastCycleTradeId: 12,
    lastTunedTradeId: 10
  }), {
    maxTradeId: 12,
    hasNewClosedTrades: false,
    newSinceTune: 2
  });
});

test('learning engine serializes concurrent tuning cycles', async () => {
  const engine = new SimulationLearningEngine();
  let release;
  engine._runLearningCycleUnlocked = () => new Promise(resolve => { release = resolve; });
  const first = engine.runLearningCycle();
  const second = await engine.runLearningCycle();
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'Learning cycle already running');
  release({ skipped: false });
  await first;
});

test('five consistently losing paper trades trigger provisional quarantine', () => {
  const rows = Array.from({ length: 5 }, (_, id) => ({
    id,
    strategy: 'bad_candidate',
    symbol: 'ETH-USD',
    status: 'closed',
    pnl: -0.5
  }));
  const guard = new TradingPerformanceGuard({
    tradeSource: { db: {}, getClosedTrades: () => rows }
  });
  const verdict = guard.evaluate({ strategyId: 'bad_candidate', symbol: 'ETH-USD' });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.action, 'restrict_paper');
});

test('strategy safety uses all-time evidence instead of the promotion cutoff', () => {
  let receivedOptions = null;
  const runtime = new MissionControlRuntime();
  runtime.state.promotionPolicy.statsSinceIso = '2026-07-01T00:00:00.000Z';
  runtime.tradeLogger = {
    db: {},
    getClosedTrades(days, options) {
      receivedOptions = { days, options };
      return [];
    }
  };

  runtime._evaluateLiveEvidence({ strategyId: 'full_aggression', symbol: 'ETH-USD' });
  assert.deepEqual(receivedOptions, { days: null, options: { since: null } });
});

test('mission control clears a stale sim-to-live strategy when reconciliation has no candidate', () => {
  const runtime = new MissionControlRuntime();
  runtime.state.activeStrategy = {
    source: 'sim_to_live',
    strategyId: 'standard_portfolio',
    symbol: 'TLT'
  };
  runtime._readSimToLiveReport = () => ({ success: true, paperQueue: [], selectedIncumbent: null });

  const hydrated = runtime._hydrateFromSimToLive({ persist: false });

  assert.equal(hydrated, null);
  assert.equal(runtime.state.activeStrategy, null);
});

test('market hydration preserves an active paper-only hunt profile when no candidate qualifies', () => {
  const runtime = new MissionControlRuntime();
  runtime.state.activeStrategy = {
    source: 'hunt', strategyId: 'swarm_architecture', paperOnly: true
  };
  runtime._hydrateFromSimToLive = () => null;
  runtime._hydrateFromOfflineEvolution = () => null;
  runtime._readMarketLedger = () => [];

  const hydrated = runtime.hydrateFromMarketLab({ persist: false });

  assert.equal(hydrated, null);
  assert.equal(runtime.state.activeStrategy.source, 'hunt');
  assert.equal(runtime.state.activeStrategy.strategyId, 'swarm_architecture');
});

test('strategy selection excludes the just-finished zero-trade strategy', () => {
  const runtime = new MissionControlRuntime();
  runtime._evaluateLiveEvidence = () => ({ allowed: true, reasons: [] });
  for (const strategy of Object.values(runtime._ucb.strategies)) {
    strategy.live = { trials: 0, wins: 0, rewards: [], avgReward: 0, byRegime: {} };
  }

  const selected = runtime.selectTradingStrategy(null, null, {
    excludeStrategyIds: ['swarm_architecture']
  });

  assert.notEqual(selected, 'swarm_architecture');
});

test('mission control cannot revive an unqualified selected incumbent', () => {
  const runtime = new MissionControlRuntime();
  runtime.state.activeStrategy = { source: 'sim_to_live', strategyId: 'loser', symbol: 'ETH-USD' };
  runtime._readSimToLiveReport = () => ({
    policy: currentPolicy(),
    selectedIncumbent: { strategyId: 'loser', symbol: 'ETH-USD', state: 'rejected_in_simulation' },
    paperQueue: []
  });
  assert.equal(runtime._hydrateFromSimToLive({ persist: false }), null);
  assert.equal(runtime.state.activeStrategy, null);
});

test('zero or negative expectancy never increases paper capital', () => {
  assert.equal(paperCapitalTierForEvidence({ closedTrades: 100, netPnl: 0, expectancy: 0, profitFactor: 2, maxDrawdownPct: 1 }).notional, 250);
  assert.equal(paperCapitalTierForEvidence({ closedTrades: 100, netPnl: -1, expectancy: -0.01, profitFactor: 2, maxDrawdownPct: 1 }).notional, 250);
});

test('mission control revalidates stale market-ledger graduation flags', () => {
  const runtime = new MissionControlRuntime();
  runtime.state.activeStrategy = {
    source: 'market_lab',
    strategyId: 'standard_portfolio',
    symbol: 'TLT'
  };
  runtime._readSimToLiveReport = () => null;
  runtime._readOfflineEvolutionReport = () => null;
  runtime._readMarketLedger = () => [{
    id: 'stale-synthetic-winner',
    strategy: { id: 'standard_portfolio', name: 'Standard Portfolio' },
    asset: { symbol: 'TLT', assetClass: 'hedge', allowShort: true },
    metrics: { trades: 466, winRate: 0.72, profitFactor: 23, maxDrawdown: 0.03, averageDollarPnl: 290 },
    paperAccount: { averageDollarPnl: 290 },
    prometheusScore: 0.88,
    dataSource: 'synthetic',
    realDataBars: 0,
    walkForward: null,
    compiledStrategy: { strategyId: 'standard_portfolio', symbol: 'TLT' },
    graduation: { canPromoteToPaper: true }
  }];

  const hydrated = runtime.hydrateFromMarketLab({ persist: false });

  assert.equal(hydrated, null);
  assert.equal(runtime.state.activeStrategy, null);
});
