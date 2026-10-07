import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveWithinRoot } from './PathSafety.js';
import { IsolatedCandidateRunner } from './IsolatedCandidateRunner.js';
import { evaluateCapabilityContract } from './SelfModificationCapabilityContract.js';

const execFileAsync = promisify(execFile);
const GENESIS = '0'.repeat(64);
const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');

async function sha256File(file) {
    const content = await fs.readFile(file);
    return crypto.createHash('sha256').update(content).digest('hex');
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((out, key) => {
        out[key] = canonical(value[key]);
        return out;
    }, {});
}

export class SelfModificationGovernance {
    constructor({ root = process.cwd(), system = null, probationMs } = {}) {
        this.root = root;
        this.system = system;
        this.probationMs = Math.max(60_000, Number(probationMs || process.env.SOMA_SELFMOD_PROBATION_MS || 15 * 60_000));
        this.stateDir = path.join(root, 'data', 'self-modification');
        this.statePath = path.join(this.stateDir, 'promotions.json');
        this.ledgerPath = path.join(this.stateDir, 'governance-ledger.jsonl');
        this.records = [];
        this._timer = null;
        this.ready = false;
        this._ledgerQueue = Promise.resolve();
        this.candidateRunner = new IsolatedCandidateRunner({ root });
        this.anchorPath = process.env.SOMA_GOVERNANCE_ANCHOR_PATH || null;
        this.anchorUrl = process.env.SOMA_GOVERNANCE_ANCHOR_URL || null;
        this.lastAnchor = null;
    }

    async initialize(system = this.system) {
        this.system = system || this.system;
        await fs.mkdir(this.stateDir, { recursive: true });
        try {
            const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            this.records = Array.isArray(parsed) ? parsed : [];
        } catch { this.records = []; }
        const chain = await this.verifyLedger();
        if (!chain.valid) throw new Error(`Self-modification governance ledger failed verification: ${chain.reason}`);
        this.ready = true;
        this._timer = setInterval(() => this.reconcileProbations().catch(error => {
            console.warn(`[SelfModificationGovernance] probation reconciliation failed: ${error.message}`);
        }), Math.min(this.probationMs, 60_000));
        this._timer.unref?.();
        return this;
    }

    async _git(args, options = {}) {
        const result = await execFileAsync('git', args, {
            cwd: options.cwd || this.root,
            timeout: options.timeout || 120_000,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
        });
        return String(result.stdout || '').trim();
    }

    async preflight({ proposalId, files, isolated = false }) {
        const active = this.records.find(record => record.status === 'probation');
        if (active) throw new Error(`Self-modification ${active.id} is still in probation; evaluate it before another promotion`);
        const inspected = isolated ? await this.inspectSnapshotFiles(files) : await this.inspectCleanFiles(files);
        const baseline = await this.system?.benchmark?.snapshot?.().catch(() => null) || null;
        await this.appendLedger('preflight_passed', { proposalId, ...inspected });
        return { proposalId, ...inspected, baseline, checkedAt: new Date().toISOString() };
    }

    async inspectCleanFiles(files) {
        const requested = [...new Set((files || []).map(normalize).filter(Boolean))];
        if (!requested.length) throw new Error('Promotion requires at least one explicit file');
        const normalized = requested.map(file => normalize(path.relative(
            this.root,
            resolveWithinRoot(this.root, file, 'Promotion path')
        )));
        const head = await this._git(['rev-parse', 'HEAD']);
        const dirty = await this._git(['status', '--porcelain=v1', '--', ...normalized]);
        if (dirty) {
            throw new Error(`Target file already had uncommitted work before proposal; refusing to absorb it into an autonomous commit: ${dirty.split(/\r?\n/).join(', ')}`);
        }
        const beforeHashes = {};
        for (const file of normalized) beforeHashes[file] = await sha256File(resolveWithinRoot(this.root, file, 'Promotion hash path'));
        return { files: normalized, head, beforeHashes };
    }

    async inspectSnapshotFiles(files) {
        const normalized = [...new Set(files.map(file => normalize(path.relative(this.root, resolveWithinRoot(this.root, file)))))];
        if (!normalized.length) throw new Error('Explicit snapshot files required');
        const head = await this._git(['rev-parse', 'HEAD']);
        const beforeHashes = {};
        for (const file of normalized) beforeHashes[file] = await sha256File(resolveWithinRoot(this.root, file));
        return { files: normalized, head, beforeHashes, isolated: true };
    }

    async cancelPreparedDeployment(record) {
        record.status = 'rejected';
        record.deployment.status = 'cancelled';
        const receiptPath = path.join(this.root, path.dirname(record.deployment.manifest), 'receipt.json');
        const temporary = `${receiptPath}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(temporary, JSON.stringify({ schema_version: 2, promotion_id: record.id, candidate_ref: record.commit, status: 'cancelled' }));
        await fs.rename(temporary, receiptPath);
        await this._persist();
    }

    async promoteSnapshot({ proposalId, goalId, asiCycleId, files, baseline, reviewers, sandbox, capabilityContract, publication, version, prepared = false }) {
        if (!/^[a-zA-Z0-9_-]+$/.test(proposalId) || sandbox?.passed !== true) throw new Error('Verified snapshot identity required');
        const record = { id: proposalId, kind: 'code', goalId, asiCycleId, files,
            parentCommit: version.parent, commit: version.commit, workspaceHead: version.workspaceHead,
            status: 'probation', promotedAt: new Date().toISOString(),
            probationEndsAt: new Date(Date.now() + this.probationMs).toISOString(),
            baseline, reviewers, sandbox, capabilityContract, observations: [],
            beforeHashes: Object.fromEntries(publication.map(file => [file.path, file.before_sha256])),
            afterHashes: Object.fromEntries(publication.map(file => [file.path, file.after_sha256])),
        };
        const deployDir = path.join(this.stateDir, 'deployments', proposalId);
        await fs.mkdir(deployDir, { recursive: true });
        const manifest = { schema_version: 2, promotion_id: proposalId, candidate_ref: record.commit,
            rollback_ref: record.parentCommit, requested_by_pid: process.pid, created_at: record.promotedAt,
            files: publication, test_receipt: sandbox };
        await fs.writeFile(path.join(deployDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        record.deployment = { status: prepared ? 'prepared' : 'pending', manifest: normalize(path.relative(this.root, path.join(deployDir, 'manifest.json'))), requestedByPid: process.pid };
        if (prepared) await fs.writeFile(path.join(deployDir, 'receipt.json'), JSON.stringify({
            schema_version: 2, promotion_id: proposalId, candidate_ref: record.commit, status: 'prepared', requested_by_pid: process.pid,
        }));
        // Retain candidate + parent locally without changing HEAD or the owner's
        // index. Removing the temporary checkout cannot garbage-collect recovery.
        await this._git(['update-ref', `refs/soma-repairs/${proposalId}`, record.commit]);
        await this.appendLedger('snapshot_promoted', { id: proposalId, goalId, asiCycleId, commit: record.commit, parentCommit: record.parentCommit, files });
        this.records.push(record);
        try { await this._persist(); }
        catch (error) { this.records = this.records.filter(item => item !== record); throw error; }
        await this.system?.improvementScorecard?.registerPromotion?.(record).catch(() => {});
        return record;
    }

    reviewerIndependence(approval, nemesis) {
        const maxFingerprint = approval?.reviewerFingerprint || approval?.provider || approval?.authority || 'max';
        const nemesisFingerprint = nemesis?.reviewerFingerprint || nemesis?.provider || nemesis?.reviewer || 'nemesis';
        const known = Boolean(maxFingerprint && nemesisFingerprint);
        const distinct = String(maxFingerprint).toLowerCase() !== String(nemesisFingerprint).toLowerCase();
        return {
            passed: distinct,
            known,
            maxFingerprint,
            nemesisFingerprint,
            mode: known ? (distinct ? 'independent' : 'correlated') : 'unknown',
        };
    }

    async validateInWorktree({ proposalId, files, contract = null }) {
        const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-selfmod-'));
        let added = false;
        try {
            await this._git(['worktree', 'add', '--detach', '--force', worktree, 'HEAD'], { timeout: 120_000 });
            added = true;
            for (const relative of files.map(normalize)) {
                const source = resolveWithinRoot(this.root, relative, 'Candidate source');
                const target = resolveWithinRoot(worktree, relative, 'Candidate worktree path');
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(source, target);
            }
            for (const testFile of contract?.testFiles || []) {
                const source = resolveWithinRoot(this.root, testFile, 'Integration test source');
                const target = resolveWithinRoot(worktree, testFile, 'Integration test worktree path');
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(source, target);
            }
            const execution = await this.candidateRunner.run({ worktree, files: files.map(normalize), contract });
            const receipt = { passed: true, isolated: true, proposalId, ...execution, checkedAt: new Date().toISOString() };
            await this.appendLedger('isolated_validation_passed', receipt);
            return receipt;
        } finally {
            if (added) await this._git(['worktree', 'remove', '--force', worktree], { timeout: 120_000 }).catch(() => {});
            await fs.rm(worktree, { recursive: true, force: true }).catch(() => {});
            await this._git(['worktree', 'prune']).catch(() => {});
        }
    }

    async promote({ proposalId, goalId = null, asiCycleId = null, files, baseline = null, beforeHashes = null, reviewers = null, sandbox = null, capabilityContract = null, publication = null }) {
        const normalized = [...new Set(files.map(normalize))];
        let committedHash = null;
        try {
            await this._git(['add', '--', ...normalized]);
            const staged = (await this._git(['diff', '--cached', '--name-only', '--', ...normalized]))
                .split(/\r?\n/).map(normalize).filter(Boolean);
            const unexpected = staged.filter(file => !normalized.includes(file));
            if (!staged.length || unexpected.length) {
                throw new Error(!staged.length ? 'Candidate produced no staged Git change' : `Unexpected staged files: ${unexpected.join(', ')}`);
            }
            const parentCommit = await this._git(['rev-parse', 'HEAD']);
            await this._git(['commit', '-m', `soma(selfmod): ${proposalId}`, '--', ...normalized], { timeout: 120_000 });
            const commit = await this._git(['rev-parse', 'HEAD']);
            committedHash = commit;
            const afterHashes = {};
            for (const file of normalized) afterHashes[file] = await sha256File(resolveWithinRoot(this.root, file, 'Promoted hash path'));
            const record = {
                id: proposalId,
                goalId,
                asiCycleId,
                kind: 'code',
                files: normalized,
                parentCommit,
                commit,
                status: 'probation',
                promotedAt: new Date().toISOString(),
                probationEndsAt: new Date(Date.now() + this.probationMs).toISOString(),
                baseline,
                beforeHashes,
                afterHashes,
                reviewers,
                sandbox,
                capabilityContract,
                observations: [],
            };
            this.records.push(record);
            if (publication) {
                if (!/^[a-zA-Z0-9_-]+$/.test(proposalId)) throw new Error('Invalid deployment ID');
                const manifest = {
                    schema_version: 2, promotion_id: proposalId, candidate_ref: commit,
                    rollback_ref: parentCommit, files: publication, requested_by_pid: process.pid,
                    created_at: new Date().toISOString(), test_receipt: sandbox,
                };
                const deployDir = path.join(this.stateDir, 'deployments', proposalId);
                await fs.mkdir(deployDir, { recursive: true });
                await fs.writeFile(path.join(deployDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
                record.deployment = { status: 'pending', manifest: path.relative(this.root, path.join(deployDir, 'manifest.json')).replace(/\\/g, '/'), requestedByPid: process.pid };
            }
            await this._persist();
            await this.appendLedger('promotion_committed', { id: proposalId, goalId, asiCycleId, files: normalized, parentCommit, commit, beforeHashes, afterHashes, reviewers, sandbox, capabilityContract, probationEndsAt: record.probationEndsAt });
            await this.anchorLedgerTip('promotion_committed').catch(() => {});
            await this.system?.improvementScorecard?.registerPromotion?.(record).catch(() => {});
            return record;
        } catch (error) {
            await this._git(['reset', '--', ...normalized]).catch(() => {});
            if (committedHash) {
                await this._git(['revert', '--no-edit', committedHash], { timeout: 120_000 }).catch(() => {});
                this.records = this.records.filter(record => record.id !== proposalId);
                await this._persist().catch(() => {});
            }
            throw error;
        }
    }

    async reconcileProbations({ force = false } = {}) {
        if (!force && !this._probationDependenciesReady()) return [];
        const pending = this.records.filter(record => record.status === 'probation');
        const results = [];
        for (const record of pending) {
            if (record.deployment && record.deployment.status !== 'succeeded') continue;
            await this.observeProbation(record.id).catch(() => {});
            if (!force && Date.parse(record.probationEndsAt) > Date.now()) continue;
            results.push(await this.evaluateProbation(record.id));
        }
        return results;
    }

    async evaluateProbation(id, { forceRollback = false, reason = null } = {}) {
        const record = this.records.find(item => item.id === id);
        if (!record) throw new Error(`Unknown self-modification promotion: ${id}`);
        if (record.status !== 'probation') return record;
        if (!forceRollback && record.deployment && record.deployment.status !== 'succeeded') {
            return { ...record, evaluationDeferred: true, evaluationReason: 'tested_version_not_deployed' };
        }
        if (!forceRollback && !this._probationDependenciesReady()) {
            return { ...record, evaluationDeferred: true, evaluationReason: 'runtime_not_fully_ready' };
        }
        const after = await this.system?.benchmark?.snapshot?.().catch(() => null) || null;
        const comparison = record.baseline && after && this.system?.benchmark?.compare
            ? this.system.benchmark.compare(record.baseline, after) : null;
        const runtimeHealthy = Boolean(this.system?.selfModPipeline && this.system?.engineeringSwarm && this.system?.nemesis);
        const contractResult = record.capabilityContract
            ? evaluateCapabilityContract(record.capabilityContract, record.baseline, after, comparison, record.observations || [])
            : { passed: comparison?.valid === true && comparison.delta >= -0.02 && (comparison.regressed?.length || 0) <= 1, failures: [] };
        const rollback = forceRollback || !runtimeHealthy || !contractResult.passed;
        if (rollback && record.deployment) {
            record.deployment.status = 'rollback_pending';
            record.rollbackReason = reason || 'capability_contract_failed';
            await this._persist();
            return record;
        }
        if (rollback) {
            try {
                await this._git(['revert', '--no-edit', record.commit], { timeout: 120_000 });
                record.status = 'rolled_back';
                record.rollbackCommit = await this._git(['rev-parse', 'HEAD']);
                record.rollbackReason = reason || (!runtimeHealthy ? 'runtime_health_failed' : `capability_contract_failed: ${contractResult.failures.join('; ')}`);
            } catch (error) {
                await this._git(['revert', '--abort']).catch(() => {});
                record.status = 'rollback_blocked';
                record.rollbackReason = error.message;
            }
        } else {
            record.status = 'accepted';
            record.acceptedAt = new Date().toISOString();
        }
        record.after = after;
        record.comparison = comparison;
        record.contractResult = contractResult;
        await this._persist();
        await this.appendLedger(`probation_${record.status}`, { id, comparison, contractResult, reason: record.rollbackReason || null });
        await this.anchorLedgerTip(`probation_${record.status}`).catch(() => {});
        await this.system?.causality?.recordIntervention?.({
            action: `self_modification:${id}`,
            context: { files: record.files, commit: record.commit },
            outcome: { status: record.status, comparison },
            success: record.status === 'accepted',
        }).catch(() => {});
        await this.system?.improvementScorecard?.recordProbationResult?.(record, {
            snapshot: after,
            comparison,
            contractResult,
        }).catch(() => {});
        return record;
    }

    async operatorRollback(id, reason = 'operator_request') {
        return this.rollbackPromotion(id, reason);
    }

    async rollbackPromotion(id, reason = 'governed_rollback') {
        const record = this.records.find(item => item.id === id);
        if (!record) throw new Error(`Unknown self-modification promotion: ${id}`);
        if (record.deployment && ['probation', 'accepted'].includes(record.status)) {
            record.deployment.status = 'rollback_pending';
            record.rollbackReason = reason;
            await this._persist();
            return record;
        }
        if (record.status === 'probation') return this.evaluateProbation(id, { forceRollback: true, reason });
        if (record.status !== 'accepted') return record;
        try {
            await this._git(['revert', '--no-edit', record.commit], { timeout: 120_000 });
            record.status = 'rolled_back';
            record.rollbackCommit = await this._git(['rev-parse', 'HEAD']);
            record.rollbackReason = reason;
        } catch (error) {
            await this._git(['revert', '--abort']).catch(() => {});
            record.status = 'rollback_blocked';
            record.rollbackReason = error.message;
        }
        await this._persist();
        await this.appendLedger(`long_term_${record.status}`, { id, reason: record.rollbackReason });
        await this.anchorLedgerTip(`long_term_${record.status}`).catch(() => {});
        return record;
    }

    async observeProbation(id) {
        const record = this.records.find(item => item.id === id);
        if (!record || record.status !== 'probation' || !this.system?.benchmark?.snapshot) return null;
        const snapshot = await this.system.benchmark.snapshot();
        record.observations = [...(record.observations || []), { at: new Date().toISOString(), snapshot }]
            .slice(-Math.max(10, record.capabilityContract?.minimumObservations || 2));
        await this._persist();
        return record.observations.at(-1);
    }

    getActiveProbation() {
        return this.records.find(record => record.status === 'probation') || null;
    }

    async buildSupervisorHandoff(reason = 'self-restart') {
        const record = this.getActiveProbation();
        const ledger = await this.verifyLedger();
        return {
            schema_version: 1,
            promotion_id: record?.id || null,
            candidate_ref: record?.commit || await this._git(['rev-parse', 'HEAD']).catch(() => null),
            rollback_ref: record?.parentCommit || await this._git(['rev-parse', 'HEAD~1']).catch(() => null),
            probation_ends_at: record?.probationEndsAt || null,
            health_url: 'http://127.0.0.1:3001/api/autonomy/health',
            governance_ledger_tip: ledger.tip,
            reason,
        };
    }

    async recordSupervisorHandoff(payload, response) {
        const acknowledged = response?.promotion_id === payload.promotion_id
            || response?.governance?.promotion_id === payload.promotion_id;
        await this.appendLedger('supervisor_handoff', { payload, acknowledged, response });
        return { acknowledged, mode: acknowledged ? 'governance_contract' : 'legacy_supervisor' };
    }

    async anchorLedgerTip(reason = 'manual') {
        const chain = await this.verifyLedger();
        if (!chain.valid) throw new Error(`Cannot anchor invalid governance ledger: ${chain.reason}`);
        const secret = process.env.SOMA_GOVERNANCE_ANCHOR_SECRET || process.env.SOMA_OPERATOR_TOKEN;
        if (!secret || (!this.anchorPath && !this.anchorUrl)) {
            this.lastAnchor = { configured: false, reason: !secret ? 'anchor_secret_missing' : 'anchor_destination_missing' };
            return this.lastAnchor;
        }
        const statement = { timestamp: new Date().toISOString(), reason, entries: chain.entries, tip: chain.tip };
        statement.signature = crypto.createHmac('sha256', secret).update(JSON.stringify(canonical(statement))).digest('hex');
        const destinations = [];
        if (this.anchorPath) {
            const target = path.resolve(this.anchorPath);
            const relative = path.relative(this.root, target);
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Governance anchor path must be outside the SOMA workspace');
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.appendFile(target, `${JSON.stringify(statement)}\n`, 'utf8');
            destinations.push('external_file');
        }
        if (this.anchorUrl) {
            const response = await fetch(this.anchorUrl, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(statement), signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok) throw new Error(`Anchor endpoint returned HTTP ${response.status}`);
            destinations.push('remote_endpoint');
        }
        this.lastAnchor = { configured: true, anchoredAt: statement.timestamp, tip: chain.tip, destinations };
        return this.lastAnchor;
    }

    _probationDependenciesReady() {
        return Boolean(
            this.ready
            && this.system?.selfModPipeline
            && this.system?.engineeringSwarm
            && this.system?.nemesis
            && this.system?.benchmark?.snapshot
            && this.system?.benchmark?.compare
        );
    }

    async appendLedger(action, metadata = {}) {
        const append = async () => {
            const rows = await this._readLedger();
            const previousHash = rows.at(-1)?.hash || GENESIS;
            const entry = { index: rows.length, timestamp: new Date().toISOString(), actor: 'SOMA', action, metadata: canonical(metadata), previousHash };
            entry.hash = crypto.createHash('sha256').update(JSON.stringify(canonical(entry))).digest('hex');
            await fs.appendFile(this.ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
            return entry;
        };
        const queued = this._ledgerQueue.then(append, append);
        this._ledgerQueue = queued.catch(() => {});
        return queued;
    }

    async _readLedger() {
        try {
            return (await fs.readFile(this.ledgerPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        } catch { return []; }
    }

    async verifyLedger() {
        const rows = await this._readLedger();
        let previousHash = GENESIS;
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const candidate = { ...row };
            delete candidate.hash;
            const hash = crypto.createHash('sha256').update(JSON.stringify(canonical(candidate))).digest('hex');
            if (row.index !== index || row.previousHash !== previousHash || row.hash !== hash) {
                return { valid: false, index, reason: 'hash chain mismatch' };
            }
            previousHash = row.hash;
        }
        return { valid: true, entries: rows.length, tip: previousHash };
    }

    async _persist() {
        const snapshot = JSON.stringify(this.records, null, 2);
        const write = async () => {
            const temp = `${this.statePath}.${crypto.randomUUID()}.tmp`;
            await fs.writeFile(temp, snapshot, 'utf8');
            await fs.rename(temp, this.statePath);
        };
        this._stateQueue = (this._stateQueue || Promise.resolve()).then(write, write);
        return this._stateQueue;
    }

    status() {
        return {
            protocolVersion: 2,
            ready: this.ready,
            probationMs: this.probationMs,
            active: this.records.filter(record => record.status === 'probation'),
            recent: this.records.slice(-10),
            isolation: { dockerAvailable: this.candidateRunner._docker, highRiskRequiresContainer: true },
            anchoring: this.lastAnchor || { configured: Boolean((this.anchorPath || this.anchorUrl) && (process.env.SOMA_GOVERNANCE_ANCHOR_SECRET || process.env.SOMA_OPERATOR_TOKEN)) },
        };
    }
}

export default SelfModificationGovernance;
