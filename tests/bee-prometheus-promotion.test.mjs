import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BeePrometheusBridge, validateSharedTuning } from '../server/trading/BeePrometheusBridge.js';
import { BeeAutonomicTuner } from '../server/trading/BeeAutonomicTuner.js';
import { SomaBeeTradingEngine } from '../server/trading/SomaBeeTradingEngine.js';
import { SomaBeeService } from '../server/trading/SomaBeeService.js';
import { TradeLogger } from '../server/finance/TradeLogger.js';
import { SimToLiveReconciler } from '../core/signals/generator/SimToLiveReconciler.js';
import { selectExecutablePaperCandidate } from '../server/finance/PaperCandidateSelector.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-bee-promotion-'));
const marketLedgerPath = path.join(root, 'market-ledger.json');
const sharedParamsPath = path.join(root, 'tuning.json');
const beeLedgerPath = path.join(root, 'bee-ledger.json');
const logger = new TradeLogger(path.join(root, 'trades.db'), { recordEvidence: false });
let bridge;

before(() => {
    logger.initialize();
    bridge = new BeePrometheusBridge({
        marketLedgerPath, sharedParamsPath, tradeLogger: logger,
        simDaemon: { readReport: () => null, runNow: async () => ({ skipped: true }) },
        performanceGuard: { evaluate: () => ({ allowed: true, reasons: [], action: 'allow', stats: {} }) }
    });
});

after(() => {
    logger.close();
    fs.rmSync(root, { recursive: true, force: true });
});

test('registration creates research hypotheses without invented validation evidence', () => {
    const result = bridge.ensurePrometheusResearchEntries();
    assert.equal(result.addedCount, 3);
    const entries = JSON.parse(fs.readFileSync(marketLedgerPath, 'utf8'));
    assert.equal(entries.length, 3);
    for (const entry of entries) {
        assert.equal(entry.status, 'research_pending');
        assert.equal(entry.dataSource, 'unverified');
        assert.equal(entry.realDataBars, 0);
        assert.deepEqual(entry.metrics, {});
        assert.equal(entry.walkForward, null);
    }
    const status = bridge.getPromotionStatus();
    assert.equal(status.bees.bizzy.researchReady, false);
    assert.equal(status.bees.bizzy.liveEligible, false);
});

test('legacy bridge-generated fake evidence is revoked without changing independent entries', () => {
    const entries = JSON.parse(fs.readFileSync(marketLedgerPath, 'utf8'));
    entries[0] = {
        ...entries[0], source: 'prometheus-beebots-bridge', id: 'market-beebot-bizzy-old',
        dataSource: 'real', realDataBars: 480, metrics: { trades: 124 },
        walkForward: { passes: true }, prometheusScore: 0.86
    };
    entries.push({ id: 'independent', source: 'real-lab', strategy: { id: 'other' }, metrics: { trades: 12 } });
    fs.writeFileSync(marketLedgerPath, JSON.stringify(entries));
    const result = bridge.ensurePrometheusResearchEntries();
    assert.equal(result.revokedCount, 1);
    const saved = JSON.parse(fs.readFileSync(marketLedgerPath, 'utf8'));
    assert.equal(saved.find(e => e.id === 'market-beebot-bizzy-old').dataSource, 'unverified');
    assert.deepEqual(saved.find(e => e.id === 'independent').metrics, { trades: 12 });
});

test('shared tuning rejects unsafe values and retains defensive risk limits', () => {
    assert.throws(() => validateSharedTuning({ bizzy: { riskPerTradePct: 0.9 } }));
    assert.throws(() => validateSharedTuning({ boozy: { rsiOversold: -1 } }));
    assert.throws(() => validateSharedTuning({ bizzy: { arbitrary: 1 } }));
    assert.equal(bridge.saveSharedParameters({ tuning: { bizzy: { k1: 0.8, riskPerTradePct: 0.02 } } }), true);
    const tuner = new BeeAutonomicTuner();
    tuner.loadState({ bizzy: { riskPerTradePct: 0.01, minConviction: 3 } });
    assert.equal(bridge.applyParametersToSwarm({ autonomicTuner: tuner }), true);
    assert.equal(tuner.getBeeAdjustments('bizzy').k1, 0.8);
    assert.equal(tuner.getBeeAdjustments('bizzy').riskPerTradePct, 0.01);
    assert.equal(tuner.getBeeAdjustments('bizzy').minConviction, 3);
    tuner.registerClosedTrade({ bee: 'bizzy', pnl: 1 });
    tuner.registerClosedTrade({ bee: 'bizzy', pnl: 1 });
    assert.equal(tuner.getBeeAdjustments('bizzy').riskPerTradePct, 0.02);
    assert.equal(tuner.getBeeAdjustments('bizzy').minConviction, 2);
    assert.equal(bridge.saveSharedParameters({ tuning: { bizzy: { k1: 0.8, riskPerTradePct: 0.01, minConviction: 3 } } }), true);
    bridge.applyParametersToSwarm({ autonomicTuner: tuner });
    tuner.registerClosedTrade({ bee: 'bizzy', pnl: -1 });
    tuner.registerClosedTrade({ bee: 'bizzy', pnl: -1 });
    tuner.registerClosedTrade({ bee: 'bizzy', pnl: 1 });
    assert.equal(tuner.getBeeAdjustments('bizzy').riskPerTradePct, 0.01);
    assert.equal(tuner.getBeeAdjustments('bizzy').minConviction, 3);
});

test('engine applies tuned breakout, RSI, and ATR settings and logs exact SQLite trade ID', () => {
    const tuner = new BeeAutonomicTuner();
    tuner.loadState({ bizzy: { k1: 0.8, k2: 0.4, stopAtr: 2, targetAtr: 3 }, boozy: { rsiOversold: 24 } });
    const engine = new SomaBeeTradingEngine({
        ledgerPath: beeLedgerPath, tradeLogger: logger, autonomicTuner: tuner,
        prometheusBridge: { applyParametersToSwarm: () => false },
        riskGate: { checkOrderApproval: () => ({ approved: true }), registerOpenPosition() {}, registerClosedTrade() {} },
        swarmBroker: { getMacroBias: () => null, publishTradeOpen() {}, publishTradeClose() {} },
        learningBridge: { distillTradeReceipt() {} },
        regimeAdapter: { getBeeAdjustments: () => ({ active: true, minConviction: 2 }) }
    });
    const market = {
        instId: 'BTC-USDT-SWAP', price: 103, bid: 102, ask: 103,
        open24h: 100, high24h: 110, low24h: 90, atr_14: 2,
        larry_williams: { status: 'INSIDE_RANGE' }
    };
    const adjusted = engine._applyTuningToSnapshot('bizzy', market);
    assert.equal(adjusted.larry_williams.buy_trigger, 116);
    assert.equal(adjusted.larry_williams.sell_trigger, 92);
    assert.equal(engine.generateAlgorithmicFallback('bizzy', { larry_williams: { status: 'ABOVE_BUY_TRIGGER' } }).choice, 'LONG');
    assert.equal(engine.generateAlgorithmicFallback('boozy', { rsi_14: 27, bollinger: { percent_b: 0.5 } }).choice, 'HOLD');
    const position = engine.openPosition('bizzy', 'LONG', market, 3, { confidence: 0.9 });
    assert.ok(position?.tradeId);
    assert.equal(position.stopLoss, 99);
    assert.equal(position.takeProfit, 109);
    const closed = engine.closePosition('bizzy', 109, 'TAKE_PROFIT');
    assert.ok(closed);
    const row = logger.db.prepare('SELECT * FROM trades WHERE id = ?').get(position.tradeId);
    assert.equal(row.strategy, 'beebots_bizzy');
    assert.equal(row.symbol, 'BTC-USD');
    assert.equal(row.status, 'closed');
    assert.equal(row.pnl, closed.pnl);
    assert.ok(row.entry_fee > 0 && row.exit_fee > 0);
    assert.ok(row.modeled_execution_cost > 0);
    assert.ok(closed.pnl < closed.grossPnl);
    assert.equal(engine.state.pendingCentralExits.length, 0);
    assert.equal(logger.logTradeExit(position.tradeId, { exitPrice: 110 }), true);
    assert.equal(logger.db.prepare('SELECT COUNT(*) AS n FROM trades WHERE id = ?').get(position.tradeId).n, 1);
});

test('SQLite entry failure blocks a position; exit failure persists an exact-ID retry', () => {
    const market = { instId: 'BTC-USDT-SWAP', price: 100, bid: 99, ask: 100, atr_14: 2 };
    const base = {
        prometheusBridge: { applyParametersToSwarm: () => false },
        autonomicTuner: new BeeAutonomicTuner(),
        riskGate: { checkOrderApproval: () => ({ approved: true }), registerOpenPosition() {}, registerClosedTrade() {} },
        swarmBroker: { getMacroBias: () => null, publishTradeOpen() {}, publishTradeClose() {} },
        learningBridge: { distillTradeReceipt() {} },
        regimeAdapter: { getBeeAdjustments: () => ({ active: true }) }
    };
    const denied = new SomaBeeTradingEngine({
        ...base, ledgerPath: path.join(root, 'denied-ledger.json'),
        tradeLogger: { db: true, logTradeEntry: () => { throw new Error('db down'); } }
    });
    assert.equal(denied.openPosition('bizzy', 'LONG', market, 3, { confidence: 0.9 }), null);
    assert.equal(denied.state.bees.bizzy.position, null);

    let failExit = true;
    const wrapped = {
        db: logger.db,
        logTradeEntry: trade => logger.logTradeEntry(trade),
        logTradeExit: (id, exit) => {
            if (failExit) throw new Error('transient db failure');
            return logger.logTradeExit(id, exit);
        }
    };
    const engine = new SomaBeeTradingEngine({
        ...base, autonomicTuner: new BeeAutonomicTuner(),
        ledgerPath: path.join(root, 'retry-ledger.json'), tradeLogger: wrapped
    });
    const position = engine.openPosition('bizzy', 'LONG', market, 3, { confidence: 0.9 });
    assert.ok(position?.tradeId);
    assert.ok(engine.closePosition('bizzy', 105, 'TAKE_PROFIT'));
    assert.equal(engine.state.pendingCentralExits.length, 1);
    assert.equal(logger.db.prepare('SELECT status FROM trades WHERE id = ?').get(position.tradeId).status, 'open');
    failExit = false;
    assert.equal(engine.flushPendingCentralExits(), 1);
    assert.equal(engine.state.pendingCentralExits.length, 0);
    assert.equal(logger.db.prepare('SELECT status FROM trades WHERE id = ?').get(position.tradeId).status, 'closed');
});

test('promotion requires exact paper identity, real research validation, and primary report membership', () => {
    const entries = JSON.parse(fs.readFileSync(marketLedgerPath, 'utf8'));
    const research = {
        id: 'real-bizzy-research', source: 'independent-market-lab',
        strategy: { id: 'beebots_bizzy', name: 'Bizzy', parameters: { k1: 0.5 } },
        asset: { symbol: 'BTC-USD', assetClass: 'crypto', allowShort: true },
        executionVenue: 'okx_perpetual_paper',
        dataSource: 'real', realDataBars: 500,
        metrics: { trades: 120, winRate: 0.65, profitFactor: 1.7, maxDrawdown: 0.08, averageDollarPnl: 5 },
        paperAccount: { averageDollarPnl: 5 }, prometheusScore: 0.8,
        walkForward: { passes: true, grade: 'ROBUST', oos: { trades: 40, totalPnl: 100 } }
    };
    entries.push(research);
    fs.writeFileSync(marketLedgerPath, JSON.stringify(entries));
    const paper = Array.from({ length: 100 }, (_, i) => ({
        strategy: 'beebots_bizzy', symbol: i === 0 ? 'ETH-USD' : 'BTC-USD',
        status: 'closed', pnl: i < 70 ? 2 : -1,
        attribution_json: JSON.stringify({ source: 'soma_beebots', mode: 'paper', strategyId: 'beebots_bizzy' })
    }));
    const fakeLogger = { db: true, getClosedTrades: () => paper };
    paper.push({ strategy: 'beebots_bizzy', symbol: 'BTC-USD', status: 'closed', pnl: 1000 });
    const simDaemon = { readReport: () => ({ liveCandidates: [{ key: 'beebots_bizzy:BTC-USD', id: 'wrong-research' }] }) };
    const candidateBridge = new BeePrometheusBridge({
        marketLedgerPath, sharedParamsPath, tradeLogger: fakeLogger, simDaemon,
        performanceGuard: { evaluate: () => ({ allowed: true, reasons: [], action: 'allow', stats: {} }) }
    });
    assert.equal(candidateBridge.getPromotionStatus().bees.bizzy.paperStats.trades, 99);
    paper[0].symbol = 'BTC-USD';
    assert.equal(candidateBridge.getPromotionStatus().bees.bizzy.liveEligible, false);
    simDaemon.readReport = () => ({ liveCandidates: [{ key: 'beebots_bizzy:BTC-USD', id: research.id }] });
    const ready = candidateBridge.getPromotionStatus().bees.bizzy;
    assert.equal(ready.researchReady, true);
    assert.equal(ready.verdict.passed, true);
    assert.equal(ready.liveEligible, true);
    research.strategy.parameters = { k1: 0.75 };
    fs.writeFileSync(marketLedgerPath, JSON.stringify(entries));
    const parameterSync = candidateBridge.syncValidatedResearchParameters();
    assert.equal(parameterSync.updated, true);
    assert.equal(parameterSync.researchEntryIds.bizzy, research.id);
    assert.equal(candidateBridge.loadSharedParameters().tuning.bizzy.k1, 0.75);
});

test('primary reconciler applies each BeeBot capital allocation to the drawdown gate', async () => {
    const attribution_json = JSON.stringify({ source: 'soma_beebots', mode: 'paper', strategyId: 'beebots_bizzy' });
    const trades = Array.from({ length: 100 }, (_, i) => ({
        strategy: 'beebots_bizzy', symbol: 'BTC-USD', status: 'closed',
        attribution_json, pnl: i < 70 ? 3 : -2
    }));
    const reconciler = new SimToLiveReconciler({
        marketLedgerPath, reportPath: path.join(root, 'primary-report.json'), closedTrades: trades,
        performanceGuard: { evaluate: () => ({ allowed: true, reasons: [], action: 'allow', stats: {} }) },
        calibrationTracker: { observe() {}, discountFor: () => 1, summary: () => ({}), save() {} }
    });
    const report = await reconciler.runReconciliation();
    const bee = report.quarantined.find(item => item.strategyId === 'beebots_bizzy');
    assert.ok(bee);
    assert.ok(bee.paper.maxDrawdownPct > 12);
    assert.equal(report.liveCandidates.some(item => item.strategyId === 'beebots_bizzy'), false);
});

test('validated research plus 100 tagged paper outcomes reaches human-review candidate tier', async () => {
    const attribution_json = JSON.stringify({ source: 'soma_beebots', mode: 'paper', strategyId: 'beebots_bizzy' });
    const trades = Array.from({ length: 100 }, (_, i) => ({
        strategy: 'beebots_bizzy', symbol: 'BTC-USD', status: 'closed',
        attribution_json, pnl: i < 70 ? 3 : -0.5
    }));
    const reconciler = new SimToLiveReconciler({
        marketLedgerPath, reportPath: path.join(root, 'passing-primary-report.json'), closedTrades: trades,
        performanceGuard: { evaluate: () => ({ allowed: true, reasons: [], action: 'allow', stats: {} }) },
        calibrationTracker: { observe() {}, discountFor: () => 1, summary: () => ({}), save() {} }
    });
    const report = await reconciler.runReconciliation();
    const candidate = report.liveCandidates.find(item => item.strategyId === 'beebots_bizzy');
    assert.ok(candidate);
    assert.equal(candidate.paper.trades, 100);
    assert.equal(candidate.live.requiresHumanApproval, true);
    assert.equal(report.paperIncumbents.some(item => item.strategyId === 'beebots_bizzy'), true);
});

test('OKX BeeBot research cannot be selected as an Alpaca executable paper canary', () => {
    const candidate = {
        state: 'paper_candidate', strategyId: 'beebots_bizzy', symbol: 'BTC-USD',
        economicsVersion: 'alpaca_crypto_spot_v2_2026_07',
        compiledStrategy: {
            economicsVersion: 'alpaca_crypto_spot_v2_2026_07', paperOnly: true,
            dsl: { execution: { style: 'taker_market' }, entry: { direction: 'long_only' } }
        }
    };
    const report = {
        paperQueue: [candidate],
        policy: { economicsVersion: candidate.economicsVersion, costModel: { takerFeeBps: 25, makerFeeBps: 15 } }
    };
    assert.equal(selectExecutablePaperCandidate(report), null);
});

test('stopped trading intent blocks BeeBots start and new entry ticks', async () => {
    const intentPath = path.join(root, 'trading-intent.json');
    fs.writeFileSync(intentPath, JSON.stringify({ desiredState: 'stopped', actualState: 'stopped', autoResume: false }));
    let ticks = 0;
    const engine = {
        state: { bees: { bizzy: { position: null } } },
        on() {}, tick: async () => { ticks++; return {}; }
    };
    const service = new SomaBeeService({ engine, intentPath, reporter: { connect: async () => {}, destroy: async () => {} } });
    await assert.rejects(service.start(), /Trading intent is stopped/);
    assert.deepEqual(await service.tick(), { skipped: true, reason: 'trading_intent_stopped' });
    assert.equal(ticks, 0);
    engine.state.bees.bizzy.position = { side: 'LONG' };
    engine.tick = async ({ allowEntries }) => { assert.equal(allowEntries, false); return { exitOnly: true }; };
    assert.deepEqual(await service.tick(), { exitOnly: true });
});

test('running Bee tick refreshes changed validated tuning once and stopped intent cannot activate entries', async () => {
    const intentPath = path.join(root, 'refresh-intent.json');
    fs.writeFileSync(intentPath, JSON.stringify({ desiredState: 'running', actualState: 'running', autoResume: true }));
    let version = 'v1';
    let applications = 0;
    const allowed = [];
    const engine = {
        state: { bees: { bizzy: { position: null } } },
        prometheusBridge: {
            loadSharedParameters: () => ({ source: 'prometheus_market_lab_validated', updatedAt: version }),
            applyParametersToSwarm: () => { applications++; return true; }
        },
        on() {},
        tick: async ({ allowEntries }) => { allowed.push(allowEntries); return {}; }
    };
    const service = new SomaBeeService({ engine, intentPath, reporter: {} });
    await service.tick();
    await service.tick();
    assert.equal(applications, 1);
    version = 'v2';
    await service.tick();
    assert.equal(applications, 2);
    assert.deepEqual(allowed, [true, true, true]);

    fs.writeFileSync(intentPath, JSON.stringify({ desiredState: 'stopped', actualState: 'stopped', autoResume: false }));
    version = 'v3';
    assert.deepEqual(await service.tick(), { skipped: true, reason: 'trading_intent_stopped' });
    assert.equal(applications, 2);
    assert.deepEqual(allowed, [true, true, true]);
});

test('reconciliation reports skipped daemon runs as failure', async () => {
    await assert.rejects(bridge.syncAndReconcile(), /did not complete/);
});
