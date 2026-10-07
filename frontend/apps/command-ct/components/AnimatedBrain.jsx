import React from 'react';
import CrystalLoader from './CrystalLoader';

export const AnimatedBrain = ({ isActive, showText = false }) => {
    return (
        <div className="flex items-center gap-3 group">
            {/* The SOMA Brain Logo */}
            <div className="relative w-10 h-10 flex items-center justify-center">
                
                {/* Aura Glow - Intensifies when thinking */}
                <div className={`absolute inset-0 rounded-full bg-cyan-500/20 blur-xl transition-all duration-1000 ${isActive ? 'scale-150 opacity-100 animate-pulse' : 'scale-100 opacity-0 group-hover:opacity-30'}`}></div>

                {/* The Brain SVG */}
                <svg
                    viewBox="0 0 24 24"
                    className={`w-8 h-8 relative z-10 transition-all duration-700 ${isActive ? 'text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'text-zinc-600 group-hover:text-zinc-400'}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
                    
                    {/* Inner Drifting Particles (CSS animated for smoothness) */}
                    <circle cx="9" cy="12" r="1" fill="currentColor" className={isActive ? "animate-[bounce_2s_infinite]" : "opacity-0"}>
                        <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" />
                    </circle>
                    <circle cx="15" cy="10" r="1" fill="currentColor" className={isActive ? "animate-[bounce_3s_infinite]" : "opacity-0"}>
                        <animate attributeName="opacity" values="0;1;0" dur="3s" repeatCount="indefinite" />
                    </circle>
                    <circle cx="12" cy="16" r="1" fill="currentColor" className={isActive ? "animate-[bounce_2.5s_infinite]" : "opacity-0"}>
                        <animate attributeName="opacity" values="0;1;0" dur="2.5s" repeatCount="indefinite" />
                    </circle>
                </svg>

                {/* Orbiting Sync Rings */}
                {isActive && (
                    <div className="absolute inset-0 border-2 border-cyan-500/30 rounded-full animate-[spin_4s_linear_infinite] border-t-transparent border-l-transparent"></div>
                )}
            </div>

            {/* SOMA Text Next to Logo */}
            {showText && (
                <div className="flex flex-col">
                    <h1 className={`text-xl font-bold tracking-tighter transition-all duration-500 ${isActive ? 'text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                        SOMA
                    </h1>
                    {isActive && (
                        <div className="-mt-2 -ml-8">
                            <CrystalLoader size="xs" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
