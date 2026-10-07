import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Singleton imports must never read/write the operator's trading state.
const originalCwd = process.cwd();
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-ecosystem-tests-'));
process.chdir(sandbox);
const { TradingEcosystem, summarizeEcosystemTrades } = await import('../server/finance/TradingEcosystem.js');
const { ecosystemCandidate, ecosystemPaperConfig, ecosystemSymbol } = await import('../server/finance/TradingEcosystemCatalog.js');
const { ScalpingEngine } = await import('../server/finance/scalpingEngine.js');
const { HighFrequencyGridEngine } = await import('../server/finance/HighFrequencyGridEngine.js');
const { executableStreamQuote } = await import('../server/finance/TradingExecutionQuote.js');
const { AutonomousTrader } = await import('../server/finance/autonomousTrader.js');
const { MissionControlRuntime } = await import('../server/finance/MissionControlRuntime.js');
const { evaluateCompiledStrategyDecision, backtestBars } = await import('../server/finance/CompiledStrategyBacktester.js');
const { evaluateScalpingSignal } = await import('../server/finance/ScalpingSignal.js');
const { default: ledger } = await import('../server/finance/TradeLogger.js');
test.after(() => { ledger.db?.close(); process.chdir(originalCwd); });

function service(options = {}) {
    return new TradingEcosystem({ statePath: path.join(sandbox, `${crypto.randomUUID()}.json`),
        ledger: {}, evidence: { append() {} }, ...options });
}
function traderWithPosition() {
    const trader = new AutonomousTrader();
    trader.symbol = 'ETH-USD'; trader.isRunning = true; trader.paperMode = true;
    trader._logDecision = () => {}; trader._recordRuntimeLifecycle = () => {};
    const position = { symbol: trader.symbol, side: 'long', entryPrice: 100, qty: 0.5,
        openedAt: Date.now(), exitConfig: { stopLossPct: 0.01, takeProfitPct: 0.08, trailingStopPct: 0.008, maxPositionAgeMs: 1200000 } };
    trader._openPositions = [position];
    trader._paperPortfolio = { balance: 9950, positions: { [trader.symbol]: position }, trades: [] };
    return trader;
}
const quote = (price, changes = {}) => ({ Symbol: 'ETH-USD', Price: price, bid: price - 0.01,
    ask: price + 0.01, source: 'alpaca_crypto_us', timestamp: Date.now(), ...changes });
function bars(count = 260, timeframe = 60000) {
    return Array.from({ length: count }, (_, i) => {
        const price = 100 + Math.sin(i / 5) * 3;
        return { timestamp: Date.now() - (count + 2 - i) * timeframe,
            open: price, close: price, high: price + 0.2, low: price - 0.2, volume: 1000, source: 'alpaca_crypto_us' };
    });
}

test('catalog snapshots are deterministic, parameter-specific, long-only and paper-only', () => {
    const first = ecosystemCandidate('fast', 'ETH-USD');
    assert.deepEqual(first, ecosystemCandidate('fast', 'ETH-USD'));
    assert.notEqual(first.id, ecosystemCandidate('fast', 'ETH-USD', { requiredSignals: 3 }).id);
    assert.equal(ecosystemSymbol(' eth/usd '), 'ETH-USD');
    assert.throws(() => ecosystemSymbol('DOGE-USD'));
    const config = ecosystemPaperConfig(first);
    assert.equal(config.compiledCandidate.compiledStrategy.dsl.entry.direction, 'long_only');
    assert.equal(config.forcePaper, true); assert.equal(config.liveTradingEnabled, false);
    assert.equal(config.maxPaperTradeValue, 250); assert.equal(config.timeframe, '1Min');
    assert.equal(config.maxPositionAgeMs, 1200000);
    assert.throws(() => ecosystemPaperConfig(ecosystemCandidate('grid', 'ETH-USD')), /research-only/);
});

test('global Mission Control choices cannot overwrite catalog parameters or enable live mode', () => {
    const runtime = new MissionControlRuntime(); runtime.hydrateFromMarketLab = () => {};
    runtime.state.activeStrategy = { strategyId: 'full_aggression', symbol: 'ETH-USD' };
    const config = ecosystemPaperConfig(ecosystemCandidate('fast', 'ETH-USD'));
    const profile = runtime.getActiveExecutionProfile({ symbol: 'ETH-USD', preset: 'scalping_confluence', baseConfig: config });
    for (const key of ['timeframe', 'stopLossPct', 'takeProfitPct', 'maxPositionAgeMs', 'maxPaperTradeValue', 'strategyVersion']) assert.equal(profile.config[key], config[key]);
    assert.equal(profile.activeStrategy, null); assert.equal(profile.config.liveTradingEnabled, false);
});

test('trade prints, stale/future, non-venue, crossed and nonfinite quotes cannot trigger exits', () => {
    assert.ok(executableStreamQuote('ETH-USD', quote(100)));
    for (const invalid of [ { Price: 100 }, quote(100, { timestamp: Date.now() - 61000 }),
        quote(100, { timestamp: Date.now() + 60000 }), quote(100, { source: 'yahoo' }),
        quote(100, { bid: 101, ask: 100 }), quote(100, { bid: Infinity, ask: Infinity }),
        quote(100, { isMock: true }), quote(100, { executionEligible: false }) ]) {
        assert.equal(executableStreamQuote('ETH-USD', invalid), null);
    }
});

test('stream quotes enforce tighter frozen stops even if the global stop is wider', async () => {
    const trader = traderWithPosition(); trader.config.stopLossPct = 0.1; trader._activeTradeConfig.stopLossPct = 0.1;
    const reasons = []; trader._closePosition = async (_, reason) => { reasons.push(reason); return {}; };
    await trader._onTradeUpdate(quote(98.9));
    assert.deepEqual(reasons, ['STOP_LOSS']);
});

test('every executable stream quote updates high-water protection', async () => {
    const trader = traderWithPosition(); const reasons = [];
    trader._closePosition = async (_, reason) => { reasons.push(reason); return {}; };
    await trader._onTradeUpdate(quote(102));
    assert.ok(trader._positionHighWater.get('ETH-USD') >= 0.0199);
    await trader._onTradeUpdate(quote(101));
    assert.deepEqual(reasons, ['TRAILING_STOP']);
});

test('invalid stream events never manage a position', async () => {
    const trader = traderWithPosition(); trader._managePosition = () => assert.fail('invalid quote managed position');
    await trader._onTradeUpdate(quote(98, { source: 'yahoo' }));
    await trader._onTradeUpdate({ Symbol: 'ETH-USD', Price: 98 });
    await trader._onTradeUpdate(quote(98, { Symbol: 'BTC-USD' }));
});

test('concurrent managers and closers share a single pending execution', async () => {
    const trader = traderWithPosition(); const position = trader._openPositions[0];
    let managed = 0, closed = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    trader._closePositionUnlocked = async () => { closed++; await barrier; return { accepted: true }; };
    trader._managePositionUnlocked = async () => { managed++; return trader._closePosition(position, 'STOP_LOSS', 98); };
    const pending = [trader._managePosition(position, 98), trader._managePosition(position, 98), trader._closePosition(position, 'TIME_EXIT', 98)];
    await Promise.resolve(); await Promise.resolve(); release();
    await Promise.all(pending); assert.equal(managed, 1); assert.equal(closed, 1);
    assert.equal(trader._closeInFlight.size, 0); assert.equal(trader._managementInFlight.size, 0);
});

test('pause blocks new entries but keeps open-position stream protection running', async () => {
    const trader = traderWithPosition();
    assert.equal(trader.pauseEntries().state, 'protecting_open_positions');
    assert.equal(trader.isRunning, true); assert.equal(trader.config.entriesPaused, true);
    let closed = false; trader._closePosition = async () => { closed = true; return {}; };
    await trader._onTradeUpdate(quote(98)); assert.equal(closed, true);
    trader._openPositions = []; trader._paperPortfolio.positions = {};
    trader._executePaperOrder = () => assert.fail('paused entry reached executor');
    assert.equal(await trader._executeTrade({ action: 'BUY' }, { qty: 1 }, 100, {}), null);
    trader.stop = () => { trader.isRunning = false; };
    assert.equal(trader.pauseEntries().state, 'stopped'); assert.equal(trader.isRunning, false);
    trader.paperMode = false; assert.throws(() => trader.pauseEntries(), /live session/);
});

test('catalog holding limits close aged winners instead of inheriting legacy heuristics', async () => {
    const trader = traderWithPosition(); trader.config.ecosystemLane = 'fast';
    const position = trader._openPositions[0]; position.openedAt = Date.now() - 1200001;
    let reason; trader._closePosition = async (_, why) => { reason = why; return {}; };
    assert.equal(await trader._managePosition(position, 100.5), true); assert.equal(reason, 'TIME_EXIT');
});

test('catalog execution and research share native venue data without cross-provider fallbacks', async t => {
    const { default: data } = await import('../server/finance/marketDataService.js');
    const { default: alpaca } = await import('../server/finance/AlpacaService.js');
    const trader = traderWithPosition(); trader.config = { ...trader.config, ...ecosystemPaperConfig(ecosystemCandidate('fast', 'ETH-USD')) };
    let nativeBars = 0, managed = 0;
    t.mock.method(data, 'getAlpacaCryptoBars', async (symbol, timeframe) => { nativeBars++; assert.equal(symbol, 'ETH-USD'); assert.equal(timeframe, '1Min'); return bars(); });
    t.mock.method(alpaca, 'getCryptoQuote', async () => ({ ...quote(101), price: 101 }));
    t.mock.method(data, 'getBars', () => assert.fail('catalog reached diagnostic fallback chain'));
    t.mock.method(data, 'getLatestPrice', () => assert.fail('catalog reached diagnostic quote cache'));
    trader._syncPositions = async () => {}; trader._getRegime = () => assert.fail('catalog queried an unrelated regime');
    trader._managePosition = async () => { managed++; return true; };
    await trader._runCycle(); assert.equal(nativeBars, 1); assert.equal(managed, 1); assert.equal(trader._stats.errors, 0);
});

test('ecosystem execution snapshots do not hydrate research or expose mutable stats', async t => {
    const { default: mission } = await import('../server/finance/MissionControlRuntime.js');
    t.mock.method(mission, 'getStatus', () => assert.fail('execution polling hydrated research'));
    const trader = traderWithPosition(); const status = trader.getExecutionStatus();
    assert.equal(status.paperMode, true); assert.equal(status.openPositions.length, 1);
    assert.equal(status.missionControlRuntime, undefined);
    status.stats.errors = 999; status.openPositions[0].qty = 999;
    assert.equal(trader._stats.errors, 0); assert.equal(trader._openPositions[0].qty, 0.5);
});

test('grid execution is forbidden, duplicate starts are serialized, and failed starts unlock', async () => {
    const runtime = service(); let started = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    runtime.bindExecution({ sessions: () => [], start: async ({ config }) => { started++; assert.equal(config.forcePaper, true); await barrier; return {}; }, pause: symbol => ({ symbol }) });
    await assert.rejects(runtime.startPaper('grid', 'ETH-USD'), /research-only/);
    const pending = runtime.startPaper('fast', 'ETH-USD');
    await assert.rejects(runtime.startPaper('holding', 'ETH-USD'), /already starting/);
    await assert.rejects(runtime.pausePaper('ETH-USD'), /still starting/);
    release(); await pending; assert.equal(started, 1);
    runtime.execution.start = async () => { throw new Error('offline'); };
    await assert.rejects(runtime.startPaper('fast', 'ETH-USD'), /offline/);
    assert.equal(runtime.startLocks.size, 0);
});

test('a stopped session still owns its symbol while a position remains open', async () => {
    const runtime = service(); runtime.bindExecution({ sessions: () => [{ symbol: 'ETH-USD', isRunning: false, openPositions: [{}] }], start: () => assert.fail('overlap') });
    await assert.rejects(runtime.startPaper('fast', 'ETH-USD'), /already owned/);
});

test('forward results are separated by symbol and immutable strategy version', () => {
    const runtime = service(); const candidate = runtime.candidate('fast', 'ETH-USD');
    runtime.closedRows = () => [{ symbol: 'ETH-USD', strategy_version: candidate.id, pnl: -1, entry_fee: 0.1, exit_fee: 0.1 },
        { symbol: 'ETH-USD', strategy_version: 'old', pnl: 999 }, { symbol: 'BTC-USD', strategy_version: candidate.id, pnl: 10 }];
    const experiment = runtime.status().lanes.find(l => l.id === 'fast').experiments.find(e => e.symbol === 'ETH-USD');
    assert.equal(experiment.forward.trades, 1); assert.equal(experiment.forward.netPnl, -1); assert.equal(experiment.forward.recordedFees, 0.2);
    assert.equal(summarizeEcosystemTrades([]).winRatePct, null);
});

test('legacy scalper facade delegates start, pause and accounting to the shared runtime', async () => {
    const calls = []; const runtime = service();
    runtime.startPaper = async (...args) => { calls.push(['start', ...args]); };
    runtime.pausePaper = async symbol => { calls.push(['pause', symbol]); };
    runtime.sessions = () => [{ symbol: 'ETH-USD', isRunning: true, config: { ecosystemLane: 'fast' }, stats: { totalDecisions: 7 }, openPositions: [] },
        { symbol: 'BTC-USD', isRunning: true, config: { ecosystemLane: 'holding' } }];
    const facade = new ScalpingEngine(runtime); await facade.start(); await facade.stop();
    assert.deepEqual(calls, [['start', 'fast', 'ETH-USD'], ['pause', 'ETH-USD']]);
    assert.equal(facade.getStats().signalsChecked, 7); assert.equal(facade.getStats().paperOnly, true);
    assert.equal(facade.getStats().executionEngine, 'AutonomousTrader');
    const version = runtime.candidate('fast', 'ETH-USD').id;
    facade.config.requiredSignals = 3; facade.config.rsiBuyZone = 99;
    assert.equal(runtime.candidate('fast', 'ETH-USD').id, version, 'legacy tuners cannot mutate the catalog');
});

test('fast compiled decisions use the shared signal and ignore the current execution candle', () => {
    const history = bars(100); const candidate = ecosystemCandidate('fast', 'ETH-USD');
    const expected = evaluateScalpingSignal(history.slice(0, -1), { entry: candidate.compiledStrategy.dsl.entry });
    const actual = evaluateCompiledStrategyDecision({ bars: history, candidate });
    assert.equal(actual.action, expected.action); assert.equal(actual.confidence, expected.confidence);
    history.at(-1).close = 99999;
    assert.equal(evaluateCompiledStrategyDecision({ bars: history, candidate }).action, expected.action);
    const result = backtestBars({ bars: bars(), candidate, includeTrades: true });
    assert.ok(Number.isFinite(result.totalPnl));
    assert.ok(result.tradeLedger.length > 0, 'synthetic mechanics exercise entries, not profitability evidence');
    assert.ok(result.tradeLedger.every(trade => trade.entryFee > 0 && trade.exitFee > 0));
});

test('grid marks losing inventory even when its realized win rate is 100 percent', () => {
    const grid = new HighFrequencyGridEngine({ maxDrawdownPct: 0.005 });
    for (const price of [100, 99, 100, 99, 80]) grid.processTick(price);
    const result = grid.getMetrics();
    assert.equal(result.winRatePct, 100); assert.ok(result.totalRealizedPnlUsd > 0);
    assert.ok(result.totalNetPnlUsd < 0); assert.ok(result.unrealizedPnlUsd < 0);
    assert.equal(result.halted, true); assert.equal(result.executionEnabled, false);
    assert.equal(grid.activeBuys.size, 0); assert.ok(grid.cash >= 0);
});

test('catalog historical holding limits use elapsed time across missing candles', () => {
    const candidate = ecosystemCandidate('holding', 'ETH-USD');
    candidate.compiledStrategy.dsl.exit = { maxPositionAgeMs: 4 * 3600000, stopLossPct: 0.2, takeProfitPct: 0.2, trailingStopPct: 0.2 };
    const history = bars(120, 3 * 3600000).map((bar, i) => ({ ...bar, open: 100 + i, close: 100 + i, high: 100.2 + i, low: 99.8 + i }));
    const result = backtestBars({ bars: history, candidate, includeTrades: true });
    const closed = result.tradeLedger.filter(trade => trade.exitReason === 'time_exit');
    assert.ok(closed.length > 0);
    assert.ok(closed.every(trade => trade.exitTime - trade.entryTime === 6 * 3600000));
});

test('research refuses mock, missing-source and undersized histories without evidence writes', async () => {
    for (const history of [bars(50), bars().map(b => ({ ...b, isMock: true })), bars().map(b => ({ ...b, source: 'fallback' }))]) {
        const runtime = service({ data: { getAlpacaCryptoBars: async () => history }, evidence: { append: () => assert.fail('invalid evidence') } });
        await assert.rejects(runtime.research('fast', 'ETH-USD'), /real, completed/);
        assert.equal(runtime.reports.length, 0); assert.equal(runtime.researchJob.running, false);
    }
});

test('historical research persists, remains non-prospective, and never starts execution', async () => {
    const records = []; const runtime = service({ data: { getAlpacaCryptoBars: async (_, timeframe) => bars(260, timeframe === '1H' ? 3600000 : timeframe === '5Min' ? 300000 : 60000) },
        evidence: { append: (...args) => records.push(args) } });
    runtime.bindExecution({ sessions: () => [], start: () => assert.fail('research started trading') });
    for (const lane of ['holding', 'fast', 'grid']) {
        const report = await runtime.research(lane, 'ETH-USD');
        assert.equal(report.liveEligible, false); assert.equal(report.graduation.qualified, false);
        assert.equal(report.evaluationKind, 'historical_70_30_split_not_prospective');
        assert.equal(report.bars, 260); assert.ok(report.firstBar < report.splitBar && report.splitBar < report.lastBar);
    }
    assert.equal(records.length, 3); assert.ok(records.every(record => record[0] === 'simulation'));
    const resumed = service({ statePath: runtime.statePath }); assert.equal(resumed.reports.length, 3);
    assert.equal(resumed.status().lanes.find(l => l.id === 'fast').experiments.find(e => e.symbol === 'ETH-USD').forward.trades, 0);
});

test('fast fractional paper fills retain the catalog identity and debit both fees', async t => {
    const { default: simulator } = await import('../server/finance/PaperExecutionSimulator.js');
    const { default: notifications } = await import('../server/services/NotificationService.js');
    const { default: mission } = await import('../server/finance/MissionControlRuntime.js');
    t.mock.method(notifications, 'sendTradeNotification', async () => {});
    t.mock.method(mission, 'recordStrategyOutcome', () => {});
    const originalReject = simulator.config.rejectProbability; simulator.config.rejectProbability = 0;
    t.after(() => { simulator.config.rejectProbability = originalReject; });
    if (!ledger.db) ledger.initialize();
    const runtime = service({ ledger }); const candidate = runtime.candidate('fast', 'ETH-USD');
    const trader = traderWithPosition(); trader.preset = 'scalping_confluence'; trader.strategySelectionMode = 'manual';
    trader.config = { ...trader.config, ...ecosystemPaperConfig(candidate) };
    trader._activeTradeConfig = candidate.compiledStrategy.dsl.exit;
    trader._paperPortfolio = { balance: 10000, positions: {}, trades: [] }; trader._openPositions = [];
    trader._lastDecisionBars = bars(); trader._lastExecutionQuote = quote(100);
    await trader._executeTrade({ action: 'BUY', confidence: 0.8 }, { qty: 0.025 }, 100, { quant: { signals: { rsi: { score: 0.8 } } } });
    const position = trader._paperPortfolio.positions['ETH-USD'];
    assert.ok(position.qty > 0 && position.qty < 1); assert.equal(position.exitConfig.maxPositionAgeMs, 1200000);
    await trader._closePosition({ ...position, symbol: 'ETH-USD' }, 'TEST_ONLY_EXIT', 99);
    const row = ledger.db.prepare('SELECT * FROM trades WHERE id=?').get(position.tradeId);
    assert.equal(row.strategy, 'scalping_confluence'); assert.equal(row.strategy_version, candidate.id);
    assert.equal(row.candidate_key, candidate.key); assert.equal(row.status, 'closed');
    assert.ok(row.entry_fee > 0 && row.exit_fee > 0);
    assert.ok(Math.abs(row.pnl - ((row.exit_price - row.entry_price) * row.qty - row.entry_fee - row.exit_fee)) < 1e-9);
    assert.ok(Math.abs(trader._paperPortfolio.balance - 10000 - row.pnl) < 1e-8);
    assert.equal(runtime.status().lanes.find(l => l.id === 'fast').experiments.find(e => e.symbol === 'ETH-USD').forward.trades, 1);
});

test('HTTP controls ignore requested live authority and reject grid execution', async t => {
    const { default: express } = await import('express');
    const { default: singleton } = await import('../server/finance/TradingEcosystem.js');
    const { default: router } = await import('../server/finance/tradingEcosystemRoutes.js');
    const { default: feedRouter } = await import('../server/finance/lowLatencyRoutes.js');
    const { default: feed } = await import('../server/finance/lowLatencyEngine.js');
    let config;
    const previous = singleton.execution;
    singleton.bindExecution({ sessions: () => [], start: async request => { config = request.config; return { paperOnly: true }; }, pause: symbol => ({ symbol, entriesPaused: true }) });
    t.after(() => { singleton.execution = previous; });
    const app = express(); app.use(express.json()); app.use('/api/trading-ecosystem', router);
    app.use('/api/lowlatency', feedRouter);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const url = `http://127.0.0.1:${server.address().port}/api/trading-ecosystem`;
    const post = (endpoint, body) => fetch(`${url}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const rejected = await post('paper/start', { lane: 'grid', symbol: 'ETH-USD' }); assert.equal(rejected.status, 409);
    const started = await post('paper/start', { lane: 'fast', symbol: 'ETH-USD', config: { forcePaper: false, liveTradingEnabled: true, maxPaperTradeValue: 999999 } });
    assert.equal(started.status, 200); assert.equal(config.forcePaper, true); assert.equal(config.liveTradingEnabled, false); assert.equal(config.maxPaperTradeValue, 250);
    assert.equal((await (await post('paper/pause', { symbol: 'ETH-USD' })).json()).result.entriesPaused, true);
    assert.equal((await (await fetch(`${url}/status`)).json()).ecosystem.liveEnabled, false);
    singleton.execution.sessions = () => [{ symbol: 'ETH-USD', isRunning: true, openPositions: [{}] }];
    t.mock.method(feed, 'stop', () => assert.fail('legacy stop disconnected position protection'));
    const retained = await fetch(`http://127.0.0.1:${server.address().port}/api/lowlatency/stop`, { method: 'POST' }).then(response => response.json());
    assert.equal(retained.retained, true);
});
