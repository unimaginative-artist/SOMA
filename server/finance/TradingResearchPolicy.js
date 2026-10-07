export const TRADING_ECONOMICS_VERSION = 'alpaca_crypto_spot_v2_2026_07';

export const ALPACA_CRYPTO_FEES = Object.freeze({
    makerBps: 15,
    takerBps: 25
});

export const PAPER_CAPITAL_LADDER = Object.freeze([
    { notional: 250, minClosedTrades: 0, minProfitFactor: 0, minNetPnl: -Infinity, minExpectancy: -Infinity, maxDrawdownPct: Infinity },
    { notional: 500, minClosedTrades: 30, minProfitFactor: 1.2, minNetPnl: 0, minExpectancy: 0, maxDrawdownPct: 8 },
    { notional: 1000, minClosedTrades: 60, minProfitFactor: 1.25, minNetPnl: 0, minExpectancy: 0, maxDrawdownPct: 7 },
    { notional: 2500, minClosedTrades: 100, minProfitFactor: 1.3, minNetPnl: 0, minExpectancy: 0, maxDrawdownPct: 6 },
    { notional: 5000, minClosedTrades: 150, minProfitFactor: 1.4, minNetPnl: 0, minExpectancy: 0, maxDrawdownPct: 5 }
]);

export function normalizeTradingSymbol(value = '') {
    const raw = String(value || '').trim().toUpperCase();
    return ['BTC', 'ETH', 'SOL', 'LTC', 'LINK', 'AVAX'].includes(raw) ? `${raw}-USD` : raw;
}

export function isAlpacaSpotCrypto(value = '') {
    return /^(BTC|ETH|SOL|LTC|LINK|AVAX)(-USD)?$/i.test(String(value || '').trim());
}

export function enforceVenueCompatibility(candidate = {}) {
    const next = JSON.parse(JSON.stringify(candidate || {}));
    const symbol = normalizeTradingSymbol(next.symbol || next.compiledStrategy?.symbol);
    next.symbol = symbol;
    if (next.compiledStrategy) next.compiledStrategy.symbol = symbol.replace(/-USD$/i, '');
    next.compiledStrategy = next.compiledStrategy || { dsl: {} };
    next.compiledStrategy.dsl = next.compiledStrategy.dsl || {};
    next.compiledStrategy.dsl.entry = { ...(next.compiledStrategy.dsl.entry || {}) };
    next.compiledStrategy.dsl.execution = { ...(next.compiledStrategy.dsl.execution || {}) };
    next.compiledStrategy.dsl.risk = { ...(next.compiledStrategy.dsl.risk || {}) };
    if (isAlpacaSpotCrypto(symbol)) {
        next.compiledStrategy.dsl.entry.direction = 'long_only';
        next.compiledStrategy.dsl.execution.venue = 'alpaca_crypto_spot';
        const requestedTimeframe = String(next.compiledStrategy.dsl.execution.timeframe || '1H').toUpperCase();
        next.compiledStrategy.dsl.execution.timeframe = ({
            '15MIN': '15Min', '1H': '1H', '4H': '4H', '1D': '1D'
        })[requestedTimeframe] || '1H';
        // Runtime entries remain market/taker until a durable pending-limit
        // order lifecycle exists. Research can model maker limits separately,
        // but cannot promote them into this executor yet.
        next.compiledStrategy.dsl.execution.style = next.compiledStrategy.dsl.execution.style || 'taker_market';
        next.compiledStrategy.dsl.risk.shortingAllowed = false;
    }
    next.compiledStrategy.economicsVersion = TRADING_ECONOMICS_VERSION;
    next.economicsVersion = TRADING_ECONOMICS_VERSION;
    return next;
}

export function candidateEconomicsAreCurrent(candidate = {}, report = {}) {
    return candidate?.economicsVersion === TRADING_ECONOMICS_VERSION
        && candidate?.compiledStrategy?.economicsVersion === TRADING_ECONOMICS_VERSION
        && report?.policy?.economicsVersion === TRADING_ECONOMICS_VERSION
        && report?.policy?.costModel?.takerFeeBps === ALPACA_CRYPTO_FEES.takerBps
        && report?.policy?.costModel?.makerFeeBps === ALPACA_CRYPTO_FEES.makerBps;
}

export function regimeAllowed(regime, allowedRegimes = []) {
    const allowed = Array.isArray(allowedRegimes) ? allowedRegimes.map(value => String(value).toUpperCase()) : [];
    if (!allowed.length || allowed.includes('ALL')) return true;
    const normalized = String(regime || 'UNKNOWN').toUpperCase();
    if (allowed.includes(normalized)) return true;
    if (allowed.includes('TRENDING') && normalized.startsWith('TRENDING')) return true;
    if (allowed.includes('NON_RANGING') && normalized !== 'RANGING') return true;
    return false;
}

export function summarizeClosedTradeEvidence(trades = []) {
    const rows = Array.isArray(trades) ? trades : [];
    const pnl = rows.map(row => Number(row.pnl) || 0);
    const grossProfit = pnl.reduce((sum, value) => sum + Math.max(0, value), 0);
    const grossLoss = pnl.reduce((sum, value) => sum + Math.max(0, -value), 0);
    let equity = 10000;
    let peak = equity;
    let maxDrawdownPct = 0;
    for (const value of pnl) {
        equity += value;
        peak = Math.max(peak, equity);
        maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    }
    return {
        closedTrades: rows.length,
        wins: pnl.filter(value => value > 0).length,
        netPnl: pnl.reduce((sum, value) => sum + value, 0),
        expectancy: rows.length ? pnl.reduce((sum, value) => sum + value, 0) / rows.length : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
        maxDrawdownPct
    };
}

export function paperCapitalTierForEvidence(evidence = {}) {
    const eligible = PAPER_CAPITAL_LADDER.filter(tier =>
        Number(evidence.closedTrades || 0) >= tier.minClosedTrades
        && Number(evidence.netPnl || 0) > tier.minNetPnl
        && Number(evidence.expectancy ?? (Number(evidence.netPnl || 0) / Math.max(1, Number(evidence.closedTrades || 0)))) > tier.minExpectancy
        && Number(evidence.profitFactor || 0) >= tier.minProfitFactor
        && Number(evidence.maxDrawdownPct || 0) <= tier.maxDrawdownPct
    );
    return eligible[eligible.length - 1] || PAPER_CAPITAL_LADDER[0];
}

export function exactCandidateSegment(candidate = {}, regime = null) {
    const dsl = candidate?.compiledStrategy?.dsl || {};
    return {
        symbol: normalizeTradingSymbol(candidate.symbol || candidate.compiledStrategy?.symbol),
        direction: dsl.entry?.direction || 'long_only',
        timeframe: dsl.execution?.timeframe || '1H',
        executionStyle: dsl.execution?.style || 'taker_market',
        regime: regime ? String(regime).toUpperCase() : null,
        economicsVersion: candidate.economicsVersion || candidate.compiledStrategy?.economicsVersion || null
    };
}

function normalCdf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * erf);
}

// Peter Acklam's rational approximation, sufficient for statistical gates.
function inverseNormalCdf(p) {
    const value = Math.min(1 - 1e-12, Math.max(1e-12, Number(p)));
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    if (value < 0.02425) {
        const q = Math.sqrt(-2 * Math.log(value));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
            / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (value > 0.97575) return -inverseNormalCdf(1 - value);
    const q = value - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
        / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function deflatedSharpeProbability(returns = [], trials = 1) {
    const values = (Array.isArray(returns) ? returns : []).map(Number).filter(Number.isFinite);
    const n = values.length;
    if (n < 5) return { probability: 0, sharpe: 0, benchmarkSharpe: Infinity, observations: n, trials };
    const mean = values.reduce((sum, value) => sum + value, 0) / n;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, n - 1);
    const std = Math.sqrt(variance);
    if (!(std > 0)) return { probability: mean > 0 ? 1 : 0, sharpe: 0, benchmarkSharpe: 0, observations: n, trials };
    const centered = values.map(value => (value - mean) / std);
    const skew = centered.reduce((sum, value) => sum + Math.pow(value, 3), 0) / n;
    const kurtosis = centered.reduce((sum, value) => sum + Math.pow(value, 4), 0) / n;
    const sharpe = mean / std;
    const k = Math.max(1, Number(trials) || 1);
    const gamma = 0.5772156649;
    const benchmarkSharpe = k <= 1 ? 0 : std / Math.sqrt(n) * (
        (1 - gamma) * inverseNormalCdf(1 - 1 / k)
        + gamma * inverseNormalCdf(1 - 1 / (k * Math.E))
    );
    const denominator = Math.sqrt(Math.max(1e-12, 1 - skew * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe));
    const z = (sharpe - benchmarkSharpe) * Math.sqrt(n - 1) / denominator;
    return {
        probability: normalCdf(z),
        sharpe,
        benchmarkSharpe,
        observations: n,
        trials: k,
        skew,
        kurtosis
    };
}

export function estimateFoldSelectionPbo(evaluations = []) {
    const rows = (Array.isArray(evaluations) ? evaluations : [])
        .filter(row => Array.isArray(row?.evaluation?.folds) && row.evaluation.folds.length >= 2);
    if (rows.length < 2) return { probability: 1, combinations: 0, candidates: rows.length, reason: 'insufficient_trials' };
    const foldCount = Math.min(...rows.map(row => row.evaluation.folds.length));
    const combinations = [];
    const choose = Math.max(1, Math.floor(foldCount / 2));
    function build(start, selected) {
        if (selected.length === choose) { combinations.push([...selected]); return; }
        for (let index = start; index < foldCount; index++) build(index + 1, [...selected, index]);
    }
    build(0, []);
    let overfit = 0;
    const logits = [];
    for (const inSample of combinations) {
        const inSet = new Set(inSample);
        const scored = rows.map((row, index) => ({
            index,
            inScore: row.evaluation.folds.reduce((sum, fold, foldIndex) => sum + (inSet.has(foldIndex) ? Number(fold.totalPnl) || 0 : 0), 0),
            outScore: row.evaluation.folds.reduce((sum, fold, foldIndex) => sum + (!inSet.has(foldIndex) ? Number(fold.totalPnl) || 0 : 0), 0)
        }));
        const winner = [...scored].sort((left, right) => right.inScore - left.inScore)[0];
        const rankedOut = [...scored].sort((left, right) => left.outScore - right.outScore);
        const rank = rankedOut.findIndex(row => row.index === winner.index) + 1;
        const omega = Math.min(1 - 1e-9, Math.max(1e-9, rank / (rankedOut.length + 1)));
        const logit = Math.log(omega / (1 - omega));
        logits.push(logit);
        if (logit <= 0) overfit++;
    }
    return {
        probability: combinations.length ? overfit / combinations.length : 1,
        combinations: combinations.length,
        candidates: rows.length,
        logits
    };
}
