import React, { useState, useEffect, useRef } from 'react';
import { Search, File, Terminal, Activity, Zap, Network, ArrowRight, Tv } from 'lucide-react';

const CommandPalette = ({ isOpen, onClose, onNavigate, onExecute }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
      setResults(defaultOptions);
    }
  }, [isOpen]);

  // Default options when query is empty
  const defaultOptions = [
    { id: 'nav-twitch', type: 'nav', label: 'Go to Twitch & Social', icon: Tv, action: () => onNavigate('social') },
    { id: 'nav-kevin', type: 'nav', label: 'Go to K.E.V.I.N.', icon: Activity, action: () => onNavigate('kevin') },
    { id: 'nav-spine', type: 'nav', label: 'Go to Spine', icon: Network, action: () => onNavigate('spine') },
    { id: 'nav-steve', type: 'nav', label: 'Go to S.T.E.V.E. (Workflow)', icon: Terminal, action: () => onNavigate('workflow') },
    { id: 'nav-storage', type: 'nav', label: 'Go to Storage', icon: File, action: () => onNavigate('storage') },
    { id: 'cmd-restart', type: 'cmd', label: 'Restart Backend', icon: Zap, action: () => onExecute('restart_system') },
  ];

  // Handle Search
  useEffect(() => {
    if (!query) {
      setResults(defaultOptions);
      return;
    }

    const search = async () => {
      const lowerQuery = query.toLowerCase();
      
      // 1. Filter default options
      const localMatches = defaultOptions.filter(opt => 
        opt.label.toLowerCase().includes(lowerQuery)
      );

      // 2. Search Files (Real Backend Search)
      try {
        const res = await fetch('/api/search/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, maxResults: 5 })
        });
        const data = await res.json();
        
        const fileMatches = (data.results || []).map(f => ({
          id: f.fullPath,
          type: 'file',
          label: f.name,
          subLabel: f.path,
          icon: File,
          action: () => console.log('Open file:', f.fullPath) // Placeholder for file opening
        }));

        setResults([...localMatches, ...fileMatches]);
        setSelectedIndex(0);
      } catch (e) {
        console.error('Search failed', e);
        setResults(localMatches);
      }
    };

    const timer = setTimeout(search, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Handle Keyboard Navigation
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        results[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div 
        className="w-full max-w-2xl bg-[#151518] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Input Area */}
        <div className="flex items-center px-4 py-3 border-b border-white/5">
          <Search className="w-5 h-5 text-zinc-500 mr-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files, commands, or agents..."
            className="flex-1 bg-transparent border-none outline-none text-lg text-white placeholder-zinc-600 font-sans"
            autoFocus
          />
          <div className="flex gap-2">
            <kbd className="hidden sm:inline-block px-2 py-0.5 bg-zinc-800 rounded text-[10px] text-zinc-400 font-mono border border-white/5">ESC</kbd>
          </div>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar p-2">
          {results.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">No results found.</div>
          ) : (
            results.map((item, idx) => (
              <div
                key={item.id}
                className={`flex items-center px-3 py-3 rounded-lg cursor-pointer transition-colors ${
                  idx === selectedIndex ? 'bg-fuchsia-500/10 text-white' : 'text-zinc-400 hover:bg-white/5'
                }`}
                onClick={() => { item.action(); onClose(); }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className={`p-2 rounded-md mr-3 ${idx === selectedIndex ? 'bg-fuchsia-500/20 text-fuchsia-400' : 'bg-zinc-800 text-zinc-500'}`}>
                  <item.icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${idx === selectedIndex ? 'text-fuchsia-100' : 'text-zinc-300'}`}>
                    {item.label}
                  </div>
                  {item.subLabel && (
                    <div className="text-[10px] text-zinc-500 truncate">{item.subLabel}</div>
                  )}
                </div>
                {idx === selectedIndex && <ArrowRight className="w-4 h-4 text-fuchsia-500 ml-2" />}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-black/20 border-t border-white/5 text-[10px] text-zinc-600 flex justify-between">
          <span>SOMA Omni-Search</span>
          <div className="flex gap-3">
            <span><strong className="text-zinc-500">↑↓</strong> Navigate</span>
            <span><strong className="text-zinc-500">↵</strong> Select</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
