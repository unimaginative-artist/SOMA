export const PAPER_EXECUTION_POLICY_VERSION = 'paper-learning-v2-2026-09-08';

// A flat, unqualified legacy auto session has no frozen research candidate to
// execute. A canary may keep collecting paper evidence only while its exact
// version still passes the performance guard. Open positions are exempt so
// their exit protection can be restored after a restart.
export function assessPaperLearningContinuation({ config = {}, hasOpenPosition = false, performanceVerdict = null } = {}) {
    if (hasOpenPosition) return { allowed: true, reason: 'protect_open_position' };
    if (config.selectedBy === 'paper_learning_canary') {
        return performanceVerdict?.allowed === true
            ? { allowed: true, reason: 'canary_within_loss_budget' }
            : { allowed: false, reason: 'paper_canary_performance_quarantine' };
    }
    if (!config.selectedBy && String(config.strategySelectionMode || '').toLowerCase() === 'auto') {
        return { allowed: false, reason: 'auto_session_has_no_qualified_candidate' };
    }
    return { allowed: true, reason: 'separately_selected_session' };
}

export function currentPaperLearningConfig(config = {}) {
    const { strategyVersion, strategyIdentityKey, ...previous } = config;
    return {
        ...previous,
        selectedBy: 'paper_learning_canary',
        paperCanary: true,
        learningCanary: true,
        forcePaper: true,
        paperMode: true,
        liveEligible: false,
        liveTradingEnabled: false,
        strategySelectionMode: 'manual',
        executionStyle: 'taker_market',
        signalLearningVersion: 2,
        executionPolicyVersion: PAPER_EXECUTION_POLICY_VERSION
    };
}
