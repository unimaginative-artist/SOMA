/**
 * SOMA Pre-Trade Risk Gateway (Institutional Grade)
 * 
 * Intercepts and validates all outgoing orders before they reach brokers.
 * Enforces strict mathematical limits, rate limits, cooldowns, and price guards.
 * Persists config and emergency halt state to disk.
 * Immutable logs every order validation through AuditLedger.
 */

import path from 'path';
import fs from 'fs';
import alpacaService from './AlpacaService.js';
import marketDataService from './marketDataService.js';
import AuditLedger from './AuditLedger.js';

class RiskGateway {
    constructor() {
        this.submissionTimestamps = []; // Tracking list for rate limiting
        this.lastSymbolOrderTime = new Map(); // symbol -> timestamp
        this._localAuditLedger = null;
        this.initPersistedState();
    }

    /**
     * Initialize config and halt state, loading from disk if available
     */
    initPersistedState() {
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this.configFilePath = path.join(dataDir, 'risk-gateway-config.json');

        const defaultState = {
            config: {
                maxOrderValueUsd: 10000,      // Hard limit for fat-finger protection
                maxOrdersPer10Sec: 5,         // Gateway-level rate limiter
                maxPriceDeviationPct: 0.005,  // 0.5% max limit price slippage guard
                maxPriceThresholdUsd: 5000,   // Max unit price threshold for auto-halt guard
                symbolCooldownMs: 2000,       // 2s minimum cooldown between orders for same asset
                failClosedOnQuoteError: true  // Fail-closed pricing reference setting
            },
            isHardHalted: false
        };

        if (fs.existsSync(this.configFilePath)) {
            try {
                const stored = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'));
                this.config = { ...defaultState.config, ...stored.config };
                this.isHardHalted = stored.isHardHalted !== undefined ? stored.isHardHalted : defaultState.isHardHalted;
                this.haltSource = stored.haltSource || null;
                console.log('[RiskGateway] Loaded persisted config and halt state:', this.config, 'Halted:', this.isHardHalted, 'Source:', this.haltSource);
            } catch (e) {
                console.error('[RiskGateway] Failed to parse config file, using defaults:', e.message);
                this.config = defaultState.config;
                this.isHardHalted = defaultState.isHardHalted;
                this.haltSource = null;
            }
        } else {
            this.config = defaultState.config;
            this.isHardHalted = defaultState.isHardHalted;
            this.haltSource = null;
            this.savePersistedState();
        }
    }

    /**
     * Write current config and halt state to disk
     */
    savePersistedState() {
        try {
            const dataToSave = {
                config: this.config,
                isHardHalted: this.isHardHalted,
                haltSource: this.haltSource || null
            };
            fs.writeFileSync(this.configFilePath, JSON.stringify(dataToSave, null, 4), 'utf8');
        } catch (e) {
            console.error('[RiskGateway] Failed to save config/state to disk:', e.message);
        }
    }

    /**
     * Resolve SOMA's AuditLedger instance
     */
    _getAuditLedger() {
        if (global.SOMA?.auditLedger) {
            return global.SOMA.auditLedger;
        }
        if (global.SOMA_TRADING?.auditLedger) {
            return global.SOMA_TRADING.auditLedger;
        }
        if (!this._localAuditLedger) {
            try {
                const dbPath = path.join(process.cwd(), 'data', 'audit', 'soma_audit_ledger.db');
                this._localAuditLedger = new AuditLedger(dbPath);
            } catch (e) {
                console.error('[RiskGateway] Local AuditLedger init failed:', e.message);
            }
        }
        return this._localAuditLedger;
    }

    /**
     * Log a message to the AuditLedger
     */
    logAuditEvent(action, metadata = {}) {
        try {
            const ledger = this._getAuditLedger();
            if (ledger) {
                ledger.append({
                    actor: 'RiskGateway',
                    action,
                    filePath: 'server/finance/RiskGateway.js',
                    metadata
                });
            }
        } catch (e) {
            console.error('[RiskGateway] Audit logging failed:', e.message);
        }
    }

    /**
     * Set hard halt status and persist to disk
     */
    setHardHalt(halt, source = 'manual') {
        const oldHalt = this.isHardHalted;
        this.isHardHalted = !!halt;
        // Track who latched the halt: automated CoD halts may auto-disarm after a
        // verified recovery; manual halts only clear by explicit human action.
        this.haltSource = this.isHardHalted ? source : null;
        this.savePersistedState();

        if (oldHalt !== this.isHardHalted) {
            const action = this.isHardHalted ? 'halt_enabled' : 'halt_disabled';
            this.logAuditEvent(action, { reason: 'System halt toggled via dynamic endpoint' });
        }
        console.warn(`[RiskGateway] Hard halt status updated: ${this.isHardHalted ? '🚨 SYSTEM LOCKED' : '✅ SYSTEM ARMED'}`);
    }

    /**
     * Helper to log rejections and throw error
     */
    rejectOrder(reason, orderDetails) {
        this.logAuditEvent('order_blocked', { ...orderDetails, reason });
        throw new Error(`[RiskGateway] BLOCKED: ${reason}`);
    }

    /**
     * Validate an incoming order request
     * @throws {Error} if order violates any risk rule
     */
    async validateOrder(order = {}) {
        const { symbol, side, qty, price, type = 'market', broker = 'alpaca' } = order;

        if (!symbol || !side || !qty) {
            throw new Error('[RiskGateway] Missing required fields: symbol, side, qty');
        }

        const now = Date.now();
        const orderDetails = { symbol, side, qty, price, type, broker };

        // Rule 1: Hard Halt / Emergency Lock check
        if (this.isHardHalted) {
            this.rejectOrder('Emergency stop is active. System is locked.', orderDetails);
        }

        const riskManager = global.SOMA_TRADING?.riskManager;
        if (riskManager?.riskState?.isHalted) {
            this.rejectOrder(`RiskManager trading halt active: ${riskManager.riskState.haltReason}`, orderDetails);
        }

        // Rule 2: Cooldown check per symbol (prevent duplicate or execution race conditions)
        const lastOrderTime = this.lastSymbolOrderTime.get(symbol.toUpperCase());
        if (lastOrderTime && (now - lastOrderTime < this.config.symbolCooldownMs)) {
            const waitMs = this.config.symbolCooldownMs - (now - lastOrderTime);
            this.rejectOrder(`Cooldown active for ${symbol.toUpperCase()}. Wait ${waitMs}ms.`, orderDetails);
        }

        // Rule 3: Gateway-level Rate Limiting (sliding window)
        this.submissionTimestamps = this.submissionTimestamps.filter(t => now - t < 10000);
        if (this.submissionTimestamps.length >= this.config.maxOrdersPer10Sec) {
            this.rejectOrder(`Rate limit reached (${this.config.maxOrdersPer10Sec} orders per 10s).`, orderDetails);
        }

        // Rule 4: Estimate trade value & enforce Fat-Finger limit
        let orderPrice = parseFloat(price || 0);
        if (!orderPrice) {
            // Retrieve current market quote if order price is omitted
            try {
                if (broker === 'alpaca') {
                    const quote = await alpacaService.getQuote(symbol);
                    orderPrice = quote.price || 0;
                }
            } catch (e) {
                try {
                    const priceInfo = await marketDataService.getLatestPrice(symbol);
                    orderPrice = priceInfo.price || 0;
                } catch (fallbackErr) {
                    // Left as 0
                }
            }
        }

        // Rule 4b: Unit Price Guard (auto-halt on breach)
        const maxPriceThreshold = this.config.maxPriceThresholdUsd || 5000;
        if (orderPrice > maxPriceThreshold) {
            this.setHardHalt(true);
            if (riskManager?.haltTrading) {
                try {
                    await riskManager.haltTrading(`Unit price $${orderPrice} exceeds threshold of $${maxPriceThreshold}`);
                } catch (e) {
                    console.error('[RiskGateway] Failed to propagate unit price halt to RiskManager:', e.message);
                }
            }
            this.rejectOrder(`Unit price guard. Est. unit price $${orderPrice} exceeds threshold $${maxPriceThreshold}. SYSTEM HALTED.`, orderDetails);
        }

        const totalValue = qty * orderPrice;
        if (totalValue > this.config.maxOrderValueUsd) {
            this.rejectOrder(`Fat-finger protection triggered. Est. value $${totalValue.toFixed(2)} exceeds limit $${this.config.maxOrderValueUsd.toFixed(2)}.`, orderDetails);
        } else if (orderPrice === 0 && this.config.failClosedOnQuoteError) {
            this.rejectOrder('Failed to resolve price reference for fat-finger validation.', orderDetails);
        }

        // Rule 5: Price Deviation Check for Limit Orders
        if (type.toLowerCase() === 'limit' && orderPrice > 0) {
            let midPrice = null;
            try {
                const quote = await alpacaService.getQuote(symbol);
                midPrice = quote.price;
            } catch (e) {
                try {
                    const priceInfo = await marketDataService.getLatestPrice(symbol);
                    midPrice = priceInfo.price;
                } catch (fallbackErr) {
                    // Left as null
                }
            }

            if (midPrice && midPrice > 0) {
                const deviation = Math.abs(orderPrice - midPrice) / midPrice;
                if (deviation > this.config.maxPriceDeviationPct) {
                    const pctStr = (deviation * 100).toFixed(2);
                    this.setHardHalt(true);
                    if (riskManager?.haltTrading) {
                        try {
                            await riskManager.haltTrading(`Price deviation limit exceeded: limit price $${orderPrice} deviates by ${pctStr}% from mid $${midPrice}`);
                        } catch (err) {
                            console.error('[RiskGateway] Failed to propagate slippage halt to RiskManager:', err.message);
                        }
                    }
                    this.rejectOrder(`Price deviation guard. Limit price $${orderPrice} deviates by ${pctStr}% from market mid $${midPrice} (limit: ${(this.config.maxPriceDeviationPct * 100).toFixed(1)}%). SYSTEM HALTED.`, orderDetails);
                }
            } else if (this.config.failClosedOnQuoteError) {
                this.rejectOrder('Price deviation check failed: Unable to fetch market price reference.', orderDetails);
            }
        }

        // Rule 6: Delegate to centralized SOMA Portfolio Risk Manager
        if (riskManager) {
            const riskCheck = await riskManager.validateTrade({
                symbol: symbol.toUpperCase(),
                side: side.toLowerCase(),
                size: qty,
                price: orderPrice || 1 // fallback to 1 if no price is resolvable
            });

            if (!riskCheck.approved) {
                const criticalViolation = riskCheck.violations.find(v => v.action === 'REJECT' || v.action === 'HALT_TRADING');
                this.rejectOrder(`Portfolio Check Failed: ${criticalViolation?.message || 'Rejected by portfolio risk limits'}`, orderDetails);
            }
        }

        // Success: Commit logs & update metrics
        this.submissionTimestamps.push(now);
        this.lastSymbolOrderTime.set(symbol.toUpperCase(), now);
        this.logAuditEvent('order_passed', orderDetails);
        console.log(`[RiskGateway] ✅ Order passed all risk checks: ${side.toUpperCase()} ${qty} ${symbol} @ $${orderPrice || 'MARKET'}`);
        return true;
    }
}

const riskGateway = new RiskGateway();
export default riskGateway;
