import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { repairPath } from './SelfRepairCandidate.js';
import { normalizeCapabilityContract } from './SelfModificationCapabilityContract.js';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export class SelfRepairCoordinator {
    constructor({ system, root = process.cwd() }) {
        this.system = system;
        this.root = root;
        this.file = path.join(root, 'data/self-modification/max-repairs.json');
        this.jobs = [];
        this.busy = false;
    }

    async initialize() {
        try { this.jobs = JSON.parse(await fs.readFile(this.file, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        this.timer = setInterval(() => this.tick().catch(error => { this.lastError = error.message; }), 15000);
        this.timer.unref?.();
        return this;
    }

    async queue(goal, autopsy) {
        const original = goal.metadata?.recoveryOfGoalId
            ? this.system.goalPlanner?.goals?.get(goal.metadata.recoveryOfGoalId) : goal;
        if (!original) return { success: false, error: 'Recovery source goal is unavailable; original scope cannot be verified' };
        const existing = this.jobs.find(job => job.sourceGoalId === original.id);
        if (existing) return { success: Boolean(existing.maxGoalId) && existing.status !== 'blocked', maxGoalId: existing.maxGoalId, repair: existing, error: existing.error || null };
        const planId = original.metadata?.researchPlanId;
        let pinnedPlan = null;
        if (planId) {
            try { pinnedPlan = await this.system.selfEvolutionResearch.validatePlan(planId); }
            catch (error) { return { success: false, error: `Hash-pinned research plan unavailable: ${error.message}` }; }
        }
        const context = [original.title, original.description, JSON.stringify(autopsy?.record || {}), JSON.stringify(original.metadata?.lastVerification || {})].join('\n');
        const mentioned = [...context.matchAll(/(?:core|arbiters|server|scripts)\/[a-zA-Z0-9_./-]+\.(?:mjs|cjs|js|ts)\b/g)].map(match => match[0]);
        const files = [];
        for (const file of pinnedPlan ? [pinnedPlan.file] : [...new Set(mentioned)].slice(0, 12)) {
            try {
                const relative = repairPath(this.root, file);
                files.push({ path: relative, sourceHash: digest(await fs.readFile(path.join(this.root, relative))) });
            } catch { /* Ignore nonexistent/protected paths from conversation. */ }
            if (files.length === 4) break;
        }
        if (!files.length) return { success: false, error: 'No eligible source inside the original repair scope' };
        if (pinnedPlan && (files.length !== 1 || files[0].path !== pinnedPlan.file || files[0].sourceHash !== pinnedPlan.sourceHash)) {
            return { success: false, error: 'Research repair no longer matches its hash-pinned source' };
        }
        const capabilityContract = normalizeCapabilityContract(original.metadata?.capabilityContract || {
            testFiles: ['tests/goal-executor-watchdog.test.mjs', 'tests/goal-verification-contract.test.cjs'], risk: 'medium',
        });
        if (pinnedPlan) capabilityContract.testFiles = [...new Set(pinnedPlan.testFiles || [])];
        if (!capabilityContract.testFiles.length) return { success: false, error: 'Repair needs an executable verification contract' };
        const bridge = this.system.maxBridge || this.system.maxAgentBridge;
        const availability = await bridge.ensureAvailable({ startIfOffline: true });
        if (!availability.available) return { success: false, error: availability.error || 'MAX unavailable' };
        if (availability.health?.boundedRepairProtocol !== 1) return { success: false, error: 'MAX must load bounded repair protocol v1 before accepting repair work' };
        const job = { sourceGoalId: original.id, asiCycleId: original.metadata?.asiCycleId || null,
            requestId: `soma-bounded-repair:${original.id}`, files, capabilityContract, status: 'submitting', createdAt: Date.now(),
            title: `Propose verified repair for SOMA: ${String(original.title).slice(0, 120)}`, description: context.slice(0, 16000) };
        this.jobs.push(job); await this.persist();
        const result = await this.submit(job);
        return { success: true, maxGoalId: result.id, repair: { status: job.status, files: files.map(file => file.path) } };
    }

    async submit(job) {
        job.submissionAttempts = (job.submissionAttempts || 0) + 1;
        await this.persist();
        const result = await (this.system.maxBridge || this.system.maxAgentBridge).injectGoal(job.title, {
            description: job.description, priority: .95, requestId: job.requestId, readOnly: true,
            repairContract: { schemaVersion: 1, workspace: this.root, sourceGoalId: job.sourceGoalId, files: job.files },
        });
        job.maxGoalId = result.id; job.status = 'queued'; await this.persist();
        return result;
    }

    async tick() {
        if (this.busy || this.system.selfRepairDeployment?.pendingShutdown || this.system.agenticExecutor?._currentGoalId) return;
        this.busy = true;
        try {
            for (const job of this.jobs.filter(job => job.status === 'submitting')) {
                try {
                    if (job.submissionAttempts >= 3) { job.status = 'blocked'; job.error = 'MAX submission budget exhausted'; await this.persist(); }
                    else await this.submit(job);
                } catch (error) { job.error = error.message; await this.persist(); }
            }
            for (const job of this.jobs.filter(job => ['queued', 'reviewing'].includes(job.status))) {
                try {
                // Reconcile the exact durable promotion after a restart or lost reply.
                const promotion = this.system.selfModificationGovernance.records.find(record => record.goalId === job.sourceGoalId &&
                    (record.id === job.promotionId || (job.status === 'reviewing' && Date.parse(record.promotedAt) >= job.createdAt)));
                if (promotion) { job.status = 'promoted'; await this.persist(); continue; }
                const result = await (this.system.maxBridge || this.system.maxAgentBridge).getGoal(job.maxGoalId);
                if (['failed', 'cancelled'].includes(result?.status)) { job.status = 'blocked'; job.error = result.outcome?.lastError || 'MAX repair failed'; await this.persist(); continue; }
                if (result?.status !== 'done') continue;
                if (result.outcome?.state !== 'proposal_only' || result.outcome?.sourceGoalId !== job.sourceGoalId) throw new Error('MAX repair receipt identity/state mismatch');
                for (const file of job.files) {
                    if (digest(await fs.readFile(path.join(this.root, file.path))) !== file.sourceHash) throw new Error('MAX repair proposal became stale; owner source preserved');
                }
                job.status = 'reviewing'; await this.persist();
                const patch = result.outcome.patch;
                const allowed = new Set(job.files.map(file => file.path));
                if (!patch?.files?.length || patch.files.some(file => !allowed.has(file.path))) throw new Error('MAX patch exceeded its repair scope');
                const proposal = await this.system.selfModPipeline.propose(patch.files[0].path, result.outcome.summary,
                    'max_repair', { patch, sourceHashes: Object.fromEntries(job.files.map(file => [file.path, file.sourceHash])),
                        goalId: job.sourceGoalId, asiCycleId: job.asiCycleId, capabilityContract: job.capabilityContract });
                job.status = proposal.implemented ? 'promoted' : 'blocked';
                job.promotionId = proposal.entry?.promotion?.id || null;
                job.error = proposal.reason || null;
                await this.persist();
                break;
                } catch (error) {
                    job.status = 'blocked'; job.error = error.message;
                    await this.persist();
                }
            }
        } finally { this.busy = false; }
    }

    async persist() {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const snapshot = JSON.stringify(this.jobs, null, 2);
        const write = async () => {
            const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
            await fs.writeFile(temp, snapshot);
            await fs.rename(temp, this.file);
        };
        this.writeQueue = (this.writeQueue || Promise.resolve()).then(write, write);
        return this.writeQueue;
    }
}
