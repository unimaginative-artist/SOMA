/**
 * Market Data Service - Real-time price data for Mission Control
 * Supports both Alpaca (stocks) and Binance (crypto) data feeds
 *
 * Production-grade features:
 *  - Per-provider circuit breakers (skip dead providers instead of hammering them)
 *  - Exponential backoff on repeated failures (30s → 60s → 120s → 5min cap)
 *  - Stale-while-revalidate (serve cached data instantly, refresh in background)
 *  - Bounded caches with LRU eviction (prevents unbounded memory growth)
 *  - getLatestPrice() has the same protections as getBars()
 */

import alpacaService from './AlpacaService.js';

// ─── Provider names (used as circuit-breaker keys) ───
const PROVIDERS = {
    BINANCE_US:    'binance.us',
    BINANCE_COM:   'binance.com',
    ALPACA:        'alpaca',
    ALPACA_CRYPTO: 'alpaca-crypto',
    COINGECKO:     'coingecko',
    YAHOO:         'yahoo',
};

class MarketDataService {
    constructor() {
        // ── Caches ──
        this.priceCache  = new Map(); // symbol -> { price, timestamp }
        this.candleCache = new Map(); // "SYMBOL_TIMEFRAME" -> { data, timestamp }

        // ── Negative / backoff cache ──
        // key -> { failedAt, error, attempts }
        this._failedCache = new Map();

        // ── Per-provider circuit breakers ──
        // provider -> { consecutiveFailures, lastFailureAt, openUntil }
        this._circuitBreakers = new Map();

        // ── In-flight background refreshes (stale-while-revalidate) ──
        this._pendingRefreshes = new Set();

        // ── Tuning knobs ──
        this.MAX_CACHE_ENTRIES   = 200;       // Max entries per cache Map
        this.FRESH_CACHE_MS      = 45_000;    // Serve cached data without any API call
        this.STALE_CACHE_MS      = 300_000;   // Max age for stale-while-revalidate (5 min)
        this.PRICE_FRESH_MS      = 15_000;    // Price cache TTL (15s)
        this.PRICE_STALE_MS      = 120_000;   // Price stale-while-revalidate window (2 min)
        this.BACKOFF_BASE_MS     = 30_000;    // First backoff interval
        this.BACKOFF_MAX_MS      = 300_000;   // Max backoff (5 min)
        this.CB_FAILURE_THRESHOLD = 3;        // Consecutive failures to open circuit
        this.CB_RECOVERY_MS      = 120_000;   // How long an open circuit stays open before half-open
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  CIRCUIT BREAKER — per-provider health tracking            ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * Check if a provider is available (circuit closed or half-open).
     */
    _isProviderAvailable(provider) {
        const cb = this._circuitBreakers.get(provider);
        if (!cb) return true; // No record = healthy
        if (cb.consecutiveFailures < this.CB_FAILURE_THRESHOLD) return true; // Under threshold
        // Circuit is open — check if recovery period has elapsed (half-open)
        if (Date.now() >= cb.openUntil) return true; // Half-open: allow one probe
        return false;
    }

    /**
     * Record a successful call — reset the circuit breaker.
     */
    _recordProviderSuccess(provider) {
        this._circuitBreakers.delete(provider);
    }

    /**
     * Record a failed call — increment failures, potentially open the circuit.
     */
    _recordProviderFailure(provider) {
        const cb = this._circuitBreakers.get(provider) || { consecutiveFailures: 0, lastFailureAt: 0, openUntil: 0 };
        cb.consecutiveFailures++;
        cb.lastFailureAt = Date.now();
        if (cb.consecutiveFailures >= this.CB_FAILURE_THRESHOLD) {
            // Exponential open duration: 2min, 4min, 8min … capped at 15min
            const multiplier = Math.min(cb.consecutiveFailures - this.CB_FAILURE_THRESHOLD, 3);
            const openDuration = this.CB_RECOVERY_MS * Math.pow(2, multiplier);
            cb.openUntil = Date.now() + Math.min(openDuration, 900_000);
            console.warn(`[CircuitBreaker] ${provider} OPEN for ${Math.round(openDuration / 1000)}s (${cb.consecutiveFailures} consecutive failures)`);
        }
        this._circuitBreakers.set(provider, cb);
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  EXPONENTIAL BACKOFF                                       ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * Calculate backoff duration for a cache key based on attempt count.
     * 30s → 60s → 120s → 300s (cap)
     */
    _getBackoffMs(cacheKey) {
        const entry = this._failedCache.get(cacheKey);
        if (!entry) return 0;
        const attempts = entry.attempts || 1;
        return Math.min(this.BACKOFF_BASE_MS * Math.pow(2, attempts - 1), this.BACKOFF_MAX_MS);
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  BOUNDED CACHE — LRU eviction                              ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * Evict oldest entries from a Map if it exceeds MAX_CACHE_ENTRIES.
     * Maps iterate in insertion order, so the first keys are the oldest.
     */
    _evictIfNeeded(cache) {
        if (cache.size <= this.MAX_CACHE_ENTRIES) return;
        const toEvict = cache.size - this.MAX_CACHE_ENTRIES;
        let evicted = 0;
        for (const key of cache.keys()) {
            if (evicted >= toEvict) break;
            cache.delete(key);
            evicted++;
        }
    }

    /**
     * Set a value in a cache Map, with LRU eviction.
     * Re-inserting a key moves it to the end (newest).
     */
    _cacheSet(cache, key, value) {
        // Delete-then-set moves the key to the end of insertion order
        cache.delete(key);
        cache.set(key, value);
        this._evictIfNeeded(cache);
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  STALE-WHILE-REVALIDATE — background refresh               ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * Trigger a non-blocking background refresh for a bars cache key.
     * Only one refresh per key at a time.
     */
    _backgroundRefreshBars(symbol, timeframe, limit) {
        const cacheKey = `${symbol}_${timeframe}`;
        if (this._pendingRefreshes.has(cacheKey)) return; // Already refreshing

        this._pendingRefreshes.add(cacheKey);
        const isCrypto = symbol.includes('-') || symbol.includes('USDT');

        const fetchPromise = isCrypto
            ? this.getCryptoBars(symbol, timeframe, limit)
            : this.getStockBars(symbol, timeframe, limit);

        fetchPromise
            .then(() => {
                this._failedCache.delete(cacheKey);
                console.log(`[MarketData] Background refresh succeeded for ${cacheKey}`);
            })
            .catch(err => {
                console.warn(`[MarketData] Background refresh failed for ${cacheKey}: ${err.message}`);
            })
            .finally(() => {
                this._pendingRefreshes.delete(cacheKey);
            });
    }

    /**
     * Trigger a non-blocking background refresh for a price cache key.
     */
    _backgroundRefreshPrice(symbol) {
        const refreshKey = `price_${symbol}`;
        if (this._pendingRefreshes.has(refreshKey)) return;

        this._pendingRefreshes.add(refreshKey);
        this._fetchLatestPrice(symbol)
            .then(result => {
                this._cacheSet(this.priceCache, symbol, { ...result, timestamp: Date.now() });
                this._failedCache.delete(refreshKey);
            })
            .catch(err => {
                console.warn(`[MarketData] Background price refresh failed for ${symbol}: ${err.message}`);
            })
            .finally(() => {
                this._pendingRefreshes.delete(refreshKey);
            });
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  getBars — main entry point                                ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * Get real-time bars/candles for a symbol
     * @param {string} symbol - Stock symbol (AAPL) or crypto pair (BTC-USD)
     * @param {string} timeframe - '1Min', '5Min', '15Min', '1H', '1D'
     * @param {number} limit - Number of bars to fetch (default: 100)
     */
    async getBars(symbol, timeframe = '1Min', limit = 100) {
        timeframe = this._normalizeTimeframe(timeframe);
        const cacheKey = `${symbol}_${timeframe}`;
        const cached = this.candleCache.get(cacheKey);

        // 1. Fresh cache → return immediately
        if (cached && Date.now() - cached.timestamp < this.FRESH_CACHE_MS) {
            return cached.data;
        }

        // 2. Stale cache → return immediately + background refresh
        if (cached && Date.now() - cached.timestamp < this.STALE_CACHE_MS) {
            this._backgroundRefreshBars(symbol, timeframe, limit);
            return cached.data.map(bar => ({ ...bar, isCached: true }));
        }

        // 3. Exponential backoff — don't retry too soon after failure
        const failed = this._failedCache.get(cacheKey);
        if (failed) {
            const backoffMs = this._getBackoffMs(cacheKey);
            if (Date.now() - failed.failedAt < backoffMs) {
                // Return very stale cached data if any (> 5 min but better than nothing)
                if (cached) {
                    return cached.data.map(bar => ({ ...bar, isCached: true }));
                }
                const remainSec = Math.round((backoffMs - (Date.now() - failed.failedAt)) / 1000);
                throw new Error(`[backoff] ${symbol} retry in ${remainSec}s (attempt #${failed.attempts}): ${failed.error}`);
            }
        }

        // 4. Fetch from providers
        try {
            const isCrypto = symbol.includes('-') || symbol.includes('USDT');
            const bars = isCrypto
                ? await this.getCryptoBars(symbol, timeframe, limit)
                : await this.getStockBars(symbol, timeframe, limit);

            // Success — clear backoff
            this._failedCache.delete(cacheKey);
            return bars;
        } catch (error) {
            // Record failure with escalating attempt count
            const prev = this._failedCache.get(cacheKey);
            const attempts = (prev?.attempts || 0) + 1;
            this._failedCache.set(cacheKey, { failedAt: Date.now(), error: error.message, attempts });
            const nextBackoff = this._getBackoffMs(cacheKey);
            console.error(`[MarketData] Failed ${symbol} (attempt #${attempts}, next retry in ${Math.round(nextBackoff / 1000)}s): ${error.message}`);
            throw error;
        }
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  getStockBars — Alpaca → Yahoo → cache                    ║
    // ╚══════════════════════════════════════════════════════════════╝

    async getStockBars(symbol, timeframe, limit) {
        timeframe = this._normalizeTimeframe(timeframe);
        // Try Alpaca first if connected and circuit is closed
        if (alpacaService.isConnected && this._isProviderAvailable(PROVIDERS.ALPACA)) {
            try {
                const alpacaTimeframe = this.convertToAlpacaTimeframe(timeframe);
                const end = new Date();
                const start = new Date();

                switch (timeframe) {
                    case '1Min': start.setHours(start.getHours() - 2); break;
                    case '5Min': start.setHours(start.getHours() - 8); break;
                    case '15Min': start.setDate(start.getDate() - 2); break;
                    case '1H': start.setDate(start.getDate() - 7); break;
                    case '1D': start.setDate(start.getDate() - 60); break;
                }

                const bars = await alpacaService.client.getBarsV2(symbol, {
                    start: start.toISOString(),
                    end: end.toISOString(),
                    timeframe: alpacaTimeframe,
                    limit: limit,
                    feed: 'iex'
                });

                const candles = [];
                for await (const bar of bars) {
                    candles.push({
                        time: new Date(bar.Timestamp).toLocaleTimeString(),
                        timestamp: new Date(bar.Timestamp).getTime(),
                        open: bar.OpenPrice,
                        high: bar.HighPrice,
                        low: bar.LowPrice,
                        close: bar.ClosePrice,
                        volume: bar.Volume
                    });
                }

                if (candles.length > 0) {
                    this._cacheSet(this.candleCache, `${symbol}_${timeframe}`, { data: candles, timestamp: Date.now() });
                    this._recordProviderSuccess(PROVIDERS.ALPACA);
                    return candles;
                }
                console.warn(`[Alpaca] No bars returned for ${symbol}, trying Yahoo Finance...`);
            } catch (error) {
                this._recordProviderFailure(PROVIDERS.ALPACA);
                console.warn(`[Alpaca] Bars failed for ${symbol}: ${error.message}. Trying Yahoo Finance...`);
            }
        }

        // Fallback: Yahoo Finance
        if (this._isProviderAvailable(PROVIDERS.YAHOO)) {
            try {
                const bars = await this.getYahooFinanceBars(symbol, timeframe, limit);
                this._recordProviderSuccess(PROVIDERS.YAHOO);
                return bars;
            } catch (yahooErr) {
                this._recordProviderFailure(PROVIDERS.YAHOO);
                console.error(`[Yahoo] Also failed for ${symbol}: ${yahooErr.message}`);
            }
        }

        // Last resort: cached data
        const cached = this.candleCache.get(`${symbol}_${timeframe}`);
        if (cached && Date.now() - cached.timestamp < this.STALE_CACHE_MS) {
            console.log(`[MarketData] Returning cached data for ${symbol}`);
            return cached.data.map(bar => ({ ...bar, isCached: true }));
        }

        throw new Error(`No market data available for ${symbol}. Alpaca and Yahoo Finance both failed.`);
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  getYahooFinanceBars                                       ║
    // ╚══════════════════════════════════════════════════════════════╝

    async getYahooFinanceBars(symbol, timeframe, limit) {
        const intervalMap = { '1Min': '1m', '5Min': '5m', '15Min': '15m', '1H': '1h', '1D': '1d' };
        const rangeMap = { '1Min': '1d', '5Min': '5d', '15Min': '5d', '1H': '1mo', '1D': '3mo' };
        const interval = intervalMap[timeframe] || '5m';
        const range = rangeMap[timeframe] || '5d';

        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOMA/1.0)' }
        });

        if (!response.ok) {
            throw new Error(`Yahoo Finance returned ${response.status}`);
        }

        const data = await response.json();
        const result = data?.chart?.result?.[0];
        if (!result || !result.timestamp) {
            throw new Error('Yahoo Finance returned no data');
        }

        const timestamps = result.timestamp;
        const quote = result.indicators?.quote?.[0];
        if (!quote) throw new Error('Yahoo Finance returned no quote data');

        const candles = [];
        for (let i = 0; i < Math.min(timestamps.length, limit); i++) {
            if (quote.open[i] == null) continue;
            candles.push({
                time: new Date(timestamps[i] * 1000).toLocaleTimeString(),
                timestamp: timestamps[i] * 1000,
                open: quote.open[i],
                high: quote.high[i],
                low: quote.low[i],
                close: quote.close[i],
                volume: quote.volume[i] || 0
            });
        }

        if (candles.length > 0) {
            this._cacheSet(this.candleCache, `${symbol}_${timeframe}`, { data: candles, timestamp: Date.now() });
            console.log(`[Yahoo] Got ${candles.length} bars for ${symbol}`);
        }

        return candles;
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  getCryptoBars — Binance.US → Binance.com → Alpaca → CG   ║
    // ╚══════════════════════════════════════════════════════════════╝

    async getCryptoBars(symbol, timeframe, limit) {
        timeframe = this._normalizeTimeframe(timeframe);
        const binanceSymbol = symbol.toUpperCase().replace('-', '').replace('USD', 'USDT');
        const binanceInterval = this.convertToBinanceInterval(timeframe);

        // Strategy 1: Binance public API (.us first, .com fallback)
        const binanceTargets = [
            { host: 'https://api.binance.us',  provider: PROVIDERS.BINANCE_US,  suffix: 'USD' },
            { host: 'https://api.binance.com', provider: PROVIDERS.BINANCE_COM, suffix: 'USDT' },
        ];

        for (const { host, provider, suffix } of binanceTargets) {
            if (!this._isProviderAvailable(provider)) continue; // Circuit open — skip

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                const sym = binanceSymbol.replace('USDT', suffix);
                const url = `${host}/api/v3/klines?symbol=${sym}&interval=${binanceInterval}&limit=${limit}`;
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeout);

                if (!response.ok) {
                    this._recordProviderFailure(provider);
                    console.warn(`[Binance] ${host} returned ${response.status} for ${sym}`);
                    continue;
                }

                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    const candles = data.map(bar => ({
                        time: new Date(bar[0]).toLocaleTimeString(),
                        timestamp: bar[0],
                        open: parseFloat(bar[1]),
                        high: parseFloat(bar[2]),
                        low: parseFloat(bar[3]),
                        close: parseFloat(bar[4]),
                        volume: parseFloat(bar[5])
                    }));
                    this._cacheSet(this.candleCache, `${symbol}_${timeframe}`, { data: candles, timestamp: Date.now() });
                    this._recordProviderSuccess(provider);
                    const label = host.includes('.us') ? 'Binance.US' : 'Binance.com';
                    console.log(`[${label}] Got ${candles.length} bars for ${symbol}`);
                    return candles;
                }
            } catch (e) {
                this._recordProviderFailure(provider);
                const label = host.includes('.us') ? 'Binance.US' : 'Binance.com';
                console.warn(`[${label}] Fetch error for ${symbol}: ${e.message}`);
            }
        }

        // Strategy 2: Alpaca crypto bars
        if (alpacaService.isConnected && this._isProviderAvailable(PROVIDERS.ALPACA_CRYPTO)) {
            try {
                const alpacaSymbol = symbol.replace('-', '/');
                const alpacaTimeframe = this.convertToAlpacaTimeframe(timeframe);
                const end = new Date();
                const start = new Date();
                switch (timeframe) {
                    case '1Min': start.setHours(start.getHours() - 2); break;
                    case '5Min': start.setHours(start.getHours() - 8); break;
                    case '15Min': start.setDate(start.getDate() - 2); break;
                    case '1H': start.setDate(start.getDate() - 7); break;
                    case '1D': start.setDate(start.getDate() - 60); break;
                }
                const bars = await alpacaService.client.getCryptoBars(alpacaSymbol, {
                    start: start.toISOString(),
                    end: end.toISOString(),
                    timeframe: alpacaTimeframe,
                    limit: limit
                });
                const candles = [];
                for await (const bar of bars) {
                    candles.push({
                        time: new Date(bar.Timestamp).toLocaleTimeString(),
                        timestamp: new Date(bar.Timestamp).getTime(),
                        open: bar.Open, high: bar.High, low: bar.Low, close: bar.Close,
                        volume: bar.Volume
                    });
                }
                if (candles.length > 0) {
                    this._cacheSet(this.candleCache, `${symbol}_${timeframe}`, { data: candles, timestamp: Date.now() });
                    this._recordProviderSuccess(PROVIDERS.ALPACA_CRYPTO);
                    console.log(`[Alpaca Crypto] Got ${candles.length} bars for ${symbol}`);
                    return candles;
                }
            } catch (e) {
                this._recordProviderFailure(PROVIDERS.ALPACA_CRYPTO);
                console.warn(`[Alpaca Crypto] Failed for ${symbol}: ${e.message}`);
            }
        }

        // Strategy 3: CoinGecko OHLC
        if (this._isProviderAvailable(PROVIDERS.COINGECKO)) {
            try {
                const cgMap = { 'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'DOGE': 'dogecoin', 'XRP': 'ripple', 'ADA': 'cardano', 'AVAX': 'avalanche-2', 'MATIC': 'matic-network', 'DOT': 'polkadot', 'LINK': 'chainlink' };
                const base = symbol.split('-')[0].toUpperCase();
                const cgId = cgMap[base] || base.toLowerCase();
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const cgRes = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=1`, { signal: controller.signal });
                clearTimeout(timeout);
                if (cgRes.ok) {
                    const cgData = await cgRes.json();
                    if (Array.isArray(cgData) && cgData.length > 0) {
                        const candles = cgData.map(d => ({
                            time: new Date(d[0]).toLocaleTimeString(),
                            timestamp: d[0],
                            open: d[1], high: d[2], low: d[3], close: d[4],
                            volume: 0
                        }));
                        this._cacheSet(this.candleCache, `${symbol}_${timeframe}`, { data: candles, timestamp: Date.now() });
                        this._recordProviderSuccess(PROVIDERS.COINGECKO);
                        console.log(`[CoinGecko] Got ${candles.length} OHLC bars for ${symbol}`);
                        return candles;
                    }
                }
                this._recordProviderFailure(PROVIDERS.COINGECKO);
            } catch (e) {
                this._recordProviderFailure(PROVIDERS.COINGECKO);
                console.warn(`[CoinGecko] Failed for ${symbol}: ${e.message}`);
            }
        }

        // Strategy 4: Cached data (any age)
        const cached = this.candleCache.get(`${symbol}_${timeframe}`);
        if (cached && Date.now() - cached.timestamp < this.STALE_CACHE_MS) {
            console.log(`[MarketData] Returning cached data for ${symbol}`);
            return cached.data.map(bar => ({ ...bar, isCached: true }));
        }

        throw new Error(`No market data for ${symbol}: Binance, Alpaca, and CoinGecko all failed.`);
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  validateDataQuality                                       ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * Validate data quality before trading decisions
     * @param {object[]} bars - OHLCV bar data
     * @param {number} maxStalenessMs - Max age in ms (default 15 min)
     * @returns {{ valid: boolean, issues: string[] }}
     */
    validateDataQuality(bars, maxStalenessMs = 900000) {
        const issues = [];

        if (!bars || bars.length === 0) {
            return { valid: false, issues: ['No data available'] };
        }

        // Check for mock data
        if (bars.some(b => b.isMock)) {
            issues.push('Data contains mock/simulated bars - not suitable for live trading');
        }

        // Check staleness
        const lastBar = bars[bars.length - 1];
        const barAge = Date.now() - (lastBar.timestamp || 0);
        if (barAge > maxStalenessMs) {
            const ageMinutes = Math.round(barAge / 60000);
            issues.push(`Data is ${ageMinutes} minutes stale (limit: ${Math.round(maxStalenessMs / 60000)} min)`);
        }

        // OHLC validity
        for (let i = 0; i < Math.min(bars.length, 10); i++) {
            const bar = bars[bars.length - 1 - i];
            if (bar.high < bar.low) {
                issues.push(`Invalid OHLC: high ($${bar.high}) < low ($${bar.low}) at index ${bars.length - 1 - i}`);
                break;
            }
            if (bar.close <= 0 || bar.open <= 0) {
                issues.push(`Invalid price: zero or negative at index ${bars.length - 1 - i}`);
                break;
            }
        }

        // Check for suspiciously flat data (all bars identical = likely mock)
        const recentCloses = bars.slice(-10).map(b => b.close);
        const allSame = recentCloses.every(c => c === recentCloses[0]);
        if (allSame && bars.length > 5) {
            issues.push('Suspiciously flat data - all recent closes identical');
        }

        return {
            valid: issues.length === 0,
            issues,
            barCount: bars.length,
            lastTimestamp: lastBar.timestamp,
            ageMs: barAge,
            hasMockData: bars.some(b => b.isMock)
        };
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  getLatestPrice — with cache + backoff + circuit breakers  ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * Get latest price for a symbol (with multi-source fallback).
     * Now protected by price cache, exponential backoff, and circuit breakers.
     */
    async getLatestPrice(symbol) {
        const priceCacheKey = `price_${symbol}`;
        const cachedPrice = this.priceCache.get(symbol);

        // 1. Fresh price cache → return immediately
        if (cachedPrice && Date.now() - cachedPrice.timestamp < this.PRICE_FRESH_MS) {
            return { symbol, price: cachedPrice.price, timestamp: cachedPrice.timestamp };
        }

        // 2. Stale price cache → return + background refresh
        if (cachedPrice && Date.now() - cachedPrice.timestamp < this.PRICE_STALE_MS) {
            this._backgroundRefreshPrice(symbol);
            return { symbol, price: cachedPrice.price, timestamp: cachedPrice.timestamp, isCached: true };
        }

        // 3. Exponential backoff
        const failed = this._failedCache.get(priceCacheKey);
        if (failed) {
            const backoffMs = Math.min(this.BACKOFF_BASE_MS * Math.pow(2, (failed.attempts || 1) - 1), this.BACKOFF_MAX_MS);
            if (Date.now() - failed.failedAt < backoffMs) {
                // Return stale price if any
                if (cachedPrice) {
                    return { symbol, price: cachedPrice.price, timestamp: cachedPrice.timestamp, isCached: true };
                }
                // Try to derive from candle cache
                const barCached = this.candleCache.get(`${symbol}_5Min`) || this.candleCache.get(`${symbol}_1Min`);
                if (barCached && barCached.data.length > 0) {
                    const lastBar = barCached.data[barCached.data.length - 1];
                    return { symbol, price: lastBar.close, timestamp: lastBar.timestamp, isCached: true };
                }
                throw new Error(`[backoff] ${symbol} price retry in ${Math.round((backoffMs - (Date.now() - failed.failedAt)) / 1000)}s`);
            }
        }

        // 4. Fetch from providers
        try {
            const result = await this._fetchLatestPrice(symbol);
            this._cacheSet(this.priceCache, symbol, { ...result, timestamp: Date.now() });
            this._failedCache.delete(priceCacheKey);
            return result;
        } catch (error) {
            const prev = this._failedCache.get(priceCacheKey);
            const attempts = (prev?.attempts || 0) + 1;
            this._failedCache.set(priceCacheKey, { failedAt: Date.now(), error: error.message, attempts });
            throw error;
        }
    }

    /**
     * Internal: actually fetch the latest price from providers.
     * Separated from getLatestPrice() so the caching/backoff layer can call it for background refresh.
     */
    async _fetchLatestPrice(symbol) {
        const isCrypto = symbol.includes('-') || symbol.includes('USDT');

        if (!isCrypto) {
            // Stocks: Alpaca
            if (!alpacaService.isConnected) {
                throw new Error('Alpaca not connected');
            }
            const quote = await alpacaService.getQuote(symbol);
            return { symbol, price: quote.price, timestamp: quote.timestamp };
        }

        // Crypto: Binance.US → Binance.com → CoinGecko → cached bars
        const binanceSymbol = symbol.toUpperCase().replace('-', '').replace('USD', 'USDT');

        const binanceTargets = [
            { host: 'https://api.binance.us',  provider: PROVIDERS.BINANCE_US,  sym: binanceSymbol.replace('USDT', 'USD') },
            { host: 'https://api.binance.com', provider: PROVIDERS.BINANCE_COM, sym: binanceSymbol },
        ];

        for (const { host, provider, sym } of binanceTargets) {
            if (!this._isProviderAvailable(provider)) continue;

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const response = await fetch(
                    `${host}/api/v3/ticker/price?symbol=${sym}`,
                    { signal: controller.signal }
                );
                clearTimeout(timeout);
                if (response.ok) {
                    const data = await response.json();
                    if (data.price) {
                        this._recordProviderSuccess(provider);
                        return { symbol, price: parseFloat(data.price), timestamp: Date.now() };
                    }
                }
                this._recordProviderFailure(provider);
            } catch (e) {
                this._recordProviderFailure(provider);
            }
        }

        // CoinGecko simple price
        if (this._isProviderAvailable(PROVIDERS.COINGECKO)) {
            try {
                const cgMap = { 'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'DOGE': 'dogecoin', 'XRP': 'ripple' };
                const base = symbol.split('-')[0].toUpperCase();
                const cgId = cgMap[base] || base.toLowerCase();
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const res = await fetch(
                    `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
                    { signal: controller.signal }
                );
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json();
                    if (data[cgId]?.usd) {
                        this._recordProviderSuccess(PROVIDERS.COINGECKO);
                        return { symbol, price: data[cgId].usd, timestamp: Date.now() };
                    }
                }
                this._recordProviderFailure(PROVIDERS.COINGECKO);
            } catch (e) {
                this._recordProviderFailure(PROVIDERS.COINGECKO);
            }
        }

        // Last resort: latest close from cached bars
        const cached = this.candleCache.get(`${symbol}_5Min`) || this.candleCache.get(`${symbol}_1Min`);
        if (cached && cached.data.length > 0) {
            const lastBar = cached.data[cached.data.length - 1];
            return { symbol, price: lastBar.close, timestamp: lastBar.timestamp, isCached: true };
        }

        throw new Error(`No price data for ${symbol}: all sources failed`);
    }

    // ╔══════════════════════════════════════════════════════════════╗
    // ║  Helpers                                                   ║
    // ╚══════════════════════════════════════════════════════════════╝

    /**
     * Canonical timeframes are '1Min','5Min','15Min','1H','1D'. Callers that pass
     * Alpaca-style names ('1Day','1Hour') used to fall through the interval maps
     * and silently fetch 1-minute bars — which fed the regime detector and
     * backtester near-flat "daily" data. Normalize before any map lookup.
     */
    _normalizeTimeframe(timeframe) {
        const aliases = { '1Day': '1D', '1day': '1D', '1Hour': '1H', '1hour': '1H' };
        return aliases[timeframe] || timeframe;
    }

    convertToAlpacaTimeframe(timeframe) {
        const map = { '1Min': '1Min', '5Min': '5Min', '15Min': '15Min', '1H': '1Hour', '1D': '1Day' };
        return map[this._normalizeTimeframe(timeframe)] || '1Min';
    }

    convertToBinanceInterval(timeframe) {
        const map = { '1Min': '1m', '5Min': '5m', '15Min': '15m', '1H': '1h', '1D': '1d' };
        return map[this._normalizeTimeframe(timeframe)] || '1m';
    }

    /**
     * Clear all caches and reset circuit breakers.
     */
    clearCache() {
        this.priceCache.clear();
        this.candleCache.clear();
        this._failedCache.clear();
        this._circuitBreakers.clear();
        this._pendingRefreshes.clear();
    }

    /**
     * Get diagnostics for debugging / status endpoints.
     */
    getDiagnostics() {
        const circuits = {};
        for (const [provider, cb] of this._circuitBreakers) {
            circuits[provider] = {
                failures: cb.consecutiveFailures,
                isOpen: cb.consecutiveFailures >= this.CB_FAILURE_THRESHOLD && Date.now() < cb.openUntil,
                openUntil: cb.openUntil > Date.now() ? new Date(cb.openUntil).toISOString() : null,
            };
        }
        return {
            candleCacheSize: this.candleCache.size,
            priceCacheSize: this.priceCache.size,
            failedCacheSize: this._failedCache.size,
            pendingRefreshes: this._pendingRefreshes.size,
            circuitBreakers: circuits,
        };
    }
}

// Singleton instance
const marketDataService = new MarketDataService();

export default marketDataService;
