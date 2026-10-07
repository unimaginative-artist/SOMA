/**
 * SomaBeeTradingEngine.js
 *
 * Multi-Agent System 1 Algorithmic Trading Engine for SOMA.
 * Inspired by BeeBots (TypeSafe AI Jev) and driven by local Laya ModernBERT on RTX 5070.
 *
 * Strategies:
 *  - bizzy: Larry Williams Dual Thrust Breakout
 *  - boozy: Bollinger Bands & RSI Mean Reversion
 *  - breezy: Multi-Factor Trend & Funding Rate Carry
 *
 * Features:
 *  - Real-time OKX public market ingestion
 *  - Zero API fees, 100% paper execution with hard code-level risk controls
 *  - Fixed 1R risk sizing ($1,000 portfolio pool, $333/bee)
 *  - ATR-based hard stop losses & trailing profit targets
 *  - Persistent JSON ledger with R-multiple accounting
 */

import fs from 'fs';
import path from 'path';
import { BeeMarketFeed } from './BeeMarketFeed.js';
import { BeeSwarmBroker } from './BeeSwarmBroker.js';
import { BeeRegimeAdapter } from './BeeRegimeAdapter.js';
import { BeeLearningBridge } from './BeeLearningBridge.js';
import enterpriseRiskGate from './EnterpriseRiskGate.js';
import autonomicTuner from './BeeAutonomicTuner.js';
import tradeLogger from '../finance/TradeLogger.js';
import beePrometheusBridge from './BeePrometheusBridge.js';
import { paperEntryCosts, paperNetPnl, PAPER_TAKER_FEE_RATE, PAPER_SLIPPAGE_RATE } from './BeePaperExecutionCosts.js';

const SYSTEM1_ENDPOINT = process.env.SOMA_SYSTEM1_URL || 'http://127.0.0.1:5055/predict/trading_decision';
const DEFAULT_LEDGER_FILE = path.join(process.cwd(), 'data', 'trading', 'soma_bee_ledger.json');

export const BEE_CONFIGS = {
    bizzy: {
        id: 'bizzy',
        name: 'Bizzy Bee',
        style: 'Breakout & Dual Thrust Momentum',
        emoji: '⚡',
        targetPair: 'BTC-USDT-SWAP',
        strategyPrompt: 'bizzy: Larry Williams Dual Thrust breakout strategy. Enter LONG when price surges above buy breakout resistance. Enter SHORT on breakdown below support. HOLD if consolidating inside the range.',
        menu: {
            LONG: 'Enter long on upside breakout above resistance',
            SHORT: 'Enter short on downside breakdown below support',
            HOLD: 'Consolidating inside range, do not enter',
            CLOSE: 'Exit open position immediately'
        }
    },
    boozy: {
        id: 'boozy',
        name: 'Boozy Bee',
        style: 'Mean-Reversion & Band Fade',
        emoji: '🍸',
        targetPair: 'ETH-USDT-SWAP',
        strategyPrompt: 'boozy: Statistical mean-reversion. Fade overbought extremes (RSI > 70 or %B > 0.9 -> SHORT). Fade oversold extremes (RSI < 30 or %B < 0.1 -> LONG). HOLD when near fair value.',
        menu: {
            LONG: 'Fade oversold extreme with long bounce',
            SHORT: 'Fade overbought extreme with short fade',
            HOLD: 'Price is near fair value, maintain current stance',
            CLOSE: 'Target reached or mean reverted, exit position'
        }
    },
    breezy: {
        id: 'breezy',
        name: 'Breezy Bee',
        style: 'Multi-Factor Trend & Carry',
        emoji: '🍃',
        targetPair: 'SOL-USDT-SWAP',
        strategyPrompt: 'breezy: Multi-factor trend following with funding rate carry. Follow established 24h momentum when aligned with favorable funding sentiment. HOLD during chop.',
        menu: {
            LONG: 'Ride bullish trend with positive funding edge',
            SHORT: 'Ride bearish trend or short crowded long funding',
            HOLD: 'Trend unclear or choppy, stay flat',
            CLOSE: 'Trend exhausted or reversing, cut risk'
        }
    }
};

export class SomaBeeTradingEngine {
    constructor(options = {}) {
        this.feed = options.feed || new BeeMarketFeed();
        this.ledgerPath = options.ledgerPath || DEFAULT_LEDGER_FILE;
        this.system1Url = options.system1Url || SYSTEM1_ENDPOINT;
        this.minConviction = options.minConviction ?? 2; // 0: None, 1: Weak, 2: Moderate, 3: Strong
        this.riskPerTradePct = options.riskPerTradePct || 0.02; // 2% of allocated bee equity
        this.maxLeverage = options.maxLeverage || 5.0;

        // Swarm Neural Components
        this.swarmBroker = options.swarmBroker || new BeeSwarmBroker();
        this.regimeAdapter = options.regimeAdapter || new BeeRegimeAdapter();
        this.learningBridge = options.learningBridge || new BeeLearningBridge();
        this.riskGate = options.riskGate || enterpriseRiskGate;
        this.autonomicTuner = options.autonomicTuner || autonomicTuner;
        this.tradeLogger = options.tradeLogger !== undefined ? options.tradeLogger : tradeLogger;
        this.prometheusBridge = options.prometheusBridge || beePrometheusBridge;

        this.listeners = {
            onTradeOpen: [],
            onTradeClose: [],
            onTick: [],
            onError: []
        };

        this.state = this._loadLedger();
        if (this.state && this.state.autonomicTuning) {
            this.autonomicTuner.loadState(this.state.autonomicTuning);
        }
        this.prometheusBridge?.applyParametersToSwarm?.(this);
    }

    /**
     * Subscribe to engine events
     */
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    _emit(event, data) {
        if (this.listeners[event]) {
            for (const cb of this.listeners[event]) {
                try { cb(data); } catch (err) { console.error(`Error in event listener ${event}:`, err); }
            }
        }
    }

    /**
     * Initialize or load existing ledger
     */
    _loadLedger() {
        try {
            if (fs.existsSync(this.ledgerPath)) {
                const data = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf8'));
                if (data && data.bees) return data;
            }
        } catch (e) {
            console.warn(`[SomaBeeEngine] Could not load ledger from ${this.ledgerPath}, creating fresh ledger.`);
        }

        const fresh = {
            createdAt: new Date().toISOString(),
            totalInitialCapital: 1000.0,
            bees: {
                bizzy: {
                    cash: 333.33,
                    equity: 333.33,
                    position: null, // { side, size, entryPrice, stopLoss, takeProfit, entryTime, atr, conviction }
                    realizedPnl: 0.0,
                    tradesCount: 0,
                    winCount: 0,
                    lossCount: 0
                },
                boozy: {
                    cash: 333.33,
                    equity: 333.33,
                    position: null,
                    realizedPnl: 0.0,
                    tradesCount: 0,
                    winCount: 0,
                    lossCount: 0
                },
                breezy: {
                    cash: 333.34,
                    equity: 333.34,
                    position: null,
                    realizedPnl: 0.0,
                    tradesCount: 0,
                    winCount: 0,
                    lossCount: 0
                }
            },
            closedTrades: [],
            lastUpdated: new Date().toISOString()
        };

        this._saveLedger(fresh);
        return fresh;
    }

    _saveLedger(state = this.state) {
        try {
            const dir = path.dirname(this.ledgerPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            state.lastUpdated = new Date().toISOString();
            fs.writeFileSync(this.ledgerPath, JSON.stringify(state, null, 2), 'utf8');
        } catch (err) {
            console.error('[SomaBeeEngine] Failed to save ledger:', err);
        }
    }

    /**
     * Query Laya System 1 model for decision
     */
    async askLaya(beeKey, marketState) {
        const config = BEE_CONFIGS[beeKey];
        if (!config) throw new Error(`Unknown bee: ${beeKey}`);

        const payload = {
            strategy: config.strategyPrompt,
            strategy_parameters: this.autonomicTuner?.getBeeAdjustments(beeKey) || {},
            state: {
                pair: marketState.instId,
                price: marketState.price,
                return_1h: `${marketState.return_1h_pct}%`,
                return_24h: `${marketState.return_24h_pct}%`,
                trend_return: `${marketState.trend_return_pct ?? marketState.return_24h_pct}%`,
                rsi: marketState.rsi_14,
                bollinger_pct_b: marketState.bollinger.percent_b,
                bollinger_width: `${marketState.bollinger.width_pct}%`,
                atr_pct: `${marketState.atr_pct}%`,
                funding_rate: `${marketState.funding.rate_pct}%`,
                funding_bias: marketState.funding.bias,
                htf_trend: marketState.htfTrend || 'RANGING',
                larry_williams_status: marketState.larry_williams.status
            },
            menu: config.menu,
            conviction_labels: ['none', 'weak', 'moderate', 'strong']
        };

        const res = await fetch(this.system1Url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error(`System 1 HTTP ${res.status}: ${await res.text()}`);
        }

        return await res.json();
    }

    /**
     * Query Laya System 1 model in a single batch across all bees
     */
    async askLayaBatch(snapshots) {
        const batchUrl = this.system1Url.replace('/predict/trading_decision', '/predict/trading_batch');
        const beesPayload = {};

        for (const beeKey of ['bizzy', 'boozy', 'breezy']) {
            const config = BEE_CONFIGS[beeKey];
            const marketState = snapshots[config.targetPair];
            if (!marketState || !marketState.price) continue;

            beesPayload[beeKey] = {
                strategy: config.strategyPrompt,
                strategy_parameters: this.autonomicTuner?.getBeeAdjustments(beeKey) || {},
                state: {
                    pair: marketState.instId,
                    price: marketState.price,
                    return_1h: `${marketState.return_1h_pct}%`,
                    return_24h: `${marketState.return_24h_pct}%`,
                    trend_return: `${marketState.trend_return_pct ?? marketState.return_24h_pct}%`,
                    rsi: marketState.rsi_14,
                    bollinger_pct_b: marketState.bollinger.percent_b,
                    bollinger_width: `${marketState.bollinger.width_pct}%`,
                    atr_pct: `${marketState.atr_pct}%`,
                    funding_rate: `${marketState.funding.rate_pct}%`,
                    funding_bias: marketState.funding.bias,
                    htf_trend: marketState.htfTrend || 'RANGING',
                    larry_williams_status: marketState.larry_williams.status
                },
                menu: config.menu,
                conviction_labels: ['none', 'weak', 'moderate', 'strong']
            };
        }

        try {
            const res = await fetch(batchUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bees: beesPayload })
            });

            if (res.ok) {
                const data = await res.json();
                return data.results || {};
            }
        } catch (err) {
            console.warn('[SomaBeeEngine] Batch inference failed, will fallback to sequential:', err.message);
        }
        return null;
    }

    /**
     * High-conviction algorithmic rule fallback when Laya System 1 is offline or times out.
     * Evaluates Dual Thrust triggers (Bizzy), RSI/%B mean-reversion extremes (Boozy),
     * and 24h momentum/funding carry (Breezy).
     */
    generateAlgorithmicFallback(beeKey, marketState) {
        const bee = this.state.bees[beeKey];
        const tuning = this.autonomicTuner?.getBeeAdjustments(beeKey) || {};
        const isHolding = bee && bee.position;
        const holdingSide = isHolding ? bee.position.side : null;

        if (beeKey === 'bizzy') {
            const lw = marketState.larry_williams?.status;
            if (lw === 'LONG_BREAKOUT' || lw === 'ABOVE_BUY_TRIGGER') {
                return { choice: 'LONG', conviction: 3, confidence: 0.88, isFallback: true };
            }
            if (lw === 'SHORT_BREAKOUT' || lw === 'BELOW_SELL_TRIGGER') {
                return { choice: 'SHORT', conviction: 3, confidence: 0.88, isFallback: true };
            }
            if (isHolding) {
                return { choice: 'HOLD', conviction: 1, confidence: 0.50, isFallback: true };
            }
            return { choice: 'HOLD', conviction: 0, confidence: 0.50, isFallback: true };
        }

        if (beeKey === 'boozy') {
            const rsi = marketState.rsi_14 ?? 50;
            const pctB = marketState.bollinger?.percent_b ?? 0.5;

            // Exit conditions for mean-reversion
            if (isHolding) {
                if (holdingSide === 'LONG' && (rsi >= 50 || pctB >= 0.55)) {
                    return { choice: 'CLOSE', conviction: 2, confidence: 0.75, isFallback: true };
                }
                if (holdingSide === 'SHORT' && (rsi <= 50 || pctB <= 0.45)) {
                    return { choice: 'CLOSE', conviction: 2, confidence: 0.75, isFallback: true };
                }
            }

            // Entry conditions
            if (rsi < (tuning.rsiOversold ?? 30) || pctB < 0.1) {
                const conv = (rsi < (tuning.rsiOversold ?? 30) - 5 || pctB < 0.05) ? 3 : 2;
                return { choice: 'LONG', conviction: conv, confidence: 0.82, isFallback: true };
            }
            if (rsi > (tuning.rsiOverbought ?? 70) || pctB > 0.9) {
                const conv = (rsi > (tuning.rsiOverbought ?? 70) + 5 || pctB > 0.95) ? 3 : 2;
                return { choice: 'SHORT', conviction: conv, confidence: 0.82, isFallback: true };
            }
            return { choice: isHolding ? 'HOLD' : 'HOLD', conviction: 0, confidence: 0.50, isFallback: true };
        }

        if (beeKey === 'breezy') {
            const ret24h = marketState.trend_return_pct ?? marketState.return_24h_pct ?? 0;
            const ret1h = marketState.return_1h_pct || 0;
            const fundingRate = marketState.funding?.rate_pct || 0;

            if (isHolding) {
                if (holdingSide === 'LONG' && ret1h < -1.5) {
                    return { choice: 'CLOSE', conviction: 2, confidence: 0.70, isFallback: true };
                }
                if (holdingSide === 'SHORT' && ret1h > 1.5) {
                    return { choice: 'CLOSE', conviction: 2, confidence: 0.70, isFallback: true };
                }
            }

            // Trend following entries
            if (ret24h >= 2.0 && ret1h >= 0.1 && fundingRate > -0.05) {
                const conv = (ret24h >= 4.0 && ret1h >= 0.5) ? 3 : 2;
                return { choice: 'LONG', conviction: conv, confidence: 0.80, isFallback: true };
            }
            if (ret24h <= -2.0 && ret1h <= -0.1 && fundingRate < 0.05) {
                const conv = (ret24h <= -4.0 && ret1h <= -0.5) ? 3 : 2;
                return { choice: 'SHORT', conviction: conv, confidence: 0.80, isFallback: true };
            }
            return { choice: isHolding ? 'HOLD' : 'HOLD', conviction: 0, confidence: 0.50, isFallback: true };
        }

        return { choice: 'HOLD', conviction: 0, confidence: 0.50, isFallback: true };
    }

    _applyTuningToSnapshot(beeKey, snapshot) {
        if (!snapshot?.price) return snapshot;
        const tuning = this.autonomicTuner?.getBeeAdjustments(beeKey) || {};
        const adjusted = { ...snapshot };
        if (beeKey === 'bizzy' && Number.isFinite(snapshot.open24h)
            && Number.isFinite(snapshot.high24h) && Number.isFinite(snapshot.low24h)) {
            const range = Math.max(1e-6, snapshot.high24h - snapshot.low24h);
            const buy = snapshot.open24h + (tuning.k1 ?? 0.5) * range;
            const sell = snapshot.open24h - (tuning.k2 ?? 0.5) * range;
            adjusted.larry_williams = {
                buy_trigger: Number(buy.toFixed(4)),
                sell_trigger: Number(sell.toFixed(4)),
                status: snapshot.price >= buy ? 'ABOVE_BUY_TRIGGER'
                    : snapshot.price <= sell ? 'BELOW_SELL_TRIGGER' : 'INSIDE_RANGE'
            };
        }
        if (beeKey === 'boozy' && Number.isFinite(tuning.bollingerStdDev)
            && snapshot.bollinger && Number.isFinite(snapshot.bollinger.upper)
            && Number.isFinite(snapshot.bollinger.middle)) {
            const halfWidth = (snapshot.bollinger.upper - snapshot.bollinger.middle) * tuning.bollingerStdDev / 2;
            if (halfWidth > 0) {
                adjusted.bollinger = {
                    ...snapshot.bollinger,
                    upper: snapshot.bollinger.middle + halfWidth,
                    lower: snapshot.bollinger.middle - halfWidth,
                    percent_b: (snapshot.price - snapshot.bollinger.middle + halfWidth) / (2 * halfWidth)
                };
            }
        }
        if (beeKey === 'breezy' && Number.isInteger(tuning.trendLookbackBars)
            && Array.isArray(snapshot.recentCloses)
            && snapshot.recentCloses.length > tuning.trendLookbackBars) {
            const prior = snapshot.recentCloses.at(-tuning.trendLookbackBars - 1);
            const last = snapshot.recentCloses.at(-1);
            if (Number.isFinite(prior) && prior > 0 && Number.isFinite(last)) {
                adjusted.trend_return_pct = Number((((last - prior) / prior) * 100).toFixed(2));
            }
        }
        return adjusted;
    }

    /**
     * Evaluate stops and calculate unrealized PnL for an open position
     */
    checkPositionRisk(beeKey, currentPrice) {
        const bee = this.state.bees[beeKey];
        if (!bee || !bee.position) return null;

        const pos = bee.position;
        const isLong = pos.side === 'LONG';
        const priceDiff = isLong ? (currentPrice - pos.entryPrice) : (pos.entryPrice - currentPrice);
        const unrealizedPnl = priceDiff * pos.size;
        const initialRiskDollars = Math.abs(pos.entryPrice - pos.stopLoss) * pos.size;
        const rMultiple = initialRiskDollars > 0 ? (unrealizedPnl / initialRiskDollars) : 0;

        // Check Hard Stop Loss
        const stopTriggered = isLong ? (currentPrice <= pos.stopLoss) : (currentPrice >= pos.stopLoss);
        // Check Take Profit Target
        const tpTriggered = isLong ? (currentPrice >= pos.takeProfit) : (currentPrice <= pos.takeProfit);

        return {
            unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
            rMultiple: Number(rMultiple.toFixed(2)),
            stopTriggered,
            tpTriggered,
            initialRiskDollars
        };
    }

    /**
     * Close an existing position
     */
    closePosition(beeKey, exitPrice, reason = 'SYSTEM1_SIGNAL', marketState = null) {
        const bee = this.state.bees[beeKey];
        if (!bee || !bee.position) return null;

        const pos = bee.position;
        const isLong = pos.side === 'LONG';
        // A close sells at bid or buys at ask when a current quote is available.
        const quoteExit = isLong ? marketState?.bid : marketState?.ask;
        if (Number.isFinite(quoteExit) && quoteExit > 0) exitPrice = quoteExit;
        const costs = paperNetPnl({ side: pos.side, entryPrice: pos.entryPrice,
            exitPrice, size: pos.size, heldMs: Date.now() - Date.parse(pos.entryTime),
            entryCosts: pos.entryCosts });
        const realizedPnl = Number(costs.netPnl.toFixed(2));
        const initialRiskDollars = pos.initialRiskDollars
            || Math.abs(pos.entryPrice - pos.stopLoss) * pos.size;
        const rMultiple = initialRiskDollars > 0 ? Number((realizedPnl / initialRiskDollars).toFixed(2)) : 0;

        bee.cash = Number((bee.cash + realizedPnl).toFixed(2));
        bee.realizedPnl = Number((bee.realizedPnl + realizedPnl).toFixed(2));
        bee.tradesCount += 1;
        if (realizedPnl > 0) bee.winCount += 1;
        else if (realizedPnl < 0) bee.lossCount += 1;

        const tradeRecord = {
            id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            bee: beeKey,
            beeName: BEE_CONFIGS[beeKey].name,
            symbol: pos.symbol,
            side: pos.side,
            entryPrice: pos.entryPrice,
            exitPrice,
            size: pos.size,
            notional: Number((exitPrice * pos.size).toFixed(2)),
            entryTime: pos.entryTime,
            exitTime: new Date().toISOString(),
            pnl: realizedPnl,
            grossPnl: Number(costs.grossPnl.toFixed(2)),
            executionCosts: costs,
            rMultiple,
            exitReason: reason,
            entryConviction: pos.conviction,
            centralTradeId: pos.tradeId ?? null
        };

        this.state.pendingCentralExits ||= [];
        if (pos.tradeId != null) {
            this.state.pendingCentralExits.push({
                tradeId: pos.tradeId,
                exitData: {
                    exitPrice,
                    pnl: realizedPnl,
                    pnlPct: Number((realizedPnl / (pos.entryPrice * pos.size)).toFixed(6)),
                    exitFee: Number(costs.exit.fee.toFixed(6)),
                    modeledExecutionCost: Number((costs.entry.slippageReserve + costs.exit.slippageReserve).toFixed(6)),
                    modeledFundingReserve: Number(costs.exit.fundingReserve.toFixed(6)),
                    reason,
                    strategy: `beebots_${beeKey}`
                }
            });
        } else if (this.tradeLogger) {
            tradeRecord.centralLogStatus = 'missing_entry';
        }

        this.state.closedTrades.unshift(tradeRecord);
        if (this.state.closedTrades.length > 200) {
            this.state.closedTrades = this.state.closedTrades.slice(0, 200);
        }

        bee.position = null;
        this.updateEquities();
        this._saveLedger();
        this._emit('onTradeClose', tradeRecord);

        // Swarm Integrations: Enterprise Risk, CNS Pub/Sub, RLCD Distillation, and Autonomic Tuning
        if (this.riskGate) this.riskGate.registerClosedTrade('BEEBOTS', tradeRecord);
        if (this.swarmBroker) this.swarmBroker.publishTradeClose(tradeRecord);
        if (this.learningBridge) this.learningBridge.distillTradeReceipt(tradeRecord);
        if (this.autonomicTuner) {
            this.autonomicTuner.registerClosedTrade(tradeRecord);
            this.state.autonomicTuning = this.autonomicTuner.getState();
        }

        this.flushPendingCentralExits();

        return tradeRecord;
    }

    flushPendingCentralExits() {
        if (!this.tradeLogger || !this.state.pendingCentralExits?.length) return 0;
        try {
            if (!this.tradeLogger.db) this.tradeLogger.initialize();
        } catch (err) {
            console.warn('[SomaBeeEngine] Central trade log unavailable:', err.message);
            return 0;
        }
        const pending = [];
        let completed = 0;
        for (const item of this.state.pendingCentralExits) {
            try {
                if (this.tradeLogger.logTradeExit(item.tradeId, { ...item.exitData }) === false) pending.push(item);
                else completed++;
            } catch (err) {
                pending.push(item);
                console.warn('[SomaBeeEngine] Central trade exit deferred:', err.message);
            }
        }
        if (completed) {
            this.state.pendingCentralExits = pending;
            this._saveLedger();
        }
        return completed;
    }

    /**
     * Open a new position with 1R risk sizing and regime-adaptive modulation
     */
    openPosition(beeKey, side, marketState, conviction, layaDecision) {
        const bee = this.state.bees[beeKey];
        if (!bee || bee.position) return null; // Already in position

        // 0. Anti-Revenge Post-Stop Cooldown Check
        const cd = this.autonomicTuner ? this.autonomicTuner.isUnderCooldown(marketState.instId, side) : { active: false };
        if (cd.active) {
            console.log(`[SomaBeeEngine] 🛑 ${BEE_CONFIGS[beeKey].name} trade blocked: ${cd.reason}`);
            return null;
        }

        // 0b. Higher-Timeframe (HTF) Trend Protection
        const htfCheck = this.autonomicTuner ? this.autonomicTuner.checkHtfAlignment(beeKey, side, marketState) : { allowed: true };
        if (!htfCheck.allowed) {
            console.log(`[SomaBeeEngine] 🛑 ${BEE_CONFIGS[beeKey].name} HTF filter blocked trade: ${htfCheck.reason}`);
            return null;
        }

        // 1. Dynamic Market Regime Modulation
        const adj = this.regimeAdapter ? this.regimeAdapter.getBeeAdjustments(beeKey, marketState.instId, null, marketState) : null;
        const autoAdj = this.autonomicTuner ? this.autonomicTuner.getBeeAdjustments(beeKey) : null;
        if (conviction < Math.max(this.minConviction, adj?.minConviction || 2, autoAdj?.minConviction || 2)) return null;

        if (adj) {
            if (!adj.active) {
                // Bee is suppressed in this regime (e.g. breezy in chop, boozy in crash)
                return null;
            }
            if (adj.allowedSides && !adj.allowedSides.includes(side)) {
                // Direction disallowed in this regime (e.g. no shorting in bull trend, no buying in crash)
                return null;
            }
        }

        // 2. Top-Down Macro Bias Check (from AutonomousTrader / Council)
        const macro = this.swarmBroker ? this.swarmBroker.getMacroBias(marketState.instId) : null;
        if (macro) {
            if (macro.bias === 'BULLISH' && side === 'SHORT' && conviction < 3) {
                return null; // Require textbook conviction to counter macro bull bias
            }
            if (macro.bias === 'BEARISH' && side === 'LONG' && conviction < 3) {
                return null; // Require textbook conviction to counter macro bear bias
            }
        }

        const entryPrice = side === 'LONG' ? marketState.ask : marketState.bid;
        const atr = Math.max(marketState.atr_14, entryPrice * 0.002); // minimum 0.2% ATR safety floor

        // Dynamic Stop & Take Profit Multipliers
        const stopMultiplier = Math.max(adj?.stopAtrMultiplier || 1.5, autoAdj?.stopAtr || 1.5);
        const tpMultiplier = autoAdj?.targetAtr || adj?.tpAtrMultiplier || 2.5;

        const stopDistance = stopMultiplier * atr;
        const tpDistance = tpMultiplier * atr;

        const stopLoss = side === 'LONG' ? (entryPrice - stopDistance) : (entryPrice + stopDistance);
        const takeProfit = side === 'LONG' ? (entryPrice + tpDistance) : (entryPrice - tpDistance);

        // Position sizing based on 1R risk budget (dynamically modulated by autonomic tuner)
        const effectiveRiskPct = Math.min(this.riskPerTradePct, autoAdj?.riskPerTradePct || this.riskPerTradePct);
        const riskBudget = bee.cash * effectiveRiskPct;
        // Reserve both taker fees, adverse slippage and one funding interval in 1R.
        const costPerUnit = entryPrice * (2 * (PAPER_TAKER_FEE_RATE + PAPER_SLIPPAGE_RATE) + 0.0001);
        let positionSize = riskBudget / (stopDistance + costPerUnit);

        // Apply leverage ceiling guard
        const notional = positionSize * entryPrice;
        const maxNotional = bee.cash * this.maxLeverage;
        if (notional > maxNotional) {
            positionSize = maxNotional / entryPrice;
        }

        positionSize = Number(positionSize.toFixed(4));
        if (positionSize <= 0) return null;

        // 3. Central Enterprise Pre-Trade Risk Gate
        if (this.riskGate) {
            const approval = this.riskGate.checkOrderApproval({
                engine: 'BEEBOTS',
                symbol: marketState.instId,
                side,
                notional: positionSize * entryPrice,
                entryPrice
            });
            if (!approval.approved) {
                console.warn(`[SomaBeeEngine] 🛑 Enterprise Risk Gate rejected trade: ${approval.reason}`);
                return null;
            }
        }

        const position = {
            id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            symbol: marketState.instId,
            side,
            size: positionSize,
            entryPrice: Number(entryPrice.toFixed(4)),
            stopLoss: Number(stopLoss.toFixed(4)),
            takeProfit: Number(takeProfit.toFixed(4)),
            atr: Number(atr.toFixed(4)),
            entryTime: new Date().toISOString(),
            conviction,
            confidence: layaDecision.confidence,
            probabilities: layaDecision.probabilities,
            regime: adj?.regime || 'RANGING',
            macroBias: macro?.bias || 'NEUTRAL',
            tradeId: null
        };
        position.entryCosts = paperEntryCosts(position.entryPrice, position.size);
        position.initialRiskDollars = stopDistance * position.size
            + costPerUnit * position.size;

        // Persist open trade to Central SQLite TradeLogger for Sim-To-Live Promotion Pipeline
        if (this.tradeLogger) {
            try {
                if (!this.tradeLogger.db) this.tradeLogger.initialize();
                const canonicalSym = marketState.instId.includes('BTC') ? 'BTC-USD' : (marketState.instId.includes('ETH') ? 'ETH-USD' : (marketState.instId.includes('SOL') ? 'SOL-USD' : marketState.instId));
                position.tradeId = this.tradeLogger.logTradeEntry({
                    orderId: position.id,
                    symbol: canonicalSym,
                    side: side.toLowerCase() === 'long' ? 'buy' : 'sell',
                    qty: positionSize,
                    entryPrice: Number(entryPrice.toFixed(4)),
                    expectedPrice: Number(entryPrice.toFixed(4)),
                    filledPrice: Number(entryPrice.toFixed(4)),
                    entryFee: Number(position.entryCosts.fee.toFixed(6)),
                    strategy: `beebots_${beeKey}`,
                    strategyVersion: 'v1.0-system1',
                    regime: adj?.regime || 'RANGING',
                    attribution: {
                        beeKey,
                        strategyId: `beebots_${beeKey}`,
                        source: 'soma_beebots',
                        mode: 'paper',
                        venue: 'okx_public_quotes_paper',
                        executionCostModel: 'okx_level1_taker_plus_modeled_slippage_funding_reserve_v1',
                        model: layaDecision?.model || 'laya-system1-modernbert',
                        conviction
                    }
                });
                if (position.tradeId == null) throw new Error('TradeLogger did not persist entry');
            } catch (err) {
                console.warn('[SomaBeeEngine] TradeLogger logTradeEntry warning:', err.message);
                return null;
            }
        }

        bee.position = position;
        this.updateEquities();
        this._saveLedger();
        this._emit('onTradeOpen', { bee: beeKey, beeName: BEE_CONFIGS[beeKey].name, position });

        // Swarm Integrations: Enterprise Risk & CNS Pub/Sub
        if (this.riskGate) this.riskGate.registerOpenPosition('BEEBOTS', position);
        if (this.swarmBroker) this.swarmBroker.publishTradeOpen({ bee: beeKey, beeName: BEE_CONFIGS[beeKey].name, position, regime: adj?.regime || 'RANGING' });

        return position;
    }

    /**
     * Recalculate total equities
     */
    updateEquities(currentPrices = {}) {
        for (const [key, bee] of Object.entries(this.state.bees)) {
            let unrealized = 0;
            if (bee.position) {
                const px = currentPrices[bee.position.symbol] || bee.position.entryPrice;
                const isLong = bee.position.side === 'LONG';
                const diff = isLong ? (px - bee.position.entryPrice) : (bee.position.entryPrice - px);
                unrealized = diff * bee.position.size;
            }
            bee.equity = Number((bee.cash + unrealized).toFixed(2));
        }
    }

    /**
     * Execute a full tick cycle across all 3 bees
     */
    async tick({ allowEntries = true } = {}) {
        this.flushPendingCentralExits();
        const tickReport = {
            timestamp: new Date().toISOString(),
            bees: {}
        };

        try {
            // 1. Ingest market data for all 3 bees
            const symbols = [
                BEE_CONFIGS.bizzy.targetPair,
                BEE_CONFIGS.boozy.targetPair,
                BEE_CONFIGS.breezy.targetPair
            ];

            const snapshots = {};
            for (const sym of symbols) {
                try {
                    snapshots[sym] = await this.feed.getMarketSnapshot(sym);
                } catch (err) {
                    console.error(`[SomaBeeEngine] Market snapshot failed for ${sym}:`, err.message);
                }
            }
            for (const [beeKey, config] of Object.entries(BEE_CONFIGS)) {
                snapshots[config.targetPair] = this._applyTuningToSnapshot(beeKey, snapshots[config.targetPair]);
            }

            const currentPrices = {};
            for (const [sym, s] of Object.entries(snapshots)) {
                if (s && s.price) {
                    currentPrices[sym] = s.price;
                    // Detect and broadcast micro volatility / funding shocks to the swarm
                    if (s.atr_pct > 1.2 || (s.funding && Math.abs(s.funding.rate_pct) > 0.05)) {
                        if (this.swarmBroker) {
                            this.swarmBroker.publishVolatilityAlert({
                                symbol: sym,
                                atr_pct: s.atr_pct,
                                funding_rate: s.funding?.rate_pct,
                                price: s.price,
                                reason: s.atr_pct > 1.2 ? 'ATR volatility expansion > 1.2%' : 'Extreme perpetual funding imbalance'
                            });
                        }
                    }
                }
            }
            this.updateEquities(currentPrices);

            // Autonomic Bandit Capital Rebalancing (UCB1)
            if (this.learningBridge && this.state.closedTrades.length >= this.learningBridge.minTradesForBandit) {
                const bandit = this.learningBridge.computeCapitalWeights(this.state.closedTrades);
                if (bandit.isBanditActive) {
                    const totalPortfolioNetWorth = this.state.totalInitialCapital + Object.values(this.state.bees).reduce((sum, b) => sum + (b.realizedPnl || 0), 0);
                    // Rebalance cash pool across idle bees anchored to true net worth
                    for (const [beeKey, weight] of Object.entries(bandit.weights)) {
                        const bee = this.state.bees[beeKey];
                        if (bee && !bee.position) {
                            bee.cash = Number((totalPortfolioNetWorth * weight).toFixed(2));
                        }
                    }
                    tickReport.banditWeights = bandit.weights;
                }
            }

            // 2. Query Laya in batch across all bees
            let batchResults = null;
            try {
                batchResults = await this.askLayaBatch(snapshots);
            } catch (err) {
                console.warn('[SomaBeeEngine] Batch query failed, will fallback to individual queries:', err.message);
            }

            // 3. Process each Bee
            for (const beeKey of ['bizzy', 'boozy', 'breezy']) {
                const config = BEE_CONFIGS[beeKey];
                const marketState = snapshots[config.targetPair];
                const bee = this.state.bees[beeKey];

                if (!marketState || !marketState.price) {
                    tickReport.bees[beeKey] = { status: 'NO_MARKET_DATA' };
                    continue;
                }

                const beeResult = {
                    symbol: config.targetPair,
                    price: marketState.price,
                    position: bee.position ? { ...bee.position } : null,
                    action: null,
                    decision: null
                };

                // Check open position risk triggers first
                if (bee.position) {
                    const risk = this.checkPositionRisk(beeKey, marketState.price);
                    if (risk && risk.stopTriggered) {
                        const closed = this.closePosition(beeKey, marketState.price, 'STOP_LOSS', marketState);
                        beeResult.action = 'CLOSED_STOP_LOSS';
                        beeResult.closedTrade = closed;
                        tickReport.bees[beeKey] = beeResult;
                        continue;
                    }
                    if (risk && risk.tpTriggered) {
                        const closed = this.closePosition(beeKey, marketState.price, 'TAKE_PROFIT', marketState);
                        beeResult.action = 'CLOSED_TAKE_PROFIT';
                        beeResult.closedTrade = closed;
                        tickReport.bees[beeKey] = beeResult;
                        continue;
                    }
                }

                // Retrieve decision from batch or query individually
                let layaRes = batchResults && batchResults[beeKey] && batchResults[beeKey].ok ? batchResults[beeKey] : null;
                if (!layaRes) {
                    try {
                        layaRes = await this.askLaya(beeKey, marketState);
                    } catch (err) {
                        console.warn(`[SomaBeeEngine] Laya query unavailable for ${beeKey} (${err.message}), engaging algorithmic fallback.`);
                        layaRes = this.generateAlgorithmicFallback(beeKey, marketState);
                    }
                }
                beeResult.decision = layaRes;


                const choice = layaRes.choice;
                const conviction = layaRes.conviction; // 0..3

                // Process Decision
                if (bee.position) {
                    // In position: Check for manual exit or reversal
                    const isLong = bee.position.side === 'LONG';
                    const oppositeSide = isLong ? 'SHORT' : 'LONG';

                    if (choice === 'CLOSE' || (choice === oppositeSide && conviction >= this.minConviction)) {
                        const closed = this.closePosition(beeKey, marketState.price, `SYSTEM1_${choice}`, marketState);
                        beeResult.action = `CLOSED_${choice}`;
                        beeResult.closedTrade = closed;

                        // If it was a reversal with strong conviction, immediately enter opposite
                        if (allowEntries && choice === oppositeSide && conviction >= this.minConviction) {
                            const newPos = this.openPosition(beeKey, choice, marketState, conviction, layaRes);
                            beeResult.action += `_AND_OPENED_${choice}`;
                            beeResult.newPosition = newPos;
                        }
                    } else {
                        beeResult.action = 'HOLDING';
                    }
                } else {
                    // Flat: Check for valid entry with conviction threshold
                    if (allowEntries && (choice === 'LONG' || choice === 'SHORT') && conviction >= this.minConviction) {
                        const newPos = this.openPosition(beeKey, choice, marketState, conviction, layaRes);
                        beeResult.action = `OPENED_${choice}`;
                        beeResult.newPosition = newPos;
                    } else {
                        beeResult.action = `FLAT_WAITING (Signal: ${choice}, Conviction: ${conviction}/${this.minConviction})`;
                    }
                }

                tickReport.bees[beeKey] = beeResult;
            }

            this._saveLedger();
            this._emit('onTick', tickReport);

            // Broadcast heartbeat telemetry to SOMA Central Nervous System
            if (this.swarmBroker) {
                this.swarmBroker.publishHeartbeat({
                    portfolio: this.getPortfolioSummary(),
                    bees: tickReport.bees
                });
            }

            return tickReport;
        } catch (err) {
            this._emit('onError', err);
            throw err;
        }
    }

    /**
     * Produce aggregated portfolio summary
     */
    getPortfolioSummary() {
        let totalCash = 0;
        let totalEquity = 0;
        let totalRealized = 0;
        let totalUnrealized = 0;
        let totalTrades = 0;
        let totalWins = 0;
        let openPositions = 0;

        const beeSummaries = {};
        for (const [key, bee] of Object.entries(this.state.bees)) {
            totalCash += bee.cash;
            totalEquity += bee.equity;
            totalRealized += bee.realizedPnl;
            totalUnrealized += bee.equity - bee.cash;
            totalTrades += bee.tradesCount;
            totalWins += bee.winCount;
            if (bee.position) openPositions += 1;

            const winRate = bee.tradesCount > 0 ? Number(((bee.winCount / bee.tradesCount) * 100).toFixed(1)) : 0;
            beeSummaries[key] = {
                name: BEE_CONFIGS[key].name,
                emoji: BEE_CONFIGS[key].emoji,
                pair: BEE_CONFIGS[key].targetPair,
                cash: Number(bee.cash.toFixed(2)),
                equity: Number(bee.equity.toFixed(2)),
                realizedPnl: Number(bee.realizedPnl.toFixed(2)),
                tradesCount: bee.tradesCount,
                winRatePct: winRate,
                position: bee.position
            };
        }

        const totalWinRate = totalTrades > 0 ? Number(((totalWins / totalTrades) * 100).toFixed(1)) : 0;
        const totalReturnPct = Number((((totalEquity - this.state.totalInitialCapital) / this.state.totalInitialCapital) * 100).toFixed(2));

        return {
            sourceSystem: 'SOMA BeeBots',
            account: 'beebots_paper',
            symbolScope: Object.values(BEE_CONFIGS).map(config => config.targetPair),
            timeWindow: { start: this.state.createdAt, end: this.state.lastUpdated, timezone: 'UTC' },
            asOf: this.state.lastUpdated,
            promotionGateWindow: 'separate SOMA 30-day gate; not scored by this BeeBot ledger',
            totalInitialCapital: this.state.totalInitialCapital,
            totalCash: Number(totalCash.toFixed(2)),
            totalEquity: Number(totalEquity.toFixed(2)),
            totalRealizedPnl: Number(totalRealized.toFixed(2)),
            totalUnrealizedPnl: Number(totalUnrealized.toFixed(2)),
            openPositions,
            totalReturnPct,
            totalTrades,
            totalWinRate,
            bees: beeSummaries,
            autonomicTuning: this.autonomicTuner ? this.autonomicTuner.getState() : null,
            recentClosedTrades: this.state.closedTrades.slice(0, 5)
        };
    }
}
