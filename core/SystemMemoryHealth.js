import v8 from 'node:v8';
import os from 'node:os';

const MIB = 1024 * 1024;

export function currentSystemMemoryHealth(samples = []) {
    return evaluateSystemMemory({ memory: process.memoryUsage(),
        heapLimit: v8.getHeapStatistics()?.heap_size_limit || null,
        physicalTotal: os.totalmem(), physicalFree: os.freemem(), samples });
}

export function evaluateSystemMemory({ memory, heapLimit, physicalTotal, physicalFree, samples = [] } = {}) {
    const used = Number(memory?.heapUsed);
    const total = Number(heapLimit);
    const rss = Number(memory?.rss);
    const physical = Number(physicalTotal);
    const free = Number(physicalFree);
    const valid = [used, total, rss, physical, free].every(Number.isFinite) && total > 0 && physical > 0;
    const heapRatio = valid ? used / total : null;
    const systemUsedRatio = valid ? Math.max(0, Math.min(1, (physical - free) / physical)) : null;
    const recent = samples.filter(sample => Number.isFinite(sample.heapUsed) && Number.isFinite(sample.rss));
    const recentPeak = recent.reduce((peak, sample) => ({
        heapUsed: Math.max(peak.heapUsed, sample.heapUsed),
        rss: Math.max(peak.rss, sample.rss)
    }), { heapUsed: valid ? used : 0, rss: valid ? rss : 0 });
    const increases = recent.slice(1).filter((sample, index) => sample.heapUsed > recent[index].heapUsed).length;
    const trend = recent.length < 4 ? 'STABLE' : increases >= recent.length - 1 ? 'RISING' : increases <= 1 ? 'FALLING' : 'STABLE';
    // A short rising window is a warning, never proof of a memory leak.
    const leakWarning = valid && recent.length >= 5 && trend === 'RISING' && heapRatio >= 0.70;
    let status = 'UNKNOWN';
    if (valid) {
        status = heapRatio >= 0.90 || used >= 1.8 * 1024 ** 3 || systemUsedRatio >= 0.96 || rss >= 6 * 1024 ** 3
            ? 'CRITICAL'
            : heapRatio >= 0.75 || systemUsedRatio >= 0.90 || rss >= 3 * 1024 ** 3 || leakWarning
                ? 'DEGRADED' : 'HEALTHY';
    }
    return {
        status,
        thresholds: {
            degraded: 'heap >=75% of V8 limit, system RAM >=90%, process RSS >=3 GiB, or sustained rising heap above 70%',
            critical: 'heap >=90% of V8 limit or >=1.8 GiB, system RAM >=96%, or process RSS >=6 GiB'
        },
        diagnostics: {
            heapUsedMb: valid ? Math.round(used / MIB) : null,
            heapTotalMb: valid ? Math.round(Number(memory.heapTotal) / MIB) : null,
            heapLimitMb: valid ? Math.round(total / MIB) : null,
            rssMb: valid ? Math.round(rss / MIB) : null,
            externalMb: valid ? Math.round(Number(memory.external || 0) / MIB) : null,
            heapUsedRatio: valid ? Number(heapRatio.toFixed(3)) : null,
            systemRamUsedPct: valid ? Number((systemUsedRatio * 100).toFixed(1)) : null,
            recentPeakHeapMb: valid ? Math.round(recentPeak.heapUsed / MIB) : null,
            recentPeakRssMb: valid ? Math.round(recentPeak.rss / MIB) : null,
            trend, leakWarning, samplesRecorded: recent.length,
            oomHistory: { state: 'unknown', reason: 'Prior-process OOMs require a separate persisted crash ledger.' }
        },
        memoryExplanation: valid
            ? 'This is a runtime sample. Earlier boot heap measurements are not directly comparable without the same process and phase. RSS includes native allocations and code outside the V8 heap; a rising short-window heap is a warning, not proof of a leak.'
            : 'Memory telemetry is incomplete; health cannot be asserted.'
    };
}
