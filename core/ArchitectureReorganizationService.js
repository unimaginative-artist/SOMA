import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { Poseidon } from './Poseidon.js';
import { resolveWithinRoot } from './PathSafety.js';

const execFileAsync = promisify(execFile);
const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);
const SEARCH_ROOTS = ['core', 'arbiters', 'server', 'daemons', 'cognitive', 'src'];
const PROTECTED = [
    /^launcher_/i,
    /^package(?:-lock)?\.json$/i,
    /^core\/SomaBootstrap/i,
    /^core\/ASIKernel\.js$/i,
    /^core\/SomaAgenticExecutor\.js$/i,
    /^arbiters\/GoalPlannerArbiter\.cjs$/i,
    /^server\/services\/AutonomousHeartbeat\.cjs$/i,
];

function normalize(value = '') {
    return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function flattenObjects(value, output = []) {
    if (Array.isArray(value)) {
        for (const item of value) flattenObjects(item, output);
    } else if (value && typeof value === 'object') {
        output.push(value);
        for (const child of Object.values(value)) flattenObjects(child, output);
    }
    return output;
}

function classification(entry = {}) {
    return String(entry.classification || entry.status || entry.bucket || entry.category || '').toLowerCase().replace(/[\s-]+/g, '_');
}

function entryPath(entry = {}) {
    return normalize(entry.path || entry.file || entry.filepath || entry.module || '');
}

export class ArchitectureReorganizationService {
    constructor({ root = process.cwd(), censusPath = 'data/architecture-census/latest.json' } = {}) {
        this.root = path.resolve(root);
        this.censusPath = censusPath;
        this.planDir = path.join(this.root, 'data', 'architecture-reorganization', 'plans');
        this.receiptDir = path.join(this.root, 'data', 'architecture-reorganization', 'receipts');
        this.quarantineRoot = path.join(this.root, '.soma-quarantine', 'architecture-unused');
        this.poseidon = new Poseidon({ threshold: 0.75 });
    }

    async plan({ source }) {
        const relativeSource = normalize(source);
        const sourcePath = resolveWithinRoot(this.root, relativeSource, 'Architecture source');
        if (!CODE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) throw new Error('Only JavaScript or TypeScript source files can be quarantined');
        if (PROTECTED.some(pattern => pattern.test(relativeSource))) throw new Error(`Protected runtime file cannot be reorganized: ${relativeSource}`);
        const stat = await fs.stat(sourcePath);
        if (!stat.isFile()) throw new Error('Source is not a file');

        const censusFile = resolveWithinRoot(this.root, this.censusPath, 'Architecture census');
        const census = JSON.parse(await fs.readFile(censusFile, 'utf8'));
        const entry = flattenObjects(census).find(item => entryPath(item) === relativeSource);
        if (!entry) throw new Error(`Source is not present in ${this.censusPath}`);
        if (!['candidate_unused', 'unused'].includes(classification(entry))) {
            throw new Error(`Census classification is not eligible for quarantine: ${classification(entry) || 'missing'}`);
        }
        const evidence = entry.evidence || entry.references || entry.reason || entry.rationale;
        if (!evidence || (Array.isArray(evidence) && evidence.length === 0)) throw new Error('Census entry lacks classification evidence');

        const references = await this._findReferences(relativeSource);
        if (references.length) throw new Error(`Source still has code references: ${references.slice(0, 8).join(', ')}`);
        await this._syntaxCheck(sourcePath);

        const destination = normalize(path.join('.soma-quarantine', 'architecture-unused', relativeSource));
        const destinationPath = resolveWithinRoot(this.root, destination, 'Architecture quarantine destination');
        try {
            await fs.access(destinationPath);
            throw new Error(`Destination already exists: ${destination}`);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        const id = `reorg-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const expiresAt = Date.now() + 30 * 60_000;
        const token = createHash('sha256').update(`${id}\0${relativeSource}\0${destination}\0${expiresAt}`).digest('hex');
        const plan = {
            schemaVersion: 1,
            id,
            createdAt: new Date().toISOString(),
            expiresAt,
            source: relativeSource,
            destination,
            censusPath: this.censusPath,
            censusClassification: classification(entry),
            evidence,
            references,
            operation: 'quarantine_move',
            deleteAllowed: false,
            confirmationToken: token
        };
        await fs.mkdir(this.planDir, { recursive: true });
        const planPath = path.join(this.planDir, `${id}.json`);
        await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');
        return { success: true, planPath: normalize(path.relative(this.root, planPath)), plan };
    }

    async apply({ planPath, confirmationToken }) {
        const resolvedPlan = resolveWithinRoot(this.root, planPath, 'Architecture reorganization plan');
        const plan = JSON.parse(await fs.readFile(resolvedPlan, 'utf8'));
        if (plan.operation !== 'quarantine_move' || plan.deleteAllowed !== false) throw new Error('Invalid reorganization operation');
        if (Date.now() > Number(plan.expiresAt || 0)) throw new Error('Reorganization plan expired');
        if (!confirmationToken || confirmationToken !== plan.confirmationToken) throw new Error('Confirmation token does not match the staged plan');

        const sourcePath = resolveWithinRoot(this.root, plan.source, 'Architecture source');
        const destinationPath = resolveWithinRoot(this.root, plan.destination, 'Architecture destination');
        const references = await this._findReferences(plan.source);
        if (references.length) throw new Error(`References appeared after planning: ${references.slice(0, 8).join(', ')}`);
        await this._syntaxCheck(sourcePath);
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });

        let moved = false;
        let method = 'filesystem_rename';
        try {
            const tracked = await this._isGitTracked(plan.source);
            if (tracked) {
                await execFileAsync('git', ['mv', '--', plan.source, plan.destination], { cwd: this.root, timeout: 30_000, windowsHide: true });
                method = 'git_mv';
            } else {
                await fs.rename(sourcePath, destinationPath);
            }
            moved = true;
            await fs.access(destinationPath);
            try { await fs.access(sourcePath); throw new Error('Source still exists after move'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            await this._syntaxCheck(destinationPath);

            const verdict = await this.poseidon.verify(`Architecture quarantine move completed: ${plan.source}`, {
                falsificationTest: `source absent; destination exists; syntax valid; references=0; method=${method}`,
                testResult: true
            });
            if (verdict?.state !== 'TRUE') throw new Error(`Poseidon did not certify move: ${verdict?.reason || verdict?.state}`);

            const receipt = await this._writeReceipt(plan, { success: true, method, poseidon: verdict, rolledBack: false });
            return { success: true, source: plan.source, destination: plan.destination, method, poseidon: verdict, receiptPath: receipt };
        } catch (error) {
            let rolledBack = false;
            if (moved) {
                try {
                    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
                    if (method === 'git_mv') await execFileAsync('git', ['mv', '--', plan.destination, plan.source], { cwd: this.root, timeout: 30_000, windowsHide: true });
                    else await fs.rename(destinationPath, sourcePath);
                    rolledBack = true;
                } catch {}
            }
            const receipt = await this._writeReceipt(plan, { success: false, method, error: error.message, rolledBack });
            return { success: false, error: error.message, rolledBack, receiptPath: receipt };
        }
    }

    async _findReferences(relativeSource) {
        const basename = path.basename(relativeSource);
        const stem = basename.replace(/\.(?:js|cjs|mjs|ts)$/i, '');
        const references = [];
        for (const rootName of SEARCH_ROOTS) {
            const root = path.join(this.root, rootName);
            await this._walk(root, async file => {
                const relative = normalize(path.relative(this.root, file));
                if (relative === relativeSource || relative.startsWith('.soma-quarantine/')) return;
                if (!CODE_EXTENSIONS.has(path.extname(file).toLowerCase())) return;
                let content;
                try { content = await fs.readFile(file, 'utf8'); } catch { return; }
                if (content.includes(basename) || new RegExp(`['\"\`]([^'\"\`]*[/\\\\])?${stem}(?:\\.(?:js|cjs|mjs|ts))?['\"\`]`).test(content)) references.push(relative);
            });
        }
        return [...new Set(references)].slice(0, 50);
    }

    async _walk(directory, visit) {
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (['node_modules', '.git', 'dist', 'build', 'backup', 'backup-unused'].includes(entry.name)) continue;
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) await this._walk(full, visit);
            else await visit(full);
        }
    }

    async _syntaxCheck(file) {
        if (!/\.(?:js|cjs|mjs)$/i.test(file)) return;
        await execFileAsync(process.execPath, ['--check', file], { cwd: this.root, timeout: 15_000, windowsHide: true });
    }

    async _isGitTracked(relative) {
        try {
            await execFileAsync('git', ['ls-files', '--error-unmatch', '--', relative], { cwd: this.root, timeout: 10_000, windowsHide: true });
            return true;
        } catch { return false; }
    }

    async _writeReceipt(plan, outcome) {
        await fs.mkdir(this.receiptDir, { recursive: true });
        const receiptPath = path.join(this.receiptDir, `${plan.id}.json`);
        await fs.writeFile(receiptPath, JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), plan, outcome }, null, 2), 'utf8');
        return normalize(path.relative(this.root, receiptPath));
    }
}

export default ArchitectureReorganizationService;
