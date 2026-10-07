import React from 'react';

export const PaletteArtifact = ({ colors, theme }) => {
  const handleCopy = (hex) => {
    navigator.clipboard.writeText(hex);
  };

  return (
    <div className="bg-zinc-800/50 backdrop-blur-md rounded-xl my-3 border border-white/5 shadow-lg w-full overflow-hidden">
      <div className="px-4 py-3 bg-white/5 border-b border-white/5 flex justify-between items-center">
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Palette: {theme}</h3>
        <span className="text-[10px] text-zinc-500">Click to copy</span>
      </div>
      <div className="p-4 flex flex-col md:flex-row h-full md:h-32 gap-2">
        {colors.map((color, index) => (
          <div 
            key={index} 
            className="group relative flex-1 min-h-[60px] md:min-h-full rounded-lg shadow-md flex flex-col justify-end p-3 transition-all duration-300 hover:flex-[1.5] cursor-pointer hover:shadow-lg ring-0 hover:ring-2 ring-white/20"
            style={{ backgroundColor: color.hex }}
            onClick={() => handleCopy(color.hex)}
          >
            <div className="bg-black/40 backdrop-blur-md p-2 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0">
              <p className="text-white font-mono text-xs font-bold">{color.hex}</p>
              <p className="text-zinc-200 text-[10px] font-medium">{color.name}</p>
              <p className="text-zinc-300 text-[9px] opacity-80 truncate">{color.usage}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
