import crypto from 'node:crypto';

const REQUIRED_STAGES = ['observe', 'propose', 'execute', 'verify', 'learn'];

function assertResult(stage, value) {
    if (!value || typeof value !== 'object') {
        throw new TypeError(`Specialist ${stage}() must return an object`);
    }
    return value;
}

/**
 * One enforceable lifecycle for domain expertise. A specialist is not a name or
 * a prompt: it must observe, propose, pass an authority boundary, execute,
 * verify against evidence, and learn from the receipt.
 */
export class SpecialistRegistry {
    constructor({ logger = console, executionLedger = null, profileRegistry = null } = {}) {
        this.logger = logger;
        this.executionLedger = executionLedger;
        this.profileRegistry = profileRegistry;
        this.specialists = new Map();
    }

    configure({ executionLedger, profileRegistry } = {}) {
        if (executionLedger !== undefined) this.executionLedger = executionLedger;
        if (profileRegistry !== undefined) this.profileRegistry = profileRegistry;
        return this;
    }

    register(domain, specialist) {
        const key = String(domain || '').trim().toLowerCase();
        if (!key) throw new TypeError('Specialist domain is required');
        for (const stage of REQUIRED_STAGES) {
            if (typeof specialist?.[stage] !== 'function') {
                throw new TypeError(`Specialist "${key}" is missing ${stage}()`);
            }
        }
        this.specialists.set(key, Object.freeze({ ...specialist, domain: key }));
        return this;
    }

    has(domain) {
        return this.specialists.has(String(domain || '').toLowerCase());
    }

    describe() {
        return [...this.specialists.values()].map(specialist => ({
            domain: specialist.domain,
            capabilities: specialist.capabilities || [],
            actionPolicy: specialist.actionPolicy || 'explicit_authority'
        }));
    }

    async run(domain, input = {}, context = {}) {
        const specialist = this.specialists.get(String(domain || '').toLowerCase());
        if (!specialist) throw new Error(`No registered specialist for domain "${domain}"`);

        const receipt = {
            id: crypto.randomUUID(),
            domain: specialist.domain,
            startedAt: Date.now(),
            stages: {}
        };
        const ledger = context.executionLedger || this.executionLedger;
        const sessionId = context.executionSessionId || `specialist-${receipt.id}`;
        const ownsSession = !context.executionSessionId;
        const record = async (type, data) => {
            if (!ledger) return;
            try { await ledger.append(sessionId, type, data); }
            catch (error) { this.logger?.warn?.(`[SpecialistRegistry] Could not record ${type}: ${error.message}`); }
        };
        if (ledger) {
            await ledger.startSession(sessionId, {
                kind: 'specialist-lifecycle',
                specialistDomain: specialist.domain,
                actor: context.actor || 'SOMA',
                profileId: context.profileId || 'default',
                personas: context.personas || [specialist.domain],
                plugins: context.plugins || [],
                reasoningAuthority: context.reasoningAuthority || 'SOMA runtime',
                observationalOnly: true
            }).catch(error => this.logger?.warn?.(`[SpecialistRegistry] Could not start execution ledger: ${error.message}`));
        }
        try {
            receipt.stages.observation = assertResult('observe', await specialist.observe(input, context));
            await record('specialist/observation', { domain: specialist.domain, value: receipt.stages.observation });
            receipt.stages.proposal = assertResult('propose', await specialist.propose(receipt.stages.observation, input, context));
            await record('specialist/proposal', { domain: specialist.domain, value: receipt.stages.proposal });

            const requestsAction = receipt.stages.proposal.requiresAction === true;
            const authorized = requestsAction && context.actionAuthorized === true;
            receipt.authority = { requestsAction, authorized };
            receipt.stages.execution = assertResult('execute', await specialist.execute(
                receipt.stages.proposal,
                { ...context, actionAuthorized: authorized }
            ));
            await record('specialist/execution', { domain: specialist.domain, authority: receipt.authority, value: receipt.stages.execution });
            receipt.stages.verification = assertResult('verify', await specialist.verify(
                receipt.stages.execution,
                receipt.stages.observation,
                context
            ));
            await record('specialist/verification', { domain: specialist.domain, value: receipt.stages.verification });
            receipt.finishedAt = Date.now();
            receipt.durationMs = receipt.finishedAt - receipt.startedAt;
            await specialist.learn(receipt, context);
            const result = {
                kind: authorized ? 'agentic' : 'inference',
                result: receipt.stages.execution.result,
                receipt,
                verified: receipt.stages.verification.verified === true
            };
            if (ownsSession) await ledger?.endSession(sessionId, { ok: true, verified: result.verified, durationMs: receipt.durationMs }).catch(() => {});
            return result;
        } catch (error) {
            receipt.error = error.message;
            receipt.finishedAt = Date.now();
            receipt.durationMs = receipt.finishedAt - receipt.startedAt;
            try { await specialist.learn(receipt, context); } catch { /* preserve original failure */ }
            await record('specialist/error', { domain: specialist.domain, error: { name: error.name, message: error.message, code: error.code || null } });
            if (ownsSession) await ledger?.endSession(sessionId, { ok: false, error: error.message, durationMs: receipt.durationMs }).catch(() => {});
            throw error;
        }
    }
}

export function registerCoreSpecialists(registry, system) {
    const inferenceSpecialist = domain => ({
        capabilities: [`${domain}.analyze`],
        actionPolicy: 'analysis_only',
        async observe(input, context) {
            return { input, state: context.state || null, domainStatus: context.domainStatus || null };
        },
        async propose(observation) {
            return { requiresAction: false, observation };
        },
        async execute(proposal, context) {
            const result = await context.infer({
                state: proposal.observation.state,
                specialistDomain: domain,
                domainStatus: proposal.observation.domainStatus
            });
            return { executed: false, result };
        },
        async verify(execution) {
            return { verified: false, evidence: null, producedAnswer: Boolean(execution.result) };
        },
        async learn() {}
    });

    registry.register('trading', inferenceSpecialist('trading'));
    registry.register('embodiment', {
        capabilities: ['embodiment.analyze', 'embodiment.execute_typed_action'],
        actionPolicy: 'typed_action_and_explicit_authority',
        async observe(input, context) {
            return { input, state: context.state || null, body: system.embodimentRuntime?.getStatus?.() || null };
        },
        async propose(observation) {
            return { requiresAction: Boolean(observation.input.embodimentAction), observation, action: observation.input.embodimentAction || null };
        },
        async execute(proposal, context) {
            if (!proposal.requiresAction) {
                const result = await context.infer({ state: proposal.observation.state, specialistDomain: 'embodiment', embodiment: proposal.observation.body });
                return { executed: false, result };
            }
            if (!context.actionAuthorized) return { executed: false, denied: true, result: { text: 'Embodiment action denied: explicit trusted authority is required.' } };
            const result = await system.embodimentRuntime.execute(proposal.action);
            return { executed: true, result: { ...result, toolsUsed: ['embodiment_execute'], observations: [result] } };
        },
        async verify(execution) {
            const result = execution.result || {};
            return { verified: execution.executed === true && result.success === true, evidence: execution.executed ? result : null };
        },
        async learn() {}
    });
    return registry;
}

export default SpecialistRegistry;
