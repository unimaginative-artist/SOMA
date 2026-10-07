import { backtestBars, evaluateCompiledStrategyDecision } from './CompiledStrategyBacktester.js';
import { evaluateWalkForward } from './OfflineStrategyEvolutionLab.js';
import { deflatedSharpeProbability, TRADING_ECONOMICS_VERSION } from './TradingResearchPolicy.js';

function stableDecision(decision = {}) {
    return JSON.stringify({
        action: decision.action, closeOnly: Boolean(decision.closeOnly),
        signalBar: decision.metadata?.signalBar ?? null,
        signalPrice: Number(decision.metadata?.signalPrice ?? 0).toFixed(8)
    });
}

export function auditCausalDecisions({ bars = [], candidate, samples = 12 } = {}) {
    const failures = [];
    if (!candidate || bars.length < 80) return { passed: false, samples: 0, failures: ['insufficient_bars'] };
    const start = Math.max(60, bars.length - Math.max(1, samples));
    for (let cutoff = start; cutoff < bars.length; cutoff++) {
        const prefix = bars.slice(0, cutoff + 1);
        const original = stableDecision(evaluateCompiledStrategyDecision({ bars: prefix, candidate }));
        const futureMutated = bars.map((bar, index) => index <= cutoff ? bar : {
            ...bar, open: Number(bar.open) * 10, high: Number(bar.high) * 10,
            low: Number(bar.low) * 10, close: Number(bar.close) * 10
        });
        const replay = stableDecision(evaluateCompiledStrategyDecision({ bars: futureMutated.slice(0, cutoff + 1), candidate }));
        if (original !== replay) failures.push({ cutoff, type: 'future_data_changed_past_decision' });

        // A finite-window strategy must not change when irrelevant ancient bars
        // are removed while a generous 200-bar warmup remains.
        if (prefix.length > 240) {
            const recursive = stableDecision(evaluateCompiledStrategyDecision({ bars: prefix.slice(-220), candidate }));
            if (original !== recursive) failures.push({ cutoff, type: 'recursive_history_instability' });
        }
    }
    return { passed: failures.length === 0, samples: bars.length - start, failures };
}

export function conservativeReturnInterval(returns = [], z = 1.96) {
    const values = returns.map(Number).filter(Number.isFinite);
    if (values.length < 2) return { observations: values.length, mean: 0, lower95: -Infinity, upper95: Infinity };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    const error = z * Math.sqrt(variance / values.length);
    return { observations: values.length, mean, lower95: mean - error, upper95: mean + error };
}

export function validateResearchCandidate({ bars = [], candidate, folds = 4, trials = 1, initialCapital = 10000 } = {}) {
    if (bars.length < 300) return { passed: false, reasons: ['insufficient_historical_bars'] };
    const split = Math.floor(bars.length * 0.8);
    const development = evaluateWalkForward({ bars: bars.slice(0, split), candidate, folds, initialCapital });
    const warmupStart = Math.max(0, split - 220);
    const heldOut = backtestBars({
        bars: bars.slice(warmupStart), candidate, initialCapital, tradeStartIndex: split - warmupStart
    });
    const causality = auditCausalDecisions({ bars, candidate });
    const deflatedSharpe = deflatedSharpeProbability(heldOut.tradeReturns || [], trials);
    const returnInterval = conservativeReturnInterval(heldOut.tradeReturns || []);
    const reasons = [];
    if (!causality.passed) reasons.push('causality_or_recursive_audit_failed');
    if (!development.supported) reasons.push('walk_forward_failed');
    if (heldOut.trades < 30) reasons.push('insufficient_held_out_trades');
    if (!(heldOut.totalPnl > 0 && heldOut.profitFactor >= 1.2)) reasons.push('held_out_economics_failed');
    if (heldOut.frictionCheck?.economicsVersion !== TRADING_ECONOMICS_VERSION || !heldOut.frictionCheck?.passed) reasons.push('cost_model_failed');
    if (deflatedSharpe.probability < 0.95) reasons.push('deflated_sharpe_failed');
    if (!(returnInterval.lower95 > 0)) reasons.push('return_confidence_interval_crosses_zero');
    return {
        passed: reasons.length === 0, reasons, causality, development,
        heldOut: { ...heldOut, deflatedSharpe, returnInterval },
        policy: { paperOnly: true, liveExecutionAllowed: false, economicsVersion: TRADING_ECONOMICS_VERSION }
    };
}

export default validateResearchCandidate;
