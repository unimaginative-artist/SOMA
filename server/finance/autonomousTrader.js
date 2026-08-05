/**
 * AutonomousTrader — The Core Trading Brain
 * 
 * Server-side autonomous trading loop that:
 * 1. Fetches market data at configurable intervals
 * 2. Runs SOMA's AI swarm analysis to generate signals
 * 3. Validates signals against guardrails + risk manager
 * 4. Executes approved trades via Alpaca
 * 5. Manages open positions (trailing stop, take-profit)
 * 6. Logs every decision (trade or skip) for full transparency
 */

import alpacaService from './AlpacaService.js';
import marketDataService from './marketDataService.js';
import tradeLogger from './TradeLogger.js';
import trendGuard from './MultiTimeframeTrendGuard.js';
import notificationService from '../services/NotificationService.js';
import { signalLibrary } from './SignalLibrary.js';
import { vwapExecutor } from './VWAPExecutor.js';
import { altDataService } from './AltDataService.js';
import missionControlRuntime from './MissionControlRuntime.js';
import paperExecutionSimulator from './PaperExecutionSimulator.js';
import marketEvidenceStore from './MarketEvidenceStore.js';
import abTestFramework from './ABTestFramework.js';
import calendarGuard from './CalendarGuard.js';
import multiTimeframeFilter from './MultiTimeframeFilter.js';
import correlationGuard from './CorrelationGuard.js';
import optionsIVSignal from './OptionsIVSignal.js';
import tradingPerformanceGuard, { normalizeStrategyId } from './TradingPerformanceGuard.js';
import { assessDecisionDataFreshness, maxDecisionAgeForTimeframe } from './TradingDataFreshness.js';
import { resolveActiveStrategyId, resolvePositionStrategyId } from './TradeAttribution.js';
import { isAuthorizedPaperCandidateSession } from './PaperCandidateSelector.js';
import { evaluateCompiledStrategyDecision } from './CompiledStrategyBacktester.js';
import {
    isAlpacaSpotCrypto,
    regimeAllowed,
    TRADING_ECONOMICS_VERSION
} from './TradingResearchPolicy.js';
import messageBroker from '../../core/MessageBroker.js';
// Flush hook wired by routes.js after both modules load (avoids circular import)
// autonomousTrader → performanceRoutes → scalpingEngine was a potential cycle
let flushPerformanceSummaryCache = () => {};
export function _setPerformanceCacheFlush(fn) { flushPerformanceSummaryCache = fn; }

export { assessDecisionDataFreshness };

class AutonomousTrader {
    constructor() {
        this.isRunning = false;
        this.symbol = null;
        this.preset = null;
        this.config = {
            analysisIntervalMs: 60000,   // Run analysis every 60s
            maxPositionPct: 0.10,        // Max 10% of equity per position
            minConfidence: 0.70,         // Minimum high-probability confidence to trade (up from 0.55)
            maxOpenPositions: 3,         // Max concurrent positions
            cooldownMs: 120000,          // 2 min cooldown between trades on same symbol
            maxSessionDrawdownPct: 0.05, // 5% max session drawdown -> auto-stop
            trailingStopPct: 0.02,       // 2% trailing stop (activates only after +1.5% profit)
            takeProfitPct: 0.05,         // 5% take-profit target
            stopLossPct: 0.015,          // 1.5% stop-loss (3.33:1 Reward-to-Risk ratio)
        };

        this._loopTimer = null;
        this._watchdogTimer = null;
        this._lastTradeTime = new Map(); // symbol -> timestamp

        // Ring buffer for decision log — O(1) insert, bounded memory
        this._decisions = new Array(200);
        this._decisionHead = 0;          // Next write index
        this._decisionCount = 0;         // Total entries written

        this._openPositions = [];        // Tracked positions
        this._positionCacheTime = 0;     // Timestamp of last position sync
        this._positionCacheTTL = 30_000; // 30s TTL for position cache

        this._lastSignal = null;         // Latest signal with agent confidences
        this._lastBlockReason = null;    // Latest reason a trade was blocked (for UI)
        this._runtimeProfile = null;     // Learned Mission Control execution profile
        this._runtimeSessionId = null;   // Lifecycle journal session id
        this._lastStreamPrice = 0;       // Real-time price from WebSocket
        this._positionHighWater = new Map(); // symbol → peak pnlPct for trailing stop
        this._currentInterval = 0;       // Active cycle interval (adaptive)
        this._analysisTimeoutMs = 15_000; // 15s timeout for AI analysis
        this._signalScoresAtEntry = new Map(); // symbol → signal scores at open (for adaptive learning)
        this._abTestArmAtEntry = new Map();   // symbol → { arm } for A/B outcome tracking
        this._lastKnownRegime = null;          // persists regime across cycles for UCB1 feedback

        // Paper trading mode (active when Alpaca not connected)
        this.paperMode = false;
        this._paperPortfolio = null; // { balance, positions: {symbol: {side,qty,entryPrice}}, trades: [] }
        this._stats = {
            totalDecisions: 0,
            tradesExecuted: 0,
            tradesSkipped: 0,
            signalsBuy: 0,
            signalsSell: 0,
            signalsHold: 0,
            errors: 0,
            lastAnalysisTime: null,
            lastTradeTime: null,
            sessionPnL: 0,
            sessionStartTime: null,
            wins: 0,
            losses: 0,
            grossWins: 0,
            grossLosses: 0,
        };
        this._recentTrades = []; // rolling 20-trade buffer for alpha decay detection
        this._lastSignalBreakdown = null; // full per-signal scores from last SignalLibrary run
        this._activeTradeConfig = {  // ATR-based dynamic stops, updated each cycle
            stopLossPct: 0.02,
            takeProfitPct: 0.06,
            trailingStopPct: 0.03,
        };
        this._performanceGuardVerdict = null;
        this._lastCompiledDecisionBar = null;
    }

    /**
     * Start the autonomous trading loop
     */
    async start(symbol, preset = null, config = {}) {
        if (this.isRunning) {
            return { success: false, error: 'Already running. Stop first.' };
        }

        const forcePaper = config?.forcePaper === true || config?.paperMode === true;
        let brokerConnected = !!alpacaService.isConnected && !forcePaper;

        // If not connected but credentials exist, try to connect now (fixes startup race condition
        // where _autoConnect fires async and hasn't finished by the time the user hits Run)
        if (!brokerConnected && !forcePaper) {
            const savedCreds = alpacaService.loadCredentials();
            if (savedCreds?.apiKey && savedCreds?.apiSecret) {
                try {
                    console.log('[AutonomousTrader] Alpaca not connected but credentials exist — attempting connect...');
                    await alpacaService.connect(savedCreds.apiKey, savedCreds.apiSecret, savedCreds.paperTrading, false);
                    brokerConnected = true;
                    console.log('[AutonomousTrader] ✅ Pre-start Alpaca connect succeeded');
                } catch (e) {
                    console.warn('[AutonomousTrader] Pre-start connect failed, falling back to paper:', e.message);
                }
            }
        }

        if (!brokerConnected) {
            this.paperMode = true;
            this._paperPortfolio = { balance: 100000, positions: {}, trades: [] };
            console.log(forcePaper
                ? '[AutonomousTrader] 📄 Mission Control requested PAPER MODE'
                : '[AutonomousTrader] 📄 Alpaca not connected — starting in PAPER MODE ($100k virtual)');
        } else {
            this.paperMode = false;
            this._paperPortfolio = null;
        }

        this.symbol = symbol;
        this.preset = preset;
        this.config = { ...this.config, ...config };

        // Apply preset-specific config overrides
        const PRESET_CONFIGS = {
            'BALANCED':            { minConfidence: 0.60, maxPositionPct: 0.10, takeProfitPct: 0.06, stopLossPct: 0.02, cooldownMs: 120000 },
            'YOLO':                { minConfidence: 0.45, maxPositionPct: 0.30, takeProfitPct: 0.15, stopLossPct: 0.05, cooldownMs: 60000 },
            'MICRO':               { minConfidence: 0.55, maxPositionPct: 0.05, takeProfitPct: 0.02, stopLossPct: 0.01, analysisIntervalMs: 30000 },
            'MICRO_CHALLENGE':     { minConfidence: 0.55, maxPositionPct: 0.05, takeProfitPct: 0.02, stopLossPct: 0.01, analysisIntervalMs: 30000 },
            'CONSERVATIVE':        { minConfidence: 0.80, maxPositionPct: 0.05, takeProfitPct: 0.04, stopLossPct: 0.01, cooldownMs: 300000 },
            'HIGH_PROBABILITY':    { minConfidence: 0.85, maxPositionPct: 0.05, takeProfitPct: 0.05, stopLossPct: 0.01, cooldownMs: 300000 },
            'BTC_NATIVE':          { minConfidence: 0.75, maxPositionPct: 0.15, takeProfitPct: 0.08, stopLossPct: 0.03, cooldownMs: 180000 },
            'STOCKS_EARNINGS':     { minConfidence: 0.70, maxPositionPct: 0.08, takeProfitPct: 0.10, stopLossPct: 0.03, cooldownMs: 240000 },
            'STOCKS_SWING':        { minConfidence: 0.65, maxPositionPct: 0.10, takeProfitPct: 0.08, stopLossPct: 0.02, analysisIntervalMs: 300000 },
            'STOCKS_MEME':         { minConfidence: 0.50, maxPositionPct: 0.05, takeProfitPct: 0.20, stopLossPct: 0.05, cooldownMs: 60000 },
            'FUTURES_GRID':        { minConfidence: 0.55, maxPositionPct: 0.10, takeProfitPct: 0.03, stopLossPct: 0.01, analysisIntervalMs: 30000 },
            'FUTURES_PERP':        { minConfidence: 0.60, maxPositionPct: 0.12, takeProfitPct: 0.05, stopLossPct: 0.02, cooldownMs: 90000 },
            'FUTURES_ES':          { minConfidence: 0.65, maxPositionPct: 0.08, takeProfitPct: 0.04, stopLossPct: 0.01, analysisIntervalMs: 60000 },
            'FUTURES_COMMODITIES': { minConfidence: 0.65, maxPositionPct: 0.08, takeProfitPct: 0.05, stopLossPct: 0.02, cooldownMs: 180000 },
        };
        if (preset && PRESET_CONFIGS[preset]) {
            this.config = { ...this.config, ...PRESET_CONFIGS[preset] };
            console.log(`[AutonomousTrader] 🎛️ Preset "${preset}" applied:`, PRESET_CONFIGS[preset]);
        }

        const runtimeStatus = missionControlRuntime.getStatus?.() || {};
        const runtimeSelectionMode = String(config?.strategySelectionMode || runtimeStatus.strategySelectionMode || 'auto').toLowerCase();
        this.strategySelectionMode = runtimeSelectionMode;
        
        // BUGFIX: Only leak the active strategy if the symbol matches!
        const activeStrategy = runtimeStatus.activeStrategy;
        const activeSymbol = activeStrategy?.symbol ? String(activeStrategy.symbol).toUpperCase() : null;
        const normSym = String(symbol || '').toUpperCase();
        const symbolMatches = activeSymbol && (normSym === activeSymbol || normSym.startsWith(activeSymbol));
        const runtimeStrategyId = symbolMatches ? activeStrategy.strategyId : null;

        const selectedPreset = runtimeSelectionMode === 'auto'
            ? (runtimeStrategyId || missionControlRuntime.selectTradingStrategy(null, symbol))
            : (preset || runtimeStrategyId || missionControlRuntime.selectTradingStrategy(null, symbol));

        const startupGuard = tradingPerformanceGuard.evaluate({
            symbol,
            strategyId: selectedPreset || this.config.strategyId || 'standard_portfolio',
            since: null
        });
        this._performanceGuardVerdict = startupGuard;
        // Paper is the learning sandbox: quarantine is advisory there (the verdict is
        // still recorded for UCB1/learning), and only hard-blocks real-money sessions.
        // A hard paper block deadlocks: pair stats can never improve while trading is off.
        const paperIntent = config.paperMode === true || config.forcePaper === true
            || (runtimeStatus.activeTier || 'paper') === 'paper';
        if (!startupGuard.allowed && !config.allowQuarantinedStrategy && !paperIntent) {
            return {
                success: false,
                error: `Trading blocked by performance guard: ${startupGuard.reasons.join('; ')}`,
                performanceGuard: startupGuard
            };
        }
        if (!startupGuard.allowed && paperIntent) {
            console.warn(`[AutonomousTrader] ⚠️ Performance guard quarantine (advisory in paper): ${startupGuard.reasons.join('; ')}`);
        }

        // Let Mission Control choose the current sim-to-live strategy unless a
        // human explicitly supplied a manual preset override.
        const ucbPreset = selectedPreset;
        this._runtimeProfile = missionControlRuntime.getActiveExecutionProfile({
            symbol,
            preset: ucbPreset,
            baseConfig: this.config
        });
        if (!preset && ucbPreset) {
            console.log(`[AutonomousTrader] UCB1 selected strategy: ${ucbPreset}`);
        }
        this.config = { ...this.config, ...this._runtimeProfile.config };
        global.SOMA_TRADING?.guardrails?.applyTierProfile?.(this.config);

        if (brokerConnected && !this._runtimeProfile.liveTradingEnabled) {
            this.paperMode = true;
            this._paperPortfolio = {
                balance: this._runtimeProfile.paperCapital || 1000,
                initialBalance: this._runtimeProfile.paperCapital || 1000,
                positions: {},
                trades: []
            };
            console.warn(`[AutonomousTrader] 🔒 Broker connected, but tier ${this._runtimeProfile.activeTier} is not live-enabled. Forcing PAPER MODE.`);
        }
        if (this.paperMode && this._paperPortfolio) {
            // config.initialBalance overrides runtime profile (used by portfolio multi-symbol splits)
            const paperCap = this.config.initialBalance || this._runtimeProfile.paperCapital || 1000;
            this._paperPortfolio.balance = paperCap;
            this._paperPortfolio.initialBalance = paperCap;

            // Restore any open paper positions from SQLite for this symbol
            try {
                const activeStrategyId = this._getActiveStrategyId();
                const belongsToSession = trade => trade.symbol === symbol
                    && normalizeStrategyId(resolvePositionStrategyId(trade)) === activeStrategyId;
                const openTrades = tradeLogger.getOpenTrades().filter(belongsToSession);
                const closedTrades = tradeLogger.getClosedTrades().filter(belongsToSession);
                const totalRealizedPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
                
                // Adjust virtual cash balance based on closed trades PnL
                this._paperPortfolio.balance += totalRealizedPnL;
                // Restore the authoritative strategy ledger into runtime status.
                // Otherwise a restart truthfully restores cash but misleadingly
                // reports zero historical trades and zero wins/losses. Session
                // P&L intentionally resets when a new process session begins.
                this._paperPortfolio.trades = [...closedTrades, ...openTrades].map(t => ({
                    tradeId: t.id,
                    symbol: t.symbol,
                    side: t.side,
                    qty: t.qty,
                    price: t.entry_price,
                    fee: Number(t.entry_fee || 0),
                    pnl: t.pnl,
                    status: t.status,
                    timestamp: t.entry_time ? new Date(t.entry_time).getTime() : null
                }));
                this._stats.tradesExecuted = closedTrades.length + openTrades.length;
                this._stats.wins = closedTrades.filter(t => Number(t.pnl) > 0).length;
                this._stats.losses = closedTrades.filter(t => Number(t.pnl) <= 0).length;
                this._stats.grossWins = closedTrades.reduce((sum, t) => sum + Math.max(0, Number(t.pnl) || 0), 0);
                this._stats.grossLosses = closedTrades.reduce((sum, t) => sum + Math.max(0, -(Number(t.pnl) || 0)), 0);
                this._recentTrades = closedTrades.slice(-20).map(t => ({
                    pnl: Number(t.pnl) || 0,
                    isWin: Number(t.pnl) > 0,
                    ts: t.exit_time ? new Date(t.exit_time).getTime() : Date.now()
                }));
                const latestTradeTime = [...closedTrades, ...openTrades]
                    .map(t => new Date(t.exit_time || t.entry_time || 0).getTime())
                    .filter(Number.isFinite)
                    .reduce((latest, value) => Math.max(latest, value), 0);
                this._stats.lastTradeTime = latestTradeTime || null;
                
                for (const t of openTrades) {
                    const posSide = (t.side === 'buy' || t.side === 'long') ? 'long' : 'short';
                    this._paperPortfolio.positions[t.symbol] = {
                        side: posSide,
                        qty: t.qty,
                        entryPrice: t.entry_price,
                        tradeId: t.id,
                        fees: Number(t.entry_fee || 0),
                        openedAt: t.entry_time ? new Date(t.entry_time).getTime() : Date.now(),
                        regime: t.regime || null,
                        attribution: {
                            strategyId: normalizeStrategyId(t.strategy),
                            strategySource: 'sqlite_restore',
                            runtimeSymbol: t.symbol,
                            selectedAt: t.entry_time || null
                        }
                    };
                    // Mirror _executePaperTrade cash flow: longs consumed cash at
                    // entry, shorts credited proceeds — so the eventual close reconciles.
                    if (posSide === 'long') {
                        this._paperPortfolio.balance -= (t.qty * t.entry_price) + Number(t.entry_fee || 0);
                    } else {
                        this._paperPortfolio.balance += (t.qty * t.entry_price) - Number(t.entry_fee || 0);
                    }
                    
                }
                
                if (openTrades.length > 0) {
                    console.log(`[AutonomousTrader] 📄 Restored ${openTrades.length} open paper position(s) for ${symbol}. Adjusted Virtual Cash Balance: $${this._paperPortfolio.balance.toFixed(2)}`);
                    this._logDecision('SYSTEM', 'RESTORE', `Restored ${openTrades.length} open paper position(s) from database`, {
                        openTrades
                    });
                }
            } catch (err) {
                console.warn(`[AutonomousTrader] ⚠️ Failed to restore open paper positions for ${symbol}:`, err.message);
            }
        }
        this._runtimeSessionId = missionControlRuntime.startSession({
            symbol,
            preset: preset || 'SOMA_LEARNED',
            config: this.config
        });

        this.isRunning = true;
        this._stats.sessionStartTime = Date.now();
        this._stats.sessionPnL = 0;
        global.__SOMA_TRADING_ACTIVE = true; // Signal to background tasks to yield Gemini quota

        this._logDecision('SYSTEM', 'START', `Autonomous trading started for ${symbol}`, {
            preset, config: this.config, runtime: this._runtimeProfile
        });

        console.log(`[AutonomousTrader] 🚀 Started for ${symbol} (interval: ${this.config.analysisIntervalMs}ms)`);

        // Subscribe to Alpaca stream for real-time exit signals + live price tick broadcasting
        if (alpacaService.isConnected) {
            try {
                alpacaService.connectStream(
                    [symbol],
                    (trade) => this._onTradeUpdate(trade),
                    (quote) => {
                        const bid = quote.BidPrice || quote.bp || 0;
                        const ask = quote.AskPrice || quote.ap || 0;
                        const mid = bid && ask ? (bid + ask) / 2 : bid || ask;
                        if (mid > 0) {
                            this._lastStreamPrice = mid;
                            try { messageBroker.publish('market.price_tick', { symbol, price: mid }); } catch {}
                        }
                    }
                );
                console.log(`[AutonomousTrader] 📡 Subscribed to ${this.paperMode ? 'paper' : 'live'} Alpaca quote stream for ${symbol}`);
            } catch (streamErr) {
                console.warn('[AutonomousTrader] Stream connection failed:', streamErr.message);
            }
        }

        // Adaptive cycle: recursive setTimeout so interval can shrink/grow after each cycle
        this._currentInterval = this.config.analysisIntervalMs;
        const scheduleNext = () => {
            if (!this.isRunning) return;
            this._loopTimer = setTimeout(() => {
                this._runCycle()
                    .catch(err => {
                        console.error('[AutonomousTrader] Cycle error:', err.message);
                        this._stats.errors++;
                    })
                    .finally(() => scheduleNext());
            }, this._currentInterval);
        };

        // Fire first cycle immediately (don't await — return to caller fast)
        this._runCycle().catch(err => {
            console.error('[AutonomousTrader] First cycle error (non-fatal):', err.message);
            this._stats.errors++;
        }).finally(() => scheduleNext());

        // Watchdog: detect stalled trading loop
        this._watchdogTimer = setInterval(() => {
            this._checkHeartbeat();
        }, this.config.analysisIntervalMs * 2);

        return { success: true, symbol, config: this.config, runtime: this._runtimeProfile };
    }

    /**
     * Stop the autonomous trading loop
     */
    stop() {
        if (!this.isRunning) return { success: false, error: 'Not running.' };

        clearTimeout(this._loopTimer);
        clearInterval(this._watchdogTimer);
        this._loopTimer = null;
        this._watchdogTimer = null;
        this.isRunning = false;
        global.__SOMA_TRADING_ACTIVE = false;

        // Unsubscribe from stream
        if (this.symbol) {
            try {
                alpacaService.unsubscribe([this.symbol]);
            } catch (e) { /* ignore */ }
        }

        this._logDecision('SYSTEM', 'STOP', `Autonomous trading stopped. ${this._stats.tradesExecuted} trades executed.`, {
            stats: { ...this._stats }
        });

        console.log(`[AutonomousTrader] ⏹️ Stopped. Trades: ${this._stats.tradesExecuted}, Skipped: ${this._stats.tradesSkipped}`);

        return { success: true, stats: this.getStatus() };
    }

    /**
     * Handle real-time trade updates from WebSocket
     */
    _onTradeUpdate(trade) {
        if (!this.isRunning || trade.Symbol !== this.symbol) return;

        const price = trade.Price;
        this._lastStreamPrice = price;

        // Check if we have an open position to manage
        const position = this._openPositions.find(p => p.symbol === this.symbol);
        if (position) {
            // Recalculate PnL locally for instant trigger
            const entry = position.entryPrice;
            const isLong = position.side === 'long';
            const rawPnl = isLong ? (price - entry) * position.qty : (entry - price) * position.qty;
            const pnlPct = (rawPnl / (entry * position.qty)) * 100;

            // Mock position object with updated real-time stats
            const realtimePos = {
                ...position,
                currentPrice: price,
                unrealizedPnl: rawPnl,
                unrealizedPnlPct: pnlPct
            };

            // Check triggers (silent unless triggered)
            if (pnlPct >= this.config.takeProfitPct * 100 || pnlPct <= -this.config.stopLossPct * 100) {
                // If trigger hit, fire manage logic immediately
                this._managePosition(realtimePos, price).catch(e =>
                    console.error('[AutonomousTrader] Real-time exit failed:', e.message)
                );
            }
        }
    }

    /**
     * Core trading cycle — runs once per interval
     */
    async _runCycle() {
        if (!this.isRunning || !this.symbol) return;

        // Yield immediately so pending HTTP requests can be processed before we start
        await new Promise(resolve => setImmediate(resolve));

        const cycleStart = Date.now();
        let signal = null;
        let analysis = null;

        try {
            // 1. Check connection & Session Circuit Breaker
            if (!alpacaService.isConnected && !this.paperMode) {
                this._logDecision('SYSTEM', 'SKIP', 'Alpaca disconnected — skipping cycle');
                return;
            }

            // Check session drawdown
            if (this._stats.sessionStartTime) {
                const startingEquity = this.paperMode
                    ? (this._paperPortfolio?.initialBalance || this.config.initialBalance || 10000)
                    : (alpacaService.accountInfo ? parseFloat(alpacaService.accountInfo.last_equity) : 0);
                if (startingEquity > 0) {
                    const drawdownPct = (this._stats.sessionPnL / startingEquity);
                    if (drawdownPct <= -this.config.maxSessionDrawdownPct) {
                        this._logDecision('RISK', 'CRITICAL_STOP', `Session drawdown ${drawdownPct*100}% exceeds limit ${this.config.maxSessionDrawdownPct*100}%`);
                        console.error(`[AutonomousTrader] 🛑 CRITICAL: Session drawdown limit hit. Stopping.`);
                        this.stop();
                        return;
                    }
                }
            }

            // 2. Parallel Fetch: Market Data + Positions + Regime
            const timeframe = this.config.timeframe || '5Min';
            const [barsResult, positionsResult, regimeResult] = await Promise.allSettled([
                marketDataService.getBars(this.symbol, timeframe, 100),
                this._syncPositions(),
                this._getRegime()
            ]);

            // Handle Market Data
            if (barsResult.status === 'rejected') {
                 this._logDecision('DATA', 'SKIP', `Market data unavailable: ${barsResult.reason.message}`);
                 this._stats.errors++;
                 return;
            }
            const bars = barsResult.value;

            // Handle Regime (optional, safe default)
            const currentRegime = regimeResult.status === 'fulfilled' ? regimeResult.value : null;
            if (currentRegime) this._lastKnownRegime = currentRegime;

            const timeframeMaxAgeMs = Number(
                this.config.maxDecisionDataAgeMs
                || maxDecisionAgeForTimeframe(timeframe)
            );
            const quality = marketDataService.validateDataQuality(bars, timeframeMaxAgeMs);

            if (!quality.valid) {
                this._logDecision('DATA', 'SKIP', `Data quality check failed: ${quality.issues.join('; ')}`, { quality });
                this._recordRuntimeLifecycle('data_quality', 'blocked', { quality });
                return;
            }

            // Warn when making decisions on stale/cached data
            const hasCachedBars = bars.some(b => b.isCached);
            const freshness = assessDecisionDataFreshness(bars, {
                maxAgeMs: timeframeMaxAgeMs
            });
            if (hasCachedBars) {
                console.warn(`[AutonomousTrader] ⚠️ Cached market data is ${Math.round(freshness.ageMs / 1000)}s old for ${this.symbol}`);
            }

            const latestBar = bars[bars.length - 1];
            const currentPrice = latestBar.close;
            this._adjustInterval(bars); // shorten in high volatility, lengthen when flat
            // Update dynamic stop/target config from current ATR + regime (used by _managePosition)
            const atrPct = this._computeATR(bars);
            const compiledExit = this.config.compiledCandidate?.compiledStrategy?.dsl?.exit;
            this._activeTradeConfig = compiledExit ? {
                stopLossPct: Number(compiledExit.stopLossPct),
                takeProfitPct: Number(compiledExit.takeProfitPct),
                trailingStopPct: Number(compiledExit.trailingStopPct)
            } : this._getRegimeConfig(currentRegime || this._lastKnownRegime, atrPct);
            this._recordRuntimeLifecycle('data_quality', 'passed', {
                bars: bars.length,
                price: currentPrice,
                cached: hasCachedBars,
                regime: currentRegime
            });

            // 3. Find existing position (already synced in parallel step)
            const existingPosition = this._openPositions.find(p => p.symbol === this.symbol);

            // Dynamic strategy selection for auto mode when there is no active position
            if (!existingPosition && this.strategySelectionMode === 'auto') {
                const regimeToUse = currentRegime || this._lastKnownRegime;
                const updatedStrategyId = missionControlRuntime.selectTradingStrategy(regimeToUse, this.symbol);
                if (updatedStrategyId && updatedStrategyId !== this._getActiveStrategyId()) {
                    console.log(`[AutonomousTrader] 🔄 Regime shifted to ${regimeToUse} — Switching strategy from ${this._getActiveStrategyId()} to ${updatedStrategyId}`);
                    this._runtimeProfile = missionControlRuntime.getActiveExecutionProfile({
                        symbol: this.symbol,
                        preset: updatedStrategyId,
                        baseConfig: this.config
                    });
                    this.config = { ...this.config, ...this._runtimeProfile.config };
                    global.SOMA_TRADING?.guardrails?.applyTierProfile?.(this.config);
                }
            }

            // 4. Manage existing position (trailing stop / take-profit)
            if (existingPosition) {
                const managed = await this._managePosition(existingPosition, currentPrice);
                if (managed) return; // Position was closed, skip new analysis
            }

            // A reconciler-selected paper session loses entry authority as soon
            // as its candidate disappears. Existing positions may still be
            // managed and closed, but a rejected synthetic winner cannot reopen
            // while the five-minute retirement loop catches up.
            if (!existingPosition && !isAuthorizedPaperCandidateSession({
                config: this.config,
                activeStrategy: missionControlRuntime.getStatus?.().activeStrategy || null,
                symbol: this.symbol,
                strategyId: this._getActiveStrategyId()
            })) {
                this._lastBlockReason = 'Paper candidate is no longer authorized by sim-to-live reconciliation';
                this._stats.tradesSkipped++;
                this._stats.totalDecisions++;
                this._logDecision('CANDIDATE_AUTH', 'BLOCKED', this._lastBlockReason, {
                    symbol: this.symbol,
                    strategyId: this._getActiveStrategyId(),
                    selectedCandidateKey: this.config.selectedCandidateKey || null
                });
                this._recordRuntimeLifecycle('candidate_authorization', 'blocked', {
                    reason: this._lastBlockReason
                });
                return;
            }

            // Cached bars remain usable for conservatively managing an existing
            // position, but stale prices must never seed a new market entry.
            if (!existingPosition && !freshness.validForEntry) {
                this._logDecision(
                    'DATA',
                    'SKIP',
                    `Market data is too old for entry (${Math.round(freshness.ageMs / 1000)}s; max ${Math.round(freshness.maxAgeMs / 1000)}s)`,
                    { freshness }
                );
                this._recordRuntimeLifecycle('data_freshness', 'blocked', { freshness });
                return;
            }

            // 5. Run AI analysis — fast path first, heavy path as fallback
            const compiledCandidate = this.config.compiledCandidate || null;
            if (compiledCandidate) {
                signal = evaluateCompiledStrategyDecision({ bars, candidate: compiledCandidate, position: existingPosition });
                this._lastSignal = signal;
                this._lastSignalBreakdown = signal.metadata || null;
                const executionBar = Number(signal.metadata?.executionBar);
                const executionBarAge = Number.isFinite(executionBar) ? Date.now() - executionBar : 0;
                if (signal.action !== 'HOLD' && executionBarAge > 15 * 60_000) {
                    signal = {
                        ...signal,
                        action: 'HOLD',
                        recommendation: 'HOLD',
                        reason: `Compiled signal arrived outside the next-bar execution window (${Math.round(executionBarAge / 60000)}m old)`
                    };
                }
                if (signal.action !== 'HOLD' && signal.metadata?.executionBar === this._lastCompiledDecisionBar) {
                    signal = { ...signal, action: 'HOLD', recommendation: 'HOLD', reason: 'Compiled signal already processed for this execution bar' };
                } else if (signal.action !== 'HOLD') {
                    this._lastCompiledDecisionBar = signal.metadata?.executionBar ?? null;
                }
                analysis = {
                    strategy: { recommendation: signal.action, confidence: signal.confidence, thesis: signal.reason },
                    risk: { score: 50, assessment: 'compiled paper canary' },
                    sentiment: { score: 0.5 },
                    quant: { strategy: 'CompiledStrategyDSL', signals: signal.metadata }
                };
            } else {
                analysis = await this._getFastAnalysis(this.symbol, bars, currentPrice);
            }

            if (!analysis) {
                this._logDecision('ANALYSIS', 'SKIP', 'AI analysis unavailable or rate-limited');
                this._recordRuntimeLifecycle('analysis', 'blocked', { reason: 'analysis_unavailable' });
                return;
            }
            this._recordRuntimeLifecycle('analysis', 'completed', {
                recommendation: analysis.strategy?.recommendation,
                confidence: analysis.strategy?.confidence,
                risk: analysis.risk?.score,
                sentiment: analysis.sentiment?.score
            });

            // 6. Generate signal (Regime-Aware)
            if (!compiledCandidate) signal = this._generateSignal(analysis, currentPrice, bars, currentRegime);

            // A compiled paper candidate has authority only inside the exact
            // economic/venue/segment contract that qualified it offline.
            if (compiledCandidate && !existingPosition && signal.action !== 'HOLD') {
                const compiled = compiledCandidate.compiledStrategy || {};
                const dsl = compiled.dsl || {};
                const economicsVersion = compiledCandidate.economicsVersion || compiled.economicsVersion;
                const allowedRegimes = dsl.entry?.allowedRegimes || ['ALL'];
                const executionStyle = dsl.execution?.style || 'taker_market';
                let segmentBlock = null;
                if (economicsVersion !== TRADING_ECONOMICS_VERSION) {
                    segmentBlock = `Candidate economics ${economicsVersion || 'missing'} is stale`;
                } else if (executionStyle !== 'taker_market') {
                    segmentBlock = `Execution style ${executionStyle} lacks a durable runtime order lifecycle`;
                } else if (isAlpacaSpotCrypto(this.symbol) && signal.action === 'SELL') {
                    segmentBlock = 'Alpaca spot crypto is long-only; short entry rejected';
                } else if (!regimeAllowed(currentRegime || this._lastKnownRegime, allowedRegimes)) {
                    segmentBlock = `Regime ${currentRegime || this._lastKnownRegime || 'UNKNOWN'} is outside ${allowedRegimes.join(',')}`;
                }
                if (segmentBlock) {
                    signal = { ...signal, action: 'HOLD', recommendation: 'HOLD', reason: segmentBlock };
                    this._recordRuntimeLifecycle('candidate_segment', 'blocked', {
                        reason: segmentBlock,
                        economicsVersion,
                        executionStyle,
                        allowedRegimes,
                        currentRegime
                    });
                }
            }
            this._recordRuntimeLifecycle('signal', signal.action === 'HOLD' ? 'held' : 'candidate', {
                action: signal.action,
                confidence: signal.confidence,
                recommendation: signal.recommendation,
                agents: signal.agents,
                runtime: signal.runtime
            });

            // 6.5. Multi-timeframe confirmation — skip in RANGING regime (mean-reversion context)
            // In RANGING, bearish higher-TF just means "near bottom of range" — that IS the trade.
            // MTF is anti-trend logic; irrelevant when there's no trend.
            const isRanging = currentRegime === 'RANGING' || currentRegime?.includes?.('RANGING');
            if (signal.action !== 'HOLD' && !isRanging && !compiledCandidate) {
                try {
                    const mtf = await multiTimeframeFilter.confirmSignal(this.symbol, signal.action, timeframe);
                    if (!mtf.confirmed) {
                        this._stats.signalsHold++;
                        this._stats.totalDecisions++;
                        this._logDecision('MTF', 'HOLD', `Higher timeframes disagree: ${mtf.reason}`, {
                            votes: mtf.votes, signal: signal.action, confidence: signal.confidence
                        });
                        return;
                    }
                } catch (mtfErr) {
                    console.warn('[AutonomousTrader] MTF check failed (non-fatal):', mtfErr.message);
                    // Continue without MTF if data unavailable — don't block trading
                }
            }

            // 7. Act on signal
            if (signal.action === 'HOLD') {
                this._stats.signalsHold++;
                this._stats.totalDecisions++;
                this._logDecision('SIGNAL', 'HOLD', signal.reason, {
                    confidence: signal.confidence,
                    price: currentPrice
                });
                return;
            }

            // 7b. Multi-Timeframe Trend Guard (Alpha Sentinel): EMA 20/50 alignment.
            // Blocks counter-trend / chop entries — this is the filter that backtested
            // at 66.7% WR. Applied to every live BUY/SELL entry. Non-fatal on data gaps.
            try {
                const tg = trendGuard.validateTrendAlignment(bars, signal.action);
                if (!tg.allowed) {
                    this._stats.signalsHold++;
                    this._stats.totalDecisions++;
                    this._logDecision('TREND_GUARD', 'BLOCK', tg.reason, {
                        signal: signal.action, confidence: signal.confidence, price: currentPrice
                    });
                    return;
                }
            } catch (tgErr) {
                console.warn('[AutonomousTrader] Trend guard failed (non-fatal):', tgErr.message);
            }

            // 8. Check cooldown
            const lastTrade = this._lastTradeTime.get(this.symbol) || 0;
            if (Date.now() - lastTrade < this.config.cooldownMs) {
                const remaining = Math.round((this.config.cooldownMs - (Date.now() - lastTrade)) / 1000);
                this._logDecision('COOLDOWN', 'SKIP', `Trade cooldown active (${remaining}s remaining)`, {
                    signal: signal.action
                });
                return;
            }

            // 9. Check max open positions
            if (!existingPosition && this._openPositions.length >= this.config.maxOpenPositions) {
                this._logDecision('RISK', 'SKIP', `Max open positions (${this.config.maxOpenPositions}) reached`, {
                    signal: signal.action
                });
                return;
            }

            // 10. Don't open a new position in the same direction as existing
            if (existingPosition) {
                const sameSide = (signal.action === 'BUY' && existingPosition.side === 'long') ||
                                 (signal.action === 'SELL' && existingPosition.side === 'short');
                if (sameSide) {
                    this._logDecision('SIGNAL', 'HOLD', `Already have ${existingPosition.side} position — not adding`, {
                        signal: signal.action, existingQty: existingPosition.qty
                    });
                    return;
                }
            }

            // 11. Calculate position size (Kelly + Alpha-Decay + Regime-Aware)
            const performanceGuard = tradingPerformanceGuard.evaluate({
                symbol: this.symbol,
                strategyId: this._getActiveStrategyId(),
                since: missionControlRuntime.getEvidenceWindow?.() || null
            });
            this._performanceGuardVerdict = performanceGuard;
            if (!performanceGuard.allowed && !this.config.allowQuarantinedStrategy && !this.paperMode) {
                this._lastBlockReason = `Performance guard quarantined ${performanceGuard.strategyId}/${this.symbol}: ${performanceGuard.reasons.join('; ')}`;
                this._stats.tradesSkipped++;
                this._stats.totalDecisions++;
                this._logDecision('PERFORMANCE_GUARD', 'BLOCKED', this._lastBlockReason, performanceGuard);
                this._recordRuntimeLifecycle('performance_guard', 'blocked', performanceGuard);
                return;
            }
            if (!performanceGuard.allowed && this.paperMode) {
                // Auto mode must learn by rotating to another strategy, not by
                // repeatedly funding a pair whose paper evidence already failed.
                // Existing positions may still exit; this gate applies only to entries.
                if (!existingPosition && this.strategySelectionMode === 'auto' && !this.config.allowQuarantinedStrategy) {
                    const currentStrategyId = this._getActiveStrategyId();
                    const replacement = missionControlRuntime.selectTradingStrategy(currentRegime, this.symbol);
                    if (replacement && normalizeStrategyId(replacement) !== currentStrategyId) {
                        const profile = missionControlRuntime.getActiveExecutionProfile({
                            symbol: this.symbol,
                            preset: replacement,
                            baseConfig: this.config
                        });
                        this.applyRuntimeProfile(profile);
                        this._lastBlockReason = `Rotated ${currentStrategyId} to ${replacement}: ${performanceGuard.reasons.join('; ')}`;
                        this._logDecision('PERFORMANCE_GUARD', 'ROTATE', this._lastBlockReason, { performanceGuard, replacement });
                        this._recordRuntimeLifecycle('performance_guard', 'rotated', { performanceGuard, replacement });
                    } else {
                        this._lastBlockReason = `Paper entry restricted: ${performanceGuard.reasons.join('; ')}`;
                        this._logDecision('PERFORMANCE_GUARD', 'BLOCKED', this._lastBlockReason, performanceGuard);
                        this._recordRuntimeLifecycle('performance_guard', 'blocked', performanceGuard);
                    }
                    this._stats.tradesSkipped++;
                    this._stats.totalDecisions++;
                    return;
                }
                this._logDecision('PERFORMANCE_GUARD', 'ADVISORY', `Paper evidence warning: ${performanceGuard.reasons.join('; ')}`, performanceGuard);
                this._recordRuntimeLifecycle('performance_guard', 'advisory', performanceGuard);
            }

            // 11. Calculate position size (Kelly + Alpha-Decay + Regime-Aware)
            const sizing = signal.closeOnly && existingPosition
                ? { qty: Number(existingPosition.qty), value: Number(existingPosition.qty) * currentPrice, closeOnly: true }
                : await this._calculatePositionSize(currentPrice, currentRegime, signal.confidence);
            if (!sizing || sizing.qty <= 0) {
                this._logDecision('SIZING', 'SKIP', 'Position size too small or account insufficient', { sizing });
                this._recordRuntimeLifecycle('sizing', 'blocked', { sizing });
                return;
            }
            this._recordRuntimeLifecycle('sizing', 'approved', { sizing, price: currentPrice });

            // 12. Validate against guardrails
            const guardrails = global.SOMA_TRADING?.guardrails;
            if (guardrails) {
                const guardrailResult = guardrails.validateTrade(
                    { symbol: this.symbol, side: signal.action.toLowerCase(), qty: sizing.qty, value: sizing.qty * currentPrice },
                    { strategy: { confidence: signal.confidence } },
                    alpacaService.accountInfo || null
                );
                if (!guardrailResult.allowed) {
                    this._logDecision('GUARDRAIL', 'BLOCKED', `Guardrail: ${guardrailResult.reason}`, {
                        signal: signal.action, checks: guardrailResult.checks
                    });
                    this._recordRuntimeLifecycle('guardrail', 'blocked', {
                        signal: signal.action,
                        reason: guardrailResult.reason,
                        checks: guardrailResult.checks
                    });
                    return;
                }
            }

            // 13. Validate against risk manager
            const riskManager = global.SOMA_TRADING?.riskManager;
            if (riskManager) {
                const riskResult = await riskManager.validateTrade({
                    symbol: this.symbol,
                    side: signal.action.toLowerCase(),
                    size: sizing.qty,
                    price: currentPrice
                });
                if (!riskResult.approved) {
                    const violation = riskResult.violations.find(v => v.action === 'REJECT' || v.action === 'HALT_TRADING');
                    this._logDecision('RISK', 'BLOCKED', `Risk: ${violation?.message || 'Trade rejected'}`, {
                        signal: signal.action, violations: riskResult.violations
                    });
                    this._recordRuntimeLifecycle('risk', 'blocked', {
                        signal: signal.action,
                        violations: riskResult.violations
                    });
                    return;
                }
            }

            // 14a. Calendar Guard — block live entries near FOMC/earnings.
            // Paper mode: use a tight 2h window (don't suppress learning sessions over FOMC weeks).
            // Live mode:  use 24h window (conserve capital before major macro events).
            if (!this.paperMode) {
                try {
                    const calCheck = await calendarGuard.isEventRisk(this.symbol, 24);
                    if (calCheck.blocked) {
                        this._logDecision('CALENDAR', 'BLOCKED', calCheck.reason, { event: calCheck.event, hoursUntil: calCheck.hoursUntil });
                        return;
                    }
                } catch { /* non-fatal */ }
            } else {
                // Paper mode: only block within 2h of the announcement (let the engine learn)
                try {
                    const calCheck = await calendarGuard.isEventRisk(this.symbol, 2);
                    if (calCheck.blocked) {
                        this._logDecision('CALENDAR', 'WARN', `${calCheck.reason} (paper mode — continuing)`, { event: calCheck.event, hoursUntil: calCheck.hoursUntil });
                    }
                } catch { /* non-fatal */ }
            }

            // 14c. Correlation Guard — block if new position is too correlated with existing ones
            const openSymbols = this._openPositions.map(p => p.symbol).filter(s => s !== this.symbol);
            if (openSymbols.length > 0) {
                try {
                    const corrCheck = await correlationGuard.check(this.symbol, openSymbols);
                    if (!corrCheck.allowed) {
                        this._logDecision('CORRELATION', 'BLOCKED', corrCheck.reason, {
                            maxCorrelation: corrCheck.maxCorrelation,
                            correlatedWith: corrCheck.correlatedWith
                        });
                        return;
                    }
                } catch { /* non-fatal */ }
            }

            // Yield before the heavy execute path so HTTP handlers can respond
            await new Promise(resolve => setImmediate(resolve));

            // 15. EXECUTE THE TRADE
            await this._executeTrade(signal, sizing, currentPrice, analysis);

        } catch (error) {
            this._stats.errors++;
            this._logDecision('ERROR', 'FAIL', `Cycle error: ${error.message}`, {
                stack: error.stack?.split('\n').slice(0, 3).join(' | ')
            });
            console.error('[AutonomousTrader] Cycle error:', error);
        } finally {
            this._stats.lastAnalysisTime = Date.now();
        }
    }

    /**
     * Fast analysis — SignalLibrary ensemble + AltData blend.
     * Deterministic, ~100ms. No external LLM calls needed.
     * Falls back to the heavy 8-step FinanceAgentArbiter if something breaks.
     */
    async _getFastAnalysis(symbol, bars, currentPrice) {
        try {
            // 1. Run all 8 technical signals in parallel (pure computation, instant)
            const techResult = signalLibrary.analyze(bars, currentPrice);

            // 2. Fetch alt data + options IV in parallel (both cached after first call)
            const [altResult, ivResult] = await Promise.all([
                Promise.race([
                    altDataService.getScore(symbol),
                    new Promise(r => setTimeout(() => r(null), 4000)) // 4s timeout
                ]),
                optionsIVSignal.getSignal(symbol).catch(() => null)
            ]);

            // 3. Blend: technical + alt data + options IV
            let composite    = techResult.composite;
            let confidence   = techResult.confidence;
            let sentimentScore = 0.5;

            if (altResult && typeof altResult.score === 'number' && altResult.confidence > 0) {
                const altWeight  = Math.min(0.20, altResult.confidence * 0.30);
                const ivWeight   = (ivResult && typeof ivResult.score === 'number') ? 0.10 : 0;
                const techWeight = 1 - altWeight - ivWeight;
                composite        = techResult.composite * techWeight
                                 + altResult.score * altWeight
                                 + (ivResult?.score || 0) * ivWeight;
                confidence       = Math.min(0.97, techResult.confidence * 0.8 + altResult.confidence * 0.2);
                sentimentScore   = (altResult.score + 1) / 2;

                const ivStr = ivWeight > 0 ? ` iv=${ivResult.score.toFixed(2)}` : '';
                console.log(`[AutonomousTrader] ⚡ Signal: tech=${techResult.composite.toFixed(3)} alt=${altResult.score.toFixed(3)}${ivStr} blend=${composite.toFixed(3)} | ${techResult.inAgreement}/8 signals agree`);
            } else {
                // alt data unavailable — blend in IV if available
                if (ivResult && typeof ivResult.score === 'number') {
                    composite  = techResult.composite * 0.88 + ivResult.score * 0.12;
                    confidence = Math.min(0.97, techResult.confidence);
                    console.log(`[AutonomousTrader] ⚡ Signal: tech=${techResult.composite.toFixed(3)} iv=${ivResult.score.toFixed(2)} blend=${composite.toFixed(3)} | ${techResult.inAgreement}/8 signals agree`);
                } else {
                    console.log(`[AutonomousTrader] ⚡ Signal: tech=${techResult.composite.toFixed(3)} (no alt/iv data) | ${techResult.inAgreement}/8 signals agree`);
                }
            }

            // Feed IV score into adaptive weight system so it learns alongside other signals
            if (ivResult && typeof ivResult.score === 'number') {
                signalLibrary._lastIVScore = ivResult.score; // stored for recordOutcome enrichment
            }

            // In RANGING regime use ±0.06 (mean-reversion — small directional edge is enough)
            // In trending/volatile regimes use ±0.10 (need clearer directional conviction)
            const rangingNow = this._lastKnownRegime === 'RANGING';
            const dirThreshold = rangingNow ? 0.06 : 0.10;
            const recommendation = composite >= dirThreshold ? 'BUY' : composite <= -dirThreshold ? 'SELL' : 'HOLD';

            // Compute RSI for risk score (reuse from signal library internals)
            const closes = bars.map(b => b.close);
            const changes = closes.slice(-15).map((v, i, a) => i === 0 ? 0 : v - a[i - 1]);
            const avgGain = changes.filter(c => c > 0).reduce((s, v) => s + v, 0) / 14;
            const avgLoss = changes.filter(c => c < 0).map(Math.abs).reduce((s, v) => s + v, 0) / 14;
            const rsi     = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

            // Confidence = composite strength + signal agreement bonus
            // At composite=0.10, inAgreement=4 → conf≈0.20 → compositeConfidence≈0.58 (fires at minConf 0.55)
            // At composite=0.10, inAgreement=6 → conf≈0.40 → compositeConfidence≈0.66 (fires at BALANCED 0.60)
            const agreementBonus = techResult.inAgreement >= 6 ? 0.25
                : techResult.inAgreement >= 5 ? 0.15
                : techResult.inAgreement >= 4 ? 0.05 : 0;
            const signalConfidence = Math.min(0.95, Math.abs(composite) * 1.5 + agreementBonus);

            // Store live per-signal scores so status endpoint can expose them to the UI
            this._lastSignalBreakdown = techResult.signals || null;

            return {
                strategy:  {
                    recommendation,
                    confidence:   signalConfidence,
                    thesis:       techResult.reason,
                    signals:      techResult.signals,
                    inAgreement:  techResult.inAgreement,
                },
                risk:      { score: rsi > 70 ? 30 : rsi < 30 ? 75 : 55, assessment: recommendation.toLowerCase(), rsi },
                sentiment: { score: sentimentScore, altData: altResult, ivScore: ivResult?.score ?? null },
                quant:     { strategy: 'SignalLibrary+AltData', composite, signals: techResult.signals },
            };
        } catch (e) {
            console.warn('[AutonomousTrader] Fast analysis error:', e.message);
        }

        // Heavy fallback — the full 8-step FinanceAgentArbiter
        return this._getHeavyAnalysis(symbol);
    }

    /**
     * Heavy analysis — full 8-step FinanceAgentArbiter. Used as fallback only.
     */
    async _getHeavyAnalysis(symbol) {
        try {
            const arbiter = global.SOMA?.financeArbiter;
            if (arbiter && typeof arbiter.analyzeStock === 'function') {
                return await Promise.race([
                    arbiter.analyzeStock(symbol),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Heavy analysis timed out')), 45000))
                ]);
            }

            const controller = new AbortController();
            const timeout    = setTimeout(() => controller.abort(), 45000);
            const response   = await fetch(`http://localhost:${process.env.PORT || 3001}/api/finance/analyze`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ symbol }),
                signal:  controller.signal
            });
            clearTimeout(timeout);

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.analysis) return data.analysis;
            }
            return null;
        } catch (error) {
            console.warn('[AutonomousTrader] Heavy analysis failed:', error.message);
            return null;
        }
    }

    /**
     * Get current market regime safely
     */
    async _getRegime() {
        const detector = global.SOMA_TRADING?.regimeDetector;
        if (detector && typeof detector.getRegime === 'function') {
            try {
                const result = await Promise.race([
                    detector.getRegime(this.symbol),
                    new Promise(r => setTimeout(() => r(null), 2000))
                ]);
                // getRegime returns { regime: 'RANGING', confidence: 0.8, ... } — extract string
                return typeof result === 'string' ? result : (result?.regime || null);
            } catch (e) { return null; }
        }
        const raw = detector?.currentRegime;
        return typeof raw === 'string' ? raw : (raw?.regime || null);
    }

    /**
     * Generate trading signal from AI analysis + Technicals + Regime
     */
    _generateSignal(analysis, currentPrice, bars, regime = null) {
        const { strategy, risk, sentiment, quant } = analysis;

        // ─── REGIME-MATCHED ENTRY ─────────────────────────────────────────────
        // Momentum entries lose in ranging markets — "price above its average"
        // reads bullish but in chop it means "near the top of the range, about
        // to revert." That produced an 8% live win rate (Jun 2026). In RANGING,
        // derive the entry from mean-reversion (buy the dip / sell the rip)
        // instead of the momentum recommendation. TRENDING keeps momentum below.
        const isRangingRegime = regime === 'RANGING' || regime?.includes?.('RANGING');
        if (isRangingRegime) {
            const mr = this._meanReversionSignal(bars, currentPrice);
            const mrSignal = {
                action: mr.action,
                confidence: mr.confidence,
                reason: `${mr.reason} [Regime: ${regime}]`,
                recommendation: mr.action === 'BUY' ? 'BUY' : mr.action === 'SELL' ? 'SELL' : 'HOLD',
                agents: { strategy: mr.confidence, risk: 0.5, sentiment: 0.5, technical: mr.bandScore },
                timestamp: Date.now(),
                regime,
                source: 'mean_reversion'
            };
            const adaptedMr = missionControlRuntime.adaptSignal(mrSignal, analysis, {
                symbol: this.symbol, price: currentPrice, regime, minConfidence: this.config.minConfidence
            });
            this._lastSignal = adaptedMr;
            return adaptedMr;
        }

        // Extract confidence scores
        let strategyConfidence = strategy?.confidence || 0;
        let riskScore = risk?.score != null ? risk.score / 100 : 0.5;
        let sentimentScore = sentiment?.score || 0.5;
        let recommendation = (strategy?.recommendation || 'HOLD').toUpperCase();

        // --- Regime Adjustments ---
        if (regime) {
            if (regime === 'TRENDING_BULL') {
                if (recommendation === 'BUY' || recommendation === 'STRONG BUY') strategyConfidence *= 1.1; // Boost buy confidence
                if (recommendation === 'SELL') strategyConfidence *= 0.8; // Dampen contrarian sells
                sentimentScore = Math.min(1, sentimentScore + 0.1);
            } else if (regime === 'TRENDING_BEAR') {
                if (recommendation === 'SELL' || recommendation === 'STRONG SELL') strategyConfidence *= 1.1;
                if (recommendation === 'BUY') strategyConfidence *= 0.8;
                sentimentScore = Math.max(0, sentimentScore - 0.1);
            } else if (regime === 'VOLATILE') {
                strategyConfidence *= 0.9; // Lower confidence in volatility
                riskScore = Math.min(1, riskScore + 0.2); // Perceived risk is higher
            }
        }

        // Composite confidence — base-anchored formula:
        // Any BUY/SELL recommendation already passed a blended signal filter, so we
        // start at 0.50 and scale up by signal quality rather than diluting with
        // neutral-ish risk/sentiment terms. Risk is inverted for SELL signals (overbought
        // RSI is bad for buys but good for sells).
        const technicalScore = this._getTechnicalSignal(bars, currentPrice);
        const isLong = ['BUY', 'STRONG BUY', 'LONG'].includes(recommendation);
        const riskMod = isLong ? (riskScore - 0.5) * 0.30 : (0.5 - riskScore) * 0.30;
        const compositeConfidence = Math.min(0.97, Math.max(0,
            0.50 +
            strategyConfidence * 0.40 +
            riskMod +
            (sentimentScore - 0.5) * 0.20 +
            (technicalScore - 0.5) * 0.20
        ));

        // Determine action
        let action = 'HOLD';
        let reason = '';

        // Dynamic threshold based on regime
        let threshold = this.config.minConfidence;
        if (regime === 'VOLATILE') threshold += 0.10; // Require higher confidence in volatile markets
        if (regime === 'RANGING' || regime?.includes?.('RANGING')) threshold -= 0.08; // Mean-reversion uses tighter directional bar (0.06 vs 0.10), so lower the confidence gate to match

        if (recommendation === 'BUY' || recommendation === 'STRONG BUY' || recommendation === 'LONG') {
            if (compositeConfidence >= threshold) {
                action = 'BUY';
                reason = `AI swarm recommends ${recommendation} (conf: ${(compositeConfidence * 100).toFixed(0)}%). ` +
                         `Strategy: ${strategyConfidence.toFixed(2)}, Sentiment: ${sentimentScore.toFixed(2)}, Risk: ${riskScore.toFixed(2)}`;
            } else {
                reason = `${recommendation} signal but confidence too low (${(compositeConfidence * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}%)`;
            }
        } else if (recommendation === 'SELL' || recommendation === 'STRONG SELL' || recommendation === 'SHORT') {
            if (compositeConfidence >= threshold) {
                action = 'SELL';
                reason = `AI swarm recommends ${recommendation} (conf: ${(compositeConfidence * 100).toFixed(0)}%). ` +
                         `Strategy: ${strategyConfidence.toFixed(2)}, Sentiment: ${sentimentScore.toFixed(2)}, Risk: ${riskScore.toFixed(2)}`;
            } else {
                reason = `${recommendation} signal but confidence too low (${(compositeConfidence * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}%)`;
            }
        } else {
            reason = `AI swarm says HOLD (conf: ${(compositeConfidence * 100).toFixed(0)}%). No clear directional signal.`;
        }
        
        // ADX filter for trend/breakout strategies
        const strategyId = this._getActiveStrategyId();
        const isTrendOrBreakout = ['full_aggression', 'standard_portfolio', 'swarm_architecture'].includes(strategyId);
        const detector = global.SOMA_TRADING?.regimeDetector || null;
        const regimeInfo = detector?.getRegime?.(this.symbol) || {};
        const adx = regimeInfo.adxProxy !== undefined ? regimeInfo.adxProxy : null;

        if (isTrendOrBreakout && adx !== null && adx < 0.22 && action !== 'HOLD') {
            action = 'HOLD';
            reason = `Breakout BLOCKED by ADX Filter — Trend too weak (ADX: ${(adx * 100).toFixed(0)} < 22). Original signal: ${action}`;
        }
        
        if (regime) reason += ` [Regime: ${regime}]`;

        const signalResult = {
            action,
            confidence: compositeConfidence,
            reason,
            recommendation,
            agents: {
                strategy: strategyConfidence,
                risk: riskScore,
                sentiment: sentimentScore,
                technical: this._getTechnicalSignal(bars, currentPrice)
            },
            timestamp: Date.now(),
            regime // store for logging
        };

        const adaptedSignal = missionControlRuntime.adaptSignal(signalResult, analysis, {
            symbol: this.symbol,
            price: currentPrice,
            regime,
            minConfidence: threshold
        });

        // Store latest signal so status endpoint can expose agent confidences
        this._lastSignal = adaptedSignal;

        return adaptedSignal;
    }

    /**
     * Simple technical signal from price action (0-1, where >0.5 = bullish)
     */
    /**
     * Calculate 14-period Average True Range (ATR)
     */
    _calculateATR(bars, period = 14) {
        if (!bars || bars.length < period + 1) return null;
        let trSum = 0;
        for (let i = bars.length - period; i < bars.length; i++) {
            const high = bars[i].high || bars[i].h || bars[i].close;
            const low = bars[i].low || bars[i].l || bars[i].close;
            const prevClose = bars[i - 1].close || bars[i - 1].c || bars[i].close;
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );
            trSum += tr;
        }
        return trSum / period;
    }

    /**
     * ATR Dynamic Volatility-Scaled Stop & Target Config
     */
    _getATRTradeConfig(bars, currentPrice) {
        const atr = this._calculateATR(bars, 14);
        if (atr && currentPrice > 0) {
            const atrPct = atr / currentPrice;
            const stopLossPct = Math.max(0.012, Math.min(0.03, atrPct * 1.5));
            const takeProfitPct = Math.max(0.045, stopLossPct * 3.0); // Enforce 3.0:1 Reward-to-Risk ratio
            const trailingStopPct = Math.max(0.015, stopLossPct * 1.2);
            return { stopLossPct, takeProfitPct, trailingStopPct, atr, atrPct };
        }
        return {
            stopLossPct: this.config.stopLossPct || 0.015,
            takeProfitPct: this.config.takeProfitPct || 0.05,
            trailingStopPct: this.config.trailingStopPct || 0.02
        };
    }

    _getTechnicalSignal(bars, currentPrice) {
        if (!bars || bars.length < 20) return 0.5;

        // SMA20 crossover
        const sma20 = bars.slice(-20).reduce((s, b) => s + b.close, 0) / 20;
        const sma10 = bars.slice(-10).reduce((s, b) => s + b.close, 0) / 10;

        // RSI approximation
        const gains = [];
        const losses = [];
        for (let i = bars.length - 14; i < bars.length; i++) {
            const change = bars[i].close - bars[i - 1].close;
            if (change > 0) { gains.push(change); losses.push(0); }
            else { gains.push(0); losses.push(Math.abs(change)); }
        }
        const avgGain = gains.reduce((s, g) => s + g, 0) / 14;
        const avgLoss = losses.reduce((s, l) => s + l, 0) / 14;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        // Composite technical score
        let score = 0.5;
        if (currentPrice > sma20) score += 0.15;
        else score -= 0.15;
        if (sma10 > sma20) score += 0.10;
        else score -= 0.10;
        if (rsi < 30) score += 0.15; // Oversold = bullish
        else if (rsi > 70) score -= 0.15; // Overbought = bearish
        else score += (50 - rsi) / 200; // Slight bias

        return Math.min(1, Math.max(0, score));
    }

    /**
     * Mean-reversion entry signal for RANGING markets — buy the dip, sell the
     * rip. Uses Bollinger band position + RSI extremes (the scalping engine's
     * confluence, self-contained). Only fires near band edges; HOLDs mid-band
     * so it trades less and at better prices than the momentum path.
     */
    _meanReversionSignal(bars, currentPrice) {
        if (!bars || bars.length < 20) {
            return { action: 'HOLD', confidence: 0, reason: 'Mean-reversion: insufficient bars', bandScore: 0.5 };
        }
        const window = bars.slice(-20).map(b => b.close);
        const sma = window.reduce((s, c) => s + c, 0) / window.length;
        const variance = window.reduce((s, c) => s + (c - sma) ** 2, 0) / window.length;
        const std = Math.sqrt(variance);
        const upper = sma + 2 * std;
        const lower = sma - 2 * std;

        // Volume spike check (1.3x average volume)
        const volumes = bars.slice(-20).map(b => b.volume || b.v || 0).filter(Boolean);
        const avgVolume = volumes.length ? volumes.reduce((s, v) => s + v, 0) / volumes.length : 0;
        const currentVolume = bars[bars.length - 1].volume || bars[bars.length - 1].v || 0;
        const volumeSpike = avgVolume > 0 ? (currentVolume > avgVolume * 1.3) : false;

        // RSI(14)
        let gains = 0, losses = 0;
        for (let i = bars.length - 14; i < bars.length; i++) {
            const ch = bars[i].close - bars[i - 1].close;
            if (ch > 0) gains += ch; else losses += Math.abs(ch);
        }
        const avgGain = gains / 14, avgLoss = losses / 14;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        // 0 = at/below lower band, 1 = at/above upper band
        const bandScore = std > 0 ? Math.min(1, Math.max(0, (currentPrice - lower) / (upper - lower))) : 0.5;
        const pct = (bandScore * 100).toFixed(0);

        // Buy the dip: lower band OR oversold RSI
        if (currentPrice <= lower || rsi < 35) {
            let conf = Math.min(0.9, 0.58 + (35 - Math.min(rsi, 35)) / 100 + Math.max(0, (lower - currentPrice) / (std || 1)) * 0.08);
            if (volumeSpike) {
                conf = Math.min(0.95, conf + 0.10); // Volume spike boost
            }
            const volStr = volumeSpike ? ' [Volume Spike Confirmation]' : '';
            return { action: 'BUY', confidence: conf, reason: `Mean-reversion BUY — oversold (RSI ${rsi.toFixed(0)}, ${pct}% of band)${volStr}`, bandScore };
        }
        // Sell the rip: upper band OR overbought RSI
        if (currentPrice >= upper || rsi > 65) {
            let conf = Math.min(0.9, 0.58 + (Math.max(rsi, 65) - 65) / 100 + Math.max(0, (currentPrice - upper) / (std || 1)) * 0.08);
            if (volumeSpike) {
                conf = Math.min(0.95, conf + 0.10); // Volume spike boost
            }
            const volStr = volumeSpike ? ' [Volume Spike Confirmation]' : '';
            return { action: 'SELL', confidence: conf, reason: `Mean-reversion SELL — overbought (RSI ${rsi.toFixed(0)}, ${pct}% of band)${volStr}`, bandScore };
        }
        return { action: 'HOLD', confidence: 0.4, reason: `Mean-reversion HOLD — mid-band (${pct}%, RSI ${rsi.toFixed(0)}), waiting for an extreme`, bandScore };
    }

    /**
     * Calculate position size — Kelly criterion + alpha decay + gross exposure cap + regime scaling
     */
    async _calculatePositionSize(currentPrice, regime = null, confidence = 0.6) {
        try {
            let equity, buyingPower;
            if (this.paperMode) {
                equity = this._paperPortfolio.balance;
                buyingPower = this._paperPortfolio.balance;
            } else {
                const account = await alpacaService.client.getAccount();
                equity = parseFloat(account.equity);
                buyingPower = parseFloat(account.buying_power);
            }

            // Regime scaling
            let maxPct = this.config.maxPositionPct;
            if (regime === 'VOLATILE') maxPct *= 0.5;
            if (regime === 'TRENDING_BULL' || regime === 'TRENDING_BEAR') maxPct *= 1.2;
            if (regime === 'RANGING' || regime?.includes?.('RANGING')) {
                const activeId = this._getActiveStrategyId();
                if (activeId === 'btc_native' || activeId === 'full_aggression') {
                    console.warn(`[AutonomousTrader] 🛑 Skipping momentum strategy (${activeId}) entry in RANGING regime.`);
                    return { qty: 0, reason: `Strategy ${activeId} disabled in RANGING regime (prevents momentum chop loss)` };
                } else {
                    maxPct *= 0.8; // Reduce exposure for all other strategies in chop
                }
            }

            // ── Gross Exposure Cap ────────────────────────────────────────────
            // Block new positions if total portfolio exposure is at 80% of equity
            const existingExposure = this._openPositions.reduce((sum, p) => sum + Math.abs(p.marketValue || 0), 0);
            if (equity > 0 && existingExposure / equity >= 0.80) {
                this._logDecision('SIZING', 'SKIP', `Gross exposure ${((existingExposure/equity)*100).toFixed(0)}% at 80% cap`, { existingExposure, equity });
                return { qty: 0, maxValue: 0, equity, buyingPower, riskPct: 0 };
            }

            // ── Half-Kelly Position Sizing ────────────────────────────────────
            // Only applies after 10+ closed trades to avoid noise on early sessions
            const wins = this._stats.wins || 0;
            const losses = this._stats.losses || 0;
            const totalClosed = wins + losses;
            if (totalClosed >= 10) {
                const p = wins / totalClosed;
                const q = 1 - p;
                const avgWin  = wins   > 0 ? (this._stats.grossWins   || 0) / wins   : 0;
                const avgLoss = losses > 0 ? (this._stats.grossLosses || 0) / losses : 1;
                const b = avgLoss > 0 ? avgWin / avgLoss : 1.5;
                const kellyFull = b > 0 ? (p * b - q) / b : 0;
                const kellyHalf = Math.max(0.01, Math.min(0.35, kellyFull / 2));
                maxPct = Math.min(maxPct, kellyHalf);
            }

            // ── Alpha Decay Guard ─────────────────────────────────────────────
            // If rolling 20-trade win rate is falling, slash position size
            if (this._recentTrades.length >= 10) {
                const recent = this._recentTrades.slice(-20);
                const recentWinRate = recent.filter(t => t.isWin).length / recent.length;
                if (recentWinRate < 0.30) {
                    maxPct *= 0.25;
                    console.warn(`[AutonomousTrader] ⚠️ Alpha decay severe (${(recentWinRate*100).toFixed(0)}% win rate) — sizing at 25%`);
                } else if (recentWinRate < 0.40) {
                    maxPct *= 0.50;
                    console.warn(`[AutonomousTrader] ⚠️ Alpha decay (${(recentWinRate*100).toFixed(0)}% win rate) — sizing at 50%`);
                }
            }

            // ── Confidence Scaling (±20% of base) ────────────────────────────
            const minConf = Math.max(this.config.minConfidence || 0.01, 0.01);
            const confScale = 0.80 + 0.40 * Math.min(1, confidence / minConf);
            maxPct = Math.min(maxPct * confScale, this.config.maxPositionPct);

            // ── Headroom clamp when approaching exposure cap ──────────────────
            let maxValue = equity * maxPct;
            if (equity > 0 && existingExposure / equity >= 0.60) {
                const headroom = (0.80 * equity) - existingExposure;
                maxValue = Math.min(maxValue, headroom * 0.9);
            }
            if (this.paperMode && this.config.maxPaperTradeValue) {
                maxValue = Math.min(maxValue, this.config.maxPaperTradeValue);
            }

            const isCrypto = this.symbol.includes('-') || this.symbol.includes('USDT');

            // Crypto is fractional — never floor to 0 just because price > balance
            const maxQty = isCrypto ? maxValue / currentPrice : Math.floor(maxValue / currentPrice);
            const bpQty  = isCrypto ? (buyingPower * 0.9) / currentPrice : Math.floor((buyingPower * 0.9) / currentPrice);
            const qty = Math.min(maxQty, bpQty);

            const finalQty = isCrypto ? qty : Math.max(1, qty);

            return {
                qty: isCrypto ? parseFloat(finalQty.toFixed(6)) : finalQty,
                maxValue,
                equity,
                buyingPower,
                riskPct: maxPct,
                kellyActive: totalClosed >= 10,
                alphaDecayActive: this._recentTrades.length >= 10
            };
        } catch (error) {
            console.error('[AutonomousTrader] Position sizing error:', error.message);
            return null;
        }
    }

    /**
     * Adaptive interval: shorten during high volatility, extend during flat markets
     * Called once per cycle after bars are fetched.
     */
    _adjustInterval(bars) {
        if (!bars || bars.length < 20) return;
        const ranges = bars.slice(-20).map(b => (b.high - b.low) / (b.close || 1));
        const avgRange = ranges.reduce((s, v) => s + v, 0) / ranges.length || 0.001;
        const currRange = ranges[ranges.length - 1];
        const atrRatio = currRange / avgRange;

        const base = this.config.analysisIntervalMs;
        let next;
        if (atrRatio > 2.0)      next = Math.max(15_000, base * 0.25);  // spike: floor 15s
        else if (atrRatio > 1.5) next = Math.max(30_000, base * 0.50);  // elevated: floor 30s
        else if (atrRatio < 0.5) next = Math.min(300_000, base * 3.0);  // dead: cap 5min
        else                     next = base;

        if (next !== this._currentInterval) {
            console.log(`[AutonomousTrader] ⏱️ Interval → ${Math.round(next/1000)}s (ATR ratio: ${atrRatio.toFixed(2)})`);
            this._currentInterval = next;
        }
    }

    /**
     * Compute True Average Range (ATR) as a fraction of current price.
     * Returns e.g. 0.012 meaning 1.2% average true range.
     */
    _computeATR(bars, period = 14) {
        if (!bars || bars.length < period + 1) return 0.015; // safe default ~1.5%
        const trueRanges = [];
        for (let i = bars.length - period; i < bars.length; i++) {
            const high = bars[i].high, low = bars[i].low, prevClose = bars[i - 1].close;
            trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        const atr = trueRanges.reduce((s, v) => s + v, 0) / trueRanges.length;
        const price = bars[bars.length - 1].close || 1;
        return atr / price;
    }

    /**
     * Derive dynamic stop/target config from regime + current ATR.
     * Multipliers are tuned per market structure:
     *   RANGING:  tighter targets (mean-reversion — price returns to mean quickly)
     *   TRENDING: wider stops (ride the wave, don't get shaken out)
     *   VOLATILE: even tighter stops (spike protection)
     */
    _getRegimeConfig(regime, atrPct) {
        const isCrypto = this.symbol && (this.symbol.includes('-') || this.symbol.includes('USDT'));
        const atr = atrPct || 0.015;
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        let stop, target, trail;
        
        // Crypto needs wider stops to survive standard noise (1.2% min vs 0.5% for stocks)
        const minStop = isCrypto ? 0.012 : 0.005;
        const maxStop = isCrypto ? 0.040 : 0.025;

        if (regime && (regime.includes('TRENDING') || regime === 'TRENDING_BULL' || regime === 'TRENDING_BEAR')) {
            stop  = clamp(2.0 * atr, minStop * 1.5, maxStop * 1.5);
            target = stop * 4.0;
            trail  = stop * 1.5;
        } else if (regime === 'VOLATILE' || regime?.includes?.('VOLATILE')) {
            stop  = clamp(1.0 * atr, minStop * 1.2, maxStop * 1.5);
            target = stop * 2.0;
            trail  = stop * 1.0;
        } else {
            // RANGING or unknown: tight mean-reversion targets
            stop  = clamp(1.5 * atr, minStop, maxStop);
            target = stop * 2.5;
            trail  = stop * 1.2;
        }
        return { stopLossPct: stop, takeProfitPct: target, trailingStopPct: trail };
    }

    /**
     * Record the result of a closed trade for Kelly + alpha decay tracking
     */
    _recordTradeResult(pnl) {
        if (pnl > 0) {
            this._stats.wins++;
            this._stats.grossWins += pnl;
        } else {
            this._stats.losses++;
            this._stats.grossLosses += Math.abs(pnl);
        }
        this._recentTrades.push({ pnl, isWin: pnl > 0, ts: Date.now() });
        if (this._recentTrades.length > 20) this._recentTrades.shift();
    }

    /**
     * Execute the trade via Alpaca
     */
    async _executeTrade(signal, sizing, currentPrice, analysis) {
        // Store signal scores now — used for adaptive weight update when position closes
        if (analysis?.quant?.signals) {
            this._signalScoresAtEntry.set(this.symbol, analysis.quant.signals);
        }

        // Route to paper execution if Alpaca not connected
        if (this.paperMode) {
            return this._executePaperOrder(signal, sizing, currentPrice);
        }

        const side = signal.action.toLowerCase(); // 'buy' or 'sell'

        try {
            // Calculate SL/TP prices (used for logging; _managePosition handles exits)
            const stopLossPrice = side === 'buy'
                ? currentPrice * (1 - this.config.stopLossPct)
                : currentPrice * (1 + this.config.stopLossPct);

            const takeProfitPrice = side === 'buy'
                ? currentPrice * (1 + this.config.takeProfitPct)
                : currentPrice * (1 - this.config.takeProfitPct);

            console.log(`[AutonomousTrader] 📊 Executing ${side.toUpperCase()} ${sizing.qty} ${this.symbol} @ ~$${currentPrice.toFixed(2)}`);
            console.log(`[AutonomousTrader] SL: $${stopLossPrice.toFixed(2)}, TP: $${takeProfitPrice.toFixed(2)}`);
            this._recordRuntimeLifecycle('order_submit', 'started', {
                side,
                qty: sizing.qty,
                expectedPrice: currentPrice,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice,
                confidence: signal.confidence
            });

            // TWAP/VWAP institutional execution — slices large orders to minimize market impact
            // Small orders (<$500 notional) fall through as single shots automatically
            const execResult = await vwapExecutor.execute(this.symbol, side, sizing.qty, currentPrice, { paperMode: false });

            if (!execResult || execResult.status === 'failed') {
                throw new Error('VWAP execution failed — no fills returned');
            }

            const fillPrice = execResult.avgPrice;
            const order = {
                id:               execResult.fills[0]?.orderId || `vwap_${Date.now()}`,
                status:           execResult.status,
                filled_avg_price: fillPrice?.toFixed(4),
            };

            if (execResult.mode === 'twap') {
                console.log(`[AutonomousTrader] 🏛️ TWAP: ${execResult.slicesExecuted} slices @ avg $${fillPrice.toFixed(4)} | Est. market impact saved: $${execResult.savings.toFixed(2)}`);
            }

            // Record trade
            this._stats.tradesExecuted++;
            this._stats.totalDecisions++;
            this._stats.lastTradeTime = Date.now();
            this._lastTradeTime.set(this.symbol, Date.now());

            if (signal.action === 'BUY') this._stats.signalsBuy++;
            else this._stats.signalsSell++;

            // Log to decision stream
            this._logDecision('TRADE', signal.action, signal.reason, {
                orderId: order.id,
                symbol: this.symbol,
                side: side,
                qty: sizing.qty,
                price: currentPrice,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice,
                confidence: signal.confidence,
                agents: signal.agents,
                status: order.status
            });
            this._recordRuntimeLifecycle('order_fill', order.status || 'filled', {
                orderId: order.id,
                side,
                qty: sizing.qty,
                fillPrice,
                mode: execResult.mode,
                confidence: signal.confidence,
                agents: signal.agents
            });

            // Record in guardrails
            const guardrails = global.SOMA_TRADING?.guardrails;
            if (guardrails) {
                guardrails.recordTrade(
                    { symbol: this.symbol, side, qty: sizing.qty, value: sizing.qty * currentPrice },
                    { success: true, orderId: order.id }
                );
            }

            // Log to SQLite (initial entry — fill price updated async below)
            try {
                const abArm = abTestFramework.assignArm();
                this._abTestArmAtEntry.set(this.symbol, abArm);
                const attribution = this._tradeAttribution();
                const tradeId = tradeLogger.logTradeEntry({
                    orderId: order.id,
                    symbol: this.symbol,
                    side: side,
                    qty: sizing.qty,
                    entryPrice: currentPrice,
                    filledPrice: order.filled_avg_price || null,
                    expectedPrice: currentPrice,
                    slippagePct: null,
                    strategy: attribution.strategyId,
                    attribution,
                    regime: this._lastSignal?.regime || null,
                    signalScores: this._signalScoresWithAttribution(this.symbol)
                });
                this._recordRuntimeLifecycle('trade_journaled', 'open', { tradeId, orderId: order.id, side, qty: sizing.qty });
            } catch (logErr) {
                console.warn('[AutonomousTrader] SQLite log failed:', logErr.message);
            }

            console.log(`[AutonomousTrader] ✅ ${side.toUpperCase()} ${sizing.qty} ${this.symbol} — Order ${order.id} (${order.status})`);

            // Async: poll for actual fill price to compute real slippage + P&L
            this._trackFillPrice(order.id, currentPrice, sizing.qty, side);

            // Invalidate position cache so next cycle sees the new position
            this._positionCacheTime = 0;

            return order;

        } catch (error) {
            this._stats.errors++;
            this._logDecision('TRADE', 'FAILED', `Execution failed: ${error.message}`, {
                signal: signal.action, qty: sizing.qty, price: currentPrice, error: error.message
            });
            this._recordRuntimeLifecycle('order_submit', 'failed', {
                signal: signal.action,
                qty: sizing.qty,
                price: currentPrice,
                error: error.message
            });
            console.error(`[AutonomousTrader] ❌ Trade execution failed:`, error.message);
            return null;
        }
    }

    /**
     * Simulate a trade fill in paper mode (no real money, tracks virtual portfolio)
     */
    async _executePaperOrder(signal, sizing, currentPrice) {
        const side = signal.action.toLowerCase();
        const existingPaperPosition = this._paperPortfolio.positions[this.symbol];
        const isClosingPosition = (side === 'buy' && existingPaperPosition?.side === 'short')
            || (side === 'sell' && existingPaperPosition?.side === 'long');
        const fill = paperExecutionSimulator.simulateFill({
            symbol: this.symbol,
            side,
            qty: isClosingPosition ? existingPaperPosition.qty : sizing.qty,
            referencePrice: currentPrice,
            allowPartialFill: !isClosingPosition
        });
        if (!fill.accepted) {
            this._logDecision('PAPER', 'REJECTED', `Paper broker rejected order: ${fill.reason}`, { fill });
            this._recordRuntimeLifecycle('paper_order_reject', 'rejected', fill);
            return null;
        }
        const mockOrder = { id: fill.orderId, status: fill.status, filled_avg_price: fill.filledPrice.toFixed(2) };
        const fillPrice = fill.filledPrice;
        const filledQty = fill.filledQty;
        const cost = fillPrice * filledQty + fill.fee;
        if (side === 'buy' && existingPaperPosition?.side !== 'short' && cost > this._paperPortfolio.balance) {
            this._logDecision('PAPER', 'SKIP', `Insufficient virtual balance ($${this._paperPortfolio.balance.toFixed(2)} < $${cost.toFixed(2)})`);
            return null;
        }

        // Update paper portfolio
        if (side === 'buy') {
            const pos = this._paperPortfolio.positions[this.symbol];
            if (pos && pos.side === 'short') {
                const pnl = (pos.entryPrice - fillPrice) * pos.qty - (pos.fees || 0) - fill.fee;
                const pnlPct = pnl / (pos.entryPrice * pos.qty);
                this._paperPortfolio.balance -= fillPrice * pos.qty + fill.fee;
                this._stats.sessionPnL += pnl;
                this._recordTradeResult(pnl);
                delete this._paperPortfolio.positions[this.symbol];
                try {
                    tradeLogger.logTradeExit(pos.tradeId || this.symbol, {
                        exitPrice: fillPrice,
                        pnl,
                        pnlPct,
                        exitFee: fill.fee,
                        reason: 'paper_signal_close'
                    });
                } catch (logErr) {
                    console.warn('[AutonomousTrader] Paper SQLite exit failed:', logErr.message);
                }
                this._recordRuntimeLifecycle('paper_order_fill', 'closed', {
                    tradeId: pos.tradeId || null,
                    orderId: mockOrder.id,
                    side,
                    qty: pos.qty,
                    fillPrice,
                    fee: fill.fee,
                    latencyMs: fill.latencyMs,
                    pnl,
                    pnlPct
                });
                notificationService.sendTradeNotification({
                    symbol: this.symbol, side: 'short', qty: pos.qty,
                    entryPrice: pos.entryPrice, exitPrice: fillPrice,
                    pnl, pnlPct: pnlPct * 100, reason: 'signal close'
                }).catch(() => {});
            } else {
                this._paperPortfolio.balance -= cost;
                let tradeId = null;
                try {
                    const abArm = abTestFramework.assignArm();
                    this._abTestArmAtEntry.set(this.symbol, abArm);
                    const attribution = this._tradeAttribution();
                    tradeId = tradeLogger.logTradeEntry({
                        orderId: mockOrder.id,
                        symbol: this.symbol,
                        side,
                        qty: filledQty,
                        entryPrice: fillPrice,
                        filledPrice: fillPrice,
                        expectedPrice: currentPrice,
                        slippagePct: fill.slippagePct,
                        entryFee: fill.fee,
                        strategy: attribution.strategyId,
                        attribution,
                        regime: this._lastSignal?.regime || null,
                        signalScores: this._signalScoresWithAttribution(this.symbol)
                    });
                } catch (logErr) {
                    console.warn('[AutonomousTrader] Paper SQLite entry failed:', logErr.message);
                }
                this._paperPortfolio.positions[this.symbol] = { side: 'long', qty: filledQty, entryPrice: fillPrice, tradeId, fees: fill.fee, openedAt: Date.now(), regime: this._lastKnownRegime, attribution: this._tradeAttribution() };
                this._recordRuntimeLifecycle('paper_order_fill', 'open', {
                    tradeId,
                    orderId: mockOrder.id,
                    side,
                    qty: filledQty,
                    fillPrice,
                    fee: fill.fee,
                    latencyMs: fill.latencyMs,
                    requestedQty: sizing.qty,
                    status: fill.status,
                    confidence: signal.confidence
                });
            }
        } else {
            const pos = this._paperPortfolio.positions[this.symbol];
            if (pos && pos.side === 'long') {
                // Close long
                const pnl = (fillPrice - pos.entryPrice) * pos.qty - (pos.fees || 0) - fill.fee;
                const pnlPct = pnl / (pos.entryPrice * pos.qty);
                this._paperPortfolio.balance += fillPrice * pos.qty - fill.fee;
                this._stats.sessionPnL += pnl;
                this._recordTradeResult(pnl);
                delete this._paperPortfolio.positions[this.symbol];

                // A/B test outcome for paper_signal_close
                const abEntryClose = this._abTestArmAtEntry.get(this.symbol);
                if (abEntryClose) {
                    abTestFramework.recordOutcome(abEntryClose.arm, pos.tradeId || this.symbol, pnlPct * 100);
                    this._abTestArmAtEntry.delete(this.symbol);
                }

                try {
                    tradeLogger.logTradeExit(pos.tradeId || this.symbol, {
                        exitPrice: fillPrice,
                        pnl,
                        pnlPct,
                        exitFee: fill.fee,
                        reason: 'paper_signal_close'
                    });
                } catch (logErr) {
                    console.warn('[AutonomousTrader] Paper SQLite exit failed:', logErr.message);
                }
                this._recordRuntimeLifecycle('paper_order_fill', 'closed', {
                    tradeId: pos.tradeId || null,
                    orderId: mockOrder.id,
                    side,
                    qty: pos.qty,
                    fillPrice,
                    fee: fill.fee,
                    latencyMs: fill.latencyMs,
                    pnl,
                    pnlPct
                });
                notificationService.sendTradeNotification({
                    symbol: this.symbol, side: 'long', qty: pos.qty,
                    entryPrice: pos.entryPrice, exitPrice: fillPrice,
                    pnl, pnlPct: pnlPct * 100, reason: 'signal close'
                }).catch(() => {});
            } else {
                // Open short
                this._paperPortfolio.balance += fillPrice * filledQty - fill.fee;
                let tradeId = null;
                try {
                    const abArm = abTestFramework.assignArm();
                    this._abTestArmAtEntry.set(this.symbol, abArm);
                    const attribution = this._tradeAttribution();
                    tradeId = tradeLogger.logTradeEntry({
                        orderId: mockOrder.id,
                        symbol: this.symbol,
                        side,
                        qty: filledQty,
                        entryPrice: fillPrice,
                        filledPrice: fillPrice,
                        expectedPrice: currentPrice,
                        slippagePct: fill.slippagePct,
                        entryFee: fill.fee,
                        strategy: attribution.strategyId,
                        attribution,
                        regime: this._lastSignal?.regime || null,
                        signalScores: this._signalScoresWithAttribution(this.symbol)
                    });
                } catch (logErr) {
                    console.warn('[AutonomousTrader] Paper SQLite entry failed:', logErr.message);
                }
                this._paperPortfolio.positions[this.symbol] = { side: 'short', qty: filledQty, entryPrice: fillPrice, tradeId, fees: fill.fee, openedAt: Date.now(), regime: this._lastKnownRegime, attribution: this._tradeAttribution() };
                this._recordRuntimeLifecycle('paper_order_fill', 'open', {
                    tradeId,
                    orderId: mockOrder.id,
                    side,
                    qty: filledQty,
                    fillPrice,
                    fee: fill.fee,
                    latencyMs: fill.latencyMs,
                    requestedQty: sizing.qty,
                    status: fill.status,
                    confidence: signal.confidence
                });
            }
        }

        this._paperPortfolio.trades.push({ symbol: this.symbol, side, qty: filledQty, requestedQty: sizing.qty, price: fillPrice, fee: fill.fee, latencyMs: fill.latencyMs, timestamp: Date.now() });

        this._stats.tradesExecuted++;
        this._stats.totalDecisions++;
        this._stats.lastTradeTime = Date.now();
        this._lastTradeTime.set(this.symbol, Date.now());
        if (signal.action === 'BUY') this._stats.signalsBuy++;
        else this._stats.signalsSell++;

        this._logDecision('TRADE', signal.action, `[PAPER] ${signal.reason}`, {
            orderId: mockOrder.id, symbol: this.symbol, side,
            qty: filledQty, requestedQty: sizing.qty, price: fillPrice,
            fee: fill.fee, latencyMs: fill.latencyMs, slippagePct: fill.slippagePct,
            paperBalance: this._paperPortfolio.balance.toFixed(2),
            confidence: signal.confidence, agents: signal.agents, status: fill.status
        });

        // Keep _openPositions in sync
        this._openPositions = Object.entries(this._paperPortfolio.positions).map(([sym, pos]) => ({
            symbol: sym, side: pos.side, qty: pos.qty,
            tradeId: pos.tradeId || null,
            entryPrice: pos.entryPrice, currentPrice: fillPrice,
            unrealizedPnl: 0, unrealizedPnlPct: 0,
            marketValue: pos.qty * fillPrice,
            openedAt: pos.openedAt || null,
            regime: pos.regime || null,
            attribution: pos.attribution || null,
        }));
        this._positionCacheTime = 0;

        console.log(`[AutonomousTrader] 📄 PAPER ${side.toUpperCase()} ${filledQty} ${this.symbol} @ $${fillPrice.toFixed(2)} | Balance: $${this._paperPortfolio.balance.toFixed(2)}`);
        return mockOrder;
    }

    /**
     * Sync positions from Alpaca (cached with TTL to reduce API calls)
     */
    async _syncPositions() {
        // In paper mode, sync from in-memory paper portfolio
        if (this.paperMode) {
            this._openPositions = Object.entries(this._paperPortfolio.positions).map(([sym, pos]) => ({
                symbol: sym,
                side: pos.side,
                qty: pos.qty,
                tradeId: pos.tradeId || null,
                entryPrice: pos.entryPrice,
                currentPrice: pos.entryPrice,  // Updated live by _onTradeUpdate when stream available
                unrealizedPnl: 0,
                unrealizedPnlPct: 0,
                marketValue: pos.qty * pos.entryPrice,
                openedAt: pos.openedAt || null,
                regime: pos.regime || null,
                attribution: pos.attribution || null,
            }));
            return;
        }

        // Return cached positions if still fresh
        if (Date.now() - this._positionCacheTime < this._positionCacheTTL) {
            return;
        }

        try {
            const positions = await alpacaService.client.getPositions();
            this._openPositions = positions.map(p => ({
                symbol: p.symbol,
                side: p.side,
                qty: parseFloat(p.qty),
                entryPrice: parseFloat(p.avg_entry_price),
                currentPrice: parseFloat(p.current_price),
                unrealizedPnl: parseFloat(p.unrealized_pl),
                unrealizedPnlPct: parseFloat(p.unrealized_plpc) * 100,
                marketValue: parseFloat(p.market_value)
            }));
            this._positionCacheTime = Date.now();
        } catch (error) {
            // Don't crash the cycle if position sync fails
            console.warn('[AutonomousTrader] Position sync failed:', error.message);
        }
    }

    /**
     * Manage existing position — trailing stop / TP / SL
     */
    async _managePosition(position, currentPrice) {
        // In paper mode, recalculate PnL from live currentPrice (stream not available)
        let pnlPct;
        if (this.paperMode) {
            const entry = position.entryPrice;
            const rawPnl = position.side === 'long'
                ? (currentPrice - entry) * position.qty
                : (entry - currentPrice) * position.qty;
            pnlPct = rawPnl / (entry * position.qty);
        } else {
            pnlPct = position.unrealizedPnlPct / 100;
        }

        const sym = position.symbol;
        const cfg = this._activeTradeConfig;
        const trailingStopPct = cfg.trailingStopPct || 0.03;

        // Time-based exit: close stale positions after maxPositionAgeMs (default 12h)
        const maxAgeMs = this.config.maxPositionAgeMs || 12 * 60 * 60 * 1000;
        const openedAt = position.openedAt || 0;
        if (openedAt && (Date.now() - openedAt) > maxAgeMs) {
            const ageMin = Math.round((Date.now() - openedAt) / 60000);
            this._logDecision('MANAGE', 'TIME_EXIT',
                `Time exit: position open ${ageMin}m (limit ${Math.round(maxAgeMs/60000)}m)`, { position, currentPrice, ageMin });
            this._positionHighWater.delete(sym);
            await this._closePosition(position, 'TIME_EXIT', currentPrice);
            return true;
        }

        // If trade is open >3 hours and in profit, set high-water mark to convert to trailing breakeven instead of TIME_EXIT
        if (openedAt && (Date.now() - openedAt) > (3 * 60 * 60 * 1000) && pnlPct > 0.001) {
            if (!this._positionHighWater.has(sym)) {
                this._positionHighWater.set(sym, pnlPct);
                this._logDecision('MANAGE', 'TRAILING_BREAKEVEN',
                    `Trade open 3h+ and in profit (+${(pnlPct * 100).toFixed(2)}%) — armed Trailing Breakeven Stop instead of TIME_EXIT`,
                    { position, currentPrice, pnlPct });
            }
        }

        // Update high-water mark when position is profitable
        if (pnlPct > 0) {
            const prev = this._positionHighWater.get(sym) || 0;
            if (pnlPct > prev) this._positionHighWater.set(sym, pnlPct);
        }
        const highWater = this._positionHighWater.get(sym) || 0;

        // Breakeven stop: once we've hit 50% of the take-profit target, protect principal
        const breakevenThreshold = cfg.takeProfitPct * 0.5;
        if (highWater >= breakevenThreshold && pnlPct <= 0.001) {
            this._logDecision('MANAGE', 'TRAILING_STOP',
                `Breakeven stop: gave back gains from peak +${(highWater*100).toFixed(1)}%`, { position, currentPrice, highWater });
            this._positionHighWater.delete(sym);
            await this._closePosition(position, 'TRAILING_STOP', currentPrice);
            return true;
        }

        // Trailing stop: fell more than trailingStopPct from the high-water mark
        if (highWater > trailingStopPct && pnlPct < highWater - trailingStopPct) {
            this._logDecision('MANAGE', 'TRAILING_STOP',
                `Trailing stop: peak +${(highWater*100).toFixed(1)}% → now +${(pnlPct*100).toFixed(1)}% (trail ${(trailingStopPct*100).toFixed(0)}%)`, {
                    position, currentPrice, highWater, drop: highWater - pnlPct
                });
            this._positionHighWater.delete(sym);
            await this._closePosition(position, 'TRAILING_STOP', currentPrice);
            return true;
        }

        // Hard take-profit (still useful as a ceiling)
        if (pnlPct >= cfg.takeProfitPct) {
            this._logDecision('MANAGE', 'TAKE_PROFIT',
                `Take profit: +${(pnlPct * 100).toFixed(1)}%`, { position, currentPrice });
            this._positionHighWater.delete(sym);
            await this._closePosition(position, 'TAKE_PROFIT', currentPrice);
            return true;
        }

        // Hard stop loss
        if (pnlPct <= -cfg.stopLossPct) {
            this._logDecision('MANAGE', 'STOP_LOSS',
                `Stop loss: ${(pnlPct * 100).toFixed(1)}%`, { position, currentPrice });
            this._positionHighWater.delete(sym);
            await this._closePosition(position, 'STOP_LOSS', currentPrice);
            return true;
        }

        return false;
    }

    /**
     * Close a position
     */
    async _closePosition(position, reason, fillPriceOverride = null) {
        this._positionHighWater.delete(position.symbol); // always clean up trailing stop state
        // Handle paper mode close
        if (this.paperMode) {
            const pos = this._paperPortfolio.positions[position.symbol];
            if (pos) {
                // position.currentPrice starts at entryPrice in paper mode and only
                // updates on stream ticks — prefer the manage cycle's market price.
                const referencePrice = fillPriceOverride ?? position.currentPrice;
                const closeSide = pos.side === 'long' ? 'sell' : 'buy';
                const fill = paperExecutionSimulator.simulateFill({
                    symbol: position.symbol,
                    side: closeSide,
                    qty: pos.qty,
                    referencePrice,
                    allowPartialFill: false
                });
                if (!fill.accepted) {
                    this._logDecision('PAPER', 'REJECTED', `Paper close rejected: ${fill.reason}`, { reason, fill });
                    this._recordRuntimeLifecycle('position_close', 'rejected', {
                        tradeId: pos.tradeId || null,
                        reason,
                        fill
                    });
                    return null;
                }
                const fillPrice = fill.filledPrice;
                const grossPnl = pos.side === 'long'
                    ? (fillPrice - pos.entryPrice) * pos.qty
                    : (pos.entryPrice - fillPrice) * pos.qty;
                const entryFee = Number(pos.fees || 0);
                const exitFee = Number(fill.fee || 0);
                const pnl = grossPnl - entryFee - exitFee;
                const pnlPct = pnl / (pos.entryPrice * pos.qty);

                // Adaptive signal weight update — teach the library what worked/didn't
                const signalScores = this._signalScoresAtEntry.get(position.symbol);
                if (signalScores) {
                    signalLibrary.recordOutcome(signalScores, pnlPct);
                    this._signalScoresAtEntry.delete(position.symbol);
                }

                // UCB1 strategy outcome — teach mission control which profile performs best
                const entryStrategyId = resolvePositionStrategyId(pos, position, this._getActiveStrategyId());
                missionControlRuntime.recordStrategyOutcome(entryStrategyId, pnlPct, position.regime || this._lastKnownRegime, 'live');

                // A/B test outcome
                const abEntry = this._abTestArmAtEntry.get(position.symbol);
                if (abEntry) {
                    abTestFramework.recordOutcome(abEntry.arm, pos.tradeId || position.symbol, pnlPct * 100);
                    this._abTestArmAtEntry.delete(position.symbol);
                }

                if (pos.side === 'long') {
                    this._paperPortfolio.balance += fillPrice * pos.qty - exitFee;
                } else {
                    this._paperPortfolio.balance -= fillPrice * pos.qty + exitFee;
                }
                this._stats.sessionPnL += pnl;
                this._recordTradeResult(pnl);
                delete this._paperPortfolio.positions[position.symbol];
                this._openPositions = this._openPositions.filter(p => p.symbol !== position.symbol);
                try {
                    tradeLogger.logTradeExit(pos.tradeId || position.symbol, {
                        exitPrice: fillPrice,
                        pnl,
                        pnlPct,
                        exitFee,
                        reason
                    });
                } catch (logErr) {
                    console.warn('[AutonomousTrader] Paper SQLite exit failed:', logErr.message);
                }
                this._recordRuntimeLifecycle('position_close', 'closed', {
                    tradeId: pos.tradeId || null,
                    symbol: position.symbol,
                    side: pos.side,
                    qty: pos.qty,
                    exitPrice: fillPrice,
                    referencePrice,
                    entryFee,
                    exitFee,
                    slippagePct: fill.slippagePct,
                    pnl,
                    pnlPct,
                    reason
                });
                this._logDecision('TRADE', pos.side === 'long' ? 'SELL' : 'BUY',
                    `[PAPER] Closed ${pos.side} ${pos.qty} ${position.symbol} — ${reason} (P&L: $${pnl.toFixed(2)})`, {
                        symbol: position.symbol, pnl, grossPnl, entryFee, exitFee,
                        slippagePct: fill.slippagePct, reason,
                        paperBalance: this._paperPortfolio.balance.toFixed(2),
                        confidence: 1.0, status: 'filled'
                    });
                console.log(`[AutonomousTrader] 📄 PAPER Closed ${position.symbol}: ${reason} (P&L: $${pnl.toFixed(2)}, Balance: $${this._paperPortfolio.balance.toFixed(2)})`);
                flushPerformanceSummaryCache(); // dashboard reflects new P&L immediately
                // Broadcast trade close for WS dashboard notifications
                try {
                    messageBroker.publish('trade.closed', {
                        symbol: position.symbol,
                        side: pos.side,
                        pnl: parseFloat(pnl.toFixed(2)),
                        pnlPct: parseFloat((pnlPct * 100).toFixed(2)),
                        reason,
                        balance: parseFloat(this._paperPortfolio.balance.toFixed(2)),
                        mode: 'paper',
                        timestamp: Date.now(),
                    });
                } catch (_) {}  // non-fatal
            }
            return;
        }

        try {
            const closeSide = position.side === 'long' ? 'sell' : 'buy';

            const order = await alpacaService.client.createOrder({
                symbol: position.symbol,
                qty: position.qty,
                side: closeSide,
                type: 'market',
                time_in_force: 'day'
            });

            // Adaptive signal weight update
            const signalScores = this._signalScoresAtEntry.get(position.symbol);
            if (signalScores && position.unrealizedPnlPct != null) {
                signalLibrary.recordOutcome(signalScores, position.unrealizedPnlPct / 100);
                this._signalScoresAtEntry.delete(position.symbol);
            }

            // UCB1 strategy outcome
            const entryStrategyId = resolvePositionStrategyId(null, position, this._getActiveStrategyId());
            missionControlRuntime.recordStrategyOutcome(entryStrategyId, (position.unrealizedPnlPct || 0) / 100, position.regime || this._lastKnownRegime, 'live');

            // A/B test outcome
            const abEntry = this._abTestArmAtEntry.get(position.symbol);
            if (abEntry) {
                abTestFramework.recordOutcome(abEntry.arm, position.symbol, position.unrealizedPnlPct || 0);
                this._abTestArmAtEntry.delete(position.symbol);
            }

            this._stats.sessionPnL += position.unrealizedPnl;
            this._recordTradeResult(position.unrealizedPnl || 0);

            this._logDecision('TRADE', closeSide.toUpperCase(),
                `Closed ${position.side} ${position.qty} ${position.symbol} — ${reason} (P&L: $${position.unrealizedPnl.toFixed(2)})`, {
                    orderId: order.id,
                    symbol: position.symbol,
                    side: closeSide,
                    qty: position.qty,
                    price: position.currentPrice,
                    pnl: position.unrealizedPnl,
                    reason,
                    confidence: 1.0,
                    status: order.status
                });

            // Log exit to SQLite
            try {
                tradeLogger.logTradeExit(position.symbol, {
                    exitPrice: position.currentPrice,
                    pnl: position.unrealizedPnl,
                    reason
                });
                this._recordRuntimeLifecycle('position_close', 'closed', {
                    symbol: position.symbol,
                    side: position.side,
                    qty: position.qty,
                    exitPrice: position.currentPrice,
                    pnl: position.unrealizedPnl,
                    pnlPct: position.unrealizedPnlPct,
                    reason,
                    orderId: order.id
                });
            } catch (e) { /* non-critical */ }

            console.log(`[AutonomousTrader] 📤 Closed ${position.symbol}: ${reason} (P&L: $${position.unrealizedPnl.toFixed(2)})`);
            flushPerformanceSummaryCache(); // dashboard reflects new P&L immediately;

            // Send notification
            notificationService.sendTradeNotification({
                symbol: position.symbol,
                side: position.side,
                qty: position.qty,
                entryPrice: position.entryPrice,
                exitPrice: position.currentPrice,
                pnl: position.unrealizedPnl,
                pnlPct: position.unrealizedPnlPct,
                reason: reason
            });
        } catch (error) {
            console.error(`[AutonomousTrader] Failed to close position:`, error.message);
        }
    }

    /**
     * Async: poll Alpaca for actual fill price, compute slippage, update SQLite log.
     */
    async _trackFillPrice(orderId, expectedPrice, qty, side) {
        const maxAttempts = 10;
        const pollIntervalMs = 3000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(r => setTimeout(r, pollIntervalMs));
            try {
                const order = await alpacaService.client.getOrder(orderId);
                if (order.filled_avg_price) {
                    const fillPrice = parseFloat(order.filled_avg_price);
                    const slippage = side === 'buy'
                        ? (fillPrice - expectedPrice) / expectedPrice
                        : (expectedPrice - fillPrice) / expectedPrice;
                    const slippagePct = slippage * 100;

                    console.log(`[AutonomousTrader] 📋 Fill confirmed: $${fillPrice.toFixed(2)} (expected $${expectedPrice.toFixed(2)}, slippage ${slippagePct >= 0 ? '+' : ''}${slippagePct.toFixed(3)}%)`);

                    // Update SQLite with real fill
                    try {
                        const attribution = this._tradeAttribution();
                        tradeLogger.logTradeEntry({
                            orderId,
                            symbol: this.symbol,
                            side,
                            qty,
                            entryPrice: expectedPrice,
                            filledPrice: fillPrice,
                            expectedPrice,
                            slippagePct: parseFloat(slippagePct.toFixed(4)),
                            strategy: attribution.strategyId,
                            attribution,
                            regime: this._lastSignal?.regime || null,
                            signalScores: this._signalScoresWithAttribution(this.symbol)
                        });
                    } catch (e) { /* non-critical */ }

                    return;
                }
                // If order is cancelled/rejected, stop polling
                if (['canceled', 'expired', 'rejected'].includes(order.status)) {
                    console.warn(`[AutonomousTrader] Order ${orderId} ended with status: ${order.status}`);
                    return;
                }
            } catch (e) {
                // Polling error — non-critical, just continue
            }
        }
        console.warn(`[AutonomousTrader] Could not confirm fill for order ${orderId} after ${maxAttempts} attempts`);
    }

    /**
     * Watchdog: detect stalled trading loop
     */
    _checkHeartbeat() {
        if (!this.isRunning) return;

        const lastAnalysis = this._stats.lastAnalysisTime;
        if (!lastAnalysis) return; // First cycle hasn't completed yet

        const elapsed = Date.now() - lastAnalysis;
        const threshold = this.config.analysisIntervalMs * 3;

        if (elapsed > threshold) {
            const staleSec = Math.round(elapsed / 1000);
            console.error(`[AutonomousTrader] 🚨 WATCHDOG: Trading loop stalled! Last cycle was ${staleSec}s ago (threshold: ${Math.round(threshold / 1000)}s)`);
            this._logDecision('SYSTEM', 'WATCHDOG', `Trading loop stalled — ${staleSec}s since last cycle`, { elapsed, threshold });

            // Attempt recovery: restart the interval
            try {
                clearInterval(this._loopTimer);
                this._loopTimer = setInterval(() => {
                    this._runCycle().catch(err => {
                        console.error('[AutonomousTrader] Cycle error:', err.message);
                        this._stats.errors++;
                    });
                }, this.config.analysisIntervalMs);
                console.log('[AutonomousTrader] ♻️ Watchdog restarted the trading loop interval');
                this._logDecision('SYSTEM', 'RECOVERY', 'Watchdog restarted trading loop interval');
            } catch (e) {
                console.error('[AutonomousTrader] Watchdog recovery failed:', e.message);
            }
        }
    }

    _recordRuntimeLifecycle(stage, status = 'info', payload = {}) {
        missionControlRuntime.recordLifecycle({
            lifecycleId: this._runtimeSessionId,
            symbol: this.symbol,
            stage,
            actor: 'AutonomousTrader',
            status,
            payload
        });
    }

    /**
     * Log a decision to the ring buffer (O(1) insert)
     */
    _logDecision(category, action, reason, data = {}) {
        const decision = {
            id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            category,    // SYSTEM, SIGNAL, TRADE, RISK, GUARDRAIL, MANAGE, DATA, ERROR, COOLDOWN, SIZING, ANALYSIS
            action,      // START, STOP, BUY, SELL, HOLD, SKIP, BLOCKED, FAIL, TAKE_PROFIT, STOP_LOSS
            reason,      // Human-readable explanation
            symbol: this.symbol,
            ...data
        };

        this._decisions[this._decisionHead] = decision;
        this._decisionHead = (this._decisionHead + 1) % this._decisions.length;
        this._decisionCount++;
        // Track last non-HOLD blocking reason for UI status display
        if (['SKIP', 'BLOCKED', 'FAIL', 'WARN'].includes(action) && category !== 'SYSTEM') {
            this._lastBlockReason = { category, action, reason, timestamp: decision.timestamp };
        }
        try {
            const evidence = marketEvidenceStore.append('autonomous_decision', decision, {
                source: 'AutonomousTrader',
                symbol: this.symbol,
                strategyId: data.strategy || this._getActiveStrategyId(),
                parentEvidenceIds: data.evidenceIds || data.parentEvidenceIds || []
            });
            decision.evidenceId = evidence.evidenceId;
        } catch {
            // Evidence logging must never block trading decisions.
        }
    }

    _getActiveStrategyId() {
        return resolveActiveStrategyId({
            strategySelectionMode: this.strategySelectionMode,
            preset: this.preset,
            runtimeProfile: this._runtimeProfile,
            config: this.config
        });
    }

    _tradeAttribution() {
        const active = this._runtimeProfile?.activeStrategy || {};
        const strategyId = this._getActiveStrategyId();
        return {
            strategyId,
            strategySource: active.source || (this.preset ? 'manual_override' : 'mission_control'),
            strategyState: active.state || null,
            strategyAction: active.action || null,
            candidateId: active.candidateId || active.sourceEntryId || null,
            candidateKey: active.candidateKey || (strategyId && this.symbol ? `${strategyId}:${this.symbol}` : null),
            compiledStrategyId: active.compiledStrategyId || active.compiledStrategy?.id || null,
            runtimeSymbol: active.symbol || this.symbol,
            selectedAt: active.learnedAt || null
        };
    }

    _signalScoresWithAttribution(symbol = this.symbol) {
        const scores = this._signalScoresAtEntry.get(symbol) || {};
        return {
            ...(scores && typeof scores === 'object' ? scores : { rawSignalScores: scores }),
            attribution: this._tradeAttribution()
        };
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            symbol: this.symbol,
            preset: this.preset,
            paperMode: this.paperMode,
            paperPortfolio: this.paperMode && this._paperPortfolio ? {
                balance: this._paperPortfolio.balance,
                positionCount: Object.keys(this._paperPortfolio.positions).length,
                tradeCount: this._paperPortfolio.trades.length,
                positions: this._paperPortfolio.positions
            } : null,
            config: this.config,
            stats: {
                ...this._stats,
                rollingWinRate: this._recentTrades.length >= 5
                    ? this._recentTrades.filter(t => t.isWin).length / this._recentTrades.length
                    : null,
                rollingTradeCount: this._recentTrades.length,
                kellyActive: (this._stats.wins + this._stats.losses) >= 10,
                // pre-computed so frontend never needs to derive
                profitFactor: this._stats.grossLosses > 0
                    ? parseFloat((this._stats.grossWins / this._stats.grossLosses).toFixed(3))
                    : null,
                winRatePct: (this._stats.wins + this._stats.losses) >= 5
                    ? parseFloat(((this._stats.wins / (this._stats.wins + this._stats.losses)) * 100).toFixed(1))
                    : null,
            },
            openPositions: [...this._openPositions],
            uptime: this._stats.sessionStartTime ? Date.now() - this._stats.sessionStartTime : 0,
            // Per-agent confidence from latest signal
            agentConfidences: this._lastSignal?.agents || null,
            lastSignal: this._lastSignal ? {
                action: this._lastSignal.action,
                confidence: this._lastSignal.confidence,
                recommendation: this._lastSignal.recommendation,
                regime: this._lastSignal.regime || this._lastKnownRegime,
                reason: this._lastSignal.reason,
                timestamp: this._lastSignal.timestamp
            } : null,
            lastBlockReason: this._lastBlockReason || null,
            // Full per-signal breakdown from SignalLibrary (9 signals with scores + reasons)
            signalBreakdown: this._lastSignalBreakdown,
            // Adaptive signal weights (learned from outcomes)
            signalWeights: signalLibrary.getWeights(),
            signalLibraryStats: signalLibrary.getStats(),
            // Active trade config (ATR-based, changes each cycle)
            activeTradeConfig: this._activeTradeConfig,
            missionControlRuntime: missionControlRuntime.getStatus(),
            runtimeProfile: this._runtimeProfile,
            performanceGuard: this._performanceGuardVerdict || tradingPerformanceGuard.evaluate({
                symbol: this.symbol,
                strategyId: this._getActiveStrategyId(),
                since: missionControlRuntime.getEvidenceWindow?.() || null
            }),
            guardrailsState: global.SOMA_TRADING?.guardrails?.getStatus() || null
        };
    }

    /**
     * Get decision log (reads from ring buffer, newest first)
     */
    getDecisions(limit = 50) {
        const size = this._decisions.length;
        const total = Math.min(this._decisionCount, size);
        const result = [];
        for (let i = 0; i < Math.min(limit, total); i++) {
            const idx = (this._decisionHead - 1 - i + size) % size;
            if (this._decisions[idx]) result.push(this._decisions[idx]);
        }
        return result;
    }

    /**
     * Update config while running
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this._logDecision('SYSTEM', 'CONFIG', `Config updated`, { config: this.config });
        return this.config;
    }

    /**
     * Hot-apply a runtime execution profile to the RUNNING engine (Strategy Hunt
     * rotation). Replaces the boot-time _runtimeProfile snapshot so strategy
     * attribution follows the rotation, then merges the tier-clamped config.
     * initialBalance/paperMode are not part of profile.config, so the paper
     * portfolio is untouched.
     */
    applyRuntimeProfile(profile) {
        if (!profile?.config) return this.config;
        this._runtimeProfile = profile;
        this.config = { ...this.config, ...profile.config };
        const label = profile.activeStrategy?.strategyId || profile.preset || 'unknown';
        this._logDecision('SYSTEM', 'STRATEGY_ROTATE', `Strategy Hunt hot-applied ${label} to running engine`, {
            strategyId: label,
            config: profile.config
        });
        return this.config;
    }
}

// Singleton (kept for backward compat — autonomousRoutes uses the registry instead)
const autonomousTrader = new AutonomousTrader();
export { AutonomousTrader };
export default autonomousTrader;
