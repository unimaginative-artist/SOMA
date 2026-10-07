/**
 * CommandBridgeInterface.js
 *
 * Gives SOMA full access to her Command Bridge dashboard.
 * She can query her own state and control the UI to show users things.
 *
 * This is SOMA's self-awareness - she can inspect herself and guide users.
 */

import fetch from 'node-fetch';
import { logger } from './Logger.js';
import fs from 'fs/promises';
import path from 'path';
import CapabilityRegistry from './CapabilityRegistry.js';

export class CommandBridgeInterface {
    constructor(baseUrl = 'http://localhost:3001', messageBroker = null) {
        this.baseUrl = baseUrl;
        this.messageBroker = messageBroker;
        this.requestTimeoutMs = 2500;
    }

    async requestJson(endpoint, fallback, label) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        try {
            const res = await fetch(`${this.baseUrl}${endpoint}`, { signal: controller.signal });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            logger.error(`[CommandBridge] Failed to get ${label}:`, e.message);
            return fallback;
        } finally {
            clearTimeout(timeout);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // READ ACCESS - Query System State
    // ═══════════════════════════════════════════════════════════

    /**
     * Get current system metrics (CPU, GPU, RAM, uptime)
     */
    async getSystemMetrics() {
        return this.requestJson('/api/status', null, 'system metrics');
    }

    /**
     * Get all arbiters and their health status
     */
    async getArbiters() {
        const data = await this.requestJson('/api/population', { agents: [] }, 'arbiters');
        return data.agents || [];
    }

    /**
     * Get shadow clone status
     */
    async getShadowClones() {
        const data = await this.requestJson('/api/balancer/stats', { stats: null }, 'shadow clones');
        return data.stats || null;
    }

    /**
     * Get daemon/subconscious status
     */
    async getDaemonStatus() {
        const data = await this.requestJson('/api/daemon/status', { daemon: null }, 'daemon status');
        return data.daemon || null;
    }

    /**
     * Get memory tier statistics
     */
    async getMemoryStatus() {
        return this.requestJson('/api/memory/status', null, 'memory status');
    }

    /**
     * Get active goals
     */
    async getActiveGoals() {
        const data = await this.requestJson('/api/goals/active', { goals: [] }, 'active goals');
        return data.goals || [];
    }

    /**
     * Get current beliefs
     */
    async getBeliefs() {
        const data = await this.requestJson('/api/beliefs', { beliefs: [] }, 'beliefs');
        return data.beliefs || [];
    }

    /**
     * Get learning velocity metrics
     */
    async getLearningVelocity() {
        return this.requestJson('/api/velocity/status', null, 'learning velocity');
    }

    /**
     * Get KEVIN security assistant status
     */
    async getKevinStatus() {
        const data = await this.requestJson('/api/kevin/status', null, 'KEVIN status');
        return data?.success ? data.status : null;
    }

    // ═══════════════════════════════════════════════════════════
    // CONTROL ACCESS - Send Commands
    // ═══════════════════════════════════════════════════════════

    /**
     * Run system diagnostics
     */
    async runDiagnostics() {
        if (this.messageBroker) {
            this.messageBroker.publish('command.execute', {
                action: 'run_diagnostics',
                source: 'soma_self',
                timestamp: Date.now()
            });
            return { success: true, message: 'Diagnostics started' };
        }
        return { success: false, message: 'No message broker available' };
    }

    /**
     * Clear memory cache
     */
    async clearCache() {
        if (this.messageBroker) {
            this.messageBroker.publish('command.execute', {
                action: 'clear_cache',
                source: 'soma_self',
                timestamp: Date.now()
            });
            return { success: true, message: 'Cache cleared' };
        }
        return { success: false, message: 'No message broker available' };
    }

    /**
     * Optimize system
     */
    async optimizeSystem() {
        if (this.messageBroker) {
            this.messageBroker.publish('command.execute', {
                action: 'optimize_system',
                source: 'soma_self',
                timestamp: Date.now()
            });
            return { success: true, message: 'Optimization triggered' };
        }
        return { success: false, message: 'No message broker available' };
    }

    // ═══════════════════════════════════════════════════════════
    // UI CONTROL - Navigate and Highlight
    // ═══════════════════════════════════════════════════════════

    /**
     * Navigate to a specific tab in the Command Bridge
     * @param {string} module - 'core', 'command', 'terminal', 'orb', 'knowledge', 'analytics', 'security', 'kevin'
     */
    navigateToTab(module) {
        if (this.messageBroker) {
            this.messageBroker.publish('ui.navigate', {
                module,
                timestamp: Date.now()
            });
            logger.info(`[CommandBridge] Navigating UI to: ${module}`);
        }
    }

    /**
     * Highlight a specific component to draw user attention
     * @param {string} component - Component name like 'ShadowCloneMonitor', 'SystemStatus', etc.
     */
    highlightComponent(component) {
        if (this.messageBroker) {
            this.messageBroker.publish('ui.highlight', {
                component,
                timestamp: Date.now()
            });
            logger.info(`[CommandBridge] Highlighting component: ${component}`);
        }
    }

    /**
     * Scroll to a specific section
     * @param {string} target - Target element ID
     */
    scrollTo(target) {
        if (this.messageBroker) {
            this.messageBroker.publish('ui.scroll', {
                target,
                timestamp: Date.now()
            });
            logger.info(`[CommandBridge] Scrolling to: ${target}`);
        }
    }

    /**
     * Open a modal
     * @param {string} modal - Modal name like 'ProcessMonitor'
     */
    openModal(modal) {
        if (this.messageBroker) {
            this.messageBroker.publish('ui.modal', {
                modal,
                action: 'open',
                timestamp: Date.now()
            });
            logger.info(`[CommandBridge] Opening modal: ${modal}`);
        }
    }

    /**
     * Show a notification/toast to the user
     * @param {string} message - Message to display
     * @param {string} type - 'info', 'success', 'warning', 'error'
     */
    notify(message, type = 'info') {
        if (this.messageBroker) {
            this.messageBroker.publish('ui.notify', {
                message,
                type,
                timestamp: Date.now()
            });
            logger.info(`[CommandBridge] Notification: ${message}`);
        }
    }

    /**
     * Point to a specific location with visual indicator
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {string} label - Label text
     */
    pointAt(x, y, label) {
        if (this.messageBroker) {
            this.messageBroker.publish('ui.point', {
                x,
                y,
                label,
                timestamp: Date.now()
            });
            logger.info(`[CommandBridge] Pointing at (${x}, ${y}): ${label}`);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // HELPER METHODS - Common Workflows
    // ═══════════════════════════════════════════════════════════

    /**
     * Show user the shadow clone status
     */
    async showShadowClones() {
        this.navigateToTab('core');
        await new Promise(resolve => setTimeout(resolve, 300)); // Wait for navigation
        this.highlightComponent('ShadowCloneMonitor');
        const stats = await this.getShadowClones();
        return stats;
    }

    /**
     * Show user their learning velocity
     */
    async showLearningVelocity() {
        this.navigateToTab('core');
        await new Promise(resolve => setTimeout(resolve, 300));
        this.highlightComponent('LearningVelocityDashboard');
        const velocity = await this.getLearningVelocity();
        return velocity;
    }

    /**
     * Show system health overview
     */
    async showSystemHealth() {
        this.navigateToTab('core');
        await new Promise(resolve => setTimeout(resolve, 300));
        this.highlightComponent('SystemStatus');
        const metrics = await this.getSystemMetrics();
        return metrics;
    }

    /**
     * Show process monitor (task manager)
     */
    showProcessMonitor() {
        this.openModal('ProcessMonitor');
    }

    /**
     * Comprehensive system summary for SOMA's self-awareness
     */
    async getSelfAwareness() {
        const [metrics, arbiters, clones, daemon, memory, goals, beliefs, velocity, kevin] = await Promise.all([
            this.getSystemMetrics(),
            this.getArbiters(),
            this.getShadowClones(),
            this.getDaemonStatus(),
            this.getMemoryStatus(),
            this.getActiveGoals(),
            this.getBeliefs(),
            this.getLearningVelocity(),
            this.getKevinStatus()
        ]);

        // Calculate memory health
        const dbPath = process.env.SOMA_MEMORY_DB_PATH || path.join(process.cwd(), 'SOMA', 'soma-memory.db');
        let memoryHealth = 'HEALTHY';
        let maintenanceSuggestion = null;
        
        try {
            const stats = await fs.stat(dbPath);
            const sizeGB = stats.size / (1024 * 1024 * 1024);
            if (sizeGB > 1.0) {
                memoryHealth = 'BLOATED';
                maintenanceSuggestion = `Database size is ${sizeGB.toFixed(2)}GB. Trigger deep_memory_cleanup to optimize performance.`;
            }
        } catch (e) {}

        return {
            metrics: {
                ...metrics,
                memoryHealth,
                maintenanceSuggestion
            },
            arbiters: {
                total: arbiters.length,
                active: arbiters.filter(a => a.status === 'active').length,
                list: arbiters
            },
            capabilities: {
                discovered: CapabilityRegistry.list(),
                total: CapabilityRegistry.list().length
            },
            shadowClones: clones,
            kevin,
            daemon,
            memory,
            goals: {
                total: goals.length,
                list: goals
            },
            beliefs: {
                total: beliefs.length,
                list: beliefs
            },
            velocity
        };
    }
}
