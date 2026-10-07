/**
 * Pre-Trade Risk Gateway & Vectorized Backtest Verification Suite
 * 
 * Verifies:
 * - Safe orders, Fat-finger rejections, Cooldowns, Rate-limiting, Halts
 * - Dynamic configuration & halt state persistence
 * - Fail-closed price deviation checks during quote API downtime
 * - Cryptographically verified Audit Ledger logging
 * - Vectorized Backtest Engine performance and execution correctness
 */

import fs from 'fs';
import path from 'path';
import riskGateway from '../server/finance/RiskGateway.js';
import alpacaService from '../server/finance/AlpacaService.js';
import marketDataService from '../server/finance/marketDataService.js';
import VectorizedBacktestEngine from '../server/finance/VectorizedBacktestEngine.js';

async function runTest(testName, testFn) {
    console.log(`\n--------------------------------------------------`);
    console.log(`RUNNING TEST: ${testName}`);
    console.log(`--------------------------------------------------`);
    // Reset transient metrics state before each test
    riskGateway.submissionTimestamps = [];
    riskGateway.lastSymbolOrderTime.clear();
    try {
        await testFn();
        console.log(`✅ TEST PASSED: ${testName}`);
    } catch (e) {
        console.error(`❌ TEST FAILED: ${testName}\nReason:`, e.stack || e.message);
        throw e;
    }
}

async function main() {
    console.log('=== STARTING PRODUCTION-GRADE TEST SUITE ===');

    // Armed status
    riskGateway.setHardHalt(false);

    // Stub alpacaService.getQuote globally for tests
    const originalGetQuote = alpacaService.getQuote;
    const originalRiskConfig = { ...riskGateway.config };
    const originalHardHalt = riskGateway.isHardHalted;
    alpacaService.getQuote = async (symbol) => {
        // Return realistic quotes to bypass deviation checks
        if (symbol === 'AAPL') return { price: 150.0 };
        if (symbol === 'TSLA') return { price: 150.0 };
        if (symbol === 'MSFT') return { price: 150.0 };
        if (symbol === 'NFLX') return { price: 150.0 };
        if (symbol === 'AMZN') return { price: 150.0 };
        return { price: 100.0 };
    };

    try {
        // 1. Safe Order Pass
        await runTest('Safe Order Pass', async () => {
            const order = {
                symbol: 'AAPL',
                side: 'buy',
                qty: 3,
                price: 150.0,
                type: 'limit'
            };
            const result = await riskGateway.validateOrder(order);
            if (result !== true) throw new Error('Expected validation to return true');
        });

        // 2. Fat-Finger Protection (far exceeds the persisted runtime limit)
        await runTest('Fat-Finger Protection Trigger', async () => {
            const order = {
                symbol: 'TSLA',
                side: 'buy',
                qty: 100,
                price: 150.0, // Total: $15,000
                type: 'limit'
            };
            try {
                await riskGateway.validateOrder(order);
                throw new Error('Fat-finger trade was not blocked');
            } catch (e) {
                console.log('Blocked correctly with message:', e.message);
                if (!e.message.includes('Fat-finger protection')) {
                    throw new Error(`Unexpected error: ${e.message}`);
                }
            }
        });

        // 3. Cooldown check (submitting same asset within 2s)
        await runTest('Consecutive Order Cooldown Trigger', async () => {
            const order = {
                symbol: 'MSFT',
                side: 'buy',
                qty: 5,
                price: 150.0,
                type: 'limit'
            };
            riskGateway.lastSymbolOrderTime.set('MSFT', Date.now());
            try {
                await riskGateway.validateOrder(order);
                throw new Error('Cooldown block failed');
            } catch (e) {
                console.log('Blocked correctly with message:', e.message);
                if (!e.message.includes('Cooldown active')) {
                    throw new Error(`Unexpected error: ${e.message}`);
                }
            }
        });

        // 4. Rate-Limiting sliding window (5 orders in 10s)
        await runTest('Gateway Rate-Limiting sliding window', async () => {
            const order = {
                symbol: 'NFLX',
                side: 'buy',
                qty: 5,
                price: 150.0,
                type: 'limit'
            };
            const now = Date.now();
            riskGateway.submissionTimestamps = [now, now, now, now, now];
            try {
                await riskGateway.validateOrder(order);
                throw new Error('Rate limiting failed to block order');
            } catch (e) {
                console.log('Blocked correctly with message:', e.message);
                if (!e.message.includes('Rate limit reached')) {
                    throw new Error(`Unexpected: ${e.message}`);
                }
            }
        });

        // 5. Price Deviation Guard (safe case vs deviation trigger)
        await runTest('Price Deviation Guard', async () => {
            const order = {
                symbol: 'AMZN',
                side: 'buy',
                qty: 3,
                price: 250.0, // Limit price $250 vs quote $150
                type: 'limit'
            };

            try {
                await riskGateway.validateOrder(order);
                throw new Error('Price deviation block failed');
            } catch (e) {
                console.log('Blocked correctly with message:', e.message);
                if (!e.message.includes('Price deviation guard')) {
                    throw new Error(`Unexpected error: ${e.message}`);
                }
            } finally {
                riskGateway.setHardHalt(false);
            }
        });

        // 6. Fail-Closed on Quote Resolve Failure
        await runTest('Fail-Closed On Quote API Downtime', async () => {
            const order = {
                symbol: 'NVDA',
                side: 'buy',
                qty: 5,
                price: 100.0,
                type: 'limit'
            };

            const originalGetPrice = marketDataService.getLatestPrice;

            // Simulate API breakdown (alpaca stubbed locally for this test block)
            const backupGetQuote = alpacaService.getQuote;
            alpacaService.getQuote = async () => { throw new Error('API Timeout'); };
            marketDataService.getLatestPrice = async () => { throw new Error('API Timeout'); };

            // Test with fail-closed enabled (default)
            riskGateway.config.failClosedOnQuoteError = true;
            try {
                await riskGateway.validateOrder(order);
                throw new Error('Order was not blocked during quote downtime (should fail-closed)');
            } catch (e) {
                console.log('Blocked correctly under fail-closed behavior:', e.message);
                if (!e.message.includes('Price deviation check failed')) {
                    throw new Error(`Unexpected error message: ${e.message}`);
                }
            }

            // Test with fail-closed disabled (should pass deviation check bypass)
            riskGateway.config.failClosedOnQuoteError = false;
            const passed = await riskGateway.validateOrder(order);
            if (passed !== true) {
                throw new Error('Order was blocked despite failClosedOnQuoteError: false');
            }
            console.log('Successfully bypassed deviation checks when fail-closed is disabled');

            // Restore
            alpacaService.getQuote = backupGetQuote;
            marketDataService.getLatestPrice = originalGetPrice;
            riskGateway.config.failClosedOnQuoteError = true;
        });

        // 7. Config and State Disk Persistence
        await runTest('Config & Halt State Persistence', async () => {
            // Change dynamic configs
            riskGateway.config.maxOrderValueUsd = 9999;
            riskGateway.isHardHalted = true;
            riskGateway.savePersistedState();

            // Instantiate fresh instance state variables
            const storedFile = riskGateway.configFilePath;
            if (!fs.existsSync(storedFile)) {
                throw new Error('State persistence file was not written to disk');
            }

            // Reload from disk
            riskGateway.initPersistedState();
            if (riskGateway.config.maxOrderValueUsd !== 9999) {
                throw new Error('Configuration failed to reload correctly from disk');
            }
            if (riskGateway.isHardHalted !== true) {
                throw new Error('Emergency halt state failed to reload correctly from disk');
            }

            console.log('Config and Halt state persisted & reloaded correctly from file:', storedFile);

            // Restore the operator's persisted configuration after proving reload.
            riskGateway.config = { ...originalRiskConfig };
            riskGateway.isHardHalted = originalHardHalt;
            riskGateway.savePersistedState();
        });

        // 8. Cryptographic Audit Ledger Integration
        await runTest('Cryptographic Audit Ledger Verification', async () => {
            const ledger = riskGateway._getAuditLedger();
            if (!ledger) {
                throw new Error('Audit Ledger was not resolved');
            }

            // Trigger validation check to generate logs
            const order = { symbol: 'AAPL', side: 'buy', qty: 2, price: 150.0, type: 'limit' };
            await riskGateway.validateOrder(order);

            // Verify the database chain is mathematically intact
            const verification = ledger.verify();
            console.log('Audit chain validation result:', verification);
            if (!verification.valid) {
                throw new Error(`Audit ledger verification failed: ${verification.reason}`);
            }
            if (verification.entries === 0) {
                throw new Error('Expected at least one ledger entry to have been written');
            }
        });

        // 9. High-Performance Vectorized Backtest Verification
        await runTest('Vectorized Backtester Signal Execution', async () => {
            const engine = new VectorizedBacktestEngine({
                initialCapital: 10000,
                feeRate: 0.001,
                slippage: 0.0005,
                maxPositionSize: 0.1
            });

            // 100 sample candles
            const candles = Array.from({ length: 100 }, (_, idx) => {
                const time = 1780509853000 + (idx * 60000);
                // Simulate ascending close values with periodic dips
                const price = 100 + idx * 0.5 + (idx % 10 === 0 ? -3 : 0);
                return {
                    time,
                    open: price - 0.2,
                    high: price + 0.5,
                    low: price - 0.5,
                    close: price,
                    volume: 1000
                };
            });

            // Simulating a vectorized short/long crossover mask strategy
            const vectorStrategy = (cols, eng) => {
                const smaShort = eng.vectorSMA(cols.close, 5);
                const smaLong = eng.vectorSMA(cols.close, 10);
                
                const len = cols.close.length;
                const buyMask = new Int8Array(len);
                const sellMask = new Int8Array(len);

                for (let i = 1; i < len; i++) {
                    if (smaShort[i - 1] <= smaLong[i - 1] && smaShort[i] > smaLong[i]) {
                        buyMask[i] = 1; // crossover signal
                    } else if (smaShort[i - 1] >= smaLong[i - 1] && smaShort[i] < smaLong[i]) {
                        sellMask[i] = 1; // crossunder signal
                    }
                }
                return { buyMask, sellMask };
            };

            const result = await engine.runBacktest(candles, vectorStrategy, { symbol: 'VEC_TEST' });
            
            if (!result.success) {
                throw new Error(`Vectorized backtest failed: ${result.error}`);
            }
            
            console.log('Vectorized Backtest completed successfully.');
            console.log('Metrics summary:', result.metrics);
            
            if (result.trades.length === 0) {
                throw new Error('Expected at least one signal execution to fill positions');
            }
            if (result.metrics.finalCapital <= 0) {
                throw new Error('Backtest resulted in absolute loss of capital');
            }
        });

        // 10. Auto-Halt on Price Deviation Breach
        await runTest('Auto-Halt on Price Deviation Breach', async () => {
            // Re-arm
            riskGateway.setHardHalt(false);
            
            const order = {
                symbol: 'AMZN',
                side: 'buy',
                qty: 3,
                price: 250.0, // deviates by >0.5% from mid $150
                type: 'limit'
            };

            try {
                await riskGateway.validateOrder(order);
                throw new Error('Deviation limit breach was not blocked');
            } catch (e) {
                console.log('Blocked correctly. Message:', e.message);
                if (!e.message.includes('Price deviation guard')) {
                    throw new Error(`Unexpected error: ${e.message}`);
                }
            }

            // Verify that it is now hard-halted
            if (!riskGateway.isHardHalted) {
                throw new Error('System should be hard-halted after price deviation breach');
            }

            // Verify a subsequent safe order is blocked because of the halt
            const safeOrder = {
                symbol: 'AAPL',
                side: 'buy',
                qty: 1,
                price: 150.0,
                type: 'limit'
            };
            try {
                await riskGateway.validateOrder(safeOrder);
                throw new Error('Safe order was not blocked during hard halt');
            } catch (e) {
                console.log('Subsequent order blocked correctly due to halt:', e.message);
                if (!e.message.includes('Emergency stop is active')) {
                    throw new Error(`Unexpected error: ${e.message}`);
                }
            }

            // Reset halt state for subsequent tests
            riskGateway.setHardHalt(false);
        });

        // 11. Auto-Halt on Unit Price Threshold Breach
        await runTest('Auto-Halt on Unit Price Threshold Breach', async () => {
            // Re-arm
            riskGateway.setHardHalt(false);
            
            // maxPriceThresholdUsd defaults to 5000. Let's send an order with price 6000.
            const order = {
                symbol: 'AAPL',
                side: 'buy',
                qty: 0.1,
                price: 6000.0,
                type: 'limit'
            };

            try {
                await riskGateway.validateOrder(order);
                throw new Error('Unit price threshold breach was not blocked');
            } catch (e) {
                console.log('Blocked correctly. Message:', e.message);
                if (!e.message.includes('Unit price guard')) {
                    throw new Error(`Unexpected error: ${e.message}`);
                }
            }

            // Verify that it is now hard-halted
            if (!riskGateway.isHardHalted) {
                throw new Error('System should be hard-halted after unit price threshold breach');
            }

            // Reset halt state
            riskGateway.setHardHalt(false);
        });

        console.log('\n=== ALL PRODUCTION-GRADE TESTS PASSED ===');

    } finally {
        alpacaService.getQuote = originalGetQuote;
        riskGateway.config = { ...originalRiskConfig };
        riskGateway.isHardHalted = originalHardHalt;
        riskGateway.savePersistedState();
    }
}

main().catch(e => {
    console.error('\n🔴 CRITICAL RUNTIME ERROR IN SUITE:', e);
    process.exit(1);
});
