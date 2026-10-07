export function normalizeTradingStrategyId(value) {
    return String(value || 'unknown')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'unknown';
}

export function resolvePositionStrategyId(paperPosition, runtimePosition, fallbackStrategyId) {
    return normalizeTradingStrategyId(
        paperPosition?.attribution?.strategyId
        || runtimePosition?.attribution?.strategyId
        || paperPosition?.strategy
        || runtimePosition?.strategy
        || fallbackStrategyId
        || 'standard_portfolio'
    );
}

export function resolveActiveStrategyId({ strategySelectionMode, preset, runtimeProfile, config } = {}) {
    const manualPreset = String(strategySelectionMode || 'auto').toLowerCase() !== 'auto' ? preset : null;
    return normalizeTradingStrategyId(
        manualPreset
        || runtimeProfile?.activeStrategy?.strategyId
        || runtimeProfile?.preset
        || config?.strategyId
        || 'standard_portfolio'
    );
}
