export function buildExecutionStoppedMessage({ symbol, reason = 'operator_requested', research = {} } = {}) {
    const normalizedSymbol = String(symbol || 'unknown').toUpperCase();
    const pruned = String(reason).startsWith('portfolio_pruner:');
    const candidateState = research.candidateAvailable
        ? 'A qualified candidate is available for reconciliation.'
        : `No candidate currently qualifies: ${research.blockedReason || 'research gates have not passed'}.`;
    return {
        title: pruned ? '✂️ Paper Engine Pruned · Research Active' : '🔴 Execution Stopped · Research Active',
        body: pruned
            ? `Paper execution on **${normalizedSymbol}** was automatically pruned using its recorded results (${String(reason).replace(/^portfolio_pruner:\s*/, '')}). It will remain quarantined from canary restarts while research continues. ${candidateState}`
            : `Paper execution stopped on **${normalizedSymbol}** (${reason}). Research remains active. ${candidateState}`,
        color: pruned ? 15844367 : 13632027
    };
}

export default buildExecutionStoppedMessage;
