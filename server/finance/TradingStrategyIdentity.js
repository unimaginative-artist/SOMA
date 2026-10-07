import crypto from 'node:crypto';
import { normalizeTradingStrategyId } from './TradeAttribution.js';

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function relevantConfig(config = {}) {
    const keys = [
        'analysisIntervalMs', 'cooldownMs', 'executionStyle', 'maxOpenPositions',
        'maxPositionPct', 'minConfidence', 'preset', 'selectedBy',
        'stopLossPct', 'strategySelectionMode', 'takeProfitPct', 'timeframe',
        'trailingStopPct', 'executionPolicyVersion', 'signalLearningVersion', 'maxPositionAgeMs'
    ];
    return Object.fromEntries(keys.filter(key => config[key] !== undefined).map(key => [key, config[key]]));
}

export function strategyVersionFor({ strategyId, preset, config = {}, candidateKey, compiledStrategyId } = {}) {
    const explicit = config.strategyVersion
        || candidateKey
        || config.selectedCandidateKey
        || compiledStrategyId
        || config.compiledStrategyId
        || config.compiledCandidate?.compiledStrategy?.id;
    if (explicit) return String(explicit).trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_');
    const payload = JSON.stringify(stable({
        strategyId: normalizeTradingStrategyId(strategyId || preset || 'standard_portfolio'),
        preset: preset || null,
        config: relevantConfig(config)
    }));
    return `cfg-${crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12)}`;
}

export function buildTradingStrategyIdentity({ symbol, strategyId, preset, config = {}, candidateKey, compiledStrategyId } = {}) {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const normalizedStrategy = normalizeTradingStrategyId(strategyId || preset || config.strategyId || 'standard_portfolio');
    const strategyVersion = strategyVersionFor({
        strategyId: normalizedStrategy, preset, config, candidateKey, compiledStrategyId
    });
    return {
        symbol: normalizedSymbol,
        strategyId: normalizedStrategy,
        strategyVersion,
        key: `${normalizedSymbol}|${normalizedStrategy}|${strategyVersion}`
    };
}

export function stampTradingStrategyIdentity({ symbol, strategyId, preset, config = {}, candidateKey, compiledStrategyId } = {}) {
    const identity = buildTradingStrategyIdentity({ symbol, strategyId, preset, config, candidateKey, compiledStrategyId });
    return {
        identity,
        config: {
            ...config,
            strategyVersion: identity.strategyVersion,
            strategyIdentityKey: identity.key
        }
    };
}

export function tradingEvidenceFingerprint(stats = {}) {
    const payload = [
        stats.trades || 0, stats.wins || 0, Number(stats.pnl || 0).toFixed(8),
        stats.firstTradeId || '', stats.lastTradeId || '', stats.lastExitTime || ''
    ].join('|');
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 20);
}
