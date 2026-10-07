import fs from 'node:fs/promises';
import path from 'node:path';
import { ArchitectureCensusService } from './ArchitectureCensusService.js';
import { buildRuntimeMap } from './SomaRuntimeMap.js';

const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'release', 'backup', 'backup-unused', '.soma-quarantine', 'graphify-out']);
const GENERIC_TERMS = new Set(['system', 'memory', 'tools', 'brain', 'planner', 'registry', 'engine', 'arbiters', 'runtime', 'context']);
const posix = value => String(value || '').replace(/\\/g, '/');
const unique = values => [...new Set(values)];
const clip = (value, limit = 180) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

async function readJson(filePath, fallback = null) {
    try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return fallback; }
}

async function walk(root, relative, output) {
    const absolute = path.join(root, relative);
    let entries = [];
    try { entries = await fs.readdir(absolute, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const child = posix(path.join(relative, entry.name));
        if (entry.isDirectory()) await walk(root, child, output);
        else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(child);
    }
}

async function sourceIndex(root) {
    const files = [];
    for (const relative of ['core', 'arbiters', 'server', 'daemons', 'cognitive', 'frontend/apps/command-bridge', 'tests']) await walk(root, relative, files);
    const rows = [];
    for (const relative of files) {
        try { rows.push({ path:relative, content:await fs.readFile(path.join(root, relative), 'utf8') }); } catch { /* unreadable source is omitted */ }
    }
    return rows;
}

function matchingFiles(rows, terms, limit = 8) {
    const useful = unique(terms.map(value => String(value || '').trim()).filter(value => value.length >= 4 && !GENERIC_TERMS.has(value.toLowerCase())));
    if (!useful.length) return [];
    return rows.filter(row => useful.some(term => row.content.includes(term))).map(row => row.path).slice(0, limit);
}

function exposureFor(component, groups) {
    const terms = [component.id, component.name];
    return {
        api: matchingFiles(groups.api, terms),
        tools: matchingFiles(groups.tools, terms),
        ui: matchingFiles(groups.ui, terms),
        tests: matchingFiles(groups.tests, terms),
        implementation: matchingFiles(groups.implementation, terms)
    };
}

function truthStatus(component, exposure) {
    const detail = component.statusDetail || {};
    if (detail.error || detail.initializeState === 'degraded') return 'degraded_runtime';
    if (component.status === 'missing' || component.status === 'initializing') return 'unavailable_runtime';
    if (component.status === 'idle') return 'loaded_idle';
    if (exposure.tests.length && (exposure.api.length || exposure.tools.length || exposure.ui.length)) return 'operational_verified_surface';
    if (exposure.api.length || exposure.tools.length || exposure.ui.length) return 'operational_reachable';
    if (exposure.tests.length) return 'operational_tested_internal';
    return 'operational_internal_only';
}

function routeInventory(rows) {
    const routes = [];
    const pattern = /\b(?:app|router)\.(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    for (const row of rows) {
        let match;
        while ((match = pattern.exec(row.content)) !== null) routes.push({ method:match[1].toUpperCase(), route:match[2], source:row.path });
    }
    return routes;
}

function environmentInventory(rows) {
    const byName = new Map();
    const pattern = /process\.env\.([A-Z][A-Z0-9_]+)/g;
    for (const row of rows) {
        let match;
        while ((match = pattern.exec(row.content)) !== null) {
            if (!byName.has(match[1])) byName.set(match[1], []);
            byName.get(match[1]).push(row.path);
        }
    }
    return [...byName.entries()].map(([name, references]) => ({ name, configured:Boolean(process.env[name]), references:unique(references).slice(0, 5) }));
}

function renderMarkdown(report) {
    const rows = report.verifiedDomains.map(item => `| ${item.domain} | ${item.status} | ${item.tests} | ${item.passed} | ${item.score} | ${item.completedAt || 'unknown'} |`).join('\n');
    const anomalies = report.findings.map(item => `- **${item.severity.toUpperCase()} · ${item.title}:** ${item.detail}`).join('\n');
    const duplicates = report.duplicateRuntimeNames.map(item => `- **${item.name}:** ${item.ids.join(', ')}`).join('\n') || '- None observed.';
    const internal = report.runtimeComponents.filter(item => item.truthStatus === 'operational_internal_only').slice(0, 30).map(item => `- ${item.id} (${item.name})`).join('\n') || '- None observed.';
    const dormant = report.dormantCandidates.top.map(item => `- ${item.path} — ${item.lines} lines${item.tags?.length ? `; ${item.tags.join(', ')}` : ''}`).join('\n') || '- None in the current census.';
    return `# SOMA Architecture Truth Map\n\nGenerated ${report.generatedAt}. This report distinguishes file presence from runtime observation and repeatable evidence.\n\n## Verdict\n\n${report.verdict}\n\n## Evidence rubric\n\n- **operational_verified_surface** — live runtime component, reachable from API/tool/UI, and directly referenced by tests.\n- **operational_reachable** — live and reachable, but no direct test reference was found.\n- **operational_tested_internal** — live and test-referenced, without a direct user-facing surface.\n- **operational_internal_only** — live, but no direct API/tool/UI/test reference was found; this is hidden, not automatically broken.\n- **loaded_idle** — instantiated but currently inactive.\n- **degraded_runtime** — live observation reports degraded initialization or an error.\n- **dormant_candidate** — zero static inbound references in the architecture census; convention-loaded modules remain a known caveat.\n\n## Current totals\n\n| Measure | Count |\n|---|---:|\n| Live runtime components | ${report.summary.runtimeComponents} |\n| Active runtime components | ${report.summary.activeRuntimeComponents} |\n| Runtime components with a reachable surface | ${report.summary.reachableRuntimeComponents} |\n| Runtime internal-only components | ${report.summary.internalOnlyRuntimeComponents} |\n| Duplicate live names | ${report.summary.duplicateRuntimeNames} |\n| Registered tools | ${report.summary.registeredTools} |\n| Registered expertises | ${report.summary.registeredExpertises} |\n| Loaded expertises | ${report.summary.loadedExpertises} |\n| API/router declarations | ${report.summary.routeDeclarations} |\n| Census source files | ${report.summary.censusFiles} |\n| Dormant candidates | ${report.summary.dormantCandidates} |\n| Duplicate basenames | ${report.summary.duplicateNamedFiles} |\n| Stub-marker files | ${report.summary.stubbedFiles} |\n| Verified mission completion rate | ${report.summary.missionCompletionRate == null ? 'not observed' : `${report.summary.missionCompletionRate}%`} |\n\n## Observed autonomous outcomes\n\n${report.autonomyOutcomes ? `The live mission scoreboard reports **${report.autonomyOutcomes.verifiedCompletions} verified completions**, **${report.autonomyOutcomes.failedMissions} failed missions**, and a **${report.autonomyOutcomes.completionRate}% completion rate**. Weakest area: **${report.autonomyOutcomes.weakestArea || 'unknown'}**. This outcome evidence is more meaningful than component initialization alone.` : 'No live autonomy outcome snapshot was available.'}\n\n## Repeatably verified domains\n\n| Domain | Status | Tests | Passed | Score | Last receipt |\n|---|---|---:|---:|---:|---|\n${rows || '| No capability-trial receipts found | unverified | 0 | 0 | 0 | unknown |'}\n\n## Highest-value findings\n\n${anomalies || '- No findings generated.'}\n\n## Duplicate live bindings\n\n${duplicates}\n\n## Live but internally surfaced only\n\nThese components are instantiated, but the static audit found no direct API, Tool Registry, Command Bridge, or test reference. They need manual tracing before being called useful or useless.\n\n${internal}\n\n## Dormant candidates requiring review\n\n${dormant}\n\n## Configuration gates\n\n${report.configurationGates.length} environment-variable gates were found; ${report.configurationGates.filter(item => item.configured).length} are configured in this audit process. Missing variables are not automatically failures because many connectors are optional. Values were never recorded.\n\n## Recommended order\n\n1. Repair truth telemetry: Tool Registry executions need durable counters/receipts; zero currently means “not measured.”\n2. Remove duplicate live aliases or designate canonical bindings, especially the degraded duplicate Biotech instance.\n3. Trace internal-only live components to an owner and consumer; expose, consolidate, or retire them deliberately.\n4. Review the ${report.summary.dormantCandidates} census dormant candidates, starting with legacy copies, duplicate basenames, large files, and stubs.\n5. Expand capability trials beyond the nine broad domains so business planning, biotech, voice, graph, and individual connectors have executable receipts.\n6. Fix the readiness scanner’s expertise discovery disagreement with the live Expertise Registry.\n`;
}

export class ArchitectureTruthMapService {
    constructor({ root = process.cwd(), outputDir = 'data/architecture-truth-map', censusService = null, now = () => new Date() } = {}) {
        this.root = path.resolve(root);
        this.outputDir = path.join(this.root, outputDir);
        this.census = censusService || new ArchitectureCensusService({ root:this.root });
        this.now = now;
    }

    async build({ system = null, runtimeSnapshot = null, toolSnapshot = null, autonomySnapshot = null, refreshCensus = false, persist = true } = {}) {
        if (refreshCensus) await this.census.run();
        let census = await readJson(path.join(this.root, 'data', 'architecture-census', 'latest.json'));
        if (!census) { await this.census.run(); census = await readJson(path.join(this.root, 'data', 'architecture-census', 'latest.json'), { summary:{}, entries:[] }); }
        const runtime = runtimeSnapshot || (system ? buildRuntimeMap(system) : { ready:false, components:[], counts:{}, expertises:{ status:{ ready:false }, packages:[] }, readiness:null });
        const sources = await sourceIndex(this.root);
        const groups = {
            api:sources.filter(row => row.path.startsWith('server/routes/') || row.path === 'server/loaders/routes.js'),
            tools:sources.filter(row => row.path.includes('ToolRegistry') || row.path === 'server/loaders/tools.js'),
            ui:sources.filter(row => row.path.startsWith('frontend/apps/command-bridge/')),
            tests:sources.filter(row => row.path.startsWith('tests/')),
            implementation:sources.filter(row => !row.path.startsWith('tests/') && !row.path.startsWith('frontend/'))
        };
        const runtimeComponents = (runtime.components || []).map(component => {
            const exposure = exposureFor(component, groups);
            return { id:component.id, name:component.name, type:component.type, runtimeStatus:component.status, truthStatus:truthStatus(component, exposure), exposure, statusDetail:component.statusDetail || null };
        });
        const duplicateRuntimeNames = [...new Map(runtimeComponents.map(item => [item.name, runtimeComponents.filter(other => other.name === item.name).map(other => other.id)]))]
            .filter(([, ids]) => ids.length > 1).map(([name, ids]) => ({ name, ids }));
        const scoreboard = await readJson(path.join(this.root, 'data', 'self-evolution', 'scoreboard.json'), { domains:{} });
        const verifiedDomains = Object.entries(scoreboard.domains || {}).map(([domain, receipt]) => ({
            domain, status:receipt.valid && receipt.tests > 0 && receipt.failed === 0 ? 'verified' : 'failed_or_unverified', tests:receipt.tests || 0,
            passed:receipt.passed || 0, score:Math.round(Number(receipt.score || 0) * 1000) / 1000, completedAt:receipt.completedAt || null, evidenceHash:receipt.evidenceHash || null
        }));
        const routes = routeInventory(groups.api);
        const configurationGates = environmentInventory(sources);
        const registrySource = sources.find(row => row.path === 'core/ToolRegistry.js')?.content || '';
        const manifestSource = registrySource.match(/getToolsManifest[\s\S]{0,1400}/)?.[0] || '';
        const toolTelemetryReliable = /this\.usage\.set\(/.test(registrySource)
            && /getUsageStats\(/.test(registrySource)
            && /usageCount/.test(manifestSource)
            && /executionLedger/.test(registrySource)
            && /tool\/result/.test(registrySource);
        const tools = toolSnapshot?.tools || system?.toolRegistry?.getToolsManifest?.() || [];
        const dormantRaw = (census.entries || []).filter(entry => entry.classification === 'candidate_unused');
        const packageText = await fs.readFile(path.join(this.root, 'package.json'), 'utf8').catch(() => '');
        const executableExceptions = dormantRaw.filter(entry => /\.test\.(?:js|cjs|mjs|ts)$/i.test(entry.path) || packageText.includes(entry.path));
        const dormant = dormantRaw.filter(entry => !executableExceptions.includes(entry));
        const findings = [];
        if (!toolTelemetryReliable) findings.push({ severity:'high', id:'tool-telemetry', title:'Tool usage is not measurable', detail:`${tools.length} tools are registered, but ToolRegistry does not expose live usage counters backed by durable execution receipts. API zeros cannot be interpreted as unused.` });
        if (duplicateRuntimeNames.length) findings.push({ severity:'high', id:'duplicate-runtime-bindings', title:'Duplicate live component aliases', detail:`${duplicateRuntimeNames.length} component names are bound under multiple system keys, increasing ambiguity and double-initialization risk.` });
        const degraded = runtimeComponents.filter(item => item.truthStatus === 'degraded_runtime');
        if (degraded.length) findings.push({ severity:'high', id:'degraded-runtime', title:'Degraded live components', detail:degraded.map(item => `${item.id} (${item.name})`).join(', ') });
        const internalOnly = runtimeComponents.filter(item => item.truthStatus === 'operational_internal_only');
        if (internalOnly.length) findings.push({ severity:'medium', id:'internal-only', title:'Live components without a direct consumer surface', detail:`${internalOnly.length} live components have no direct API, tool, Command Bridge, or test reference in the static audit. Manual call-graph review is required.` });
        if (dormant.length) findings.push({ severity:'medium', id:'dormant-candidates', title:'Static dormant candidates', detail:`${dormant.length} source files have zero detected inbound references; ${census.summary?.stubbed || 0} census files carry stub markers and ${census.summary?.duplicate_named || 0} share basenames.` });
        const registryExpertises = runtime.expertises?.packages?.length || 0;
        const readinessExpertises = runtime.readiness?.packages?.length || 0;
        if (registryExpertises !== readinessExpertises) findings.push({ severity:'high', id:'expertise-readiness-disagreement', title:'Readiness scanner disagrees with live Expertise Registry', detail:`Live registry reports ${registryExpertises} expertises while readiness reports ${readinessExpertises}; readiness is using incomplete discovery evidence.` });
        const missionBoard = autonomySnapshot?.scoreboard || system?.goalPlanner?.missionDirector?.status?.().scoreboard || null;
        const resource = autonomySnapshot?.heartbeat?.resource || null;
        if (missionBoard && Number(missionBoard.completionRate) < 50) findings.push({ severity:'high', id:'low-mission-completion', title:'Live mission completion is low', detail:`${missionBoard.verifiedCompletions || 0} verified completions versus ${missionBoard.failedMissions || 0} failures (${missionBoard.completionRate}% completion). Weakest area: ${missionBoard.weakestArea || 'unknown'}.` });
        if (resource?.level && resource.level !== 'healthy') findings.push({ severity:'medium', id:'runtime-resource-pressure', title:'Runtime resource pressure', detail:`Live resource level is ${resource.level}; heap ratio ${Math.round(Number(resource.processHeapRatio || 0) * 100)}% and event-loop lag ${Math.round(Number(resource.eventLoopLagMs || 0))} ms.` });
        const report = {
            schemaVersion:1, generatedAt:this.now().toISOString(), root:this.root,
            verdict:`SOMA is not broadly non-functional: ${runtimeComponents.filter(item => item.runtimeStatus === 'active').length} components are observed active and ${verifiedDomains.filter(item => item.status === 'verified').length} broad domains have passing receipts. The main risk is overclaiming: hidden consumers, duplicate bindings, stale/coarse trials, missing tool-use telemetry, and ${dormant.length} static dormant candidates prevent a trustworthy one-number capability claim.`,
            rubricVersion:'runtime-reachability-evidence-v1',
            summary:{
                runtimeComponents:runtimeComponents.length, activeRuntimeComponents:runtimeComponents.filter(item => item.runtimeStatus === 'active').length,
                reachableRuntimeComponents:runtimeComponents.filter(item => ['operational_verified_surface','operational_reachable'].includes(item.truthStatus)).length,
                internalOnlyRuntimeComponents:internalOnly.length, duplicateRuntimeNames:duplicateRuntimeNames.length, registeredTools:tools.length,
                registeredExpertises:registryExpertises, loadedExpertises:runtime.expertises?.packages?.filter(item => item.loaded).length || 0,
                routeDeclarations:routes.length, censusFiles:census.filesClassified || census.entries?.length || 0, dormantCandidates:dormant.length,
                duplicateNamedFiles:census.summary?.duplicate_named || 0, stubbedFiles:census.summary?.stubbed || 0, toolTelemetryReliable,
                missionCompletionRate:missionBoard?.completionRate ?? null
            },
            liveRuntime:{ available:Boolean(runtimeSnapshot || system), ready:Boolean(runtime.ready), observedAt:runtime.generatedAt || null, counts:runtime.counts || {} },
            autonomyOutcomes:missionBoard ? { verifiedCompletions:missionBoard.verifiedCompletions || 0, failedMissions:missionBoard.failedMissions || 0, completionRate:missionBoard.completionRate ?? null, weakestArea:missionBoard.weakestArea || null, byCategory:missionBoard.byCategory || {}, failureCauses:missionBoard.failureCauses || {} } : null,
            runtimeComponents, duplicateRuntimeNames, verifiedDomains, readiness:runtime.readiness || null, routes,
            tools:{ count:tools.length, telemetryReliable:toolTelemetryReliable, names:tools.map(item => item.name).filter(Boolean).sort() },
            expertises:runtime.expertises || { status:{ ready:false }, packages:[] }, configurationGates,
            dormantCandidates:{ count:dormant.length, rawCount:dormantRaw.length, executableExceptions:executableExceptions.map(item => item.path), caveats:[...(census.caveats || []), 'Package-script entrypoints and executable test files are excluded from the truth-map dormant review queue even when the import census reports zero inbound references.'], top:dormant.sort((a,b) => b.lines-a.lines).slice(0,50).map(item => ({ path:item.path, lines:item.lines, tags:item.tags, evidence:item.evidence })) },
            reviewQueues:census.reviewQueues || {}, findings
        };
        if (persist) {
            await fs.mkdir(this.outputDir, { recursive:true });
            await fs.writeFile(path.join(this.outputDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
            await fs.writeFile(path.join(this.outputDir, 'ARCHITECTURE_TRUTH_MAP.md'), renderMarkdown(report), 'utf8');
        }
        return report;
    }
}

export { renderMarkdown as renderArchitectureTruthMapMarkdown };
export default ArchitectureTruthMapService;
