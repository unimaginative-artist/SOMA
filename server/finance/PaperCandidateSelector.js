import {
    candidateEconomicsAreCurrent,
    isAlpacaSpotCrypto,
    PAPER_CAPITAL_LADDER,
    TRADING_ECONOMICS_VERSION
} from './TradingResearchPolicy.js';

export const OFFLINE_PAPER_CANARY_MAX_TRADE_VALUE = 5000;

export function selectExecutablePaperCandidate(report = {}) {
    const queue = Array.isArray(report.paperQueue) ? report.paperQueue : [];
    return queue.find(candidate =>
        candidate?.state === 'paper_candidate'
        // BeeBots paper fills use OKX perpetual quotes and a separate executor.
        // A generic Alpaca spot DSL is not the same executable strategy.
        && !String(candidate?.strategyId || '').startsWith('beebots_')
        && candidate?.strategyId
        && candidate?.symbol
        && candidate?.compiledStrategy?.paperOnly !== false
        && candidateEconomicsAreCurrent(candidate, report)
        && candidate?.compiledStrategy?.dsl?.execution?.style === 'taker_market'
        && (!isAlpacaSpotCrypto(candidate.symbol)
            || candidate?.compiledStrategy?.dsl?.entry?.direction === 'long_only')
    ) || null;
}

export function selectQualifiedOfflinePaperCandidate(report = {}) {
    const candidates = Array.isArray(report.qualifiedCandidates) ? report.qualifiedCandidates : [];
    const row = candidates.find(item => item?.qualified === true
        && item?.evaluation?.supported === true
        && item?.finalHoldout?.supported === true
        && item?.finalHoldout?.segmentGatePassed === true
        && item?.finalHoldout?.excessPnlVsNoTrade > 0
        && item?.finalHoldout?.deflatedSharpe?.probability >= 0.95
        && item?.finalHoldout?.pbo?.probability <= 0.5
        && item?.finalHoldout?.executionStyle === 'taker_market'
        && item?.candidate?.compiledStrategy?.paperOnly !== false
        && item?.candidate?.strategyId
        && item?.candidate?.symbol
        && candidateEconomicsAreCurrent(item.candidate, report)
        && (!isAlpacaSpotCrypto(item.candidate.symbol)
            || item.candidate?.compiledStrategy?.dsl?.entry?.direction === 'long_only'));
    if (!row) return null;
    const candidateSuffix = String(row.candidate.id || row.candidate.key || 'candidate')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-10)
        .toLowerCase();
    return {
        ...row.candidate,
        baseStrategyId: row.candidate.strategyId,
        strategyId: `paper_canary_${row.candidate.strategyId}_${candidateSuffix}`,
        economicsVersion: TRADING_ECONOMICS_VERSION,
        state: 'paper_candidate',
        paperCanaryMaxTradeValue: OFFLINE_PAPER_CANARY_MAX_TRADE_VALUE,
        offlineEvidence: { development: row.evaluation, forward: row.finalHoldout },
        source: 'offline_forward_qualified'
    };
}

export function isAuthorizedPaperCandidateSession({ config = {}, activeStrategy = null, symbol = null, strategyId = null } = {}) {
    const expectedSource = config.selectedBy === 'mission_control_sim_to_live'
        ? 'sim_to_live'
        : config.selectedBy === 'offline_forward_qualified'
            ? 'offline_forward_qualified'
            : null;
    if (!expectedSource) return true;
    if (!activeStrategy || activeStrategy.source !== expectedSource) return false;
    const expectedSymbol = String(symbol || '').trim().toUpperCase();
    const activeSymbol = String(activeStrategy.symbol || '').trim().toUpperCase();
    const expectedStrategy = String(strategyId || '').trim().toLowerCase();
    const activeId = String(activeStrategy.strategyId || '').trim().toLowerCase();
    if (!expectedSymbol || activeSymbol !== expectedSymbol) return false;
    if (!expectedStrategy || activeId !== expectedStrategy) return false;
    if (config.selectedCandidateKey && activeStrategy.candidateKey
        && config.selectedCandidateKey !== activeStrategy.candidateKey) return false;
    return true;
}

export function buildTradingResearchStatus({ simToLiveReport = null, offlineReport = null, runtime = null } = {}) {
    const queuedCandidate = simToLiveReport ? selectExecutablePaperCandidate(simToLiveReport) : null;
    const offlineCandidate = offlineReport ? selectQualifiedOfflinePaperCandidate(offlineReport) : null;
    const candidate = queuedCandidate || offlineCandidate;
    const active = runtime?.activeStrategy || null;
    const source = queuedCandidate ? 'sim_to_live' : offlineCandidate ? 'offline_forward_qualified' : null;
    return {
        mode: 'offline_research_to_paper_canary',
        isolatedFromGeneralAutonomy: true,
        livePromotionAllowed: false,
        candidateAvailable: Boolean(candidate),
        candidate: candidate ? {
            id: candidate.id || null,
            strategyId: candidate.strategyId,
            symbol: candidate.symbol,
            source,
            paperOnly: candidate.compiledStrategy?.paperOnly !== false,
            maxStartingNotional: PAPER_CAPITAL_LADDER[0].notional,
            maxQualifiedNotional: candidate.paperCanaryMaxTradeValue || OFFLINE_PAPER_CANARY_MAX_TRADE_VALUE
        } : null,
        activePaperCandidate: active && ['sim_to_live', 'offline_forward_qualified'].includes(active.source) ? {
            strategyId: active.strategyId,
            symbol: active.symbol,
            source: active.source
        } : null,
        blockedReason: candidate ? null : 'no_candidate_passed_current_economics_and_frozen_forward_gates'
    };
}

export default selectExecutablePaperCandidate;
