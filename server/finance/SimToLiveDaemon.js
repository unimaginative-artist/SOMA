import fs from 'fs';
import path from 'path';
import { SimToLiveReconciler } from '../../core/signals/generator/SimToLiveReconciler.js';

const REPORT_PATH = path.join(process.cwd(), 'data', 'trading', 'sim-to-live-report.json');

class SimToLiveDaemon {
    constructor() {
        this.intervalId = null;
        this.intervalMs = 5 * 60 * 1000;
        this.running = false;
        this.lastRunAt = null;
        this.lastError = null;
        this.lastReport = null;
        this.reconciler = new SimToLiveReconciler({ reportPath: REPORT_PATH });
    }

    start({ intervalMs = this.intervalMs, initialDelayMs = 45000 } = {}) {
        if (this.intervalId) return this.getStatus();
        this.intervalMs = Math.max(30000, Number(intervalMs) || this.intervalMs);
        console.log(`[SimToLiveDaemon] Starting sim-to-live loop (${Math.round(this.intervalMs / 1000)}s interval)`);
        this.intervalId = setInterval(() => {
            this.runNow().catch(error => {
                console.warn('[SimToLiveDaemon] Cycle failed:', error.message);
            });
        }, this.intervalMs);
        setTimeout(() => {
            this.runNow().catch(error => {
                console.warn('[SimToLiveDaemon] Initial cycle failed:', error.message);
            });
        }, Math.max(1000, Number(initialDelayMs) || 45000));
        return this.getStatus();
    }

    stop() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = null;
        return this.getStatus();
    }

    async runNow() {
        if (this.running) return { skipped: true, reason: 'sim-to-live reconciliation already running', status: this.getStatus() };
        this.running = true;
        try {
            const report = await this.reconciler.runReconciliation();
            this.lastRunAt = report.generatedAt || new Date().toISOString();
            this.lastReport = report;
            this.lastError = null;
            return report;
        } catch (error) {
            this.lastError = error.message;
            throw error;
        } finally {
            this.running = false;
        }
    }

    readReport() {
        if (this.lastReport) return this.lastReport;
        try {
            if (!fs.existsSync(REPORT_PATH)) return null;
            return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
        } catch {
            return null;
        }
    }

    getStatus() {
        const report = this.readReport();
        return {
            active: !!this.intervalId,
            running: this.running,
            intervalMs: this.intervalMs,
            lastRunAt: this.lastRunAt || report?.generatedAt || null,
            lastError: this.lastError,
            reportPath: path.relative(process.cwd(), REPORT_PATH).replace(/\\/g, '/'),
            summary: report?.summary || null,
            selectedIncumbent: report?.selectedIncumbent || null,
            nextPaperCandidates: Array.isArray(report?.paperQueue) ? report.paperQueue.slice(0, 5) : []
        };
    }
}

const simToLiveDaemon = new SimToLiveDaemon();

export { SimToLiveDaemon };
export default simToLiveDaemon;
