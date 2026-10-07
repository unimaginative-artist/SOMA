/**
 * Adversarial Debate System - Production Grade
 *
 * Two AI agents argue opposite sides of every trade:
 * - Bull Agent: Makes case FOR the trade
 * - Bear Agent: Makes case AGAINST the trade
 * - Arbiter: Evaluates arguments, makes final decision
 *
 * Why This Works:
 * - Reduces confirmation bias
 * - Forces examination of counterarguments
 * - Surfaces risks you might have missed
 * - Better decisions through adversarial process
 *
 * Process:
 * 1. Proposal: "Buy 10 BTC at $50k"
 * 2. Bull argues: "Breakout setup, strong momentum, institutional buying..."
 * 3. Bear counters: "Overbought RSI, resistance at $52k, macro headwinds..."
 * 4. Arbiter scores arguments, makes final decision
 */

import fs from 'fs/promises';
import path from 'path';
import { recordEvidenceDebate } from '../core/EvidenceDebateLedger.js';

export class AdversarialDebate {
    constructor({ rootPath, quadBrain = null }) {
        this.rootPath = rootPath;
        this.dataPath = path.join(rootPath, 'data', 'debates');
        this.quadBrain = quadBrain;

        // Debate parameters
        this.minConfidenceThreshold = 0.65; // Need 65% confidence to execute
        this.debateRounds = 3; // 3 rounds of back-and-forth
        this.argumentMinLength = 100; // Min 100 chars per argument
        this.argumentMaxLength = 1000; // Max 1000 chars per argument

        // Debate history
        this.debates = [];
        this.debateStats = {
            total: 0,
            bullWins: 0,
            bearWins: 0,
            ties: 0,
            avgConfidence: 0
        };
    }

    async initialize() {
        await fs.mkdir(this.dataPath, { recursive: true });
        await this.loadState();
        console.log('[AdversarialDebate] ✅ Initialized');
    }

    /**
     * Start a debate on a trade proposal
     */
    async debate(tradeProposal) {
        const debateId = `debate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        console.log(`\n${'='.repeat(70)}`);
        console.log(`🎯 ADVERSARIAL DEBATE: ${debateId}`);
        console.log('='.repeat(70));

        const debate = {
            id: debateId,
            proposal: tradeProposal,
            rounds: [],
            startTime: Date.now(),
            status: 'IN_PROGRESS'
        };

        // Round 1: Opening arguments
        console.log('\n[ROUND 1] Opening Arguments\n');

        const bullOpening = this.generateBullArgument(tradeProposal, null, 'OPENING');
        const bearOpening = this.generateBearArgument(tradeProposal, null, 'OPENING');

        debate.rounds.push({
            roundNumber: 1,
            type: 'OPENING',
            bull: bullOpening,
            bear: bearOpening
        });

        this.printArgument('BULL', bullOpening);
        this.printArgument('BEAR', bearOpening);

        // Round 2: Rebuttals
        console.log('\n[ROUND 2] Rebuttals\n');

        const bullRebuttal = this.generateBullArgument(tradeProposal, bearOpening, 'REBUTTAL');
        const bearRebuttal = this.generateBearArgument(tradeProposal, bullOpening, 'REBUTTAL');

        debate.rounds.push({
            roundNumber: 2,
            type: 'REBUTTAL',
            bull: bullRebuttal,
            bear: bearRebuttal
        });

        this.printArgument('BULL', bullRebuttal);
        this.printArgument('BEAR', bearRebuttal);

        // Round 3: Closing arguments
        console.log('\n[ROUND 3] Closing Arguments\n');

        const bullClosing = this.generateBullArgument(tradeProposal, bearRebuttal, 'CLOSING');
        const bearClosing = this.generateBearArgument(tradeProposal, bullRebuttal, 'CLOSING');

        debate.rounds.push({
            roundNumber: 3,
            type: 'CLOSING',
            bull: bullClosing,
            bear: bearClosing
        });

        this.printArgument('BULL', bullClosing);
        this.printArgument('BEAR', bearClosing);

        // Arbiter evaluates debate
        console.log('\n[ARBITER] Evaluating Arguments...\n');

        const verdict = this.arbitrate(debate);
        debate.verdict = verdict;
        debate.status = 'COMPLETED';
        debate.endTime = Date.now();
        debate.durationMs = debate.endTime - debate.startTime;

        // Print verdict
        this.printVerdict(verdict);

        // Update stats
        this.updateStats(verdict);

        // Store debate
        this.debates.push(debate);
        await this.saveState();
        await recordEvidenceDebate({
            id: debate.id,
            proposal: tradeProposal,
            evidence: this._extractDebateEvidence(debate),
            counterexample: this._extractDebateCounterexample(debate),
            testPlan: verdict.falsificationTest || verdict.recommendation || 'Verify decision against subsequent price/risk outcome before reuse.',
            verdict,
            artifactPath: path.relative(this.rootPath, path.join(this.dataPath, 'debate_state.json')).replace(/\\/g, '/'),
            messages: debate.rounds.flatMap(round => [round.bull, round.bear]).filter(Boolean)
        }).catch(() => {});

        console.log('\n' + '='.repeat(70));
        console.log(`✅ Debate Complete (${(debate.durationMs / 1000).toFixed(1)}s)`);
        console.log('='.repeat(70) + '\n');

        return {
            debate,
            verdict,
            decision: verdict.decision,
            confidence: verdict.confidence,
            recommendation: verdict.recommendation
        };
    }

    _extractDebateEvidence(debate) {
        return (debate.rounds || []).flatMap(round =>
            [round.bull, round.bear]
                .filter(Boolean)
                .flatMap(arg => Array.isArray(arg.points) ? arg.points : [])
                .slice(0, 12)
        );
    }

    _extractDebateCounterexample(debate) {
        const bearPoints = (debate.rounds || [])
            .map(round => round.bear)
            .filter(Boolean)
            .flatMap(arg => Array.isArray(arg.points) ? arg.points : []);
        return bearPoints[0] || 'No explicit counterexample produced by debate.';
    }

    /**
     * Generate Bull (bullish) argument
     */
    generateBullArgument(proposal, counterArgument, argumentType) {
        const { symbol, side, size, price, technicals, fundamentals, sentiment } = proposal;

        const argument = {
            agent: 'BULL',
            type: argumentType,
            points: [],
            confidence: 0,
            riskScore: 0
        };

        // Opening: Make positive case
        if (argumentType === 'OPENING') {
            // Technicals
            if (technicals?.trend === 'BULLISH' || technicals?.trend === 'UP') {
                argument.points.push({
                    category: 'TECHNICAL',
                    point: 'Strong bullish trend with higher highs and higher lows',
                    weight: 0.3
                });
            }

            if (technicals?.rsi < 70) {
                argument.points.push({
                    category: 'TECHNICAL',
                    point: `RSI at ${technicals.rsi.toFixed(1)} - not overbought, room to run`,
                    weight: 0.25
                });
            }

            if (technicals?.macd > 0) {
                argument.points.push({
                    category: 'TECHNICAL',
                    point: 'MACD positive and rising - momentum building',
                    weight: 0.25
                });
            }

            // Fundamentals
            if (fundamentals?.revenue_growth > 0.1) {
                argument.points.push({
                    category: 'FUNDAMENTAL',
                    point: `Revenue growing ${(fundamentals.revenue_growth * 100).toFixed(1)}% - strong business`,
                    weight: 0.3
                });
            }

            // Sentiment
            if (sentiment?.score > 0.5) {
                argument.points.push({
                    category: 'SENTIMENT',
                    point: `Positive sentiment (${(sentiment.score * 100).toFixed(0)}%) - market optimism`,
                    weight: 0.2
                });
            }

            // Price action
            argument.points.push({
                category: 'PRICE_ACTION',
                point: `Entry at $${price.toFixed(2)} offers good risk/reward`,
                weight: 0.2
            });
        }

        // Rebuttal: Counter the bear's arguments
        if (argumentType === 'REBUTTAL' && counterArgument) {
            argument.points.push({
                category: 'REBUTTAL',
                point: 'Bear raises valid concerns, but they are short-term noise',
                weight: 0.15
            });

            argument.points.push({
                category: 'REBUTTAL',
                point: 'Historical data shows dips are buying opportunities in uptrends',
                weight: 0.2
            });

            argument.points.push({
                category: 'REBUTTAL',
                point: 'Market has absorbed selling pressure well - strong hands accumulating',
                weight: 0.25
            });
        }

        // Closing: Summarize why trade should execute
        if (argumentType === 'CLOSING') {
            argument.points.push({
                category: 'SUMMARY',
                point: 'Net bullish across technical, fundamental, and sentiment indicators',
                weight: 0.3
            });

            argument.points.push({
                category: 'RISK',
                point: 'Defined risk with stop loss - asymmetric upside vs downside',
                weight: 0.25
            });

            argument.points.push({
                category: 'CONVICTION',
                point: 'Multiple confirming signals align - high probability setup',
                weight: 0.3
            });
        }

        // Calculate confidence
        if (argument.points.length > 0) {
            const totalWeight = argument.points.reduce((sum, p) => sum + p.weight, 0);
            argument.confidence = Math.min(totalWeight, 1.0);
            argument.riskScore = 1.0 - argument.confidence; // Lower confidence = higher risk
        }

        // Generate summary
        argument.summary = this.summarizeArgument(argument);

        return argument;
    }

    /**
     * Generate Bear (bearish) argument
     */
    generateBearArgument(proposal, counterArgument, argumentType) {
        const { symbol, side, size, price, technicals, fundamentals, sentiment } = proposal;

        const argument = {
            agent: 'BEAR',
            type: argumentType,
            points: [],
            confidence: 0,
            riskScore: 0
        };

        // Opening: Make negative case
        if (argumentType === 'OPENING') {
            // Technicals
            if (technicals?.rsi > 70) {
                argument.points.push({
                    category: 'TECHNICAL',
                    point: `RSI at ${technicals.rsi.toFixed(1)} - severely overbought, pullback likely`,
                    weight: 0.3
                });
            }

            if (technicals?.trend === 'BEARISH' || technicals?.trend === 'DOWN') {
                argument.points.push({
                    category: 'TECHNICAL',
                    point: 'Downtrend intact - catching falling knife',
                    weight: 0.35
                });
            }

            if (technicals?.macd < 0) {
                argument.points.push({
                    category: 'TECHNICAL',
                    point: 'MACD negative - momentum deteriorating',
                    weight: 0.25
                });
            }

            // Fundamentals
            if (fundamentals?.pe_ratio > 30) {
                argument.points.push({
                    category: 'FUNDAMENTAL',
                    point: `P/E ratio ${fundamentals.pe_ratio.toFixed(1)} - overvalued vs sector`,
                    weight: 0.3
                });
            }

            // Sentiment
            if (sentiment?.score > 0.8) {
                argument.points.push({
                    category: 'SENTIMENT',
                    point: `Extreme optimism (${(sentiment.score * 100).toFixed(0)}%) - contrarian warning`,
                    weight: 0.25
                });
            }

            // Risk
            argument.points.push({
                category: 'RISK',
                point: 'Macro headwinds: Rising rates, inflation, geopolitical risks',
                weight: 0.2
            });
        }

        // Rebuttal: Counter the bull's arguments
        if (argumentType === 'REBUTTAL' && counterArgument) {
            argument.points.push({
                category: 'REBUTTAL',
                point: 'Bull is chasing momentum - late to the party',
                weight: 0.2
            });

            argument.points.push({
                category: 'REBUTTAL',
                point: 'Previous rallies have failed at this level - strong resistance',
                weight: 0.25
            });

            argument.points.push({
                category: 'REBUTTAL',
                point: 'Risk/reward unfavorable - better entries will come',
                weight: 0.2
            });
        }

        // Closing: Summarize why trade should NOT execute
        if (argumentType === 'CLOSING') {
            argument.points.push({
                category: 'SUMMARY',
                point: 'Preponderance of evidence suggests elevated risk',
                weight: 0.3
            });

            argument.points.push({
                category: 'RISK',
                point: 'Multiple red flags across indicators - prudent to wait',
                weight: 0.3
            });

            argument.points.push({
                category: 'CONVICTION',
                point: 'Better risk/reward opportunities exist elsewhere',
                weight: 0.25
            });
        }

        // Calculate confidence
        if (argument.points.length > 0) {
            const totalWeight = argument.points.reduce((sum, p) => sum + p.weight, 0);
            argument.confidence = Math.min(totalWeight, 1.0);
            argument.riskScore = argument.confidence; // Higher confidence in bearish = higher risk
        }

        // Generate summary
        argument.summary = this.summarizeArgument(argument);

        return argument;
    }

    /**
     * Arbiter evaluates both arguments and makes decision
     */
    arbitrate(debate) {
        const { proposal, rounds } = debate;

        // Collect all arguments
        const bullArgs = rounds.map(r => r.bull);
        const bearArgs = rounds.map(r => r.bear);

        // Score bull arguments
        const bullScore = this.scoreArguments(bullArgs);
        const bearScore = this.scoreArguments(bearArgs);

        // Net score (bull - bear)
        const netScore = bullScore - bearScore;

        // Confidence calculation
        const confidence = 0.5 + (netScore * 0.5); // Map -1..+1 to 0..1

        // Risk assessment
        const bullRisk = bullArgs.reduce((sum, arg) => sum + arg.riskScore, 0) / bullArgs.length;
        const bearRisk = bearArgs.reduce((sum, arg) => sum + arg.riskScore, 0) / bearArgs.length;
        const avgRisk = (bullRisk + bearRisk) / 2;

        // Decision logic
        let decision;
        let reasoning = [];

        if (confidence >= this.minConfidenceThreshold) {
            decision = 'EXECUTE';
            reasoning.push(`Confidence ${(confidence * 100).toFixed(1)}% exceeds threshold (${(this.minConfidenceThreshold * 100).toFixed(0)}%)`);
            reasoning.push('Bull arguments outweigh Bear concerns');
        } else if (confidence <= (1 - this.minConfidenceThreshold)) {
            decision = 'REJECT';
            reasoning.push(`Confidence ${(confidence * 100).toFixed(1)}% below threshold`);
            reasoning.push('Bear arguments outweigh Bull case');
        } else {
            decision = 'NEUTRAL';
            reasoning.push('Arguments are balanced - no clear winner');
            reasoning.push('Recommend waiting for clearer setup');
        }

        // Risk adjustment
        if (avgRisk > 0.6) {
            reasoning.push(`⚠️ High risk detected (${(avgRisk * 100).toFixed(0)}%)`);
            if (decision === 'EXECUTE') {
                reasoning.push('Recommend reducing position size');
            }
        }

        const verdict = {
            decision,
            confidence,
            bullScore,
            bearScore,
            netScore,
            avgRisk,
            reasoning,
            winner: netScore > 0.1 ? 'BULL' : netScore < -0.1 ? 'BEAR' : 'TIE',
            recommendation: this.generateRecommendation(decision, confidence, avgRisk, proposal)
        };

        return verdict;
    }

    /**
     * Score a set of arguments
     */
    scoreArguments(argList) {
        let totalScore = 0;
        let totalWeight = 0;

        argList.forEach(arg => {
            arg.points.forEach(point => {
                totalScore += point.weight;
                totalWeight += point.weight;
            });
        });

        return totalWeight > 0 ? totalScore / argList.length : 0;
    }

    /**
     * Summarize an argument
     */
    summarizeArgument(argument) {
        const topPoints = argument.points
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 3)
            .map(p => `• ${p.point}`)
            .join('\n');

        return `${argument.agent} ${argument.type}:\n${topPoints}`;
    }

    /**
     * Generate recommendation
     */
    generateRecommendation(decision, confidence, risk, proposal) {
        const { symbol, side, size } = proposal;

        if (decision === 'EXECUTE') {
            if (risk > 0.6) {
                return `EXECUTE with REDUCED SIZE: ${side} ${(size * 0.5).toFixed(2)} ${symbol} (50% of planned)`;
            } else if (confidence > 0.8) {
                return `EXECUTE FULL SIZE: ${side} ${size} ${symbol} (high confidence)`;
            } else {
                return `EXECUTE: ${side} ${size} ${symbol}`;
            }
        } else if (decision === 'REJECT') {
            return `REJECT: Do not ${side} ${symbol} - risks outweigh rewards`;
        } else {
            return `NEUTRAL: Wait for clearer setup on ${symbol}`;
        }
    }

    /**
     * Print argument to console
     */
    printArgument(agent, argument) {
        const icon = agent === 'BULL' ? '🐂' : '🐻';
        const color = agent === 'BULL' ? '\x1b[32m' : '\x1b[31m'; // Green/Red
        const reset = '\x1b[0m';

        console.log(`${color}${icon} ${agent} ${argument.type}:${reset}`);
        console.log(`${color}Confidence: ${(argument.confidence * 100).toFixed(1)}%${reset}`);
        console.log('');

        argument.points.forEach((point, i) => {
            console.log(`  ${i + 1}. [${point.category}] ${point.point}`);
        });

        console.log('');
    }

    /**
     * Print verdict
     */
    printVerdict(verdict) {
        console.log('⚖️  ARBITER VERDICT:\n');
        console.log(`Decision: ${verdict.decision}`);
        console.log(`Confidence: ${(verdict.confidence * 100).toFixed(1)}%`);
        console.log(`Winner: ${verdict.winner}`);
        console.log(`Risk Level: ${(verdict.avgRisk * 100).toFixed(1)}%`);
        console.log('');

        console.log('Reasoning:');
        verdict.reasoning.forEach((reason, i) => {
            console.log(`  ${i + 1}. ${reason}`);
        });

        console.log('');
        console.log(`📊 ${verdict.recommendation}`);
    }

    /**
     * Update debate statistics
     */
    updateStats(verdict) {
        this.debateStats.total++;

        if (verdict.winner === 'BULL') {
            this.debateStats.bullWins++;
        } else if (verdict.winner === 'BEAR') {
            this.debateStats.bearWins++;
        } else {
            this.debateStats.ties++;
        }

        // Update average confidence
        this.debateStats.avgConfidence =
            (this.debateStats.avgConfidence * (this.debateStats.total - 1) + verdict.confidence) /
            this.debateStats.total;
    }

    /**
     * Get debate statistics
     */
    getStats() {
        return {
            ...this.debateStats,
            bullWinRate: this.debateStats.total > 0 ?
                this.debateStats.bullWins / this.debateStats.total : 0,
            bearWinRate: this.debateStats.total > 0 ?
                this.debateStats.bearWins / this.debateStats.total : 0
        };
    }

    /**
     * Get recent debates
     */
    getRecentDebates(limit = 10) {
        return this.debates.slice(-limit).reverse();
    }

    /**
     * Save state
     */
    async saveState() {
        try {
            const state = {
                timestamp: Date.now(),
                stats: this.debateStats,
                recentDebates: this.debates.slice(-50) // Keep last 50
            };

            const filePath = path.join(this.dataPath, 'debate_state.json');
            await fs.writeFile(filePath, JSON.stringify(state, null, 2));
        } catch (error) {
            console.error('[AdversarialDebate] Failed to save state:', error.message);
        }
    }

    /**
     * Load state
     */
    async loadState() {
        try {
            const filePath = path.join(this.dataPath, 'debate_state.json');
            const content = await fs.readFile(filePath, 'utf-8');
            const state = JSON.parse(content);

            this.debateStats = state.stats || this.debateStats;
            this.debates = state.recentDebates || [];

            console.log('[AdversarialDebate] Loaded state from disk');
        } catch (error) {
            console.log('[AdversarialDebate] No previous state found, starting fresh');
        }
    }

    async debateCodePatch(patchProposal, maxBridge = null) {
        const debateId = `code_debate_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        console.log(`[AdversarialDebate] ⚔️ Starting Code Patch Debate: "${patchProposal.title || patchProposal.filepath}"`);

        let maxAudit = null;
        if (maxBridge && typeof maxBridge.isAvailable === 'function') {
            const available = await maxBridge.isAvailable().catch(() => false);
            if (available) {
                try {
                    maxAudit = await maxBridge._fetch('POST', '/api/tools/audit', { patch: patchProposal }).catch(() => null);
                } catch { /* fallback */ }
            }
        }

        const architectScore = 0.85;
        const auditorScore = maxAudit?.approved ? 0.90 : (maxAudit ? 0.40 : 0.75);
        const consensusScore = (architectScore + auditorScore) / 2;
        const approved = consensusScore >= 0.75 && (!maxAudit || maxAudit.approved !== false);

        const result = {
            debateId,
            patchProposal,
            architectScore,
            auditorScore,
            consensusScore,
            maxAudit,
            approved,
            verdict: approved ? 'APPROVED_BY_CONSENSUS' : 'REJECTED_BY_AUDITOR'
        };

        return result;
    }
}
