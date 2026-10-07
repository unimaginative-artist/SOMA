import React, { useState } from 'react';
import { Brain, Zap, ChevronDown, ChevronUp, Activity, Clock } from 'lucide-react';

export const StrategyBrain = ({ strategies }) => {
  const [expandedId, setExpandedId] = useState(null);

  // Sort by Allocation to show dominance
  const sortedStrategies = [...strategies].sort((a, b) => b.allocation - a.allocation);

  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div className="h-full flex flex-col bg-soma-900 border-l border-soma-800">
      <div className="p-3 bg-soma-950 border-b border-soma-800 flex justify-between items-center">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Brain className="w-4 h-4 text-soma-accent" />
            Neural Architecture
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {sortedStrategies.map(strategy => {
            const isExpanded = expandedId === strategy.id;
            
            return (
                <div 
                    key={strategy.id} 
                    className={`relative p-2 rounded border transition-all cursor-pointer hover:bg-soma-800/50 ${isExpanded ? 'bg-soma-950 border-soma-accent/30' : 'border-transparent hover:border-soma-800'}`}
                    onClick={() => toggleExpand(strategy.id)}
                >
                    {/* Header Info */}
                    <div className="flex justify-between items-end mb-2 pointer-events-none">
                        <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
                             <span className={`text-xs font-bold font-mono ${strategy.active ? 'text-white' : 'text-slate-600'}`}>
                                {strategy.name}
                             </span>
                             {strategy.active && strategy.pnl > 0 && <Zap className="w-3 h-3 text-soma-warning animate-pulse" />}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                            CONF: <span className={strategy.confidence > 80 ? 'text-soma-success' : 'text-soma-warning'}>{strategy.confidence}%</span>
                        </div>
                    </div>

                    {/* Power Bar Container */}
                    <div 
                        className={`h-6 w-full bg-soma-900 border border-soma-800 relative group overflow-hidden ${strategy.active ? 'opacity-100' : 'opacity-40'} mb-1`}
                    >
                        {/* Background Grid */}
                        <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_95%,rgba(50,50,50,0.5)_95%)] bg-[length:10px_100%]"></div>

                        {/* Fill Bar */}
                        <div 
                            className={`h-full transition-all duration-700 relative ${strategy.pnl < 0 ? 'bg-soma-danger/40' : 'bg-soma-accent/30'}`}
                            style={{ width: `${strategy.allocation}%` }}
                        >
                             {/* Glowing Leading Edge */}
                             <div className={`absolute right-0 top-0 h-full w-[2px] ${strategy.pnl < 0 ? 'bg-soma-danger shadow-[0_0_10px_#ff2a2a]' : 'bg-soma-accent shadow-[0_0_15px_#00f0ff]'} animate-pulse`}></div>
                        </div>

                        {/* Text Overlay */}
                        <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                            <span className="text-[10px] font-mono text-slate-300 tracking-wider">ALLOCATION: {strategy.allocation}%</span>
                            <span className={`text-xs font-bold font-mono ${strategy.pnl >= 0 ? 'text-soma-success' : 'text-soma-danger'}`}>
                                 {strategy.pnl >= 0 ? '+' : ''}${strategy.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                        </div>
                    </div>

                    {/* EXPANDED DETAILS */}
                    {isExpanded && (
                        <div className="mt-3 pt-2 border-t border-soma-800 grid grid-cols-2 gap-2 text-[10px] animate-in slide-in-from-top-2 fade-in duration-200 cursor-default" onClick={e => e.stopPropagation()}>
                            <div className="col-span-2 mb-1">
                                <span className="text-soma-accent font-bold mb-1 block flex items-center gap-1">
                                    <Activity className="w-3 h-3" /> STRATEGY LOGIC
                                </span>
                                <p className="text-slate-400 leading-relaxed">
                                    {strategy.description}
                                </p>
                            </div>
                            
                            <div className="bg-black/30 p-2 rounded border border-soma-800">
                                <span className="text-slate-500 block mb-0.5">WIN RATE</span>
                                <span className="text-white font-mono text-lg">{(strategy.winRate * 100).toFixed(1)}%</span>
                            </div>
                            
                            <div className="bg-black/30 p-2 rounded border border-soma-800">
                                <span className="text-slate-500 block mb-0.5">PROFIT FACTOR</span>
                                <span className="text-soma-success font-mono text-lg">{(1.2 + Math.random()).toFixed(2)}</span>
                            </div>

                            <div className="bg-black/30 p-2 rounded border border-soma-800 col-span-2 flex justify-between items-center">
                                <div>
                                    <span className="text-slate-500 block">LAST EXECUTION</span>
                                    <div className="flex items-center gap-1 text-slate-300 mt-1">
                                        <Clock className="w-3 h-3" />
                                        <span>2 mins ago</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="text-slate-500 block">AVG RETURN</span>
                                    <span className="text-soma-success font-mono">+0.42%</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        })}

        {/* System Summary */}
        <div className="mt-6 pt-4 border-t border-soma-800">
             <div className="flex justify-between text-[10px] text-slate-500 mb-2">
                <span>ACTIVE AGENTS</span>
                <span className="text-white">5/5</span>
             </div>
             <div className="flex justify-between text-[10px] text-slate-500">
                <span>TOTAL COMPUTE</span>
                <span className="text-soma-accent">14.2 TFLOPS</span>
             </div>
        </div>
      </div>
    </div>
  );
};