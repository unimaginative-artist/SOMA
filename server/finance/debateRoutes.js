/**
 * Debate Arena API Routes
 * Real-time AI trading debates with SSE streaming
 */

import express from 'express';
import { DebateEngine, DEBATE_PERSONALITIES, DEBATE_ACTIONS } from './DebateEngine.js';
import marketDataService from './marketDataService.js';

// ── Indicator helpers (pure functions, no external deps) ────────────────────
function calcEMA(closes, period) {
    if (!closes.length || closes.length < period) return closes[closes.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((s, c) => s + c, 0) / period;
    for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    return ema;
}

function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    const start = closes.length - period;
    for (let i = start; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) gains += d; else losses += Math.abs(d);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

function calcMACD(closes) {
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const value = parseFloat((ema12 - ema26).toFixed(4));
    // Approximate signal line (9-period EMA of MACD requires history we don't carry; use 80% decay)
    const signal = parseFloat((value * 0.8).toFixed(4));
    return { value, signal, histogram: parseFloat((value - signal).toFixed(4)) };
}

const router = express.Router();

// Store for SSE clients
const sseClients = new Map();

// AI Provider - calls SOMA's QuadBrain directly (DeepSeek → Ollama fallback chain)
const aiProvider = async (symbol, systemPrompt, userPrompt) => {
    try {
        const brain = global.SOMA?.brain || global.SOMA?.quadBrain;
        if (brain && typeof brain.reason === 'function') {
            const fullPrompt = `${systemPrompt}\n\n---\nMarket symbol: ${symbol}\n\n${userPrompt}`;
            const result = await Promise.race([
                brain.reason(fullPrompt, { quickResponse: true }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000))
            ]);
            if (result?.text) return result.text;
        }
    } catch (e) {
        console.warn('[Debate] SOMA brain unavailable, using fallback:', e.message);
    }

    // Fallback: Generate structured response based on market data
    return generateFallbackResponse(symbol, userPrompt);
};

// Fallback response generator when AI is not available
// SAFETY: Always returns "hold" with 0 confidence so it can never trigger a real trade
const generateFallbackResponse = (symbol, prompt) => {
    return JSON.stringify({
        action: 'hold',
        confidence: 0,
        reasoning: `[FALLBACK] AI unavailable for ${symbol}. Defaulting to HOLD. No trade should be placed on fallback data.`,
        keyPoints: [
            'AI provider offline - no real analysis performed',
            'Manual review recommended before any action'
        ],
        riskLevel: 'high',
        positionSize: 'none'
    });
};

// Initialize debate engine
const debateEngine = new DebateEngine(aiProvider);

// Setup event listeners for SSE
debateEngine.on('debateStart', (data) => broadcastToSession(data.sessionId, 'debateStart', data));
debateEngine.on('roundStart', (data) => broadcastToSession(data.sessionId, 'roundStart', data));
debateEngine.on('message', (data) => broadcastToSession(data.sessionId, 'message', data));
debateEngine.on('roundEnd', (data) => broadcastToSession(data.sessionId, 'roundEnd', data));
debateEngine.on('votingStart', (data) => broadcastToSession(data.sessionId, 'votingStart', data));
debateEngine.on('vote', (data) => broadcastToSession(data.sessionId, 'vote', data));
debateEngine.on('debateComplete', (data) => broadcastToSession(data.sessionId, 'debateComplete', data));
debateEngine.on('debateError', (data) => broadcastToSession(data.sessionId, 'error', data));

// Broadcast to all SSE clients watching a session
function broadcastToSession(sessionId, event, data) {
    const clients = sseClients.get(sessionId) || [];
    clients.forEach(res => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

/**
 * GET /api/debate/personalities
 * List available AI personalities
 */
router.get('/personalities', (req, res) => {
    res.json({
        success: true,
        personalities: Object.entries(DEBATE_PERSONALITIES).map(([id, p]) => ({
            id,
            name: p.name,
            emoji: p.emoji,
            color: p.color,
            bias: p.bias
        }))
    });
});

/**
 * POST /api/debate/create
 * Create a new debate session
 */
router.post('/create', (req, res) => {
    try {
        const { symbol, participants, maxRounds } = req.body;

        if (!symbol) {
            return res.status(400).json({ success: false, error: 'Symbol is required' });
        }

        const session = debateEngine.createSession({
            symbol: symbol.toUpperCase(),
            participants: participants || ['bull', 'bear', 'analyst'],
            maxRounds: maxRounds || 3
        });

        res.json({
            success: true,
            session: {
                id: session.id,
                symbol: session.symbol,
                participants: session.participants,
                maxRounds: session.maxRounds,
                status: session.status
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/debate/:sessionId/start
 * Start a debate — fetches real market data from marketDataService when caller doesn't supply it.
 */
router.post('/:sessionId/start', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { marketData } = req.body;

        let data = marketData || null;

        // Auto-fetch real market data when the caller doesn't provide it
        if (!data) {
            const session = debateEngine.getSession(sessionId);
            const symbol = session?.symbol;

            if (symbol) {
                try {
                    // Fetch 60 5-minute bars (~5 hours of data) for indicator calculations
                    const bars = await Promise.race([
                        marketDataService.getBars(symbol, '5Min', 60),
                        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))
                    ]);

                    if (bars?.length >= 2) {
                        const latest = bars[bars.length - 1];
                        const first = bars[0];
                        const closes = bars.map(b => parseFloat(b.close));
                        const highs  = bars.map(b => parseFloat(b.high  || b.close));
                        const lows   = bars.map(b => parseFloat(b.low   || b.close));
                        const totalVolume = bars.reduce((s, b) => s + (parseFloat(b.volume) || 0), 0);

                        data = {
                            price:    parseFloat(latest.close.toFixed(4)),
                            change24h: first.close > 0
                                ? parseFloat(((latest.close - first.close) / first.close * 100).toFixed(3))
                                : 0,
                            volume24h:   totalVolume,
                            high24h:     Math.max(...highs),
                            low24h:      Math.min(...lows),
                            rsi:         calcRSI(closes),
                            macd:        calcMACD(closes),
                            ema20:       parseFloat(calcEMA(closes, 20).toFixed(4)),
                            ema50:       parseFloat(calcEMA(closes, 50).toFixed(4)),
                            support:     parseFloat(Math.min(...lows.slice(-20)).toFixed(4)),
                            resistance:  parseFloat(Math.max(...highs.slice(-20)).toFixed(4)),
                            dataSource:  'live',
                            barCount:    bars.length
                        };

                        console.log(`[Debate] Loaded real market data for ${symbol}: price=${data.price} RSI=${data.rsi} change=${data.change24h}%`);
                    }
                } catch (e) {
                    console.warn(`[Debate] Could not fetch real market data for ${symbol}: ${e.message}`);
                }
            }
        }

        // If still no data (market closed, symbol unsupported, service offline) use neutral context
        // — deliberately sparse so SOMA's brain knows data is missing rather than fabricating confidence
        if (!data) {
            console.warn('[Debate] No market data available — debate will run with minimal context');
            data = {
                price: null,
                change24h: 0,
                volume24h: 0,
                dataSource: 'unavailable'
            };
        }

        // Start debate asynchronously (SSE stream delivers results)
        debateEngine.startDebate(sessionId, data).catch(err => {
            console.error('[Debate] Error:', err);
        });

        res.json({ success: true, message: 'Debate started', sessionId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/debate/:sessionId/stream
 * SSE endpoint for real-time debate updates
 */
router.get('/:sessionId/stream', (req, res) => {
    const { sessionId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Add client to session
    if (!sseClients.has(sessionId)) {
        sseClients.set(sessionId, []);
    }
    sseClients.get(sessionId).push(res);

    // Send initial connection event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);

    // Cleanup on disconnect
    req.on('close', () => {
        const clients = sseClients.get(sessionId) || [];
        const index = clients.indexOf(res);
        if (index > -1) {
            clients.splice(index, 1);
        }
    });
});

/**
 * GET /api/debate/:sessionId
 * Get debate session details
 */
router.get('/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = debateEngine.getSession(sessionId);

        if (!session) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        res.json({
            success: true,
            session: {
                id: session.id,
                symbol: session.symbol,
                participants: session.participants,
                maxRounds: session.maxRounds,
                currentRound: session.currentRound,
                status: session.status,
                messages: session.messages,
                votes: session.votes,
                finalDecision: session.finalDecision,
                createdAt: session.createdAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/debate/sessions
 * List all debate sessions
 */
router.get('/', (req, res) => {
    try {
        const sessions = debateEngine.listSessions().map(s => ({
            id: s.id,
            symbol: s.symbol,
            status: s.status,
            currentRound: s.currentRound,
            maxRounds: s.maxRounds,
            createdAt: s.createdAt
        }));

        res.json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/debate/:sessionId/cancel
 * Cancel a running debate
 */
router.post('/:sessionId/cancel', (req, res) => {
    try {
        const { sessionId } = req.params;
        debateEngine.cancelDebate(sessionId);
        res.json({ success: true, message: 'Debate cancelled' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
