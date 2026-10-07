import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pencil } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

// ── Direct imports from command-bridge panels ─────────────────────────────────
import SomaCT from '../command-ct/SomaCT.jsx';
import FileIntelligenceApp from '../command-bridge/panels/FileIntelligence/FileIntelligenceApp.jsx';
import ReflectionsTab from '../command-bridge/components/ReflectionsTab.jsx';
import AxisApp from '../command-bridge/panels/Axis/AxisApp.jsx';
// AxisApp already wraps itself in AxisProvider internally — no external wrap needed

import FloatingChat from '../command-bridge/components/FloatingChat.jsx';

// ── Tie-native modules ────────────────────────────────────────────────────────
import WorkspaceModule from './modules/WorkspaceModule.jsx';
import ForensicsModule from './modules/ForensicsModule.jsx';

const T = {
  bg:       '#09090b',
  surface:  '#111113',
  card:     '#18181b',
  border:   'rgba(255,255,255,0.07)',
  border2:  'rgba(255,255,255,0.12)',
  text:     '#fafafa',
  dim:      '#a1a1aa',
  dimmer:   '#52525b',
  blue:     '#00aaff',
  blueGlow: 'rgba(0,170,255,0.12)',
  success:  '#33ffaa',
  danger:   '#ff4455',
};

const IDENTITY_KEY = 'tie_identity';

const NAV = [
  { id: 'ct',          label: 'CT',          desc: 'Cognitive Terminal'  },
  { id: 'forensics',   label: 'Forensics',   desc: 'Fraud & Audit Suite' },
  { id: 'storage',     label: 'Storage',     desc: 'Hybrid Search'       },
  { id: 'reflections', label: 'Reflections', desc: 'Neural Vault'        },
  { id: 'axis',        label: 'Axis',        desc: 'Communications'      },
  { id: 'workspace',   label: 'Workspace',   desc: 'Projects & Tasks'    },
];

// Logo placeholder — swap in real elephant-in-a-tie artwork here when ready

// ── Auth gate ─────────────────────────────────────────────────────────────────
function TieAuth({ onIdentify }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('ANALYST');

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onIdentify({
      id:   `tie-${name.trim().toLowerCase().replace(/\s+/g,'-')}-${Date.now()}`,
      name: name.trim(),
      role,
    });
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: T.bg,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          width: 340, background: T.card,
          border: `1px solid ${T.border}`, borderRadius: 12, padding: 36,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 22, color: T.blue, letterSpacing: 4 }}>TIE</div>
          <div style={{ fontSize: 9, color: T.dimmer, letterSpacing: 3, marginTop: 4 }}>
            POWERED BY SOMA
          </div>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 6, color: T.text, fontSize: 12,
              padding: '10px 12px', fontFamily: 'inherit', outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = T.blue}
            onBlur={e => e.target.style.borderColor = T.border}
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 6, color: T.dim, fontSize: 11,
              padding: '10px 12px', fontFamily: 'inherit', outline: 'none',
            }}
          >
            {['ANALYST','AUDITOR','INVESTIGATOR','MANAGER','PARTNER','ADMIN'].map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            type="submit"
            style={{
              padding: 12, background: T.blue, border: 'none',
              borderRadius: 6, color: '#050506', fontSize: 11,
              fontWeight: 700, letterSpacing: 3, cursor: 'pointer',
              fontFamily: 'inherit', marginTop: 4,
            }}
          >
            ENTER
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ── Main shell ────────────────────────────────────────────────────────────────
export default function TieApp() {
  const [identity,     setIdentity]     = useState(null);
  const [tab,          setTab]          = useState('ct');
  const [wsStatus,     setWsStatus]     = useState('offline');
  const [isBusy,       setIsBusy]       = useState(false);
  const [showQuickNote, setShowQuickNote] = useState(false);
  const wsRef = useRef(null);

  const handleChatSubmit = useCallback(async (message, { history = [], activeModule: page } = {}) => {
    setIsBusy(true);
    try {
      const res = await fetch('/api/soma/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          sessionId: `tie-${identity?.id || 'anon'}`,
          history: history.map(m => ({
            role: m.role || (m.sender === 'user' ? 'user' : 'assistant'),
            content: m.content || m.text,
          })),
          context: { source: 'tie-floating-chat', page: page || tab },
        }),
      });
      const data = await res.json();
      if (data?.response || data?.message) {
        return { text: data.response || data.message };
      }
    } catch (e) {
      console.error('[Tie] chat error:', e);
    } finally {
      setIsBusy(false);
    }
    return null;
  }, [identity, tab]);

  useEffect(() => {
    const stored = localStorage.getItem(IDENTITY_KEY);
    if (stored) try { setIdentity(JSON.parse(stored)); } catch {}
  }, []);

  const identify = useCallback((id) => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
    setIdentity(id);
  }, []);

  // Minimal WS just for status indicator
  useEffect(() => {
    if (!identity) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let backoff = 1000;
    let dead = false;

    const connect = () => {
      if (dead) return;
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen  = () => { setWsStatus('online'); backoff = 1000; };
      ws.onclose = () => { setWsStatus('offline'); if (!dead) setTimeout(connect, Math.min(backoff *= 1.5, 30000)); };
      ws.onerror = () => ws.close();
      wsRef.current = ws;
    };
    connect();
    return () => { dead = true; wsRef.current?.close(); };
  }, [identity]);

  if (!identity) return <TieAuth onIdentify={identify} />;

  return (
    <div style={{
      display: 'flex', height: '100vh',
      background: T.bg, color: T.text,
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      <style>{`
        /* Retheme FileIntelligenceApp to Tie zinc+blue palette */
        .tie-storage .bg-background        { background-color: #09090b; }
        .tie-storage .bg-surface           { background-color: #111113; }
        .tie-storage .bg-surfaceHighlight  { background-color: #18181b; }
        .tie-storage .border-border        { border-color: rgba(255,255,255,0.07); }
        .tie-storage .text-text-primary    { color: #fafafa; }
        .tie-storage .text-text-secondary  { color: #a1a1aa; }
        .tie-storage .text-text-muted      { color: #52525b; }
        .tie-storage .text-accent          { color: #00aaff; }
        .tie-storage .bg-accent            { background-color: #00aaff; }
        .tie-storage .bg-accent\\/10       { background-color: rgba(0,170,255,0.10); }
        .tie-storage .bg-accent\\/20       { background-color: rgba(0,170,255,0.20); }
        .tie-storage .bg-accent\\/5        { background-color: rgba(0,170,255,0.05); }
        .tie-storage .ring-accent\\/30     { box-shadow: 0 0 0 1px rgba(0,170,255,0.30); }
        .tie-storage .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; }
      `}</style>
      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside style={{
        width: 200, minWidth: 200,
        background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column',
        userSelect: 'none',
      }}>
        {/* Brand */}
        <div style={{
          padding: '20px 16px 16px',
          borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 14, letterSpacing: 4, color: T.blue }}>TIE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: wsStatus === 'online' ? T.success : T.danger,
                boxShadow: wsStatus === 'online' ? `0 0 5px ${T.success}` : 'none',
                display: 'inline-block', transition: 'background 0.3s',
              }} />
              <span style={{ fontSize: 8, color: T.dimmer, letterSpacing: 1 }}>
                {wsStatus === 'online' ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(n => {
            const active = tab === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                style={{
                  width: '100%', textAlign: 'left',
                  background: active ? T.blueGlow : 'transparent',
                  border: `1px solid ${active ? T.blue : 'transparent'}`,
                  borderRadius: 6, padding: '9px 12px',
                  color: active ? T.blue : T.dim,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: 1 }}>{n.label}</div>
                <div style={{ fontSize: 8, color: active ? T.blue : T.dimmer, marginTop: 2, opacity: 0.7 }}>
                  {n.desc}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Identity */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, color: T.text }}>{identity.name}</div>
          <div style={{ fontSize: 8, color: T.dimmer, letterSpacing: 1, marginTop: 2 }}>{identity.role}</div>
          <button
            onClick={() => { localStorage.removeItem(IDENTITY_KEY); setIdentity(null); }}
            style={{
              marginTop: 8, fontSize: 8, color: T.dimmer,
              background: 'none', border: 'none', cursor: 'pointer',
              letterSpacing: 1, textDecoration: 'underline', padding: 0,
              fontFamily: 'inherit',
            }}
          >
            SWITCH
          </button>
        </div>
      </aside>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ flex: 1, overflow: 'hidden', height: '100%' }}
          >
            {tab === 'ct'          && <SomaCT />}
            {tab === 'forensics'   && <ForensicsModule identity={identity} />}
            {tab === 'storage'     && (
              <div className="tie-storage" style={{ height: '100%' }}>
                <FileIntelligenceApp />
              </div>
            )}
            {tab === 'reflections' && <ReflectionsTab />}
            {tab === 'axis'        && <AxisApp />}
            {tab === 'workspace'   && <WorkspaceModule identity={identity} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Quick Note button — hidden on reflections tab ── */}
      {tab !== 'reflections' && (
        <button
          onClick={() => setShowQuickNote(v => !v)}
          title="Quick Note"
          style={{
            position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)',
            zIndex: 90, width: 40, height: 40, borderRadius: 10,
            background: showQuickNote ? T.blueGlow : 'rgba(17,17,19,0.92)',
            border: `1px solid ${showQuickNote ? T.blue : T.border2}`,
            color: showQuickNote ? T.blue : T.dim,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.15s',
            boxShadow: showQuickNote ? `0 0 12px rgba(0,170,255,0.2)` : 'none',
          }}
        >
          <Pencil size={15} />
        </button>
      )}

      {/* ── Quick Note side panel ── */}
      {showQuickNote && (
        <div style={{
          position: 'fixed', right: 0, top: 0, bottom: 0, width: 480,
          zIndex: 95, borderLeft: `1px solid ${T.border}`,
          boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        }}>
          <ReflectionsTab
            mode="quick-note-only"
            onClose={() => setShowQuickNote(false)}
            context={tab}
            onSendToSoma={(text) => handleChatSubmit(text, { history: [], activeModule: tab })}
          />
        </div>
      )}

      {/* ── Floating Chat — anchored bottom-left near the identity section ── */}
      <FloatingChat
        isServerRunning={wsStatus === 'online'}
        isBusy={isBusy}
        onSendMessage={handleChatSubmit}
        activeModule={tab}
        activeQuestion={null}
        onSendQuestionResponse={() => {}}
        tensionLevel={0}
        initialX={216}
        initialY={typeof window !== 'undefined' ? window.innerHeight - 60 : 900}
      />
    </div>
  );
}
