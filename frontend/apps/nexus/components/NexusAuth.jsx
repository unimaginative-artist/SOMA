import React, { useState } from 'react';
import { motion } from 'framer-motion';

const ROLES = ['FORENSIC AUDITOR', 'SENIOR ANALYST', 'INVESTIGATOR', 'DIRECTOR', 'PARTNER', 'ADMIN'];
const COLORS = [
  '#00aaff', '#7755ff', '#33ffaa', '#ffaa33', '#ff4488',
  '#44ddff', '#aaffdd', '#ffdd44', '#dd44ff', '#ff6644',
];

const T = {
  bg:     '#050506',
  card:   '#0d0d10',
  border: '#1a1a20',
  blue:   '#00aaff',
  text:   '#f5f0e8',
  dim:    '#8888a0',
};

export default function NexusAuth({ onIdentify }) {
  const [name,  setName]  = useState('');
  const [role,  setRole]  = useState(ROLES[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [err,   setErr]   = useState('');

  const submit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setErr('Name required'); return; }
    onIdentify({
      id:    `nexus-${trimmed.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      name:  trimmed,
      role,
      color,
    });
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: T.bg, fontFamily: "'JetBrains Mono', monospace",
    }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        style={{
          width: 420,
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 40,
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{
            fontSize: 9, letterSpacing: 6, color: '#404055', marginBottom: 8,
          }}>
            SOMA NEXUS
          </div>
          <div style={{ fontSize: 20, color: T.blue, letterSpacing: 2 }}>
            IDENTIFY
          </div>
          <div style={{ fontSize: 10, color: T.dim, marginTop: 8, letterSpacing: 1 }}>
            Establish your neural signature to proceed
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Name */}
          <div>
            <label style={{ fontSize: 9, letterSpacing: 2, color: T.dim, display: 'block', marginBottom: 6 }}>
              FULL NAME
            </label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setErr(''); }}
              placeholder="Enter your name"
              autoFocus
              style={{
                width: '100%', padding: '10px 12px',
                background: '#050506', border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text, fontSize: 12,
                fontFamily: 'inherit', outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = T.blue}
              onBlur={e => e.target.style.borderColor = T.border}
            />
          </div>

          {/* Role */}
          <div>
            <label style={{ fontSize: 9, letterSpacing: 2, color: T.dim, display: 'block', marginBottom: 6 }}>
              ROLE
            </label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px',
                background: '#050506', border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text, fontSize: 11,
                fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
              }}
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Color */}
          <div>
            <label style={{ fontSize: 9, letterSpacing: 2, color: T.dim, display: 'block', marginBottom: 8 }}>
              SIGNATURE COLOR
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLORS.map(c => (
                <button
                  key={c} type="button" onClick={() => setColor(c)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: c, border: color === c ? `2px solid ${T.text}` : '2px solid transparent',
                    cursor: 'pointer', transition: 'transform 0.1s',
                    transform: color === c ? 'scale(1.15)' : 'scale(1)',
                    boxShadow: color === c ? `0 0 8px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
          </div>

          {err && (
            <div style={{ fontSize: 10, color: '#ff4455', letterSpacing: 1 }}>{err}</div>
          )}

          <button
            type="submit"
            style={{
              marginTop: 8,
              padding: '12px',
              background: T.blue,
              border: 'none',
              borderRadius: 6,
              color: '#050506',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 3,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.target.style.opacity = '0.85'}
            onMouseLeave={e => e.target.style.opacity = '1'}
          >
            ENTER NEXUS
          </button>
        </form>
      </motion.div>
    </div>
  );
}
