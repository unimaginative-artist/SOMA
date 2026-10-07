/**
 * Anomaly Detector - Automatic Issue Detection & Logging
 *
 * Catches and logs:
 * - Missing arbiter messages
 * - Initialization errors
 * - API failures
 * - WebSocket disconnections
 * - Performance anomalies
 * - Unexpected behavior
 *
 * Provides:
 * - Structured logging to file
 * - Anomaly dashboard/API
 * - Auto-remediation hints
 * - Trend analysis
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

export class AnomalyDetector extends EventEmitter {
    constructor({ rootPath }) {
        super();
        this.rootPath = rootPath;
        this.logsPath = path.join(rootPath, 'data', 'anomalies');

        // Anomaly storage
        this.anomalies = [];
        this.maxAnomalies = 1000; // Keep last 1000

        // Categorized counts
        this.stats = {
            total: 0,
            byType: {},
            bySeverity: {},
            bySource: {},
            lastHour: 0,
            resolved: 0
        };

        // Patterns for auto-detection
        this.patterns = {
            missingArbiter: /Arbiter not found: (.+)/,
            connectionRefused: /ERR_CONNECTION_REFUSED/,
            api500: /500 \(Internal Server Error\)/,
            packageError: /ERR_PACKAGE_PATH_NOT_EXPORTED/,
            moduleNotFound: /Cannot find module/,
            nullReference: /Cannot read property .+ of null/,
            undefinedReference: /Cannot read property .+ of undefined/,
            timeout: /timeout|timed out/i,
            memoryLeak: /FATAL ERROR: .+ heap out of memory/
        };

        // Auto-remediation knowledge base
        this.remediations = {
            missingArbiter: {
                hint: 'Arbiter not registered yet. Check initialization order.',
                action: 'Add existence check or spawn arbiter earlier',
                severity: 'warning'
            },
            connectionRefused: {
                hint: 'Service not running on expected port',
                action: 'Check if backend/service is started',
                severity: 'critical'
            },
            api500: {
                hint: 'Backend endpoint throwing error',
                action: 'Check backend logs and fix endpoint handler',
                severity: 'high'
            },
            packageError: {
                hint: 'Incorrect package import path',
                action: 'Fix import to use correct package export',
                severity: 'critical'
            },
            moduleNotFound: {
                hint: 'Missing npm package or file',
                action: 'Run npm install or check file path',
                severity: 'critical'
            }
        };
    }

    async initialize() {
        await fs.mkdir(this.logsPath, { recursive: true });

        // Load existing anomalies from today
        await this.loadTodaysAnomalies();

        console.log('[AnomalyDetector] ✅ Initialized');
        console.log(`[AnomalyDetector] Tracking ${Object.keys(this.patterns).length} anomaly patterns`);
    }

    /**
     * Log an anomaly (main entry point)
     */
    async logAnomaly(source, message, metadata = {}) {
        const anomaly = {
            id: `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            date: new Date().toISOString(),
            source,
            message,
            metadata,
            type: this.detectType(message),
            severity: this.detectSeverity(message, metadata),
            remediation: this.getRemediation(message),
            resolved: false
        };

        // Add to memory
        this.anomalies.push(anomaly);
        if (this.anomalies.length > this.maxAnomalies) {
            this.anomalies.shift(); // Remove oldest
        }

        // Update stats
        this.updateStats(anomaly);

        // Save to disk (async, don't block)
        this.saveAnomaly(anomaly).catch(err =>
            console.error('[AnomalyDetector] Failed to save anomaly:', err)
        );

        // Emit event for real-time monitoring
        this.emit('anomaly', anomaly);

        // Log to console with color coding
        this.logToConsole(anomaly);

        // Check for critical issues
        if (anomaly.severity === 'critical') {
            this.emit('critical', anomaly);
            console.error(`[AnomalyDetector] 🚨 CRITICAL ANOMALY: ${anomaly.message}`);
        }

        return anomaly;
    }

    /**
     * Detect anomaly type from message
     */
    detectType(message) {
        for (const [type, pattern] of Object.entries(this.patterns)) {
            if (pattern.test(message)) {
                return type;
            }
        }
        return 'unknown';
    }

    /**
     * Detect severity
     */
    detectSeverity(message, metadata) {
        // Check metadata first
        if (metadata.severity) return metadata.severity;

        // Auto-detect from message
        const msg = message.toLowerCase();

        if (msg.includes('critical') || msg.includes('fatal')) return 'critical';
        if (msg.includes('error') || msg.includes('failed')) return 'high';
        if (msg.includes('warning') || msg.includes('not found')) return 'warning';

        return 'info';
    }

    /**
     * Get remediation suggestion
     */
    getRemediation(message) {
        const type = this.detectType(message);
        return this.remediations[type] || {
            hint: 'Unknown issue',
            action: 'Check logs for more details',
            severity: 'unknown'
        };
    }

    /**
     * Update statistics
     */
    updateStats(anomaly) {
        this.stats.total++;

        // By type
        this.stats.byType[anomaly.type] = (this.stats.byType[anomaly.type] || 0) + 1;

        // By severity
        this.stats.bySeverity[anomaly.severity] = (this.stats.bySeverity[anomaly.severity] || 0) + 1;

        // By source
        this.stats.bySource[anomaly.source] = (this.stats.bySource[anomaly.source] || 0) + 1;

        // Last hour
        const oneHourAgo = Date.now() - 3600000;
        this.stats.lastHour = this.anomalies.filter(a => a.timestamp > oneHourAgo).length;
    }

    /**
     * Log to console with formatting
     */
    logToConsole(anomaly) {
        const icons = {
            critical: '🚨',
            high: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        const icon = icons[anomaly.severity] || '📝';
        const timestamp = new Date(anomaly.timestamp).toLocaleTimeString();

        console.log(`[AnomalyDetector] ${icon} [${anomaly.severity.toUpperCase()}] ${timestamp}`);
        console.log(`  Source: ${anomaly.source}`);
        console.log(`  Type: ${anomaly.type}`);
        console.log(`  Message: ${anomaly.message}`);

        if (anomaly.remediation) {
            console.log(`  💡 Hint: ${anomaly.remediation.hint}`);
            console.log(`  🔧 Action: ${anomaly.remediation.action}`);
        }

        console.log('');
    }

    /**
     * Save anomaly to disk
     */
    async saveAnomaly(anomaly) {
        const today = new Date().toISOString().split('T')[0];
        const filename = path.join(this.logsPath, `anomalies-${today}.jsonl`);

        // Append as JSON Lines format (one JSON object per line)
        const line = JSON.stringify(anomaly) + '\n';
        await fs.appendFile(filename, line, 'utf-8');
    }

    /**
     * Load today's anomalies from disk
     */
    async loadTodaysAnomalies() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const filename = path.join(this.logsPath, `anomalies-${today}.jsonl`);

            const content = await fs.readFile(filename, 'utf-8');
            const lines = content.trim().split('\n');

            this.anomalies = lines
                .filter(line => line.trim())
                .map(line => JSON.parse(line));

            // Rebuild stats
            this.stats = {
                total: 0,
                byType: {},
                bySeverity: {},
                bySource: {},
                lastHour: 0,
                resolved: 0
            };

            this.anomalies.forEach(a => this.updateStats(a));

            console.log(`[AnomalyDetector] Loaded ${this.anomalies.length} anomalies from today`);
        } catch (err) {
            // File doesn't exist yet - first run of the day
            console.log('[AnomalyDetector] No existing anomalies for today');
        }
    }

    /**
     * Get recent anomalies
     */
    getRecent(limit = 50) {
        return this.anomalies.slice(-limit).reverse();
    }

    /**
     * Get anomalies by type
     */
    getByType(type) {
        return this.anomalies.filter(a => a.type === type);
    }

    /**
     * Get anomalies by severity
     */
    getBySeverity(severity) {
        return this.anomalies.filter(a => a.severity === severity);
    }

    /**
     * Get unresolved anomalies
     */
    getUnresolved() {
        return this.anomalies.filter(a => !a.resolved);
    }

    /**
     * Mark anomaly as resolved
     */
    async resolveAnomaly(anomalyId) {
        const anomaly = this.anomalies.find(a => a.id === anomalyId);
        if (anomaly) {
            anomaly.resolved = true;
            anomaly.resolvedAt = Date.now();
            this.stats.resolved++;

            // Re-save to disk
            await this.saveAnomaly(anomaly);

            return true;
        }
        return false;
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            currentlyTracked: this.anomalies.length,
            unresolved: this.getUnresolved().length
        };
    }

    /**
     * Get summary report
     */
    getSummary() {
        const unresolved = this.getUnresolved();
        const critical = this.getBySeverity('critical');
        const high = this.getBySeverity('high');

        return {
            total: this.stats.total,
            unresolved: unresolved.length,
            critical: critical.length,
            high: high.length,
            lastHour: this.stats.lastHour,
            topTypes: Object.entries(this.stats.byType)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([type, count]) => ({ type, count })),
            topSources: Object.entries(this.stats.bySource)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([source, count]) => ({ source, count })),
            recentCritical: critical.slice(-5).reverse()
        };
    }

    /**
     * Generate daily report
     */
    async generateDailyReport() {
        const summary = this.getSummary();
        const today = new Date().toISOString().split('T')[0];

        const report = `
# Anomaly Report - ${today}

## Summary
- **Total Anomalies:** ${summary.total}
- **Unresolved:** ${summary.unresolved}
- **Critical:** ${summary.critical}
- **High Priority:** ${summary.high}
- **Last Hour:** ${summary.lastHour}

## Top Anomaly Types
${summary.topTypes.map(t => `- ${t.type}: ${t.count} occurrences`).join('\n')}

## Top Sources
${summary.topSources.map(s => `- ${s.source}: ${s.count} anomalies`).join('\n')}

## Recent Critical Issues
${summary.recentCritical.map(a => `
### ${new Date(a.timestamp).toLocaleString()}
- **Type:** ${a.type}
- **Source:** ${a.source}
- **Message:** ${a.message}
- **Remediation:** ${a.remediation?.hint || 'N/A'}
`).join('\n')}

---
Generated by AnomalyDetector at ${new Date().toISOString()}
        `.trim();

        const reportPath = path.join(this.logsPath, `report-${today}.md`);
        await fs.writeFile(reportPath, report, 'utf-8');

        console.log(`[AnomalyDetector] Daily report saved to ${reportPath}`);

        return report;
    }

    /**
     * Hook into MessageBroker to catch "Arbiter not found" errors
     */
    hookMessageBroker(messageBroker) {
        // Listen for failed messages
        messageBroker.on('message_failed', (data) => {
            this.logAnomaly('MessageBroker', `Message failed: ${data.error}`, {
                to: data.to,
                type: data.type,
                severity: 'warning'
            });
        });

        console.log('[AnomalyDetector] Hooked into MessageBroker');
    }

    /**
     * Hook into global error handlers
     */
    hookGlobalErrors() {
        // Uncaught exceptions
        process.on('uncaughtException', (error) => {
            this.logAnomaly('Process', `Uncaught exception: ${error.message}`, {
                stack: error.stack,
                severity: 'critical'
            });
        });

        // Unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            this.logAnomaly('Process', `Unhandled rejection: ${reason}`, {
                severity: 'high'
            });
        });

        console.log('[AnomalyDetector] Hooked into global error handlers');
    }

    /**
     * Start periodic cleanup (remove old anomalies)
     */
    startCleanup(intervalMs = 3600000) { // 1 hour
        setInterval(() => {
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            this.anomalies = this.anomalies.filter(a => a.timestamp > sevenDaysAgo);
            console.log(`[AnomalyDetector] Cleanup: ${this.anomalies.length} anomalies retained`);
        }, intervalMs);
    }
}

// Export singleton instance
let anomalyDetector = null;

export function getAnomalyDetector(config) {
    if (!anomalyDetector) {
        anomalyDetector = new AnomalyDetector(config);
    }
    return anomalyDetector;
}

export default AnomalyDetector;
