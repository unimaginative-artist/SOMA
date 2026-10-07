import React, { useState, useEffect } from 'react';
import { Play, Pause, AlertOctagon, Cpu, Lock, Zap } from 'lucide-react';
import { TradeMode } from '../types';

interface GlobalControlsProps {
  mode: TradeMode;
  setMode: (mode: TradeMode) => void;
  tradingActive: boolean;
  toggleTrading: () => void;
  killSwitch: () => void;
  marketSentiment: 'BULL' | 'BEAR';
}

export const GlobalControls: React.FC<GlobalControlsProps> = ({
  mode,
  setMode,
  tradingActive,
  toggleTrading,
  killSwitch,
  marketSentiment
}) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fallback URLs in case local files aren't found
  const FALLBACK_BULL = "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Animals/Ox.png";
  const FALLBACK_BEAR = "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Animals/Bear.png";

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const target = e.target as HTMLImageElement;
    // Prevent infinite loop if fallback fails
    if (target.src !== FALLBACK_BULL && target.src !== FALLBACK_BEAR) {
        target.src = marketSentiment === 'BULL' ? FALLBACK_BULL : FALLBACK_BEAR;
    }
  };

  return (
    <header className="h-16 bg-soma-900 border-b border-soma-800 flex items-center justify-between px-4 select-none shrink-0 z-50 relative overflow-visible">
      {/* Left: Brand & Status */}
      <div className="flex items-center space-x-6 z-10 bg-soma-900/80 pr-4 backdrop-blur-sm">
        <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${tradingActive ? 'bg-soma-success animate-pulse' : 'bg-soma-warning'}`}></div>
            <h1 className="text-lg font-bold tracking-wider text-slate-100 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-soma-accent" />
                SOMA
            </h1>
        </div>
        
        <div className="h-8 w-[1px] bg-soma-800 mx-2"></div>

        <div className="flex bg-soma-950 border border-soma-800 rounded-md p-1">
            {(Object.keys(TradeMode) as Array<keyof typeof TradeMode>).map((m) => (
                <button
                    key={m}
                    onClick={() => setMode(TradeMode[m])}
                    className={`px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${
                        mode === TradeMode[m] 
                        ? 'bg-soma-700 text-white shadow-sm' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                >
                    {m}
                </button>
            ))}
        </div>
      </div>

      {/* CENTER: Dynamic Market Sentiment Icons (Shifted to 45%) */}
      <div className="absolute left-[45%] top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none flex items-center justify-center">
        {marketSentiment === 'BULL' ? (
             <div className="relative group animate-in zoom-in duration-500">
                 {/* Expects 'bull.png' in public folder */}
                 <img 
                    src="/bull.png" 
                    onError={handleImageError}
                    alt="Bull Market"
                    className="h-14 w-auto object-contain drop-shadow-[0_0_15px_rgba(0,255,157,0.3)] filter brightness-110 transition-transform duration-300 group-hover:scale-110" 
                 />
             </div>
        ) : (
            <div className="relative group animate-in zoom-in duration-500">
                 {/* Expects 'bear.png' in public folder */}
                 <img 
                    src="/bear.png" 
                    onError={handleImageError}
                    alt="Bear Market"
                    className="h-14 w-auto object-contain drop-shadow-[0_0_15px_rgba(255,42,42,0.3)] filter brightness-110 transition-transform duration-300 group-hover:scale-110" 
                 />
             </div>
        )}
      </div>

      {/* Right: Critical Controls */}
      <div className="flex items-center space-x-4 z-10 bg-soma-900/80 pl-4 backdrop-blur-sm">
        {/* System Time */}
        <div className="text-right hidden md:block border-r border-soma-800 pr-4">
            <div className="text-xs text-slate-500">SYSTEM TIME (UTC)</div>
            <div className="text-sm font-mono text-soma-accent">
                {time.toISOString().split('T')[1].split('.')[0]}
            </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
            <button 
                onClick={toggleTrading}
                className={`flex items-center gap-2 px-4 py-2 rounded font-bold transition-all border ${
                    tradingActive 
                    ? 'bg-soma-950 border-soma-warning text-soma-warning hover:bg-soma-900' 
                    : 'bg-soma-success/10 border-soma-success text-soma-success hover:bg-soma-success/20'
                }`}
            >
                {tradingActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {tradingActive ? 'PAUSE' : 'ENGAGE'}
            </button>

            <button 
                onClick={killSwitch}
                className="flex items-center gap-2 px-4 py-2 rounded font-bold bg-soma-danger/10 border border-soma-danger text-soma-danger hover:bg-soma-danger hover:text-white transition-all ml-4"
            >
                <AlertOctagon className="w-4 h-4" />
                KILL SWITCH
            </button>
        </div>
        
        <div className="ml-2 pl-2 border-l border-soma-800 flex gap-2">
           <button title="Lock Instruments" className="p-2 text-slate-500 hover:text-white hover:bg-soma-800 rounded">
             <Lock className="w-4 h-4" />
           </button>
           <button title="Flatten Portfolio" className="p-2 text-slate-500 hover:text-soma-warning hover:bg-soma-800 rounded">
             <Zap className="w-4 h-4" />
           </button>
        </div>
      </div>
    </header>
  );
};