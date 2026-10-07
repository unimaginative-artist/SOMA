import fs from 'node:fs/promises';
import path from 'node:path';

const TERMINAL = new Set(['completed', 'broken', 'failed', 'verification_failed', 'rejected', 'archived', 'cancelled', 'blocked', 'abandoned']);
const ACTIVE = new Set(['proposed', 'pending', 'active', 'delegated', 'queued', 'executing', 'creating_goal']);

async function atomicJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporary, filePath);
}

/**
 * Authoritative experience loop:
 * choose -> contract -> act -> observe -> verify -> diagnose -> remember -> retry/compile.
 */
export class RealityLoopDirector {
    constructor({
        system = null,
        provingGround = null,
        proceduralMemory = null,
        skillCompiler = null,
        desktopWorldModel = null,
        adaptiveCognition = null,
        proactivePresence = null,
        reliability = null,
        statePath = 'data/reality-loop/director.json',
        intervalMs = 6 * 60 * 60_000,
        bootDelayMs = 5 * 60_000,
        now = () => Date.now(),
        logger = console
    } = {}) {
        this.system = system;
        this.provingGround = provingGround;
        this.proceduralMemory = proceduralMemory;
        this.skillCompiler = skillCompiler;
        this.desktopWorldModel = desktopWorldModel;
        this.adaptiveCognition = adaptiveCognition;
        this.proactivePresence = proactivePresence;
        this.reliability = reliability;
        this.statePath = path.resolve(statePath);
        this.intervalMs = Math.max(30 * 60_000, Number(intervalMs) || 6 * 60 * 60_000);
        this.bootDelayMs = Math.max(30_000, Number(bootDelayMs) || 5 * 60_000);
        this.now = now;
        this.logger = logger;
        this.state = {
            schemaVersion: 1, cycles: 0, launched: 0, completed: 0, failed: 0,
            processedRunIds: [], capabilityMeasurements: [], lastCycleAt: null, lastDecision: null, currentRunId: null
        };
        this._busy = false;
        this._timer = null;
        this._bootTimer = null;
        this._unsubscribers = [];
    }

    async initialize(system = this.system, { autoStart = true } = {}) {
        this.system = system || this.system;
        try {
            const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (parsed?.schemaVersion === 1) this.state = parsed;
        } catch { /* first boot */ }
        this.state.processedRunIds = Array.isArray(this.state.processedRunIds) ? this.state.processedRunIds.slice(-500) : [];
        this.state.capabilityMeasurements = Array.isArray(this.state.capabilityMeasurements) ? this.state.capabilityMeasurements.slice(-100) : [];
        this._connectBroker();
        if (autoStart) this.start();
        return this;
    }

    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this.cycle().catch(error => this.logger.warn?.(`[RealityLoop] cycle failed: ${error.message}`)), this.intervalMs);
        this._timer.unref?.();
        this._bootTimer = setTimeout(() => this.cycle().catch(error => this.logger.warn?.(`[RealityLoop] boot cycle failed: ${error.message}`)), this.bootDelayMs);
        this._bootTimer.unref?.();
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        if (this._bootTimer) clearTimeout(this._bootTimer);
        this._timer = this._bootTimer = null;
        for (const unsubscribe of this._unsubscribers) unsubscribe?.();
        this._unsubscribers = [];
    }

    async cycle({ launch = true, reason = 'scheduled_capability_gym' } = {}) {
        if (this._busy) return { ran: false, reason: 'cycle_already_running' };
        this._busy = true;
        try {
            this.state.cycles++;
            this.state.lastCycleAt = this.now();
            const runs = this.provingGround?.listRuns?.(100) || [];
            const refreshed = [];
            for (const existing of runs.filter(run => !run.terminal && (ACTIVE.has(run.state) || run.goalId))) {
                try { refreshed.push(this.provingGround.refresh(existing.id, { planner: this.system?.goalPlanner })); } catch { /* isolated stale run */ }
            }
            const allRuns = [...refreshed, ...(this.provingGround?.listRuns?.(100) || runs)];
            const unique = [...new Map(allRuns.map(run => [run.id, run])).values()];
            const newlyTerminal = unique.filter(run => run.terminal && !this.state.processedRunIds.includes(run.id));
            for (const run of newlyTerminal) await this._ingestTrial(run);

            const activeRun = unique.find(run => !run.terminal && ACTIVE.has(run.state));
            if (activeRun) return this._decide({ ran: true, launched: false, reason: 'capability_trial_active', runId: activeRun.id });
            if (!launch) return this._decide({ ran: true, launched: false, reason: 'observation_only', processed: newlyTerminal.length });
            if (!this.provingGround?.start || !this.system?.goalPlanner) return this._decide({ ran: false, reason: 'proving_ground_or_planner_unavailable' });

            // User work always outranks self-training. The gym waits instead of
            // competing for the single authoritative execution focus.
            const activeGoals = [...(this.system.goalPlanner.goals?.values?.() || [])]
                .filter(goal => ACTIVE.has(String(goal.status)));
            const operatorWork = activeGoals.some(goal => goal.metadata?.userDirected === true || ['user', 'discord', 'discord_admin'].includes(goal.source || goal.metadata?.source));
            if (operatorWork) return this._decide({ ran: true, launched: false, reason: 'operator_work_has_priority' });

            const measurement = await this._measureCapability().catch(error => ({ valid: false, error: error.message }));

            const trialId = this._selectTrial(unique);
            const run = await this.provingGround.start({ planner: this.system.goalPlanner, trialId, requestedBy: 'reality_loop' });
            this.state.launched++;
            this.state.currentRunId = run.id;
            await this._persist();
            return this._decide({ ran: true, launched: true, reason, runId: run.id, trialId, measurement });
        } finally {
            this._busy = false;
        }
    }

    async observeTransaction(transaction = {}) {
        const procedureCase = await this.proceduralMemory?.recordTransaction?.(transaction);
        if (procedureCase) transaction.procedureCase = procedureCase;
        await this.reliability?.recordTransaction?.(transaction);
        if (transaction.classification?.lane !== 'inference') {
            await this.desktopWorldModel?.recordConsequence?.({
                transactionId: transaction.id,
                action: transaction.observed?.toolsUsed?.join('>') || transaction.decision?.kind || 'agentic',
                before: transaction.environmentBefore || null,
                verified: transaction.observed?.verified === true
            }).catch(() => {});
        }
        const compiled = transaction.observed?.verified ? await this.skillCompiler?.compileEligible?.() || [] : [];
        return { procedureCase, compiled };
    }

    /** Learn from every authoritative goal attempt, including failed ones. */
    async observeGoalAttempt({ goal = {}, execResult = {}, receipt = null, verification = null, completion = null, measurement = null, durationMs = 0 } = {}) {
        if (!goal.id) return { recorded: false, reason: 'goal_id_required' };
        const verified = goal.status === 'completed'
            && verification?.verified === true
            && completion?.success === true;
        const success = verified;
        const tools = [...new Set([
            ...(execResult.toolsUsed || []),
            ...(receipt?.toolOutcomes || []).map(item => item.tool)
        ].filter(Boolean))];
        const failedChecks = (verification?.checks || [])
            .filter(check => check?.passed === false)
            .map(check => check.check || check.type)
            .filter(Boolean);
        const procedureCase = await this.proceduralMemory?.recordCase?.({
            source: 'authoritative_goal_loop',
            sourceId: `${goal.id}:${Number(goal.metadata?.executionAttempts || 0)}`,
            domain: goal.category || goal.type || 'general',
            task: goal.description || goal.title,
            tools,
            success,
            verified,
            failure: success ? null : failedChecks.join(', ') || execResult.stopReason || execResult.error || goal.status,
            evidence: {
                receiptId: receipt?.receiptId || null,
                receiptPath: goal.metadata?.latestExecutionReceipt || null,
                verification: verification || null,
                baseline: measurement || null
            },
            at: this.now(),
            durationMs
        });
        const compiled = verified ? await this.skillCompiler?.compileEligible?.() || [] : [];
        this.state.lastGoalAttempt = {
            goalId: goal.id,
            at: this.now(),
            status: goal.status,
            verified,
            receiptId: receipt?.receiptId || null,
            procedureCaseId: procedureCase?.id || procedureCase?.caseId || null
        };
        await this._persist();
        return { recorded: true, verified, procedureCase, compiled };
    }

    getStatus() {
        return {
            enabled: Boolean(this._timer), busy: this._busy, schedule: { intervalMs: this.intervalMs, bootDelayMs: this.bootDelayMs },
            state: { ...this.state },
            proceduralMemory: this.proceduralMemory?.getStatus?.() || null,
            skills: this.skillCompiler?.getStatus?.() || null,
            desktopWorld: this.desktopWorldModel?.getStatus?.() || null,
            cognition: this.adaptiveCognition?.getStatus?.() || null,
            proactivePresence: this.proactivePresence?.getStatus?.() || null,
            reliability: this.reliability?.dashboard?.() || null
        };
    }

    async _ingestTrial(run) {
        await this.reliability?.recordTrial?.(run);
        const passed = Number(run.score?.value || 0) >= 70;
        await this.proceduralMemory?.recordCase?.({
            source: 'capability_gym', sourceId: run.id, domain: run.trialId,
            task: run.trialId, tools: run.score?.diagnostics?.toolsUsed || [],
            success: passed, verified: Boolean(run.score) && passed,
            failure: passed ? null : run.score?.reason || run.state,
            evidence: run.score, at: Date.parse(run.updatedAt) || this.now()
        });
        this.state.processedRunIds.push(run.id);
        this.state.processedRunIds = this.state.processedRunIds.slice(-500);
        if (passed) this.state.completed++; else this.state.failed++;
        if (passed) {
            await this.proactivePresence?.reportVerifiedWork?.({
                message: `Capability trial completed: ${run.trialId} scored ${Number(run.score?.value || 0).toFixed(0)}%.`,
                evidence: { runId: run.id, score: run.score }, source: 'reality_loop'
            }).catch(() => {});
        }
        await this.skillCompiler?.compileEligible?.();
        await this._persist();
    }

    _selectTrial(runs) {
        const trials = this.provingGround.listTrials().map(item => item.id);
        const lastByTrial = new Map();
        for (const run of runs) lastByTrial.set(run.trialId, Math.max(lastByTrial.get(run.trialId) || 0, Date.parse(run.createdAt) || 0));
        return trials.sort((a, b) => (lastByTrial.get(a) || 0) - (lastByTrial.get(b) || 0) || a.localeCompare(b))[0];
    }

    async _measureCapability() {
        const registry = this.system?.capabilityTrials;
        if (!registry?.listTrials || !registry?.run) return null;
        const measuredAt = new Map((this.state.capabilityMeasurements || []).map(item => [item.domain, Number(item.at || 0)]));
        const domain = registry.listTrials().map(item => item.id)
            .sort((a, b) => (measuredAt.get(a) || 0) - (measuredAt.get(b) || 0) || a.localeCompare(b))[0];
        if (!domain) return null;
        const receipt = await registry.run(domain, { reason: 'reality_loop_capability_gym' });
        const measurement = { domain, at: this.now(), valid: receipt.valid === true, score: receipt.score, receiptId: receipt.id };
        this.state.capabilityMeasurements.push(measurement);
        this.state.capabilityMeasurements = this.state.capabilityMeasurements.slice(-100);
        await this._persist();
        return measurement;
    }

    async _onGoalTerminal(message, eventType) {
        const payload = message?.payload || message || {};
        const goal = payload.goal || payload;
        if (!goal?.id) return;
        const receipt = await this._readReceipt(goal);
        await this.reliability?.recordGoal?.(goal, receipt);
        const tools = (receipt?.toolOutcomes || receipt?.historicalToolOutcomes || []).map(item => item.tool).filter(Boolean);
        await this.proceduralMemory?.recordCase?.({
            source: eventType, sourceId: goal.id, domain: goal.category || 'general', task: goal.description || goal.title,
            tools, verified: eventType === 'goal_completed' && (receipt?.completionEvidence?.passed === true || Boolean(receipt)),
            success: eventType === 'goal_completed', failure: eventType === 'goal_completed' ? null : payload.reason || goal.status,
            evidence: receipt?.completionEvidence || goal.metadata?.latestExecutionReceipt || null,
            at: goal.completedAt || goal.updatedAt || this.now()
        });
        await this.skillCompiler?.compileEligible?.();
    }

    async _readReceipt(goal) {
        const receiptPath = goal.metadata?.latestExecutionReceipt;
        if (!receiptPath) return null;
        const absolute = path.resolve(process.cwd(), receiptPath);
        if (!absolute.startsWith(path.resolve(process.cwd()))) return null;
        try { return JSON.parse(await fs.readFile(absolute, 'utf8')); } catch { return null; }
    }

    _connectBroker() {
        const broker = this.system?.messageBroker;
        if (!broker?.subscribe || this._unsubscribers.length) return;
        for (const type of ['goal_completed', 'goal_failed']) {
            const unsubscribe = broker.subscribe(type, message => this._onGoalTerminal(message, type).catch(() => {}));
            if (typeof unsubscribe === 'function') this._unsubscribers.push(unsubscribe);
        }
    }

    async _decide(decision) {
        this.state.lastDecision = { ...decision, at: this.now() };
        await this._persist();
        return decision;
    }

    async _persist() { await atomicJson(this.statePath, this.state); }
}

export default RealityLoopDirector;
