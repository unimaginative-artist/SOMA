/**
 * CorrelationGuard — Portfolio Correlation & Concentration Risk
 *
 * Before opening a new position, checks two things:
 *
 * 1. Pairwise correlation with existing positions (30-day daily closes).
 *    If Pearson r > 0.75 with any open position → BLOCK (hidden double exposure).
 *
 * 2. Portfolio beta vs SPY.
 *    If aggregate beta > 2.0 → WARN (portfolio is >2x the market's risk).
 *
 * Results are cached per symbol-pair for 4 hours (daily closes don't change intraday).
 *
 * Data source: marketDataService.getBars (1Day, 35 bars)
 */

import marketDataService from './marketDataService.js';

const CACHE_TTL_MS   = 4 * 60 * 60 * 1000;
const CORRELATION_BLOCK  = 0.75;  // block if r > this
const BETA_WARN          = 2.0;   // warn if portfolio beta > this
const MIN_BARS           = 20;    // minimum overlapping bars for correlation

class CorrelationGuard {
    constructor() {
        this._returnsCache = new Map(); // symbol → { returns: number[], ts: number }
        this._corrCache    = new Map(); // `${s1}_${s2}` → { r, ts }
    }

    /**
     * Check if opening a new position would create dangerous correlation.
     *
     * @param {string}   newSymbol
     * @param {string[]} openSymbols  - symbols of currently open positions
     * @param {object}   options
     *   threshold  {number} - correlation block threshold (default 0.75)
     *   warnBeta   {number} - portfolio beta warning level (default 2.0)
     *
     * @returns {Promise<{
     *   allowed: boolean,
     *   maxCorrelation: number,
     *   correlatedWith: string|null,
     *   portfolioBeta: number|null,
     *   betaWarning: boolean,
     *   reason: string
     * }>}
     */
    async check(newSymbol, openSymbols = [], options = {}) {
        const threshold = options.threshold ?? CORRELATION_BLOCK;
        const warnBeta  = options.warnBeta  ?? BETA_WARN;

        if (openSymbols.length === 0) {
            return { allowed: true, maxCorrelation: 0, correlatedWith: null, portfolioBeta: null, betaWarning: false, reason: 'no open positions' };
        }

        // Dedup and exclude same symbol
        const others = [...new Set(openSymbols.map(s => s.toUpperCase()))].filter(s => s !== newSymbol.toUpperCase());

        let maxR = 0;
        let correlatedWith = null;

        for (const sym of others) {
            try {
                const r = await this._correlation(newSymbol.toUpperCase(), sym);
                if (Math.abs(r) > Math.abs(maxR)) {
                    maxR = r;
                    if (Math.abs(r) > threshold) correlatedWith = sym;
                }
            } catch { /* non-fatal */ }
        }

        const blocked = Math.abs(maxR) > threshold;

        // Portfolio beta (vs SPY)
        let portfolioBeta = null;
        let betaWarning   = false;
        try {
            const allSymbols = [...others, newSymbol.toUpperCase()];
            portfolioBeta = await this._portfolioBeta(allSymbols);
            betaWarning   = portfolioBeta !== null && portfolioBeta > warnBeta;
        } catch { /* non-fatal */ }

        const reason = blocked
            ? `${newSymbol} is ${(maxR * 100).toFixed(0)}% correlated with ${correlatedWith} (>${(threshold * 100).toFixed(0)}% limit)`
            : betaWarning
                ? `Portfolio beta ${portfolioBeta?.toFixed(2)} > ${warnBeta} — high market exposure`
                : `Correlation OK (max r=${maxR.toFixed(2)})`;

        if (blocked) console.log(`[CorrelationGuard] BLOCKED ${newSymbol}: ${reason}`);

        return {
            allowed: !blocked,
            maxCorrelation: parseFloat(maxR.toFixed(4)),
            correlatedWith,
            portfolioBeta:  portfolioBeta !== null ? parseFloat(portfolioBeta.toFixed(4)) : null,
            betaWarning,
            reason
        };
    }

    async _correlation(sym1, sym2) {
        const key = [sym1, sym2].sort().join('_');
        const cached = this._corrCache.get(key);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.r;

        const [r1, r2] = await Promise.all([
            this._getReturns(sym1),
            this._getReturns(sym2)
        ]);

        // Align by length (use shorter)
        const len = Math.min(r1.length, r2.length);
        if (len < MIN_BARS) return 0;

        const a = r1.slice(-len);
        const b = r2.slice(-len);
        const r = this._pearson(a, b);
        this._corrCache.set(key, { r, ts: Date.now() });
        return r;
    }

    async _portfolioBeta(symbols) {
        const spyReturns = await this._getReturns('SPY');
        if (spyReturns.length < MIN_BARS) return null;

        let totalBeta = 0;
        let count = 0;
        for (const sym of symbols) {
            if (sym === 'SPY') { totalBeta += 1; count++; continue; }
            try {
                const symReturns = await this._getReturns(sym);
                const len = Math.min(spyReturns.length, symReturns.length);
                if (len < MIN_BARS) continue;
                const beta = this._beta(symReturns.slice(-len), spyReturns.slice(-len));
                totalBeta += beta;
                count++;
            } catch { /* skip */ }
        }
        return count > 0 ? totalBeta / count : null;
    }

    async _getReturns(symbol) {
        const cached = this._returnsCache.get(symbol);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.returns;

        const bars = await marketDataService.getBars(symbol, '1Day', 35);
        if (!bars || bars.length < 2) return [];

        const closes  = bars.map(b => b.close || b.c).filter(v => typeof v === 'number' && v > 0);
        const returns = [];
        for (let i = 1; i < closes.length; i++) {
            returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
        this._returnsCache.set(symbol, { returns, ts: Date.now() });
        return returns;
    }

    _pearson(a, b) {
        const n    = a.length;
        const avgA = a.reduce((s, v) => s + v, 0) / n;
        const avgB = b.reduce((s, v) => s + v, 0) / n;
        let num = 0, denA = 0, denB = 0;
        for (let i = 0; i < n; i++) {
            const da = a[i] - avgA, db = b[i] - avgB;
            num  += da * db;
            denA += da * da;
            denB += db * db;
        }
        const den = Math.sqrt(denA * denB);
        return den === 0 ? 0 : num / den;
    }

    _beta(assetReturns, marketReturns) {
        const cov = this._covariance(assetReturns, marketReturns);
        const varM = this._variance(marketReturns);
        return varM === 0 ? 1 : cov / varM;
    }

    _covariance(a, b) {
        const n = a.length;
        const avgA = a.reduce((s, v) => s + v, 0) / n;
        const avgB = b.reduce((s, v) => s + v, 0) / n;
        return a.reduce((s, v, i) => s + (v - avgA) * (b[i] - avgB), 0) / n;
    }

    _variance(arr) {
        const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
        return arr.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / arr.length;
    }

    clearCache() {
        this._returnsCache.clear();
        this._corrCache.clear();
    }
}

const correlationGuard = new CorrelationGuard();
export default correlationGuard;
