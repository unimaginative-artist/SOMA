import os from 'os';
import { recordTruth } from './TruthLedger.js';

export class ResourceJobScheduler {
    constructor(config = {}) {
        this.maxCpuLoad = config.maxCpuLoad ?? 0.85;
        this.maxMemoryUsed = config.maxMemoryUsed ?? 0.90;
        this.queue = [];
        this.running = 0;
        this.maxConcurrent = config.maxConcurrent || 2;
    }

    getLoadSnapshot() {
        const cores = Math.max(1, os.cpus()?.length || 1);
        const cpuLoad = os.loadavg()[0] / cores;
        const total = os.totalmem();
        const free = os.freemem();
        const memoryUsed = total ? (total - free) / total : 0;
        return {
            cpuLoad,
            memoryUsed,
            cores,
            memoryTotal: total,
            memoryFree: free,
            at: new Date().toISOString()
        };
    }

    canRun(priority = 'normal') {
        if (priority === 'realtime') return { allowed: true, snapshot: this.getLoadSnapshot() };
        const snapshot = this.getLoadSnapshot();
        const allowed = snapshot.cpuLoad <= this.maxCpuLoad && snapshot.memoryUsed <= this.maxMemoryUsed && this.running < this.maxConcurrent;
        return {
            allowed,
            snapshot,
            reason: allowed ? null : `resource gate: cpu=${snapshot.cpuLoad.toFixed(2)}, mem=${snapshot.memoryUsed.toFixed(2)}, running=${this.running}`
        };
    }

    async runJob(job = {}, handler) {
        if (typeof handler !== 'function') throw new Error('ResourceJobScheduler.runJob requires a handler');
        const gate = this.canRun(job.priority || 'normal');
        if (!gate.allowed) {
            await recordTruth(`Job deferred: ${job.name || job.type || 'unnamed'}`, {
                status: 'deferred',
                confidence: 1,
                source: 'resource_job_scheduler',
                proof: gate.reason,
                metadata: { job, snapshot: gate.snapshot }
            });
            return { deferred: true, reason: gate.reason, snapshot: gate.snapshot };
        }

        this.running++;
        try {
            const result = await handler({ snapshot: gate.snapshot });
            return { deferred: false, result, snapshot: gate.snapshot };
        } finally {
            this.running = Math.max(0, this.running - 1);
        }
    }
}

export default new ResourceJobScheduler();
