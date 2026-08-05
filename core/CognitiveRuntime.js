import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const EXTERNAL_ACTION_INTENT = /\b(build|implement|fix|change|modify|edit|run|execute|install|deploy|test|research|investigate|organize)\b/i;
const ACTION_TARGET = /\b(file|folder|code|change|repo(?:sitory)?|project|app|service|server|test|script|command|terminal|browser|dataset|document|spreadsheet|system|bug|issue|workspace)\b/i;
const EXPLICIT_WRITE_TARGET = /\b(write|create)\b[\s\S]{0,40}\b(file|code|script|test|document|spreadsheet|email|report)\b/i;
const TRADING_INTENT = /\b(trad(?:e|ing)|stock|crypto|forex|option|portfolio|position|order|ticker|market|backtest|alpaca|buy|sell|stop[- ]?loss|take[- ]?profit)\b/i;
const EMBODIMENT_INTENT = /\b(robot|motor|servo|actuator|sensor|lidar|camera|body|physical|move forward|turn left|turn right|emergency stop)\b/i;

function requestsAction(message = '') {
    const value = String(message || '').trim();
    return /^(?:please\s+)?(?:build|implement|fix|change|modify|edit|run|execute|install|deploy|test|research|investigate|organize|write|create)\b/i.test(value)
        || /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:build|implement|fix|change|modify|edit|run|execute|install|deploy|test|research|investigate|organize|write|create)\b/i.test(value)
        || /\bI\s+(?:want|need|would like)\s+you\s+to\s+(?:build|implement|fix|change|modify|edit|run|execute|install|deploy|test|research|investigate|organize|write|create)\b/i.test(value);
}

function textOf(value) {
    if (typeof value === 'string') return value;
    return value?.text || value?.response || value?.result || value?.output || '';
}

/**
 * The authoritative perceive -> decide -> act -> observe transaction boundary.
 * Models may propose; only tool receipts and external checks establish outcomes.
 */
export class CognitiveRuntime {
    constructor({ ledgerPath = 'SOMA/cognitive-transactions.jsonl', logger = console } = {}) {
        this.ledgerPath = path.resolve(ledgerPath);
        this.logger = logger;
        this.system = null;
    }

    initialize(system) {
        this.system = system;
        return this;
    }

    classify(input = {}) {
        const message = String(input.message || '');
        if (input.domain === 'trading' || TRADING_INTENT.test(message)) return { lane: 'specialist', domain: 'trading' };
        if (input.domain === 'embodiment' || EMBODIMENT_INTENT.test(message)) return { lane: 'specialist', domain: 'embodiment' };
        const groundedAction = requestsAction(message) && (
            (EXTERNAL_ACTION_INTENT.test(message) && ACTION_TARGET.test(message)) ||
            EXPLICIT_WRITE_TARGET.test(message)
        );
        if (input.forceAgentic || (groundedAction && !input.quickResponse)) return { lane: 'agentic', domain: 'general' };
        return { lane: 'inference', domain: 'general' };
    }

    async run(input = {}) {
        if (!this.system) throw new Error('CognitiveRuntime is not initialized');
        const startedAt = Date.now();
        const id = crypto.randomUUID();
        const classification = this.classify(input);
        await this.system.beingKernel?.beginTurn?.({
            message: input.message,
            channel: input.options?.sourceChannel || 'cognitive_runtime',
            userId: input.userId || input.options?.userId || null
        });
        const environmentBefore = classification.lane !== 'inference'
            ? await this.system.desktopWorldModel?.observe?.({ reason: `before:${classification.domain}` }).catch(() => null)
            : null;
        const before = await this._snapshot();
        const transaction = { id, startedAt, classification, input: this._safeInput(input), before, environmentBefore };

        this.system.workingMemory?.setPreoccupation?.(String(input.message || '').slice(0, 200));

        try {
            const decision = await this._decide(input, classification, before);
            const observed = this._observe(decision, classification);
            const after = await this._snapshot();
            Object.assign(transaction, { decision, observed, after, finishedAt: Date.now(), durationMs: Date.now() - startedAt });
            await this._learn(transaction);
            await this.system.beingKernel?.recordTransaction?.(transaction);
            await this._record(transaction);
            await this.system.agencyMetrics?.record?.(transaction).catch(() => {});
            await this._publishState(transaction).catch(() => {});
            return this._toBrainResult(transaction);
        } catch (error) {
            Object.assign(transaction, { error: error.message, finishedAt: Date.now(), durationMs: Date.now() - startedAt });
            await this._record(transaction).catch(() => {});
            await this.system.beingKernel?.recordTransaction?.(transaction).catch(() => {});
            await this.system.agencyMetrics?.record?.(transaction).catch(() => {});
            await this._publishState(transaction).catch(() => {});
            throw error;
        }
    }

    async _decide(input, classification, state) {
        if (classification.lane === 'specialist' && this.system.specialistRegistry?.has(classification.domain)) {
            const specialist = await this.system.specialistRegistry.run(classification.domain, input, {
                state,
                actionAuthorized: input.trustedActionAuthority === true,
                domainStatus: classification.domain === 'trading' ? this.system.tradingPerformanceGuard?.getStatus?.() || null : null,
                infer: runtimeContext => this._infer(input, runtimeContext).then(decision => decision.result)
            });
            return { kind: specialist.kind, result: specialist.result, specialistReceipt: specialist.receipt };
        }

        // Trading remains owned by its purpose-built market/risk/execution stack.
        if (classification.domain === 'trading') {
            return this._infer(input, { state, specialistDomain: 'trading' });
        }

        if (classification.domain === 'embodiment') {
            // Natural language never directly becomes motor commands. Only a typed
            // action from a trusted caller reaches the embodiment boundary.
            if (input.embodimentAction) {
                const result = await this.system.embodimentRuntime?.execute(input.embodimentAction);
                return { kind: 'agentic', result: { ...result, toolsUsed: ['embodiment_execute'], observations: [result] } };
            }
            return this._infer(input, { state, specialistDomain: 'embodiment', embodiment: this.system.embodimentRuntime?.getStatus?.() || null });
        }

        if (classification.lane === 'agentic' && this.system.agenticExecutor?.execute) {
            if (this.system.goalPlanner?.createGoal) {
                const title = String(input.message || 'User-directed task').slice(0, 160);
                const queued = await this.system.goalPlanner.createGoal({
                    title,
                    description: String(input.message || ''),
                    category: input.category || 'engineering',
                    type: 'user_directed',
                    priority: Number(input.priority || 95),
                    metadata: {
                        sessionId: input.sessionId || null,
                        userDirected: true,
                        source: input.options?.sourceChannel || 'cognitive_runtime_chat',
                        adaptiveCognition: this.system.adaptiveCognition?.assess?.(input, state) || null,
                        proceduralGuidance: this.system.proceduralMemory?.retrieve?.({ task: input.message, domain: classification.domain, limit: 3 }) || [],
                        reusableSkills: this.system.skillCompiler?.recommend?.({ task: input.message, domain: classification.domain }) || []
                    }
                }, 'user');
                const goalId = queued.goalId || queued.existingGoalId || null;
                return {
                    kind: 'agentic',
                    goal: queued.goal || (goalId ? this.system.goalPlanner.goals?.get?.(goalId) : null),
                    result: {
                        done: false,
                        queued: queued.success === true,
                        duplicate: Boolean(queued.existingGoalId),
                        goalId,
                        toolsUsed: [],
                        observations: [],
                        text: queued.success
                            ? `Queued as focused goal ${goalId}. Execution will begin when the current non-trading focus is available.`
                            : queued.existingGoalId
                                ? `This work is already queued as goal ${queued.existingGoalId}; no duplicate was created.`
                                : `The goal was not queued: ${queued.error || 'goal admission rejected it'}.`
                    }
                };
            }

            const goal = {
                id: `chat-${crypto.randomUUID()}`,
                title: String(input.message || 'User-directed task').slice(0, 160),
                description: String(input.message || ''),
                priority: input.priority || 'high',
                source: 'cognitive_runtime_chat',
                metadata: { sessionId: input.sessionId || null, userDirected: true }
            };
            const result = await this.system.agenticExecutor.execute(goal);
            return { kind: 'agentic', goal, result };
        }

        return this._infer(input, { state });
    }

    async _infer(input, runtimeContext) {
        const brain = this.system.quadBrain || this.system.brain;
        if (!brain?.reason) throw new Error('No reasoning brain is available');
        const policy = this.system.adaptiveCognition?.assess?.(input, runtimeContext?.state || {}) || null;
        const result = await brain.reason(input.prompt || input.message, {
            ...(input.options || {}),
            ...(policy ? {
                // Do NOT let the policy auto-escalate to deepThinking. ODIN's
                // multi-pass recurrence (30s+) is a user opt-in (the Brain
                // button), not something a novel/uncertain regular chat should
                // trigger — with novelty defaulting to 1 for any unseen query,
                // that made effectively EVERY fresh question deliberate and time
                // out. The user's own deepThinking (from input.options) still
                // wins. Policy still shapes temperature/evidence strictness, and
                // reserves multi-lobe scrutiny for genuinely high-stakes work.
                forceMultiLobe: policy.mode === 'adversarial' ? policy.forceMultiLobe : false,
                temperature: policy.temperature,
                cognitiveMode: policy.mode,
                uncertainty: policy.uncertainty,
                evidenceStrictness: policy.evidenceStrictness
            } : {}),
            cognitiveRuntime: runtimeContext,
            workingState: this.system.workingMemory?.state || null,
            beingState: this.system.beingKernel?.snapshot?.() || null,
            adaptiveCognition: policy,
            proceduralGuidance: this.system.proceduralMemory?.retrieve?.({ task: input.message, domain: input.domain || 'general', limit: 3 }) || [],
            reusableSkills: this.system.skillCompiler?.recommend?.({ task: input.message, domain: input.domain || 'general' }) || []
        });
        return { kind: 'inference', result };
    }

    _observe(decision, classification) {
        const result = decision.result || {};
        const observations = Array.isArray(result.observations) ? result.observations : [];
        const toolsUsed = Array.isArray(result.toolsUsed) ? result.toolsUsed : [];
        const evidence = result.completionEvidence || result.evidence || null;
        const verified = Boolean(
            result.verified === true ||
            result.done === true && (evidence?.passed === true || observations.some(item => item?.result?.success === true))
        );
        return {
            lane: classification.lane,
            toolsUsed,
            observationCount: observations.length,
            evidence,
            verified,
            success: decision.kind === 'inference' ? Boolean(textOf(result)) : verified
        };
    }

    async _learn(transaction) {
        const { observed, decision, before, after } = transaction;
        const reward = observed.verified ? 1 : observed.success ? 0.1 : -1;
        const action = observed.toolsUsed.join(',') || decision.kind;

        // Language generation alone is not an environmental transition. Only teach
        // the world model from an action that produced observable evidence.
        if (decision.kind === 'agentic' && this.system.worldModel?.observeTransition) {
            await this.system.worldModel.observeTransition({ state: before, action, nextState: after, reward }).catch(() => {});
        }
        if (this.system.learningPipeline?.logInteraction) {
            await this.system.learningPipeline.logInteraction({
                type: 'cognitive_transaction',
                agent: 'CognitiveRuntime',
                input: transaction.input.message,
                output: textOf(decision.result),
                context: { transactionId: transaction.id, lane: observed.lane },
                metadata: { success: observed.success, externallyVerified: observed.verified, reward, toolsUsed: observed.toolsUsed }
            }).catch(() => {});
        }
        this.system.workingMemory?.addAction?.(
            transaction.input.message,
            observed.verified ? 'externally verified' : observed.success ? 'observed, not externally verified' : 'failed'
        );
        await this.system.workingMemory?.save?.();
        await this.system.realityLoop?.observeTransaction?.(transaction).catch(() => {});
    }

    async _snapshot() {
        const wm = this.system?.workingMemory?.state || {};
        const active = await this.system?.goalPlanner?.getActiveGoals?.();
        const goals = Array.isArray(active) ? active : (active?.goals || []);
        return {
            focus: wm.preoccupation || null,
            openWonderCount: wm.openWonders?.length || 0,
            activeGoals: goals.slice(0, 10).map(goal => ({ id: goal.id, title: goal.title, status: goal.status })),
            being: this.system?.beingKernel?.snapshot?.() || null,
            desktopWorld: this.system?.desktopWorldModel?.getStatus?.()?.current || null,
            systemReady: Boolean(this.system?.ready)
        };
    }

    _safeInput(input) {
        return {
            message: String(input.message || '').slice(0, 4000),
            sessionId: input.sessionId || null,
            forceAgentic: input.forceAgentic === true,
            sourceChannel: input.options?.sourceChannel || null
        };
    }

    _toBrainResult(transaction) {
        const raw = transaction.decision.result;
        const text = textOf(raw) || (transaction.observed.verified ? 'Task completed and externally verified.' : 'The task ran but did not produce verified completion evidence.');
        return {
            ...(raw && typeof raw === 'object' ? raw : {}),
            text,
            response: text,
            cognitiveTransaction: {
                id: transaction.id,
                lane: transaction.classification.lane,
                domain: transaction.classification.domain,
                verified: transaction.observed.verified,
                toolsUsed: transaction.observed.toolsUsed,
                durationMs: transaction.durationMs
            }
        };
    }

    async _record(transaction) {
        await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
        await fs.appendFile(this.ledgerPath, `${JSON.stringify(transaction)}\n`, 'utf8');
    }

    async _publishState(transaction) {
        const observed = transaction.observed || {};
        const status = transaction.error ? 'failed' : observed.verified ? 'verified' : observed.success ? 'observed' : 'failed';
        await this.system.stateGateway?.publish?.('cognition', 'latest_transaction', {
            transactionId: transaction.id,
            lane: transaction.classification?.lane,
            domain: transaction.classification?.domain,
            toolsUsed: observed.toolsUsed || [],
            durationMs: transaction.durationMs,
            error: transaction.error || null
        }, {
            owner: 'CognitiveRuntime',
            source: transaction.input?.sessionId || 'cognitive-runtime',
            status,
            confidence: observed.verified ? 1 : observed.success ? 0.6 : 1,
            evidence: observed.verified ? (observed.evidence || { transactionId: transaction.id, observations: observed.observationCount }) : null
        });
    }
}

export default CognitiveRuntime;
