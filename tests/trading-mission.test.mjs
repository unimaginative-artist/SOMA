import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// All singleton side effects are isolated from Owner's ledger and intent.
const originalCwd = process.cwd();
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-mission-tests-'));
process.chdir(sandbox);
const { TradingMissionController } = await import('../server/finance/TradingMissionController.js');
const { missionCandidate, missionConfig, assessMissionCandidate, selectMissionCandidate } = await import('../server/finance/TradingMissionPolicy.js');
const { ecosystemCandidate } = await import('../server/finance/TradingEcosystemCatalog.js');
const { createMissionEvidence } = await import('../server/finance/TradingMissionEvidence.js');
const { AutonomousTrader } = await import('../server/finance/autonomousTrader.js');
const { default: ledger } = await import('../server/finance/TradeLogger.js');
test.after(() => { ledger.db?.close(); process.chdir(originalCwd); });
const candidate = () => ecosystemCandidate('fast', 'ETH-USD');
const evidence = (changes = {}) => ({ data: { ready: true },
    forward: { trades: 0, netPnl: 0, profitFactor: 0, meanNetReturn: 0 },
    historical: { netPnl: 3, observedCloses: 2, meanNetReturn: 0.003, frictionPassed: true }, ...changes });
function fixture(overrides = {}) {
    let time = 1000000;
    const sessions = [], starts = [], pauses = [];
    const dependencies = {
        proposals: () => ({ candidates: [candidate()], excluded: [] }),
        inspect: async () => evidence(), readiness: async () => ({ ready: true }),
        sessions: () => structuredClone(sessions), unownedPositions: () => [],
        start: async (selected, runId) => {
            starts.push(selected);
            sessions.push({ symbol: selected.symbol, isRunning: true, paperMode: true, config: missionConfig(selected, runId), openPositions: [] });
            return { success: true };
        },
        pause: async symbol => {
            pauses.push(symbol);
            const session = sessions.find(session => session.symbol === symbol);
            if (session) { session.config.entriesPaused = true; if (!session.openPositions.length) session.isRunning = false; }
        }, ...overrides
    };
    const controller = new TradingMissionController({ dependencies, now: () => time,
        statePath: path.join(sandbox, `${crypto.randomUUID()}.json`) });
    return { controller, dependencies, sessions, starts, pauses, advance: ms => { time += ms; } };
}
async function launch(f) { f.controller.run(); await f.controller.workPromise; }

test('mission recipes are frozen, bounded, current-cost, paper-only and versioned', () => {
    const recipe = candidate(); const config = missionConfig(recipe, 'run-1');
    assert.equal(config.forcePaper, true); assert.equal(config.paperMode, true);
    assert.equal(config.liveTradingEnabled, false); assert.equal(config.maxPaperTradeValue, 250);
    assert.equal(config.strategySelectionMode, 'manual'); assert.equal(config.missionRunId, 'run-1');
    assert.equal(missionCandidate(recipe).id, recipe.id);
    const external = candidate(); delete external.ecosystemLane;
    external.id = 'research-recipe';
    external.compiledStrategy.dsl.sizing.maxPaperTradeValue = 9000;
    const normalized = missionCandidate(external);
    assert.match(normalized.id, /^mission-/); assert.equal(normalized.compiledStrategy.dsl.sizing.maxPaperTradeValue, 250);
    assert.equal(missionCandidate(external).id, normalized.id);
    assert.equal(missionConfig(normalized, 'run').strategyVersion, normalized.id);
    assert.equal(external.compiledStrategy.dsl.sizing.maxPaperTradeValue, 9000);
});

test('unsupported, short, grid, stale-economics and malformed recipes are rejected', () => {
    for (const mutate of [c => { c.symbol = 'SPY'; }, c => { c.researchOnly = true; },
        c => { c.compiledStrategy.dsl.entry.direction = 'both'; }, c => { c.economicsVersion = 'old'; },
        c => { c.compiledStrategy.dsl.entry.mode = 'imaginary'; }, c => { c.compiledStrategy.dsl.exit.stopLossPct = NaN; },
        c => { c.compiledStrategy.dsl.exit.maxPositionAgeMs = 0; }]) {
        const recipe = candidate(); mutate(recipe); assert.throws(() => missionCandidate(recipe));
    }
    assert.throws(() => missionConfig(ecosystemCandidate('grid', 'ETH-USD'), 'run'));
});

test('thin evidence is a paper experiment, never a profitable or live-qualified label', () => {
    const row = assessMissionCandidate({ candidate: candidate(), ...evidence() });
    assert.equal(row.evidenceClass, 'paper_experiment'); assert.equal(row.eligible, true);
    assert.equal(row.liveEligible, undefined);
});

test('missing data, missing costs, historical losers, paper losers and budget breaches exclude recipes', () => {
    for (const changes of [{ data: { ready: false, reason: 'stale' } }, { historical: null },
        { historical: { netPnl: 20, observedCloses: 8, frictionPassed: false } },
        { historical: { netPnl: -2, observedCloses: 5, frictionPassed: true } },
        { forward: { trades: 5, netPnl: -1, profitFactor: 0.5 } },
        { forward: { trades: 1, netPnl: -11, profitFactor: 0 } }]) {
        assert.equal(assessMissionCandidate({ candidate: candidate(), ...evidence(changes) }).eligible, false);
    }
});

test('selection prefers stronger paper evidence, not the largest simulated dollar win', () => {
    const experiment = assessMissionCandidate({ candidate: candidate(), ...evidence({ historical: { netPnl: 2000, observedCloses: 2, frictionPassed: true } }) });
    const supported = assessMissionCandidate({ candidate: ecosystemCandidate('holding', 'BTC-USD'), ...evidence({
        forward: { trades: 35, netPnl: 12, profitFactor: 1.4, meanNetReturn: 0.001 } }) });
    assert.equal(selectMissionCandidate([experiment, supported]), supported);
    assert.equal(selectMissionCandidate([{ ...supported, eligible: false }]), null);
});

test('audit-only does not claim ownership, pause, start or change desired execution', async () => {
    const f = fixture(); const audit = await f.controller.audit();
    assert.equal(audit.rows.length, 1); assert.equal(f.controller.state.desired, 'paused');
    assert.equal(f.controller.state.controlled, false); assert.equal(f.starts.length, 0); assert.equal(f.pauses.length, 0);
});

test('paused audit clears a stale selected recipe when current after-cost evidence rejects it', async () => {
    const f = fixture({ inspect: async () => evidence({ historical: {
        netPnl: -14, observedCloses: 9, meanNetReturn: -0.014, frictionPassed: true
    } }) });
    f.controller.state.controlled = true;
    f.controller.state.selection = assessMissionCandidate({ candidate: candidate(), ...evidence() });
    const audit = await f.controller.audit();
    assert.equal(audit.rows[0].eligible, false);
    assert.equal(audit.recommendation, null);
    assert.equal(f.controller.status().selection, null);
    assert.match(f.controller.status().message, /No eligible paper candidate/);
    assert.equal(f.controller.status().desired, 'paused');
    assert.equal(f.starts.length, 0);
});

test('one click audits, selects and verifies the exact executor recipe; repeat Run is idempotent', async () => {
    const f = fixture(); await launch(f); f.controller.run(); await f.controller.workPromise;
    assert.equal(f.starts.length, 1); assert.equal(f.controller.status().phase, 'running');
    assert.equal(f.controller.status().entriesActive, true);
    assert.equal(f.controller.canEnter('BTC-USD', f.sessions[0].config), false);
    assert.equal(f.controller.canEnter('ETH-USD', { ...f.sessions[0].config, strategyVersion: 'different' }), false);
});

test('SOMA waits and periodically rechecks when the audit has no candidate', async () => {
    const f = fixture({ inspect: async () => evidence({ data: { ready: false } }) });
    await launch(f); assert.equal(f.controller.state.phase, 'waiting'); assert.equal(f.starts.length, 0);
    f.dependencies.inspect = async () => evidence();
    await f.controller.reconcile(); assert.equal(f.starts.length, 0);
    f.advance(16 * 60_000); await f.controller.reconcile(); assert.equal(f.starts.length, 1);
});

test('incomplete audit retries soon and cannot select from partial results', async () => {
    let fail = true;
    const f = fixture({ proposals: () => ({ candidates: [candidate(), ecosystemCandidate('holding', 'BTC-USD')] }),
        inspect: async proposal => {
            if (fail && proposal.symbol === 'BTC-USD') throw new Error('quote timeout');
            return evidence();
        } });
    await launch(f);
    assert.equal(f.starts.length, 0);
    assert.equal(f.controller.state.phase, 'waiting');
    assert.match(f.controller.state.message, /inspection\(s\) failed/);
    assert.equal(f.controller.state.nextAuditAt, 1000000 + 60_000);
    fail = false;
    f.advance(61_000);
    await f.controller.reconcile();
    assert.equal(f.starts.length, 1);
});

test('pause during audit cancels subsequent selection and launch', async () => {
    let release; const barrier = new Promise(resolve => { release = resolve; });
    const f = fixture({ inspect: async () => { await barrier; return evidence(); } });
    f.controller.run(); await Promise.resolve(); await f.controller.pause(); release(); await f.controller.workPromise;
    assert.equal(f.starts.length, 0); assert.equal(f.controller.state.desired, 'paused');
});

test('paper permission revocation stops entries and pauses the owned session', async () => {
    let permitted = true;
    const f = fixture({ entryAuthority: () => permitted });
    await launch(f);
    assert.equal(f.starts.length, 1);
    permitted = false;
    assert.equal(f.controller.canEnter('ETH-USD', f.sessions[0].config), false);
    await f.controller.reconcile();
    assert.equal(f.sessions[0].config.entriesPaused, true);
    assert.equal(f.controller.state.phase, 'waiting');
});

test('pause while start is pending catches a late acknowledgement and pauses it too', async () => {
    let release, entered; const barrier = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture(); const realStart = f.dependencies.start;
    f.dependencies.start = async (...args) => { entered(); await barrier; return realStart(...args); };
    f.controller.run(); await started; await f.controller.pause(); release(); await f.controller.workPromise;
    assert.equal(f.sessions[0].config.entriesPaused, true);
    assert.equal(f.controller.canEnter('ETH-USD', f.sessions[0].config), false);
});

test('new mission drains existing paper positions without abandoning protection', async () => {
    const f = fixture(); f.sessions.push({ symbol: 'BTC-USD', isRunning: true, paperMode: true, config: {}, openPositions: [{ qty: 1 }] });
    await launch(f); assert.equal(f.starts.length, 0); assert.equal(f.sessions[0].isRunning, true);
    assert.equal(f.sessions[0].config.entriesPaused, true); assert.equal(f.controller.state.phase, 'waiting');
    f.sessions[0].openPositions = []; f.sessions[0].isRunning = false; f.advance(61000);
    await f.controller.reconcile(); assert.equal(f.starts.length, 1);
});

test('orphan ledger positions prevent replacement entries', async () => {
    const f = fixture({ unownedPositions: () => [{ symbol: 'ETH-USD' }] });
    await launch(f); assert.equal(f.starts.length, 0); assert.match(f.controller.state.message, /restoration/);
});

test('paper mission refuses to take over a live executor', () => {
    const f = fixture(); f.sessions.push({ isRunning: true, paperMode: false });
    assert.throws(() => f.controller.run(), /live session/); assert.equal(f.controller.state.controlled, false);
});

test('no executor acknowledgement is an error, not a running success', async () => {
    const f = fixture({ start: async () => ({ success: true }) });
    await launch(f); assert.equal(f.controller.state.phase, 'error'); assert.equal(f.controller.status().entriesActive, false);
    assert.match(f.controller.state.lastError, /acknowledge/);
});

test('freshness is checked again immediately before launch', async () => {
    const f = fixture({ readiness: async () => ({ ready: false, reason: 'quote expired' }) });
    await launch(f); assert.equal(f.starts.length, 0); assert.match(f.controller.state.message, /quote expired/);
});

test('pause reports executor failures and persisted pause survives restart', async () => {
    const f = fixture(); await launch(f);
    f.dependencies.pause = async () => { throw new Error('unreachable'); };
    const result = await f.controller.pause(); assert.equal(result.phase, 'error'); assert.match(result.lastError, /unreachable/);
    assert.equal(f.controller.canEnter('ETH-USD', f.sessions[0].config), false);
    const restored = new TradingMissionController({ statePath: f.controller.statePath, dependencies: f.dependencies });
    assert.equal(restored.state.controlled, true); assert.equal(restored.state.desired, 'paused');
    await restored.reconcile(); assert.equal(f.starts.length, 1);
});

test('protection status becomes paused when the last protected position closes', async () => {
    const f = fixture(); await launch(f); f.sessions[0].openPositions = [{ qty: 1 }];
    await f.controller.pause(); assert.equal(f.controller.status().phase, 'protecting');
    f.sessions[0].openPositions = []; f.sessions[0].isRunning = false;
    assert.equal(f.controller.status().phase, 'paused');
});

test('running intent restarts in recovery, with no entry authority until a new audit', async () => {
    const f = fixture(); await launch(f);
    const restored = new TradingMissionController({ statePath: f.controller.statePath, dependencies: f.dependencies });
    assert.equal(restored.state.phase, 'recovering'); assert.equal(restored.canEnter('ETH-USD', f.sessions[0].config), false);
});

test('paper mission resumes its audit after restart only while scoped permission remains', async () => {
    let permitted = true;
    const f = fixture({ entryAuthority: () => permitted });
    await launch(f);
    f.sessions.length = 0;
    const restored = new TradingMissionController({ statePath: f.controller.statePath, dependencies: f.dependencies });
    assert.equal(restored.state.phase, 'recovering');
    restored.schedule(); await restored.workPromise;
    assert.equal(restored.state.phase, 'running');
    assert.equal(f.starts.length, 2);
    permitted = false;
    const stopped = new TradingMissionController({ statePath: f.controller.statePath, dependencies: f.dependencies });
    assert.equal(stopped.canEnter('ETH-USD', f.sessions[0].config), false);
    stopped.schedule(); await stopped.workPromise;
    assert.equal(f.starts.length, 2);
    assert.equal(f.sessions[0].config.entriesPaused, true);
});

test('catalog and mission configuration cannot be hot-mutated or hunt-rotated', () => {
    const trader = new AutonomousTrader(); trader.config = missionConfig(candidate(), 'run');
    assert.throws(() => trader.updateConfig({ maxPaperTradeValue: 90000, entriesPaused: false }), /frozen/);
    const original = structuredClone(trader.config);
    trader.applyRuntimeProfile({ config: { forcePaper: false, maxPaperTradeValue: 90000 } }, { allowManual: true });
    assert.deepEqual(trader.config, original);
});

test('final executor boundary rejects unacknowledged entries but does not gate exits', async () => {
    const trader = new AutonomousTrader(); trader.symbol = 'ETH-USD'; trader.isRunning = true; trader.paperMode = true;
    trader._logDecision = () => {}; trader._executePaperOrder = () => assert.fail('unauthorized entry reached fill simulator');
    const previous = global.SOMA_TRADING_MISSION;
    global.SOMA_TRADING_MISSION = { canEnter: () => false };
    try { assert.equal(await trader._executeTrade({ action: 'BUY' }, { qty: 1 }, 100, {}), null); }
    finally { global.SOMA_TRADING_MISSION = previous; }
});

test('evidence provider fails closed on unavailable ledger and never treats it as zero losses', async () => {
    const provider = createMissionEvidence({ ledger: {}, reports: () => ({}), data: {}, quotes: {} });
    assert.equal(provider.proposals().candidates.length, 6);
    assert.equal(provider.proposals().excluded[0].source, 'grid');
    await assert.rejects(provider.inspect(candidate()), /ledger/);
});

test('UI default uses the autonomous mission, keeps scan separate, and removes manual preflight from Auto', () => {
    const app = fs.readFileSync(new URL('../frontend/apps/command-bridge/panels/MissionControl/MissionControlApp.jsx', import.meta.url), 'utf8');
    const panel = fs.readFileSync(new URL('../frontend/apps/command-bridge/components/TradingMissionPanel.jsx', import.meta.url), 'utf8');
    assert.match(app, /mode === TradeMode\.AUTONOMOUS\) return missionControl\.command\('run'\)/);
    assert.match(app, /mode === TradeMode\.MANUAL && !tradingActive && !tradeStrategyGateSkipped/);
    assert.match(panel, /command\('audit'\)/); assert.match(panel, /run SOMA/i);
    assert.match(panel, /Last displayed state may be stale/);
});

test('catalog identities cannot conceal changed execution sizing', () => {
    const recipe = candidate(); recipe.compiledStrategy.dsl.sizing.maxPaperTradeValue = 90000;
    assert.throws(() => missionCandidate(recipe), /frozen recipe/);
});

test('focused experiment requests constrain selection without bypassing the audit', async () => {
    const f = fixture({ proposals: () => ({ candidates: [candidate(), ecosystemCandidate('holding', 'BTC-USD')] }) });
    f.controller.run({ focus: { symbol: 'BTC-USD', lane: 'holding' } }); await f.controller.workPromise;
    assert.equal(f.starts[0].symbol, 'BTC-USD'); assert.equal(f.starts[0].ecosystemLane, 'holding');
    await f.controller.pause(); assert.equal(f.controller.canEnter('SOL-USD', {}), false);
    assert.throws(() => f.controller.run({ focus: { symbol: 'BTC-USD', lane: 'grid' } }), /Unsupported/);
});

test('new negative closed-trade evidence pauses entries before the periodic audit is due', async () => {
    let changed = false;
    const paper = () => changed ? { trades: 5, netPnl: -6, profitFactor: 0.2, meanNetReturn: -0.01 } : evidence().forward;
    const f = fixture({ forward: paper, inspect: async () => evidence({ forward: paper() }) });
    await launch(f); changed = true; await f.controller.reconcile();
    assert.equal(f.pauses.includes('ETH-USD'), true); assert.equal(f.controller.state.phase, 'waiting');
    assert.equal(f.starts.length, 1);
});

test('native evidence uses exact version outcomes and rejects mock source history', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    try {
        db.exec('CREATE TABLE trades (id INTEGER, symbol TEXT, strategy_version TEXT, status TEXT, pnl REAL, entry_price REAL, qty REAL, exit_time TEXT, entry_fee REAL, exit_fee REAL, slippage_pct REAL)');
        const insert = db.prepare("INSERT INTO trades VALUES(?, 'ETH-USD', ?, 'closed', ?, 100, 1, '2026-09-10', 0.25, 0.25, 0.02)");
        insert.run(1, 'old-version', -1000); insert.run(2, candidate().id, 0.5);
        const now = Date.now(); let mockHistory = false;
        const bars = Array.from({ length: 260 }, (_, i) => ({ timestamp: now - (262 - i) * 60000,
            open: 100 + i * 0.1, close: 100 + i * 0.1, high: 101 + i * 0.1, low: 99 + i * 0.1, volume: 1000,
            source: 'alpaca_crypto_us' }));
        const dependencies = { ledger: { db }, now: () => now, reports: () => ({}),
            data: { getAlpacaCryptoBars: async () => bars.map(bar => ({ ...bar, isMock: mockHistory })) },
            quotes: { getCryptoQuote: async () => ({ bid: 100, ask: 100.01, timestamp: now, source: 'alpaca_crypto_us' }) } };
        const provider = createMissionEvidence(dependencies);
        const inspected = await provider.inspect(candidate());
        assert.equal(inspected.forward.trades, 1); assert.equal(inspected.forward.netPnl, 0.5);
          assert.equal(inspected.forward.costReconciliation.observedRoundTripFeeBps, 50);
          assert.equal(inspected.forward.costReconciliation.modeledRoundTripFeeBps, 50);
          assert.equal(inspected.forward.costReconciliation.averageAbsoluteEntrySlippageBps, 2);
          db.prepare('UPDATE trades SET entry_fee=0, exit_fee=0 WHERE id=2').run();
          assert.equal(provider.forward(candidate()).costReconciliation.warning, 'paper_fee_evidence_below_model');
          assert.equal(inspected.historical.kind, 'historical_70_30_split_not_prospective');
        mockHistory = true;
        const rejected = await createMissionEvidence(dependencies).inspect(candidate());
        assert.equal(rejected.data.ready, false); assert.equal(rejected.historical, null);
        insert.run(3, candidate().id, null);
        assert.throws(() => provider.forward(candidate()), /malformed/);
    } finally { db.close(); }
});

test('HTTP mission commands acknowledge intent, ignore live overrides, and block legacy restarts', async () => {
    const { default: express } = await import('express');
    const { default: routes, tradingMission, reconcilePaperCandidateExecution } = await import('../server/finance/autonomousRoutes.js');
    const f = fixture();
    const intentPath = path.join(sandbox, 'data', 'trading', 'trading-intent.json');
    tradingMission.bind({ ...f.dependencies, entryAuthority: () =>
        JSON.parse(fs.readFileSync(intentPath, 'utf8')).paperMissionEnabled === true });
    const app = express(); app.use(express.json()); app.use('/api/autonomous', routes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/autonomous`;
    const post = (suffix, body = {}) => fetch(`${base}/${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
        const audit = await post('mission/audit'); assert.equal(audit.status, 202); await tradingMission.auditPromise;
        assert.equal(tradingMission.state.controlled, false); assert.equal(f.starts.length, 0);
        const start = await post('mission/run', { symbol: 'SPY', config: { paperMode: false, maxPaperTradeValue: 90000 } });
        assert.equal(start.status, 202); await tradingMission.workPromise;
        const paperIntent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
        assert.equal(paperIntent.desiredState, 'stopped');
        assert.equal(paperIntent.autoResume, false);
        assert.equal(paperIntent.paperMissionEnabled, true);
        assert.equal(f.starts.length, 1); assert.equal(f.sessions[0].paperMode, true); assert.equal(f.sessions[0].config.maxPaperTradeValue, 250);
        assert.equal((await post('start', { symbol: 'SPY' })).status, 409);
        assert.equal((await post('start-portfolio', { symbols: ['SPY'] })).status, 409);
        assert.equal((await reconcilePaperCandidateExecution()).reason, 'mission_control_owns_paper_lifecycle');
        const pause = await post('mission/pause'); assert.equal(pause.status, 200);
        assert.equal((await pause.json()).mission.desired, 'paused');
        const stoppedIntent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
        assert.equal(stoppedIntent.desiredState, 'stopped');
        assert.equal(stoppedIntent.autoResume, false);
        assert.equal(stoppedIntent.paperMissionEnabled, false);
        assert.equal((await reconcilePaperCandidateExecution()).reason, 'mission_control_owns_paper_lifecycle');
        const status = await (await fetch(`${base}/mission/status`)).json();
        assert.equal(status.mission.entriesActive, false); assert.equal(status.mission.liveEnabled, false);
    } finally {
        await tradingMission.pause();
        await new Promise(resolve => server.close(resolve));
        const { default: hunt } = await import('../daemons/StrategyHuntDaemon.js');
        await hunt.stop();
        // Keep legacy bootstrap timers inert until the test process exits.
        tradingMission.state.controlled = true;
    }
});
