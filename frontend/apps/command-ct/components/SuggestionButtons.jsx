import React from 'react';

export const SuggestionButtons = ({ suggestions, onSuggestionClick, isLoading }) => {
  if (suggestions.length === 0 || isLoading) {
    return null;
  }

  return (
    <div className="mt-2 flex items-center flex-wrap gap-2 animate-fade-in">
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSuggestionClick(s)}
          className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-100 text-xs font-medium rounded-full transition-all duration-200 border border-white/5 hover:border-white/10"
        >
          {s}
        </button>
      ))}
    </div>
  );
};
