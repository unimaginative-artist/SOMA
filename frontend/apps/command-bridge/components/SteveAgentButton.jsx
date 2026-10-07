
import React, { useState } from 'react';
import { Bot, Sparkles, GripVertical } from 'lucide-react';

const SteveAgentButton = ({ onClick, isActive, position, onMouseDown, isDragging }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="fixed z-[1000] group flex flex-col items-center justify-center select-none"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
      onMouseDown={onMouseDown}
    >
      {/* Tooltip - Adjusted for drag state */}
      {!isDragging && (
        <div className={`absolute bottom-full mb-6 transition-all duration-300 transform ${isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
          <div className="bg-zinc-900/95 backdrop-blur-md border border-emerald-500/30 text-emerald-400 px-5 py-2.5 rounded-2xl text-xs font-bold shadow-2xl flex items-center space-x-2 whitespace-nowrap">
            <Sparkles className="w-4 h-4" />
            <span>{isActive ? 'Minimize Architect' : 'Drag or Click Steve'}</span>
          </div>
          <div className="w-2.5 h-2.5 bg-zinc-900 border-r border-b border-emerald-500/30 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>
        </div>
      )}

      <div className="relative">
        {/* Status Dot Badge - Now just a small pulsing dot on the top right */}
        {!isDragging && (
          <div className="absolute -top-1 -right-1 z-10 w-4 h-4 rounded-full bg-zinc-950 border border-emerald-500/30 flex items-center justify-center shadow-lg transition-opacity duration-300">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          </div>
        )}

        {/* The Orb - Changed to rounded-full */}
        <button
          onClick={(e) => { e.stopPropagation(); onClick?.(); }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`
            relative w-16 h-16 rounded-full flex items-center justify-center 
            transition-all duration-300 ease-out transform
            ${isDragging ? 'scale-110 shadow-[0_25px_50px_rgba(0,0,0,0.5)]' : isHovered ? 'scale-105 -translate-y-1' : 'scale-100'}
            ${isActive ? 'bg-emerald-400 shadow-[0_20px_40px_rgba(16,185,129,0.4)]' : 'bg-zinc-900/90 backdrop-blur-2xl border border-emerald-400/20 shadow-2xl'}
          `}
        >
          {/* Internal Glow - Changed to rounded-full */}
          <div className={`absolute inset-0 rounded-full bg-emerald-400 transition-opacity duration-700 ${isActive ? 'opacity-20 animate-pulse' : 'opacity-0 group-hover:opacity-5'}`}></div>


          <img
            src="/steve_profile.gif"
            alt="Steve"
            className={`w-full h-full object-cover rounded-full transition-all duration-500 hover:scale-110 ${isActive ? 'p-0.5' : 'p-1'}`}
          />
          <div className={`absolute inset-0 rounded-full border-2 transition-colors duration-500 ${isActive ? 'border-zinc-950/20' : 'border-emerald-500/20'}`}></div>

          {/* Drag Handle Icon (Subtle) */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-40 transition-opacity">
            <GripVertical className="w-3 h-3 text-emerald-400 rotate-90" />
          </div>

          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/10 via-transparent to-transparent pointer-events-none"></div>
        </button>
      </div>

      {/* Dynamic Shadow */}
      <div className={`mt-2 h-1 bg-black/40 blur-md rounded-full transition-all duration-500 ${isDragging ? 'w-20 opacity-20' : isHovered ? 'w-12 opacity-80' : 'w-8 opacity-40'}`}></div>
    </div>
  );
};

export default SteveAgentButton;
