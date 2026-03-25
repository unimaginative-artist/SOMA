/**
 * AlpacaService - Real Money Trading Integration
 *
 * Connects SOMA's FinanceAgentArbiter to Alpaca Markets for real/paper trading
 * Supports both paper trading (virtual money) and live trading (real money)
 */

import Alpaca from '@alpacahq/alpaca-trade-api';
import exchangeCredentials from './ExchangeCredentialsService.js';

class AlpacaService {
  constructor() {
    this.client = null;
    this.stream = null; // WebSocket stream
    this.isPaperTrading = true;
    this.isConnected = false;
    this.accountInfo = null;
    this.credentialsSaved = false;
    this.currentCredentialType = null; // 'alpaca_paper' or 'alpaca_live'

    // Rate limiter: token bucket (Alpaca allows 200 requests/minute)
    this._rateLimiter = {
      tokens: 200,
      maxTokens: 200,
      refillRate: 200 / 60000, // tokens per ms
      lastRefill: Date.now()
    };
  }

  /**
   * Initialize service and auto-connect if credentials exist
   */
  async initialize() {
    await this._autoConnect();
    return this;
  }

  /**
   * Save credentials to disk (encrypted) - delegates to shared service
   * @param {string} apiKey - Alpaca API Key
   * @param {string} apiSecret - Alpaca API Secret
   * @param {boolean} paperTrading - Is this paper trading mode
   * @param {string} credentialType - Optional explicit type: 'alpaca_paper' or 'alpaca_live'
   */
  saveCredentials(apiKey, apiSecret, paperTrading, credentialType = null) {
    // Determine credential type based on paperTrading flag or explicit type
    const type = credentialType || (paperTrading ? 'alpaca_paper' : 'alpaca_live');
    const result = exchangeCredentials.saveCredentials(type, {
      apiKey,
      secretKey: apiSecret,
      paperTrading
    });
    this.credentialsSaved = result;
    this.currentCredentialType = type;
    return result;
  }

  /**
   * Load credentials from disk - delegates to shared service
   * @param {string} credentialType - 'alpaca_paper', 'alpaca_live', or null for auto-detect
   */
  loadCredentials(credentialType = null) {
    // If specific type requested, load that
    if (credentialType) {
      const creds = exchangeCredentials.loadCredentials(credentialType);
      if (creds) {
        this.credentialsSaved = true;
        this.currentCredentialType = credentialType;
        return {
          apiKey: creds.apiKey,
          apiSecret: creds.secretKey,
          paperTrading: creds.paperTrading
        };
      }
      return null;
    }

    // Auto-detect: try paper first, then live
    const paperCreds = exchangeCredentials.loadCredentials('alpaca_paper');
    if (paperCreds) {
      this.credentialsSaved = true;
      this.currentCredentialType = 'alpaca_paper';
      return {
        apiKey: paperCreds.apiKey,
        apiSecret: paperCreds.secretKey,
        paperTrading: true
      };
    }

    const liveCreds = exchangeCredentials.loadCredentials('alpaca_live');
    if (liveCreds) {
      this.credentialsSaved = true;
      this.currentCredentialType = 'alpaca_live';
      return {
        apiKey: liveCreds.apiKey,
        apiSecret: liveCreds.secretKey,
        paperTrading: false
      };
    }

    // Legacy fallback
    const legacyCreds = exchangeCredentials.loadCredentials('alpaca');
    if (legacyCreds) {
      this.credentialsSaved = true;
      this.currentCredentialType = legacyCreds.paperTrading ? 'alpaca_paper' : 'alpaca_live';
      return {
        apiKey: legacyCreds.apiKey,
        apiSecret: legacyCreds.secretKey,
        paperTrading: legacyCreds.paperTrading
      };
    }

    return null;
  }

  /**
   * Clear saved credentials - delegates to shared service
   * @param {string} credentialType - 'alpaca_paper', 'alpaca_live', or null for current
   */
  clearCredentials(credentialType = null) {
    const type = credentialType || this.currentCredentialType || 'alpaca_paper';
    const result = exchangeCredentials.clearCredentials(type);
    if (type === this.currentCredentialType) {
      this.credentialsSaved = false;
    }
    return result;
  }

  /**
   * Check if credentials are saved - delegates to shared service
   * @param {string} credentialType - Optional: 'alpaca_paper' or 'alpaca_live'
   */
  hasStoredCredentials(credentialType = null) {
    if (credentialType) {
      return exchangeCredentials.hasCredentials(credentialType);
    }
    // Check if either exists
    return exchangeCredentials.hasCredentials('alpaca_paper') ||
           exchangeCredentials.hasCredentials('alpaca_live') ||
           exchangeCredentials.hasCredentials('alpaca'); // Legacy
  }

  /**
   * Auto-connect using stored credentials (prefers paper for safety)
   */
  async _autoConnect() {
    const creds = this.loadCredentials();
    if (creds) {
      console.log(`[Alpaca] Found stored credentials (${this.currentCredentialType}), attempting auto-connect...`);
      // FIRE AND FORGET - Don't block the entire system boot
      this.connect(creds.apiKey, creds.apiSecret, creds.paperTrading, false, this.currentCredentialType)
        .then(() => console.log('[Alpaca] Auto-connect successful!'))
        .catch(e => console.error('[Alpaca] Auto-connect failed:', e.message));
    }
  }

  /**
   * Initialize Alpaca connection with user's API keys
   * @param {string} apiKey - Alpaca API Key
   * @param {string} apiSecret - Alpaca API Secret
   * @param {boolean} paperTrading - Use paper trading mode
   * @param {boolean} saveToStorage - Save credentials to disk for persistence
   * @param {string} credentialType - Optional: 'alpaca_paper' or 'alpaca_live'
   * @param {string} baseUrl - Optional: Custom API Endpoint URL
   */
  async connect(apiKey, apiSecret, paperTrading = true, saveToStorage = true, credentialType = null, baseUrl = null) {
    try {
      const config = {
        keyId: apiKey,
        secretKey: apiSecret,
        paper: paperTrading,
        usePolygon: false
      };

      // Add base URL if provided (overrides paper/live default)
      if (baseUrl) {
        config.baseUrl = baseUrl;
      }

      this.client = new Alpaca(config);
      // Initialize stream (lazy connect)
      this.stream = this.client.data_stream_v2;

      this.isPaperTrading = paperTrading;
      this.currentCredentialType = credentialType || (paperTrading ? 'alpaca_paper' : 'alpaca_live');

      // Test connection by fetching account info with timeout
      this.accountInfo = await Promise.race([
        this.client.getAccount(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Alpaca connection timed out')), 10000))
      ]);
      this.isConnected = true;

      console.log(`[Alpaca] Connected successfully (${paperTrading ? 'Paper' : 'Live'} Trading)`);
      if (baseUrl) console.log(`[Alpaca] Using Custom Endpoint: ${baseUrl}`);
      console.log(`[Alpaca] Account Value: $${this.accountInfo.portfolio_value}`);

      // Save credentials if requested (default: yes)
      if (saveToStorage) {
        // We currently don't save baseUrl in the shared credential service structure 
        // but we can pass it if we update that service or just save the keys.
        // For now, let's just save the keys as before.
        this.saveCredentials(apiKey, apiSecret, paperTrading, credentialType);
      }

      return {
        success: true,
        account: {
          id: this.accountInfo.id,
          cash: parseFloat(this.accountInfo.cash),
          portfolio_value: parseFloat(this.accountInfo.portfolio_value),
          buying_power: parseFloat(this.accountInfo.buying_power),
          equity: parseFloat(this.accountInfo.equity),
          mode: paperTrading ? 'paper' : 'live'
        },
        credentialsSaved: this.credentialsSaved,
        credentialType: this.currentCredentialType
      };
    } catch (error) {
      console.error('[Alpaca] Connection failed:', error.message);
      this.isConnected = false;
      throw new Error(`Alpaca connection failed: ${error.message}`);
    }
  }

  /**
   * Disconnect from Alpaca
   */
  disconnect() {
    if (this.stream) {
      try {
        this.stream.disconnect();
      } catch (e) { /* ignore */ }
    }
    this.client = null;
    this.stream = null;
    this.isConnected = false;
    this.accountInfo = null;
    console.log('[Alpaca] Disconnected');
  }

  /**
   * Connect to WebSocket stream and subscribe to updates
   * @param {string[]} symbols - Array of symbols to subscribe to
   * @param {function} onTrade - Callback for trade updates
   * @param {function} onQuote - Callback for quote updates
   */
  async connectStream(symbols, onTrade, onQuote = null) {
    this._checkConnection();
    if (!this.stream) {
        throw new Error('Stream client not initialized');
    }

    try {
        this.stream.onConnect(() => {
            console.log('[Alpaca] Stream connected');
            this.stream.subscribeForTrades(symbols);
            if (onQuote) this.stream.subscribeForQuotes(symbols);
        });

        this.stream.onError((err) => {
            console.error('[Alpaca] Stream error:', err);
        });

        this.stream.onStockTrade((trade) => {
            if (onTrade) onTrade(trade);
        });

        if (onQuote) {
            this.stream.onStockQuote((quote) => {
                onQuote(quote);
            });
        }

        this.stream.connect();
        console.log(`[Alpaca] Connecting stream for ${symbols.join(', ')}...`);
    } catch (error) {
        console.error('[Alpaca] Stream setup failed:', error.message);
    }
  }

  /**
   * Unsubscribe from stream
   */
  unsubscribe(symbols) {
      if (this.stream) {
          this.stream.unsubscribeFromTrades(symbols);
          this.stream.unsubscribeFromQuotes(symbols);
      }
  }

  /**
   * Get current account information
   */
  async getAccount() {
    this._checkConnection();

    try {
      const account = await this.client.getAccount();
      const positions = await this.client.getPositions();

      return {
        account: {
          cash: parseFloat(account.cash),
          portfolio_value: parseFloat(account.portfolio_value),
          buying_power: parseFloat(account.buying_power),
          equity: parseFloat(account.equity),
          last_equity: parseFloat(account.last_equity),
          pattern_day_trader: account.pattern_day_trader,
          trading_blocked: account.trading_blocked,
          transfers_blocked: account.transfers_blocked
        },
        positions: positions.map(p => ({
          symbol: p.symbol,
          qty: parseFloat(p.qty),
          avg_entry_price: parseFloat(p.avg_entry_price),
          current_price: parseFloat(p.current_price),
          market_value: parseFloat(p.market_value),
          cost_basis: parseFloat(p.cost_basis),
          unrealized_pl: parseFloat(p.unrealized_pl),
          unrealized_plpc: parseFloat(p.unrealized_plpc),
          side: p.side
        }))
      };
    } catch (error) {
      console.error('[Alpaca] Failed to get account:', error.message);
      throw error;
    }
  }

  /**
   * Get recent orders
   */
  async getOrders(status = 'all', limit = 50) {
    this._checkConnection();

    try {
      const orders = await this.client.getOrders({
        status,
        limit,
        direction: 'desc'
      });

      return orders.map(o => ({
        id: o.id,
        client_order_id: o.client_order_id,
        symbol: o.symbol,
        side: o.side,
        qty: parseFloat(o.qty),
        filled_qty: parseFloat(o.filled_qty),
        type: o.type,
        status: o.status,
        filled_avg_price: o.filled_avg_price ? parseFloat(o.filled_avg_price) : null,
        submitted_at: o.submitted_at,
        filled_at: o.filled_at,
        canceled_at: o.canceled_at,
        failed_at: o.failed_at
      }));
    } catch (error) {
      console.error('[Alpaca] Failed to get orders:', error.message);
      throw error;
    }
  }

  /**
   * Execute a market order
   * @param {string} symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} qty
   * @param {string} orderType - 'market', 'limit', 'stop', 'stop_limit'
   * @param {string} timeInForce - 'day', 'gtc', 'ioc', 'fok'
   * @param {object} opts - { waitForFill: boolean, expectedPrice: number }
   */
  async executeOrder(symbol, side, qty, orderType = 'market', timeInForce = 'day', opts = {}) {
    this._checkConnection();
    this._checkRateLimit();

    if (this.accountInfo.trading_blocked) {
      throw new Error('Trading is blocked on this account');
    }

    try {
      console.log(`[Alpaca] Executing ${side.toUpperCase()} order: ${qty} shares of ${symbol}`);

      // Build order params — support bracket orders with SL/TP
      const orderParams = {
        symbol: symbol.toUpperCase(),
        qty: qty,
        side: side,
        type: orderType,
        time_in_force: timeInForce
      };

      // Bracket order: attach stop_loss and/or take_profit legs
      if (opts.stopLoss || opts.takeProfit) {
        orderParams.order_class = 'bracket';
        if (opts.stopLoss) {
          orderParams.stop_loss = { stop_price: opts.stopLoss };
        }
        if (opts.takeProfit) {
          orderParams.take_profit = { limit_price: opts.takeProfit };
        }
        // Bracket orders require both legs for Alpaca — if only one provided, use OTO instead
        if (!opts.stopLoss || !opts.takeProfit) {
          orderParams.order_class = 'oto';
        }
        console.log(`[Alpaca] Bracket order: SL=${opts.stopLoss || 'none'} TP=${opts.takeProfit || 'none'}`);
      }

      let order;
      try {
        order = await this.client.createOrder(orderParams);
      } catch (bracketErr) {
        // Fallback: if bracket/OTO fails, execute as simple order
        if (orderParams.order_class) {
          console.warn(`[Alpaca] Bracket order failed (${bracketErr.message}), falling back to simple order`);
          delete orderParams.order_class;
          delete orderParams.stop_loss;
          delete orderParams.take_profit;
          order = await this.client.createOrder(orderParams);
        } else {
          throw bracketErr;
        }
      }

      console.log(`[Alpaca] Order submitted: ${order.id} (${order.status})`);

      const result = {
        id: order.id,
        client_order_id: order.client_order_id,
        symbol: order.symbol,
        side: order.side,
        qty: parseFloat(order.qty),
        type: order.type,
        status: order.status,
        submitted_at: order.submitted_at,
        filled_avg_price: null,
        filled_at: null
      };

      // For market orders, wait for fill to get actual execution price
      if (orderType === 'market' && opts.waitForFill !== false) {
        try {
          const filled = await this.waitForFill(order.id, 10000, 500);
          result.status = filled.status;
          result.filled_avg_price = filled.filled_avg_price;
          result.filled_qty = filled.filled_qty;
          result.filled_at = filled.filled_at;
          result._timedOut = filled._timedOut || false;

          if (filled.status === 'filled') {
            console.log(`[Alpaca] Order filled: ${qty} ${symbol} @ $${filled.filled_avg_price}`);
          } else if (filled._timedOut) {
            console.warn(`[Alpaca] Fill wait timed out for ${order.id}, status: ${filled.status}`);
          }

          // Track slippage if expected price provided
          if (opts.expectedPrice && filled.filled_avg_price) {
            const slippage = Math.abs(filled.filled_avg_price - opts.expectedPrice) / opts.expectedPrice;
            result.slippage = slippage;
            result.slippagePercent = (slippage * 100).toFixed(3) + '%';
            if (slippage > 0.005) {
              console.warn(`[Alpaca] High slippage on ${symbol}: ${result.slippagePercent} (expected $${opts.expectedPrice}, got $${filled.filled_avg_price})`);
            }
          }
        } catch (fillErr) {
          console.warn(`[Alpaca] Fill verification failed: ${fillErr.message}`);
        }
      }

      return result;
    } catch (error) {
      console.error(`[Alpaca] Order failed:`, error.message);
      throw new Error(`Failed to execute order: ${error.message}`);
    }
  }

  /**
   * Place a trailing stop order.
   * @param {string} symbol
   * @param {string} side - 'buy' or 'sell'
   * @param {number} qty
   * @param {number} trailPercent - trail distance as % (e.g. 2 = 2%)
   */
  async placeTrailingStopOrder(symbol, side, qty, trailPercent) {
    this._checkConnection();
    this._checkRateLimit();

    if (!symbol || !side || !qty || !trailPercent) {
      throw new Error('symbol, side, qty, and trailPercent are required');
    }
    if (trailPercent <= 0 || trailPercent > 50) {
      throw new Error('trailPercent must be between 0 and 50');
    }

    try {
      console.log(`[Alpaca] Placing trailing stop: ${side.toUpperCase()} ${qty} ${symbol} trail=${trailPercent}%`);
      const order = await this.client.createOrder({
        symbol: symbol.toUpperCase(),
        qty,
        side,
        type: 'trailing_stop',
        time_in_force: 'gtc',
        trail_percent: trailPercent.toString()
      });

      console.log(`[Alpaca] Trailing stop submitted: ${order.id} (${order.status})`);
      return {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        qty: parseFloat(order.qty),
        type: 'trailing_stop',
        trailPercent,
        status: order.status,
        submitted_at: order.submitted_at
      };
    } catch (error) {
      console.error(`[Alpaca] Trailing stop failed:`, error.message);
      throw new Error(`Failed to place trailing stop: ${error.message}`);
    }
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId) {
    this._checkConnection();
    this._checkRateLimit();

    try {
      const order = await this.client.getOrder(orderId);

      return {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        qty: parseFloat(order.qty),
        filled_qty: parseFloat(order.filled_qty),
        status: order.status,
        filled_avg_price: order.filled_avg_price ? parseFloat(order.filled_avg_price) : null,
        submitted_at: order.submitted_at,
        filled_at: order.filled_at
      };
    } catch (error) {
      console.error('[Alpaca] Failed to get order status:', error.message);
      throw error;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId) {
    this._checkConnection();
    this._checkRateLimit();

    try {
      await this.client.cancelOrder(orderId);
      console.log(`[Alpaca] Order ${orderId} cancelled`);
      return { success: true, orderId };
    } catch (error) {
      console.error('[Alpaca] Failed to cancel order:', error.message);
      throw error;
    }
  }

  /**
   * Get real-time quote for a symbol
   */
  async getQuote(symbol) {
    this._checkConnection();
    this._checkRateLimit();

    try {
      const quote = await this.client.getLatestTrade(symbol);

      return {
        symbol: symbol,
        price: parseFloat(quote.p),
        size: parseFloat(quote.s),
        timestamp: quote.t
      };
    } catch (error) {
      console.error(`[Alpaca] Failed to get quote for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get position for a specific symbol
   */
  async getPosition(symbol) {
    this._checkConnection();

    try {
      const position = await this.client.getPosition(symbol);

      return {
        symbol: position.symbol,
        qty: parseFloat(position.qty),
        avg_entry_price: parseFloat(position.avg_entry_price),
        current_price: parseFloat(position.current_price),
        market_value: parseFloat(position.market_value),
        cost_basis: parseFloat(position.cost_basis),
        unrealized_pl: parseFloat(position.unrealized_pl),
        unrealized_plpc: parseFloat(position.unrealized_plpc),
        side: position.side
      };
    } catch (error) {
      if (error.message.includes('404')) {
        return null; // No position exists
      }
      throw error;
    }
  }

  /**
   * Close position for a symbol
   */
  async closePosition(symbol) {
    this._checkConnection();

    try {
      const result = await this.client.closePosition(symbol);
      console.log(`[Alpaca] Closed position for ${symbol}`);
      return result;
    } catch (error) {
      console.error(`[Alpaca] Failed to close position for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all open positions
   */
  async getPositions() {
    this._checkConnection();

    try {
      const positions = await this.client.getPositions();
      return positions.map(p => ({
        symbol: p.symbol,
        qty: parseFloat(p.qty),
        avg_entry_price: parseFloat(p.avg_entry_price),
        current_price: parseFloat(p.current_price),
        market_value: parseFloat(p.market_value),
        cost_basis: parseFloat(p.cost_basis),
        unrealized_pl: parseFloat(p.unrealized_pl),
        unrealized_plpc: parseFloat(p.unrealized_plpc),
        side: p.side
      }));
    } catch (error) {
      console.error('[Alpaca] Failed to get positions:', error.message);
      throw error;
    }
  }

  /**
   * Emergency: Close ALL positions and cancel ALL open orders
   */
  async closeAllPositions() {
    this._checkConnection();

    try {
      // Cancel all open orders first
      const orders = await this.client.getOrders({ status: 'open' });
      for (const order of orders) {
        try {
          await this.client.cancelOrder(order.id);
        } catch (e) {
          console.warn(`[Alpaca] Failed to cancel order ${order.id}:`, e.message);
        }
      }

      // Close all positions
      const positions = await this.client.getPositions();
      const results = [];
      for (const pos of positions) {
        try {
          const result = await this.client.closePosition(pos.symbol);
          results.push({ symbol: pos.symbol, status: 'closed' });
          console.log(`[Alpaca] EMERGENCY: Closed ${pos.symbol}`);
        } catch (e) {
          results.push({ symbol: pos.symbol, status: 'failed', error: e.message });
          console.error(`[Alpaca] EMERGENCY: Failed to close ${pos.symbol}:`, e.message);
        }
      }

      console.log(`[Alpaca] EMERGENCY STOP COMPLETE: ${results.length} positions processed`);
      return { ordersCanelled: orders.length, positions: results };
    } catch (error) {
      console.error('[Alpaca] Emergency close all failed:', error.message);
      throw error;
    }
  }

  /**
   * Wait for an order to fill (polls until terminal state)
   * @param {string} orderId - Order ID to monitor
   * @param {number} timeoutMs - Max wait time (default 10s)
   * @param {number} intervalMs - Poll interval (default 500ms)
   * @returns {object} Final order state with fill info
   */
  async waitForFill(orderId, timeoutMs = 10000, intervalMs = 500) {
    this._checkConnection();
    const start = Date.now();
    const terminalStates = ['filled', 'canceled', 'expired', 'rejected', 'replaced'];

    while (Date.now() - start < timeoutMs) {
      const order = await this.getOrderStatus(orderId);
      if (terminalStates.includes(order.status)) {
        return order;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    // Timeout - return last known state
    const finalOrder = await this.getOrderStatus(orderId);
    finalOrder._timedOut = true;
    return finalOrder;
  }

  /**
   * Token-bucket rate limiter - call before every API request
   * Alpaca limit: 200 requests/minute
   */
  _checkRateLimit() {
    const now = Date.now();
    const elapsed = now - this._rateLimiter.lastRefill;

    // Refill tokens based on elapsed time
    this._rateLimiter.tokens = Math.min(
      this._rateLimiter.maxTokens,
      this._rateLimiter.tokens + elapsed * this._rateLimiter.refillRate
    );
    this._rateLimiter.lastRefill = now;

    if (this._rateLimiter.tokens < 1) {
      throw new Error('Alpaca API rate limit reached (200/min). Try again in a few seconds.');
    }

    this._rateLimiter.tokens -= 1;
  }

  /**
   * Check if connected
   */
  _checkConnection() {
    if (!this.isConnected || !this.client) {
      throw new Error('Not connected to Alpaca. Please connect first.');
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      mode: this.isPaperTrading ? 'paper' : 'live',
      account_value: this.accountInfo ? parseFloat(this.accountInfo.portfolio_value) : 0,
      credentialsSaved: this.hasStoredCredentials(),
      credentialType: this.currentCredentialType,
      hasPaperCredentials: exchangeCredentials.hasCredentials('alpaca_paper'),
      hasLiveCredentials: exchangeCredentials.hasCredentials('alpaca_live')
    };
  }
}

// Singleton instance
const alpacaService = new AlpacaService();

export default alpacaService;
