import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Send, Activity, Brain, Move, Zap, XCircle } from 'lucide-react';
import MarkdownIt from 'markdown-it';
import { parseEmotes } from '../lib/emotes';
import PixelAvatar from './PixelAvatar';
import somaBackend from '../somaBackend.js';

const md = new MarkdownIt({
  highlight: function (str, lang) {
    return `<pre class="bg-black/50 p-2 rounded-lg overflow-x-auto my-2 border border-white/5"><code class="text-xs text-fuchsia-300">${str}</code></pre>`;
  }
});

const RARITY_GLOW = {
  common: 'border-zinc-600/40',
  uncommon: 'border-emerald-500/40',
  rare: 'border-blue-500/50',
  epic: 'border-purple-500/50',
  legendary: 'border-amber-500/60',
};

const FloatingChat = ({ isServerRunning, isBusy, onSendMessage, activeModule }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [suggestion, setSuggestion] = useState(null);
  const [isThinking, setIsThinking] = useState(false); // local thinking state independent of parent isBusy
  const messagesEndRef = useRef(null);

  // Dragging State
  const [position, setPosition] = useState(null); // { x: number, y: number }
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState(false);
  const chatRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isBusy]);

  // ── SOMA speaks first: autonomous proactive messages ──────────────────────
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    const handleProactive = (payload) => {
      const text = payload.message || payload.text || String(payload);
      if (!text) return;
      setMessages(prev => [...prev, {
        id: Date.now(),
        text,
        sender: 'system',
        autonomous: true
      }]);
      // Auto-open chat so SOMA's message isn't invisible
      setIsOpen(prev => {
        if (!prev) setUnreadCount(c => c + 1);
        return true;
      });
    };

    const handleActivity = (payload) => {
      const { source, description, output, status } = payload;
      if (status !== 'ok') return; // only surface successes in chat
      const summary = output
        ? `_[${source}] ${description} → ${output.substring(0, 120)}_`
        : `_[${source}] ${description}_`;
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: summary,
        sender: 'system',
        autonomous: true
      }]);
    };

    somaBackend.on('soma_proactive', handleProactive);
    somaBackend.on('soma_activity', handleActivity);
    return () => {
      somaBackend.off('soma_proactive', handleProactive);
      somaBackend.off('soma_activity', handleActivity);
    };
  }, []);

  // Drag Handlers
  const handleMouseDown = (e) => {
    // Only allow dragging from the button (if closed) or the header (if open)
    // We can filter this by checking if the target has a 'data-drag-handle' attribute or similar, 
    // but for now, we'll attach this handler to the specific elements.
    if (e.button !== 0) return; // Only left click

    const rect = chatRef.current.getBoundingClientRect();

    // If this is the first drag, we need to snap from CSS positioning to absolute positioning
    const currentX = position ? position.x : rect.left;
    const currentY = position ? position.y : rect.top;

    setDragOffset({
      x: e.clientX - currentX,
      y: e.clientY - currentY
    });

    // Set initial position immediately to prevent jumping
    setPosition({ x: currentX, y: currentY });
    setIsDragging(true);
    setHasMoved(false);

    e.preventDefault(); // Prevent text selection
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;

      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Simple bounds checking (optional, nice to have)
      const maxX = window.innerWidth - (isOpen ? 384 : 56); // w-96 = 384px, w-14 = 56px
      const maxY = window.innerHeight - (isOpen ? 500 : 56);

      setPosition({
        x: Math.min(Math.max(0, newX), window.innerWidth - 50), // loosen bounds slightly
        y: Math.min(Math.max(0, newY), window.innerHeight - 50)
      });
      setHasMoved(true);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, isOpen]);

  // Smart Positioning: Clamp window to viewport when opening
  useEffect(() => {
    if (isOpen && position) {
      const PADDING = 24;
      const WIDTH = 384; // w-96
      const HEIGHT = 500; // h-[500px]
      const winW = window.innerWidth;
      const winH = window.innerHeight;

      let newX = position.x;
      let newY = position.y;
      let needsUpdate = false;

      // Check Right Edge
      if (newX + WIDTH + PADDING > winW) {
        newX = winW - WIDTH - PADDING;
        needsUpdate = true;
      }
      // Check Left Edge
      if (newX < PADDING) {
        newX = PADDING;
        needsUpdate = true;
      }

      // Check Bottom Edge
      if (newY + HEIGHT + PADDING > winH) {
        newY = winH - HEIGHT - PADDING;
        needsUpdate = true;
      }
      // Check Top Edge
      if (newY < PADDING) {
        newY = PADDING;
        needsUpdate = true;
      }

      if (needsUpdate) {
        setPosition({ x: newX, y: newY });
      }
    }
  }, [isOpen, position]);

  const toggleOpen = () => {
    if (!hasMoved) {
      setIsOpen(!isOpen);
    }
  };

  const handleAssignAgent = async (char) => {
    setSuggestion(null);
    try {
      await fetch('/api/characters/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: char.id })
      });
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: `**${char.shortName}** has been activated. Their ${char.domain?.label || 'general'} expertise is now channeled through SOMA.`,
        sender: 'system',
        isAgentNotice: true
      }]);
    } catch {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || !isServerRunning || isBusy || isThinking) return;

    const message = input.trim();
    const userMsg = { id: Date.now(), text: message, sender: 'user' };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSuggestion(null);
    setIsThinking(true);

    // Build conversation history for context (last 6 exchanges)
    const history = messages.slice(-6).map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    try {
      const response = await onSendMessage(message, { history, activeModule });
      if (response) {
        const text = typeof response === 'string' ? response : response.text;
        const charSuggestion = typeof response === 'object' ? response.characterSuggestion : null;
        if (text) {
          setMessages(prev => [...prev, { id: Date.now() + 1, text, sender: 'system' }]);
        }
        if (charSuggestion) {
          setSuggestion(charSuggestion);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now() + 1, text: "_Neural Link unstable. Perimeter defense active._", sender: 'system' }]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div
      ref={chatRef}
      className={`fixed z-[100] ${!position ? 'bottom-6 right-6' : ''} transition-width duration-300 ${isOpen ? 'w-96' : 'w-14'}`}
      style={position ? { left: position.x, top: position.y } : {}}
    >
      {!isOpen ? (
        <button
          onMouseDown={handleMouseDown}
          onClick={() => { toggleOpen(); setUnreadCount(0); }}
          className={`relative w-14 h-14 rounded-full bg-[#151518]/90 backdrop-blur-md border ${unreadCount > 0 ? 'border-fuchsia-500/60 animate-pulse' : 'border-white/10'} flex items-center justify-center shadow-2xl hover:border-white/20 transition-all group ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          title="SOMA Chat (Drag to move)"
        >
          {/* Static Fuchsia Brain Icon */}
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="text-fuchsia-500 transition-transform group-hover:scale-110">
            <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-fuchsia-500 text-white text-[10px] font-bold flex items-center justify-center shadow-lg">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      ) : (
        <div className="bg-[#151518]/90 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[500px]">
          {/* Draggable Header */}
          <div
            onMouseDown={handleMouseDown}
            className={`p-4 border-b border-white/5 flex items-center justify-between bg-black/40 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          >
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isServerRunning ? 'bg-fuchsia-500' : 'bg-rose-500'} shadow-[0_0_8px_currentColor]`} />
              <span className="text-zinc-200 font-semibold text-sm tracking-tight">SOMA</span>
              <Move className="w-3 h-3 text-zinc-600 ml-2" />
            </div>
            {/* Close button stops propagation to prevent drag start */}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setIsOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[#09090b]/50">
            {messages.length === 0 && (
              <div className="text-center text-zinc-600 text-xs py-12 flex flex-col items-center">
                <Brain className="w-10 h-10 mb-3 opacity-20 text-fuchsia-500 animate-pulse" />
                <p className="font-mono uppercase tracking-widest opacity-50">Neural Link Established</p>
                <p className="mt-1">Awaiting consciousness interface...</p>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.sender === 'user'
                  ? 'bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-50'
                  : msg.autonomous
                  ? 'bg-violet-950/40 border border-violet-500/30 text-violet-200'
                  : 'bg-white/5 border border-white/10 text-zinc-200'
                  }`}>
                  {msg.autonomous && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                      <span className="text-[9px] font-mono uppercase tracking-widest text-violet-400 opacity-80">autonomous</span>
                    </div>
                  )}
                  <div
                    className="markdown-content"
                    dangerouslySetInnerHTML={{ __html: parseEmotes(md.render(msg.text)) }}
                  />
                </div>
              </div>
            ))}
            {/* Agent Suggestion Popup */}
            {suggestion && (
              <div className={`mx-1 p-3 rounded-xl bg-[#0d0d10]/90 border ${RARITY_GLOW[suggestion.rarity] || 'border-cyan-500/40'} shadow-lg animate-in fade-in slide-in-from-bottom-2`}>
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">Agent Available</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg overflow-hidden bg-black/50 p-1 border border-white/5 flex-shrink-0">
                    <PixelAvatar
                      seed={suggestion.avatarSeed || suggestion.id}
                      colors={suggestion.avatarColors}
                      creatureType={suggestion.creatureType !== 'humanoid' ? suggestion.creatureType : null}
                      size={44}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-zinc-100 text-xs font-semibold truncate">{suggestion.name}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{suggestion.domain?.emoji} {suggestion.reason}</div>
                  </div>
                </div>
                <div className="flex gap-2 mt-2.5">
                  <button
                    onClick={() => handleAssignAgent(suggestion)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold uppercase tracking-wider hover:bg-cyan-500/30 transition-colors"
                  >
                    <Zap className="w-3 h-3" /> Assign
                  </button>
                  <button
                    onClick={() => setSuggestion(null)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/30 text-zinc-500 text-[10px] font-bold uppercase tracking-wider hover:text-zinc-300 transition-colors"
                  >
                    No thanks
                  </button>
                </div>
              </div>
            )}

            {isThinking && (
              <div className="flex justify-start">
                <div className="bg-white/5 border border-white/10 px-4 py-3 rounded-2xl flex items-center space-x-2">
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 bg-fuchsia-500/50 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-fuchsia-500/50 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="w-1.5 h-1.5 bg-fuchsia-500/50 rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">Processing</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="p-3 border-t border-white/5 bg-black/40">
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={!isServerRunning ? "Neural link severed" : isThinking ? "SOMA is thinking..." : "Ask anything..."}
                disabled={!isServerRunning || isBusy || isThinking}
                className="w-full bg-black/60 border border-white/10 rounded-xl pl-4 pr-10 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-fuchsia-500/40 focus:ring-1 focus:ring-fuchsia-500/20 transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || !isServerRunning || isBusy || isThinking}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 rounded-lg text-fuchsia-400 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default FloatingChat;