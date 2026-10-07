import React from 'react';
import { BRAINS } from '../constants.js';
import { BrainType } from '../types.js';
import { Brain, Eye, Cpu, ShieldCheck } from 'lucide-react';

export const ThreeBrains = ({ onSelectBrain, activeBrain }) => {
    const getBrainIcon = (type, size = 18) => {
        switch (type) {
            case BrainType.AURORA: return <Brain size={size} />;
            case BrainType.PROMETHEUS: return <Eye size={size} />;
            case BrainType.LOGOS: return <Cpu size={size} />;
            case BrainType.THALAMUS: return <ShieldCheck size={size} />;
        }
    };

    return (
        <div className="absolute left-6 top-24 z-30 pointer-events-none">
            <div className="pointer-events-auto flex w-[210px] flex-col gap-2 rounded-2xl border border-white/10 bg-black/30 p-2 shadow-2xl backdrop-blur-xl">
                <div className="px-2 pb-1 pt-1">
                    <div className="text-[9px] font-bold uppercase tracking-[0.28em] text-zinc-500">Cognitive Lanes</div>
                </div>
                {Object.values(BRAINS).map((brain) => {
                    const isActive = activeBrain === brain.id;
                    const isMuted = activeBrain && !isActive;

                    return (
                        <button
                            key={brain.id}
                            onClick={() => onSelectBrain(brain.id)}
                            className={`group flex min-h-[54px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all duration-300
                                ${isActive ? 'border-white/20 bg-white/10 shadow-lg' : 'border-white/5 bg-white/[0.025] hover:border-white/12 hover:bg-white/[0.06]'}
                                ${isMuted ? 'opacity-45' : 'opacity-100'}`}
                        >
                            <div
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04]"
                                style={{ color: brain.color, boxShadow: isActive ? `0 0 22px ${brain.color}55` : 'none' }}
                            >
                                {getBrainIcon(brain.id)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className={`truncate text-[11px] font-bold uppercase tracking-[0.2em] ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                                    {brain.name}
                                </div>
                                <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                                    {brain.role}
                                </div>
                            </div>
                            <div
                                className={`h-2 w-2 rounded-full transition-opacity ${isActive ? 'opacity-100' : 'opacity-30 group-hover:opacity-70'}`}
                                style={{ backgroundColor: brain.color }}
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
