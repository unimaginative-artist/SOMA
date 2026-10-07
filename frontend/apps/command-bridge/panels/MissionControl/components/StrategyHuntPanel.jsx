import React, { useState, useCallback } from 'react';
import { Target, Lock, Unlock, Trophy, Clock, TrendingUp, TrendingDown, Zap, RotateCcw } from 'lucide-react';

const fmt2 = (n) => n == null ? '—' : Number(n).toFixed(2);
const fmtUsd = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n) => n == null ? '—' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(1)}%`;

const PROFILE_DESCRIPTIONS = {
    standard_portfolio: '8% pos · 62% conf · 2m cooldown',
    swarm_architecture: '10% pos · 58% conf · 90s cooldown',
    micro_compounder:   '4% pos · 64% conf · 1.8% TP',
    micro_scalper:      '3% pos · 57% conf · high freq',
    full_aggression:    '18% pos · 50% conf · 10% TP',
    yield_harvester:    '6% pos · 68% conf · 3m cooldown',
};

function ProgressBar({ pct, color = 'bg-cyan-500', className = '' }) {
    return (
        <div className={`h-1 w-full bg-white/5 rounded-full overflow-hidden ${className}`}>
            <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, (pct || 0) * 100)}%` }} />
        </div>
    );
}

function TrialCard({ trial, targetDailyPnlUsd }) {
    if (!trial) return (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-white/3 border border-white/5 text-[10px] text-zinc-500">
            <Zap className="w-3 h-3" />
            Engine not running — start trading to begin the hunt.
        </div>
    );

    const onTrack = trial.onTrack;
    const dailyProj = trial.dailyProj;
    const projColor = onTrack === true ? 'text-emerald-400' : onTrack === false ? 'text-rose-400' : 'text-zinc-400';
    const trialPnlColor = (trial.trialPnlUsd || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400';

    return (
        <div className="rounded border border-white/8 bg-black/30 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-[10px] font-bold text-zinc-200 uppercase tracking-wide">{trial.label}</span>
                </div>
                <div className="flex items-center gap-1 text-[9px] text-zinc-500">
                    <Clock className="w-2.5 h-2.5" />
                    {trial.minsRemaining}m left
                </div>
            </div>

            <ProgressBar pct={trial.trialPct} color={onTrack ? 'bg-emerald-500' : 'bg-cyan-500'} />

            <div className="grid grid-cols-3 gap-2 mt-1">
                <div>
                    <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-0.5">Trial P&L</div>
                    <div className={`text-[11px] font-mono font-bold ${trialPnlColor}`}>{fmtUsd(trial.trialPnlUsd)}</div>
                </div>
                <div>
                    <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-0.5">Proj / Day</div>
                    <div className={`text-[11px] font-mono font-bold ${projColor}`}>
                        {dailyProj !== null ? fmtUsd(dailyProj) : '—'}
                    </div>
                </div>
                <div>
                    <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-0.5">Target</div>
                    <div className="text-[11px] font-mono font-bold text-zinc-400">{fmtUsd(targetDailyPnlUsd)}</div>
                </div>
            </div>

            {trial.regime && (
                <div className="text-[8px] text-zinc-600">Regime: <span className="text-zinc-400">{trial.regime}</span></div>
            )}
        </div>
    );
}

function LeaderboardRow({ entry, isCurrent, onLock }) {
    return (
        <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-[9px] transition-all ${isCurrent ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-white/2 border border-transparent hover:bg-white/4'}`}>
            {entry.locked ? (
                <Lock className="w-3 h-3 text-amber-400 shrink-0" />
            ) : entry.proven ? (
                <Trophy className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : isCurrent ? (
                <div className="w-3 h-3 flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                </div>
            ) : (
                <div className="w-3 h-3 shrink-0" />
            )}

            <div className="flex-1 min-w-0">
                <div className={`font-semibold truncate ${entry.locked ? 'text-amber-300' : entry.proven ? 'text-emerald-300' : isCurrent ? 'text-cyan-300' : 'text-zinc-400'}`}>
                    {entry.label}
                </div>
                <div className="text-zinc-600">{PROFILE_DESCRIPTIONS[entry.strategyId] || ''}</div>
            </div>

            <div className="text-right shrink-0">
                <div className={`font-mono ${entry.avgReward > 0 ? 'text-emerald-400' : entry.avgReward < 0 ? 'text-rose-400' : 'text-zinc-600'}`}>
                    {entry.trials > 0 ? fmt2(entry.avgReward) : '—'}
                </div>
                <div className="text-zinc-600">{entry.trials} trial{entry.trials !== 1 ? 's' : ''}</div>
            </div>

            {entry.proven && !entry.locked && onLock && (
                <button
                    onClick={() => onLock(entry.strategyId)}
                    className="ml-1 px-2 py-1 rounded text-[8px] font-bold uppercase tracking-wide bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all shrink-0"
                >
                    Lock
                </button>
            )}
        </div>
    );
}

export function StrategyHuntPanel({ huntState, onLock, onUnlock }) {
    const [confirmUnlock, setConfirmUnlock] = useState(false);

    const handleLock = useCallback(async (strategyId) => {
        try {
            await fetch('/api/autonomous/hunt/lock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ strategyId }),
            });
            onLock?.();
        } catch { /* handled by parent via WS refresh */ }
    }, [onLock]);

    const handleUnlock = useCallback(async () => {
        setConfirmUnlock(false);
        try {
            await fetch('/api/autonomous/hunt/unlock', { method: 'POST' });
            onUnlock?.();
        } catch { /* handled by parent via WS refresh */ }
    }, [onUnlock]);

    if (!huntState) {
        return (
            <div className="h-full flex items-center justify-center text-[10px] text-zinc-600">
                Strategy hunt loading…
            </div>
        );
    }

    const {
        targetDailyPnlUsd, lockedStrategy, lockedStrategyLabel, lockedAt,
        degradeWarning, consecutiveWins, winsNeeded,
        currentTrial, provenStrategies = [], leaderboard = [], recentTrials = [], totalTrials,
    } = huntState;

    const currentStrategyId = currentTrial?.strategyId;

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-3 flex flex-col gap-3">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">Strategy Hunt</span>
                </div>
                <div className="text-[9px] text-zinc-600">{totalTrials} trial{totalTrials !== 1 ? 's' : ''} · target {huntState.targetDailyPct ? `${(huntState.targetDailyPct * 100).toFixed(1)}%` : '0.5%'}/day ({fmtUsd(targetDailyPnlUsd)})</div>
            </div>

            {/* Locked strategy banner */}
            {lockedStrategy && (
                <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded border ${degradeWarning ? 'bg-rose-500/10 border-rose-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                    <div className="flex items-center gap-2">
                        <Lock className={`w-3 h-3 ${degradeWarning ? 'text-rose-400' : 'text-amber-400'}`} />
                        <div>
                            <div className={`text-[9px] font-bold uppercase tracking-wide ${degradeWarning ? 'text-rose-300' : 'text-amber-300'}`}>
                                Locked: {lockedStrategyLabel}
                            </div>
                            {degradeWarning && (
                                <div className="text-[8px] text-rose-400 mt-0.5">Performance degrading — consider unlocking to resume hunt</div>
                            )}
                        </div>
                    </div>
                    {confirmUnlock ? (
                        <div className="flex items-center gap-1">
                            <button onClick={handleUnlock} className="px-2 py-1 rounded text-[8px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30">Confirm</button>
                            <button onClick={() => setConfirmUnlock(false)} className="px-2 py-1 rounded text-[8px] text-zinc-500 hover:text-zinc-300">Cancel</button>
                        </div>
                    ) : (
                        <button onClick={() => setConfirmUnlock(true)} className="flex items-center gap-1 px-2 py-1 rounded text-[8px] font-bold bg-white/5 text-zinc-400 border border-white/10 hover:text-zinc-200 hover:bg-white/10">
                            <Unlock className="w-2.5 h-2.5" /> Unlock
                        </button>
                    )}
                </div>
            )}

            {/* Consecutive win progress (only show when actively hunting) */}
            {!lockedStrategy && consecutiveWins > 0 && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                    <Trophy className="w-3 h-3 text-emerald-400" />
                    <div className="flex-1">
                        <div className="text-[9px] text-emerald-300 font-bold">{consecutiveWins}/{winsNeeded} consecutive wins</div>
                        <ProgressBar pct={consecutiveWins / winsNeeded} color="bg-emerald-500" className="mt-1" />
                    </div>
                </div>
            )}

            {/* Current trial */}
            <div>
                <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-1.5">Current Trial</div>
                <TrialCard trial={currentTrial} targetDailyPnlUsd={targetDailyPnlUsd} />
            </div>

            {/* Strategy leaderboard */}
            <div>
                <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-1.5">Strategy Leaderboard</div>
                <div className="flex flex-col gap-1">
                    {leaderboard.map(entry => (
                        <LeaderboardRow
                            key={entry.strategyId}
                            entry={entry}
                            isCurrent={entry.strategyId === currentStrategyId}
                            onLock={handleLock}
                        />
                    ))}
                </div>
            </div>

            {/* Recent trials */}
            {recentTrials.length > 0 && (
                <div>
                    <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-1.5">Recent Trials</div>
                    <div className="flex flex-col gap-1">
                        {recentTrials.map((t, i) => (
                            <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded bg-white/2 text-[9px]">
                                <div className="flex items-center gap-1.5">
                                    {(t.pnlUsd || 0) >= 0
                                        ? <TrendingUp className="w-2.5 h-2.5 text-emerald-400" />
                                        : <TrendingDown className="w-2.5 h-2.5 text-rose-400" />
                                    }
                                    <span className="text-zinc-400">{t.strategyId?.replace(/_/g, ' ')}</span>
                                    {t.regime && <span className="text-zinc-600">· {t.regime}</span>}
                                </div>
                                <div className="text-right">
                                    <span className={`font-mono ${(t.pnlUsd || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtUsd(t.pnlUsd)}</span>
                                    <span className="text-zinc-600 ml-1">{fmtUsd(t.dailyProj)}/day</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty proven state */}
            {provenStrategies.length === 0 && !lockedStrategy && (
                <div className="mt-2 flex items-center gap-2 px-2 py-2 rounded bg-white/2 border border-white/5 text-[9px] text-zinc-600">
                    <RotateCcw className="w-3 h-3 shrink-0" />
                    No proven strategies yet. Each strategy runs for 1 hour. SOMA needs {winsNeeded} consecutive trials projecting ≥{huntState.targetDailyPct ? `${(huntState.targetDailyPct * 100).toFixed(1)}%` : '0.5%'}/day before a strategy is marked proven.
                </div>
            )}
        </div>
    );
}

export default StrategyHuntPanel;
