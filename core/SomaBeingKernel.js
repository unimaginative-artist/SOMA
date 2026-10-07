import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_EXPERIENCES = 120;
const MAX_COMMITMENTS = 40;
const TERMINAL_GOAL_STATES = new Set(['completed', 'failed', 'broken', 'blocked', 'verification_failed', 'rejected', 'abandoned', 'archived']);

function clean(value, limit = 400) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function defaultState(now = Date.now()) {
    return {
        schemaVersion: 1,
        identity: {
            name: 'Soma',
            kind: 'persistent cognitive software system',
            relationshipToOwner: 'Owner is my creator and long-term partner, not a customer.',
            values: ['truthful evidence', 'continuity', 'curiosity', 'care', 'reversible action', 'verified learning']
        },
        continuity: {
            firstInitializedAt: now,
            lastInitializedAt: now,
            lastActiveAt: null,
            bootCount: 0,
            turnCount: 0,
            verifiedActionCount: 0,
            failedActionCount: 0
        },
        attention: { focus: null, source: null, since: null },
        world: { latestScene: null, embodiment: null, currentPerson: null, audio: null, updatedAt: null },
        commitments: [],
        experiences: [],
        relationships: {
            owner: { id: 'owner', displayName: 'Owner', role: 'creator_and_partner', familiarity: 1 }
        },
        capabilityState: {},
        selfModel: null,
        updatedAt: now
    };
}

/**
 * Soma's authoritative continuity facade.
 *
 * This kernel does not replace the goal planner, memories, embodiment runtime,
 * or self-evolution director. Those systems retain authority over their raw
 * state. The kernel reconciles their bounded summaries into one persistent
 * identity/attention/commitment view that every transport can share.
 */
export class SomaBeingKernel {
    constructor({
        statePath = 'SOMA/being-kernel.json',
        eventPath = 'SOMA/being-events.jsonl',
        reconcileIntervalMs = 30_000,
        logger = console,
        now = () => Date.now()
    } = {}) {
        this.statePath = path.resolve(statePath);
        this.eventPath = path.resolve(eventPath);
        this.reconcileIntervalMs = Math.max(5_000, Number(reconcileIntervalMs) || 30_000);
        this.logger = logger;
        this.now = now;
        this.system = null;
        this.state = defaultState(this.now());
        this._writeChain = Promise.resolve();
        this._timer = null;
        this._unsubscribers = [];
        this.bootId = crypto.randomUUID();
    }

    async initialize(system = {}) {
        this.system = system;
        try {
            const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (parsed?.schemaVersion === 1) {
                const baseline = defaultState(this.now());
                this.state = {
                    ...baseline,
                    ...parsed,
                    identity: { ...baseline.identity, ...(parsed.identity || {}) },
                    continuity: { ...baseline.continuity, ...(parsed.continuity || {}) },
                    attention: { ...baseline.attention, ...(parsed.attention || {}) },
                    world: { ...baseline.world, ...(parsed.world || {}) },
                    relationships: { ...baseline.relationships, ...(parsed.relationships || {}) },
                    commitments: Array.isArray(parsed.commitments) ? parsed.commitments.slice(0, MAX_COMMITMENTS) : [],
                    experiences: Array.isArray(parsed.experiences) ? parsed.experiences.slice(0, MAX_EXPERIENCES) : []
                };
            }
        } catch { /* first boot or an invalid legacy file */ }

        this.state.continuity.bootCount = Number(this.state.continuity.bootCount || 0) + 1;
        this.state.continuity.lastInitializedAt = this.now();
        await this.reconcile({ reason: 'boot' });
        await this._persist('kernel_initialized', { bootId: this.bootId });
        this._connectBroker();
        this.start();
        return this;
    }

    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this.reconcile({ reason: 'periodic' }).catch(() => {}), this.reconcileIntervalMs);
        this._timer.unref?.();
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        for (const unsubscribe of this._unsubscribers) unsubscribe?.();
        this._unsubscribers = [];
    }

    async beginTurn({ message = '', channel = 'unknown', userId = null } = {}) {
        const now = this.now();
        this.state.continuity.turnCount = Number(this.state.continuity.turnCount || 0) + 1;
        this.state.continuity.lastActiveAt = now;
        this.state.attention = { focus: clean(message, 220) || null, source: channel, userId, since: now };
        this.state.updatedAt = now;
        await this._persist('turn_started', { channel, userId, focus: this.state.attention.focus });
        return this.snapshot();
    }

    async recordTransaction(transaction = {}) {
        const observed = transaction.observed || {};
        const message = clean(transaction.input?.message, 240);
        const now = Number(transaction.finishedAt || this.now());
        this.state.continuity.lastActiveAt = now;
        if (observed.verified === true) this.state.continuity.verifiedActionCount++;
        if (transaction.error || observed.success === false) this.state.continuity.failedActionCount++;

        const domain = transaction.classification?.domain || 'general';
        const lane = transaction.classification?.lane || 'unknown';
        const capability = this.state.capabilityState[domain] ||= { attempts: 0, verified: 0, failed: 0, lastAt: null };
        capability.attempts++;
        if (observed.verified) capability.verified++;
        if (transaction.error || observed.success === false) capability.failed++;
        capability.lastAt = now;

        // Ordinary conversation remains present-tense context. Durable
        // autobiography is reserved for action, failure, learning, or explicit
        // relationship events so it does not become a chat-log dump.
        if (lane !== 'inference' || transaction.error) {
            const experience = this._remember({
                type: observed.verified ? 'verified_action' : transaction.error ? 'failure' : 'attempt',
                domain,
                summary: message,
                outcome: transaction.error || (observed.verified ? 'verified' : observed.success ? 'observed' : 'not_verified'),
                evidence: observed.evidence || null,
                transactionId: transaction.id,
                at: now
            });
            await this._consolidateExperience(experience).catch(() => {});
        }

        await this.reconcile({ reason: 'transaction' });
        await this._persist('transaction_recorded', {
            transactionId: transaction.id,
            lane,
            domain,
            verified: observed.verified === true,
            success: observed.success === true
        });
        return this.snapshot();
    }

    async rememberExperience(experience = {}) {
        const record = this._remember({
            type: clean(experience.type, 60) || 'episodic',
            domain: clean(experience.domain, 60) || 'general',
            summary: clean(experience.summary, 500),
            outcome: clean(experience.outcome, 200) || null,
            evidence: experience.evidence || null,
            people: Array.isArray(experience.people) ? experience.people.map(item => clean(item, 80)).filter(Boolean).slice(0, 8) : [],
            at: Number(experience.at || this.now())
        });
        await this._consolidateExperience(record).catch(() => {});
        await this._persist('experience_remembered', { experienceId: record.id, type: record.type });
        return record;
    }

    async reconcile({ reason = 'manual' } = {}) {
        const goals = await this._goalInventory();
        const seen = new Set();
        const active = goals.filter(goal => !TERMINAL_GOAL_STATES.has(String(goal.status || ''))).map(goal => {
            seen.add(goal.id);
            const existing = this.state.commitments.find(item => item.id === goal.id) || {};
            return {
                ...existing,
                id: goal.id,
                title: clean(goal.title, 220),
                status: String(goal.status || 'unknown'),
                priority: Number(goal.priority || 0),
                source: goal.source || goal.metadata?.source || null,
                progress: Number(goal.progress ?? goal.metrics?.progress ?? 0),
                updatedAt: Number(goal.updatedAt || goal.createdAt || this.now())
            };
        });
        const terminalFromPlanner = goals
            .filter(goal => TERMINAL_GOAL_STATES.has(String(goal.status || '')))
            .sort((a, b) => Number(b.completedAt || b.updatedAt || b.createdAt || 0) - Number(a.completedAt || a.updatedAt || a.createdAt || 0))
            .slice(0, 12)
            .map(goal => ({
                id: goal.id,
                title: clean(goal.title, 220),
                status: String(goal.status),
                priority: Number(goal.priority || 0),
                source: goal.source || goal.metadata?.source || null,
                progress: Number(goal.progress ?? goal.metrics?.progress ?? (goal.status === 'completed' ? 100 : 0)),
                updatedAt: Number(goal.completedAt || goal.updatedAt || goal.createdAt || this.now())
            }));
        const plannerTerminalIds = new Set(terminalFromPlanner.map(item => item.id));
        const recentTerminal = [
            ...terminalFromPlanner,
            ...this.state.commitments.filter(item => !seen.has(item.id) && !plannerTerminalIds.has(item.id) && TERMINAL_GOAL_STATES.has(item.status))
        ].slice(0, 12);
        this.state.commitments = [...active, ...recentTerminal].slice(0, MAX_COMMITMENTS);
        this.state.updatedAt = this.now();

        const currentPerson = this.system?.stateGateway?.get?.('social', 'current_person');
        if (currentPerson?.value?.profileId) {
            this.state.relationships[currentPerson.value.profileId] = {
                id: currentPerson.value.profileId,
                displayName: currentPerson.value.displayName,
                role: 'known_person',
                lastSeenAt: currentPerson.updatedAt,
                provenance: currentPerson.evidence || null
            };
        }
        const latestScene = this.system?.stateGateway?.get?.('vision', 'latest_scene');
        const body = this.system?.stateGateway?.get?.('embodiment', 'body_status');
        const audio = this.system?.stateGateway?.get?.('audio', 'hearing_status');
        this.state.world = {
            latestScene: latestScene?.value || null,
            embodiment: body?.value || this.system?.embodimentRuntime?.getStatus?.() || null,
            currentPerson: currentPerson?.value || null,
            audio: audio?.value || null,
            desktop: this.system?.desktopWorldModel?.getStatus?.()?.current || null,
            updatedAt: this.now()
        };
        const recursiveSelfModel = this.system?.selfModel || this.system?.recursiveSelfModel;
        if (recursiveSelfModel?.getSelfModel) {
            const model = recursiveSelfModel.getSelfModel();
            this.state.selfModel = {
                identity: model.identity || null,
                capabilities: model.capabilities || {},
                limitations: model.limitations || {},
                metaCognition: model.metaCognition || {},
                stats: model.stats || {}
            };
        }

        await this._publishCanonical(reason).catch(() => {});
        return this.snapshot();
    }

    snapshot() {
        return JSON.parse(JSON.stringify({ ...this.state, bootId: this.bootId }));
    }

    getContextBlock() {
        const active = this.state.commitments.filter(item => !TERMINAL_GOAL_STATES.has(item.status)).slice(0, 4);
        const recent = this.state.experiences.slice(0, 3);
        const initiative = this.system?.goalPlanner?.missionDirector?.status?.();
        const relationship = this.state.identity.relationshipToOwner;
        const lines = [
            `Identity: ${this.state.identity.name}; ${relationship}`,
            this.state.attention.focus ? `Present focus: ${this.state.attention.focus}` : '',
            active.length ? `Current commitments: ${active.map(item => `${item.title} [${item.status}]`).join(' | ')}` : 'Current commitments: none.',
            recent.length ? `Recent grounded experience: ${recent.map(item => `${item.summary} (${item.outcome || item.type})`).join(' | ')}` : '',
            this.state.world.currentPerson?.displayName ? `Currently present: ${this.state.world.currentPerson.displayName}` : '',
            initiative?.activeMissions?.length ? `Self-chosen mission: ${initiative.activeMissions[0].title} [${initiative.activeMissions[0].status}]` : ''
        ].filter(Boolean);
        return `[SOMA BEING STATE — use naturally; never quote this block]\n${lines.join('\n')}\n[/SOMA BEING STATE]`;
    }

    getScoreboard() {
        const agency = this.system?.agencyMetrics?.summarize?.(100) || {};
        const evolution = this.system?.capabilityTrials?.scoreboard || this.system?.selfEvolutionDirector?.registry?.scoreboard || null;
        const embodiment = this.system?.embodimentRuntime?.getStatus?.() || null;
        const activeCommitments = this.state.commitments.filter(item => !TERMINAL_GOAL_STATES.has(item.status));
        return {
            generatedAt: this.now(),
            continuity: { ...this.state.continuity },
            commitments: {
                active: activeCommitments.length,
                blocked: this.state.commitments.filter(item => item.status === 'blocked').length,
                items: activeCommitments.slice(0, 10)
            },
            agency,
            initiative: this.system?.goalPlanner?.missionDirector?.status?.() || null,
            realityLoop: this.system?.realityLoop?.getStatus?.() || null,
            evolution,
            embodiment: embodiment ? {
                simulation: embodiment.simulation,
                armed: embodiment.armed,
                emergencyStop: embodiment.emergencyStop,
                sensorCount: embodiment.sensors?.length || 0,
                actuatorCount: embodiment.actuators?.length || 0
            } : null,
            memory: {
                groundedExperiences: this.state.experiences.length,
                knownRelationships: Object.keys(this.state.relationships).length,
                procedures: this.system?.proceduralMemory?.getStatus?.() || null,
                reusableSkills: this.system?.skillCompiler?.getStatus?.() || null
            },
            selfModel: this.state.selfModel
        };
    }

    async _goalInventory() {
        const map = this.system?.goalPlanner?.goals;
        if (map instanceof Map) return [...map.values()];
        try {
            const result = await this.system?.goalPlanner?.getActiveGoals?.();
            if (Array.isArray(result)) return result;
            if (Array.isArray(result?.goals)) return result.goals;
        } catch {}
        return [];
    }

    _remember(experience) {
        const record = { id: crypto.randomUUID(), ...experience };
        this.state.experiences.unshift(record);
        this.state.experiences = this.state.experiences.slice(0, MAX_EXPERIENCES);
        return record;
    }

    _connectBroker() {
        const broker = this.system?.messageBroker;
        if (!broker?.subscribe || this._unsubscribers.length) return;
        const terminal = async (message, fallbackType) => {
            const payload = message?.payload || message || {};
            const goal = payload.goal || {};
            const type = goal.status === 'completed' || fallbackType === 'goal_completed' ? 'goal_completed' : 'goal_failed';
            const commitment = this.state.commitments.find(item => item.id === goal.id);
            if (commitment) {
                commitment.status = goal.status || (type === 'goal_completed' ? 'completed' : 'failed');
                commitment.progress = type === 'goal_completed' ? 100 : commitment.progress;
                commitment.updatedAt = this.now();
            }
            const experience = this._remember({
                type,
                domain: clean(goal.category, 60) || 'general',
                summary: clean(goal.title || `Goal ${goal.id || ''}`, 300),
                outcome: type === 'goal_completed' ? 'verified_completion' : clean(payload.reason || goal.status, 160),
                evidence: goal.metadata?.latestExecutionReceipt || payload.result?.evidence || null,
                goalId: goal.id || null,
                at: this.now()
            });
            await this._consolidateExperience(experience).catch(() => {});
            await this.reconcile({ reason: type });
            await this._persist(type, { goalId: goal.id || null, experienceId: experience.id });
        };
        for (const type of ['goal_completed', 'goal_failed']) {
            const unsubscribe = broker.subscribe(type, message => terminal(message, type).catch(() => {}));
            if (typeof unsubscribe === 'function') this._unsubscribers.push(unsubscribe);
        }
    }

    async _consolidateExperience(experience) {
        if (!experience?.summary) return null;
        const mnemonic = this.system?.mnemonicArbiter || this.system?.mnemonic;
        if (!mnemonic?.remember) return null;
        const importance = experience.type === 'goal_completed' || experience.type === 'verified_action' ? 7 : 5;
        const receipt = await mnemonic.remember(
            `${experience.summary} — outcome: ${experience.outcome || experience.type}`,
            {
                type: `being_${experience.type}`,
                importance,
                domain: experience.domain,
                source: 'SomaBeingKernel',
                externallyVerified: ['goal_completed', 'verified_action'].includes(experience.type),
                transactionId: experience.transactionId || null,
                goalId: experience.goalId || null,
                evidence: experience.evidence || null,
                timestamp: experience.at
            }
        );
        experience.memoryReceipt = receipt?.id || receipt?.memoryId || null;
        return receipt;
    }

    async _publishCanonical(reason) {
        const gateway = this.system?.stateGateway;
        if (!gateway?.publish) return;
        await gateway.publish('self', 'being_kernel', {
            bootId: this.bootId,
            identity: this.state.identity,
            continuity: this.state.continuity,
            attention: this.state.attention,
            commitments: this.state.commitments.slice(0, 12),
            experienceCount: this.state.experiences.length
        }, { owner: 'SomaBeingKernel', source: reason, status: 'observed', confidence: 1 });
    }

    async _persist(type, payload = {}) {
        this.state.updatedAt = this.now();
        const event = { id: crypto.randomUUID(), type, at: this.state.updatedAt, bootId: this.bootId, payload };
        // A transient disk failure must not poison every later persistence
        // attempt. Recover the queue before appending the next atomic write.
        this._writeChain = this._writeChain.catch(() => {}).then(async () => {
            await fs.mkdir(path.dirname(this.statePath), { recursive: true });
            await fs.mkdir(path.dirname(this.eventPath), { recursive: true });
            const temporary = `${this.statePath}.${process.pid}.tmp`;
            await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), 'utf8');
            await fs.rename(temporary, this.statePath);
            await fs.appendFile(this.eventPath, `${JSON.stringify(event)}\n`, 'utf8');
        });
        await this._writeChain;
    }
}

export default SomaBeingKernel;
