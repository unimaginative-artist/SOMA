/**
 * BeeLearningBridge.js
 *
 * Autonomic Learning & Bandit Capital Rebalancing for SOMA BeeBots.
 * Connects live trade outcomes to SOMA's learning loops:
 *  1. Performance Attribution: computes rolling win rate, profit factor, and average R-multiple per bee.
 *  2. UCB1 Multi-Armed Bandit: dynamically shifts capital weights to the most profitable bee.
 *  3. Experience Distillation: streams decision receipts to /distill/record for local GPU fine-tuning.
 */

import fs from 'fs';
import path from 'path';

const DISTILL_ENDPOINT = process.env.SOMA_DISTILL_URL || 'http://127.0.0.1:5055/distill/record';

export class BeeLearningBridge {
    constructor(options = {}) {
        this.distillUrl = options.distillUrl || DISTILL_ENDPOINT;
        this.explorationFactor = options.explorationFactor || 0.5; // UCB1 c factor
        this.minTradesForBandit = options.minTradesForBandit || 5;  // Minimum trades before shifting capital
        this.maxCapitalShare = 0.50; // Max 50% of capital to a single bee
        this.minCapitalShare = 0.15; // Min 15% to maintain exploration
    }

    /**
     * Compute rolling performance stats per bee from closed trades
     */
    computeBeeStats(closedTrades = []) {
        const stats = {
            bizzy: { count: 0, wins: 0, losses: 0, totalPnl: 0, totalR: 0, winRate: 0, avgR: 0, profitFactor: 1.0 },
            boozy: { count: 0, wins: 0, losses: 0, totalPnl: 0, totalR: 0, winRate: 0, avgR: 0, profitFactor: 1.0 },
            breezy: { count: 0, wins: 0, losses: 0, totalPnl: 0, totalR: 0, winRate: 0, avgR: 0, profitFactor: 1.0 }
        };

        const grossWins = { bizzy: 0, boozy: 0, breezy: 0 };
        const grossLosses = { bizzy: 0, boozy: 0, breezy: 0 };

        for (const t of closedTrades) {
            const bee = t.bee;
            if (!stats[bee]) continue;

            stats[bee].count++;
            stats[bee].totalPnl += (t.pnl || 0);
            stats[bee].totalR += (t.rMultiple || 0);

            if ((t.pnl || 0) > 0) {
                stats[bee].wins++;
                grossWins[bee] += t.pnl;
            } else {
                stats[bee].losses++;
                grossLosses[bee] += Math.abs(t.pnl || 0);
            }
        }

        for (const [k, s] of Object.entries(stats)) {
            if (s.count > 0) {
                s.winRate = Number((s.wins / s.count).toFixed(3));
                s.avgR = Number((s.totalR / s.count).toFixed(3));
                s.totalPnl = Number(s.totalPnl.toFixed(2));
                s.totalR = Number(s.totalR.toFixed(2));
                s.profitFactor = grossLosses[k] > 0
                    ? Number((grossWins[k] / grossLosses[k]).toFixed(2))
                    : (grossWins[k] > 0 ? 5.0 : 1.0);
            }
        }

        return stats;
    }

    /**
     * Compute UCB1 Bandit Capital Allocation Weights across the 3 bees
     * Total weights sum to 1.0 (e.g. [0.45, 0.25, 0.30])
     */
    computeCapitalWeights(closedTrades = []) {
        const stats = this.computeBeeStats(closedTrades);
        const bees = ['bizzy', 'boozy', 'breezy'];
        const totalTrades = closedTrades.length;

        // If not enough trades across all bees, allocate equally (1/3 each)
        if (totalTrades < this.minTradesForBandit) {
            return {
                weights: { bizzy: 0.3333, boozy: 0.3333, breezy: 0.3334 },
                stats,
                isBanditActive: false
            };
        }

        const scores = {};
        const lnTotal = Math.log(Math.max(1, totalTrades));

        for (const b of bees) {
            const count = stats[b].count;
            if (count === 0) {
                // High exploration incentive for unvisited arm
                scores[b] = 1.0 + this.explorationFactor;
            } else {
                // Bound average R between -1.0 and +1.0 for stability
                const boundedAvgR = Math.max(-1.0, Math.min(1.0, stats[b].avgR));
                // Normalized exploitation value in range [0, 1]
                const exploit = (boundedAvgR + 1.0) / 2.0;
                // UCB exploration bonus
                const explore = this.explorationFactor * Math.sqrt(lnTotal / count);
                scores[b] = exploit + explore;
            }
        }

        // Softmax / normalized sum
        const sumScores = Object.values(scores).reduce((a, b) => a + b, 0);
        let rawWeights = {};
        for (const b of bees) {
            rawWeights[b] = scores[b] / (sumScores || 1);
        }

        // Clip weights to bounds [minCapitalShare, maxCapitalShare]
        let finalWeights = {};
        let excess = 0;
        for (const b of bees) {
            if (rawWeights[b] > this.maxCapitalShare) {
                excess += (rawWeights[b] - this.maxCapitalShare);
                finalWeights[b] = this.maxCapitalShare;
            } else if (rawWeights[b] < this.minCapitalShare) {
                finalWeights[b] = this.minCapitalShare;
            } else {
                finalWeights[b] = rawWeights[b];
            }
        }

        // Normalize so sum is exactly 1.0
        const totalW = Object.values(finalWeights).reduce((a, b) => a + b, 0);
        for (const b of bees) {
            finalWeights[b] = Number((finalWeights[b] / totalW).toFixed(4));
        }

        return {
            weights: finalWeights,
            stats,
            isBanditActive: true
        };
    }

    /**
     * Dispatch trade execution receipt to /distill/record for local ModernBERT RLCD training
     */
    async distillTradeReceipt(trade) {
        if (!trade) return false;

        const payload = {
            source: 'SOMA_BEEBOTS',
            bee: trade.bee,
            symbol: trade.symbol,
            side: trade.side,
            entry_price: trade.entryPrice,
            exit_price: trade.exitPrice,
            r_multiple: trade.rMultiple,
            pnl_dollars: trade.pnl,
            exit_reason: trade.exitReason,
            conviction: trade.conviction,
            confidence: trade.confidence,
            reward: trade.rMultiple > 0 ? trade.rMultiple : (trade.rMultiple * 1.2), // Asymmetric loss penalty
            timestamp: trade.exitTime || new Date().toISOString()
        };

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(this.distillUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timer);
            return res.ok;
        } catch (_) {
            // Non-fatal if substrate daemon is offline
            return false;
        }
    }
}
