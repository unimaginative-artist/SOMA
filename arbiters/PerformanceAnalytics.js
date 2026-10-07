/**
 * Performance Analytics - Track and analyze trading performance
 *
 * Concept: You can't improve what you don't measure.
 * This system tracks EVERYTHING:
 * - Win rate over time
 * - Profit curves
 * - Best/worst trades
 * - Performance by strategy
 * - Performance by market regime
 * - Time-of-day analysis
 * - Holding period analysis
 * - And generates actionable insights
 */

import fs from 'fs/promises';
import path from 'path';

export class PerformanceAnalytics {
    constructor({ rootPath }) {
        this.rootPath = rootPath;
        this.analyticsPath = path.join(rootPath, 'data', 'analytics');
        this.trades = [];
        this.dailyStats = [];
        this.strategyStats = new Map();
        this.regimeStats = new Map();
    }

    async initialize() {
        await fs.mkdir(this.analyticsPath, { recursive: true });
        await this.loadHistoricalData();
        console.log('[Analytics] ✅ Initialized');
    }

    /**
     * Record a completed trade
     */
    async recordTrade(trade) {
        this.trades.push({
            ...trade,
            timestamp: trade.timestamp || Date.now()
        });

        // Update running statistics
        this.updateStatistics(trade);

        // Save to disk periodically
        if (this.trades.length % 10 === 0) {
            await this.saveAnalytics();
        }
    }

    /**
     * Update running statistics
     */
    updateStatistics(trade) {
        const strategy = trade.strategy || 'Unknown';
        const regime = trade.regime || 'Unknown';

        // Update strategy stats
        if (!this.strategyStats.has(strategy)) {
            this.strategyStats.set(strategy, this.createEmptyStats());
        }
        this.updateStrategyStats(this.strategyStats.get(strategy), trade);

        // Update regime stats
        if (!this.regimeStats.has(regime)) {
            this.regimeStats.set(regime, this.createEmptyStats());
        }
        this.updateStrategyStats(this.regimeStats.get(regime), trade);

        // Update daily stats
        this.updateDailyStats(trade);
    }

    /**
     * Create empty stats object
     */
    createEmptyStats() {
        return {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            totalPnL: 0,
            totalPnLPercent: 0,
            avgWin: 0,
            avgLoss: 0,
            largestWin: 0,
            largestLoss: 0,
            winRate: 0,
            profitFactor: 0,
            avgHoldingPeriod: 0,
            consecutiveWins: 0,
            consecutiveLosses: 0,
            maxConsecutiveWins: 0,
            maxConsecutiveLosses: 0,
            trades: []
        };
    }

    /**
     * Update strategy statistics
     */
    updateStrategyStats(stats, trade) {
        stats.totalTrades++;
        stats.trades.push(trade);

        const isWin = trade.pnl > 0;

        if (isWin) {
            stats.wins++;
            stats.consecutiveWins++;
            stats.consecutiveLosses = 0;
            stats.maxConsecutiveWins = Math.max(stats.maxConsecutiveWins, stats.consecutiveWins);
            stats.avgWin = ((stats.avgWin * (stats.wins - 1)) + trade.pnlPercent) / stats.wins;
            stats.largestWin = Math.max(stats.largestWin, trade.pnlPercent);
        } else {
            stats.losses++;
            stats.consecutiveLosses++;
            stats.consecutiveWins = 0;
            stats.maxConsecutiveLosses = Math.max(stats.maxConsecutiveLosses, stats.consecutiveLosses);
            stats.avgLoss = ((stats.avgLoss * (stats.losses - 1)) + Math.abs(trade.pnlPercent)) / stats.losses;
            stats.largestLoss = Math.min(stats.largestLoss, trade.pnlPercent);
        }

        stats.totalPnL += trade.pnl;
        stats.totalPnLPercent += trade.pnlPercent;
        stats.winRate = (stats.wins / stats.totalTrades) * 100;

        // Profit factor
        const grossProfit = stats.trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(stats.trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
        stats.profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

        // Average holding period
        if (trade.holdingPeriod) {
            const totalHolding = stats.avgHoldingPeriod * (stats.totalTrades - 1) + trade.holdingPeriod;
            stats.avgHoldingPeriod = totalHolding / stats.totalTrades;
        }
    }

    /**
     * Update daily statistics
     */
    updateDailyStats(trade) {
        const tradeDate = new Date(trade.timestamp).toISOString().split('T')[0];

        let dayStats = this.dailyStats.find(d => d.date === tradeDate);

        if (!dayStats) {
            dayStats = {
                date: tradeDate,
                trades: 0,
                wins: 0,
                losses: 0,
                pnl: 0,
                pnlPercent: 0
            };
            this.dailyStats.push(dayStats);
        }

        dayStats.trades++;
        if (trade.pnl > 0) dayStats.wins++;
        else dayStats.losses++;
        dayStats.pnl += trade.pnl;
        dayStats.pnlPercent += trade.pnlPercent;
    }

    /**
     * Generate performance report
     */
    generateReport() {
        if (this.trades.length === 0) {
            return 'No trades recorded yet.';
        }

        const overall = this.calculateOverallStats();
        const bestStrategy = this.getBestStrategy();
        const worstStrategy = this.getWorstStrategy();
        const bestRegime = this.getBestRegime();
        const insights = this.generateInsights();

        return `
════════════════════════════════════════════════════════════════
                    PERFORMANCE ANALYTICS
════════════════════════════════════════════════════════════════

Total Trades:        ${overall.totalTrades}
Win Rate:            ${overall.winRate.toFixed(1)}% (${overall.wins}W / ${overall.losses}L)
Total P&L:           ${overall.totalPnL > 0 ? '+' : ''}$${overall.totalPnL.toFixed(2)}
Avg Return/Trade:    ${overall.avgReturn > 0 ? '+' : ''}${overall.avgReturn.toFixed(2)}%

Profit Factor:       ${overall.profitFactor.toFixed(2)}
Avg Win:             +${overall.avgWin.toFixed(2)}%
Avg Loss:            -${overall.avgLoss.toFixed(2)}%
Risk/Reward:         ${overall.riskReward.toFixed(2)}

Best Trade:          +${overall.largestWin.toFixed(2)}% (${overall.bestTradeSymbol})
Worst Trade:         ${overall.largestLoss.toFixed(2)}% (${overall.worstTradeSymbol})

Streaks:
  Max Win Streak:    ${overall.maxConsecutiveWins}
  Max Loss Streak:   ${overall.maxConsecutiveLosses}
  Current Streak:    ${overall.currentStreak}

────────────────────────────────────────────────────────────────
                    STRATEGY PERFORMANCE
────────────────────────────────────────────────────────────────

Best Strategy:       ${bestStrategy.name}
  Win Rate:          ${bestStrategy.winRate.toFixed(1)}%
  Profit Factor:     ${bestStrategy.profitFactor.toFixed(2)}
  Total P&L:         ${bestStrategy.totalPnL > 0 ? '+' : ''}$${bestStrategy.totalPnL.toFixed(2)}

Worst Strategy:      ${worstStrategy.name}
  Win Rate:          ${worstStrategy.winRate.toFixed(1)}%
  Profit Factor:     ${worstStrategy.profitFactor.toFixed(2)}
  Total P&L:         ${worstStrategy.totalPnL > 0 ? '+' : ''}$${worstStrategy.totalPnL.toFixed(2)}

────────────────────────────────────────────────────────────────
                    MARKET REGIME PERFORMANCE
────────────────────────────────────────────────────────────────

Best Regime:         ${bestRegime.name}
  Win Rate:          ${bestRegime.winRate.toFixed(1)}%
  Avg Return:        ${bestRegime.avgReturn > 0 ? '+' : ''}${bestRegime.avgReturn.toFixed(2)}%
  Trades:            ${bestRegime.trades}

────────────────────────────────────────────────────────────────
                    ACTIONABLE INSIGHTS
────────────────────────────────────────────────────────────────

${insights.join('\n')}

════════════════════════════════════════════════════════════════
        `.trim();
    }

    /**
     * Calculate overall statistics
     */
    calculateOverallStats() {
        const wins = this.trades.filter(t => t.pnl > 0);
        const losses = this.trades.filter(t => t.pnl < 0);

        const totalPnL = this.trades.reduce((sum, t) => sum + t.pnl, 0);
        const totalPnLPercent = this.trades.reduce((sum, t) => sum + t.pnlPercent, 0);

        const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnlPercent, 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0) / losses.length) : 0;

        const largestWin = Math.max(...this.trades.map(t => t.pnlPercent), 0);
        const largestLoss = Math.min(...this.trades.map(t => t.pnlPercent), 0);

        const bestTrade = this.trades.find(t => t.pnlPercent === largestWin);
        const worstTrade = this.trades.find(t => t.pnlPercent === largestLoss);

        // Calculate current streak
        let currentStreak = 0;
        let streakType = '';
        for (let i = this.trades.length - 1; i >= 0; i--) {
            const isWin = this.trades[i].pnl > 0;
            if (currentStreak === 0) {
                currentStreak = 1;
                streakType = isWin ? 'W' : 'L';
            } else if ((isWin && streakType === 'W') || (!isWin && streakType === 'L')) {
                currentStreak++;
            } else {
                break;
            }
        }

        // Max consecutive wins/losses
        let maxWins = 0, maxLosses = 0, currentWins = 0, currentLosses = 0;
        for (const trade of this.trades) {
            if (trade.pnl > 0) {
                currentWins++;
                currentLosses = 0;
                maxWins = Math.max(maxWins, currentWins);
            } else {
                currentLosses++;
                currentWins = 0;
                maxLosses = Math.max(maxLosses, currentLosses);
            }
        }

        return {
            totalTrades: this.trades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: (wins.length / this.trades.length) * 100,
            totalPnL,
            avgReturn: totalPnLPercent / this.trades.length,
            avgWin,
            avgLoss,
            riskReward: avgLoss > 0 ? avgWin / avgLoss : avgWin,
            largestWin,
            largestLoss,
            bestTradeSymbol: bestTrade?.symbol || 'N/A',
            worstTradeSymbol: worstTrade?.symbol || 'N/A',
            profitFactor: avgLoss > 0 ? (wins.reduce((s, t) => s + t.pnl, 0) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0))) : Infinity,
            maxConsecutiveWins: maxWins,
            maxConsecutiveLosses: maxLosses,
            currentStreak: `${currentStreak}${streakType}`
        };
    }

    /**
     * Get best performing strategy
     */
    getBestStrategy() {
        let best = { name: 'N/A', winRate: 0, profitFactor: 0, totalPnL: 0 };

        for (const [name, stats] of this.strategyStats.entries()) {
            if (stats.profitFactor > best.profitFactor) {
                best = {
                    name,
                    winRate: stats.winRate,
                    profitFactor: stats.profitFactor,
                    totalPnL: stats.totalPnL,
                    trades: stats.totalTrades
                };
            }
        }

        return best;
    }

    /**
     * Get worst performing strategy
     */
    getWorstStrategy() {
        let worst = { name: 'N/A', winRate: 100, profitFactor: Infinity, totalPnL: 0 };

        for (const [name, stats] of this.strategyStats.entries()) {
            if (stats.profitFactor < worst.profitFactor) {
                worst = {
                    name,
                    winRate: stats.winRate,
                    profitFactor: stats.profitFactor,
                    totalPnL: stats.totalPnL,
                    trades: stats.totalTrades
                };
            }
        }

        return worst;
    }

    /**
     * Get best performing regime
     */
    getBestRegime() {
        let best = { name: 'N/A', winRate: 0, avgReturn: 0, trades: 0 };

        for (const [name, stats] of this.regimeStats.entries()) {
            const avgReturn = stats.totalPnLPercent / stats.totalTrades;
            if (avgReturn > best.avgReturn) {
                best = {
                    name,
                    winRate: stats.winRate,
                    avgReturn,
                    trades: stats.totalTrades
                };
            }
        }

        return best;
    }

    /**
     * Generate actionable insights
     */
    generateInsights() {
        const insights = [];
        const overall = this.calculateOverallStats();

        // Win rate insights
        if (overall.winRate > 60) {
            insights.push('✅ Strong win rate - strategy is working well');
        } else if (overall.winRate < 45) {
            insights.push('⚠️  Low win rate - consider reviewing strategy selection');
        }

        // Risk/reward insights
        if (overall.riskReward > 2) {
            insights.push('✅ Excellent risk/reward ratio - wins are much larger than losses');
        } else if (overall.riskReward < 1.5) {
            insights.push('⚠️  Poor risk/reward - need larger wins or smaller losses');
        }

        // Profit factor insights
        if (overall.profitFactor > 2) {
            insights.push('✅ High profit factor - strong edge in the market');
        } else if (overall.profitFactor < 1.5) {
            insights.push('⚠️  Low profit factor - strategy barely profitable');
        }

        // Streak insights
        if (overall.currentStreak.endsWith('L') && parseInt(overall.currentStreak) >= 3) {
            insights.push('⚠️  On a losing streak - consider reducing position sizes');
        } else if (overall.currentStreak.endsWith('W') && parseInt(overall.currentStreak) >= 3) {
            insights.push('✅ On a winning streak - strategy is in sync with market');
        }

        // Strategy-specific insights
        const bestStrategy = this.getBestStrategy();
        const worstStrategy = this.getWorstStrategy();

        if (bestStrategy.name !== 'N/A' && worstStrategy.name !== 'N/A') {
            insights.push(`💡 Focus on "${bestStrategy.name}" strategy (${bestStrategy.winRate.toFixed(0)}% win rate)`);
            if (worstStrategy.profitFactor < 1) {
                insights.push(`⚠️  Avoid "${worstStrategy.name}" strategy (losing money)`);
            }
        }

        // Regime insights
        const bestRegime = this.getBestRegime();
        if (bestRegime.name !== 'N/A') {
            insights.push(`💡 Best performance in ${bestRegime.name} markets (${bestRegime.avgReturn.toFixed(2)}% avg return)`);
        }

        // Sample size warning
        if (this.trades.length < 20) {
            insights.push('⚠️  Small sample size - need more trades for statistical significance');
        }

        return insights;
    }

    /**
     * Get equity curve data (for charting)
     */
    getEquityCurve() {
        let runningEquity = 0;
        const curve = [];

        for (const trade of this.trades) {
            runningEquity += trade.pnl;
            curve.push({
                date: trade.timestamp,
                equity: runningEquity,
                trade: trade.symbol,
                pnl: trade.pnl
            });
        }

        return curve;
    }

    /**
     * Get daily P&L breakdown
     */
    getDailyPnL() {
        return this.dailyStats.map(day => ({
            date: day.date,
            pnl: day.pnl,
            trades: day.trades,
            winRate: day.trades > 0 ? (day.wins / day.trades) * 100 : 0
        }));
    }

    /**
     * Get performance by hour of day
     */
    getPerformanceByHour() {
        const hourlyStats = new Array(24).fill(null).map(() => ({
            trades: 0,
            pnl: 0,
            wins: 0
        }));

        for (const trade of this.trades) {
            const hour = new Date(trade.timestamp).getHours();
            hourlyStats[hour].trades++;
            hourlyStats[hour].pnl += trade.pnl;
            if (trade.pnl > 0) hourlyStats[hour].wins++;
        }

        return hourlyStats.map((stats, hour) => ({
            hour,
            trades: stats.trades,
            pnl: stats.pnl,
            winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
            avgPnl: stats.trades > 0 ? stats.pnl / stats.trades : 0
        }));
    }

    /**
     * Save analytics to disk
     */
    async saveAnalytics() {
        const data = {
            trades: this.trades,
            dailyStats: this.dailyStats,
            strategyStats: Array.from(this.strategyStats.entries()),
            regimeStats: Array.from(this.regimeStats.entries()),
            timestamp: Date.now()
        };

        const filename = path.join(this.analyticsPath, 'performance_analytics.json');
        await fs.writeFile(filename, JSON.stringify(data, null, 2));
    }

    /**
     * Load historical analytics
     */
    async loadHistoricalData() {
        try {
            const filename = path.join(this.analyticsPath, 'performance_analytics.json');
            const content = await fs.readFile(filename, 'utf-8');
            const data = JSON.parse(content);

            this.trades = data.trades || [];
            this.dailyStats = data.dailyStats || [];
            this.strategyStats = new Map(data.strategyStats || []);
            this.regimeStats = new Map(data.regimeStats || []);

            console.log(`[Analytics] Loaded ${this.trades.length} historical trades`);
        } catch (err) {
            // First run, no data yet
            console.log('[Analytics] No historical data found, starting fresh');
        }
    }

    /**
     * Export data for external analysis (CSV, etc.)
     */
    async exportToCSV() {
        const csv = ['Date,Symbol,Side,Entry,Exit,PnL,PnL%,Strategy,Regime'].concat(
            this.trades.map(t =>
                `${new Date(t.timestamp).toISOString()},${t.symbol},${t.side},${t.entryPrice},${t.exitPrice},${t.pnl},${t.pnlPercent},${t.strategy || ''},${t.regime || ''}`
            )
        ).join('\n');

        const filename = path.join(this.analyticsPath, `trades_export_${Date.now()}.csv`);
        await fs.writeFile(filename, csv);

        return filename;
    }
}
