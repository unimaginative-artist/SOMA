/**
 * Risk Management System - Production Grade
 *
 * The FINAL piece! Professional risk management:
 * - Position sizing (Kelly Criterion)
 * - Stop loss / take profit automation
 * - Portfolio-level risk limits
 * - Drawdown protection
 * - Correlation-based risk adjustment
 * - Real-time risk monitoring
 *
 * Why This Matters:
 * - Professionals don't lose money because they lack alpha
 * - They lose money because they mismanage risk
 * - Risk management = survival
 * - This is the difference between Buffett and broke
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

export class RiskManager extends EventEmitter {
    constructor({ rootPath, portfolioOptimizer = null, correlationDetector = null, regimeDetector = null }) {
        super();
        this.regimeDetector = regimeDetector;
        this.rootPath = rootPath;
        this.riskPath = path.join(rootPath, 'data', 'risk');
        this.portfolioOptimizer = portfolioOptimizer;
        this.correlationDetector = correlationDetector;

        // Risk limits (defaults - should be customized)
        this.limits = {
            // Position limits
            maxPositionSize: 0.20,          // 20% max per position
            maxSectorExposure: 0.40,        // 40% max per sector
            maxCorrelatedExposure: 0.50,    // 50% max in correlated assets

            // Portfolio limits
            maxPortfolioLeverage: 2.0,      // 2x max leverage
            maxDrawdown: 0.20,              // 20% max drawdown
            maxDailyLoss: 0.05,             // 5% max daily loss
            maxDailyTrades: 50,             // 50 trades/day max

            // Risk per trade
            maxRiskPerTrade: 0.02,          // 2% max risk per trade
            minRiskReward: 1.5,             // 1.5:1 min risk/reward
            maxConsecutiveLosses: 5         // Halt after 5 losses
        };

        // Portfolio state
        this.portfolio = {
            totalValue: 0,
            cash: 0,
            positions: new Map(),
            unrealizedPnL: 0,
            realizedPnL: 0,
            dailyPnL: 0,
            peakValue: 0,
            currentDrawdown: 0
        };

        // Risk state
        this.riskState = {
            dailyTrades: 0,
            consecutiveLosses: 0,
            consecutiveWins: 0,
            isHalted: false,
            haltReason: null,
            lastTradeTimestamp: 0,
            violations: []
        };

        // Active risk rules
        this.stopLosses = new Map();  // symbol -> stop price
        this.takeProfits = new Map(); // symbol -> target price
    }

    async initialize() {
        await fs.mkdir(this.riskPath, { recursive: true });
        await this.loadRiskState();

        console.log('[RiskManager] ✅ Initialized');
        this.emit('risk:ready', { timestamp: Date.now() });
    }

    /**
     * Calculate optimal position size using Kelly Criterion
     */
    calculatePositionSize(trade) {
        const {
            symbol,
            winProbability,      // Probability of winning (0-1)
            avgWinPercent,       // Average win %
            avgLossPercent,      // Average loss %
            currentPrice
        } = trade;

        // Kelly Criterion: f* = (p * b - q) / b
        // where:
        // f* = fraction of bankroll to bet
        // p = probability of win
        // q = probability of loss (1-p)
        // b = odds received on the wager (win/loss ratio)

        const p = winProbability;
        const q = 1 - p;
        const b = Math.abs(avgWinPercent / avgLossPercent); // Odds ratio

        let kellyFraction = (p * b - q) / b;

        // Kelly is aggressive, use fractional Kelly (25% of Kelly)
        kellyFraction = kellyFraction * 0.25;

        // Apply constraints
        kellyFraction = Math.max(0, Math.min(kellyFraction, this.limits.maxPositionSize));

        // Calculate dollar amount
        const positionValue = this.portfolio.totalValue * kellyFraction;
        const shares = Math.floor(positionValue / currentPrice);

        // Apply risk per trade limit
        const maxRiskDollars = this.portfolio.totalValue * this.limits.maxRiskPerTrade;
        const stopDistance = avgLossPercent / 100;
        const maxSharesFromRisk = Math.floor(maxRiskDollars / (currentPrice * stopDistance));

        const finalShares = Math.min(shares, maxSharesFromRisk);

        return {
            shares: finalShares,
            positionValue: finalShares * currentPrice,
            kellyFraction,
            riskDollars: finalShares * currentPrice * stopDistance,
            positionPercent: (finalShares * currentPrice) / this.portfolio.totalValue
        };
    }

    /**
     * Validate trade against risk limits
     */
    async validateTrade(trade) {
        const violations = [];

        // Check if trading is halted
        if (this.riskState.isHalted) {
            violations.push({
                severity: 'CRITICAL',
                rule: 'TRADING_HALTED',
                message: `Trading halted: ${this.riskState.haltReason}`,
                action: 'REJECT'
            });
        }

        // Check daily trade limit
        if (this.riskState.dailyTrades >= this.limits.maxDailyTrades) {
            violations.push({
                severity: 'HIGH',
                rule: 'MAX_DAILY_TRADES',
                message: `Daily trade limit reached (${this.limits.maxDailyTrades})`,
                action: 'REJECT'
            });
        }

        // Check daily loss limit
        if (this.portfolio.dailyPnL < -(this.portfolio.totalValue * this.limits.maxDailyLoss)) {
            violations.push({
                severity: 'CRITICAL',
                rule: 'MAX_DAILY_LOSS',
                message: `Daily loss limit exceeded (${this.limits.maxDailyLoss * 100}%)`,
                action: 'HALT_TRADING'
            });

            // Halt trading
            await this.haltTrading('Daily loss limit exceeded');
        }

        // Check position size limit
        const positionPercent = (trade.size * trade.price) / this.portfolio.totalValue;
        if (positionPercent > this.limits.maxPositionSize) {
            violations.push({
                severity: 'HIGH',
                rule: 'MAX_POSITION_SIZE',
                message: `Position size ${(positionPercent * 100).toFixed(1)}% exceeds limit ${(this.limits.maxPositionSize * 100).toFixed(1)}%`,
                action: 'REDUCE_SIZE',
                suggestion: `Reduce to ${(this.limits.maxPositionSize * this.portfolio.totalValue / trade.price).toFixed(2)} shares`
            });
        }

        // Check sector exposure limit
        if (trade.sector) {
            const sectorCheck = this.checkSectorExposure(trade);
            if (!sectorCheck.passed) {
                violations.push({
                    severity: 'MEDIUM',
                    rule: 'MAX_SECTOR_EXPOSURE',
                    message: sectorCheck.reason,
                    action: 'REDUCE_SIZE'
                });
            }
        }

        // Check correlation risk
        if (this.correlationDetector) {
            const correlatedExposure = await this.calculateCorrelatedExposure(trade.symbol);
            if (correlatedExposure > this.limits.maxCorrelatedExposure) {
                violations.push({
                    severity: 'MEDIUM',
                    rule: 'MAX_CORRELATED_EXPOSURE',
                    message: `Correlated exposure ${(correlatedExposure * 100).toFixed(1)}% exceeds limit`,
                    action: 'REDUCE_SIZE'
                });
            }
        }

        // Check drawdown limit
        if (this.portfolio.currentDrawdown > this.limits.maxDrawdown) {
            violations.push({
                severity: 'CRITICAL',
                rule: 'MAX_DRAWDOWN',
                message: `Drawdown ${(this.portfolio.currentDrawdown * 100).toFixed(1)}% exceeds limit`,
                action: 'HALT_TRADING'
            });

            await this.haltTrading('Max drawdown exceeded');
        }

        // Check consecutive losses
        if (this.riskState.consecutiveLosses >= this.limits.maxConsecutiveLosses) {
            violations.push({
                severity: 'HIGH',
                rule: 'MAX_CONSECUTIVE_LOSSES',
                message: `${this.riskState.consecutiveLosses} consecutive losses - consider halting`,
                action: 'REDUCE_SIZE'
            });
        }

        // Check market regime compatibility
        if (trade.regime || this.regimeDetector) {
            let currentRegime = trade.regime;
            if (!currentRegime && this.regimeDetector) {
                try {
                    const res = await this.regimeDetector.detectRegime(trade.symbol);
                    currentRegime = res?.regime || res;
                } catch (e) {}
            }

            if (currentRegime === 'TRENDING_BEAR' && trade.side === 'buy') {
                violations.push({
                    severity: 'HIGH',
                    rule: 'REGIME_MISMATCH',
                    message: 'Long buy rejected in TRENDING_BEAR market regime',
                    action: 'REJECT'
                });
            } else if (currentRegime === 'RANGING' && (trade.strategy === 'momentum' || trade.strategy === 'breakout' || trade.strategy === 'micro_compounder')) {
                violations.push({
                    severity: 'MEDIUM',
                    rule: 'REGIME_MISMATCH',
                    message: 'Momentum/breakout strategy rejected in RANGING market regime',
                    action: 'REJECT'
                });
            }
        }

        // Check risk/reward ratio
        if (trade.riskRewardRatio && trade.riskRewardRatio < this.limits.minRiskReward) {
            violations.push({
                severity: 'MEDIUM',
                rule: 'MIN_RISK_REWARD',
                message: `Risk/reward ${trade.riskRewardRatio.toFixed(2)} below minimum ${this.limits.minRiskReward}`,
                action: 'REJECT'
            });
        }

        return {
            approved: !this.riskState.isHalted && violations.filter(v => v.action === 'REJECT' || v.action === 'HALT_TRADING' || v.severity === 'CRITICAL').length === 0,
            violations,
            adjustedSize: this.calculateAdjustedSize(trade, violations)
        };
    }

    /**
     * Check sector exposure limits
     */
    checkSectorExposure(trade) {
        const sector = trade.sector || 'Unknown';
        const tradeValue = trade.size * trade.price;

        // Calculate current sector exposure
        let currentSectorValue = 0;
        for (const [symbol, position] of this.portfolio.positions) {
            if (position.sector === sector) {
                currentSectorValue += position.value || (position.shares * position.currentPrice);
            }
        }

        const newSectorValue = currentSectorValue + tradeValue;
        const sectorPercent = newSectorValue / this.portfolio.totalValue;

        if (sectorPercent > this.limits.maxSectorExposure) {
            return {
                passed: false,
                reason: `${sector} exposure would be ${(sectorPercent * 100).toFixed(1)}% (max ${(this.limits.maxSectorExposure * 100).toFixed(0)}%)`,
                severity: 'MEDIUM'
            };
        }

        return {
            passed: true,
            reason: `${sector} exposure: ${(sectorPercent * 100).toFixed(1)}% (limit: ${(this.limits.maxSectorExposure * 100).toFixed(0)}%)`,
            severity: 'NONE'
        };
    }

    /**
     * Calculate adjusted position size based on violations
     */
    calculateAdjustedSize(trade, violations) {
        let adjustedSize = trade.size;

        for (const violation of violations) {
            if (violation.action === 'REDUCE_SIZE') {
                if (violation.rule === 'MAX_POSITION_SIZE') {
                    const maxShares = (this.limits.maxPositionSize * this.portfolio.totalValue) / trade.price;
                    adjustedSize = Math.min(adjustedSize, maxShares);
                } else if (violation.rule === 'MAX_SECTOR_EXPOSURE') {
                    adjustedSize = adjustedSize * 0.6; // Reduce by 40% for sector risk
                } else if (violation.rule === 'MAX_CORRELATED_EXPOSURE') {
                    adjustedSize = adjustedSize * 0.5; // Reduce by 50%
                } else if (violation.rule === 'MAX_CONSECUTIVE_LOSSES') {
                    adjustedSize = adjustedSize * 0.5; // Reduce by 50%
                }
            }
        }

        return Math.max(0, trade.allowFractional === true ? Math.floor(adjustedSize * 1e6) / 1e6 : Math.floor(adjustedSize));
    }

    /**
     * Set stop loss for position
     */
    setStopLoss(symbol, currentPrice, stopPercent) {
        const stopPrice = currentPrice * (1 - stopPercent);

        this.stopLosses.set(symbol, {
            symbol,
            stopPrice,
            currentPrice,
            stopPercent,
            setAt: Date.now()
        });

        console.log(`[RiskManager] Stop loss set for ${symbol}: $${stopPrice.toFixed(2)} (-${(stopPercent * 100).toFixed(1)}%)`);

        this.emit('risk:stop_loss_set', {
            symbol,
            stopPrice,
            stopPercent
        });

        return this.stopLosses.get(symbol);
    }

    /**
     * Set take profit for position
     */
    setTakeProfit(symbol, currentPrice, targetPercent) {
        const targetPrice = currentPrice * (1 + targetPercent);

        this.takeProfits.set(symbol, {
            symbol,
            targetPrice,
            currentPrice,
            targetPercent,
            setAt: Date.now()
        });

        console.log(`[RiskManager] Take profit set for ${symbol}: $${targetPrice.toFixed(2)} (+${(targetPercent * 100).toFixed(1)}%)`);

        this.emit('risk:take_profit_set', {
            symbol,
            targetPrice,
            targetPercent
        });

        return this.takeProfits.get(symbol);
    }

    /**
     * Check if stop loss or take profit triggered
     */
    checkExitTriggers(symbol, currentPrice) {
        const triggers = [];

        // Check stop loss
        if (this.stopLosses.has(symbol)) {
            const stopLoss = this.stopLosses.get(symbol);
            if (currentPrice <= stopLoss.stopPrice) {
                triggers.push({
                    type: 'STOP_LOSS',
                    symbol,
                    triggerPrice: stopLoss.stopPrice,
                    currentPrice,
                    action: 'SELL',
                    reason: `Stop loss triggered at $${stopLoss.stopPrice.toFixed(2)}`
                });

                this.emit('risk:stop_loss_triggered', triggers[triggers.length - 1]);
            }
        }

        // Check take profit
        if (this.takeProfits.has(symbol)) {
            const takeProfit = this.takeProfits.get(symbol);
            if (currentPrice >= takeProfit.targetPrice) {
                triggers.push({
                    type: 'TAKE_PROFIT',
                    symbol,
                    triggerPrice: takeProfit.targetPrice,
                    currentPrice,
                    action: 'SELL',
                    reason: `Take profit triggered at $${takeProfit.targetPrice.toFixed(2)}`
                });

                this.emit('risk:take_profit_triggered', triggers[triggers.length - 1]);
            }
        }

        return triggers;
    }

    /**
     * Calculate correlated exposure
     */
    async calculateCorrelatedExposure(symbol) {
        if (!this.correlationDetector) {
            return 0; // No correlation data available
        }

        let correlatedValue = 0;

        for (const [posSymbol, position] of this.portfolio.positions) {
            if (posSymbol === symbol) continue;

            // Get correlation between symbols
            const correlation = await this.correlationDetector.getCorrelation(symbol, posSymbol);

            // If highly correlated (>0.7), count as correlated exposure
            if (Math.abs(correlation) > 0.7) {
                correlatedValue += position.value;
            }
        }

        return correlatedValue / this.portfolio.totalValue;
    }

    /**
     * Update portfolio state
     */
    updatePortfolio(portfolio) {
        this.portfolio.totalValue = portfolio.totalValue;
        this.portfolio.cash = portfolio.cash;
        this.portfolio.positions = portfolio.positions;
        this.portfolio.unrealizedPnL = portfolio.unrealizedPnL || 0;
        this.portfolio.realizedPnL = portfolio.realizedPnL || 0;
        this.portfolio.dailyPnL = portfolio.dailyPnL || 0;

        // Update drawdown
        if (this.portfolio.totalValue > this.portfolio.peakValue) {
            this.portfolio.peakValue = this.portfolio.totalValue;
        }

        this.portfolio.currentDrawdown = (this.portfolio.peakValue - this.portfolio.totalValue) / this.portfolio.peakValue;

        // Emit portfolio update
        this.emit('risk:portfolio_updated', {
            totalValue: this.portfolio.totalValue,
            drawdown: this.portfolio.currentDrawdown,
            dailyPnL: this.portfolio.dailyPnL
        });
    }

    /**
     * Record trade result
     */
    recordTradeResult(trade) {
        this.riskState.dailyTrades++;
        this.riskState.lastTradeTimestamp = Date.now();

        if (trade.pnl > 0) {
            // Win
            this.riskState.consecutiveWins++;
            this.riskState.consecutiveLosses = 0;
        } else {
            // Loss
            this.riskState.consecutiveLosses++;
            this.riskState.consecutiveWins = 0;
        }

        // Remove stop loss / take profit
        this.stopLosses.delete(trade.symbol);
        this.takeProfits.delete(trade.symbol);

        // Emit event
        this.emit('risk:trade_recorded', {
            symbol: trade.symbol,
            pnl: trade.pnl,
            consecutiveLosses: this.riskState.consecutiveLosses,
            consecutiveWins: this.riskState.consecutiveWins
        });
    }

    /**
     * Halt trading
     */
    async haltTrading(reason, { scope = 'account' } = {}) {
        this.riskState.isHalted = true;
        this.riskState.haltReason = reason;
        // An operator stop always wins over a later account-generated halt.
        this.riskState.haltScope = this.riskState.haltScope === 'all' ? 'all' : scope;

        console.log(`[RiskManager] 🚨 TRADING HALTED: ${reason}`);

        this.emit('risk:trading_halted', {
            reason,
            timestamp: Date.now()
        });

        await this.saveRiskState();
    }

    /**
     * Resume trading
     */
    async resumeTrading() {
        this.riskState.isHalted = false;
        this.riskState.haltReason = null;
        this.riskState.haltScope = null;

        console.log('[RiskManager] ✅ Trading resumed');

        this.emit('risk:trading_resumed', {
            timestamp: Date.now()
        });

        await this.saveRiskState();
    }

    /**
     * Reset daily counters (call at market open)
     */
    async resetDaily() {
        this.riskState.dailyTrades = 0;
        this.portfolio.dailyPnL = 0;

        console.log('[RiskManager] Daily counters reset');

        this.emit('risk:daily_reset', {
            timestamp: Date.now()
        });

        await this.saveRiskState();
    }

    /**
     * Get risk summary
     */
    getRiskSummary() {
        const utilizationPercent = (this.portfolio.positions.size / this.limits.maxDailyTrades) * 100;

        return {
            portfolio: {
                totalValue: this.portfolio.totalValue,
                cash: this.portfolio.cash,
                positions: this.portfolio.positions.size,
                unrealizedPnL: this.portfolio.unrealizedPnL,
                dailyPnL: this.portfolio.dailyPnL,
                currentDrawdown: this.portfolio.currentDrawdown
            },
            limits: {
                maxDrawdown: this.limits.maxDrawdown,
                maxDailyLoss: this.limits.maxDailyLoss,
                maxPositionSize: this.limits.maxPositionSize,
                maxDailyTrades: this.limits.maxDailyTrades
            },
            state: {
                isHalted: this.riskState.isHalted,
                haltReason: this.riskState.haltReason,
                dailyTrades: this.riskState.dailyTrades,
                tradesRemaining: this.limits.maxDailyTrades - this.riskState.dailyTrades,
                consecutiveLosses: this.riskState.consecutiveLosses,
                consecutiveWins: this.riskState.consecutiveWins
            },
            utilization: {
                dailyTradesPercent: utilizationPercent,
                drawdownPercent: (this.portfolio.currentDrawdown / this.limits.maxDrawdown) * 100,
                dailyLossPercent: (Math.abs(this.portfolio.dailyPnL) / (this.portfolio.totalValue * this.limits.maxDailyLoss)) * 100
            },
            activeRules: {
                stopLosses: this.stopLosses.size,
                takeProfits: this.takeProfits.size
            }
        };
    }

    /**
     * Generate risk report
     */
    generateRiskReport() {
        const summary = this.getRiskSummary();

        return `
════════════════════════════════════════════════════════════════
                        RISK SUMMARY
════════════════════════════════════════════════════════════════

Portfolio Value:     $${summary.portfolio.totalValue.toLocaleString()}
Daily P&L:           ${summary.portfolio.dailyPnL >= 0 ? '+' : ''}$${summary.portfolio.dailyPnL.toFixed(2)}
Current Drawdown:    ${(summary.portfolio.currentDrawdown * 100).toFixed(2)}% / ${(summary.limits.maxDrawdown * 100).toFixed(2)}% max

Trading Status:      ${summary.state.isHalted ? '🚨 HALTED' : '✅ ACTIVE'}
${summary.state.haltReason ? `Halt Reason:         ${summary.state.haltReason}` : ''}

Daily Trades:        ${summary.state.dailyTrades} / ${summary.limits.maxDailyTrades} (${summary.state.tradesRemaining} remaining)
Streak:              ${summary.state.consecutiveWins > 0 ? summary.state.consecutiveWins + 'W' : summary.state.consecutiveLosses + 'L'}

────────────────────────────────────────────────────────────────
                        RISK LIMITS
────────────────────────────────────────────────────────────────

Max Position Size:   ${(summary.limits.maxPositionSize * 100).toFixed(1)}%
Max Daily Loss:      ${(summary.limits.maxDailyLoss * 100).toFixed(1)}%
Max Drawdown:        ${(summary.limits.maxDrawdown * 100).toFixed(1)}%

────────────────────────────────────────────────────────────────
                        ACTIVE RULES
────────────────────────────────────────────────────────────────

Stop Losses:         ${summary.activeRules.stopLosses}
Take Profits:        ${summary.activeRules.takeProfits}

════════════════════════════════════════════════════════════════
        `.trim();
    }

    /**
     * Save risk state
     */
    async saveRiskState() {
        const state = {
            portfolio: this.portfolio,
            riskState: this.riskState,
            stopLosses: Array.from(this.stopLosses.entries()),
            takeProfits: Array.from(this.takeProfits.entries()),
            timestamp: Date.now()
        };

        const filename = path.join(this.riskPath, 'risk_state.json');
        await fs.writeFile(filename, JSON.stringify(state, null, 2));
    }

    /**
     * Load risk state
     */
    async loadRiskState() {
        try {
            const filename = path.join(this.riskPath, 'risk_state.json');
            const content = await fs.readFile(filename, 'utf-8');
            const state = JSON.parse(content);

            this.portfolio = state.portfolio || this.portfolio;
            this.riskState = state.riskState || this.riskState;
            this.stopLosses = new Map(state.stopLosses || []);
            this.takeProfits = new Map(state.takeProfits || []);

            console.log('[RiskManager] Loaded previous risk state');
        } catch (err) {
            console.log('[RiskManager] No previous state found, starting fresh');
        }
    }

    /**
     * Update risk limits
     */
    updateLimits(newLimits) {
        this.limits = {
            ...this.limits,
            ...newLimits
        };

        console.log('[RiskManager] Risk limits updated');

        this.emit('risk:limits_updated', this.limits);
    }

    /**
     * Recommend stop loss based on volatility and risk tolerance
     */
    recommendStopLoss(entryPrice, volatility, riskTolerance = 0.02) {
        // Stop loss = entry - (2 * ATR) or risk tolerance, whichever is tighter
        const volatilityStop = entryPrice * (1 - volatility * 2);
        const riskStop = entryPrice * (1 - riskTolerance);

        const recommendedStop = Math.max(volatilityStop, riskStop);

        return {
            stopLoss: recommendedStop.toFixed(2),
            stopLossPercent: (((entryPrice - recommendedStop) / entryPrice) * 100).toFixed(2),
            rationale: volatilityStop > riskStop ?
                'Based on volatility (2x ATR)' :
                'Based on risk tolerance'
        };
    }

    /**
     * Recommend position size based on signal confidence
     */
    recommendPositionSize(signal, portfolio, volatility = 0.5) {
        const accountValue = portfolio.totalValue;
        const confidence = signal.confidence || 0.5;
        const riskPerTrade = this.limits.maxRiskPerTrade;

        // Kelly Criterion (simplified)
        // f = (bp - q) / b
        // where f = fraction to bet, b = odds, p = win prob, q = loss prob

        const winProb = confidence;
        const lossProb = 1 - confidence;
        const payoffRatio = signal.riskRewardRatio || 2; // Assume 2:1 reward:risk

        let kellyFraction = (payoffRatio * winProb - lossProb) / payoffRatio;

        // Kelly is aggressive, use half-Kelly for safety
        kellyFraction = Math.max(0, kellyFraction * 0.5);

        // Also cap at risk per trade
        const riskBasedSize = accountValue * riskPerTrade;
        const kellyBasedSize = accountValue * kellyFraction;

        const recommendedSize = Math.min(
            riskBasedSize,
            kellyBasedSize,
            this.limits.maxPositionSize * accountValue
        );

        return {
            recommendedSize: Math.round(recommendedSize),
            kellyFraction: (kellyFraction * 100).toFixed(2) + '%',
            rationale: `Based on ${(confidence * 100).toFixed(0)}% confidence and ${(riskPerTrade * 100).toFixed(0)}% risk per trade`,
            volatilityAdjustment: volatility > 0.5 ? 'Consider reducing size due to high volatility' : null
        };
    }
}
