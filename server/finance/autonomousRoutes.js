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
import { normalizeStrategyId } from './TradingPerformanceGuard.js';
import { selectExecutablePaperCandidate, selectQualifiedOfflinePaperCandidate } from './PaperCandidateSelector.js';

const router = express.Router();

// Registry: symbol (uppercased) → AutonomousTrader instance
const _registry = new Map();
// Shared so PositionGuardian can snapshot SOMA's own paper-engine equity instead
// of the untouched Alpaca account (whose frozen $100k made daily_snapshots useless).
global.SOMA_AUTONOMOUS_REGISTRY = _registry;

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
    try {
        return JSON.parse(fs.readFileSync(INTENT_PATH, 'utf8'));
    } catch { return { engaged: {} }; }
}

function _writeIntent(intent) {
    try {
        fs.mkdirSync(path.dirname(INTENT_PATH), { recursive: true });
        fs.writeFileSync(INTENT_PATH, JSON.stringify(intent, null, 2));
    } catch (e) {
        console.warn('[Autonomous] Failed to persist trading intent:', e.message);
    }
}

function recordEngaged(symbol, preset, config) {
    const intent = _readIntent();
    intent.engaged[symbol] = { preset: preset || null, config: config || {}, engagedAt: new Date().toISOString() };
    _writeIntent(intent);
}

function recordDisengaged(symbol = null) {
    const intent = _readIntent();
    if (symbol) delete intent.engaged[symbol];
    else intent.engaged = {};
    _writeIntent(intent);
}

async function resumeEngagedSessions() {
    const intent = _readIntent();
    const symbols = Object.keys(intent.engaged || {});
    if (symbols.length === 0) return;
    console.log(`[Autonomous] 🔁 Resuming ${symbols.length} engaged trading session(s) from intent file...`);
    for (const sym of symbols) {
        const { preset, config } = intent.engaged[sym];
        if (config?.paperMode !== true) {
            console.warn(`[Autonomous] ⏭ Skipping auto-resume of ${sym} — not explicitly paper mode. Live resume requires a human.`);
            continue;
        }
        if (AUTOMATED_CANDIDATE_SOURCES.has(config?.selectedBy)) {
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
            const result = await instance.start(sym, preset, config);
            console.log(`[Autonomous] ${result.success ? '✅ Resumed' : '❌ Failed to resume'} ${sym}${result.success ? '' : ': ' + (result.error || 'unknown')}`);
            if (result.success) notificationService.sendAlert('🔁 Engine Auto-Resumed', `Paper trading on **${sym}** resumed after server restart`).catch(() => {});
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

/**
 * Keep one exact sim-to-live candidate gathering paper evidence. Previously the
 * queue nominated pairs such as standard_portfolio/TLT while the durable intent
 * kept running full_aggression/ETH, so the candidate could never graduate.
 */
export async function reconcilePaperCandidateExecution() {
    const current = currentAutomatedCandidate();
    const candidate = current?.candidate || null;
    const selectedBy = current?.selectedBy || null;
    if (!candidate) {
        const intent = _readIntent();
        const retired = [];
        const deferred = [];
        for (const [runningSymbol, instance] of _registry.entries()) {
            const engaged = intent.engaged?.[runningSymbol];
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
        return {
            skipped: true,
            reason: deferred.length ? 'no_candidate_waiting_for_flat' : 'no_paper_candidate',
            retired,
            deferred
        };
    }

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
    const config = {
        forcePaper: true,
        paperMode: true,
        strategySelectionMode: 'manual',
        selectedBy,
        selectedStrategyId: strategyId,
        selectedCandidateId: candidate.id || null,
        selectedCandidateKey: candidate.key || null,
        compiledCandidate: selectedBy === 'offline_forward_qualified' ? candidate : null
    };
    const result = await instance.start(symbol, strategyId, config);
    if (!result?.success) return { success: false, symbol, strategyId, error: result?.error || 'start_failed' };
    recordEngaged(symbol, strategyId, config);
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
            inst._onTradeUpdate({ Symbol: sym, Price: tick.price });
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
        const { symbol, preset, config } = req.body;
        if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });

        const resolved = resolveAutonomousStartRequest({ symbol, preset, config: config || {} });
        const sym = resolved.symbol;
        const existing = _registry.get(sym);
        if (existing?.isRunning) {
            return res.status(400).json({ success: false, error: `${sym} is already trading. Stop it first.` });
        }

        const instance = getOrCreateInstance(sym);
        const result = await instance.start(sym, resolved.preset, resolved.config || {});

        if (!result.success) return res.status(400).json(result);
        recordEngaged(sym, resolved.preset, resolved.config || {});
        ensureStreaming();
        notificationService.sendAlert('🟢 Engine Engaged', `Autonomous ${resolved.config?.paperMode ? 'paper ' : ''}trading started on **${sym}** (${resolved.preset || 'auto ladder'})`).catch(() => {});
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
router.post('/stop', (req, res) => {
    try {
        const { symbol } = req.body || {};

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
            if (!instance) return res.status(404).json({ success: false, error: `${sym} not found in registry` });
            const result = instance.stop();
            _registry.delete(sym);
            recordDisengaged(sym);
            notificationService.sendAlert('🔴 Engine Stopped', `Autonomous trading stopped on **${sym}**`, { color: 13632027 }).catch(() => {});
            flushCache(sym);
            return res.json({ ...result, symbol: sym, runningSymbols: [..._registry.keys()].filter(k => _registry.get(k).isRunning) });
        }

        // Stop all
        const stopped = [];
        for (const [sym, instance] of _registry) {
            instance.stop();
            stopped.push(sym);
        }
        _registry.clear();
        recordDisengaged();
        if (stopped.length > 0) notificationService.sendAlert('🔴 Engine Stopped', `Autonomous trading stopped on **${stopped.join(', ')}**`, { color: 13632027 }).catch(() => {});
        flushCache();
        res.json({ success: true, stopped, message: `Stopped ${stopped.length} trader(s)` });
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
            const primaryInstance = instances.find(i => i.isRunning) || instances[0];
            return {
                success: true,
                // Legacy single-trader fields (first running instance) for backward compat
                ...(primaryInstance || { isRunning: false }),
                // Multi-symbol extension
                instances,
                runningCount: instances.filter(i => i.isRunning).length,
                runningSymbols: instances.filter(i => i.isRunning).map(i => i.symbol),
            };
        });
        res.json(body);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
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
 * POST /api/autonomous/start-portfolio
 * Start multiple symbols concurrently with capital split evenly across them.
 * Body: { symbols: ['BTC/USD','ETH/USD','SPY'], preset?, totalCapital?, config? }
 * Already-running symbols are skipped (not restarted).
 */
router.post('/start-portfolio', async (req, res) => {
    try {
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
                const result = await instance.start(sym, preset, {
                    ...config,
                    initialBalance: perSymbolCapital,
                    // Tighten position size so each symbol can't blow the whole allocation
                    maxPositionPct: Math.min(config.maxPositionPct || 0.10, 0.10),
                });
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
    const results = [];
    for (const symbol of symbols) {
        try {
            const resolved = resolveAutonomousStartRequest({ symbol, preset: null, config: { paperMode: true } });
            const sym = resolved.symbol;
            const existing = _registry.get(sym);
            if (existing?.isRunning) { results.push({ symbol: sym, alreadyRunning: true }); continue; }
            const instance = getOrCreateInstance(sym);
            const result = await instance.start(sym, resolved.preset, resolved.config || {});
            if (result?.success) {
                recordEngaged(sym, resolved.preset, resolved.config || {});
                ensureStreaming();
                results.push({ symbol: sym, started: true });
            } else {
                results.push({ symbol: sym, started: false, error: result?.error || 'unknown' });
            }
        } catch (e) {
            results.push({ symbol, started: false, error: e.message });
        }
    }
    return results;
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
strategyHuntDaemon.setAggregateStatusFn(getAggregateStatus);

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
