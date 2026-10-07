// Persist actual execution mode after a successful start. A caller can omit
// paperMode even though Mission Control forces paper; do not lose that fact.
export function buildTradingResumeConfig(config = {}, instance = null) {
    const paperMode = typeof instance?.paperMode === 'boolean'
        ? instance.paperMode : config.paperMode === true || config.forcePaper === true;
    const result = { ...config, paperMode, forcePaper: paperMode };
    const capital = Number(instance?._paperPortfolio?.initialBalance);
    if (paperMode && Number.isFinite(capital) && capital > 0) result.initialBalance = capital;
    return result;
}
