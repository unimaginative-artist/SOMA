import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Zap, Paperclip, Image as ImageIcon } from 'lucide-react';
import MarkdownIt from 'markdown-it';
import { parseEmotes } from '../lib/emotes';
import PixelAvatar from './PixelAvatar';
import somaBackend from '../somaBackend.js';
import { textToSpeech, isElevenLabsEnabled, initElevenLabs } from '../utils/elevenLabsTTS.js';

// ElevenLabs voice settings tuned for SOMA's autonomous voice:
// slightly expressive (stability 0.42), high similarity to trained voice
const SOMA_VOICE_EMOTION = { energy: 0.55, stability: 0.42, similarity_boost: 0.82 };

// Speak text: ElevenLabs → Siren → browser voice
// audioUnlockedRef must be true (user gesture has occurred) or we skip entirely
async function speakProactive(text, audioCtxRef, audioUnlockedRef, voiceIdRef) {
  if (!text) return;
  // Browser blocks AudioContext without a prior user gesture — skip TTS until unlocked
  if (!audioUnlockedRef?.current) return;
  if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
  const ctx = audioCtxRef.current;

  // Tier 1: ElevenLabs (primary — custom SOMA voice)
  try {
    if (isElevenLabsEnabled()) {
      const voiceId = voiceIdRef?.current || import.meta.env.VITE_ELEVENLABS_VOICE_ID || null;
      const r = await textToSpeech(text, ctx, voiceId, SOMA_VOICE_EMOTION);
      if (r.success) {
        const src = ctx.createBufferSource();
        src.buffer = r.audioBuffer;
        src.connect(ctx.destination);
        src.start(0);
        return;
      }
    }
  } catch { /* fall through */ }

  // Tier 2: Siren (Fish-Speech, local GPU)
  try {
    const host = window.location.hostname || 'localhost';
    const r = await fetch(`http://${host}:8081/v1/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      return;
    }
  } catch { /* fall through */ }

  // Tier 3: Browser voice (female lock)
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.05;
  utt.pitch = 1.18;
  const voices = window.speechSynthesis.getVoices();
  const female = voices.find(v => (v.name.includes('Aria') || v.name.includes('Zira') || v.name.includes('Samantha')) && v.lang.includes('en'));
  if (female) utt.voice = female;
  window.speechSynthesis.speak(utt);
}

const md = new MarkdownIt({
  highlight: (str) =>
    `<pre class="bg-black/50 p-2 rounded-lg overflow-x-auto my-2 border border-white/5"><code class="text-xs text-fuchsia-300">${str}</code></pre>`
});

const RARITY_GLOW = {
  common:    'border-zinc-600/40',
  uncommon:  'border-emerald-500/40',
  rare:      'border-blue-500/50',
  epic:      'border-purple-500/50',
  legendary: 'border-amber-500/60',
};

const PANEL_W       = 384;
const PANEL_H       = 500;
const ORB_SIZE      = 56;
const ORB_WORK_SIZE = 38;   // shrunken size while SOMA is puppeteering
const PAD           = 16;
const CHAT_CLIENT_TIMEOUT_MS = 35_000;

// Compute where the panel should open relative to where the orb is sitting.
// Returns { x, y } for the panel top-left and a CSS transform-origin pointing
// back at the orb centre so the scale animation grows from there.
function getPanelGeom(orbX, orbY) {
  const wW = window.innerWidth;
  const wH = window.innerHeight;

  // Prefer opening rightward/downward; flip when near the edge
  let px = (orbX + PANEL_W + PAD <= wW) ? orbX : orbX + ORB_SIZE - PANEL_W;
  let py = (orbY + PANEL_H + PAD <= wH) ? orbY : orbY + ORB_SIZE - PANEL_H;

  // Hard clamp so the panel never leaves the viewport
  px = Math.max(PAD, Math.min(px, wW - PANEL_W - PAD));
  py = Math.max(PAD, Math.min(py, wH - PANEL_H - PAD));

  // Transform-origin: the point inside the panel that's closest to the orb centre
  const orbCX = orbX + ORB_SIZE / 2;
  const orbCY = orbY + ORB_SIZE / 2;
  const ox = Math.max(0, Math.min(100, ((orbCX - px) / PANEL_W) * 100));
  const oy = Math.max(0, Math.min(100, ((orbCY - py) / PANEL_H) * 100));

  return { x: px, y: py, origin: `${ox.toFixed(1)}% ${oy.toFixed(1)}%` };
}

const FloatingChat = ({
  isServerRunning, isBusy, onSendMessage, activeModule,
  activeQuestion, onSendQuestionResponse, tensionLevel,
  initialX, initialY,
}) => {
  // ── Panel visibility / animation state ────────────────────────────────────
  const [panelMounted, setPanelMounted] = useState(false); // panel in DOM
  const [isVisible,    setIsVisible]    = useState(false); // drives scale

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [input,          setInput]          = useState('');
  const [messages,       setMessages]       = useState([]);
  const [suggestion,     setSuggestion]     = useState(null);
  const [isThinking,     setIsThinking]     = useState(false);
  const [unreadCount,    setUnreadCount]    = useState(0);
  const [attachment,     setAttachment]     = useState(null);
  const [attachmentError,setAttachmentError]= useState('');

  // ── Puppeteer / ghost mode ─────────────────────────────────────────────────
  const [isPuppeteering,    setIsPuppeteering]    = useState(false);
  const [ghostBubble,       setGhostBubble]       = useState(null);   // { text, id }
  const [showPuppetHint,    setShowPuppetHint]    = useState(false);  // "chat from here" one-shot
  const puppeteerTimer      = useRef(null);  // auto-clear puppeteering after inactivity
  const ghostBubbleTimer    = useRef(null);
  const hintShown           = useRef(false);

  // ── Orb (anchor) position ──────────────────────────────────────────────────
  const [orbPos, setOrbPos] = useState(() => ({
    x: initialX ?? (window.innerWidth  - ORB_SIZE - 24),
    y: initialY ?? (window.innerHeight - ORB_SIZE - 24),
  }));
  const orbPosRef = useRef(orbPos);   // kept in sync for use inside event handlers

  // ── Panel geometry (computed fresh on each open) ───────────────────────────
  const [panelGeom, setPanelGeom] = useState(null);

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const orbRef          = useRef(null);
  const messagesEnd     = useRef(null);
  const fileInputRef    = useRef(null);
  const audioCtxRef     = useRef(null);  // for proactive TTS
  const audioUnlocked   = useRef(false); // true after first user gesture (orb click)
  const elevenLabsVoiceIdRef = useRef(import.meta.env.VITE_ELEVENLABS_VOICE_ID || null);

  // ── Drag refs (no state = no re-render during drag) ────────────────────────
  const drag    = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const moved   = useRef(false);      // did the pointer travel far enough to be a drag?
  const exitTmr = useRef(null);       // close-animation timeout handle

  // ── helpers ────────────────────────────────────────────────────────────────
  const scrollToBottom = () => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(() => { scrollToBottom(); }, [messages, isBusy]);

  // ── ElevenLabs initialization (runs once at mount) ───────────────────────
  useEffect(() => {
    const key = import.meta.env.VITE_ELEVENLABS_API_KEY;
    const voiceId = import.meta.env.VITE_ELEVENLABS_VOICE_ID;
    if (key) {
      initElevenLabs(key);
      if (voiceId) elevenLabsVoiceIdRef.current = voiceId;
    }
  }, []);

  // ── SOMA proactive / activity messages ────────────────────────────────────
  useEffect(() => {
    const onProactive = (payload) => {
      const text = payload.message || payload.text || String(payload);
      if (!text) return;
      setMessages(prev => [...prev, { id: Date.now(), text, sender: 'system', autonomous: true }]);
      setIsVisible(prev => { if (!prev) setUnreadCount(c => c + 1); return prev; });
      // Speak the proactive message (only if user has interacted — avoids robot voice on startup)
      speakProactive(text, audioCtxRef, audioUnlocked, elevenLabsVoiceIdRef);
    };
    somaBackend.on('soma_proactive', onProactive);
    return () => somaBackend.off('soma_proactive', onProactive);
  }, []);

  // ── Ghost / puppeteering messages ─────────────────────────────────────────
  useEffect(() => {
    const onGhost = ({ text, emotion }) => {
      if (!text) return;

      // Enter puppeteering mode
      setIsPuppeteering(true);

      // Show speech bubble above orb
      if (ghostBubbleTimer.current) clearTimeout(ghostBubbleTimer.current);
      setGhostBubble({ text, id: Date.now() });
      ghostBubbleTimer.current = setTimeout(() => setGhostBubble(null), 5500);

      // One-shot "we can chat from here" hint
      if (!hintShown.current) {
        hintShown.current = true;
        setShowPuppetHint(true);
        setTimeout(() => setShowPuppetHint(false), 4000);
      }

      // Add as a ghost narration in the chat messages
      setMessages(prev => [...prev, {
        id: Date.now(),
        text,
        sender: 'system',
        autonomous: true,
        isGhost: true,
      }]);

      // If panel is closed, bump the unread badge
      setIsVisible(prev => { if (!prev) setUnreadCount(c => c + 1); return prev; });

      // Auto-exit puppeteering after 30s of silence
      if (puppeteerTimer.current) clearTimeout(puppeteerTimer.current);
      puppeteerTimer.current = setTimeout(() => setIsPuppeteering(false), 30_000);
    };

    somaBackend.on('ghost_message', onGhost);
    return () => {
      somaBackend.off('ghost_message', onGhost);
      if (ghostBubbleTimer.current) clearTimeout(ghostBubbleTimer.current);
      if (puppeteerTimer.current) clearTimeout(puppeteerTimer.current);
    };
  }, []);

  // ── Active-question badge ─────────────────────────────────────────────────
  useEffect(() => {
    if (activeQuestion && !isVisible) setUnreadCount(p => p + 1);
  }, [activeQuestion, isVisible]);

  // ── Memory surfacing on open ──────────────────────────────────────────────
  useEffect(() => {
    const onRecall = ({ results }) => {
      if (!results?.length) return;
      const lines = results
        .map(m => `- ${m.content.substring(0, 100)}${m.content.length > 100 ? '…' : ''}`)
        .join('\n');
      setMessages(prev => [{
        id: Date.now(),
        text: `_Recent memories:_\n${lines}`,
        sender: 'system', autonomous: true, isMemoryNotice: true
      }, ...prev]);
    };
    somaBackend.on('recall_recent_response', onRecall);
    if (isVisible && isServerRunning) {
      somaBackend.send('recall_recent', { durationMs: 86400000, limit: 5 });
    }
    return () => somaBackend.off('recall_recent_response', onRecall);
  }, [isVisible, isServerRunning]);

  // ── Load shared conversation history on first open ────────────────────────
  const historyLoaded = useRef(false);
  useEffect(() => {
    if (!isVisible || historyLoaded.current || !isServerRunning) return;
    historyLoaded.current = true;
    fetch(`/api/soma/history?limit=20`)
      .then(r => r.json())
      .then(data => {
        if (!data.messages?.length) return;
        const loaded = data.messages.map((m, i) => ({
          id: m.timestamp ? m.timestamp + i : Date.now() - (data.messages.length - i) * 1000,
          text: m.text || m.content || '',
          sender: (m.role === 'assistant' || m.role === 'soma') ? 'system' : 'user',
        }));
        setMessages(prev => {
          // Only inject if messages haven't accumulated yet (avoid prepending over active chat)
          if (prev.length > 2) return prev;
          return [...loaded, ...prev];
        });
      })
      .catch(() => {});
  }, [isVisible, isServerRunning]);

  // ── Open / Close with spring animation ────────────────────────────────────
  const openChat = useCallback(() => {
    // Cancel any in-flight close
    if (exitTmr.current) { clearTimeout(exitTmr.current); exitTmr.current = null; }

    // Unlock audio on this user gesture — future proactive messages can use Siren/ElevenLabs
    if (!audioUnlocked.current) {
      audioUnlocked.current = true;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    }

    const geom = getPanelGeom(orbPosRef.current.x, orbPosRef.current.y);
    setPanelGeom(geom);
    setPanelMounted(true);
    setUnreadCount(0);
    // Two rAFs: first mounts the DOM node (scale 0), second triggers the transition
    requestAnimationFrame(() => requestAnimationFrame(() => setIsVisible(true)));
  }, []);

  const closeChat = useCallback(() => {
    setIsVisible(false);
    exitTmr.current = setTimeout(() => setPanelMounted(false), 270);
  }, []);

  // ── Drag: direct DOM manipulation, commit to state on mouseup ─────────────
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    moved.current = false;
    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX:  orbPosRef.current.x,
      origY:  orbPosRef.current.y,
    };
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current.active) return;
      const { startX, startY, origX, origY } = drag.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;

      const nx = Math.max(0, Math.min(origX + dx, window.innerWidth  - ORB_SIZE));
      const ny = Math.max(0, Math.min(origY + dy, window.innerHeight - ORB_SIZE));
      orbPosRef.current = { x: nx, y: ny };

      // Bypass React — touch the DOM directly for zero-jank movement
      if (orbRef.current) {
        orbRef.current.style.left = `${nx}px`;
        orbRef.current.style.top  = `${ny}px`;
      }
    };
    const onUp = () => {
      if (!drag.current.active) return;
      drag.current.active = false;
      // Commit final position to React state (triggers a single re-render)
      setOrbPos({ ...orbPosRef.current });
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, []);

  const handleOrbClick = useCallback(() => {
    if (moved.current) return; // was a drag, not a click
    if (panelMounted && isVisible) closeChat();
    else openChat();
  }, [panelMounted, isVisible, openChat, closeChat]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleImageSelect = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setAttachmentError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) return setAttachmentError('Choose an image file.');
    if (file.size > 12 * 1024 * 1024) return setAttachmentError('Images must be 12 MB or smaller.');
    const reader = new FileReader();
    reader.onload = () => setAttachment({ imageData: reader.result, mimeType: file.type, name: file.name, previewUrl: reader.result });
    reader.onerror = () => setAttachmentError('The image could not be read.');
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((!input.trim() && !attachment) || !isServerRunning || isBusy || isThinking) return;
    const message = input.trim() || 'Describe and analyze this image.';
    const sentAttachment = attachment;
    setMessages(prev => [...prev, { id: Date.now(), text: message, sender: 'user', imageUrl: sentAttachment?.previewUrl, imageName: sentAttachment?.name }]);
    setInput('');
    setAttachment(null);
    setSuggestion(null);
    setIsThinking(true);
    const history = messages
      .filter(m => !m.isMemoryNotice) // exclude memory notice cards — not real conversation
      .slice(-10)                      // wider window so autonomous messages are always included
      .map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('Floating Chat client timeout')), CHAT_CLIENT_TIMEOUT_MS);
    try {
      const response = await onSendMessage(message, {
        history,
        activeModule,
        attachment: sentAttachment ? { imageData: sentAttachment.imageData, mimeType: sentAttachment.mimeType, name: sentAttachment.name } : null,
        signal: controller.signal,
      });
      if (response) {
        const text = typeof response === 'string' ? response : response.text;
        const charSuggestion = typeof response === 'object' ? response.characterSuggestion : null;
        if (text) setMessages(prev => [...prev, {
          id: Date.now() + 1,
          text,
          sender: 'system',
          retryText: response?.retryable ? message : null,
        }]);
        if (charSuggestion) setSuggestion(charSuggestion);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        text: error?.name === 'AbortError'
          ? '_This turn took too long, so I stopped it instead of leaving the chat stuck._'
          : '_Neural Link unstable. Perimeter defense active._',
        sender: 'system',
        retryText: message,
      }]);
    } finally {
      clearTimeout(timeoutId);
      setIsThinking(false);
    }
  };

  const handleAssignAgent = async (char) => {
    setSuggestion(null);
    try {
      await fetch('/api/characters/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: char.id }),
      });
      setMessages(prev => [...prev, {
        id: Date.now(),
        text: `**${char.shortName}** has been activated. Their ${char.domain?.label || 'general'} expertise is now channeled through SOMA.`,
        sender: 'system', isAgentNotice: true,
      }]);
    } catch {}
  };

  const isUrgent = (tensionLevel || 0) >= 70;

  const currentOrbSize = isPuppeteering ? ORB_WORK_SIZE : ORB_SIZE;

  return (
    <>
      {/* ── Orb / draggable anchor ─────────────────────────────────────────── */}
      <div
        ref={orbRef}
        className="fixed z-[100]"
        style={{
          left: orbPos.x,
          top: orbPos.y,
          width: currentOrbSize,
          height: currentOrbSize,
          opacity: panelMounted ? 0 : 1,
          pointerEvents: panelMounted ? 'none' : 'auto',
          transition: 'opacity 180ms ease, width 350ms cubic-bezier(0.34,1.56,0.64,1), height 350ms cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        {/* Speech bubble — ghost narration */}
        {ghostBubble && !panelMounted && (
          <div
            key={ghostBubble.id}
            className="absolute bottom-full mb-2.5 right-0 max-w-[220px] pointer-events-none"
            style={{
              animation: 'ghostBubbleIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both',
            }}
          >
            <div className="bg-[#0e0e12]/95 border border-cyan-500/30 rounded-2xl rounded-br-sm px-3 py-2 shadow-xl shadow-cyan-500/10 backdrop-blur-md">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                <span className="text-[8px] font-bold uppercase tracking-widest text-cyan-500">SOMA</span>
              </div>
              <p className="text-[11px] text-zinc-200 leading-relaxed">{ghostBubble.text}</p>
            </div>
            {/* Tail */}
            <div className="absolute -bottom-1.5 right-4 w-3 h-3 bg-[#0e0e12]/95 border-b border-r border-cyan-500/30 rotate-45" />
          </div>
        )}

        {/* "chat from here" one-shot hint */}
        {showPuppetHint && !panelMounted && (
          <div
            className="absolute bottom-full mb-12 right-0 pointer-events-none"
            style={{ animation: 'ghostBubbleIn 0.3s ease both' }}
          >
            <div className="bg-violet-500/90 rounded-xl px-3 py-1.5 shadow-lg shadow-violet-500/20 whitespace-nowrap">
              <p className="text-[11px] text-white font-medium">we can chat from here 👋</p>
            </div>
          </div>
        )}

        <button
          onMouseDown={onMouseDown}
          onClick={handleOrbClick}
          className={`relative rounded-full bg-[#151518]/90 backdrop-blur-md border flex items-center justify-center shadow-2xl transition-colors group cursor-grab active:cursor-grabbing select-none ${
            isPuppeteering
              ? 'border-cyan-500/60 shadow-cyan-500/20 shadow-lg'
              : isUrgent
              ? 'border-amber-500/70 shadow-amber-500/30 shadow-lg animate-pulse'
              : unreadCount > 0
              ? 'border-fuchsia-500/60 animate-pulse'
              : 'border-white/10 hover:border-white/25'
          }`}
          style={{ width: currentOrbSize, height: currentOrbSize, transition: 'width 350ms cubic-bezier(0.34,1.56,0.64,1), height 350ms cubic-bezier(0.34,1.56,0.64,1)' }}
          title={isPuppeteering ? 'SOMA is working — click to chat' : 'SOMA Chat — drag to move'}
        >
          {isPuppeteering ? (
            /* Working state: spinning ring + small icon */
            <>
              <svg className="absolute inset-0 w-full h-full animate-spin-slow" viewBox="0 0 38 38" fill="none">
                <circle cx="19" cy="19" r="17" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="28 80" strokeLinecap="round" opacity="0.7" />
              </svg>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-cyan-400 pointer-events-none relative z-10">
                <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
              </svg>
            </>
          ) : (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"
              className="text-fuchsia-500 transition-transform group-hover:scale-110 pointer-events-none"
            >
              <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
            </svg>
          )}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-fuchsia-500 text-white text-[10px] font-bold flex items-center justify-center shadow-lg pointer-events-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Chat panel (separate element, opens into available space) ─────────
           Scales from the orb via transform-origin, so it always appears to
           grow out of / shrink back into the orb wherever it's sitting.       */}
      {panelMounted && panelGeom && (
        <div
          className="fixed z-[99] bg-[#151518]/90 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          style={{
            left:            panelGeom.x,
            top:             panelGeom.y,
            width:           PANEL_W,
            height:          PANEL_H,
            transformOrigin: panelGeom.origin,
            transform:       isVisible ? 'scale(1)'    : 'scale(0.04)',
            opacity:         isVisible ? 1             : 0,
            transition:      isVisible
              ? 'transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 160ms ease'
              : 'transform 240ms cubic-bezier(0.4, 0, 0.6, 1),       opacity 200ms ease',
            willChange: 'transform, opacity',
          }}
        >
          {/* Header */}
          <div className="border-b border-white/5 bg-black/40 select-none flex-shrink-0">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${isPuppeteering ? 'bg-cyan-400' : isServerRunning ? 'bg-fuchsia-500' : 'bg-rose-500'} shadow-[0_0_8px_currentColor]`} />
                <span className="text-zinc-200 font-semibold text-sm tracking-tight">SOMA</span>
              </div>
              <button onClick={closeChat} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Puppeteering status bar */}
            {isPuppeteering && (
              <div className="px-4 pb-3 flex items-center gap-2">
                <div className="flex-1 h-px bg-cyan-500/20" />
                <div className="flex items-center gap-1.5 shrink-0">
                  <svg className="w-3 h-3 text-cyan-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                  </svg>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-500">working on your screen</span>
                </div>
                <div className="flex-1 h-px bg-cyan-500/20" />
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[#09090b]/50">
            {messages.length === 0 && (
              <div className="text-center text-zinc-600 text-xs py-12 flex flex-col items-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round"
                  className="mb-3 text-fuchsia-500 animate-pulse opacity-60">
                  <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
                </svg>
                <p className="font-mono uppercase tracking-widest opacity-50">Neural Link Established</p>
                <p className="mt-1">Awaiting consciousness interface...</p>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-50'
                    : msg.isGhost
                    ? 'bg-cyan-950/40 border border-cyan-500/25 text-cyan-100'
                    : msg.autonomous
                    ? 'bg-violet-950/40 border border-violet-500/30 text-violet-200'
                    : 'bg-white/5 border border-white/10 text-zinc-200'
                }`}>
                  {msg.isGhost && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <svg className="w-2.5 h-2.5 text-cyan-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                      </svg>
                      <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-500">working</span>
                    </div>
                  )}
                  {!msg.isGhost && msg.autonomous && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                      <span className="text-[9px] font-mono uppercase tracking-widest text-violet-400 opacity-80">autonomous</span>
                    </div>
                  )}
                  {msg.imageUrl && (
                    <img src={msg.imageUrl} alt={msg.imageName || 'Uploaded image'} className="mb-2 max-h-40 w-full rounded-lg object-contain bg-black/30" />
                  )}
                  <div
                    className="markdown-content"
                    dangerouslySetInnerHTML={{ __html: parseEmotes(md.render(msg.text)) }}
                  />
                  {msg.retryText && (
                    <button
                      type="button"
                      onClick={() => { setInput(msg.retryText); setAttachmentError(''); }}
                      className="mt-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-fuchsia-300 hover:bg-fuchsia-500/20"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Agent suggestion card */}
            {suggestion && (
              <div className={`mx-1 p-3 rounded-xl bg-[#0d0d10]/90 border ${RARITY_GLOW[suggestion.rarity] || 'border-cyan-500/40'} shadow-lg`}>
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
                    {[0, 0.2, 0.4].map((delay, i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 bg-fuchsia-500/50 rounded-full animate-bounce"
                        style={{ animationDelay: `${delay}s` }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">Processing</span>
                </div>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>

          {/* Input area */}
          {activeQuestion ? (
            <div className="p-3 border-t border-white/5 bg-black/40 flex-shrink-0">
              <p className="text-sm text-zinc-200 mb-3 font-semibold">{activeQuestion.question}</p>
              {activeQuestion.type === 'choice' && (
                <div className="flex flex-wrap gap-2">
                  {activeQuestion.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => onSendQuestionResponse(activeQuestion.questionId, opt)}
                      className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-lg text-blue-300 text-xs font-bold uppercase tracking-wider transition-all"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              {activeQuestion.type === 'text' && (
                <div className="relative">
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Type your response..."
                    className="w-full bg-black/60 border border-white/10 rounded-xl pl-4 pr-10 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-fuchsia-500/40 focus:ring-1 focus:ring-fuchsia-500/20 transition-all"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && input.trim()) {
                        onSendQuestionResponse(activeQuestion.questionId, input.trim());
                        setInput('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (input.trim()) {
                        onSendQuestionResponse(activeQuestion.questionId, input.trim());
                        setInput('');
                      }
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 rounded-lg text-fuchsia-400"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-3 border-t border-white/5 bg-black/40 flex-shrink-0">
              {attachment && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-fuchsia-500/25 bg-fuchsia-500/5 p-2">
                  <img src={attachment.previewUrl} alt="Attachment preview" className="h-12 w-12 rounded object-cover" />
                  <div className="min-w-0 flex-1 text-[10px] text-zinc-300">
                    <div className="truncate">{attachment.name}</div>
                    <div className="text-zinc-500">SOMA will inspect the actual pixels</div>
                  </div>
                  <button type="button" onClick={() => setAttachment(null)} className="p-1 text-zinc-500 hover:text-zinc-200"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {attachmentError && <div className="mb-2 text-[10px] text-rose-400">{attachmentError}</div>}
              <div className="relative">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!isServerRunning || isBusy || isThinking}
                  title="Attach an image"
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-fuchsia-400 disabled:opacity-30"
                >
                  {attachment ? <ImageIcon className="h-4 w-4 text-fuchsia-400" /> : <Paperclip className="h-4 w-4" />}
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={
                    !isServerRunning ? 'Neural link severed'
                    : isThinking     ? 'SOMA is thinking...'
                    :                  'Ask anything...'
                  }
                  disabled={!isServerRunning || isBusy || isThinking}
                  className="w-full bg-black/60 border border-white/10 rounded-xl pl-11 pr-10 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-fuchsia-500/40 focus:ring-1 focus:ring-fuchsia-500/20 transition-all disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={(!input.trim() && !attachment) || !isServerRunning || isBusy || isThinking}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 rounded-lg text-fuchsia-400 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
};

export default FloatingChat;
