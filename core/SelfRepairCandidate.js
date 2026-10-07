import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolveWithinRoot } from './PathSafety.js';
import { protectionForArchitecturePath } from './ArchitectureProtectionPolicy.js';
import { SwarmPatchTransaction } from './SwarmPatchTransaction.js';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const protectedCode = /^(?:config\/|marionette\/|server\/loaders\/|server\/routes\/rsiRoutes|server\/core\/CostLedger|core\/rsi\/|core\/(?:SelfModification|SelfRepair|PathSafety|ArchitectureProtection|SwarmPatchTransaction|IsolatedCandidateRunner|SelfEvolutionDirector|ASIKernel|CapabilityTrialRegistry)|arbiters\/MaxApprovalShim|launcher_ULTRA|start_production|clean_restart|ecosystem\.config)/i;
const tradingCode = /(?:^|\/)(?:trading|trade|market|order|position|risk|broker|exchange|beebot)[^/]*\.(?:js|cjs|mjs|ts)$/i;

export function repairPath(root, value) {
    const absolute = resolveWithinRoot(root, value, 'Repair candidate');
    resolveWithinRoot(realpathSync(root), realpathSync(absolute), 'Repair real path');
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (!/^(?:core|arbiters|server|scripts)\/.+\.(?:js|cjs|mjs|ts)$/.test(relative)
        || protectedCode.test(relative) || tradingCode.test(relative) || protectionForArchitecturePath(relative).protected) {
        throw new Error(`Repair cannot change protected/non-source path: ${relative}`);
    }
    return relative;
}

// A disposable checkout holds ALL candidate writes. The owner worktree is only
// touched by publish(), after executable validation and independent review.
export class SelfRepairCandidate {
    static async create(governance, patch, contract) {
        if (!Array.isArray(patch?.files) || !patch.files.length || patch.files.length > 4) throw new Error('Repair requires 1–4 explicit source files');
        if (!contract?.testFiles?.length) throw new Error('Repair requires explicit executable testFiles; syntax alone is insufficient');
        const files = patch.files.map(file => ({ ...file, path: repairPath(governance.root, file.path) }));
        if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) throw new Error('Duplicate repair target');
        const preflight = await governance.inspectSnapshotFiles(files.map(file => file.path));
        const candidate = new SelfRepairCandidate(governance, preflight);
        try {
            candidate.worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-repair-candidate-'));
            await governance._git(['worktree', 'add', '--detach', candidate.worktree, preflight.head]);
            candidate.added = true;
            // Overlay current owner source changes into the PRIVATE baseline.
            // Never copy .env, runtime databases, secrets or generated datasets.
            const overlay = (await governance._git(['ls-files', '-m', '-o', '--exclude-standard', '--',
                'core', 'arbiters', 'server', 'scripts', 'utils', 'services', 'providers', 'cognitive']))
                .split(/\r?\n/).filter(file => /\.(?:js|cjs|mjs|ts)$/.test(file));
            if (overlay.length > 2000) throw new Error('Source snapshot exceeds bounded overlay limit');
            for (const file of [...new Set([...overlay, ...preflight.files])]) {
                const source = resolveWithinRoot(governance.root, file);
                const target = resolveWithinRoot(candidate.worktree, file);
                const bytes = await fs.readFile(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
                if (bytes === null) {
                    candidate.baselineHashes[file] = null;
                    await fs.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
                    continue;
                }
                resolveWithinRoot(realpathSync(governance.root), realpathSync(source), 'Snapshot source real path');
                candidate.baselineHashes[file] = digest(bytes);
                await fs.mkdir(path.dirname(target), { recursive: true });
                resolveWithinRoot(realpathSync(candidate.worktree), realpathSync(path.dirname(target)), 'Snapshot directory', { allowRoot: true });
                if (await fs.lstat(target).then(stat => stat.isSymbolicLink(), () => false)) throw new Error('Symlink in candidate baseline');
                await fs.writeFile(target, bytes);
            }
            for (const file of files) {
                candidate.originals[file.path] = await fs.readFile(resolveWithinRoot(governance.root, file.path));
            }
            // Use the registered tests as immutable evaluation input, including
            // owner-authored tests not yet committed. Candidates cannot edit them.
            for (const file of contract.testFiles) {
                const source = resolveWithinRoot(governance.root, file, 'Repair test');
                const target = resolveWithinRoot(candidate.worktree, file, 'Candidate test');
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(source, target);
                candidate.baselineHashes[file] = digest(await fs.readFile(source));
            }
            const baselineFiles = Object.keys(candidate.baselineHashes);
            for (let index = 0; index < baselineFiles.length; index += 80) {
                await governance._git(['add', '--', ...baselineFiles.slice(index, index + 80)], { cwd: candidate.worktree });
            }
            await governance._git(['-c', `core.hooksPath=${path.join(candidate.worktree, '.no-repair-hooks')}`, '-c', 'user.name=SOMA Repair', '-c', 'user.email=soma-repair@localhost', 'commit', '--allow-empty', '-m', 'Private current-source repair baseline'], { cwd: candidate.worktree });
            candidate.parent = await governance._git(['rev-parse', 'HEAD'], { cwd: candidate.worktree });
            const dependencies = path.join(governance.root, 'node_modules');
            if (await fs.stat(dependencies).then(() => true, () => false)) {
                if (await governance.candidateRunner.dockerAvailable()) {
                    // A real directory is required as Docker's nested bind
                    // mountpoint; a Windows junction cannot be mounted over.
                    await fs.mkdir(path.join(candidate.worktree, 'node_modules'));
                } else {
                    await fs.symlink(dependencies, path.join(candidate.worktree, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
                }
            }
            const transaction = new SwarmPatchTransaction(candidate.worktree);
            await transaction.applyPatch({ ...patch, files });
            transaction.commit();
            candidate.validation = await governance.candidateRunner.run({ worktree: candidate.worktree, files: preflight.files, contract });
            if (candidate.validation?.passed !== true) throw new Error('Candidate test execution did not pass');
            for (const file of preflight.files) candidate.hashes[file] = digest(await fs.readFile(resolveWithinRoot(candidate.worktree, file)));
            if (preflight.files.every(file => candidate.hashes[file] === preflight.beforeHashes[file])) throw new Error('Candidate contains no change');
            return candidate;
        } catch (error) { await candidate.close(); throw error; }
    }

    constructor(governance, preflight) {
        this.governance = governance;
        this.preflight = preflight;
        this.originals = {};
        this.hashes = {};
        this.baselineHashes = {};
        this.published = false;
    }

    async publish() {
        const current = await this.governance.inspectSnapshotFiles(this.preflight.files);
        if (current.head !== this.preflight.head) throw new Error('Repository HEAD changed during candidate validation');
        for (const [file, hash] of Object.entries(this.baselineHashes)) {
            const bytes = await fs.readFile(resolveWithinRoot(this.governance.root, file)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
            if ((bytes === null ? null : digest(bytes)) !== hash) throw new Error(`Source/test changed during review: ${file}`);
        }
        const replacements = [];
        for (const file of this.preflight.files) {
            const bytes = await fs.readFile(resolveWithinRoot(this.worktree, file));
            if (digest(bytes) !== this.hashes[file] || current.beforeHashes[file] !== this.preflight.beforeHashes[file]) throw new Error('Candidate/source changed after verification');
            replacements.push({ file, bytes });
        }
        this.published = true;
        for (const { file, bytes } of replacements) await fs.writeFile(resolveWithinRoot(this.governance.root, file), bytes);
        return this.publicationSnapshot();
    }

    publicationSnapshot() {
        return this.preflight.files.map(file => ({ path: file, before_sha256: this.preflight.beforeHashes[file], after_sha256: this.hashes[file], before_base64: this.originals[file].toString('base64') }));
    }

    async rollbackPublication() {
        if (!this.published) return;
        // Never overwrite an intervening owner edit, even during error recovery.
        for (const file of this.preflight.files) {
            const actual = digest(await fs.readFile(resolveWithinRoot(this.governance.root, file)));
            if (actual !== this.hashes[file] && actual !== this.preflight.beforeHashes[file]) throw new Error(`Rollback blocked by intervening edit: ${file}`);
        }
        for (const file of this.preflight.files) await fs.writeFile(resolveWithinRoot(this.governance.root, file), this.originals[file]);
        this.published = false;
    }

    async close() {
        if (!this.worktree) return;
        const dependencyPath = path.join(this.worktree, 'node_modules');
        const dependencyStat = await fs.lstat(dependencyPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (dependencyStat?.isSymbolicLink()) await fs.unlink(dependencyPath);
        else if (dependencyStat?.isDirectory()) await fs.rmdir(dependencyPath);
        if (this.added) await this.governance._git(['worktree', 'remove', '--force', this.worktree]);
        else await fs.rm(this.worktree, { recursive: true, force: true });
        this.worktree = null;
    }

    async commitSnapshot() {
        await this.governance._git(['add', '--', ...this.preflight.files], { cwd: this.worktree });
        await this.governance._git(['-c', `core.hooksPath=${path.join(this.worktree, '.no-repair-hooks')}`, '-c', 'user.name=SOMA Repair', '-c', 'user.email=soma-repair@localhost', 'commit', '-m', 'Verified isolated repair candidate'], { cwd: this.worktree });
        return { parent: this.parent, workspaceHead: this.preflight.head,
            commit: await this.governance._git(['rev-parse', 'HEAD'], { cwd: this.worktree }) };
    }
}
