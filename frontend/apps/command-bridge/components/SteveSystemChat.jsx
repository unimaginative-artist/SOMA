import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles, Terminal, Rocket, ChevronRight, Check, Code, Brain } from 'lucide-react';

const WITTY_PHRASES = [
  "Rerouting synaptic pathways...",
  "Consulting the Oracle...",
  "Judging your code structure...",
  "Synthesizing brilliance...",
  "Allocating neurons...",
  "Pondering the meaning of 'undefined'...",
  "Wiring new connections...",
  "Optimizing sarcasm module..."
];

const SteveSystemChat = ({ isOpen, onClose, onActionExecute, onApplyEdits, messages, onSendMessage, isProcessing, buttonPosition, onOpenSettings }) => {
  const [input, setInput] = useState('');
  const [loadingPhrase, setLoadingPhrase] = useState("Processing...");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // Cycle witty phrases when processing
  useEffect(() => {
    if (isProcessing) {
      setLoadingPhrase(WITTY_PHRASES[Math.floor(Math.random() * WITTY_PHRASES.length)]);
      const interval = setInterval(() => {
        setLoadingPhrase(WITTY_PHRASES[Math.floor(Math.random() * WITTY_PHRASES.length)]);
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [isProcessing]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    onSendMessage(input);
    setInput('');
  };

  // Dynamic Positioning Logic
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  const isOnRight = buttonPosition.x > screenWidth / 2;
  const isAtBottom = buttonPosition.y > screenHeight / 2;

  const chatStyles = {
    position: 'fixed',
    zIndex: 900,
    // Horizontal positioning
    left: isOnRight ? 'auto' : buttonPosition.x + 40,
    right: isOnRight ? (screenWidth - buttonPosition.x) + 40 : 'auto',
    // Vertical positioning
    top: isAtBottom ? 'auto' : buttonPosition.y - 20,
    bottom: isAtBottom ? (screenHeight - buttonPosition.y) - 20 : 'auto',
    
    // Smooth emergence
    transformOrigin: `${isOnRight ? 'right' : 'left'} ${isAtBottom ? 'bottom' : 'top'}`,
  };

  return (
    <div 
      style={chatStyles}
      className="w-96 h-[500px] flex flex-col bg-zinc-950/90 backdrop-blur-3xl border border-emerald-500/20 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_rgba(16,185,129,0.1)] overflow-hidden animate-in zoom-in-95 fade-in duration-300"
    >
      {/* Header */}
      <div className="p-4 border-b border-zinc-800/50 flex items-center justify-between bg-emerald-500/5">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30 overflow-hidden">
             {/* Try to load the GIF, fallback to Icon */}
             <img 
                src="/steve_profile.gif" 
                alt="Steve"
                className="w-full h-full object-cover"
                onError={(e) => { e.target.style.display = 'none'; }} 
             />
             <Bot className="w-4 h-4 text-emerald-400 absolute" style={{ zIndex: -1 }} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">S.T.E.V.E.</h3>
            <div className="flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-500/70 uppercase tracking-widest">Architect Core</span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
            {onOpenSettings && (
                <button 
                    onClick={onOpenSettings} 
                    className="p-1.5 hover:bg-emerald-500/10 rounded-lg text-zinc-500 hover:text-emerald-400 transition-colors group relative" 
                    title="Open Neural Dashboard"
                >
                    <Brain className="w-4 h-4" />
                    {/* Tiny tooltip for context */}
                    <span className="absolute right-0 -bottom-8 bg-black text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-white/10 text-zinc-300">
                        Neural Dashboard
                    </span>
                </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
            </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth custom-scrollbar">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`
              max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm
              ${m.role === 'user' 
                ? 'bg-blue-600/10 border border-blue-500/20 text-blue-100 rounded-tr-none' 
                : 'bg-zinc-900/80 border border-zinc-800 text-zinc-300 rounded-tl-none'}
            `}>
              {m.content}
              
              {m.updatedFiles && m.updatedFiles.length > 0 && (
                <div className="mt-4 p-3 bg-zinc-950 rounded-xl border border-emerald-500/30 space-y-3">
                   <div className="flex items-center space-x-2 text-emerald-400 text-[9px] font-bold uppercase tracking-widest">
                      <Sparkles className="w-3 h-3" />
                      <span>Code Synthesis Ready</span>
                   </div>
                   <div className="space-y-1">
                      {m.updatedFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center space-x-2 text-[9px] text-zinc-500 font-mono">
                           <Code className="w-2.5 h-2.5" />
                           <span className="truncate">{file.path}</span>
                        </div>
                      ))}
                   </div>
                   <button
                     onClick={() => onApplyEdits(m.updatedFiles)}
                     className="w-full flex items-center justify-center space-x-2 bg-emerald-500 text-zinc-950 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors"
                   >
                     <Check className="w-3 h-3" />
                     <span>Apply Changes</span>
                   </button>
                </div>
              )}

              {m.actions && m.actions.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {m.actions.map((act, idx) => (
                    <button
                      key={idx}
                      onClick={() => onActionExecute(act)}
                      className="flex items-center space-x-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 p-2 rounded-lg text-emerald-400 transition-all text-left group"
                    >
                      <Terminal className="w-3 h-3 shrink-0" />
                      <span className="font-mono text-[10px] truncate">{act}</span>
                      <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="text-[8px] font-bold text-zinc-600 uppercase mt-1 tracking-tighter">
              {m.role === 'user' ? 'You' : 'S.T.E.V.E.'}
            </span>
          </div>
        ))}
        {isProcessing && (
          <div className="flex items-center space-x-2 text-emerald-500/60 font-mono text-[10px] pl-1 animate-pulse">
            <Sparkles className="w-3 h-3 animate-spin" />
            <span>{loadingPhrase}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 bg-zinc-900/30 border-t border-zinc-800/50">
        <div className="relative group">
          <input 
            autoFocus
            className={`
              w-full bg-zinc-900 border rounded-xl py-3 pl-4 pr-12 text-xs text-zinc-200 outline-none transition-all
              ${isProcessing ? 'opacity-50 cursor-not-allowed border-zinc-800' : 'border-zinc-800 focus:border-emerald-500/50 group-hover:border-zinc-700'}
            `}
            placeholder="Command S.T.E.V.E. to execute..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isProcessing}
          />
          <button 
            type="submit"
            disabled={isProcessing || !input.trim()}
            className="absolute right-2 top-2 p-1.5 bg-emerald-500 text-zinc-950 rounded-lg disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-600 transition-all"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default SteveSystemChat;