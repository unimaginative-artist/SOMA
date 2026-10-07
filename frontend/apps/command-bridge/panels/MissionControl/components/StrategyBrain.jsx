import React, { useState } from 'react';
import { Brain, Zap, ChevronDown, ChevronUp, Activity, ShieldCheck, TrendingUp } from 'lucide-react';

/**
 * Extract a 0-1 score for an agent role from the live autonomousStatus payload.
 * dataSource strings mirror AGENTS definitions in constants.js.
 */
function getLiveScore(dataSource, status) {
    if (!status) return null;
    const { agentConfidences, signalBreakdown, stats, lastSignal } = status;

    if (dataSource === 'agents.strategy') return agentConfidences?.strategy ?? null;
    if (dataSource === 'agents.risk')     return agentConfidences?.risk     ?? null;
    if (dataSource === 'agents.sentiment')return agentConfidences?.sentiment ?? null;

    if (dataSource === 'stats.execution') {
        const w = stats?.rollingWinRate;
        return w != null ? w : null;
    }

    if (dataSource === 'regime') {
        // Not a 0-1 score — return null, render regime label separately
        return null;
    }

    // Signal group averages
    if (dataSource && dataSource.startsWith('signals.')) {
        if (!signalBreakdown) return null;
        const keys = dataSource.replace('signals.', '').split('+');
        const scores = keys.map(k => signalBreakdown[k]?.score).filter(s => s != null);
        if (!scores.length) return null;
        // Convert from raw score (can be -1..1 depending on engine) to 0..1
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        return Math.max(0, Math.min(1, (avg + 1) / 2)); // map -1..1 → 0..1
    }

    return null;
}

function getRegimeLabel(status) {
    return status?.lastSignal?.regime || status?.regime || null;
}

function getLiveWinRate(status) {
    const w = status?.stats?.rollingWinRate;
    return w != null ? w : null;
}

function getLiveSessionPnl(status) {
    const p = status?.stats?.sessionPnL;
    return p != null ? p : null;
}

function getLastSignalReason(status) {
    return status?.lastSignal?.reason || status?.lastSignal?.signal || null;
}

const SCORE_COLOR = (s) => {
    if (s == null) return 'text-slate-600';
    if (s >= 0.75) return 'text-emerald-400';
    if (s >= 0.50) return 'text-amber-400';
    return 'text-rose-400';
};

const SCORE_BAR_COLOR = (s) => {
    if (s == null) return 'bg-slate-700/30';
    if (s >= 0.75) return 'bg-emerald-500/30';
    if (s >= 0.50) return 'bg-amber-500/30';
    return 'bg-rose-500/30';
};

const SCORE_EDGE_COLOR = (s) => {
    if (s == null) return 'bg-slate-600 shadow-none';
    if (s >= 0.75) return 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]';
    if (s >= 0.50) return 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]';
    return 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.6)]';
};

export const StrategyBrain = ({ strategies, autonomousStatus, learnedPlaybook, missionRuntime }) => {
    const [expandedId, setExpandedId] = useState(null);

    const winRate = getLiveWinRate(autonomousStatus);
    const sessionPnl = getLiveSessionPnl(autonomousStatus);
    const regime = getRegimeLabel(autonomousStatus);
    const isRunning = !!autonomousStatus?.isRunning;
    const totalTrades = autonomousStatus?.stats?.tradesExecuted ?? 0;
    const lastReason = getLastSignalReason(autonomousStatus);

    const atc = autonomousStatus?.activeTradeConfig;

    return (
        <div className="h-full flex flex-col bg-[#151518]/40 border-l border-white/5">
            <div className="p-3 bg-transparent border-b border-white/5 flex justify-between items-center">
                <div>
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <Brain className="w-4 h-4 text-soma-accent" />
                        Agent Architecture
                    </h3>
                    {regime && (
                        <div className="mt-1 text-[9px] font-mono text-zinc-500">
                            REGIME: <span className="text-soma-accent">{regime}</span>
                            {atc && (
                                <span className="ml-2 text-zinc-600">
                                    SL {(atc.stopLossPct * 100).toFixed(1)}% / TP {(atc.takeProfitPct * 100).toFixed(1)}%
                                </span>
                            )}
                        </div>
                    )}
                    {lastReason && (
                        <div className="mt-0.5 text-[9px] font-mono text-zinc-600 truncate max-w-[200px]" title={lastReason}>
                            LAST: {lastReason}
                        </div>
                    )}
                </div>
                <div className={`rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${
                    isRunning
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-zinc-700/30 bg-zinc-800/20 text-zinc-600'
                }`}>
                    <ShieldCheck className="h-3 w-3" />
                    {isRunning ? 'Live Engine' : 'Idle'}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                {strategies.map(agent => {
                    const isExpanded = expandedId === agent.id;
                    const score = getLiveScore(agent.dataSource, autonomousStatus);
                    const scoreLabel = score != null ? `${(score * 100).toFixed(0)}%` : '--';
                    const barWidth = score != null ? `${(score * 100).toFixed(1)}%` : '0%';
                    const isRegime = agent.dataSource === 'regime';

                    return (
                        <div
                            key={agent.id}
                            className={`relative p-2 rounded border transition-all cursor-pointer hover:bg-white/5 ${
                                isExpanded ? 'bg-black/40 border-purple-500/30' : 'border-transparent hover:border-white/10'
                            }`}
                            onClick={() => setExpandedId(prev => prev === agent.id ? null : agent.id)}
                        >
                            {/* Header */}
                            <div className="flex justify-between items-center mb-2 pointer-events-none">
                                <div className="flex items-center gap-2">
                                    {isExpanded
                                        ? <ChevronUp className="w-3 h-3 text-slate-500" />
                                        : <ChevronDown className="w-3 h-3 text-slate-500" />}
                                    <span className="text-xs font-bold font-mono text-white">
                                        {agent.name}
                                    </span>
                                    {isRunning && score != null && score >= 0.75 && (
                                        <Zap className="w-3 h-3 text-soma-warning animate-pulse" />
                                    )}
                                </div>
                                {!isRegime && (
                                    <div className={`text-[10px] font-mono ${SCORE_COLOR(score)}`}>
                                        {isRunning ? scoreLabel : '--'}
                                    </div>
                                )}
                                {isRegime && regime && (
                                    <div className="text-[9px] font-mono text-soma-accent">{regime}</div>
                                )}
                            </div>

                            {/* Score Bar */}
                            {!isRegime && (
                                <div className="h-5 w-full bg-soma-900 border border-soma-800 relative overflow-hidden mb-1">
                                    <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_95%,rgba(50,50,50,0.5)_95%)] bg-[length:10px_100%]" />
                                    <div
                                        className={`h-full transition-all duration-700 relative ${SCORE_BAR_COLOR(isRunning ? score : null)}`}
                                        style={{ width: isRunning ? barWidth : '0%' }}
                                    >
                                        <div className={`absolute right-0 top-0 h-full w-[2px] ${SCORE_EDGE_COLOR(isRunning ? score : null)} animate-pulse`} />
                                    </div>
                                    <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                                        <span className="text-[9px] font-mono text-slate-500 tracking-wider uppercase">
                                            {agent.dataSource?.replace('signals.', '').replace(/\+/g, ' · ')}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Expanded details */}
                            {isExpanded && (
                                <div
                                    className="mt-3 pt-2 border-t border-white/5 text-[10px] animate-in slide-in-from-top-2 fade-in duration-200 cursor-default space-y-2"
                                    onClick={e => e.stopPropagation()}
                                >
                                    <div>
                                        <span className="text-soma-accent font-bold mb-1 flex items-center gap-1">
                                            <Activity className="w-3 h-3" /> ROLE
                                        </span>
                                        <p className="text-slate-400 leading-relaxed">{agent.description}</p>
                                    </div>

                                    {agent.dataSource === 'stats.execution' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="bg-black/30 p-2 rounded border border-soma-800">
                                                <span className="text-slate-500 block mb-0.5">WIN RATE</span>
                                                <span className={`font-mono text-base ${SCORE_COLOR(winRate)}`}>
                                                    {winRate != null ? `${(winRate * 100).toFixed(1)}%` : '--'}
                                                </span>
                                            </div>
                                            <div className="bg-black/30 p-2 rounded border border-soma-800">
                                                <span className="text-slate-500 block mb-0.5">SESSION P&L</span>
                                                <span className={`font-mono text-base ${sessionPnl != null ? (sessionPnl >= 0 ? 'text-soma-success' : 'text-soma-danger') : 'text-slate-600'}`}>
                                                    {sessionPnl != null ? `${sessionPnl >= 0 ? '+' : ''}$${Math.abs(sessionPnl).toFixed(2)}` : '--'}
                                                </span>
                                            </div>
                                            <div className="bg-black/30 p-2 rounded border border-soma-800 col-span-2">
                                                <span className="text-slate-500 block mb-0.5">TOTAL TRADES</span>
                                                <span className="font-mono text-slate-300">{totalTrades || '--'}</span>
                                            </div>
                                        </div>
                                    )}

                                    {agent.dataSource?.startsWith('signals.') && autonomousStatus?.signalBreakdown && (
                                        <div className="space-y-1">
                                            {agent.dataSource.replace('signals.', '').split('+').map(sig => {
                                                const entry = autonomousStatus.signalBreakdown[sig];
                                                const s = entry?.score;
                                                const mapped = s != null ? Math.max(0, Math.min(1, (s + 1) / 2)) : null;
                                                return (
                                                    <div key={sig} className="flex justify-between items-center bg-black/20 px-2 py-1 rounded">
                                                        <span className="text-slate-500 uppercase">{sig}</span>
                                                        <span className={`font-mono ${SCORE_COLOR(mapped)}`}>
                                                            {mapped != null ? `${(mapped * 100).toFixed(0)}%` : '--'}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                            {autonomousStatus.signalWeights && (
                                                <div className="mt-1 text-[9px] text-zinc-600">
                                                    Weights adapt via trade outcomes (SignalLibrary)
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {agent.dataSource === 'regime' && (
                                        <div className="space-y-1">
                                            <div className="bg-black/30 p-2 rounded border border-soma-800">
                                                <span className="text-slate-500 block mb-0.5">CURRENT REGIME</span>
                                                <span className="font-mono text-soma-accent">{regime || '--'}</span>
                                            </div>
                                            {atc && (
                                                <div className="grid grid-cols-3 gap-1">
                                                    <div className="bg-black/20 p-1.5 rounded text-center">
                                                        <span className="text-slate-600 block text-[8px]">STOP</span>
                                                        <span className="font-mono text-rose-400">{(atc.stopLossPct * 100).toFixed(1)}%</span>
                                                    </div>
                                                    <div className="bg-black/20 p-1.5 rounded text-center">
                                                        <span className="text-slate-600 block text-[8px]">TARGET</span>
                                                        <span className="font-mono text-emerald-400">{(atc.takeProfitPct * 100).toFixed(1)}%</span>
                                                    </div>
                                                    <div className="bg-black/20 p-1.5 rounded text-center">
                                                        <span className="text-slate-600 block text-[8px]">TRAIL</span>
                                                        <span className="font-mono text-amber-400">{(atc.trailingStopPct * 100).toFixed(1)}%</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Session summary */}
                {isRunning && (
                    <div className="mt-4 pt-3 border-t border-soma-800 grid grid-cols-3 gap-2 text-[9px]">
                        <div className="text-center">
                            <span className="text-slate-600 block mb-0.5">WIN RATE</span>
                            <span className={`font-mono ${SCORE_COLOR(winRate)}`}>
                                {winRate != null ? `${(winRate * 100).toFixed(1)}%` : '--'}
                            </span>
                        </div>
                        <div className="text-center">
                            <span className="text-slate-600 block mb-0.5">SESSION</span>
                            <span className={`font-mono ${sessionPnl != null ? (sessionPnl >= 0 ? 'text-soma-success' : 'text-soma-danger') : 'text-slate-600'}`}>
                                {sessionPnl != null ? `${sessionPnl >= 0 ? '+' : ''}$${Math.abs(sessionPnl).toFixed(2)}` : '--'}
                            </span>
                        </div>
                        <div className="text-center">
                            <span className="text-slate-600 block mb-0.5">TRADES</span>
                            <span className="font-mono text-slate-400">{totalTrades || '--'}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
