/**
 * TradingConnectionMonitorDaemon Verification Suite
 * 
 * Verifies:
 * - Active healthy connection checks
 * - Outage counter accumulation
 * - Emergency halt and broker order cancels upon outage threshold breach
 * - Safe disarming on clean network recovery
 * - Continued halting on recovery with lingering open broker orders
 */

import { TradingConnectionMonitorDaemon } from '../daemons/TradingConnectionMonitorDaemon.js';
import riskGateway from '../server/finance/RiskGateway.js';
import alpacaService from '../server/finance/AlpacaService.js';
import binanceService from '../server/finance/BinanceService.js';
import lowLatencyEngine from '../server/finance/lowLatencyEngine.js';

async function runTest(testName, testFn) {
    console.log(`\n--------------------------------------------------`);
    console.log(`RUNNING TEST: ${testName}`);
    console.log(`--------------------------------------------------`);
    try {
        await testFn();
        console.log(`✅ TEST PASSED: ${testName}`);
    } catch (e) {
        console.error(`❌ TEST FAILED: ${testName}\nReason:`, e.stack || e.message);
        throw e;
    }
}

async function main() {
    console.log('=== STARTING CONNECTION MONITOR TEST SUITE ===');

    const originalAlpacaIsConnected = alpacaService.isConnected;
    const originalAlpacaWs = lowLatencyEngine.alpacaWs;
    const originalBinanceWs = lowLatencyEngine.binanceWs;
    const originalAlpacaClose = alpacaService.closeAllPositions;
    const originalBinanceClose = binanceService.emergencyStop;
    const originalAlpacaGetOrders = alpacaService.client?.getOrders;
    const originalBinanceGetOrders = binanceService.getOpenOrders;

    // Standardize system armed status
    riskGateway.setHardHalt(false);

    // Setup stub environment
    alpacaService.isConnected = true;
    alpacaService.isPaperTrading = false;

    // Mock Websockets
    lowLatencyEngine.alpacaWs = { connection: { ws: { readyState: 1 } } }; // OPEN
    lowLatencyEngine.binanceWs = { readyState: 1 }; // OPEN

    const monitor = new TradingConnectionMonitorDaemon({
        intervalMs: 1000,
        outageThreshold: 2 // 2 fails triggers halt
    });
    monitor.active = true;

    try {
        // 1. Healthy state check
        await runTest('Healthy Connection check', async () => {
            const check = await monitor.checkConnectivity();
            if (!check.ok) {
                throw new Error(`Expected connection check to be healthy. Reasons: ${check.reason.join(', ')}`);
            }
            if (check.alpacaWsOpen !== true || check.binanceWsOpen !== true || check.internetAccess !== true) {
                throw new Error('Healthy connections flags not set correctly');
            }
        });

        // 2. Outage accumulation & halt trigger
        await runTest('Connection Outage Halted & Orders Cancelled', async () => {
            // Mock connection failure
            lowLatencyEngine.alpacaWs.connection.ws.readyState = 3; // CLOSED
            lowLatencyEngine.binanceWs.readyState = 3; // CLOSED

            // Stub emergency cancellations
            let alpacaCancelTriggered = false;
            let binanceCancelTriggered = false;

            alpacaService.closeAllPositions = async () => {
                alpacaCancelTriggered = true;
                return { success: true };
            };
            binanceService.emergencyStop = async () => {
                binanceCancelTriggered = true;
                return { success: true };
            };

            // Run first tick (should fail but not halt yet)
            await monitor.onTick();
            if (monitor.failedChecks !== 1) {
                throw new Error(`Expected 1 failed check, got: ${monitor.failedChecks}`);
            }
            if (riskGateway.isHardHalted !== false) {
                throw new Error('RiskGateway halted prematurely');
            }

            // Run second tick (should trigger halt & cancel)
            await monitor.onTick();
            if (monitor.failedChecks !== 2) {
                throw new Error(`Expected 2 failed checks, got: ${monitor.failedChecks}`);
            }
            if (riskGateway.isHardHalted !== true) {
                throw new Error('RiskGateway failed to halt on connection outage');
            }
            if (!alpacaCancelTriggered || !binanceCancelTriggered) {
                throw new Error('Emergency cancellations were not dispatched to brokers');
            }

            console.log('Outage halt triggered and cancel orders dispatched successfully.');
        });

        // 3. Connection recovery with lingering open orders (should keep halt active)
        await runTest('Recovery With Lingering Orders (Maintain Halt)', async () => {
            // Restore connection mock
            lowLatencyEngine.alpacaWs.connection.ws.readyState = 1; // OPEN
            lowLatencyEngine.binanceWs.readyState = 1; // OPEN

            // Mock that brokers still have resting open orders
            alpacaService.client = {
                getOrders: async () => [{ id: 'order_1' }] // 1 open order
            };
            binanceService.getOpenOrders = async () => [];

            // Tick (should recover connection count but retain halt due to lingering exposure)
            await monitor.onTick();

            if (monitor.failedChecks !== 0) {
                throw new Error('Expected failed checks to reset to 0');
            }
            if (riskGateway.isHardHalted !== true) {
                throw new Error('Halt disarmed despite lingering open orders on broker');
            }

            console.log('Halt maintained correctly because open orders were detected.');
        });

        // 4. Connection recovery with clean exposure (should disarm halt)
        await runTest('Recovery With Clean Exposure (Disarm Halt)', async () => {
            // Mock that open orders are now resolved
            alpacaService.client = {
                getOrders: async () => [] // 0 open orders
            };
            binanceService.getOpenOrders = async () => [];

            // Manually mark monitor as halting (since we simulated lingering state previously)
            monitor.isHaltingDueToOutage = true;

            // Tick (should recover & disarm)
            await monitor.onTick();

            if (riskGateway.isHardHalted !== false) {
                throw new Error('Emergency halt not disarmed after clean exposure check');
            }

            console.log('Halt disarmed successfully after confirming zero exposure.');
        });

    } finally {
        // Restore environment stubs
        alpacaService.isConnected = originalAlpacaIsConnected;
        lowLatencyEngine.alpacaWs = originalAlpacaWs;
        lowLatencyEngine.binanceWs = originalBinanceWs;
        alpacaService.closeAllPositions = originalAlpacaClose;
        binanceService.emergencyStop = originalBinanceClose;
        if (alpacaService.client) {
            alpacaService.client.getOrders = originalAlpacaGetOrders;
        }
        binanceService.getOpenOrders = originalBinanceGetOrders;
    }

    console.log('\n=== ALL CONNECTION MONITOR TESTS PASSED ===');
}

main().catch(e => {
    console.error('\n🔴 CRITICAL RUNTIME ERROR IN SUITE:', e);
    process.exit(1);
});
