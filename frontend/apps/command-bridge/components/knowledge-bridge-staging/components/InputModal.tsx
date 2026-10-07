
import React, { useState, useEffect, useRef } from 'react';
import { Zap, X } from 'lucide-react';

interface InputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

export const InputModal: React.FC<InputModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value);
      setValue('');
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-slate-900 border border-yellow-500/30 rounded-lg shadow-[0_0_50px_rgba(234,179,8,0.2)] overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-950/50 px-6 py-4 flex justify-between items-center border-b border-white/5">
          <div className="flex items-center space-x-2 text-yellow-400">
            <Zap size={20} />
            <span className="font-bold display-font tracking-widest text-lg">INJECT HYPOTHESIS</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-8">
          <p className="text-slate-400 text-sm mb-4">
            Enter a seed concept. The Three Minds will analyze, deconstruct, and integrate it into the graph.
          </p>
          
          <div className="relative group">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g., 'The singularity is inevitable' or 'Ocean colonization'"
              className="w-full bg-slate-950 border border-slate-700 text-white px-4 py-4 rounded focus:outline-none focus:border-yellow-500 transition-colors text-lg font-mono placeholder:text-slate-700"
            />
            <div className="absolute inset-0 border border-yellow-500/20 rounded pointer-events-none group-hover:border-yellow-500/40 transition-colors"></div>
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-white text-sm uppercase tracking-wider font-bold"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={!value.trim()}
              className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold uppercase tracking-wider text-sm rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(234,179,8,0.4)] hover:shadow-[0_0_30px_rgba(234,179,8,0.6)]"
            >
              Initialize Upload
            </button>
          </div>
        </form>

        {/* Decorative Progress Line */}
        <div className="h-1 bg-slate-800 w-full">
            <div className="h-full bg-yellow-500 w-1/3 animate-[loading_2s_ease-in-out_infinite]"></div>
        </div>
      </div>
    </div>
  );
};
