/**
 * Autonomous Trading API Routes
 * Supports running multiple symbols concurrently via a per-symbol instance registry.
 * Each symbol gets its own AutonomousTrader instance with independent state.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { AutonomousTrader, _setPerformanceCacheFlush } from './autonomousTrader.js';
import strategyHuntDaemon from '../../daemons/StrategyHuntDaemon.js';
import notificationService from '../services/NotificationService.js';
import lowLatencyEngine from './lowLatencyEngine.js';
import missionControlRuntime from './MissionControlRuntime.js';
import tradeLogger from './TradeLogger.js';
import tradingPerformanceGuard, { normalizeStrategyId } from './TradingPerformanceGuard.js';
import { buildTradingResearchStatus, selectExecutablePaperCandidate, selectQualifiedOfflinePaperCandidate } from './PaperCandidateSelector.js';
import { buildQualifiedPaperAutostartPlan } from './TradingAutostartPolicy.js';
import { buildExecutionStoppedMessage } from './TradingStatusMessaging.js';
import tradingResearchDaemon from './TradingResearchDaemon.js';
import { bindLegacyPrunerQuarantine, getPrunerQuarantine } from './TradingPrunerState.js';
import { buildTradingStrategyIdentity, stampTradingStrategyIdentity } from './TradingStrategyIdentity.js';
import { assessPaperLearningContinuation, currentPaperLearningConfig, PAPER_EXECUTION_POLICY_VERSION } from './PaperLearningPolicy.js';
import tradingEcosystem from './TradingEcosystem.js';
import { TradingMissionController } from './TradingMissionController.js';
import { createMissionEvidence } from './TradingMissionEvidence.js';
import { missionConfig } from './TradingMissionPolicy.js';
import marketDataService from './marketDataService.js';
import alpacaService from './AlpacaService.js';
import { buildTradingResumeConfig } from './TradingResumeIntent.js';
import { normalizeTradingIntent, allowsAutonomousEntries, allowsScopedPaperMissionEntry, resumeMode, stopTradingIntent } from './TradingIntentPolicy.js';

const router = express.Router();

// Registry: symbol (uppercased) → AutonomousTrader instance
const _registry = new Map();
// Shared so PositionGuardian can snapshot SOMA's own paper-engine equity instead
// of the untouched Alpaca account (whose frozen $100k made daily_snapshots useless).
global.SOMA_AUTONOMOUS_REGISTRY = _registry;
export const tradingMission = new TradingMissionController({
    statePath: path.join(process.cwd(), 'data/trading/mission-autopilot.json')
});
// Final entry authority for this paper executor; exits never depend on it.
global.SOMA_TRADING_MISSION = tradingMission;

// Cache per symbol + aggregate
const _cache = new Map();
const CACHE_TTL = 2000;

function cached(key, ttlMs, compute) {
    const now = Date.now();
    const hit = _cache.get(key);
    if (hit && (now - hit.ts) < ttlMs) return hit.body;
    const body = compute();
    _cache.set(key, { body, ts: now });
    return body;
}

function flushCache(symbol) {
    if (symbol) {
        _cache.delete(`status_${symbol}`);
        _cache.delete(`decisions_${symbol}`);
    }
    _cache.delete('status_all');
    _cache.delete('decisions_all');
}

/** Called by routes.js after performance routes load — wires all instances to the same flush */
export function flushStatusCache() {
    flushCache();
}

function getOrCreateInstance(symbol) {
    const key = symbol.toUpperCase();
    if (!_registry.has(key)) {
        _registry.set(key, new AutonomousTrader());
    }
    return _registry.get(key);
}

function normalizeTradeSymbol(symbol) {
    const raw = String(symbol || '').trim().toUpperCase();
    if (['BTC', 'ETH', 'SOL'].includes(raw)) return `${raw}-USD`;
    return raw;
}

function resolveAutonomousStartRequest({ symbol, preset, config = {} } = {}) {
    const runtime = missionControlRuntime.getStatus?.() || {};
    const selectionMode = String(config.strategySelectionMode || runtime.strategySelectionMode || 'auto').toLowerCase();
    if (selectionMode === 'auto' && runtime.activeStrategy?.symbol) {
        return {
            symbol: normalizeTradeSymbol(runtime.activeStrategy.symbol),
            preset: null,
            config: {
                ...config,
                strategySelectionMode: 'auto',
                paperMode: config.paperMode !== false,
                selectedBy: 'mission_control_sim_to_live',
                selectedStrategyId: runtime.activeStrategy.strategyId,
                selectedCandidateId: runtime.activeStrategy.candidateId || null
            },
            runtime
        };
    }
    return {
        symbol: normalizeTradeSymbol(symbol),
        preset,
        config,
        runtime
    };
}

// ─── Durable trading intent ──────────────────────────────────────────────────
// The registry is in-memory, so a server restart used to silently end trading.
// Intent is persisted on every deliberate start/stop and PAPER sessions are
// auto-resumed shortly after boot. Live sessions are never auto-resumed —
// re-engaging real money always requires an explicit human start.

const INTENT_PATH = path.join(process.cwd(), 'data', 'trading', 'trading-intent.json');
const SIM_TO_LIVE_REPORT_PATH = path.join(process.cwd(), 'data', 'trading', 'sim-to-live-report.json');
const OFFLINE_EVOLUTION_REPORT_PATH = path.join(process.cwd(), 'data', 'market-lab', 'offline-evolution-latest.json');

function readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
}
const AUTOMATED_CANDIDATE_SOURCES = new Set(['mission_control_sim_to_live', 'offline_forward_qualified']);

function currentAutomatedCandidate() {
    try {
        const report = JSON.parse(fs.readFileSync(SIM_TO_LIVE_REPORT_PATH, 'utf8'));
        const candidate = selectExecutablePaperCandidate(report || {});
        if (candidate) return { candidate, selectedBy: 'mission_control_sim_to_live' };
    } catch {}
    try {
        const report = JSON.parse(fs.readFileSync(OFFLINE_EVOLUTION_REPORT_PATH, 'utf8'));
        const candidate = selectQualifiedOfflinePaperCandidate(report || {});
        if (candidate) return { candidate, selectedBy: 'offline_forward_qualified' };
    } catch {}
    return null;
}

function _readIntent() {
    const active = [..._registry.values()].filter(instance => instance.isRunning);
    const actualState = active.some(instance => !instance.config?.entriesPaused)
        ? 'running' : active.length ? 'paused' : 'stopped';
    try {
        const data = JSON.parse(fs.readFileSync(INTENT_PATH, 'utf8'));
        return normalizeTradingIntent(data, actualState);
    } catch {
        return normalizeTradingIntent({}, actualState);
    }
}

function _writeIntent(intent) {
    try {
        fs.mkdirSync(path.dirname(INTENT_PATH), { recursive: true });
        const normalized = normalizeTradingIntent(intent, intent.actualState || (_registry.size > 0 ? 'running' : 'stopped'));
        const payload = {
            ...normalized,
            updatedAt: new Date().toISOString()
        };
        const temporary = `${INTENT_PATH}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(payload, null, 2));
        fs.renameSync(temporary, INTENT_PATH);
    } catch (e) {
        console.warn('[Autonomous] Failed to persist trading intent:', e.message);
        throw e;
    }
}

function stampStrategyIdentity(symbol, preset, config = {}) {
    return stampTradingStrategyIdentity({
        symbol,
        strategyId: config?.selectedStrategyId || preset,
        preset,
        config,
        candidateKey: config?.selectedCandidateKey,
        compiledStrategyId: config?.compiledStrategyId
    });
}

function paperCanaryVerdict(identity) {
    return tradingPerformanceGuard.evaluate({
        symbol: identity.symbol,
        strategyId: identity.strategyId,
        strategyVersion: identity.strategyVersion,
        paperOnly: true
    });
}

function recordEngaged(symbol, preset, config) {
    const intent = _readIntent();
    const stamped = stampStrategyIdentity(symbol, preset, buildTradingResumeConfig(config, _registry.get(symbol.toUpperCase())));
    intent.engaged[symbol] = { preset: preset || null, config: stamped.config, engagedAt: new Date().toISOString() };
    const missionClaim = config?.selectedBy === 'mission_autopilot';
    const missionPaper = missionClaim && allowsScopedPaperMissionEntry(intent, config,
        config?.missionRunId === tradingMission.state.runId && tradingMission.canEnter(symbol, config));
    if (missionClaim && !missionPaper) throw new Error('Paper mission lost entry authority before intent was persisted');
    if (!missionPaper) intent.desiredState = 'running';
    intent.actualState = 'running';
    if (!missionPaper) {
        intent.autoResume = true;
        if (intent.pausedSymbols) delete intent.pausedSymbols[symbol];
    }
    _writeIntent(intent);
}

function containUnpersistedStart(symbol, instance) {
    try { instance.pauseEntries(); } catch {}
    const hasOpen = Boolean((instance.getStatus?.().openPositions || []).length);
    if (!hasOpen) {
        try { instance.stop(); } catch {}
        if (_registry.get(symbol) === instance) _registry.delete(symbol);
    }
}

function recordStartedOrContain(symbol, preset, config, instance) {
    try { recordEngaged(symbol, preset, config); }
    catch (error) {
        containUnpersistedStart(symbol, instance);
        throw new Error(`Started ${symbol} but could not persist trading intent; entries were paused: ${error.message}`);
    }
}

function entriesAllowedFor(symbol, config = null) {
    const intent = _readIntent();
    if (config?.selectedBy === 'mission_autopilot') return allowsScopedPaperMissionEntry(intent, config,
        tradingMission.canEnter(symbol, config));
    return allowsAutonomousEntries(intent) && !intent.pausedSymbols?.[symbol];
}

function recordDisengaged(symbol = null) {
    const intent = _readIntent();
    if (symbol) {
        delete intent.engaged[symbol];
        if (Object.keys(intent.engaged).length === 0) {
            intent.desiredState = 'stopped';
            intent.autoResume = false;
            intent.actualState = 'stopped';
        }
    } else {
        intent.engaged = {};
        intent.desiredState = 'stopped';
        intent.autoResume = false;
        intent.actualState = 'stopped';
    }
    _writeIntent(intent);
}

function pausePaperSession(symbol) {
    const instance = _registry.get(symbol);
    if (!instance) return { symbol, state: 'stopped' };
    if (!instance.paperMode) throw new Error('Ecosystem controls are paper-only');
    const result = instance.pauseEntries();
    const protecting = result.state === 'protecting_open_positions';
    if (protecting) {
        const intent = _readIntent();
        const stamped = stampStrategyIdentity(symbol, instance.preset, buildTradingResumeConfig(instance.config, instance));
        intent.engaged[symbol] = { preset: instance.preset || null, config: { ...stamped.config, entriesPaused: true }, engagedAt: new Date().toISOString() };
        intent.actualState = 'paused';
        _writeIntent(intent);
    }
    else recordDisengaged(symbol);
    const intent = _readIntent();
    intent.pausedSymbols ||= {};
    intent.pausedSymbols[symbol] = new Date().toISOString();
    _writeIntent(intent);
    flushCache(symbol);
    return result;
}

const ecosystemExecution = {
    sessions: () => [..._registry.values()].map(instance => instance.getExecutionStatus()),
    start: async ({ symbol, preset, config }) => {
        if (!entriesAllowedFor(symbol, config)) throw new Error(`Trading intent is stopped or ${symbol} is paused; use an explicit start before new paper entries.`);
        if (tradingMission.state.controlled && !config.missionRunId) {
            return { success: true, submitted: true, mission: tradingMission.run({ focus: { symbol, lane: config.ecosystemLane } }) };
        }
        if (tradingMission.state.desired === 'running' && !tradingMission.canEnter(symbol, config)) {
            throw new Error('SOMA mission owns strategy selection. Pause the mission before starting a separate experiment.');
        }
        if (_registry.get(symbol)?.isRunning || _registry.get(symbol)?._openPositions?.length) throw new Error(`${symbol} already has an owner`);
        if (!tradeLogger.db) tradeLogger.initialize();
        if (tradeLogger.getOpenTrades().some(trade => trade.symbol === symbol)) throw new Error(`${symbol} has an open ledger position; restore its original session first`);
        const instance = new AutonomousTrader();
        _registry.set(symbol, instance);
        const stamped = stampStrategyIdentity(symbol, preset, config);
        const result = await instance.start(symbol, preset, stamped.config);
        if (!result?.success) {
            instance.stop();
            if (_registry.get(symbol) === instance) _registry.delete(symbol);
            throw new Error(result?.error || 'Paper start failed');
        }
        recordStartedOrContain(symbol, preset, stamped.config, instance);
        ensureStreaming();
        flushCache(symbol);
        return { success: true, symbol, lane: config.ecosystemLane, paperOnly: true, strategyVersion: stamped.config.strategyVersion };
    },
    pause: pausePaperSession
};
tradingEcosystem.bindExecution({ ...ecosystemExecution,
    pause: async symbol => {
        if (!tradingMission.state.controlled) return pausePaperSession(symbol);
        const mission = await tradingMission.pause(`ecosystem_pause:${symbol}`);
        if (mission.lastError) throw new Error(mission.lastError);
        return mission;
    },
    missionStatus: () => tradingMission.status()
});
const missionEvidence = createMissionEvidence({ data: marketDataService, quotes: alpacaService, ledger: tradeLogger,
    reports: () => ({ simToLive: readJson(SIM_TO_LIVE_REPORT_PATH), offline: readJson(OFFLINE_EVOLUTION_REPORT_PATH) }) });
tradingMission.bind({ ...missionEvidence, sessions: ecosystemExecution.sessions, pause: pausePaperSession,
    entryAuthority: () => _readIntent().paperMissionEnabled,
    proposals: () => { if (!tradeLogger.db) tradeLogger.initialize(); return missionEvidence.proposals(); },
    unownedPositions: () => tradeLogger.getOpenTrades().filter(row => !_registry.get(row.symbol)?._openPositions?.length),
    start: (candidate, runId) => ecosystemExecution.start({ symbol: candidate.symbol, preset: candidate.strategyId,
        config: missionConfig(candidate, runId) })
});
const missionBootReadyAt = Date.now() + 90_000;
const missionTimer = setInterval(() => {
    if (Date.now() < missionBootReadyAt || tradingMission.state.desired !== 'running') return;
    if (!_readIntent().paperMissionEnabled) {
        tradingMission.pause('paper_mission_authority_disabled').catch(error =>
            console.warn('[TradingMission] Failed to pause after authority was removed:', error.message));
        return;
    }
    tradingMission.schedule();
}, 15_000);
missionTimer.unref?.();

router.get('/mission/status', (_req, res) => res.json({ success: true, mission: tradingMission.status() }));
router.post('/mission/run', (_req, res) => {
    const before = _readIntent();
    try {
        const intent = { ...before };
        intent.paperMissionEnabled = true;
        _writeIntent(intent);
        const mission = tradingMission.run();
        res.status(202).json({ success: true, mission });
    }
    catch (error) {
        try { _writeIntent(before); } catch {}
        res.status(409).json({ success: false, error: error.message });
    }
});
router.post('/mission/audit', (_req, res) => {
    // Information request only: never sets desired=running or executes a trade.
    tradingMission.audit().catch(error => console.warn('[TradingMission] Audit:', error.message));
    res.status(202).json({ success: true, mission: tradingMission.status() });
});
router.post('/mission/pause', async (_req, res) => {
    try {
        _writeIntent(stopTradingIntent(_readIntent(), { stopped: [..._registry.keys()] }));
        const mission = await tradingMission.pause();
        const protecting = mission.sessions.filter(session => session.openPositions?.length).map(session => session.symbol);
        const intent = _readIntent();
        intent.actualState = mission.lastError ? 'failed' : protecting.length ? 'paused' : 'stopped';
        _writeIntent(intent);
        res.status(mission.lastError ? 409 : 200).json({ success: !mission.lastError, mission, error: mission.lastError });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

async function resumeEngagedSessions() {
    const intent = _readIntent();
    const entryResumeAllowed = allowsAutonomousEntries(intent);
    if (!entryResumeAllowed) console.log('[Autonomous] Trading entries are stopped; only existing open paper positions may restore exit protection.');
    const symbols = Object.keys(intent.engaged || {});
    if (symbols.length === 0) return;
    console.log(`[Autonomous] 🔁 Resuming ${symbols.length} engaged trading session(s) from intent file...`);
    for (const [index, sym] of symbols.entries()) {
        const { preset, config } = intent.engaged[sym];
        if (config?.paperMode !== true) {
            console.warn(`[Autonomous] ⏭ Skipping auto-resume of ${sym} — not explicitly paper mode. Live resume requires a human.`);
            continue;
        }
        if (!tradeLogger.db) tradeLogger.initialize();
        const hasOpenPosition = tradeLogger.getOpenTrades().some(trade => trade.symbol === sym);
        if (tradingMission.state.controlled && !hasOpenPosition) {
            // A prior mission session has no exit to protect. Clear its stale
            // execution receipt even when global entry intent is stopped.
            recordDisengaged(sym);
            continue;
        }
        const mode = resumeMode(intent, hasOpenPosition);
        if (mode === 'skip') continue;
        if (mode === 'protect_exits_only') config.entriesPaused = true;
        if (tradingMission.state.controlled) {
            // Recover exits, not stale entry authority. The mission audits and
            // explicitly recreates a flat paper recipe after bootstrap.
            if (!hasOpenPosition) { recordDisengaged(sym); continue; }
            config.entriesPaused = true;
        }
        const migrateCanary = config?.selectedBy === 'paper_learning_canary'
            && config.executionPolicyVersion !== PAPER_EXECUTION_POLICY_VERSION && !hasOpenPosition;
        const stamped = stampStrategyIdentity(sym, preset, migrateCanary ? currentPaperLearningConfig(config) : (config || {}));
        const { identity } = stamped;
        bindLegacyPrunerQuarantine(identity);
        if (!hasOpenPosition && getPrunerQuarantine(identity)) {
            console.warn(`[Autonomous] ⏭ Skipping quarantined paper identity ${identity.key}; unchanged losing evidence cannot auto-resume.`);
            recordDisengaged(sym);
            continue;
        }
        const continuation = assessPaperLearningContinuation({
            config,
            hasOpenPosition,
            performanceVerdict: config?.selectedBy === PAPER_LEARNING_CANARY_SELECTED_BY ? paperCanaryVerdict(identity) : null
        });
        if (!continuation.allowed) {
            console.warn(`[Autonomous] ⏭ Retiring ${identity.key}: ${continuation.reason}. Research remains active.`);
            recordDisengaged(sym);
            continue;
        }
        if (!hasOpenPosition && AUTOMATED_CANDIDATE_SOURCES.has(config?.selectedBy)) {
            const current = currentAutomatedCandidate();
            const sameCandidate = current
                && current.selectedBy === config.selectedBy
                && (!config.selectedCandidateKey || current.candidate.key === config.selectedCandidateKey);
            if (!sameCandidate) {
                console.warn(`[Autonomous] ⏭ Retiring stale automated intent for ${sym}; its economic evidence is no longer current.`);
                recordDisengaged(sym);
                continue;
            }
        }
        try {
            const existing = _registry.get(sym);
            if (existing?.isRunning) continue;
            const instance = getOrCreateInstance(sym);
            const result = await instance.start(sym, preset, {
                ...stamped.config,
                initialCycleDelayMs: Math.max(Number(config?.initialCycleDelayMs || 0), index * 15_000)
            });
            if (result.success && mode === 'normal') recordStartedOrContain(sym, preset, stamped.config, instance);
            console.log(`[Autonomous] ${result.success ? '✅ Resumed' : '❌ Failed to resume'} ${sym}${result.success ? '' : ': ' + (result.error || 'unknown')}`);
            if (result.success && mode === 'normal') notificationService.sendAlert(
                '🔁 Engine Auto-Resumed',
                `Paper trading on **${sym}** resumed after server restart`,
                { delivery: 'digest', eventType: 'engine_resume', dedupeKey: `engine_resume:${identity.key}` }
            ).catch(() => {});
            flushCache(sym);
        } catch (e) {
            console.warn(`[Autonomous] ❌ Resume error for ${sym}:`, e.message);
        }
    }
    ensureStreaming();
    try {
        if (!tradeLogger.db) tradeLogger.initialize();
        const activeOrderIds = [..._registry.values()].flatMap(instance =>
            (instance.getStatus?.().openPositions || []).map(position => position.orderId || position.order_id).filter(Boolean)
        );
        const reconciliation = tradeLogger.reconcileStaleOpenTrades({ activeOrderIds });
        if (reconciliation.reconciled.length) {
            console.warn(`[Autonomous] Reconciled ${reconciliation.reconciled.length} stale trade row(s) not present in runtime state.`);
        }
    } catch (error) {
        console.warn('[Autonomous] Trade-state reconciliation failed:', error.message);
    }
}

// Give the bootstrap and extended loaders time to settle before resuming.
const resumeIntentTimer = setTimeout(() => { resumeEngagedSessions().catch(() => {}); }, 75_000);
resumeIntentTimer.unref?.();

// ─── Paper learning canary ───────────────────────────────────────────────────
// When NO strategy passes the strict offline live-promotion gate, the autonomous
// engine used to sit flat indefinitely (it went dead for 16 days in Aug 2026).
// When research has no qualified candidate, a PAPER-ONLY canary can gather
// bounded forward evidence. A quarantined exact version is not restarted to
// manufacture more losses. It can never be promoted to live through this path.
const PAPER_LEARNING_CANARY_SELECTED_BY = 'paper_learning_canary';
function learningCanaryEnabled() { return process.env.SOMA_PAPER_LEARNING_CANARY !== 'false'; }
// Canary universe is deliberately its OWN knob (not SOMA_TRADING_SYMBOLS, which
// governs qualified-candidate autostart). Defaults to broker-tradeable cryptos
// including a couple of higher-vol alts so she gathers diverse paper evidence.
function learningCanarySymbols() {
    const raw = process.env.SOMA_CANARY_SYMBOLS || 'SOL-USD,BTC-USD';
    return [...new Set(raw.split(',').map(s => normalizeTradeSymbol(s.trim())).filter(Boolean))];
}
function learningCanaryPreset() { return (process.env.SOMA_CANARY_PRESET || 'standard_portfolio').trim(); }

let _lastCanaryAlertTime = 0;

async function ensureLearningCanary(requestedPreset = null) {
    if (tradingMission.state.controlled) return { canary: false, reason: 'mission_control_owns_paper_lifecycle' };
    if (!allowsAutonomousEntries(_readIntent())) return { canary: false, reason: 'trading_intent_stopped' };
    if (!learningCanaryEnabled()) return { canary: false, reason: 'paper_learning_canary_disabled' };
    const report = readJson(OFFLINE_EVOLUTION_REPORT_PATH);
    const candidate = selectQualifiedOfflinePaperCandidate(report);
    if (candidate) return { canary: false, candidate };
    const preset = requestedPreset || learningCanaryPreset();
    const configuredTargets = learningCanarySymbols().filter(symbol => !_readIntent().pausedSymbols?.[symbol]);
    const plans = configuredTargets.map(symbol => {
        const baseConfig = currentPaperLearningConfig();
        const identity = buildTradingStrategyIdentity({ symbol, strategyId: preset, preset, config: baseConfig });
        const config = { ...baseConfig, strategyVersion: identity.strategyVersion };
        bindLegacyPrunerQuarantine(identity);
        const performanceVerdict = paperCanaryVerdict(identity);
        const continuation = assessPaperLearningContinuation({ config, performanceVerdict });
        return { symbol, identity, config, quarantine: getPrunerQuarantine(identity)
            || (!continuation.allowed ? { reason: continuation.reason, performanceVerdict } : null) };
    });
    const targets = plans.filter(plan => !plan.quarantine);
    const results = [];
    for (const { symbol, identity, config } of targets) {
        if (!allowsAutonomousEntries(_readIntent())) break;
        if (!entriesAllowedFor(symbol)) continue;
        if (_registry.get(symbol)?.isRunning) {
            results.push({ symbol, identity, success: true, alreadyRunning: true });
            continue;
        }
        try {
            const instance = getOrCreateInstance(symbol);
            const result = await instance.start(symbol, preset, config);
            if (!result?.success) { results.push({ symbol, success: false, error: result?.error || 'start_failed' }); continue; }
            if (!entriesAllowedFor(symbol)) {
                instance.pauseEntries();
                if (!(instance.getStatus?.().openPositions || []).length) { instance.stop(); _registry.delete(symbol); }
                results.push({ symbol, success: false, error: 'trading_intent_stopped_during_start' });
                continue;
            }
            recordStartedOrContain(symbol, preset, config, instance);
            results.push({ symbol, identity, success: true });
        } catch (e) {
            results.push({ symbol, success: false, error: e.message });
        }
    }
    const started = results.filter(r => r.success && !r.alreadyRunning).map(r => r.symbol);
    if (started.length) {
        ensureStreaming();
        started.forEach(s => flushCache(s));
        console.log(`[Autonomous] 🐤 Paper learning canary engaged on ${started.join(', ')}/${preset} (paper-only, NOT live-eligible) — no qualified candidate available.`);
        const now = Date.now();
        if (now - _lastCanaryAlertTime > 24 * 60 * 60 * 1000) {
            _lastCanaryAlertTime = now;
            notificationService.sendAlert(
                '🐤 Paper Learning Canary',
                `No strategy passed the live-promotion gate, so I engaged paper-only learning canaries on **${started.join(', ')}** to keep gathering diverse real evidence. None can be promoted to live.`,
                { delivery: 'digest', eventType: 'canary_start', dedupeKey: `canary_start:${started.sort().join(',')}:${preset}` }
            ).catch(() => {});
        }
    }
    return {
        canary: true,
        started,
        results,
        quarantined: plans.filter(plan => plan.quarantine).map(plan => plan.quarantine)
    };
}

// Retire a running canary when a real qualified candidate is ready to take over —
// but never while the canary still holds an open paper position.
function retireLearningCanaryIfFlat() {
    const intent = _readIntent();
    for (const [sym, instance] of _registry.entries()) {
        if (!instance?.isRunning) continue;
        if (intent.engaged?.[sym]?.config?.selectedBy !== PAPER_LEARNING_CANARY_SELECTED_BY) continue;
        if ((instance.getStatus?.().openPositions || []).length > 0) continue;
        instance.stop();
        _registry.delete(sym);
        recordDisengaged(sym);
    }
}

/**
 * Keep one exact sim-to-live candidate gathering paper evidence. Previously the
 * queue nominated pairs such as standard_portfolio/TLT while the durable intent
 * kept running full_aggression/ETH, so the candidate could never graduate.
 */
export async function reconcilePaperCandidateExecution() {
    if (tradingMission.state.controlled) return { skipped: true, reason: 'mission_control_owns_paper_lifecycle' };
    if (!entriesAllowedFor(symbol)) return { skipped: true, reason: 'trading_intent_stopped' };
    const current = currentAutomatedCandidate();
    const candidate = current?.candidate || null;
    const selectedBy = current?.selectedBy || null;
    if (!candidate) {
        const intent = _readIntent();
        const retired = [];
        const deferred = [];
        const canaryTargets = new Set(learningCanarySymbols());
        const canaryPreset = normalizeStrategyId(learningCanaryPreset());
        for (const [runningSymbol, instance] of _registry.entries()) {
            const engaged = intent.engaged?.[runningSymbol];
            if (instance?.isRunning && engaged?.config?.selectedBy === PAPER_LEARNING_CANARY_SELECTED_BY) {
                const identity = buildTradingStrategyIdentity({ symbol: runningSymbol,
                    strategyId: engaged.config.selectedStrategyId || engaged.preset,
                    preset: engaged.preset, config: engaged.config });
                const continuation = assessPaperLearningContinuation({ config: engaged.config,
                    hasOpenPosition: Boolean((instance.getStatus?.().openPositions || []).length),
                    performanceVerdict: paperCanaryVerdict(identity) });
                const staleFleetMember = !canaryTargets.has(runningSymbol)
                    || normalizeStrategyId(engaged.preset) !== canaryPreset
                    || engaged.config.executionPolicyVersion !== PAPER_EXECUTION_POLICY_VERSION
                    || !continuation.allowed;
                if (staleFleetMember && !(instance.getStatus?.().openPositions || []).length) {
                    instance.stop();
                    _registry.delete(runningSymbol);
                    recordDisengaged(runningSymbol);
                    retired.push(runningSymbol);
                    continue;
                }
            }
            if (instance?.isRunning && !engaged?.config?.selectedBy
                && String(engaged?.config?.strategySelectionMode || '').toLowerCase() === 'auto'
                && !(instance.getStatus?.().openPositions || []).length) {
                instance.stop();
                _registry.delete(runningSymbol);
                recordDisengaged(runningSymbol);
                retired.push(runningSymbol);
                continue;
            }
            if (!instance?.isRunning || !AUTOMATED_CANDIDATE_SOURCES.has(engaged?.config?.selectedBy)) continue;
            if ((instance.getStatus?.().openPositions || []).length > 0) {
                deferred.push(runningSymbol);
                continue;
            }
            instance.stop();
            _registry.delete(runningSymbol);
            recordDisengaged(runningSymbol);
            retired.push(runningSymbol);
        }
        if (retired.length) {
            ensureStreaming();
            flushCache();
        }
        // No strategy passed the live-promotion gate. Instead of sitting flat, keep
        // paper learning alive with a clearly-labeled, non-live-eligible canary.
        const canary = await ensureLearningCanary(canaryPreset);
        return {
            skipped: true,
            reason: deferred.length ? 'no_candidate_waiting_for_flat' : 'no_paper_candidate',
            retired,
            deferred,
            canary
        };
    }

    // A real qualified candidate exists — let it supersede any paper learning canary.
    retireLearningCanaryIfFlat();

    const symbol = normalizeTradeSymbol(candidate.symbol);
    const strategyId = String(candidate.strategyId).trim().toLowerCase();
    const existing = _registry.get(symbol);
    if (existing?.isRunning
        && normalizeStrategyId(existing._getActiveStrategyId?.() || existing.preset) === normalizeStrategyId(strategyId)) {
        return { skipped: true, reason: 'candidate_already_running', symbol, strategyId };
    }

    // Retire only prior automatically-selected sessions, and never while they
    // still own a position. Human/manual sessions remain untouched.
    const intent = _readIntent();
    for (const [runningSymbol, instance] of _registry.entries()) {
        const engaged = intent.engaged?.[runningSymbol];
        if (!instance?.isRunning || !AUTOMATED_CANDIDATE_SOURCES.has(engaged?.config?.selectedBy)) continue;
        if ((instance.getStatus?.().openPositions || []).length > 0) {
            return { skipped: true, reason: 'prior_candidate_has_open_position', symbol: runningSymbol };
        }
        instance.stop();
        _registry.delete(runningSymbol);
        recordDisengaged(runningSymbol);
    }

    const instance = getOrCreateInstance(symbol);
    const requestedConfig = {
        forcePaper: true,
        paperMode: true,
        strategySelectionMode: 'manual',
        selectedBy,
        selectedStrategyId: strategyId,
        selectedCandidateId: candidate.id || null,
        selectedCandidateKey: candidate.key || null,
        compiledCandidate: selectedBy === 'offline_forward_qualified' ? candidate : null
    };
    const { config } = stampStrategyIdentity(symbol, strategyId, requestedConfig);
    if (!allowsAutonomousEntries(_readIntent())) return { skipped: true, reason: 'trading_intent_stopped' };
    const result = await instance.start(symbol, strategyId, config);
    if (!result?.success) return { success: false, symbol, strategyId, error: result?.error || 'start_failed' };
    if (!entriesAllowedFor(symbol)) {
        instance.pauseEntries();
        if (!(instance.getStatus?.().openPositions || []).length) { instance.stop(); _registry.delete(symbol); }
        return { skipped: true, reason: 'trading_intent_stopped_during_start' };
    }
    recordStartedOrContain(symbol, strategyId, config, instance);
    ensureStreaming();
    flushCache(symbol);
    return { success: true, symbol, strategyId, candidateId: candidate.id || null };
}

const candidateExecutionTimer = setInterval(() => {
    reconcilePaperCandidateExecution().catch(error => {
        console.warn('[Autonomous] Candidate execution reconciliation failed:', error.message);
    });
}, 5 * 60_000);
candidateExecutionTimer.unref?.();
const initialCandidateExecution = setTimeout(() => {
    reconcilePaperCandidateExecution().catch(() => {});
}, 90_000);
initialCandidateExecution.unref?.();

// ─── Streaming tick bridge ────────────────────────────────────────────────────
// lowLatencyEngine ticks (Alpaca crypto WS, ~ms latency) feed each running
// trader's existing real-time trigger path (_onTradeUpdate: instant TP/SL/
// trailing exits + live mark prices). Entries stay on the deliberate cycle;
// this makes her REACTIONS tick-speed without making her impulsive.

lowLatencyEngine.on('tick', (tick) => {
    try {
        const sym = lowLatencyEngine.normalizeSymbol(tick.symbol);
        const inst = _registry.get(sym);
        if (inst?.isRunning) {
            inst._onTradeUpdate({ ...tick, Symbol: sym, Price: tick.price });
        }
    } catch { /* tick handling must never throw */ }
});

/** Ensure the streaming engine covers every engaged symbol. */
function ensureStreaming() {
    try {
        const symbols = [..._registry.keys()].filter(k => _registry.get(k)?.isRunning);
        if (symbols.length === 0) return;
        const covered = lowLatencyEngine.isRunning
            ? symbols.every(s => lowLatencyEngine.orderBook?.has?.(s) || (lowLatencyEngine._streamSymbols || []).includes(s))
            : false;
        if (!covered) {
            if (lowLatencyEngine.isRunning) lowLatencyEngine.stop();
            lowLatencyEngine._streamSymbols = symbols;
            lowLatencyEngine.start(symbols).catch(e => console.warn('[Autonomous] Tick stream start failed:', e.message));
        }
    } catch (e) {
        console.warn('[Autonomous] ensureStreaming failed:', e.message);
    }
}

/**
 * POST /api/autonomous/start
 * Start autonomous trading for a symbol. Multiple symbols can run concurrently.
 * Body: { symbol, preset?, config? }
 */
router.post('/start', async (req, res) => {
    try {
        if (tradingMission.state.controlled) return res.status(409).json({ success: false, error: 'Use Run SOMA or request a focused experiment in Trading Ecosystem; the mission owns this executor.' });
        const { symbol, preset, config } = req.body;
        if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });

        const resolved = resolveAutonomousStartRequest({ symbol, preset, config: config || {} });
        const sym = resolved.symbol;
        const existing = _registry.get(sym);
        if (existing?.isRunning) {
            return res.status(400).json({ success: false, error: `${sym} is already trading. Stop it first.` });
        }

        const instance = getOrCreateInstance(sym);
        const stamped = stampStrategyIdentity(sym, resolved.preset, resolved.config || {});
        const result = await instance.start(sym, resolved.preset, stamped.config);

        if (!result.success) return res.status(400).json(result);
        recordStartedOrContain(sym, resolved.preset, stamped.config, instance);
        ensureStreaming();
        notificationService.sendAlert(
            '🟢 Engine Engaged',
            `Autonomous ${resolved.config?.paperMode ? 'paper ' : ''}trading started on **${sym}** (${resolved.preset || 'auto ladder'})`,
            { eventType: 'engine_engaged', dedupeKey: `engine_engaged:${sym}:${resolved.preset || 'auto'}`, dedupeMs: 30 * 60_000 }
        ).catch(() => {});
        flushCache(sym);
        res.json({
            ...result,
            symbol: sym,
            requested: { symbol, preset, config: config || {} },
            resolved: {
                symbol: sym,
                preset: resolved.preset,
                strategySelectionMode: resolved.config?.strategySelectionMode,
                selectedStrategyId: resolved.config?.selectedStrategyId,
                selectedCandidateId: resolved.config?.selectedCandidateId
            },
            runningSymbols: [..._registry.keys()].filter(k => _registry.get(k).isRunning)
        });
    } catch (error) {
        console.error('[Autonomous API] Start error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/autonomous/stop
 * Stop autonomous trading for a symbol (or all symbols if no symbol given).
 * Body: { symbol? }
 */
router.post('/stop', async (req, res) => {
    try {
        const { symbol, reason = 'operator_requested' } = req.body || {};
        if (tradingMission.state.controlled && (!symbol || symbol.toUpperCase() === tradingMission.state.selection?.candidate.symbol)) {
            // The stop must be durable before an asynchronous mission pause;
            // even a failed pause cannot restore entry authority on restart.
            _writeIntent(stopTradingIntent(_readIntent(), { stopped: [..._registry.keys()] }));
            const mission = await tradingMission.pause(reason);
            const protecting = mission.sessions.filter(session => session.openPositions?.length).map(session => session.symbol);
            const finalIntent = _readIntent();
            finalIntent.actualState = mission.lastError ? 'failed' : protecting.length ? 'paused' : 'stopped';
            _writeIntent(finalIntent);
            return res.status(mission.lastError ? 409 : 200).json({ success: !mission.lastError, mission, error: mission.lastError,
                message: mission.message, protecting });
        }

        // Audit every stop call — engines have been vanishing from the registry
        // with no session_end; this records who issued the stop.
        try {
            const auditPath = path.join(process.cwd(), 'data', 'trading', 'stop-audit.jsonl');
            fs.mkdirSync(path.dirname(auditPath), { recursive: true });
            fs.appendFileSync(auditPath, JSON.stringify({
                at: new Date().toISOString(),
                ip: req.ip || req.socket?.remoteAddress || null,
                userAgent: req.get?.('user-agent') || null,
                referer: req.get?.('referer') || null,
                body: req.body || null,
                registrySymbols: [..._registry.keys()]
            }) + '\n');
        } catch { /* audit is best-effort */ }

        if (symbol) {
            const sym = symbol.toUpperCase();
            const instance = _registry.get(sym);
            if (!instance) {
                // A stopped or crashed process can leave durable intent behind.
                // The stop command still has to clear it, even with no live instance.
                const intent = _readIntent();
                delete intent.engaged[sym];
                intent.pausedSymbols[sym] = new Date().toISOString();
                if (!Object.keys(intent.engaged).length) {
                    intent.desiredState = 'stopped';
                    intent.autoResume = false;
                }
                _writeIntent(intent);
                flushCache(sym);
                return res.json({ success: true, symbol: sym, state: 'stopped', runningSymbols: [..._registry.keys()].filter(key => _registry.get(key)?.isRunning) });
            }
            const result = instance.paperMode ? { success: true, ...pausePaperSession(sym) } : instance.stop();
            if (!instance.paperMode) { _registry.delete(sym); recordDisengaged(sym); }
            const research = buildTradingResearchStatus({
                simToLiveReport: readJson(SIM_TO_LIVE_REPORT_PATH),
                offlineReport: readJson(OFFLINE_EVOLUTION_REPORT_PATH),
                runtime: missionControlRuntime.getStatus?.() || null
            });
            const message = buildExecutionStoppedMessage({ symbol: sym, reason, research });
            notificationService.sendAlert(message.title, message.body, {
                color: message.color,
                eventType: String(reason).startsWith('portfolio_pruner:') ? 'engine_pruned' : 'engine_stopped',
                dedupeKey: `engine_stop:${sym}:${reason}`,
                dedupeMs: String(reason).startsWith('portfolio_pruner:') ? 7 * 24 * 60 * 60_000 : 30 * 60_000
            }).catch(() => {});
            flushCache(sym);
            return res.json({ ...result, symbol: sym, runningSymbols: [..._registry.keys()].filter(k => _registry.get(k).isRunning) });
        }

        // Stop all
        const stopped = [];
        const protecting = [];
        for (const [sym, instance] of _registry) {
            if (instance.paperMode) {
                if (pausePaperSession(sym).state === 'protecting_open_positions') protecting.push(sym);
            } else {
                instance.stop();
                _registry.delete(sym);
                recordDisengaged(sym);
            }
            stopped.push(sym);
        }
        // Even an empty registry must persist the operator's stop. A stale
        // engaged record or a future canary/reconciler must not restart entries.
        _writeIntent(stopTradingIntent(_readIntent(), { stopped, protecting }));
        if (stopped.length > 0) {
            const research = buildTradingResearchStatus({
                simToLiveReport: readJson(SIM_TO_LIVE_REPORT_PATH),
                offlineReport: readJson(OFFLINE_EVOLUTION_REPORT_PATH),
                runtime: missionControlRuntime.getStatus?.() || null
            });
            const message = buildExecutionStoppedMessage({ symbol: stopped.join(', '), reason, research });
            notificationService.sendAlert(message.title, message.body, {
                color: message.color,
                eventType: 'engine_stopped',
                dedupeKey: `engine_stop_all:${stopped.sort().join(',')}:${reason}`,
                dedupeMs: 30 * 60_000
            }).catch(() => {});
        }
        flushCache();
        res.json({ success: true, stopped, protecting, message: `Entries paused for ${stopped.length} trader(s); protecting ${protecting.length} open paper session(s)` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/autonomous/status
 * Get status of all running traders (or a specific one via ?symbol=SPY)
 */
router.get('/status', (req, res) => {
    try {
        const sym = req.query.symbol?.toUpperCase();

        if (sym) {
            const instance = _registry.get(sym);
            if (!instance) return res.json({ success: true, isRunning: false, symbol: sym });
            const body = cached(`status_${sym}`, CACHE_TTL, () => ({ success: true, symbol: sym, ...instance.getStatus() }));
            return res.json(body);
        }

        // Aggregate all
        const body = cached('status_all', CACHE_TTL, () => {
            const instances = [..._registry.entries()].map(([sym, inst]) => ({
                symbol: sym,
                ...inst.getStatus()
            }));
            const anyRunning = instances.some(i => i.isRunning);
            const intent = _readIntent();
            const primaryInstance = instances.find(i => i.isRunning) || instances[0];
            return {
                success: true,
                // Legacy single-trader fields (first running instance) for backward compat
                ...(primaryInstance || { isRunning: false }),
                // Multi-symbol extension
                instances,
                runningCount: instances.filter(i => i.isRunning).length,
                runningSymbols: instances.filter(i => i.isRunning).map(i => i.symbol),
                intent: {
                    desiredState: intent.desiredState,
                    actualState: anyRunning ? 'running' : 'stopped',
                    autoResume: intent.autoResume,
                    paperMissionEnabled: intent.paperMissionEnabled,
                    updatedAt: intent.updatedAt
                },
                execution: {
                    state: anyRunning ? 'paper_executing'
                        : intent.paperMissionEnabled && tradingMission.state.desired === 'running' ? 'paper_waiting_for_qualified_candidate'
                        : intent.desiredState === 'stopped' ? 'stopped' : 'flat_waiting_for_qualified_candidate',
                    paperOnly: true,
                    liveEnabled: false
                },
                research: buildTradingResearchStatus({
                    simToLiveReport: readJson(SIM_TO_LIVE_REPORT_PATH),
                    offlineReport: readJson(OFFLINE_EVOLUTION_REPORT_PATH),
                    runtime: missionControlRuntime.getStatus?.() || null
                })
            };
        });
        res.json(body);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/research-status', (req, res) => {
    const progress = readJson(path.join(process.cwd(), 'data', 'trading', 'research-progress.json'));
    const director = readJson(path.join(process.cwd(), 'data', 'trading', 'research-director-latest.json'));
    // The persisted state records the current child run, not whether the
    // scheduler itself is alive. Report the singleton's runtime status so an
    // idle interval cannot be mistaken for a dead research daemon.
    const daemon = tradingResearchDaemon.getStatus();
    res.json({
        success: true,
        ...buildTradingResearchStatus({
            simToLiveReport: readJson(SIM_TO_LIVE_REPORT_PATH),
            offlineReport: readJson(OFFLINE_EVOLUTION_REPORT_PATH),
            runtime: missionControlRuntime.getStatus?.() || null
        }),
        discovery: progress ? {
            experimentIndex: progress.experimentIndex,
            consecutiveNoQualified: progress.consecutiveNoQualified,
            lastMeaningfulOutcome: progress.lastMeaningfulOutcome,
            stagnation: progress.stagnation || null,
            lastCycle: progress.lastCycle
        } : null,
        daemon,
        cluster: progress?.lastCycle?.cluster || null,
        latestAuditSummary: director?.summary || null,
        diagnosticShadow: director?.diagnosticShadow || null,
        nextAction: progress?.lastCycle?.research?.paperPromotionEligible > 0
            ? 'observe_eligible_candidates_in_isolated_paper_canaries'
            : (progress?.stagnation?.phase || 'run_bounded_cost_aware_research')
    });
});

/**
 * GET /api/autonomous/decisions
 * Decision log — all instances merged and sorted by time, or ?symbol=SPY for one.
 * Query: ?limit=50&symbol=SPY
 */
router.get('/decisions', (req, res) => {
    try {
        const limit = parseInt(req.query.limit || 50);
        const sym = req.query.symbol?.toUpperCase();

        if (sym) {
            const instance = _registry.get(sym);
            if (!instance) return res.json({ success: true, decisions: [], count: 0, symbol: sym });
            const body = cached(`decisions_${sym}_${limit}`, CACHE_TTL, () => {
                const decisions = instance.getDecisions(limit).map(d => ({ ...d, symbol: sym }));
                return { success: true, decisions, count: decisions.length, symbol: sym };
            });
            return res.json(body);
        }

        // Merge from all instances
        const body = cached(`decisions_all_${limit}`, CACHE_TTL, () => {
            const all = [];
            for (const [sym, instance] of _registry) {
                const decisions = instance.getDecisions(limit);
                decisions.forEach(d => all.push({ ...d, symbol: sym }));
            }
            // Sort by timestamp descending, take top limit
            all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const decisions = all.slice(0, limit);
            return { success: true, decisions, count: decisions.length };
        });
        res.json(body);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/autonomous/config
 * Update config for a running symbol (or all if no symbol)
 * Body: { symbol?, ...configFields }
 */
router.put('/config', (req, res) => {
    try {
        if (tradingMission.state.controlled) return res.status(409).json({ success: false, error: 'Mission recipes are audited snapshots, not mutable runtime preferences.' });
        const { symbol, ...config } = req.body || {};
        if (symbol) {
            const instance = _registry.get(symbol.toUpperCase());
            if (!instance) return res.status(404).json({ success: false, error: `${symbol} not in registry` });
            return res.json({ success: true, config: instance.updateConfig(config) });
        }
        // Apply to all
        const results = {};
        for (const [sym, instance] of _registry) {
            results[sym] = instance.updateConfig(config);
        }
        res.json({ success: true, configs: results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/autonomous/sentiment-ab
 * A/B measurement (Options A + D): does the alt-data/sentiment layer (Reddit +
 * Fear & Greed) actually improve outcomes vs pure technical signals? Reads the
 * per-trade decisionBreakdown captured at entry and compares CLOSED-trade outcomes
 * across buckets. Read-only; reflects real trades she took.
 */
router.get('/sentiment-ab', (req, res) => {
    try {
        if (!tradeLogger.db) tradeLogger.initialize();
        const rows = tradeLogger.db.prepare(
            `SELECT pnl, strategy, symbol, signal_scores_json FROM trades
             WHERE status='closed' AND signal_scores_json IS NOT NULL`
        ).all();
        const mk = () => ({ n: 0, wins: 0, pnl: 0 });
        const buckets = { all: mk(), agreement: mk(), sentimentChanged: mk(), sentimentCreated: mk(), sentimentFlipped: mk() };
        let withBreakdown = 0;
        for (const r of rows) {
            let bd = null;
            try { bd = JSON.parse(r.signal_scores_json)?.decisionBreakdown; } catch { /* ignore */ }
            if (!bd || !bd.blendRec) continue;
            withBreakdown++;
            const win = Number(r.pnl) > 0;
            const add = (b) => { b.n++; if (win) b.wins++; b.pnl += Number(r.pnl) || 0; };
            add(buckets.all);
            if (bd.sentimentChangedDecision) {
                add(buckets.sentimentChanged);
                if (bd.techOnlyRec === 'HOLD') add(buckets.sentimentCreated);
                else if (bd.blendRec !== 'HOLD') add(buckets.sentimentFlipped);
            } else {
                add(buckets.agreement);
            }
        }
        const fmt = (b) => ({ trades: b.n, winRatePct: b.n ? +(b.wins / b.n * 100).toFixed(1) : null, totalPnl: +b.pnl.toFixed(2), avgPnl: b.n ? +(b.pnl / b.n).toFixed(3) : null });
        const sc = fmt(buckets.sentimentChanged), ag = fmt(buckets.agreement);
        let verdict = 'insufficient_data';
        if (buckets.sentimentChanged.n >= 20 && buckets.agreement.n >= 20) {
            verdict = sc.avgPnl > ag.avgPnl ? 'sentiment_layer_helps' : sc.avgPnl < ag.avgPnl ? 'sentiment_layer_hurts' : 'neutral';
        }
        res.json({
            success: true,
            note: 'Compares closed trades where sentiment CHANGED the decision vs where technicals+sentiment agreed. Needs ~20+ in each bucket to mean anything; canaries began gathering this 2026-08-17.',
            closedTradesWithBreakdown: withBreakdown,
            buckets: { all: fmt(buckets.all), agreement: ag, sentimentChanged: sc, sentimentCreated: fmt(buckets.sentimentCreated), sentimentFlipped: fmt(buckets.sentimentFlipped) },
            verdict
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/autonomous/start-portfolio
 * Start multiple symbols concurrently with capital split evenly across them.
 * Body: { symbols: ['BTC/USD','ETH/USD','SPY'], preset?, totalCapital?, config? }
 * Already-running symbols are skipped (not restarted).
 */
router.post('/start-portfolio', async (req, res) => {
    try {
        if (tradingMission.state.controlled) return res.status(409).json({ success: false, error: 'Use Run SOMA or Trading Ecosystem; the mission owns this executor.' });
        const { symbols, preset, totalCapital = 100000, config = {} } = req.body;
        if (!Array.isArray(symbols) || symbols.length === 0) {
            return res.status(400).json({ success: false, error: 'symbols array is required' });
        }

        const perSymbolCapital = Math.floor(totalCapital / symbols.length);
        const results = [];
        const errors = [];

        for (const raw of symbols) {
            const sym = raw.toUpperCase();
            const existing = _registry.get(sym);
            if (existing?.isRunning) {
                results.push({ symbol: sym, status: 'skipped', reason: 'already running' });
                continue;
            }
            try {
                const instance = getOrCreateInstance(sym);
                const stamped = stampStrategyIdentity(sym, preset, {
                    ...config,
                    initialBalance: perSymbolCapital,
                    // Tighten position size so each symbol can't blow the whole allocation
                    maxPositionPct: Math.min(config.maxPositionPct || 0.10, 0.10),
                });
                const result = await instance.start(sym, preset, stamped.config);
                if (result.success) recordStartedOrContain(sym, preset, stamped.config, instance);
                flushCache(sym);
                results.push({ symbol: sym, status: result.success ? 'started' : 'error', ...result });
                if (!result.success) errors.push(sym);
            } catch (err) {
                results.push({ symbol: sym, status: 'error', error: err.message });
                errors.push(sym);
            }
        }

        const runningSymbols = [..._registry.keys()].filter(k => _registry.get(k).isRunning);
        res.json({
            success: errors.length < symbols.length,
            perSymbolCapital,
            totalCapital,
            results,
            runningSymbols,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch (error) {
        console.error('[Autonomous API] start-portfolio error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/autonomous/registry
 * List all registered symbols and their running state
 */
router.get('/registry', (req, res) => {
    try {
        const entries = [..._registry.entries()].map(([sym, inst]) => ({
            symbol: sym,
            isRunning: inst.isRunning,
            preset: inst.preset,
            paperMode: inst.paperMode,
            startedAt: inst._stats?.sessionStartTime || null,
        }));
        res.json({ success: true, count: entries.length, traders: entries });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── Strategy Hunt routes ─────────────────────────────────────────────────────

router.get('/hunt/state', (req, res) => {
    res.json({ success: true, ...strategyHuntDaemon.getHuntState() });
});

router.post('/hunt/lock', (req, res) => {
    const { strategyId } = req.body || {};
    if (!strategyId) return res.status(400).json({ success: false, error: 'strategyId required' });
    res.json(strategyHuntDaemon.lockProvenStrategy(strategyId));
});

router.post('/hunt/unlock', (req, res) => {
    res.json(strategyHuntDaemon.unlockStrategy());
});

/**
 * WebSocket bridge helpers — read from the registry, not the singleton.
 * The singleton (autonomousTrader default export) is never started; all active
 * traders live in _registry. These exports let websocket.js stay current.
 */
/**
 * Boot auto-start: engage paper trading on the given symbols so the loop survives
 * restarts instead of going dormant (root cause of "no trades since July 20" — the
 * singleton is never started and nothing re-engaged it after a restart). Called
 * from extended.js Phase D once the trading pipeline is loaded.
 */
export async function autoStartTrading(symbols = ['ETH-USD']) {
    const plan = buildQualifiedPaperAutostartPlan({
        selection: currentAutomatedCandidate(),
        requestedSymbols: symbols
    });
    if (!plan.allowed) {
        return plan.requestedSymbols.map(symbol => ({
            symbol,
            started: false,
            skipped: true,
            reason: plan.reason
        }));
    }

    // The reconciler binds the running engine and durable intent to this exact
    // candidate key. It also retires a superseded automated session only after
    // the old one is flat.
    const result = await reconcilePaperCandidateExecution();
    return [{
        symbol: plan.symbol,
        strategyId: plan.strategyId,
        candidateId: plan.candidateId,
        selectedBy: plan.selectedBy,
        started: result?.success === true,
        ...result
    }];
}

export function getAggregateStatus() {
    if (_registry.size === 0) return { success: true, isRunning: false };
    const instances = [..._registry.entries()].map(([sym, inst]) => ({
        symbol: sym, ...inst.getStatus()
    }));
    const primary = instances.find(i => i.isRunning) || instances[0];
    return {
        success: true,
        ...(primary || { isRunning: false }),
        instances,
        runningCount: instances.filter(i => i.isRunning).length,
        runningSymbols: instances.filter(i => i.isRunning).map(i => i.symbol),
    };
}

// Wire aggregate status into the hunt daemon now that getAggregateStatus is defined
strategyHuntDaemon.setAggregateStatusFn(() => tradingMission.state.controlled
    ? { isRunning: false, instances: [] } : getAggregateStatus());

// Hot-apply hunt strategy rotations to engines that are already running
strategyHuntDaemon.setApplyProfileFn((profile) => {
    let applied = 0;
    for (const inst of _registry.values()) {
        if (inst.isRunning) {
            inst.applyRuntimeProfile(profile);
            applied++;
        }
    }
    return applied;
});

export function getHuntState() {
    return strategyHuntDaemon.getHuntState();
}

export function getAggregateDecisions(limit = 30) {
    const all = [];
    for (const [sym, inst] of _registry) {
        inst.getDecisions(limit).forEach(d => all.push({ ...d, symbol: d.symbol || sym }));
    }
    all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return all.slice(0, limit);
}

export default router;
