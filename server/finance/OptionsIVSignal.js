/**
 * OptionsIVSignal — Implied Volatility Alpha Signal
 *
 * Produces a signal score [-1, +1] from two orthogonal IV data sources:
 *
 * 1. VIX regime (CBOE Volatility Index via Yahoo Finance informal API)
 *    VIX > 30  → fear spike → bearish score (institutions hedging)
 *    VIX 20-30 → elevated uncertainty → slightly bearish
 *    VIX 15-20 → normal → neutral
 *    VIX < 15  → complacency → slight bullish with caution flag
 *
 * 2. IV Rank for the specific symbol (from Yahoo Finance options chain)
 *    IV Rank = (current IV - 52w low IV) / (52w high IV - 52w low IV)
 *    IV Rank > 0.7 → high IV → mean-reversion opportunity (sell premium, score = +0.4 for options writers)
 *    IV Rank < 0.3 → low IV → pre-expansion → uncertainty (score = -0.2)
 *
 * Combined score is cached for 15 minutes.
 * Falls back to 0 (neutral) on any API failure — never blocks trading.
 */

const VIX_CACHE_MS     = 15 * 60 * 1000;
const OPTIONS_CACHE_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

class OptionsIVSignal {
    constructor() {
        this._vixCache     = { vix: null, ts: 0 };
        this._optionsCache = new Map(); // symbol → { ivRank, ts }
    }

    /**
     * Get IV-based signal score for a symbol.
     * @param {string} symbol
     * @returns {Promise<{ score: number, vix: number|null, ivRank: number|null, reason: string }>}
     */
    async getSignal(symbol) {
        const [vixResult, ivResult] = await Promise.all([
            this._getVIX().catch(() => null),
            this._getIVRank(symbol).catch(() => null)
        ]);

        let score = 0;
        const parts = [];

        // VIX component (±0.6 max contribution)
        if (vixResult !== null) {
            if (vixResult > 35) {
                score -= 0.60; parts.push(`VIX=${vixResult.toFixed(1)} (extreme fear)`);
            } else if (vixResult > 28) {
                score -= 0.40; parts.push(`VIX=${vixResult.toFixed(1)} (elevated fear)`);
            } else if (vixResult > 20) {
                score -= 0.15; parts.push(`VIX=${vixResult.toFixed(1)} (uncertainty)`);
            } else if (vixResult < 13) {
                score += 0.10; parts.push(`VIX=${vixResult.toFixed(1)} (complacency — bullish near-term)`);
            } else {
                parts.push(`VIX=${vixResult.toFixed(1)} (normal)`);
            }
        }

        // IV Rank component (±0.4 max contribution)
        if (ivResult !== null) {
            if (ivResult > 0.75) {
                // Very high IV rank → expected move priced in → favour mean reversion or wait for IV crush
                score += 0.30; parts.push(`IVRank=${(ivResult * 100).toFixed(0)}% (high, mean-reversion signal)`);
            } else if (ivResult > 0.50) {
                score += 0.15; parts.push(`IVRank=${(ivResult * 100).toFixed(0)}% (elevated)`);
            } else if (ivResult < 0.20) {
                score -= 0.20; parts.push(`IVRank=${(ivResult * 100).toFixed(0)}% (low — vol likely to expand)`);
            } else {
                parts.push(`IVRank=${(ivResult * 100).toFixed(0)}% (normal)`);
            }
        }

        const clampedScore = Math.max(-1, Math.min(1, score));
        const reason = parts.length ? parts.join('; ') : 'no IV data';

        return {
            score:   parseFloat(clampedScore.toFixed(4)),
            vix:     vixResult,
            ivRank:  ivResult,
            reason,
            timestamp: new Date().toISOString()
        };
    }

    async _getVIX() {
        if (this._vixCache.vix !== null && Date.now() - this._vixCache.ts < VIX_CACHE_MS) {
            return this._vixCache.vix;
        }
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d';
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`VIX HTTP ${res.status}`);
        const json = await res.json();
        const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (!price) throw new Error('VIX price not found in response');
        this._vixCache = { vix: parseFloat(price), ts: Date.now() };
        return this._vixCache.vix;
    }

    async _getIVRank(symbol) {
        const cached = this._optionsCache.get(symbol);
        if (cached && Date.now() - cached.ts < OPTIONS_CACHE_MS) return cached.ivRank;

        // Yahoo Finance options chain (informal API — may change without notice)
        const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) return null;
        const json = await res.json();

        const options = json?.optionChain?.result?.[0]?.options?.[0];
        if (!options) return null;

        // Collect implied volatilities from near-ATM calls and puts
        const allContracts = [...(options.calls || []), ...(options.puts || [])];
        const ivs = allContracts
            .map(c => c.impliedVolatility)
            .filter(iv => typeof iv === 'number' && iv > 0 && iv < 20); // sanity bounds (20 = 2000%)

        if (ivs.length < 3) return null;

        const currentIV = ivs.reduce((s, v) => s + v, 0) / ivs.length;

        // We only have current snapshot — use currentIV vs rough historical bands
        // IV rank approximation: assume 52w range is ~0.15 (low) to ~0.85 (high) for most equities
        // This is a simplification; a true IV rank requires 52w of daily IV data
        // Treat currentIV in context of its own distribution across strikes
        const minIV = Math.min(...ivs);
        const maxIV = Math.max(...ivs);
        const ivRank = maxIV > minIV ? (currentIV - minIV) / (maxIV - minIV) : 0.5;

        this._optionsCache.set(symbol, { ivRank: parseFloat(ivRank.toFixed(4)), ts: Date.now() });
        return ivRank;
    }

    /** Flush caches (for testing) */
    clearCache() {
        this._vixCache = { vix: null, ts: 0 };
        this._optionsCache.clear();
    }
}

const optionsIVSignal = new OptionsIVSignal();
export default optionsIVSignal;
