/**
 * Backtesting Engine for SOMA
 * Test trading strategies against historical data
 *
 * Features:
 * - Multi-timeframe backtesting
 * - Position management simulation
 * - P&L tracking with fees
 * - Performance metrics (Sharpe, Sortino, Max Drawdown)
 * - Event-driven architecture for real-time progress updates
 */

import { EventEmitter } from 'events';

/**
 * Position class for tracking trades
 */
class Position {
    constructor(config) {
        this.id = config.id || `pos_${Date.now()}`;
        this.symbol = config.symbol;
        this.side = config.side; // 'long' or 'short'
        this.entryPrice = config.entryPrice;
        this.entryTime = config.entryTime;
        this.size = config.size;
        this.leverage = config.leverage || 1;
        this.stopLoss = config.stopLoss || null;
        this.takeProfit = config.takeProfit || null;
        this.exitPrice = null;
        this.exitTime = null;
        this.exitReason = null;
        this.pnl = 0;
        this.fees = 0;
        this.status = 'open';
    }

    close(exitPrice, exitTime, reason = 'manual') {
        this.exitPrice = exitPrice;
        this.exitTime = exitTime;
        this.exitReason = reason;
        this.status = 'closed';

        // Calculate P&L
        if (this.side === 'long') {
            this.pnl = (exitPrice - this.entryPrice) * this.size * this.leverage;
        } else {
            this.pnl = (this.entryPrice - exitPrice) * this.size * this.leverage;
        }

        return this.pnl;
    }

    getUnrealizedPnL(currentPrice) {
        if (this.side === 'long') {
            return (currentPrice - this.entryPrice) * this.size * this.leverage;
        } else {
            return (this.entryPrice - currentPrice) * this.size * this.leverage;
        }
    }

    shouldTriggerStopLoss(price) {
        if (!this.stopLoss) return false;
        if (this.side === 'long') return price <= this.stopLoss;
        return price >= this.stopLoss;
    }

    shouldTriggerTakeProfit(price) {
        if (!this.takeProfit) return false;
        if (this.side === 'long') return price >= this.takeProfit;
        return price <= this.takeProfit;
    }
}

/**
 * Main Backtest Engine
 */
export class BacktestEngine extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            initialCapital: config.initialCapital || 10000,
            feeRate: config.feeRate || 0.001, // 0.1% per trade
            slippage: config.slippage || 0.0005, // 0.05% slippage
            maxPositionSize: config.maxPositionSize || 0.1, // 10% of capital per trade
            maxDrawdownLimit: config.maxDrawdownLimit || 0.25, // 25% max drawdown
            riskPerTrade: config.riskPerTrade || 0.02, // 2% risk per trade
            ...config
        };

        this.reset();
    }

    /**
     * Reset engine state
     */
    reset() {
        this.capital = this.config.initialCapital;
        this.peakCapital = this.config.initialCapital;
        this.positions = [];
        this.closedTrades = [];
        this.equity = [{ time: 0, value: this.config.initialCapital }];
        this.metrics = {};
        this.isRunning = false;
        this.currentBar = 0;
        this.totalBars = 0;
    }

    /**
     * Run backtest with candle data and strategy
     * @param {Array} candles - Array of OHLCV candles
     * @param {Function} strategy - Strategy function (bar, engine) => { action, ... }
     */
    async runBacktest(candles, strategy, options = {}) {
        this.reset();
        this.isRunning = true;
        this.totalBars = candles.length;

        const symbol = options.symbol || 'UNKNOWN';
        const startTime = Date.now();

        this.emit('backtestStart', {
            symbol,
            totalBars: this.totalBars,
            initialCapital: this.config.initialCapital
        });

        try {
            for (let i = 0; i < candles.length; i++) {
                if (!this.isRunning) break;

                this.currentBar = i;
                const bar = candles[i];
                const prevBars = candles.slice(Math.max(0, i - 100), i);

                // Check stop loss / take profit for open positions
                this._checkPositionTriggers(bar);

                // Calculate equity
                const unrealizedPnL = this._getUnrealizedPnL(bar.close);
                const totalEquity = this.capital + unrealizedPnL;

                // Check max drawdown
                if (totalEquity > this.peakCapital) {
                    this.peakCapital = totalEquity;
                }
                const drawdown = (this.peakCapital - totalEquity) / this.peakCapital;

                if (drawdown >= this.config.maxDrawdownLimit) {
                    this._closeAllPositions(bar.close, bar.time, 'max_drawdown');
                    this.emit('maxDrawdownHit', { drawdown, bar: i });
                    break;
                }

                // Execute strategy
                const signal = await strategy(bar, prevBars, this, i);

                if (signal) {
                    await this._executeSignal(signal, bar);
                }

                // Record equity
                this.equity.push({
                    time: bar.time,
                    value: this.capital + this._getUnrealizedPnL(bar.close)
                });

                // Emit progress every 100 bars
                if (i % 100 === 0 || i === candles.length - 1) {
                    this.emit('progress', {
                        bar: i,
                        totalBars: candles.length,
                        percent: Math.round((i / candles.length) * 100),
                        equity: totalEquity,
                        openPositions: this.positions.length,
                        closedTrades: this.closedTrades.length
                    });
                }
            }

            // Close remaining positions at end
            if (this.positions.length > 0 && candles.length > 0) {
                const lastBar = candles[candles.length - 1];
                this._closeAllPositions(lastBar.close, lastBar.time, 'backtest_end');
            }

            // Calculate final metrics
            this.metrics = this._calculateMetrics();

            const duration = Date.now() - startTime;
            this.emit('backtestComplete', {
                symbol,
                metrics: this.metrics,
                duration,
                trades: this.closedTrades.length
            });

            return {
                success: true,
                metrics: this.metrics,
                trades: this.closedTrades,
                equity: this.equity
            };

        } catch (error) {
            this.emit('backtestError', { error: error.message });
            return { success: false, error: error.message };
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Execute a trading signal
     */
    async _executeSignal(signal, bar) {
        const { action, size, stopLoss, takeProfit, leverage = 1 } = signal;

        // Apply slippage
        const slippage = bar.close * this.config.slippage;

        switch (action) {
            case 'open_long': {
                const entryPrice = bar.close + slippage;
                if (this._canOpenPosition(size, entryPrice)) {
                    const fee = size * entryPrice * this.config.feeRate;
                    this.capital -= fee;

                    const position = new Position({
                        symbol: signal.symbol || 'UNKNOWN',
                        side: 'long',
                        entryPrice,
                        entryTime: bar.time,
                        size,
                        leverage,
                        stopLoss,
                        takeProfit
                    });
                    position.fees = fee;
                    this.positions.push(position);

                    this.emit('positionOpened', { position, bar });
                }
                break;
            }

            case 'open_short': {
                const entryPrice = bar.close - slippage;
                if (this._canOpenPosition(size, entryPrice)) {
                    const fee = size * entryPrice * this.config.feeRate;
                    this.capital -= fee;

                    const position = new Position({
                        symbol: signal.symbol || 'UNKNOWN',
                        side: 'short',
                        entryPrice,
                        entryTime: bar.time,
                        size,
                        leverage,
                        stopLoss,
                        takeProfit
                    });
                    position.fees = fee;
                    this.positions.push(position);

                    this.emit('positionOpened', { position, bar });
                }
                break;
            }

            case 'close_long':
                this._closePositionsBySide('long', bar.close - slippage, bar.time, 'signal');
                break;

            case 'close_short':
                this._closePositionsBySide('short', bar.close + slippage, bar.time, 'signal');
                break;

            case 'close_all':
                this._closeAllPositions(bar.close, bar.time, 'signal');
                break;
        }
    }

    /**
     * Check if we can open a position based on risk management
     */
    _canOpenPosition(size, price) {
        const totalExposure = this.positions.reduce((sum, p) => sum + (p.size * p.entryPrice), 0);
        const newExposure = size * price;
        const maxAllowed = this.capital * this.config.maxPositionSize;

        return (totalExposure + newExposure) <= maxAllowed * 2; // Allow 2x max position
    }

    /**
     * Check stop loss and take profit triggers
     */
    _checkPositionTriggers(bar) {
        const positionsToClose = [];

        for (const position of this.positions) {
            // Check high/low for triggers (more realistic than just close)
            if (position.shouldTriggerStopLoss(bar.low) || position.shouldTriggerStopLoss(bar.high)) {
                positionsToClose.push({ position, price: position.stopLoss, reason: 'stop_loss' });
            } else if (position.shouldTriggerTakeProfit(bar.high) || position.shouldTriggerTakeProfit(bar.low)) {
                positionsToClose.push({ position, price: position.takeProfit, reason: 'take_profit' });
            }
        }

        for (const { position, price, reason } of positionsToClose) {
            this._closePosition(position, price, bar.time, reason);
        }
    }

    /**
     * Close a specific position
     */
    _closePosition(position, exitPrice, exitTime, reason) {
        const fee = position.size * exitPrice * this.config.feeRate;
        position.fees += fee;
        this.capital -= fee;

        const pnl = position.close(exitPrice, exitTime, reason);
        this.capital += pnl;

        // Remove from open positions
        const idx = this.positions.indexOf(position);
        if (idx > -1) {
            this.positions.splice(idx, 1);
        }

        this.closedTrades.push(position);
        this.emit('positionClosed', { position, pnl });
    }

    /**
     * Close all positions by side
     */
    _closePositionsBySide(side, exitPrice, exitTime, reason) {
        const toClose = this.positions.filter(p => p.side === side);
        for (const position of toClose) {
            this._closePosition(position, exitPrice, exitTime, reason);
        }
    }

    /**
     * Close all open positions
     */
    _closeAllPositions(exitPrice, exitTime, reason) {
        const toClose = [...this.positions];
        for (const position of toClose) {
            this._closePosition(position, exitPrice, exitTime, reason);
        }
    }

    /**
     * Get total unrealized P&L
     */
    _getUnrealizedPnL(currentPrice) {
        return this.positions.reduce((sum, p) => sum + p.getUnrealizedPnL(currentPrice), 0);
    }

    /**
     * Calculate performance metrics
     */
    _calculateMetrics() {
        const trades = this.closedTrades;
        const equityValues = this.equity.map(e => e.value);

        if (trades.length === 0) {
            return {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                profitFactor: 0,
                sharpeRatio: 0,
                sortinoRatio: 0,
                maxDrawdown: 0,
                totalReturn: 0,
                annualizedReturn: 0,
                totalPnL: 0,
                netPnL: 0,
                avgWin: 0,
                avgLoss: 0,
                largestWin: 0,
                largestLoss: 0,
                avgHoldingPeriod: 0,
                totalFees: 0,
                finalCapital: this.capital
            };
        }

        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);

        const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
        const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
        const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

        // Calculate returns for Sharpe/Sortino
        const returns = [];
        for (let i = 1; i < equityValues.length; i++) {
            returns.push((equityValues[i] - equityValues[i - 1]) / equityValues[i - 1]);
        }

        const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const stdDev = this._standardDeviation(returns);
        const downstdDev = this._standardDeviation(returns.filter(r => r < 0));

        // Max drawdown
        let maxDrawdown = 0;
        let peak = equityValues[0];
        for (const val of equityValues) {
            if (val > peak) peak = val;
            const drawdown = (peak - val) / peak;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }

        // Holding period
        const holdingPeriods = trades
            .filter(t => t.exitTime && t.entryTime)
            .map(t => t.exitTime - t.entryTime);
        const avgHoldingPeriod = holdingPeriods.length > 0
            ? holdingPeriods.reduce((a, b) => a + b, 0) / holdingPeriods.length
            : 0;

        // Annualized calculations (assuming daily data, 252 trading days)
        const totalReturn = (this.capital - this.config.initialCapital) / this.config.initialCapital;
        const tradingDays = Math.max(1, equityValues.length);
        const annualizedReturn = Math.pow(1 + totalReturn, 252 / tradingDays) - 1;

        return {
            totalTrades: trades.length,
            winningTrades: wins.length,
            losingTrades: losses.length,
            winRate: (wins.length / trades.length) * 100,
            profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
            sharpeRatio: stdDev > 0 ? (avgReturn * Math.sqrt(252)) / stdDev : 0,
            sortinoRatio: downstdDev > 0 ? (avgReturn * Math.sqrt(252)) / downstdDev : 0,
            maxDrawdown: maxDrawdown * 100,
            totalReturn: totalReturn * 100,
            annualizedReturn: annualizedReturn * 100,
            totalPnL,
            netPnL: totalPnL - totalFees,
            avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
            avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
            largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0,
            largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0,
            avgHoldingPeriod: avgHoldingPeriod / (1000 * 60 * 60), // Convert to hours
            totalFees,
            finalCapital: this.capital
        };
    }

    /**
     * Calculate standard deviation
     */
    _standardDeviation(values) {
        if (values.length === 0) return 0;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const squareDiffs = values.map(v => Math.pow(v - avg, 2));
        const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
        return Math.sqrt(avgSquareDiff);
    }

    /**
     * Stop running backtest
     */
    stop() {
        this.isRunning = false;
    }

    /**
     * Get current state
     */
    getState() {
        return {
            capital: this.capital,
            openPositions: this.positions.length,
            closedTrades: this.closedTrades.length,
            currentBar: this.currentBar,
            totalBars: this.totalBars,
            isRunning: this.isRunning
        };
    }
}

// ==================== BUILT-IN STRATEGIES ====================

/**
 * Simple Moving Average Crossover Strategy
 */
export const SMAStrategy = (shortPeriod = 10, longPeriod = 20) => {
    return (bar, prevBars, engine, index) => {
        if (prevBars.length < longPeriod) return null;

        const closes = prevBars.map(b => b.close);
        const shortSMA = closes.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
        const longSMA = closes.slice(-longPeriod).reduce((a, b) => a + b, 0) / longPeriod;

        const prevCloses = prevBars.slice(0, -1).map(b => b.close);
        const prevShortSMA = prevCloses.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
        const prevLongSMA = prevCloses.slice(-longPeriod).reduce((a, b) => a + b, 0) / longPeriod;

        // Golden cross
        if (prevShortSMA <= prevLongSMA && shortSMA > longSMA) {
            return {
                action: 'open_long',
                size: engine.capital * 0.05 / bar.close,
                stopLoss: bar.close * 0.95,
                takeProfit: bar.close * 1.1
            };
        }

        // Death cross
        if (prevShortSMA >= prevLongSMA && shortSMA < longSMA) {
            return { action: 'close_long' };
        }

        return null;
    };
};

/**
 * RSI Mean Reversion Strategy
 */
export const RSIStrategy = (period = 14, oversold = 30, overbought = 70) => {
    return (bar, prevBars, engine, index) => {
        if (prevBars.length < period + 1) return null;

        const closes = prevBars.map(b => b.close);
        const changes = [];
        for (let i = 1; i < closes.length; i++) {
            changes.push(closes[i] - closes[i - 1]);
        }

        const gains = changes.slice(-period).filter(c => c > 0);
        const losses = changes.slice(-period).filter(c => c < 0).map(c => Math.abs(c));

        const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0.001;

        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        // Oversold - buy
        if (rsi < oversold && engine.positions.length === 0) {
            return {
                action: 'open_long',
                size: engine.capital * 0.05 / bar.close,
                stopLoss: bar.close * 0.93,
                takeProfit: bar.close * 1.08
            };
        }

        // Overbought - sell
        if (rsi > overbought && engine.positions.some(p => p.side === 'long')) {
            return { action: 'close_long' };
        }

        return null;
    };
};

/**
 * Momentum Breakout Strategy
 */
export const MomentumStrategy = (lookback = 20, threshold = 0.02) => {
    return (bar, prevBars, engine, index) => {
        if (prevBars.length < lookback) return null;

        const highestHigh = Math.max(...prevBars.slice(-lookback).map(b => b.high));
        const lowestLow = Math.min(...prevBars.slice(-lookback).map(b => b.low));

        // Breakout above
        if (bar.close > highestHigh * (1 + threshold) && engine.positions.length === 0) {
            return {
                action: 'open_long',
                size: engine.capital * 0.05 / bar.close,
                stopLoss: bar.close * 0.95,
                takeProfit: bar.close * 1.15
            };
        }

        // Breakdown below
        if (bar.close < lowestLow * (1 - threshold) && engine.positions.some(p => p.side === 'long')) {
            return { action: 'close_long' };
        }

        return null;
    };
};

export default BacktestEngine;
