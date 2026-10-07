#!/usr/bin/env node
/**
 * start_daemon.js - SOMA Cognitive Daemon
 * 
 * Runs SOMA background services 24/7 with low CPU impact.
 * Focuses on:
 * - TimekeeperArbiter (Scheduling)
 * - ImmuneSystemArbiter (Self-Healing)
 * - NighttimeLearningOrchestrator (Dreaming)
 * - MetaLearningEngine (Optimization)
 * 
 * Features:
 * - Low-intensity heartbeat.
 * - Auto-recovery via Immune System.
 * - Ctrl+C graceful shutdown.
 * - No UI/Web server overhead.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import fs from 'fs/promises';

// Load environment
dotenvConfig();
process.env.SOMA_PROCESS_TYPE = 'daemon';
process.env.NODE_ENV = 'development';
process.env.SOMA_MOCK_VISION_MODEL = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { CONFIG } from './core/SomaConfig.js';
import { SomaBootstrap } from './core/SomaBootstrap.js';
import { logger } from './core/Logger.js';
import RepoWatcherDaemon from './daemons/RepoWatcherDaemon.js';
import HealthDaemon from './daemons/HealthDaemon.js';
import net from 'net';

// Daemon State - Shared with main launcher via IPC
const daemonState = {
    startTime: Date.now(),
    memoryConsolidations: 0,
    fileChanges: [],
    dreamInsights: [],
    systemHealth: { healthy: true, alerts: [] },
    lastConsolidation: null,
    lastPersistence: null
};

logger.info(`
╔═══════════════════════════════════════════════════════════╗
║   🌙 SOMA COGNITIVE DAEMON ACTIVE                         ║
║   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━       ║
║   🛡️  Immune System: ON      ⏰ Timekeeper: ON           ║
║   💤 Dream Cycles: ON       🧠 Meta-Learning: ON         ║
║   🏗️  Physics Sim: ON       📁 File Watcher: ON          ║
║   💾 Memory Consolidation: ON   🔗 IPC Bridge: ON        ║
║                                                           ║
║   [Running in background - Low Intensity Mode]            ║
╚═══════════════════════════════════════════════════════════╝
`);

async function main() {
    try {
        // 1. Initialize Bootstrap in "Lightweight" mode if possible
        let system = {};
        try {
            const bootstrap = new SomaBootstrap(process.cwd(), {
                ...CONFIG,
                mode: 'daemon',
                port: 0, // No port needed for web
                clusterPort: 0 // Disable GMN server for daemon
            });
            logger.info('Initializing background arbiters...');
            system = await bootstrap.initialize();
            logger.success('Daemon bootstrap complete.');
        } catch (bootstrapErr) {
            logger.warn('Daemon bootstrap failed — running in minimal mode: ' + bootstrapErr.message);
            // Continue: file watcher, IPC, heartbeat all work without bootstrap
        }

        // SimulationArbiter runs in the main server (launcher_ULTRA), not the daemon.

        logger.success('Daemon mode fully operational.');
        logger.info('Press Ctrl+C to stop the daemon.');

        // 2. Initialize COS Daemons
        const repoWatcher = new RepoWatcherDaemon({ root: process.cwd(), logger });
        const healthDaemon = new HealthDaemon({ logger });

        // Update local state when signals occur (for legacy IPC compatibility)
        repoWatcher.on('signal', (signal) => {
            if (signal.type.startsWith('repo.file')) {
                daemonState.fileChanges.push({ ...signal.payload, type: signal.type.split('.').pop() });
                if (daemonState.fileChanges.length > 100) daemonState.fileChanges.shift();
            }
        });

        healthDaemon.on('signal', (signal) => {
            if (signal.type === 'health.metrics') {
                daemonState.systemHealth = { healthy: true, ...signal.payload };
            }
            if (signal.type === 'health.warning') {
                daemonState.systemHealth.healthy = false;
                daemonState.systemHealth.alerts = daemonState.systemHealth.alerts || [];
                daemonState.systemHealth.alerts.push(signal.payload.issue);
                if (daemonState.systemHealth.alerts.length > 10) daemonState.systemHealth.alerts.shift();
            }
        });

        await Promise.all([
            repoWatcher.start(),
            healthDaemon.start()
        ]);

        // 3. Memory Consolidation + Auto-Cleanup (Every hour)
        const memoryConsolidation = setInterval(async () => {
            try {
                if (system.mnemonic && system.mnemonic.consolidate) {
                    logger.info('[Memory] Starting consolidation cycle...');
                    const result = await system.mnemonic.consolidate();
                    daemonState.memoryConsolidations++;
                    daemonState.lastConsolidation = Date.now();
                    logger.success(`[Memory] Consolidated ${result?.count || 0} fragments`);
                }

                // NEW: Automated Digital Constipation Fix (Hourly Purge)
                if (system.mnemonic && typeof system.mnemonic.deepCleanup === 'function') {
                    logger.info('[Memory] Running deep cleanup safety check...');
                    await system.mnemonic.deepCleanup();
                }

                // Auto-cleanup: prune old experience files
                const experiencesDir = join(__dirname, '.soma', 'experiences');
                const consolidatedLog = join(experiencesDir, '.consolidated.txt');

                try {
                    const files = await fs.readdir(experiencesDir);
                    const indexed = new Set();

                    // Load list of indexed files
                    try {
                        const log = await fs.readFile(consolidatedLog, 'utf8');
                        log.split('\n').forEach(f => f.trim() && indexed.add(f.trim()));
                    } catch (e) { /* log doesn't exist yet */ }

                    let deleted = 0;
                    const now = Date.now();
                    const INDEXED_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
                    const UNINDEXED_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

                    for (const file of files) {
                        if (file.startsWith('.') || !file.endsWith('.json')) continue;

                        const filePath = join(experiencesDir, file);
                        const stats = await fs.stat(filePath);
                        const age = now - stats.mtimeMs;

                        const shouldDelete = indexed.has(file)
                            ? age > INDEXED_MAX_AGE
                            : age > UNINDEXED_MAX_AGE;

                        if (shouldDelete) {
                            await fs.unlink(filePath);
                            deleted++;
                        }
                    }

                    if (deleted > 0) {
                        logger.info(`[Cleanup] Deleted ${deleted} old experience files`);
                    }
                } catch (e) {
                    logger.warn('[Cleanup] Experience cleanup failed:', e.message);
                }
            } catch (e) {
                logger.error('[Memory] Consolidation failed:', e.message);
            }
        }, 3600000); // 1 hour

        // 5. State Persistence (Write to disk every 10 minutes)
        const statePersistence = setInterval(async () => {
            try {
                const stateFile = join(__dirname, 'data', 'daemon-state.json');
                await fs.writeFile(stateFile, JSON.stringify({
                    ...daemonState,
                    uptime: Date.now() - daemonState.startTime,
                    savedAt: new Date().toISOString()
                }, null, 2));
                daemonState.lastPersistence = Date.now();
                logger.info('[Persistence] Daemon state saved');
            } catch (e) {
                logger.error('[Persistence] Failed to save state:', e.message);
            }
        }, 600000); // 10 minutes

        // 6. Capture Dream Insights (When nighttime learning produces insights)
        if (system.nighttimeLearning) {
            // Hook into dream cycle completion
            const originalOnCycleComplete = system.nighttimeLearning.onCycleComplete;
            system.nighttimeLearning.onCycleComplete = (insights) => {
                if (insights && insights.length > 0) {
                    daemonState.dreamInsights.push(...insights.map(i => ({
                        ...i,
                        timestamp: Date.now()
                    })));
                    // Keep only last 50 insights
                    if (daemonState.dreamInsights.length > 50) {
                        daemonState.dreamInsights = daemonState.dreamInsights.slice(-50);
                    }
                    logger.success(`[Dream] Captured ${insights.length} new insights`);
                }
                if (originalOnCycleComplete) originalOnCycleComplete(insights);
            };
        }

        // 7. IPC Server (Communication bridge with main launcher)
        const IPC_PATH = process.platform === 'win32'
            ? '\\\\.\\pipe\\soma-daemon'
            : '/tmp/soma-daemon.sock';

        // Clean up old socket if exists
        if (process.platform !== 'win32') {
            try {
                await fs.unlink(IPC_PATH);
            } catch (e) {
                // Socket doesn't exist, that's fine
            }
        }

        const ipcServer = net.createServer((socket) => {
            logger.info('[IPC] Main launcher connected');

            socket.on('data', (data) => {
                try {
                    const request = JSON.parse(data.toString());

                    if (request.type === 'getState') {
                        // Send full daemon state to main launcher
                        socket.write(JSON.stringify({
                            type: 'state',
                            payload: {
                                ...daemonState,
                                uptime: Date.now() - daemonState.startTime,
                                memory: process.memoryUsage().rss / 1024 / 1024
                            }
                        }) + '\n');
                    } else if (request.type === 'getDreamInsights') {
                        socket.write(JSON.stringify({
                            type: 'insights',
                            payload: daemonState.dreamInsights
                        }) + '\n');
                    }
                } catch (e) {
                    logger.error('[IPC] Invalid message:', e.message);
                }
            });

            socket.on('end', () => {
                logger.info('[IPC] Main launcher disconnected');
            });
        });

        ipcServer.listen(IPC_PATH, () => {
            logger.success(`[IPC] Bridge listening on ${IPC_PATH}`);
        });

        // 8. Graceful Shutdown
        process.on('SIGINT', async () => {
            logger.info('\nStopping SOMA Daemon...');
            clearInterval(memoryConsolidation);
            clearInterval(statePersistence);

            // Stop Daemons
            await Promise.all([
                repoWatcher.stop(),
                healthDaemon.stop()
            ]);

            // Close IPC server
            if (ipcServer) ipcServer.close();

            if (system.conversationHistory) await system.conversationHistory.shutdown();
            if (system.personalityForge) await system.personalityForge.shutdown();
            if (system.learningPipeline) await system.learningPipeline.shutdown();
            if (system.nighttimeLearning) await system.nighttimeLearning.shutdown();

            logger.success('Daemon stopped. SOMA is now resting.');
            process.exit(0);
        });

    } catch (error) {
        logger.error('DAEMON FATAL ERROR:', error);
        process.exit(1);
    }
}

main();
