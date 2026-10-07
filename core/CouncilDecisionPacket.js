import { createHash } from 'node:crypto';

const ACTION_INTENT = /\b(?:build|change|delete|deploy|execute|fix|implement|install|modify|restart|run|trade|write)\b/i;

export function createCouncilDecisionPacket({ runId, question, answer, evidence = null, verdict = 'REVISE', lobes = [] } = {}) {
    const actionRequested = ACTION_INTENT.test(String(question || ''));
    const packet = {
        schemaVersion: 1,
        id: `council-decision-${runId}`,
        runId,
        createdAt: new Date().toISOString(),
        question: String(question || '').slice(0, 12_000),
        recommendation: String(answer || '').slice(0, 20_000),
        verifierVerdict: verdict,
        actionRequested,
        actionAuthority: false,
        requiresOperatorAuthorization: actionRequested,
        executable: false,
        allowedTools: [],
        evidenceDigest: evidence?.digest || null,
        evidenceSources: (evidence?.sources || []).slice(0, 24),
        lobeModels: Object.fromEntries((lobes || []).map(lobe => [lobe.lobe, lobe.model || null])),
        preconditions: actionRequested
            ? ['operator authorization', 'bounded goal contract', 'authorized paths/tools', 'rollback plan']
            : [],
        falsificationTests: [
            'Verify every material factual claim against its cited evidence source.',
            actionRequested
                ? 'Execute only through the governed agentic executor and require artifact/test receipts.'
                : 'Compare the recommendation with the eventual observed outcome.'
        ]
    };
    packet.digest = createHash('sha256').update(JSON.stringify(packet)).digest('hex');
    return packet;
}

export function authorizeCouncilDecision(packet, { operator, allowedTools = [], allowedWritePaths = [], successCriteria = [] } = {}) {
    if (!packet?.digest || !operator) throw new Error('Council decisions require explicit operator authorization');
    return {
        ...packet,
        operatorAuthorization: { operator: String(operator), at: new Date().toISOString() },
        executable: true,
        actionAuthority: false,
        goalContract: {
            strict: true,
            allowedTools: [...new Set(allowedTools.map(String))],
            allowedWritePaths: [...new Set(allowedWritePaths.map(String))],
            successCriteria: successCriteria.map(String)
        }
    };
}
