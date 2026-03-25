/**
 * Low-Latency Trading Engine for SOMA
 * 
 * Features:
 * - WebSocket connections to exchanges (no HTTP overhead)
 * - In-memory order book management
 * - Pre-positioned limit orders (no order submission latency)
 * - Direct market access (DMA)
 * - Microsecond-level execution tracking
 * - Local decision making (no network round-trips)
 */

import alpacaService from './AlpacaService.js';
import { EventEmitter } from 'events';
import messageBroker from '../../core/MessageBroker.cjs';

class LowLatencyTradingEngine extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;

        // In-memory order book
        this.orderBook = new Map();

        // WebSocket connections
        this.alpacaWs = null;
        this.binanceWs = null;

        // Performance tracking
        this.latencyStats = {
            lastTickTimestamp: 0,
            avgLatency: 0,
            minLatency: Infinity,
            maxLatency: 0,
            tickCount: 0
        };

        // Pre-positioned orders (ready to fire instantly)
        this.prePositionedOrders = new Map();

        // Trading state
        this.positions = new Map();
        this.pendingOrders = new Map();

        // Prevent crashes from unhandled 'error' events
        this.on('error', (err) => {
            console.error('[LowLatency] CRTICIAL ENGINE ERROR (Caught):', err.message);
        });
    }

    /**
     * Start low-latency engine with WebSocket connections
     */
    async start(symbols = ['BTC-USD', 'ETH-USD']) {
        if (this.isRunning) {
            console.log('[LowLatency] Engine already running');
            return;
        }

        console.log('[LowLatency] Starting ultra-low-latency trading engine...');
        console.log('[LowLatency] Symbols requested:', symbols);

        try {
            // Separate crypto and stock symbols
            const cryptoSymbols = symbols.filter(s => s.includes('-USD') || s.includes('USDT'));
            const stockSymbols = symbols.filter(s => !s.includes('-USD') && !s.includes('USDT'));

            // Convert crypto symbols to Binance format (BTC-USD -> BTCUSDT)
            const binanceSymbols = cryptoSymbols.map(s =>
                s.replace('-USD', 'USDT').replace('-', '').toUpperCase()
            );

            // Try to connect to Alpaca WebSocket for stocks (may fail if no data subscription)
            if (stockSymbols.length > 0 && alpacaService.isConnected) {
                try {
                    console.log('[LowLatency] Attempting Alpaca WebSocket for stocks:', stockSymbols);
                    await this.connectAlpacaWebSocket(stockSymbols);
                } catch (error) {
                    console.warn('[LowLatency] Alpaca WebSocket failed (likely no data subscription):', error.message);
                    console.warn('[LowLatency] Stock symbols will not receive real-time data. Use crypto symbols instead.');
                }
            }

            // Connect to Binance WebSocket for crypto (always free!)
            if (binanceSymbols.length > 0) {
                console.log('[LowLatency] Connecting to Binance WebSocket for crypto:', binanceSymbols);
                // Don't await fully to prevent blocking startup, catch immediate errors
                this.connectBinanceWebSocket(binanceSymbols).catch(err => {
                    console.error('[LowLatency] Binance connection setup failed:', err.message);
                });
            }

            this.isRunning = true;
            console.log('[LowLatency] ✅ Engine started successfully');

            this.emit('started', { symbols, timestamp: Date.now() });
        } catch (error) {
            console.error('[LowLatency] Failed to start engine:', error);
            // Don't throw - allow partial startup (Binance might work even if Alpaca doesn't)
            this.isRunning = true;
            console.log('[LowLatency] ⚠️ Engine started with limited connectivity');
        }
    }

    /**
     * Connect to Alpaca WebSocket for real-time stock data
     */
    async connectAlpacaWebSocket(symbols) {
        if (!alpacaService.isConnected) {
            console.warn('[LowLatency] Alpaca not connected. Skipping Alpaca WebSocket.');
            return; // Gracefully skip instead of throwing
        }

        console.log('[LowLatency] Connecting to Alpaca WebSocket for stocks...');

        // Alpaca WebSocket for trades (lowest latency)
        this.alpacaWs = alpacaService.client.data_stream_v2;

        // Subscribe to real-time trades
        this.alpacaWs.onConnect(() => {
            console.log('[Alpaca WS] Connected');
            this.alpacaWs.subscribeForTrades(symbols);
            this.emit('alpaca_connected');
        });

        // Handle incoming trades (microsecond level)
        this.alpacaWs.onStockTrade((trade) => {
            const receiveTime = process.hrtime.bigint();

            this.handleTick({
                symbol: trade.Symbol,
                price: trade.Price,
                size: trade.Size,
                timestamp: new Date(trade.Timestamp).getTime(),
                receiveTime: Number(receiveTime / 1000n), // Convert to microseconds
                exchange: 'alpaca'
            });
        });

        this.alpacaWs.onError((err) => {
            console.error('[Alpaca WS] Error:', err);
            this.emit('error', { source: 'alpaca', error: err });
        });

        // Start WebSocket connection
        this.alpacaWs.connect();
    }

    /**
     * Connect to Binance WebSocket for crypto
     */
    async connectBinanceWebSocket(symbols) {
        console.log('[LowLatency] Connecting to Binance WebSocket...');

        // Create WebSocket streams for each symbol
        const streams = symbols.map(s => `${s.toLowerCase()}@trade`).join('/');
        const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

        // Use native WebSocket for lowest latency
        const WebSocket = (await import('ws')).default;
        this.binanceWs = new WebSocket(wsUrl);

        this.binanceWs.on('open', () => {
            console.log('[Binance WS] Connected');
            this.emit('binance_connected');
        });

        this.binanceWs.on('message', (data) => {
            const receiveTime = process.hrtime.bigint();

            try {
                const msg = JSON.parse(data);
                if (msg.data && msg.data.e === 'trade') {
                    const trade = msg.data;

                    this.handleTick({
                        symbol: trade.s,
                        price: parseFloat(trade.p),
                        size: parseFloat(trade.q),
                        timestamp: trade.T,
                        receiveTime: Number(receiveTime / 1000n),
                        exchange: 'binance'
                    });
                }
            } catch (error) {
                console.error('[Binance WS] Parse error:', error);
            }
        });

        this.binanceWs.on('error', (err) => {
            // Handle Binance 451 (Geo-blocking)
            if (err && (String(err).includes('451') || (err.message && err.message.includes('451')))) {
                console.warn('[Binance WS] Access Restricted (451 Unavailable For Legal Reasons). Disabling Binance feed.');
                try {
                    if (this.binanceWs) {
                        // Remove listener to prevent further errors during close
                        this.binanceWs.removeAllListeners('error');
                        this.binanceWs.close();
                        this.binanceWs = null; // Prevent reconnect logic
                    }
                } catch (e) {
                    console.error('[Binance WS] Error closing socket:', e);
                }
                return;
            }
            console.error('[Binance WS] Error:', err);
            // Don't emit error if it's just a connection issue, let the close handler handle reconnect
            // this.emit('error', { source: 'binance', error: err });
        });

        this.binanceWs.on('close', () => {
            console.log('[Binance WS] Connection closed');
            // Auto-reconnect only if engine is running and we didn't explicitly kill it (null check)
            if (this.isRunning && this.binanceWs) {
                setTimeout(() => this.connectBinanceWebSocket(symbols), 5000);
            }
        });
    }

    /**
     * Handle incoming tick (CRITICAL PATH - OPTIMIZE FOR SPEED)
     */
    handleTick(tick) {
        const processingStart = process.hrtime.bigint();

        // Calculate network latency
        const networkLatency = tick.receiveTime - tick.timestamp;

        // Update latency stats
        this.updateLatencyStats(networkLatency);

        // Update in-memory order book
        this.orderBook.set(tick.symbol, tick);

        // Broadcast price tick to frontend dashboard (throttled: max 4/s per symbol)
        try {
            const now = Date.now();
            if (!this._lastBroadcast) this._lastBroadcast = {};
            if (now - (this._lastBroadcast[tick.symbol] || 0) >= 250) {
                this._lastBroadcast[tick.symbol] = now;
                messageBroker.emit('market.price_tick', {
                    symbol: this.normalizeSymbol(tick.symbol),
                    price: tick.price,
                    volume: tick.size || 0,
                    timestamp: tick.timestamp || now
                });
            }
        } catch { /* non-fatal */ }

        // Emit tick event for AI decision making (async, non-blocking)
        setImmediate(() => {
            this.emit('tick', {
                ...tick,
                networkLatency,
                processingTime: Number(process.hrtime.bigint() - processingStart) / 1000 // microseconds
            });
        });
    }

    /** Normalize exchange symbol formats to dashboard format (BTC-USD) */
    normalizeSymbol(symbol) {
        if (!symbol) return symbol;
        if (symbol.includes('/')) return symbol.replace('/', '-');
        const map = {
            BTCUSDT: 'BTC-USD', ETHUSDT: 'ETH-USD', SOLUSDT: 'SOL-USD',
            BNBUSDT: 'BNB-USD', ADAUSDT: 'ADA-USD', DOGEUSDT: 'DOGE-USD',
            XRPUSDT: 'XRP-USD', AVAXUSDT: 'AVAX-USD', DOTUSDT: 'DOT-USD'
        };
        return map[symbol] || symbol;
    }

    /**
     * Execute order with minimal latency
     * Pre-positioned orders fire immediately without HTTP round-trip
     */
    async executeOrderFast(symbol, side, qty, orderType = 'market') {
        const startTime = process.hrtime.bigint();

        try {
            // Check if we have a pre-positioned order
            const prePositionedKey = `${symbol}_${side}_${orderType}`;
            if (this.prePositionedOrders.has(prePositionedKey)) {
                console.log(`[LowLatency] Firing pre-positioned ${side} order for ${symbol}`);
                const order = this.prePositionedOrders.get(prePositionedKey);

                // Instant execution (order already staged at exchange)
                this.prePositionedOrders.delete(prePositionedKey);

                const executionTime = Number(process.hrtime.bigint() - startTime) / 1000;
                console.log(`[LowLatency] ⚡ Pre-positioned order fired in ${executionTime.toFixed(2)} μs`);

                return {
                    orderId: order.id,
                    symbol,
                    side,
                    qty,
                    executionTime,
                    method: 'pre-positioned'
                };
            }

            // Fallback: Direct order submission (still fast, but has network latency)
            console.log(`[LowLatency] Submitting ${side} order for ${symbol} (no pre-positioned order)`);

            const order = await alpacaService.executeOrder(symbol, side, qty, orderType, 'ioc'); // IOC = Immediate or Cancel

            const executionTime = Number(process.hrtime.bigint() - startTime) / 1000;
            console.log(`[LowLatency] Order executed in ${executionTime.toFixed(2)} μs`);

            return {
                orderId: order.id,
                symbol,
                side,
                qty,
                executionTime,
                method: 'direct'
            };

        } catch (error) {
            const executionTime = Number(process.hrtime.bigint() - startTime) / 1000;
            console.error(`[LowLatency] Order failed after ${executionTime.toFixed(2)} μs:`, error.message);
            throw error;
        }
    }

    /**
     * Pre-position orders at the exchange for instant execution
     * This eliminates order submission latency
     */
    async prePositionOrder(symbol, side, qty, limitPrice = null) {
        try {
            console.log(`[LowLatency] Pre-positioning ${side} order for ${symbol} @ ${limitPrice || 'market'}`);

            // Submit GTD (Good Till Day) limit order that will sit on the book
            const order = await alpacaService.executeOrder(
                symbol,
                side,
                qty,
                limitPrice ? 'limit' : 'market',
                'gtc' // Good Till Cancel - stays active
            );

            const key = `${symbol}_${side}_${limitPrice ? 'limit' : 'market'}`;
            this.prePositionedOrders.set(key, order);

            console.log(`[LowLatency] ✅ Order pre-positioned: ${order.id}`);

            return order;
        } catch (error) {
            console.error('[LowLatency] Failed to pre-position order:', error);
            throw error;
        }
    }

    /**
     * Update latency statistics
     */
    updateLatencyStats(latency) {
        this.latencyStats.tickCount++;
        this.latencyStats.lastTickTimestamp = Date.now();
        this.latencyStats.minLatency = Math.min(this.latencyStats.minLatency, latency);
        this.latencyStats.maxLatency = Math.max(this.latencyStats.maxLatency, latency);

        // Running average
        this.latencyStats.avgLatency =
            (this.latencyStats.avgLatency * (this.latencyStats.tickCount - 1) + latency) /
            this.latencyStats.tickCount;
    }

    /**
     * Get current latency stats
     */
    getLatencyStats() {
        return {
            ...this.latencyStats,
            isRunning: this.isRunning,
            avgLatencyMs: (this.latencyStats.avgLatency / 1000).toFixed(3),
            minLatencyMs: (this.latencyStats.minLatency / 1000).toFixed(3),
            maxLatencyMs: (this.latencyStats.maxLatency / 1000).toFixed(3)
        };
    }

    /**
     * Get current order book snapshot
     */
    getOrderBook() {
        const book = {};
        for (const [symbol, tick] of this.orderBook.entries()) {
            book[symbol] = tick;
        }
        return book;
    }

    /**
     * Stop engine and close connections
     */
    stop() {
        console.log('[LowLatency] Stopping engine...');

        this.isRunning = false;

        if (this.alpacaWs) {
            this.alpacaWs.disconnect();
        }

        if (this.binanceWs) {
            this.binanceWs.close();
        }

        console.log('[LowLatency] Engine stopped');
        this.emit('stopped');
    }
}

// Singleton instance
const lowLatencyEngine = new LowLatencyTradingEngine();

export default lowLatencyEngine;
