function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function correlation(left = [], right = []) {
    const length = Math.min(left.length, right.length);
    if (length < 10) return 0;
    const a = left.slice(-length).map(Number);
    const b = right.slice(-length).map(Number);
    const meanA = a.reduce((sum, value) => sum + value, 0) / length;
    const meanB = b.reduce((sum, value) => sum + value, 0) / length;
    let covariance = 0;
    let varianceA = 0;
    let varianceB = 0;
    for (let index = 0; index < length; index++) {
        const da = a[index] - meanA;
        const db = b[index] - meanB;
        covariance += da * db;
        varianceA += da * da;
        varianceB += db * db;
    }
    return varianceA > 0 && varianceB > 0 ? covariance / Math.sqrt(varianceA * varianceB) : 0;
}

export function buildShadowPortfolioPlan(audits = [], {
    minimumTrades = 100,
    maximumCandidates = 10,
    maximumWeight = 0.25,
    maximumCorrelation = 0.8
} = {}) {
    const observation = Array.from(new Map(audits.map(row => ({
        candidateId: row.candidate?.id || row.candidate?.key,
        strategyId: row.candidate?.strategyId,
        symbol: row.candidate?.symbol,
        mode: row.candidate?.compiledStrategy?.dsl?.entry?.mode,
        shadow: row.shadow
    })).filter(row => row.candidateId).map(row => [row.candidateId, row])).values());
    const mature = observation.filter(row =>
        finite(row.shadow?.prospectiveClosedTrades) >= minimumTrades
        && finite(row.shadow?.netPnl) > 0
        && finite(row.shadow?.profitFactor) >= 1.2
        && finite(row.shadow?.returnInterval?.lower95, -Infinity) > 0
    ).sort((left, right) => finite(right.shadow.netPnl) - finite(left.shadow.netPnl));
    const selected = [];
    for (const candidate of mature) {
        if (selected.length >= maximumCandidates) break;
        const tooCorrelated = selected.some(existing =>
            Math.abs(correlation(candidate.shadow.recentReturns, existing.shadow.recentReturns)) > maximumCorrelation
        );
        if (!tooCorrelated) selected.push(candidate);
    }
    const raw = selected.map(row => Math.max(1e-9,
        finite(row.shadow.returnInterval.mean) * Math.min(3, finite(row.shadow.profitFactor))
        / Math.max(0.001, finite(row.shadow.returnVolatility, 1))
    ));
    const total = raw.reduce((sum, value) => sum + value, 0);
    const weights = raw.map(value => Math.min(maximumWeight, value / Math.max(1e-9, total)));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    return {
        paperOnly: true,
        status: selected.length ? 'eligible_for_portfolio_shadow' : 'collecting_prospective_evidence',
        minimumTrades,
        observedCandidates: observation.length,
        matureCandidates: mature.length,
        cashWeight: Number(Math.max(0, 1 - weightTotal).toFixed(6)),
        allocations: selected.map((row, index) => ({
            candidateId: row.candidateId, strategyId: row.strategyId, symbol: row.symbol,
            mode: row.mode, weight: Number(weights[index].toFixed(6))
        }))
    };
}

export default buildShadowPortfolioPlan;
