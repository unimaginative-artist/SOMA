/**
 * test-mission-control-wiring.mjs
 *
 * Structural audit: every API endpoint Mission Control calls must exist
 * in the backend route files. No live server required — this reads source.
 *
 * Run: node tests/test-mission-control-wiring.mjs
 * Live: node tests/test-mission-control-wiring.mjs --live  (hits localhost:3001)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());
const LIVE = process.argv.includes('--live');
const BASE = 'http://localhost:3001';

let passed = 0;
let failed = 0;
let warned = 0;

function ok(msg)   { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.error(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warned++; }

// ─── All API endpoints that Mission Control frontend calls ─────────────────────
// Format: [method, path, source component]
const MC_ENDPOINTS = [
    // MissionControlApp.jsx — core data loops
    ['GET',  '/api/autonomous/status',            'MissionControlApp (trading poll)'],
    ['GET',  '/api/autonomous/decisions',         'MissionControlApp (trading poll)'],
    ['POST', '/api/autonomous/start',             'MissionControlApp (engage)'],
    ['POST', '/api/autonomous/stop',              'MissionControlApp (stop)'],
    ['GET',  '/api/alpaca/status',                'MissionControlApp/SettingsModal'],
    ['GET',  '/api/alpaca/account',               'MissionControlApp (balance)'],
    ['GET',  '/api/alpaca/orders',                'MissionControlApp (orders poll)'],
    ['POST', '/api/alpaca/connect',               'MissionControlApp/SettingsModal'],
    ['POST', '/api/alpaca/emergency-stop',        'MissionControlApp (kill switch)'],
    ['POST', '/api/alpaca/trailing-stop',         'ManualWorkstation'],
    ['GET',  '/api/binance/prices',               'MissionControlApp (ticker hydration)'],
    ['POST', '/api/binance/emergency-stop',       'MissionControlApp (kill switch)'],
    ['GET',  '/api/binance/orderbook/:symbol',    'MarketRadar'],
    ['GET',  '/api/market/bars/:symbol',          'MissionControlApp (chart data)'],
    ['GET',  '/api/market/price/:symbol',         'VWAPExecutor (internal)'],
    ['GET',  '/api/scalping/stats',               'MarketRadar + DemoTrainingPanel'],
    ['POST', '/api/scalping/stop',                'MissionControlApp (stop)'],
    ['POST', '/api/lowlatency/start',             'MissionControlApp (engage)'],
    ['POST', '/api/lowlatency/stop',              'MissionControlApp (stop)'],
    ['GET',  '/api/performance/summary',          'MissionControlApp + LearningDashboard'],
    ['GET',  '/api/performance/equity-curve',     'LearningDashboard'],
    ['GET',  '/api/learning/report',              'MissionControlApp (readiness)'],
    ['GET',  '/api/learning/events',              'LearningDashboard'],
    ['GET',  '/api/learning/status',              'MissionControlApp'],
    ['GET',  '/api/trading/regime',               'MissionControlApp'],
    ['GET',  '/api/trading/position-size',        'ManualWorkstation'],
    ['GET',  '/api/backtest/strategies',          'BacktestPanel'],
    ['POST', '/api/backtest/run',                 'BacktestPanel'],
    ['GET',  '/api/backtest/:id',                 'BacktestPanel'],
    ['GET',  '/api/backtest/:id/equity',          'BacktestPanel'],
    ['GET',  '/api/backtest/:id/trades',          'BacktestPanel'],
    ['POST', '/api/backtest/:id/stop',            'BacktestPanel'],
    ['GET',  '/api/debate',                       'DebateArena'],
    ['POST', '/api/debate/create',                'DebateArena'],
    ['POST', '/api/debate/:id/start',             'DebateArena'],
    ['GET',  '/api/debate/:id/stream',            'DebateArena (SSE)'],
    ['POST', '/api/debate/:id/cancel',            'DebateArena'],
    ['GET',  '/api/alerts',                       'AlertsPanel'],
    ['POST', '/api/alerts',                       'AlertsPanel (create)'],
    ['DELETE','/api/alerts/:id',                  'AlertsPanel (delete)'],
    ['POST', '/api/alerts/:id/reset',             'AlertsPanel (reset)'],
    ['GET',  '/api/exchange/credentials-status',  'SettingsModal'],
    ['POST', '/api/exchange/test',                'SettingsModal'],
    ['POST', '/api/exchange/clear-credentials',   'SettingsModal'],
    ['GET',  '/api/finance/search',               'GlobalControls'],
    ['POST', '/api/finance/analyze',              'AIAnalysisModal + ManualWorkstation'],
    ['GET',  '/api/finance/news',                 'ManualWorkstation'],
    ['POST', '/api/finance/execute',              'ManualWorkstation'],
    ['GET',  '/api/notifications/settings',       'SettingsModal'],
    ['POST', '/api/notifications/settings',       'SettingsModal'],
    ['POST', '/api/soma/chat',                    'MissionControlApp (Ask SOMA)'],
    ['POST', '/api/lowlatency/start',             'MissionControlApp'],
];

// ─── Route inventory built from route files ───────────────────────────────────
const ROUTE_FILES = [
    ['server/finance/autonomousRoutes.js',      '/api/autonomous'],
    ['server/finance/alpacaRoutes.js',          '/api/alpaca'],
    ['server/finance/binanceRoutes.js',         '/api/binance'],
    ['server/finance/marketDataRoutes.js',      '/api/market'],
    ['server/finance/scalpingRoutes.js',        '/api/scalping'],
    ['server/finance/lowLatencyRoutes.js',      '/api/lowlatency'],
    ['server/finance/performanceRoutes.js',     '/api/performance'],
    ['server/finance/performanceRoutes.js',     '/api/learning'],
    ['server/finance/performanceRoutes.js',     '/api/trading'],
    ['server/finance/backtestRoutes.js',        '/api/backtest'],
    ['server/finance/debateRoutes.js',          '/api/debate'],
    ['server/finance/alertRoutes.js',           '/api/alerts'],
    ['server/finance/exchangeRoutes.js',        '/api/exchange'],
    ['server/finance/financeRoutes.js',         '/api/finance'],
    ['server/routes/notificationRoutes.js',     '/api/notifications'],
    ['server/routes/somaRoutes.js',             '/api/soma'],
];

/** Build a set of known (method, prefix+path) pairs from route source */
function buildRouteInventory() {
    const known = new Set();

    // router.get/post/etc in route files
    for (const [file, prefix] of ROUTE_FILES) {
        let src;
        try { src = readFileSync(resolve(ROOT, file), 'utf8'); }
        catch { continue; }

        const re = /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
        let m;
        while ((m = re.exec(src)) !== null) {
            const method = m[1].toUpperCase();
            const subpath = m[2];
            // '/' on a mounted router means the mount prefix itself
            const full = subpath === '/' ? prefix : prefix + subpath;
            const normalised = full.replace(/:[^/]+/g, ':param');
            known.add(`${method} ${normalised}`);
            // Also add without trailing slash so GET /api/alerts matches /api/alerts/
            known.add(`${method} ${normalised.replace(/\/$/, '')}`);
        }
    }

    // Also parse direct app.get/post in routes.js (inline handlers)
    try {
        const src = readFileSync(resolve(ROOT, 'server/loaders/routes.js'), 'utf8');
        const re = /app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
        let m;
        while ((m = re.exec(src)) !== null) {
            const method = m[1].toUpperCase();
            const path = m[2].replace(/:[^/]+/g, ':param');
            known.add(`${method} ${path}`);
        }
    } catch { /* ignore */ }

    return known;
}

/** Check if routeInventory covers an endpoint (supports :param wildcards) */
function isCovered(inventory, method, path) {
    const norm = path.replace(/:[^/]+/g, ':param');
    if (inventory.has(`${method} ${norm}`)) return true;
    // Try with trailing slash stripped/added
    if (inventory.has(`${method} ${norm}/`)) return true;
    if (inventory.has(`${method} ${norm.replace(/\/$/, '')}`)) return true;
    // Prefix match for parameterised sub-routes
    for (const entry of inventory) {
        if (!entry.startsWith(`${method} `)) continue;
        const ep = entry.slice(method.length + 1);
        if (norm === ep) return true;
        // /api/backtest/:param/equity should match /api/backtest/:id/equity
        if (ep === norm) return true;
        const epNorm = ep.replace(/:[^/]+/g, ':param');
        if (epNorm === norm) return true;
    }
    return false;
}

// ─── 1. Structural check (offline) ───────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  Mission Control — API Wiring Audit (Structural)');
console.log('══════════════════════════════════════════════════════');

const inventory = buildRouteInventory();
console.log(`  Route inventory: ${inventory.size} endpoints across ${ROUTE_FILES.length} route files\n`);

// Deduplicate endpoints for checking
const seen = new Set();
for (const [method, path, source] of MC_ENDPOINTS) {
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (isCovered(inventory, method, path)) {
        ok(`${method.padEnd(7)} ${path.padEnd(45)} ← ${source}`);
    } else {
        fail(`${method.padEnd(7)} ${path.padEnd(45)} NOT FOUND — ${source}`);
    }
}

// ─── 2. routes.js mount check ────────────────────────────────────────────────

console.log('\n── Mount check (routes.js) ──────────────────────────');
let routesJs;
try { routesJs = readFileSync(resolve(ROOT, 'server/loaders/routes.js'), 'utf8'); }
catch { routesJs = ''; }

const mounts = [
    ['/api/autonomous',    'autonomousRoutes'],
    ['/api/alpaca',        'alpacaRoutes'],
    ['/api/binance',       'binanceRoutes'],
    ['/api/market',        'marketDataRoutes'],
    ['/api/scalping',      'scalpingRoutes'],
    ['/api/lowlatency',    'lowLatencyRoutes'],
    ['/api/performance',   'performanceRoutes'],
    ['/api/learning',      'performanceRoutes'],
    ['/api/trading',       'performanceRoutes'],
    ['/api/backtest',      'backtestRoutes'],
    ['/api/debate',        'debateRoutes'],
    ['/api/alerts',        'alertRoutes'],
    ['/api/exchange',      'exchangeRoutes'],
    ['/api/finance',       'financeRoutes'],
    ['/api/notifications', 'notificationRoutes'],
    ['/api/soma',          'somaRoutes'],
];

for (const [prefix, routeVar] of mounts) {
    const mounted = routesJs.includes(`'${prefix}'`) || routesJs.includes(`"${prefix}"`);
    const imported = routesJs.includes(routeVar);
    if (mounted && imported) {
        ok(`${prefix.padEnd(25)} mounted (${routeVar})`);
    } else if (!imported) {
        fail(`${prefix.padEnd(25)} NOT IMPORTED — ${routeVar} missing from routes.js`);
    } else if (!mounted) {
        fail(`${prefix.padEnd(25)} imported but NOT mounted — add safeMount('${prefix}', ...)`);
    }
}

// ─── 3. Live API test (optional) ─────────────────────────────────────────────

if (LIVE) {
    console.log('\n── Live API test (localhost:3001) ────────────────────');
    console.log('  (routes may be slow when trading engine is running)');

    const LIVE_TESTS = [
        ['GET',  '/api/autonomous/status'],
        ['GET',  '/api/autonomous/decisions?limit=5'],
        ['GET',  '/api/alpaca/status'],
        ['GET',  '/api/market/bars/BTC-USD?timeframe=5Min&limit=5'],
        ['GET',  '/api/scalping/stats'],
        ['GET',  '/api/performance/summary'],
        ['GET',  '/api/learning/report'],
        ['GET',  '/api/learning/events?limit=3'],
        ['GET',  '/api/trading/regime?symbol=BTC-USD'],
        ['GET',  '/api/trading/position-size?symbol=BTC-USD'],
        ['GET',  '/api/backtest/strategies'],
        ['GET',  '/api/debate'],
        ['GET',  '/api/alerts'],
        ['GET',  '/api/exchange/credentials-status'],
        ['GET',  '/api/notifications/settings'],
        ['GET',  '/api/finance/search?q=AAPL'],
    ];

    for (const [method, path] of LIVE_TESTS) {
        const start = Date.now();
        try {
            const r = await fetch(BASE + path, {
                method,
                signal: AbortSignal.timeout(12000),
                headers: { 'Content-Type': 'application/json' },
            });
            const ms = Date.now() - start;
            const body = await r.text();
            const parsed = JSON.parse(body);

            if (r.status >= 500) {
                fail(`${r.status} ${ms}ms ${method} ${path} | ${body.slice(0, 80)}`);
            } else if (r.status === 404) {
                fail(`404 ${ms}ms ${method} ${path} — route not found`);
            } else {
                const note = ms > 5000 ? ` (SLOW: ${ms}ms — trading engine busy)` : ` (${ms}ms)`;
                ok(`${r.status}${note} ${method} ${path}`);
                if (parsed.success === false && parsed.error && !parsed.error.includes('not connected') && !parsed.error.includes('451')) {
                    warn(`  response.success=false: ${parsed.error?.slice(0, 60)}`);
                }
            }
        } catch (e) {
            const ms = Date.now() - start;
            if (e.name === 'TimeoutError' || e.message.includes('aborted')) {
                warn(`SLOW/TIMEOUT ${ms}ms ${method} ${path} — server may be busy`);
            } else {
                fail(`ERR ${ms}ms ${method} ${path} — ${e.message.slice(0, 60)}`);
            }
        }
    }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${warned} warnings, ${failed} failed`);
if (!LIVE) console.log('  Run with --live to also hit the live server');
console.log('══════════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
