/**
 * HighFrequencyGridEngine.js — SOMA Engine B (Perpetual Adaptive Micro-Grid)
 * 
 * Research-only price-touch grid replay. Realized wins can coexist with a
 * larger open inventory loss; neither is evidence of executable live returns.
 */

export class HighFrequencyGridEngine {
    constructor(config = {}) {
        this.symbol = config.symbol || 'BTC-USD';
        this.gridLevels = config.gridLevels || 8;             // 8 buy levels, 8 sell levels
        this.gridSpacingPct = config.gridSpacingPct || 0.0065; // 0.65% price spacing per grid tier (clears 0.30% round-trip fees with positive net)
        this.orderNotional = config.orderNotional || 50;       // $50 notional per micro-order
        this.makerFeeBps = config.makerFeeBps ?? 15;          // 15 bps (0.15%) Maker fee
        this.maxInventoryLevels = config.maxInventoryLevels || 6; // Max 6 open buy levels
        this.maxDrawdownPct = config.maxDrawdownPct || 0.025;   // 2.5% max drawdown circuit breaker

        this.centerPrice = 0;
        this.activeBuys = new Map();  // level -> { price, qty }
        this.activeSells = new Map(); // level -> { price, qty, buyPrice }
        this.openInventory = [];
        this.closedFills = [];
        
        this.totalRealizedPnl = 0;
        this.totalVolumeTraded = 0;
        this.totalFeesPaid = 0;
        this.researchOnly = true;
        this.initialCapital = Math.max(1, Number(config.initialCapital) || 1000);
        this.cash = this.initialCapital;
        this.lastPrice = 0;
        this.peakEquity = this.initialCapital;
        this.maxObservedDrawdownPct = 0;
        this.halted = false;
    }

    initializeGrid(midPrice) {
        if (!midPrice || midPrice <= 0) return false;
        this.centerPrice = midPrice;
        this.activeBuys.clear();
        this.activeSells.clear();

        for (let i = 1; i <= this.gridLevels; i++) {
            const price = Number((midPrice * (1 - i * this.gridSpacingPct)).toFixed(2));
            const qty = this.orderNotional / price;
            this.activeBuys.set(i, { price, qty, level: i });
        }
        return true;
    }

    processTick(tickPrice) {
        if (!Number.isFinite(tickPrice) || tickPrice <= 0) throw new Error('Grid requires a finite positive price');
        this.lastPrice = tickPrice;
        if (!this.centerPrice) {
            this.initializeGrid(tickPrice);
            return { action: 'INIT', pnl: 0 };
        }

        const feeRate = (this.makerFeeBps / 10000);
        let filledAny = false;
        this.markEquity(); // A gap through the drawdown limit must not add inventory.

        // 1. Check Buy Fills
        for (const [level, order] of this.activeBuys.entries()) {
            if (!this.halted && tickPrice <= order.price && this.openInventory.length < this.maxInventoryLevels
                && this.cash >= order.price * order.qty * (1 + feeRate)) {
                // Buy filled!
                this.activeBuys.delete(level);
                this.openInventory.push({ level, buyPrice: order.price, qty: order.qty });
                const notional = order.price * order.qty;
                this.totalVolumeTraded += notional;
                this.totalFeesPaid += (notional * feeRate);
                this.cash -= notional * (1 + feeRate);

                // Place corresponding Take-Profit Sell
                const targetSellPrice = Number((order.price * (1 + this.gridSpacingPct)).toFixed(2));
                this.activeSells.set(level, {
                    price: targetSellPrice,
                    qty: order.qty,
                    buyPrice: order.price,
                    level
                });
                filledAny = true;
            }
        }

        // 2. Check Sell Fills
        for (const [level, order] of this.activeSells.entries()) {
            if (tickPrice >= order.price) {
                // Sell filled!
                this.activeSells.delete(level);
                const tradeNotional = order.price * order.qty;
                const costNotional = order.buyPrice * order.qty;
                const grossProfit = tradeNotional - costNotional;
                const entryFee = costNotional * feeRate;
                const exitFee = tradeNotional * feeRate;
                const totalTradeFees = entryFee + exitFee;
                const netProfit = grossProfit - totalTradeFees;

                this.totalRealizedPnl += netProfit;
                this.totalVolumeTraded += tradeNotional;
                this.totalFeesPaid += exitFee;
                this.cash += tradeNotional - exitFee;

                this.closedFills.push({
                    buyPrice: order.buyPrice,
                    sellPrice: order.price,
                    grossProfit,
                    fees: totalTradeFees,
                    netProfit,
                    fillTime: Date.now()
                });

                // Remove from inventory and REPLENISH buy order at this level!
                this.openInventory = this.openInventory.filter(inv => inv.level !== level);
                const replenishPrice = Number((this.centerPrice * (1 - level * this.gridSpacingPct)).toFixed(2));
                const qty = this.orderNotional / replenishPrice;
                this.activeBuys.set(level, { price: replenishPrice, qty, level });
                filledAny = true;
            }
        }

        // Dynamic Re-center if price drifts > 2.0%
        const drift = Math.abs(tickPrice - this.centerPrice) / this.centerPrice;
        if (!this.halted && drift >= 0.020 && this.openInventory.length === 0) {
            this.initializeGrid(tickPrice);
        }
        this.markEquity();

        return {
            filled: filledAny,
            realizedPnl: this.totalRealizedPnl,
            totalFills: this.closedFills.length
        };
    }

    markEquity() {
        const equity = this.cash + this.openInventory.reduce((sum, lot) => sum + lot.qty * this.lastPrice, 0);
        this.peakEquity = Math.max(this.peakEquity, equity);
        this.maxObservedDrawdownPct = Math.max(this.maxObservedDrawdownPct, (this.peakEquity - equity) / this.peakEquity);
        if (this.maxObservedDrawdownPct >= this.maxDrawdownPct) {
            this.halted = true;
            this.activeBuys.clear();
        }

    }

    getMetrics() {
        const equity = this.cash + this.openInventory.reduce((sum, lot) => sum + lot.qty * this.lastPrice, 0);
        const winningFills = this.closedFills.filter(f => f.netProfit > 0).length;
        const totalFills = this.closedFills.length;
        const winRate = totalFills > 0 ? (winningFills / totalFills) * 100 : 0;
        const avgProfitPerFill = totalFills > 0 ? (this.totalRealizedPnl / totalFills) : 0;

        return {
            researchOnly: true, executionEnabled: false,
            fillModel: 'idealized_price_touch_not_execution_evidence',
            initialCapital: this.initialCapital, equityUsd: Number(equity.toFixed(2)),
            totalNetPnlUsd: Number((equity - this.initialCapital).toFixed(2)),
            unrealizedPnlUsd: Number((equity - this.initialCapital - this.totalRealizedPnl).toFixed(2)),
            maxDrawdownPct: Number((this.maxObservedDrawdownPct * 100).toFixed(3)), halted: this.halted,
            symbol: this.symbol,
            totalFills,
            winningFills,
            winRatePct: Number(winRate.toFixed(1)),
            totalRealizedPnlUsd: Number(this.totalRealizedPnl.toFixed(2)),
            avgProfitPerFillUsd: Number(avgProfitPerFill.toFixed(3)),
            totalFeesPaidUsd: Number(this.totalFeesPaid.toFixed(2)),
            totalVolumeTradedUsd: Number(this.totalVolumeTraded.toFixed(2)),
            openInventoryCount: this.openInventory.length
        };
    }
}

export default HighFrequencyGridEngine;
