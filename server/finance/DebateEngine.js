/**
 * AI Debate Engine for SOMA
 * Ported from NOFX - Multiple AI models debate trading decisions
 *
 * Features:
 * - Multiple AI personalities (Bull, Bear, Analyst, Contrarian, Risk Manager)
 * - Round-based debates with voting
 * - Consensus determination
 * - Real-time SSE streaming
 */

import { EventEmitter } from 'events';

// Debate personalities with their biases
export const DEBATE_PERSONALITIES = {
    bull: {
        name: 'Bull',
        emoji: '🐂',
        color: '#22C55E',
        systemPrompt: `You are a BULLISH trading analyst. You tend to see opportunities for upward price movement.
Focus on: momentum indicators, breakout patterns, positive sentiment, accumulation signals.
Your bias is toward LONG positions, but you must justify with data. If the evidence is overwhelmingly bearish, acknowledge it.`,
        bias: 'long'
    },
    bear: {
        name: 'Bear',
        emoji: '🐻',
        color: '#EF4444',
        systemPrompt: `You are a BEARISH trading analyst. You tend to identify risks and downward pressure.
Focus on: resistance levels, overbought conditions, negative divergences, distribution patterns.
Your bias is toward SHORT positions, but you must justify with data. If the evidence is overwhelmingly bullish, acknowledge it.`,
        bias: 'short'
    },
    analyst: {
        name: 'Analyst',
        emoji: '📊',
        color: '#3B82F6',
        systemPrompt: `You are a NEUTRAL technical analyst. You have no directional bias.
Focus on: pure technical analysis, support/resistance, volume patterns, indicator confluence.
Provide objective analysis. Your job is to find the highest probability setup regardless of direction.`,
        bias: 'neutral'
    },
    contrarian: {
        name: 'Contrarian',
        emoji: '🔄',
        color: '#F59E0B',
        systemPrompt: `You are a CONTRARIAN analyst. You look for overcrowded trades and reversal opportunities.
Focus on: extreme sentiment readings, crowded positioning, mean reversion setups, capitulation signals.
Your job is to identify when the crowd is wrong and find counter-trend opportunities.`,
        bias: 'contrarian'
    },
    risk_manager: {
        name: 'Risk Manager',
        emoji: '🛡️',
        color: '#8B5CF6',
        systemPrompt: `You are a RISK MANAGER. Your priority is capital preservation.
Focus on: position sizing, stop loss placement, risk/reward ratios, correlation risks, drawdown limits.
You must approve or veto trade ideas based on risk parameters. Suggest modifications to improve risk profile.`,
        bias: 'risk'
    }
};

// Action types
export const DEBATE_ACTIONS = {
    OPEN_LONG: 'open_long',
    OPEN_SHORT: 'open_short',
    CLOSE_LONG: 'close_long',
    CLOSE_SHORT: 'close_short',
    HOLD: 'hold',
    WAIT: 'wait'
};

/**
 * Debate Session
 */
class DebateSession {
    constructor(config) {
        this.id = config.id || `debate_${Date.now()}`;
        this.symbol = config.symbol;
        this.participants = config.participants || ['bull', 'bear', 'analyst'];
        this.maxRounds = config.maxRounds || 3;
        this.currentRound = 0;
        this.status = 'pending'; // pending, running, voting, completed, cancelled
        this.messages = [];
        this.votes = [];
        this.finalDecision = null;
        this.createdAt = new Date();
        this.marketContext = null;
    }
}

/**
 * Main Debate Engine
 */
export class DebateEngine extends EventEmitter {
    constructor(aiProvider) {
        super();
        this.aiProvider = aiProvider; // Function to call AI (symbol, systemPrompt, userPrompt) => response
        this.sessions = new Map();
        this.activeDebate = null;
    }

    /**
     * Create a new debate session
     */
    createSession(config) {
        const session = new DebateSession(config);
        this.sessions.set(session.id, session);
        console.log(`[Debate] Created session ${session.id} for ${session.symbol}`);
        return session;
    }

    /**
     * Build market context for the debate
     */
    async buildMarketContext(symbol, marketData) {
        return {
            symbol,
            currentPrice: marketData.price || 0,
            change24h: marketData.change24h || 0,
            volume24h: marketData.volume24h || 0,
            high24h: marketData.high24h || 0,
            low24h: marketData.low24h || 0,
            rsi: marketData.rsi || 50,
            macd: marketData.macd || { value: 0, signal: 0, histogram: 0 },
            ema20: marketData.ema20 || 0,
            ema50: marketData.ema50 || 0,
            support: marketData.support || 0,
            resistance: marketData.resistance || 0,
            orderBookImbalance: marketData.orderBookImbalance || 0,
            fundingRate: marketData.fundingRate || 0,
            openInterest: marketData.openInterest || 0,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Start a debate
     */
    async startDebate(sessionId, marketData) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`Session ${sessionId} not found`);
        if (session.status !== 'pending') throw new Error('Session already started');

        session.status = 'running';
        session.marketContext = await this.buildMarketContext(session.symbol, marketData);
        this.activeDebate = session;

        this.emit('debateStart', { sessionId, session });
        console.log(`[Debate] Starting debate ${sessionId} for ${session.symbol}`);

        try {
            await this.runDebateRounds(session);
            await this.collectVotes(session);
            session.finalDecision = this.determineConsensus(session);
            session.status = 'completed';

            this.emit('debateComplete', {
                sessionId,
                decision: session.finalDecision,
                messages: session.messages,
                votes: session.votes
            });

            console.log(`[Debate] Completed: ${session.finalDecision.action} ${session.symbol} (${session.finalDecision.confidence}% confidence)`);
            return session.finalDecision;
        } catch (error) {
            session.status = 'cancelled';
            this.emit('debateError', { sessionId, error: error.message });
            throw error;
        } finally {
            this.activeDebate = null;
        }
    }

    /**
     * Run debate rounds
     */
    async runDebateRounds(session) {
        for (let round = 1; round <= session.maxRounds; round++) {
            session.currentRound = round;
            this.emit('roundStart', { sessionId: session.id, round });
            console.log(`[Debate] Round ${round}/${session.maxRounds}`);

            for (const personalityId of session.participants) {
                const personality = DEBATE_PERSONALITIES[personalityId];
                if (!personality) continue;

                try {
                    const response = await this.getParticipantResponse(
                        session,
                        personalityId,
                        personality,
                        round
                    );

                    const message = {
                        id: `msg_${Date.now()}_${personalityId}`,
                        sessionId: session.id,
                        round,
                        participant: personalityId,
                        personalityName: personality.name,
                        emoji: personality.emoji,
                        color: personality.color,
                        content: response.content,
                        decision: response.decision,
                        confidence: response.confidence,
                        reasoning: response.reasoning,
                        timestamp: new Date()
                    };

                    session.messages.push(message);
                    this.emit('message', { sessionId: session.id, message });

                    console.log(`[Debate] ${personality.emoji} ${personality.name}: ${response.decision.action} (${response.confidence}%)`);
                } catch (error) {
                    console.error(`[Debate] Error from ${personality.name}:`, error.message);
                    this.emit('participantError', { sessionId: session.id, participant: personalityId, error: error.message });
                }
            }

            this.emit('roundEnd', { sessionId: session.id, round });
        }
    }

    /**
     * Get response from a debate participant
     */
    async getParticipantResponse(session, personalityId, personality, round) {
        const systemPrompt = this.buildSystemPrompt(personality, session, round);
        const userPrompt = this.buildUserPrompt(session, round);

        // Call AI provider
        const response = await this.aiProvider(session.symbol, systemPrompt, userPrompt);

        // Parse response
        return this.parseAIResponse(response, personalityId);
    }

    /**
     * Build system prompt for participant
     */
    buildSystemPrompt(personality, session, round) {
        return `${personality.systemPrompt}

DEBATE CONTEXT:
- Symbol: ${session.symbol}
- Round: ${round}/${session.maxRounds}
- Your Role: ${personality.name} (${personality.emoji})

RESPONSE FORMAT (JSON):
{
    "action": "open_long|open_short|hold|wait|close_long|close_short",
    "confidence": 0-100,
    "reasoning": "Your detailed analysis",
    "keyPoints": ["point1", "point2", "point3"],
    "riskLevel": "low|medium|high|extreme",
    "targetPrice": number or null,
    "stopLoss": number or null,
    "positionSize": "small|medium|large"
}

${round > 1 ? 'Consider the previous arguments from other participants and either strengthen your position or adjust based on valid counterpoints.' : ''}`;
    }

    /**
     * Build user prompt with market context
     */
    buildUserPrompt(session, round) {
        const ctx = session.marketContext;
        const previousMessages = session.messages
            .filter(m => m.round < round)
            .map(m => `${m.emoji} ${m.personalityName}: ${m.decision.action} (${m.confidence}%) - ${m.reasoning}`)
            .join('\n');

        return `MARKET DATA FOR ${ctx.symbol}:
- Current Price: $${ctx.currentPrice.toLocaleString()}
- 24h Change: ${ctx.change24h > 0 ? '+' : ''}${ctx.change24h.toFixed(2)}%
- 24h Volume: $${(ctx.volume24h / 1e6).toFixed(2)}M
- 24h High/Low: $${ctx.high24h.toLocaleString()} / $${ctx.low24h.toLocaleString()}

TECHNICAL INDICATORS:
- RSI(14): ${ctx.rsi.toFixed(1)}
- MACD: ${ctx.macd.value.toFixed(2)} (Signal: ${ctx.macd.signal.toFixed(2)}, Hist: ${ctx.macd.histogram.toFixed(2)})
- EMA20: $${ctx.ema20.toLocaleString()} | EMA50: $${ctx.ema50.toLocaleString()}
- Support: $${ctx.support.toLocaleString()} | Resistance: $${ctx.resistance.toLocaleString()}

MARKET STRUCTURE:
- Order Book Imbalance: ${ctx.orderBookImbalance > 0 ? 'Buy' : 'Sell'} pressure (${Math.abs(ctx.orderBookImbalance).toFixed(2)})
- Funding Rate: ${(ctx.fundingRate * 100).toFixed(4)}%
- Open Interest: $${(ctx.openInterest / 1e6).toFixed(2)}M

${previousMessages ? `\nPREVIOUS ARGUMENTS:\n${previousMessages}` : ''}

Provide your ${round === session.maxRounds ? 'FINAL' : ''} analysis and trading recommendation:`;
    }

    /**
     * Parse AI response into structured format
     */
    parseAIResponse(response, personalityId) {
        try {
            // Try to extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    content: response,
                    decision: {
                        action: parsed.action || 'hold',
                        targetPrice: parsed.targetPrice,
                        stopLoss: parsed.stopLoss,
                        positionSize: parsed.positionSize || 'medium'
                    },
                    confidence: Math.min(100, Math.max(0, parsed.confidence || 50)),
                    reasoning: parsed.reasoning || '',
                    keyPoints: parsed.keyPoints || [],
                    riskLevel: parsed.riskLevel || 'medium'
                };
            }
        } catch (e) {
            console.warn(`[Debate] Failed to parse JSON response from ${personalityId}`);
        }

        // Fallback: extract action from text
        const actionKeywords = {
            'open_long': ['long', 'buy', 'bullish', 'accumulate'],
            'open_short': ['short', 'sell', 'bearish', 'distribute'],
            'hold': ['hold', 'wait', 'neutral', 'sideways']
        };

        let detectedAction = 'hold';
        const lowerResponse = response.toLowerCase();
        for (const [action, keywords] of Object.entries(actionKeywords)) {
            if (keywords.some(kw => lowerResponse.includes(kw))) {
                detectedAction = action;
                break;
            }
        }

        return {
            content: response,
            decision: { action: detectedAction },
            confidence: 50,
            reasoning: response.slice(0, 500),
            keyPoints: [],
            riskLevel: 'medium'
        };
    }

    /**
     * Collect final votes from participants
     */
    async collectVotes(session) {
        session.status = 'voting';
        this.emit('votingStart', { sessionId: session.id });

        // Get last message from each participant as their vote
        for (const personalityId of session.participants) {
            const lastMessage = [...session.messages]
                .reverse()
                .find(m => m.participant === personalityId);

            if (lastMessage) {
                session.votes.push({
                    participant: personalityId,
                    action: lastMessage.decision.action,
                    confidence: lastMessage.confidence,
                    reasoning: lastMessage.reasoning
                });

                this.emit('vote', { sessionId: session.id, vote: session.votes[session.votes.length - 1] });
            }
        }
    }

    /**
     * Determine consensus from votes
     */
    determineConsensus(session) {
        const votes = session.votes;
        if (votes.length === 0) {
            return { action: 'hold', confidence: 0, reasoning: 'No votes collected' };
        }

        // Weight votes by confidence
        const actionScores = {};
        let totalWeight = 0;

        for (const vote of votes) {
            const weight = vote.confidence / 100;
            actionScores[vote.action] = (actionScores[vote.action] || 0) + weight;
            totalWeight += weight;
        }

        // Find winning action
        let winningAction = 'hold';
        let maxScore = 0;
        for (const [action, score] of Object.entries(actionScores)) {
            if (score > maxScore) {
                maxScore = score;
                winningAction = action;
            }
        }

        // Calculate consensus confidence
        const consensusConfidence = Math.round((maxScore / totalWeight) * 100);

        // Gather reasoning from supporters
        const supportingVotes = votes.filter(v => v.action === winningAction);
        const reasoning = supportingVotes.map(v => v.reasoning).join(' | ');

        return {
            action: winningAction,
            confidence: consensusConfidence,
            reasoning,
            voteBreakdown: actionScores,
            totalVotes: votes.length,
            supportingVotes: supportingVotes.length
        };
    }

    /**
     * Get session by ID
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    /**
     * List all sessions
     */
    listSessions() {
        return Array.from(this.sessions.values());
    }

    /**
     * Cancel a debate
     */
    cancelDebate(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.status === 'running') {
            session.status = 'cancelled';
            this.emit('debateCancelled', { sessionId });
        }
    }
}

export default DebateEngine;
