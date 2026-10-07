/**
 * Meta-Learning System - Production Grade
 *
 * Learns which strategies work in which market regimes and automatically:
 * - Disables underperforming strategies
 * - Enables high-performing strategies
 * - Prevents flip-flopping with cooldown periods
 * - Requires statistical significance (minimum sample size)
 *
 * This makes SOMA self-improving - it learns from experience and adapts.
 */

import fs from 'fs/promises';
import path from 'path';

export class MetaLearner {
    constructor({ rootPath, performanceAnalytics = null, minSampleSize = 20 }) {
        this.rootPath = rootPath;
        this.performanceAnalytics = performanceAnalytics;
        this.dataPath = path.join(rootPath, 'data', 'meta_learning');

        // Configuration
        this.minSampleSize = minSampleSize; // Minimum trades before making decisions
        this.disableThreshold = 0.40; // Disable if win rate < 40%
        this.enableThreshold = 0.60;  // Enable if win rate > 60%
        this.cooldownPeriod = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

        // State
        this.strategyPerformance = new Map(); // strategy -> { regime -> stats }
        this.strategyStates = new Map(); // strategy -> { enabled, lastChange, reason }
        this.overrides = new Map(); // strategy -> { forced: true/false, reason }
    }

    async initialize() {
        await fs.mkdir(this.dataPath, { recursive: true });
        await this.loadState();
        console.log('[MetaLearner] ✅ Initialized with', this.strategyPerformance.size, 'strategies tracked');
    }

    /**
     * Record a trade outcome for learning
     */
    recordTrade(strategyName, regime, outcome) {
        const { win, pnl, pnlPercent, confidence } = outcome;

        // Get or create strategy performance data
        if (!this.strategyPerformance.has(strategyName)) {
            this.strategyPerformance.set(strategyName, new Map());
        }

        const strategyData = this.strategyPerformance.get(strategyName);

        // Get or create regime-specific stats
        if (!strategyData.has(regime)) {
            strategyData.set(regime, {
                trades: [],
                wins: 0,
                losses: 0,
                totalPnL: 0,
                avgPnL: 0,
                winRate: 0,
                confidenceInterval: { lower: 0, upper: 1 },
                lastUpdated: Date.now()
            });
        }

        const stats = strategyData.get(regime);

        // Add trade
        stats.trades.push({
            timestamp: Date.now(),
            win,
            pnl,
            pnlPercent,
            confidence
        });

        // Update stats
        if (win) {
            stats.wins++;
        } else {
            stats.losses++;
        }

        stats.totalPnL += pnl;
        const totalTrades = stats.wins + stats.losses;
        stats.winRate = stats.wins / totalTrades;
        stats.avgPnL = stats.totalPnL / totalTrades;
        stats.lastUpdated = Date.now();

        // Calculate confidence interval (Wilson score)
        stats.confidenceInterval = this.calculateConfidenceInterval(stats.wins, totalTrades);

        // Update strategy state if needed
        this.updateStrategyState(strategyName, regime);

        // Save state periodically
        if (totalTrades % 5 === 0) {
            this.saveState();
        }
    }

    /**
     * Update strategy enabled/disabled state based on performance
     */
    updateStrategyState(strategyName, currentRegime) {
        // Check if manual override
        if (this.overrides.has(strategyName)) {
            return; // Don't auto-adjust if manually overridden
        }

        const stats = this.getStrategyStats(strategyName, currentRegime);
        const totalTrades = stats.wins + stats.losses;

        // Not enough data yet
        if (totalTrades < this.minSampleSize) {
            return;
        }

        // Check cooldown period
        const currentState = this.strategyStates.get(strategyName);
        if (currentState && currentState.lastChange) {
            const timeSinceChange = Date.now() - currentState.lastChange;
            if (timeSinceChange < this.cooldownPeriod) {
                return; // Still in cooldown
            }
        }

        const winRate = stats.winRate;
        const ci = stats.confidenceInterval;

        // Decision logic
        let shouldEnable = true;
        let reason = '';

        // Disable if upper bound of confidence interval < threshold
        if (ci.upper < this.disableThreshold) {
            shouldEnable = false;
            reason = `Low win rate: ${(winRate * 100).toFixed(1)}% (CI: ${(ci.lower * 100).toFixed(1)}%-${(ci.upper * 100).toFixed(1)}%) in ${currentRegime}`;
        }
        // Enable if lower bound > threshold
        else if (ci.lower > this.enableThreshold) {
            shouldEnable = true;
            reason = `High win rate: ${(winRate * 100).toFixed(1)}% (CI: ${(ci.lower * 100).toFixed(1)}%-${(ci.upper * 100).toFixed(1)}%) in ${currentRegime}`;
        }
        // Ambiguous - use point estimate
        else if (winRate < this.disableThreshold) {
            shouldEnable = false;
            reason = `Below threshold: ${(winRate * 100).toFixed(1)}% in ${currentRegime}`;
        }

        // Check if state changed
        const previousState = currentState?.enabled ?? true;
        if (previousState !== shouldEnable) {
            console.log(`[MetaLearner] ${shouldEnable ? 'ENABLING' : 'DISABLING'} ${strategyName}: ${reason}`);

            this.strategyStates.set(strategyName, {
                enabled: shouldEnable,
                lastChange: Date.now(),
                reason,
                regime: currentRegime,
                stats: {
                    winRate: winRate,
                    trades: totalTrades,
                    confidenceInterval: ci
                }
            });

            this.saveState();
        }
    }

    /**
     * Calculate Wilson score confidence interval
     * More reliable than normal approximation for small samples
     */
    calculateConfidenceInterval(wins, total, confidence = 0.95) {
        if (total === 0) {
            return { lower: 0, upper: 1 };
        }

        const z = 1.96; // 95% confidence
        const phat = wins / total;

        const denominator = 1 + z * z / total;
        const centre = (phat + z * z / (2 * total)) / denominator;
        const margin = z * Math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total) / denominator;

        return {
            lower: Math.max(0, centre - margin),
            upper: Math.min(1, centre + margin)
        };
    }

    /**
     * Get stats for a strategy in a specific regime
     */
    getStrategyStats(strategyName, regime) {
        const strategyData = this.strategyPerformance.get(strategyName);
        if (!strategyData || !strategyData.has(regime)) {
            return { wins: 0, losses: 0, winRate: 0, totalPnL: 0, avgPnL: 0, trades: [], confidenceInterval: { lower: 0, upper: 1 } };
        }
        return strategyData.get(regime);
    }

    /**
     * Get overall stats across all regimes
     */
    getOverallStats(strategyName) {
        const strategyData = this.strategyPerformance.get(strategyName);
        if (!strategyData) {
            return { wins: 0, losses: 0, winRate: 0, totalPnL: 0, avgPnL: 0 };
        }

        let totalWins = 0;
        let totalLosses = 0;
        let totalPnL = 0;

        for (const [regime, stats] of strategyData.entries()) {
            totalWins += stats.wins;
            totalLosses += stats.losses;
            totalPnL += stats.totalPnL;
        }

        const totalTrades = totalWins + totalLosses;
        return {
            wins: totalWins,
            losses: totalLosses,
            winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
            totalPnL,
            avgPnL: totalTrades > 0 ? totalPnL / totalTrades : 0
        };
    }

    /**
     * Check if a strategy should be used in current regime
     */
    shouldUseStrategy(strategyName, currentRegime) {
        // Check manual override first
        if (this.overrides.has(strategyName)) {
            const override = this.overrides.get(strategyName);
            return {
                shouldUse: override.forced,
                reason: override.reason,
                override: true
            };
        }

        // Check if strategy exists and is tracked
        const state = this.strategyStates.get(strategyName);
        const stats = this.getStrategyStats(strategyName, currentRegime);
        const totalTrades = stats.wins + stats.losses;

        // No data yet - allow by default
        if (totalTrades < this.minSampleSize) {
            return {
                shouldUse: true,
                reason: `Insufficient data (${totalTrades}/${this.minSampleSize} trades)`,
                learning: true
            };
        }

        // Use state if available
        if (state) {
            return {
                shouldUse: state.enabled,
                reason: state.reason,
                winRate: state.stats.winRate,
                trades: state.stats.trades,
                override: false
            };
        }

        // Default: allow
        return {
            shouldUse: true,
            reason: 'No state available - allowing by default',
            learning: true
        };
    }

    /**
     * Get best strategies for current regime
     */
    getBestStrategies(currentRegime, minTrades = 20, topN = 5) {
        const strategies = [];

        for (const [strategyName, regimeData] of this.strategyPerformance.entries()) {
            const stats = regimeData.get(currentRegime);
            if (!stats) continue;

            const totalTrades = stats.wins + stats.losses;
            if (totalTrades < minTrades) continue;

            strategies.push({
                name: strategyName,
                winRate: stats.winRate,
                trades: totalTrades,
                avgPnL: stats.avgPnL,
                totalPnL: stats.totalPnL,
                confidenceInterval: stats.confidenceInterval
            });
        }

        // Sort by win rate
        strategies.sort((a, b) => b.winRate - a.winRate);

        return strategies.slice(0, topN);
    }

    /**
     * Get worst strategies for current regime
     */
    getWorstStrategies(currentRegime, minTrades = 20, topN = 5) {
        const strategies = [];

        for (const [strategyName, regimeData] of this.strategyPerformance.entries()) {
            const stats = regimeData.get(currentRegime);
            if (!stats) continue;

            const totalTrades = stats.wins + stats.losses;
            if (totalTrades < minTrades) continue;

            strategies.push({
                name: strategyName,
                winRate: stats.winRate,
                trades: totalTrades,
                avgPnL: stats.avgPnL,
                totalPnL: stats.totalPnL,
                confidenceInterval: stats.confidenceInterval
            });
        }

        // Sort by win rate (ascending)
        strategies.sort((a, b) => a.winRate - b.winRate);

        return strategies.slice(0, topN);
    }

    /**
     * Force enable/disable a strategy (manual override)
     */
    forceStrategyState(strategyName, enabled, reason) {
        console.log(`[MetaLearner] Manual override: ${enabled ? 'FORCING ENABLE' : 'FORCING DISABLE'} ${strategyName}`);

        this.overrides.set(strategyName, {
            forced: enabled,
            reason: reason || 'Manual override',
            timestamp: Date.now()
        });

        this.saveState();
    }

    /**
     * Clear manual override
     */
    clearOverride(strategyName) {
        if (this.overrides.has(strategyName)) {
            console.log(`[MetaLearner] Clearing manual override for ${strategyName}`);
            this.overrides.delete(strategyName);
            this.saveState();
        }
    }

    /**
     * Get dashboard summary
     */
    getSummary(currentRegime) {
        const allStrategies = Array.from(this.strategyPerformance.keys());

        const enabled = [];
        const disabled = [];
        const learning = [];

        for (const strategy of allStrategies) {
            const decision = this.shouldUseStrategy(strategy, currentRegime);
            const stats = this.getStrategyStats(strategy, currentRegime);
            const totalTrades = stats.wins + stats.losses;

            const info = {
                name: strategy,
                enabled: decision.shouldUse,
                reason: decision.reason,
                winRate: stats.winRate,
                trades: totalTrades
            };

            if (decision.learning) {
                learning.push(info);
            } else if (decision.shouldUse) {
                enabled.push(info);
            } else {
                disabled.push(info);
            }
        }

        return {
            regime: currentRegime,
            enabled: enabled.length,
            disabled: disabled.length,
            learning: learning.length,
            strategies: {
                enabled,
                disabled,
                learning
            },
            best: this.getBestStrategies(currentRegime, this.minSampleSize, 3),
            worst: this.getWorstStrategies(currentRegime, this.minSampleSize, 3)
        };
    }

    /**
     * Save state to disk
     */
    async saveState() {
        try {
            const state = {
                timestamp: Date.now(),
                strategyPerformance: Array.from(this.strategyPerformance.entries()).map(([strategy, regimes]) => ({
                    strategy,
                    regimes: Array.from(regimes.entries()).map(([regime, stats]) => ({
                        regime,
                        stats
                    }))
                })),
                strategyStates: Array.from(this.strategyStates.entries()),
                overrides: Array.from(this.overrides.entries())
            };

            const filePath = path.join(this.dataPath, 'meta_learning_state.json');
            await fs.writeFile(filePath, JSON.stringify(state, null, 2));
        } catch (error) {
            console.error('[MetaLearner] Failed to save state:', error.message);
        }
    }

    /**
     * Load state from disk
     */
    async loadState() {
        try {
            const filePath = path.join(this.dataPath, 'meta_learning_state.json');
            const content = await fs.readFile(filePath, 'utf-8');
            const state = JSON.parse(content);

            // Restore strategy performance
            this.strategyPerformance.clear();
            for (const { strategy, regimes } of state.strategyPerformance) {
                const regimeMap = new Map();
                for (const { regime, stats } of regimes) {
                    regimeMap.set(regime, stats);
                }
                this.strategyPerformance.set(strategy, regimeMap);
            }

            // Restore strategy states
            this.strategyStates = new Map(state.strategyStates);

            // Restore overrides
            this.overrides = new Map(state.overrides);

            console.log('[MetaLearner] Loaded state from disk');
        } catch (error) {
            // No state file yet
            console.log('[MetaLearner] No previous state found, starting fresh');
        }
    }

    /**
     * Generate performance report
     */
    generateReport(currentRegime) {
        const summary = this.getSummary(currentRegime);

        let report = `
╔════════════════════════════════════════════════════════════════╗
║               META-LEARNING PERFORMANCE REPORT                 ║
╚════════════════════════════════════════════════════════════════╝

Current Regime: ${currentRegime}

Strategy Status:
  ✅ Enabled:  ${summary.enabled}
  ❌ Disabled: ${summary.disabled}
  📚 Learning: ${summary.learning}

`;

        if (summary.strategies.disabled.length > 0) {
            report += `\n❌ DISABLED STRATEGIES (Poor Performance):\n`;
            report += `${'─'.repeat(60)}\n`;
            summary.strategies.disabled.forEach(s => {
                report += `  ${s.name}\n`;
                report += `    Win Rate: ${(s.winRate * 100).toFixed(1)}% (${s.trades} trades)\n`;
                report += `    Reason: ${s.reason}\n\n`;
            });
        }

        if (summary.strategies.enabled.length > 0) {
            report += `\n✅ ENABLED STRATEGIES:\n`;
            report += `${'─'.repeat(60)}\n`;
            summary.strategies.enabled.forEach(s => {
                report += `  ${s.name}\n`;
                report += `    Win Rate: ${(s.winRate * 100).toFixed(1)}% (${s.trades} trades)\n`;
                report += `    Reason: ${s.reason}\n\n`;
            });
        }

        if (summary.best.length > 0) {
            report += `\n🏆 TOP PERFORMERS (${currentRegime}):\n`;
            report += `${'─'.repeat(60)}\n`;
            summary.best.forEach((s, i) => {
                report += `  ${i + 1}. ${s.name}\n`;
                report += `     Win Rate: ${(s.winRate * 100).toFixed(1)}% | Trades: ${s.trades} | Avg P&L: ${s.avgPnL > 0 ? '+' : ''}${s.avgPnL.toFixed(2)}%\n`;
                report += `     CI: ${(s.confidenceInterval.lower * 100).toFixed(1)}% - ${(s.confidenceInterval.upper * 100).toFixed(1)}%\n\n`;
            });
        }

        if (summary.worst.length > 0) {
            report += `\n⚠️  WORST PERFORMERS (${currentRegime}):\n`;
            report += `${'─'.repeat(60)}\n`;
            summary.worst.forEach((s, i) => {
                report += `  ${i + 1}. ${s.name}\n`;
                report += `     Win Rate: ${(s.winRate * 100).toFixed(1)}% | Trades: ${s.trades} | Avg P&L: ${s.avgPnL > 0 ? '+' : ''}${s.avgPnL.toFixed(2)}%\n`;
                report += `     CI: ${(s.confidenceInterval.lower * 100).toFixed(1)}% - ${(s.confidenceInterval.upper * 100).toFixed(1)}%\n\n`;
            });
        }

        report += `${'═'.repeat(64)}\n`;

        return report;
    }
}
