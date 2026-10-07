/**
 * Adaptive Position Sizer - Dynamic position sizing based on confidence + performance
 *
 * Concept: Don't bet the same amount on every trade. Size positions based on:
 * - Confidence level (higher confidence = larger position)
 * - Historical win rate (proven strategies get more capital)
 * - Current drawdown (reduce size during losing streaks)
 * - Market volatility (smaller positions in choppy markets)
 *
 * This is how professional traders manage risk.
 */

export class AdaptivePositionSizer {
    constructor({ basePositionSize = 1000, maxPositionSize = 5000, minPositionSize = 50 }) {
        this.basePositionSize = basePositionSize;  // Default position size ($)
        this.maxPositionSize = maxPositionSize;    // Max position size ($)
        this.minPositionSize = minPositionSize;    // Min position size ($)

        // Track current state
        this.currentDrawdown = 0; // % from peak
        this.consecutiveLosses = 0;
        this.consecutiveWins = 0;
        this.recentTrades = []; // Last 20 trades
    }

    /**
     * Calculate optimal position size for a trade
     *
     * @param {Object} tradeContext
     * @param {number} tradeContext.confidence - 0-1 confidence from agents
     * @param {number} tradeContext.historicalWinRate - 0-1 win rate for this strategy
     * @param {number} tradeContext.volatility - Market volatility (0-1)
     * @param {number} tradeContext.riskScore - Risk score (0-100)
     * @param {number} accountBalance - Current account balance
     */
    calculatePositionSize(tradeContext, accountBalance) {
        const {
            confidence = 0.5,
            historicalWinRate = 0.5,
            volatility = 0.5,
            riskScore = 50
        } = tradeContext;

        console.log('[PositionSizer] Calculating position size...');
        console.log(`  Confidence: ${(confidence * 100).toFixed(1)}%`);
        console.log(`  Historical Win Rate: ${(historicalWinRate * 100).toFixed(1)}%`);
        console.log(`  Volatility: ${(volatility * 100).toFixed(1)}%`);
        console.log(`  Risk Score: ${riskScore}`);

        // Start with base size
        let positionSize = this.basePositionSize;

        // 1. Confidence multiplier (0.5x to 2x)
        // High confidence = bigger position
        const confidenceMultiplier = 0.5 + (confidence * 1.5);
        positionSize *= confidenceMultiplier;

        console.log(`  After confidence (${confidenceMultiplier.toFixed(2)}x): $${positionSize.toFixed(2)}`);

        // 2. Historical performance multiplier (0.5x to 1.5x)
        // Proven strategies get more capital
        const performanceMultiplier = 0.5 + historicalWinRate;
        positionSize *= performanceMultiplier;

        console.log(`  After performance (${performanceMultiplier.toFixed(2)}x): $${positionSize.toFixed(2)}`);

        // 3. Volatility adjustment (reduce size in volatile markets)
        // High volatility = smaller position (0.5x to 1x)
        const volatilityMultiplier = Math.max(0.5, 1 - (volatility * 0.5));
        positionSize *= volatilityMultiplier;

        console.log(`  After volatility (${volatilityMultiplier.toFixed(2)}x): $${positionSize.toFixed(2)}`);

        // 4. Risk score adjustment
        // High risk = smaller position
        const riskMultiplier = Math.max(0.3, 1 - (riskScore / 150));
        positionSize *= riskMultiplier;

        console.log(`  After risk (${riskMultiplier.toFixed(2)}x): $${positionSize.toFixed(2)}`);

        // 5. Drawdown protection (cut size during losing streaks)
        if (this.currentDrawdown > 10) {
            const drawdownMultiplier = Math.max(0.25, 1 - (this.currentDrawdown / 100));
            positionSize *= drawdownMultiplier;
            console.log(`  ⚠️ Drawdown protection (${drawdownMultiplier.toFixed(2)}x): $${positionSize.toFixed(2)}`);
        }

        // 6. Consecutive losses protection
        if (this.consecutiveLosses >= 3) {
            const lossMultiplier = Math.max(0.5, 1 - (this.consecutiveLosses * 0.1));
            positionSize *= lossMultiplier;
            console.log(`  ⚠️ Loss streak protection (${lossMultiplier.toFixed(2)}x): $${positionSize.toFixed(2)}`);
        }

        // 7. Consecutive wins boost (hot hand)
        if (this.consecutiveWins >= 3) {
            const winBoost = Math.min(1.3, 1 + (this.consecutiveWins * 0.05));
            positionSize *= winBoost;
            console.log(`  ✅ Win streak boost (${winBoost.toFixed(2)}x): $${positionSize.toFixed(2)}`);
        }

        // 8. Account size check (never risk more than 5% of account)
        const maxRisk = accountBalance * 0.05;
        if (positionSize > maxRisk) {
            positionSize = maxRisk;
            console.log(`  ⚠️ Account risk limit: $${positionSize.toFixed(2)}`);
        }

        // Apply min/max bounds
        // If the calculated size before max-bounding is under the minimum, SOMA requested we reject the trade 
        // entirely rather than bump it up to 50, to avoid executing low-signal micro-trades.
        if (positionSize < this.minPositionSize) {
            console.log(`[PositionSizer] ❌ Trade REJECTED: Position size $${positionSize.toFixed(2)} is below the $${this.minPositionSize} capital floor.`);
            return {
                positionSize: 0,
                rejected: true,
                reason: `Below capital floor: calculated $${positionSize.toFixed(2)} < $${this.minPositionSize}`
            };
        }

        positionSize = Math.max(this.minPositionSize, Math.min(this.maxPositionSize, positionSize));

        console.log(`[PositionSizer] ✅ Final position size: $${positionSize.toFixed(2)}`);

        return {
            positionSize: Math.round(positionSize),
            multipliers: {
                confidence: confidenceMultiplier.toFixed(2),
                performance: performanceMultiplier.toFixed(2),
                volatility: volatilityMultiplier.toFixed(2),
                risk: riskMultiplier.toFixed(2)
            },
            reasoning: this.generateReasoning(tradeContext, positionSize, accountBalance)
        };
    }

    /**
     * Generate human-readable explanation
     */
    generateReasoning(context, finalSize, accountBalance) {
        const riskPercent = ((finalSize / accountBalance) * 100).toFixed(2);

        let reasoning = `Position Size: $${finalSize.toFixed(2)} (${riskPercent}% of account)\n\n`;

        reasoning += 'Rationale:\n';

        if (context.confidence > 0.7) {
            reasoning += `✅ High confidence (${(context.confidence * 100).toFixed(0)}%) increased size\n`;
        } else if (context.confidence < 0.4) {
            reasoning += `⚠️ Low confidence (${(context.confidence * 100).toFixed(0)}%) reduced size\n`;
        }

        if (context.historicalWinRate > 0.6) {
            reasoning += `✅ Strong historical performance (${(context.historicalWinRate * 100).toFixed(0)}% win rate)\n`;
        } else if (context.historicalWinRate < 0.4) {
            reasoning += `⚠️ Weak historical performance (${(context.historicalWinRate * 100).toFixed(0)}% win rate) reduced size\n`;
        }

        if (context.volatility > 0.6) {
            reasoning += `⚠️ High volatility reduced position size\n`;
        }

        if (this.consecutiveLosses >= 3) {
            reasoning += `⚠️ ${this.consecutiveLosses} consecutive losses - defensive sizing active\n`;
        }

        if (this.consecutiveWins >= 3) {
            reasoning += `✅ ${this.consecutiveWins} consecutive wins - increased size (hot hand)\n`;
        }

        return reasoning;
    }

    /**
     * Update state after a trade closes
     */
    updateFromTrade(trade) {
        const isWin = trade.pnl > 0;

        // Update streaks
        if (isWin) {
            this.consecutiveWins++;
            this.consecutiveLosses = 0;
        } else {
            this.consecutiveLosses++;
            this.consecutiveWins = 0;
        }

        // Track recent trades
        this.recentTrades.push({
            pnl: trade.pnl,
            pnlPercent: trade.pnlPercent,
            timestamp: Date.now()
        });

        // Keep only last 20 trades
        if (this.recentTrades.length > 20) {
            this.recentTrades.shift();
        }

        // Calculate drawdown
        this.updateDrawdown();

        console.log(`[PositionSizer] Updated: ${isWin ? 'WIN' : 'LOSS'} | Streak: ${this.consecutiveWins}W ${this.consecutiveLosses}L | Drawdown: ${this.currentDrawdown.toFixed(2)}%`);
    }

    /**
     * Calculate current drawdown
     */
    updateDrawdown() {
        if (this.recentTrades.length < 2) {
            this.currentDrawdown = 0;
            return;
        }

        // Find peak equity
        let runningEquity = 0;
        let peak = 0;

        for (const trade of this.recentTrades) {
            runningEquity += trade.pnl;
            peak = Math.max(peak, runningEquity);
        }

        // Calculate drawdown from peak
        if (peak > 0) {
            this.currentDrawdown = ((peak - runningEquity) / peak) * 100;
        } else {
            this.currentDrawdown = 0;
        }
    }

    /**
     * Get current state for dashboard
     */
    getStats() {
        return {
            consecutiveWins: this.consecutiveWins,
            consecutiveLosses: this.consecutiveLosses,
            currentDrawdown: this.currentDrawdown.toFixed(2),
            recentTradeCount: this.recentTrades.length,
            basePositionSize: this.basePositionSize,
            currentMultiplier: this.getCurrentMultiplier()
        };
    }

    /**
     * Calculate current effective multiplier
     */
    getCurrentMultiplier() {
        let multiplier = 1.0;

        // Drawdown protection
        if (this.currentDrawdown > 10) {
            multiplier *= Math.max(0.25, 1 - (this.currentDrawdown / 100));
        }

        // Loss streak
        if (this.consecutiveLosses >= 3) {
            multiplier *= Math.max(0.5, 1 - (this.consecutiveLosses * 0.1));
        }

        // Win streak
        if (this.consecutiveWins >= 3) {
            multiplier *= Math.min(1.3, 1 + (this.consecutiveWins * 0.05));
        }

        return multiplier.toFixed(2);
    }

    /**
     * Reset state (use after major changes)
     */
    reset() {
        this.currentDrawdown = 0;
        this.consecutiveLosses = 0;
        this.consecutiveWins = 0;
        this.recentTrades = [];
        console.log('[PositionSizer] State reset');
    }
}
