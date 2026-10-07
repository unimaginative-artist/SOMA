import React, { useState } from 'react';

export const ImageArtifact = ({ src, prompt }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-zinc-800/50 backdrop-blur-md rounded-xl my-3 border border-white/5 shadow-xl inline-block overflow-hidden group max-w-md transition-all duration-300 hover:shadow-2xl">
      <div className="relative">
        <img 
          src={src} 
          alt={prompt} 
          className={`w-full h-auto object-cover transition-all duration-500 ${isExpanded ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
          onClick={() => setIsExpanded(!isExpanded)}
        />
        {!isExpanded && (
           <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-950/90 to-transparent p-4 pt-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
             <p className="text-[10px] text-zinc-300 truncate font-medium">{prompt}</p>
           </div>
        )}
      </div>
      {isExpanded && (
        <div className="p-4 bg-zinc-900/95 border-t border-white/5">
            <p className="text-xs text-zinc-400 font-mono mb-3 leading-relaxed">{prompt}</p>
            <a 
              href={src} 
              download={`soma-gen-${Date.now()}.png`}
              className="inline-flex items-center text-xs bg-white text-zinc-900 hover:bg-zinc-200 font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Download Asset
            </a>
        </div>
      )}
    </div>
  );
};
