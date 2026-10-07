/**
 * Trade Learning Engine - SOMA learns from every trade outcome
 *
 * Concept: After each trade closes, analyze what went right/wrong
 * and update agent strategies to improve future performance.
 */

import fs from 'fs/promises';
import path from 'path';

export class TradeLearningEngine {
    constructor({ quadBrain, mnemonic, rootPath }) {
        this.quadBrain = quadBrain;
        this.mnemonic = mnemonic;
        this.rootPath = rootPath;
        this.learningPath = path.join(rootPath, 'data', 'trade_learning');

        // Track performance by strategy type
        this.strategyPerformance = new Map();

        // Track what market conditions lead to wins/losses
        this.marketConditionPatterns = [];
    }

    async initialize() {
        await fs.mkdir(this.learningPath, { recursive: true });
        await this.loadHistoricalLearning();
        console.log('[TradeLearning] ✅ Learning engine initialized');
    }

    /**
     * Record a trade and its full context for learning
     */
    async recordTrade(trade) {
        const tradeRecord = {
            id: trade.id,
            timestamp: Date.now(),
            symbol: trade.symbol,
            side: trade.side,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice || null,
            entryTime: trade.entryTime || trade.entryTimestamp || trade.openedAt || trade.createdAt || null,
            exitTime: trade.exitTime || trade.exitTimestamp || trade.closedAt || null,
            quantity: trade.quantity,
            pnl: trade.pnl || 0,
            pnlPercent: trade.exitPrice ?
                ((trade.side === 'short' ? trade.entryPrice - trade.exitPrice : trade.exitPrice - trade.entryPrice) / trade.entryPrice * 100) : 0,

            // Context at time of trade
            context: {
                thesis: trade.thesis,
                sentiment: trade.sentiment,
                technicals: trade.technicals,
                riskScore: trade.riskScore,
                confidence: trade.confidence,
                timeframe: trade.timeframe,
                marketCondition: trade.marketCondition,
                volatility: trade.volatility
            },

            // Agent reasoning
            agentReasons: trade.agentReasons || {},
            debate: trade.debate || null
        };

        // Save to disk
        const tradePath = path.join(this.learningPath, `trade_${trade.id}.json`);
        await fs.writeFile(tradePath, JSON.stringify(tradeRecord, null, 2));

        // If trade is closed, analyze and learn
        if (trade.exitPrice) {
            await this.learnFromClosedTrade(tradeRecord);
        }

        return tradeRecord;
    }

    /**
     * Analyze a closed trade and extract learnings
     */
    async learnFromClosedTrade(trade) {
        const isWin = trade.pnl > 0;
        const isSignificant = Math.abs(trade.pnlPercent) > 2; // >2% move

        console.log(`[TradeLearning] Analyzing ${isWin ? 'WIN' : 'LOSS'}: ${trade.symbol} (${trade.pnlPercent.toFixed(2)}%)`);

        // Use QuadBrain to analyze what happened
        if (this.quadBrain) {
            const analysis = await this.quadBrain.reason(`
                You are SOMA's Trade Learning System. Analyze this completed trade:

                TRADE SUMMARY:
                - Symbol: ${trade.symbol}
                - Entry: $${trade.entryPrice} → Exit: $${trade.exitPrice}
                - P&L: ${trade.pnl > 0 ? '+' : ''}$${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(2)}%)
                - Duration: ${this.calculateDuration(trade)}

                INITIAL ANALYSIS:
                - Thesis: ${trade.context.thesis}
                - Sentiment: ${trade.context.sentiment}
                - Risk Score: ${trade.context.riskScore}
                - Confidence: ${trade.context.confidence}

                DEBATE OUTCOME:
                ${trade.debate ? JSON.stringify(trade.debate, null, 2) : 'No debate recorded'}

                TASK: Analyze what went ${isWin ? 'right' : 'wrong'}.

                Focus on:
                1. Was the thesis accurate? What signals were missed?
                2. Did sentiment analysis match reality?
                3. Was risk assessment appropriate?
                4. What market conditions invalidated/validated the thesis?
                5. What should SOMA do differently next time?

                Provide SPECIFIC, ACTIONABLE lessons (not generic advice).
            `, 'analytical', {
                source: 'trade_learning',
                context: trade
            });

            // Extract lessons and store
            const lesson = {
                tradeId: trade.id,
                timestamp: Date.now(),
                symbol: trade.symbol,
                outcome: isWin ? 'WIN' : 'LOSS',
                pnlPercent: trade.pnlPercent,
                analysis: analysis.text || analysis.response,
                context: trade.context,
                patterns: this.extractPatterns(trade, analysis)
            };

            // Save to mnemonic (long-term memory)
            if (this.mnemonic) {
                await this.mnemonic.remember(
                    `Trade Lesson: ${trade.symbol} ${isWin ? 'WIN' : 'LOSS'} (${trade.pnlPercent.toFixed(2)}%)\n\n${lesson.analysis}`,
                    {
                        type: 'trade_lesson',
                        category: 'finance',
                        outcome: isWin ? 'win' : 'loss',
                        symbol: trade.symbol,
                        metadata: lesson
                    }
                );
            }

            // Update strategy performance tracker
            this.updateStrategyPerformance(trade, lesson);

            // Save lesson
            const lessonPath = path.join(this.learningPath, `lesson_${trade.id}.json`);
            await fs.writeFile(lessonPath, JSON.stringify(lesson, null, 2));

            console.log(`[TradeLearning] ✅ Lesson extracted and stored in memory`);

            return lesson;
        }
    }

    /**
     * Extract patterns from trade outcome
     */
    extractPatterns(trade, analysis) {
        const patterns = [];

        // Pattern: High confidence + loss = overconfidence
        if (trade.context.confidence > 0.8 && trade.pnl < 0) {
            patterns.push({
                type: 'overconfidence',
                lesson: 'High confidence does not guarantee success',
                adjustment: 'Reduce position size on high-confidence trades until validated'
            });
        }

        // Pattern: Low risk score but won = missed opportunity
        if (trade.context.riskScore < 30 && trade.pnl > 0 && Math.abs(trade.pnlPercent) > 5) {
            patterns.push({
                type: 'missed_opportunity',
                lesson: 'Low risk + high return suggests conservative sizing',
                adjustment: 'Increase position size on low-risk, high-conviction trades'
            });
        }

        // Pattern: Sentiment mismatch
        const sentimentScore = trade.context.sentiment?.score || 0.5;
        const actualOutcome = trade.pnl > 0 ? 1 : 0;
        const sentimentAccuracy = Math.abs(sentimentScore - actualOutcome);

        if (sentimentAccuracy > 0.5) {
            patterns.push({
                type: 'sentiment_mismatch',
                lesson: `Sentiment analysis was ${sentimentScore > 0.5 ? 'bullish' : 'bearish'} but trade went ${trade.pnl > 0 ? 'up' : 'down'}`,
                adjustment: 'Re-evaluate sentiment analysis methodology'
            });
        }

        return patterns;
    }

    /**
     * Update strategy performance metrics
     */
    updateStrategyPerformance(trade, lesson) {
        const strategyKey = trade.context.thesis || 'unknown';

        if (!this.strategyPerformance.has(strategyKey)) {
            this.strategyPerformance.set(strategyKey, {
                wins: 0,
                losses: 0,
                totalPnL: 0,
                avgWin: 0,
                avgLoss: 0,
                winRate: 0,
                trades: []
            });
        }

        const perf = this.strategyPerformance.get(strategyKey);

        if (trade.pnl > 0) {
            perf.wins++;
            perf.avgWin = (perf.avgWin * (perf.wins - 1) + trade.pnlPercent) / perf.wins;
        } else {
            perf.losses++;
            perf.avgLoss = (perf.avgLoss * (perf.losses - 1) + Math.abs(trade.pnlPercent)) / perf.losses;
        }

        perf.totalPnL += trade.pnl;
        perf.winRate = perf.wins / (perf.wins + perf.losses);
        perf.trades.push({ id: trade.id, pnl: trade.pnl, timestamp: Date.now() });

        this.strategyPerformance.set(strategyKey, perf);
    }

    /**
     * Get strategy insights for future trades
     */
    async getStrategyInsights(symbol, proposedThesis) {
        // Find similar past trades
        const similarTrades = await this.findSimilarTrades(symbol, proposedThesis);

        if (similarTrades.length === 0) {
            return {
                confidence: 0.5,
                insights: 'No historical data for this strategy',
                adjustments: []
            };
        }

        // Calculate historical performance
        const wins = similarTrades.filter(t => t.pnl > 0).length;
        const winRate = wins / similarTrades.length;
        const avgPnL = similarTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / similarTrades.length;

        return {
            confidence: winRate,
            insights: `Historical win rate: ${(winRate * 100).toFixed(1)}% (${wins}/${similarTrades.length} trades)`,
            avgReturn: avgPnL,
            sampleSize: similarTrades.length,
            adjustments: this.getRecommendedAdjustments(similarTrades)
        };
    }

    /**
     * Find trades similar to proposed strategy
     */
    async findSimilarTrades(symbol, thesis) {
        const files = await fs.readdir(this.learningPath);
        const tradeFiles = files.filter(f => f.startsWith('trade_') && f.endsWith('.json'));

        const similarTrades = [];

        for (const file of tradeFiles) {
            try {
                const content = await fs.readFile(path.join(this.learningPath, file), 'utf-8');
                const trade = JSON.parse(content);

                // Match by symbol or thesis similarity
                if (trade.symbol === symbol || this.thesisSimilarity(trade.context.thesis, thesis) > 0.7) {
                    if (trade.exitPrice) { // Only completed trades
                        similarTrades.push(trade);
                    }
                }
            } catch (err) {
                // Skip invalid files
            }
        }

        return similarTrades;
    }

    /**
     * Simple thesis similarity (could be enhanced with embeddings)
     */
    thesisSimilarity(thesis1, thesis2) {
        if (!thesis1 || !thesis2) return 0;

        const words1 = new Set(thesis1.toLowerCase().split(/\s+/));
        const words2 = new Set(thesis2.toLowerCase().split(/\s+/));

        const intersection = new Set([...words1].filter(w => words2.has(w)));
        const union = new Set([...words1, ...words2]);

        return intersection.size / union.size; // Jaccard similarity
    }

    /**
     * Get recommended adjustments based on historical patterns
     */
    getRecommendedAdjustments(similarTrades) {
        const adjustments = [];

        // If historical volatility was high, recommend tighter stops
        const avgVolatility = similarTrades.reduce((sum, t) =>
            sum + (t.context.volatility || 0), 0) / similarTrades.length;

        if (avgVolatility > 0.5) {
            adjustments.push({
                type: 'risk_management',
                recommendation: 'Use tighter stop-loss (high historical volatility)',
                suggestedStopLoss: '2%'
            });
        }

        // If win rate is low, reduce position size
        const winRate = similarTrades.filter(t => t.pnl > 0).length / similarTrades.length;
        if (winRate < 0.4) {
            adjustments.push({
                type: 'position_sizing',
                recommendation: 'Reduce position size (low historical win rate)',
                suggestedSize: '50% of normal'
            });
        }

        return adjustments;
    }

    calculateDuration(trade) {
        const parseTime = value => {
            if (value == null) return Number.NaN;
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
            return Date.parse(value);
        };
        const start = parseTime(trade.entryTime || trade.entryTimestamp || trade.openedAt || trade.createdAt);
        const end = parseTime(trade.exitTime || trade.exitTimestamp || trade.closedAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'unknown';
        const totalSeconds = Math.floor((end - start) / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return [days ? `${days}d` : null, hours ? `${hours}h` : null, minutes ? `${minutes}m` : null, (seconds || (!days && !hours && !minutes)) ? `${seconds}s` : null]
            .filter(Boolean).join(' ');
    }

    async loadHistoricalLearning() {
        try {
            const files = await fs.readdir(this.learningPath);
            const tradeFiles = files.filter(f => f.startsWith('trade_') && f.endsWith('.json'));

            console.log(`[TradeLearning] Loading ${tradeFiles.length} historical trades...`);

            for (const file of tradeFiles) {
                try {
                    const content = await fs.readFile(path.join(this.learningPath, file), 'utf-8');
                    const trade = JSON.parse(content);

                    if (trade.exitPrice) {
                        // Rebuild performance stats
                        this.updateStrategyPerformance(trade, null);
                    }
                } catch (err) {
                    // Skip corrupt files
                }
            }

            console.log(`[TradeLearning] Loaded ${this.strategyPerformance.size} strategy patterns`);
        } catch (err) {
            // First run, no historical data yet
        }
    }

    /**
     * Get learning dashboard stats
     */
    getStats() {
        const stats = {
            totalStrategies: this.strategyPerformance.size,
            strategies: []
        };

        for (const [thesis, perf] of this.strategyPerformance.entries()) {
            stats.strategies.push({
                thesis: thesis.substring(0, 100), // Truncate long thesis
                winRate: perf.winRate,
                totalTrades: perf.wins + perf.losses,
                totalPnL: perf.totalPnL,
                avgWin: perf.avgWin,
                avgLoss: perf.avgLoss,
                profitFactor: perf.avgLoss > 0 ? perf.avgWin / perf.avgLoss : 0
            });
        }

        // Sort by win rate
        stats.strategies.sort((a, b) => b.winRate - a.winRate);

        return stats;
    }
}
