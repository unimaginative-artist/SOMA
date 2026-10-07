import { normalizeTradingSymbol } from './TradingResearchPolicy.js';

/**
 * Boot-time trading is an executor for qualified research, not a strategy
 * selector.  Returning a closed plan here prevents a missing research winner
 * from silently falling through to a generic preset.
 */
export function buildQualifiedPaperAutostartPlan({ selection = null, requestedSymbols = [] } = {}) {
    const requested = [...new Set((requestedSymbols || [])
        .map(normalizeTradingSymbol)
        .filter(Boolean))];
    const candidate = selection?.candidate || null;
    const symbol = normalizeTradingSymbol(candidate?.symbol);
    const strategyId = String(candidate?.strategyId || '').trim().toLowerCase();

    if (!candidate || !symbol || !strategyId || !selection?.selectedBy) {
        return {
            allowed: false,
            reason: 'no_qualified_paper_candidate',
            requestedSymbols: requested
        };
    }

    return {
        allowed: true,
        reason: 'qualified_paper_candidate',
        requestedSymbols: requested,
        symbol,
        strategyId,
        candidateId: candidate.id || null,
        candidateKey: candidate.key || null,
        selectedBy: selection.selectedBy
    };
}

export default buildQualifiedPaperAutostartPlan;
