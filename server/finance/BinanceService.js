/**
 * BinanceService - Crypto Exchange Integration
 *
 * Features:
 * - Real-time market data (prices, orderbook, trades)
 * - Spot and Futures trading
 * - Account management
 * - WebSocket streams for live data
 */

import crypto from 'crypto';
import exchangeCredentials from './ExchangeCredentialsService.js';
import riskGateway from './RiskGateway.js';

const BASE_URL = 'https://api.binance.com';
const FUTURES_URL = 'https://fapi.binance.com';
const TESTNET_URL = 'https://testnet.binance.vision';
const TESTNET_FUTURES_URL = 'https://testnet.binancefuture.com';

class BinanceService {
    constructor() {
        this.apiKey = null;
        this.apiSecret = null;
        this.isTestnet = true;
        this.isConnected = false;
        this.wsConnections = new Map();

        // Rate limiter: token bucket (Binance allows 1200 weight/minute)
        this._rateLimiter = {
            tokens: 1200,
            maxTokens: 1200,
            refillRate: 1200 / 60000, // tokens per ms
            lastRefill: Date.now()
        };

        // Auto-connect on startup
        this._autoConnect();
    }

    /**
     * Generate signature for authenticated requests
     */
    _sign(queryString) {
        return crypto
            .createHmac('sha256', this.apiSecret)
            .update(queryString)
            .digest('hex');
    }

    /**
     * Get base URL based on testnet setting
     */
    _getBaseUrl(futures = false) {
        if (this.isTestnet) {
            return futures ? TESTNET_FUTURES_URL : TESTNET_URL;
        }
        return futures ? FUTURES_URL : BASE_URL;
    }

    /**
     * Make authenticated request
     */
    async _request(endpoint, method = 'GET', params = {}, futures = false, signed = false) {
        this._checkRateLimit();
        const baseUrl = this._getBaseUrl(futures);
        let url = `${baseUrl}${endpoint}`;

        if (signed) {
            params.timestamp = Date.now();
            params.recvWindow = 5000;
        }

        const queryString = new URLSearchParams(params).toString();

        if (signed) {
            const signature = this._sign(queryString);
            params.signature = signature;
        }

        const finalQueryString = new URLSearchParams(params).toString();

        const options = {
            method,
            headers: {
                'X-MBX-APIKEY': this.apiKey
            }
        };

        if (method === 'GET' || method === 'DELETE') {
            url += `?${finalQueryString}`;
        } else {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.body = finalQueryString;
        }

        const response = await fetch(url, options);
        if (!response.ok) {
            let errMsg = `HTTP Error ${response.status}`;
            try {
                const errData = await response.json();
                if (errData && errData.msg) {
                    errMsg += `: ${errData.msg}`;
                } else if (errData && errData.message) {
                    errMsg += `: ${errData.message}`;
                }
            } catch (e) {
                // Ignore json parse error
            }
            throw new Error(errMsg);
        }

        const data = await response.json();

        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (data.code !== undefined && data.code < 0) {
                throw new Error(`Binance API Error: ${data.msg} (${data.code})`);
            }
            if (data.msg) {
                throw new Error(`Binance API Error: ${data.msg}`);
            }
        }

        return data;
    }

    /**
     * Auto-connect using stored credentials
     */
    async _autoConnect() {
        const creds = exchangeCredentials.loadCredentials('binance');
        if (creds) {
            console.log('[Binance] Found stored credentials, connecting...');
            try {
                await this.connect(creds.apiKey, creds.secretKey, creds.testnet);
                console.log('[Binance] Auto-connect successful!');
            } catch (e) {
                console.error('[Binance] Auto-connect failed:', e.message);
            }
        }
    }

    /**
     * Connect to Binance
     */
    async connect(apiKey, apiSecret, testnet = true) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.isTestnet = testnet;

        // Test connection
        try {
            const account = await this.getAccount();
            this.isConnected = true;

            // Save credentials
            exchangeCredentials.saveCredentials('binance', {
                apiKey,
                secretKey: apiSecret,
                testnet
            });

            console.log(`[Binance] Connected (${testnet ? 'Testnet' : 'Live'})`);
            return {
                success: true,
                account: {
                    balances: account.balances?.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0) || [],
                    canTrade: account.canTrade,
                    canWithdraw: account.canWithdraw
                }
            };
        } catch (error) {
            this.isConnected = false;
            throw new Error(`Binance connection failed: ${error.message}`);
        }
    }

    /**
     * Disconnect
     */
    disconnect() {
        this.apiKey = null;
        this.apiSecret = null;
        this.isConnected = false;

        // Close all WebSocket connections
        this.wsConnections.forEach(ws => ws.close());
        this.wsConnections.clear();

        console.log('[Binance] Disconnected');
    }

    // ==================== PUBLIC ENDPOINTS ====================

    /**
     * Get current price
     */
    async getPrice(symbol) {
        const data = await this._request('/api/v3/ticker/price', 'GET', { symbol });
        return {
            symbol: data.symbol,
            price: parseFloat(data.price)
        };
    }

    /**
     * Get 24h ticker
     */
    async get24hTicker(symbol) {
        const data = await this._request('/api/v3/ticker/24hr', 'GET', { symbol });
        return {
            symbol: data.symbol,
            priceChange: parseFloat(data.priceChange),
            priceChangePercent: parseFloat(data.priceChangePercent),
            lastPrice: parseFloat(data.lastPrice),
            highPrice: parseFloat(data.highPrice),
            lowPrice: parseFloat(data.lowPrice),
            volume: parseFloat(data.volume),
            quoteVolume: parseFloat(data.quoteVolume)
        };
    }

    /**
     * Get order book
     */
    async getOrderBook(symbol, limit = 20) {
        const data = await this._request('/api/v3/depth', 'GET', { symbol, limit });
        return {
            bids: data.bids.map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) })),
            asks: data.asks.map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) })),
            lastUpdateId: data.lastUpdateId
        };
    }

    /**
     * Get klines/candlesticks
     */
    async getKlines(symbol, interval = '1h', limit = 100) {
        const data = await this._request('/api/v3/klines', 'GET', { symbol, interval, limit });
        return data.map(k => ({
            openTime: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            closeTime: k[6],
            quoteVolume: parseFloat(k[7]),
            trades: k[8]
        }));
    }

    /**
     * Get recent trades
     */
    async getRecentTrades(symbol, limit = 50) {
        const data = await this._request('/api/v3/trades', 'GET', { symbol, limit });
        return data.map(t => ({
            id: t.id,
            price: parseFloat(t.price),
            qty: parseFloat(t.qty),
            time: t.time,
            isBuyerMaker: t.isBuyerMaker
        }));
    }

    // ==================== FUTURES PUBLIC ====================

    /**
     * Get futures funding rate
     */
    async getFundingRate(symbol) {
        const data = await this._request('/fapi/v1/fundingRate', 'GET', { symbol, limit: 1 }, true);
        if (data.length > 0) {
            return {
                symbol: data[0].symbol,
                fundingRate: parseFloat(data[0].fundingRate),
                fundingTime: data[0].fundingTime
            };
        }
        return null;
    }

    /**
     * Get futures open interest
     */
    async getOpenInterest(symbol) {
        const data = await this._request('/fapi/v1/openInterest', 'GET', { symbol }, true);
        return {
            symbol: data.symbol,
            openInterest: parseFloat(data.openInterest),
            time: data.time
        };
    }

    /**
     * Get top long/short ratio
     */
    async getLongShortRatio(symbol, period = '1h', limit = 10) {
        const data = await this._request('/futures/data/topLongShortPositionRatio', 'GET', {
            symbol, period, limit
        }, true);
        return data.map(d => ({
            symbol: d.symbol,
            longShortRatio: parseFloat(d.longShortRatio),
            longAccount: parseFloat(d.longAccount),
            shortAccount: parseFloat(d.shortAccount),
            timestamp: d.timestamp
        }));
    }

    // ==================== PRIVATE ENDPOINTS ====================

    /**
     * Get account information
     */
    async getAccount() {
        this._checkConnection();
        return await this._request('/api/v3/account', 'GET', {}, false, true);
    }

    /**
     * Get futures account
     */
    async getFuturesAccount() {
        this._checkConnection();
        return await this._request('/fapi/v2/account', 'GET', {}, true, true);
    }

    /**
     * Place spot order
     */
    async placeOrder(symbol, side, type, quantity, price = null) {
        this._checkConnection();

        // Intercept with Pre-Trade Risk Gateway
        await riskGateway.validateOrder({
            symbol,
            side,
            qty: quantity,
            price: price || 0,
            type,
            broker: 'binance'
        });

        const params = {
            symbol,
            side: side.toUpperCase(),
            type: type.toUpperCase(),
            quantity
        };

        if (price && type.toUpperCase() === 'LIMIT') {
            params.price = price;
            params.timeInForce = 'GTC';
        }

        const order = await this._request('/api/v3/order', 'POST', params, false, true);

        console.log(`[Binance] Order placed: ${side} ${quantity} ${symbol} @ ${price || 'MARKET'}`);
        return {
            orderId: order.orderId,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            quantity: parseFloat(order.origQty),
            price: parseFloat(order.price),
            status: order.status
        };
    }

    /**
     * Place futures order
     */
    async placeFuturesOrder(symbol, side, type, quantity, price = null, leverage = null) {
        this._checkConnection();

        // Intercept with Pre-Trade Risk Gateway
        await riskGateway.validateOrder({
            symbol,
            side,
            qty: quantity,
            price: price || 0,
            type,
            broker: 'binance'
        });

        // Set leverage if specified
        if (leverage) {
            await this._request('/fapi/v1/leverage', 'POST', { symbol, leverage }, true, true);
        }

        const params = {
            symbol,
            side: side.toUpperCase(),
            type: type.toUpperCase(),
            quantity
        };

        if (price && type.toUpperCase() === 'LIMIT') {
            params.price = price;
            params.timeInForce = 'GTC';
        }

        const order = await this._request('/fapi/v1/order', 'POST', params, true, true);

        console.log(`[Binance Futures] Order placed: ${side} ${quantity} ${symbol} @ ${price || 'MARKET'}`);
        return {
            orderId: order.orderId,
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            quantity: parseFloat(order.origQty),
            price: parseFloat(order.price),
            status: order.status
        };
    }

    /**
     * Cancel order
     */
    async cancelOrder(symbol, orderId) {
        this._checkConnection();
        return await this._request('/api/v3/order', 'DELETE', { symbol, orderId }, false, true);
    }

    /**
     * Get open orders
     */
    async getOpenOrders(symbol = null) {
        this._checkConnection();
        const params = symbol ? { symbol } : {};
        return await this._request('/api/v3/openOrders', 'GET', params, false, true);
    }

    /**
     * Get order history
     */
    async getOrderHistory(symbol, limit = 50) {
        this._checkConnection();
        return await this._request('/api/v3/allOrders', 'GET', { symbol, limit }, false, true);
    }

    // ==================== EMERGENCY ====================

    /**
     * Emergency stop: cancel all open orders + close futures positions
     */
    async emergencyStop() {
        this._checkConnection();
        console.error('[Binance] *** EMERGENCY STOP TRIGGERED ***');

        const results = { spotOrdersCancelled: 0, futuresOrdersCancelled: 0, futuresPositionsClosed: 0, errors: [] };

        // 1. Cancel all open spot orders
        try {
            const openOrders = await this.getOpenOrders();
            for (const order of openOrders) {
                try {
                    await this.cancelOrder(order.symbol, order.orderId);
                    results.spotOrdersCancelled++;
                    console.log(`[Binance] EMERGENCY: Cancelled spot order ${order.orderId} (${order.symbol})`);
                } catch (e) {
                    results.errors.push(`Failed to cancel spot order ${order.orderId}: ${e.message}`);
                }
            }
        } catch (e) {
            results.errors.push(`Failed to fetch open spot orders: ${e.message}`);
        }

        // 2. Cancel all open futures orders + close futures positions
        try {
            const futuresAccount = await this.getFuturesAccount();
            const openPositions = (futuresAccount.positions || []).filter(
                p => parseFloat(p.positionAmt) !== 0
            );

            // Cancel open futures orders
            try {
                const futuresOrders = await this._request('/fapi/v1/openOrders', 'GET', {}, true, true);
                for (const order of futuresOrders) {
                    try {
                        await this._request('/fapi/v1/order', 'DELETE', {
                            symbol: order.symbol,
                            orderId: order.orderId
                        }, true, true);
                        results.futuresOrdersCancelled++;
                        console.log(`[Binance] EMERGENCY: Cancelled futures order ${order.orderId}`);
                    } catch (e) {
                        results.errors.push(`Failed to cancel futures order ${order.orderId}: ${e.message}`);
                    }
                }
            } catch (e) {
                results.errors.push(`Failed to fetch open futures orders: ${e.message}`);
            }

            // Close open futures positions with market orders
            for (const pos of openPositions) {
                const amt = parseFloat(pos.positionAmt);
                const side = amt > 0 ? 'SELL' : 'BUY';
                try {
                    await this._request('/fapi/v1/order', 'POST', {
                        symbol: pos.symbol,
                        side,
                        type: 'MARKET',
                        quantity: Math.abs(amt),
                        reduceOnly: 'true'
                    }, true, true);
                    results.futuresPositionsClosed++;
                    console.log(`[Binance] EMERGENCY: Closed futures position ${pos.symbol} (${amt})`);
                } catch (e) {
                    results.errors.push(`Failed to close futures position ${pos.symbol}: ${e.message}`);
                }
            }
        } catch (e) {
            // Futures account may not exist — that's fine for spot-only users
            if (!e.message.includes('-4004') && !e.message.includes('Not Found')) {
                results.errors.push(`Failed to process futures: ${e.message}`);
            }
        }

        console.log(`[Binance] EMERGENCY STOP COMPLETE: ${results.spotOrdersCancelled} spot orders, ${results.futuresPositionsClosed} futures positions closed`);
        return results;
    }

    // ==================== UTILITIES ====================

    /**
     * Rate limit check (token bucket)
     */
    _checkRateLimit() {
        const now = Date.now();
        const elapsed = now - this._rateLimiter.lastRefill;

        this._rateLimiter.tokens = Math.min(
            this._rateLimiter.maxTokens,
            this._rateLimiter.tokens + elapsed * this._rateLimiter.refillRate
        );
        this._rateLimiter.lastRefill = now;

        if (this._rateLimiter.tokens < 1) {
            throw new Error('Binance API rate limit reached (1200/min). Try again in a few seconds.');
        }

        this._rateLimiter.tokens -= 1;
    }

    /**
     * Check connection status
     */
    _checkConnection() {
        if (!this.isConnected || !this.apiKey || !this.apiSecret) {
            throw new Error('Not connected to Binance. Configure API keys first.');
        }
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            mode: this.isTestnet ? 'testnet' : 'live',
            credentialsSaved: exchangeCredentials.hasCredentials('binance')
        };
    }

    /**
     * Calculate order book metrics
     */
    calculateOrderBookMetrics(orderBook) {
        const bidVolume = orderBook.bids.reduce((sum, b) => sum + b.qty, 0);
        const askVolume = orderBook.asks.reduce((sum, a) => sum + a.qty, 0);
        const totalVolume = bidVolume + askVolume;

        const imbalance = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;
        const spread = orderBook.asks[0]?.price && orderBook.bids[0]?.price
            ? (orderBook.asks[0].price - orderBook.bids[0].price) / orderBook.bids[0].price
            : 0;

        return {
            bidVolume,
            askVolume,
            imbalance, // Positive = buy pressure, negative = sell pressure
            spreadPercent: spread * 100,
            midPrice: (orderBook.asks[0]?.price + orderBook.bids[0]?.price) / 2
        };
    }
}

// Singleton instance
const binanceService = new BinanceService();
export default binanceService;
