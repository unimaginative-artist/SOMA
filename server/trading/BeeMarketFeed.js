/**
 * BeeMarketFeed.js
 *
 * Real-time public OKX market feed and quantitative feature extractor
 * for SOMA BeeBots (System 1 Laya trading agents).
 *
 * Zero API keys required: utilizes public OKX perpetual swap REST endpoints.
 * Features computed:
 *  - 1h / 24h returns
 *  - Wilder RSI (14)
 *  - Bollinger Bands (%B and width)
 *  - Average True Range (ATR 14)
 *  - Perpetual Funding Rate & Sentiment Bias
 *  - Open Interest
 *  - Larry Williams Dual Thrust Breakout Thresholds
 */

import { calculateRSI, calculateBollingerBands, calculateATR, calculateEMA, calculateSupertrend } from '../finance/TechnicalIndicators.js';

export const DEFAULT_PAIRS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'];
const OKX_BASE = 'https://www.okx.com';

export class BeeMarketFeed {
    constructor(options = {}) {
        this.pairs = options.pairs || DEFAULT_PAIRS;
        this.cache = new Map();
        this.timeoutMs = options.timeoutMs || 4000;
    }

    /**
     * Fetch public OKX JSON endpoint with timeout
     */
    async _fetchOkx(path) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(`${OKX_BASE}${path}`, {
                signal: controller.signal,
                headers: { 'User-Agent': 'SOMA-BeeBots/1.0' }
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
            const data = await res.json();
            if (data.code !== '0') throw new Error(`OKX API error code ${data.code}: ${data.msg}`);
            return data.data;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    /**
     * Fetch raw 1-hour candles (last 40 candles)
     * Format: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
     */
    async fetchCandles(instId, limit = 40) {
        const data = await this._fetchOkx(`/api/v5/market/candles?instId=${instId}&bar=1H&limit=${limit}`);
        if (!data || data.length === 0) return [];
        // OKX returns newest first. Reverse to chronological order (oldest first)
        return data.slice().reverse().map(c => ({
            ts: Number(c[0]),
            open: Number(c[1]),
            high: Number(c[2]),
            low: Number(c[3]),
            close: Number(c[4]),
            volume: Number(c[5])
        }));
    }

    /**
     * Fetch current ticker
     */
    async fetchTicker(instId) {
        const data = await this._fetchOkx(`/api/v5/market/ticker?instId=${instId}`);
        if (!data || !data[0]) throw new Error(`No ticker returned for ${instId}`);
        const t = data[0];
        return {
            instId: t.instId,
            last: Number(t.last),
            bid: Number(t.bidPx),
            ask: Number(t.askPx),
            high24h: Number(t.high24h),
            low24h: Number(t.low24h),
            open24h: Number(t.open24h),
            vol24h: Number(t.vol24h),
            ts: Number(t.ts)
        };
    }

    /**
     * Fetch perpetual funding rate
     */
    async fetchFunding(instId) {
        try {
            const data = await this._fetchOkx(`/api/v5/public/funding-rate?instId=${instId}`);
            if (data && data[0]) {
                return {
                    fundingRate: Number(data[0].fundingRate),
                    nextFundingRate: data[0].nextFundingRate ? Number(data[0].nextFundingRate) : null,
                    fundingTime: Number(data[0].fundingTime)
                };
            }
        } catch (_) {
            // Non-critical fallback
        }
        return { fundingRate: 0.0001, nextFundingRate: null, fundingTime: Date.now() };
    }

    /**
     * Fetch open interest
     */
    async fetchOpenInterest(instId) {
        try {
            const data = await this._fetchOkx(`/api/v5/public/open-interest?instType=SWAP&instId=${instId}`);
            if (data && data[0]) {
                return Number(data[0].oi);
            }
        } catch (_) {
            // Non-critical
        }
        return 0;
    }

    /**
     * Compute Larry Williams Dual Thrust breakout levels
     * Buy trigger = Open + k1 * Range
     * Sell trigger = Open - k2 * Range
     */
    computeLarryWilliams(open, high, low, k = 0.5) {
        const range = Math.max(1e-6, high - low);
        const buyTrigger = open + (k * range);
        const sellTrigger = open - (k * range);
        return {
            range,
            buyTrigger: Number(buyTrigger.toFixed(4)),
            sellTrigger: Number(sellTrigger.toFixed(4))
        };
    }

    /**
     * Get enriched quantitative snapshot for an instrument
     */
    async getMarketSnapshot(instId) {
        try {
            const [ticker, candles, funding, oi] = await Promise.all([
                this.fetchTicker(instId),
                this.fetchCandles(instId, 45),
                this.fetchFunding(instId),
                this.fetchOpenInterest(instId)
            ]);

            const closes = candles.map(c => c.close);
            const highs = candles.map(c => c.high);
            const lows = candles.map(c => c.low);

            const lastClose = closes[closes.length - 1] || ticker.last;
            const prev1hClose = closes.length >= 2 ? closes[closes.length - 2] : lastClose;
            const return1hPct = Number((((lastClose - prev1hClose) / prev1hClose) * 100).toFixed(2));
            const return24hPct = Number((((ticker.last - ticker.open24h) / ticker.open24h) * 100).toFixed(2));

            // Technical indicators
            const rsi = Number(calculateRSI(closes, 14).toFixed(1));
            const bb = calculateBollingerBands(closes, 20, 2);
            const atr = calculateATR(highs, lows, closes, 14);

            // Higher Timeframe (1H) Trend & Momentum Extraction
            const ema12Series = calculateEMA(closes, 12);
            const ema26Series = calculateEMA(closes, 26);
            const ema12 = ema12Series.length > 0 ? ema12Series[ema12Series.length - 1] : lastClose;
            const ema26 = ema26Series.length > 0 ? ema26Series[ema26Series.length - 1] : lastClose;
            const st = calculateSupertrend(highs, lows, closes, 10, 3);
            const stDirection = st && st.direction ? st.direction[st.direction.length - 1] : 1;

            let htfTrend = 'RANGING';
            if (ema12 > ema26 && stDirection === 1 && lastClose >= bb.middle) {
                htfTrend = 'BULLISH';
            } else if (ema12 < ema26 && stDirection === -1 && lastClose <= bb.middle) {
                htfTrend = 'BEARISH';
            }

            // Larry Williams Breakout levels
            const lw = this.computeLarryWilliams(ticker.open24h, ticker.high24h, ticker.low24h, 0.5);

            let breakoutStatus = 'INSIDE_RANGE';
            if (ticker.last >= lw.buyTrigger) breakoutStatus = 'ABOVE_BUY_TRIGGER';
            else if (ticker.last <= lw.sellTrigger) breakoutStatus = 'BELOW_SELL_TRIGGER';

            // Funding bias
            const fundingPct = Number((funding.fundingRate * 100).toFixed(4));
            let fundingBias = 'neutral';
            if (fundingPct > 0.02) fundingBias = 'crowded_long';
            else if (fundingPct < -0.01) fundingBias = 'crowded_short';

            const snapshot = {
                instId,
                symbol: instId.split('-')[0],
                timestamp: Date.now(),
                price: ticker.last,
                bid: ticker.bid,
                ask: ticker.ask,
                high24h: ticker.high24h,
                low24h: ticker.low24h,
                open24h: ticker.open24h,
                return_1h_pct: return1hPct,
                return_24h_pct: return24hPct,
                recentCloses: closes.slice(-41),
                rsi_14: rsi,
                bollinger: {
                    upper: Number(bb.upper.toFixed(4)),
                    middle: Number(bb.middle.toFixed(4)),
                    lower: Number(bb.lower.toFixed(4)),
                    percent_b: Number(bb.percentB.toFixed(4)),
                    width_pct: Number(bb.width.toFixed(2))
                },
                atr_14: Number(atr.atr.toFixed(4)),
                atr_pct: Number(atr.atrPercent.toFixed(2)),
                funding: {
                    rate_pct: fundingPct,
                    bias: fundingBias
                },
                open_interest: oi,
                htfTrend,
                htf: {
                    ema12: Number(ema12.toFixed(4)),
                    ema26: Number(ema26.toFixed(4)),
                    supertrendDirection: stDirection,
                    trend: htfTrend
                },
                larry_williams: {
                    buy_trigger: lw.buyTrigger,
                    sell_trigger: lw.sellTrigger,
                    status: breakoutStatus
                }
            };

            this.cache.set(instId, snapshot);
            return snapshot;
        } catch (err) {
            // Check cache
            if (this.cache.has(instId)) {
                const cached = this.cache.get(instId);
                return { ...cached, stale: true, error: err.message };
            }
            throw err;
        }
    }

    /**
     * Get snapshots across all configured pairs
     */
    async getAllSnapshots() {
        const results = await Promise.allSettled(this.pairs.map(p => this.getMarketSnapshot(p)));
        const snapshots = {};
        for (let i = 0; i < this.pairs.length; i++) {
            const pair = this.pairs[i];
            const res = results[i];
            if (res.status === 'fulfilled') {
                snapshots[pair] = res.value;
            } else {
                snapshots[pair] = { instId: pair, error: res.reason?.message || 'Failed' };
            }
        }
        return snapshots;
    }
}
