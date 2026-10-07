export function getOpenStrategyIds(aggregate = {}) {
    const instances = Array.isArray(aggregate?.instances) ? aggregate.instances : [aggregate];
    return instances.flatMap(instance => Array.isArray(instance?.openPositions) ? instance.openPositions : [])
        .map(position => String(position?.attribution?.strategyId || position?.strategy || '').trim().toLowerCase())
        .filter(Boolean);
}

export function hasOpenPositions(aggregate = {}) {
    const instances = Array.isArray(aggregate?.instances) ? aggregate.instances : [aggregate];
    return instances.some(instance =>
        (Array.isArray(instance?.openPositions) && instance.openPositions.length > 0)
        || Number(instance?.paperPortfolio?.positionCount || 0) > 0
    );
}
