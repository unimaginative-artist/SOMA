import crypto from 'node:crypto';
import { ecosystemPaperConfig, ecosystemCandidate, ECOSYSTEM_SYMBOLS } from './TradingEcosystemCatalog.js';
import { TRADING_ECONOMICS_VERSION } from './TradingResearchPolicy.js';

export const MISSION_POLICY_VERSION = 'paper-mission-v1';
export const MISSION_RECHECK_MS = 15 * 60_000;
const MODES = new Set(['trend', 'mean_reversion', 'range_reversion', 'rsi_reversion', 'breakout',
    'volume_momentum', 'volatility_breakout', 'trend_pullback', 'ensemble', 'slow_trend', 'scalping_confluence']);

// Research can propose a recipe, never execution authority. Freeze and validate
// the actual paper recipe before auditing it; no client-supplied config enters here.
export function missionCandidate(input) {
    const candidate = structuredClone(input);
    const dsl = candidate?.compiledStrategy?.dsl;
    if (!ECOSYSTEM_SYMBOLS.includes(candidate?.symbol) || candidate.researchOnly
        || candidate.ecosystemLane === 'grid' || !dsl || !MODES.has(dsl.entry?.mode)
        || dsl.entry?.direction !== 'long_only' || dsl.execution?.style !== 'taker_market'
        || !['1Min', '5Min', '15Min', '1H', '4H', '1D'].includes(dsl.execution?.timeframe)
        || candidate.economicsVersion !== TRADING_ECONOMICS_VERSION
        || candidate.compiledStrategy.economicsVersion !== TRADING_ECONOMICS_VERSION
        || candidate.compiledStrategy.paperOnly === false) throw new Error('Recipe is outside the supported paper mission universe');
    for (const key of ['stopLossPct', 'takeProfitPct', 'trailingStopPct']) {
        if (!Number.isFinite(dsl.exit?.[key]) || dsl.exit[key] <= 0 || dsl.exit[key] > 0.2) throw new Error(`Invalid ${key}`);
    }
    if (!Number.isFinite(dsl.exit?.maxPositionAgeMs) || dsl.exit.maxPositionAgeMs < 60_000
        || dsl.exit.maxPositionAgeMs > 7 * 86400_000) throw new Error('Missing or unsupported holding limit');
    if (String(candidate.id).startsWith('ecosystem-')) {
        const canonical = ecosystemCandidate(candidate.ecosystemLane, candidate.symbol);
        if (candidate.id !== canonical.id || candidate.key !== canonical.key || candidate.strategyId !== canonical.strategyId
            || JSON.stringify(dsl) !== JSON.stringify(canonical.compiledStrategy.dsl)) throw new Error('Catalog identity does not match its frozen recipe');
    } else {
        candidate.ecosystemLane = 'holding';
        dsl.sizing = { maxPositionPct: 0.025, maxPaperTradeValue: 250 };
        dsl.risk = { ...dsl.risk, shortingAllowed: false };
        const hash = crypto.createHash('sha256').update(JSON.stringify({ policy: MISSION_POLICY_VERSION, dsl })).digest('hex').slice(0, 12);
        candidate.id = `mission-${hash}`;
        candidate.key = `${candidate.symbol}|${candidate.strategyId}|${candidate.id}`;
        candidate.compiledStrategy.id = candidate.id;
    }
    // Also rejects an invalid catalog lane or accidental research-only recipe.
    ecosystemPaperConfig(candidate);
    return candidate;
}

export function missionConfig(candidate, runId) {
    return { ...ecosystemPaperConfig(missionCandidate(candidate)), missionRunId: runId,
        selectedBy: 'mission_autopilot', missionPolicyVersion: MISSION_POLICY_VERSION };
}

export function assessMissionCandidate({ candidate, forward, historical, data }) {
    const reasons = [];
    if (!data?.ready) reasons.push(data?.reason || 'Native market data is unavailable');
    if (!historical || !Number.isFinite(historical.netPnl)) reasons.push('No current after-cost historical audit');
    if (historical?.frictionPassed !== true) reasons.push('Profit target does not clear the modeled cost buffer');
    if (historical?.observedCloses >= 5 && historical.netPnl <= 0) reasons.push('Historical evaluation loses after costs');
    if (forward.trades >= 5 && forward.netPnl <= 0) reasons.push('Current-version paper outcomes lose after costs');
    if (forward.netPnl <= -10) reasons.push('Paper experiment loss budget reached ($10)');
    const supported = forward.trades >= 30 && forward.netPnl > 0 && forward.profitFactor >= 1.2;
    // A bounded experiment is not a profitable strategy. Ten completed trials
    // without enough promise require research/revision, not perpetual resets.
    if (!supported && forward.trades >= 10 && !(forward.netPnl > 0 && forward.profitFactor >= 1.2)) {
        reasons.push('Exploratory sample exhausted without sufficient after-cost evidence');
    }
    const historicalSupport = historical?.observedCloses >= 5 && historical.netPnl > 0;
    const evidenceClass = supported ? 'paper_supported' : historicalSupport ? 'historical_candidate' : 'paper_experiment';
    return { candidate, data, forward, historical, eligible: reasons.length === 0, reasons, evidenceClass,
        // Compare net return per unit of exposure, not dollars across horizons.
        rank: [supported ? 3 : historicalSupport ? 2 : 1,
            supported ? forward.meanNetReturn : historicalSupport ? historical.meanNetReturn : -forward.trades] };
}

export function selectMissionCandidate(rows) {
    return rows.filter(row => row.eligible).sort((a, b) =>
        b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || a.candidate.key.localeCompare(b.candidate.key))[0] || null;
}
