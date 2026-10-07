export const SELF_MODIFICATION_PROTOCOL_VERSION = 2;

// Capability token used to distinguish the authoritative pipeline's internal
// EngineeringSwarm call from legacy/direct callers. It is a process boundary,
// not a security boundary; path protection and approval still apply downstream.
export const SELF_MODIFICATION_INTERNAL = Symbol('soma.self-modification.internal');
// Dispatch-only marker for a hash-pinned RSI repair plan. The executor may
// attach it only after revalidating the exact ASI goal and sourced plan; MAX,
// NEMESIS, container tests and governance still decide whether it is safe.
export const GOVERNED_RSI_REPAIR_INTERNAL = Symbol('soma.rsi-repair.internal');

export const SelfModificationDecision = Object.freeze({
    APPROVE: 'approve',
    REJECT: 'reject',
    DEFER: 'defer',
    UNAVAILABLE: 'unavailable',
    ERROR: 'error',
});

const RETRYABLE = new Set([
    SelfModificationDecision.DEFER,
    SelfModificationDecision.UNAVAILABLE,
    SelfModificationDecision.ERROR,
]);

export function createSelfModificationVerdict({
    decision,
    stage,
    authority = null,
    reason = '',
    evidence = null,
    raw = null,
} = {}) {
    const normalizedDecision = Object.values(SelfModificationDecision).includes(decision)
        ? decision
        : SelfModificationDecision.ERROR;
    return {
        protocolVersion: SELF_MODIFICATION_PROTOCOL_VERSION,
        decision: normalizedDecision,
        stage: stage || 'unknown',
        authority,
        approved: normalizedDecision === SelfModificationDecision.APPROVE,
        retryable: RETRYABLE.has(normalizedDecision),
        terminal: normalizedDecision === SelfModificationDecision.APPROVE
            || normalizedDecision === SelfModificationDecision.REJECT,
        reason: String(reason || '').trim() || 'No reason supplied',
        evidence,
        raw,
        timestamp: new Date().toISOString(),
    };
}

export function parseMaxApprovalVerdict(response) {
    const text = String(
        response?.response
        ?? response?.text
        ?? response?.message
        ?? (typeof response === 'string' ? response : '')
    ).trim();

    if (response?.success === false) {
        return createSelfModificationVerdict({
            decision: SelfModificationDecision.UNAVAILABLE,
            stage: 'authorization',
            authority: 'max',
            reason: response.error || response.message || 'MAX returned an unsuccessful response',
            raw: text,
        });
    }

    // Rejection wins if a malformed answer contains contradictory markers.
    if (/\[REJECTED\]/i.test(text) || /(?:^|\n)\s*REJECTED\s*(?:\n|$)/i.test(text)) {
        return createSelfModificationVerdict({
            decision: SelfModificationDecision.REJECT,
            stage: 'authorization',
            authority: 'max',
            reason: text,
            raw: text,
        });
    }
    if (/\[(?:DEFERRED|RETRY)\]/i.test(text) || /(?:^|\n)\s*(?:DEFERRED|RETRY)\s*(?:\n|$)/i.test(text)) {
        return createSelfModificationVerdict({
            decision: SelfModificationDecision.DEFER,
            stage: 'authorization',
            authority: 'max',
            reason: text,
            raw: text,
        });
    }
    if (/^\[APPROVED\]/i.test(text) || /^APPROVED\s*(?:\n|$)/i.test(text)) {
        return createSelfModificationVerdict({
            decision: SelfModificationDecision.APPROVE,
            stage: 'authorization',
            authority: 'max',
            reason: text,
            raw: text,
        });
    }

    return createSelfModificationVerdict({
        decision: SelfModificationDecision.DEFER,
        stage: 'authorization',
        authority: 'max',
        reason: text
            ? 'MAX response was ambiguous; a typed verdict is required'
            : 'MAX returned no verdict',
        raw: text,
    });
}

export function stageReceipt(stage, decision, details = {}) {
    return {
        stage,
        decision,
        timestamp: new Date().toISOString(),
        ...details,
    };
}

export function sourceMutationCommandReason(command = '') {
    const value = String(command || '');
    if (/\bgit\s+(?:commit|push|tag|merge|rebase)\b/i.test(value)) {
        return 'Git promotion commands are owned by the self-modification promotion stage';
    }
    if (/\bnpm\s+(?:install|uninstall|update|link)\b|\b(?:pnpm|yarn)\s+(?:add|remove|install|update)\b/i.test(value)) {
        return 'Dependency mutations require an explicit reviewed change';
    }

    const mutationVerb = /\b(?:set-content|add-content|out-file|copy-item|move-item|rename-item|remove-item|sed\s+-i|perl\s+-pi|apply_patch)\b|(?:^|\s)(?:>|>>)(?:\s|$)|\b(?:writeFile|writeFileSync|appendFile|appendFileSync)\b/i;
    const sourceTarget = /(?:^|[\\/])(?:core|arbiters|server|daemons|config|frontend)(?:[\\/])|\.(?:js|cjs|mjs|ts|tsx|jsx|json)\b/i;
    if (mutationVerb.test(value) && sourceTarget.test(value)) {
        return 'Shell-based source mutation is forbidden; use modify_code';
    }
    return null;
}
