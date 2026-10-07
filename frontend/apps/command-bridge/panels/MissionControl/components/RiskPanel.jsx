import React, { useState, useEffect } from 'react';
import { ShieldAlert, TrendingDown, Wallet, Briefcase, CreditCard, AlertOctagon } from 'lucide-react';
import { PnlSummaryCard, computeMissionPnl } from './PnlSummary.jsx';

export const RiskPanel = ({ metrics, onUpdateAllocation, onUpdateWallet, autonomousStatus = null, positions = [], readOnly = false }) => {
    const [allocationInput, setAllocationInput] = useState(metrics.initialBalance.toString());
    const [walletInput, setWalletInput] = useState(metrics.walletBalance.toString());

    const exposurePercent = (metrics.netExposure / metrics.equity) * 100;
    const pnlSummary = computeMissionPnl({ riskMetrics: metrics, autonomousStatus, positions });
    const pnl = pnlSummary.total;
    const tradeCount = autonomousStatus?.stats?.tradesExecuted || 0;
    const holdCount = autonomousStatus?.stats?.signalsHold || 0;
    const lastSignal = autonomousStatus?.lastSignal || null;
    const minConfidence = autonomousStatus?.config?.minConfidence || autonomousStatus?.guardrailsState?.config?.minConfidence || null;
    const lastConfidence = lastSignal?.confidence ?? null;
    const lastBlock = autonomousStatus?.lastBlockReason || null;

    // Synthesize Sharpe/Sortino from session stats when not yet available from PerformanceCalculator
    const stats = autonomousStatus?.stats || {};
    const synthSharpe = (() => {
        if (metrics.sharpeRatio != null) return metrics.sharpeRatio;
        const { wins = 0, losses = 0, grossWins = 0, grossLosses = 0 } = stats;
        const total = wins + losses;
        if (total < 5) return null;
        const avgReturn = (grossWins - grossLosses) / total;
        const variance = ((wins * Math.pow(grossWins / Math.max(wins, 1) - avgReturn, 2) +
                          losses * Math.pow(-(grossLosses / Math.max(losses, 1)) - avgReturn, 2)) / total);
        const stdDev = Math.sqrt(variance);
        return stdDev > 0 ? parseFloat((avgReturn / stdDev).toFixed(2)) : null;
    })();
    const synthSortino = (() => {
        if (metrics.sortinoRatio != null) return metrics.sortinoRatio;
        const { wins = 0, losses = 0, grossWins = 0, grossLosses = 0 } = stats;
        const total = wins + losses;
        if (total < 5) return null;
        const avgReturn = (grossWins - grossLosses) / total;
        const downside = losses > 0 ? Math.sqrt(Math.pow(grossLosses / losses, 2)) : 1;
        return downside > 0 ? parseFloat((avgReturn / downside).toFixed(2)) : null;
    })();

    // Calculate unallocated funds
    const unallocated = metrics.walletBalance - metrics.initialBalance;

    // Scary Mode Trigger
    const isCriticalRisk = metrics.dailyDrawdown > 3.0 || Math.abs(exposurePercent) > 85;

    // Sync internal state if metrics change externally
    useEffect(() => {
        if (metrics.initialBalance !== parseFloat(allocationInput) && document.activeElement?.id !== 'allocation-input') {
            setAllocationInput(metrics.initialBalance.toString());
        }
    }, [metrics.initialBalance]);

    useEffect(() => {
        if (metrics.walletBalance !== parseFloat(walletInput) && document.activeElement?.id !== 'wallet-input') {
            setWalletInput(metrics.walletBalance.toString());
        }
    }, [metrics.walletBalance]);

    const handleAllocationBlur = () => {
        const val = parseFloat(allocationInput);
        if (!isNaN(val) && val >= 0) {
            if (val > metrics.walletBalance) {
                onUpdateAllocation(metrics.walletBalance);
                setAllocationInput(metrics.walletBalance.toString());
            } else {
                onUpdateAllocation(val);
            }
        } else {
            setAllocationInput(metrics.initialBalance.toString());
        }
    };

    const handleWalletBlur = () => {
        const val = parseFloat(walletInput);
        if (!isNaN(val) && val >= 0) {
            onUpdateWallet(val);
            if (val < metrics.initialBalance) {
                onUpdateAllocation(val);
                setAllocationInput(val.toString());
            }
        } else {
            setWalletInput(metrics.walletBalance.toString());
        }
    };

    const handleKeyDown = (e, action) => {
        if (e.key === 'Enter') {
            action();
            e.target.blur();
        }
    }

    // P&L State
    const isWinning = pnl > 0;
    const isLosing = pnl < 0;

    // Safety Colors
    const getBgColor = () => {
        if (isCriticalRisk) return 'bg-soma-danger/20';
        if (isWinning) return 'bg-emerald-500/5';
        if (isLosing) return 'bg-red-500/5';
        return 'bg-[#151518]/40';
    };

    const getBorderColor = () => {
        if (isCriticalRisk) return 'border-soma-danger';
        if (isWinning) return 'border-emerald-500/20';
        if (isLosing) return 'border-red-500/20';
        return 'border-white/5';
    };

    const getTextColor = () => {
        if (isCriticalRisk) return 'text-soma-danger';
        if (isWinning) return 'text-soma-success';
        if (isLosing) return 'text-soma-danger';
        return 'text-soma-accent';
    };

    return (
        <div className={`h-full flex flex-col border-t transition-colors duration-500 ${getBgColor()} ${getBorderColor()}`}>

            {/* Header with Visual Alarm */}
            <div className={`p-3 border-b flex justify-between items-center transition-colors ${isCriticalRisk ? 'bg-soma-danger/20 border-soma-danger' : isWinning ? 'bg-emerald-500/10 border-emerald-500/20' : isLosing ? 'bg-red-500/10 border-red-500/20' : 'bg-transparent border-white/5'}`}>
                <h3 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${getTextColor()}`}>
                    {isCriticalRisk ? <AlertOctagon className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                    Risk & Capital
                </h3>
                {isCriticalRisk && <span className="text-[10px] bg-soma-danger text-black font-bold px-2 py-0.5 rounded animate-pulse">CRITICAL</span>}
                {!isCriticalRisk && isWinning && <span className="text-[10px] bg-soma-success/20 text-soma-success border border-soma-success border-opacity-30 font-bold px-2 py-0.5 rounded">PROFITABLE</span>}
                {!isCriticalRisk && isLosing && <span className="text-[10px] bg-soma-danger/20 text-soma-danger border border-soma-danger border-opacity-30 font-bold px-2 py-0.5 rounded">DRAWDOWN</span>}
            </div>

            <div className="flex-1 p-3 overflow-y-auto relative custom-scrollbar">
                {isCriticalRisk && <div className="absolute inset-0 bg-soma-danger/5 pointer-events-none animate-pulse z-0"></div>}

                <div className="relative z-10 space-y-2">

                    {/* MASTER WALLET */}
                    <div className="bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-cyan-500/10 p-3 rounded border border-pink-500/30 relative group shadow-lg hover:shadow-pink-500/20 transition-all">
                        <div className="text-[10px] text-pink-400 uppercase font-bold mb-1 flex items-center gap-1">
                            <Wallet className="w-3 h-3" /> Master Wallet
                        </div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-pink-400 font-mono">$</span>
                            <input
                                id="wallet-input"
                                readOnly={readOnly}
                                type="number"
                                value={walletInput}
                                onChange={(e) => setWalletInput(e.target.value)}
                                onBlur={readOnly ? undefined : handleWalletBlur}
                                onKeyDown={readOnly ? undefined : (e) => handleKeyDown(e, handleWalletBlur)}
                                className="bg-transparent text-xl font-mono text-white w-full focus:outline-none placeholder-slate-600 focus:text-pink-300 transition-colors no-spinner"
                            />
                        </div>
                    </div>

                    {/* TRADING ALLOCATION */}
                    <div className="bg-gradient-to-br from-purple-500/10 via-pink-500/10 to-purple-600/10 p-3 rounded border border-purple-500/30 relative transition-all shadow-lg hover:shadow-purple-500/20">
                        <div className="text-[10px] uppercase font-bold mb-1 flex items-center gap-1 text-purple-400">
                            <CreditCard className="w-3 h-3" /> Trading Allocation
                        </div>

                        <div className="flex items-baseline gap-1 mb-2 border-b border-dashed border-purple-500/30 pb-2">
                            <span className="text-purple-400 font-mono text-lg">$</span>
                            <input
                                id="allocation-input"
                                readOnly={readOnly}
                                type="number"
                                value={allocationInput}
                                onChange={(e) => setAllocationInput(e.target.value)}
                                onBlur={readOnly ? undefined : handleAllocationBlur}
                                onKeyDown={readOnly ? undefined : (e) => handleKeyDown(e, handleAllocationBlur)}
                                className="bg-transparent text-2xl font-bold font-mono w-full focus:outline-none text-white focus:text-purple-300 transition-colors no-spinner"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div>
                                <div className="text-slate-500">SESSION P&L</div>
                                <div className={`text-base font-mono font-bold ${pnlSummary.percent >= 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                                    {pnlSummary.percent >= 0 ? '+' : ''}{pnlSummary.percent.toFixed(2)}%
                                </div>
                            </div>
                            <div>
                                <div className="text-slate-500">DOLLARS</div>
                                <div className={`text-base font-mono font-bold ${pnl >= 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                </div>
                            </div>
                        </div>
                    </div>

                    {autonomousStatus?.stats && (
                        <div className="p-2 rounded bg-black/40 border border-white/5">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-[9px] text-slate-500 uppercase">Paper P&L State</div>
                                <div className={`text-[9px] font-bold ${tradeCount > 0 ? 'text-emerald-400' : 'text-blue-400'}`}>
                                    {tradeCount > 0 ? `${tradeCount} fill${tradeCount === 1 ? '' : 's'}` : 'No fills yet'}
                                </div>
                            </div>
                            <PnlSummaryCard summary={pnlSummary} compact title="Unified P&L" />
                            <div className="mt-2 text-[9px] leading-snug text-zinc-500">
                                {tradeCount === 0
                                    ? lastBlock
                                        ? `Blocked: [${lastBlock.category}] ${lastBlock.reason?.slice(0, 80)}`
                                        : `Waiting for first entry. Signal: ${lastSignal?.action || 'NONE'}${lastConfidence != null && minConfidence != null ? ` (${Math.round(lastConfidence * 100)}% vs ${Math.round(minConfidence * 100)}% gate)` : ''}. Holds: ${holdCount}.`
                                    : positions.length > 0
                                        ? 'Position is open. Unrealized P&L moves with live price; realized P&L updates after exit.'
                                        : 'No open position. Realized P&L reflects closed paper trades.'}
                            </div>
                        </div>
                    )}

                    {readOnly && <p className="text-[10px] text-zinc-500">Account telemetry only. Autopilot chooses paper sizing; its enforced position limit is shown in the mission panel.</p>}
                    {/* METRICS GRID - SCARY MODE */}
                    <div className="space-y-3 pt-2">

                        {/* Drawdown */}
                        <div className={`p-2 rounded border transition-all ${isCriticalRisk ? 'bg-soma-danger/20 border-soma-danger' : 'bg-transparent border-white/5'}`}>
                            <div className="flex justify-between items-center mb-1">
                                <div className={`text-[9px] uppercase flex items-center gap-1 ${isCriticalRisk ? 'text-soma-danger' : 'text-slate-500'}`}>
                                    <TrendingDown className="w-3 h-3" /> Max Drawdown
                                </div>
                                <span className="text-[9px] text-slate-500">LIMIT: {metrics.maxDrawdownLimit}%</span>
                            </div>
                            <div className={`text-2xl font-mono font-bold ${isCriticalRisk ? 'text-soma-danger' : metrics.dailyDrawdown > 2 ? 'text-soma-warning' : 'text-slate-300'}`}>
                                {metrics.dailyDrawdown.toFixed(2)}%
                            </div>
                            <div className="w-full bg-black/50 h-1 mt-1 rounded-full overflow-hidden">
                                <div className={`h-full ${isCriticalRisk ? 'bg-soma-danger animate-pulse' : 'bg-slate-600'}`} style={{ width: `${(metrics.dailyDrawdown / metrics.maxDrawdownLimit) * 100}%` }}></div>
                            </div>
                        </div>

                        {/* Exposure */}
                        <div className="p-2 rounded bg-black/40 border border-white/5">
                            <div className="flex justify-between text-[10px] mb-1">
                                <span className="text-slate-500">NET EXPOSURE</span>
                                <span className="font-mono text-white">{(exposurePercent).toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-black h-2 rounded-full overflow-hidden border border-white/5 relative">
                                {/* Center Line */}
                                <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-slate-600 z-10"></div>
                                <div
                                    className={`h-full transition-all duration-300 ${exposurePercent > 0 ? 'bg-soma-success ml-auto' : 'bg-soma-danger mr-auto'}`}
                                    style={{
                                        width: `${Math.min(Math.abs(exposurePercent) / 2, 50)}%`,
                                        transformOrigin: exposurePercent > 0 ? 'left' : 'right',
                                        marginLeft: exposurePercent > 0 ? '50%' : undefined,
                                        marginRight: exposurePercent < 0 ? '50%' : undefined
                                    }}
                                ></div>
                            </div>
                        </div>

                        {/* Sharpe / Sortino — shows once we have ≥5 closed trades */}
                        {(synthSharpe != null || synthSortino != null) && (
                            <div className="p-2 rounded bg-black/40 border border-white/5">
                                <div className="flex justify-between items-center mb-2">
                                    <div className="text-[9px] text-slate-500 uppercase">Risk-Adjusted Returns</div>
                                    {metrics.sharpeRatio == null && <div className="text-[8px] text-zinc-600 italic">est.</div>}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <div className="text-[9px] text-slate-500 mb-0.5">SHARPE</div>
                                        <div className={`text-base font-mono font-bold ${synthSharpe == null ? 'text-slate-600' : synthSharpe >= 1 ? 'text-emerald-400' : synthSharpe >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {synthSharpe != null ? synthSharpe.toFixed(2) : '--'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[9px] text-slate-500 mb-0.5">SORTINO</div>
                                        <div className={`text-base font-mono font-bold ${synthSortino == null ? 'text-slate-600' : synthSortino >= 1 ? 'text-emerald-400' : synthSortino >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {synthSortino != null ? synthSortino.toFixed(2) : '--'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
};
