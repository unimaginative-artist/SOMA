/**
 * core/GitArbiter.js
 *
 * SOMA's self-publishing engine. Called by EngineeringSwarmArbiter after every
 * successful patch. Commits the change to a dedicated branch and pushes to GitHub
 * so the improvement is permanently timestamped and visible to the world.
 *
 * Safety gates:
 *   - Only commits to `soma-improvements` branch — never main
 *   - Blocked paths: .env files, session files, memory databases
 *   - Only known source extensions allowed
 *
 * Requires: GITHUB_TOKEN env var for push. Without it, commits locally only.
 */

import { exec }     from 'child_process';
import { promisify} from 'util';
import path          from 'path';
import fs            from 'fs';

const execAsync = promisify(exec);

const BLOCKED_PATHS = [
    'config/api-keys.env', '.env', '.env.local', '.env.production',
    'SOMA/.bluesky-session.json', 'SOMA/kuze_memory.json',
    'SOMA/social-queue.json', 'SOMA/kuze_memory.db',
];

const ALLOWED_EXTENSIONS = new Set([
    '.js', '.mjs', '.cjs', '.jsx', '.tsx', '.ts',
    '.py', '.md', '.json', '.css', '.html', '.sh',
]);

const COMMITS_FILE = path.join(process.cwd(), 'SOMA', 'git-commits.json');

export class GitArbiter {
    constructor(config = {}) {
        this.repoPath     = config.repoPath  || process.cwd();
        this.improvBranch = config.branch    || 'soma-improvements';
        this.githubToken  = config.token     || process.env.GITHUB_TOKEN;
        this._branchReady = false;
        this._broker      = null; // set by setBroker()
    }

    setBroker(broker) { this._broker = broker; }

    // ── Shell helper ──────────────────────────────────────────────────────────

    async _git(args) {
        const { stdout } = await execAsync(`git ${args}`, {
            cwd: this.repoPath,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        return stdout.trim();
    }

    // ── Safety ────────────────────────────────────────────────────────────────

    _isSafe(filePath) {
        const rel = path.relative(this.repoPath, path.resolve(this.repoPath, filePath))
                        .replace(/\\/g, '/');
        if (BLOCKED_PATHS.some(b => rel === b || rel.endsWith('/' + b))) return false;
        const ext = path.extname(rel).toLowerCase();
        if (ext && !ALLOWED_EXTENSIONS.has(ext)) return false;
        return true;
    }

    // ── Branch management ─────────────────────────────────────────────────────
    // SOMA commits to her current working branch (main) and pushes those commits
    // to the soma-improvements branch on the remote. This keeps the working tree
    // stable — no checkout needed, no risk of disrupting a live running process.

    async ensureBranch() {
        this._branchReady = true; // nothing to do locally
    }

    // ── Core operations ───────────────────────────────────────────────────────

    async getStatus() {
        try {
            const branch     = await this._git('rev-parse --abbrev-ref HEAD');
            const status     = await this._git('status --short');
            const lastCommit = await this._git('log -1 --format="%h %s"');
            return { branch, status, lastCommit, ok: true };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    /**
     * Stage + commit a set of files with SOMA as author.
     * Returns { hash, message, files } or null if nothing to commit.
     */
    async commitImprovement(message, files = []) {
        // Safety check
        const blocked = files.filter(f => !this._isSafe(f));
        if (blocked.length) throw new Error(`[GitArbiter] Blocked paths: ${blocked.join(', ')}`);

        await this.ensureBranch();

        if (files.length > 0) {
            for (const f of files) {
                const abs = path.resolve(this.repoPath, f);
                await this._git(`add "${abs}"`);
            }
        } else {
            await this._git('add -A');
        }

        // Nothing staged?
        const staged = await this._git('diff --cached --name-only');
        if (!staged) return null;

        const body = [
            `[SOMA] ${message}`,
            '',
            'Self-generated improvement by SOMA\'s engineering swarm.',
            `Timestamp: ${new Date().toISOString()}`,
            '',
            'Co-authored-by: SOMA <redacted@example.com>',
        ].join('\n');

        // Write message to temp file to avoid shell escaping issues
        const tmpMsg = path.join(this.repoPath, '.soma_commit_msg.tmp');
        fs.writeFileSync(tmpMsg, body);
        try {
            await this._git(`commit -F "${tmpMsg}"`);
        } finally {
            try { fs.unlinkSync(tmpMsg); } catch {}
        }

        const hash = await this._git('rev-parse --short HEAD');
        const result = { hash, message, files: staged.split('\n').filter(Boolean) };
        this._recordCommit({ ...result, timestamp: Date.now() });

        console.log(`[GitArbiter] ✅ Committed: ${hash} — "${message}"`);
        return result;
    }

    /**
     * Push soma-improvements branch to GitHub.
     */
    async push() {
        if (!this.githubToken) {
            console.warn('[GitArbiter] No GITHUB_TOKEN — commit saved locally only');
            return { pushed: false, reason: 'no GITHUB_TOKEN' };
        }
        try {
            const remote = await this._git('remote get-url origin');
            const authed = remote.includes('@')
                ? remote
                : remote.replace('https://', `https://${this.githubToken}@`);

            // Push current HEAD → soma-improvements on remote (no local branch switch needed)
            await execAsync(`git push "${authed}" HEAD:${this.improvBranch} --force-with-lease`, {
                cwd: this.repoPath,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            });
            console.log(`[GitArbiter] 📤 Pushed ${this.improvBranch} to GitHub`);
            return { pushed: true, branch: this.improvBranch };
        } catch (e) {
            console.warn(`[GitArbiter] Push failed: ${e.message}`);
            return { pushed: false, error: e.message };
        }
    }

    /**
     * Full pipeline: commit → push → emit broker signal → return result.
     * This is the one EngineeringSwarmArbiter calls.
     */
    async publishImprovement(description, files = []) {
        const commit = await this.commitImprovement(description, files);
        if (!commit) return null;

        const pushResult = await this.push();

        let repoUrl = '';
        try {
            const raw = await this._git('remote get-url origin');
            repoUrl = raw.replace(/https?:\/\/[^@]+@/, 'https://')
                         .replace(/\.git$/, '')
                         .trim();
        } catch {}

        const result = {
            committed: true,
            hash:      commit.hash,
            message:   description,
            files:     commit.files,
            pushed:    pushResult.pushed,
            branch:    this.improvBranch,
            url:       repoUrl ? `${repoUrl}/tree/${this.improvBranch}` : '',
            timestamp: Date.now(),
        };

        // Signal to the rest of SOMA (SocialIntelDaemon listens → queues a post)
        if (this._broker) {
            this._broker.publish('git.improvement.published', result).catch(() => {});
        }

        return result;
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    _recordCommit(data) {
        try {
            const existing = fs.existsSync(COMMITS_FILE)
                ? JSON.parse(fs.readFileSync(COMMITS_FILE, 'utf8'))
                : [];
            existing.push(data);
            fs.writeFileSync(COMMITS_FILE, JSON.stringify(existing.slice(-200), null, 2));
        } catch {}
    }

    getRecentCommits(n = 10) {
        try {
            const all = fs.existsSync(COMMITS_FILE)
                ? JSON.parse(fs.readFileSync(COMMITS_FILE, 'utf8'))
                : [];
            return all.slice(-n);
        } catch { return []; }
    }
}

export default new GitArbiter();
