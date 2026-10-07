/**
 * TradingConnectionMonitorDaemon.js
 * 
 * SOMA High-Stakes Cancel-on-Disconnect (CoD) Connection Monitor.
 * Actively monitors WebSocket connections to Alpaca/Binance and external internet access.
 * Triggers emergency system halts and broker cancellations if connectivity drops for >15s.
 */

import fetch from 'node-fetch';
import BaseDaemon from './BaseDaemon.js';
import riskGateway from '../server/finance/RiskGateway.js';
import alpacaService from '../server/finance/AlpacaService.js';
import binanceService from '../server/finance/BinanceService.js';
import lowLatencyEngine from '../server/finance/lowLatencyEngine.js';

export class TradingConnectionMonitorDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({
            name: 'TradingConnectionMonitorDaemon',
            intervalMs: config.intervalMs || 5000, // Check every 5 seconds
            ...config
        });

        this.outageThreshold = config.outageThreshold || 3; // 3 ticks = 15 seconds
        this.failedChecks = 0;
        this.isHaltingDueToOutage = false;
        this._bootRecoveryDone = false;
    }

    /**
     * Periodic check loop
     */
    async onTick() {
        const status = await this.checkConnectivity();

        if (status.ok) {
            this.failedChecks = 0;
            if (this.isHaltingDueToOutage) {
                await this.handleConnectionRestored(status);
            } else if (!this._bootRecoveryDone && riskGateway.isHardHalted && riskGateway.haltSource === 'cod_monitor') {
                // A CoD halt latched across a restart: the previous process died
                // before its own recovery pass could disarm (happened 2026-07-03 —
                // in live mode this silently stops all trading forever). Run the
                // same exposure-verified recovery. Manual halts are never touched.
                this._bootRecoveryDone = true;
                this.logger.warn('[CoDMonitor] Boot recovery: CoD halt latched from a previous process — verifying exposure before disarming.');
                await this.handleConnectionRestored(status);
            }
        } else {
            this.failedChecks++;
            this.logger.warn(`[CoDMonitor] Connection check failed (${this.failedChecks}/${this.outageThreshold}). Status:`, status.reason);

            if (this.failedChecks >= this.outageThreshold && !this.isHaltingDueToOutage) {
                await this.triggerEmergencyDisconnectHalt(status);
            }
        }
    }

    /**
     * Comprehensive connectivity check
     */
    async checkConnectivity() {
        const result = {
            ok: true,
            alpacaWsOpen: false,
            binanceWsOpen: false,
            internetAccess: false,
            reason: []
        };

        // 1. Check Alpaca WS Stream Status
        if (alpacaService.isConnected && lowLatencyEngine.alpacaWs) {
            // Alpaca data stream client doesn't expose simple readyState directly, check connection instance
            const wsState = lowLatencyEngine.alpacaWs.connection?.ws?.readyState;
            // 1 === OPEN
            result.alpacaWsOpen = (wsState === 1);
        } else {
            result.alpacaWsOpen = false;
        }

        // 2. Check Binance WS Stream Status
        if (lowLatencyEngine.binanceWs) {
            result.binanceWsOpen = (lowLatencyEngine.binanceWs.readyState === 1);
        } else {
            result.binanceWsOpen = false;
        }

        // 3. Verify External Internet Access (Fetch to Alpaca REST host with 2s timeout)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            const testUrl = 'https://api.alpaca.markets/v2/clock';
            const response = await fetch(testUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            result.internetAccess = response.ok || response.status === 401; // 401 is fine (indicates reached endpoint without authentication headers)
        } catch (e) {
            result.internetAccess = false;
        }

        // Evaluate overall health
        // Outage triggers if external internet is completely dead OR if active live WS feeds are disconnected.
        // Paper mode does not use WS streams — only flag WS down if live trading AND stream was actually started.
        const tradingWantsAlpaca = alpacaService.isConnected && !alpacaService.isPaperTrading && !!lowLatencyEngine.alpacaWs;
        const tradingWantsBinance = (process.env.SOMA_LOAD_TRADING === 'true') && !!lowLatencyEngine.binanceWs;

        let wsHealthy = true;
        if (tradingWantsAlpaca && !result.alpacaWsOpen) {
            wsHealthy = false;
            result.reason.push('Alpaca WS Disconnected');
        }
        if (tradingWantsBinance && !result.binanceWsOpen) {
            wsHealthy = false;
            result.reason.push('Binance WS Disconnected');
        }

        if (!result.internetAccess) {
            result.ok = false;
            result.reason.push('Internet Access Lost');
        } else if (!wsHealthy) {
            result.ok = false;
        }

        return result;
    }

    /**
     * Trigger Emergency halt and cancel orders
     */
    async triggerEmergencyDisconnectHalt(status) {
        this.isHaltingDueToOutage = true;
        this.logger.error(`[CoDMonitor] 🚨 DISCONNECT DETECTED! Outage threshold exceeded. Running emergency Cancel-on-Disconnect halt.`);

        // 1. Lock Risk Gateway immediately to block any new trade submissions
        riskGateway.setHardHalt(true, 'cod_monitor');
        riskGateway.logAuditEvent('cod_emergency_halt_triggered', {
            consecutiveFailures: this.failedChecks,
            reason: status.reason
        });

        // 2. Fire emergency order cancellation to brokers
        const cancellationDetails = { alpaca: null, binance: null };

        // Attempt Alpaca cancel if internet is reachable or broker recovery possible
        if (alpacaService.isConnected && status.internetAccess) {
            try {
                cancellationDetails.alpaca = await alpacaService.closeAllPositions();
                this.logger.info('[CoDMonitor] Emergency cancellations sent to Alpaca.');
            } catch (e) {
                cancellationDetails.alpaca = { success: false, error: e.message };
                this.logger.error('[CoDMonitor] Failed to send emergency cancellations to Alpaca:', e.message);
            }
        }

        // Attempt Binance cancel
        if (status.internetAccess) {
            try {
                cancellationDetails.binance = await binanceService.emergencyStop();
                this.logger.info('[CoDMonitor] Emergency cancellations sent to Binance.');
            } catch (e) {
                cancellationDetails.binance = { success: false, error: e.message };
                this.logger.error('[CoDMonitor] Failed to send emergency cancellations to Binance:', e.message);
            }
        }

        riskGateway.logAuditEvent('cod_emergency_cancel_results', cancellationDetails);
        this.emitSignal('trading.cod_halt', { status, cancellationDetails }, 'critical');
    }

    /**
     * Recover and clean up positions when connection returns
     */
    async handleConnectionRestored(status) {
        this.logger.info(`[CoDMonitor] ✅ Connection restored. Verifying open exposure before arming.`);
        this.isHaltingDueToOutage = false;

        const exposureCheck = { alpacaOpenOrders: 0, binanceOpenOrders: 0 };

        try {
            // Fetch Alpaca open orders
            if (alpacaService.isConnected) {
                const orders = await alpacaService.client.getOrders({ status: 'open' });
                exposureCheck.alpacaOpenOrders = orders.length;
            }

            // Fetch Binance open orders
            if (lowLatencyEngine.binanceWs) {
                const orders = await binanceService.getOpenOrders();
                exposureCheck.binanceOpenOrders = orders.length;
            }

            riskGateway.logAuditEvent('cod_recovery_exposure_check', exposureCheck);

            if (exposureCheck.alpacaOpenOrders === 0 && exposureCheck.binanceOpenOrders === 0) {
                this.logger.info('[CoDMonitor] No lingering open orders found. Disarming emergency stop.');
                riskGateway.setHardHalt(false);
                riskGateway.logAuditEvent('cod_emergency_halt_disarmed', { message: 'Outage recovered, clean exposure verified.' });
            } else {
                this.logger.warn(`[CoDMonitor] Lingering open orders found: Alpaca(${exposureCheck.alpacaOpenOrders}), Binance(${exposureCheck.binanceOpenOrders}). Keeping halt active for safety.`);
                this.emitSignal('trading.recovery_exposure_warning', { exposureCheck }, 'high');
            }
        } catch (e) {
            this.logger.error('[CoDMonitor] Error verifying open exposure during recovery:', e.message);
            // Keep hard halt enabled for safety
        }
    }
}

export default TradingConnectionMonitorDaemon;
