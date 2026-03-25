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
import notificationService from '../services/NotificationService.js';

class AutonomousTrader {
    constructor() {
        this.isRunning = false;
        this.symbol = null;
        this.preset = null;
        this.config = {
            analysisIntervalMs: 60000,   // Run analysis every 60s
            maxPositionPct: 0.10,        // Max 10% of equity per position
            minConfidence: 0.55,         // Minimum strategy confidence to trade
            maxOpenPositions: 3,         // Max concurrent positions
            cooldownMs: 120000,          // 2 min cooldown between trades on same symbol
            maxSessionDrawdownPct: 0.05, // 5% max session drawdown -> auto-stop
            trailingStopPct: 0.03,       // 3% trailing stop
            takeProfitPct: 0.06,         // 6% take-profit
            stopLossPct: 0.02,           // 2% stop-loss
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
        this._lastStreamPrice = 0;       // Real-time price from WebSocket
        this._analysisTimeoutMs = 15_000; // 15s timeout for AI analysis

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
        };
    }

    /**
     * Start the autonomous trading loop
     */
    async start(symbol, preset = null, config = {}) {
        if (this.isRunning) {
            return { success: false, error: 'Already running. Stop first.' };
        }

        if (!alpacaService.isConnected) {
            this.paperMode = true;
            this._paperPortfolio = { balance: 100000, positions: {}, trades: [] };
            console.log('[AutonomousTrader] 📄 Alpaca not connected — starting in PAPER MODE ($100k virtual)');
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
            'CONSERVATIVE':        { minConfidence: 0.75, maxPositionPct: 0.05, takeProfitPct: 0.04, stopLossPct: 0.01, cooldownMs: 300000 },
            'BTC_NATIVE':          { minConfidence: 0.60, maxPositionPct: 0.15, takeProfitPct: 0.08, stopLossPct: 0.03, cooldownMs: 180000 },
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

        this.isRunning = true;
        this._stats.sessionStartTime = Date.now();
        this._stats.sessionPnL = 0;
        global.__SOMA_TRADING_ACTIVE = true; // Signal to background tasks to yield Gemini quota

        this._logDecision('SYSTEM', 'START', `Autonomous trading started for ${symbol}`, {
            preset, config: this.config
        });

        console.log(`[AutonomousTrader] 🚀 Started for ${symbol} (interval: ${this.config.analysisIntervalMs}ms)`);

        // Connect to WebSocket Stream for real-time exits (skip in paper mode)
        if (!this.paperMode) {
            try {
                alpacaService.connectStream([symbol], (trade) => this._onTradeUpdate(trade));
            } catch (streamErr) {
                console.warn('[AutonomousTrader] Stream connection failed:', streamErr.message);
            }
        }

        // Fire first cycle immediately (don't await — return to caller fast)
        this._runCycle().catch(err => {
            console.error('[AutonomousTrader] First cycle error (non-fatal):', err.message);
            this._stats.errors++;
        });

        // Schedule recurring cycles
        this._loopTimer = setInterval(() => {
            this._runCycle().catch(err => {
                console.error('[AutonomousTrader] Cycle error:', err.message);
                this._stats.errors++;
            });
        }, this.config.analysisIntervalMs);

        // Watchdog: detect stalled trading loop
        this._watchdogTimer = setInterval(() => {
            this._checkHeartbeat();
        }, this.config.analysisIntervalMs * 2);

        return { success: true, symbol, config: this.config };
    }

    /**
     * Stop the autonomous trading loop
     */
    stop() {
        if (!this.isRunning) return { success: false, error: 'Not running.' };

        clearInterval(this._loopTimer);
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
                    ? 100000  // Paper mode: check against initial virtual balance
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
            const [barsResult, positionsResult, regimeResult] = await Promise.allSettled([
                marketDataService.getBars(this.symbol, '5Min', 100),
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

            const quality = marketDataService.validateDataQuality(bars);

            if (!quality.valid) {
                this._logDecision('DATA', 'SKIP', `Data quality check failed: ${quality.issues.join('; ')}`, { quality });
                return;
            }

            // Warn when making decisions on stale/cached data
            const hasCachedBars = bars.some(b => b.isCached);
            if (hasCachedBars) {
                const ageMs = Date.now() - (bars[bars.length - 1].timestamp || 0);
                console.warn(`[AutonomousTrader] ⚠️ Using cached market data (${Math.round(ageMs / 1000)}s old) for ${this.symbol}`);
            }

            const latestBar = bars[bars.length - 1];
            const currentPrice = latestBar.close;

            // 3. Find existing position (already synced in parallel step)
            const existingPosition = this._openPositions.find(p => p.symbol === this.symbol);

            // 4. Manage existing position (trailing stop / take-profit)
            if (existingPosition) {
                const managed = await this._managePosition(existingPosition, currentPrice);
                if (managed) return; // Position was closed, skip new analysis
            }

            // 5. Run AI analysis (rate-limited)
            analysis = await this._getAnalysis(this.symbol);

            if (!analysis) {
                this._logDecision('ANALYSIS', 'SKIP', 'AI analysis unavailable or rate-limited');
                return;
            }

            // 6. Generate signal (Regime-Aware)
            signal = this._generateSignal(analysis, currentPrice, bars, currentRegime);

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

            // 11. Calculate position size (Regime-Aware)
            const sizing = await this._calculatePositionSize(currentPrice, currentRegime);
            if (!sizing || sizing.qty <= 0) {
                this._logDecision('SIZING', 'SKIP', 'Position size too small or account insufficient', { sizing });
                return;
            }

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
                    return;
                }
            }

            // 14. EXECUTE THE TRADE
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
     * Run AI swarm analysis (with rate limiting + timeout)
     */
    async _getAnalysis(symbol) {
        try {
            // Use the existing FinanceAgentArbiter via the internal route
            const arbiter = global.SOMA?.financeArbiter;
            if (arbiter && typeof arbiter.analyzeStock === 'function') {
                const result = await Promise.race([
                    arbiter.analyzeStock(symbol),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Analysis timed out')), this._analysisTimeoutMs)
                    )
                ]);
                return result;
            }

            // Fallback: call the HTTP endpoint internally (with AbortController timeout)
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this._analysisTimeoutMs);
            const response = await fetch(`http://localhost:${process.env.PORT || 3001}/api/finance/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol }),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.analysis) return data.analysis;
            }

            return null;
        } catch (error) {
            const isTimeout = error.message.includes('timed out') || error.name === 'AbortError';
            console.warn(`[AutonomousTrader] Analysis ${isTimeout ? 'timed out' : 'failed'} (${this._analysisTimeoutMs / 1000}s limit):`, error.message);
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
                 // Use a short timeout so we don't block
                 return await Promise.race([
                     detector.getRegime(this.symbol),
                     new Promise(r => setTimeout(() => r(null), 2000))
                 ]);
             } catch (e) { return null; }
        }
        return detector?.currentRegime || null;
    }

    /**
     * Generate trading signal from AI analysis + Technicals + Regime
     */
    _generateSignal(analysis, currentPrice, bars, regime = null) {
        const { strategy, risk, sentiment, quant } = analysis;

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

        // Composite confidence = weighted average of all agents
        const compositeConfidence = (
            strategyConfidence * 0.35 +
            riskScore * 0.20 +
            sentimentScore * 0.25 +
            (this._getTechnicalSignal(bars, currentPrice) * 0.20)
        );

        // Determine action
        let action = 'HOLD';
        let reason = '';

        // Dynamic threshold based on regime
        let threshold = this.config.minConfidence;
        if (regime === 'VOLATILE') threshold += 0.10; // Require higher confidence in volatile markets

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

        // Store latest signal so status endpoint can expose agent confidences
        this._lastSignal = signalResult;

        return signalResult;
    }

    /**
     * Simple technical signal from price action (0-1, where >0.5 = bullish)
     */
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
     * Calculate position size based on account equity and risk (Regime-Aware)
     */
    async _calculatePositionSize(currentPrice, regime = null) {
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

            // Regime Adjustments
            let maxPct = this.config.maxPositionPct;
            if (regime === 'VOLATILE') maxPct *= 0.5; // Half size in volatile markets
            if (regime === 'TRENDING_BULL' || regime === 'TRENDING_BEAR') maxPct *= 1.2; // Increase size in strong trends

            // Position = maxPositionPct of equity
            const maxValue = equity * maxPct;
            const maxQty = Math.floor(maxValue / currentPrice);

            // Also check buying power
            const bpQty = Math.floor((buyingPower * 0.9) / currentPrice); // Use 90% of BP
            const qty = Math.min(maxQty, bpQty);

            // For crypto, allow fractional
            const isCrypto = this.symbol.includes('-') || this.symbol.includes('USDT');
            const finalQty = isCrypto ? Math.min(maxValue / currentPrice, bpQty) : qty;

            return {
                qty: isCrypto ? parseFloat(finalQty.toFixed(6)) : Math.max(1, finalQty),
                maxValue,
                equity,
                buyingPower,
                riskPct: maxPct // Use the adjusted percentage
            };
        } catch (error) {
            console.error('[AutonomousTrader] Position sizing error:', error.message);
            return null;
        }
    }

    /**
     * Execute the trade via Alpaca
     */
    async _executeTrade(signal, sizing, currentPrice, analysis) {
        // Route to paper execution if Alpaca not connected
        if (this.paperMode) {
            return this._executePaperOrder(signal, sizing, currentPrice);
        }

        const side = signal.action.toLowerCase(); // 'buy' or 'sell'

        try {
            // Calculate SL/TP prices
            const stopLossPrice = side === 'buy'
                ? currentPrice * (1 - this.config.stopLossPct)
                : currentPrice * (1 + this.config.stopLossPct);

            const takeProfitPrice = side === 'buy'
                ? currentPrice * (1 + this.config.takeProfitPct)
                : currentPrice * (1 - this.config.takeProfitPct);

            console.log(`[AutonomousTrader] 📊 Executing ${side.toUpperCase()} ${sizing.qty} ${this.symbol} @ ~$${currentPrice.toFixed(2)}`);
            console.log(`[AutonomousTrader] SL: $${stopLossPrice.toFixed(2)}, TP: $${takeProfitPrice.toFixed(2)}`);

            // Use Marketable Limit Order for better execution safety (slippage protection)
            // Buy: Limit = Current + 0.2%
            // Sell: Limit = Current - 0.2%
            // This ensures we don't buy at +5% in a flash spike
            const slippageTolerance = 0.002;
            const limitPrice = side === 'buy'
                 ? currentPrice * (1 + slippageTolerance)
                 : currentPrice * (1 - slippageTolerance);

            // Try bracket order first (marketable limit + SL + TP)
            let order;
            try {
                order = await alpacaService.client.createOrder({
                    symbol: this.symbol.replace('-', '/'), // BTC-USD -> BTC/USD for crypto
                    qty: sizing.qty,
                    side: side,
                    type: 'limit',
                    limit_price: limitPrice.toFixed(2),
                    time_in_force: 'gtc',
                    order_class: 'bracket',
                    stop_loss: { stop_price: stopLossPrice.toFixed(2) },
                    take_profit: { limit_price: takeProfitPrice.toFixed(2) }
                });
            } catch (bracketErr) {
                // Bracket orders not supported for all assets — fallback to simple marketable limit order
                console.warn(`[AutonomousTrader] Bracket order failed (${bracketErr.message}), using simple marketable limit order`);
                order = await alpacaService.client.createOrder({
                    symbol: this.symbol.replace('-', '/'),
                    qty: sizing.qty,
                    side: side,
                    type: 'limit',
                    limit_price: limitPrice.toFixed(2),
                    time_in_force: side === 'buy' ? 'gtc' : 'day'
                });
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
                tradeLogger.logTradeEntry({
                    orderId: order.id,
                    symbol: this.symbol,
                    side: side,
                    qty: sizing.qty,
                    entryPrice: currentPrice,
                    filledPrice: order.filled_avg_price || null,
                    expectedPrice: currentPrice,
                    slippagePct: null,
                    strategy: this.preset || 'autonomous',
                    regime: this._lastSignal?.regime || null
                });
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
            console.error(`[AutonomousTrader] ❌ Trade execution failed:`, error.message);
            return null;
        }
    }

    /**
     * Simulate a trade fill in paper mode (no real money, tracks virtual portfolio)
     */
    async _executePaperOrder(signal, sizing, currentPrice) {
        const side = signal.action.toLowerCase();
        // Apply tiny simulated slippage (0.1%)
        const fillPrice = side === 'buy'
            ? currentPrice * 1.001
            : currentPrice * 0.999;
        const cost = fillPrice * sizing.qty;

        if (side === 'buy' && cost > this._paperPortfolio.balance) {
            this._logDecision('PAPER', 'SKIP', `Insufficient virtual balance ($${this._paperPortfolio.balance.toFixed(2)} < $${cost.toFixed(2)})`);
            return null;
        }

        // Update paper portfolio
        if (side === 'buy') {
            this._paperPortfolio.balance -= cost;
            this._paperPortfolio.positions[this.symbol] = { side: 'long', qty: sizing.qty, entryPrice: fillPrice };
        } else {
            const pos = this._paperPortfolio.positions[this.symbol];
            if (pos && pos.side === 'long') {
                // Close long
                const pnl = (fillPrice - pos.entryPrice) * pos.qty;
                this._paperPortfolio.balance += fillPrice * pos.qty;
                this._stats.sessionPnL += pnl;
                delete this._paperPortfolio.positions[this.symbol];
            } else {
                // Open short
                this._paperPortfolio.balance += fillPrice * sizing.qty;
                this._paperPortfolio.positions[this.symbol] = { side: 'short', qty: sizing.qty, entryPrice: fillPrice };
            }
        }

        const mockOrder = { id: `paper_${Date.now()}`, status: 'filled', filled_avg_price: fillPrice.toFixed(2) };
        this._paperPortfolio.trades.push({ symbol: this.symbol, side, qty: sizing.qty, price: fillPrice, timestamp: Date.now() });

        this._stats.tradesExecuted++;
        this._stats.totalDecisions++;
        this._stats.lastTradeTime = Date.now();
        this._lastTradeTime.set(this.symbol, Date.now());
        if (signal.action === 'BUY') this._stats.signalsBuy++;
        else this._stats.signalsSell++;

        this._logDecision('TRADE', signal.action, `[PAPER] ${signal.reason}`, {
            orderId: mockOrder.id, symbol: this.symbol, side,
            qty: sizing.qty, price: fillPrice,
            paperBalance: this._paperPortfolio.balance.toFixed(2),
            confidence: signal.confidence, agents: signal.agents, status: 'filled'
        });

        // Keep _openPositions in sync
        this._openPositions = Object.entries(this._paperPortfolio.positions).map(([sym, pos]) => ({
            symbol: sym, side: pos.side, qty: pos.qty,
            entryPrice: pos.entryPrice, currentPrice: fillPrice,
            unrealizedPnl: 0, unrealizedPnlPct: 0,
            marketValue: pos.qty * fillPrice
        }));
        this._positionCacheTime = 0;

        console.log(`[AutonomousTrader] 📄 PAPER ${side.toUpperCase()} ${sizing.qty} ${this.symbol} @ $${fillPrice.toFixed(2)} | Balance: $${this._paperPortfolio.balance.toFixed(2)}`);
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
                entryPrice: pos.entryPrice,
                currentPrice: pos.entryPrice,  // Updated live by _onTradeUpdate when stream available
                unrealizedPnl: 0,
                unrealizedPnlPct: 0,
                marketValue: pos.qty * pos.entryPrice
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

        // Take profit hit
        if (pnlPct >= this.config.takeProfitPct) {
            this._logDecision('MANAGE', 'TAKE_PROFIT',
                `Taking profit on ${position.symbol}: +${(pnlPct * 100).toFixed(1)}% ($${position.unrealizedPnl.toFixed(2)})`, {
                    position, currentPrice
                });
            await this._closePosition(position, 'TAKE_PROFIT');
            return true;
        }

        // Stop loss hit
        if (pnlPct <= -this.config.stopLossPct) {
            this._logDecision('MANAGE', 'STOP_LOSS',
                `Stop loss triggered on ${position.symbol}: ${(pnlPct * 100).toFixed(1)}% ($${position.unrealizedPnl.toFixed(2)})`, {
                    position, currentPrice
                });
            await this._closePosition(position, 'STOP_LOSS');
            return true;
        }

        return false;
    }

    /**
     * Close a position
     */
    async _closePosition(position, reason) {
        // Handle paper mode close
        if (this.paperMode) {
            const pos = this._paperPortfolio.positions[position.symbol];
            if (pos) {
                const fillPrice = position.currentPrice;
                const pnl = pos.side === 'long'
                    ? (fillPrice - pos.entryPrice) * pos.qty
                    : (pos.entryPrice - fillPrice) * pos.qty;
                this._paperPortfolio.balance += fillPrice * pos.qty;
                this._stats.sessionPnL += pnl;
                delete this._paperPortfolio.positions[position.symbol];
                this._openPositions = this._openPositions.filter(p => p.symbol !== position.symbol);
                this._logDecision('TRADE', pos.side === 'long' ? 'SELL' : 'BUY',
                    `[PAPER] Closed ${pos.side} ${pos.qty} ${position.symbol} — ${reason} (P&L: $${pnl.toFixed(2)})`, {
                        symbol: position.symbol, pnl, reason,
                        paperBalance: this._paperPortfolio.balance.toFixed(2),
                        confidence: 1.0, status: 'filled'
                    });
                console.log(`[AutonomousTrader] 📄 PAPER Closed ${position.symbol}: ${reason} (P&L: $${pnl.toFixed(2)}, Balance: $${this._paperPortfolio.balance.toFixed(2)})`);
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

            this._stats.sessionPnL += position.unrealizedPnl;

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
                tradeLogger.logTradeExit({
                    symbol: position.symbol,
                    exitPrice: position.currentPrice,
                    pnl: position.unrealizedPnl,
                    reason
                });
            } catch (e) { /* non-critical */ }

            console.log(`[AutonomousTrader] 📤 Closed ${position.symbol}: ${reason} (P&L: $${position.unrealizedPnl.toFixed(2)})`);

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
                        tradeLogger.logTradeEntry({
                            orderId,
                            symbol: this.symbol,
                            side,
                            qty,
                            entryPrice: expectedPrice,
                            filledPrice: fillPrice,
                            expectedPrice,
                            slippagePct: parseFloat(slippagePct.toFixed(4)),
                            strategy: this.preset || 'autonomous',
                            regime: this._lastSignal?.regime || null
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
            stats: { ...this._stats },
            openPositions: [...this._openPositions],
            uptime: this._stats.sessionStartTime ? Date.now() - this._stats.sessionStartTime : 0,
            // Per-agent confidence from latest signal
            agentConfidences: this._lastSignal?.agents || null,
            lastSignal: this._lastSignal ? {
                action: this._lastSignal.action,
                confidence: this._lastSignal.confidence,
                recommendation: this._lastSignal.recommendation,
                timestamp: this._lastSignal.timestamp
            } : null,
            guardrailsState: this.guardrails?.getStatus() || null
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
}

// Singleton
const autonomousTrader = new AutonomousTrader();
export default autonomousTrader;
