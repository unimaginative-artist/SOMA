/**
 * Finance Routes - General trading analysis and execution
 * Powered by SOMA's FinanceAgentArbiter (Real AI Swarm)
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import alpacaService from './AlpacaService.js';
import { FinanceAgentArbiter } from '../../arbiters/FinanceAgentArbiter.js';
import TradingGuardrails from './TradingGuardrails.js';
import slippageTracker from './SlippageTracker.js';
import tradeLogger from './TradeLogger.js';
import marketDataService from './marketDataService.js';
import opportunityScanner from './OpportunityScanner.js';
import binanceService from './BinanceService.js';
import marketEvidenceStore from './MarketEvidenceStore.js';
import blueskeyClient from '../social/BlueskeyClient.js';
import excelOperator from './excelOperator.js';


const router = express.Router();
const MARKET_LAB_DIR = path.join(process.cwd(), 'data', 'market-lab');
const MARKET_LAB_LEDGER_PATH = path.join(MARKET_LAB_DIR, 'strategy-ledger.json');
const DEEP_SCAN_LEDGER_PATH = path.join(MARKET_LAB_DIR, 'deep-scan-ledger.json');

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

function compactDeepScanContext(body = {}) {
    const context = body.context && typeof body.context === 'object' ? body.context : {};
    const chartData = Array.isArray(body.chartData) ? body.chartData : [];
    const recentBars = chartData.slice(-30).map(bar => ({
        timestamp: bar.timestamp || bar.time || null,
        open: Number(bar.open ?? bar.o ?? 0),
        high: Number(bar.high ?? bar.h ?? 0),
        low: Number(bar.low ?? bar.l ?? 0),
        close: Number(bar.close ?? bar.c ?? bar.price ?? 0),
        volume: Number(bar.volume ?? bar.v ?? 0)
    }));
    return {
        activeProtocol: body.activeProtocol || context.activeProtocol || null,
        assetType: body.assetType || context.assetType || null,
        rangeId: body.rangeId || context.rangeId || null,
        dataSource: body.dataSource || context.dataSource || null,
        ticker: body.tickerData ? {
            price: body.tickerData.price,
            change: body.tickerData.change,
            changePercent: body.tickerData.changePercent,
            momentum: body.tickerData.momentum,
            sentiment: body.tickerData.sentiment
        } : null,
        risk: body.riskMetrics ? {
            equity: body.riskMetrics.equity,
            dailyPnL: body.riskMetrics.dailyPnL,
            dailyDrawdown: body.riskMetrics.dailyDrawdown,
            maxDrawdown: body.riskMetrics.maxDrawdown,
            activeTier: body.riskMetrics.activeTier
        } : null,
        presets: Array.isArray(body.presets)
            ? body.presets.slice(0, 12).map(preset => ({
                id: preset.id,
                name: preset.name,
                active: preset.active,
                allocation: preset.allocation,
                confidence: preset.confidence
            }))
            : [],
        recentBars
    };
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
 * POST /api/finance/deep-scan
 * Real multi-source market scan for Mission Control.
 *
 * Pulls:
 * - multi-timeframe market bars + quality
 * - orderbook pressure for crypto where available
 * - Alpaca news where connected
 * - opportunity scanner context across the asset universe
 * - SOMA finance swarm synthesis when available
 */
router.post('/deep-scan', async (req, res) => {
    const startedAt = Date.now();
    try {
        let { symbol } = req.body;
        if (!symbol || symbol === 'ALL' || symbol === 'SCAN' || symbol === 'NONE' || symbol === 'undefined' || symbol === 'null') {
            console.log('[Finance/DeepScan] No asset selected. Scanning full market (Stocks, Crypto, Futures)...');
            const cryptoOpportunities = await opportunityScanner.scan('CRYPTO').catch(() => []);
            const stockOpportunities = await opportunityScanner.scan('STOCKS').catch(() => []);
            const futuresUniverse = ['ES', 'NQ', 'CL'];
            const futuresPromises = futuresUniverse.map(async (fSym) => {
                try {
                    const bars = await marketDataService.getBars(fSym, '15Min', 50);
                    if (!bars || bars.length < 30) return null;
                    const score = opportunityScanner._calculateScore(bars);
                    const suggestedStrategy = opportunityScanner._suggestStrategy(score, bars);
                    return {
                        symbol: fSym,
                        score: score.total,
                        metrics: score.metrics,
                        strategy: suggestedStrategy,
                        price: bars[bars.length - 1].close,
                        change24h: ((bars[bars.length - 1].close - bars[0].close) / bars[0].close) * 100
                    };
                } catch {
                    return null;
                }
            });
            const futuresOpportunities = (await Promise.all(futuresPromises)).filter(Boolean);
            const allOpportunities = [
                ...cryptoOpportunities,
                ...stockOpportunities,
                ...futuresOpportunities
            ];
            if (allOpportunities.length > 0) {
                allOpportunities.sort((a, b) => (b.score || 0) - (a.score || 0));
                symbol = allOpportunities[0].symbol;
                console.log(`[Finance/DeepScan] Selected best overall opportunity: ${symbol} (Score: ${allOpportunities[0].score})`);
            } else {
                symbol = 'BTC-USD';
                console.log('[Finance/DeepScan] Opportunity scanner returned no results. Falling back to BTC-USD.');
            }
        }

        const sym = String(symbol).toUpperCase();
        const requestContext = compactDeepScanContext(req.body || {});
        const rateCheck = checkAnalysisRateLimit(req.ip, `deep:${sym}`);
        if (!rateCheck.allowed) {
            return res.status(429).json({ success: false, error: rateCheck.reason });
        }

        const frames = [
            { id: 'intraday', timeframe: '5Min', limit: 96 },
            { id: 'swing', timeframe: '1H', limit: 120 },
            { id: 'macro', timeframe: '1D', limit: 180 }
        ];

        const frameResults = await Promise.allSettled(
            frames.map(async frame => {
                const bars = await marketDataService.getBars(sym, frame.timeframe, frame.limit);
                return {
                    ...frame,
                    bars,
                    summary: summarizeBars(bars),
                    quality: marketDataService.validateDataQuality(
                        bars,
                        frame.timeframe === '1D'
                            ? 3 * 24 * 60 * 60 * 1000
                            : frame.timeframe === '1H'
                                ? 6 * 60 * 60 * 1000
                                : 45 * 60 * 1000
                    )
                };
            })
        );

        const timeframes = {};
        frameResults.forEach((result, index) => {
            const frame = frames[index];
            if (result.status === 'fulfilled') {
                timeframes[frame.id] = result.value;
            } else {
                timeframes[frame.id] = {
                    ...frame,
                    bars: [],
                    summary: null,
                    quality: { valid: false, issues: [result.reason?.message || 'Data unavailable'] }
                };
            }
        });

        const latestBars = timeframes.intraday?.bars?.length ? timeframes.intraday.bars : timeframes.swing?.bars || [];
        const latestPrice = latestBars.at(-1)?.close || null;

        let orderbook = null;
        if (isCryptoSymbol(sym)) {
            try {
                const book = await binanceService.getOrderBook(toBinanceSymbol(sym), 20);
                const metrics = binanceService.calculateOrderBookMetrics(book);
                orderbook = {
                    bidLevels: book.bids?.slice(0, 5) || [],
                    askLevels: book.asks?.slice(0, 5) || [],
                    metrics
                };
            } catch (e) {
                orderbook = { error: e.message };
            }
        }

        const [newsItems, opportunities] = await Promise.all([
            fetchNewsItems(sym, 6),
            opportunityScanner.scan(isCryptoSymbol(sym) ? 'CRYPTO' : 'STOCKS')
        ]);

        const matchingOpportunity = opportunities.find(o => o.symbol === sym) || null;
        const marketLabContext = getMarketLabContext(sym);
        const previousDeepScans = getDeepScanContext(sym);
        const intraday = timeframes.intraday?.summary;
        const swing = timeframes.swing?.summary;
        const macro = timeframes.macro?.summary;
        const highImpactNews = newsItems.filter(item => item.impact === 'HIGH').length;
        const volumeAnomaly = intraday?.volumeRatio ? intraday.volumeRatio >= 1.4 : false;
        const alignmentScore = [intraday, swing, macro]
            .filter(Boolean)
            .reduce((score, tf) => score + (tf.direction === 'bullish' ? 1 : tf.direction === 'bearish' ? -1 : 0), 0);
        const orderbookAvailable = !!orderbook?.metrics && !orderbook?.error;
        const orderbookPressure = orderbookAvailable ? Number(orderbook.metrics.imbalance || 0) : 0;

        const altSignals = [
            {
                label: 'Volume anomaly',
                state: volumeAnomaly ? 'ACTIVE' : 'NORMAL',
                detail: intraday?.volumeRatio != null ? `${intraday.volumeRatio.toFixed(2)}x recent baseline` : 'No volume baseline'
            },
            {
                label: 'Orderbook pressure',
                state: orderbookAvailable ? (orderbookPressure > 0.08 ? 'BID STACKED' : orderbookPressure < -0.08 ? 'ASK STACKED' : 'BALANCED') : (orderbook?.error ? 'ERROR' : 'N/A'),
                detail: orderbookAvailable ? `${(orderbookPressure * 100).toFixed(1)}% imbalance` : (orderbook?.error || 'Not available for this asset')
            },
            {
                label: 'News impact',
                state: highImpactNews > 0 ? 'HIGH' : newsItems.length ? 'LOW/MED' : 'QUIET',
                detail: newsItems.length ? `${newsItems.length} headlines, ${highImpactNews} high impact` : 'No connected headline feed returned items'
            },
            {
                label: 'Universe rank',
                state: matchingOpportunity ? `SCORE ${matchingOpportunity.score}` : 'UNRANKED',
                detail: matchingOpportunity
                    ? `${matchingOpportunity.strategy}; ${matchingOpportunity.change24h?.toFixed?.(2) ?? matchingOpportunity.change24h}% change`
                    : 'Not in current top opportunity set'
            },
            {
                label: 'Simulation memory',
                state: marketLabContext.best ? `SIM ${Number(marketLabContext.best.prometheusScore || 0).toFixed(3)}` : 'NO MATCH',
                detail: marketLabContext.best
                    ? `${marketLabContext.best.strategy?.name || marketLabContext.best.strategy?.id} ${marketLabContext.best.status}; ${((marketLabContext.best.metrics?.winRate || 0) * 100).toFixed(1)}% WR`
                    : 'No market simulation evidence matched this symbol yet'
            },
            {
                label: 'Prior deep scans',
                state: previousDeepScans.count ? `${previousDeepScans.count} STORED` : 'FIRST SCAN',
                detail: previousDeepScans.latest
                    ? `${previousDeepScans.latest.verdict?.recommendation || 'scan'} at ${Math.round((previousDeepScans.latest.verdict?.confidence || 0) * 100)}%`
                    : 'This scan will seed future simulation context'
            }
        ];

        const deterministicRecommendation = (() => {
            let score = 0.5;
            score += alignmentScore * 0.08;
            if (volumeAnomaly) score += 0.06;
            score += Math.max(-0.08, Math.min(0.08, orderbookPressure * 0.2));
            if (highImpactNews > 0) score -= 0.03;
            const confidence = Math.max(0.15, Math.min(0.92, score));
            const recommendation = confidence >= 0.62 ? 'BUY WATCH'
                : confidence <= 0.38 ? 'SELL WATCH'
                    : 'HOLD / WAIT';
            return {
                recommendation,
            confidence,
            rationale: `Timeframe alignment ${alignmentScore}; volume ${volumeAnomaly ? 'above baseline' : 'normal'}; orderbook ${orderbookAvailable ? 'observed' : 'unavailable'}; news ${highImpactNews ? 'contains high-impact items' : 'quiet/normal'}; simulation memory ${marketLabContext.best ? 'matched' : 'not yet available'}.`
        };
        })();

        const marketDataEvidence = marketEvidenceStore.append('market_data', {
            symbol: sym,
            timeframes: Object.fromEntries(Object.entries(timeframes).map(([key, value]) => [
                key,
                { timeframe: value.timeframe, summary: value.summary, quality: value.quality }
            ])),
            orderbook: orderbook?.metrics || null,
            newsCount: newsItems.length,
            opportunity: matchingOpportunity,
            requestContext
        }, { source: 'FinanceDeepScan', symbol: sym });

        let swarmAnalysis = null;
        try {
            const arbiter = await getFinanceArbiter();
            const fullAnalysis = await arbiter.analyzeStock(sym);
            swarmAnalysis = {
                thesis: fullAnalysis.thesis || null,
                quant: fullAnalysis.quant || null,
                risk: fullAnalysis.risk || null,
                sentiment: fullAnalysis.sentiment || null,
                strategy: fullAnalysis.strategy || null,
                debate: fullAnalysis.debate || null
            };
        } catch (e) {
            console.warn('[Finance/DeepScan] Swarm synthesis unavailable:', e.message);
        }

        // ── Active Protocol (Strategy Preset) Selection ──────────────────────────
        const recommendedActiveProtocol = (() => {
            if (marketLabContext?.best?.strategy?.id) {
                return {
                    id: marketLabContext.best.strategy.id,
                    name: marketLabContext.best.strategy.name,
                    source: 'Simulation Ledger Champion',
                    score: marketLabContext.best.prometheusScore,
                    reason: `This protocol achieved the highest Prometheus score (${(marketLabContext.best.prometheusScore * 100).toFixed(1)}%) in background Monte Carlo trials.`
                };
            }
            const vol = intraday?.volatilityPct || 0;
            const rsiVal = intraday?.rsi || 50;
            if (vol > 0.025) {
                return {
                    id: 'full_aggression',
                    name: 'Full Aggression',
                    source: 'Technical Volatility Fit',
                    score: 0.75,
                    reason: `High volatility (${(vol * 100).toFixed(2)}% intraday) fits momentum-based breakout posture.`
                };
            } else if (rsiVal < 35 || rsiVal > 65) {
                return {
                    id: 'swarm_architecture',
                    name: 'Swarm Architecture',
                    source: 'Technical Confluence Fit',
                    score: 0.78,
                    reason: `Overextended RSI (${rsiVal.toFixed(1)}) benefits from ensemble consensus voting across reversion and trend signals.`
                };
            } else {
                return {
                    id: 'standard_portfolio',
                    name: 'Standard Portfolio',
                    source: 'Technical Default Fit',
                    score: 0.72,
                    reason: `Normal market conditions fit a balanced trend and hedge allocation strategy.`
                };
            }
        })();

        // ── Bluesky Social Intel RAG ──────────────────────────────────────────
        let socialIntel = "No social feed data resolved.";
        let blueskySentiment = null;
        if (blueskeyClient && blueskeyClient.configured) {
            try {
                console.log(`[Finance/DeepScan] RAG: Querying Bluesky for "${sym}" social sentiment...`);
                const searchResults = await blueskeyClient.searchPosts(sym, 15).catch(() => []);
                let postsToProcess = searchResults || [];
                if (postsToProcess.length === 0) {
                    const cleanSym = sym.replace('-USD', '').replace('USDT', '');
                    const searchResults2 = await blueskeyClient.searchPosts(cleanSym, 15).catch(() => []);
                    postsToProcess = searchResults2 || [];
                }
                if (postsToProcess.length > 0) {
                    const posts = postsToProcess.map(p => `@${p.author?.handle || 'user'}: ${p.text || ''}`);
                    socialIntel = posts.join('\n---\n');
                    console.log(`[Finance/DeepScan] RAG: Retrieved ${postsToProcess.length} posts from Bluesky.`);
                    
                    const brain = global.SOMA?.quadBrain;
                    if (brain) {
                        const ragPrompt = `You are SOMA's Social Sentiment Arbiter.
Below is the real-time social feed data (RAG'd from Bluesky) regarding the asset: ${sym}.

SOCIAL FEED CONTENT:
${socialIntel}

MARKET SUMMARY:
Asset: ${sym}
Last Price: ${latestPrice}
Intraday change: ${intraday?.changePct != null ? `${intraday.changePct}%` : 'unknown'}
Timeframe alignment: ${alignmentScore}
Recommended Protocol: ${recommendedActiveProtocol.name}

TASK:
Analyze the social sentiment and market backdrop. Distill this information into a precise set of trading options/verdicts (e.g. Bullish breakout option, Bearish hedging option, or Range play option).
Provide:
1. Social Sentiment summary (bullish/bearish/neutral, volume of discussion).
2. Distilled trading options (how to trade this sentiment with entry, target, and risk guidelines).
Keep it concise and highly actionable for SOMA's trading playbook. Output in structured clear paragraphs. Do NOT include markdown code blocks or json, just plain structured markdown text.`;
                        
                        const ragResult = await brain.reason(ragPrompt, 'logos').catch(() => null);
                        if (ragResult) {
                            blueskySentiment = {
                                queryUsed: sym,
                                postsProcessed: postsToProcess.length,
                                distilledOptions: ragResult.response || ragResult.text
                            };
                        }
                    }
                }
            } catch (e) {
                console.warn('[Finance/DeepScan] Failed to RAG Bluesky posts:', e.message);
            }
        }

        const analysis = {
            thesis: (swarmAnalysis?.thesis || `${sym} deep scan completed across intraday, swing, and macro bars. ${deterministicRecommendation.rationale}`) +
                    `\n\n[Active Protocol Recommendation]: ${recommendedActiveProtocol.name} (${recommendedActiveProtocol.reason})` +
                    (blueskySentiment ? `\n\n[Bluesky Social RAG Option]: ${blueskySentiment.distilledOptions}` : ''),
            blueskySentiment,
            quant: {
                strategy: matchingOpportunity?.strategy || 'Multi-timeframe real-data scan',
                technical_indicators: {
                    intraday_rsi: intraday?.rsi,
                    swing_rsi: swing?.rsi,
                    macro_rsi: macro?.rsi,
                    volume_ratio: intraday?.volumeRatio,
                    volatility_pct: intraday?.volatilityPct
                },
                backtest_results: {
                    opportunity_score: matchingOpportunity?.score || null,
                    timeframe_alignment: alignmentScore
                }
            },
            risk: {
                score: Math.round((1 - Math.min(0.9, intraday?.volatilityPct || 0) / 0.9) * 100),
                max_drawdown_limit: 'Use active guardrails',
                position_size_recommendation: deterministicRecommendation.confidence >= 0.62 ? 'Small paper probe only' : 'No new entry until gate clears',
                notes: timeframes.intraday?.quality?.valid ? 'Market data quality passed for active intraday frame.' : timeframes.intraday?.quality?.issues?.join('; ')
            },
            sentiment: {
                score: highImpactNews ? 0.45 : 0.5 + Math.max(-0.15, Math.min(0.15, alignmentScore * 0.05)),
                label: highImpactNews ? 'Event-sensitive' : 'Data-led neutral',
                social_volume: newsItems.length ? `${newsItems.length} connected headlines` : 'No headline feed'
            },
            strategy: swarmAnalysis?.strategy ? {
                recommendation: swarmAnalysis.strategy.recommendation || deterministicRecommendation.recommendation,
                confidence: swarmAnalysis.strategy.confidence || deterministicRecommendation.confidence,
                rationale: swarmAnalysis.strategy.rationale || deterministicRecommendation.rationale,
                entry_price: latestPrice,
                stop_loss: swarmAnalysis.strategy.action_plan?.stop_loss || null,
                take_profit: swarmAnalysis.strategy.action_plan?.target || null,
                recommendedActiveProtocol
            } : {
                ...deterministicRecommendation,
                entry_price: latestPrice,
                stop_loss: null,
                take_profit: null,
                recommendedActiveProtocol
            },
            debate: swarmAnalysis?.debate || null,
            duration: Date.now() - startedAt,
            deepScan: {
                sources: [
                    'SOMA marketDataService bars',
                    isCryptoSymbol(sym) ? 'Binance orderbook' : 'Alpaca/Yahoo stock bars',
                    'OpportunityScanner universe ranking',
                    newsItems.length ? 'Alpaca News' : 'News feed quiet/unavailable'
                ],
                timeframes: Object.fromEntries(Object.entries(timeframes).map(([key, value]) => [
                    key,
                    { timeframe: value.timeframe, summary: value.summary, quality: value.quality }
                ])),
                orderbook,
                news: newsItems,
                altSignals,
                requestContext,
                opportunities: opportunities.slice(0, 5),
                marketSimulation: {
                    context: marketLabContext,
                    previousDeepScans
                }
            }
        };

        const scanRecord = {
            id: `deep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            parentEvidenceIds: [marketDataEvidence.evidenceId],
            symbol: sym,
            marketLabSymbol: marketLabContext.best?.asset?.symbol || sym.replace('-USD', ''),
            createdAt: new Date().toISOString(),
            verdict: {
                recommendation: analysis.strategy.recommendation,
                confidence: analysis.strategy.confidence,
                rationale: analysis.strategy.rationale
            },
            quality: Object.fromEntries(Object.entries(analysis.deepScan.timeframes).map(([key, value]) => [
                key,
                { valid: value.quality?.valid, issues: value.quality?.issues || [] }
            ])),
            altSignals,
            simulationContext: {
                matchedRuns: marketLabContext.count,
                bestStrategy: marketLabContext.best ? {
                    id: marketLabContext.best.strategy?.id,
                    name: marketLabContext.best.strategy?.name,
                    status: marketLabContext.best.status,
                    prometheusScore: marketLabContext.best.prometheusScore,
                    winRate: marketLabContext.best.metrics?.winRate,
                    averageDollarPnl: marketLabContext.best.paperAccount?.averageDollarPnl ?? marketLabContext.best.metrics?.averageDollarPnl
                } : null
            },
            marketSnapshot: {
                price: latestPrice,
                intraday,
                swing,
                macro,
                orderbook: orderbook?.metrics || null,
                newsCount: newsItems.length
            },
            requestContext
        };
        const evidence = marketEvidenceStore.append('deep_scan', scanRecord, {
            source: 'FinanceDeepScan',
            symbol: sym,
            strategyId: requestContext.activeProtocol || matchingOpportunity?.strategy || analysis.strategy?.recommendation || null,
            parentEvidenceIds: [marketDataEvidence.evidenceId]
        });
        scanRecord.evidenceId = evidence.evidenceId;
        recordDeepScan(scanRecord);
        analysis.deepScan.feedbackRecord = scanRecord;
        analysis.deepScan.evidenceId = evidence.evidenceId;

        res.json({
            success: true,
            symbol: sym,
            timestamp: new Date().toISOString(),
            analysis
        });
    } catch (error) {
        console.error('[Finance] Deep scan error:', error);
        res.status(500).json({ success: false, error: error.message });
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
                strategy: 'manual',
                venue: alpacaService.isPaperTrading !== false ? 'alpaca_paper' : 'live'
            });
        }

        // Log trade entry to SQLite for performance tracking
        try {
            const slippagePct = (order.filled_avg_price && estimatedPrice)
                ? ((order.filled_avg_price - estimatedPrice) / estimatedPrice) * 100
                : null;
            const isPaperBroker = alpacaService.isPaperTrading !== false;
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
                regime: req.body.regime || null,
                evidenceType: isPaperBroker ? 'paper_trade' : 'manual_broker_order',
                mode: isPaperBroker ? 'paper' : 'broker',
                broker: 'alpaca'
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
router.get('/status', async (req, res) => {
    try {
        const alpacaStatus = alpacaService.getStatus();
        const financeAgent = await getFinanceArbiter();
        const agentStatus = financeAgent ? financeAgent.getStatus() : { active: false };

        res.json({
            success: true,
            alpaca: alpacaStatus,
            agent: agentStatus
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
/**
 * GET /api/finance/slippage
 * Get execution quality / slippage statistics
 */
router.get('/slippage', (req, res) => {
    try {
        const stats = slippageTracker.getStats();
        const paperModelCalibration = slippageTracker.calibrationVsPaperModel();
        res.json({ success: true, ...stats, paperModelCalibration });
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

const isCryptoSymbol = (symbol = '') => symbol.includes('-USD') || symbol.toUpperCase().endsWith('USDT');

const toBinanceSymbol = (symbol = '') => {
    const upper = symbol.toUpperCase();
    if (upper.endsWith('USDT')) return upper;
    if (upper.includes('-USD')) return upper.replace('-USD', 'USDT');
    if (upper.includes('-')) return upper.replace('-', '') + 'USDT';
    return `${upper}USDT`;
};

const marketLabSymbolAliases = (symbol = '') => {
    const upper = symbol.toUpperCase();
    const base = upper.replace('-USD', '').replace('USDT', '');
    const aliases = new Set([upper, base]);
    if (base === 'BTC') aliases.add('BTC-USD');
    if (base === 'ETH') aliases.add('ETH-USD');
    if (base === 'SOL') aliases.add('SOL-USD');
    return aliases;
};

function readJsonArray(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeJsonArray(filePath, entries, limit = 500) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(entries.slice(0, limit), null, 2), 'utf8');
}

function getMarketLabContext(symbol) {
    const aliases = marketLabSymbolAliases(symbol);
    const entries = readJsonArray(MARKET_LAB_LEDGER_PATH)
        .filter(entry => aliases.has(String(entry.asset?.symbol || entry.symbol || '').toUpperCase()))
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    const best = [...entries].sort((a, b) => (b.prometheusScore || 0) - (a.prometheusScore || 0))[0] || null;
    return {
        count: entries.length,
        latest: entries[0] || null,
        best,
        recent: entries.slice(0, 5).map(entry => ({
            id: entry.id,
            status: entry.status,
            symbol: entry.asset?.symbol || entry.symbol,
            strategy: entry.strategy?.name || entry.strategy?.id,
            prometheusScore: entry.prometheusScore,
            winRate: entry.metrics?.winRate,
            sharpe: entry.metrics?.sharpe,
            averageDollarPnl: entry.paperAccount?.averageDollarPnl ?? entry.metrics?.averageDollarPnl,
            updatedAt: entry.updatedAt || entry.createdAt
        }))
    };
}

function getDeepScanContext(symbol) {
    const aliases = marketLabSymbolAliases(symbol);
    const entries = readJsonArray(DEEP_SCAN_LEDGER_PATH)
        .filter(entry => aliases.has(String(entry.symbol || '').toUpperCase()) || aliases.has(String(entry.marketLabSymbol || '').toUpperCase()))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return {
        count: entries.length,
        latest: entries[0] || null,
        recent: entries.slice(0, 8)
    };
}

function recordDeepScan(entry) {
    const entries = readJsonArray(DEEP_SCAN_LEDGER_PATH);
    entries.unshift(entry);
    writeJsonArray(DEEP_SCAN_LEDGER_PATH, entries, 500);
}

const pct = (value, base) => base ? (value / base) * 100 : 0;

function calculateRsi(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function summarizeBars(bars = []) {
    if (!bars.length) return null;
    const first = bars[0];
    const last = bars[bars.length - 1];
    const closes = bars.map(b => Number(b.close)).filter(Number.isFinite);
    const recent = bars.slice(-20);
    const older = bars.slice(-60, -20);
    const recentVolume = recent.reduce((sum, b) => sum + Number(b.volume || 0), 0) / Math.max(recent.length, 1);
    const olderVolume = older.length
        ? older.reduce((sum, b) => sum + Number(b.volume || 0), 0) / older.length
        : recentVolume;
    const ranges = recent.map(b => Number(b.high || b.close) - Number(b.low || b.close));
    const avgRange = ranges.reduce((sum, r) => sum + r, 0) / Math.max(ranges.length, 1);
    const changePct = pct(last.close - first.close, first.close);
    const rsi = calculateRsi(closes);
    const volumeRatio = olderVolume > 0 ? recentVolume / olderVolume : 1;
    const volatilityPct = pct(avgRange, last.close);
    const direction = changePct > 0.35 ? 'bullish' : changePct < -0.35 ? 'bearish' : 'sideways';

    return {
        bars: bars.length,
        price: Number(last.close),
        changePct: Number(changePct.toFixed(3)),
        rsi: rsi == null ? null : Number(rsi.toFixed(2)),
        volumeRatio: Number(volumeRatio.toFixed(3)),
        volatilityPct: Number(volatilityPct.toFixed(3)),
        direction,
        lastTimestamp: last.timestamp || null
    };
}

async function fetchNewsItems(symbol, limit = 6) {
    const alpacaSymbol = symbol.includes('-USD') ? symbol.replace('-USD', '/USD') : symbol;
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
                return (data.news || []).map(n => ({
                    time: n.created_at,
                    source: (n.source || 'ALPACA NEWS').toUpperCase().slice(0, 18),
                    headline: n.headline,
                    url: n.url || null,
                    impact: classifyNewsImpact(n.headline)
                }));
            }
        }
    } catch (e) {
        console.warn('[Finance/DeepScan] News unavailable:', e.message);
    }
    return [];
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

// -- Guarded Excel Operator Endpoints --

router.post('/excel/analyze', async (req, res) => {
    try {
        const { filePath, targetVariance } = req.body || {};
        if (!filePath) {
            return res.status(400).json({ success: false, error: 'filePath is required' });
        }
        const resolvedPath = await excelOperator.resolveWorkbook(filePath);
        const result = await excelOperator.analyzeAndLocateVariance(resolvedPath, targetVariance);
        res.json({ success: true, resolvedPath, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/excel/propose', async (req, res) => {
    try {
        const { filePath, sheetName, cellAddr, actionType, actionPayload } = req.body || {};
        if (!filePath || !sheetName || !cellAddr || !actionType || !actionPayload) {
            return res.status(400).json({ success: false, error: 'filePath, sheetName, cellAddr, actionType, and actionPayload are required' });
        }
        const resolvedPath = await excelOperator.resolveWorkbook(filePath);
        // By default, work on a backup copy
        const workingCopy = await excelOperator.createWorkingCopy(resolvedPath);
        const receipt = await excelOperator.proposeModification(workingCopy, sheetName, cellAddr, actionType, actionPayload);
        res.json({ success: true, workingCopy, receipt });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/excel/execute', async (req, res) => {
    try {
        const { filePath, sheetName, cellAddr, actionType, actionPayload } = req.body || {};
        if (!filePath || !sheetName || !cellAddr || !actionType || !actionPayload) {
            return res.status(400).json({ success: false, error: 'filePath, sheetName, cellAddr, actionType, and actionPayload are required' });
        }
        const resolvedPath = await excelOperator.resolveWorkbook(filePath);
        const success = await excelOperator.executeModification(resolvedPath, sheetName, cellAddr, actionType, actionPayload);
        res.json({ success });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/excel/open', async (req, res) => {
    try {
        const { filePath, sheetName, cellAddr } = req.body || {};
        if (!filePath) {
            return res.status(400).json({ success: false, error: 'filePath is required' });
        }
        const resolvedPath = await excelOperator.resolveWorkbook(filePath);
        const result = await excelOperator.openInExcel(resolvedPath, sheetName, cellAddr);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
