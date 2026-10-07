function timestamp(bar = {}) {
    const numeric = Number(bar.timestamp ?? bar.t ?? bar.time);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(bar.timestamp ?? bar.t ?? bar.time);
    return Number.isFinite(parsed) ? parsed : 0;
}

function close(bar = {}) {
    const value = Number(bar.close ?? bar.c);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function trailingReturn(rows, index, lookback) {
    const current = close(rows[index]);
    const previous = close(rows[Math.max(0, index - lookback)]);
    return current && previous ? current / previous - 1 : 0;
}

function latestIndexAtOrBefore(rows, targetTimestamp, start = 0) {
    let index = Math.max(0, start);
    while (index + 1 < rows.length && timestamp(rows[index + 1]) <= targetTimestamp) index++;
    while (index > 0 && timestamp(rows[index]) > targetTimestamp) index--;
    return timestamp(rows[index]) <= targetTimestamp ? index : -1;
}

export function enrichBarsWithCrossAssetContext({
    bars = [],
    targetSymbol,
    contextSeries = {},
    fundingSeries = [],
    lookbackBars = 24
} = {}) {
    const orderedTarget = [...bars].sort((a, b) => timestamp(a) - timestamp(b));
    const series = Object.fromEntries(Object.entries(contextSeries)
        .map(([symbol, rows]) => [symbol, [...(rows || [])].sort((a, b) => timestamp(a) - timestamp(b))])
        .filter(([, rows]) => rows.length));
    const cursors = Object.fromEntries(Object.keys(series).map(symbol => [symbol, 0]));
    const funding = [...fundingSeries].sort((a, b) => timestamp(a) - timestamp(b));
    let fundingCursor = 0;
    return orderedTarget.map((bar, targetIndex) => {
        const time = timestamp(bar);
        const returns = [];
        let benchmarkMomentum = 0;
        for (const [symbol, rows] of Object.entries(series)) {
            const index = latestIndexAtOrBefore(rows, time, cursors[symbol]);
            if (index < 0) continue;
            cursors[symbol] = index;
            const value = trailingReturn(rows, index, lookbackBars);
            returns.push(value);
            if (symbol === 'BTC-USD') benchmarkMomentum = value;
        }
        while (fundingCursor + 1 < funding.length && timestamp(funding[fundingCursor + 1]) <= time) fundingCursor++;
        const currentFunding = funding.length && timestamp(funding[fundingCursor]) <= time ? funding[fundingCursor] : null;
        const targetMomentum = trailingReturn(orderedTarget, targetIndex, lookbackBars);
        const marketMomentum = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
        const marketBreadth = returns.length ? returns.filter(value => value > 0).length / returns.length : 0.5;
        const dispersion = returns.length
            ? Math.sqrt(returns.reduce((sum, value) => sum + Math.pow(value - marketMomentum, 2), 0) / returns.length)
            : 0;
        return {
            ...bar,
            context: {
                causalAt: time,
                targetSymbol,
                contextAssets: returns.length,
                targetMomentum,
                benchmarkMomentum,
                relativeMomentum: targetMomentum - benchmarkMomentum,
                marketMomentum,
                marketBreadth,
                dispersion,
                fundingRate: Number(currentFunding?.fundingRate || 0),
                fundingSource: currentFunding?.source || null,
                fundingTimestamp: currentFunding ? timestamp(currentFunding) : null
            }
        };
    });
}

export function auditContextCausality(bars = []) {
    const failures = bars.flatMap((bar, index) => {
        const barTime = timestamp(bar);
        const contextTime = Number(bar?.context?.causalAt || 0);
        const fundingTime = Number(bar?.context?.fundingTimestamp || 0);
        const rows = [];
        if (contextTime > barTime) rows.push(`future_context:${index}`);
        if (fundingTime > barTime) rows.push(`future_funding:${index}`);
        return rows;
    });
    return { passed: failures.length === 0, failures };
}

export default enrichBarsWithCrossAssetContext;
