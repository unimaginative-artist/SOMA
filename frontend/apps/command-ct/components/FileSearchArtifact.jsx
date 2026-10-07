import React, { useState } from 'react';
import { Search, Folder, File, ChevronRight, ChevronDown, ArrowRight } from 'lucide-react';

export const FileSearchArtifact = ({ query, results = [] }) => {
  const [isOpen, setIsOpen] = useState(true);

  if (!results || results.length === 0) {
    return (
      <div className="bg-[#1c1c1e] border border-white/5 rounded-lg p-4 my-2 max-w-2xl">
        <div className="flex items-center space-x-2 text-zinc-400">
          <Search className="w-4 h-4" />
          <span className="text-sm font-medium">No files found for "{query}"</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1c1c1e] border border-white/5 rounded-xl overflow-hidden my-2 max-w-2xl shadow-lg">
      {/* Header */}
      <div 
        className="flex items-center justify-between p-3 bg-white/5 border-b border-white/5 cursor-pointer hover:bg-white/10 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-blue-500/20 rounded text-blue-400">
            <Search className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-semibold text-zinc-200">
            Found {results.length} matches for <span className="text-blue-400">"{query}"</span>
          </span>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
      </div>

      {/* Results List */}
      {isOpen && (
        <div className="max-h-64 overflow-y-auto custom-scrollbar">
          {results.map((file, idx) => (
            <div 
              key={idx}
              className="flex items-center justify-between p-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 group cursor-pointer"
              onClick={() => {
                // Future: Handle file click (e.g., emit event to open file)
                // For now, perhaps just copy path or log
                console.log('Selected file:', file.path);
              }}
            >
              <div className="flex items-center space-x-3 overflow-hidden">
                {file.isDirectory ? (
                  <Folder className="w-4 h-4 text-amber-400 flex-shrink-0" />
                ) : (
                  <File className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                )}
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm text-zinc-200 truncate">{file.name}</span>
                  <span className="text-[10px] text-zinc-500 truncate font-mono">{file.path}</span>
                </div>
              </div>
              
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                 <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Footer */}
      {isOpen && results.length > 5 && (
        <div className="p-2 bg-black/20 text-center text-[10px] text-zinc-500 border-t border-white/5">
          Scroll for more
        </div>
      )}
    </div>
  );
};
