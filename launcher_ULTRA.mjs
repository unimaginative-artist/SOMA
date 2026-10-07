#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// SOMA Level 4.5 - ULTRA MODULAR BOOTSTRAP (V3 STABILITY)
// "The Ghost in the Machine"
// ═══════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import path from 'path';
import http from 'http';
import { config as dotenvConfig, parse as dotenvParse } from 'dotenv';
import fs from 'fs';
import express from 'express';
import { WebSocketServer } from 'ws';

// Load environment variables FIRST — .env first, then config/api-keys.env overrides
// (api-keys.env has the real DeepSeek key; .env may have placeholder values)
dotenvConfig();
const apiKeysPath = join(dirname(fileURLToPath(import.meta.url)), 'config', 'api-keys.env');
if (fs.existsSync(apiKeysPath)) {
    // Override with api-keys.env — but never with an EMPTY value. A blank placeholder
    // (`DEEPSEEK_API_KEY=`) used to wipe the real key from .env on every boot, silently
    // dropping SOMA's brain off DeepSeek onto slow local fallbacks.
    const parsedKeys = dotenvParse(fs.readFileSync(apiKeysPath));
    for (const [key, value] of Object.entries(parsedKeys)) {
        if (String(value).trim() !== '') process.env[key] = value;
    }
}
process.env.SOMA_PROCESS_TYPE = 'backend';
process.env.NODE_ENV = 'development';
process.env.SOMA_MOCK_VISION_MODEL = 'false';

import { CONFIG } from './core/SomaConfig.js';
import { SomaBootstrapV2 as SomaBootstrap } from './core/SomaBootstrapV2.js';
import { SystemValidator } from './core/SystemValidator.js';
import { logger } from './core/Logger.js';
import { ensureOperatorCredential } from './server/loaders/operatorCredential.js';
import { portHasListener } from './core/PortOwnership.js';
import { currentSystemMemoryHealth } from './core/SystemMemoryHealth.js';
import { ensureLocalChatOllamaSidecar } from './core/LocalChatOllamaSidecar.js';

import beingKernel from './core/BeingKernel.js';
import commitmentEngine from './core/CommitmentEngine.js';
import memorySpine from './core/MemorySpine.js';

// Provision a dedicated operator credential before protected governance and
// social-review routes begin accepting requests. Never reuse social tokens.
ensureOperatorCredential();

const DEBUG_LOG = join(process.cwd(), 'logs', 'launcher_debug.log');
const logSync = (msg) => {
    const entry = `[${new Date().toISOString()}] ${msg}\n`;
    try { fs.appendFileSync(DEBUG_LOG, entry); } catch (e) {}
};

// --- ANSI COLOR LOGGER (Restoring the "Green" Matrix vibe) ---
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    blue: "\x1b[34m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    dim: "\x1b[2m"
};

const cLog = (type, msg) => {
    let color = colors.reset;
    let label = type;
    
    switch (type) {
        case 'ULTRA': color = colors.magenta; break;
        case 'SERVER': color = colors.green; break;
        case 'BACKEND': color = colors.green; break; // Legacy compat
        case 'BOOTSTRAP': color = colors.cyan; break;
        case 'ERROR': color = colors.red; break;
        case 'WARN': color = colors.yellow; break;
    }
    
    console.log(`${colors.dim}[${new Date().toLocaleTimeString()}]${colors.reset} ${color}[${label}]${colors.reset} ${msg}`);
};

logSync('>>> SOMA ENGINE STARTUP <<<');

process.on('exit', (code) => {
    logSync(`[PROCESS] System exiting with code: ${code}`);
    cLog('ULTRA', `System exiting with code: ${code}`);
});

process.on('SIGTERM', () => {
    logSync(`[SIGNAL] Received SIGTERM`);
    process.exit(0);
});

process.on('SIGINT', () => {
    logSync(`[SIGNAL] Received SIGINT`);
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    logSync(`[FATAL] Uncaught Exception: ${err.message}\n${err.stack}`);
    cLog('ERROR', `Uncaught Exception: ${err.message}`);
    // Only exit on truly fatal errors, not transient async issues
    if (!global.__SOMA_SERVER_READY) {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : '';
    logSync(`[WARN] Unhandled Rejection: ${msg}\n${stack}`);
    cLog('ERROR', `Unhandled Rejection: ${msg}`);
    // Don't crash on non-critical async errors after server is running
    if (!global.__SOMA_SERVER_READY) {
        process.exit(1);
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Marionette owns recovery of an unresponsive listener. This launcher never
// kills a process merely because an HTTP handler is slow under load.

// --- HARDENING: Prevents EPIPE crashes ---
process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') return;
});
process.stderr.on('error', (err) => {
    if (err.code === 'EPIPE') return;
});

async function main() {
    try {
        cLog('ULTRA', '🟢 Initializing SOMA System...');

        // 1. Start Server IMMEDIATELY (Atomic Port Binding)
        const PORT = 3001;
        if (await portHasListener(PORT)) {
            cLog('ULTRA', `🟡 A SOMA listener already owns port ${PORT}. Yielding to the incumbent and Marionette.`);
            logSync(`[PORT-OWNERSHIP] Listener present on ${PORT}; no process was killed.`);
            process.exit(0);
        }

        const app = express();
        const server = http.createServer(app);
        const wss = new WebSocketServer({ server, path: '/ws' });

        // Add middleware BEFORE routes
        app.use(express.json({ limit: '50mb' }));
        app.use(express.urlencoded({ extended: true, limit: '50mb' }));

        // CORS for frontend (incl. mobile Studio on :8088, which sends
        // x-studio-device-* and x-axis-user-* headers on every request —
        // reflect whatever the preflight asks for and answer OPTIONS directly)
        app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
            res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization, x-studio-device-id, x-studio-device-name, x-studio-device-type, x-studio-session, x-axis-user-id, x-axis-user-name, x-axis-user-color');
            if (req.method === 'OPTIONS') return res.sendStatus(204);
            next();
        });

        // 🟢 RESTORED: Serve Frontend (built output lives in frontend/dist)
        app.use(express.static(join(__dirname, 'frontend', 'dist')));

        // 📱 Serve Mobile Studio directly on SOMA port 3001
        const studioMobilePath = 'C:\\Users\\owner\\Desktop\\Studio';
        if (fs.existsSync(studioMobilePath)) {
            app.use('/m', express.static(studioMobilePath));
            app.use('/studio-mobile', express.static(studioMobilePath));
        }

        // Health endpoint — shallow at boot, deep once system is ready
        app.get('/health', (req, res) => {
            const ready = global.__SOMA_SERVER_READY;
            const chatReady = globalThis.__SOMA_CHAT_SIDECAR_READY === true;
            if (!ready || !chatReady) {
                return res.json({ ok: true, status: 'initializing', chatReady, uptime: process.uptime() });
            }
            try {
                const sys = global.__SOMA_SYSTEM;
                const rawStatus = sys?.quadBrain?.getStatus?.() ?? null;
                const providers = rawStatus?.providers || [];
                const brainOk = rawStatus ? (providers.length ? providers.some(p => p.available) : true) : true;
                const deepseek = providers.find(p => p.name === 'deepseek');
                const warnings = [];
                if (deepseek && !deepseek.configured) warnings.push('DeepSeek API key is not loaded — SOMA is running on local models only');
                else if (deepseek?.circuitOpen) warnings.push('DeepSeek keeps failing (circuit open) — SOMA is falling back to local models');
                const memoryHealth = currentSystemMemoryHealth();
                if (memoryHealth.status !== 'HEALTHY') warnings.push(`Memory health: ${memoryHealth.status.toLowerCase()}`);
                const status = memoryHealth.status === 'CRITICAL' ? 'critical' : !brainOk ? 'degraded' : memoryHealth.status.toLowerCase();
                res.json({
                    ok: brainOk && memoryHealth.status !== 'CRITICAL' && memoryHealth.status !== 'UNKNOWN',
                    status,
                    chatReady,
                    uptime: process.uptime(),
                    brainMode: !rawStatus ? 'unknown' : deepseek?.available ? 'full' : brainOk ? 'local-only' : 'down',
                    warnings,
                    brain: rawStatus ? {
                        name: rawStatus.name ?? null,
                        providers: providers.map(p => ({ name: p.name, available: p.available, configured: p.configured, circuitOpen: p.circuitOpen, model: p.model }))
                    } : null,
                    memory: { ...memoryHealth.diagnostics, heapUsedMB: memoryHealth.diagnostics.heapUsedMb,
                        heapTotalMB: memoryHealth.diagnostics.heapTotalMb, thresholds: memoryHealth.thresholds }
                });
            } catch (e) {
                res.json({ ok: false, status: 'unknown', chatReady, uptime: process.uptime(), warning: 'Health assessment failed' });
            }
        });

        server.listen(PORT, '0.0.0.0', () => {
            logSync(`[SERVER] Active on port ${PORT}`);
            cLog('SERVER', `SOMA Core online at http://0.0.0.0:${PORT}`);
        });

        // 2. Database Health Check
        const dbPath = path.join(__dirname, 'soma-memory.db');
        if (fs.existsSync(dbPath)) {
            const stats = fs.statSync(dbPath);
            const sizeGB = stats.size / (1024 * 1024 * 1024);
            if (sizeGB > 2.0) {
                cLog('DATABASE', `⚠️  CRITICAL BLOAT: Database is ${sizeGB.toFixed(2)} GB!`, colors.red);
            } else {
                cLog('DATABASE', `✅ Health: ${sizeGB.toFixed(2)} GB`, colors.green);
            }
        }

        // 3. Pre-Flight
        await SystemValidator.runPreFlightChecks();

        // 4. Bootstrap - Register API Routes
        cLog('BOOTSTRAP', 'Initializing SOMA systems and routes...');
        const bootstrap = new SomaBootstrap();
        await bootstrap.initialize(app, server, wss);
        global.__SOMA_SYSTEM = bootstrap.system;

        // API clients must always receive JSON. Letting unknown /api requests
        // fall through to Express's HTML 404 page causes response.json() to
        // fail with "Unexpected token '<'".
        app.use('/api', (req, res) => {
            res.status(404).json({
                ok: false,
                code: 'API_ROUTE_NOT_FOUND',
                error: `API route not found: ${req.method} ${req.originalUrl}`,
            });
        });

        // React SPA fallback: direct browser navigation to UI paths should
        // return the Command Bridge instead of Express' 404 handler.
        const frontendIndex = join(__dirname, 'frontend', 'dist', 'index.html');
        app.get(/^\/(?!api\/|health$|socket\.io|ws).*/, (req, res, next) => {
            if (req.method !== 'GET') return next();
            // Static-asset requests (anything with a file extension) must NEVER get
            // the SPA shell. If express.static didn't find it above, it's a missing
            // file and must 404 — serving index.html (HTML) for a missing .js chunk
            // after a redeploy is what causes the browser's "Failed to fetch
            // dynamically imported module" crash (it gets HTML where it expects JS).
            if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();
            if (!fs.existsSync(frontendIndex)) return next();
            res.sendFile(frontendIndex);
        });

        // 🧠 MEMORY MANAGEMENT: Periodic GC if available
        if (global.gc) {
            setInterval(() => {
                const usage = process.memoryUsage();
                if (usage.heapUsed > 1500 * 1024 * 1024) { // > 1.5GB
                    cLog('SYSTEM', '🧤 High memory detected, triggering manual GC...');
                    global.gc();
                }
            }, 60000);
        }

        logSync('[BOOTSTRAP] Success - Routes Registered');

        // Mark server as ready so unhandled rejections don't crash it
        global.__SOMA_SERVER_READY = true;
        cLog('ULTRA', 'SOMA Fully Operational');
        // /health includes chat readiness. Start its dedicated local Ollama
        // sidecar without delaying the HTTP server or BeeBots read-only routes.
        void ensureLocalChatOllamaSidecar().catch(error => {
            cLog('WARN', `Local chat sidecar warmup pending: ${error.message}`);
        });

        // 📚 RECURSIVE KNOWLEDGE CONSOLIDATION TICK (Medical & SOMA Sagas Story Master Volumes)
        try {
            const { default: recursiveConsolidationEngine } = await import('./server/services/RecursiveConsolidationEngine.js');
            setInterval(() => {
                try {
                    recursiveConsolidationEngine.runConsolidationCycle();
                } catch (e) {
                    cLog('WARN', `Consolidation tick error: ${e.message}`);
                }
            }, 15 * 60 * 1000); // Every 15 minutes
            recursiveConsolidationEngine.runConsolidationCycle();
        } catch (e) {
            cLog('WARN', `Consolidation engine init skipped: ${e.message}`);
        }

        // Start MessageBroker network bridge — lets external agents (MAX, etc.)
        // register as virtual arbiters and participate in the signal flow
        try {
            const { createRequire } = await import('module');
            const req = createRequire(import.meta.url);
            const broker = req('./core/MessageBroker.cjs');
            const bridgePort = parseInt(process.env.SOMA_BRIDGE_PORT || '4201');
            broker.startNetworkBridge(bridgePort);
        } catch (e) {
            cLog('WARN', `Network bridge skipped: ${e.message}`);
        }

        // 🌌 DORMANT ARCHITECTURES INITIALIZATION: GameTheory, QuantumSimulation, Medical Discovery
        try {
            const { QuantumSimulationArbiter } = await import('./arbiters/QuantumSimulationArbiter.js');
            const { DiscoveryGradeMedicalCortex } = await import('./arbiters/DiscoveryGradeMedicalCortex.js');
            const { default: gameTheoryArbiter } = await import('./arbiters/GameTheoryArbiter.js').catch(() => ({ default: null }));

            const quantum = new QuantumSimulationArbiter();
            const medicalCortex = new DiscoveryGradeMedicalCortex();
            await medicalCortex.onInitialize();

            cLog('ULTRA', '⚛️ Quantum Simulation Engine, Game Theory Arbiter & Discovery Medical Cortex ACTIVE 🟢');
        } catch (e) {
            cLog('WARN', `Dormant architecture init note: ${e.message}`);
        }

    } catch (error) {
        logSync(`[FATAL] main() error: ${error.message}\n${error.stack}`);
        cLog('ERROR', `main() error: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

// Start Main
main();

// IMMORTALITY LOOP
setInterval(() => {
    // Keep event loop alive
}, 10000);
