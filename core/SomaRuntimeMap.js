import { buildReadinessReport } from './SomaReadinessScanner.js';

const isLiveObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const componentType = (key, value) => {
    if (key.toLowerCase().includes('registry')) return 'registry';
    if (key.toLowerCase().includes('planner')) return 'planner';
    if (key.toLowerCase().includes('memory') || key.toLowerCase().includes('mnemonic')) return 'memory';
    if (key.toLowerCase().includes('tool')) return 'tooling';
    if (key.toLowerCase().includes('heartbeat') || key.toLowerCase().includes('daemon')) return 'autonomy';
    if (key.toLowerCase().includes('arbiter') || value?.name?.includes?.('Arbiter')) return 'arbiter';
    if (key.toLowerCase().includes('engine')) return 'engine';
    if (key.toLowerCase().includes('cortex')) return 'cortex';
    return 'component';
};

const componentStatus = (value) => {
    if (!value) return 'missing';
    if (value.ready === false || value.initialized === false) return 'initializing';
    if (value.isRunning === false) return 'ready';
    if (value.active === false) return 'idle';
    return 'active';
};

const safeStatus = (value) => {
    if (!value || typeof value.getStatus !== 'function') return null;
    try {
        const status = value.getStatus();
        if (!status || typeof status !== 'object') return status;
        return Object.fromEntries(
            Object.entries(status)
                .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v) || v === null)
                .slice(0, 20)
        );
    } catch (error) {
        return { error: error.message };
    }
};

export function buildRuntimeMap(system = {}) {
    const components = [];

    for (const [key, value] of Object.entries(system)) {
        if (!isLiveObject(value)) continue;
        if (!(value.name || /arbiter|engine|cortex|registry|planner|daemon|memory|mnemonic|tool|heartbeat/i.test(key))) continue;

        components.push({
            id: key,
            name: value.name || key,
            type: componentType(key, value),
            status: componentStatus(value),
            statusDetail: safeStatus(value)
        });
    }

    const expertiseRegistry = system.expertiseRegistry;
    const expertises = expertiseRegistry
        ? {
            status: expertiseRegistry.status(),
            packages: expertiseRegistry.list().map(pkg => ({
                id: pkg.id,
                name: pkg.name,
                parent: pkg.parent || null,
                specialty: pkg.specialty || null,
                loaded: !!pkg.loaded,
                runtime: !!pkg.runtime,
                capabilities: pkg.capabilities || []
            }))
        }
        : { status: { ready: false, reason: 'ExpertiseRegistry offline' }, packages: [] };

    return {
        generatedAt: new Date().toISOString(),
        ready: !!system.ready,
        components: components.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)),
        counts: {
            components: components.length,
            active: components.filter(c => c.status === 'active').length,
            expertises: expertises.packages.length,
            loadedExpertises: expertises.packages.filter(pkg => pkg.loaded).length,
            tools: system.toolRegistry?.getToolsManifest?.()?.length || 0
        },
        readiness: buildReadinessReport(system),
        expertises
    };
}

export default buildRuntimeMap;
