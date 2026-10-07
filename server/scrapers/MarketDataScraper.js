/**
 * server/scrapers/MarketDataScraper.js
 *
 * SOMA's market data pipeline.
 *
 * Primary:   scripts/market_bridge.py  (yfinance — real quotes, history, news, WSB)
 * Fallback:  CoinGecko + Yahoo Finance REST + Puppeteer CoinDesk/Reuters
 *
 * Cache: 60s in-memory. Always returns data — never a hard error to callers.
 */

import { spawn } from 'child_process';
import puppeteer from 'puppeteer';
import path from 'path';

const BRIDGE_SCRIPT = path.join(process.cwd(), 'scripts', 'market_bridge.py');
const CACHE_TTL_MS  = 60_000;
const HISTORY_TTL_MS = 4 * 60 * 60 * 1000; // 4h — historical data doesn't change much

let _cache    = null;
let _cacheTs  = 0;
let _scraping = false;

// Historical OHLCV cache per symbol
const _historyCache = new Map();   // symbol → { data, ts }

// ── Python bridge helper ──────────────────────────────────────────────────

function runBridge(args, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const errChunks = [];
        const proc = spawn('python', [BRIDGE_SCRIPT, ...args], {
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
        proc.stdout.on('data', d => chunks.push(d));
        proc.stderr.on('data', d => errChunks.push(d));
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`market_bridge.py timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        proc.on('close', code => {
            clearTimeout(timer);
            const out = Buffer.concat(chunks).toString('utf8').trim();
            if (!out) {
                const err = Buffer.concat(errChunks).toString('utf8').trim();
                return reject(new Error(`bridge exited ${code}: ${err.slice(0, 200)}`));
            }
            try {
                resolve(JSON.parse(out));
            } catch (e) {
                reject(new Error(`bridge JSON parse error: ${out.slice(0, 200)}`));
            }
        });
        proc.on('error', err => { clearTimeout(timer); reject(err); });
    });
}

// ── Primary: yfinance bridge ───────────────────────────────────────────────

async function fetchFromBridge() {
    const [quotes, wsb] = await Promise.allSettled([
        runBridge(['quotes'], 45_000),
        runBridge(['wsb'],    20_000),
    ]);

    const qData = quotes.status === 'fulfilled' ? quotes.value : null;
    const wData = wsb.status   === 'fulfilled' ? wsb.value   : null;

    if (!qData?.ok) throw new Error('quotes bridge failed');

    // Split quotes into class buckets matching ASSET_CLASSES in SimulationSuite
    const cryptoIds  = ['BTC','ETH','SOL','AVAX','LINK','DOT','UNI','AAVE'];
    const stockIds   = ['NVDA','MSFT','AAPL','META','GOOGL','AMZN','TSLA','AMD'];
    const futuresIds = ['ES','NQ','CL','GC','SI','ZB'];

    const classify = ids => Object.fromEntries(
        ids.filter(id => qData.quotes[id]).map(id => [id, qData.quotes[id]])
    );

    // Build news from yfinance for key symbols
    const newsItems = [];
    try {
        const btcNews = await runBridge(['news', 'BTC'], 15_000);
        if (btcNews.ok) {
            newsItems.push(...btcNews.articles.slice(0, 4).map(a => ({ source: a.publisher, text: a.title })));
        }
    } catch {}
    try {
        const spxNews = await runBridge(['news', 'SPY'], 15_000);
        if (spxNews.ok) {
            newsItems.push(...spxNews.articles.slice(0, 3).map(a => ({ source: a.publisher, text: a.title })));
        }
    } catch {}

    // Transform WSB
    let wsbResult = null;
    if (wData?.ok) {
        wsbResult = {
            sentiment:      wData.sentiment,
            sentimentLabel: wData.sentimentLabel,
            bullCount:      wData.bullCount,
            bearCount:      wData.bearCount,
            hotTickers:     wData.hotTickers,
            ddPosts:        wData.ddPosts,
            flowPosts:      wData.flowPosts,
            posts:          wData.topPosts,
            totalScanned:   wData.totalScanned,
        };
    }

    // Fetch options flow in parallel (non-blocking — if it fails, skip)
    let optionsData = null;
    try {
        optionsData = await _fetchOptionsBundle();
    } catch {}

    return {
        timestamp: Date.now(),
        source:    'yfinance',
        crypto:    classify(cryptoIds),
        stocks:    classify(stockIds),
        futures:   classify(futuresIds),
        wsb:       wsbResult,
        news:      newsItems,
        options:   optionsData,
    };
}

// ── Fallback: CoinGecko + Yahoo Finance REST ──────────────────────────────

async function fetchFallbackJson(url, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOMA/1.0)' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchFallback() {
    const [coinGecko, spxNews] = await Promise.allSettled([
        fetchFallbackJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,avalanche-2&vs_currencies=usd&include_24hr_change=true'),
        fetch('https://www.reddit.com/r/wallstreetbets/hot.json?limit=25', {
            headers: { 'User-Agent': 'SOMA-SimBot/1.0' },
            signal: AbortSignal.timeout(8000),
        }).then(r => r.json()),
    ]);

    const cg = coinGecko.status === 'fulfilled' ? coinGecko.value : null;
    const wsb = spxNews.status === 'fulfilled' ? spxNews.value : null;

    const crypto = cg ? {
        BTC:  { price: cg['bitcoin']?.usd,     change24h: cg['bitcoin']?.usd_24h_change },
        ETH:  { price: cg['ethereum']?.usd,    change24h: cg['ethereum']?.usd_24h_change },
        SOL:  { price: cg['solana']?.usd,      change24h: cg['solana']?.usd_24h_change },
        AVAX: { price: cg['avalanche-2']?.usd, change24h: cg['avalanche-2']?.usd_24h_change },
    } : null;

    let wsbResult = null;
    if (wsb?.data?.children) {
        const posts = wsb.data.children.map(p => p.data).filter(p => !p.stickied);
        const bulls = posts.filter(p => /moon|call|bull|buy|yolo/i.test(p.title)).length;
        const bears = posts.filter(p => /puts|short|crash|bear|dump/i.test(p.title)).length;
        const total = bulls + bears || 1;
        wsbResult = {
            sentiment: bulls / total,
            sentimentLabel: bulls / total > 0.6 ? 'BULLISH' : bulls / total < 0.4 ? 'BEARISH' : 'NEUTRAL',
            bullCount: bulls, bearCount: bears,
            posts: posts.slice(0, 5).map(p => ({ title: p.title, score: p.score })),
        };
    }

    return { timestamp: Date.now(), source: 'fallback', crypto, wsb: wsbResult, news: [], stocks: null, futures: null };
}

// ── Historical OHLCV (for SimulationEvaluator backtesting) ────────────────

export async function fetchHistoricalOHLCV(symbol) {
    const cached = _historyCache.get(symbol);
    if (cached && (Date.now() - cached.ts) < HISTORY_TTL_MS) return cached.data;

    try {
        const result = await runBridge(['history', symbol], 30_000);
        if (!result.ok || !result.rows?.length) {
            if (process.env.SOMA_MARKET_HISTORY_VERBOSE === 'true') {
                console.warn(`[MarketDataScraper] no historical rows for ${symbol}`);
            }
            return null;
        }
        const data = result.rows;
        _historyCache.set(symbol, { data, ts: Date.now() });
        return data;
    } catch (e) {
        console.warn(`[MarketDataScraper] history failed for ${symbol}:`, e.message);
        return null;
    }
}

// ── Options flow (put/call ratio + unusual activity) ─────────────────────

const OPTIONS_SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL'];
const _optionsCache = new Map();
const OPTIONS_TTL_MS = 10 * 60 * 1000;

export async function fetchOptionsData(symbol) {
    const cached = _optionsCache.get(symbol);
    if (cached && (Date.now() - cached.ts) < OPTIONS_TTL_MS) return cached.data;
    try {
        const result = await runBridge(['options', symbol], 20_000);
        if (!result.ok) throw new Error(result.error || 'options bridge failed');
        _optionsCache.set(symbol, { data: result, ts: Date.now() });
        return result;
    } catch (e) {
        console.warn(`[MarketDataScraper] options failed for ${symbol}:`, e.message);
        return null;
    }
}

async function _fetchOptionsBundle() {
    const results = {};
    for (const sym of OPTIONS_SYMBOLS) {
        try {
            const data = await fetchOptionsData(sym);
            if (data?.ok) results[sym] = data;
        } catch {}
        await new Promise(r => setTimeout(r, 400));
    }
    return Object.keys(results).length ? results : null;
}

// ── WSB deep scan (standalone) ────────────────────────────────────────────

export async function fetchWSBDeepScan() {
    try {
        const result = await runBridge(['wsb'], 20_000);
        if (!result.ok) throw new Error('wsb bridge failed');
        return result;
    } catch (e) {
        console.warn('[MarketDataScraper] WSB deep scan failed:', e.message);
        return null;
    }
}

// ── Main scrape ────────────────────────────────────────────────────────────

export async function scrapeMarketData() {
    if (_cache && (Date.now() - _cacheTs) < CACHE_TTL_MS) {
        return { ..._cache, cached: true };
    }
    if (_scraping) {
        return _cache ? { ..._cache, cached: true, pending: true } : null;
    }
    _scraping = true;

    try {
        console.log('[MarketDataScraper] Fetching market data via yfinance bridge...');
        const result = await fetchFromBridge();
        _cache  = result;
        _cacheTs = Date.now();
        console.log(`[MarketDataScraper] Done — BTC: $${result.crypto?.BTC?.price?.toFixed(0)} | NVDA: $${result.stocks?.NVDA?.price?.toFixed(2)} | WSB: ${result.wsb?.sentimentLabel}`);
        return result;
    } catch (e) {
        console.warn('[MarketDataScraper] Bridge failed, trying fallback:', e.message);
        try {
            const result = await fetchFallback();
            _cache  = result;
            _cacheTs = Date.now();
            return result;
        } catch (e2) {
            console.error('[MarketDataScraper] All sources failed:', e2.message);
            return _cache ? { ..._cache, cached: true, stale: true } : null;
        }
    } finally {
        _scraping = false;
    }
}

export function getCachedMarketData() {
    return _cache;
}
