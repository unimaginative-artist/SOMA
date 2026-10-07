import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
import { redactText } from './RedactionUtils.js';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 12_000;
const DEFAULT_TIMEOUT_MS = 120_000;

function normalizeForComparison(value) {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(root, candidate, allowRoot = true) {
    const rootValue = normalizeForComparison(root);
    const candidateValue = normalizeForComparison(candidate);
    if (allowRoot && candidateValue === rootValue) return true;
    const relative = path.relative(rootValue, candidateValue);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function exists(filePath) {
    try {
        await fs.lstat(filePath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
}

async function sha256(filePath) {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
}

async function atomicWriteJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, filePath);
}

export function defaultComputerWorkspaceRoots(home = os.homedir()) {
    return [
        path.join(home, 'Desktop', 'Soma Projects'),
        path.join(home, 'Documents', 'Soma'),
    ];
}

export class ComputerWorkspaceService {
    constructor(options = {}) {
        this.projectRoot = path.resolve(options.projectRoot || process.cwd());
        this.stateRoot = path.resolve(options.stateRoot || path.join(this.projectRoot, '.soma', 'computer-workspaces'));
        this.configPath = path.resolve(options.configPath || path.join(this.projectRoot, '.soma', 'computer-workspaces.json'));
        this.configuredRoots = Array.isArray(options.roots) ? options.roots.map(root => path.resolve(root)) : null;
        this.home = options.home || os.homedir();
        this.transactionsRoot = path.join(this.stateRoot, 'transactions');
        this.trashRoot = path.join(this.stateRoot, 'trash');
        this._roots = [];
        this._readyPromise = null;
        this._pathClaims = new Map();
    }

    async initialize() {
        if (this._readyPromise) return this._readyPromise;
        this._readyPromise = this._initialize();
        return this._readyPromise;
    }

    async _initialize() {
        await fs.mkdir(this.transactionsRoot, { recursive: true });
        await fs.mkdir(this.trashRoot, { recursive: true });

        let configured = this.configuredRoots;
        if (!configured) {
            try {
                const saved = JSON.parse(await fs.readFile(this.configPath, 'utf8'));
                configured = Array.isArray(saved?.roots) ? saved.roots : null;
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
        }
        configured = (configured || defaultComputerWorkspaceRoots(this.home))
            .map(root => path.resolve(String(root)))
            .filter((root, index, all) => all.findIndex(item => normalizeForComparison(item) === normalizeForComparison(root)) === index);
        if (!configured.length) throw new Error('At least one computer workspace root is required');

        for (const root of configured) await fs.mkdir(root, { recursive: true });
        this._roots = configured;
        if (!this.configuredRoots) {
            await atomicWriteJson(this.configPath, {
                version: 1,
                purpose: 'Owner-controlled writable roots for Soma. Paths outside these roots remain read-only.',
                roots: configured,
                updatedAt: new Date().toISOString(),
            });
        }
        return this.listRoots();
    }

    async listRoots() {
        if (!this._readyPromise) await this.initialize();
        return { roots: this._roots.map((root, index) => ({ id: `workspace-${index + 1}`, path: root })) };
    }

    async history({ limit = 20 } = {}) {
        await this.initialize();
        const cap = Math.max(1, Math.min(100, Number(limit) || 20));
        const entries = await fs.readdir(this.transactionsRoot, { withFileTypes: true });
        const records = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            try {
                const record = JSON.parse(await fs.readFile(path.join(this.transactionsRoot, entry.name), 'utf8'));
                records.push({
                    transactionId: record.id,
                    operation: record.operation,
                    status: record.status,
                    createdAt: record.createdAt,
                    path: record.target || record.destination || record.source || null,
                });
            } catch { /* Ignore malformed/incomplete ledger files; mutation paths remain fail-closed. */ }
        }
        records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return { transactions: records.slice(0, cap), count: records.length };
    }

    async _existingAncestor(target) {
        let cursor = path.resolve(target);
        while (!(await exists(cursor))) {
            const parent = path.dirname(cursor);
            if (parent === cursor) break;
            cursor = parent;
        }
        return cursor;
    }

    async assertAllowed(target, { allowRoot = false } = {}) {
        await this.initialize();
        if (!target || !path.isAbsolute(String(target))) throw new Error('Workspace path must be absolute');
        const resolved = path.resolve(String(target));
        const root = this._roots.find(candidate => isPathInside(candidate, resolved, allowRoot));
        if (!root) throw new Error(`Path is outside Soma's owner-controlled workspaces: ${resolved}`);

        // Junctions and symlinks must not turn an allowed lexical path into an escape.
        const [realRoot, existingAncestor] = await Promise.all([fs.realpath(root), this._existingAncestor(resolved)]);
        const realAncestor = await fs.realpath(existingAncestor);
        if (!isPathInside(realRoot, realAncestor, true)) {
            throw new Error(`Workspace path escapes through a link or junction: ${resolved}`);
        }
        return { path: resolved, root, relative: path.relative(root, resolved) };
    }

    async _transaction(operation, details) {
        const id = `cws-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const record = { id, operation, status: 'prepared', createdAt: new Date().toISOString(), ...details };
        record.recordPath = path.join(this.transactionsRoot, `${id}.json`);
        await atomicWriteJson(record.recordPath, record);
        return record;
    }

    async _complete(record, additions = {}) {
        Object.assign(record, additions, { status: 'complete', completedAt: new Date().toISOString() });
        await atomicWriteJson(record.recordPath, record);
        return { success: true, transactionId: record.id, operation: record.operation, ...additions };
    }

    _pruneExpiredClaims(now = Date.now()) {
        for (const [target, claim] of this._pathClaims.entries()) {
            if (Number(claim.expiresAt || 0) <= now) this._pathClaims.delete(target);
        }
    }

    async claimPaths({ ownerId, paths, leaseMs = 120_000 }) {
        const owner = String(ownerId || '').trim();
        if (!owner) throw new Error('Path claim ownerId is required');
        const requested = Array.isArray(paths) ? paths : [paths];
        if (!requested.length || requested.some(value => !value)) throw new Error('At least one path is required');
        const resolved = [];
        for (const value of requested) resolved.push((await this.assertAllowed(value)).path);
        const normalized = [...new Set(resolved.map(normalizeForComparison))];
        const now = Date.now();
        this._pruneExpiredClaims(now);
        for (const target of normalized) {
            const existing = this._pathClaims.get(target);
            if (existing && existing.ownerId !== owner) {
                throw new Error(`WRITE_PATH_CLAIMED: ${target} is currently owned by ${existing.ownerId}`);
            }
        }
        const boundedLease = Math.max(1_000, Math.min(10 * 60_000, Number(leaseMs) || 120_000));
        for (const target of normalized) {
            this._pathClaims.set(target, { ownerId: owner, claimedAt: now, expiresAt: now + boundedLease });
        }
        return { success: true, ownerId: owner, paths: resolved, expiresAt: now + boundedLease };
    }

    releasePaths({ ownerId, paths = null }) {
        const owner = String(ownerId || '').trim();
        if (!owner) throw new Error('Path claim ownerId is required');
        const requested = paths
            ? new Set((Array.isArray(paths) ? paths : [paths]).map(normalizeForComparison))
            : null;
        let released = 0;
        for (const [target, claim] of this._pathClaims.entries()) {
            if (claim.ownerId !== owner || (requested && !requested.has(target))) continue;
            this._pathClaims.delete(target);
            released++;
        }
        return { success: true, ownerId: owner, released };
    }

    async mkdir({ directory }) {
        const target = await this.assertAllowed(directory);
        const existedBefore = await exists(target.path);
        const transaction = await this._transaction('mkdir', { target: target.path, existedBefore });
        await fs.mkdir(target.path, { recursive: true });
        return this._complete(transaction, { path: target.path, changed: !existedBefore });
    }

    async writeFile({ filePath, content, encoding = 'utf8', expectedHash = null, claimOwner = null }) {
        const target = await this.assertAllowed(filePath);
        if (typeof content !== 'string') throw new Error('Workspace file content must be a string');
        const ownerId = String(claimOwner || `write-${randomUUID()}`);
        await this.claimPaths({ ownerId, paths: [target.path] });
        try {
        const safeContent = redactText(content);
        const secretsRedacted = safeContent !== content;
        const existedBefore = await exists(target.path);
        if (existedBefore && (await fs.lstat(target.path)).isDirectory()) throw new Error('Cannot overwrite a directory');
        const currentHash = existedBefore ? await sha256(target.path) : null;
        if (existedBefore && !expectedHash) {
            throw new Error('CONTENT_REVISION_REQUIRED: read the existing file first and retry with its SHA-256 contentHash');
        }
        if (existedBefore && String(expectedHash).toLowerCase() !== currentHash) {
            throw new Error(`STALE_CONTENT_REVISION: expected ${expectedHash} but current content is ${currentHash}`);
        }

        const transaction = await this._transaction('write', { target: target.path, existedBefore, backupPath: null, beforeHash: null });
        if (existedBefore) {
            const backupDirectory = path.join(this.transactionsRoot, transaction.id);
            await fs.mkdir(backupDirectory, { recursive: true });
            transaction.backupPath = path.join(backupDirectory, 'before.bin');
            transaction.beforeHash = currentHash;
            await fs.copyFile(target.path, transaction.backupPath);
            await atomicWriteJson(transaction.recordPath, transaction);
        }

        await fs.mkdir(path.dirname(target.path), { recursive: true });
        const temporary = `${target.path}.${transaction.id}.tmp`;
        await fs.writeFile(temporary, safeContent, encoding);
        await fs.rename(temporary, target.path);
        const afterHash = await sha256(target.path);
        return this._complete(transaction, {
            path: target.path,
            bytes: Buffer.byteLength(safeContent, encoding),
            afterHash,
            secretsRedacted,
            warning: secretsRedacted ? 'Credential-like values were redacted before persistence.' : null
        });
        } finally {
            this.releasePaths({ ownerId, paths: [target.path] });
        }
    }

    async move({ source, destination }) {
        const from = await this.assertAllowed(source);
        const to = await this.assertAllowed(destination);
        if (!(await exists(from.path))) throw new Error(`Move source does not exist: ${from.path}`);
        if (await exists(to.path)) throw new Error(`Move destination already exists: ${to.path}`);
        const transaction = await this._transaction('move', { source: from.path, destination: to.path });
        await fs.mkdir(path.dirname(to.path), { recursive: true });
        await fs.rename(from.path, to.path);
        return this._complete(transaction, { source: from.path, destination: to.path });
    }

    async trash({ target: targetPath }) {
        const target = await this.assertAllowed(targetPath);
        if (!(await exists(target.path))) throw new Error(`Trash target does not exist: ${target.path}`);
        const transaction = await this._transaction('trash', { target: target.path, trashPath: null });
        const trashDirectory = path.join(this.trashRoot, transaction.id);
        await fs.mkdir(trashDirectory, { recursive: true });
        transaction.trashPath = path.join(trashDirectory, path.basename(target.path));
        await atomicWriteJson(transaction.recordPath, transaction);
        await fs.rename(target.path, transaction.trashPath);
        return this._complete(transaction, { path: target.path, trashPath: transaction.trashPath });
    }

    async exec({ executable, args = [], cwd, timeoutMs = DEFAULT_TIMEOUT_MS }) {
        const workingDirectory = await this.assertAllowed(cwd, { allowRoot: true });
        const command = path.basename(String(executable || '')).toLowerCase().replace(/\.(exe|cmd|bat)$/i, '');
        const allowed = new Set(['node', 'npm', 'npx', 'git', 'python', 'python3', 'py']);
        if (!allowed.has(command)) throw new Error(`Executable is not allowed in computer workspaces: ${executable}`);
        if (!Array.isArray(args) || args.length > 80 || args.some(value => typeof value !== 'string' || value.length > 2_000)) {
            throw new Error('Command args must be an array of at most 80 bounded strings');
        }
        if (['node', 'python', 'python3', 'py'].includes(command) && args.some(value => ['-e', '--eval', '-c'].includes(value.toLowerCase()))) {
            throw new Error('Inline code execution is blocked; write a script inside the workspace and execute that file');
        }
        if (args.some(value => ['-c', '--global', '-g', '--prefix'].includes(value.toLowerCase()))) {
            throw new Error('Command option can escape the selected workspace and is blocked');
        }
        for (const value of args) {
            if (path.isAbsolute(value)) await this.assertAllowed(value, { allowRoot: true });
        }
        if (['node', 'python', 'python3', 'py'].includes(command)) {
            const scriptArg = args.find(value => !value.startsWith('-') && !/^\d+$/.test(value));
            if (scriptArg) await this.assertAllowed(path.resolve(workingDirectory.path, scriptArg));
        }
        const boundedTimeout = Math.max(1_000, Math.min(600_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
        const startedAt = Date.now();
        try {
            const result = await execFileAsync(String(executable), args, {
                cwd: workingDirectory.path,
                timeout: boundedTimeout,
                windowsHide: true,
                maxBuffer: 4 * 1024 * 1024,
            });
            return {
                success: true,
                executable: command,
                args,
                cwd: workingDirectory.path,
                exitCode: 0,
                durationMs: Date.now() - startedAt,
                stdout: String(result.stdout || '').slice(-MAX_OUTPUT),
                stderr: String(result.stderr || '').slice(-MAX_OUTPUT),
                reversible: false,
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                executable: command,
                args,
                cwd: workingDirectory.path,
                exitCode: Number.isInteger(error.code) ? error.code : null,
                durationMs: Date.now() - startedAt,
                stdout: String(error.stdout || '').slice(-MAX_OUTPUT),
                stderr: String(error.stderr || '').slice(-MAX_OUTPUT),
                reversible: false,
            };
        }
    }

    async rollback({ transactionId }) {
        if (!/^cws-[a-zA-Z0-9-]+$/.test(String(transactionId || ''))) throw new Error('Invalid transaction id');
        const recordPath = path.join(this.transactionsRoot, `${transactionId}.json`);
        const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
        if (record.status === 'rolled_back') return { success: true, transactionId, alreadyRolledBack: true };
        if (record.status !== 'complete') throw new Error(`Transaction is not rollback-ready: ${record.status}`);

        if (record.operation === 'write') {
            await this.assertAllowed(record.target);
            if (record.afterHash && await exists(record.target) && await sha256(record.target) !== record.afterHash) {
                throw new Error('Rollback refused because the file changed after this transaction');
            }
            if (record.existedBefore) {
                if (!record.backupPath || !(await exists(record.backupPath))) throw new Error('Rollback backup is missing');
                await fs.copyFile(record.backupPath, record.target);
            } else if (await exists(record.target)) {
                await fs.rm(record.target, { force: true });
            }
        } else if (record.operation === 'mkdir') {
            await this.assertAllowed(record.target);
            if (!record.existedBefore && await exists(record.target)) await fs.rmdir(record.target);
        } else if (record.operation === 'move') {
            await this.assertAllowed(record.source);
            await this.assertAllowed(record.destination);
            if (await exists(record.source)) throw new Error('Rollback source is occupied');
            if (!(await exists(record.destination))) throw new Error('Rollback destination is missing');
            await fs.mkdir(path.dirname(record.source), { recursive: true });
            await fs.rename(record.destination, record.source);
        } else if (record.operation === 'trash') {
            await this.assertAllowed(record.target);
            if (await exists(record.target)) throw new Error('Rollback target is occupied');
            if (!(await exists(record.trashPath))) throw new Error('Trashed item is missing');
            await fs.mkdir(path.dirname(record.target), { recursive: true });
            await fs.rename(record.trashPath, record.target);
        } else {
            throw new Error(`Unsupported rollback operation: ${record.operation}`);
        }

        record.status = 'rolled_back';
        record.rolledBackAt = new Date().toISOString();
        await atomicWriteJson(recordPath, record);
        return { success: true, transactionId, operation: record.operation, rolledBack: true };
    }
}

export default ComputerWorkspaceService;
