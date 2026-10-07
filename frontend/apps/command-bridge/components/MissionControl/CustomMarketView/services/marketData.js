// services/marketData.js
// --- REAL MARKET DATA SERVICE ---
// Connects to Binance REST + WebSocket for live data.
// Falls back to local simulation ONLY when all real sources are unreachable.

// ── SIMULATION FALLBACK (used only when real sources fail) ──
const VOLATILITY_BASE = 2;
const MOMENTUM_FACTOR = 0.95;

let simPrice = 1000;
let simMomentum = 0;

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
export const getHistoricalData = async (symbol) => {
    const binanceSymbol = toBinanceSymbol(symbol);

    // Strategy 1: SOMA backend proxy (server-to-server, no CORS issues)
    try {
        const res = await fetch(`/api/market/bars/${symbol}?timeframe=1Min&limit=1000`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.bars?.length > 0) {
                console.log(`[MarketData] SOMA backend: ${data.bars.length} bars for ${symbol}`);
                return data.bars.map(b => ({ ...b, isSimulation: false }));
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
            `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1m&limit=1000`,
            { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (res.ok) {
            const raw = await res.json();
            if (Array.isArray(raw) && raw.length > 0) {
                console.log(`[MarketData] Binance REST: ${raw.length} bars for ${binanceSymbol}`);
                return raw.map(k => ({
                    time: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                    isSimulation: false
                }));
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
    for (let i = 0; i < 1000; i++) {
        const point = generateSimTick(lastPoint);
        point.time = Date.now() - (1000 - i) * 60000;
        history.push(point);
        lastPoint = point;
    }
    return history;
};

/**
 * Real-time market data stream.
 * Tries Binance WebSocket first, falls back to SOMA backend polling, then simulation.
 */
export class MarketStream {
    constructor(symbol, onTick) {
        this.symbol = symbol;
        this.onTick = onTick;
        this.ws = null;
        this.intervalId = null;
        this.isReal = false;
        this.connect();
    }

    connect() {
        const binanceSymbol = toBinanceSymbol(this.symbol).toLowerCase();

        // Strategy 1: Binance WebSocket (real-time klines)
        try {
            const wsUrl = `wss://stream.binance.com:9443/ws/${binanceSymbol}@kline_1m`;
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
                    const res = await fetch(`/api/market/bars/${this.symbol}?timeframe=1Min&limit=2`);
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
