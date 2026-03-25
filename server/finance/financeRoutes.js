/**
 * Finance Routes - General trading analysis and execution
 * Powered by SOMA's FinanceAgentArbiter (Real AI Swarm)
 */

import express from 'express';
import alpacaService from './AlpacaService.js';
import { FinanceAgentArbiter } from '../../arbiters/FinanceAgentArbiter.js';
import TradingGuardrails from './TradingGuardrails.js';
import slippageTracker from './SlippageTracker.js';
import tradeLogger from './TradeLogger.js';

const router = express.Router();

// Use shared guardrails from bootstrap (global.SOMA_TRADING) or create fallback
function getGuardrails() {
    return global.SOMA_TRADING?.guardrails || _fallbackGuardrails;
}
const _fallbackGuardrails = new TradingGuardrails({
    maxTradeValue: Infinity,    // Use maxPositionSize % instead
    maxDailyLoss: Infinity,
    maxDailyLossPct: 0.05,      // 5% daily loss limit
    maxDailyTrades: 50,
    minConfidence: 0.5,
    cooldownMs: 5000,
    maxPositionSize: 0.15,
    requireMarketHours: false   // Allow crypto 24/7
});

// --- Rate limiter for AI analysis (prevent hammering expensive LLM calls) ---
const analysisRateLimit = new Map(); // ip+symbol -> timestamp
const ANALYSIS_COOLDOWN_MS = 15000; // 15s between identical analyses
const ANALYSIS_GLOBAL_COOLDOWN_MS = 5000; // 5s between any analysis from same IP

function checkAnalysisRateLimit(ip, symbol) {
    const now = Date.now();
    const symbolKey = `${ip}:${symbol}`;
    const globalKey = `${ip}:*`;

    // Check symbol-specific cooldown
    const lastSymbol = analysisRateLimit.get(symbolKey);
    if (lastSymbol && now - lastSymbol < ANALYSIS_COOLDOWN_MS) {
        const waitSec = Math.ceil((ANALYSIS_COOLDOWN_MS - (now - lastSymbol)) / 1000);
        return { allowed: false, reason: `Analysis for ${symbol} was run recently. Wait ${waitSec}s.` };
    }

    // Check global cooldown (any symbol)
    const lastGlobal = analysisRateLimit.get(globalKey);
    if (lastGlobal && now - lastGlobal < ANALYSIS_GLOBAL_COOLDOWN_MS) {
        return { allowed: false, reason: 'Too many analysis requests. Please wait a moment.' };
    }

    // Record timestamps
    analysisRateLimit.set(symbolKey, now);
    analysisRateLimit.set(globalKey, now);

    // Cleanup old entries every 100 requests
    if (analysisRateLimit.size > 200) {
        for (const [key, ts] of analysisRateLimit) {
            if (now - ts > 60000) analysisRateLimit.delete(key);
        }
    }

    return { allowed: true };
}

// Initialize SOMA's Finance Arbiter (Lazy-loaded)
let financeArbiter = null;
async function getFinanceArbiter() {
    if (!financeArbiter) {
        console.log('[Finance] Initializing SOMA FinanceAgentArbiter...');
        financeArbiter = new FinanceAgentArbiter({
            // QuadBrain injected from global.SOMA (exposed by launcher)
            quadBrain: global.SOMA?.quadBrain || null,
            visionArbiter: global.SOMA?.visionArbiter || null,
            edgeOrchestrator: global.SOMA?.edgeOrchestrator || null,
            rootPath: process.cwd()
        });
        await financeArbiter.onInitialize();
        console.log('[Finance] ✅ SOMA Finance Arbiter ready!');
    }
    return financeArbiter;
}

/**
 * GET /api/finance/search
 * Search the entire financial universe (300k+ assets)
 * Query: ?q=tesla or ?q=semiconductor
 */
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ results: [] });

        const arbiter = await getFinanceArbiter();
        const results = await arbiter.knowledgeArbiter.searchUniverse(q);
        
        res.json({ success: true, count: results.length, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/finance/sectors
 * Get sector map for a country
 * Query: ?country=United States
 */
router.get('/sectors', async (req, res) => {
    try {
        const { country = 'United States' } = req.query;
        const arbiter = await getFinanceArbiter();
        const map = arbiter.knowledgeArbiter.getSectorMap(country);
        
        res.json({ success: true, country, sectors: map });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/finance/analyze
 * Multi-agent AI analysis of a trading symbol
 *
 * Returns swarm analysis with:
 * - thesis: Overall market thesis
 * - quant: Technical analysis and backtesting
 * - risk: Risk assessment
 * - sentiment: Market sentiment analysis
 * - strategy: Recommended trading strategy
 */
router.post('/analyze', async (req, res) => {
    try {
        const { symbol } = req.body;

        if (!symbol) {
            return res.status(400).json({ success: false, error: 'Symbol is required' });
        }

        // Rate limit AI analysis to prevent hammering expensive LLM calls
        const rateCheck = checkAnalysisRateLimit(req.ip, symbol);
        if (!rateCheck.allowed) {
            return res.status(429).json({ success: false, error: rateCheck.reason });
        }

        console.log(`[Finance] 🧠 Analyzing ${symbol} with SOMA's AI Swarm...`);

        // Get the real SOMA Finance Arbiter
        const arbiter = await getFinanceArbiter();

        // Run SOMA's full AI swarm analysis!
        const fullAnalysis = await arbiter.analyzeStock(symbol);

        // Format for frontend (map SOMA's output to Mission Control format)
        const analysis = {
            // Director's thesis
            thesis: fullAnalysis.thesis || "Analysis in progress",

            // Quant agent output
            quant: {
                strategy: fullAnalysis.quant?.strategy || "Multi-Factor Analysis",
                technical_indicators: fullAnalysis.quant?.technical_indicators || {},
                backtest_results: fullAnalysis.quant?.backtest_results || {}
            },

            // Risk agent output
            risk: {
                score: fullAnalysis.risk?.score || 50,
                max_drawdown_limit: fullAnalysis.risk?.max_drawdown_limit || '5%',
                position_size_recommendation: fullAnalysis.risk?.position_sizing || 'Medium',
                notes: fullAnalysis.risk?.notes || 'Risk analysis complete'
            },

            // Sentiment agent output
            sentiment: {
                score: fullAnalysis.sentiment?.score || 0.5,
                label: fullAnalysis.sentiment?.label || 'Neutral',
                social_volume: fullAnalysis.sentiment?.social_volume || 'Medium',
                fear_greed_index: 50
            },

            // Strategist agent output
            strategy: {
                recommendation: fullAnalysis.strategy?.recommendation || 'HOLD',
                confidence: fullAnalysis.strategy?.confidence || 0.5,
                rationale: fullAnalysis.strategy?.rationale || 'Analysis complete',
                entry_price: fullAnalysis.research?.price || null,
                stop_loss: fullAnalysis.strategy?.action_plan?.stop_loss || null,
                take_profit: fullAnalysis.strategy?.action_plan?.target || null
            },

            // Additional SOMA data
            debate: fullAnalysis.debate, // Bull vs Bear debate
            portfolio: fullAnalysis.portfolio, // Portfolio state
            duration: fullAnalysis.duration // Analysis duration
        };

        res.json({
            success: true,
            symbol,
            timestamp: new Date().toISOString(),
            analysis
        });

    } catch (error) {
        console.error('[Finance] Analysis error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/finance/execute
 * Execute a manual trade
 *
 * Body:
 * - symbol: Trading symbol
 * - side: 'buy' or 'sell'
 * - quantity: Number of shares/contracts
 * - type: 'market' or 'limit'
 * - price: Limit price (optional, for limit orders)
 */
router.post('/execute', async (req, res) => {
    try {
        const { symbol, side, quantity, type = 'market', price, stopLoss, takeProfit } = req.body;

        // Validation
        if (!symbol || !side || !quantity) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: symbol, side, quantity'
            });
        }

        if (!['buy', 'sell'].includes(side.toLowerCase())) {
            return res.status(400).json({
                success: false,
                error: 'Side must be "buy" or "sell"'
            });
        }

        if (quantity <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Quantity must be greater than 0'
            });
        }

        // Check if Alpaca is connected
        if (!alpacaService.isConnected) {
            return res.status(503).json({
                success: false,
                error: 'Trading service not connected. Please configure API keys in settings.'
            });
        }

        // --- SAFETY GUARDRAILS CHECK ---
        const guardrails = getGuardrails();
        let estimatedPrice = price || 0;
        if (!estimatedPrice) {
            try {
                const quote = await alpacaService.getQuote(symbol);
                estimatedPrice = quote.price || 0;
            } catch (e) {
                // Can't get price — guardrails will use 0 and trade size check may pass
            }
        }

        const guardrailResult = guardrails.validateTrade(
            { symbol, side: side.toLowerCase(), qty: quantity, value: quantity * estimatedPrice },
            { strategy: { confidence: req.body.confidence || 0.8 } },
            alpacaService.accountInfo || null
        );

        if (!guardrailResult.allowed) {
            console.warn(`[Finance] Trade BLOCKED by guardrails: ${guardrailResult.reason}`);
            return res.status(403).json({
                success: false,
                error: `Trade blocked: ${guardrailResult.reason}`,
                guardrails: guardrailResult.checks
            });
        }

        // --- RISK MANAGER CHECK (portfolio-level) ---
        const riskManager = global.SOMA_TRADING?.riskManager;
        if (riskManager) {
            const riskResult = await riskManager.validateTrade({
                symbol,
                side: side.toLowerCase(),
                size: quantity,
                price: estimatedPrice,
                riskRewardRatio: req.body.riskRewardRatio || null
            });

            if (!riskResult.approved) {
                const criticalViolation = riskResult.violations.find(v => v.action === 'REJECT' || v.action === 'HALT_TRADING');
                console.warn(`[Finance] Trade BLOCKED by RiskManager: ${criticalViolation?.message}`);
                return res.status(403).json({
                    success: false,
                    error: `Risk check failed: ${criticalViolation?.message}`,
                    violations: riskResult.violations
                });
            }
        }

        console.log(`[Finance] Guardrails PASSED. Executing ${side.toUpperCase()} ${quantity} ${symbol} @ ${type}`);

        // Execute order via Alpaca (with fill verification for market orders)
        const execOpts = { waitForFill: type === 'market', expectedPrice: estimatedPrice };
        if (stopLoss) execOpts.stopLoss = parseFloat(stopLoss);
        if (takeProfit) execOpts.takeProfit = parseFloat(takeProfit);

        const order = await alpacaService.executeOrder(
            symbol,
            side.toLowerCase(),
            quantity,
            type,
            'day',
            execOpts
        );

        // Record trade with guardrails for daily tracking
        guardrails.recordTrade(
            { symbol, side: side.toLowerCase(), qty: quantity, value: quantity * estimatedPrice },
            { success: true, orderId: order.id, filled_avg_price: order.filled_avg_price }
        );

        // Record slippage if we have fill data
        if (order.filled_avg_price && estimatedPrice) {
            slippageTracker.record({
                symbol,
                side: side.toLowerCase(),
                qty: quantity,
                expectedPrice: estimatedPrice,
                filledPrice: order.filled_avg_price,
                orderId: order.id,
                strategy: 'manual'
            });
        }

        // Log trade entry to SQLite for performance tracking
        try {
            const slippagePct = (order.filled_avg_price && estimatedPrice)
                ? ((order.filled_avg_price - estimatedPrice) / estimatedPrice) * 100
                : null;
            tradeLogger.logTradeEntry({
                orderId: order.id,
                symbol,
                side: side.toLowerCase(),
                qty: quantity,
                entryPrice: estimatedPrice,
                filledPrice: order.filled_avg_price || null,
                expectedPrice: estimatedPrice,
                slippagePct,
                strategy: req.body.strategy || 'manual',
                regime: req.body.regime || null
            });
        } catch (logErr) {
            console.warn('[Finance] Trade logged to broker but SQLite log failed:', logErr.message);
        }

        res.json({
            success: true,
            order: {
                id: order.id,
                symbol: order.symbol,
                side: order.side,
                quantity: order.qty,
                type: order.type,
                status: order.status,
                submitted_at: order.submitted_at,
                filled_avg_price: order.filled_avg_price,
                slippage: order.slippagePercent || null
            },
            guardrailsStatus: guardrails.getStatus(),
            message: `${side.toUpperCase()} order for ${quantity} ${symbol} submitted successfully`
        });

    } catch (error) {
        console.error('[Finance] Execution error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/finance/status
 * Get trading service status
 */
router.get('/status', (req, res) => {
    try {
        const status = alpacaService.getStatus();
        res.json({
            success: true,
            status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/finance/slippage
 * Get execution quality / slippage statistics
 */
router.get('/slippage', (req, res) => {
    try {
        const stats = slippageTracker.getStats();
        res.json({ success: true, ...stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/finance/news
 * Fetch real financial news for a symbol via Alpaca News API
 * Falls back to empty array if Alpaca not connected or unavailable
 * Query: ?symbol=BTC-USD&limit=5
 */
const HIGH_NEWS_WORDS = ['crash', 'surge', 'fed ', 'rate hike', 'inflation', 'bankrupt', 'sec ', 'halt', 'ban ', 'record high', 'record low', 'plunge', 'soar', 'spike', 'collapse', 'crisis', 'emergency', 'default'];
const LOW_NEWS_WORDS = ['update', 'announces', 'partnership', 'launches', 'quarterly earnings', 'hires', 'names ', 'appoints', 'expands'];

function classifyNewsImpact(headline) {
    const h = (headline || '').toLowerCase();
    if (HIGH_NEWS_WORDS.some(w => h.includes(w))) return 'HIGH';
    if (LOW_NEWS_WORDS.some(w => h.includes(w))) return 'LOW';
    return 'MED';
}

router.get('/news', async (req, res) => {
    const { symbol, limit = 5 } = req.query;
    if (!symbol) return res.json({ success: true, items: [] });

    // Normalize: BTC-USD → BTC/USD for Alpaca crypto news, stocks stay as-is
    const alpacaSymbol = symbol.includes('-USD')
        ? symbol.replace('-USD', '/USD')
        : symbol;

    try {
        if (alpacaService.isConnected && alpacaService.apiKey) {
            const url = `https://data.alpaca.markets/v1beta1/news?symbols=${encodeURIComponent(alpacaSymbol)}&limit=${parseInt(limit)}&sort=desc`;
            const resp = await fetch(url, {
                headers: {
                    'APCA-API-KEY-ID': alpacaService.apiKey,
                    'APCA-API-SECRET-KEY': alpacaService.secretKey
                },
                signal: AbortSignal.timeout(5000)
            });

            if (resp.ok) {
                const data = await resp.json();
                const items = (data.news || []).map(n => ({
                    time: new Date(n.created_at).toLocaleTimeString(),
                    source: (n.source || 'ALPACA NEWS').toUpperCase().slice(0, 16),
                    headline: n.headline,
                    url: n.url || null,
                    impact: classifyNewsImpact(n.headline)
                }));
                return res.json({ success: true, items });
            }
        }
    } catch (e) {
        console.warn('[Finance/News] Alpaca news unavailable:', e.message);
    }

    res.json({ success: true, items: [] });
});

export default router;
