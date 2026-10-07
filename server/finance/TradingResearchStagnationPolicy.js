const REASON_GROUPS = Object.freeze({
    holdout: ['insufficient_held_out_trades', 'deflated_sharpe_failed', 'return_confidence_interval_crosses_zero'],
    development: ['walk_forward_failed', 'development_economics_failed'],
    execution: ['held_out_economics_failed', 'parity_failed', 'execution_not_supported']
});

export function diagnoseResearchStagnation({ consecutiveNoQualified = 0, rejectionReasons = {} } = {}) {
    const counts = Object.fromEntries(Object.entries(REASON_GROUPS).map(([group, reasons]) => [
        group,
        reasons.reduce((sum, reason) => sum + Number(rejectionReasons?.[reason] || 0), 0)
    ]));
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['unknown', 0];
    const stagnant = Number(consecutiveNoQualified || 0);
    const phase = stagnant >= 8
        ? (dominant[0] === 'holdout' ? 'accumulate_prospective_evidence' : 'change_hypothesis_family')
        : stagnant >= 3 ? 'diversify_search' : 'baseline_search';
    return {
        stagnantCycles: stagnant,
        phase,
        dominantFailure: dominant[1] > 0 ? dominant[0] : 'unknown',
        failureCounts: counts,
        // Stop blindly growing to the old 320x14 ceiling. Correlated parameter
        // mutations add compute and multiple-testing burden faster than insight.
        populationSize: phase === 'baseline_search' ? 128 : phase === 'diversify_search' ? 176 : 192,
        generations: phase === 'baseline_search' ? 6 : phase === 'diversify_search' ? 8 : 9,
        recommendation: phase === 'accumulate_prospective_evidence'
            ? 'retain exact candidates and collect new sealed/shadow observations'
            : phase === 'change_hypothesis_family'
                ? 'introduce structurally distinct signal families before expanding parameters'
                : 'continue bounded cost-aware search'
    };
}

export default diagnoseResearchStagnation;
