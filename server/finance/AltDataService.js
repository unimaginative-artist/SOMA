/**
 * AltDataService — Free alternative data sources
 *
 * Institutional firms pay $50k-$500k/year for alt data.
 * These are the free public equivalents:
 *
 * 1. Fear & Greed Index
 *    - Crypto: alternative.me/fng (no key)
 *    - Equity: CNN fear & greed endpoint (no key)
 *
 * 2. Reddit Sentiment
 *    - r/wallstreetbets (stocks), r/CryptoCurrency + r/Bitcoin (crypto)
 *    - Reddit public JSON API (no auth required for read)
 *    - Measures mention velocity + upvote-weighted sentiment
 *
 * 3. Upcoming Earnings / Events  (future: EDGAR insider filings)
 *    - Yahoo Finance earnings calendar (free, no key)
 *
 * Results are cached per TTL to avoid rate limits.
 * Scores normalize to -1 (bearish) → +1 (bullish).
 */

const TTL = {
    fearGreed: 15 * 60 * 1000,   // 15 min
    reddit:    12 * 60 * 1000,   // 12 min
    earnings:  60 * 60 * 1000,   // 60 min
};

const FETCH_TIMEOUT_MS = 5000;

class AltDataService {
    constructor() {
        this._cache = new Map();
        this._fetchCount = 0;
        this._errorCount = 0;
    }

    /**
     * Get composite alt-data score for a symbol.
     * Uses whichever sources succeed (gracefully degrades).
     *
     * @returns {{ score, confidence, components, label }}
     */
    async getScore(symbol) {
        const [fgResult, rdResult] = await Promise.allSettled([
            this.getFearGreed(symbol),
            this.getRedditSentiment(symbol),
        ]);

        const fg  = fgResult.status  === 'fulfilled' ? fgResult.value  : null;
        const rd  = rdResult.status  === 'fulfilled' ? rdResult.value  : null;

        const active = [];
        if (fg && fg.score != null) active.push({ score: fg.score, weight: 0.45, name: 'fearGreed' });
        if (rd && rd.score != null) active.push({ score: rd.score, weight: 0.55, name: 'reddit'    });

        if (active.length === 0) {
            return { score: 0, confidence: 0, components: {}, label: 'no data' };
        }

        const totalW    = active.reduce((s, x) => s + x.weight, 0);
        const composite = active.reduce((s, x) => s + x.score * x.weight, 0) / totalW;

        // Alt data max confidence = 0.65 — it supplements technicals, doesn't override
        const confidence = Math.min(0.65, active.length * 0.32);

        const label = composite > 0.3 ? 'bullish' : composite < -0.3 ? 'bearish' : 'neutral';

        return {
            score:      Math.max(-1, Math.min(1, composite)),
            confidence,
            components: { fearGreed: fg, reddit: rd },
            label,
            sourcesActive: active.length,
        };
    }

    /**
     * Fear & Greed Index
     * Crypto: alternative.me (free, updated daily)
     * Equity: CNN (free, updated throughout day)
     *
     * Interpretation: extreme fear = contrarian buy, extreme greed = contrarian sell
     */
    async getFearGreed(symbol) {
        const isCrypto = this._isCrypto(symbol);
        const cacheKey = isCrypto ? 'fg_crypto' : 'fg_equity';
        const cached   = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            let value = 50, label = 'Neutral', score = 0;

            if (isCrypto) {
                // alternative.me — Crypto Fear & Greed
                const data = await this._fetch('https://api.alternative.me/fng/?limit=1&format=json');
                if (data?.data?.[0]) {
                    value = parseInt(data.data[0].value, 10);
                    label = data.data[0].value_classification || 'Unknown';
                }
            } else {
                // CNN Fear & Greed
                const data = await this._fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata/previous_close');
                if (data?.fear_and_greed?.score != null) {
                    value = Math.round(data.fear_and_greed.score);
                    label = data.fear_and_greed.rating || 'Unknown';
                }
            }

            // Contrarian: extreme fear (0-25) → strong buy signal (+1)
            //             extreme greed (75-100) → strong sell signal (-1)
            //             neutral (50) → 0
            if      (value <= 15)  score =  1.0;
            else if (value <= 25)  score =  0.7;
            else if (value <= 35)  score =  0.4;
            else if (value <= 45)  score =  0.15;
            else if (value <= 55)  score =  0.0;
            else if (value <= 65)  score = -0.15;
            else if (value <= 75)  score = -0.4;
            else if (value <= 85)  score = -0.7;
            else                   score = -1.0;

            const result = { score, value, label, source: isCrypto ? 'alternative.me' : 'CNN' };
            this._setCache(cacheKey, result, TTL.fearGreed);
            return result;
        } catch (e) {
            this._errorCount++;
            console.warn('[AltData] Fear & Greed failed:', e.message);
            return null;
        }
    }

    /**
     * Reddit mention velocity + sentiment
     * Stocks: r/wallstreetbets, r/stocks
     * Crypto: r/CryptoCurrency, r/Bitcoin
     *
     * Score = upvote-weighted bull/bear ratio in last 24h
     * More mentions = higher confidence (mention velocity)
     */
    async getRedditSentiment(symbol) {
        const ticker   = symbol.replace('-USD', '').replace('/', '').replace('-', '').toUpperCase();
        const cacheKey = `reddit_${ticker}`;
        const cached   = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            const isCrypto = this._isCrypto(symbol);
            const subs     = isCrypto
                ? ['CryptoCurrency', 'Bitcoin']
                : ['wallstreetbets', 'stocks'];

            let totalMentions = 0;
            let bullScore     = 0;
            let bearScore     = 0;

            const BULL_WORDS = ['moon', 'bull', 'buy', 'long', 'bullish', 'pump', 'breakout', 'squeeze', 'calls', 'yolo', 'rocket', 'green', 'up', 'hold', 'hodl'];
            const BEAR_WORDS = ['bear', 'sell', 'short', 'bearish', 'dump', 'puts', 'crash', 'dead', 'rip', 'red', 'down', 'falling', 'drop', 'avoid'];

            for (const sub of subs) {
                try {
                    const url  = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(ticker)}&sort=new&t=day&limit=25&restrict_sr=1`;
                    const data = await this._fetch(url);
                    const posts = data?.data?.children || [];

                    totalMentions += posts.length;

                    for (const { data: post } of posts) {
                        const text   = `${post.title} ${post.selftext || ''}`.toLowerCase();
                        const weight = Math.max(1, Math.log10((post.score || 1) + 1)); // log-scale upvotes

                        const bullHits = BULL_WORDS.filter(w => text.includes(w)).length;
                        const bearHits = BEAR_WORDS.filter(w => text.includes(w)).length;

                        if (bullHits > bearHits)       bullScore += weight * (bullHits - bearHits);
                        else if (bearHits > bullHits)  bearScore += weight * (bearHits - bullHits);
                    }
                } catch { /* skip failed subreddit */ }
            }

            if (totalMentions === 0) {
                return { score: 0, mentions: 0, bullScore: 0, bearScore: 0, source: 'Reddit', confidence: 0 };
            }

            const total    = bullScore + bearScore || 1;
            const rawScore = (bullScore - bearScore) / total;

            // Velocity multiplier: more mentions = stronger signal (caps at 2x at 100 mentions)
            const velocityMult = Math.min(2.0, 1 + totalMentions / 100);
            const score        = Math.max(-1, Math.min(1, rawScore * velocityMult));

            // Confidence scales with mention count (low mentions = low confidence)
            const confidence = Math.min(0.7, totalMentions / 50);

            const result = { score, mentions: totalMentions, bullScore, bearScore, source: 'Reddit', confidence };
            this._setCache(cacheKey, result, TTL.reddit);
            return result;
        } catch (e) {
            this._errorCount++;
            console.warn('[AltData] Reddit failed:', e.message);
            return null;
        }
    }

    /** Stats for dashboard / debugging */
    getStats() {
        return {
            fetchCount:  this._fetchCount,
            errorCount:  this._errorCount,
            cacheSize:   this._cache.size,
            errorRate:   this._fetchCount > 0 ? (this._errorCount / this._fetchCount).toFixed(3) : 0,
        };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _isCrypto(symbol) {
        return symbol.includes('-USD') || symbol.includes('/') ||
            ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'XRP', 'MATIC', 'AVAX'].some(c => symbol.toUpperCase().includes(c));
    }

    _getCache(key) {
        const e = this._cache.get(key);
        if (!e || Date.now() - e.ts > e.ttl) return null;
        return e.data;
    }

    _setCache(key, data, ttl) {
        this._cache.set(key, { data, ts: Date.now(), ttl });
    }

    async _fetch(url, timeoutMs = FETCH_TIMEOUT_MS) {
        this._fetchCount++;
        const controller = new AbortController();
        const tid        = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                signal:  controller.signal,
                headers: { 'User-Agent': 'SOMA-AlphaEngine/2.0' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        } finally {
            clearTimeout(tid);
        }
    }
}

export const altDataService = new AltDataService();
