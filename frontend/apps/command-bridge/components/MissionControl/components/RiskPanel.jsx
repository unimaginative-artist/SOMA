import React, { useState, useEffect } from 'react';
import { ShieldAlert, TrendingDown, Wallet, Briefcase, CreditCard, AlertOctagon } from 'lucide-react';

export const RiskPanel = ({ metrics, onUpdateAllocation, onUpdateWallet }) => {
    const [allocationInput, setAllocationInput] = useState(metrics.initialBalance.toString());
    const [walletInput, setWalletInput] = useState(metrics.walletBalance.toString());

    const exposurePercent = (metrics.netExposure / metrics.equity) * 100;
    const pnl = metrics.equity - metrics.initialBalance;
    const pnlPercent = (pnl / metrics.initialBalance) * 100;

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
                                type="number"
                                value={walletInput}
                                onChange={(e) => setWalletInput(e.target.value)}
                                onBlur={handleWalletBlur}
                                onKeyDown={(e) => handleKeyDown(e, handleWalletBlur)}
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
                                type="number"
                                value={allocationInput}
                                onChange={(e) => setAllocationInput(e.target.value)}
                                onBlur={handleAllocationBlur}
                                onKeyDown={(e) => handleKeyDown(e, handleAllocationBlur)}
                                className="bg-transparent text-2xl font-bold font-mono w-full focus:outline-none text-white focus:text-purple-300 transition-colors no-spinner"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div>
                                <div className="text-slate-500">SESSION P&L</div>
                                <div className={`text-base font-mono font-bold ${pnl >= 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                                    {pnl >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                                </div>
                            </div>
                        </div>
                    </div>

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
                        {(metrics.sharpeRatio != null || metrics.sortinoRatio != null) && (
                            <div className="p-2 rounded bg-black/40 border border-white/5">
                                <div className="text-[9px] text-slate-500 uppercase mb-2">Risk-Adjusted Returns</div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <div className="text-[9px] text-slate-500 mb-0.5">SHARPE</div>
                                        <div className={`text-base font-mono font-bold ${metrics.sharpeRatio == null ? 'text-slate-600' : metrics.sharpeRatio >= 1 ? 'text-emerald-400' : metrics.sharpeRatio >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {metrics.sharpeRatio != null ? metrics.sharpeRatio.toFixed(2) : '--'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[9px] text-slate-500 mb-0.5">SORTINO</div>
                                        <div className={`text-base font-mono font-bold ${metrics.sortinoRatio == null ? 'text-slate-600' : metrics.sortinoRatio >= 1 ? 'text-emerald-400' : metrics.sortinoRatio >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {metrics.sortinoRatio != null ? metrics.sortinoRatio.toFixed(2) : '--'}
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
