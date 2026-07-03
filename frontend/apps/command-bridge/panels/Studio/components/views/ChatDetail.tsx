import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Phone, Video, Info, Image as ImageIcon, Mic, Sticker, Heart, Search, X, ShieldCheck } from 'lucide-react';
import { ChatSession, ChatMessage, IdentityProfile } from '../../types';
import { getDirectMessages, searchDirectMessages, sendDirectMessage } from '../../services/directsService';
import { loadSecureMessages, sendSecureMessage, openSecureMessage } from '../../services/secureDirectsService';
import { stableAvatar } from '../../services/avatarService';
import IdentityChip from '../identity/IdentityChip';

interface Props {
  chat: ChatSession;
  onBack: () => void;
  currentUserAvatar: string;
}

/* A sealed "Pathway" message, inline in the same thread — rendered in the
   violet/rose secure style with a burn bar and tap-to-reveal for view-once. */
const SecureBubble: React.FC<{ msg: ChatMessage; senderName: string; onReveal: (m: ChatMessage) => void }> = ({ msg, senderName, onReveal }) => {
  const isMe = msg.sender === 'user';
  const locked = !!msg.locked && !isMe;
  const burnTtl = msg.ttl || (msg.viewOnce ? 12 : 0);
  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} items-end`}>
      <div className="relative max-w-[72%]">
        <div className={`mb-1 flex items-center gap-1.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
          <ShieldCheck size={11} className="text-fuchsia-400" />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-fuchsia-400">{isMe ? 'Sealed' : `${senderName} · Sealed`}</span>
          {msg.viewOnce && <span className="font-mono text-[8.5px] text-rose-400">· view once</span>}
          {(msg.ttl || 0) > 0 && <span className="font-mono text-[8.5px] text-rose-400">· {msg.ttl}s</span>}
        </div>
        <div
          onClick={locked ? () => onReveal(msg) : undefined}
          className={`relative overflow-hidden px-3.5 py-2.5 text-[15px] leading-snug ${locked ? 'cursor-pointer' : ''} ${
            isMe
              ? 'rounded-[18px_18px_5px_18px] bg-gradient-to-br from-fuchsia-500 to-rose-500 text-white'
              : 'rounded-[18px_18px_18px_5px] border border-fuchsia-400/35 bg-fuchsia-500/[0.08] text-fuchsia-50'
          }`}
        >
          {locked ? <span className="font-semibold text-fuchsia-200">📷 Tap to open · view once</span> : msg.text}
          {msg.expiresAt && burnTtl ? (
            <span
              className="absolute bottom-0 left-0 h-[2px] rounded-full"
              style={{
                width: '100%',
                background: 'linear-gradient(90deg,#fb7185,#ef4444)',
                boxShadow: '0 0 6px #ef4444',
                animation: `pw-burn ${burnTtl}s linear forwards`,
                animationDelay: `-${Math.max(0, (Date.now() - (msg.ts || Date.now())) / 1000)}s`,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

const ChatDetail: React.FC<Props> = ({ chat, onBack, currentUserAvatar }) => {
  const chatAvatar = stableAvatar({ id: chat.id, title: chat.title, image: chat.image });
  const userAvatar = stableAvatar({ id: 'studio-user', name: 'You', image: currentUserAvatar });
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'other',
      text: "Did you see the new update?",
      timestamp: '10:02 AM',
      avatar: chatAvatar
    },
    {
      id: '2',
      sender: 'user',
      text: "Yeah looks amazing! The dark mode is perfect.",
      timestamp: '10:05 AM',
    },
    {
      id: '3',
      sender: 'other',
      text: "Sending you the files now.",
      timestamp: '10:11 AM',
      avatar: chatAvatar
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [secure, setSecure] = useState(false);        // Pathway (sealed) mode armed
  const [ttl, setTtl] = useState(0);
  const [viewOnce, setViewOnce] = useState(false);
  const pullRef = useRef<() => void>(() => {});

  // Load + poll BOTH the normal thread and its sealed Pathway messages, merged by time.
  useEffect(() => {
      let cancelled = false;
      const pull = () => Promise.all([
          getDirectMessages(chat).catch(() => [] as ChatMessage[]),
          loadSecureMessages(chat).catch(() => [] as ChatMessage[]),
      ]).then(([normal, sealed]) => {
          if (cancelled) return;
          const base = Array.isArray(normal) ? normal : [];
          const secureMsgs = Array.isArray(sealed) ? sealed : [];
          const merged = [...base, ...secureMsgs].sort((a, b) => (a.ts || 0) - (b.ts || 0));
          setMessages(merged);
      });
      pullRef.current = pull;
      pull();
      const timer = window.setInterval(pull, 3500);
      return () => { cancelled = true; window.clearInterval(timer); };
  }, [chat.id]);

  // Burn expired sealed messages from view between polls.
  useEffect(() => {
      const id = window.setInterval(() => setMessages(prev => {
          const now = Date.now();
          const next = prev.filter(x => !(x.secure && x.expiresAt && x.expiresAt <= now));
          return next.length !== prev.length ? next : prev;
      }), 500);
      return () => window.clearInterval(id);
  }, []);

  const revealSecure = (m: ChatMessage) => {
      if (!m.msgId) return;
      openSecureMessage(chat, m.msgId).then(() => pullRef.current && pullRef.current());
  };

  useEffect(() => {
      let cancelled = false;
      if (!searchQuery.trim()) {
          setSearchResults([]);
          return () => { cancelled = true; };
      }
      const timer = window.setTimeout(() => {
          searchDirectMessages(chat, searchQuery)
              .then(results => {
                  if (!cancelled) setSearchResults(results);
              })
              .catch(() => {
                  if (!cancelled) setSearchResults([]);
              });
      }, 180);
      return () => {
          cancelled = true;
          window.clearTimeout(timer);
      };
  }, [chat, searchQuery]);

  const localSearchResults = useMemo(() => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [];
      return messages
          .filter(message => message.text.toLowerCase().includes(q))
          .slice(-12)
          .map(message => ({ id: message.id, text: message.text, timestamp: message.timestamp, senderName: message.sender === 'user' ? 'You' : chat.title }));
  }, [chat.title, messages, searchQuery]);

  const visibleSearchResults = searchResults.length ? searchResults : localSearchResults;

  const jumpToMessage = (id: string) => {
      setHighlightedId(id);
      messageRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => setHighlightedId(null), 1400);
  };

  const handleSend = async () => {
      const text = inputText.trim();
      if (!text) return;
      setInputText('');
      const now = Date.now();
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (secure) {
          const optimistic: ChatMessage = {
              id: 'sec-' + now, text, sender: 'user', timestamp, ts: now,
              secure: true, ttl, viewOnce, expiresAt: (!viewOnce && ttl > 0) ? now + ttl * 1000 : null,
          };
          setMessages(prev => [...prev, optimistic]);
          try { await sendSecureMessage(chat, text, { ttl, viewOnce }); } catch {}
          pullRef.current && pullRef.current();
          return;
      }
      const newMsg: ChatMessage = { id: now.toString(), sender: 'user', text, timestamp, ts: now };
      setMessages(prev => [...prev, newMsg]);
      try { await sendDirectMessage(chat, text, userAvatar); } catch {}
      pullRef.current && pullRef.current();
  };

  const handleSubmit = (event: React.FormEvent) => {
      event.preventDefault();
      handleSend();
  };

  const handleAction = (action: string) => {
      window.dispatchEvent(new CustomEvent('axis:action', { detail: { action, chatId: chat.id, chat } }));
  };

  const openInAxis = () => {
      const detail = { module: 'axis', channelId: chat.id, workspaceId: chat.workspaceId, type: 'dm', isDirect: true };
      localStorage.setItem('axis:pending-channel', JSON.stringify(detail));
      localStorage.setItem('axis:pending-direct-home', JSON.stringify({ directId: chat.id, workspaceId: chat.workspaceId }));
      window.dispatchEvent(new CustomEvent('commandbridge:navigate', { detail }));
      window.dispatchEvent(new CustomEvent('soma:navigate', { detail }));
      window.dispatchEvent(new CustomEvent('axis:navigate-channel', { detail }));
      window.dispatchEvent(new CustomEvent('axis:open-direct-home', { detail: { directId: chat.id, workspaceId: chat.workspaceId } }));
  };

  const identity: IdentityProfile = {
      id: String(chat.id),
      name: chat.title,
      handle: chat.members || chat.title,
      avatar: chatAvatar,
      role: chat.axisSource === 'axis' ? 'Axis Direct' : 'Studio Direct',
      status: chat.online ? 'online' : 'offline',
      source: 'direct',
      recentActivity: chat.lastMessage || chat.messagesCount,
      mutualSpaces: ['Studio', 'Axis', 'Directs'],
  };

  const openStudioSpace = (profile: IdentityProfile) => {
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'studio-space', context: { identity: profile } } }));
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col font-sans">
        <style>{`@keyframes pw-burn { from { width:100%; } to { width:0%; } }`}</style>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black z-50">
            <div className="flex items-center gap-4">
                <button onClick={onBack} className="text-white p-1 -ml-1 hover:opacity-70 transition-opacity">
                    <ArrowLeft size={28} />
                </button>
                <IdentityChip identity={identity} compact={false} onOpenStudio={openStudioSpace} />
            </div>
            <div className="flex items-center gap-6 pr-1">
                {chat.axisSource === 'axis' && (
                    <button onClick={openInAxis} title="Open in Axis" className="hover:opacity-70 transition-opacity">
                        <Info size={24} strokeWidth={1.5} />
                    </button>
                )}
                <button onClick={() => setSearchOpen(prev => !prev)} title="Search Direct" className="hover:opacity-70 transition-opacity">
                    <Search size={24} strokeWidth={1.5} />
                </button>
                <button onClick={() => handleAction('Voice Call')} className="hover:opacity-70 transition-opacity">
                    <Phone size={26} strokeWidth={1.5} />
                </button>
                <button onClick={() => handleAction('Video Call')} className="hover:opacity-70 transition-opacity">
                    <Video size={28} strokeWidth={1.5} />
                </button>
            </div>
        </div>

        {searchOpen && (
            <div className="border-b border-white/10 bg-black/95 px-4 py-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" size={16} />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search this Direct..."
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.06] py-2.5 pl-10 pr-9 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
                    />
                    <button
                        onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white"
                    >
                        <X size={15} />
                    </button>
                </div>
                {searchQuery.trim() && (
                    <div className="mt-2 max-h-36 overflow-y-auto rounded-2xl border border-white/8 bg-white/[0.03]">
                        {visibleSearchResults.length ? visibleSearchResults.map(result => (
                            <button
                                key={result.id}
                                onClick={() => jumpToMessage(result.id)}
                                className="block w-full border-b border-white/5 px-3 py-2 text-left last:border-b-0 hover:bg-white/5"
                            >
                                <div className="text-[11px] font-semibold text-white/45">{result.senderName || result.sender || 'Direct'} · {result.timestamp}</div>
                                <div className="truncate text-[13px] text-white/80">{String(result.text || result.snippet || '').replace(/\[\[|\]\]/g, '')}</div>
                            </button>
                        )) : (
                            <div className="px-3 py-3 text-center text-xs text-white/30">No matching messages.</div>
                        )}
                    </div>
                )}
            </div>
        )}

        {/* Directs Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-0.5 pb-28">
            <div className="text-center text-[11px] font-medium text-white/40 my-4">Today</div>
            
            {messages.map((msg) => (
                <motion.div
                    ref={node => { messageRefs.current[msg.id] = node; }}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={msg.id}
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2 rounded-2xl transition-colors ${highlightedId === msg.id ? 'bg-yellow-300/10' : ''}`}
                >
                    {msg.secure ? (
                        <div className="flex-1"><SecureBubble msg={msg} senderName={chat.title.split(' ')[0]} onReveal={revealSecure} /></div>
                    ) : (
                      <>
                        {msg.sender === 'other' && (
                            <img src={chatAvatar} className="w-7 h-7 rounded-full object-cover mb-1" alt="" />
                        )}
                        <div
                            className={`max-w-[70%] px-4 py-2.5 text-[15px] leading-snug rounded-[22px] font-normal
                                ${msg.sender === 'user'
                                    ? 'bg-[#3797F0] text-white rounded-br-md'
                                    : 'bg-[#262626] text-white rounded-bl-md'
                                }`}
                        >
                            {msg.text}
                        </div>
                      </>
                    )}
                </motion.div>
            ))}
        </div>

        {/* Sealed (Pathway) controls — only while secure mode is armed */}
        {secure && (
            <div className="fixed bottom-[84px] left-0 right-0 z-[240] flex items-center gap-1.5 overflow-x-auto bg-black px-3 py-2">
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-fuchsia-400">Sealed ·</span>
                {[{ v: 0, l: 'KEEP' }, { v: 10, l: '10s' }, { v: 60, l: '1m' }, { v: 3600, l: '1h' }].map(o => (
                    <button
                        key={o.v} type="button"
                        onClick={() => { setTtl(o.v); if (o.v) setViewOnce(false); }}
                        className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] transition ${
                            ttl === o.v && !viewOnce ? 'border-rose-400 bg-rose-400/10 text-rose-400' : 'border-white/10 text-white/35'
                        }`}
                    >{o.l}</button>
                ))}
                <button
                    type="button"
                    onClick={() => { setViewOnce(v => !v); setTtl(0); }}
                    className={`flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] transition ${
                        viewOnce ? 'border-fuchsia-400 bg-fuchsia-400/10 text-fuchsia-400' : 'border-white/10 text-white/35'
                    }`}
                ><ShieldCheck size={11} />View once</button>
            </div>
        )}

        {/* Input Area */}
        <form onSubmit={handleSubmit} className="fixed bottom-0 left-0 right-0 z-[240] flex items-center gap-3 bg-black p-3 pb-8 pointer-events-auto">
             {/* Pathway (sealed) toggle */}
             <button
                type="button"
                onClick={() => setSecure(s => !s)}
                title="Pathway — sealed & ephemeral"
                className={`relative w-10 h-10 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform cursor-pointer ${
                    secure ? 'bg-gradient-to-br from-fuchsia-500 to-rose-500 text-black' : 'bg-[#262626] text-white/80 hover:text-white'
                }`}
             >
                <ShieldCheck size={20} strokeWidth={secure ? 2.4 : 1.7} />
             </button>

             {/* Input Pill */}
             <div className={`flex-1 bg-[#262626] rounded-full h-11 flex items-center px-4 gap-2 transition-all ${secure ? 'ring-1 ring-fuchsia-400/45' : ''}`}>
                 <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder={secure ? (viewOnce ? 'Sealed · view once…' : ttl > 0 ? `Sealed · burns in ${ttl < 60 ? ttl + 's' : ttl / 60 + 'm'}…` : 'Sealed message…') : 'Direct...'}
                    autoComplete="off"
                    className="flex-1 bg-transparent border-none text-white focus:outline-none placeholder:text-white/50 text-[15px] h-full"
                 />

                 {inputText ? (
                     <button type="submit" className={`font-semibold text-[15px] ml-2 transition-colors ${secure ? 'text-fuchsia-400 hover:text-fuchsia-300' : 'text-[#3797F0] hover:text-[#3797F0]/80'}`}>
                        Send
                     </button>
                 ) : (
                     <div className="flex items-center gap-3 text-white">
                         <button type="button" onClick={() => handleAction('Mic')} className="p-1 hover:opacity-70 transition-opacity">
                            <Mic size={22} strokeWidth={1.5} />
                         </button>
                         <button type="button" onClick={() => handleAction('Gallery')} className="p-1 hover:opacity-70 transition-opacity">
                            <ImageIcon size={22} strokeWidth={1.5} />
                         </button>
                         <button type="button" onClick={() => handleAction('Sticker')} className="p-1 hover:opacity-70 transition-opacity">
                            <Sticker size={22} strokeWidth={1.5} />
                         </button>
                     </div>
                 )}
             </div>
             
             {/* Heart Button (Only visible if not typing) */}
             {!inputText && (
                <button type="button" onClick={() => handleAction('Like')} className="p-1 hover:opacity-70 transition-opacity">
                    <Heart size={26} strokeWidth={1.5} />
                </button>
             )}
        </form>
    </div>
  );
};

export default ChatDetail;
