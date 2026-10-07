
import React, { useState, useEffect } from 'react';
import { BrainType, Fragment } from '../types';
import { BRAINS } from '../constants';
import { X, Zap, Shield, Target, Microscope, Link, Search, GitBranch, Terminal, LineChart, Hash, Sparkles, ShieldCheck, Lock } from 'lucide-react';

interface FeatureOverlayProps {
  brainId: BrainType;
  featureId: string;
  onClose: () => void;
  onAction: (featureId: string, payload: any) => void;
  fragments: Fragment[];
  selectedFragment: Fragment | null;
  entropy: number;
}

export const FeatureOverlay: React.FC<FeatureOverlayProps> = ({ 
    brainId, 
    featureId, 
    onClose, 
    onAction, 
    fragments,
    selectedFragment,
    entropy 
}) => {
  const brain = BRAINS[brainId];
  const [inputValue, setInputValue] = useState('');
  const [ticker, setTicker] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTicker(t => t + 1), 100);
    return () => clearInterval(interval);
  }, []);

  const PanelHeader = () => (
    <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
        <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 shadow-[0_0_15px_rgba(255,255,255,0.05)]">
                <Zap size={20} style={{ color: brain.color }} className="animate-pulse" />
            </div>
            <div>
                <h2 className="text-xl font-bold display-font tracking-tight text-white uppercase">{featureId}</h2>
                <div className="text-[10px] uppercase text-slate-500 tracking-[0.2em] font-bold">{brain.name} Sub-System ACTIVE</div>
            </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors bg-slate-800/50 p-1.5 rounded">
            <X size={16} />
        </button>
    </div>
  );

  const renderFeatureContent = () => {
    switch (featureId) {
        // --- AURORA ---
        case 'Dreamspace':
            return (
                <div className="space-y-4">
                    <p className="text-sm text-slate-400 font-light">Probabilistic synthesis engine running. SOMA is dreaming new axiomatic clusters.</p>
                    <div className="h-40 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-center relative overflow-hidden group">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(192,132,252,0.1),transparent_70%)]"></div>
                        {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} className="absolute w-6 h-6 rounded-full blur-xl opacity-40 transition-all duration-[3000ms]" 
                                 style={{ 
                                    backgroundColor: brain.color, 
                                    top: `${(Math.sin(ticker/20 + i) * 30) + 40}%`, 
                                    left: `${(Math.cos(ticker/25 + i) * 30) + 40}%`,
                                 }} />
                        ))}
                        <div className="z-10 flex flex-col items-center">
                            <span className="text-[10px] font-mono text-purple-400 uppercase tracking-widest mb-1">Synthesis in progress</span>
                            <div className="flex space-x-1">
                                {[1, 2, 3].map(i => <div key={i} className="w-1 h-1 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: `${i*0.2}s` }} />)}
                            </div>
                        </div>
                    </div>
                </div>
            );
        case 'Pattern Mutation':
            return (
                <div className="space-y-4">
                    <p className="text-sm text-slate-400">Select any fragment to generate structural variants and alternate symbolic meanings.</p>
                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg">
                        {selectedFragment ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                    <Sparkles size={16} className="text-purple-400" />
                                    <span className="text-sm font-bold text-white">{selectedFragment.label}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="text-xs text-slate-600 italic text-center py-2">No fragment targeted for mutation.</div>
                        )}
                    </div>
                </div>
            );

        // --- THALAMUS ---
        case 'Signal Firewall':
            return (
                <div className="space-y-4">
                    <p className="text-sm text-slate-400">Neural data packets are being inspected for integrity. Unauthorized patterns are filtered.</p>
                    <div className="bg-slate-950 border border-red-900/40 p-4 rounded font-mono text-[10px] space-y-1">
                        <div className="text-red-400 animate-pulse">[SCANNING STREAM: 0x4F2A...]</div>
                        <div className="text-slate-500">PACKET-77: VALIDATED</div>
                        <div className="text-slate-500">PACKET-78: VALIDATED</div>
                        <div className="text-red-500 font-bold">PACKET-79: MALFORMED HEURISTIC - DROPPED</div>
                        <div className="text-slate-500">PACKET-80: VALIDATED</div>
                    </div>
                    <button onClick={() => onAction(featureId, {})} className="w-full py-2 bg-red-600 text-white text-[10px] font-bold rounded uppercase">
                        Harden Firewall
                    </button>
                </div>
            );
        case 'Protocol Guard':
            return (
                <div className="space-y-4">
                    <p className="text-sm text-slate-400">Enforcement of core AI directives. Any attempt to bypass safety logic will be intercepted here.</p>
                    <div className="flex flex-col space-y-2">
                        {['Primary Directive: Coherence', 'Secondary Directive: Non-Destruction', 'Tertiary Directive: Integrity'].map((dir, i) => (
                            <div key={i} className="flex items-center space-x-3 p-3 bg-slate-950 border border-slate-800 rounded">
                                <ShieldCheck size={14} className="text-red-500" />
                                <span className="text-xs text-slate-300 font-bold uppercase tracking-widest">{dir}</span>
                                <div className="ml-auto text-[9px] text-green-500 font-mono">ACTIVE</div>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => onAction(featureId, {})} className="w-full py-2 bg-red-900/30 border border-red-500/50 text-red-500 text-[10px] font-bold rounded uppercase">
                        Cycle Security Keys
                    </button>
                </div>
            );
        case 'Sensory Gate':
            return (
                <div className="space-y-4 text-center">
                    <Lock size={32} className="mx-auto text-red-500 mb-2 opacity-50" />
                    <p className="text-xs text-slate-500 font-mono">GATE STATUS: UNSTABLE DATA FLOW</p>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 w-2/3 animate-pulse"></div>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed px-4">
                        Data ingress from external prompts is currently gated to prevent hallucination cycles.
                    </p>
                </div>
            );

        // --- PROMETHEUS / LOGOS (Simplified for brev) ---
        default:
            return (
                <div className="p-10 text-center bg-slate-950 rounded-lg border border-slate-800">
                    <Terminal size={32} className="text-slate-800 mx-auto mb-4" />
                    <p className="text-xs text-slate-500 font-mono uppercase tracking-[0.2em]">Integrating Analytical Streams...</p>
                </div>
            );
    }
  };

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-300">
        <div 
          className="w-full max-w-lg bg-slate-900/95 border rounded-xl shadow-[0_0_80px_rgba(0,0,0,0.6)] overflow-hidden"
          style={{ borderColor: `${brain.color}40`, boxShadow: `0 0 50px ${brain.color}15` }}
        >
            <div className="h-1 w-full" style={{ backgroundColor: brain.color }}></div>
            <div className="p-8">
                <PanelHeader />
                {renderFeatureContent()}
                
                <div className="mt-8 flex justify-center items-center space-x-3">
                    <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-slate-800"></div>
                    <div className="flex items-center space-x-2 text-[9px] text-slate-600 uppercase font-bold tracking-[0.3em]">
                        <Microscope size={12} />
                        <span>SOMA NEURAL BRIDGE v3.1</span>
                    </div>
                    <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-slate-800"></div>
                </div>
            </div>
        </div>
    </div>
  );
};
