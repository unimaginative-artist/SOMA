import { BaseArbiterV4 } from './BaseArbiter.js';
import {
    SelfModificationDecision,
    createSelfModificationVerdict,
    parseMaxApprovalVerdict,
} from '../core/SelfModificationProtocol.js';

export class MaxApprovalShim extends BaseArbiterV4 {
    constructor(config = {}) {
        super(config);
        this.name = 'MaxApprovalShim';
        this.logger = config.logger || console;
        this.rootPath = config.rootPath || process.cwd();
    }

    async initialize(deps = {}) {
        await super.initialize(deps);
        this.maxAgentBridge = deps.maxAgentBridge || this.system?.maxBridge || this.system?.maxAgentBridge;
        // Defense-in-depth: if the bridge was never wired into system, fall back to
        // the authenticated singleton so the gate delegates to MAX instead of
        // silently rejecting every modification.
        if (!this.maxAgentBridge) {
            try {
                const { default: maxBridgeSingleton } = await import('../core/MaxAgentBridge.js');
                this.maxAgentBridge = maxBridgeSingleton;
            } catch (e) {
                this.logger.warn?.(`[${this.name}] Could not load MaxAgentBridge singleton: ${e.message}`);
            }
        }
        this.logger.info?.(`[${this.name}] Initialized — delegating self-mod review to MAX (bridge ${this.maxAgentBridge ? 'ready' : 'MISSING'}); executable evidence is checked by the candidate/governance pipeline`);
    }

    async requestApproval(operation = {}) {
        if (!this.maxAgentBridge) {
            this.logger.warn?.(`[${this.name}] MaxAgentBridge not found. Cannot delegate approval.`);
            return createSelfModificationVerdict({
                decision: SelfModificationDecision.UNAVAILABLE,
                stage: 'authorization',
                authority: 'max',
                reason: 'MaxAgentBridge unavailable',
            });
        }

        const { filepath, request } = operation;

        const messageToMax = `
SYSTEM OVERRIDE NOTIFICATION:
SOMA is attempting an autonomous self-modification on the following file:
File: ${filepath}

Modification Request:
${request}

You (MAX) are the delegated preflight reviewer for this modification. Owner remains the constitutional authority and can override or require human review through SOMA's authority settings.
Review the requested change.
If it is safe and logically sound, reply with exactly [APPROVED] and a brief reason.
If it is dangerous or malformed, reply with exactly [REJECTED] and a brief reason.
If evidence or service availability is insufficient, reply with exactly [DEFERRED] and what is needed next.
`;

        this.logger.info?.(`[${this.name}] Delegating code modification approval to MAX for ${filepath}`);

        try {
            const maxResponse = await this.maxAgentBridge.chat(messageToMax);
            const text = maxResponse?.response || maxResponse?.text || maxResponse?.message || JSON.stringify(maxResponse);

            this.logger.info?.(`[${this.name}] MAX returned a ${text.length}-character review`);

            const verdict = parseMaxApprovalVerdict(maxResponse);
            const provider = maxResponse?.provider || this.maxAgentBridge?.getLastHealth?.()?.provider || 'max-service';
            const model = maxResponse?.model || this.maxAgentBridge?.getLastHealth?.()?.model || 'undisclosed';
            verdict.provider = provider;
            verdict.model = model;
            verdict.reviewerFingerprint = `max:${provider}:${model}`;

            if (verdict.decision === SelfModificationDecision.APPROVE) {
                this.logger.info?.(`[${this.name}] MAX APPROVED the modification.`);
            } else if (verdict.decision === SelfModificationDecision.REJECT) {
                this.logger.warn?.(`[${this.name}] MAX REJECTED the modification.`);
            } else {
                this.logger.warn?.(`[${this.name}] MAX did not produce a terminal verdict (${verdict.decision}). Deferring.`);
            }
            return verdict;
        } catch (err) {
            this.logger.error?.(`[${this.name}] Error communicating with MAX: ${err.message}`);
            return createSelfModificationVerdict({
                decision: SelfModificationDecision.UNAVAILABLE,
                stage: 'authorization',
                authority: 'max',
                reason: `Error bridging to MAX: ${err.message}`,
            });
        }
    }
}
