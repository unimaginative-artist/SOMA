import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    Hash, Eye, Archive, Lock, Plus, Settings, Send, Search,
    Users, UserPlus, Copy, Check, X, Trash2,
    LogOut, Smile, RefreshCw, Shield, Pencil, BookOpen, Home,
    MessageSquare, Globe2, Circle, Briefcase, ChevronRight, CheckSquare,
    AtSign, MessageCircle, Heart, Sparkles, Code2, BarChart3,
    ClipboardList, FlaskConical, PenTool,
} from 'lucide-react';
import { AxisProvider, useAxis, AXIS_COLORS } from './AxisContext';
import { TaskWindowModal } from './TaskWindow';
import somaBackend from '../../somaBackend';
import './AxisVoid.css';
import AxisHomePanel from './AxisHomePanel';
import AxisWorkspaceView from './AxisWorkspaceView';
import * as AxisAudio from './utils/AxisAudio';

/* ── Void emoji data ─────────────────────────────────────────────────────── */
const VOID_EMOJI = {
    Recent:   [],
    Smileys:  ['😀','😂','😍','🥹','😎','🤔','😅','🙄','😭','😤','🤯','🥳','😴','🤗','😬'],
    Gestures: ['👍','👎','👋','🤝','🙏','👏','🤜','✌️','🤞','🫶','💪','🫵','👌','🤌'],
    Objects:  ['⚡','🔒','🔑','💡','🔥','✅','❌','⚠️','📌','🎯','🚀','💎','🧠','📎'],
    Symbols:  ['❤️','🧡','💛','💚','💙','💜','🖤','⭐','💫','✨','💥','❓','‼️','💯'],
};

const AVATAR_HEX = {
    blue:    '#6366f1', emerald: '#34d399', violet: '#a78bfa',
    amber:   '#fbbf24', rose:    '#fb7185', cyan:   '#22d3ee',
    orange:  '#fb923c', fuchsia: '#e879f9',
};

// ── Color utilities ──────────────────────────────────────────────────────────
const COLOR = {
    blue:    { text: 'text-blue-400',    bg: 'bg-blue-500/15',    ring: 'ring-blue-500/40',    dot: 'bg-blue-400'    },
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/40', dot: 'bg-emerald-400' },
    violet:  { text: 'text-violet-400',  bg: 'bg-violet-500/15',  ring: 'ring-violet-500/40',  dot: 'bg-violet-400'  },
    amber:   { text: 'text-amber-400',   bg: 'bg-amber-500/15',   ring: 'ring-amber-500/40',   dot: 'bg-amber-400'   },
    rose:    { text: 'text-rose-400',    bg: 'bg-rose-500/15',    ring: 'ring-rose-500/40',    dot: 'bg-rose-400'    },
    cyan:    { text: 'text-cyan-400',    bg: 'bg-cyan-500/15',    ring: 'ring-cyan-500/40',    dot: 'bg-cyan-400'    },
    orange:  { text: 'text-orange-400',  bg: 'bg-orange-500/15',  ring: 'ring-orange-500/40',  dot: 'bg-orange-400'  },
    fuchsia: { text: 'text-fuchsia-400', bg: 'bg-fuchsia-500/15', ring: 'ring-fuchsia-500/40', dot: 'bg-fuchsia-400' },
};
const c = (color, key) => COLOR[color]?.[key] || COLOR.blue[key];

const CHANNEL_TYPE_ICON = { text: Hash, ephemeral: Eye, archive: Archive, system: Shield, dm: Send, thread: MessageCircle };
const QUICK_EMOJIS     = ['👍','❤️','😂','🔥','👀','✅'];
const GOSSIP_STEPS     = [0, 60_000, 300_000, 1_800_000];
const GOSSIP_LABELS    = ['', '1m', '5m', '30m'];

const channelLabel = (channel) => {
    if (!channel) return 'channel';
    if (channel.type === 'dm') {
        const match = String(channel.description || '').match(/^Direct with\s+(.+)$/i);
        return match?.[1] || 'Direct';
    }
    return channel.name || 'channel';
};

const WorkspaceGlyph = ({ active = false, size = 18 }) => (
    <MessageSquare
        style={{ width: size, height: size, color: active ? '#c4b5fd' : '#71717a' }}
        strokeWidth={active ? 2.2 : 1.7}
    />
);

const WORKSPACE_ICON_COMPONENTS = {
    engineering: Code2,
    finance: BarChart3,
    operations: ClipboardList,
    science: FlaskConical,
    creative: PenTool,
    workspace: Briefcase,
    message: MessageSquare,
};

function WorkspaceTypeIcon({ icon, active = false, size = 16, className = '' }) {
    const key = String(icon || '').toLowerCase();
    const Icon = WORKSPACE_ICON_COMPONENTS[key];
    if (Icon) {
        return (
            <Icon
                className={className}
                style={{ width: size, height: size, color: active ? '#c4b5fd' : '#71717a' }}
                strokeWidth={active ? 2.2 : 1.7}
            />
        );
    }
    if (icon && icon.length <= 3) {
        return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>;
    }
    return <WorkspaceGlyph active={active} size={size} />;
}


// ── Soma Dot ──────────────────────────────────────────────────────────────────
function SomaDot({ size = 6, anim = false }) {
    return (
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            {anim && (
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#a78bfa', animation: 'ax-ping 1.8s ease-out infinite', opacity: 0.4 }} />
            )}
            <div style={{ width: size, height: size, borderRadius: '50%', background: '#a78bfa', animation: anim ? 'ax-pulse 2s ease-in-out infinite' : 'none', boxShadow: anim ? '0 0 8px rgba(167,139,250,0.5)' : 'none' }} />
        </div>
    );
}

// ── Whisper Ring ──────────────────────────────────────────────────────────────
function WhisperRing({ durMs, startAt }) {
    const [, tick] = useState(0);
    useEffect(() => {
        if (!startAt) return;
        const id = setInterval(() => tick(t => t + 1), 150);
        return () => clearInterval(id);
    }, [startAt]);
    const rem   = startAt ? Math.max(0, durMs - (Date.now() - startAt)) : durMs;
    const secs  = Math.ceil(rem / 1000);
    const r     = 12;
    const circ  = 2 * Math.PI * r;
    const off   = circ * (1 - rem / durMs);
    return (
        <div style={{ position: 'relative', width: 30, height: 30, flexShrink: 0 }}>
            <svg width={30} height={30} style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={15} cy={15} r={r} stroke="rgba(255,255,255,0.05)" strokeWidth={2} fill="none" />
                <circle cx={15} cy={15} r={r} stroke="#475569" strokeWidth={2} fill="none"
                    strokeDasharray={circ} strokeDashoffset={off}
                    style={{ transition: 'stroke-dashoffset 0.15s linear' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Geist Mono', monospace", fontSize: 8, color: '#475569', fontWeight: 500 }}>
                {secs}s
            </div>
        </div>
    );
}

// ── Emoji Picker Panel ────────────────────────────────────────────────────────
function EmojiPickerPanel({ onSelect, recentEmoji = [], onClose, placement = 'top' }) {
    const [search, setSearch] = useState('');
    const [cat, setCat]       = useState('Smileys');
    const ref = useRef(null);

    useEffect(() => {
        const hClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
        const hKey   = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', hClick);
        document.addEventListener('keydown',   hKey);
        return () => {
            document.removeEventListener('mousedown', hClick);
            document.removeEventListener('keydown',   hKey);
        };
    }, [onClose]);

    const allFlat   = Object.values(VOID_EMOJI).flat();
    const withRecent = { ...VOID_EMOJI, Recent: recentEmoji };
    const display   = search
        ? allFlat.filter(e => e.includes(search))
        : cat === 'Recent' ? (recentEmoji.length ? recentEmoji : VOID_EMOJI.Smileys)
        : (withRecent[cat] || []);

    const pos = placement === 'top'
        ? { bottom: 'calc(100% + 8px)', left: 0 }
        : { top: 'calc(100% + 8px)', left: 0 };

    return (
        <div ref={ref} style={{
            position: 'absolute', ...pos, zIndex: 400,
            background: '#111318', border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: 12, width: 280, boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
            animation: 'ax-appear 0.15s ease', overflow: 'hidden',
        }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search emoji…"
                    style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '5px 10px', fontSize: 11, color: '#e8eaf0', outline: 'none', fontFamily: 'inherit' }} />
            </div>
            {!search && (
                <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto', padding: '0 6px' }}>
                    {Object.keys(withRecent).map(c => (
                        <button key={c} onClick={() => setCat(c)} style={{
                            padding: '5px 8px', background: 'none', border: 'none',
                            fontSize: 9, fontFamily: "'Geist Mono', monospace", letterSpacing: '0.06em',
                            color: cat === c ? '#818cf8' : '#2d3142',
                            borderBottom: `2px solid ${cat === c ? '#6366f1' : 'transparent'}`,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>{c.toUpperCase()}</button>
                    ))}
                </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 2, padding: 8, maxHeight: 200, overflowY: 'auto' }}>
                {display.map((e, i) => (
                    <button key={i} onClick={() => onSelect(e)}
                        style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', padding: 3, borderRadius: 4, lineHeight: 1.2 }}
                        onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={ev => ev.currentTarget.style.background = 'none'}
                    >{e}</button>
                ))}
                {display.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 16, fontSize: 11, color: '#2d3142', fontFamily: "'Geist Mono', monospace" }}>
                        no results
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Context Pane ──────────────────────────────────────────────────────────────
function ContextPane({ open, channel, onSomaAsk }) {
    const { searchMessages, setActiveChannelId, channels, activeWorkspaceId } = useAxis();
    const [refreshing, setRefreshing] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [busy, setBusy] = useState(false);
    const debounceRef = useRef(null);

    const handleAsk = () => {
        setRefreshing(true);
        onSomaAsk?.();
        setTimeout(() => setRefreshing(false), 5000);
    };

    const runSearch = useCallback(async (value) => {
        if (!value.trim()) {
            setResults([]);
            setBusy(false);
            return;
        }
        setBusy(true);
        const found = await searchMessages(value, { workspaceId: activeWorkspaceId, limit: 24 });
        setResults(found);
        setBusy(false);
    }, [searchMessages, activeWorkspaceId]);

    const handleQuery = (value) => {
        setQuery(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(value), 240);
    };

    const jumpToResult = (result) => {
        const pending = { channelId: result.channel_id, messageId: result.id };
        localStorage.setItem('axis:pending-message', JSON.stringify(pending));
        setActiveChannelId(result.channel_id);
        window.dispatchEvent(new CustomEvent('axis:jump-message', { detail: pending }));
    };

    const getChannelName = (id) => {
        const ch = channels.find(item => item.id === id);
        return ch ? channelLabel(ch) : id;
    };

    return (
        <div className="ax-ctx-slide" style={{
            width: open ? 256 : 0, background: '#0d0f13',
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            overflow: 'hidden', transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
            flexShrink: 0, display: 'flex', flexDirection: 'column',
        }}>
            <div style={{ width: 256, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '12px 14px 9px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#e8eaf0' }}>Search</span>
                        <button onClick={handleAsk} style={{
                            background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                            color: refreshing ? '#a78bfa' : '#2d3142', fontSize: 9, fontFamily: "'Geist Mono', monospace",
                            padding: '2px 5px', borderRadius: 4, transition: 'color 0.15s',
                            animation: refreshing ? 'ax-pulse 1s ease-in-out infinite' : 'none',
                        }}>
                            <SomaDot anim={refreshing} size={5} />
                            {refreshing ? 'thinking…' : 'ask soma'}
                        </button>
                    </div>
                    <p style={{ fontSize: 9, color: '#2d3142', marginTop: 3, fontFamily: "'Geist Mono', monospace" }}>
                        {channel?.type === 'dm' ? 'direct' : `#${channelLabel(channel)}`} · message index
                    </p>
                </div>
                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <CtxBlock label="Find Messages">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '7px 9px' }}>
                            <Search className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                            <input
                                value={query}
                                onChange={e => handleQuery(e.target.value)}
                                placeholder="Search this workspace..."
                                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#e4e4e7', fontSize: 11 }}
                            />
                            {busy && <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #3f3f46', borderTopColor: '#a1a1aa', animation: 'spin 0.7s linear infinite' }} />}
                        </div>
                    </CtxBlock>

                    <CtxBlock label={query ? `${results.length} Result${results.length === 1 ? '' : 's'}` : 'Results'}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {!query && (
                                <div style={{ fontSize: 10, color: '#52525b', lineHeight: 1.55 }}>
                                    Search any word or phrase. Results can come from any channel in this workspace.
                                </div>
                            )}
                            {query && !busy && results.length === 0 && (
                                <div style={{ fontSize: 10, color: '#52525b', lineHeight: 1.55 }}>No matching messages.</div>
                            )}
                            {results.map(result => (
                                <button
                                    key={result.id}
                                    onClick={() => jumpToResult(result)}
                                    style={{ width: '100%', textAlign: 'left', padding: '8px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.055)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                        <span style={{ fontSize: 9, color: '#818cf8', fontFamily: "'Geist Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getChannelName(result.channel_id)}</span>
                                        <span style={{ marginLeft: 'auto', fontSize: 8, color: '#3f3f46', fontFamily: "'Geist Mono', monospace" }}>{new Date(result.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                                    </div>
                                    <div style={{ fontSize: 10.5, color: '#a1a1aa', lineHeight: 1.45 }}>{renderSnippet(result.snippet || result.content)}</div>
                                </button>
                            ))}
                        </div>
                    </CtxBlock>

                    {channel && (
                        <CtxBlock label="Channel">
                            <div style={{ fontSize: 10, color: '#818cf8', fontFamily: "'Geist Mono', monospace", padding: '3px 8px', background: 'rgba(99,102,241,0.1)', borderRadius: 4, border: '1px solid rgba(99,102,241,0.2)', display: 'inline-block', marginBottom: 5 }}>
                                {channel.type?.toUpperCase() || 'TEXT'}
                            </div>
                            {channel.description && (
                                <p style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.5, marginTop: 4 }}>{channel.description}</p>
                            )}
                        </CtxBlock>
                    )}
                </div>
            </div>
        </div>
    );
}

function CtxBlock({ label, children }) {
    return (
        <div>
            <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2d3142', fontFamily: "'Geist Mono', monospace", marginBottom: 6 }}>
                {label}
            </div>
            {children}
        </div>
    );
}

// ── Profile Modal ─────────────────────────────────────────────────────────────
function ProfileModal({ memberId, isSelf, onClose, onStartMessage }) {
    const { user, members, findOrCreateDM } = useAxis();
    const [dmBusy, setDmBusy] = useState(false);

    const member    = isSelf ? null : members.find(m => m.user_id === memberId);
    const name      = isSelf ? (user?.name || 'You') : (member?.user_name || 'Unknown');
    const colorKey  = isSelf ? (user?.color || 'blue') : (member?.user_color || 'blue');
    const avatarSrc = isSelf ? user?.avatar : null;
    const avatarHex = AVATAR_HEX[colorKey] || '#6366f1';
    const initial   = memberId === 'soma' ? 'S' : name[0]?.toUpperCase() || '?';
    const handle    = `@${name.toLowerCase().replace(/\s+/g, '')}`;

    // Studio fields — only available for self
    const role      = isSelf ? user?.role     : null;
    const bio       = isSelf ? user?.bio      : null;
    const location  = isSelf ? user?.location : null;
    const timezone  = isSelf ? user?.timezone : null;

    const [localTime, setLocalTime] = useState('');
    useEffect(() => {
        const tick = () => setLocalTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }));
        tick();
        const id = setInterval(tick, 15000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    const identity = {
        id: isSelf ? (user?.id || 'self') : memberId,
        name,
        handle,
        avatar: avatarSrc || '',
        role: role || (isSelf ? 'Studio identity' : 'Axis member'),
        tagline: bio || (isSelf ? 'Identity synced from Studio.' : 'Axis contact'),
        status: 'online',
        location,
        source: isSelf ? 'studio' : 'axis',
        isSelf,
        recentActivity: isSelf ? 'Active in Axis' : 'Seen in this channel',
        mutualSpaces: ['Axis', 'Studio', 'Directs'],
        accentColor: avatarHex,
        badge: isSelf ? 'You' : 'Contact',
        cardStyle: 'glass',
    };

    const goToStudio = () => {
        window.dispatchEvent(new CustomEvent('soma:nav', { detail: { module: 'studio' } }));
        const detail = {
            view: isSelf ? 'profile' : 'studio-space',
            context: { identity },
        };
        window.dispatchEvent(new CustomEvent('app:navigate', { detail }));
        window.dispatchEvent(new CustomEvent('studio:navigate', { detail }));
        onClose();
    };

    const openDirect = async () => {
        if (isSelf || dmBusy) return;
        setDmBusy(true);
        await findOrCreateDM(memberId, name, member?.user_color || 'violet');
        setDmBusy(false);
        onStartMessage?.(memberId);
        onClose();
    };

    const metaItems = [
        role || (isSelf ? 'Studio identity' : 'Axis contact'),
        location,
        timezone,
    ].filter(Boolean);

    return (
        <div onClick={e => e.target === e.currentTarget && onClose()} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(14px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 500, padding: 20,
        }}>
            <div className="ax-modal-enter" style={{
                width: 390, maxWidth: '100%', maxHeight: '88vh',
                background: 'linear-gradient(180deg, rgba(20,20,24,0.98), rgba(9,9,12,0.98))',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 24, boxShadow: `0 34px 110px rgba(0,0,0,0.72), 0 0 70px ${avatarHex}18`,
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
                <div style={{ position: 'relative', minHeight: 136, padding: 18, background: `radial-gradient(circle at 20% 10%, ${avatarHex}4d, transparent 42%), radial-gradient(circle at 78% 4%, rgba(34,211,238,0.16), transparent 34%), linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.01))` }}>
                    <button
                        onClick={onClose}
                        title="Close"
                        style={{ position: 'absolute', right: 14, top: 14, width: 30, height: 30, borderRadius: 999, background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.58)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <X className="w-4 h-4" />
                    </button>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginTop: 20 }}>
                        <div style={{ width: 88, height: 88, borderRadius: 26, border: '1px solid rgba(255,255,255,0.18)', background: '#060608', padding: 4, boxShadow: '0 22px 70px rgba(0,0,0,0.5)', position: 'relative', flexShrink: 0 }}>
                            {avatarSrc ? (
                                <img src={avatarSrc} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 21 }} />
                            ) : (
                                <div style={{ width: '100%', height: '100%', borderRadius: 21, background: `linear-gradient(135deg, ${avatarHex}33, rgba(255,255,255,0.05))`, color: avatarHex, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 25, fontWeight: 900 }}>
                                    {initial}
                                </div>
                            )}
                            <span style={{ position: 'absolute', right: 5, bottom: 5, width: 14, height: 14, borderRadius: 999, background: '#34d399', border: '3px solid #060608', boxShadow: '0 0 12px rgba(52,211,153,.62)' }} />
                        </div>
                        <div style={{ minWidth: 0, paddingBottom: 5 }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${avatarHex}55`, background: `${avatarHex}18`, color: 'rgba(255,255,255,0.76)', borderRadius: 999, padding: '4px 9px', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
                                <span style={{ width: 6, height: 6, borderRadius: 999, background: avatarHex }} />
                                {isSelf ? 'Your identity' : 'Axis contact'}
                            </div>
                            <h2 style={{ fontSize: 23, lineHeight: 1.05, fontWeight: 900, color: '#fff', letterSpacing: '-0.035em', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</h2>
                            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.48)', margin: '5px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{handle}</p>
                        </div>
                    </div>
                </div>

                <div style={{ padding: 18, overflowY: 'auto' }}>
                    <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)', borderRadius: 18, padding: 14 }}>
                        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.55, margin: 0 }}>
                            {bio || (isSelf ? 'Your Studio profile follows you through Axis, Directs, communities, and the wider Command Bridge.' : 'A shared Axis contact. Directs and Studio space use the same identity anchor.')}
                        </p>
                        {metaItems.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                                {metaItems.map(item => (
                                    <span key={item} style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)', borderRadius: 999, padding: '5px 8px', color: 'rgba(255,255,255,0.48)', fontSize: 10, fontWeight: 700 }}>
                                        {item}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                        {[
                            ['Axis', 'active'],
                            ['Studio', isSelf ? 'profile' : 'space'],
                            ['Directs', isSelf ? 'hub' : 'thread'],
                        ].map(([label, sub]) => (
                            <div key={label} style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)', borderRadius: 14, padding: '10px 8px', minWidth: 0 }}>
                                <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                                <div style={{ color: 'rgba(255,255,255,0.34)', fontSize: 10, marginTop: 3 }}>{sub}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: '11px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.66)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: '#34d399', boxShadow: '0 0 10px rgba(52,211,153,.7)' }} />
                            Online
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>
                            {localTime}
                        </div>
                    </div>

                    <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                        <button onClick={goToStudio} style={{ flex: 1, border: 'none', borderRadius: 15, padding: '12px 14px', background: '#fff', color: '#000', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
                            {isSelf ? 'Edit Studio Profile' : 'Open Studio Space'}
                        </button>
                        {!isSelf && (
                        <button
                            disabled={dmBusy}
                            onClick={openDirect}
                            style={{ border: 'none', borderRadius: 15, padding: '12px 14px', background: dmBusy ? '#4f46e5' : '#2563eb', color: '#fff', fontSize: 12, fontWeight: 900, cursor: dmBusy ? 'not-allowed' : 'pointer', opacity: dmBusy ? 0.7 : 1 }}
                        >
                            {dmBusy ? 'Opening…' : 'Direct'}
                        </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Start Direct Modal ───────────────────────────────────────────────────────
function StartDirectModal({ onClose }) {
    const { findOrCreateDM, hdrs } = useAxis();
    const [friends, setFriends] = useState([]);
    const [query, setQuery] = useState('');
    const [busyId, setBusyId] = useState(null);

    useEffect(() => {
        const load = async () => {
            const contacts = [];
            const seen = new Set();
            try {
                const d = await fetch('/api/axis/contacts', { headers: hdrs() }).then(r => r.json());
                for (const c of (d?.contacts || [])) {
                    if (!seen.has(c.id)) { seen.add(c.id); contacts.push({ id: c.id, name: c.name, color: c.color }); }
                }
            } catch {}
            try {
                const d = await fetch('/api/studio/axis').then(r => r.json());
                for (const f of (d?.axis?.friends || d?.friends || [])) {
                    const id = f.id || f.title;
                    if (id && !seen.has(id)) { seen.add(id); contacts.push(f); }
                }
            } catch {}
            setFriends(contacts);
        };
        load();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    const normalized = query.trim();
    const filtered = friends.filter(friend => {
        const text = `${friend.name || friend.title || ''} ${friend.id || ''}`.toLowerCase();
        return !normalized || text.includes(normalized.toLowerCase());
    });

    const openDirect = async (target) => {
        const targetId = target.id || `direct-${String(target.title || target.name || normalized).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const targetName = target.title || target.name || normalized || targetId;
        if (!targetName || busyId) return;
        setBusyId(targetId);
        await findOrCreateDM(targetId, targetName, target.color || 'violet');
        setBusyId(null);
        onClose();
    };

    return (
        <div onClick={e => e.target === e.currentTarget && onClose()} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.76)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 520, padding: 20,
        }}>
            <div className="ax-modal-enter" style={{
                width: 420, maxWidth: '100%', maxHeight: '82vh', overflow: 'hidden',
                background: '#111318', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16,
                boxShadow: '0 36px 90px rgba(0,0,0,0.68)', display: 'flex', flexDirection: 'column',
            }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#f4f4f5' }}>Start Direct</h2>
                        <p style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>Open a private persistent thread from your Studio contacts.</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', padding: 6 }}>
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '9px 11px' }}>
                        <Search className="w-3.5 h-3.5 text-zinc-600" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search contacts or type a handle"
                            autoFocus
                            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e4e4e7', fontSize: 13 }}
                        />
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
                    {filtered.map(friend => {
                        const id = friend.id || friend.title;
                        const name = friend.name || friend.title || id;
                        return (
                            <button key={id} onClick={() => openDirect(friend)}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, border: '1px solid transparent', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.045)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                            >
                                <div style={{ width: 36, height: 36, borderRadius: 10, overflow: 'hidden', background: 'rgba(99,102,241,0.14)', flexShrink: 0 }}>
                                    {friend.image || friend.avatar
                                        ? <img src={friend.image || friend.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>{(name[0] || '?').toUpperCase()}</div>
                                    }
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, color: '#e4e4e7', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                                    <div style={{ fontSize: 10, color: '#52525b', marginTop: 1 }}>{friend.online ? 'Online' : friend.messagesCount || 'Axis contact'}</div>
                                </div>
                                <span style={{ fontSize: 10, color: busyId === id ? '#a78bfa' : '#52525b', fontFamily: "'Geist Mono', monospace" }}>
                                    {busyId === id ? 'OPENING' : 'DIRECT'}
                                </span>
                            </button>
                        );
                    })}

                    {normalized && filtered.length === 0 && (
                        <button onClick={() => openDirect({ id: normalized, title: normalized })}
                            style={{ width: '100%', marginTop: 4, padding: '11px 12px', borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)', color: '#c4b5fd', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
                            Start Direct with “{normalized}”
                        </button>
                    )}

                    {!normalized && filtered.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '26px 12px', color: '#52525b', fontSize: 12 }}>No contacts yet — once others join your Axis channels they'll appear here.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Space Settings Modal (Discord-style) ─────────────────────────────────────
const SPACE_ICONS = ['💬','🌐','🚀','⚡','🔥','🎯','🎮','🎨','📡','🔬','💡','🛠️','📊','🏢','🌿','✨'];
function SpaceSettingsModal({ workspace, onClose }) {
    const { updateWorkspace, updateChannel, deleteWorkspace, leaveCommunity, deleteCommunity, setActiveWorkspaceId, channels, user, members, loadMembers } = useAxis();
    const isCommunity = workspace?.type === 'community';
    const isOwner     = workspace?.created_by === user?.id || workspace?.created_by === 'system';

    const [tab, setTab]               = useState('overview');
    const [name, setName]             = useState(workspace?.name || '');
    const [desc, setDesc]             = useState(workspace?.description || '');
    const [icon, setIcon]             = useState(workspace?.icon || '💬');
    const [avatarUrl, setAvatarUrl]   = useState(workspace?.avatar_url || '');
    const [isPublic, setIsPublic]     = useState(workspace?.is_public !== 0);
    const [busy, setBusy]             = useState(false);
    const [saved, setSaved]           = useState(false);
    const [editingChIcon, setEditingChIcon] = useState(null);
    const [chIconInput, setChIconInput]     = useState('');
    const [confirmDelete, setConfirmDelete]     = useState(false);
    const [confirmInput, setConfirmInput]       = useState('');

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    const spaceChannels = channels.filter(c => c.workspace_id === workspace?.id || c.workspace_id === undefined);

    const handleSave = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        await updateWorkspace(workspace.id, { name: name.trim(), icon, description: desc.trim(), is_public: isPublic, avatar_url: avatarUrl.trim() || null });
        setBusy(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
    };

    const handleDelete = async () => {
        if (isCommunity && isOwner && workspace.community_id) {
            await deleteCommunity(workspace.community_id);
        }
        await deleteWorkspace(workspace.id);
        setActiveWorkspaceId(null);
        onClose();
    };

    const handleLeave = async () => {
        if (isCommunity && workspace.community_id) {
            await leaveCommunity(workspace.community_id);
        }
        await deleteWorkspace(workspace.id);
        setActiveWorkspaceId(null);
        onClose();
    };

    const dangerLabel = isCommunity
        ? (isOwner ? 'Delete Community' : 'Leave Community')
        : (isOwner ? 'Delete Workspace' : 'Remove from Sidebar');

    const SIDEBAR = [
        { id: 'overview',     label: 'Overview',     group: 'General' },
        { id: 'channels',     label: 'Channels',     group: 'General' },
        ...(isCommunity ? [{ id: 'permissions', label: 'Permissions', group: 'Community' }] : []),
        { id: 'members',      label: 'Members',      group: 'Administration' },
        { id: 'invites',      label: 'Invites',      group: 'Administration' },
        { id: 'danger',       label: dangerLabel,    group: 'Danger Zone', danger: true },
    ];

    const groups = [...new Set(SIDEBAR.map(s => s.group))];

    const FieldLabel = ({ children }) => (
        <p style={{ fontSize: 10, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{children}</p>
    );

    const inputStyle = { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#e8eaf0', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.15s' };

    return (
        <div onClick={e => e.target === e.currentTarget && onClose()} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600, padding: 24,
        }}>
            <div className="ax-modal-enter" style={{
                width: '100%', maxWidth: 820, height: '80vh',
                background: '#111318', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 16, boxShadow: '0 48px 120px rgba(0,0,0,0.8)',
                display: 'flex', overflow: 'hidden',
            }}>
                {/* Sidebar */}
                <div style={{ width: 220, background: '#0d0f13', borderRight: '1px solid rgba(255,255,255,0.06)', padding: '20px 8px', overflowY: 'auto', flexShrink: 0 }}>
                    <div style={{ padding: '0 8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 12 }}>
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf0', lineHeight: 1.2 }}>{name || workspace?.name}</div>
                        <div style={{ fontSize: 10, color: '#3f3f46', marginTop: 2 }}>{isCommunity ? 'Community' : 'Workspace'}</div>
                    </div>
                    {groups.map(group => (
                        <div key={group} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.12em', padding: '4px 10px', marginBottom: 2 }}>{group}</div>
                            {SIDEBAR.filter(s => s.group === group).map(item => (
                                <button key={item.id} onClick={() => setTab(item.id)} style={{
                                    width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 6,
                                    background: tab === item.id ? 'rgba(99,102,241,0.12)' : 'none',
                                    border: 'none', cursor: 'pointer', fontSize: 13,
                                    color: item.danger ? (tab === item.id ? '#ef4444' : '#7f1d1d') : (tab === item.id ? '#c7d2fe' : '#6b7280'),
                                    fontWeight: tab === item.id ? 600 : 400, transition: 'all 0.1s',
                                }}
                                    onMouseEnter={e => { if (tab !== item.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = item.danger ? '#ef4444' : '#a1a1aa'; }}
                                    onMouseLeave={e => { if (tab !== item.id) { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = item.danger ? '#7f1d1d' : '#6b7280'; } }}
                                >{item.label}</button>
                            ))}
                        </div>
                    ))}
                </div>

                {/* Content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    {/* Header */}
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#e8eaf0', margin: 0, textTransform: 'capitalize' }}>
                            {tab === 'danger' ? dangerLabel : tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </h2>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 4 }}>
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

                        {tab === 'overview' && (
                            <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 18 }}>
                                {/* Avatar preview + photo URL */}
                                <div>
                                    <FieldLabel>Profile Photo</FieldLabel>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                        <div style={{ width: 56, height: 56, borderRadius: 14, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
                                            {avatarUrl
                                                ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setAvatarUrl('')} />
                                                : <span>{icon || '💬'}</span>
                                            }
                                        </div>
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            <input
                                                value={avatarUrl}
                                                onChange={e => setAvatarUrl(e.target.value)}
                                                placeholder="Paste image URL (optional)"
                                                style={inputStyle}
                                                disabled={isCommunity && !isOwner}
                                                onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.5)'}
                                                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                                            />
                                            {avatarUrl && (
                                                <button onClick={() => setAvatarUrl('')} style={{ alignSelf: 'flex-start', fontSize: 10, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                                    Remove photo
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {/* Icon picker — used when no photo */}
                                <div>
                                    <FieldLabel>Emoji Icon {avatarUrl && <span style={{ fontSize: 10, color: '#52525b', fontWeight: 400 }}>(hidden while photo is set)</span>}</FieldLabel>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {SPACE_ICONS.map(ic => (
                                            <button key={ic} onClick={() => setIcon(ic)} style={{
                                                width: 36, height: 36, borderRadius: 8, fontSize: 18,
                                                background: icon === ic ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                                                border: `1px solid ${icon === ic ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            }}>{ic}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <FieldLabel>Name</FieldLabel>
                                    <input value={name} onChange={e => setName(e.target.value)} style={inputStyle}
                                        disabled={isCommunity && !isOwner}
                                        onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.5)'}
                                        onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                                    />
                                </div>
                                <div>
                                    <FieldLabel>Description</FieldLabel>
                                    <textarea value={desc} onChange={e => setDesc(e.target.value)}
                                        style={{ ...inputStyle, height: 80, resize: 'none' }}
                                        disabled={isCommunity && !isOwner}
                                        placeholder={isCommunity ? 'What is this community about?' : 'What is this workspace for?'}
                                        onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.5)'}
                                        onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                                    />
                                </div>
                                {isCommunity && (
                                    <div>
                                        <FieldLabel>Visibility</FieldLabel>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            {[['public', true, '🌐 Public', 'Anyone can find and join'], ['private', false, '🔒 Private', 'Invite-only']].map(([key, val, label, hint]) => (
                                                <button key={key} onClick={() => isOwner && setIsPublic(val)} style={{
                                                    flex: 1, padding: '10px 12px', borderRadius: 8, textAlign: 'left',
                                                    background: isPublic === val ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
                                                    border: `1px solid ${isPublic === val ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.07)'}`,
                                                    cursor: isOwner ? 'pointer' : 'default', opacity: !isOwner ? 0.5 : 1,
                                                }}>
                                                    <div style={{ fontSize: 12, fontWeight: 600, color: isPublic === val ? '#c7d2fe' : '#71717a', marginBottom: 3 }}>{label}</div>
                                                    <div style={{ fontSize: 10, color: '#52525b' }}>{hint}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {(!isCommunity || isOwner) && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <button onClick={handleSave} disabled={!name.trim() || busy} style={{
                                            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: name.trim() ? 'pointer' : 'default',
                                            background: saved ? 'rgba(34,197,94,0.8)' : name.trim() ? 'rgba(99,102,241,0.9)' : 'rgba(99,102,241,0.3)',
                                            color: '#fff', fontSize: 13, fontWeight: 600, transition: 'background 0.2s',
                                        }}>{busy ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}</button>
                                    </div>
                                )}
                            </div>
                        )}

                        {tab === 'channels' && (
                            <div style={{ maxWidth: 560 }}>
                                <p style={{ fontSize: 12, color: '#52525b', marginBottom: 16, lineHeight: 1.5 }}>
                                    {isCommunity && !isOwner ? 'Channels in this community are managed by the owner.' : 'Click the icon on any channel to set a custom emoji. Text channels are for chat; ephemeral channels auto-delete messages.'}
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {channels.filter(c => !c.project_id).map(ch => {
                                        const TypeIcon = CHANNEL_TYPE_ICON[ch.type] || Hash;
                                        const isEditingThis = editingChIcon === ch.id;
                                        return (
                                            <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: `1px solid ${isEditingThis ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)'}` }}>
                                                <button
                                                    onClick={() => {
                                                        if (!isOwner) return;
                                                        setEditingChIcon(isEditingThis ? null : ch.id);
                                                        setChIconInput(ch.icon || '');
                                                    }}
                                                    title={isOwner ? 'Set channel emoji' : undefined}
                                                    style={{ width: 22, height: 22, borderRadius: 4, background: isOwner ? 'rgba(255,255,255,0.06)' : 'transparent', border: 'none', cursor: isOwner ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                                                >
                                                    {ch.icon
                                                        ? <span style={{ fontSize: 14, lineHeight: 1 }}>{ch.icon}</span>
                                                        : <TypeIcon style={{ width: 13, height: 13, color: '#52525b' }} />
                                                    }
                                                </button>
                                                {isEditingThis ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                                                        <input
                                                            autoFocus
                                                            value={chIconInput}
                                                            onChange={e => setChIconInput(e.target.value)}
                                                            placeholder="emoji"
                                                            maxLength={4}
                                                            style={{ ...inputStyle, width: 60, padding: '4px 8px', fontSize: 16, textAlign: 'center' }}
                                                            onKeyDown={async e => {
                                                                if (e.key === 'Enter') {
                                                                    await updateChannel(ch.id, { icon: chIconInput.trim() || null });
                                                                    setEditingChIcon(null);
                                                                }
                                                                if (e.key === 'Escape') setEditingChIcon(null);
                                                            }}
                                                        />
                                                        <button onClick={async () => { await updateChannel(ch.id, { icon: chIconInput.trim() || null }); setEditingChIcon(null); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(99,102,241,0.7)', color: '#fff', border: 'none', cursor: 'pointer' }}>Set</button>
                                                        {ch.icon && <button onClick={async () => { await updateChannel(ch.id, { icon: null }); setEditingChIcon(null); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: '#71717a', border: 'none', cursor: 'pointer' }}>Clear</button>}
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: 13, color: '#a1a1aa', flex: 1 }}>{ch.name}</span>
                                                )}
                                                {!isEditingThis && <span style={{ fontSize: 9, color: '#3f3f46', fontFamily: "'Geist Mono', monospace", textTransform: 'uppercase' }}>{ch.type}</span>}
                                                {ch.is_private === 1 && <Lock style={{ width: 11, height: 11, color: '#3f3f46' }} />}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {tab === 'permissions' && isCommunity && (
                            <div style={{ maxWidth: 480 }}>
                                <p style={{ fontSize: 12, color: '#52525b', marginBottom: 20, lineHeight: 1.5 }}>Control what members can do in this community.</p>
                                {[
                                    { key: 'post',   label: 'Post messages',       hint: 'Allow members to post in channels' },
                                    { key: 'invite', label: 'Invite others',        hint: 'Allow members to share invite links' },
                                    { key: 'react',  label: 'React to messages',    hint: 'Allow emoji reactions on posts' },
                                ].map(perm => (
                                    <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <div>
                                            <div style={{ fontSize: 13, color: '#d4d4d8', fontWeight: 500 }}>{perm.label}</div>
                                            <div style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>{perm.hint}</div>
                                        </div>
                                        <div style={{ width: 36, height: 20, borderRadius: 10, background: isOwner ? 'rgba(99,102,241,0.8)' : 'rgba(255,255,255,0.12)', position: 'relative', cursor: isOwner ? 'pointer' : 'default', opacity: isOwner ? 1 : 0.5 }}>
                                            <div style={{ position: 'absolute', right: 2, top: 2, width: 16, height: 16, borderRadius: '50%', background: '#fff' }} />
                                        </div>
                                    </div>
                                ))}
                                {!isOwner && <p style={{ fontSize: 11, color: '#52525b', marginTop: 16, fontStyle: 'italic' }}>Only the community owner can change permissions.</p>}
                            </div>
                        )}

                        {tab === 'members' && (
                            <div style={{ maxWidth: 560 }}>
                                <p style={{ fontSize: 12, color: '#52525b', marginBottom: 16 }}>Members who have access to this space.</p>
                                <div style={{ fontSize: 11, color: '#52525b', marginBottom: 12, fontFamily: "'Geist Mono', monospace" }}>
                                    Member list is visible in individual channel member panels.
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
                                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#818cf8' }}>
                                        {(user?.name || '?')[0].toUpperCase()}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: '#d4d4d8' }}>{user?.name}</div>
                                        <div style={{ fontSize: 10, color: '#3f3f46' }}>Owner</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {tab === 'invites' && (
                            <div style={{ maxWidth: 480 }}>
                                <p style={{ fontSize: 12, color: '#52525b', marginBottom: 16, lineHeight: 1.5 }}>
                                    Invite links are per-channel. Open a channel and click the invite icon in the header to generate a shareable code.
                                </p>
                                <div style={{ padding: '14px 16px', borderRadius: 8, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
                                    <div style={{ fontSize: 12, color: '#818cf8', fontWeight: 600, marginBottom: 4 }}>How invites work</div>
                                    <ul style={{ fontSize: 12, color: '#71717a', lineHeight: 1.7, margin: 0, paddingLeft: 16 }}>
                                        <li>Each channel has a unique 6-character invite code</li>
                                        <li>Share the code via Join by Code in the sidebar</li>
                                        <li>Private channels require the code to join</li>
                                        <li>Codes can be refreshed from the channel invite modal</li>
                                    </ul>
                                </div>
                            </div>
                        )}

                        {tab === 'danger' && (() => {
                            const isLeave = !isOwner || (!isCommunity && !isOwner);
                            const actionFn = (!isOwner && isCommunity) ? handleLeave : handleDelete;
                            const needsConfirm = isOwner; // non-owners just get one-click leave
                            const confirmReady = confirmInput === workspace?.name;
                            return (
                                <div style={{ maxWidth: 480 }}>
                                    <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 20 }}>
                                        <p style={{ fontSize: 13, color: '#fca5a5', fontWeight: 600, marginBottom: 6 }}>
                                            {isOwner ? 'This action cannot be undone' : `You will lose access to ${workspace?.name}`}
                                        </p>
                                        <p style={{ fontSize: 12, color: '#71717a', lineHeight: 1.5, margin: 0 }}>
                                            {isOwner
                                                ? `This will permanently delete all channels, messages, and history in ${isCommunity ? 'this community' : 'this workspace'}.`
                                                : isCommunity
                                                    ? 'Leaving will remove you from the community. You can rejoin if it\'s public.'
                                                    : 'This removes the workspace from your sidebar.'
                                            }
                                        </p>
                                    </div>
                                    {!confirmDelete ? (
                                        <button onClick={() => { if (needsConfirm) { setConfirmDelete(true); setConfirmInput(''); } else actionFn(); }}
                                            style={{ padding: '8px 20px', borderRadius: 8, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                                            {dangerLabel}
                                        </button>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                            <p style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>Type <strong>{workspace?.name}</strong> to confirm:</p>
                                            <input
                                                autoFocus
                                                value={confirmInput}
                                                onChange={e => setConfirmInput(e.target.value)}
                                                placeholder={workspace?.name}
                                                style={{ ...inputStyle, borderColor: confirmReady ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.3)' }}
                                                onKeyDown={e => { if (e.key === 'Enter' && confirmReady) actionFn(); if (e.key === 'Escape') setConfirmDelete(false); }}
                                            />
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button onClick={() => { setConfirmDelete(false); setConfirmInput(''); }} style={{ padding: '7px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#71717a', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                                                <button onClick={actionFn} disabled={!confirmReady} style={{ padding: '7px 16px', borderRadius: 8, background: confirmReady ? 'rgba(239,68,68,0.8)' : 'rgba(239,68,68,0.25)', border: 'none', color: confirmReady ? '#fff' : '#7f1d1d', fontSize: 13, fontWeight: 700, cursor: confirmReady ? 'pointer' : 'default', transition: 'all 0.15s' }}>
                                                    {dangerLabel}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, color, src, size = 'md', isSoma = false }) {
    const [imgFailed, setImgFailed] = useState(false);
    const s = size === 'sm' ? 'w-7 h-7 text-[11px]' : size === 'lg' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';
    const initial = isSoma ? '⬡' : (name || '?')[0].toUpperCase();
    if (src && !isSoma && !imgFailed) {
        return (
            <div className={`${s} rounded-xl shrink-0 ring-1 ${c(color, 'ring')} overflow-hidden bg-zinc-800`}>
                <img src={src} alt={name} className="w-full h-full object-cover"
                    onError={() => setImgFailed(true)} />
            </div>
        );
    }
    return (
        <div className={`${s} rounded-xl flex items-center justify-center font-bold shrink-0 ring-1 ${c(color, 'bg')} ${c(color, 'ring')} ${c(color, 'text')}`}>
            {initial}
        </div>
    );
}

// ── Modal shell ───────────────────────────────────────────────────────────────
function Modal({ onClose, children, width = 'max-w-md' }) {
    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className={`${width} w-full bg-[#111113] border border-white/10 rounded-2xl shadow-2xl overflow-hidden`}>
                {children}
            </div>
        </div>
    );
}

// ── Fenced code block component with syntax highlighting and Copy button ──────
function CodeBlock({ language, code }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            AxisAudio.playUI();
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy!", err);
        }
    };

    const tokenize = (src) => {
        const tokens = [];
        const regex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:const|let|var|function|return|class|import|export|from|if|else|for|while|switch|case|break|try|catch|throw|default|new|this|async|await|typeof|instanceof|in|of|void|delete|null|undefined|true|false)\b)|(\b\d+(?:\.\d+)?\b)|(\b(?:console|window|document|process|global|Array|Object|String|Number|Boolean|Function|Promise|Map|Set|Error)\b)/g;

        let lastIdx = 0;
        let match;
        while ((match = regex.exec(src)) !== null) {
            const index = match.index;
            if (index > lastIdx) {
                tokens.push({ type: 'text', text: src.slice(lastIdx, index) });
            }
            if (match[1]) {
                tokens.push({ type: 'comment', text: match[1] });
            } else if (match[2]) {
                tokens.push({ type: 'string', text: match[2] });
            } else if (match[3]) {
                tokens.push({ type: 'keyword', text: match[3] });
            } else if (match[4]) {
                tokens.push({ type: 'number', text: match[4] });
            } else if (match[5]) {
                tokens.push({ type: 'builtin', text: match[5] });
            }
            lastIdx = regex.lastIndex;
        }
        if (lastIdx < src.length) {
            tokens.push({ type: 'text', text: src.slice(lastIdx) });
        }
        return tokens;
    };

    const tokens = tokenize(code);

    const getStyle = (type) => {
        switch (type) {
            case 'comment': return 'text-zinc-500 italic';
            case 'string': return 'text-amber-300';
            case 'keyword': return 'text-pink-400 font-semibold';
            case 'number': return 'text-orange-300';
            case 'builtin': return 'text-cyan-400';
            default: return 'text-zinc-100';
        }
    };

    return (
        <div className="relative my-3 border border-white/10 rounded-xl bg-zinc-950/80 backdrop-blur-md overflow-hidden font-mono group">
            <div className="flex justify-between items-center px-4 py-2 border-b border-white/5 bg-white/3 text-[10px] text-zinc-500 uppercase tracking-widest font-semibold select-none">
                <span>{language || 'code'}</span>
                <button
                    onClick={handleCopy}
                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-zinc-300 text-[10px] hover:text-white uppercase font-bold tracking-wide flex items-center gap-1"
                >
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <pre className="p-4 overflow-x-auto text-xs leading-relaxed select-text text-zinc-100">
                <code>
                    {tokens.map((t, idx) => (
                        <span key={idx} className={getStyle(t.type)}>{t.text}</span>
                    ))}
                </code>
            </pre>
        </div>
    );
}

// ── Content renderers ─────────────────────────────────────────────────────────
function renderContent(content, myName = '') {
    if (!content) return null;

    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
        const textBefore = content.substring(lastIndex, match.index);
        if (textBefore) {
            parts.push({ type: 'text', value: textBefore });
        }
        parts.push({ type: 'codeblock', language: match[1], code: match[2] });
        lastIndex = codeBlockRegex.lastIndex;
    }

    const textAfter = content.substring(lastIndex);
    if (textAfter) {
        parts.push({ type: 'text', value: textAfter });
    }

    return parts.map((part, index) => {
        if (part.type === 'codeblock') {
            return <CodeBlock key={index} language={part.language} code={part.code} />;
        }

        const inlineParts = part.value.split(/(\*\*[^*]+\*\*|`[^`]+`|\n|@\w+)/g);
        return inlineParts.map((sub, i) => {
            if (!sub) return null;
            if (sub.startsWith('**') && sub.endsWith('**'))
                return <strong key={`${index}-${i}`} className="font-semibold text-zinc-100">{sub.slice(2, -2)}</strong>;
            if (sub.startsWith('`') && sub.endsWith('`'))
                return <code key={`${index}-${i}`} className="px-1.5 py-0.5 rounded bg-white/8 text-cyan-300 font-mono text-[0.85em]">{sub.slice(1, -1)}</code>;
            if (sub === '\n') return <br key={`${index}-${i}`} />;
            if (/^@\w+/.test(sub)) {
                const isMe = myName && sub.slice(1).toLowerCase() === myName.toLowerCase();
                return <span key={`${index}-${i}`} className={isMe
                    ? 'bg-amber-500/20 text-amber-300 rounded px-0.5 font-semibold'
                    : 'text-blue-400 font-medium'}>{sub}</span>;
            }
            return sub;
        });
    });
}

function renderSnippet(text) {
    if (!text) return null;
    const parts = text.split(/(\[\[.*?\]\])/g);
    return parts.map((part, i) => {
        if (part.startsWith('[[') && part.endsWith(']]'))
            return <mark key={i} className="bg-amber-500/30 text-amber-200 not-italic rounded">{part.slice(2, -2)}</mark>;
        return <span key={i} className="text-zinc-400">{part}</span>;
    });
}

// ── Identity Setup Modal — color picker only (name comes from Studio) ─────────
function IdentityModal({ onDone }) {
    const { user, setupUser, AXIS_COLORS } = useAxis();
    const [color, setColor] = useState(user?.color || 'violet');

    // Auto-dismiss once Studio profile loads with a name
    useEffect(() => {
        if (user?.name) onDone();
    }, [user?.name, onDone]);

    const submit = () => {
        setupUser(user?.name || 'User', color);
        onDone();
    };

    return (
        <Modal onClose={() => {}} width="max-w-sm">
            <div className="p-8 flex flex-col items-center gap-6">
                <div className="text-center">
                    <div className="text-3xl mb-2">⬡</div>
                    <h1 className="text-lg font-bold text-zinc-100 tracking-wide">Welcome to AXIS</h1>
                    <p className="text-xs text-zinc-500 mt-1">Loading your Studio profile…</p>
                </div>
                <div className="w-full">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium mb-2 block">Choose your color</label>
                    <div className="flex gap-2 flex-wrap">
                        {AXIS_COLORS.map(col => (
                            <button key={col} onClick={() => setColor(col)} className={`w-7 h-7 rounded-lg ${c(col, 'dot')} transition-all ${color === col ? 'ring-2 ring-white ring-offset-2 ring-offset-[#111113] scale-110' : 'opacity-50 hover:opacity-100'}`} />
                        ))}
                    </div>
                </div>
                <button onClick={submit} className="w-full py-2.5 rounded-xl bg-white text-black text-sm font-bold tracking-wide hover:bg-zinc-100 transition-colors">
                    Enter AXIS
                </button>
            </div>
        </Modal>
    );
}

// ── Create Workspace Modal ────────────────────────────────────────────────────
const WORKSPACE_TYPES = [
    { id: 'engineering', label: 'Engineering', icon: 'engineering', desc: 'Code, systems, incidents, PRs, and sprints.', color: 'blue' },
    { id: 'finance', label: 'Finance', icon: 'finance', desc: 'Budgets, reconciliations, forecasts, close.', color: 'emerald' },
    { id: 'operations', label: 'Operations', icon: 'operations', desc: 'Roadmaps, projects, cross-team coordination.', color: 'violet' },
    { id: 'science', label: 'Science', icon: 'science', desc: 'Research, experiments, data, and synthesis.', color: 'cyan' },
    { id: 'creative', label: 'Creative', icon: 'creative', desc: 'Design, content, campaigns, and publishing.', color: 'fuchsia' },
];

const ROOM_TEMPLATES = [
    {
        id: 'community',
        label: 'Community',
        desc: 'General discussion, intros, announcements, and help.',
        icon: MessageCircle,
        color: 'violet',
        startChannel: 'general',
    },
    {
        id: 'research',
        label: 'Research',
        desc: 'Questions, sources, findings, and synthesis.',
        icon: BookOpen,
        color: 'emerald',
        startChannel: 'questions',
    },
    {
        id: 'trading',
        label: 'Trading',
        desc: 'Market watch, thesis, risk, and post-trade review.',
        icon: Briefcase,
        color: 'amber',
        startChannel: 'market-watch',
    },
    {
        id: 'creative',
        label: 'Creative',
        desc: 'Ideas, drafts, critique, and publishing flow.',
        icon: Sparkles,
        color: 'fuchsia',
        startChannel: 'ideas',
    },
    {
        id: 'support',
        label: 'Support',
        desc: 'Questions, bug reports, requests, and resolved threads.',
        icon: Shield,
        color: 'cyan',
        startChannel: 'help-desk',
    },
];

function CreateWorkspaceModal({ onClose, kind = 'workspace' }) {
    const { createWorkspace, loadChannels, setActiveWorkspaceId, setActiveChannelId } = useAxis();
    const [name, setName]           = useState('');
    const [color, setColor]         = useState(kind === 'room' ? 'violet' : 'blue');
    const [desc, setDesc]           = useState('');
    const [roomTemplate, setRoomTemplate]     = useState('community');
    const [workspaceType, setWorkspaceType]   = useState('operations');
    const [busy, setBusy]           = useState(false);
    const [error, setError]         = useState('');
    const isRoom = kind === 'room';
    const selectedTemplate = ROOM_TEMPLATES.find(t => t.id === roomTemplate) || ROOM_TEMPLATES[0];
    const selectedWsType = WORKSPACE_TYPES.find(t => t.id === workspaceType) || WORKSPACE_TYPES[0];

    const submit = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        setError('');
        try {
            const d = await createWorkspace({
                name: name.trim(),
                icon: isRoom ? '💬' : selectedWsType.icon,
                color: isRoom ? color : selectedWsType.color,
                type: isRoom ? 'room' : 'workspace',
                description: desc.trim(),
                roomTemplate: isRoom ? roomTemplate : undefined,
            });
            if (!d?.ok || !d?.workspace?.id) {
                throw new Error(d?.error || `Could not create ${isRoom ? 'room' : 'workspace'}.`);
            }
            const workspaceId = d.workspace.id;
            if (!isRoom) {
                localStorage.setItem(`axis_wstype_${workspaceId}`, workspaceType);
            }
            setActiveWorkspaceId(workspaceId);
            const channels = await loadChannels(workspaceId);
            const startName = isRoom ? selectedTemplate.startChannel : 'general';
            const defaultChannel = channels.find(ch => ch.name === startName) || channels.find(ch => ch.name === 'general') || channels[0];
            setActiveChannelId(defaultChannel?.id || null);
            onClose();
        } catch (e) {
            console.error('[Axis] createWorkspace failed:', e);
            setError(e?.message || `Could not create ${isRoom ? 'room' : 'workspace'}.`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6 space-y-5">
                <div>
                    <h2 className="text-sm font-bold text-zinc-100 tracking-wide">New {isRoom ? 'Room' : 'Workspace'}</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                        {isRoom ? 'A room is a Discord-like space with channels and threads.' : 'A workspace is a full collaboration area with projects and tasks.'}
                    </p>
                </div>
                <div className="space-y-3">
                    {!isRoom && (
                        <div>
                            <label className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5 block">What kind of work?</label>
                            <div className="grid grid-cols-1 gap-2">
                                {WORKSPACE_TYPES.map(wt => {
                                    const active = workspaceType === wt.id;
                                    return (
                                        <button
                                            key={wt.id}
                                            type="button"
                                            onClick={() => { setWorkspaceType(wt.id); setColor(wt.color); }}
                                            className={`rounded-xl border p-3 text-left transition-all ${active ? 'border-violet-300/35 bg-violet-400/10' : 'border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]'}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <WorkspaceTypeIcon icon={wt.icon} active={active} size={15} />
                                                <span className={`text-xs font-bold ${active ? 'text-zinc-100' : 'text-zinc-400'}`}>{wt.label}</span>
                                            </div>
                                            <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{wt.desc}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <div>
                        <label className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1 block">Name</label>
                        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder={isRoom ? 'e.g. SOMA Builders' : 'e.g. Product Team'} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-white/25" />
                    </div>
                    <div>
                        <label className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1 block">Description</label>
                        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder={isRoom ? 'What do people gather here to discuss?' : 'What work happens here?'} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-white/25" />
                    </div>
                    {isRoom && (
                        <div>
                            <label className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5 block">Room Template</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {ROOM_TEMPLATES.map(template => {
                                    const Icon = template.icon;
                                    const active = roomTemplate === template.id;
                                    return (
                                        <button
                                            key={template.id}
                                            type="button"
                                            onClick={() => { setRoomTemplate(template.id); setColor(template.color); }}
                                            className={`rounded-xl border p-3 text-left transition-all ${active ? 'border-violet-300/35 bg-violet-400/10 shadow-[0_0_24px_rgba(167,139,250,0.10)]' : 'border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]'}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <Icon className={`h-4 w-4 ${active ? 'text-violet-200' : 'text-zinc-500'}`} />
                                                <span className={`text-xs font-bold ${active ? 'text-zinc-100' : 'text-zinc-400'}`}>{template.label}</span>
                                            </div>
                                            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">{template.desc}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                {error && (
                    <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        {error}
                    </div>
                )}
                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
                    <button onClick={submit} disabled={!name.trim() || busy} className="px-4 py-1.5 text-xs font-bold bg-white text-black rounded-lg hover:bg-zinc-100 disabled:opacity-30 transition-all">{busy ? '…' : `Create ${isRoom ? 'Room' : 'Workspace'}`}</button>
                </div>
            </div>
        </Modal>
    );
}

// ── Create Channel Modal ──────────────────────────────────────────────────────
function CreateChannelModal({ onClose }) {
    const { createChannel, activeWorkspaceId, activeWorkspace, setActiveChannelId } = useAxis();
    const [name, setName]         = useState('');
    const [type, setType]         = useState('text');
    const [desc, setDesc]         = useState('');
    const [isPrivate, setPrivate] = useState(false);
    const [busy, setBusy]         = useState(false);

    const TYPES = [
        { id: 'text',      label: 'Text',     icon: Hash, desc: 'Standard persistent chat' },
        { id: 'ephemeral', label: 'Ephemeral', icon: Eye,  desc: 'Messages can self-destruct' },
    ];

    const [error, setError] = useState('');

    const submit = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        setError('');
        try {
            const d = await createChannel({ workspaceId: activeWorkspaceId, name: name.trim(), type, description: desc, isPrivate });
            if (d?.ok) { setActiveChannelId(d.channel.id); onClose(); }
            else setError(d?.error || 'Failed to create channel');
        } catch (e) {
            console.error('[Axis] createChannel failed:', e);
            setError('Server error — check console');
        }
        setBusy(false);
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6 space-y-4">
                <div>
                    <h2 className="text-sm font-bold text-zinc-100 tracking-wide">New Channel</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                        {(activeWorkspace?.type === 'room' || activeWorkspace?.type === 'community')
                            ? 'Channels are persistent topic lanes inside this room.'
                            : 'Channels are where conversations happen.'}
                    </p>
                </div>
                <div className="flex gap-2">
                    {TYPES.map(t => (
                        <button key={t.id} onClick={() => setType(t.id)} className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${type === t.id ? 'border-white/25 bg-white/8' : 'border-white/5 bg-white/3 hover:border-white/15'}`}>
                            <t.icon className={`w-4 h-4 ${type === t.id ? 'text-zinc-100' : 'text-zinc-500'}`} />
                            <span className={`text-[11px] font-semibold ${type === t.id ? 'text-zinc-100' : 'text-zinc-500'}`}>{t.label}</span>
                            <span className="text-[9px] text-zinc-600 text-center leading-tight">{t.desc}</span>
                        </button>
                    ))}
                </div>
                <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1 block">Channel name</label>
                    <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="e.g. strategy" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-white/25" />
                </div>
                <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1 block">Description (optional)</label>
                    <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What's this channel about?" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-white/25" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <div onClick={() => setPrivate(v => !v)} className={`w-9 h-5 rounded-full transition-colors flex items-center ${isPrivate ? 'bg-white/40' : 'bg-white/10'}`}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${isPrivate ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-xs text-zinc-400">Private channel <span className="text-zinc-600">(invite only)</span></span>
                </label>
                {error && <p className="text-xs text-red-400">{error}</p>}
                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
                    <button onClick={submit} disabled={!name.trim() || busy} className="px-4 py-1.5 text-xs font-bold bg-white text-black rounded-lg hover:bg-zinc-100 disabled:opacity-30 transition-all">{busy ? '…' : 'Create'}</button>
                </div>
            </div>
        </Modal>
    );
}

// ── Create Thread Modal ───────────────────────────────────────────────────────
function CreateThreadModal({ onClose }) {
    const { createChannel, activeWorkspaceId, setActiveChannelId, activeWorkspace } = useAxis();
    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        setError('');
        try {
            const d = await createChannel({
                workspaceId: activeWorkspaceId,
                name: name.trim(),
                type: 'thread',
                description: desc || `Focused thread in ${activeWorkspace?.name || 'this room'}`,
                isPrivate: false,
            });
            if (d?.ok) { setActiveChannelId(d.channel.id); onClose(); }
            else setError(d?.error || 'Failed to create thread');
        } catch (e) {
            console.error('[Axis] createThread failed:', e);
            setError('Server error — check console');
        }
        setBusy(false);
    };

    return (
        <Modal onClose={onClose}>
            <div className="p-6 space-y-4">
                <div>
                    <h2 className="text-sm font-bold text-zinc-100 tracking-wide">New Thread</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">A focused conversation branch inside this room.</p>
                </div>
                <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1 block">Thread name</label>
                    <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="e.g. CT memory cleanup" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-white/25" />
                </div>
                <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1 block">Context</label>
                    <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What should stay focused here?" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-white/25" />
                </div>
                {error && <p className="text-xs text-red-400">{error}</p>}
                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
                    <button onClick={submit} disabled={!name.trim() || busy} className="px-4 py-1.5 text-xs font-bold bg-white text-black rounded-lg hover:bg-zinc-100 disabled:opacity-30 transition-all">{busy ? '…' : 'Create Thread'}</button>
                </div>
            </div>
        </Modal>
    );
}

// ── Invite Modal ──────────────────────────────────────────────────────────────
function InviteModal({ channelId, onClose }) {
    const { getInvite } = useAxis();
    const [data, setData]     = useState(null);
    const [copied, setCopied] = useState(false);
    const [busy, setBusy]     = useState(false);

    useEffect(() => { getInvite(channelId).then(d => d.ok && setData(d)); }, [channelId, getInvite]);

    const copy = () => {
        navigator.clipboard.writeText(data.inviteCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const refresh = async () => {
        setBusy(true);
        const r = await fetch(`/api/axis/channels/${channelId}/invite/refresh`, { method: 'POST' }).then(r => r.json());
        if (r.ok) setData(d => ({ ...d, inviteCode: r.inviteCode }));
        setBusy(false);
    };

    return (
        <Modal onClose={onClose} width="max-w-sm">
            <div className="p-6 space-y-5">
                <div>
                    <h2 className="text-sm font-bold text-zinc-100 tracking-wide">Invite to #{data?.channelName || '…'}</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">Share this code with anyone you want in this channel</p>
                </div>
                {data ? (
                    <>
                        <div className="bg-black/40 border border-white/10 rounded-xl p-5 flex items-center justify-between gap-4">
                            <span className="font-mono text-3xl font-bold text-zinc-100 tracking-[0.25em]">{data.inviteCode}</span>
                            <button onClick={copy} className={`p-2 rounded-lg transition-all ${copied ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'}`}>
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                        </div>
                        <p className="text-[10px] text-zinc-600 text-center">Others open AXIS → Join Channel → enter this code</p>
                        <div className="flex justify-between items-center">
                            <button onClick={refresh} disabled={busy} className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40">
                                <RefreshCw className="w-3 h-3" /> {busy ? 'Refreshing…' : 'Generate new code'}
                            </button>
                            <button onClick={onClose} className="px-4 py-1.5 text-xs font-bold bg-white text-black rounded-lg hover:bg-zinc-100 transition-all">Done</button>
                        </div>
                    </>
                ) : (
                    <div className="h-24 flex items-center justify-center text-zinc-600 text-sm">Loading…</div>
                )}
            </div>
        </Modal>
    );
}

// ── Join Modal ────────────────────────────────────────────────────────────────
function JoinModal({ onClose }) {
    const { joinByInvite } = useAxis();
    const [code, setCode]   = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy]   = useState(false);

    const submit = async () => {
        if (code.length < 6 || busy) return;
        setBusy(true); setError('');
        const d = await joinByInvite(code.trim().toUpperCase());
        if (d.ok) { onClose(); } else { setError(d.error || 'Invalid code'); setBusy(false); }
    };

    return (
        <Modal onClose={onClose} width="max-w-xs">
            <div className="p-6 space-y-4">
                <div>
                    <h2 className="text-sm font-bold text-zinc-100 tracking-wide">Join a Channel</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">Enter the invite code you received</p>
                </div>
                <input
                    value={code}
                    onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                    placeholder="XXXXXX"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl font-mono text-xl text-center text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-white/25 tracking-[0.3em]"
                />
                {error && <p className="text-xs text-red-400">{error}</p>}
                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
                    <button onClick={submit} disabled={code.length < 6 || busy} className="px-4 py-1.5 text-xs font-bold bg-white text-black rounded-lg hover:bg-zinc-100 disabled:opacity-30 transition-all">{busy ? '…' : 'Join'}</button>
                </div>
            </div>
        </Modal>
    );
}

// ── Search Modal ──────────────────────────────────────────────────────────────
function SearchModal({ onClose, workspaceId }) {
    const { searchMessages, setActiveChannelId, channels } = useAxis();
    const [query, setQuery]     = useState('');
    const [results, setResults] = useState([]);
    const [busy, setBusy]       = useState(false);
    const inputRef              = useRef(null);
    const debounceRef           = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const doSearch = useCallback(async (q) => {
        if (!q.trim()) { setResults([]); return; }
        setBusy(true);
        const res = await searchMessages(q, { workspaceId });
        setResults(res);
        setBusy(false);
    }, [searchMessages, workspaceId]);

    const handleChange = (val) => {
        setQuery(val);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(val), 280);
    };

    const goToMessage = (result) => {
        localStorage.setItem('axis:pending-message', JSON.stringify({ channelId: result.channel_id, messageId: result.id }));
        setActiveChannelId(result.channel_id);
        window.dispatchEvent(new CustomEvent('axis:jump-message', { detail: { channelId: result.channel_id, messageId: result.id } }));
        onClose();
    };

    const getChannelName = (id) => {
        const ch = channels.find(item => item.id === id);
        return ch ? channelLabel(ch) : id;
    };

    return (
        <Modal onClose={onClose} width="max-w-xl">
            <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8">
                    <Search className="w-4 h-4 text-zinc-500 shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => handleChange(e.target.value)}
                        placeholder="Search messages…"
                        className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                    />
                    {busy && <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin shrink-0" />}
                    <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {!query && (
                        <div className="py-10 text-center text-zinc-700 text-sm">Type to search across all messages</div>
                    )}
                    {query && !busy && results.length === 0 && (
                        <div className="py-10 text-center text-zinc-600 text-sm">No results for "<span className="text-zinc-400">{query}</span>"</div>
                    )}
                    {results.map(r => (
                        <button key={r.id} onClick={() => goToMessage(r)}
                            className="w-full text-left p-3 rounded-xl hover:bg-white/5 transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] text-zinc-600 font-mono">#{getChannelName(r.channel_id)}</span>
                                <span className="text-[11px] font-semibold text-zinc-400">{r.sender_name}</span>
                                <span className="text-[10px] text-zinc-700 ml-auto">
                                    {new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                            </div>
                            <p className="text-[12.5px] leading-relaxed">
                                {renderSnippet(r.snippet || r.content)}
                            </p>
                        </button>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

// ── Create Project Modal ──────────────────────────────────────────────────────
function CreateProjectModal({ onClose }) {
    const { activeWorkspaceId, createProject } = useAxis();
    const [name, setName]       = useState('');
    const [desc, setDesc]       = useState('');
    const [icon, setIcon]       = useState('📁');
    const [color, setColor]     = useState('indigo');
    const [saving, setSaving]   = useState(false);
    const ICONS = ['📁','🚀','💡','⚡','🔥','🎯','📊','🛠️','🧠','🌐','🔬','💼'];

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    const handleCreate = async () => {
        if (!name.trim() || saving) return;
        setSaving(true);
        const r = await createProject({ workspaceId: activeWorkspaceId, name: name.trim(), description: desc.trim(), icon, color });
        setSaving(false);
        if (r?.ok) onClose();
    };

    return (
        <div onClick={e => e.target === e.currentTarget && onClose()} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20,
        }}>
            <div className="ax-modal-enter" style={{
                width: 440, maxWidth: '100%', background: '#111318',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16,
                boxShadow: '0 40px 100px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0d0f13', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Briefcase className="w-4 h-4 text-zinc-500" />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf0' }}>New Project</span>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}>
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        {/* Icon picker */}
                        <div>
                            <p style={{ fontSize: 10, color: '#52525b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Icon</p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                                {ICONS.map(ic => (
                                    <button key={ic} onClick={() => setIcon(ic)} style={{
                                        width: 32, height: 32, borderRadius: 8, fontSize: 16,
                                        background: icon === ic ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                                        border: `1px solid ${icon === ic ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>{ic}</button>
                                ))}
                            </div>
                        </div>
                        {/* Name + desc */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div>
                                <p style={{ fontSize: 10, color: '#52525b', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Project name</p>
                                <input autoFocus value={name} onChange={e => setName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                    placeholder="e.g. Traction 2026"
                                    style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#e8eaf0', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                                />
                            </div>
                            <div>
                                <p style={{ fontSize: 10, color: '#52525b', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Description</p>
                                <input value={desc} onChange={e => setDesc(e.target.value)}
                                    placeholder="What is this project about?"
                                    style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#e8eaf0', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                                />
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                        <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#6b7280', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleCreate} disabled={!name.trim() || saving} style={{
                            padding: '7px 16px', borderRadius: 8,
                            background: name.trim() && !saving ? 'rgba(99,102,241,0.9)' : 'rgba(99,102,241,0.3)',
                            border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: name.trim() && !saving ? 'pointer' : 'default',
                        }}>{saving ? 'Creating…' : 'Create Project'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Create Community Modal ───────────────────────────────────────────────────
const COMMUNITY_PRESETS = [
    { id: 'builders', label: 'Builders', icon: '🛠️', desc: 'Projects, feedback, shipping, and technical collaboration.' },
    { id: 'creative', label: 'Creative', icon: '🎨', desc: 'Art, stories, media, critique, and publishing.' },
    { id: 'research', label: 'Research', icon: '🔬', desc: 'Questions, sources, findings, and synthesis.' },
    { id: 'trading', label: 'Markets', icon: '📈', desc: 'Market structure, signals, risk, and review.' },
    { id: 'support', label: 'Support', icon: '🧭', desc: 'Questions, help, bug reports, and resolved answers.' },
];

function CreateCommunityModal({ createCommunity, onCreated, onClose }) {
    const [preset, setPreset] = useState(COMMUNITY_PRESETS[0]);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [icon, setIcon] = useState(COMMUNITY_PRESETS[0].icon);
    const [isPublic, setIsPublic] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const applyPreset = (next) => {
        setPreset(next);
        setIcon(next.icon);
        if (!description.trim()) setDescription(next.desc);
    };

    const submit = async () => {
        if (!name.trim() || saving) return;
        setSaving(true);
        setError('');
        try {
            const result = await createCommunity({
                name: name.trim(),
                description: description.trim() || preset.desc,
                icon,
                isPublic,
            });
            if (result?.ok && result.community) {
                onCreated(result.community);
            } else {
                setError(result?.error || 'Failed to create community.');
            }
        } catch (e) {
            setError(e.message || 'Failed to create community.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div onClick={e => e.target === e.currentTarget && onClose()} style={{
            position: 'fixed', inset: 0, zIndex: 620, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
            <div className="ax-modal-enter" style={{
                width: 520, maxWidth: '100%', background: '#101116', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.75)',
            }}>
                <div style={{ padding: '15px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0c0d11', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <Globe2 className="w-4 h-4 text-violet-300" />
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: '#f4f4f5' }}>Create Community</div>
                            <div style={{ fontSize: 9, color: '#3f3f46', fontFamily: "'Geist Mono', monospace" }}>Creates an identity, member record, feed, and linked Axis space</div>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer' }}>
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                        <p style={{ margin: '0 0 7px', fontSize: 10, color: '#52525b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Purpose</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                            {COMMUNITY_PRESETS.map(item => {
                                const active = preset.id === item.id;
                                return (
                                    <button key={item.id} onClick={() => applyPreset(item)} style={{
                                        minHeight: 58, borderRadius: 12, border: `1px solid ${active ? 'rgba(167,139,250,0.38)' : 'rgba(255,255,255,0.07)'}`,
                                        background: active ? 'rgba(167,139,250,0.11)' : 'rgba(255,255,255,0.035)',
                                        color: active ? '#ddd6fe' : '#71717a', cursor: 'pointer', display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center', gap: 4,
                                    }}>
                                        <span style={{ fontSize: 18 }}>{item.icon}</span>
                                        <span style={{ fontSize: 9, fontWeight: 800 }}>{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 12 }}>
                        <div>
                            <p style={{ margin: '0 0 6px', fontSize: 10, color: '#52525b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Icon</p>
                            <input value={icon} onChange={e => setIcon(e.target.value.slice(0, 4))} style={{
                                width: '100%', height: 42, textAlign: 'center', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(255,255,255,0.045)', color: '#f4f4f5', fontSize: 20, outline: 'none',
                            }} />
                        </div>
                        <div>
                            <p style={{ margin: '0 0 6px', fontSize: 10, color: '#52525b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Name</p>
                            <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="e.g. SOMA Builders" style={{
                                width: '100%', height: 42, boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(255,255,255,0.045)', color: '#f4f4f5', padding: '0 12px', fontSize: 13, outline: 'none',
                            }} />
                        </div>
                    </div>

                    <div>
                        <p style={{ margin: '0 0 6px', fontSize: 10, color: '#52525b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Description</p>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={preset.desc} rows={3} style={{
                            width: '100%', boxSizing: 'border-box', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.045)', color: '#f4f4f5', padding: '10px 12px', fontSize: 12.5,
                            lineHeight: 1.5, resize: 'none', outline: 'none', fontFamily: 'inherit',
                        }} />
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' }}>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#e4e4e7' }}>Public community</div>
                            <div style={{ fontSize: 10, color: '#52525b', marginTop: 2 }}>Visible in the community browser. Private mode is ready for later invite flows.</div>
                        </div>
                        <div onClick={() => setIsPublic(v => !v)} style={{ width: 38, height: 22, borderRadius: 999, background: isPublic ? 'rgba(167,139,250,0.55)' : 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', padding: 2, transition: 'all .16s' }}>
                            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', transform: isPublic ? 'translateX(16px)' : 'translateX(0)', transition: 'all .16s' }} />
                        </div>
                    </label>

                    {error && <div style={{ color: '#fb7185', fontSize: 12 }}>{error}</div>}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 2 }}>
                        <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#71717a', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={submit} disabled={!name.trim() || saving} style={{
                            padding: '8px 16px', borderRadius: 9, border: 'none', background: name.trim() && !saving ? '#8b5cf6' : 'rgba(139,92,246,0.32)',
                            color: '#fff', fontSize: 12, fontWeight: 800, cursor: name.trim() && !saving ? 'pointer' : 'default',
                        }}>{saving ? 'Creating...' : 'Create and Enter'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Community Browser Modal ───────────────────────────────────────────────────
function CommunityBrowserModal({ onClose }) {
    const { workspaces, createWorkspace, createCommunity, joinCommunity, leaveCommunity, setActiveWorkspaceId, loadChannels, setActiveChannelId } = useAxis();
    const [search, setSearch]         = useState('');
    const [joining, setJoining]       = useState(null);
    const [communities, setCommunities] = useState([]);

    const loadAxisCommunities = useCallback(() => {
        return fetch('/api/axis/communities')
            .then(r => r.json())
            .then(d => { if (d.ok) setCommunities(d.communities || []); return d; })
            .catch(() => null);
    }, []);

    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        loadAxisCommunities();
        return () => window.removeEventListener('keydown', h);
    }, [onClose, loadAxisCommunities]);

    const filtered = communities.filter(c =>
        !search
        || String(c.name || '').toLowerCase().includes(search.toLowerCase())
        || String(c.description || '').toLowerCase().includes(search.toLowerCase())
        || String(c.creator_name || '').toLowerCase().includes(search.toLowerCase())
    );

    const linkedWorkspace = (community) => workspaces.find(ws => ws.community_id === community.id || (ws.type === 'community' && ws.name === community.name));
    const isJoined = (community) => Boolean(community.my_role || linkedWorkspace(community));

    const enterCommunityWorkspace = async (community, workspace = null) => {
        const existing = workspace || linkedWorkspace(community);
        if (existing) {
            setActiveWorkspaceId(existing.id);
            const chs = await loadChannels(existing.id);
            const first = chs.find(ch => ch.name === 'general') || chs.find(ch => ch.type !== 'archive') || chs[0];
            setActiveChannelId(first?.id || null);
            onClose();
            return existing;
        }

        const result = await createWorkspace({
            name: community.name,
            icon: community.icon || '🌐',
            color: 'violet',
            type: 'community',
            description: community.description || '',
            community_id: community.id,
            roomTemplate: 'community',
        });
        if (result?.ok && result.workspace) {
            setActiveWorkspaceId(result.workspace.id);
            const chs = await loadChannels(result.workspace.id);
            const first = chs.find(ch => ch.name === 'general') || chs.find(ch => ch.type !== 'archive') || chs[0];
            setActiveChannelId(first?.id || null);
            onClose();
            return result.workspace;
        }
        return null;
    };

    const handleJoin = async (community) => {
        if (joining) return;
        const existing = linkedWorkspace(community);
        if (existing || community.my_role) {
            await enterCommunityWorkspace(community, existing);
            return;
        }
        setJoining(community.id);
        try {
            const joined = await joinCommunity(community.id);
            const nextCommunity = joined?.community || { ...community, my_role: 'member', member_count: (community.member_count || 0) + 1 };
            setCommunities(prev => prev.map(c => c.id === community.id ? { ...c, ...nextCommunity, my_role: nextCommunity.my_role || 'member' } : c));
            await enterCommunityWorkspace(nextCommunity);
        } finally {
            setJoining(null);
        }
    };

    const handleLeave = async (community, e) => {
        e.stopPropagation();
        await leaveCommunity(community.id).catch(() => {});
        setCommunities(prev => prev.map(c => c.id === community.id ? { ...c, my_role: null, member_count: Math.max(0, (c.member_count || 1) - 1) } : c));
    };

    const openStudioCreator = () => {
        onClose();
        window.dispatchEvent(new CustomEvent('soma:nav', { detail: { module: 'studio' } }));
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'community-hub', context: { mode: 'create' } } }));
        }, 180);
    };

    return (
        <div onClick={e => e.target === e.currentTarget && onClose()} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20,
        }}>
            <div className="ax-modal-enter" style={{
                width: 560, maxWidth: '100%', maxHeight: '80vh',
                background: '#111318', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 16, boxShadow: '0 40px 100px rgba(0,0,0,0.7)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, background: '#0d0f13', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Globe2 className="w-4 h-4 text-zinc-500" />
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf0' }}>Communities</div>
                            <div style={{ fontSize: 9, color: '#2d3142', fontFamily: "'Geist Mono', monospace", marginTop: 1 }}>Create or join a community space</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={openStudioCreator} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(167,139,250,0.25)', background: 'rgba(167,139,250,0.1)', color: '#c4b5fd', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            <Plus className="w-3.5 h-3.5" /> Design in Studio
                        </button>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
                    <input
                        autoFocus value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search communities…"
                        style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: '#e8eaf0', outline: 'none', fontFamily: 'inherit' }}
                    />
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {filtered.map(community => {
                        const joined = isJoined(community);
                        const busy   = joining === community.id;
                        return (
                            <div key={community.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '10px 12px', borderRadius: 10,
                                background: joined ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                                border: `1px solid ${joined ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)'}`,
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}
                                onMouseEnter={e => { e.currentTarget.style.background = joined ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.04)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = joined ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)'; }}
                                onClick={() => handleJoin(community)}
                            >
                                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Globe2 className="w-4 h-4 text-violet-300" />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: '#e8eaf0' }}>{community.name}</span>
                                        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: community.is_public ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.06)', color: community.is_public ? '#818cf8' : '#6b7280', fontFamily: "'Geist Mono', monospace", letterSpacing: '0.06em' }}>{community.is_public ? 'PUBLIC' : 'PRIVATE'}</span>
                                    </div>
                                    <p style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4, margin: '0 0 4px' }}>{community.description}</p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 9, color: '#2d3142', fontFamily: "'Geist Mono', monospace" }}>{(community.member_count || 0).toLocaleString()} members</span>
                                        {community.creator_name && <span style={{ fontSize: 9, color: '#3f3f46', fontFamily: "'Geist Mono', monospace" }}>by {community.creator_name}</span>}
                                        {community.my_role && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: 'rgba(34,197,94,0.08)', color: '#86efac', fontFamily: "'Geist Mono', monospace" }}>{String(community.my_role).toUpperCase()}</span>}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    {joined && (
                                        <button
                                            onClick={e => handleLeave(community, e)}
                                            style={{ padding: '6px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                                            Leave
                                        </button>
                                    )}
                                    <button
                                        onClick={e => { e.stopPropagation(); handleJoin(community); }}
                                        disabled={busy}
                                        style={{
                                            padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
                                            background: joined ? 'rgba(99,102,241,0.2)' : '#6366f1',
                                            color: joined ? '#818cf8' : '#fff',
                                            opacity: busy ? 0.6 : 1,
                                        }}>
                                        {busy ? '…' : joined ? 'Enter' : 'Join'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    {filtered.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 12, color: '#2d3142', fontFamily: "'Geist Mono', monospace" }}>no communities found</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Room / Workspace Rail ─────────────────────────────────────────────────────
function WorkspaceRail({ onAddRoom, onAddWorkspace, onCustomize, onCommunities }) {
    const { workspaces, activeWorkspaceId, setActiveWorkspaceId, setActiveChannelId, loadChannels, workspaceUnreadCounts } = useAxis();
    const [expanded, setExpanded] = useState(() => localStorage.getItem('axis_rail_expanded') === 'true');

    const rooms         = workspaces.filter(ws => ws.name !== 'Directs' && (ws.type === 'room' || ws.type === 'community'));
    const collaboration = workspaces.filter(ws => ws.name !== 'Directs' && ws.type !== 'room' && ws.type !== 'community');

    const toggleExpanded = () => {
        const next = !expanded;
        setExpanded(next);
        localStorage.setItem('axis_rail_expanded', String(next));
    };

    const openSpace = async (ws) => {
        const chs = await loadChannels(ws.id);
        const first = chs.find(ch => ch.type === 'text' || ch.type === 'system')
            || chs.find(ch => ch.type !== 'archive')
            || chs[0];
        setActiveWorkspaceId(ws.id);
        setActiveChannelId(first?.id || null);
    };

    const openAxisHome = () => {
        setActiveChannelId(null);
        setActiveWorkspaceId(null);
    };

    const W = expanded ? 220 : 60;

    const SpaceRow = ({ ws }) => {
        const active = ws.id === activeWorkspaceId;
        const unread = workspaceUnreadCounts?.[ws.id] || 0;
        const isRoom = ws.type === 'room' || ws.type === 'community';
        const icon = ws.avatar_url
            ? <img src={ws.avatar_url} alt={ws.name} style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }} />
            : isRoom
                ? <MessageCircle style={{ width: 15, height: 15, color: active ? '#c4b5fd' : '#71717a' }} />
                : <WorkspaceTypeIcon icon={ws.icon || 'workspace'} active={active} size={15} />;

        return (
            <button
                key={ws.id}
                onClick={() => openSpace(ws)}
                title={expanded ? undefined : ws.name}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: expanded ? 10 : 0, padding: expanded ? '6px 10px' : '6px 8px',
                    justifyContent: expanded ? 'flex-start' : 'center',
                    borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: active
                        ? 'linear-gradient(135deg, rgba(167,139,250,0.18), rgba(99,102,241,0.08))'
                        : 'transparent',
                    boxShadow: active ? '0 0 0 1px rgba(196,181,253,0.22)' : 'none',
                    transition: 'all 0.15s',
                    position: 'relative',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
                {/* Icon wrapper */}
                <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'rgba(167,139,250,0.14)' : 'rgba(255,255,255,0.05)',
                    position: 'relative',
                }}>
                    {icon}
                    {!active && unread > 0 && (
                        <div style={{
                            position: 'absolute', right: -3, top: -3, minWidth: 14, height: 14,
                            padding: unread > 9 ? '0 3px' : 0, borderRadius: 99,
                            background: '#818cf8', color: '#09090b', border: '2px solid #08090b',
                            fontSize: 7, fontWeight: 800, lineHeight: '10px', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontFamily: "'Geist Mono', monospace",
                        }}>
                            {unread > 9 ? '9+' : unread}
                        </div>
                    )}
                </div>
                {/* Name (only when expanded) */}
                {expanded && (
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div style={{
                            fontSize: 12.5, fontWeight: active ? 600 : 500,
                            color: active ? '#e8edf5' : '#71717a',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            transition: 'color 0.15s',
                        }}>{ws.name}</div>
                        {isRoom && (
                            <div style={{ fontSize: 9, color: '#3f3f46', fontFamily: "'Geist Mono', monospace", letterSpacing: '0.06em', marginTop: 1 }}>
                                {ws.type === 'community' ? 'COMMUNITY' : 'ROOM'}
                            </div>
                        )}
                    </div>
                )}
                {/* Unread badge on right when expanded */}
                {expanded && !active && unread > 0 && (
                    <div style={{
                        minWidth: 16, height: 16, padding: '0 4px', borderRadius: 99,
                        background: 'rgba(129,140,248,0.2)', color: '#818cf8',
                        fontSize: 9, fontWeight: 700, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontFamily: "'Geist Mono', monospace",
                    }}>
                        {unread > 9 ? '9+' : unread}
                    </div>
                )}
            </button>
        );
    };

    const SectionHead = ({ label }) => expanded ? (
        <div style={{
            padding: '10px 12px 4px',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: '#2d3548', fontFamily: "'Geist Mono', monospace",
        }}>{label}</div>
    ) : (
        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '6px 10px' }} />
    );

    return (
        <div style={{
            width: W, flexShrink: 0, background: '#07080b',
            borderRight: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', flexDirection: 'column',
            padding: expanded ? '10px 8px' : '10px 8px',
            gap: 2, overflowY: 'auto', overflowX: 'hidden',
            transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
        }}>
            {/* Home button */}
            <button onClick={openAxisHome} title={expanded ? undefined : 'Axis Home'}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: expanded ? 10 : 0, padding: expanded ? '6px 10px' : '6px 8px',
                    justifyContent: expanded ? 'flex-start' : 'center',
                    borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: !activeWorkspaceId ? 'rgba(167,139,250,0.14)' : 'transparent',
                    boxShadow: !activeWorkspaceId ? '0 0 0 1px rgba(196,181,253,0.2)' : 'none',
                    transition: 'all 0.15s', marginBottom: 2,
                }}
                onMouseEnter={e => { if (activeWorkspaceId) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { if (activeWorkspaceId) e.currentTarget.style.background = 'transparent'; }}
            >
                <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: !activeWorkspaceId ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.05)',
                }}>
                    <Home style={{ width: 15, height: 15, color: !activeWorkspaceId ? '#c4b5fd' : '#71717a' }} />
                </div>
                {expanded && (
                    <span style={{
                        fontSize: 12.5, fontWeight: !activeWorkspaceId ? 600 : 500,
                        color: !activeWorkspaceId ? '#e8edf5' : '#71717a',
                        whiteSpace: 'nowrap',
                    }}>Home</span>
                )}
            </button>

            {/* Rooms section */}
            <SectionHead label="Rooms" />
            {rooms.map(ws => <SpaceRow key={ws.id} ws={ws} />)}

            {/* Add room */}
            <button onClick={onAddRoom} title={expanded ? undefined : 'New Room'}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: expanded ? 10 : 0, padding: expanded ? '5px 10px' : '5px 8px',
                    justifyContent: expanded ? 'flex-start' : 'center',
                    borderRadius: 10, border: '1px dashed rgba(167,139,250,0.18)',
                    cursor: 'pointer', background: 'transparent', transition: 'all 0.15s', marginTop: 2,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(167,139,250,0.4)'; e.currentTarget.style.background = 'rgba(167,139,250,0.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(167,139,250,0.18)'; e.currentTarget.style.background = 'transparent'; }}
            >
                <div style={{ width: 32, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Plus style={{ width: 13, height: 13, color: '#6d5fa8' }} />
                </div>
                {expanded && <span style={{ fontSize: 11.5, color: '#6d5fa8', fontFamily: "'Geist Mono', monospace", letterSpacing: '0.04em' }}>Room</span>}
            </button>

            {/* Workspaces section */}
            {collaboration.length > 0 && <SectionHead label="Workspaces" />}
            {collaboration.map(ws => <SpaceRow key={ws.id} ws={ws} />)}

            {/* Add workspace */}
            <button onClick={onAddWorkspace} title={expanded ? undefined : 'New Workspace'}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: expanded ? 10 : 0, padding: expanded ? '5px 10px' : '5px 8px',
                    justifyContent: expanded ? 'flex-start' : 'center',
                    borderRadius: 10, border: '1px dashed rgba(167,139,250,0.18)',
                    cursor: 'pointer', background: 'transparent', transition: 'all 0.15s', marginTop: 2,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(167,139,250,0.4)'; e.currentTarget.style.background = 'rgba(167,139,250,0.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(167,139,250,0.18)'; e.currentTarget.style.background = 'transparent'; }}
            >
                <div style={{ width: 32, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Plus style={{ width: 13, height: 13, color: '#6d5fa8' }} />
                </div>
                {expanded && <span style={{ fontSize: 11.5, color: '#6d5fa8', fontFamily: "'Geist Mono', monospace", letterSpacing: '0.04em' }}>Workspace</span>}
            </button>

            <div style={{ flex: 1 }} />

            {/* Communities */}
            <button onClick={onCommunities} title={expanded ? undefined : 'Browse Communities'}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: expanded ? 10 : 0, padding: expanded ? '6px 10px' : '6px 8px',
                    justifyContent: expanded ? 'flex-start' : 'center',
                    borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'rgba(99,102,241,0.06)', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.13)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.06)'; }}
            >
                <div style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Globe2 style={{ width: 15, height: 15, color: '#c4b5fd' }} />
                </div>
                {expanded && <span style={{ fontSize: 12.5, color: '#a78bfa', fontWeight: 500 }}>Communities</span>}
            </button>

            {/* Collapse / expand toggle */}
            <button onClick={toggleExpanded}
                title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: expanded ? 10 : 0, padding: expanded ? '6px 10px' : '6px 8px',
                    justifyContent: expanded ? 'flex-start' : 'center',
                    borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'transparent', transition: 'all 0.15s', marginTop: 2,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
                <div style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <ChevronRight style={{
                        width: 14, height: 14, color: '#3f4a5c',
                        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
                    }} />
                </div>
                {expanded && <span style={{ fontSize: 11, color: '#3f4a5c', fontFamily: "'Geist Mono', monospace", letterSpacing: '0.06em' }}>COLLAPSE</span>}
            </button>
        </div>
    );
}

// ── Channel Sidebar ───────────────────────────────────────────────────────────
function ChannelSidebar({ onCreateCh, onCreateThread, onJoin, onGoHome, onNewProject, onOpenTasks, onSettings }) {
    const {
        channels, activeChannelId, setActiveChannelId, activeWorkspace,
        unreadCounts, mentionedChannels,
        projects, activeProjectId, setActiveProjectId,
        user,
    } = useAxis();
    const isCommunityWs  = activeWorkspace?.type === 'community';
    const isRoom         = activeWorkspace?.type === 'room' || activeWorkspace?.type === 'community';
    const isSpaceOwner   = !activeWorkspace || activeWorkspace.created_by === user?.id || activeWorkspace.created_by === 'system';
    const canCreateCh    = !isCommunityWs || isSpaceOwner;
    const canCreateProj  = !isRoom && (!isCommunityWs || isSpaceOwner);

    // Channels: when project active, show project channels; otherwise workspace-level channels
    const projectChs   = !isRoom && activeProjectId ? channels.filter(ch => ch.project_id === activeProjectId) : [];
    const workspaceChs = channels.filter(ch => !ch.project_id && ch.type !== 'dm');
    const visibleChs   = !isRoom && activeProjectId ? projectChs : workspaceChs;
    const textChs      = visibleChs.filter(ch => ch.type === 'text' || ch.type === 'system');
    const threadChs    = visibleChs.filter(ch => ch.type === 'thread');
    const ephemeralChs = visibleChs.filter(ch => ch.type === 'ephemeral' || ch.type === 'archive');

    useEffect(() => {
        if (isRoom && activeProjectId) setActiveProjectId(null);
    }, [isRoom, activeProjectId, setActiveProjectId]);

    const ChItem = ({ ch }) => {
        const TypeIcon    = CHANNEL_TYPE_ICON[ch.type] || Hash;
        const isActive    = ch.id === activeChannelId;
        const unread      = !isActive ? (unreadCounts[ch.id] || 0) : 0;
        const isMentioned = mentionedChannels.has(ch.id);
        const hasUnread   = unread > 0;
        return (
            <button key={ch.id} onClick={() => setActiveChannelId(ch.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-left
                    ${isActive  ? 'bg-white/8 text-zinc-100'
                    : hasUnread ? 'text-zinc-200 hover:bg-white/5'
                    :             'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}
            >
                {ch.icon
                    ? <span className="shrink-0 leading-none" style={{ fontSize: 13, width: 14, textAlign: 'center' }}>{ch.icon}</span>
                    : <TypeIcon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-zinc-300' : hasUnread ? 'text-zinc-400' : 'text-zinc-600'}`} />
                }
                <span className={`text-[13px] truncate flex-1 ${hasUnread ? 'font-semibold' : 'font-medium'}`}>{channelLabel(ch)}</span>
                {ch.is_private && !hasUnread && <Lock className="w-2.5 h-2.5 ml-auto text-zinc-700 shrink-0" />}
                {hasUnread && (
                    <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 min-w-[18px] text-center leading-none
                        ${isMentioned ? 'bg-amber-500/30 text-amber-300' : 'bg-white/15 text-zinc-300'}`}>
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
            </button>
        );
    };

    const SectionLabel = ({ label }) => (
        <div className="px-3 mb-0.5">
            <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">{label}</span>
        </div>
    );

    const SectionHeader = ({ label, onAdd, title }) => (
        <div className="px-3 mb-0.5 flex items-center justify-between">
            <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">{label}</span>
            {onAdd && (
                <button onClick={onAdd} title={title} className="p-0.5 rounded text-zinc-700 hover:text-zinc-400 transition-colors">
                    <Plus className="w-3 h-3" />
                </button>
            )}
        </div>
    );

    return (
        <div className="w-[220px] shrink-0 bg-[#0e0e10] border-r border-white/5 flex flex-col">
            <div className="px-4 py-3.5 border-b border-white/5 flex items-center justify-between shrink-0">
                <div className="min-w-0 flex items-center gap-1.5">
                    {isRoom ? <MessageCircle className="w-3.5 h-3.5 text-violet-300" /> : <WorkspaceTypeIcon icon={activeWorkspace?.icon || 'workspace'} active={true} size={14} />}
                    <h3 className="text-[13px] font-bold text-zinc-100 truncate">{activeWorkspace?.name || 'Loading…'}</h3>
                </div>
                <div className="flex items-center gap-0.5 ml-1">
                    <button onClick={onGoHome} title="Home" className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-all shrink-0">
                        <Home className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => onSettings?.(activeWorkspace)} title="Space settings" className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-all shrink-0">
                        <Settings className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2 px-1">
                {/* Projects section */}
                {!isRoom && (projects.length > 0 || canCreateProj) && (
                    <div className="mb-3">
                        <div className="px-3 mb-0.5 flex items-center justify-between">
                            <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">Projects</span>
                            {canCreateProj && (
                                <button onClick={onNewProject} title="New project" className="p-0.5 rounded text-zinc-700 hover:text-zinc-400 transition-colors">
                                    <Plus className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        {projects.map(p => {
                            const isActive = p.id === activeProjectId;
                            return (
                                <button key={p.id}
                                    onClick={() => setActiveProjectId(isActive ? null : p.id)}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-left
                                        ${isActive ? 'bg-indigo-500/15 text-indigo-200' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}
                                >
                                    <span className="text-[15px] shrink-0">{p.icon || '📁'}</span>
                                    <span className="text-[13px] truncate flex-1 font-medium">{p.name}</span>
                                    {isActive && (
                                        <button onClick={(e) => { e.stopPropagation(); onOpenTasks?.(p); }}
                                            title="Tasks" className="shrink-0 p-0.5 rounded text-indigo-400 hover:text-indigo-200 transition-colors">
                                            <CheckSquare className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                    {!isActive && <ChevronRight className="w-3 h-3 shrink-0 text-zinc-700" />}
                                </button>
                            );
                        })}
                        {projects.length === 0 && (
                            <button onClick={onNewProject} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-700 hover:text-zinc-500 hover:bg-white/5 transition-all text-left">
                                <Plus className="w-3.5 h-3.5" />
                                <span className="text-[12px]">New project</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Active project back row */}
                {!isRoom && activeProjectId && (
                    <div className="px-3 mb-1 flex items-center gap-1.5">
                        <Briefcase className="w-3 h-3 text-indigo-400 shrink-0" />
                        <span className="text-[10px] text-indigo-400 uppercase tracking-widest font-semibold truncate">
                            {projects.find(p => p.id === activeProjectId)?.name || 'Project'}
                        </span>
                    </div>
                )}

                {textChs.length > 0 && (
                    <div className="mb-2">
                        {!activeProjectId && <SectionHeader label="Channels" onAdd={canCreateCh ? onCreateCh : null} title="New channel" />}
                        {textChs.map(ch => <ChItem key={ch.id} ch={ch} />)}
                    </div>
                )}
                {isRoom && textChs.length === 0 && canCreateCh && (
                    <div className="mb-2">
                        <SectionHeader label="Channels" onAdd={onCreateCh} title="New channel" />
                        <button onClick={onCreateCh} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-700 hover:text-zinc-500 hover:bg-white/5 transition-all text-left">
                            <Plus className="w-3.5 h-3.5" />
                            <span className="text-[12px]">Create first channel</span>
                        </button>
                    </div>
                )}
                {isRoom && (
                    <div className="mb-2">
                        <SectionHeader label="Threads" onAdd={canCreateCh ? onCreateThread : null} title="New thread" />
                        {threadChs.length > 0
                            ? threadChs.map(ch => <ChItem key={ch.id} ch={ch} />)
                            : canCreateCh && <button onClick={onCreateThread} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-700 hover:text-zinc-500 hover:bg-white/5 transition-all text-left">
                                <MessageCircle className="w-3.5 h-3.5" />
                                <span className="text-[12px]">Start a thread</span>
                            </button>}
                    </div>
                )}
                {ephemeralChs.length > 0 && (
                    <div className="mb-2">
                        <SectionLabel label="Ephemeral" />
                        {ephemeralChs.map(ch => <ChItem key={ch.id} ch={ch} />)}
                    </div>
                )}
            </div>

            <div className="px-2 py-2 border-t border-white/5 space-y-0.5 shrink-0">
                {isCommunityWs && !isSpaceOwner && (
                    <div className="px-3 py-1.5 flex items-center gap-2">
                        <Lock className="w-3 h-3 text-zinc-700 shrink-0" />
                        <span className="text-[11px] text-zinc-700">Managed by owner</span>
                    </div>
                )}
                {canCreateCh && (
                    <button onClick={onCreateCh} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all text-left">
                        <Plus className="w-3.5 h-3.5" />
                        <span className="text-[12px]">New channel</span>
                    </button>
                )}
                {isRoom && canCreateCh && (
                    <button onClick={onCreateThread} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all text-left">
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span className="text-[12px]">New thread</span>
                    </button>
                )}
                <button onClick={onJoin} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-all text-left">
                    <LogOut className="w-3.5 h-3.5 rotate-180" />
                    <span className="text-[12px]">Join by code</span>
                </button>
            </div>
        </div>
    );
}

// ── Open Graph Link Previews ──────────────────────────────────────────────────
const PREVIEW_CACHE = new Map();

function LinkPreviewCard({ url }) {
    const [meta, setMeta] = useState(() => PREVIEW_CACHE.get(url) || null);
    const [loading, setLoading] = useState(!PREVIEW_CACHE.has(url));
    const [error, setError] = useState(false);

    useEffect(() => {
        if (meta || PREVIEW_CACHE.has(url)) return;

        let active = true;
        setLoading(true);
        fetch(`/api/axis/link-preview?url=${encodeURIComponent(url)}`)
            .then(res => {
                if (!res.ok) throw new Error('Failed to load link preview');
                return res.json();
            })
            .then(data => {
                if (active) {
                    PREVIEW_CACHE.set(url, data);
                    setMeta(data);
                }
            })
            .catch(() => {
                if (active) setError(true);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [url, meta]);

    if (loading) {
        return (
            <div className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-xl animate-pulse">
                <div className="w-12 h-12 bg-white/5 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-white/10 rounded w-1/3" />
                    <div className="h-3 bg-white/5 rounded w-2/3" />
                </div>
            </div>
        );
    }

    if (error || !meta || (!meta.title && !meta.description)) return null;

    const domain = meta.siteName || new URL(url).hostname;

    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col sm:flex-row border border-white/8 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/15 rounded-xl overflow-hidden transition-all duration-200 group text-left max-w-xl cursor-pointer"
        >
            {meta.image && (
                <div className="w-full sm:w-32 h-24 sm:h-auto shrink-0 relative bg-zinc-950 overflow-hidden border-b sm:border-b-0 sm:border-r border-white/5">
                    <img
                        src={meta.image}
                        alt=""
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e) => {
                            e.target.style.display = 'none';
                        }}
                    />
                </div>
            )}
            <div className="p-3.5 flex flex-col justify-center min-w-0 flex-1 gap-1">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider font-mono">
                    {domain}
                </span>
                {meta.title && (
                    <h4 className="text-[13px] font-bold text-zinc-100 line-clamp-1 group-hover:text-white transition-colors">
                        {meta.title}
                    </h4>
                )}
                {meta.description && (
                    <p className="text-[11.5px] text-zinc-400 line-clamp-2 leading-relaxed">
                        {meta.description}
                    </p>
                )}
            </div>
        </a>
    );
}

function LinkPreviews({ content }) {
    const urls = useMemo(() => {
        const matches = content.match(/(https?:\/\/[^\s]+)/g);
        if (!matches) return [];
        return matches.map(url => url.replace(/[.,;:!?]+$/, ''));
    }, [content]);

    if (!urls.length) return null;

    return (
        <div className="flex flex-col gap-2.5 mt-2 max-w-lg select-text">
            {urls.map((url, idx) => (
                <LinkPreviewCard key={idx} url={url} />
            ))}
        </div>
    );
}

// ── Message Group ─────────────────────────────────────────────────────────────
function MessageGroup({ group, onReact, onDelete, currentUserId, currentUserName, replySource, highlightedMessageId }) {
    const [hovering, setHovering]   = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editText, setEditText]   = useState('');
    const editRef                   = useRef(null);
    const { editMessage }           = useAxis();

    const hasMention = currentUserName && group.messages.some(m =>
        new RegExp(`@${currentUserName}`, 'i').test(m.content)
    );

    const startEdit = (msg) => {
        setEditingId(msg.id);
        setEditText(msg.content);
        setTimeout(() => { editRef.current?.focus(); editRef.current?.select(); }, 40);
    };

    const saveEdit = async () => {
        if (!editText.trim() || !editingId) return;
        await editMessage(editingId, editText.trim());
        setEditingId(null);
    };

    const cancelEdit = () => setEditingId(null);

    const MODE_BADGE = {
        whisper: { label: 'WHISPER', cls: 'text-red-400   bg-red-500/10   border-red-500/20'   },
        gossip:  { label: 'FADING',  cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    };

    return (
        <div
            className={`flex gap-3 px-5 py-0.5 hover:bg-white/[0.015] rounded-xl mx-1 transition-colors group
                ${hasMention ? 'border-l-2 border-amber-500/50 bg-amber-500/[0.025] pl-[18px]' : ''}`}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => { setHovering(false); }}
        >
            {/* Avatar column */}
            <div className="w-8 shrink-0 pt-0.5">
                {group.showHeader && (
                    <Avatar name={group.senderName} color={group.senderColor} isSoma={group.isSoma} />
                )}
            </div>

            {/* Content column */}
            <div className="flex-1 min-w-0">
                {group.showHeader && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                        <span className={`text-[13px] font-semibold ${c(group.senderColor, 'text')}`}>{group.senderName}</span>
                        <span className="text-[10px] text-zinc-600 font-mono">
                            {new Date(group.messages[0].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                )}

                {group.messages.map((msg) => {
                    const isOwn = msg.sender_id === currentUserId || msg.senderId === currentUserId;

                    return (
                        <div
                            key={msg.id}
                            data-axis-message-id={msg.id}
                            className={`relative rounded-lg transition-all duration-500 ${highlightedMessageId === msg.id ? 'bg-violet-500/12 ring-1 ring-violet-400/40 px-2 py-1 -mx-2' : ''}`}
                        >
                            {/* Reply context */}
                            {msg.reply_to && replySource?.[msg.reply_to] && (
                                <div className="flex items-center gap-1.5 mb-0.5 pl-3 border-l-2 border-white/10">
                                    <span className={`text-[10px] font-semibold ${c(replySource[msg.reply_to].sender_color, 'text')}`}>{replySource[msg.reply_to].sender_name}</span>
                                    <span className="text-[10px] text-zinc-600 truncate max-w-[200px]">{replySource[msg.reply_to].content}</span>
                                </div>
                            )}

                            {/* Edit mode */}
                            {editingId === msg.id ? (
                                <div className="flex flex-col gap-1.5 py-0.5 pr-4">
                                    <textarea
                                        ref={editRef}
                                        value={editText}
                                        onChange={e => setEditText(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                            if (e.key === 'Escape') cancelEdit();
                                        }}
                                        rows={2}
                                        className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-lg px-3 py-2 text-[13.5px] text-zinc-200 resize-none focus:outline-none"
                                    />
                                    <div className="flex items-center gap-2">
                                        <button onClick={saveEdit} className="px-3 py-1 bg-white text-black text-[11px] font-bold rounded-lg hover:bg-zinc-100 transition-colors">Save</button>
                                        <button onClick={cancelEdit} className="px-3 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                                        <span className="text-[10px] text-zinc-700">Enter to save · Esc to cancel</span>
                                    </div>
                                </div>
                            ) : (
                                <div className={`text-[13.5px] text-zinc-300 leading-relaxed pr-2
                                    ${msg.mode === 'whisper' ? 'italic opacity-80' : ''}
                                    ${msg.mode === 'gossip'  ? 'opacity-70'        : ''}`}>
                                    {renderContent(msg.content, currentUserName)}
                                    {msg.edited_at && (
                                        <span className="text-[9px] text-zinc-600 ml-1.5">(edited)</span>
                                    )}
                                    {MODE_BADGE[msg.mode] && (
                                        <span className={`ml-2 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border align-middle ${MODE_BADGE[msg.mode].cls}`}>
                                            {MODE_BADGE[msg.mode].label}
                                        </span>
                                    )}
                                    {msg.mode !== 'whisper' && <LinkPreviews content={msg.content} />}
                                </div>
                            )}

                            {/* Reactions */}
                            {Object.keys(msg.reactions || {}).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {Object.entries(msg.reactions).map(([emoji, users]) => (
                                        <button key={emoji} onClick={() => onReact(msg.id, emoji, users.includes(currentUserId))}
                                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-all
                                                ${users.includes(currentUserId) ? 'bg-white/10 border-white/20 text-zinc-200' : 'bg-white/4 border-white/8 text-zinc-400 hover:bg-white/8'}`}>
                                            {emoji} <span className="font-semibold text-[10px]">{users.length}</span>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Hover toolbar */}
                            {hovering && editingId !== msg.id && (
                                <div className="absolute right-0 -top-1 flex items-center gap-0.5 bg-[#1c1c1f] border border-white/10 rounded-lg p-0.5 shadow-xl z-10">
                                    {QUICK_EMOJIS.map(em => (
                                        <button key={em} onClick={() => onReact(msg.id, em, (msg.reactions?.[em] || []).includes(currentUserId))}
                                            className="w-6 h-6 flex items-center justify-center rounded text-sm hover:bg-white/10 transition-colors">
                                            {em}
                                        </button>
                                    ))}
                                    <div className="w-px h-4 bg-white/10 mx-0.5" />
                                    {isOwn && (
                                        <button onClick={() => startEdit(msg)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-200 transition-colors" title="Edit">
                                            <Pencil className="w-3 h-3" />
                                        </button>
                                    )}
                                    {isOwn && (
                                        <button onClick={() => onDelete(msg.id)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors" title="Delete">
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── SOMA typing indicator ─────────────────────────────────────────────────────
function SomaTyping() {
    return (
        <div style={{ display: 'flex', gap: 10, padding: '6px 20px', margin: '0 4px', animation: 'ax-fadeUp 0.2s ease' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700, fontFamily: "'Geist Mono', monospace", flexShrink: 0, marginTop: 2, boxShadow: '0 0 12px rgba(167,139,250,0.4)', animation: 'ax-pulse 1.5s ease-in-out infinite' }}>◎</div>
            <div style={{ padding: '8px 12px', borderRadius: '8px 8px 8px 2px', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: '#a78bfa', animation: `ax-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
                <span style={{ fontSize: 9, color: '#a78bfa', fontFamily: "'Geist Mono', monospace", marginLeft: 4, letterSpacing: '0.05em' }}>reading context…</span>
            </div>
        </div>
    );
}

// ── Chat Area ─────────────────────────────────────────────────────────────────
function ChatArea({ onInvite, showMembers, onToggleMembers, onSearch, showContext, onToggleContext, onOpenProfile }) {
    const { messages, somaTyping, sendMessage, deleteMessage, reactToMessage, activeChannel, activeChannelId, setActiveChannelId, user, members, loadMoreMessages, sendTyping, typingUsers } = useAxis();
    const [hasMore, setHasMore]       = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [input, setInput]           = useState('');
    const [mode, setMode]             = useState('archive');
    const [gossipIdx, setGossipIdx]   = useState(0);
    const [replyTo, setReplyTo]       = useState(null);
    const [cmdHint, setCmdHint]       = useState(null);
    const lastTypingRef               = useRef(0);
    const [mentionSearch, setMentionSearch] = useState(null);
    const [mentionIdx, setMentionIdx]   = useState(0);
    const [composerEmoji, setComposerEmoji] = useState(false);
    const [recentEmoji, setRecentEmoji]     = useState(() => { try { return JSON.parse(localStorage.getItem('ax_recent_emoji') || '[]'); } catch { return []; } });
    const [highlightedMessageId, setHighlightedMessageId] = useState(null);
    const scrollRef                   = useRef(null);
    const textareaRef                 = useRef(null);

    const addRecentEmoji = useCallback((e) => {
        setRecentEmoji(prev => {
            const next = [e, ...prev.filter(x => x !== e)].slice(0, 18);
            localStorage.setItem('ax_recent_emoji', JSON.stringify(next));
            return next;
        });
    }, []);

    const insertEmoji = useCallback((e) => {
        addRecentEmoji(e);
        setInput(v => v + e);
        setComposerEmoji(false);
        textareaRef.current?.focus();
    }, [addRecentEmoji]);

    const gossipMs    = GOSSIP_STEPS[gossipIdx];
    const gossipLabel = GOSSIP_LABELS[gossipIdx];
    const cycleGossip = () => setGossipIdx(i => (i + 1) % GOSSIP_STEPS.length);

    // @mention autocomplete
    const filteredMembers = useMemo(() => {
        if (!mentionSearch) return [];
        const q = mentionSearch.query.toLowerCase();
        // Include SOMA + real members
        const all = [{ user_name: 'soma', user_color: 'violet' }, ...members.filter(m => m.user_id !== user?.id)];
        return all.filter(m => m.user_name.toLowerCase().includes(q)).slice(0, 6);
    }, [mentionSearch, members, user?.id]);

    const completeMention = useCallback((memberName) => {
        if (!mentionSearch || !textareaRef.current) return;
        const before = input.slice(0, mentionSearch.start);
        const after  = input.slice(textareaRef.current.selectionStart);
        const newVal = before + '@' + memberName + ' ' + after;
        setInput(newVal);
        setMentionSearch(null);
        setTimeout(() => {
            const pos = before.length + memberName.length + 2;
            textareaRef.current?.setSelectionRange(pos, pos);
            textareaRef.current?.focus();
        }, 0);
    }, [input, mentionSearch]);

    // Message grouping
    const groups = useMemo(() => {
        const result = [];
        let cur = null;
        for (const msg of messages) {
            const sameUser = cur && (cur.senderId === (msg.sender_id || msg.senderId));
            const recent   = cur && ((msg.created_at - cur.lastAt) < 5 * 60 * 1000);
            const sameMode = cur && cur.mode === msg.mode;
            if (sameUser && recent && sameMode) {
                cur.messages.push(msg); cur.lastAt = msg.created_at;
            } else {
                cur = {
                    senderId:    msg.sender_id   || msg.senderId,
                    senderName:  msg.sender_name || msg.senderName,
                    senderColor: msg.sender_color || msg.senderColor || 'blue',
                    isSoma:      !!(msg.is_soma),
                    mode:        msg.mode,
                    lastAt:      msg.created_at,
                    messages:    [msg],
                    showHeader:  true,
                };
                result.push(cur);
            }
        }
        return result;
    }, [messages]);

    const replySource = useMemo(() => {
        const map = {};
        messages.forEach(m => { map[m.id] = m; });
        return map;
    }, [messages]);

    // Reset hasMore when channel changes
    useEffect(() => { setHasMore(true); }, [activeChannelId]);

    // WebSocket chimes and native push notifications
    useEffect(() => {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        const handleMsg = (msg) => {
            const senderId = msg.sender_id || msg.senderId;
            if (senderId === user?.id) return;

            const content = msg.content || '';
            const isSoma = senderId === 'soma' || msg.is_soma;
            const myName = user?.name || '';
            const isMention = myName && content.toLowerCase().includes(`@${myName.toLowerCase()}`);
            const isDM = activeChannel?.type === 'dm';

            if (isMention || isDM) {
                AxisAudio.playMention();
                if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                    const title = isDM ? `Direct message from ${msg.sender_name || 'Someone'}` : `@${myName} mentioned you in Axis`;
                    new Notification(title, {
                        body: content.slice(0, 100),
                        icon: '/favicon.ico',
                    });
                }
            } else if (isSoma) {
                AxisAudio.playSoma();
            } else {
                const msgChannelId = msg.channel_id || msg.channelId;
                if (msgChannelId === activeChannelId) {
                    AxisAudio.playMessage();
                }
            }
        };

        somaBackend.on('axis.message', handleMsg);
        return () => {
            somaBackend.off('axis.message', handleMsg);
        };
    }, [user, activeChannelId, activeChannel]);

    // Unlock AudioContext on first user click
    useEffect(() => {
        const unlock = () => {
            AxisAudio.playUI();
            window.removeEventListener('click', unlock);
        };
        window.addEventListener('click', unlock);
        return () => window.removeEventListener('click', unlock);
    }, []);

    useEffect(() => {
        const handler = (event) => {
            const { channelId, messageId } = event.detail || {};
            if (!messageId) return;
            localStorage.setItem('axis:pending-message', JSON.stringify({ channelId, messageId }));
            if (channelId && channelId !== activeChannelId) setActiveChannelId(channelId);
        };
        window.addEventListener('axis:jump-message', handler);
        return () => window.removeEventListener('axis:jump-message', handler);
    }, [activeChannelId, setActiveChannelId]);

    useEffect(() => {
        let pending = null;
        try { pending = JSON.parse(localStorage.getItem('axis:pending-message') || 'null'); } catch {}
        if (!pending?.messageId || (pending.channelId && pending.channelId !== activeChannelId)) return;

        const el = scrollRef.current?.querySelector(`[data-axis-message-id="${pending.messageId}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedMessageId(pending.messageId);
        localStorage.removeItem('axis:pending-message');
        const timeout = setTimeout(() => setHighlightedMessageId(null), 2600);
        return () => clearTimeout(timeout);
    }, [messages, activeChannelId]);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (scrollRef.current) {
            const el   = scrollRef.current;
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
            if (near) el.scrollTop = el.scrollHeight;
        }
    }, [messages, somaTyping]);

    // Upward scroll → load more
    const handleScroll = useCallback(async () => {
        const el = scrollRef.current;
        if (!el || el.scrollTop > 120 || loadingMore || !hasMore || messages.length === 0) return;
        const prevHeight = el.scrollHeight;
        setLoadingMore(true);
        const more = await loadMoreMessages(activeChannelId, messages[0]?.id);
        setHasMore(more);
        setLoadingMore(false);
        // Maintain scroll position after prepend
        requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
    }, [loadingMore, hasMore, messages, activeChannelId, loadMoreMessages]);

    // Slash command hint
    useEffect(() => {
        if (input.startsWith('/')) {
            const q = input.slice(1).toLowerCase();
            const CMDS = [
                { cmd: '/ask',       hint: '/ask [question] — ask SOMA directly' },
                { cmd: '/whisper',   hint: '/whisper [text] — send an ephemeral whisper' },
                { cmd: '/invite',    hint: '/invite — show invite code' },
                { cmd: '/summarize', hint: '/summarize — ask SOMA to summarize recent chat' },
            ];
            setCmdHint(CMDS.find(cmd => cmd.cmd.includes(q)) || null);
        } else {
            setCmdHint(null);
        }
    }, [input]);

    const handleInputChange = (e) => {
        const val = e.target.value;
        setInput(val);
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';

        // Typing broadcast (throttled 2s, skip in whisper mode)
        if (!isWhisper && val.trim()) {
            const now = Date.now();
            if (now - lastTypingRef.current > 2000) {
                lastTypingRef.current = now;
                sendTyping(activeChannelId);
            }
        }

        // @mention autocomplete detection
        const cursor = e.target.selectionStart;
        const before = val.slice(0, cursor);
        const match  = before.match(/@(\w*)$/);
        if (match) {
            setMentionSearch({ query: match[1], start: cursor - match[0].length });
            setMentionIdx(0);
        } else {
            setMentionSearch(null);
        }
    };

    const handleSend = useCallback(() => {
        const text = input.trim();
        if (!text) return;

        if (text.startsWith('/whisper ')) {
            sendMessage(text.slice(9).trim(), { mode: 'whisper' });
        } else if (text === '/invite') {
            onInvite();
        } else if (text.startsWith('/ask ')) {
            sendMessage('@soma ' + text.slice(5).trim(), { mode: 'archive', replyTo: replyTo?.id });
        } else if (text === '/summarize') {
            sendMessage('@soma Please summarize the recent conversation in this channel.', { mode: 'archive' });
        } else {
            const msgMode = mode === 'whisper' ? 'whisper' : gossipMs > 0 ? 'gossip' : 'archive';
            sendMessage(text, { mode: msgMode, replyTo: replyTo?.id, gossipMs: gossipMs || null });
        }

        setInput('');
        setReplyTo(null);
        setMentionSearch(null);
        if (textareaRef.current) { textareaRef.current.style.height = '36px'; }
        if (mode === 'whisper') setMode('archive');
    }, [input, mode, gossipMs, replyTo, sendMessage, onInvite]);

    const handleKeyDown = (e) => {
        // @mention dropdown navigation
        if (mentionSearch && filteredMembers.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % filteredMembers.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIdx(i => (i - 1 + filteredMembers.length) % filteredMembers.length); return; }
            if (e.key === 'Tab' || (e.key === 'Enter' && filteredMembers[mentionIdx])) {
                e.preventDefault();
                completeMention(filteredMembers[mentionIdx].user_name);
                return;
            }
            if (e.key === 'Escape') { setMentionSearch(null); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const ChannelTypeIcon = CHANNEL_TYPE_ICON[activeChannel?.type] || Hash;
    const ChannelIconEl = activeChannel?.icon
        ? ({ className }) => <span className={className} style={{ fontSize: 15, lineHeight: 1 }}>{activeChannel.icon}</span>
        : ChannelTypeIcon;

    if (!activeChannel) return (
        <div className="flex-1 flex items-center justify-center bg-[#09090b] text-zinc-600 text-sm">
            Select a channel to start
        </div>
    );

    const isWhisper = mode === 'whisper';

    return (
        <div className="flex-1 flex flex-col bg-[#09090b] min-w-0 relative">
            {/* Header */}
            <div className="h-[52px] shrink-0 border-b border-white/5 flex items-center px-4 gap-3 bg-[#0c0c0e]/80 backdrop-blur-sm">
                <ChannelIconEl className="w-4 h-4 text-zinc-500 shrink-0" />
                <h2 className="text-sm font-bold text-zinc-100 truncate">{channelLabel(activeChannel)}</h2>
                {activeChannel.description && <span className="text-xs text-zinc-600 hidden md:block truncate">— {activeChannel.description}</span>}
                <div className="ml-auto flex items-center gap-1">
                    <button onClick={onSearch} title="Search (Ctrl+F)" className="p-1.5 rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-300 transition-all">
                        <Search className="w-4 h-4" />
                    </button>
                    <button onClick={onInvite} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-all border border-transparent hover:border-white/8">
                        <UserPlus className="w-3.5 h-3.5" /> Invite
                    </button>
                    <button onClick={onToggleMembers} title="Toggle members" className={`p-1.5 rounded-lg transition-all ${showMembers ? 'bg-white/8 text-zinc-200' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}>
                        <Users className="w-4 h-4" />
                    </button>
                    <button onClick={onToggleContext} title="Toggle context pane" className={`p-1.5 rounded-lg transition-all ${showContext ? 'text-[#818cf8] bg-[rgba(99,102,241,0.12)]' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}>
                        <BookOpen className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-4 space-y-0.5 scroll-smooth">
                {loadingMore && (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                        <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1', animation: 'spin 0.7s linear infinite' }} />
                    </div>
                )}
                {!hasMore && messages.length > 0 && (
                    <div style={{ textAlign: 'center', padding: '6px 0 2px', fontSize: 9, color: '#2d3142', fontFamily: "'Geist Mono', monospace", letterSpacing: '0.1em' }}>— beginning of history —</div>
                )}
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-48 text-zinc-700 gap-2">
                        <ChannelIconEl className="w-10 h-10 opacity-20" />
                        <p className="text-sm">No messages yet</p>
                        <p className="text-xs">Be the first to say something — or type <code className="px-1 py-0.5 bg-white/5 rounded text-zinc-500">@soma</code> to bring SOMA in</p>
                    </div>
                )}
                {groups.map((group, gi) => (
                    <MessageGroup
                        key={`g-${gi}`}
                        group={group}
                        onReact={reactToMessage}
                        onDelete={deleteMessage}
                        currentUserId={user?.id}
                        currentUserName={user?.name}
                        replySource={replySource}
                        highlightedMessageId={highlightedMessageId}
                    />
                ))}
                {somaTyping && <SomaTyping />}
            </div>

            {/* @mention autocomplete dropdown */}
            {mentionSearch && filteredMembers.length > 0 && (
                <div className="absolute bottom-[72px] left-4 bg-[#0e0e11]/90 backdrop-blur-md border border-white/10 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] z-20 w-64 p-1 flex flex-col gap-0.5 max-h-72 overflow-y-auto">
                    <div className="px-2.5 py-1.5 text-[9px] text-zinc-500 uppercase tracking-widest font-semibold border-b border-white/5 mb-1 select-none">
                        Mentions
                    </div>
                    {filteredMembers.map((m, i) => (
                        <button
                            key={m.user_name}
                            onClick={() => completeMention(m.user_name)}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-all ${
                                i === mentionIdx 
                                    ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/30' 
                                    : 'hover:bg-white/5 text-zinc-300 border border-transparent'
                            }`}
                        >
                            <Avatar name={m.user_name} color={m.user_color} size="sm" isSoma={m.user_name === 'soma'} />
                            <span className="text-[13px] font-medium flex-1 truncate">{m.user_name}</span>
                            {i === mentionIdx && (
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* Typing indicator */}
            {(() => {
                const typers = Object.values(typingUsers?.[activeChannelId] || {});
                if (!typers.length) return null;
                const label = typers.length === 1
                    ? `${typers[0].name} is typing…`
                    : typers.length === 2
                        ? `${typers[0].name} and ${typers[1].name} are typing…`
                        : `${typers.length} people are typing…`;
                return (
                    <div style={{ padding: '0 16px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                            {[0,1,2].map(i => (
                                <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: '#52525b', animation: `ax-pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />
                            ))}
                        </div>
                        <span style={{ fontSize: 11, color: '#52525b', fontStyle: 'italic' }}>{label}</span>
                    </div>
                );
            })()}

            {/* Reply banner */}
            {replyTo && (
                <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-1.5 bg-white/4 border border-white/8 rounded-lg">
                    <span className="text-[11px] text-zinc-400">Replying to <span className={`font-semibold ${c(replyTo.sender_color, 'text')}`}>{replyTo.sender_name}</span></span>
                    <span className="text-[11px] text-zinc-600 truncate flex-1">{replyTo.content?.slice(0, 60)}</span>
                    <button onClick={() => setReplyTo(null)} className="text-zinc-600 hover:text-zinc-300"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            {/* Slash command hint */}
            {cmdHint && (
                <div className="mx-4 mb-1 px-3 py-1.5 bg-white/4 border border-white/8 rounded-lg">
                    <span className="text-[11px] text-zinc-400 font-mono">{cmdHint.hint}</span>
                </div>
            )}

            {/* Input bar */}
            <div className="px-4 pb-4 shrink-0">
                <div className={`flex items-end gap-2 rounded-2xl border transition-all p-2 ${isWhisper ? 'bg-red-500/5 border-red-500/20' : 'bg-white/[0.04] border-white/8 focus-within:border-white/15'}`} style={{ position: 'relative' }}>
                    {/* Emoji picker */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                        <button onClick={() => setComposerEmoji(o => !o)}
                            title="Emoji"
                            className={`p-2 rounded-xl transition-all ${composerEmoji ? 'text-[#818cf8] bg-[rgba(99,102,241,0.12)]' : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-300'}`}>
                            <Smile className="w-4 h-4" />
                        </button>
                        {composerEmoji && (
                            <EmojiPickerPanel
                                recentEmoji={recentEmoji}
                                onSelect={insertEmoji}
                                onClose={() => setComposerEmoji(false)}
                                placement="top"
                            />
                        )}
                    </div>
                    <button onClick={() => setMode(m => m === 'whisper' ? 'archive' : 'whisper')}
                        title="Whisper mode — never stored"
                        className={`p-2 rounded-xl transition-all shrink-0 ${isWhisper ? 'bg-red-500/20 text-red-400' : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-300'}`}>
                        <Lock className="w-4 h-4" />
                    </button>

                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder={isWhisper ? 'Whisper (never stored, never logged)…' : activeChannel?.type === 'dm' ? `Direct ${channelLabel(activeChannel)}` : `Message #${channelLabel(activeChannel)}`}
                        rows={1}
                        className="flex-1 bg-transparent text-[13.5px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none resize-none py-1.5 px-1 leading-relaxed"
                        style={{ minHeight: '36px', maxHeight: '120px' }}
                    />

                    {!isWhisper && (
                        <button onClick={cycleGossip} title="Gossip mode — message auto-deletes"
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px] font-bold transition-all shrink-0 ${gossipIdx > 0 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20' : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-400'}`}>
                            <Eye className="w-3.5 h-3.5" />
                            {gossipLabel && <span>{gossipLabel}</span>}
                        </button>
                    )}

                    <button onClick={handleSend} disabled={!input.trim()}
                        className="p-2 bg-zinc-100 text-zinc-900 rounded-xl hover:bg-white active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed transition-all shrink-0">
                        <Send className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex items-center gap-3 mt-1.5 px-1">
                    {isWhisper && <span className="text-[10px] text-red-400/70">🔴 Whisper — only broadcast, never stored</span>}
                    {gossipIdx > 0 && !isWhisper && <span className="text-[10px] text-amber-400/70">🟡 Gossip — auto-deletes in {gossipLabel}</span>}
                    {!isWhisper && gossipIdx === 0 && <span className="text-[10px] text-zinc-700">Enter to send · Shift+Enter for new line · @soma to summon · Ctrl+F to search</span>}
                </div>
            </div>
        </div>
    );
}

// ── Members Pane ──────────────────────────────────────────────────────────────
function MembersPane({ channelId, onInvite }) {
    const { members, user, removeMember, loadMembers, onlineUsers } = useAxis();

    useEffect(() => { if (channelId) loadMembers(channelId); }, [channelId, loadMembers]);

    const realMembers = members.filter(m => m.user_id !== 'soma' && m.user_id !== 'system');

    return (
        <div className="w-[240px] shrink-0 bg-[#0a0a0c] border-l border-white/5 flex flex-col">
            <div className="px-4 py-3.5 border-b border-white/5 shrink-0">
                <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Members — {realMembers.length + 1}</h3>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {/* SOMA always first */}
                <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
                    <div className="relative shrink-0">
                        <Avatar name="SOMA" color="violet" isSoma size="sm" />
                        <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-violet-400 border-2 border-[#0a0a0c]" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-violet-400 truncate">SOMA</span>
                            <span className="text-[9px] bg-violet-500/20 text-violet-400 px-1.5 rounded-full border border-violet-500/20 font-bold uppercase tracking-wider">AI</span>
                        </div>
                        <span className="text-[10px] text-zinc-600">Always present</span>
                    </div>
                </div>

                {realMembers.length > 0 && <div className="w-full h-px bg-white/4 my-1" />}

                {realMembers.map(m => {
                    const isMe     = m.user_id === user?.id;
                    const isOnline = onlineUsers?.has(m.user_id) || isMe;
                    return (
                        <div key={m.user_id} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/4 group transition-colors">
                            <div className="relative shrink-0">
                                <Avatar name={m.user_name} color={m.user_color} size="sm" />
                                {isOnline && (
                                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0a0a0c]" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                    <span className={`text-[13px] font-medium truncate ${c(m.user_color, 'text')}`}>{m.user_name}</span>
                                    {isMe && <span className="text-[9px] text-zinc-600 font-medium">(you)</span>}
                                    {m.role === 'admin' && <span className="text-[9px] text-amber-400/70">★</span>}
                                </div>
                            </div>
                            {!isMe && (
                                <button onClick={() => removeMember(channelId, m.user_id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0">
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    );
                })}

                {realMembers.length === 0 && (
                    <div className="px-2 py-4 text-center">
                        <p className="text-[11px] text-zinc-600">Just you and SOMA</p>
                    </div>
                )}
            </div>

            <div className="p-3 border-t border-white/5 shrink-0">
                <button onClick={onInvite} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white/5 border border-white/8 hover:bg-white/8 hover:border-white/15 text-zinc-400 hover:text-zinc-200 transition-all text-xs font-semibold">
                    <UserPlus className="w-3.5 h-3.5" /> Invite People
                </button>
            </div>
        </div>
    );
}

// ── User badge ────────────────────────────────────────────────────────────────
function UserBadge({ onOpenSelfProfile }) {
    const { user, setupUser, AXIS_COLORS } = useAxis();
    const [showColors, setShowColors] = useState(false);
    if (!user) return null;
    return (
        <div style={{ position: 'relative', flexShrink: 0 }}>
            {showColors && (
                <div style={{
                    position: 'absolute', bottom: '100%', left: 0, right: 0,
                    background: '#111318', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, padding: '10px 12px', margin: '0 6px 4px',
                    animation: 'ax-appear 0.15s ease', zIndex: 200,
                }}>
                    <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.14em', color: '#2d3142', fontFamily: "'Geist Mono', monospace", marginBottom: 8, textTransform: 'uppercase' }}>Axis Color</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {AXIS_COLORS.map(col => (
                            <button key={col}
                                onClick={() => { setupUser(user.name, col); setShowColors(false); }}
                                title={col}
                                style={{ width: 22, height: 22, borderRadius: 6, background: AVATAR_HEX[col], border: col === user.color ? '2px solid white' : '2px solid transparent', cursor: 'pointer', transform: col === user.color ? 'scale(1.15)' : 'scale(1)', transition: 'all 0.12s' }} />
                        ))}
                    </div>
                </div>
            )}
            <div className="px-3 py-2.5 border-t border-white/5 flex items-center gap-2.5 bg-[#0e0e10]"
                style={{ cursor: 'pointer' }} onClick={onOpenSelfProfile} title="View your profile">
                <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
                <div className="flex-1 min-w-0">
                    <p className={`text-[12px] font-semibold truncate ${c(user.color, 'text')}`}>{user.name}</p>
                    <p className="text-[10px] text-zinc-600">{user.role || 'Online'}</p>
                </div>
                <button
                    onClick={e => { e.stopPropagation(); setShowColors(v => !v); }}
                    title="Change color"
                    style={{ width: 10, height: 10, borderRadius: '50%', background: AVATAR_HEX[user.color] || '#6366f1', border: showColors ? '2px solid white' : '1.5px solid rgba(255,255,255,0.25)', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}
                />
            </div>
        </div>
    );
}

// ── Axis Home ─────────────────────────────────────────────────────────────────
// ── Community Home (post feed for community workspaces) ───────────────────────
function CommunityHome({ workspace, hdrs }) {
    const [posts,      setPosts]      = useState([]);
    const [community,  setCommunity]  = useState(null);
    const [newPost,    setNewPost]    = useState('');
    const [postImage,  setPostImage]  = useState('');
    const [posting,    setPosting]    = useState(false);
    const [expanded,   setExpanded]   = useState(null); // postId with open comments
    const [comments,   setComments]   = useState({});    // { [postId]: [...] }
    const [newComment, setNewComment] = useState('');
    const [commentBusy, setCommentBusy] = useState(false);
    const textRef = useRef(null);

    const wsId = workspace?.community_id || workspace?.id;

    useEffect(() => {
        if (!wsId) return;
        fetch(`/api/axis/communities/${wsId}`, { headers: hdrs() })
            .then(r => r.json())
            .then(d => { if (d.ok) setCommunity(d.community); })
            .catch(() => {});
        fetch(`/api/axis/communities/${wsId}/posts`, { headers: hdrs() })
            .then(r => r.json())
            .then(d => { if (d.ok) setPosts(d.posts); })
            .catch(() => {});
    }, [wsId]); // eslint-disable-line

    const createPost = async () => {
        if (!newPost.trim() || posting || !wsId) return;
        setPosting(true);
        try {
            const r = await fetch(`/api/axis/communities/${wsId}/posts`, {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ content: newPost.trim(), images: postImage.trim() ? [postImage.trim()] : [] }),
            });
            const d = await r.json();
            if (d.ok) { setPosts(prev => [d.post, ...prev]); setNewPost(''); setPostImage(''); }
        } catch {} finally { setPosting(false); }
    };

    const toggleLike = async (post) => {
        const liked = post.hasLiked;
        const url   = `/api/axis/communities/${wsId}/posts/${post.id}/like`;
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, hasLiked: !liked, likes_count: (p.likes_count || 0) + (liked ? -1 : 1) } : p));
        try {
            await fetch(url, { method: liked ? 'DELETE' : 'POST', headers: hdrs() });
        } catch {}
    };

    const loadComments = async (postId) => {
        if (expanded === postId) { setExpanded(null); return; }
        setExpanded(postId);
        if (comments[postId]) return;
        const r = await fetch(`/api/axis/communities/${wsId}/posts/${postId}/comments`, { headers: hdrs() });
        const d = await r.json();
        if (d.ok) setComments(prev => ({ ...prev, [postId]: d.comments }));
    };

    const addComment = async (postId) => {
        if (!newComment.trim() || commentBusy) return;
        setCommentBusy(true);
        try {
            const r = await fetch(`/api/axis/communities/${wsId}/posts/${postId}/comments`, {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ content: newComment.trim() }),
            });
            const d = await r.json();
            if (d.ok) {
                setComments(prev => ({ ...prev, [postId]: [...(prev[postId] || []), d.comment] }));
                setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p));
                setNewComment('');
            }
        } catch {} finally { setCommentBusy(false); }
    };

    return (
        <div style={{ flex: 1, overflowY: 'auto', background: '#08090b', padding: '24px 28px 52px' }}>
            <div style={{ maxWidth: 980, margin: '0 auto' }}>

                {/* Header */}
                <div style={{ marginBottom: 24, padding: 18, borderRadius: 18, border: '1px solid rgba(255,255,255,0.06)', background: 'linear-gradient(135deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018))', overflow: 'hidden', position: 'relative' }}>
                    {(community?.cover_image || workspace?.avatar_url) && (
                        <img src={community?.cover_image || workspace?.avatar_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.18 }} />
                    )}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18 }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                {workspace?.icon && workspace.icon !== 'message' && (
                                    <span style={{ fontSize: 24 }}>{workspace.icon}</span>
                                )}
                                <h1 style={{ fontSize: 20, fontWeight: 800, color: '#f4f4f5', margin: 0 }}>{workspace?.name}</h1>
                            </div>
                            <p style={{ fontSize: 12, color: '#a1a1aa', margin: 0, maxWidth: 620, lineHeight: 1.55 }}>{community?.description || workspace?.description}</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 10, color: '#c4b5fd', border: '1px solid rgba(196,181,253,0.18)', background: 'rgba(167,139,250,0.08)', borderRadius: 999, padding: '4px 8px', fontFamily: "'Geist Mono', monospace" }}>{community?.category || 'Community'}</span>
                                {(community?.tags || []).slice(0, 5).map(tag => (
                                    <span key={tag} style={{ fontSize: 10, color: '#71717a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: '4px 8px', fontFamily: "'Geist Mono', monospace" }}>#{tag}</span>
                                ))}
                            </div>
                        </div>
                        <div style={{ minWidth: 120, textAlign: 'right', color: '#71717a', fontSize: 10, fontFamily: "'Geist Mono', monospace" }}>
                            <div>{(community?.member_count || 0).toLocaleString()} members</div>
                            <div style={{ marginTop: 4 }}>{community?.post_count || posts.length} posts</div>
                            <div style={{ marginTop: 4 }}>score {community?.merit_score || 0}</div>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 18, alignItems: 'start' }}>
                <div>
                {/* Create post */}
                <div style={{ background: '#0c0d10', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 14, marginBottom: 20 }}>
                    <textarea
                        ref={textRef}
                        value={newPost}
                        onChange={e => setNewPost(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) createPost(); }}
                        placeholder="Share something with this community…"
                        rows={3}
                        style={{ width: '100%', background: 'transparent', border: 'none', color: '#e4e4e7', fontSize: 13, lineHeight: 1.5, outline: 'none', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    <input
                        value={postImage}
                        onChange={e => setPostImage(e.target.value)}
                        placeholder="Optional image URL"
                        style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)', color: '#a1a1aa', fontSize: 12, outline: 'none', borderRadius: 9, padding: '7px 10px', fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                        <button onClick={createPost} disabled={!newPost.trim() || posting}
                            style={{ padding: '6px 16px', borderRadius: 8, background: newPost.trim() && !posting ? '#6366f1' : 'rgba(99,102,241,0.2)', border: 'none', color: newPost.trim() && !posting ? '#fff' : '#818cf8', fontSize: 12, fontWeight: 600, cursor: newPost.trim() && !posting ? 'pointer' : 'default', transition: 'all 0.12s' }}
                        >
                            {posting ? 'Posting…' : 'Post'}
                        </button>
                    </div>
                </div>

                {/* Posts feed */}
                {posts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '48px 0', color: '#3f3f46' }}>
                        <Globe2 style={{ width: 28, height: 28, margin: '0 auto 10px', display: 'block', opacity: 0.3 }} />
                        <p style={{ fontSize: 13 }}>No posts yet — be the first to share something</p>
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {posts.map(post => (
                        <div key={post.id} style={{ background: '#0c0d10', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 14, overflow: 'hidden' }}>
                            <div style={{ padding: '14px 16px' }}>
                                {/* Author row */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#818cf8' }}>{(post.author_name || '?')[0].toUpperCase()}</span>
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: '#d4d4d8' }}>{post.author_name}</span>
                                        <span style={{ fontSize: 10, color: '#3f3f46', marginLeft: 8 }}>{tAgo(post.created_at)}</span>
                                    </div>
                                </div>
                                {/* Content */}
                                <p style={{ fontSize: 13.5, color: '#e4e4e7', lineHeight: 1.55, margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>{post.content}</p>
                                {Array.isArray(post.images) && post.images.length > 0 && (
                                    <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                                        {post.images.map((src, i) => (
                                            <img key={`${post.id}-img-${i}`} src={src} alt="" style={{ width: '100%', maxHeight: 420, objectFit: 'cover', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }} />
                                        ))}
                                    </div>
                                )}
                                {/* Actions */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                                    <button onClick={() => toggleLike(post)}
                                        style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: post.hasLiked ? '#f43f5e' : '#52525b', transition: 'color 0.12s' }}
                                        onMouseEnter={e => { if (!post.hasLiked) e.currentTarget.style.color = '#a1a1aa'; }}
                                        onMouseLeave={e => { if (!post.hasLiked) e.currentTarget.style.color = '#52525b'; }}
                                    >
                                        <Heart size={14} fill={post.hasLiked ? 'currentColor' : 'none'} />
                                        <span style={{ fontSize: 12 }}>{post.likes_count || 0}</span>
                                    </button>
                                    <button onClick={() => loadComments(post.id)}
                                        style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: expanded === post.id ? '#818cf8' : '#52525b', transition: 'color 0.12s' }}
                                        onMouseEnter={e => { if (expanded !== post.id) e.currentTarget.style.color = '#a1a1aa'; }}
                                        onMouseLeave={e => { if (expanded !== post.id) e.currentTarget.style.color = '#52525b'; }}
                                    >
                                        <MessageCircle size={14} />
                                        <span style={{ fontSize: 12 }}>{post.comments_count || 0}</span>
                                    </button>
                                </div>
                            </div>
                            {/* Comments section */}
                            {expanded === post.id && (
                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: '#090a0c' }}>
                                    <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {(comments[post.id] || []).map(c => (
                                            <div key={c.id} style={{ display: 'flex', gap: 8 }}>
                                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#71717a' }}>{(c.author_name || '?')[0].toUpperCase()}</span>
                                                </div>
                                                <div>
                                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#a1a1aa' }}>{c.author_name}</span>
                                                    <span style={{ fontSize: 9, color: '#3f3f46', marginLeft: 6 }}>{tAgo(c.created_at)}</span>
                                                    <p style={{ fontSize: 12, color: '#d4d4d8', margin: '3px 0 0', lineHeight: 1.4 }}>{c.content}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {(comments[post.id] || []).length === 0 && (
                                            <p style={{ fontSize: 11, color: '#3f3f46', margin: 0 }}>No comments yet</p>
                                        )}
                                    </div>
                                    <div style={{ padding: '8px 12px 12px', display: 'flex', gap: 8 }}>
                                        <input value={newComment} onChange={e => setNewComment(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(post.id); } }}
                                            placeholder="Write a comment…"
                                            style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#e4e4e7', outline: 'none', fontFamily: 'inherit' }}
                                        />
                                        <button onClick={() => addComment(post.id)} disabled={!newComment.trim() || commentBusy}
                                            style={{ padding: '6px 10px', borderRadius: 8, background: newComment.trim() ? 'rgba(99,102,241,0.7)' : 'rgba(99,102,241,0.15)', border: 'none', color: '#fff', cursor: newComment.trim() ? 'pointer' : 'default' }}
                                        >
                                            <Send size={12} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                </div>
                <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ background: '#0c0d10', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 14, padding: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.13em', marginBottom: 8 }}>Rules</div>
                        <p style={{ fontSize: 12, color: '#a1a1aa', lineHeight: 1.55, whiteSpace: 'pre-wrap', margin: 0 }}>{community?.rules || 'Be useful. Stay on topic. No spam.'}</p>
                    </div>
                    <div style={{ background: '#0c0d10', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 14, padding: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.13em', marginBottom: 8 }}>Moderation</div>
                        <p style={{ fontSize: 12, color: '#a1a1aa', lineHeight: 1.55, margin: 0 }}>Tone: {community?.moderation_tone || 'thoughtful'}</p>
                        <p style={{ fontSize: 11, color: '#52525b', lineHeight: 1.55, margin: '8px 0 0' }}>Studio controls identity and settings. Axis is the live room.</p>
                    </div>
                </aside>
                </div>
            </div>
        </div>
    );
}

function tAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
}

function SectionLabel({ children, action, onAction }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.13em', margin: 0 }}>{children}</p>
            {action && (
                <button onClick={onAction} style={{ fontSize: 11, color: '#52525b', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
                    onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
                >{action}</button>
            )}
        </div>
    );
}

function AxisHome({ onCommunities, onCreateRoom, onCreateWorkspace, onStartDirect }) {
    return <AxisHomePanel onCommunities={onCommunities} onCreateRoom={onCreateRoom} onCreateWorkspace={onCreateWorkspace} onStartDirect={onStartDirect} />;
}

function SpaceOpeningFallback({ workspace }) {
    return (
        <div className="flex flex-1 items-center justify-center" style={{ background: '#08090b' }}>
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                padding: 28, borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
                boxShadow: '0 24px 80px rgba(0,0,0,0.24)',
            }}>
                <SomaDot size={9} anim />
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e4e4e7', letterSpacing: '0.01em' }}>
                        Opening {workspace?.name || 'space'}
                    </div>
                    <div style={{ marginTop: 5, fontSize: 10, color: '#71717a', fontFamily: "'Geist Mono', monospace" }}>
                        selecting default channel
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Root ──────────────────────────────────────────────────────────────────────
function AxisContent() {
    const { user, activeChannelId, setActiveChannelId, activeWorkspaceId, setActiveWorkspaceId, activeWorkspace, activeChannel, activeProjectId, setActiveProjectId, loading, sendMessage, hdrs } = useAxis();
    const [showIdentity,     setShowIdentity]     = useState(!user?.name);
    const [showCreateRoom,   setShowCreateRoom]   = useState(false);
    const [showCreateWs,     setShowCreateWs]     = useState(false);
    const [showCreateCh,     setShowCreateCh]     = useState(false);
    const [showCreateThread, setShowCreateThread] = useState(false);
    const [showCreateProj,   setShowCreateProj]   = useState(false);
    const [showInvite,       setShowInvite]        = useState(false);
    const [showJoin,         setShowJoin]          = useState(false);
    const [showMembers,      setShowMembers]       = useState(false);
    const [showContext,      setShowContext]        = useState(true);
    const [showSearch,       setShowSearch]        = useState(false);
    const [showCommunities,  setShowCommunities]   = useState(false);
    const [showStartDirect,  setShowStartDirect]   = useState(false);
    const [showTaskWindow,   setShowTaskWindow]     = useState(false);
    const [taskWindowProject, setTaskWindowProject] = useState(null);
    const [profileTarget,    setProfileTarget]     = useState(null); // { memberId, isSelf }
    const [wsCustomTarget,   setWsCustomTarget]    = useState(null); // workspace object

    // Global Ctrl+F → search
    useEffect(() => {
        const h = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                setShowSearch(v => !v);
            }
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, []);

    useEffect(() => {
        const h = e => {
            const detail = e.detail || {};
            if (detail.memberId) setProfileTarget({ memberId: detail.memberId, isSelf: !!detail.isSelf });
        };
        window.addEventListener('axis:open-profile', h);
        return () => window.removeEventListener('axis:open-profile', h);
    }, []);

    const handleSomaAsk = useCallback(() => {
        sendMessage('@soma Please summarize the recent conversation in this channel and identify any key decisions.', { mode: 'archive' });
    }, [sendMessage]);

    const isRegularWorkspace = activeWorkspaceId && activeWorkspace &&
        activeWorkspace.type !== 'room' && activeWorkspace.type !== 'community' && activeWorkspace.name !== 'Directs';
    const storedWsType = activeWorkspaceId ? localStorage.getItem(`axis_wstype_${activeWorkspaceId}`) : null;
    const iconWsType = WORKSPACE_TYPES.some(t => t.id === activeWorkspace?.icon) ? activeWorkspace.icon : null;
    const wsType = isRegularWorkspace
        ? (storedWsType || iconWsType || 'general')
        : null;

    if (loading && !user) return (
        <div className="flex h-full w-full items-center justify-center" style={{ background: '#08090b' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#2d3142' }}>
                <SomaDot size={10} anim />
                <p style={{ fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", color: '#6b7280' }}>Connecting to AXIS…</p>
            </div>
        </div>
    );

    return (
        <div className="axis-void flex h-full w-full overflow-hidden" style={{ background: '#08090b' }}>
            <WorkspaceRail
                onAddRoom={() => setShowCreateRoom(true)}
                onAddWorkspace={() => setShowCreateWs(true)}
                onCustomize={(ws) => setWsCustomTarget(ws)}
                onCommunities={() => setShowCommunities(true)}
            />

            {activeWorkspaceId && !wsType && (
                <div className="flex flex-col border-r border-white/5 shrink-0" style={{ width: 220 }}>
                    <ChannelSidebar
                        onCreateCh={() => setShowCreateCh(true)}
                        onCreateThread={() => setShowCreateThread(true)}
                        onJoin={() => setShowJoin(true)}
                        onGoHome={() => {
                            setActiveChannelId(null);
                            setActiveProjectId(null);
                            setActiveWorkspaceId(null);
                        }}
                        onNewProject={() => setShowCreateProj(true)}
                        onOpenTasks={(proj) => { setTaskWindowProject(proj); setShowTaskWindow(true); }}
                        onSettings={(ws) => setWsCustomTarget(ws)}
                    />
                    <UserBadge onOpenSelfProfile={() => setProfileTarget({ memberId: 'self', isSelf: true })} />
                </div>
            )}

            {wsType
                ? <AxisWorkspaceView workspaceType={wsType} workspace={activeWorkspace} />
                : activeChannelId && activeChannel
                    ? <ChatArea
                        onInvite={() => setShowInvite(true)}
                        showMembers={showMembers}
                        onToggleMembers={() => setShowMembers(v => !v)}
                        onSearch={() => setShowSearch(true)}
                        showContext={showContext}
                        onToggleContext={() => setShowContext(v => !v)}
                        onOpenProfile={(memberId) => setProfileTarget({ memberId, isSelf: false })}
                    />
                    : activeWorkspace?.type === 'community'
                        ? <CommunityHome workspace={activeWorkspace} hdrs={hdrs} />
                        : activeWorkspaceId
                            ? <SpaceOpeningFallback workspace={activeWorkspace} />
                        : <AxisHome
                            onCommunities={() => setShowCommunities(true)}
                            onCreateRoom={() => setShowCreateRoom(true)}
                            onCreateWorkspace={() => setShowCreateWs(true)}
                            onStartDirect={() => setShowStartDirect(true)}
                        />
            }

            {showMembers && activeChannelId && activeChannel && (
                <MembersPane channelId={activeChannelId} onInvite={() => setShowInvite(true)} />
            )}

            <ContextPane
                open={!wsType && showContext && !!activeChannelId && !!activeChannel}
                channel={activeChannel}
                onSomaAsk={handleSomaAsk}
            />

            {showCommunities && <CommunityBrowserModal onClose={() => setShowCommunities(false)} />}
            {showIdentity    && <IdentityModal onDone={() => setShowIdentity(false)} />}
            {showCreateRoom  && <CreateWorkspaceModal kind="room" onClose={() => setShowCreateRoom(false)} />}
            {showCreateWs    && <CreateWorkspaceModal kind="workspace" onClose={() => setShowCreateWs(false)} />}
            {showCreateCh    && <CreateChannelModal   onClose={() => setShowCreateCh(false)} />}
            {showCreateThread && <CreateThreadModal   onClose={() => setShowCreateThread(false)} />}
            {showCreateProj  && <CreateProjectModal   onClose={() => setShowCreateProj(false)} />}
            {showTaskWindow  && <TaskWindowModal project={taskWindowProject} onClose={() => { setShowTaskWindow(false); setTaskWindowProject(null); }} />}
            {showStartDirect && <StartDirectModal onClose={() => setShowStartDirect(false)} />}
            {showInvite && activeChannelId && activeChannel && <InviteModal channelId={activeChannelId} onClose={() => setShowInvite(false)} />}
            {showJoin        && <JoinModal   onClose={() => setShowJoin(false)} />}
            {showSearch      && <SearchModal onClose={() => setShowSearch(false)} workspaceId={activeWorkspaceId} />}
            {profileTarget   && (
                <ProfileModal
                    memberId={profileTarget.memberId}
                    isSelf={profileTarget.isSelf}
                    onClose={() => setProfileTarget(null)}
                    onStartMessage={(memberId) => {
                        setProfileTarget(null);
                    }}
                />
            )}
            {wsCustomTarget  && (
                <SpaceSettingsModal
                    workspace={wsCustomTarget}
                    onClose={() => setWsCustomTarget(null)}
                />
            )}
        </div>
    );
}

export default function AxisApp() {
    return (
        <AxisProvider>
            <AxisContent />
        </AxisProvider>
    );
}
