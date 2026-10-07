#!/usr/bin/env node
/**
 * scripts/start_trading_sentinel.mjs
 *
 * Launcher for Machine B Quantitative Trading Sentinel.
 * Usage:
 *   node scripts/start_trading_sentinel.mjs            # Starts 24/7 background surveillance
 *   node scripts/start_trading_sentinel.mjs --dry-run  # Runs a single probe tick and exits
 */

import { ClusterTradingSentinel } from './trading/ClusterTradingSentinel.js';

const isDryRun = process.argv.includes('--dry-run');

const sentinel = new ClusterTradingSentinel({
    primaryHost: process.env.SOMA_PRIMARY_HOST || '192.168.1.254:3001',
    pollIntervalMs: 60_000
});

console.log('═══════════════════════════════════════════════════════════');
console.log(' SOMA QUANT CLUSTER: SENTINEL INGESTION & DISPATCH WORKER');
console.log(' Primary Host Target: ' + sentinel.primaryHost);
console.log(' Fallback Local Host: ' + sentinel.localFallbackHost);
console.log(' Mode: ' + (isDryRun ? 'DRY RUN PROBE' : '24/7 LIVE POLLING'));
console.log('═══════════════════════════════════════════════════════════');

if (isDryRun) {
    console.log('[Sentinel] Running single probe tick across OKX feeds...');
    const results = await sentinel.tick();
    console.log('\nProbe Results:');
    for (const r of results) {
        console.log(` • ${r.symbol}: Price $${r.currentPrice.toFixed(2)} | RSI ${r.rsi} | Divergence: ${r.divergence} | Signal: ${r.signal}`);
    }
    console.log('\n[Sentinel] Dry run complete.');
    process.exit(0);
} else {
    sentinel.start();

    process.on('SIGINT', () => {
        console.log('\n[Sentinel] Received SIGINT, gracefully shutting down...');
        sentinel.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n[Sentinel] Received SIGTERM, gracefully shutting down...');
        sentinel.stop();
        process.exit(0);
    });
}
