import crypto from 'node:crypto';
import { TRADING_ECONOMICS_VERSION } from './TradingResearchPolicy.js';

export const ECOSYSTEM_VERSION = 'paper-ecosystem-v2-2026-09-09';
export const ECOSYSTEM_SYMBOLS = Object.freeze(['SOL-USD', 'BTC-USD', 'ETH-USD']);
export const ECOSYSTEM_LANES = Object.freeze([
    { id: 'holding', label: 'Holding', strategyId: 'standard_portfolio', timeframe: '1H', researchOnly: false, description: 'Deliberate trend experiment; up to eight hours per position.' },
    { id: 'fast', label: 'Fast confluence', strategyId: 'scalping_confluence', timeframe: '1Min', researchOnly: false, description: 'Completed-candle Bollinger / RSI / MACD; fractional paper positions.' },
    { id: 'grid', label: 'Grid research', strategyId: 'grid_research', timeframe: '5Min', researchOnly: true, description: 'Inventory and drawdown experiment. Execution remains disabled.' }
]);

export function ecosystemLane(id) {
    const lane = ECOSYSTEM_LANES.find(lane => lane.id === id);
    if (!lane) throw new Error('Unknown trading lane');
    return lane;
}

export function ecosystemSymbol(input) {
    const symbol = String(input || '').trim().toUpperCase().replace('/', '-');
    if (!ECOSYSTEM_SYMBOLS.includes(symbol)) throw new Error('Choose SOL-USD, BTC-USD, or ETH-USD');
    return symbol;
}

export function ecosystemCandidate(laneId, input, preferences = {}) {
    const lane = ecosystemLane(laneId);
    const symbol = ecosystemSymbol(input);
    const fast = lane.id === 'fast';
    const dsl = {
        entry: { mode: fast ? 'scalping_confluence' : 'trend', direction: 'long_only',
            fastWindow: 12, slowWindow: 36, minMomentum: 0.0025, allowedRegimes: ['ALL'],
            ...(fast ? { rsiBuyZone: Math.min(45, Math.max(25, Number(preferences.rsiBuyZone) || 45)),
                requiredSignals: Math.min(3, Math.max(2, Number(preferences.requiredSignals) || 2)) } : {}) },
        exit: { stopLossPct: fast ? 0.01 : 0.02, takeProfitPct: fast ? 0.02 : 0.05,
            trailingStopPct: fast ? 0.008 : 0.015, maxPositionAgeMs: fast ? 20 * 60000 : 8 * 3600000 },
        sizing: { maxPositionPct: 0.025, maxPaperTradeValue: 250 },
        execution: { timeframe: lane.timeframe, style: 'taker_market', venue: 'alpaca_crypto_spot' },
        risk: { shortingAllowed: false },
        ...(lane.researchOnly ? { grid: { initialCapital: 1000, gridLevels: 8, gridSpacingPct: 0.0065,
            orderNotional: 50, makerFeeBps: 15, maxInventoryLevels: 6, maxDrawdownPct: 0.025 } } : {})
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify({ version: ECOSYSTEM_VERSION, laneId, dsl })).digest('hex').slice(0, 12);
    const id = `ecosystem-${laneId}-${hash}`;
    return { id, key: `${symbol}|${lane.strategyId}|${id}`, symbol, strategyId: lane.strategyId,
        economicsVersion: TRADING_ECONOMICS_VERSION, ecosystemLane: laneId, researchOnly: lane.researchOnly,
        compiledStrategy: { id, strategyId: lane.strategyId, paperOnly: true, economicsVersion: TRADING_ECONOMICS_VERSION, dsl } };
}

export function ecosystemPaperConfig(candidate) {
    if (candidate.researchOnly || candidate.ecosystemLane === 'grid') throw new Error('Grid is research-only; execution is disabled');
    const dsl = candidate.compiledStrategy.dsl;
    return { ...dsl.exit, ...dsl.sizing, timeframe: dsl.execution.timeframe,
        compiledCandidate: candidate, compiledStrategyId: candidate.id, strategyVersion: candidate.id,
        selectedBy: 'trading_ecosystem_paper', ecosystemLane: candidate.ecosystemLane,
        executionPolicyVersion: ECOSYSTEM_VERSION, signalLearningVersion: 2,
        selectedCandidateKey: candidate.key, strategySelectionMode: 'manual', executionStyle: 'taker_market',
        forcePaper: true, paperMode: true, liveEligible: false, liveTradingEnabled: false,
        minConfidence: 0.62, maxOpenPositions: 1, analysisIntervalMs: 60000,
        cooldownMs: candidate.ecosystemLane === 'fast' ? 60000 : 30 * 60000,
        maxTradeValue: 250, initialBalance: 10000, learningCanary: true };
}
