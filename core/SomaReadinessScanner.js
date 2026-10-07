import fs from 'fs';
import path from 'path';

const STATUS_WEIGHT = {
    ready: 100,
    partial: 55,
    missing: 0,
    broken: 0
};

const toPosix = (value) => value.replace(/\\/g, '/');

const exists = (rootPath, relativePath) => fs.existsSync(path.join(rootPath, relativePath));

const readJson = (filePath) => {
    try {
        return { ok: true, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    } catch (error) {
        return { ok: false, error: error.message };
    }
};

const check = ({ id, label, status, detail, path: checkPath, required = false }) => ({
    id,
    label,
    status,
    detail,
    path: checkPath ? toPosix(checkPath) : undefined,
    required
});

const fileCheck = (rootPath, relativePath, label, { id, required = false, partialDetail } = {}) => {
    const found = exists(rootPath, relativePath);
    return check({
        id: id || relativePath,
        label,
        status: found ? 'ready' : (partialDetail ? 'partial' : 'missing'),
        detail: found ? 'Found' : (partialDetail || 'No implementation file found'),
        path: relativePath,
        required
    });
};

const anyFileCheck = (rootPath, relativePaths, label, { id, required = false, partialDetail } = {}) => {
    const foundPath = relativePaths.find(relativePath => exists(rootPath, relativePath));
    return check({
        id,
        label,
        status: foundPath ? 'ready' : (partialDetail ? 'partial' : 'missing'),
        detail: foundPath ? `Found ${toPosix(foundPath)}` : (partialDetail || 'No implementation file found'),
        path: foundPath,
        required
    });
};

const capabilityStatus = (checks) => {
    const required = checks.filter(item => item.required);
    const requiredScope = required.length ? required : checks;

    if (requiredScope.some(item => item.status === 'broken')) return 'broken';
    if (requiredScope.every(item => item.status === 'ready')) return 'ready';
    if (requiredScope.every(item => item.status === 'missing')) return 'missing';
    return 'partial';
};

const scoreChecks = (checks) => {
    if (checks.length === 0) return 0;
    const total = checks.reduce((sum, item) => sum + (STATUS_WEIGHT[item.status] || 0), 0);
    return Math.round(total / checks.length);
};

const capability = ({ id, label, group, description, checks }) => {
    const status = capabilityStatus(checks);
    const blockers = checks
        .filter(item => item.required && ['missing', 'broken'].includes(item.status))
        .map(item => item.detail || item.label);

    return {
        id,
        label,
        group,
        description,
        status,
        score: scoreChecks(checks),
        checks,
        blockers
    };
};

const findExpertiseManifests = (rootPath) => {
    const expertiseRoot = path.join(rootPath, 'expertises');
    const manifests = [];

    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && entry.name === 'expertise.json') {
                manifests.push(fullPath);
            }
        }
    };

    walk(expertiseRoot);
    return manifests;
};

const scanExpertisePackages = (rootPath) => {
    return findExpertiseManifests(rootPath).map((manifestPath) => {
        const relativeManifest = path.relative(rootPath, manifestPath);
        const parsed = readJson(manifestPath);

        if (!parsed.ok) {
            return {
                id: toPosix(relativeManifest),
                name: path.basename(path.dirname(manifestPath)),
                status: 'broken',
                score: 0,
                checks: [
                    check({
                        id: 'manifest.parse',
                        label: 'Manifest JSON',
                        status: 'broken',
                        detail: parsed.error,
                        path: relativeManifest,
                        required: true
                    })
                ],
                blockers: [parsed.error]
            };
        }

        const manifest = parsed.data;
        const runtimeModule = manifest.runtime?.module || null;
        const runtimePath = runtimeModule ? path.resolve(path.dirname(manifestPath), runtimeModule) : null;
        const relativeRuntime = runtimePath ? path.relative(rootPath, runtimePath) : null;
        const hasRuntime = runtimePath ? fs.existsSync(runtimePath) : false;
        const packageChecks = [
            check({
                id: 'manifest.parse',
                label: 'Manifest JSON',
                status: 'ready',
                detail: 'Manifest parses cleanly',
                path: relativeManifest,
                required: true
            }),
            check({
                id: 'runtime.module',
                label: 'Runtime adapter',
                status: runtimeModule ? (hasRuntime ? 'ready' : 'broken') : 'partial',
                detail: runtimeModule
                    ? (hasRuntime ? 'Callable runtime module exists' : `Declared runtime module is missing: ${runtimeModule}`)
                    : 'Manifest-only package; SOMA can route to it but cannot execute package code yet',
                path: relativeRuntime,
                required: !!runtimeModule
            }),
            check({
                id: 'capabilities',
                label: 'Declared capabilities',
                status: Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0 ? 'ready' : 'missing',
                detail: `${manifest.capabilities?.length || 0} capabilities declared`
            }),
            check({
                id: 'standards',
                label: 'Declared standards',
                status: Array.isArray(manifest.standards) && manifest.standards.length > 0 ? 'ready' : 'partial',
                detail: `${manifest.standards?.length || 0} standards declared`
            })
        ];
        const status = runtimeModule
            ? capabilityStatus(packageChecks)
            : 'partial';

        return {
            id: manifest.id || toPosix(relativeManifest),
            name: manifest.name || manifest.id || path.basename(path.dirname(manifestPath)),
            status,
            score: scoreChecks(packageChecks),
            runtime: {
                declared: !!runtimeModule,
                present: hasRuntime,
                path: relativeRuntime ? toPosix(relativeRuntime) : null
            },
            manifestPath: toPosix(relativeManifest),
            checks: packageChecks,
            blockers: packageChecks
                .filter(item => item.status === 'broken' || (item.required && item.status === 'missing'))
                .map(item => item.detail || item.label)
        };
    });
};

const countStatuses = (items) => items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
}, { ready: 0, partial: 0, missing: 0, broken: 0 });

export function buildReadinessReport(system = {}, options = {}) {
    const rootPath = options.rootPath || process.cwd();
    const packages = scanExpertisePackages(rootPath);
    const runtimeBacked = packages.filter(pkg => pkg.runtime?.present).length;
    const brokenPackages = packages.filter(pkg => pkg.status === 'broken').length;
    const manifestOnly = packages.filter(pkg => !pkg.runtime?.declared).length;

    const capabilities = [
        capability({
            id: 'expertise.runtime',
            label: 'Lazy Expertise Runtime',
            group: 'agency',
            description: 'Discovers expertise manifests, routes tasks to them, and loads callable adapters on demand.',
            checks: [
                fileCheck(rootPath, 'core/ExpertiseRegistry.js', 'Expertise registry', { required: true }),
                check({
                    id: 'expertise.manifests',
                    label: 'Expertise manifests',
                    status: packages.length > 0 ? 'ready' : 'missing',
                    detail: `${packages.length} package manifests found`,
                    path: 'expertises',
                    required: true
                }),
                check({
                    id: 'expertise.runtime_backed',
                    label: 'Runtime-backed packages',
                    status: runtimeBacked > 0 ? 'ready' : 'partial',
                    detail: `${runtimeBacked} packages have callable runtime modules`,
                    required: true
                }),
                check({
                    id: 'expertise.manifest_only',
                    label: 'Manifest-only packages',
                    status: manifestOnly === 0 ? 'ready' : 'partial',
                    detail: `${manifestOnly} packages are routeable but not directly executable`
                }),
                check({
                    id: 'expertise.broken_packages',
                    label: 'Broken package declarations',
                    status: brokenPackages === 0 ? 'ready' : 'broken',
                    detail: `${brokenPackages} packages have broken declarations`,
                    required: true
                })
            ]
        }),
        capability({
            id: 'enterprise.domain_model',
            label: 'Tenant / Client / Project Model',
            group: 'enterprise',
            description: 'Clean boundaries for enterprise tenants, clients, engagements, projects, and audit roles.',
            checks: [
                check({
                    id: 'enterprise.todo',
                    label: 'Enterprise TODO',
                    status: exists(rootPath, 'SOMA_ENTERPRISE_TODO.md') ? 'partial' : 'missing',
                    detail: exists(rootPath, 'SOMA_ENTERPRISE_TODO.md')
                        ? 'Planned in SOMA_ENTERPRISE_TODO.md; planning does not count as ready'
                        : 'No enterprise plan file found',
                    path: 'SOMA_ENTERPRISE_TODO.md'
                }),
                anyFileCheck(rootPath, ['server/enterprise', 'server/routes/enterpriseRoutes.js'], 'Enterprise API boundary', {
                    id: 'enterprise.api_boundary',
                    required: true
                }),
                anyFileCheck(rootPath, ['server/models/Tenant.js', 'server/enterprise/TenantModel.js', 'core/enterprise/TenantModel.js'], 'Tenant model', {
                    id: 'enterprise.tenant_model',
                    required: true
                }),
                anyFileCheck(rootPath, ['server/models/Client.js', 'server/enterprise/ClientModel.js', 'core/enterprise/ClientModel.js'], 'Client model', {
                    id: 'enterprise.client_model',
                    required: true
                }),
                anyFileCheck(rootPath, ['server/routes/workspaceRoutes.js', 'server/models/Project.js'], 'Workspace/project surface', {
                    id: 'enterprise.project_surface'
                })
            ]
        }),
        capability({
            id: 'evidence.chain',
            label: 'Evidence Chain',
            group: 'enterprise',
            description: 'Trace every answer back to source document, page, row, cell, extraction step, and reviewer action.',
            checks: [
                anyFileCheck(rootPath, ['server/finance/AuditLedger.js', 'core/AuditLedger.js'], 'Audit ledger', {
                    id: 'evidence.audit_ledger'
                }),
                anyFileCheck(rootPath, ['Concieve/datasnipper-app/server/services/auditSystem.js'], 'Audit evidence service', {
                    id: 'evidence.audit_service'
                }),
                anyFileCheck(rootPath, ['server/enterprise/EvidenceChain.js', 'core/EvidenceChain.js', 'server/services/EvidenceChain.js'], 'Canonical evidence chain service', {
                    id: 'evidence.canonical_service',
                    required: true
                }),
                anyFileCheck(rootPath, ['server/routes/evidenceRoutes.js', 'server/enterprise/evidenceRoutes.js'], 'Evidence API routes', {
                    id: 'evidence.routes',
                    required: true
                })
            ]
        }),
        capability({
            id: 'validation.engines',
            label: 'Deterministic Validation Engines',
            group: 'enterprise',
            description: 'Footing, crossfooting, reconciliation, duplicates, and variance checks with non-LLM results.',
            checks: [
                anyFileCheck(rootPath, ['Concieve/datasnipper-app/server/services/auditSystem.js'], 'Audit validation service', {
                    id: 'validation.audit_service'
                }),
                anyFileCheck(rootPath, ['arbiters/ConcieveExpertiseArbiter.js'], 'Finance/audit arbiter', {
                    id: 'validation.audit_arbiter'
                }),
                anyFileCheck(rootPath, ['server/enterprise/ValidationEngine.js', 'core/ValidationEngine.js', 'server/services/ValidationEngine.js'], 'Canonical validation engine', {
                    id: 'validation.canonical_engine',
                    required: true
                }),
                anyFileCheck(rootPath, ['server/routes/validationRoutes.js', 'server/enterprise/validationRoutes.js'], 'Validation API routes', {
                    id: 'validation.routes',
                    required: true
                })
            ]
        }),
        capability({
            id: 'review.signoff',
            label: 'Review / Approval Signoff',
            group: 'enterprise',
            description: 'Preparer, reviewer, approval, signoff, and immutable status transitions.',
            checks: [
                anyFileCheck(rootPath, ['server/ApprovalSystem.cjs', 'server/ApprovalSystem.js'], 'General approval system', {
                    id: 'review.general_approval'
                }),
                anyFileCheck(rootPath, ['server/enterprise/ReviewWorkflow.js', 'core/ReviewWorkflow.js'], 'Audit review workflow', {
                    id: 'review.workflow',
                    required: true
                }),
                anyFileCheck(rootPath, ['server/routes/reviewRoutes.js', 'server/enterprise/reviewRoutes.js'], 'Review API routes', {
                    id: 'review.routes',
                    required: true
                })
            ]
        }),
        capability({
            id: 'standards.library',
            label: 'Standards Library',
            group: 'enterprise',
            description: 'Governed standards packs for GAAP, IFRS, SOX, SOC 1, PCAOB, ASC 842, and domain plugins.',
            checks: [
                fileCheck(rootPath, 'seeds/audit.json', 'Audit seed knowledge'),
                check({
                    id: 'standards.manifest_declarations',
                    label: 'Expertise standard declarations',
                    status: packages.some(pkg => pkg.checks?.find(item => item.id === 'standards' && item.status === 'ready')) ? 'ready' : 'partial',
                    detail: 'Standards are declared in expertise manifests'
                }),
                anyFileCheck(rootPath, ['standards', 'expertises/finance/standards', 'core/StandardsLibrary.js'], 'Governed standards library', {
                    id: 'standards.library_files',
                    required: true
                })
            ]
        }),
        capability({
            id: 'exports.workpapers',
            label: 'Audit-Ready Exports',
            group: 'enterprise',
            description: 'Exportable workpapers and reports with evidence references and review state.',
            checks: [
                anyFileCheck(rootPath, ['arbiters/ConcieveExpertiseArbiter.js'], 'Report/export arbiter surface', {
                    id: 'exports.arbiter'
                }),
                anyFileCheck(rootPath, ['server/enterprise/WorkpaperExporter.js', 'core/WorkpaperExporter.js'], 'Canonical workpaper exporter', {
                    id: 'exports.workpaper_exporter',
                    required: true
                }),
                anyFileCheck(rootPath, ['server/routes/exportRoutes.js', 'server/enterprise/exportRoutes.js'], 'Export API routes', {
                    id: 'exports.routes',
                    required: true
                })
            ]
        }),
        capability({
            id: 'tool.governance',
            label: 'Tool Governance',
            group: 'agency',
            description: 'Tool inventory, permissioning, and approval gates for higher-risk actions.',
            checks: [
                anyFileCheck(rootPath, ['arbiters/ToolRegistry.cjs', 'core/ToolRegistry.js'], 'Tool registry', {
                    id: 'tools.registry',
                    required: true
                }),
                anyFileCheck(rootPath, ['server/ApprovalSystem.cjs', 'server/ApprovalSystem.js'], 'Approval system', {
                    id: 'tools.approvals'
                }),
                anyFileCheck(rootPath, ['server/toolPolicy.js', 'core/ToolPolicy.js', 'server/enterprise/ToolPolicy.js'], 'Tool policy layer', {
                    id: 'tools.policy',
                    required: true
                })
            ]
        }),
        capability({
            id: 'startup.reliability',
            label: 'Startup Reliability',
            group: 'platform',
            description: 'Bootstrap wiring, health checks, runtime map, and verification scripts for this machine.',
            checks: [
                fileCheck(rootPath, 'launcher_ULTRA.mjs', 'Primary launcher', { required: true }),
                fileCheck(rootPath, 'core/SomaBootstrapV2.js', 'Bootstrap orchestrator', { required: true }),
                fileCheck(rootPath, 'core/SomaRuntimeMap.js', 'Runtime map', { required: true }),
                fileCheck(rootPath, 'scripts/verify-autonomy-health.mjs', 'Autonomy health verifier'),
                fileCheck(rootPath, 'scripts/verify-expertise-runtime.mjs', 'Expertise runtime verifier')
            ]
        }),
        capability({
            id: 'memory.hygiene',
            label: 'Scoped Memory Hygiene',
            group: 'agency',
            description: 'Memory that can be scoped by domain, project, evidence source, and compliance boundary.',
            checks: [
                anyFileCheck(rootPath, ['arbiters/MnemonicArbiter.js', 'arbiters/MnemonicArbiter.cjs'], 'Mnemonic arbiter', {
                    id: 'memory.mnemonic',
                    required: true
                }),
                anyFileCheck(rootPath, ['core/ScopedMemoryPolicy.js', 'server/enterprise/ScopedMemoryPolicy.js'], 'Scoped memory policy', {
                    id: 'memory.policy',
                    required: true
                }),
                anyFileCheck(rootPath, ['core/MemoryEvidenceLinker.js', 'server/enterprise/MemoryEvidenceLinker.js'], 'Memory/evidence linker', {
                    id: 'memory.evidence_linker'
                })
            ]
        })
    ];

    const counts = countStatuses(capabilities);
    const packageCounts = countStatuses(packages);
    const totalScore = capabilities.length
        ? Math.round(capabilities.reduce((sum, item) => sum + item.score, 0) / capabilities.length)
        : 0;

    return {
        generatedAt: new Date().toISOString(),
        status: counts.broken > 0 ? 'broken' : counts.missing > 0 ? 'partial' : counts.partial > 0 ? 'partial' : 'ready',
        score: totalScore,
        counts,
        packageCounts,
        capabilities,
        packages,
        topGaps: capabilities
            .filter(item => item.status !== 'ready')
            .sort((a, b) => STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] || a.score - b.score)
            .slice(0, 8)
            .map(item => ({
                id: item.id,
                label: item.label,
                status: item.status,
                blocker: item.blockers[0] || item.checks.find(checkItem => checkItem.status !== 'ready')?.detail || 'Needs implementation'
            }))
    };
}

export default buildReadinessReport;
