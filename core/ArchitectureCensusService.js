/**
 * ArchitectureCensusService — Phase 1 of SOMA's architecture self-knowledge.
 *
 * Walks the code roots, builds a reference map from every import/require and
 * quoted module path in the codebase, and classifies each source file:
 *   active           — protected entrypoint, or has inbound references
 *   candidate_unused — zero inbound references found (evidence recorded)
 * Files with TODO/STUB/not-implemented markers get a 'stubbed' tag on top of
 * their classification.
 *
 * Output: data/architecture-census/latest.json (+ timestamped history copy) —
 * the evidence base that ArchitectureReorganizationService.plan() requires
 * before any quarantine move. The census deliberately errs toward 'active':
 * a false-active costs nothing, while a false-unused is caught again by the
 * reorg service's own stricter live reference re-check at plan AND apply time.
 *
 * Known blind spot (recorded in caveats): modules loaded by convention or via
 * computed paths (require(`./x/${name}`)) can look unused. Quarantine moves
 * are reversible and receipted, so the failure mode is a recoverable move,
 * never a deletion.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);
// Subjects: what gets classified. Must stay aligned with
// ArchitectureReorganizationService.SEARCH_ROOTS so plan() accepts the entries.
const SUBJECT_ROOTS = ['core', 'arbiters', 'server', 'daemons', 'cognitive', 'src'];
// Reference sources: everywhere an import can live, including the launchers at
// repo root and the cognitive terminal backend.
const REFERENCE_ROOTS = [...SUBJECT_ROOTS, 'scripts', 'appendages', 'a cognitive terminal'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'backup', 'backup-unused', '.soma-quarantine', 'unsloth_compiled_cache', 'checkpoints', 'vendor']);
// Mirrors ArchitectureReorganizationService.PROTECTED — these are always active.
const PROTECTED = [
    /^launcher_/i,
    /^package(?:-lock)?\.json$/i,
    /^core\/SomaBootstrap/i,
    /^core\/ASIKernel\.js$/i,
    /^core\/SomaAgenticExecutor\.js$/i,
    /^arbiters\/GoalPlannerArbiter\.cjs$/i,
    /^server\/services\/AutonomousHeartbeat\.cjs$/i,
];
const STUB_PATTERN = /\b(TODO|FIXME|STUB|NOT[_ ]?IMPLEMENTED|PLACEHOLDER)\b|throw new Error\((['"`])not implemented\1\)/i;

function normalize(value = '') {
    return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function stemOf(filePath = '') {
    return path.basename(filePath).replace(/\.(?:js|cjs|mjs|ts)$/i, '').toLowerCase();
}

export class ArchitectureCensusService {
    constructor({ root = process.cwd(), outputDir = 'data/architecture-census' } = {}) {
        this.root = path.resolve(root);
        this.outputDir = path.join(this.root, outputDir);
    }

    async run() {
        const startedAt = Date.now();
        const subjects = [];
        for (const rootName of SUBJECT_ROOTS) {
            await this._walk(path.join(this.root, rootName), file => {
                if (CODE_EXTENSIONS.has(path.extname(file).toLowerCase())) subjects.push(file);
            });
        }

        // One pass over every reference source: extract module stems from
        // import/require specifiers and quoted path-like strings.
        // stem -> Set of referencing relative paths
        const referencedBy = new Map();
        let referenceSources = 0;
        const referenceFiles = [];
        for (const rootName of REFERENCE_ROOTS) {
            await this._walk(path.join(this.root, rootName), file => {
                if (CODE_EXTENSIONS.has(path.extname(file).toLowerCase())) referenceFiles.push(file);
            });
        }
        // Root-level launchers/config scripts are reference sources too.
        try {
            const rootEntries = await fs.readdir(this.root, { withFileTypes: true });
            for (const entry of rootEntries) {
                if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                    referenceFiles.push(path.join(this.root, entry.name));
                }
            }
        } catch { /* non-fatal */ }

        for (const file of referenceFiles) {
            let content;
            try { content = await fs.readFile(file, 'utf8'); } catch { continue; }
            referenceSources++;
            const relative = normalize(path.relative(this.root, file));
            for (const stem of this._extractReferencedStems(content)) {
                if (!referencedBy.has(stem)) referencedBy.set(stem, new Set());
                referencedBy.get(stem).add(relative);
            }
        }

        const entries = [];
        const summary = { active: 0, candidate_unused: 0, stubbed: 0 };
        for (const file of subjects) {
            const relative = normalize(path.relative(this.root, file));
            let content = '';
            let lines = 0;
            try {
                content = await fs.readFile(file, 'utf8');
                lines = content.split('\n').length;
            } catch { /* unreadable files stay classified on structure alone */ }

            const stem = stemOf(file);
            const inbound = new Set(referencedBy.get(stem) || []);
            inbound.delete(relative); // self-references don't keep a file alive
            const isProtected = PROTECTED.some(pattern => pattern.test(relative));
            const stubbed = STUB_PATTERN.test(content);

            const tags = [];
            if (stubbed) { tags.push('stubbed'); summary.stubbed++; }

            let classificationValue;
            let evidence;
            if (isProtected) {
                classificationValue = 'active';
                evidence = 'Protected entrypoint/runtime file (always active by policy).';
            } else if (inbound.size > 0) {
                classificationValue = 'active';
                evidence = `Referenced by ${inbound.size} file(s), e.g. ${[...inbound].slice(0, 3).join(', ')}`;
            } else {
                classificationValue = 'candidate_unused';
                evidence = `0 inbound references: stem "${stem}" not found in any import/require specifier or quoted module path across ${referenceSources} reference-source files (roots: ${REFERENCE_ROOTS.join(', ')} + repo root).`;
            }
            summary[classificationValue]++;

            entries.push({
                path: relative,
                classification: classificationValue,
                tags,
                evidence,
                inboundCount: inbound.size,
                references: [...inbound].slice(0, 5),
                lines,
                bytes: content.length
            });
        }

        entries.sort((a, b) => a.path.localeCompare(b.path));
        const census = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            root: this.root,
            subjectRoots: SUBJECT_ROOTS,
            referenceRoots: [...REFERENCE_ROOTS, '<repo root files>'],
            filesClassified: entries.length,
            referenceSourcesScanned: referenceSources,
            summary,
            caveats: [
                'Modules loaded via computed paths (require(`./x/${name}`)) or filesystem-scan conventions may be misclassified as candidate_unused.',
                'architecture_reorg_plan re-verifies references live before any move; quarantine moves are reversible and never delete.',
                'Files named index.* almost always classify active due to stem collisions — review those manually.'
            ],
            entries
        };

        await fs.mkdir(this.outputDir, { recursive: true });
        const latestPath = path.join(this.outputDir, 'latest.json');
        const historyPath = path.join(this.outputDir, `census-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        const serialized = JSON.stringify(census, null, 2);
        await fs.writeFile(latestPath, serialized, 'utf8');
        await fs.writeFile(historyPath, serialized, 'utf8');

        return {
            success: true,
            censusPath: normalize(path.relative(this.root, latestPath)),
            historyPath: normalize(path.relative(this.root, historyPath)),
            filesClassified: entries.length,
            referenceSourcesScanned: referenceSources,
            summary,
            durationMs: census.durationMs,
            sampleUnused: entries.filter(e => e.classification === 'candidate_unused').slice(0, 10).map(e => e.path),
            nextStep: 'Review sampleUnused, then use architecture_reorg_plan on one census-confirmed candidate_unused file.'
        };
    }

    _extractReferencedStems(content) {
        const stems = new Set();
        // import/require/dynamic-import specifiers
        const importPattern = /(?:require\s*\(\s*|from\s+|import\s*\(\s*|import\s+)['"`]([^'"`\n]{2,220})['"`]/g;
        // any quoted token that names a code file or looks like a module path
        const quotedPathPattern = /['"`]([^'"`\n]{2,220}?\.(?:js|cjs|mjs|ts))['"`]/g;
        const quotedSlashPattern = /['"`]((?:[A-Za-z0-9_$.-]+[/\\])+[A-Za-z0-9_$.-]{2,80})['"`]/g;
        for (const pattern of [importPattern, quotedPathPattern, quotedSlashPattern]) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const specifier = match[1];
                if (!specifier || specifier.startsWith('http')) continue;
                stems.add(stemOf(specifier));
            }
        }
        return stems;
    }

    async _walk(directory, visit) {
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) await this._walk(full, visit);
            else visit(full);
        }
    }
}

export default ArchitectureCensusService;
