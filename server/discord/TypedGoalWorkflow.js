const WORKFLOWS = Object.freeze({
    trading_diagnostic: {
        id: 'paper_trading_diagnostic_v1', allowDecomposition: false,
        stages: ['read_authoritative_trade_state', 'attribute_results_by_strategy', 'run_bounded_paper_experiment', 'verify_report_and_keep_live_blocked']
    },
    research: {
        id: 'sourced_research_v1', allowDecomposition: false,
        stages: ['inventory_local_evidence', 'collect_primary_sources', 'reconcile_claims_and_citations', 'write_and_read_back_artifact']
    },
    artifact_synthesis: {
        id: 'artifact_synthesis_v1', allowDecomposition: false,
        stages: ['inventory_source_material', 'deduplicate_and_reconcile', 'compose_structured_artifact', 'read_back_and_verify']
    },
    app_build: {
        id: 'bounded_app_build_v1', allowDecomposition: false,
        stages: ['inspect_workspace_and_define_acceptance', 'implement_smallest_runnable_product', 'run_build_or_tests', 'verify_launch_and_artifacts']
    },
    engineering: {
        id: 'bounded_engineering_v1', allowDecomposition: false,
        stages: ['reproduce_or_inspect', 'make_bounded_change', 'run_focused_verification', 'report_changed_files_and_result']
    }
});

export function workflowForTask(task = {}) {
    const selected = WORKFLOWS[task.kind] || WORKFLOWS.engineering;
    return { ...selected, stages: [...selected.stages] };
}

export function isContextualFollowup(input = '') {
    const value = String(input || '').trim();
    // Context inheritance is an execution decision, so require the utterance to
    // actually be a follow-up request. An unanchored "fix it" used to turn
    // statements such as "I attempted to fix it, but the goal loop is broken"
    // into continuations of an unrelated older task.
    return /^(?:(?:no[, ]+)?(?:just|please)\s+)?(?:fix|finish|continue|resume|do|check|retry|try|execute|run|implement|test|backtest)\s*(?:it|that|this)?\b/i.test(value)
        || /^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:fix|finish|continue|resume|do|check|retry|try|execute|run|implement|test|backtest)\s+(?:it|that|this)\b|I\s+thought\s+you\s+were\s+going\s+to\b|(?:you were|you(?:'|’)re|you are)\s+going\s+to\b|what happened(?:\s+with\s+(?:it|that))?\b)/i.test(value);
}

export function resolveContextualTask(input = '', prior = null) {
    if (!isContextualFollowup(input) || !prior?.kind) return null;
    return {
        kind: prior.kind,
        category: prior.category || (prior.kind === 'trading_diagnostic' ? 'trading' : 'engineering'),
        domain: prior.domain || 'general',
        request: `${String(input).trim()} — continue the prior ${prior.kind} request: ${prior.request || prior.title || ''}`.slice(0, 1000),
        contextParentGoalId: prior.goalId || prior.id || null
    };
}

export { WORKFLOWS };
