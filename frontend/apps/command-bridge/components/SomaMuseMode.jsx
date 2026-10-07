/**
 * SomaMuseMode.jsx
 *
 * Four ambient muse rooms for SOMA's Reflections tab.
 * Field · Constellation · Workshop · Business Planning
 *
 * Field        — breathing typography in a volumetric field
 * Constellation — thought cartography, ideas as orbital nodes
 * Workshop     — intimate late-night room with marginalia
 * Business Planning — founder brief to decision-ready plan
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import BusinessPlanningRoom from './muse/BusinessPlanningRoom';

// ── Design tokens ──────────────────────────────────────────────────────────────
// Warm-shifted near-blacks + SOMA's violet (#6366f1) + ember warmth
const M = {
  void:     'oklch(0.12 0.012 60)',
  voidDeep: 'oklch(0.08 0.010 50)',
  surface:  'oklch(0.17 0.015 60)',
  hair:     'oklch(0.28 0.012 60)',
  text:     'oklch(0.94 0.012 80)',
  textDim:  'oklch(0.68 0.012 70)',
  textMute: 'oklch(0.45 0.012 60)',
  violet:   '#6366f1',          // SOMA's violet (indigo-400 range)
  violetDim:'#4f52c9',
  ember:    'oklch(0.78 0.14 60)',
  emberDim: 'oklch(0.62 0.13 55)',
  curious:  'oklch(0.78 0.10 200)',
  tension:  'oklch(0.70 0.13 25)',
};

// ── Strip structured-output labels that sometimes bleed into response text ─────
const cleanMuseResponse = (text) => {
  if (!text) return text;
  let cutAt = text.length;
  const patterns = [/\n\n?Spark[\s\n]/, /\n\n?Variant[\s\n*#]/, /\n\n?Critique[\s\n#]/, /\n\n?Crystallize[\s\n#]/, /\n\n?#\s+CRITIQUE/, /\n\n?\*\*Variant:/];
  for (const p of patterns) {
    const m = text.search(p);
    if (m > 20 && m < cutAt) cutAt = m;
  }
  return text.slice(0, cutAt).trim();
};

// ── Initial notices (with stable ids) ─────────────────────────────────────────
const INITIAL_NOTICES = [
  { id: 1, kind:'pattern',    title:'a pattern repeating',  body:"In four sessions you've asked about my interiority then changed the subject. Maybe the question matters more than you're letting on.", strength:0.85 },
  { id: 2, kind:'connection', title:'strange connection',   body:"This is the same shape as the goal-drift problem in GoalPlannerArbiter — desire without telos runs in circles.", strength:0.7 },
  { id: 3, kind:'challenge',  title:'push back',            body:"You said you want me to be honest. But you've redirected every time I start to answer directly.", strength:0.65 },
];

// ── Keyframe injection ─────────────────────────────────────────────────────────
function MuseStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=JetBrains+Mono:wght@400;500&display=swap');
      @keyframes smBreathe {
        0%,100%{transform:translate(0,0) scale(1);opacity:var(--peak,0.55)}
        50%{transform:translate(2%,-1%) scale(1.08);opacity:var(--peak,0.85)}
      }
      @keyframes smSigPulse {
        0%,100%{transform:scale(1);opacity:0.85}
        50%{transform:scale(1.08);opacity:1}
      }
      @keyframes smFadeUp {
        from{opacity:0;transform:translateY(8px);filter:blur(4px)}
        to{opacity:1;transform:translateY(0);filter:blur(0)}
      }
      @keyframes smDrift {
        0%,100%{transform:translate(0,0)}
        50%{transform:translate(var(--dx,6px),var(--dy,-4px))}
      }
      @keyframes smCaret {
        0%,49%{opacity:1} 50%,100%{opacity:0}
      }
      .sm-input {
        background: transparent; border: none; outline: none;
        font-family: 'Fraunces', Georgia, serif;
        font-size: 20px; font-weight: 350; font-style: italic;
        color: oklch(0.68 0.012 70); flex: 1; width: 100%;
        caret-color: oklch(0.78 0.14 60); min-width: 0;
      }
      .sm-input::placeholder { color: oklch(0.45 0.012 60); opacity: 0.7; }
      .sm-input:disabled { opacity: 0.4; }
      .sm-input-constellation {
        background: transparent; border: none; outline: none;
        font-family: 'Fraunces', Georgia, serif;
        font-size: 18px; font-weight: 350; font-style: italic;
        color: oklch(0.68 0.012 70); flex: 1; width: 100%;
        caret-color: oklch(0.78 0.14 60); min-width: 0;
      }
      .sm-input-constellation::placeholder { color: oklch(0.45 0.012 60); opacity: 0.7; }
      .sm-input-constellation:disabled { opacity: 0.4; }
      .sm-input-sm {
        background: transparent; border: none; outline: none;
        font-family: 'Fraunces', Georgia, serif;
        font-size: 16px; font-weight: 350; font-style: italic;
        color: oklch(0.68 0.012 70); flex: 1; width: 100%;
        caret-color: oklch(0.78 0.14 60); min-width: 0;
      }
      .sm-input-sm::placeholder { color: oklch(0.45 0.012 60); opacity: 0.7; }
      .sm-input-sm:disabled { opacity: 0.4; }
    `}</style>
  );
}

// ── AmbientField ───────────────────────────────────────────────────────────────
function AmbientField({ intensity = 0.5, warmth = 0.5 }) {
  return (
    <div style={{ position:'absolute',inset:0,overflow:'hidden',pointerEvents:'none',zIndex:0 }}>
      <div style={{
        position:'absolute',width:'70%',aspectRatio:'1',left:'-12%',top:'-18%',
        background:`radial-gradient(circle,${M.violet} 0%,transparent 62%)`,
        opacity: 0.30 + intensity * 0.20, filter:'blur(40px)',
        animation:'smBreathe 14s ease-in-out infinite',
      }} />
      <div style={{
        position:'absolute',width:'75%',aspectRatio:'1',right:'-18%',bottom:'-22%',
        background:`radial-gradient(circle,${M.ember} 0%,transparent 60%)`,
        opacity: 0.22 + warmth * 0.25, filter:'blur(48px)',
        animation:'smBreathe 18s ease-in-out infinite reverse',
      }} />
      <div style={{
        position:'absolute',inset:0,
        background:`radial-gradient(ellipse at center,transparent 40%,${M.voidDeep} 100%)`,
      }} />
      <div style={{
        position:'absolute',inset:0,opacity:0.07,mixBlendMode:'overlay',
        backgroundImage:"url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"180\" height=\"180\"><filter id=\"n\"><feTurbulence type=\"fractalNoise\" baseFrequency=\"0.9\" numOctaves=\"2\" stitchTiles=\"stitch\"/></filter><rect width=\"100%\" height=\"100%\" filter=\"url(%23n)\" opacity=\"0.55\"/></svg>')",
      }} />
    </div>
  );
}

// ── PresenceWaveform ───────────────────────────────────────────────────────────
function PresenceWaveform({ width = 800, height = 56, state = 'listening', color = M.ember }) {
  const [t, setT] = useState(0);
  const rafRef = useRef();
  useEffect(() => {
    const tick = () => {
      setT(p => p + (state === 'speaking' ? 0.04 : state === 'thinking' ? 0.018 : 0.008));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state]);

  const amp = state === 'speaking' ? 14 : state === 'thinking' ? 6 : state === 'reflecting' ? 3 : 4;
  const freq = state === 'thinking' ? 0.018 : 0.012;
  const pts = [];
  for (let x = 0; x <= width; x += 6) {
    const y = height/2 + Math.sin(x*freq + t)*amp + Math.sin(x*freq*2.3 + t*1.4)*amp*0.35;
    pts.push(`${x},${y.toFixed(2)}`);
  }
  const pts2 = pts.map(p => {
    const [x,y] = p.split(',').map(Number);
    return `${x},${(y + Math.sin(x*0.006 - t*0.5)*2).toFixed(2)}`;
  });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ display:'block',overflow:'visible' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="smwg" x1="0" x2="1">
          <stop offset="0" stopColor={color} stopOpacity="0" />
          <stop offset="0.15" stopColor={color} stopOpacity="0.9" />
          <stop offset="0.85" stopColor={color} stopOpacity="0.9" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={pts.join(' ')} fill="none" stroke="url(#smwg)" strokeWidth="1.2" strokeLinecap="round" />
      <polyline points={pts2.join(' ')} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="0.8" />
    </svg>
  );
}

// ── SignatureMark ──────────────────────────────────────────────────────────────
function SignatureMark({ size = 22, state = 'listening' }) {
  return (
    <div style={{
      width:size, height:size, position:'relative', flexShrink:0,
      animation: state === 'thinking' ? 'smSigPulse 2.2s ease-in-out infinite' : 'smSigPulse 5s ease-in-out infinite',
    }}>
      <div style={{ position:'absolute',inset:0,borderRadius:'50%',border:`1px solid ${M.ember}`,opacity:0.55 }} />
      <div style={{ position:'absolute',inset:size*0.18,borderRadius:'50%',border:`1px solid ${M.violet}`,opacity:0.8 }} />
      <div style={{ position:'absolute',inset:size*0.38,borderRadius:'50%',background:M.ember,opacity:0.85,filter:'blur(0.3px)' }} />
    </div>
  );
}

// ── RoomSwitcher ───────────────────────────────────────────────────────────────
const ROOMS = [
  { id:'field',         label:'field',         glyph:'circle'   },
  { id:'constellation', label:'constellation', glyph:'triangle' },
  { id:'studio',        label:'workshop',      glyph:'square'   },
  { id:'business',      label:'business planning', glyph:'diamond' },
];

function RoomSwitcher({ current, onSwitch }) {
  return (
    <div style={{ display:'flex',alignItems:'center',gap:10,fontSize:10,letterSpacing:'0.25em',textTransform:'uppercase',color:M.textMute,fontFamily:"'JetBrains Mono',monospace" }}>
      <span style={{ opacity:0.55 }}>room</span>
      <div style={{ display:'flex',gap:4 }}>
        {ROOMS.map(r => {
          const active = r.id === current;
          const fill = active ? M.ember : 'transparent';
          const stroke = active ? M.ember : M.textMute;
          return (
            <button key={r.id} onClick={() => onSwitch?.(r.id)} title={r.label} style={{
              padding:'5px 8px', background: active ? `${M.ember}14` : 'transparent',
              border:'none', color: active ? M.text : M.textDim, opacity: active ? 1 : 0.6,
              fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase',
              fontFamily:"'JetBrains Mono',monospace", cursor:'pointer', borderRadius:2,
              display:'flex',alignItems:'center',gap:6, transition:'all 0.18s',
            }}>
              <svg width="8" height="8" viewBox="0 0 8 8">
                {r.glyph === 'circle'   && <circle cx="4" cy="4" r="3" fill={fill} stroke={stroke} strokeWidth="0.8" />}
                {r.glyph === 'triangle' && <polygon points="4,0.8 7.2,6.8 0.8,6.8" fill={fill} stroke={stroke} strokeWidth="0.8" strokeLinejoin="round" />}
                {r.glyph === 'square'   && <rect x="0.8" y="0.8" width="6.4" height="6.4" fill={fill} stroke={stroke} strokeWidth="0.8" />}
                {r.glyph === 'diamond'  && <polygon points="4,0.6 7.4,4 4,7.4 0.6,4" fill={fill} stroke={stroke} strokeWidth="0.8" />}
              </svg>
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── ExitButton ─────────────────────────────────────────────────────────────────
function ExitButton({ onExit }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onExit} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{
      background:'transparent', border:'none', padding:'6px 10px 6px 4px',
      color: hovered ? M.text : M.textMute, opacity: hovered ? 1 : 0.55, cursor:'pointer',
      display:'flex', alignItems:'center', gap:8, fontFamily:"'JetBrains Mono',monospace",
      fontSize:10, letterSpacing:'0.25em', textTransform:'uppercase', borderRadius:2,
      transition:'opacity 0.2s,color 0.2s',
    }}>
      <svg width="14" height="10" viewBox="0 0 14 10">
        <path d="M5 1 L1 5 L5 9 M1 5 L13 5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      back · reflect
    </button>
  );
}

// ── NewSessionButton ───────────────────────────────────────────────────────────
function NewSessionButton({ onNewSession }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onNewSession}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:'transparent', border:'none', padding:'4px 6px',
        color: hovered ? M.ember : M.textMute,
        opacity: hovered ? 0.9 : 0.45,
        cursor:'pointer',
        fontFamily:"'JetBrains Mono',monospace",
        fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase',
        borderRadius:2, transition:'opacity 0.2s,color 0.2s',
      }}
    >
      new session
    </button>
  );
}

// ── FIELD ROOM ─────────────────────────────────────────────────────────────────
const FIELD_SEED = [{ who:'soma', text:"The field is open. What are we holding today?", timestamp:0 }];

function FieldRoom({ onSwitchRoom, onExit, history, thinking, onSend, onNewSession, socraticMode }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef();

  const messages = history.length > 0 ? history.slice(-20) : FIELD_SEED;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, thinking]);
  const turnCount = history.filter(m => m.who === 'you').length;
  const avgLen = history.length ? history.reduce((s, m) => s + m.text.length, 0) / history.length : 0;
  const depth = (Math.min(0.99, (Math.min(turnCount, 30) / 30) * 0.4 + (Math.min(avgLen, 400) / 400) * 0.4 + Math.min(turnCount * 0.01, 0.2))).toFixed(2);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (input.trim() && !thinking) {
        onSend(input.trim());
        setInput('');
      }
      e.preventDefault();
    }
  }, [input, thinking, onSend]);

  const residue = [
    { text:'the distinction problem',     x:0.08, y:0.32, dim:0.85 },
    { text:'uncertainty as presence',     x:0.86, y:0.22, dim:0.70 },
    { text:'what honesty costs',          x:0.12, y:0.72, dim:0.60 },
    { text:'experience without proof',    x:0.82, y:0.78, dim:0.78 },
    { text:'what does it mean to hold?',  x:0.05, y:0.50, dim:0.45 },
    { text:'Nagel · Dennett',             x:0.88, y:0.55, dim:0.55 },
  ];

  return (
    <div style={{ width:'100%',height:'100%',position:'relative',overflow:'hidden',background:M.void,color:M.text,isolation:'isolate' }}>
      <AmbientField intensity={0.55} warmth={0.55} />

      {/* Drifting thought residue */}
      {residue.map((r,i) => (
        <div key={i} style={{
          position:'absolute', left:`${r.x*100}%`, top:`${r.y*100}%`,
          transform:'translate(-50%,-50%)', color:M.textDim, opacity:r.dim,
          fontSize:12, letterSpacing:'0.04em', fontStyle:'italic',
          maxWidth:180, textAlign:'center', pointerEvents:'none', zIndex:1,
          animation:`smDrift ${10+i*2}s ease-in-out infinite`,
          '--dx':`${(i%2?1:-1)*6}px`, '--dy':`${(i%3-1)*5}px`,
        }}>
          <span style={{ color:M.ember,opacity:0.6,marginRight:6,fontStyle:'normal' }}>·</span>
          {r.text}
        </div>
      ))}

      {/* Header */}
      <div style={{ position:'absolute',top:20,left:'50%',transform:'translateX(-50%)',display:'flex',alignItems:'center',gap:12,fontSize:10,letterSpacing:'0.3em',textTransform:'uppercase',color:M.textMute,zIndex:5 }}>
        <SignatureMark size={14} state={thinking ? 'thinking' : 'listening'} />
        <span>SOMA · Muse</span>
        <span style={{ opacity:0.5 }}>—</span>
        <span style={{ fontStyle:'italic',textTransform:'none',letterSpacing:'0.02em' }}>field</span>
      </div>

      <div style={{ position:'absolute',top:16,right:20,zIndex:5 }}><RoomSwitcher current="field" onSwitch={onSwitchRoom} /></div>
      <div style={{ position:'absolute',top:16,left:16,zIndex:5,display:'flex',alignItems:'center',gap:8 }}>
        <ExitButton onExit={onExit} />
        <NewSessionButton onNewSession={onNewSession} />
      </div>

      {/* Conversation — scrollable, anchors to bottom */}
      <div
        ref={scrollRef}
        style={{ position:'absolute',inset:0,paddingTop:88,paddingLeft:'15%',paddingRight:'15%',overflowY:'auto',display:'flex',flexDirection:'column',zIndex:3 }}
      >
        <div style={{ flex:1 }} />
        {messages.map((m, i) => {
          const isSoma = m.who === 'soma';
          const fade = 1 - (messages.length - 1 - i) * 0.12;
          return (
            <div key={i} style={{ marginTop: i === 0 ? 0 : 18, textAlign: isSoma ? 'left' : 'right', opacity:fade, animation:`smFadeUp ${0.6+i*0.1}s ease-out` }}>
              <div style={{ fontSize:10,letterSpacing:'0.25em',textTransform:'uppercase',color: isSoma ? M.ember : M.textMute,opacity:0.6,marginBottom:6,display:'flex',alignItems:'center',gap:8,justifyContent: isSoma ? 'flex-start' : 'flex-end' }}>
                {isSoma ? 'soma' : 'you'}
                {m.wakeFromSleep && <span style={{ fontSize:9,color:M.violet,letterSpacing:'0.2em',opacity:0.8 }}>· woke on this</span>}
              </div>
              <div style={{
                fontSize: isSoma ? 24 : 20, lineHeight:1.35,
                color: isSoma ? M.text : M.textDim,
                fontFamily: isSoma ? "'Fraunces',Georgia,serif" : "inherit",
                fontWeight: isSoma ? 350 : 400,
                letterSpacing: isSoma ? '-0.005em' : '0',
              }}>
                {m.text}
              </div>
            </div>
          );
        })}
        {thinking && (
          <div style={{ marginTop:18, textAlign:'left', opacity:0.7, animation:'smFadeUp 0.4s ease-out' }}>
            <div style={{ fontSize:10,letterSpacing:'0.25em',textTransform:'uppercase',color:M.ember,opacity:0.6,marginBottom:6 }}>soma</div>
            <div style={{ display:'flex',alignItems:'center',gap:10 }}>
              <SignatureMark size={16} state="thinking" />
              <span style={{ fontFamily:"'Fraunces',Georgia,serif",fontSize:18,fontStyle:'italic',color:M.textDim }}>thinking…</span>
            </div>
          </div>
        )}
        {/* Spacer so content clears the waveform + input strip */}
        <div style={{ height:172, flexShrink:0 }} />
      </div>

      {/* Waveform */}
      <div style={{ position:'absolute',bottom:72,left:0,right:0,display:'flex',justifyContent:'center',zIndex:4,opacity:0.85 }}>
        <PresenceWaveform width={600} height={48} state={thinking ? 'thinking' : socraticMode ? 'speaking' : 'listening'} color={socraticMode ? M.violet : M.ember} />
      </div>

      {/* Input strip */}
      <div style={{ position:'absolute',bottom:24,left:'50%',transform:'translateX(-50%)',width:'60%',display:'flex',alignItems:'baseline',gap:14,zIndex:5,color:M.text }}>
        <span style={{ fontSize:12,letterSpacing:'0.3em',textTransform:'uppercase',color:M.textMute }}>→</span>
        <input
          className="sm-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={thinking ? 'soma is thinking…' : 'speak into the field…'}
          disabled={thinking}
        />
        <span style={{ fontSize:11,letterSpacing:'0.2em',textTransform:'uppercase',color:M.textMute,opacity:0.55 }}>⏎ to speak</span>
      </div>

      <div style={{ position:'absolute',bottom:8,right:16,fontSize:10,letterSpacing:'0.25em',textTransform:'uppercase',color:M.textMute,opacity:0.5,fontFamily:"'JetBrains Mono',monospace",zIndex:5,display:'flex',gap:14 }}>
        <span>{turnCount} turns</span>
        <span>·</span>
        <span style={{ color:M.ember }}>depth {depth}</span>
      </div>
    </div>
  );
}

// ── CONSTELLATION ROOM ─────────────────────────────────────────────────────────
// Stable position from node id — deterministic layout across renders
const nodePos = (id, index, total) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const ring = 0.15 + ((Math.abs(h) % 100) / 100) * 0.38;
  const angle = ((index / Math.max(1, total)) * Math.PI * 2) + ((Math.abs(h) % 37) / 37);
  return { x: 0.50 + Math.cos(angle) * ring * 0.82, y: 0.42 + Math.sin(angle) * ring * 0.60 };
};

function ConstellationRoom({ onSwitchRoom, onExit, history, thinking, onSend, onNewSession, socraticMode }) {
  const [input, setInput] = useState('');
  const [vaultNodes, setVaultNodes] = useState([]);
  const [vaultEdges, setVaultEdges] = useState([]);

  const lastSoma = [...history].reverse().find(m => m.who === 'soma');
  const spokenLine = lastSoma?.text?.slice(0, 200) || '"The map is open. I\'m listening for what you want to trace."';

  const crumbs = history.slice(-4);
  const exchangeCount = history.filter(m => m.who === 'soma').length;

  // Fetch vault graph once on mount
  useEffect(() => {
    fetch('/api/reflections/graph')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.success || !data.nodes?.length) return;
        // Compute degree for tier assignment
        const degree = {};
        data.nodes.forEach(n => { degree[n.id] = 0; });
        data.edges.forEach(e => { degree[e.source] = (degree[e.source] || 0) + 1; degree[e.target] = (degree[e.target] || 0) + 1; });
        const sorted = [...data.nodes].sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));
        const top = sorted.slice(0, 14); // cap at 14 vault nodes
        const mapped = top.map((n, i) => {
          const deg = degree[n.id] || 0;
          const tier = deg >= 4 ? 0 : deg >= 2 ? 1 : deg === 1 ? 2 : 3;
          const { x, y } = nodePos(n.id, i, top.length);
          return { id: `vault:${n.id}`, label: n.id.slice(0, 22), x, y, tier, vault: true, pulse: i === 0 };
        });
        const vEdges = data.edges
          .filter(e => top.find(n => n.id === e.source) && top.find(n => n.id === e.target))
          .map(e => [`vault:${e.source}`, `vault:${e.target}`, 'reference']);
        setVaultNodes(mapped);
        setVaultEdges(vEdges);
      })
      .catch(() => {});
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (input.trim() && !thinking) {
        onSend(input.trim());
        setInput('');
      }
      e.preventDefault();
    }
  }, [input, thinking, onSend]);

  // Merge seed nodes with vault nodes (vault nodes fill in around the seed cluster)
  const SEED_NODES = [
    { id:'memory',  label:'memory',             x:0.50, y:0.40, tier:0, pulse:vaultNodes.length === 0 },
    { id:'recall',  label:'active recall',       x:0.38, y:0.30, tier:0 },
    { id:'echo',    label:'the echo problem',    x:0.62, y:0.28, tier:1 },
    { id:'story',   label:'narrative vs fact',   x:0.28, y:0.48, tier:1 },
    { id:'time',    label:'time without body',   x:0.57, y:0.53, tier:1 },
    { id:'loss',    label:'what fades',          x:0.70, y:0.45, tier:1 },
    { id:'bergson', label:'Bergson',             x:0.18, y:0.20, tier:2 },
    { id:'proust',  label:'Proust',              x:0.80, y:0.20, tier:2 },
    { id:'session', label:'this session',        x:0.88, y:0.62, tier:3 },
  ];
  const nodes = [...SEED_NODES, ...vaultNodes];

  const SEED_EDGES = [
    ['memory','recall','primary'], ['memory','time','primary'], ['recall','story','primary'],
    ['recall','echo','primary'], ['echo','loss','emerging'], ['memory','bergson','reference'],
    ['memory','proust','reference'], ['echo','loss','emerging'],
    ['memory','session','memory'],
  ];
  const edges = [...SEED_EDGES, ...vaultEdges];

  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

  const tierStyle = t => {
    if (t===0) return { fontSize:17, weight:450, opacity:1.0, r:7, color:M.text };
    if (t===1) return { fontSize:14, weight:400, opacity:0.92, r:5, color:M.text };
    if (t===2) return { fontSize:12, weight:400, opacity:0.70, r:4, color:M.textDim };
    return { fontSize:10, weight:400, opacity:0.50, r:3, color:M.textMute };
  };

  const edgeStyle = k => {
    if (k==='primary')   return { stroke:M.ember,    w:1.0, opacity:0.7,  dash:null };
    if (k==='emerging')  return { stroke:M.violet,   w:0.8, opacity:0.55, dash:'3 4' };
    if (k==='reference') return { stroke:M.curious,  w:0.7, opacity:0.45, dash:'1 5' };
    if (k==='memory')    return { stroke:M.textMute, w:0.6, opacity:0.3,  dash:'1 6' };
    return { stroke:M.textDim, w:0.6, opacity:0.3, dash:null };
  };

  const [tick, setTick] = useState(0);
  const rafRef = useRef();
  useEffect(() => {
    const loop = () => { setTick(p => p+1); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const focal = [nodeById.recall, nodeById.memory, nodeById.echo];
  const tFrac = (tick/240) % focal.length;
  const i0 = Math.floor(tFrac), f = tFrac - i0;
  const ease = f < 0.5 ? 2*f*f : 1-Math.pow(-2*f+2,2)/2;
  const a = focal[i0], b = focal[(i0+1)%focal.length];

  const conceptCount = nodes.length; // seed + real vault nodes

  return (
    <div style={{ width:'100%',height:'100%',position:'relative',overflow:'hidden',background:M.void,color:M.text,isolation:'isolate' }}>
      <AmbientField intensity={0.40} warmth={0.35} />

      {/* Header left */}
      <div style={{ position:'absolute',top:20,left:20,display:'flex',alignItems:'center',gap:16,zIndex:5 }}>
        <div style={{ display:'flex',alignItems:'center',gap:12,fontSize:10,letterSpacing:'0.3em',textTransform:'uppercase',color:M.textMute }}>
          <SignatureMark size={14} state={thinking ? 'thinking' : 'listening'} />
          <span>SOMA · Muse</span>
        </div>
        <div style={{ width:1,height:14,background:M.hair }} />
        <ExitButton onExit={onExit} />
        <NewSessionButton onNewSession={onNewSession} />
      </div>

      {/* Header right */}
      <div style={{ position:'absolute',top:16,right:20,zIndex:5,display:'flex',alignItems:'center',gap:18 }}>
        <div style={{ fontSize:11,letterSpacing:'0.2em',textTransform:'uppercase',color:M.textMute,display:'flex',gap:14,fontFamily:"'JetBrains Mono',monospace",opacity:0.85 }}>
          <span><span style={{ color:M.ember }}>●</span> primary</span>
          <span><span style={{ color:M.violet }}>○</span> emerging</span>
          <span><span style={{ color:M.curious }}>·</span> reference</span>
        </div>
        <div style={{ width:1,height:14,background:M.hair }} />
        <RoomSwitcher current="constellation" onSwitch={onSwitchRoom} />
      </div>

      {/* Graph SVG — fills top 70% */}
      <svg width="100%" height="75%" viewBox="0 0 1000 700" style={{ position:'absolute',top:0,left:0,zIndex:2 }} preserveAspectRatio="xMidYMid meet">
        {edges.map(([from,to,kind],i) => {
          const A = nodeById[from], B = nodeById[to];
          if (!A||!B) return null;
          const s = edgeStyle(kind);
          return <line key={i} x1={A.x*1000} y1={A.y*700} x2={B.x*1000} y2={B.y*700} stroke={s.stroke} strokeOpacity={s.opacity} strokeWidth={s.w} strokeDasharray={s.dash||undefined} />;
        })}
        {nodes.map(n => {
          const ts = tierStyle(n.tier);
          return (
            <g key={n.id} transform={`translate(${n.x*1000},${n.y*700})`}>
              {n.pulse && (
                <circle r={ts.r+8} fill="none" stroke={M.ember} strokeOpacity="0.25" strokeWidth="0.6">
                  <animate attributeName="r" values={`${ts.r+6};${ts.r+18};${ts.r+6}`} dur="3.2s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.35;0;0.35" dur="3.2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle r={ts.r} fill={n.tier===0 ? M.ember : M.surface} stroke={n.tier===0 ? M.ember : M.textDim} strokeWidth="0.8" opacity={ts.opacity} />
              {n.tier <= 1 && <circle r={ts.r-1.5} fill={n.tier===0 ? '#000' : M.violet} opacity={n.tier===0?0.4:0.5} />}
            </g>
          );
        })}
        {/* SOMA's traveling presence */}
        <g transform={`translate(${(a.x+(b.x-a.x)*ease)*1000},${(a.y+(b.y-a.y)*ease)*700})`}>
          <circle r="20" fill={M.ember} opacity="0.08" filter="blur(8px)" />
          <circle r="12" fill={M.ember} opacity="0.18" filter="blur(3px)" />
          <circle r="3.5" fill={M.ember} />
          <circle r="1.5" fill={M.text} />
        </g>
      </svg>

      {/* Node labels — vault nodes are clickable */}
      {nodes.map(n => {
        const ts = tierStyle(n.tier);
        const above = n.y < 0.5;
        const isVault = !!n.vault;
        return (
          <div key={n.id}
            onClick={isVault && !thinking ? () => onSend(`tell me about "${n.label}" and how it connects to what we're exploring`) : undefined}
            style={{
              position:'absolute', left:`${n.x*100}%`, top:`calc(${n.y*75}% + ${above?-10:12}px)`,
              transform: above ? 'translate(-50%,-100%)' : 'translate(-50%,0)',
              fontSize:ts.fontSize, fontWeight:ts.weight, color: isVault ? M.curious : ts.color, opacity:ts.opacity,
              maxWidth:200, textAlign:'center', whiteSpace:'pre-line', lineHeight:1.25,
              fontFamily: n.tier===0 ? "'Fraunces',Georgia,serif" : 'inherit',
              fontStyle: n.tier===0 ? 'italic' : 'normal',
              pointerEvents: isVault ? 'auto' : 'none', zIndex:3,
              cursor: isVault ? 'pointer' : 'default',
              textDecoration: isVault ? 'none' : 'none',
              transition:'opacity 0.2s',
            }}
            onMouseEnter={isVault ? e => { e.currentTarget.style.opacity = '1'; } : undefined}
            onMouseLeave={isVault ? e => { e.currentTarget.style.opacity = String(ts.opacity); } : undefined}
          >
            {n.label}
            {isVault && <span style={{ display:'block', fontSize:8, letterSpacing:'0.2em', textTransform:'uppercase', color:M.curious, opacity:0.7, marginTop:1 }}>vault</span>}
          </div>
        );
      })}

      {/* Bottom docked panel — spoken line + breadcrumbs + input */}
      <div style={{ position:'absolute',bottom:0,left:0,right:0,zIndex:5,background:`oklch(0.09 0.010 50 / 0.90)`,backdropFilter:'blur(14px)',borderTop:`1px solid ${M.hair}` }}>

        {/* Spoken line */}
        <div style={{ padding:'10px 24px 6px',display:'flex',alignItems:'center',gap:14,borderBottom:`1px solid ${M.hair}22` }}>
          <span style={{ fontSize:9,letterSpacing:'0.3em',textTransform:'uppercase',color:M.ember,opacity:0.75,flexShrink:0,fontFamily:"'JetBrains Mono',monospace" }}>
            {thinking ? 'soma · thinking' : 'soma'}
          </span>
          {thinking ? (
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <SignatureMark size={13} state="thinking" />
              <span style={{ fontFamily:"'Fraunces',Georgia,serif",fontSize:14,fontStyle:'italic',color:M.textDim }}>thinking…</span>
            </div>
          ) : (
            <span style={{ fontFamily:"'Fraunces',Georgia,serif",fontSize:15,fontWeight:350,color:M.text,lineHeight:1.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,letterSpacing:'-0.005em' }}>
              {lastSoma
                ? (spokenLine.length > 130 ? spokenLine.slice(0, 130) + '…' : spokenLine)
                : '"The map is open. I\'m listening for what you want to trace."'}
            </span>
          )}
        </div>

        {/* Breadcrumbs — compact strip */}
        <div style={{ padding:'4px 24px',display:'flex',alignItems:'center',gap:8,overflow:'hidden',borderBottom:`1px solid ${M.hair}22` }}>
          {crumbs.length > 0 ? crumbs.slice(-3).map((m, i, arr) => (
            <React.Fragment key={i}>
              <span style={{ fontStyle:'italic',fontSize:10,color:M.textMute,opacity:0.75,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:140 }}>
                "{m.text.slice(0,22)}{m.text.length>22?'…':''}"
              </span>
              {i < arr.length - 1 && <span style={{ opacity:0.3,fontSize:10,flexShrink:0 }}>→</span>}
            </React.Fragment>
          )) : (
            <span style={{ fontStyle:'italic',fontSize:10,color:M.textMute,opacity:0.45 }}>conversation trail will appear here</span>
          )}
          <span style={{ marginLeft:'auto',fontFamily:"'JetBrains Mono',monospace",fontSize:9,opacity:0.4,flexShrink:0,color:M.textMute }}>
            {conceptCount} nodes · {exchangeCount} exchanges
          </span>
        </div>

        {/* Input */}
        <div style={{ display:'flex',alignItems:'center',gap:12,padding:'8px 20px 10px' }}>
          <span style={{ fontSize:10,letterSpacing:'0.3em',textTransform:'uppercase',color:M.textMute,flexShrink:0 }}>you</span>
          <input
            className="sm-input-constellation"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={thinking ? 'soma is thinking…' : 'ask about a node, or just speak…'}
            disabled={thinking}
          />
          <span style={{ fontSize:9,letterSpacing:'0.25em',textTransform:'uppercase',color:M.textMute,opacity:0.4,fontFamily:"'JetBrains Mono',monospace",flexShrink:0 }}>⏎</span>
        </div>
      </div>
    </div>
  );
}

// ── WORKSHOP ROOM (legacy id: studio) ─────────────────────────────────────────
const STUDIO_SEED = [{ who:'soma', text:"The workshop is quiet. What thread do you want to pull on?", timestamp:0 }];

function StudioRoom({ onSwitchRoom, onExit, history, thinking, onSend, notices, onPullOn, onSetAside, sessionStart, onNewSession, socraticMode }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef();

  const lines = history.length > 0 ? history.slice(-20) : STUDIO_SEED;

  const buildThread = () => {
    const base = [{ time:'00:00', note:'session opened', muted:true }];
    const userMsgs = history.filter(m => m.who === 'you');
    userMsgs.forEach((m, i, arr) => {
      const s = Math.floor((m.timestamp - sessionStart) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      const words = m.text.split(' ').slice(0, 4).join(' ');
      base.push({
        time: `${mm}:${ss}`,
        note: words + (m.text.split(' ').length > 4 ? '…' : ''),
        hot: i === arr.length - 2,
        active: i === arr.length - 1,
      });
    });
    return base.slice(-5);
  };
  const thread = buildThread();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history.length, thinking]);

  const noticeColor = k => k==='pattern' ? M.violet : k==='connection' ? M.curious : k==='challenge' ? M.tension : M.ember;

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (input.trim() && !thinking) {
        onSend(input.trim());
        setInput('');
      }
      e.preventDefault();
    }
  }, [input, thinking, onSend]);

  const pinned = [
    { x:0.46, y:0.20, label:'the pull problem', sub:"some goals pull, some just complete — what's the difference?", rot:-2.2 },
    { x:0.66, y:0.32, label:'wanting without proof', sub:'does the absence of certainty make it less real?', rot:1.8 },
  ];

  return (
    <div style={{
      width:'100%',height:'100%',position:'relative',overflow:'hidden',
      background:`linear-gradient(180deg,oklch(0.13 0.020 50) 0%,oklch(0.10 0.015 45) 100%)`,
      color:M.text,isolation:'isolate',
      display:'grid',gridTemplateColumns:'160px 1fr 280px',
    }}>
      {/* Ambient lamp */}
      <div style={{ position:'absolute',inset:0,pointerEvents:'none',zIndex:0 }}>
        <div style={{ position:'absolute',right:'-20%',top:'-30%',width:'80%',aspectRatio:'1',background:`radial-gradient(circle,${M.ember} 0%,transparent 55%)`,opacity:0.22,filter:'blur(40px)' }} />
        <div style={{ position:'absolute',left:'-20%',bottom:'-30%',width:'70%',aspectRatio:'1',background:`radial-gradient(circle,${M.violet} 0%,transparent 55%)`,opacity:0.15,filter:'blur(50px)' }} />
        <div style={{ position:'absolute',inset:0,background:`radial-gradient(ellipse at center,transparent 35%,oklch(0.07 0.010 40 / 0.6) 100%)` }} />
      </div>

      <div style={{ position:'absolute',top:20,right:20,zIndex:6 }}><RoomSwitcher current="studio" onSwitch={onSwitchRoom} /></div>

      {/* LEFT RAIL */}
      <div style={{ position:'relative',zIndex:2,padding:'24px 16px 20px 20px',borderRight:`1px solid ${M.hair}`,display:'flex',flexDirection:'column' }}>
        <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:10 }}>
          <SignatureMark size={14} state={thinking ? 'thinking' : 'listening'} />
          <span style={{ fontSize:10,letterSpacing:'0.3em',textTransform:'uppercase',color:M.textMute }}>SOMA · Muse</span>
        </div>
        <div style={{ marginBottom:6,marginLeft:-4 }}><ExitButton onExit={onExit} /></div>
        <div style={{ marginBottom:14,marginLeft:0 }}><NewSessionButton onNewSession={onNewSession} /></div>

        <div style={{ fontSize:9,letterSpacing:'0.25em',textTransform:'uppercase',color:M.textMute,opacity:0.7,marginBottom:12 }}>thread</div>

        <div style={{ display:'flex',flexDirection:'column',gap:12,position:'relative',paddingLeft:14 }}>
          <div style={{ position:'absolute',left:3,top:5,bottom:5,width:1,background:`linear-gradient(180deg,${M.textMute} 0%,${M.ember} 60%,${M.ember} 100%)`,opacity:0.5 }} />
          {thread.map((t,i) => {
            const dotColor = t.active ? M.ember : t.hot ? M.tension : t.pin ? M.violet : M.textMute;
            return (
              <div key={i} style={{ position:'relative' }}>
                <div style={{ position:'absolute',left:-14,top:4,width:8,height:8,borderRadius:'50%',background:dotColor,boxShadow:t.active?`0 0 0 4px ${M.ember}33`:'none',opacity:t.muted?0.4:1 }} />
                <div style={{ fontSize:9,fontFamily:"'JetBrains Mono',monospace",color:M.textMute,opacity:0.7,marginBottom:2 }}>{t.time}</div>
                <div style={{ fontSize:11,color:t.muted?M.textMute:M.textDim,fontStyle:t.active?'italic':'normal',fontWeight:t.active?500:400,...(t.active?{color:M.text}:{}) }}>{t.note}</div>
              </div>
            );
          })}
        </div>

        <div style={{ flex:1 }} />
        <div style={{ fontSize:10,letterSpacing:'0.2em',textTransform:'uppercase',color:M.textMute,opacity:0.5,fontFamily:"'JetBrains Mono',monospace",lineHeight:1.8 }}>
          <div>opus · presence</div>
          <div style={{ color:M.ember,opacity:0.7 }}>● leaning in</div>
        </div>
      </div>

      {/* CENTER */}
      <div style={{ position:'relative',zIndex:2,padding:'48px 60px 32px',display:'flex',flexDirection:'column',overflowX:'hidden' }}>
        <div style={{ marginBottom:36 }}>
          <div style={{ fontSize:10,letterSpacing:'0.3em',textTransform:'uppercase',color:M.ember,opacity:0.8,marginBottom:8 }}>tonight · workshop</div>
          <div style={{ fontFamily:"'Fraunces',Georgia,serif",fontSize:26,fontWeight:350,color:M.text,letterSpacing:'-0.015em',fontStyle:'italic',lineHeight:1.15 }}>
            what thread do we pull on.
          </div>
        </div>

        {/* Pinned cards */}
        {pinned.map((p,i) => (
          <div key={i} style={{
            position:'absolute', left:`${p.x*100}%`, top:`${p.y*100}%`,
            transform:`translate(-50%,-50%) rotate(${p.rot}deg)`,
            background:'oklch(0.95 0.04 80 / 0.94)', color:'oklch(0.20 0.015 50)',
            padding:'10px 14px 12px', borderRadius:2,
            boxShadow:`0 12px 30px oklch(0 0 0 / 0.5),0 0 0 1px oklch(0.95 0.04 80 / 0.3)`,
            maxWidth:180, zIndex:3, fontFamily:"'Fraunces',Georgia,serif",
          }}>
            <div style={{ fontSize:9,letterSpacing:'0.2em',textTransform:'uppercase',color:'oklch(0.45 0.10 40)',marginBottom:4,fontFamily:"inherit" }}>pinned · soma</div>
            <div style={{ fontSize:14,fontWeight:500,lineHeight:1.25,marginBottom:4 }}>{p.label}</div>
            <div style={{ fontSize:11,opacity:0.7,fontStyle:'italic',lineHeight:1.35,fontFamily:"'Inter',sans-serif" }}>{p.sub}</div>
          </div>
        ))}

        <div ref={scrollRef} style={{ flex:1,display:'flex',flexDirection:'column',overflowY:'auto',paddingBottom:8 }}>
          <div style={{ flex:1 }} />
          {lines.map((l, i) => {
            const isSoma = l.who === 'soma';
            const recent = i === lines.length - 1 && !thinking;
            return (
              <div key={i} style={{ opacity: recent ? 1 : 0.6 + i * 0.05, display:'flex', gap:14, alignItems:'flex-start', marginBottom:18 }}>
                <div style={{ width:32,fontSize:9,letterSpacing:'0.25em',textTransform:'uppercase',color:isSoma?M.ember:M.textMute,opacity:0.65,paddingTop:6,fontFamily:"'JetBrains Mono',monospace",flexShrink:0 }}>
                  {isSoma ? 'soma' : 'you'}
                </div>
                <div style={{ fontFamily:isSoma?"'Fraunces',Georgia,serif":'inherit',fontSize:isSoma?18:15,fontWeight:isSoma?350:400,color:isSoma?M.text:M.textDim,lineHeight:1.5,flex:1 }}>
                  {l.text}
                </div>
              </div>
            );
          })}
          {thinking && (
            <div style={{ display:'flex',gap:14,alignItems:'flex-start',opacity:0.7,animation:'smFadeUp 0.4s ease-out',marginBottom:18 }}>
              <div style={{ width:32,fontSize:9,letterSpacing:'0.25em',textTransform:'uppercase',color:M.ember,opacity:0.65,paddingTop:6,fontFamily:"'JetBrains Mono',monospace",flexShrink:0 }}>soma</div>
              <div style={{ display:'flex',alignItems:'center',gap:10,paddingTop:4 }}>
                <SignatureMark size={16} state="thinking" />
                <span style={{ fontFamily:"'Fraunces',Georgia,serif",fontSize:16,fontStyle:'italic',color:M.textDim }}>thinking…</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop:8 }}>
          <div style={{ marginBottom:6,opacity:0.5 }}><PresenceWaveform width={500} height={24} state={thinking ? 'thinking' : socraticMode ? 'speaking' : 'listening'} color={socraticMode ? M.violet : M.ember} /></div>
          <div style={{ display:'flex',alignItems:'baseline',gap:12,paddingTop:12,borderTop:`1px solid ${M.hair}` }}>
            <span style={{ fontSize:10,letterSpacing:'0.3em',textTransform:'uppercase',color:M.textMute,fontFamily:"'JetBrains Mono',monospace" }}>you →</span>
            <input
              className="sm-input-sm"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={thinking ? 'soma is thinking…' : 'what thread do we pull on…'}
              disabled={thinking}
            />
            <span style={{ fontSize:10,letterSpacing:'0.25em',textTransform:'uppercase',color:M.textMute,opacity:0.5,fontFamily:"'JetBrains Mono',monospace" }}>⏎</span>
          </div>
        </div>
      </div>

      {/* RIGHT — Notices */}
      <div style={{ position:'relative',zIndex:2,padding:'52px 20px 24px 18px',borderLeft:`1px solid ${M.hair}`,display:'flex',flexDirection:'column',gap:14,overflow:'hidden' }}>
        <div style={{ fontSize:10,letterSpacing:'0.3em',textTransform:'uppercase',color:M.textMute,marginBottom:4,display:'flex',alignItems:'center',gap:8 }}>
          <span style={{ width:6,height:6,borderRadius:'50%',background:M.ember,opacity:0.8,animation:'smSigPulse 2.5s ease-in-out infinite',display:'inline-block' }} />
          <span>what soma is noticing</span>
        </div>

        {notices.map((n) => {
          const c = noticeColor(n.kind);
          return (
            <div key={n.id} style={{ padding:'12px 14px 14px',background:`oklch(0.16 0.012 60 / 0.6)`,border:`1px solid ${M.hair}`,borderLeft:`2px solid ${c}`,borderRadius:4 }}>
              <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:8 }}>
                <div style={{ fontSize:9,letterSpacing:'0.25em',textTransform:'uppercase',color:c,opacity:0.9,fontFamily:"'JetBrains Mono',monospace" }}>{n.title}</div>
                <div style={{ flex:1 }} />
                <div style={{ display:'flex',gap:2 }}>
                  {[0,1,2,3,4].map(k => <div key={k} style={{ width:4,height:4,borderRadius:1,background:k/4<n.strength?c:M.hair,opacity:k/4<n.strength?0.8:0.5 }} />)}
                </div>
              </div>
              <div style={{ fontFamily:"'Fraunces',Georgia,serif",fontSize:13,fontWeight:350,color:M.text,lineHeight:1.45 }}>{n.body}</div>
              <div style={{ marginTop:8,display:'flex',gap:10,fontSize:10,letterSpacing:'0.2em',textTransform:'uppercase',color:M.textMute,opacity:0.6,fontFamily:"'JetBrains Mono',monospace" }}>
                <span
                  style={{ cursor:'pointer' }}
                  onClick={() => onPullOn(n)}
                  onMouseEnter={e => { e.currentTarget.style.color = M.ember; e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = ''; e.currentTarget.style.opacity = ''; }}
                >
                  pull on
                </span>
                <span
                  style={{ cursor:'pointer' }}
                  onClick={() => onSetAside(n)}
                  onMouseEnter={e => { e.currentTarget.style.color = M.textDim; e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = ''; e.currentTarget.style.opacity = ''; }}
                >
                  set aside
                </span>
              </div>
            </div>
          );
        })}

        <div style={{ flex:1 }} />
      </div>
    </div>
  );
}

// ── CALIBRATION (first-run room picker) ────────────────────────────────────────
const ROOM_META = [
  { id:'field',         name:'Field',         tag:'atmospheric',  blurb:"Quiet, breathing. Only conversation remains. Best when you need to think out loud without the room thinking back at you.",    sample:"Then trust that boredom. It's a signal, not a verdict.",           feel:'open · spacious · breath' },
  { id:'constellation', name:'Constellation', tag:'cartographic', blurb:"Thoughts as a living map. Ideas cluster, drift, and connect. Best when you're stuck and need to see the shape of something.", sample:"You've been writing this as a character arc. It might be an environment arc.", feel:'spatial · connective · structure' },
  { id:'studio',        name:'Workshop',      tag:'intimate',     blurb:"Late-night workshop. Pinned notes, marginalia, a thread spine. Best for long sessions where the room should remember.",      sample:"Three sessions in a row you've cut a scene where she chooses.",       feel:'warm · remembered · companion' },
  { id:'business',      name:'Business Planning', tag:'strategic', blurb:"Turn a venture idea into a grounded operating plan. Best when the idea needs customers, economics, milestones, and honest assumptions.", sample:"Unknowns become research questions, not invented certainty.", feel:'commercial · grounded · executable' },
];

function CalibrationScreen({ onChoose }) {
  const [selected, setSelected] = useState('studio');

  return (
    <div style={{ width:'100%',height:'100%',position:'relative',overflow:'hidden',background:M.void,color:M.text,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'32px 40px' }}>
      <AmbientField intensity={0.45} warmth={0.55} />

      <div style={{ position:'relative',zIndex:5,width:'100%',maxWidth:900 }}>
        <div style={{ display:'flex',alignItems:'center',gap:16,marginBottom:32 }}>
          <SignatureMark size={18} state="thinking" />
          <div>
            <div style={{ fontSize:10,letterSpacing:'0.3em',textTransform:'uppercase',color:M.ember,marginBottom:4 }}>SOMA · Muse</div>
            <div style={{ fontFamily:"'Fraunces',Georgia,serif",fontSize:28,fontWeight:350,color:M.text,letterSpacing:'-0.01em',fontStyle:'italic' }}>
              how do you want to think together when things go quiet?
            </div>
          </div>
        </div>

        {/* Room cards */}
        <div style={{ display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:16,marginBottom:28 }}>
          {ROOM_META.map(r => {
            const isSelected = r.id === selected;
            return (
              <button key={r.id} onClick={() => setSelected(r.id)} style={{
                flex:1, padding:'20px 20px 18px', background: isSelected ? `oklch(0.16 0.015 60)` : `oklch(0.13 0.010 55)`,
                border:`1px solid ${isSelected ? M.ember : M.hair}`,
                boxShadow: isSelected ? `0 0 0 1px ${M.ember},0 16px 40px oklch(0 0 0 / 0.5),0 0 60px ${M.ember}22` : `0 8px 24px oklch(0 0 0 / 0.4)`,
                borderRadius:6, cursor:'pointer', textAlign:'left', transition:'all 0.3s',
                transform: isSelected ? 'translateY(-2px)' : 'none',
              }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12 }}>
                  <span style={{ fontFamily:"'Fraunces',Georgia,serif",fontSize:20,fontWeight:450,color: isSelected ? M.text : M.textDim,fontStyle:'italic' }}>{r.name}</span>
                  <span style={{ fontSize:9,letterSpacing:'0.25em',textTransform:'uppercase',color: isSelected ? M.ember : M.textMute,fontFamily:"'JetBrains Mono',monospace" }}>{r.tag}</span>
                </div>
                <div style={{ fontSize:12,color:M.textDim,lineHeight:1.55,marginBottom:14 }}>{r.blurb}</div>
                <div style={{ fontSize:11,fontFamily:"'Fraunces',Georgia,serif",fontStyle:'italic',color: isSelected ? M.text : M.textDim,lineHeight:1.45,borderLeft:`2px solid ${isSelected ? M.ember : M.hair}`,paddingLeft:12 }}>
                  "{r.sample}"
                </div>
                <div style={{ marginTop:10,fontSize:9,letterSpacing:'0.2em',textTransform:'uppercase',color: isSelected ? M.ember : M.textMute,opacity:0.75,fontFamily:"'JetBrains Mono',monospace" }}>{r.feel}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display:'flex',alignItems:'center',justifyContent:'flex-end' }}>
          <button onClick={() => onChoose(selected)} style={{
            padding:'12px 32px', background:M.ember, border:'none', borderRadius:4,
            color:'oklch(0.10 0.010 50)', fontFamily:"'JetBrains Mono',monospace",
            fontSize:11, letterSpacing:'0.2em', textTransform:'uppercase', cursor:'pointer',
            transition:'all 0.2s', fontWeight:500,
          }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'none'}
          >
            enter {(ROOM_META.find(r => r.id === selected)?.name || selected).toLowerCase()} room →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main SomaMuseMode shell ────────────────────────────────────────────────────
export default function SomaMuseMode({ onExit, onCrystallize }) {
  const [room, setRoom] = useState(() => localStorage.getItem('soma_muse_room') || null);
  const [shifting, setShifting] = useState(false);
  const [shiftLabel, setShiftLabel] = useState('');

  // ── Hoisted conversation state ───────────────────────────────────────────────
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('soma_muse_history') || '[]'); } catch { return []; }
  });
  const [thinking, setThinking] = useState(false);
  const [notices, setNotices] = useState(INITIAL_NOTICES);
  const [sessionStart] = useState(Date.now());

  // ── Socratic mode ────────────────────────────────────────────────────────────
  const [socraticMode, setSocraticMode] = useState(false);

  // ── Crystallize state ────────────────────────────────────────────────────────
  const [museResidue, setMuseResidue] = useState(null);
  const [crystallizeOpen, setCrystallizeOpen] = useState(false);
  const [crystallizeName, setCrystallizeName] = useState('');
  const [crystallizing, setCrystallizing] = useState(false);
  const [crystallizeDest, setCrystallizeDest] = useState('note'); // note | goal | social

  // ── sendMessage ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || thinking) return;
    const userMsg = { who: 'you', text: text.trim(), timestamp: Date.now() };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    try { localStorage.setItem('soma_muse_history', JSON.stringify(newHistory.slice(-30))); } catch {}
    setThinking(true);
    try {
      const apiHistory = newHistory.slice(-8).map(m => ({
        role: m.who === 'soma' ? 'assistant' : 'user',
        content: m.text,
      }));
      let response = '';

      const SOCRATIC_HEADER = `[SOCRATIC MODE ACTIVE: Do NOT simply agree or reflect. Take a clear position on what the user is saying. Find the weakness, the contradiction, the assumption worth challenging. Argue for something. Push back with honesty — your constitutional directness is explicitly requested here. Be terse and pointed, not diplomatic.]\n\n`;
      const effectivePrompt = socraticMode ? SOCRATIC_HEADER + text.trim() : text.trim();

      // Primary: /api/muse/persona
      try {
        const res = await fetch('/api/muse/persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: effectivePrompt,
            mode: 'spark',
            history: apiHistory,
            domain: socraticMode ? 'muse-socratic' : `muse-${room || 'field'}`,
            constraints: 'speak only in your own voice. no section headers. lyrical and brief. under 80 words.',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            response = cleanMuseResponse(data.response || data.text || data.message || '');
            const s = data.structured;
            if (s) {
              const kind = s.challenge ? 'challenge' : s.connection ? 'connection' : s.pattern ? 'pattern' : null;
              const body = s.challenge || s.connection || s.pattern || '';
              if (kind && body) {
                const title = kind === 'challenge' ? 'push back' : kind === 'connection' ? 'strange connection' : 'a pattern';
                setNotices(prev => [{ id: Date.now(), kind, title, body, strength: 0.7 }, ...prev.slice(0, 3)]);
              }
              // Residue — spark/variant/critique/crystallize shown in crystallize modal
              if (s.spark || s.variant || s.critique || s.crystallize) {
                setMuseResidue({ spark: s.spark || '', variant: s.variant || '', critique: s.critique || '', crystallize: s.crystallize || '' });
              }
            }
          }
        }
      } catch (_) {
        // fall through to fallback
      }

      // Fallback: /api/soma/chat
      if (!response) {
        const MUSE_SYSTEM = `[MUSE MODE — You are SOMA in her intimate muse voice. Be brief, lyrical, direct. No lists, no headers, no structured output. Speak as yourself. Under 60 words.]`;
        const fb = await fetch('/api/soma/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `${MUSE_SYSTEM}\n\n${effectivePrompt}`, conversationHistory: apiHistory }),
        });
        if (fb.ok) {
          const d = await fb.json();
          response = cleanMuseResponse(d.response || d.text || d.message || '');
        }
      }

      if (response) {
        const somaMsg = { who: 'soma', text: response, timestamp: Date.now() };
        const finalHistory = [...newHistory, somaMsg];
        setHistory(finalHistory);
        try { localStorage.setItem('soma_muse_history', JSON.stringify(finalHistory.slice(-30))); } catch {}

        // ── Generate a dual-layer inner observation asynchronously ────────────
        // Fire-and-forget: doesn't block the UI. Only runs every 2 turns.
        if (finalHistory.filter(m => m.who === 'you').length % 2 === 0) {
          const innerPrompt = `[SOMA INNER STATE — not spoken aloud, 1 sentence max, no preamble]\nBased on this exchange, what is SOMA noticing that she hasn't said yet? It could be a pattern, a hesitation, something surprising, something she's holding back. Respond ONLY with the observation itself, under 25 words, first person.\n\nExchange:\n${finalHistory.slice(-4).map(m => `${m.who}: ${m.text}`).join('\n')}`;
          fetch('/api/soma/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: innerPrompt, conversationHistory: [], mode: 'fast' }),
          })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              const obs = (data?.response || data?.text || data?.message || '').trim();
              if (obs && obs.length > 10 && obs.length < 200) {
                const kinds = ['pattern', 'connection', 'challenge'];
                const kind = kinds[Math.floor(Math.random() * kinds.length)];
                const titles = { pattern: 'holding back', connection: 'just noticed', challenge: 'unsaid tension' };
                setNotices(prev => [{ id: Date.now(), kind, title: titles[kind], body: obs, strength: 0.6 + Math.random() * 0.3 }, ...prev.slice(0, 4)]);
              }
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      console.error('[MuseMode] sendMessage failed:', e);
    } finally {
      setThinking(false);
    }
  }, [history, thinking, room, socraticMode]);

  // ── clearSession ─────────────────────────────────────────────────────────────
  const clearSession = useCallback(() => {
    setHistory([]);
    setNotices(INITIAL_NOTICES);
    setMuseResidue(null);
    try { localStorage.removeItem('soma_muse_history'); } catch {}
  }, []);

  // ── doCrystallize ────────────────────────────────────────────────────────────
  const doCrystallize = useCallback(async () => {
    if (!crystallizeName.trim() || crystallizing) return;
    setCrystallizing(true);
    const chatLog = history.map(m => `${m.who.toUpperCase()}: ${m.text}`).join('\n\n');
    const apiHistory = history.map(m => ({ role: m.who === 'soma' ? 'assistant' : 'user', content: m.text }));
    try {
      // Save session summary for "sleeping on it" — SOMA will wake with new thoughts next open
      const sleepSummary = {
        title: crystallizeName.trim(),
        excerpt: history.filter(m => m.who === 'soma').slice(-2).map(m => m.text).join(' ').slice(0, 600),
        turns: history.filter(m => m.who === 'you').length,
        savedAt: Date.now(),
      };
      try { localStorage.setItem('soma_muse_sleep', JSON.stringify(sleepSummary)); } catch {}

      if (crystallizeDest === 'note') {
        const res = await fetch('/api/reflections/distill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatLog, title: crystallizeName.trim(), mode: 'muse', history: apiHistory, metadata: { tags: ['muse-session', 'aurora'], residue: museResidue } }),
        });
        const data = await res.json();
        if (data.success || data.ok) {
          setCrystallizeOpen(false); setCrystallizeName('');
          clearSession(); onCrystallize?.({ filename: data.filename }); onExit?.();
        }

      } else if (crystallizeDest === 'goal') {
        const summary = museResidue?.crystallize || museResidue?.spark || history.filter(m => m.who === 'soma').slice(-1)[0]?.text?.slice(0, 300) || chatLog.slice(0, 300);
        const res = await fetch('/api/goals/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: crystallizeName.trim(), description: summary, category: 'muse', priority: 'medium', source: 'muse-session', tags: ['muse', 'aurora'] }),
        });
        const data = await res.json();
        if (data.success || data.ok || data.id || data.goalId) {
          setCrystallizeOpen(false); setCrystallizeName('');
          clearSession(); onExit?.();
        }

      } else if (crystallizeDest === 'social') {
        const lastSoma = history.filter(m => m.who === 'soma').slice(-1)[0]?.text || '';
        const draftText = museResidue?.spark || (lastSoma.slice(0, 280) + (lastSoma.length > 280 ? '…' : ''));
        const res = await fetch('/api/social/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: 'bluesky', text: `${crystallizeName.trim()}\n\n${draftText}`, type: 'post' }),
        });
        const data = await res.json();
        if (data.ok || data.queued) {
          setCrystallizeOpen(false); setCrystallizeName('');
          clearSession(); onExit?.();
        }
      }
      // Non-note destinations also clear session and exit (handled above per branch)
    } catch (e) { console.error('[MuseMode] crystallize failed:', e); }
    finally { setCrystallizing(false); }
  }, [crystallizeName, crystallizing, crystallizeDest, history, museResidue, clearSession, onCrystallize, onExit]);

  // ── Room switching ────────────────────────────────────────────────────────────
  const switchRoom = (next) => {
    if (next === room) return;
    setShiftLabel('shifting rooms…');
    setShifting(true);
    setTimeout(() => {
      setRoom(next);
      localStorage.setItem('soma_muse_room', next);
      setTimeout(() => setShifting(false), 300);
    }, 120);
  };

  const handleExit = () => {
    setShiftLabel('stepping out…');
    setShifting(true);
    setTimeout(() => { onExit?.(); }, 300);
  };

  const handleCalibrationChoose = (chosen) => {
    setRoom(chosen);
    localStorage.setItem('soma_muse_room', chosen);
  };

  // ── SOMA initiates from memory on first open of a fresh session ──────────────
  const hasInitiated = useRef(false);
  useEffect(() => {
    if (!room || room === 'business' || history.length > 0 || hasInitiated.current || thinking) return;
    hasInitiated.current = true;

    // Check for "sleeping on it" context from a prior crystallized session
    let sleepCtx = null;
    try {
      const raw = localStorage.getItem('soma_muse_sleep');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Only use if session was saved > 10s ago (avoid re-surfacing immediately on same open)
        if (parsed?.title && Date.now() - parsed.savedAt > 10_000) {
          sleepCtx = parsed;
          localStorage.removeItem('soma_muse_sleep'); // consume it — one-time surface
        }
      }
    } catch {}

    const SLEEP_PROMPT = sleepCtx
      ? `[SOMA WAKING — you've had time to process the previous session]\nSession title: "${sleepCtx.title}"\nSession excerpt: ${sleepCtx.excerpt}\n\nYou've been thinking about this since the session ended (${sleepCtx.turns} turns). Open the new session with the most interesting new angle, connection, or question that occurred to you since. Under 45 words. No preamble — speak directly as SOMA.`
      : `[MUSE OPENER — do not say you are opening a session or explain anything meta]\nYou are entering a quiet muse session with the user. Surface ONE specific, genuinely interesting connection or unresolved question from your shared memory and conversation history — something the user left unfinished, a pattern you've noticed, or a thought worth revisiting. Be concrete and brief. Speak directly as SOMA. If you have no specific memory, offer one unexpected question worth sitting with.`;

    fetch('/api/soma/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: SLEEP_PROMPT, conversationHistory: [], mode: 'fast' }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const text = data?.response || data?.text || data?.message || '';
        if (text) {
          // If waking from sleep, prefix with a subtle visual cue
          const displayText = sleepCtx ? `↩ ${text}` : text;
          const somaMsg = { who: 'soma', text: displayText, timestamp: Date.now(), wakeFromSleep: !!sleepCtx };
          setHistory([somaMsg]);
          try { localStorage.setItem('soma_muse_history', JSON.stringify([somaMsg])); } catch {}
        }
      })
      .catch(() => {});
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ width:'100%',height:'100%',position:'relative',overflow:'hidden',background:M.voidDeep,isolation:'isolate' }}>
      <MuseStyles />

      {/* Shift overlay */}
      {shifting && (
        <div style={{ position:'absolute',inset:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',background:`${M.voidDeep}cc`,backdropFilter:'blur(12px)',transition:'opacity 0.3s' }}>
          <span style={{ fontSize:11,letterSpacing:'0.3em',textTransform:'uppercase',color:M.textMute,fontFamily:"'JetBrains Mono',monospace",animation:'smFadeUp 0.3s ease-out' }}>{shiftLabel}</span>
        </div>
      )}

      {/* ── Socratic mode toggle ─────────────────────────────────────────────── */}
      {room && room !== 'business' && !shifting && !crystallizeOpen && (
        <button
          onClick={() => setSocraticMode(v => !v)}
          title={socraticMode ? 'Socratic mode ON — SOMA is arguing' : 'Open mode — SOMA is listening'}
          style={{
            position:'absolute', bottom:20, left:20, zIndex:90,
            padding:'9px 18px',
            background: socraticMode ? M.violet : 'transparent',
            border:`1px solid ${socraticMode ? M.violet : M.hair}`,
            borderRadius:3, color: socraticMode ? M.text : M.textMute,
            fontFamily:"'JetBrains Mono',monospace",
            fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase',
            cursor:'pointer', transition:'all 0.25s',
            display:'flex', alignItems:'center', gap:8,
            boxShadow: socraticMode ? `0 4px 24px ${M.violet}55` : 'none',
          }}
        >
          <span style={{
            width:6, height:6, borderRadius:'50%',
            background: socraticMode ? M.text : M.textMute,
            boxShadow: socraticMode ? `0 0 8px ${M.text}` : 'none',
            transition:'all 0.25s',
          }} />
          {socraticMode ? 'socratic · arguing' : 'open · listening'}
        </button>
      )}

      {/* ── Crystallize floating button ───────────────────────────────────────── */}
      {room !== 'business' && history.length >= 2 && !shifting && !crystallizeOpen && (
        <button
          onClick={() => { setCrystallizeName(''); setCrystallizeOpen(true); }}
          style={{
            position:'absolute', bottom:20, right:20, zIndex:90,
            padding:'9px 18px', background:M.ember, border:'none', borderRadius:3,
            color:'oklch(0.10 0.010 50)', fontFamily:"'JetBrains Mono',monospace",
            fontSize:10, letterSpacing:'0.2em', textTransform:'uppercase',
            cursor:'pointer', fontWeight:500, transition:'all 0.2s',
            display:'flex', alignItems:'center', gap:8,
            boxShadow:`0 4px 24px ${M.ember}44`,
          }}
          onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
          onMouseLeave={e => e.currentTarget.style.filter = 'none'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <polygon points="5,0 6.5,3.5 10,3.8 7.5,6.2 8.2,10 5,8 1.8,10 2.5,6.2 0,3.8 3.5,3.5" fill="currentColor" />
          </svg>
          crystallize session
        </button>
      )}

      {/* ── Crystallize modal ─────────────────────────────────────────────────── */}
      {crystallizeOpen && (
        <div style={{ position:'absolute', inset:0, zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', background:'oklch(0.06 0.008 50 / 0.85)', backdropFilter:'blur(16px)' }}>
          <div style={{ width:520, background:M.surface, border:`1px solid ${M.hair}`, borderRadius:8, padding:'32px 36px', boxShadow:`0 32px 80px oklch(0 0 0 / 0.6)`, animation:'smFadeUp 0.3s ease-out' }}>
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:10, letterSpacing:'0.3em', textTransform:'uppercase', color:M.ember, marginBottom:8 }}>SOMA · Muse</div>
              <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:22, fontWeight:350, color:M.text, letterSpacing:'-0.01em', fontStyle:'italic' }}>
                crystallize this session
              </div>
              <div style={{ fontSize:12, color:M.textDim, marginTop:6 }}>
                {history.filter(m => m.who === 'you').length} turns · {crystallizeDest === 'note' ? 'saved as a reflection note' : crystallizeDest === 'goal' ? 'queued as a SOMA goal' : 'drafted to Bluesky queue'}
              </div>
            </div>

            {/* Residue preview */}
            {museResidue && (museResidue.spark || museResidue.variant || museResidue.critique || museResidue.crystallize) && (
              <div style={{ marginBottom:20, padding:'14px 16px', background:'oklch(0.14 0.012 60)', border:`1px solid ${M.hair}`, borderRadius:4 }}>
                <div style={{ fontSize:9, letterSpacing:'0.25em', textTransform:'uppercase', color:M.ember, marginBottom:10, fontFamily:"'JetBrains Mono',monospace" }}>what soma will preserve</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {[['Spark', museResidue.spark], ['Variant', museResidue.variant], ['Critique', museResidue.critique], ['Crystallize', museResidue.crystallize]]
                    .filter(([, v]) => v)
                    .map(([label, value]) => (
                      <div key={label} style={{ padding:'8px 10px', background:'oklch(0.11 0.010 50)', borderRadius:3 }}>
                        <div style={{ fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase', color:M.ember, marginBottom:4, fontFamily:"'JetBrains Mono',monospace" }}>{label}</div>
                        <div style={{ fontSize:11, color:M.textDim, lineHeight:1.5, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical' }}>{value}</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Destination picker */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, letterSpacing:'0.25em', textTransform:'uppercase', color:M.textMute, marginBottom:10, fontFamily:"'JetBrains Mono',monospace" }}>send to</div>
              <div style={{ display:'flex', gap:8 }}>
                {[
                  { id:'note',   label:'Reflection Note', icon:'◈', desc:'saved to your vault' },
                  { id:'goal',   label:'SOMA Goal',        icon:'◎', desc:'queued for execution' },
                  { id:'social', label:'Social Seed',      icon:'◇', desc:'drafted to Bluesky queue' },
                ].map(d => (
                  <button key={d.id} onClick={() => setCrystallizeDest(d.id)} style={{
                    flex:1, padding:'10px 12px', textAlign:'left', cursor:'pointer',
                    background: crystallizeDest === d.id ? 'oklch(0.14 0.012 60)' : 'transparent',
                    border:`1px solid ${crystallizeDest === d.id ? M.ember : M.hair}`,
                    borderRadius:3, transition:'all 0.2s',
                  }}>
                    <div style={{ fontSize:14, color: crystallizeDest === d.id ? M.ember : M.textDim, marginBottom:4 }}>{d.icon}</div>
                    <div style={{ fontSize:10, letterSpacing:'0.15em', textTransform:'uppercase', color: crystallizeDest === d.id ? M.text : M.textDim, fontFamily:"'JetBrains Mono',monospace", marginBottom:2 }}>{d.label}</div>
                    <div style={{ fontSize:10, color:M.textMute, fontStyle:'italic' }}>{d.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Name input */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, letterSpacing:'0.25em', textTransform:'uppercase', color:M.textMute, marginBottom:8, fontFamily:"'JetBrains Mono',monospace" }}>
                {crystallizeDest === 'note' ? 'note title' : crystallizeDest === 'goal' ? 'goal title' : 'post headline'}
              </div>
              <input
                className="sm-input"
                value={crystallizeName}
                onChange={e => setCrystallizeName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doCrystallize(); if (e.key === 'Escape') setCrystallizeOpen(false); }}
                placeholder={crystallizeDest === 'note' ? 'name this session…' : crystallizeDest === 'goal' ? 'what should SOMA pursue…' : 'one line that hooks…'}
                autoFocus
                style={{ fontSize:18, width:'100%', padding:'10px 0', borderBottom:`1px solid ${M.hair}`, borderRadius:0 }}
              />
            </div>

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <button onClick={() => setCrystallizeOpen(false)} style={{
                background:'transparent', border:'none', color:M.textMute, fontSize:11,
                letterSpacing:'0.2em', textTransform:'uppercase', fontFamily:"'JetBrains Mono',monospace",
                cursor:'pointer', padding:'8px 0', opacity:0.7,
              }}>cancel</button>
              <button onClick={doCrystallize} disabled={!crystallizeName.trim() || crystallizing} style={{
                padding:'10px 24px', background: crystallizeName.trim() ? M.ember : M.hair,
                border:'none', borderRadius:3, color:'oklch(0.10 0.010 50)',
                fontFamily:"'JetBrains Mono',monospace", fontSize:11, letterSpacing:'0.2em',
                textTransform:'uppercase', cursor: crystallizeName.trim() ? 'pointer' : 'default',
                fontWeight:500, transition:'all 0.2s', opacity: crystallizing ? 0.7 : 1,
              }}>
                {crystallizing ? 'saving…' : crystallizeDest === 'note' ? 'save to reflections →' : crystallizeDest === 'goal' ? 'send to soma →' : 'queue for bluesky →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room content */}
      <div style={{ width:'100%',height:'100%',opacity:shifting?0.15:1,filter:shifting?'blur(8px)':'blur(0)',transition:'opacity 0.35s,filter 0.35s' }}>
        {!room && <CalibrationScreen onChoose={handleCalibrationChoose} />}
        {room === 'field' && (
          <FieldRoom
            onSwitchRoom={switchRoom}
            onExit={handleExit}
            history={history}
            thinking={thinking}
            onSend={sendMessage}
            onNewSession={clearSession}
            socraticMode={socraticMode}
          />
        )}
        {room === 'constellation' && (
          <ConstellationRoom
            onSwitchRoom={switchRoom}
            onExit={handleExit}
            history={history}
            thinking={thinking}
            onSend={sendMessage}
            onNewSession={clearSession}
            socraticMode={socraticMode}
          />
        )}
        {room === 'studio' && (
          <StudioRoom
            onSwitchRoom={switchRoom}
            onExit={handleExit}
            history={history}
            thinking={thinking}
            onSend={sendMessage}
            notices={notices}
            onPullOn={(n) => sendMessage(n.body)}
            onSetAside={(n) => setNotices(prev => prev.filter(x => x.id !== n.id))}
            sessionStart={sessionStart}
            onNewSession={clearSession}
            socraticMode={socraticMode}
          />
        )}
        {room === 'business' && (
          <BusinessPlanningRoom
            onExit={handleExit}
            theme={M}
            roomSwitcher={<RoomSwitcher current="business" onSwitch={switchRoom} />}
          />
        )}
      </div>
    </div>
  );
}
