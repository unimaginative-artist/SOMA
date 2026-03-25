#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// SOMA Level 4.5 - ULTRA MODULAR BOOTSTRAP (V3 STABILITY)
// "The Ghost in the Machine"
// ═══════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import path from 'path';
import http from 'http';
import { config as dotenvConfig } from 'dotenv';
import fs from 'fs';
import express from 'express';
import { WebSocketServer } from 'ws';

// Load environment variables FIRST
dotenvConfig();

import { CONFIG } from './core/SomaConfig.js';
import { SomaBootstrapV2 as SomaBootstrap } from './core/SomaBootstrapV2.js';
import { SystemValidator } from './core/SystemValidator.js';
import { logger } from './core/Logger.js';

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

// ─── Port zombie recovery ────────────────────────────────────
import { execSync } from 'child_process';

function killPortOwner(port) {
    try {
        const pidStr = execSync(
            `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) -join ','"`
        , { encoding: 'utf8', timeout: 3000 }).trim();

        if (!pidStr) return false;

        for (const pid of pidStr.split(',').map(s => s.trim()).filter(Boolean)) {
            // Skip PID 0 — Windows system process, cannot and should not be killed
            if (pid === '0') continue;

            let cmdline = '';
            try {
                cmdline = execSync(`wmic process where ProcessId=${pid} get CommandLine /value`, { encoding: 'utf8', timeout: 2000 });
            } catch (e) { /* wmic may fail on zombie; proceed */ }

            const lower = cmdline.toLowerCase();
            // Skip protected processes
            if (!lower.includes('node') && !lower.includes('launch') && lower.length > 0) {
                logSync(`[PORT-RECOVERY] PID ${pid} is not a standard node process — skipping.`);
                continue;
            }
            
            cLog('ULTRA', `Killing zombie process on port ${port} (PID: ${pid})...
`);
            try {
                process.kill(parseInt(pid), 'SIGKILL');
                logSync(`[PORT-RECOVERY] Killed PID ${pid}`);
            } catch (e) {
                logSync(`[PORT-RECOVERY] Failed to kill PID ${pid}: ${e.message}`);
            }
        }
        return true;
    } catch (e) {
        return false;
    }
}

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

        // ─── Database Health Check ───────────────────────────
        const dbPath = path.join(__dirname, 'soma-memory.db');
        if (fs.existsSync(dbPath)) {
            const stats = fs.statSync(dbPath);
            const sizeGB = stats.size / (1024 * 1024 * 1024);
            if (sizeGB > 2.0) {
                cLog('DATABASE', `⚠️  CRITICAL BLOAT: Database is ${sizeGB.toFixed(2)} GB!`, colors.red);
                cLog('DATABASE', '⚠️  Reasoning timeouts are LIKELY. Run "node purge_memories.mjs" immediately.', colors.yellow);
            } else {
                cLog('DATABASE', `✅ Health: ${sizeGB.toFixed(2)} GB`, colors.green);
            }
        }

        // 1. Kill Zombies on main port only (cluster port 7777 has Windows system PIDs that cause loop)
        const PORT = 3001; // FIXED PORT
        killPortOwner(PORT);

        // 2. Pre-Flight
        await SystemValidator.runPreFlightChecks();

        // 3. Setup Server & Middleware FIRST
        const app = express();
        const server = http.createServer(app);
        const wss = new WebSocketServer({ server, path: '/ws' });

        // Add middleware BEFORE routes
        app.use(express.json({ limit: '50mb' }));
        app.use(express.urlencoded({ extended: true, limit: '50mb' }));

        // CORS for frontend
        app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            next();
        });

        // Serve Frontend (built output lives in frontend/dist)
        app.use(express.static(join(__dirname, 'frontend', 'dist')));

        server.on('error', (e) => {
            cLog('ERROR', `Server error: ${e.message}`);
            logSync(`[SERVER] Error: ${e.message}`);
            if (e.code === 'EADDRINUSE') {
                cLog('ERROR', `Port ${PORT} is already in use!`);
                process.exit(1);
            }
        });

        // Minimal health endpoint early so port binds immediately
        app.get('/health', (req, res) => {
            res.json({ ok: true, status: global.__SOMA_SERVER_READY ? 'healthy' : 'initializing', uptime: process.uptime() });
        });

        // 4. Start Server EARLY (bind port before heavy bootstrap)
        server.listen(PORT, '127.0.0.1', () => {
            logSync(`[SERVER] Active on port ${PORT}`);
            cLog('SERVER', `SOMA Core online at http://127.0.0.1:${PORT}`);
            cLog('BACKEND', `REST API Active on /health`);
            cLog('BACKEND', `WebSocket Server Active on /ws`);
        });

        // 5. Bootstrap - Register Routes AFTER listening
        cLog('BOOTSTRAP', 'Initializing SOMA systems and routes...');
        const bootstrap = new SomaBootstrap();
        await bootstrap.initialize(app, server, wss);

        logSync('[BOOTSTRAP] Success - Routes Registered');

        // Mark server as ready so unhandled rejections don't crash it
        global.__SOMA_SERVER_READY = true;
        cLog('ULTRA', 'SOMA Fully Operational');

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
