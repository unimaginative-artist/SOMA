// This is an operator-facing snapshot, not a substitute for an end-to-end
// probe. In particular, object existence must not be called a working bridge.
export function buildOperationalReadiness(system = {}) {
    const phase = system.bootStatus || {};
    const discord = system.discordArbiter;
    const executor = system.agenticExecutor;
    const mnemonic = system.mnemonicArbiter || system.mnemonic;
    return {
        generatedAt: new Date().toISOString(),
        core: { state: system.ready ? 'ready' : 'initializing' },
        extended: {
            state: phase.extended || 'unknown',
            error: phase.extendedError || null
        },
        discord: {
            state: !discord ? (phase.extended === 'loading' || phase.extended === 'pending' ? 'loading' : 'unavailable')
                : discord.connected ? 'connected' : 'disconnected',
            lastError: discord?.lastError || null
        },
        memory: {
            state: !mnemonic ? 'unavailable' : mnemonic.degraded === true ? 'degraded' : 'available',
            reason: mnemonic?.degradedReason || null
        },
        inspection: {
            state: typeof executor?.forkReadOnlyInspection === 'function' ? 'available'
                : executor?.execute ? 'shared_executor_only' : 'unavailable'
        },
        engineering: {
            state: !executor?.execute ? 'unavailable' : executor._executionActive ? 'busy' : 'available'
        },
        max: {
            state: system.maxBridge ? 'configured_unprobed' : 'unavailable',
            note: 'Use the MAX health and a verified bridge request to establish connectivity.'
        }
    };
}
