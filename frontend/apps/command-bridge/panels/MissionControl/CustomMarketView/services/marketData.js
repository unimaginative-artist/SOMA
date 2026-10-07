// services/marketData.js
// --- REAL MARKET DATA SERVICE ---
// Connects to Binance REST + WebSocket for live data.
// Falls back to local simulation ONLY when all real sources are unreachable.

// ── SIMULATION FALLBACK (used only when real sources fail) ──
const VOLATILITY_BASE = 2;
const MOMENTUM_FACTOR = 0.95;

let simPrice = 1000;
let simMomentum = 0;

const TIMEFRAME_MS = {
    '1Min': 60_000,
    '5Min': 5 * 60_000,
    '15Min': 15 * 60_000,
    '1H': 60 * 60_000,
    '1D': 24 * 60 * 60_000
};

const BINANCE_INTERVALS = {
    '1Min': '1m',
    '5Min': '5m',
    '15Min': '15m',
    '1H': '1h',
    '1D': '1d'
};

const generateSimTick = (lastPoint = undefined) => {
    const noise = (Math.random() - 0.5) * VOLATILITY_BASE;
    const regimeShift = (Math.random() - 0.5) * 0.1;
    simMomentum = (simMomentum * MOMENTUM_FACTOR) + noise + regimeShift;
    const open = lastPoint ? lastPoint.close : simPrice;
    simPrice = open + simMomentum;
    const volatility = Math.abs(simMomentum) + Math.random() * 2;
    const volume = Math.floor(Math.abs(simMomentum) * 1000 + Math.random() * 500);

    return {
        time: Date.now(),
        open,
        high: Math.max(open, simPrice) + Math.random() * volatility,
        low: Math.min(open, simPrice) - Math.random() * volatility,
        close: simPrice,
        volume,
        momentum: simMomentum,
        isSimulation: true // Always flag simulation data
    };
};

// Re-export for CustomMarketView fallback analysis engine
export const generateNextTick = generateSimTick;

export const generateHistory = (count, startPrice = 1000) => {
    simPrice = startPrice;
    simMomentum = 0;
    const history = [];
    let lastPoint = undefined;
    for (let i = 0; i < count; i++) {
        const point = generateSimTick(lastPoint);
        point.time = Date.now() - (count - i) * 1000;
        history.push(point);
        lastPoint = point;
    }
    return history;
};

const normalizeBars = (bars = [], isSimulation = false) => bars
    .map((b) => {
        const rawTime = b.timestamp ?? b.time ?? Date.now();
        const numericTime = Number(rawTime);
        const parsedTime = Number.isFinite(numericTime) ? numericTime : Date.parse(rawTime);
        const timestamp = Number.isFinite(parsedTime) ? parsedTime : Date.now();
        return {
            ...b,
            time: b.time ?? timestamp,
            timestamp,
            open: Number(b.open),
            high: Number(b.high),
            low: Number(b.low),
            close: Number(b.close),
            volume: Number(b.volume || 0),
            isSimulation: Boolean(isSimulation || b.isSimulation || b.isMock)
        };
    })
    .filter(b => Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close));

// ── BINANCE SYMBOL MAPPING ──
const toBinanceSymbol = (symbol) => {
    const upper = (symbol || '').toUpperCase();
    if (upper.endsWith('USDT')) return upper;
    if (upper.includes('-USD')) return upper.replace('-USD', 'USDT');
    if (upper.includes('-')) return upper.replace('-', '') + 'USDT';
    return upper + 'USDT';
};

// Approximate prices for simulation seed
const APPROX_PRICES = {
    'BTCUSDT': 96500, 'ETHUSDT': 3650, 'SOLUSDT': 240,
    'XRPUSDT': 2.5, 'BNBUSDT': 600, 'ADAUSDT': 0.9
};

/**
 * Fetch real historical klines from Binance REST API.
 * Falls back to SOMA backend proxy, then to simulation.
 */
export const getHistoricalData = async (symbol, options = {}) => {
    const timeframe = options.timeframe || '1Min';
    const limit = options.limit || 1000;
    const binanceSymbol = toBinanceSymbol(symbol);
    const binanceInterval = BINANCE_INTERVALS[timeframe] || '1m';

    // Strategy 1: SOMA backend proxy (server-to-server, no CORS issues)
    try {
        const res = await fetch(`/api/market/bars/${encodeURIComponent(symbol)}?timeframe=${encodeURIComponent(timeframe)}&limit=${encodeURIComponent(limit)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.bars?.length > 0) {
                console.log(`[MarketData] SOMA backend: ${data.bars.length} ${timeframe} bars for ${symbol}`);
                return normalizeBars(data.bars, false);
            }
        }
    } catch (e) {
        console.warn(`[MarketData] SOMA backend failed for ${symbol}:`, e.message);
    }

    // Strategy 2: Direct Binance REST (may CORS-fail from browser, but works in some environments)
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&limit=${limit}`,
            { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (res.ok) {
            const raw = await res.json();
            if (Array.isArray(raw) && raw.length > 0) {
                console.log(`[MarketData] Binance REST: ${raw.length} ${binanceInterval} bars for ${binanceSymbol}`);
                return normalizeBars(raw.map(k => ({
                    time: k[0],
                    timestamp: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                    isSimulation: false
                })), false);
            }
        }
    } catch (e) {
        // Expected to CORS-fail from browser — backend proxy is the primary path
    }

    // Strategy 3: Simulation fallback (clearly labeled)
    console.warn(`[MarketData] All real sources failed for ${symbol} — using SIMULATION data`);
    const startPrice = APPROX_PRICES[binanceSymbol] || 1000;
    simPrice = startPrice;
    simMomentum = 0;
    const history = [];
    let lastPoint = undefined;
    const intervalMs = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS['1Min'];
    for (let i = 0; i < limit; i++) {
        const point = generateSimTick(lastPoint);
        point.time = Date.now() - (limit - i) * intervalMs;
        point.timestamp = point.time;
        history.push(point);
        lastPoint = point;
    }
    return normalizeBars(history, true);
};

/**
 * Real-time market data stream.
 * Tries Binance WebSocket first, falls back to SOMA backend polling, then simulation.
 */
export class MarketStream {
    constructor(symbol, onTick, options = {}) {
        this.symbol = symbol;
        this.onTick = onTick;
        this.timeframe = options.timeframe || '1Min';
        this.ws = null;
        this.intervalId = null;
        this.isReal = false;
        this.connect();
    }

    connect() {
        const binanceSymbol = toBinanceSymbol(this.symbol).toLowerCase();
        const binanceInterval = BINANCE_INTERVALS[this.timeframe] || '1m';

        // Strategy 1: Binance WebSocket (real-time klines)
        try {
            const wsUrl = `wss://stream.binance.com:9443/ws/${binanceSymbol}@kline_${binanceInterval}`;
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log(`[MarketStream] Binance WS connected for ${binanceSymbol}`);
                this.isReal = true;
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.k) {
                        const k = msg.k;
                        this.onTick({
                            time: k.t,
                            open: parseFloat(k.o),
                            high: parseFloat(k.h),
                            low: parseFloat(k.l),
                            close: parseFloat(k.c),
                            volume: parseFloat(k.v),
                            isSimulation: false,
                            isClosed: k.x
                        });
                    }
                } catch (e) { /* ignore parse errors */ }
            };

            this.ws.onerror = () => {
                console.warn(`[MarketStream] Binance WS error — falling back`);
                this._fallbackToPolling();
            };

            this.ws.onclose = () => {
                if (this.isReal) {
                    console.warn(`[MarketStream] Binance WS closed — falling back`);
                    this.isReal = false;
                    this._fallbackToPolling();
                }
            };

            // If WebSocket doesn't connect within 5s, fall back
            setTimeout(() => {
                if (!this.isReal && !this.intervalId) {
                    console.warn(`[MarketStream] Binance WS timeout — falling back`);
                    this._fallbackToPolling();
                }
            }, 5000);

        } catch (e) {
            console.warn(`[MarketStream] WebSocket init failed:`, e.message);
            this._fallbackToPolling();
        }
    }

    _fallbackToPolling() {
        if (this.intervalId) return; // Already polling

        let backendFailed = false;
        this.intervalId = setInterval(async () => {
            if (!backendFailed) {
                try {
                    const res = await fetch(`/api/market/bars/${encodeURIComponent(this.symbol)}?timeframe=${encodeURIComponent(this.timeframe)}&limit=2`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.success && data.bars?.length > 0) {
                            const latest = data.bars[data.bars.length - 1];
                            this.onTick({ ...latest, isSimulation: false });
                            return;
                        }
                    }
                    backendFailed = true;
                } catch (e) {
                    backendFailed = true;
                    console.warn(`[MarketStream] Backend polling failed — using simulation`);
                }
            }

            // Strategy 3: Simulation fallback
            this.onTick(generateSimTick());
        }, 2000);
    }

    close() {
        if (this.ws) {
            try { this.ws.close(); } catch (e) { /* ignore */ }
            this.ws = null;
        }
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isReal = false;
        console.log(`[MarketStream] Closed for ${this.symbol}`);
    }
}
