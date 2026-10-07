/**
 * DaemonBridge.js
 *
 * Communication bridge between main SOMA launcher and the background daemon.
 * Allows main SOMA to "wake up" with full context of what happened while asleep.
 */

import net from 'net';
import fs from 'fs/promises';
import { join } from 'path';
import { logger } from './Logger.js';

export class DaemonBridge {
    constructor() {
        this.IPC_PATH = process.platform === 'win32'
            ? '\\\\.\\pipe\\soma-daemon'
            : '/tmp/soma-daemon.sock';

        this.daemonState = null;
        this.isConnected = false;
    }

    /**
     * Check if daemon is running and connect to it
     */
    async connect() {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(this.IPC_PATH);

            const timeout = setTimeout(() => {
                socket.destroy();
                logger.warn('[DaemonBridge] Daemon not running - starting fresh');
                resolve(false);
            }, 2000);

            socket.on('connect', () => {
                clearTimeout(timeout);
                logger.success('[DaemonBridge] Connected to daemon');
                this.isConnected = true;

                // Request state
                socket.write(JSON.stringify({ type: 'getState' }) + '\n');

                socket.on('data', (data) => {
                    try {
                        const response = JSON.parse(data.toString());
                        if (response.type === 'state') {
                            this.daemonState = response.payload;
                            logger.info(`[DaemonBridge] Received state: ${this.daemonState.memoryConsolidations} consolidations, ${this.daemonState.fileChanges.length} file changes`);
                        }
                    } catch (e) {
                        logger.error('[DaemonBridge] Failed to parse state:', e.message);
                    }
                });

                socket.on('end', () => {
                    this.isConnected = false;
                });

                resolve(true);
            });

            socket.on('error', (err) => {
                clearTimeout(timeout);
                logger.warn('[DaemonBridge] Could not connect to daemon:', err.message);
                resolve(false);
            });
        });
    }

    /**
     * Load daemon state from disk if daemon is not running
     */
    async loadPersistedState(basePath) {
        try {
            const stateFile = join(basePath, 'data', 'daemon-state.json');
            const data = await fs.readFile(stateFile, 'utf8');
            this.daemonState = JSON.parse(data);
            logger.success(`[DaemonBridge] Loaded persisted state from ${stateFile}`);
            return this.daemonState;
        } catch (e) {
            logger.warn('[DaemonBridge] No persisted daemon state found');
            return null;
        }
    }

    /**
     * Get insights from daemon for display in Command Bridge
     */
    getInsights() {
        if (!this.daemonState) return null;

        return {
            daemonRunning: this.isConnected,
            uptime: this.daemonState.uptime,
            memoryConsolidations: this.daemonState.memoryConsolidations,
            lastConsolidation: this.daemonState.lastConsolidation,
            fileChanges: this.daemonState.fileChanges.slice(-10), // Last 10
            dreamInsights: this.daemonState.dreamInsights.slice(-5), // Last 5
            systemHealth: this.daemonState.systemHealth,
            memory: this.daemonState.memory
        };
    }

    /**
     * Get all file changes since daemon started
     */
    getFileChanges() {
        return this.daemonState?.fileChanges || [];
    }

    /**
     * Get all dream insights
     */
    getDreamInsights() {
        return this.daemonState?.dreamInsights || [];
    }

    /**
     * Get daemon health status
     */
    getHealth() {
        return this.daemonState?.systemHealth || { healthy: true, alerts: [] };
    }
}
