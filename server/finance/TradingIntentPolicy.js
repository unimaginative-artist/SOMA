// A persisted stop is authoritative for new entries, including after a crash.
// Open positions may still need an exit-only recovery session.
export function normalizeTradingIntent(data = {}, actualState = 'stopped') {
    const engaged = data.engaged && typeof data.engaged === 'object' ? data.engaged : {};
    const hasEngaged = Object.keys(engaged).length > 0;
    const desiredState = ['running', 'stopped', 'paused'].includes(data.desiredState)
        ? data.desiredState : hasEngaged ? 'running' : 'stopped';
    return {
        desiredState,
        actualState,
        autoResume: desiredState === 'running' && data.autoResume !== false,
        // Separate authority for the audited, simulated paper mission.
        paperMissionEnabled: data.paperMissionEnabled === true,
        engaged,
        pausedSymbols: data.pausedSymbols && typeof data.pausedSymbols === 'object' ? data.pausedSymbols : {},
        updatedAt: data.updatedAt || null
    };
}

export function allowsAutonomousEntries(intent = {}) {
    return intent.desiredState === 'running' && intent.autoResume === true;
}

export function allowsScopedPaperMissionEntry(intent = {}, config = {}, candidateAuthorized = false) {
    return intent.paperMissionEnabled === true && candidateAuthorized === true
        && config.selectedBy === 'mission_autopilot' && config.paperMode === true
        && config.forcePaper === true && config.liveTradingEnabled === false
        && typeof config.missionRunId === 'string' && config.missionRunId.length > 0;
}

export function resumeMode(intent = {}, hasOpenPosition = false) {
    if (allowsAutonomousEntries(intent)) return 'normal';
    return hasOpenPosition ? 'protect_exits_only' : 'skip';
}

export function stopTradingIntent(intent = {}, { stopped = [], protecting = [], now = new Date().toISOString() } = {}) {
    const pausedSymbols = { ...(intent.pausedSymbols || {}) };
    for (const symbol of stopped) pausedSymbols[symbol] = now;
    return {
        ...intent,
        desiredState: 'stopped',
        actualState: protecting.length ? 'paused' : 'stopped',
        autoResume: false,
        paperMissionEnabled: false,
        pausedSymbols
    };
}
