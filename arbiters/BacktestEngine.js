/**
 * Backtest Engine - Test strategies on historical data before risking real money
 *
 * Concept: Never trade a strategy until you've backtested it.
 * This engine simulates trading on historical data to evaluate:
 * - Win rate
 * - Profit factor
 * - Max drawdown
 * - Sharpe ratio
 * - Best/worst trades
 *
 * SOMA can test strategies before deploying them live.
 */

import marketDataService from '../server/finance/marketDataService.js';
import fs from 'fs/promises';
import path from 'path';

export class BacktestEngine {
    constructor({ quadBrain, mtfAnalyzer, positionSizer, regimeDetector, rootPath }) {
        this.quadBrain = quadBrain;
        this.mtfAnalyzer = mtfAnalyzer;
        this.positionSizer = positionSizer;
        this.regimeDetector = regimeDetector;
        this.rootPath = rootPath;
        this.backtestPath = path.join(rootPath, 'data', 'backtests');
    }

    async initialize() {
        await fs.mkdir(this.backtestPath, { recursive: true });
        console.log('[Backtest] ✅ Engine initialized');
    }

    /**
     * Run backtest on a symbol
     *
     * @param {string} symbol - Symbol to test
     * @param {string} strategy - Strategy name
     * @param {Function} strategyFunction - Strategy logic
     * @param {Object} config - Backtest configuration
     */
    async runBacktest(symbol, strategy, strategyFunction, config = {}) {
        const {
            startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
            endDate = new Date(),
            initialCapital = 100000,
            timeframe = '1D',
            slippage = 0.001, // 0.1% slippage
            commission = 0.001 // 0.1% commission
        } = config;

        console.log(`[Backtest] Starting backtest: ${symbol} | ${strategy}`);
        console.log(`[Backtest] Period: ${startDate.toISOString()} → ${endDate.toISOString()}`);
        console.log(`[Backtest] Capital: $${initialCapital.toLocaleString()}`);

        // Fetch historical data
        console.log('[Backtest] Fetching historical data...');
        const bars = await this.getHistoricalData(symbol, timeframe, startDate, endDate);

        if (!bars || bars.length < 20) {
            throw new Error(`Insufficient data for backtest (${bars?.length || 0} bars)`);
        }

        console.log(`[Backtest] ✅ Loaded ${bars.length} bars`);

        // Initialize backtest state
        const state = {
            capital: initialCapital,
            peakCapital: initialCapital,
            position: null,
            trades: [],
            equity: [{ date: bars[0].timestamp, value: initialCapital }],
            metrics: {
                totalTrades: 0,
                wins: 0,
                losses: 0,
                totalPnL: 0,
                totalReturn: 0,
                maxDrawdown: 0,
                currentDrawdown: 0,
                sharpeRatio: 0,
                profitFactor: 0,
                avgWin: 0,
                avgLoss: 0,
                largestWin: 0,
                largestLoss: 0,
                consecutiveWins: 0,
                consecutiveLosses: 0,
                maxConsecutiveWins: 0,
                maxConsecutiveLosses: 0
            }
        };

        // Simulate trading day by day
        console.log('[Backtest] Simulating trades...');
        for (let i = 20; i < bars.length; i++) {
            const currentBar = bars[i];
            const historicalBars = bars.slice(0, i + 1);

            // Call strategy function with historical data
            const signal = await strategyFunction({
                symbol,
                bars: historicalBars,
                currentBar,
                position: state.position,
                capital: state.capital,
                mtfAnalyzer: this.mtfAnalyzer,
                regimeDetector: this.regimeDetector,
                positionSizer: this.positionSizer
            });

            // Process signal
            const isShort = state.position && state.position.side === 'short';
            
            if (signal && signal.action === 'BUY' && !state.position) {
                // Open long position
                const entryPrice = currentBar.close * (1 + slippage);
                const positionSize = signal.positionSize || state.capital * 0.1;
                const isCrypto = symbol.includes('-') || symbol.includes('USDT');
                const shares = isCrypto ? (positionSize / entryPrice) : Math.floor(positionSize / entryPrice);
                const cost = shares * entryPrice * (1 + commission);

                if (cost <= state.capital) {
                    state.position = {
                        symbol,
                        side: 'long',
                        shares,
                        entryPrice,
                        entryDate: currentBar.timestamp,
                        entryBar: i,
                        stopLoss: signal.stopLoss || null,
                        takeProfit: signal.takeProfit || null,
                        context: signal.context || {}
                    };

                    state.capital -= cost;
                    console.log(`[Backtest] ${new Date(currentBar.timestamp).toISOString().split('T')[0]} BUY ${shares.toFixed(4)} @ $${entryPrice.toFixed(2)}`);
                }
            } else if (signal && signal.action === 'SHORT' && !state.position) {
                // Open short position
                const entryPrice = currentBar.close * (1 - slippage);
                const positionSize = signal.positionSize || state.capital * 0.1;
                const isCrypto = symbol.includes('-') || symbol.includes('USDT');
                const shares = isCrypto ? (positionSize / entryPrice) : Math.floor(positionSize / entryPrice);
                const cost = shares * entryPrice * (1 + commission);

                if (cost <= state.capital) {
                    state.position = {
                        symbol,
                        side: 'short',
                        shares,
                        entryPrice,
                        entryDate: currentBar.timestamp,
                        entryBar: i,
                        stopLoss: signal.stopLoss || null,
                        takeProfit: signal.takeProfit || null,
                        context: signal.context || {}
                    };

                    state.capital -= cost;
                    console.log(`[Backtest] ${new Date(currentBar.timestamp).toISOString().split('T')[0]} SHORT ${shares.toFixed(4)} @ $${entryPrice.toFixed(2)}`);
                }
            } else if (signal && state.position && (
                (state.position.side === 'long' && signal.action === 'SELL') ||
                (state.position.side === 'short' && (signal.action === 'BUY' || signal.action === 'COVER'))
            )) {
                // Close position manually
                const isPositionShort = state.position.side === 'short';
                const exitPrice = isPositionShort ? currentBar.close * (1 + slippage) : currentBar.close * (1 - slippage);
                
                const entryVal = state.position.entryPrice * state.position.shares;
                const exitVal = exitPrice * state.position.shares;
                const fees = (entryVal + exitVal) * commission;
                
                const pnl = isPositionShort ? (entryVal - exitVal - fees) : (exitVal - entryVal - fees);
                const pnlPercent = isPositionShort 
                    ? ((state.position.entryPrice - exitPrice) / state.position.entryPrice) * 100
                    : ((exitPrice - state.position.entryPrice) / state.position.entryPrice) * 100;

                const returnedCapital = isPositionShort 
                    ? (entryVal * (1 + commission) + pnl) 
                    : (exitVal - (exitVal * commission));

                state.capital += returnedCapital;

                const trade = {
                    symbol,
                    side: state.position.side,
                    shares: state.position.shares,
                    entryPrice: state.position.entryPrice,
                    exitPrice,
                    entryDate: state.position.entryDate,
                    exitDate: currentBar.timestamp,
                    holdingPeriod: i - state.position.entryBar,
                    pnl,
                    pnlPercent,
                    context: state.position.context
                };

                state.trades.push(trade);
                state.position = null;

                this.updateMetrics(state, trade);
                console.log(`[Backtest] ${new Date(currentBar.timestamp).toISOString().split('T')[0]} CLOSE @ $${exitPrice.toFixed(2)} | P&L: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
            } else if (state.position) {
                // Process update signal (trailing stops)
                if (signal && signal.action === 'UPDATE') {
                    if (signal.stopLoss) state.position.stopLoss = signal.stopLoss;
                    if (signal.takeProfit) state.position.takeProfit = signal.takeProfit;
                    if (signal.context) state.position.context = { ...state.position.context, ...signal.context };
                }

                // Check stop loss / take profit
                const isPositionShort = state.position.side === 'short';
                const stopLossHit = isPositionShort
                    ? (currentBar.high >= state.position.stopLoss)
                    : (currentBar.low <= state.position.stopLoss);
                    
                const takeProfitHit = isPositionShort
                    ? (currentBar.low <= state.position.takeProfit)
                    : (currentBar.high >= state.position.takeProfit);

                if (state.position.stopLoss && stopLossHit) {
                    // Stop loss hit
                    const exitPrice = state.position.stopLoss;
                    const entryVal = state.position.entryPrice * state.position.shares;
                    const exitVal = exitPrice * state.position.shares;
                    const fees = (entryVal + exitVal) * commission;
                    
                    const pnl = isPositionShort ? (entryVal - exitVal - fees) : (exitVal - entryVal - fees);
                    const pnlPercent = isPositionShort 
                        ? ((state.position.entryPrice - exitPrice) / state.position.entryPrice) * 100
                        : ((exitPrice - state.position.entryPrice) / state.position.entryPrice) * 100;

                    const returnedCapital = isPositionShort 
                        ? (entryVal * (1 + commission) + pnl) 
                        : (exitVal - (exitVal * commission));

                    state.capital += returnedCapital;

                    const trade = {
                        symbol,
                        side: state.position.side,
                        shares: state.position.shares,
                        entryPrice: state.position.entryPrice,
                        exitPrice,
                        entryDate: state.position.entryDate,
                        exitDate: currentBar.timestamp,
                        holdingPeriod: i - state.position.entryBar,
                        pnl,
                        pnlPercent,
                        exitReason: 'STOP_LOSS',
                        context: state.position.context
                    };

                    state.trades.push(trade);
                    state.position = null;
                    this.updateMetrics(state, trade);

                    console.log(`[Backtest] ${new Date(currentBar.timestamp).toISOString().split('T')[0]} STOP LOSS @ $${exitPrice.toFixed(2)} | P&L: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`);
                } else if (state.position.takeProfit && takeProfitHit) {
                    // Take profit hit
                    const exitPrice = state.position.takeProfit;
                    const entryVal = state.position.entryPrice * state.position.shares;
                    const exitVal = exitPrice * state.position.shares;
                    const fees = (entryVal + exitVal) * commission;
                    
                    const pnl = isPositionShort ? (entryVal - exitVal - fees) : (exitVal - entryVal - fees);
                    const pnlPercent = isPositionShort 
                        ? ((state.position.entryPrice - exitPrice) / state.position.entryPrice) * 100
                        : ((exitPrice - state.position.entryPrice) / state.position.entryPrice) * 100;

                    const returnedCapital = isPositionShort 
                        ? (entryVal * (1 + commission) + pnl) 
                        : (exitVal - (exitVal * commission));

                    state.capital += returnedCapital;

                    const trade = {
                        symbol,
                        side: state.position.side,
                        shares: state.position.shares,
                        entryPrice: state.position.entryPrice,
                        exitPrice,
                        entryDate: state.position.entryDate,
                        exitDate: currentBar.timestamp,
                        holdingPeriod: i - state.position.entryBar,
                        pnl,
                        pnlPercent,
                        exitReason: 'TAKE_PROFIT',
                        context: state.position.context
                    };

                    state.trades.push(trade);
                    state.position = null;
                    this.updateMetrics(state, trade);

                    console.log(`[Backtest] ${new Date(currentBar.timestamp).toISOString().split('T')[0]} TAKE PROFIT @ $${exitPrice.toFixed(2)} | P&L: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`);
                }
            }

            // Track equity curve
            let positionValue = 0;
            if (state.position) {
                const isPositionShort = state.position.side === 'short';
                if (isPositionShort) {
                    const entryVal = state.position.entryPrice * state.position.shares;
                    const unrealizedPnl = (state.position.entryPrice - currentBar.close) * state.position.shares - (state.position.entryPrice + currentBar.close) * state.position.shares * commission;
                    positionValue = entryVal * (1 + commission) + unrealizedPnl;
                } else {
                    positionValue = state.position.shares * currentBar.close * (1 - commission);
                }
            }
            const currentEquity = state.capital + positionValue;
            state.equity.push({ date: currentBar.timestamp, value: currentEquity });

            // Update peak and drawdown
            if (currentEquity > state.peakCapital) {
                state.peakCapital = currentEquity;
            }
            const drawdown = ((state.peakCapital - currentEquity) / state.peakCapital) * 100;
            state.metrics.currentDrawdown = drawdown;
            state.metrics.maxDrawdown = Math.max(state.metrics.maxDrawdown, drawdown);
        }

        // Close any open position at end
        if (state.position) {
            const currentBar = bars[bars.length - 1];
            const exitPrice = currentBar.close;
            const proceeds = state.position.shares * exitPrice * (1 - commission);
            const pnl = proceeds - (state.position.shares * state.position.entryPrice * (1 + commission));
            const pnlPercent = (pnl / (state.position.shares * state.position.entryPrice)) * 100;

            state.capital += proceeds;

            const trade = {
                symbol,
                side: state.position.side,
                shares: state.position.shares,
                entryPrice: state.position.entryPrice,
                exitPrice,
                entryDate: state.position.entryDate,
                exitDate: currentBar.timestamp,
                holdingPeriod: bars.length - 1 - state.position.entryBar,
                pnl,
                pnlPercent,
                exitReason: 'END_OF_TEST',
                context: state.position.context
            };

            state.trades.push(trade);
            state.position = null;
            this.updateMetrics(state, trade);
        }

        // Calculate final metrics
        state.metrics.totalReturn = ((state.capital - initialCapital) / initialCapital) * 100;
        state.metrics.sharpeRatio = this.calculateSharpe(state.trades);

        // Generate report
        const report = this.generateReport(symbol, strategy, state, initialCapital, config);

        // Save backtest
        const backtestResult = {
            symbol,
            strategy,
            config,
            state,
            report,
            timestamp: Date.now()
        };

        const filename = `backtest_${symbol}_${strategy}_${Date.now()}.json`;
        await fs.writeFile(
            path.join(this.backtestPath, filename),
            JSON.stringify(backtestResult, null, 2)
        );

        console.log(`[Backtest] ✅ Saved to ${filename}`);

        return backtestResult;
    }

    /**
     * Update backtest metrics after each trade
     */
    updateMetrics(state, trade) {
        state.metrics.totalTrades++;

        if (trade.pnl > 0) {
            state.metrics.wins++;
            state.metrics.consecutiveWins++;
            state.metrics.consecutiveLosses = 0;
            state.metrics.maxConsecutiveWins = Math.max(state.metrics.maxConsecutiveWins, state.metrics.consecutiveWins);
            state.metrics.avgWin = ((state.metrics.avgWin * (state.metrics.wins - 1)) + trade.pnlPercent) / state.metrics.wins;
            state.metrics.largestWin = Math.max(state.metrics.largestWin, trade.pnlPercent);
        } else {
            state.metrics.losses++;
            state.metrics.consecutiveLosses++;
            state.metrics.consecutiveWins = 0;
            state.metrics.maxConsecutiveLosses = Math.max(state.metrics.maxConsecutiveLosses, state.metrics.consecutiveLosses);
            state.metrics.avgLoss = ((state.metrics.avgLoss * (state.metrics.losses - 1)) + Math.abs(trade.pnlPercent)) / state.metrics.losses;
            state.metrics.largestLoss = Math.min(state.metrics.largestLoss, trade.pnlPercent);
        }

        state.metrics.totalPnL += trade.pnl;

        // Profit factor
        const grossProfit = state.trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(state.trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
        state.metrics.profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    }

    /**
     * Calculate Sharpe Ratio
     */
    calculateSharpe(trades) {
        if (trades.length < 2) return 0;

        const returns = trades.map(t => t.pnlPercent);
        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);

        return stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
    }

    /**
     * Generate backtest report
     */
    generateReport(symbol, strategy, state, initialCapital, config) {
        const winRate = state.metrics.totalTrades > 0 ? (state.metrics.wins / state.metrics.totalTrades) * 100 : 0;

        return `
════════════════════════════════════════════════════════════════
                    BACKTEST REPORT
════════════════════════════════════════════════════════════════

Symbol:          ${symbol}
Strategy:        ${strategy}
Timeframe:       ${config.timeframe || '1D'}
Period:          ${new Date(config.startDate).toISOString().split('T')[0]} → ${new Date(config.endDate).toISOString().split('T')[0]}

────────────────────────────────────────────────────────────────
                    PERFORMANCE METRICS
────────────────────────────────────────────────────────────────

Initial Capital:     $${initialCapital.toLocaleString()}
Final Capital:       $${state.capital.toFixed(2).toLocaleString()}
Total Return:        ${state.metrics.totalReturn > 0 ? '+' : ''}${state.metrics.totalReturn.toFixed(2)}%
Total P&L:           ${state.metrics.totalPnL > 0 ? '+' : ''}$${state.metrics.totalPnL.toFixed(2)}

Max Drawdown:        -${state.metrics.maxDrawdown.toFixed(2)}%
Sharpe Ratio:        ${state.metrics.sharpeRatio.toFixed(2)}
Profit Factor:       ${state.metrics.profitFactor.toFixed(2)}

────────────────────────────────────────────────────────────────
                    TRADE STATISTICS
────────────────────────────────────────────────────────────────

Total Trades:        ${state.metrics.totalTrades}
Wins:                ${state.metrics.wins} (${winRate.toFixed(1)}%)
Losses:              ${state.metrics.losses} (${(100 - winRate).toFixed(1)}%)

Avg Win:             +${state.metrics.avgWin.toFixed(2)}%
Avg Loss:            -${state.metrics.avgLoss.toFixed(2)}%
Largest Win:         +${state.metrics.largestWin.toFixed(2)}%
Largest Loss:        ${state.metrics.largestLoss.toFixed(2)}%

Max Win Streak:      ${state.metrics.maxConsecutiveWins}
Max Loss Streak:     ${state.metrics.maxConsecutiveLosses}

────────────────────────────────────────────────────────────────
                    VERDICT
────────────────────────────────────────────────────────────────

${this.generateVerdict(state.metrics)}

════════════════════════════════════════════════════════════════
        `.trim();
    }

    /**
     * Generate verdict based on metrics
     */
    generateVerdict(metrics) {
        const winRate = (metrics.wins / metrics.totalTrades) * 100;
        const verdicts = [];

        if (metrics.totalReturn > 20) verdicts.push('✅ EXCELLENT RETURNS');
        else if (metrics.totalReturn > 10) verdicts.push('✅ GOOD RETURNS');
        else if (metrics.totalReturn > 0) verdicts.push('⚠️  MODEST RETURNS');
        else verdicts.push('❌ NEGATIVE RETURNS');

        if (winRate > 60) verdicts.push('✅ HIGH WIN RATE');
        else if (winRate > 50) verdicts.push('⚠️  MODERATE WIN RATE');
        else verdicts.push('❌ LOW WIN RATE');

        if (metrics.profitFactor > 2) verdicts.push('✅ EXCELLENT PROFIT FACTOR');
        else if (metrics.profitFactor > 1.5) verdicts.push('✅ GOOD PROFIT FACTOR');
        else if (metrics.profitFactor > 1) verdicts.push('⚠️  MARGINAL PROFIT FACTOR');
        else verdicts.push('❌ POOR PROFIT FACTOR');

        if (metrics.maxDrawdown < 10) verdicts.push('✅ LOW DRAWDOWN');
        else if (metrics.maxDrawdown < 20) verdicts.push('⚠️  MODERATE DRAWDOWN');
        else verdicts.push('❌ HIGH DRAWDOWN');

        if (metrics.sharpeRatio > 2) verdicts.push('✅ EXCELLENT RISK-ADJ RETURNS');
        else if (metrics.sharpeRatio > 1) verdicts.push('✅ GOOD RISK-ADJ RETURNS');
        else if (metrics.sharpeRatio > 0) verdicts.push('⚠️  POOR RISK-ADJ RETURNS');
        else verdicts.push('❌ NEGATIVE RISK-ADJ RETURNS');

        return verdicts.join('\n');
    }

    /**
     * Get historical data for backtesting
     */
    async getHistoricalData(symbol, timeframe, startDate, endDate) {
        try {
            const filename = `${symbol}_${timeframe}.json`;
            const cachePath = path.join(this.rootPath || process.cwd(), 'data', 'trading', 'historical-cache', filename);
            try {
                const content = await fs.readFile(cachePath, 'utf8');
                const bars = JSON.parse(content);
                if (Array.isArray(bars) && bars.length > 0) {
                    console.log(`[Backtest] 📂 Loaded ${bars.length} bars directly from historical cache: ${filename}`);
                    return bars;
                }
            } catch (fsErr) {
                // Fallback to marketDataService if file doesn't exist
            }
            return await marketDataService.getBars(symbol, timeframe, 1000);
        } catch (err) {
            console.error('[Backtest] Failed to fetch data:', err.message);
            throw err;
        }
    }
}
