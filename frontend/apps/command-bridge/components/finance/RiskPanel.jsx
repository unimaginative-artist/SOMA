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

  return (
    <div className={`h-full flex flex-col border-t border-soma-800 transition-colors duration-500 ${isCriticalRisk ? 'bg-soma-danger/10' : 'bg-soma-900'}`}>
      
      {/* Header with Visual Alarm */}
      <div className={`p-3 border-b flex justify-between items-center transition-colors ${isCriticalRisk ? 'bg-soma-danger/20 border-soma-danger' : 'bg-soma-950 border-soma-800'}`}>
        <h3 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${isCriticalRisk ? 'text-soma-danger animate-pulse' : 'text-slate-400'}`}>
            {isCriticalRisk ? <AlertOctagon className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4 text-soma-accent" />}
            Risk & Capital
        </h3>
        {isCriticalRisk && <span className="text-[10px] bg-soma-danger text-black font-bold px-2 py-0.5 rounded animate-pulse">CRITICAL</span>}
      </div>

      <div className="flex-1 p-4 overflow-y-auto relative">
        {isCriticalRisk && <div className="absolute inset-0 bg-soma-danger/5 pointer-events-none animate-pulse z-0"></div>}
        
        <div className="relative z-10 space-y-4">
            
            {/* MASTER WALLET */}
            <div className="bg-soma-950 p-3 rounded border border-soma-700 relative group shadow-lg">
                <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Master Wallet</div>
                <div className="flex items-baseline gap-1">
                    <span className="text-slate-500 font-mono">$</span>
                    <input 
                        id="wallet-input"
                        type="number" 
                        value={walletInput}
                        onChange={(e) => setWalletInput(e.target.value)}
                        onBlur={handleWalletBlur}
                        onKeyDown={(e) => handleKeyDown(e, handleWalletBlur)}
                        className="bg-transparent text-xl font-mono text-white w-full focus:outline-none placeholder-slate-600"
                    />
                </div>
            </div>

            {/* TRADING ALLOCATION */}
            <div className={`bg-soma-800/40 p-3 rounded border relative ${isCriticalRisk ? 'border-soma-danger shadow-[0_0_20px_rgba(255,42,42,0.2)]' : 'border-soma-accent/30'}`}>
                <div className={`text-[10px] uppercase font-bold mb-1 flex items-center gap-1 ${isCriticalRisk ? 'text-soma-danger' : 'text-soma-accent'}`}>
                    <CreditCard className="w-3 h-3" /> Trading Allocation
                </div>
                
                <div className="flex items-baseline gap-1 mb-2 border-b border-dashed border-soma-700 pb-2">
                    <span className="text-slate-500 font-mono text-lg">$</span>
                    <input 
                        id="allocation-input"
                        type="number" 
                        value={allocationInput}
                        onChange={(e) => setAllocationInput(e.target.value)}
                        onBlur={handleAllocationBlur}
                        onKeyDown={(e) => handleKeyDown(e, handleAllocationBlur)}
                        className={`bg-transparent text-2xl font-bold font-mono w-full focus:outline-none ${isCriticalRisk ? 'text-soma-danger' : 'text-soma-accent'}`}
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
                <div className={`p-2 rounded border transition-all ${isCriticalRisk ? 'bg-soma-danger/20 border-soma-danger' : 'bg-soma-950 border-soma-800'}`}>
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
                        <div className={`h-full ${isCriticalRisk ? 'bg-soma-danger animate-pulse' : 'bg-slate-600'}`} style={{width: `${(metrics.dailyDrawdown / metrics.maxDrawdownLimit) * 100}%`}}></div>
                    </div>
                </div>

                {/* Exposure */}
                <div className="p-2 rounded bg-soma-950 border border-soma-800">
                    <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-slate-500">NET EXPOSURE</span>
                        <span className="font-mono text-white">{(exposurePercent).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-black h-2 rounded-full overflow-hidden border border-soma-800 relative">
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

            </div>
        </div>
      </div>
    </div>
  );
};