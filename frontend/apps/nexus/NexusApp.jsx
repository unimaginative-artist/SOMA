import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import EngagementHub from './modules/EngagementHub.jsx';
import OculusVault from './modules/OculusVault.jsx';
import AxisChat from './modules/AxisChat.jsx';
import NeuralReflections from './modules/NeuralReflections.jsx';
import NexusAuth from './components/NexusAuth.jsx';
import { createNexusSocket, fetchSomaStatus } from './nexusBackend.js';

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:       '#050506',
  surface:  '#0a0a0c',
  card:     '#0d0d10',
  border:   '#1a1a20',
  border2:  '#252530',
  text:     '#f5f0e8',
  dim:      '#8888a0',
  dimmer:   '#4a4a60',
  blue:     '#00aaff',
  blueGlow: 'rgba(0,170,255,0.15)',
  purple:   '#7755ff',
  success:  '#33ffaa',
  warning:  '#ffaa33',
  danger:   '#ff4455',
};

const NAV = [
  { id: 'hub',         label: 'Engagement Hub',     icon: '◈', short: 'HUB'  },
  { id: 'vault',       label: 'Oculus Vault',        icon: '⬡', short: 'VLT'  },
  { id: 'chat',        label: 'Axis Chat',           icon: '⬡', short: 'AXS'  },
  { id: 'reflections', label: 'Neural Reflections',  icon: '◇', short: 'REF'  },
];

const IDENTITY_KEY = 'soma_nexus_identity';

export default function NexusApp() {
  const [identity, setIdentity]   = useState(null);
  const [tab, setTab]             = useState('hub');
  const [somaStatus, setSomaStatus] = useState(null);
  const [wsStatus, setWsStatus]   = useState('offline');
  const [events, setEvents]       = useState([]);
  const wsRef = useRef(null);

  // ── Identity ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem(IDENTITY_KEY);
    if (stored) {
      try { setIdentity(JSON.parse(stored)); } catch {}
    }
  }, []);

  const handleIdentify = useCallback((id) => {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
    setIdentity(id);
  }, []);

  // ── SOMA status poll ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!identity) return;
    fetchSomaStatus().then(setSomaStatus);
    const iv = setInterval(() => fetchSomaStatus().then(setSomaStatus), 30_000);
    return () => clearInterval(iv);
  }, [identity]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!identity) return;
    wsRef.current = createNexusSocket(
      (msg) => setEvents(prev => [{ ...msg, _ts: Date.now() }, ...prev].slice(0, 200)),
      setWsStatus
    );
    return () => wsRef.current?.destroy();
  }, [identity]);

  if (!identity) return <NexusAuth onIdentify={handleIdentify} />;

  return (
    <div style={{ display: 'flex', height: '100vh', background: T.bg, color: T.text, fontFamily: "'JetBrains Mono', monospace" }}>
      {/* ── Sidebar ─── */}
      <aside style={{
        width: 220,
        minWidth: 220,
        background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}>
        {/* Logo */}
        <div style={{
          padding: '20px 16px 16px',
          borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: 11, letterSpacing: 4, color: T.dimmer, marginBottom: 4 }}>
            SOMA NEXUS
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 10, color: T.dim,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: wsStatus === 'online' ? T.success : T.danger,
              boxShadow: wsStatus === 'online' ? `0 0 6px ${T.success}` : 'none',
              display: 'inline-block',
              transition: 'background 0.3s',
            }} />
            <span>{wsStatus === 'online' ? 'NODE 01 LIVE' : 'RECONNECTING'}</span>
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
                  width: '100%',
                  textAlign: 'left',
                  background: active ? T.blueGlow : 'transparent',
                  border: `1px solid ${active ? T.blue : 'transparent'}`,
                  borderRadius: 6,
                  padding: '8px 12px',
                  color: active ? T.blue : T.dim,
                  cursor: 'pointer',
                  fontSize: 11,
                  letterSpacing: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 14, opacity: 0.8 }}>{n.icon}</span>
                <span>{n.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Identity */}
        <div style={{
          padding: '12px 16px',
          borderTop: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: 9, letterSpacing: 2, color: T.dimmer, marginBottom: 6 }}>IDENTITY</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: identity.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: '#fff', fontWeight: 700,
            }}>
              {identity.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 11, color: T.text }}>{identity.name}</div>
              <div style={{ fontSize: 9, color: T.dimmer }}>{identity.role || 'ANALYST'}</div>
            </div>
          </div>
          <button
            onClick={() => { localStorage.removeItem(IDENTITY_KEY); setIdentity(null); }}
            style={{
              marginTop: 8, fontSize: 9, color: T.dimmer, background: 'none',
              border: 'none', cursor: 'pointer', letterSpacing: 1,
              textDecoration: 'underline', padding: 0,
            }}
          >
            SWITCH IDENTITY
          </button>
        </div>
      </aside>

      {/* ── Main content ─── */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Tab header */}
        <header style={{
          padding: '0 24px',
          height: 48,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: T.surface,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 9, letterSpacing: 3, color: T.dimmer }}>
              {NAV.find(n => n.id === tab)?.short}
            </span>
            <span style={{ color: T.border2 }}>—</span>
            <span style={{ fontSize: 12, color: T.text, letterSpacing: 1 }}>
              {NAV.find(n => n.id === tab)?.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 9, color: T.dimmer, letterSpacing: 1 }}>
            {somaStatus?.arbiters && (
              <span>{somaStatus.arbiters.active ?? '—'} ARBITERS</span>
            )}
            {somaStatus?.memory && (
              <span>MEM {somaStatus.memory.usedPercent ?? '—'}%</span>
            )}
            <span style={{ color: T.dimmer }}>
              {new Date().toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
        </header>

        {/* Tab panels */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              style={{ height: '100%' }}
            >
              {tab === 'hub'         && <EngagementHub somaStatus={somaStatus} events={events} identity={identity} />}
              {tab === 'vault'       && <OculusVault identity={identity} />}
              {tab === 'chat'        && <AxisChat identity={identity} events={events} />}
              {tab === 'reflections' && <NeuralReflections identity={identity} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
