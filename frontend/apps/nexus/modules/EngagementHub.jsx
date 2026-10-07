import React, { useState, useEffect } from 'react';
import { fetchGoals, get } from '../nexusBackend.js';

const T = {
  bg:      '#050506',
  surface: '#0a0a0c',
  card:    '#0d0d10',
  border:  '#1a1a20',
  border2: '#252530',
  text:    '#f5f0e8',
  dim:     '#8888a0',
  dimmer:  '#4a4a60',
  blue:    '#00aaff',
  purple:  '#7755ff',
  success: '#33ffaa',
  warning: '#ffaa33',
  danger:  '#ff4455',
};

function Panel({ title, badge, children, style = {} }) {
  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      ...style,
    }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, letterSpacing: 3, color: T.dimmer }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: 8, letterSpacing: 1, padding: '2px 6px',
            background: T.border2, borderRadius: 10, color: T.dim,
          }}>{badge}</span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function GoalRow({ goal }) {
  const pct = Math.round((goal.progress || 0) * 100);
  const color = goal.priority > 0.7 ? T.blue : goal.priority > 0.4 ? T.purple : T.dim;
  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: `1px solid ${T.border}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 11, color: T.text, flex: 1, lineHeight: 1.4 }}>
          {goal.title || goal.description?.slice(0, 80) || 'Untitled'}
        </span>
        <span style={{ fontSize: 9, color, marginLeft: 12, flexShrink: 0 }}>
          P{(goal.priority || 0).toFixed(2)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          flex: 1, height: 2, background: T.border2, borderRadius: 1, overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: color,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 9, color: T.dimmer, flexShrink: 0 }}>{pct}%</span>
      </div>
    </div>
  );
}

function EventRow({ evt }) {
  const typeColors = {
    'axis.message':         T.blue,
    'git.improvement':      T.success,
    'health.warning':       T.warning,
    'swarm.experience':     T.purple,
    'limbic.affect':        '#ff88aa',
    'insight':              T.blue,
  };
  const key  = Object.keys(typeColors).find(k => evt.type?.includes(k.replace('.', ''))) || '';
  const color = typeColors[key] || T.dimmer;
  const ts = evt._ts ? new Date(evt._ts).toLocaleTimeString('en-US', { hour12: false }) : '';

  let summary = evt.type || 'event';
  if (evt.payload?.message)  summary = evt.payload.message;
  else if (evt.payload?.text) summary = evt.payload.text;
  else if (evt.payload?.issue) summary = evt.payload.issue;
  else if (evt.content)       summary = evt.content;

  return (
    <div style={{
      padding: '8px 16px',
      borderBottom: `1px solid ${T.border}`,
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <span style={{
        fontSize: 8, color, letterSpacing: 1,
        marginTop: 2, flexShrink: 0, minWidth: 60,
      }}>
        {ts}
      </span>
      <span style={{ fontSize: 10, color: T.dim, flex: 1, lineHeight: 1.5 }}>
        {typeof summary === 'string' ? summary.slice(0, 120) : JSON.stringify(summary).slice(0, 80)}
      </span>
    </div>
  );
}

export default function EngagementHub({ somaStatus, events, identity }) {
  const [goals,  setGoals]  = useState([]);
  const [brief,  setBrief]  = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);

  useEffect(() => {
    fetchGoals().then(data => setGoals((data?.goals || []).slice(0, 20)));
  }, []);

  const generateBrief = async () => {
    setBriefLoading(true);
    try {
      const res = await fetch('/api/soma/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Generate a concise neural brief for the audit team: current system status, top priorities, any anomalies or alerts. Keep it under 200 words. Be direct and professional.',
          sessionId: `nexus-brief-${Date.now()}`,
        }),
      });
      const data = await res.json();
      setBrief(data.response || data.message || data.text || 'No response');
    } catch (e) {
      setBrief('Neural brief unavailable — brain offline.');
    } finally {
      setBriefLoading(false);
    }
  };

  const activeGoals = goals.filter(g => g.status === 'active' || !g.status);
  const completedGoals = goals.filter(g => g.status === 'completed');
  const feedEvents = events.slice(0, 50);

  const arbiters = somaStatus?.arbiters;
  const mem = somaStatus?.memory;

  return (
    <div style={{
      height: '100%',
      display: 'grid',
      gridTemplateColumns: '320px 1fr 280px',
      gridTemplateRows: '1fr',
      gap: 1,
      background: T.border,
      overflow: 'hidden',
    }}>
      {/* ── Left: Neural Brief ─────────────────────────────────────────────── */}
      <div style={{ background: T.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Panel title="NEURAL BRIEF" style={{ flex: 1 }}>
          {/* System vitals */}
          <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${T.border}`,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}>
            {[
              { label: 'ARBITERS',  value: arbiters?.active ?? '—' },
              { label: 'MEMORY',    value: mem?.usedPercent ? `${mem.usedPercent}%` : '—' },
              { label: 'GOALS',     value: activeGoals.length },
              { label: 'COMPLETED', value: completedGoals.length },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 8, letterSpacing: 2, color: T.dimmer }}>{label}</div>
                <div style={{ fontSize: 18, color: T.blue, marginTop: 2 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Brief text */}
          <div style={{ padding: '12px 16px', flex: 1, overflow: 'auto' }}>
            {brief ? (
              <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.7 }}>{brief}</div>
            ) : (
              <div style={{ textAlign: 'center', paddingTop: 24 }}>
                <div style={{ fontSize: 10, color: T.dimmer, marginBottom: 16, lineHeight: 1.6 }}>
                  Request a neural brief from SOMA for a current system summary.
                </div>
                <button
                  onClick={generateBrief}
                  disabled={briefLoading}
                  style={{
                    padding: '8px 16px',
                    background: T.blue,
                    border: 'none',
                    borderRadius: 6,
                    color: '#050506',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 2,
                    cursor: briefLoading ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: briefLoading ? 0.6 : 1,
                  }}
                >
                  {briefLoading ? 'THINKING...' : 'GENERATE BRIEF'}
                </button>
              </div>
            )}
            {brief && (
              <button
                onClick={() => { setBrief(null); generateBrief(); }}
                disabled={briefLoading}
                style={{
                  marginTop: 16, fontSize: 9, color: T.dimmer,
                  background: 'none', border: 'none', cursor: 'pointer',
                  letterSpacing: 1, fontFamily: 'inherit', textDecoration: 'underline',
                }}
              >
                REFRESH
              </button>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Center: Active Neural Mission (Goals) ──────────────────────────── */}
      <div style={{ background: T.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Panel title="ACTIVE NEURAL MISSION" badge={`${activeGoals.length} ACTIVE`} style={{ flex: 1 }}>
          <div style={{ overflow: 'auto', height: '100%' }}>
            {activeGoals.length === 0 ? (
              <div style={{
                padding: 32, textAlign: 'center',
                fontSize: 10, color: T.dimmer, letterSpacing: 1,
              }}>
                NO ACTIVE GOALS
              </div>
            ) : (
              activeGoals.map((g, i) => <GoalRow key={g.id || i} goal={g} />)
            )}
          </div>
        </Panel>
      </div>

      {/* ── Right: Live Feed ───────────────────────────────────────────────── */}
      <div style={{ background: T.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Panel title="ACTIVE FINDINGS" badge="LIVE" style={{ flex: 1 }}>
          <div style={{ overflow: 'auto', height: '100%' }}>
            {feedEvents.length === 0 ? (
              <div style={{
                padding: 24, textAlign: 'center',
                fontSize: 10, color: T.dimmer, letterSpacing: 1,
              }}>
                AWAITING SIGNALS...
              </div>
            ) : (
              feedEvents.map((evt, i) => <EventRow key={evt._ts || i} evt={evt} />)
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
