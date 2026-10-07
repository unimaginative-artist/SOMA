/**
 * GridBot.js
 *
 * Autonomous crypto grid trading — profits from price oscillation, not prediction.
 *
 * How it works:
 *   1. Divide a price range into N equally-spaced levels
 *   2. Place BUY limit orders at every level BELOW the current price
 *   3. Place SELL limit orders at every level ABOVE the current price
 *   4. When a BUY fills at level N → immediately place SELL at level N+1
 *   5. When a SELL fills at level N → immediately place BUY at level N-1
 *   6. Each completed BUY→SELL cycle captures one grid spacing as profit
 *   7. The bot keeps going as long as price oscillates inside the range
 *
 * Example on BTC/USDT:
 *   Range $95k–$105k, 20 grids, $1000 capital
 *   → Grid spacing = $500
 *   → Capital per grid = $50
 *   → Qty per grid ≈ 0.00053 BTC
 *   → Profit per cycle ≈ $0.265 (before fees)
 *   → 10 crossings/day → ~$2.65/day → ~8%/month on $1000
 *
 * Uses BinanceService for execution (spot orders only — no liquidation risk)
 * Uses GridEngine for level calculation and regime detection
 */

import binanceService from './BinanceService.js';
import gridEngine from './strategies/GridEngine.js';

class GridBot {
    constructor() {
        this.isRunning   = false;
        this.symbol      = null;
        this.config      = null;
        this.gridLevels  = [];      // Sorted array of price levels (ascending)
        this.currentPrice = 0;
        this.highestPrice = 0;

        // orderId → { orderId, levelIndex, side, price, qty, status, placedAt, filledAt }
        this._gridOrders = new Map();

        this._stats = {
            totalProfit:      0,
            totalFees:        0,
            cyclesCompleted:  0,   // Each completed BUY→SELL pair
            buysFilled:       0,
            sellsFilled:      0,
            startTime:        null,
            startPrice:       0,
        };

        // Ring buffer decision log (same pattern as autonomousTrader)
        this._decisions     = new Array(500);
        this._decisionHead  = 0;
        this._decisionCount = 0;

        this._pollTimer          = null;
        this._priceTimer         = null;
        this._pollIntervalMs     = 5000;   // Check fills every 5s
        this._priceIntervalMs    = 15000;  // Refresh price every 15s

        this._regime             = null;
        this._pollCount          = 0;
        this._regimeCheckEvery   = 12;     // Re-detect regime every 12 polls (~1 min)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Start the grid bot.
     * Config:
     *   symbol       — e.g. 'BTCUSDT'
     *   upperPrice   — top of the grid range
     *   lowerPrice   — bottom of the grid range
     *   gridCount    — number of grid levels (10–50 recommended)
     *   totalCapital — total USDT to allocate across all BUY orders
     *   mode         — 'arithmetic' (equal $) or 'geometric' (equal %)
     *   stopLossPct  — emergency stop if price drops X% below lowerPrice (default 0.05)
     *   takeProfitPct— optional: stop if cumulative profit reaches X% of capital
     *   makerFee     — exchange fee rate (default 0.001 = 0.1%)
     */
    async start(symbol, config = {}) {
        if (this.isRunning) {
            return { success: false, error: 'Already running. Stop first.' };
        }
        if (!binanceService.isConnected) {
            return { success: false, error: 'Binance not connected. Configure API keys in Settings.' };
        }
        if (!config.upperPrice || !config.lowerPrice) {
            return { success: false, error: 'upperPrice and lowerPrice are required.' };
        }
        if (config.upperPrice <= config.lowerPrice) {
            return { success: false, error: 'upperPrice must be greater than lowerPrice.' };
        }

        this.symbol = symbol.toUpperCase();
        this.config = {
            upperPrice:          parseFloat(config.upperPrice),
            lowerPrice:          parseFloat(config.lowerPrice),
            gridCount:           parseInt(config.gridCount)    || 20,
            totalCapital:        parseFloat(config.totalCapital) || 1000,
            mode:                config.mode          || 'arithmetic',
            stopLossPct:         parseFloat(config.stopLossPct)  ?? 0.05,
            trailingStopLossPct: config.trailingStopLossPct ? parseFloat(config.trailingStopLossPct) : null,
            takeProfitPct:       config.takeProfitPct ? parseFloat(config.takeProfitPct) : null,
            makerFee:            parseFloat(config.makerFee)     ?? 0.001,
        };

        try {
            // 1. Get current price
            const priceData = await binanceService.getPrice(this.symbol);
            this.currentPrice = priceData.price;

            // 2. Warn if price is outside range (bot will still start and wait)
            if (this.currentPrice < this.config.lowerPrice || this.currentPrice > this.config.upperPrice) {
                this._log('WARN', 'PRICE_OUT_OF_RANGE',
                    `Current price $${this.currentPrice.toFixed(2)} is outside grid [$${this.config.lowerPrice}–$${this.config.upperPrice}]. Bot will wait.`
                );
            }

            // 3. Calculate grid levels
            const gridResult = gridEngine.calculateLevels(
                this.currentPrice,
                this.config.upperPrice,
                this.config.lowerPrice,
                this.config.gridCount,
                this.config.mode
            );
            this.gridLevels = gridResult.levels;

            const capitalPerGrid = (this.config.totalCapital / this.config.gridCount).toFixed(2);

            // 4. Detect regime
            await this._updateRegime();

            // 5. Bootstrap state
            this.isRunning = true;
            this._stats.startTime  = Date.now();
            this._stats.startPrice = this.currentPrice;
            this.highestPrice = this.currentPrice;
            this._stats.totalProfit = 0;
            this._stats.totalFees   = 0;
            this._stats.cyclesCompleted = 0;
            this._stats.buysFilled  = 0;
            this._stats.sellsFilled = 0;
            this._gridOrders.clear();

            this._log('SYSTEM', 'START',
                `Grid bot started: ${this.config.gridCount} levels, $${this.config.lowerPrice}–$${this.config.upperPrice}, $${this.config.totalCapital} USDT`, {
                    capitalPerGrid,
                    regime: this._regime,
                    currentPrice: this.currentPrice,
                }
            );
            console.log(`[GridBot] 🚀 ${this.symbol} | ${this.config.gridCount} grids | $${this.config.lowerPrice}–$${this.config.upperPrice} | $${this.config.totalCapital} USDT (${this._regime || '?'} regime)`);

            // 6. Place all initial orders
            await this._placeInitialOrders();

            // 7. Start poll loop
            this._pollTimer  = setInterval(() => {
                this._poll().catch(e => {
                    this._log('ERROR', 'POLL_ERROR', e.message);
                    console.error('[GridBot] Poll error:', e.message);
                });
            }, this._pollIntervalMs);

            // Lightweight price refresh (for status display)
            this._priceTimer = setInterval(() => {
                this._updatePrice().catch(() => {});
            }, this._priceIntervalMs);

            return {
                success:      true,
                symbol:       this.symbol,
                gridLevels:   this.gridLevels,
                capitalPerGrid,
                regime:       this._regime,
                currentPrice: this.currentPrice,
                config:       this.config,
            };

        } catch (error) {
            this.isRunning = false;
            this._log('ERROR', 'START_FAILED', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Graceful stop — cancel all open grid orders then exit.
     */
    async stop() {
        if (!this.isRunning) return { success: false, error: 'Not running.' };

        clearInterval(this._pollTimer);
        clearInterval(this._priceTimer);
        this._pollTimer  = null;
        this._priceTimer = null;
        this.isRunning   = false;

        this._log('SYSTEM', 'STOP',
            `Grid bot stopped. Cycles: ${this._stats.cyclesCompleted}, Profit: $${this._stats.totalProfit.toFixed(4)}`
        );

        const cancelled = await this._cancelAllGridOrders();
        console.log(`[GridBot] ⏹️ Stopped. ${cancelled} orders cancelled. Total profit: $${this._stats.totalProfit.toFixed(4)}`);

        return { success: true, stats: this.getStatus(), ordersCancelled: cancelled };
    }

    /**
     * Nuclear option — cancels EVERY open order on the account (not just grid orders).
     * Use when something is badly wrong.
     */
    async emergencyStop() {
        clearInterval(this._pollTimer);
        clearInterval(this._priceTimer);
        this._pollTimer  = null;
        this._priceTimer = null;
        this.isRunning   = false;

        this._log('SYSTEM', 'EMERGENCY_STOP', 'Emergency stop — cancelling ALL orders on account');
        console.error('[GridBot] 🚨 EMERGENCY STOP');

        const result = await binanceService.emergencyStop();
        this._gridOrders.clear();

        return { success: true, emergencyResult: result };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL: ORDER MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Place all initial orders.
     * BUY at every level below current price.
     * SELL at every level above current price.
     * Skip the two levels bracketing the current price (too close — immediate fill risk).
     */
    async _placeInitialOrders() {
        // Find which level index the current price sits between
        const aboveIdx = this.gridLevels.findIndex(l => l > this.currentPrice);
        const belowIdx = aboveIdx === -1 ? this.gridLevels.length - 1 : aboveIdx - 1;

        let placed = 0, failed = 0;

        for (let i = 0; i < this.gridLevels.length; i++) {
            const price = this.gridLevels[i];

            // Skip the immediate neighbours of current price to avoid instant fills
            if (i === belowIdx || i === aboveIdx) continue;

            const side = price < this.currentPrice ? 'BUY' : 'SELL';
            const qty  = this._calcQty(price);
            if (qty <= 0) continue;

            try {
                const order = await binanceService.placeOrder(
                    this.symbol, side, 'LIMIT', qty, this._formatPrice(price)
                );

                this._gridOrders.set(order.orderId, {
                    orderId:    order.orderId,
                    levelIndex: i,
                    side,
                    price,
                    qty,
                    status:   'open',
                    placedAt: Date.now(),
                    filledAt: null,
                });

                placed++;
                this._log('ORDER', 'PLACED', `Initial ${side} ${qty} @ $${price.toFixed(2)} [L${i}]`, {
                    orderId: order.orderId, side, price, qty, levelIndex: i,
                });

                // Throttle: Binance allows ~10 orders/sec before hitting weight limits
                await new Promise(r => setTimeout(r, 120));

            } catch (err) {
                failed++;
                this._log('ERROR', 'ORDER_FAILED', `Initial ${side} @ $${price.toFixed(2)}: ${err.message}`);
                console.warn(`[GridBot] Failed to place initial ${side} @ $${price}: ${err.message}`);
            }
        }

        console.log(`[GridBot] 📊 Initial orders: ${placed} placed, ${failed} failed`);
        this._log('SYSTEM', 'INIT_COMPLETE', `${placed} initial orders placed`, { placed, failed });
    }

    /**
     * Core polling loop — detects filled orders, places counter orders.
     */
    async _poll() {
        if (!this.isRunning) return;
        this._pollCount++;

        // Refresh price before checking stop losses
        await this._updatePrice();

        // Update highest price seen so far
        if (this.currentPrice > this.highestPrice) {
            this.highestPrice = this.currentPrice;
        }

        // ── Stop loss check ───────────────────────────────────────────────────
        const stopLossPrice = this.config.lowerPrice * (1 - this.config.stopLossPct);
        if (this.currentPrice > 0 && this.currentPrice < stopLossPrice) {
            this._log('RISK', 'STOP_LOSS',
                `Price $${this.currentPrice.toFixed(2)} breached stop loss $${stopLossPrice.toFixed(2)} — emergency stop`
            );
            console.error(`[GridBot] 🛑 Stop loss at $${this.currentPrice.toFixed(2)}!`);
            await this.emergencyStop();
            return;
        }

        // ── Trailing Stop loss check ──────────────────────────────────────────
        if (this.config.trailingStopLossPct && this.highestPrice > 0) {
            const trailingStopPrice = this.highestPrice * (1 - this.config.trailingStopLossPct);
            if (this.currentPrice > 0 && this.currentPrice < trailingStopPrice) {
                this._log('RISK', 'TRAILING_STOP_LOSS',
                    `Price $${this.currentPrice.toFixed(2)} breached trailing stop loss $${trailingStopPrice.toFixed(2)} (peak: $${this.highestPrice.toFixed(2)}) — emergency stop`
                );
                console.error(`[GridBot] 🛑 Trailing stop loss hit at $${this.currentPrice.toFixed(2)} (peak: $${this.highestPrice.toFixed(2)})!`);
                await this.emergencyStop();
                return;
            }
        }

        // ── Take profit check ─────────────────────────────────────────────────
        if (this.config.takeProfitPct) {
            const profitPct = this._stats.totalProfit / this.config.totalCapital;
            if (profitPct >= this.config.takeProfitPct) {
                this._log('PROFIT', 'TAKE_PROFIT_TARGET',
                    `Take-profit target ${(this.config.takeProfitPct * 100).toFixed(1)}% reached — stopping`
                );
                await this.stop();
                return;
            }
        }

        // ── Regime update ─────────────────────────────────────────────────────
        if (this._pollCount % this._regimeCheckEvery === 0) {
            await this._updateRegime();
        }

        // ── Detect fills ──────────────────────────────────────────────────────
        let openOrderIds;
        try {
            const openOrders = await binanceService.getOpenOrders(this.symbol);
            openOrderIds = new Set(openOrders.map(o => o.orderId));
        } catch (e) {
            console.warn('[GridBot] Could not fetch open orders:', e.message);
            return;
        }

        // Any order we placed that's no longer in the open list = filled (or cancelled)
        const fills = [];
        for (const [orderId, order] of this._gridOrders) {
            if (order.status === 'open' && !openOrderIds.has(orderId)) {
                order.status  = 'filled';
                order.filledAt = Date.now();
                fills.push(order);
            }
        }

        for (const fill of fills) {
            await this._onFill(fill);
        }
    }

    /**
     * React to a filled order — place the counter order at the adjacent level.
     */
    async _onFill(filledOrder) {
        const { levelIndex, side, price, qty } = filledOrder;

        this._log('FILL', side,
            `Filled: ${side} ${qty} @ $${price.toFixed(2)} [L${levelIndex}]`, {
                orderId: filledOrder.orderId, levelIndex, side, price, qty,
            }
        );

        if (side === 'BUY') {
            this._stats.buysFilled++;

            // Place SELL one level up to capture the spread
            const sellIdx = levelIndex + 1;
            if (sellIdx < this.gridLevels.length) {
                const sellPrice = this.gridLevels[sellIdx];
                await this._placeSingleOrder('SELL', sellIdx, sellPrice, qty);
            }

        } else {
            this._stats.sellsFilled++;

            // Place BUY one level down to reset this grid position
            const buyIdx = levelIndex - 1;
            if (buyIdx >= 0) {
                const buyPrice = this.gridLevels[buyIdx];
                const buyQty   = this._calcQty(buyPrice);
                await this._placeSingleOrder('BUY', buyIdx, buyPrice, buyQty);
            }

            // A completed SELL = one profit cycle captured
            const spacing     = this._calcSpacing(levelIndex);
            const grossProfit = spacing * qty;
            const fees        = (price * qty * this.config.makerFee) * 2; // buy + sell
            const netProfit   = grossProfit - fees;

            this._stats.totalProfit += netProfit;
            this._stats.totalFees   += fees;
            this._stats.cyclesCompleted++;

            const profitPct = ((this._stats.totalProfit / this.config.totalCapital) * 100).toFixed(3);

            this._log('PROFIT', 'CYCLE',
                `Cycle #${this._stats.cyclesCompleted}: +$${netProfit.toFixed(4)} | Total: $${this._stats.totalProfit.toFixed(4)} (${profitPct}%)`, {
                    grossProfit, fees, netProfit,
                    totalProfit: this._stats.totalProfit,
                    totalProfitPct: profitPct,
                }
            );
            console.log(`[GridBot] ✅ Cycle #${this._stats.cyclesCompleted}: +$${netProfit.toFixed(4)} | Running total: $${this._stats.totalProfit.toFixed(4)} (${profitPct}%)`);
        }
    }

    /**
     * Place a single order at a grid level.
     * Cancels any stale open order at the same level+side first.
     */
    async _placeSingleOrder(side, levelIndex, price, qty) {
        // Remove stale order at same slot
        for (const [orderId, order] of this._gridOrders) {
            if (order.levelIndex === levelIndex && order.side === side && order.status === 'open') {
                try {
                    await binanceService.cancelOrder(this.symbol, orderId);
                    order.status = 'cancelled';
                } catch (_) { /* already filled or expired — fine */ }
            }
        }

        try {
            const order = await binanceService.placeOrder(
                this.symbol, side, 'LIMIT', qty, this._formatPrice(price)
            );

            this._gridOrders.set(order.orderId, {
                orderId:    order.orderId,
                levelIndex,
                side,
                price,
                qty,
                status:   'open',
                placedAt: Date.now(),
                filledAt: null,
            });

            this._log('ORDER', 'PLACED', `Counter ${side} ${qty} @ $${price.toFixed(2)} [L${levelIndex}]`, {
                orderId: order.orderId,
            });

        } catch (err) {
            this._log('ERROR', 'ORDER_FAILED', `Counter ${side} @ $${price.toFixed(2)}: ${err.message}`);
            console.error('[GridBot] Counter order failed:', err.message);
        }
    }

    /**
     * Cancel all orders we placed (by orderId).
     * Returns the number successfully cancelled.
     */
    async _cancelAllGridOrders() {
        let count = 0;
        for (const [orderId, order] of this._gridOrders) {
            if (order.status === 'open') {
                try {
                    await binanceService.cancelOrder(this.symbol, orderId);
                    order.status = 'cancelled';
                    count++;
                } catch (_) { /* may already be filled */ }
            }
        }
        return count;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL: UTILITIES
    // ─────────────────────────────────────────────────────────────────────────

    /** Refresh current price (used by the display timer). */
    async _updatePrice() {
        try {
            const data     = await binanceService.getPrice(this.symbol);
            this.currentPrice = data.price;
        } catch (_) { /* non-critical */ }
    }

    /** Detect market regime using Bollinger width + ATR from 1h klines. */
    async _updateRegime() {
        try {
            const klines = await binanceService.getKlines(this.symbol, '1h', 50);
            if (klines.length < 20) return;

            const closes = klines.map(k => k.close);
            const highs  = klines.map(k => k.high);
            const lows   = klines.map(k => k.low);

            // Bollinger Band width (%)
            const sma20    = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const variance = closes.slice(-20).reduce((a, b) => a + (b - sma20) ** 2, 0) / 20;
            const stdDev   = Math.sqrt(variance);
            const bbWidth  = (stdDev * 4 / sma20) * 100;  // (2σ * 2) / mid

            // ATR (14-period)
            let atrSum = 0;
            for (let i = closes.length - 14; i < closes.length; i++) {
                const tr = Math.max(
                    highs[i] - lows[i],
                    Math.abs(highs[i] - closes[i - 1]),
                    Math.abs(lows[i]  - closes[i - 1])
                );
                atrSum += tr;
            }
            const atrPct = (atrSum / 14) / closes[closes.length - 1] * 100;

            const prev    = this._regime;
            this._regime  = gridEngine.detectRegime(bbWidth, atrPct);

            if (this._regime !== prev && prev !== null) {
                this._log('REGIME', 'CHANGE', `Regime changed: ${prev} → ${this._regime}`, { bbWidth: bbWidth.toFixed(2), atrPct: atrPct.toFixed(2) });
                console.log(`[GridBot] 📊 Regime: ${prev} → ${this._regime} (BB: ${bbWidth.toFixed(1)}%, ATR: ${atrPct.toFixed(2)}%)`);
            }
        } catch (_) { /* non-critical */ }
    }

    /**
     * Calculate order quantity (in base asset) from USDT capital at given price.
     * Rounds to 5 decimal places (safe floor for most Binance pairs).
     */
    _calcQty(price) {
        const capitalPerGrid = this.config.totalCapital / this.config.gridCount;
        const rawQty = capitalPerGrid / price;
        return Math.floor(rawQty * 100000) / 100000;   // Floor to 5dp (never over-allocate)
    }

    /**
     * Price spacing at a given level index.
     * For arithmetic grids this is constant. For geometric it varies.
     */
    _calcSpacing(levelIndex) {
        if (this.config.mode === 'arithmetic') {
            return (this.config.upperPrice - this.config.lowerPrice) / this.config.gridCount;
        }
        // Geometric: spacing between this level and the next
        const lo = this.gridLevels[levelIndex - 1] ?? this.gridLevels[levelIndex];
        const hi = this.gridLevels[levelIndex];
        return hi - lo;
    }

    /** Format price to 2 decimal places (standard for USDT pairs). */
    _formatPrice(price) {
        return parseFloat(price.toFixed(2));
    }

    /** Append entry to the ring-buffer decision log. */
    _log(category, action, reason, data = {}) {
        const entry = {
            id:           `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp:    Date.now(),
            category,    // SYSTEM, ORDER, FILL, PROFIT, RISK, REGIME, ERROR, WARN
            action,      // START, STOP, PLACED, CYCLE, STOP_LOSS, etc.
            reason,
            symbol:       this.symbol,
            currentPrice: this.currentPrice,
            regime:       this._regime,
            ...data,
        };
        this._decisions[this._decisionHead] = entry;
        this._decisionHead = (this._decisionHead + 1) % this._decisions.length;
        this._decisionCount++;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STATUS
    // ─────────────────────────────────────────────────────────────────────────

    getStatus() {
        const openOrders   = [...this._gridOrders.values()].filter(o => o.status === 'open');
        const filledOrders = [...this._gridOrders.values()].filter(o => o.status === 'filled');
        const uptimeMs     = this._stats.startTime ? Date.now() - this._stats.startTime : 0;
        const profitPct    = this.config
            ? ((this._stats.totalProfit / this.config.totalCapital) * 100).toFixed(4)
            : '0';

        // Annotate grid levels with their order status for the UI
        const levelMap = openOrders.reduce((m, o) => {
            m[o.levelIndex] = { side: o.side, orderId: o.orderId, price: o.price, qty: o.qty };
            return m;
        }, {});

        return {
            isRunning:    this.isRunning,
            symbol:       this.symbol,
            config:       this.config,
            currentPrice: this.currentPrice,
            regime:       this._regime,
            gridLevels:   this.gridLevels,
            levelOrders:  levelMap,   // levelIndex → order (for UI grid visualisation)
            stats: {
                ...this._stats,
                profitPct,
                uptimeMs,
                uptimeHours: (uptimeMs / 3600000).toFixed(2),
            },
            orders: {
                open:   openOrders.length,
                filled: filledOrders.length,
                total:  this._gridOrders.size,
            },
            openOrders: openOrders.map(o => ({
                orderId:    o.orderId,
                side:       o.side,
                price:      o.price,
                qty:        o.qty,
                levelIndex: o.levelIndex,
            })),
        };
    }

    /** Newest decisions first, capped at `limit`. */
    getDecisions(limit = 100) {
        const size  = this._decisions.length;
        const total = Math.min(this._decisionCount, size);
        const out   = [];
        for (let i = 0; i < Math.min(limit, total); i++) {
            const idx = (this._decisionHead - 1 - i + size) % size;
            if (this._decisions[idx]) out.push(this._decisions[idx]);
        }
        return out;
    }
}

// Singleton — one active grid per process (can be extended to multi-bot later)
const gridBot = new GridBot();
export default gridBot;
