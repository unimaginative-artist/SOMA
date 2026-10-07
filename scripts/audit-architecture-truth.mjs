import { ArchitectureTruthMapService } from '../core/ArchitectureTruthMapService.js';

const baseUrl = process.env.SOMA_HTTP_URL || 'http://127.0.0.1:3001';
const fetchJson = async route => {
    try {
        const response = await fetch(`${baseUrl}${route}`, { signal:AbortSignal.timeout(15_000) });
        return response.ok ? await response.json() : null;
    } catch { return null; }
};

const [runtimeResult, toolResult, autonomyResult] = await Promise.all([fetchJson('/api/runtime/map'), fetchJson('/api/tools/list'), fetchJson('/api/autonomy/health')]);
const service = new ArchitectureTruthMapService({ root:process.cwd() });
const report = await service.build({ runtimeSnapshot:runtimeResult?.runtime || null, toolSnapshot:toolResult || null, autonomySnapshot:autonomyResult || null, refreshCensus:process.argv.includes('--refresh-census'), persist:true });

console.log(`Architecture truth map written: data/architecture-truth-map/ARCHITECTURE_TRUTH_MAP.md`);
console.log(`Runtime: ${report.summary.activeRuntimeComponents}/${report.summary.runtimeComponents} active; ${report.summary.reachableRuntimeComponents} directly surfaced; ${report.summary.internalOnlyRuntimeComponents} internal-only.`);
console.log(`Static census: ${report.summary.censusFiles} files; ${report.summary.dormantCandidates} dormant candidates; ${report.summary.duplicateNamedFiles} duplicate basenames; ${report.summary.stubbedFiles} stub markers.`);
console.log(`Evidence: ${report.verifiedDomains.filter(item => item.status === 'verified').length} verified domains; ${report.findings.length} priority findings.`);
