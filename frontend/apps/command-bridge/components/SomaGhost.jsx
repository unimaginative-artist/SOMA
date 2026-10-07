/**
 * SomaGhost — floating ghost orb that travels the screen while SOMA is working.
 *
 * States:
 *  orb   → eraser-tip pulsing dot, draggable, shows speech bubble on hover
 *  strip → small floating chat strip (auto when messages arrive, or click orb)
 *
 * Messages arrive via somaBackend 'ghost_message' events:
 *  { text, emotion? }
 *  emotion: 'thinking' | 'found' | 'searching' | 'done' | 'error' | null
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import somaBackend from '../somaBackend';

const EMOTION_COLORS = {
    thinking:  { orb: '#a855f7', glow: '#9333ea' },  // purple
    found:     { orb: '#22d3ee', glow: '#06b6d4' },  // cyan
    searching: { orb: '#f59e0b', glow: '#d97706' },  // amber
    done:      { orb: '#4ade80', glow: '#16a34a' },  // green
    error:     { orb: '#f87171', glow: '#dc2626' },  // red
    default:   { orb: '#818cf8', glow: '#6366f1' },  // indigo
};

const MAX_MESSAGES = 6;
const AUTO_STRIP_TIMEOUT = 8000; // expand to strip for 8s when a message arrives

export default function SomaGhost() {
    const [messages, setMessages]     = useState([]);
    const [mode, setMode]             = useState('orb');   // 'orb' | 'strip'
    const [emotion, setEmotion]       = useState('default');
    const [active, setActive]         = useState(false);   // received at least one message
    const [visible, setVisible]       = useState(false);   // show at all
    const [pos, setPos]               = useState({ x: window.innerWidth - 64, y: window.innerHeight - 120 });
    const dragging                    = useRef(false);
    const dragOffset                  = useRef({ x: 0, y: 0 });
    const stripTimer                  = useRef(null);
    const ghostRef                    = useRef(null);

    const colors = EMOTION_COLORS[emotion] || EMOTION_COLORS.default;

    // ── Receive messages from SOMA ────────────────────────────────────────────
    useEffect(() => {
        const handler = ({ text, emotion: emo }) => {
            if (!text) return;
            const timestamp = Date.now();
            setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), { text, timestamp }]);
            setEmotion(emo || 'thinking');
            setActive(true);
            setVisible(true);

            // Auto-expand to strip, then collapse back to orb
            setMode('strip');
            if (stripTimer.current) clearTimeout(stripTimer.current);
            stripTimer.current = setTimeout(() => setMode('orb'), AUTO_STRIP_TIMEOUT);
        };

        somaBackend.on('ghost_message', handler);
        return () => {
            somaBackend.off('ghost_message', handler);
            if (stripTimer.current) clearTimeout(stripTimer.current);
        };
    }, []);

    // ── Drag logic ────────────────────────────────────────────────────────────
    const onMouseDown = useCallback((e) => {
        e.preventDefault();
        dragging.current = true;
        dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };

        const onMove = (mv) => {
            if (!dragging.current) return;
            const nx = Math.max(8, Math.min(window.innerWidth - 8, mv.clientX - dragOffset.current.x));
            const ny = Math.max(8, Math.min(window.innerHeight - 8, mv.clientY - dragOffset.current.y));
            setPos({ x: nx, y: ny });
        };
        const onUp = () => {
            dragging.current = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [pos]);

    const handleOrbClick = useCallback(() => {
        if (dragging.current) return;
        if (!active) return;
        setMode(m => m === 'strip' ? 'orb' : 'strip');
        if (stripTimer.current) clearTimeout(stripTimer.current);
        if (mode === 'orb') {
            stripTimer.current = setTimeout(() => setMode('orb'), AUTO_STRIP_TIMEOUT);
        }
    }, [active, mode]);

    const dismiss = useCallback(() => {
        setMode('orb');
        setVisible(false);
        setActive(false);
        setMessages([]);
    }, []);

    if (!visible) return null;

    const lastMsg = messages[messages.length - 1];

    return (
        <div
            style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                zIndex: 9999,
                transform: 'translate(-50%, -50%)',
                userSelect: 'none',
                pointerEvents: 'auto',
            }}
            ref={ghostRef}
        >
            <AnimatePresence mode="wait">
                {mode === 'orb' ? (
                    /* ── ORB MODE: eraser-tip floating dot ─── */
                    <motion.div
                        key="orb"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ duration: 0.25, type: 'spring', bounce: 0.5 }}
                        className="group relative"
                        onMouseDown={onMouseDown}
                        onClick={handleOrbClick}
                        style={{ cursor: dragging.current ? 'grabbing' : 'grab' }}
                    >
                        {/* Core orb */}
                        <motion.div
                            animate={{
                                scale: [1, 1.18, 1],
                                boxShadow: [
                                    `0 0 8px 3px ${colors.glow}60`,
                                    `0 0 16px 6px ${colors.glow}90`,
                                    `0 0 8px 3px ${colors.glow}60`,
                                ]
                            }}
                            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                            style={{
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                background: `radial-gradient(circle at 35% 35%, #fff4, ${colors.orb})`,
                                border: `1px solid ${colors.orb}99`,
                            }}
                        />

                        {/* Hover tooltip — last message */}
                        {lastMsg && (
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap">
                                <div
                                    className="text-[10px] leading-tight px-2 py-1 rounded-lg text-white max-w-[220px] truncate"
                                    style={{
                                        background: '#0e0e12ee',
                                        border: `1px solid ${colors.orb}55`,
                                        boxShadow: `0 0 8px ${colors.glow}33`,
                                    }}
                                >
                                    {lastMsg.text}
                                </div>
                                <div className="w-0 h-0 mx-auto"
                                    style={{ borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `4px solid ${colors.orb}55` }}
                                />
                            </div>
                        )}
                    </motion.div>
                ) : (
                    /* ── STRIP MODE: small floating chat window ─── */
                    <motion.div
                        key="strip"
                        initial={{ scale: 0.6, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.6, opacity: 0, y: 10 }}
                        transition={{ duration: 0.2, type: 'spring', bounce: 0.3 }}
                        style={{
                            width: 240,
                            background: '#0b0b10f0',
                            border: `1px solid ${colors.orb}44`,
                            borderRadius: 12,
                            boxShadow: `0 4px 24px ${colors.glow}30, 0 0 0 1px ${colors.orb}22`,
                            backdropFilter: 'blur(12px)',
                        }}
                    >
                        {/* Drag handle / header */}
                        <div
                            className="flex items-center justify-between px-3 py-2 cursor-grab"
                            onMouseDown={onMouseDown}
                            style={{ borderBottom: `1px solid ${colors.orb}22` }}
                        >
                            <div className="flex items-center gap-2">
                                <motion.div
                                    animate={{ scale: [1, 1.25, 1] }}
                                    transition={{ duration: 1.4, repeat: Infinity }}
                                    style={{
                                        width: 6, height: 6, borderRadius: '50%',
                                        background: colors.orb,
                                        boxShadow: `0 0 6px ${colors.glow}`,
                                    }}
                                />
                                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: colors.orb }}>
                                    SOMA
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => { setMode('orb'); if (stripTimer.current) clearTimeout(stripTimer.current); }}
                                    className="text-zinc-600 hover:text-zinc-300 text-[10px] px-1 transition-colors"
                                    title="Collapse to orb"
                                >−</button>
                                <button
                                    onClick={dismiss}
                                    className="text-zinc-600 hover:text-red-400 text-[10px] px-1 transition-colors"
                                    title="Dismiss"
                                >×</button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="px-3 py-2 space-y-1.5 max-h-[160px] overflow-y-auto">
                            {messages.slice(-4).map((m, i) => (
                                <div
                                    key={m.timestamp}
                                    className="text-[11px] leading-relaxed"
                                    style={{
                                        color: i === messages.length - 1 ? '#e4e4e7' : '#71717a',
                                        opacity: i === messages.length - 1 ? 1 : 0.6,
                                    }}
                                >
                                    {m.text}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
