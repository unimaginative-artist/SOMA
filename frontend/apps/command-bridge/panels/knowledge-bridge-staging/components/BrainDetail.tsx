
import React from 'react';
import { BRAINS } from '../constants';
import { BrainType } from '../types';
import { X, Activity, Zap, Lock, BookOpen, ChevronRight } from 'lucide-react';

interface BrainDetailProps {
  brainId: BrainType | null;
  onClose: () => void;
  onOpenFeature: (feature: string) => void;
}

export const BrainDetail: React.FC<BrainDetailProps> = ({ brainId, onClose, onOpenFeature }) => {
  if (!brainId) return null;
  const brain = BRAINS[brainId];

  return (
    <div className="absolute top-20 right-0 bottom-0 w-96 z-50 overflow-hidden pointer-events-none">
      <div className="h-full w-full bg-slate-900/90 backdrop-blur-xl border-l border-slate-700/50 shadow-2xl p-6 transform transition-transform duration-500 translate-x-0 pointer-events-auto overflow-y-auto">
        
        <div className="flex justify-between items-start mb-8">
          <div>
            <h2 className={`text-4xl font-bold display-font ${brain.textGlowClass}`} style={{ color: brain.color }}>
              {brain.name}
            </h2>
            <p className="text-slate-400 text-sm mt-1 uppercase tracking-widest">{brain.role}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="mb-8">
            <div className="flex justify-between text-sm text-slate-400 mb-2">
                <span>Neural Integrity</span>
                <span>{brain.stats.load}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${brain.stats.load}%`, backgroundColor: brain.color }}
                ></div>
            </div>
        </div>

        <div className="space-y-2 mb-8">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Cognitive Core Operations</div>
          {brain.buttons.map((btn, i) => (
            <button 
                key={i}
                onClick={() => onOpenFeature(btn)}
                className="w-full text-left px-4 py-3 rounded bg-slate-800/30 hover:bg-slate-700/50 border border-slate-700/50 hover:border-white/20 transition-all group flex items-center justify-between"
            >
                <div className="flex items-center space-x-3">
                    <div className="p-1 rounded bg-slate-950">
                        <Zap size={12} style={{ color: brain.color }} />
                    </div>
                    <span className="text-slate-200 font-medium group-hover:text-white text-sm">{btn}</span>
                </div>
                <ChevronRight size={14} className="text-slate-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </button>
          ))}
        </div>

        <div className="space-y-4">
            <div className="bg-black/40 rounded-lg p-4 border border-slate-800/50">
                <h4 className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center">
                    <Activity size={10} className="mr-2" /> Local Threads
                </h4>
                <div className="text-xl font-mono text-white tracking-tighter">{brain.stats.processes.toLocaleString()}</div>
            </div>

            <div className="bg-black/40 rounded-lg p-4 border border-slate-800/50">
                <h4 className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center">
                    <BookOpen size={10} className="mr-2" /> Current Mandate
                </h4>
                <div className="text-sm font-mono text-slate-300 italic">"{brain.stats.focus}"</div>
            </div>
        </div>
      </div>
    </div>
  );
};
