import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assessMissionCandidate, selectMissionCandidate, MISSION_RECHECK_MS, MISSION_POLICY_VERSION } from './TradingMissionPolicy.js';

/** One-click paper lifecycle. Dependencies are injected; tests never boot SOMA. */
export class TradingMissionController {
    constructor({ statePath, now = Date.now, dependencies = {} } = {}) {
        this.statePath = statePath;
        this.now = now;
        this.dependencies = dependencies;
        this.auditPromise = null;
        this.workPromise = null;
        this.generation = 0;
        this.state = { controlled: false, desired: 'paused', phase: 'idle', runId: null,
            message: 'Click Run SOMA to audit and start an autonomous paper mission.', selection: null, focus: null,
            audit: null, events: [], nextAuditAt: null, lastError: null };
        try {
            if (statePath && fs.existsSync(statePath)) {
                const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                this.state = { ...this.state, ...saved, phase: saved.desired === 'running' ? 'recovering' : 'paused',
                    nextAuditAt: 0, message: 'Restored mission intent; executor state will be reconciled before new entries.' };
            }
        } catch (error) {
            // Corrupt authority must not fall back to legacy automatic trading.
            this.state.controlled = true;
            this.state.lastError = `Mission state could not be restored: ${error.message}`;
            this.state.message = this.state.lastError;
            this.state.phase = 'error';
        }
    }

    bind(dependencies) { this.dependencies = dependencies; }
    persist() {
        if (!this.statePath) return;
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        fs.writeFileSync(`${this.statePath}.tmp`, JSON.stringify(this.state, null, 2));
        fs.renameSync(`${this.statePath}.tmp`, this.statePath);
    }
    note(type, message) {
        this.state.events = [{ type, message, at: new Date(this.now()).toISOString() }, ...this.state.events].slice(0, 40);
        this.state.message = message;
        this.persist();
    }
    sessions() { return this.dependencies.sessions?.() || []; }
    status() {
        const sessions = this.sessions();
        const protectedPositions = sessions.reduce((sum, session) => sum + (session.openPositions?.length || 0), 0);
        const phase = this.state.controlled && this.state.desired === 'paused' && ['paused', 'protecting'].includes(this.state.phase)
            ? protectedPositions ? 'protecting' : 'paused' : this.state.phase;
        return structuredClone({ ...this.state, policyVersion: MISSION_POLICY_VERSION, paperOnly: true, liveEnabled: false,
            phase,
            message: !this.state.controlled && sessions.some(session => session.isRunning)
                ? 'Existing sessions are running outside Autopilot. Run SOMA will audit and take over the paper lifecycle safely.' : this.state.message,
            auditRunning: Boolean(this.auditPromise), executionReady: Boolean(this.dependencies.start),
            limits: { maxPositionNotional: 250, maxMissionSessions: 1, experimentLossBudget: 10 },
            sessions, entriesActive: sessions.some(session => session.paperMode && session.isRunning && !session.config?.entriesPaused
                && this.canEnter(session.symbol, session.config)),
            protectedPositions });
    }
    canEnter(symbol, config = {}) {
        if (!this.state.controlled) return true;
        if (this.state.desired !== 'running') return false;
        if (this.dependencies.entryAuthority && !this.dependencies.entryAuthority()) return false;
        return config.missionRunId === this.state.runId && symbol === this.state.selection?.candidate.symbol
            && config.strategyVersion === this.state.selection?.candidate.id
            && this.state.phase === 'running';
    }
    async audit() {
        if (this.auditPromise) return this.auditPromise;
        this.auditPromise = this.performAudit();
        try { return await this.auditPromise; }
        finally { this.auditPromise = null; }
    }
    async performAudit() {
        const audit = { id: crypto.randomUUID(), startedAt: new Date(this.now()).toISOString(), rows: [], errors: [],
            scope: 'Supported native-venue recipes from the ecosystem, sim-to-paper queue and qualified offline research. Grid is research-only.',
            evidenceNotice: 'A historical comparison is not a prospective test. No selection grants live authority.' };
        this.state.audit = audit;
        this.persist();
        try {
            const proposals = await this.dependencies.proposals();
            audit.excluded = proposals.excluded || [];
            for (const proposal of proposals.candidates) {
                try {
                    const evidence = await this.dependencies.inspect(proposal);
                    audit.rows.push(assessMissionCandidate({ candidate: proposal, ...evidence }));
                } catch (error) { audit.errors.push({ candidateKey: proposal.key, error: error.message }); }
                this.persist();
            }
            audit.recommendation = selectMissionCandidate(audit.rows);
        } catch (error) { audit.errors.push({ error: error.message }); }
        audit.completedAt = new Date(this.now()).toISOString();
        if (this.state.desired !== 'running') {
            // A paused mission can retain an old selection after fresh evidence
            // disqualifies it. Audit-only updates the display, never entry authority.
            this.state.selection = audit.errors.length ? null : audit.recommendation;
            if (!audit.errors.length && !audit.recommendation) {
                this.state.message = 'No eligible paper candidate in the current audit. Research continues; entries remain paused.';
            }
        }
        this.state.nextAuditAt = this.now() + MISSION_RECHECK_MS;
        this.persist();
        return audit;
    }
    run({ focus = null } = {}) {
        if (!this.dependencies.start) throw new Error('Paper executor is not ready');
        if (this.sessions().some(session => session.isRunning && !session.paperMode)) throw new Error('A live session is active; paper autopilot cannot take it over');
        if (focus && (!['SOL-USD', 'BTC-USD', 'ETH-USD'].includes(focus.symbol) || !['fast', 'holding'].includes(focus.lane))) {
            throw new Error('Unsupported mission focus');
        }
        if (this.state.desired === 'running' && JSON.stringify(focus) === JSON.stringify(this.state.focus)) return this.status();
        this.generation++;
        this.state.controlled = true;
        this.state.desired = 'running';
        this.state.runId = crypto.randomUUID();
        this.state.selection = null;
        this.state.focus = focus ? { symbol: focus.symbol, lane: focus.lane } : null;
        this.state.phase = 'auditing';
        this.state.lastError = null;
        this.state.nextAuditAt = 0;
        this.note('run_requested', 'Auditing paper evidence and market data. Existing positions will not be abandoned.');
        this.schedule();
        return this.status();
    }
    schedule() {
        if (this.workPromise) return;
        this.workPromise = this.reconcile().catch(error => {
            this.state.lastError = error.message;
            this.state.phase = 'error';
            this.state.nextAuditAt = this.now() + MISSION_RECHECK_MS;
            this.note('error', `Mission needs attention: ${error.message}. No new mission entries are authorized.`);
        }).finally(() => { this.workPromise = null; });
    }
    async pause(reason = 'operator_requested') {
        this.generation++;
        this.state.controlled = true;
        this.state.desired = 'paused';
        this.state.phase = 'pausing';
        this.note('pause_requested', `Pausing paper entries (${reason}); open positions keep their exit protection.`);
        const failures = [];
        for (const session of this.sessions().filter(session => session.paperMode && session.isRunning)) {
            try { await this.dependencies.pause(session.symbol); }
            catch (error) { failures.push(`${session.symbol}: ${error.message}`); }
        }
        this.state.phase = failures.length ? 'error' : this.sessions().some(session => session.openPositions?.length) ? 'protecting' : 'paused';
        this.state.lastError = failures.join('; ') || null;
        this.note(failures.length ? 'pause_failed' : 'paused', failures.length
            ? `Pause not fully acknowledged: ${failures.join('; ')}`
            : 'Paper entries paused. Open positions, if any, remain protected. Click Run SOMA to resume.');
        return this.status();
    }
    async reconcile() {
        if (this.state.desired !== 'running') return;
        if (this.dependencies.entryAuthority && !this.dependencies.entryAuthority()) {
            for (const session of this.sessions().filter(session => session.paperMode && session.isRunning
                && session.config?.missionRunId === this.state.runId && !session.config?.entriesPaused)) {
                await this.dependencies.pause(session.symbol);
            }
            this.state.phase = 'waiting';
            this.note('authority_stopped', 'Paper mission permission is disabled; entries remain paused.');
            return;
        }
        const generation = this.generation;
        const current = () => this.state.desired === 'running' && generation === this.generation;
        if (this.sessions().some(session => session.isRunning && !session.paperMode)) throw new Error('A live executor is present; paper mission halted');
        // Retain an acknowledged current experiment until its next audit. Never
        // rotate a recipe underneath an open position.
        const owned = this.sessions().find(session => session.isRunning && session.config?.missionRunId === this.state.runId
            && session.config?.strategyVersion === this.state.selection?.candidate.id);
        let evidenceChanged = false;
        if (owned && !owned.config.entriesPaused && this.dependencies.forward) {
            const review = assessMissionCandidate({ ...this.state.selection, forward: this.dependencies.forward(this.state.selection.candidate) });
            if (!review.eligible) {
                evidenceChanged = true;
                this.state.phase = 'reviewing';
                await this.dependencies.pause(owned.symbol);
                this.note('evidence_changed', `Paper evidence changed: ${review.reasons.join('; ')}`);
            }
        }
        if (!current()) return;
        if (owned && !owned.config.entriesPaused && this.state.phase === 'running' && this.now() < this.state.nextAuditAt) return;
        if (!owned && this.state.phase === 'waiting' && this.now() < this.state.nextAuditAt) return;
        for (const session of this.sessions().filter(session => session.paperMode && session.isRunning && session !== owned)) {
            // Snapshots are copies; compare identity, not object equality.
            if (owned && session.symbol === owned.symbol) continue;
            await this.dependencies.pause(session.symbol);
        }
        if (!current()) return;
        this.state.phase = 'auditing';
        const audit = await this.audit();
        if (!current()) return;
        if (audit.errors.length) {
            this.state.phase = 'waiting';
            this.state.nextAuditAt = this.now() + 60_000;
            this.note('audit_incomplete', `${audit.errors.length} paper candidate inspection(s) failed; retrying shortly. No new entries are authorized.`);
            return;
        }
        const matchesFocus = row => !this.state.focus || (row.candidate.symbol === this.state.focus.symbol
            && row.candidate.ecosystemLane === this.state.focus.lane && row.candidate.proposalSource !== 'qualified_offline_research'
            && row.candidate.proposalSource !== 'sim_to_paper_queue');
        const selected = selectMissionCandidate(audit.rows.filter(matchesFocus));
        const retained = owned && !evidenceChanged && audit.rows.find(row => row.eligible
            && matchesFocus(row) && row.candidate.key === this.state.selection?.candidate.key);
        const stillRunning = owned && this.sessions().some(session => session.symbol === owned.symbol && session.isRunning
            && !session.config?.entriesPaused && session.config?.missionRunId === this.state.runId);
        if (retained && stillRunning && !owned.config.entriesPaused) {
            this.state.selection = retained;
            this.state.phase = 'running';
            this.note('retained', `Continuing ${owned.symbol} / ${retained.candidate.strategyId}: ${retained.evidenceClass.replaceAll('_', ' ')}. Not live-qualified.`);
            return;
        }
        if (owned) await this.dependencies.pause(owned.symbol);
        if (!current()) return;
        const open = this.sessions().filter(session => session.openPositions?.length);
        const orphaned = this.dependencies.unownedPositions?.() || [];
        if (open.length || orphaned.length) {
            this.state.phase = 'waiting';
            // Recheck protection sooner than a full research refresh.
            this.state.nextAuditAt = this.now() + 60_000;
            this.note('waiting_for_flat', orphaned.length ? 'Ledger positions need restoration; new entries are blocked.'
                : 'Waiting for protected positions to close before starting the selected experiment.');
            return;
        }
        this.state.selection = selected;
        if (!selected) {
            this.state.phase = 'waiting';
            this.note('waiting', 'No eligible paper candidate in this audit. Continuing research checks; no forced trades.');
            return;
        }
        // Revalidate entry data immediately before launch; an earlier audit
        // item may have aged while other candidates were inspected.
        const readiness = await this.dependencies.readiness(selected.candidate);
        if (!current()) return;
        if (!readiness.ready) {
            this.state.phase = 'waiting';
            this.note('data_blocked', `Waiting for executable data: ${readiness.reason}`);
            return;
        }
        this.state.phase = 'running'; // authorizes this exact recipe at executor boundary
        this.persist();
        const result = await this.dependencies.start(selected.candidate, this.state.runId);
        if (!current()) { await this.dependencies.pause(selected.candidate.symbol); return; }
        const acknowledged = this.sessions().find(session => session.symbol === selected.candidate.symbol
            && session.isRunning && session.paperMode && session.config?.missionRunId === this.state.runId
            && session.config?.strategyVersion === selected.candidate.id && !session.config.entriesPaused);
        if (!result?.success || !acknowledged) throw new Error(result?.error || 'Executor did not acknowledge the selected paper recipe');
        this.note('started', `SOMA selected ${selected.candidate.symbol} / ${selected.candidate.strategyId}: ${selected.evidenceClass.replaceAll('_', ' ')}. $250 maximum position; live trading disabled.`);
    }
}
