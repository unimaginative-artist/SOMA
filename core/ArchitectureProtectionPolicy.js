const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');

export const CORE_PROTECTED_PATTERNS = [
    /^launcher_/i,
    /^package(?:-lock)?\.json$/i,
    /^core\/SomaBootstrap/i,
    /^core\/CognitiveRuntime\.js$/i,
    /^core\/WorkingMemory\.js$/i,
    /^core\/EmbodimentRuntime\.js$/i,
    /^core\/ASIKernel\.js$/i,
    /^core\/SomaAgenticExecutor\.js$/i,
    /^arbiters\/GoalPlannerArbiter\.cjs$/i,
    /^server\/services\/AutonomousHeartbeat\.cjs$/i,
];

// Owner's trading work is protected as a domain, not as a short hand-curated list.
// This intentionally errs broad: a false-positive means "review manually"; a
// false-negative could quarantine months of strategy or execution work.
export const TRADING_PROTECTED_PATTERNS = [
    /^server\/finance\//i,
    /^arbiters\/finance\//i,
    /^appendages\/forecaster\//i,
    /^arbiters\/(?:Finance|Trading|Trade|Market|Portfolio|Risk|SmartOrder|Correlation|Economic|Macro|MultiTimeframe|Sentiment)/i,
    /(?:Trader|Trading|Trade|Backtest|MarketData|MarketRegime|Portfolio|Position|OrderRouter|RiskManager|TechnicalIndicators|StrategyRegistry|Forecaster)/i,
    /^scratch\/(?:analyze_trades|check_.*(?:trade|strateg)|inspect_.*bars|populate_cache)/i,
];

export const EMBODIMENT_PROTECTED_PATTERNS = [
    /^daemons\/VisionDaemon\.js$/i,
    /^arbiters\/(?:VisionProcessing|VisualMemory|Ocular|SensoryCortex|SpatialMemory|Proprioception|ComputerControl)/i,
    /^server\/routes\/perceptionRoutes\.js$/i,
    /^core\/(?:EmbodimentRuntime|VisualProprioception)\.js$/i,
    /^core\/RotarySensorHead\.js$/i,
];

export function protectionForArchitecturePath(value) {
    const file = normalize(value);
    if (TRADING_PROTECTED_PATTERNS.some(pattern => pattern.test(file))) {
        return { protected: true, domain: 'trading', reason: 'Protected trading capability or supporting market infrastructure.' };
    }
    if (EMBODIMENT_PROTECTED_PATTERNS.some(pattern => pattern.test(file))) {
        return { protected: true, domain: 'embodiment', reason: 'Protected vision, perception, spatial, or embodiment infrastructure.' };
    }
    if (CORE_PROTECTED_PATTERNS.some(pattern => pattern.test(file))) {
        return { protected: true, domain: 'core', reason: 'Protected production entrypoint or cognitive runtime.' };
    }
    return { protected: false, domain: null, reason: null };
}

export function isProtectedArchitecturePath(value) {
    return protectionForArchitecturePath(value).protected;
}

export default protectionForArchitecturePath;
