
import React from 'react';
import { BRAINS } from '../constants';
import { BrainType } from '../types';
import { Brain, Eye, Cpu, ShieldCheck } from 'lucide-react';

interface ThreeBrainsProps {
  onSelectBrain: (brain: BrainType) => void;
  activeBrain: BrainType | null;
}

export const ThreeBrains: React.FC<ThreeBrainsProps> = ({ onSelectBrain, activeBrain }) => {
  const getBrainIcon = (type: BrainType, size = 32) => {
    switch (type) {
      case BrainType.AURORA: return <Brain size={size} />;
      case BrainType.PROMETHEUS: return <Eye size={size} />;
      case BrainType.LOGOS: return <Cpu size={size} />;
      case BrainType.THALAMUS: return <ShieldCheck size={size} />;
    }
  };

  return (
    <div className="absolute top-20 left-0 right-0 z-30 flex justify-center items-start h-80 pointer-events-none">
      <div className="relative w-full max-w-4xl flex justify-center items-start pt-10">
        
        {/* Layout Lines */}
        <div className="absolute top-[80px] w-64 h-[1px] bg-gradient-to-r from-transparent via-slate-600/30 to-transparent"></div>
        <div className="absolute top-[80px] left-1/2 -translate-x-1/2 w-[1px] h-48 bg-gradient-to-b from-slate-600/30 to-transparent"></div>

        {Object.values(BRAINS).map((brain, index) => {
          const isActive = activeBrain === brain.id;
          const isMuted = activeBrain && !isActive;
          const isThalamus = brain.id === BrainType.THALAMUS;

          // Positioning logic
          let positionClasses = '';
          if (brain.id === BrainType.AURORA) positionClasses = '-translate-y-8'; 
          if (brain.id === BrainType.PROMETHEUS) positionClasses = 'translate-y-16 translate-x-32'; 
          if (brain.id === BrainType.LOGOS) positionClasses = 'translate-y-16 -translate-x-32';
          if (brain.id === BrainType.THALAMUS) positionClasses = 'translate-y-32'; // Directly under Aurora

          return (
            <div 
              key={brain.id}
              className={`absolute transition-all duration-700 ease-out transform ${positionClasses} pointer-events-auto`}
            >
              <button
                onClick={() => onSelectBrain(brain.id)}
                className={`
                  group relative flex flex-col items-center justify-center
                  ${isThalamus ? 'w-20 h-20' : 'w-32 h-32'}
                  transition-all duration-500
                  ${isActive ? 'scale-110' : 'hover:scale-105'}
                  ${isMuted ? 'opacity-30 grayscale blur-sm scale-90' : 'opacity-100'}
                `}
              >
                {/* Core Pillar Visual */}
                <div 
                  className={`
                    absolute inset-0 rounded-full border border-white/10 backdrop-blur-sm
                    bg-gradient-to-b ${brain.bgGradient}
                    ${isActive ? brain.glowClass : 'shadow-none'}
                    group-hover:${brain.glowClass}
                    transition-shadow duration-500
                    overflow-hidden
                  `}
                >
                    <div className="absolute inset-0 opacity-30 mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                    
                    {brain.id === BrainType.AURORA && <div className="absolute inset-0 bg-purple-500/20 blur-xl animate-[spin_10s_linear_infinite]"></div>}
                    {brain.id === BrainType.PROMETHEUS && <div className="absolute inset-0 bg-amber-500/10 animate-pulse"></div>}
                    {brain.id === BrainType.LOGOS && <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(68,255,255,0.1)_50%,transparent_75%,transparent_100%)] bg-[length:10px_10px]"></div>}
                    {brain.id === BrainType.THALAMUS && <div className="absolute inset-0 bg-red-500/20 animate-[pulse_1s_ease-in-out_infinite]"></div>}
                </div>

                <div className={`z-10 text-white ${isActive ? 'animate-bounce' : ''}`} style={{color: isActive ? '#fff' : brain.color}}>
                   {getBrainIcon(brain.id, isThalamus ? 24 : 32)}
                </div>

                <div className={`${isThalamus ? 'mt-24' : 'mt-32'} text-center absolute top-2 w-48`}>
                  <h3 className={`display-font ${isThalamus ? 'text-sm' : 'text-lg'} font-bold tracking-widest ${isActive ? brain.textGlowClass : 'text-slate-400'}`}>
                    {brain.name}
                  </h3>
                  <p className="text-[10px] uppercase text-slate-500 tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                    {brain.role}
                  </p>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
