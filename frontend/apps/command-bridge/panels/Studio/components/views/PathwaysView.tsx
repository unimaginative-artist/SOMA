import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Zap, Send, Radio, ShieldCheck } from 'lucide-react';
import { stableAvatar } from '../../services/avatarService';
import { UserProfile } from '../../types';

/* ============================================================================
   Pathways — Scatter Protocol P2P messaging (web port of the mobile screen)
   Ephemeral burn-after-TTL messages, E2E framing, reactions, relay panel.
   Self-contained: peers are seeded, replies simulated, history in localStorage.
   ========================================================================== */

type Role = 'user' | 'peer' | 'system';
interface PWMsg {
  id: string;
  role: Role;
  content: string;
  ts: number;
  ttl: number;
  expiresAt?: number;
  reactions?: Record<string, string>;
}
interface Peer {
  id: string;
  name: string;
  handle: string;
  last: string;
  age: string;
  unread?: number;
}

const SEED_PEERS: Peer[] = [
  { id: 'pw-aria', name: 'Aria Mensah', handle: 'aria', last: 'relay node is up — ping when you land', age: '2m', unread: 2 },
  { id: 'pw-kai', name: 'Kai Okafor', handle: 'kai', last: 'burning that file after you read it', age: '14m' },
  { id: 'pw-juno', name: 'Juno Vega', handle: 'juno', last: 'mesh holding steady on my end', age: '1h' },
  { id: 'pw-soma', name: 'SOMA', handle: 'soma', last: 'channel secured. I am listening.', age: '3h' },
];

const TTL_OPTS = [
  { val: 0, label: 'KEEP' },
  { val: 10, label: '10s' },
  { val: 60, label: '1m' },
  { val: 3600, label: '1h' },
];

const REPLIES = [
  'got it — received clean',
  'on it',
  'noted, will circle back',
  'yes exactly. let’s sync later',
  '👍 makes sense',
  'packet decoded. agreed.',
];

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
const keyFor = (id: string) => 'studio_pw_' + id;

function loadMsgs(peer: Peer): PWMsg[] {
  try {
    const raw = localStorage.getItem(keyFor(peer.id));
    if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) return p; }
  } catch { /* ignore */ }
  return [
    { id: 'sys1', role: 'system', content: 'PATHWAY ESTABLISHED · E2E ENCRYPTION ACTIVE', ts: Date.now() - 5000, ttl: 0 },
    { id: 'init', role: 'peer', content: peer.last, ts: Date.now() - 120000, ttl: 0 },
  ];
}
function saveMsgs(peerId: string, msgs: PWMsg[]) {
  try { localStorage.setItem(keyFor(peerId), JSON.stringify(msgs)); } catch { /* ignore */ }
}

/* ---- ephemeral burn bar (pure CSS, no per-frame re-render) ---------------- */
const BurnBar: React.FC<{ ts: number; ttl: number }> = ({ ts, ttl }) => {
  const elapsed = (Date.now() - ts) / 1000;
  return (
    <div
      className="absolute bottom-0 left-0 h-[2px] rounded-full"
      style={{
        width: '100%',
        background: 'linear-gradient(90deg,#fb7185,#ef4444)',
        boxShadow: '0 0 6px #ef4444',
        animation: `pw-burn ${ttl}s linear forwards`,
        animationDelay: `-${Math.max(0, elapsed)}s`,
      }}
    />
  );
};

/* ---- single message bubble ------------------------------------------------ */
const PathBubble: React.FC<{ msg: PWMsg; isMe: boolean; onReact: (id: string) => void }> = ({ msg, isMe, onReact }) => {
  if (msg.role === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-md border border-violet-400/25 bg-violet-400/[0.07] px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-violet-300/80">
          [{msg.content}]
        </span>
      </div>
    );
  }
  const reactions = msg.reactions ? Object.values(msg.reactions) : [];
  return (
    <div className={`mb-2.5 flex ${isMe ? 'justify-end' : 'justify-start'} ${reactions.length ? 'mb-5' : ''}`}>
      <div className="relative max-w-[78%]">
        <div
          onDoubleClick={() => onReact(msg.id)}
          className={`relative cursor-pointer select-none overflow-hidden px-3.5 py-2.5 ${
            isMe ? 'rounded-[16px_16px_4px_16px] border border-violet-400/35 bg-violet-500/[0.16]' : 'rounded-[16px_16px_16px_4px] border border-white/10 bg-white/[0.04]'
          }`}
        >
          <div className={`mb-1 font-mono text-[9.5px] tracking-[0.08em] ${isMe ? 'text-violet-300' : 'text-white/35'}`}>
            {isMe ? '>> OUT' : '<< IN'}
          </div>
          <div className={`font-sans text-[14.5px] leading-relaxed ${isMe ? 'text-white' : 'text-white/80'}`}>{msg.content}</div>
          {msg.expiresAt ? <BurnBar ts={msg.ts} ttl={msg.ttl || 10} /> : null}
        </div>
        {reactions.length > 0 && (
          <div className={`absolute -bottom-4 ${isMe ? 'right-0' : 'left-0'} flex gap-1 rounded-full border border-violet-400/25 bg-black px-2 py-0.5 text-xs`}>
            {reactions.map((r, i) => <span key={i}>{r}</span>)}
          </div>
        )}
        <div className={`mt-1.5 flex items-center gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
          {msg.ttl > 0 && (
            <span className="flex items-center gap-1 font-mono text-[9px] text-rose-400">
              <span className="inline-block h-[5px] w-[5px] rounded-full bg-rose-400" />TTL {msg.ttl}s
            </span>
          )}
          <span className="font-mono text-[9.5px] text-white/25">
            {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
};

/* ---- full-screen pathway chat --------------------------------------------- */
const PathwayChat: React.FC<{ peer: Peer; onBack: () => void }> = ({ peer, onBack }) => {
  const [msgs, setMsgs] = useState<PWMsg[]>(() => loadMsgs(peer));
  const [input, setInput] = useState('');
  const [ttl, setTtl] = useState(0);
  const [typing, setTyping] = useState(false);
  const [showRelay, setShowRelay] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const avatar = stableAvatar({ id: peer.id, name: peer.name, handle: peer.handle });

  // burn expired messages
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setMsgs(m => { const next = m.filter(x => !x.expiresAt || x.expiresAt > now); return next.length !== m.length ? next : m; });
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, typing]);
  useEffect(() => { saveMsgs(peer.id, msgs); }, [msgs, peer.id]);

  const send = () => {
    if (!input.trim()) return;
    const now = Date.now();
    const out: PWMsg = { id: 'u' + now, role: 'user', content: input, ts: now, ttl, reactions: {}, expiresAt: ttl > 0 ? now + ttl * 1000 : undefined };
    setMsgs(prev => [...prev, out]);
    const cap = input;
    setInput('');
    window.setTimeout(() => setTyping(true), 600);
    window.setTimeout(() => {
      const rn = Date.now();
      const reply = cap.length > 4 ? pick(REPLIES) : pick(REPLIES);
      setTyping(false);
      setMsgs(prev => [...prev, { id: 'p' + rn, role: 'peer', content: reply, ts: rn, ttl, reactions: {}, expiresAt: ttl > 0 ? rn + ttl * 1000 : undefined }]);
    }, 1200 + Math.random() * 1000);
  };

  const react = (msgId: string) => {
    setMsgs(m => m.map(x => (x.id === msgId ? { ...x, reactions: { ...(x.reactions || {}), me: '⚡' } } : x)));
  };

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#06060a]">
      <style>{`@keyframes pw-burn { from { width:100%; } to { width:0%; } } @keyframes pw-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }`}</style>
      {/* header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-full p-1.5 text-white/70 transition hover:text-white"><ArrowLeft size={22} /></button>
          <img src={avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-sans text-[15px] font-bold text-white">{peer.name}</span>
              <span className="rounded border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.08em] text-violet-300">E2E</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400" style={{ animation: 'pw-pulse 2s ease-in-out infinite' }} />
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-white/35">Active Node</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowRelay(r => !r)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] transition ${
            showRelay ? 'border-violet-400 bg-violet-400 text-black' : 'border-violet-400/30 bg-violet-400/[0.08] text-violet-300'
          }`}
        >
          <Zap size={12} fill={showRelay ? 'currentColor' : 'none'} />Relay
        </button>
      </div>

      {/* relay panel */}
      {showRelay && (
        <div className="flex flex-shrink-0 items-center gap-4 border-b border-violet-400/20 bg-white/[0.02] px-5 py-4">
          <div className="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-400/10">
            <Radio size={30} className="text-violet-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 font-sans text-[15px] font-bold text-white">Host Web Relay</div>
            <div className="font-mono text-[10.5px] leading-relaxed text-white/45">Your device is a local signaling node. Guests join via browser — no app required.</div>
            <div className="mt-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-violet-300">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400" style={{ animation: 'pw-pulse 2s ease-in-out infinite' }} />
              WebRTC Ready · Port 3000 Open
            </div>
          </div>
        </div>
      )}

      {/* messages */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 pb-1 pt-3.5 custom-scrollbar">
        <div className="my-2 mb-5 flex flex-col items-center">
          <div className="mb-2 flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-violet-400/30 bg-white/[0.04]">
            <img src={avatar} alt="" className="h-[46px] w-[46px] rounded-full object-cover" />
          </div>
          <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-violet-300/70">
            <ShieldCheck size={12} />End-to-End Encryption Verified
          </span>
        </div>
        {msgs.map(msg => <PathBubble key={msg.id} msg={msg} isMe={msg.role === 'user'} onReact={react} />)}
        {typing && (
          <div className="mb-2.5 flex justify-start">
            <div className="flex items-center gap-1.5 rounded-[16px_16px_16px_4px] border border-white/10 bg-white/[0.04] px-4 py-3">
              {[0, 1, 2].map(i => <span key={i} className="inline-block h-1.5 w-1.5 rounded-full bg-white/40" style={{ animation: 'pw-pulse 1s ease-in-out infinite', animationDelay: i * 0.15 + 's' }} />)}
              <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-white/35">Incoming packet…</span>
            </div>
          </div>
        )}
      </div>

      {/* TTL chips */}
      <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto px-3.5 pt-2">
        {TTL_OPTS.map(o => (
          <button
            key={o.val}
            onClick={() => setTtl(o.val)}
            className={`flex-shrink-0 rounded-md border px-3 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] transition ${
              ttl === o.val ? 'border-rose-400 bg-rose-400/10 text-rose-400' : 'border-white/10 text-white/35'
            }`}
          >
            {o.label}
          </button>
        ))}
        {ttl > 0 && <span className="self-center font-mono text-[9px] tracking-[0.04em] text-white/40">· burns after {ttl < 60 ? ttl + 's' : ttl / 60 + 'm'}</span>}
      </div>

      {/* input */}
      <div className="flex flex-shrink-0 items-center gap-2.5 border-t border-white/8 px-3.5 pb-6 pt-2">
        <div className="flex flex-1 items-center rounded-[22px] border border-white/10 bg-white/[0.04] py-1 pl-3.5 pr-1.5">
          <span className="mr-2 flex-shrink-0 font-mono text-xs text-violet-400/50">{'>'}</span>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder={ttl > 0 ? `Transmit · TTL ${ttl}s…` : 'Transmit data…'}
            className="flex-1 bg-transparent py-2 font-mono text-[13.5px] tracking-[0.02em] text-white outline-none placeholder:text-white/30"
          />
          <button
            onClick={send}
            className={`flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full transition ${input.trim() ? 'bg-gradient-to-br from-violet-400 to-fuchsia-500 text-black' : 'bg-white/10 text-white/35'}`}
          >
            <Send size={16} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---- pathways list -------------------------------------------------------- */
const PathwaysView: React.FC<{ currentUser: UserProfile; onBack: () => void }> = ({ onBack }) => {
  const [active, setActive] = useState<Peer | null>(null);
  if (active) return <PathwayChat peer={active} onBack={() => setActive(null)} />;

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-5 pt-8">
      <div className="mb-1 flex items-center gap-3">
        <button onClick={onBack} className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/60 transition hover:text-white"><ArrowLeft size={18} /></button>
        <h1 className="font-sans text-2xl font-black tracking-tight text-white">Pathways</h1>
      </div>
      <div className="mb-5 flex items-center gap-2 pl-12">
        <Zap size={13} className="text-violet-400" fill="currentColor" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-violet-300">Scatter Protocol · P2P</span>
        <span className="flex items-center gap-1 font-mono text-[9px] text-emerald-400">
          <span className="inline-block h-[5px] w-[5px] rounded-full bg-emerald-400" />active
        </span>
      </div>

      <div className="flex flex-col">
        {SEED_PEERS.map(peer => {
          const avatar = stableAvatar({ id: peer.id, name: peer.name, handle: peer.handle });
          return (
            <button
              key={peer.id}
              onClick={() => setActive(peer)}
              className="flex items-center gap-3 border-b border-white/[0.06] py-3 text-left transition hover:bg-white/[0.02]"
            >
              <div className="relative flex-shrink-0">
                <img src={avatar} alt="" className="h-[46px] w-[46px] rounded-full object-cover" />
                <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-[7px] border border-white/10 bg-black">
                  <ShieldCheck size={11} className="text-violet-300" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="flex-1 truncate font-sans text-[14.5px] font-semibold text-white">{peer.name}</span>
                  <span className="rounded border border-violet-400/20 bg-violet-400/[0.08] px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.08em] text-violet-300/60">E2E</span>
                  <span className="font-mono text-[10.5px] text-white/35">{peer.age}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-white/45">
                  <span className="opacity-50">{'>'}</span>
                  <span className="truncate">{peer.last}</span>
                </div>
              </div>
              {peer.unread ? (
                <span className="flex h-[18px] min-w-[18px] items-center justify-center self-center rounded-full bg-violet-400 px-1.5 font-sans text-[10px] font-bold text-black">{peer.unread}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PathwaysView;
