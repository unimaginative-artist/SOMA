import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const STATE_PALETTES = {
  offline: {
    core: '#71717a',
    glow: 'rgba(113,113,122,0.26)',
    iris: '#a1a1aa',
    line: '#52525b',
    accent: 'rgba(161,161,170,0.18)',
    label: 'presence offline'
  },
  idle: {
    core: '#e9d5ff',
    glow: 'rgba(217,70,239,0.34)',
    iris: '#d946ef',
    line: '#a855f7',
    accent: 'rgba(34,211,238,0.2)',
    label: 'presence stable'
  },
  listening: {
    core: '#dbeafe',
    glow: 'rgba(34,211,238,0.36)',
    iris: '#38bdf8',
    line: '#22d3ee',
    accent: 'rgba(96,165,250,0.24)',
    label: 'listening'
  },
  thinking: {
    core: '#fef3c7',
    glow: 'rgba(251,191,36,0.34)',
    iris: '#f59e0b',
    line: '#fbbf24',
    accent: 'rgba(217,70,239,0.18)',
    label: 'reasoning'
  },
  talking: {
    core: '#ffffff',
    glow: 'rgba(217,70,239,0.46)',
    iris: '#e879f9',
    line: '#d946ef',
    accent: 'rgba(34,211,238,0.24)',
    label: 'speaking'
  }
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function EyeLens({ side, palette, stateKey, phase, volume }) {
  const x = side === 'left' ? -62 : 62;
  const blinkScale = phase === 'closed' ? 0.08 : phase === 'closing' ? 0.22 : 1;
  const talkPulse = stateKey === 'talking' ? 1 + clamp01(volume) * 0.16 : 1;
  const scanOpacity = stateKey === 'thinking' ? 0.55 : 0.32;

  return (
    <motion.g
      transform={`translate(${x}, -18)`}
      animate={{ y: stateKey === 'listening' ? [0, -2, 0] : 0 }}
      transition={{ duration: 1.6, repeat: stateKey === 'listening' ? Infinity : 0, ease: 'easeInOut' }}
    >
      <motion.ellipse
        rx="42"
        ry="30"
        fill="rgba(3,7,18,0.82)"
        stroke={palette.line}
        strokeWidth="2"
        animate={{
          scaleX: talkPulse,
          scaleY: blinkScale,
          stroke: palette.line,
          filter: `drop-shadow(0 0 ${stateKey === 'talking' ? 18 : 10}px ${palette.glow})`
        }}
        transition={{ type: 'spring', stiffness: 360, damping: 24 }}
      />
      <motion.ellipse
        rx="18"
        ry="18"
        fill={palette.iris}
        animate={{
          scale: stateKey === 'talking' ? 0.82 + clamp01(volume) * 0.42 : stateKey === 'thinking' ? [0.72, 0.9, 0.72] : 0.82,
          opacity: phase === 'open' ? 0.95 : 0,
          fill: palette.iris
        }}
        transition={{ duration: 1.4, repeat: stateKey === 'thinking' ? Infinity : 0, ease: 'easeInOut' }}
        style={{ filter: `drop-shadow(0 0 16px ${palette.iris})` }}
      />
      <motion.circle
        r="5"
        cx="-5"
        cy="-6"
        fill="white"
        animate={{ opacity: phase === 'open' ? 0.85 : 0 }}
      />
      {phase === 'open' && (
        <g opacity={scanOpacity}>
          {[-16, -8, 0, 8, 16].map((y) => (
            <line key={y} x1="-30" x2="30" y1={y} y2={y} stroke={palette.line} strokeWidth="0.8" />
          ))}
        </g>
      )}
    </motion.g>
  );
}

function SignalRing({ index, palette, active }) {
  return (
    <motion.circle
      r={92 + index * 28}
      fill="none"
      stroke={palette.line}
      strokeWidth={index === 0 ? 1.4 : 0.9}
      strokeDasharray={index % 2 ? '8 14' : '2 10'}
      opacity={active ? 0.34 - index * 0.06 : 0.08}
      animate={{
        rotate: index % 2 ? -360 : 360,
        scale: active ? [1, 1.025, 1] : 1
      }}
      transition={{
        rotate: { duration: 24 + index * 8, repeat: Infinity, ease: 'linear' },
        scale: { duration: 3.4 + index * 0.4, repeat: Infinity, ease: 'easeInOut' }
      }}
      style={{ transformOrigin: 'center' }}
    />
  );
}

export function RobotFace({ volume = 0, isTalking, isListening, isThinking, isConnected }) {
  const [phase, setPhase] = useState('open');
  const frameRef = useRef(0);
  const stateKey = !isConnected ? 'offline' : isThinking ? 'thinking' : isTalking ? 'talking' : isListening ? 'listening' : 'idle';
  const palette = STATE_PALETTES[stateKey];
  const active = isConnected && stateKey !== 'offline';

  useEffect(() => {
    let timeout;
    const blink = () => {
      if (!isConnected || isThinking) {
        timeout = setTimeout(blink, 2400);
        return;
      }
      setPhase('closing');
      setTimeout(() => setPhase('closed'), 55);
      setTimeout(() => setPhase('open'), 145);
      timeout = setTimeout(blink, 2600 + Math.random() * 3600);
    };
    timeout = setTimeout(blink, 1600);
    return () => clearTimeout(timeout);
  }, [isConnected, isThinking]);

  const nodes = useMemo(() => Array.from({ length: 18 }).map((_, index) => {
    const angle = (Math.PI * 2 * index) / 18;
    const radius = index % 3 === 0 ? 170 : index % 2 === 0 ? 145 : 124;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, r: 1.5 + (index % 4) };
  }), []);

  return (
    <motion.div
      className="relative flex h-full w-full items-center justify-center pointer-events-none select-none"
      animate={{
        y: active ? [0, -8, 0] : 0,
        scale: active ? 1 : 0.94
      }}
      transition={{
        y: { duration: 5.8, repeat: Infinity, ease: 'easeInOut' },
        scale: { duration: 0.6, ease: 'easeOut' }
      }}
    >
      <svg width="560" height="500" viewBox="-280 -250 560 500" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="somaFaceShell" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
            <stop offset="42%" stopColor={palette.accent} />
            <stop offset="100%" stopColor="rgba(10,10,14,0.08)" />
          </radialGradient>
          <linearGradient id="somaFaceGlass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="52%" stopColor="rgba(24,24,27,0.64)" />
            <stop offset="100%" stopColor="rgba(8,8,12,0.9)" />
          </linearGradient>
          <filter id="softGlow">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <motion.g
          animate={{ rotate: active ? 360 : 0 }}
          transition={{ duration: 90, repeat: active ? Infinity : 0, ease: 'linear' }}
          style={{ transformOrigin: 'center' }}
        >
          {[0, 1, 2].map((index) => (
            <SignalRing key={index} index={index} palette={palette} active={active} />
          ))}
        </motion.g>

        <motion.g
          animate={{ opacity: active ? 0.7 : 0.24 }}
          transition={{ duration: 0.5 }}
        >
          {nodes.map((node, index) => (
            <g key={index}>
              <motion.circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={palette.line}
                animate={{ opacity: [0.24, 0.72, 0.24] }}
                transition={{ duration: 2.5 + index * 0.08, repeat: Infinity, ease: 'easeInOut' }}
              />
              {index % 2 === 0 && (
                <line x1={node.x * 0.72} y1={node.y * 0.72} x2={node.x} y2={node.y} stroke={palette.line} strokeWidth="0.6" opacity="0.25" />
              )}
            </g>
          ))}
        </motion.g>

        <motion.ellipse
          rx="178"
          ry="162"
          fill="url(#somaFaceShell)"
          stroke={palette.line}
          strokeWidth="1.5"
          animate={{
            stroke: palette.line,
            filter: `drop-shadow(0 0 ${active ? 50 : 18}px ${palette.glow})`
          }}
        />

        <motion.path
          d="M -152 -96 C -92 -154 92 -154 152 -96 C 190 -48 188 78 124 126 C 58 174 -58 174 -124 126 C -188 78 -190 -48 -152 -96 Z"
          fill="url(#somaFaceGlass)"
          stroke={palette.line}
          strokeWidth="2"
          animate={{
            stroke: palette.line,
            d: stateKey === 'talking'
              ? 'M -154 -98 C -92 -158 92 -158 154 -98 C 196 -44 192 84 124 132 C 54 178 -54 178 -124 132 C -192 84 -196 -44 -154 -98 Z'
              : 'M -152 -96 C -92 -154 92 -154 152 -96 C 190 -48 188 78 124 126 C 58 174 -58 174 -124 126 C -188 78 -190 -48 -152 -96 Z'
          }}
          transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        />

        <motion.path
          d="M -118 -112 C -58 -134 58 -134 118 -112"
          fill="none"
          stroke={palette.core}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.45"
          filter="url(#softGlow)"
        />

        <EyeLens side="left" palette={palette} stateKey={stateKey} phase={phase} volume={volume} />
        <EyeLens side="right" palette={palette} stateKey={stateKey} phase={phase} volume={volume} />

        <motion.g transform="translate(0, 66)">
          <motion.path
            d={stateKey === 'talking'
              ? `M -42 0 C -22 ${12 + clamp01(volume) * 32} 22 ${12 + clamp01(volume) * 32} 42 0`
              : stateKey === 'thinking'
                ? 'M -36 5 C -18 -4 18 14 36 2'
                : stateKey === 'listening'
                  ? 'M -22 0 C -8 12 8 12 22 0'
                  : 'M -34 0 C -16 16 16 16 34 0'}
            fill="none"
            stroke={palette.line}
            strokeWidth="5"
            strokeLinecap="round"
            animate={{ stroke: palette.line }}
            transition={{ type: 'spring', stiffness: 340, damping: 24 }}
            style={{ filter: `drop-shadow(0 0 12px ${palette.line})` }}
          />
          {stateKey === 'talking' && (
            <motion.ellipse
              cy="12"
              rx={18 + clamp01(volume) * 22}
              ry={4 + clamp01(volume) * 18}
              fill={palette.iris}
              opacity="0.22"
            />
          )}
        </motion.g>

        <motion.g animate={{ opacity: active ? 0.42 : 0.16 }}>
          <path d="M -172 -20 C -204 -4 -206 50 -176 72" fill="none" stroke={palette.line} strokeWidth="4" strokeLinecap="round" />
          <path d="M 172 -20 C 204 -4 206 50 176 72" fill="none" stroke={palette.line} strokeWidth="4" strokeLinecap="round" />
        </motion.g>

        <motion.g
          transform="translate(0, 180)"
          animate={{ opacity: active ? 0.8 : 0.35 }}
        >
          <rect x="-82" y="-14" width="164" height="28" rx="14" fill="rgba(0,0,0,0.34)" stroke={palette.line} strokeWidth="1" />
          <text x="0" y="4" textAnchor="middle" fill={palette.core} fontSize="10" fontFamily="monospace" letterSpacing="3">
            {palette.label.toUpperCase()}
          </text>
        </motion.g>
      </svg>
    </motion.div>
  );
}
