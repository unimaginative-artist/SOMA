import React from 'react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, FlaskConical, ShieldCheck, Target, XCircle } from 'lucide-react';
import { computeMissionPnl, formatMoney } from './PnlSummary.jsx';

const pct = (value, digits = 1) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '--';
    return `${n.toFixed(digits)}%`;
};

function GateRow({ label, passed, detail }) {
    return (
        <div className="flex items-start gap-2 rounded border border-white/5 bg-black/25 px-2.5 py-2">
            {passed ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            )}
            <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-300">{label}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-zinc-500">{detail}</div>
            </div>
        </div>
    );
}

export function MissionBriefPanel({
    isDemoMode,
    tradingActive,
    selectedSymbol,
    riskMetrics,
    missionRuntime,
    learnedPlaybook,
    liveReadiness,
    marketRegime,
    dataSource,
    autonomousStatus,
    positions = [],
    currentPresetId,
    onOpenBacktest,
    onOpenSim,
    onOpenJournal
}) {
    const activeStrategy = missionRuntime?.activeStrategy || learnedPlaybook?.best || null;
    const promotion = missionRuntime?.lastPromotion || liveReadiness?.promotion || liveReadiness || {};
    const ladder = promotion?.ladder || {};
    const activeTier = missionRuntime?.activeTierProfile || promotion?.activeTierProfile || null;
    const nextTier = missionRuntime?.promotionTiers?.find(tier => tier.id === ladder.nextTier) || null;
    const stats = autonomousStatus?.stats || {};
    // Live stats take priority over stale liveReadiness promotion data
    const closedTrades = Number(stats.tradesExecuted ?? promotion.closedTrades ?? promotion.closed_trades ?? 0);
    const winRate = stats.winRatePct != null
        ? stats.winRatePct
        : stats.rollingWinRate != null
            ? stats.rollingWinRate * 100
            : Number(promotion.winRate ?? promotion.win_rate ?? 0);
    const profitFactor = stats.profitFactor != null
        ? stats.profitFactor
        : Number(promotion.profitFactor ?? promotion.profit_factor ?? 0);
    const maxDrawdown = Number(riskMetrics?.dailyDrawdown ?? promotion.maxDrawdownPct ?? promotion.max_drawdown_pct ?? 0);
    // Use live ensemble confidence as market lab score when no strategy score is loaded
    const marketLabScore = Number(
        activeStrategy?.score ?? activeStrategy?.prometheusScore ??
        autonomousStatus?.agentConfidences?.strategy ?? 0
    );
    const liveEligible = Boolean(missionRuntime?.liveEligible || promotion.liveEligible || promotion.passed);
    const simulated = dataSource === 'SIMULATION';
    const paperOnly = isDemoMode || !liveEligible;
    const allocation = Number(riskMetrics?.initialBalance || 0);
    const pnlSummary = computeMissionPnl({ riskMetrics, autonomousStatus, positions });
    const pnl = pnlSummary.total;
    const pnlPct = pnlSummary.percent;

    const gates = [
        {
            label: 'Paper sample',
            passed: closedTrades >= 100,
            detail: closedTrades > 0
                ? `${closedTrades}/100 closed paper trades.`
                : 'No closed trades yet — engine running.'
        },
        {
            label: 'Win rate',
            passed: winRate >= 60,
            detail: winRate > 0
                ? `${pct(winRate)} win rate (${stats.wins || 0}W / ${stats.losses || 0}L) vs 60% min.`
                : closedTrades > 0 ? 'Calculating...' : 'No closed trades yet.'
        },
        {
            label: 'Profit factor',
            passed: profitFactor >= 1.4,
            detail: profitFactor != null && profitFactor > 0
                ? `${profitFactor.toFixed(2)}× gross win/loss ratio vs 1.40 min.`
                : closedTrades > 0 ? 'Calculating...' : 'Needs closed trade distribution.'
        },
        {
            label: 'Drawdown control',
            passed: maxDrawdown <= 12,
            detail: `${pct(maxDrawdown)} current drawdown vs 12% cap.`
        },
        {
            label: 'Ensemble confidence',
            passed: marketLabScore >= 0.72,
            detail: marketLabScore > 0
                ? `${(marketLabScore * 100).toFixed(0)}% ensemble score vs 72% min.`
                : 'Engine not running — no signal score yet.'
        }
    ];

    const nextAction = simulated
        ? 'Get live historical bars loaded before trusting the chart.'
        : !gates[0].passed
            ? 'Run paper sessions until the sample reaches 100 closed trades.'
            : !gates.every(g => g.passed)
                ? 'Use Backtest and Sim Intel to identify which gate is failing.'
                : 'Keep live disabled until you intentionally confirm broker mode and sizing.';

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-3 text-xs">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-emerald-400" />
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Thesis Brief</div>
                        <div className="mt-0.5 text-[10px] text-zinc-500">One trade thesis at a time. Paper evidence first.</div>
                    </div>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded border border-white/5 bg-black/30 p-2">
                    <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-600">
                        <CircleDollarSign className="h-3 w-3" /> Allocation
                    </div>
                    <div className="mt-1 font-mono text-sm font-bold text-white">{formatMoney(allocation)}</div>
                    <div className={`mt-0.5 font-mono text-[10px] ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pnl >= 0 ? '+' : ''}{formatMoney(pnl)} · {pnl >= 0 ? '+' : ''}{pct(pnlPct, 2)}
                    </div>
                </div>
                <div className="rounded border border-white/5 bg-black/30 p-2">
                    <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-600">
                        <ShieldCheck className="h-3 w-3" /> Mode
                    </div>
                    <div className={`mt-1 text-sm font-bold ${paperOnly ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {paperOnly ? 'PAPER ONLY' : 'LIVE ELIGIBLE'}
                    </div>
                    <div className="mt-0.5 text-[10px] text-zinc-500">{tradingActive ? 'Engine running' : 'Engine standby'}</div>
                </div>
            </div>

            <div className="mt-3 rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Promotion Ladder</div>
                    <div className={`rounded border px-2 py-0.5 text-[9px] font-bold uppercase ${activeTier?.liveTradingEnabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
                        {activeTier?.label || missionRuntime?.activeTier || 'Paper Trading'}
                    </div>
                </div>
                <div className="text-[10px] leading-snug text-zinc-500">
                    {nextTier ? `Next tier: ${nextTier.label}` : 'Highest tier eligible.'}
                </div>
                {ladder.nextBlockedBy?.length > 0 && (
                    <div className="mt-2 space-y-1">
                        {ladder.nextBlockedBy.slice(0, 4).map(blocker => (
                            <div key={blocker.id} className="flex items-center justify-between gap-2 rounded bg-black/30 px-2 py-1">
                                <span className="text-[9px] font-bold uppercase text-zinc-500">{blocker.label}</span>
                                <span className="truncate text-right text-[9px] text-amber-300">{blocker.detail}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {(simulated || !isDemoMode) && (
                <div className={`mt-3 flex gap-2 rounded border px-2.5 py-2 ${simulated ? 'border-amber-500/25 bg-amber-500/10' : 'border-rose-500/25 bg-rose-500/10'}`}>
                    <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${simulated ? 'text-amber-300' : 'text-rose-300'}`} />
                    <div className="text-[10px] leading-snug text-zinc-300">
                        {simulated
                            ? 'Chart is using simulated fallback data. Treat all signals as UI testing only.'
                            : 'Live mode selected. Do not engage unless broker keys, sizing, and promotion gates are intentionally verified.'}
                    </div>
                </div>
            )}

            <div className="mt-3 rounded border border-white/5 bg-black/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Active Focus</div>
                    <div className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300">{selectedSymbol}</div>
                </div>
                <div className="font-mono text-[11px] font-bold text-white">
                    {autonomousStatus?.preset || activeStrategy?.strategyName || currentPresetId || 'No strategy loaded'}
                </div>
                <div className="mt-1 text-[10px] leading-snug text-zinc-500">
                    Regime: {autonomousStatus?.lastSignal?.regime || marketRegime?.regime?.type?.replace('_', ' ') || 'unknown'} · Data: {dataSource || 'unknown'}
                </div>
            </div>

            <div className="mt-3 space-y-1.5">
                {gates.map(gate => <GateRow key={gate.label} {...gate} />)}
            </div>

            <div className="mt-3 rounded border border-cyan-500/15 bg-cyan-500/5 p-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-cyan-300">
                    <FlaskConical className="h-3.5 w-3.5" />
                    Next Action
                </div>
                <div className="mt-1.5 text-[11px] leading-snug text-zinc-300">{nextAction}</div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                    <button onClick={onOpenBacktest} className="rounded border border-violet-500/20 bg-violet-500/10 px-2 py-1.5 text-[9px] font-bold uppercase text-violet-300 hover:bg-violet-500/20">
                        Backtest
                    </button>
                    <button onClick={onOpenSim} className="rounded border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-1.5 text-[9px] font-bold uppercase text-fuchsia-300 hover:bg-fuchsia-500/20">
                        Sim
                    </button>
                    <button onClick={onOpenJournal} className="rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1.5 text-[9px] font-bold uppercase text-cyan-300 hover:bg-cyan-500/20">
                        Trail
                    </button>
                </div>
            </div>
        </div>
    );
}
