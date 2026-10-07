/**
 * core/SomaKernel.js
 * 
 * The "Nervous System" of SOMA.
 * Implements a Kernel Architecture for high-performance telemetry, 
 * decoupled service registry, and centralized lifecycle management.
 */

import { logger } from './Logger.js';
import os from 'os';
import osUtils from 'os-utils';

class SomaKernel {
    constructor() {
        this.registry = new Map();
        this.telemetryBuffer = {
            system: { cpu: 0, ram: 0, gpu: 0, uptime: 0 },
            brainStats: {},
            agents: [],
            events: [],
            knowledge: { fragments: 0, links: 0 }
        };
        this.isReady = false;
        this.startTime = Date.now();
        this.telemetryInterval = null;
        this.busListeners = new Map();
    }

    /**
     * Register a system component (Inversion of Control)
     */
    register(id, instance) {
        this.registry.set(id, instance);
        logger.info(`[Kernel] Registered component: ${id}`);
    }

    /**
     * Get a registered component (Registry Pattern)
     */
    get(id) {
        return this.registry.get(id);
    }

    /**
     * Internal Event Bus
     */
    emit(event, data) {
        if (this.busListeners.has(event)) {
            this.busListeners.get(event).forEach(cb => cb(data));
        }
        
        // Feed events into telemetry for real-time visualization
        this.telemetryBuffer.events.push({
            id: Date.now() + Math.random(),
            type: event,
            payload: data,
            timestamp: Date.now()
        });
        
        if (this.telemetryBuffer.events.length > 50) {
            this.telemetryBuffer.events.shift();
        }
    }

    on(event, callback) {
        if (!this.busListeners.has(event)) {
            this.busListeners.set(event, []);
        }
        this.busListeners.get(event).push(callback);
    }

    /**
     * Start the Nervous System (Telemetry Loop)
     */
    boot() {
        logger.success('[Kernel] ⚡ Nervous System Active');
        this.isReady = true;

        this.telemetryInterval = setInterval(() => {
            this._updateTelemetry();
        }, 2000);
    }

    async _updateTelemetry() {
        // 1. Host Metrics
        osUtils.cpuUsage((cpuPercent) => {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            this.telemetryBuffer.system = {
                cpu: cpuPercent * 100,
                ram: ((totalMem - freeMem) / totalMem) * 100,
                uptime: process.uptime(),
                timestamp: Date.now()
            };
        });

        // 2. Aggregate Agent Status
        const agents = [];
        for (const [id, instance] of this.registry.entries()) {
            if (instance && typeof instance === 'object') {
                const name = instance.name || instance.constructor.name;
                let status = 'active';
                if (instance.getStatus) {
                    const s = instance.getStatus();
                    status = typeof s === 'string' ? s : (s.active ? 'active' : 'idle');
                }
                
                agents.push({
                    id,
                    name,
                    status,
                    type: id.includes('Cortex') ? 'cortex' : 'arbiter',
                    load: Math.floor(Math.random() * 10) + 5 // Placeholder for real internal load
                });
            }
        }
        this.telemetryBuffer.agents = agents;

        // 3. Knowledge Sync
        const thoughtNetwork = this.get('thoughtNetwork');
        if (thoughtNetwork) {
            this.telemetryBuffer.knowledge = {
                fragments: thoughtNetwork.nodes?.size || 0,
                links: thoughtNetwork.stats?.totalConnections || 0
            };
        }

        // 4. Brain Metrics (QuadBrain integration)
        const quadBrain = this.get('quadBrain') || this.get('brain');
        if (quadBrain && typeof quadBrain.getStats === 'function') {
            try {
                const stats = quadBrain.getStats();
                this.telemetryBuffer.brainStats = {
                    totalQueries: stats.totalQueries || 0,
                    queriesByBrain: stats.queriesByBrain || {},
                    avgConfidence: stats.avgConfidence || 0,
                    safetyBlocks: stats.safetyBlocks || 0,
                    activeSessions: stats.activeSessions || 0,
                    routingMethods: stats.routingMethods || {}
                };
            } catch (e) {
                // Fallback to direct stats access if getStats fails
                this.telemetryBuffer.brainStats = quadBrain.stats || {};
            }
        }
    }

    /**
     * Get single-stream telemetry packet
     */
    getPulse() {
        return {
            type: 'pulse',
            payload: this.telemetryBuffer
        };
    }

    shutdown() {
        if (this.telemetryInterval) clearInterval(this.telemetryInterval);
        this.isReady = false;
        logger.info('[Kernel] Nervous System powering down...');
    }
}

const somaKernel = new SomaKernel();
export default somaKernel;
