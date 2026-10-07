import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { resolveWithinRoot } from './PathSafety.js';

const execFileAsync = promisify(execFile);
function candidateEnv(memory) {
    // Candidate checks never inherit provider keys or operator credentials.
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
        .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.NODE_OPTIONS = `--max-old-space-size=${memory}`;
    env.SOMA_ISOLATED_TEST = 'true';
    // node:test sets this in its workers. Inheriting it can make a nested test
    // process return success without actually running the requested tests.
    delete env.NODE_TEST_CONTEXT;
    return env;
}

export class IsolatedCandidateRunner {
    constructor({ root = process.cwd() } = {}) {
        this.root = root;
        this._docker = null;
    }

    dockerExecutable() {
        const candidates = [
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'),
        ];
        return candidates.find(candidate => existsSync(candidate)) || 'docker';
    }

    async dockerAvailable() {
        try {
            await execFileAsync(this.dockerExecutable(), ['version', '--format', '{{.Server.Version}}'], { timeout: 5000, windowsHide: true });
            this._docker = true;
        } catch { this._docker = false; }
        return this._docker;
    }

    async run({ worktree, files, contract }) {
        if (contract?.requiresContainer && !contract?.testFiles?.length) {
            throw new Error('High-risk proposal requires explicit integration testFiles');
        }
        // Fail before even touching candidate source when isolation is required.
        if (contract?.requiresContainer && !await this.dockerAvailable()) {
            throw new Error('Docker is unavailable; autonomous candidate validation is blocked');
        }
        const checks = [];
        for (const relative of files) {
            const target = resolveWithinRoot(worktree, relative, 'Isolated candidate path');
            if (/\.(?:js|cjs|mjs)$/i.test(relative)) {
                await execFileAsync(process.execPath, ['--check', target], {
                    cwd: worktree, timeout: 20_000, windowsHide: true,
                    env: candidateEnv(256),
                });
                checks.push({ file: relative, check: 'node_syntax', passed: true, isolation: 'process' });
            }
        }

        const tests = contract?.testFiles || [];
        if (!tests.length) {
            if (contract?.requiresContainer) throw new Error('High-risk proposal requires explicit integration testFiles');
            return { passed: true, mode: 'process', resourceLimited: true, networkIsolated: false, checks };
        }

        if (await this.dockerAvailable()) {
            const mount = `${worktree.replace(/\\/g, '/')}:/workspace:ro`;
            const dependencySource = path.join(this.root, 'node_modules');
            const dependencyMount = `${dependencySource.replace(/\\/g, '/')}:/workspace/node_modules:ro`;
            const hasDependencies = existsSync(dependencySource);
            if (hasDependencies) {
                const mountPoint = resolveWithinRoot(worktree, 'node_modules', 'Candidate dependency mountpoint');
                const stat = await fsp.lstat(mountPoint).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
                if (stat?.isSymbolicLink()) throw new Error('Candidate dependency mountpoint cannot be a symlink');
                if (!stat) await fsp.mkdir(mountPoint);
            }
            const args = [
                'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
                '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--user', 'node',
                '-e', 'HOME=/tmp', '-e', 'SOMA_ISOLATED_TEST=true',
                '-v', mount, ...(hasDependencies ? ['-v', dependencyMount] : []),
                '-w', '/workspace', 'node:22-bookworm-slim', 'node', '--test', ...tests,
            ];
            const executable = this.dockerExecutable();
            // Docker Desktop may be installed after SOMA started. Its credential
            // helper lives beside docker.exe and is absent from the old PATH.
            const dockerPath = path.dirname(executable);
            const result = await execFileAsync(executable, args, {
                timeout: 180_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
                env: { ...process.env, PATH: `${dockerPath}${path.delimiter}${process.env.PATH || ''}` },
            });
            checks.push({ check: 'integration_tests', tests, passed: true, isolation: 'container', output: String(result.stdout || '').slice(-2000) });
            return { passed: true, mode: 'container', resourceLimited: true, networkIsolated: true, checks };
        }

        if (contract?.requiresContainer) throw new Error('Docker is unavailable; high-risk candidate integration execution deferred');
        for (const testFile of tests) resolveWithinRoot(worktree, testFile, 'Isolated test path');
        const result = await execFileAsync(process.execPath, ['--test', ...tests], {
            cwd: worktree,
            timeout: 120_000,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
            env: candidateEnv(512),
        });
        checks.push({ check: 'integration_tests', tests, passed: true, isolation: 'process', output: String(result.stdout || '').slice(-2000) });
        return { passed: true, mode: 'process', resourceLimited: true, networkIsolated: false, checks };
    }
}

export default IsolatedCandidateRunner;
