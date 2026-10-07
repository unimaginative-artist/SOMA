import fs from 'node:fs/promises';
import path from 'node:path';

export class SelfRepairDeployment {
    constructor({ system, governance, fetchImpl = fetch, baseUrl = process.env.MARIONETTE_URL || 'http://127.0.0.1:9000' }) {
        Object.assign(this, { system, governance, fetchImpl, baseUrl });
        this.pendingShutdown = false;
        this.busy = false;
    }

    start() {
        this.timer = setInterval(() => this.tick().catch(error => { this.lastError = error.message; }), 5000);
        this.timer.unref?.();
        return this;
    }

    async request(record, { rollback = false } = {}) {
        const ping = await this.fetchImpl(`${this.baseUrl}/ping`, { signal: AbortSignal.timeout(3000) });
        if (!ping.ok || (await ping.json()).deployment_contract_version !== 2) throw new Error('Marionette file-scoped deployment contract v2 is required');
        this.pendingShutdown = true;
        record.deployment.status = rollback ? 'rollback_requested' : 'requested';
        record.deployment.lastRequestAt = Date.now();
        try {
            await this.governance._persist();
            const res = await this.fetchImpl(`${this.baseUrl}/deploy/soma`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
                body: JSON.stringify({ deployment_manifest: record.deployment.manifest, rollback_ref: record.parentCommit,
                    promotion_id: record.id, rollback_only: rollback, reason: `Verified repair ${record.id}` }),
            });
            const body = await res.json();
            if (!res.ok || body.error || body.promotion_id !== record.id) throw new Error(body.error || 'Supervisor did not acknowledge the exact promotion');
            await this.governance.appendLedger('deployment_requested', { id: record.id, rollback, acknowledgement: body });
            return body;
        } catch (error) {
            // The supervisor may have accepted a request whose reply was lost.
            // Preserve requested state for receipt reconciliation, but do not
            // strand this process's goal admission indefinitely.
            this.pendingShutdown = false;
            this.lastError = record.deployment.lastError = error.message;
            await this.governance._persist();
            throw error;
        }
    }

    async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            for (const record of this.governance.records.filter(r => r.deployment)) {
                const deployment = record.deployment;
                const receiptPath = path.join(this.governance.root, path.dirname(deployment.manifest), 'receipt.json');
                let receipt;
                try { receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); }
                catch (error) { if (error.code !== 'ENOENT') throw error; }
                if (receipt && (receipt.promotion_id !== record.id || receipt.candidate_ref !== record.commit)) throw new Error('Deployment receipt identity mismatch');
                if (receipt && ['succeeded', 'rolled_back', 'failed', 'rollback_blocked'].includes(receipt.status)) {
                    if (receipt.status === 'succeeded' && ['rollback_pending', 'rollback_requested'].includes(deployment.status)) receipt = null;
                    else if (deployment.status !== receipt.status) {
                        // Only the replacement process may claim that its candidate
                        // was loaded. A HTTP acknowledgement is not deployment proof.
                        if (['succeeded', 'rolled_back'].includes(receipt.status) && receipt.pid !== process.pid) continue;
                        deployment.status = receipt.status;
                        deployment.receipt = receipt;
                        if (receipt.status === 'succeeded') record.probationEndsAt = new Date(Date.now() + this.governance.probationMs).toISOString();
                        else record.status = receipt.status === 'rolled_back' ? 'rolled_back' : 'rollback_blocked';
                        this.pendingShutdown = false;
                        await this.governance._persist();
                        await this.governance.appendLedger('deployment_observed', { id: record.id, receipt });
                    }
                    if (receipt?.status === 'succeeded') await this.resumeRepairedGoal(record);
                    if (receipt) continue;
                }
                if (deployment.status === 'prepared' && deployment.requestedByPid !== process.pid) deployment.status = 'rollback_pending';
                if (!['pending', 'requested', 'rollback_pending', 'rollback_requested'].includes(deployment.status)) continue;
                if (Date.now() - Date.parse(record.promotedAt) < 10000 || Date.now() - (deployment.lastRequestAt || 0) < 30000) continue;
                if (this.system.agenticExecutor?._currentGoalId || this.system.selfModPipeline?._activeProposal) continue;
                this.pendingShutdown = true;
                try { await this.request(record, { rollback: deployment.status.startsWith('rollback') }); }
                catch (error) {
                    this.lastError = error.message;
                    deployment.lastError = error.message;
                    deployment.lastRequestAt = Date.now();
                    this.pendingShutdown = false;
                    await this.governance._persist();
                }
                break;
            }
        } finally { this.busy = false; }
    }

    status() { return { pendingShutdown: this.pendingShutdown, lastError: this.lastError || null,
        deployments: this.governance.records.filter(r => r.deployment).map(r => ({ id: r.id, status: r.deployment.status })) }; }

    async resumeRepairedGoal(record) {
        const planner = this.system.goalPlanner;
        const goal = planner?.goals?.get?.(record.goalId);
        if (!goal || record.retryIssued || goal.status !== 'blocked' || !goal.metadata?.maxEscalation?.success
            || Number(goal.metadata?.autonomousRepairRetries || 0) >= 1) return;
        // One changed-strategy retry only. A deployment never marks the original
        // task complete; it must pass its normal executable verification again.
        record.retryIssued = true;
        goal.metadata.autonomousRepairRetries = 1;
        await this.governance._persist();
        const retry = await planner.retryGoal(goal.id, { actor: 'SelfRepairDeployment', reason: `Verified repair ${record.id} loaded; retry original task once` });
        await this.governance.appendLedger('repaired_goal_retry', { promotionId: record.id, goalId: goal.id, success: retry?.success === true });
    }
}
