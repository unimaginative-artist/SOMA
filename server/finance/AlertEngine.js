/**
 * AlertEngine.js
 * Price alert system — subscribes to market.price_tick, fires alerts on conditions.
 */

import { EventEmitter } from 'events';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

class AlertEngine extends EventEmitter {
    constructor() {
        super();
        this.alerts = new Map(); // id → alert object
        this._subscribed = false;
    }

    /**
     * Lazy-subscribe to market.price_tick once the MessageBroker is available.
     * Called on first alert creation or manually from routes.js.
     */
    ensureSubscribed() {
        if (this._subscribed) return;
        try {
            const broker = require('../../core/MessageBroker.cjs');
            broker.on('market.price_tick', (envelope) => {
                const tick = envelope.payload || envelope;
                this._checkAlerts(tick);
            });
            this._subscribed = true;
        } catch (e) {
            // MessageBroker not yet available — will retry on next alert creation
        }
    }

    createAlert({ symbol, type, value, label }) {
        if (!symbol || !type || value == null) throw new Error('symbol, type, and value are required');
        if (!['price_above', 'price_below', 'pct_change'].includes(type)) {
            throw new Error(`Unknown alert type: ${type}`);
        }

        this.ensureSubscribed();

        const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const alert = {
            id,
            symbol: symbol.toUpperCase(),
            type,
            value: parseFloat(value),
            label: label || `${symbol} ${type} ${value}`,
            status: 'active',   // 'active' | 'triggered'
            createdAt: Date.now(),
            triggeredAt: null,
            triggeredPrice: null
        };
        this.alerts.set(id, alert);
        return alert;
    }

    deleteAlert(id) {
        return this.alerts.delete(id);
    }

    resetAlert(id) {
        const alert = this.alerts.get(id);
        if (!alert) return null;
        alert.status = 'active';
        alert.triggeredAt = null;
        alert.triggeredPrice = null;
        return alert;
    }

    listAlerts() {
        return [...this.alerts.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    getAlert(id) {
        return this.alerts.get(id) || null;
    }

    _checkAlerts({ symbol, price }) {
        if (!symbol || price == null) return;
        const normalSymbol = symbol.toUpperCase();

        for (const alert of this.alerts.values()) {
            if (alert.status !== 'active') continue;
            if (alert.symbol !== normalSymbol) continue;

            let triggered = false;
            if (alert.type === 'price_above' && price >= alert.value) triggered = true;
            if (alert.type === 'price_below' && price <= alert.value) triggered = true;
            // pct_change: value is % threshold (e.g. 5 = fire when |change| >= 5%)
            // For this type we need to track initial price — skip for now (complex, out of scope)

            if (triggered) {
                alert.status = 'triggered';
                alert.triggeredAt = Date.now();
                alert.triggeredPrice = price;

                const payload = { ...alert };
                this.emit('triggered', payload);

                // Broadcast via MessageBroker so WebSocket can pick it up
                try {
                    const broker = require('../../core/MessageBroker.cjs');
                    broker.emit('alert.triggered', payload);
                } catch { /* non-fatal */ }

                console.log(`[AlertEngine] Alert triggered: ${alert.label} @ $${price}`);
            }
        }
    }
}

export default new AlertEngine();
