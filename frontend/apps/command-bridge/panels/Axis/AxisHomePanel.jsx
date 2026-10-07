import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Send, Heart, MessageCircle, Briefcase, Search, Star, X, ArrowLeft, UserRound, EyeOff } from 'lucide-react';
import { useAxis } from './AxisContext';
import { TaskWindowModal } from './TaskWindow';
import somaBackend from '../../somaBackend';

const AVATAR_HEX = {
    blue:    '#6366f1', emerald: '#34d399', violet: '#a78bfa',
    amber:   '#fbbf24', rose:    '#fb7185', cyan:   '#22d3ee',
    orange:  '#fb923c', fuchsia: '#e879f9',
};

function tAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
}

function normalizeDirect(direct) {
    const name = direct.name || direct.title || 'Direct';
    return {
        ...direct,
        name,
        title: direct.title || name,
        otherColor: direct.otherColor || direct.color || 'violet',
        lastContent: direct.lastContent || direct.lastMessage || '',
        lastAt: direct.lastAt || direct.updatedAt || direct.createdAt || null,
        isDemo: String(direct.otherId || direct.id || direct.name || '').startsWith('axis-') || String(name).includes('Demo'),
    };
}

function DirectIdentityChip({ direct, compact = false }) {
    const col = AVATAR_HEX[direct.otherColor] || '#a78bfa';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 11, minWidth: 0 }}>
            <div style={{ position: 'relative', width: compact ? 28 : 38, height: compact ? 28 : 38, borderRadius: compact ? 8 : 12, overflow: 'hidden', background: `${col}22`, border: `1px solid ${col}55`, flexShrink: 0 }}>
                {direct.image
                    ? <img src={direct.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: col, fontWeight: 800, fontSize: compact ? 11 : 14 }}>{(direct.name || '?')[0].toUpperCase()}</span>}
                {direct.online && <span style={{ position: 'absolute', right: 2, bottom: 2, width: 7, height: 7, borderRadius: '50%', background: '#22c55e', border: '1px solid #09090b' }} />}
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: compact ? 12.5 : 14, fontWeight: 700, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{direct.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                    <span style={{ fontSize: 9, color: direct.online ? '#22c55e' : '#52525b', fontFamily: "'Geist Mono', monospace" }}>{direct.online ? 'online' : 'direct'}</span>
                    {direct.isDemo && <span style={{ fontSize: 8, color: '#71717a', fontFamily: "'Geist Mono', monospace", border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: '1px 5px' }}>demo</span>}
                </div>
            </div>
        </div>
    );
}

function AxisDirectDetail({ direct, hdrs, onBack, onRefresh }) {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');
    const [highlighted, setHighlighted] = useState(null);
    const msgRefs = useRef({});

    const loadMessages = useCallback(async () => {
        if (!direct?.id) return;
        const d = await fetch(`/api/axis/directs/${direct.id}/messages`, { headers: hdrs() }).then(r => r.json()).catch(() => null);
        if (d?.ok) {
            setMessages(d.messages || []);
            onRefresh?.();
        }
    }, [direct?.id, hdrs, onRefresh]);

    useEffect(() => { loadMessages(); }, [loadMessages]);

    const filtered = query.trim()
        ? messages.filter(msg => String(msg.text || '').toLowerCase().includes(query.trim().toLowerCase()))
        : [];

    const jump = (id) => {
        setHighlighted(id);
        msgRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => setHighlighted(null), 1600);
    };

    const send = async () => {
        const text = input.trim();
        if (!text || busy) return;
        setBusy(true);
        setInput('');
        try {
            const d = await fetch(`/api/axis/directs/${direct.id}/messages`, {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ text }),
            }).then(r => r.json());
            if (d?.ok) {
                setMessages(d.messages || []);
                onRefresh?.();
            }
        } catch {
            setInput(text);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#08090b' }}>
            <div style={{ height: 58, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', background: 'rgba(12,13,16,0.92)' }}>
                <button onClick={onBack} title="Back to Axis Home" style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#a1a1aa', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <ArrowLeft size={16} />
                </button>
                <DirectIdentityChip direct={direct} />
                <div style={{ marginLeft: 'auto', width: 280, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '7px 10px' }}>
                    <Search size={14} color="#52525b" />
                    <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search this Direct..." style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#e4e4e7', fontSize: 12 }} />
                    {query && <button onClick={() => setQuery('')} style={{ border: 'none', background: 'transparent', color: '#52525b', cursor: 'pointer' }}><X size={13} /></button>}
                </div>
            </div>
            {query.trim() && (
                <div style={{ maxHeight: 110, overflowY: 'auto', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0d0e12', padding: '8px 18px' }}>
                    {filtered.length ? filtered.slice(-8).map(msg => (
                        <button key={msg.id} onClick={() => jump(msg.id)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '7px 9px', marginBottom: 4, cursor: 'pointer' }}>
                            <div style={{ fontSize: 9, color: '#818cf8', fontFamily: "'Geist Mono', monospace" }}>{msg.sender === 'user' ? 'You' : direct.name} · {msg.timestamp}</div>
                            <div style={{ fontSize: 12, color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.text}</div>
                        </button>
                    )) : <div style={{ fontSize: 12, color: '#52525b', textAlign: 'center', padding: 8 }}>No matching messages.</div>}
                </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', padding: '22px 22px 18px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {messages.map(msg => {
                    const own = msg.sender === 'user';
                    return (
                        <div key={msg.id} ref={node => { msgRefs.current[msg.id] = node; }} style={{ display: 'flex', justifyContent: own ? 'flex-end' : 'flex-start', padding: '1px 0', background: highlighted === msg.id ? 'rgba(250,204,21,0.08)' : 'transparent', borderRadius: 10 }}>
                            <div style={{ maxWidth: '68%', borderRadius: own ? '16px 16px 5px 16px' : '16px 16px 16px 5px', padding: '8px 11px', background: own ? 'rgba(99,102,241,0.85)' : 'rgba(255,255,255,0.07)', color: '#f4f4f5', fontSize: 13.5, lineHeight: 1.42 }}>
                                {msg.text}
                                <div style={{ fontSize: 9, color: own ? 'rgba(255,255,255,0.55)' : '#52525b', marginTop: 3, textAlign: 'right', fontFamily: "'Geist Mono', monospace" }}>{msg.timestamp}</div>
                            </div>
                        </div>
                    );
                })}
                {messages.length === 0 && <div style={{ textAlign: 'center', color: '#3f3f46', fontSize: 13, marginTop: 80 }}>No Direct messages yet.</div>}
            </div>
            <div style={{ padding: '12px 18px 18px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 10 }}>
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Direct ${direct.name}...`} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: '#e4e4e7', fontSize: 13, padding: '11px 13px', outline: 'none' }} />
                <button onClick={send} disabled={!input.trim() || busy} style={{ width: 42, height: 42, borderRadius: 12, border: 'none', background: input.trim() ? '#6366f1' : 'rgba(255,255,255,0.07)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: input.trim() ? 'pointer' : 'default' }}>
                    <Send size={15} />
                </button>
            </div>
        </div>
    );
}

export default function AxisHomePanel({ onCreateRoom, onCreateWorkspace, onStartDirect }) {
    const {
        user, workspaces, activeWorkspaceId, setActiveWorkspaceId,
        setActiveChannelId, loadChannels, workspaceUnreadCounts, hdrs, projects,
    } = useAxis();

    const [homeData, setHomeData]   = useState({ directs: [], recentChannels: [], mentions: [] });
    const homeDataRef               = useRef({ directs: [], recentChannels: [], mentions: [] });
    const [myTasks, setMyTasks]     = useState([]);
    const [taskProject, setTaskProject] = useState(null);
    const [dmToast, setDmToast]     = useState(null);
    const dmToastTimer              = useRef(null);

    // Inline DM quick-reply
    const [dmOpenId, setDmOpenId]   = useState(null);
    const [dmInputs, setDmInputs]   = useState({});
    const [dmSending, setDmSending] = useState({});
    const [dmSent, setDmSent]       = useState({});
    const [activeDirect, setActiveDirect] = useState(null);
    const [directSearch, setDirectSearch] = useState('');
    const [directSearchResults, setDirectSearchResults] = useState([]);
    const [pinnedDirects, setPinnedDirects] = useState(() => {
        try { return JSON.parse(localStorage.getItem('axis:pinned-directs') || '[]'); } catch { return []; }
    });
    const [showDemoDirects, setShowDemoDirects] = useState(() => localStorage.getItem('axis:show-demo-directs') !== 'false');

    // Activity heart reactions (local UI)
    const [actHearts, setActHearts] = useState({});
    const [studioActivity, setStudioActivity] = useState([]);
    const [activityDrafts, setActivityDrafts] = useState({});
    const [activityBusy, setActivityBusy] = useState({});
    const [activityDetail, setActivityDetail] = useState(null);

    // Live clock
    const [clock, setClock] = useState(() => {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });

    const fetchHome = useCallback(() => {
        return fetch('/api/axis/home', { headers: hdrs() })
            .then(r => r.json())
            .then(d => {
                if (d.ok) {
                    const next = { directs: (d.directs || []).map(normalizeDirect), recentChannels: d.recentChannels || [], mentions: d.mentions || [] };
                    homeDataRef.current = next;
                    setHomeData(next);
                    return next;
                }
                return null;
            })
            .catch(() => null);
    }, [hdrs]);

    useEffect(() => { fetchHome(); }, []); // eslint-disable-line

    const fetchStudioActivity = useCallback(() => {
        return fetch('/api/studio/axis/activity?limit=40', { headers: hdrs() })
            .then(r => r.json())
            .then(d => { if (d?.ok) setStudioActivity(d.items || []); return d; })
            .catch(() => null);
    }, [hdrs]);

    useEffect(() => {
        fetchStudioActivity();
        const timer = setInterval(fetchStudioActivity, 20000);
        return () => clearInterval(timer);
    }, [fetchStudioActivity]);

    const openStudioActivity = async (item) => {
        const d = await fetch(`/api/studio/axis/activity/${item.id}`, { headers: hdrs() }).then(r => r.json()).catch(() => null);
        if (d?.ok) {
            setActivityDetail(d);
            setStudioActivity(list => list.map(entry => entry.id === item.id ? { ...entry, read: true } : entry));
        }
    };

    const replyStudioActivity = async (item) => {
        const text = (activityDrafts[item.id] || '').trim();
        if (!text || activityBusy[item.id]) return;
        setActivityBusy(state => ({ ...state, [item.id]: true }));
        try {
            const d = await fetch(`/api/studio/axis/activity/${item.id}/reply`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ text }) }).then(r => r.json());
            if (d?.ok) {
                setActivityDrafts(state => ({ ...state, [item.id]: '' }));
                setActivityDetail(current => current?.item?.id === item.id ? { ...current, comments: d.comments || current.comments } : current);
                fetchStudioActivity();
            }
        } finally {
            setActivityBusy(state => ({ ...state, [item.id]: false }));
        }
    };

    useEffect(() => {
        const handleDmToast = (msg) => {
            if (!msg?.isDirect || !msg?.sender_id || msg.sender_id === user?.id) return;
            const senderDirect = homeDataRef.current.directs.find(d => d.title === msg.sender_name);
            clearTimeout(dmToastTimer.current);
            setDmToast({ name: msg.sender_name || 'Someone', text: String(msg.content || '').slice(0, 80), image: senderDirect?.image || '' });
            dmToastTimer.current = window.setTimeout(() => setDmToast(null), 4500);
        };
        somaBackend.on('axis.message', fetchHome);
        somaBackend.on('axis.message', handleDmToast);
        somaBackend.on('axis.channel_created', fetchHome);
        somaBackend.on('axis.workspace_created', fetchHome);
        const timer = setInterval(fetchHome, 20000);
        return () => {
            somaBackend.off('axis.message', fetchHome);
            somaBackend.off('axis.message', handleDmToast);
            somaBackend.off('axis.channel_created', fetchHome);
            somaBackend.off('axis.workspace_created', fetchHome);
            clearInterval(timer);
            clearTimeout(dmToastTimer.current);
        };
    }, [fetchHome, user?.id]);

    useEffect(() => {
        const openPendingDirect = async (detail = null) => {
            let pending = detail;
            if (!pending) {
                try { pending = JSON.parse(localStorage.getItem('axis:pending-direct-home') || 'null'); } catch { pending = null; }
            }
            const directId = pending?.directId || pending?.id;
            if (!directId) return;
            localStorage.removeItem('axis:pending-direct-home');
            const next = await fetchHome();
            setDmOpenId(directId);
            const current = (next?.directs || homeDataRef.current.directs).find(d => d.id === directId);
            if (current) setActiveDirect(current);
        };
        const handler = (event) => openPendingDirect(event.detail);
        window.addEventListener('axis:open-direct-home', handler);
        openPendingDirect();
        return () => window.removeEventListener('axis:open-direct-home', handler);
    }, [fetchHome]);

    useEffect(() => {
        localStorage.setItem('axis:pinned-directs', JSON.stringify(pinnedDirects));
    }, [pinnedDirects]);

    useEffect(() => {
        localStorage.setItem('axis:show-demo-directs', showDemoDirects ? 'true' : 'false');
    }, [showDemoDirects]);

    useEffect(() => {
        if (!directSearch.trim()) {
            setDirectSearchResults([]);
            return;
        }
        const timer = setTimeout(() => {
            fetch(`/api/axis/directs-search?q=${encodeURIComponent(directSearch.trim())}`, { headers: hdrs() })
                .then(r => r.json())
                .then(d => setDirectSearchResults(d.ok ? (d.results || []) : []))
                .catch(() => setDirectSearchResults([]));
        }, 180);
        return () => clearTimeout(timer);
    }, [directSearch, hdrs]);

    useEffect(() => {
        fetch('/api/axis/my-tasks', { headers: hdrs() })
            .then(r => r.json())
            .then(d => { if (d.ok) setMyTasks(d.tasks || []); })
            .catch(() => {});
    }, []); // eslint-disable-line

    useEffect(() => {
        const id = setInterval(() => {
            const d = new Date();
            setClock(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
        }, 30000);
        return () => clearInterval(id);
    }, []);

    const sendInlineDm = async (dm) => {
        const text = (dmInputs[dm.id] || '').trim();
        if (!text || dmSending[dm.id]) return;
        setDmSending(s => ({ ...s, [dm.id]: true }));
        setDmInputs(s => ({ ...s, [dm.id]: '' }));
        try {
            await fetch(`/api/axis/directs/${dm.id}/messages`, {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ text }),
            });
            setDmSent(s => ({ ...s, [dm.id]: [...(s[dm.id] || []), text] }));
            setDmOpenId(null);
            fetchHome();
        } catch {
            setDmInputs(s => ({ ...s, [dm.id]: text }));
        } finally {
            setDmSending(s => ({ ...s, [dm.id]: false }));
        }
    };

    const goTo = (workspaceId, channelId) => {
        setActiveWorkspaceId(workspaceId);
        setActiveChannelId(channelId);
    };

    const openSpace = async (ws) => {
        const chs = await loadChannels(ws.id);
        const first = chs.find(ch => ch.type === 'text' || ch.type === 'system')
            || chs.find(ch => ch.type !== 'archive')
            || chs[0]
            || null;
        setActiveWorkspaceId(ws.id);
        setActiveChannelId(first?.id || null);
    };

    const togglePinnedDirect = (id) => {
        setPinnedDirects(prev => prev.includes(id) ? prev.filter(item => item !== id) : [id, ...prev].slice(0, 12));
    };

    const hour    = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const now     = new Date();
    const dayStr  = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

    const nonDirectsWs    = workspaces.filter(ws => ws.name !== 'Directs');
    const roomSpaces      = nonDirectsWs.filter(ws => ws.type === 'room' || ws.type === 'community');
    const workSpaces      = nonDirectsWs.filter(ws => ws.type !== 'room' && ws.type !== 'community');
    const totalDirUnread  = homeData.directs.reduce((s, d) => s + (d.unread || 0), 0);
    const totalWsUnread   = nonDirectsWs.reduce((s, ws) => s + (workspaceUnreadCounts[ws.id] || 0), 0);
    const totalUnread     = totalDirUnread + totalWsUnread;
    const urgentCount     = myTasks.filter(t => t.priority === 'urgent').length;

    const BDR  = 'rgba(255,255,255,0.07)';
    const MONO = "'Geist Mono', monospace";
    const CARD = { background: '#0c0d10', border: `1px solid ${BDR}`, borderRadius: 14, marginBottom: 14 };
    const HEAD = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px 10px', borderBottom: `1px solid ${BDR}` };

    const statItems = [
        { k: 'unread',   v: totalUnread,              d: 'across all channels'                              },
        { k: 'mentions', v: homeData.mentions.length, d: 'waiting on you'                                   },
        { k: 'tasks',    v: myTasks.length,           d: urgentCount > 0 ? `${urgentCount} urgent` : 'all clear' },
        { k: 'projects', v: projects.length,          d: 'in flight'                                        },
    ];

    const visibleDirects = homeData.directs
        .filter(dm => showDemoDirects || !dm.isDemo)
        .sort((a, b) => {
            const ap = pinnedDirects.includes(a.id) ? 1 : 0;
            const bp = pinnedDirects.includes(b.id) ? 1 : 0;
            return bp - ap || (b.lastAt || 0) - (a.lastAt || 0);
        });

    if (activeDirect) {
        return (
            <AxisDirectDetail
                direct={activeDirect}
                hdrs={hdrs}
                onBack={() => { setActiveDirect(null); fetchHome(); }}
                onRefresh={fetchHome}
            />
        );
    }

    return (
        <div style={{ flex: 1, overflowY: 'auto', background: '#08090b', position: 'relative' }}>

            {dmToast && (
                <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: '#18181b', border: '1px solid rgba(99,102,241,0.3)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', maxWidth: 320, animation: 'ax-slide-up 0.22s ease-out', cursor: 'pointer' }}
                    onClick={() => setDmToast(null)}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {dmToast.image
                            ? <img src={dmToast.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                            : <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 15 }}>{(dmToast.name || '?')[0].toUpperCase()}</span>}
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#f4f4f5', marginBottom: 2 }}>{dmToast.name}</div>
                        <div style={{ fontSize: 12, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dmToast.text}</div>
                    </div>
                </div>
            )}

            <div style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 28px 52px' }}>

                {/* Axis landing */}
                <div style={{ position: 'relative', overflow: 'hidden', marginBottom: 22, padding: '22px 24px', borderRadius: 18, background: 'linear-gradient(135deg, rgba(15,15,20,0.96), rgba(12,13,18,0.98))', border: `1px solid ${BDR}`, boxShadow: '0 24px 80px rgba(0,0,0,0.28)' }}>
                    <div style={{ position: 'absolute', right: -80, top: -110, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(129,140,248,0.16), transparent 65%)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', left: '38%', bottom: -120, width: 320, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,211,238,0.07), transparent 68%)', pointerEvents: 'none' }} />
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <span style={{ fontSize: 9, color: '#a78bfa', fontFamily: MONO, letterSpacing: '0.14em', border: '1px solid rgba(167,139,250,0.22)', background: 'rgba(167,139,250,0.08)', borderRadius: 999, padding: '4px 8px' }}>AXIS HOME</span>
                                <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO }}>{dayStr} · {dateStr} · {clock}</span>
                            </div>
                            <h1 style={{ fontSize: 28, fontWeight: 750, color: '#e4e4e7', margin: 0, letterSpacing: 0, lineHeight: 1.12 }}>
                                {greeting}, <span style={{ color: '#c4b5fd' }}>{user?.name || 'there'}</span>.
                            </h1>
                            <p style={{ maxWidth: 560, fontSize: 13, lineHeight: 1.6, color: '#71717a', margin: '10px 0 0' }}>
                                Your communication hub for directs, rooms, workspaces, and the social layer around SOMA.
                            </p>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                                <button onClick={onStartDirect} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid rgba(255,255,255,0.12)', background: '#e4e4e7', color: '#09090b', borderRadius: 9, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                    <Send style={{ width: 13, height: 13 }} /> New direct
                                </button>
                                <button onClick={onCreateRoom} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid rgba(167,139,250,0.24)', background: 'rgba(167,139,250,0.1)', color: '#c4b5fd', borderRadius: 9, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                    <MessageCircle style={{ width: 13, height: 13 }} /> New room
                                </button>
                                <button onClick={onCreateWorkspace} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#a1a1aa', borderRadius: 9, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                    <Briefcase style={{ width: 13, height: 13 }} /> New workspace
                                </button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexShrink: 0 }}>
                            {statItems.map(s => (
                                <div key={s.k} style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 9.5, color: '#3f3f46', fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>{s.k}</div>
                                    <div style={{ fontSize: 24, fontWeight: 750, color: s.v > 0 ? '#e4e4e7' : '#3f3f46', lineHeight: 1 }}>{s.v}</div>
                                    <div style={{ fontSize: 9.5, color: '#3f3f46', fontFamily: MONO, marginTop: 1 }}>{s.d}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 2-column grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 18 }}>

                    {/* Left column */}
                    <div>

                        {/* Studio comment conversations */}
                        <div style={CARD}>
                            <div style={HEAD}>
                                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.11em', margin: 0 }}>Studio conversations</h3>
                                <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO }}>{studioActivity.filter(item => !item.read).length} unread</span>
                            </div>
                            {!studioActivity.length ? <div style={{ padding: '16px', color: '#3f3f46', fontSize: 12, textAlign: 'center' }}>Comments on your posts and Signals appear here.</div> : studioActivity.slice(0, 6).map((item, index) => (
                                <div key={item.id} style={{ padding: '11px 14px', borderBottom: index === Math.min(studioActivity.length, 6) - 1 ? 'none' : `1px solid ${BDR}`, background: item.read ? 'transparent' : 'rgba(99,102,241,0.045)' }}>
                                    <button onClick={() => openStudioActivity(item)} style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' }}>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><strong style={{ fontSize: 12.5, color: '#e4e4e7' }}>{item.actorName || 'Someone'}</strong><span style={{ fontSize: 9.5, color: '#3f3f46', fontFamily: MONO }}>{item.targetType === 'signal' ? 'Signal' : 'Post'} · {tAgo(item.createdAt)}</span>{!item.read && <span style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%', background: '#6366f1' }} />}</div>
                                        <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 3 }}>{item.text}</div>
                                        <div style={{ fontSize: 10, color: '#6366f1', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.targetTitle || 'Open conversation'}</div>
                                    </button>
                                    <div style={{ display: 'flex', gap: 7, marginTop: 8 }}><input value={activityDrafts[item.id] || ''} onChange={e => setActivityDrafts(state => ({ ...state, [item.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') replyStudioActivity(item); }} placeholder="Quick reply..." style={{ flex: 1, minWidth: 0, border: `1px solid ${BDR}`, borderRadius: 8, background: 'rgba(255,255,255,0.035)', color: '#e4e4e7', padding: '7px 9px', fontSize: 11.5 }} /><button onClick={() => replyStudioActivity(item)} disabled={!activityDrafts[item.id]?.trim() || activityBusy[item.id]} style={{ width: 32, border: 'none', borderRadius: 8, background: activityDrafts[item.id]?.trim() ? '#6366f1' : 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer' }}><Send size={12} /></button></div>
                                </div>
                            ))}
                        </div>

                        {activityDetail && <div style={CARD}>
                            <div style={HEAD}><h3 style={{ fontSize:11,color:'#a1a1aa',margin:0 }}>{activityDetail.content?.title || 'Conversation'}</h3><button onClick={() => setActivityDetail(null)} style={{ border:'none',background:'none',color:'#52525b',cursor:'pointer' }}><X size={14}/></button></div>
                            <div style={{ padding:'12px 14px',fontSize:12,color:'#71717a',lineHeight:1.5,borderBottom:`1px solid ${BDR}` }}>{activityDetail.content?.text}</div>
                            {(activityDetail.comments||[]).map(comment => <div key={comment.id} style={{ padding:'9px 14px',borderBottom:`1px solid ${BDR}` }}><strong style={{ fontSize:11.5,color:'#e4e4e7' }}>{comment.name||comment.who}</strong><span style={{ fontSize:12,color:'#a1a1aa',marginLeft:7 }}>{comment.text}</span></div>)}
                        </div>}

                        {/* Priority queue */}
                        <div style={CARD}>
                            <div style={HEAD}>
                                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.11em', margin: 0 }}>Priority queue</h3>
                                <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO }}>today · in order</span>
                            </div>
                            <div>
                                {homeData.mentions.slice(0, 2).map(m => (
                                    <button key={m.id} onClick={() => goTo(m.workspaceId, m.channelId)}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: `1px solid ${BDR}`, padding: '12px 16px', cursor: 'pointer', transition: 'background 0.1s' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                            <span style={{ fontSize: 8.5, fontWeight: 700, fontFamily: MONO, letterSpacing: '0.08em', background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: 4, padding: '2px 6px' }}>MENTIONED</span>
                                            <span style={{ fontSize: 9, color: '#3f3f46', fontFamily: MONO }}>#{m.channelName || m.workspaceName} · {tAgo(m.createdAt)}</span>
                                        </div>
                                        <div style={{ fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
                                            <div style={{ width: 14, height: 14, borderRadius: 4, background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{ fontSize: 8, color: '#818cf8', fontWeight: 700 }}>{(m.senderName || '?')[0].toUpperCase()}</span>
                                            </div>
                                            <span style={{ fontSize: 10.5, color: '#52525b' }}>{m.senderName}</span>
                                        </div>
                                    </button>
                                ))}
                                {myTasks.slice(0, 4).map((t, i, arr) => {
                                    const isUrgent = t.priority === 'urgent';
                                    const isHigh   = t.priority === 'high';
                                    const badge = isUrgent
                                        ? { bg: 'rgba(239,68,68,0.12)',    col: '#ef4444', label: 'URGENT' }
                                        : isHigh
                                            ? { bg: 'rgba(99,102,241,0.15)', col: '#818cf8', label: 'HIGH' }
                                            : { bg: 'rgba(255,255,255,0.06)', col: '#52525b', label: t.priority?.toUpperCase() || 'TASK' };
                                    return (
                                        <button key={t.id}
                                            onClick={() => setTaskProject({ id: t.project_id, name: t.project_name, icon: t.project_icon })}
                                            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: i === arr.length - 1 ? 'none' : `1px solid ${BDR}`, padding: '12px 16px', cursor: 'pointer', transition: 'background 0.1s' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                <span style={{ fontSize: 8.5, fontWeight: 700, fontFamily: MONO, letterSpacing: '0.08em', background: badge.bg, color: badge.col, borderRadius: 4, padding: '2px 6px' }}>{badge.label}</span>
                                                <span style={{ fontSize: 9, color: '#3f3f46', fontFamily: MONO }}>{t.project_icon || '📁'} {t.project_name}</span>
                                            </div>
                                            <div style={{ fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                                        </button>
                                    );
                                })}
                                {myTasks.length === 0 && homeData.mentions.length === 0 && (
                                    <div style={{ padding: '18px 16px', color: '#3f3f46', fontSize: 12, textAlign: 'center' }}>All clear — nothing urgent demanding attention.</div>
                                )}
                            </div>
                        </div>

                        {/* Direct messages */}
                        <div style={CARD}>
                            <div style={HEAD}>
                                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.11em', margin: 0 }}>Directs</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <button onClick={() => setShowDemoDirects(v => !v)} title={showDemoDirects ? 'Hide demo Directs' : 'Show demo Directs'}
                                        style={{ fontSize: 10, color: showDemoDirects ? '#818cf8' : '#52525b', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <EyeOff style={{ width: 11, height: 11 }} /> Demo
                                    </button>
                                    <button onClick={onStartDirect}
                                        style={{ fontSize: 10, color: '#52525b', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                        onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
                                        onMouseLeave={e => e.currentTarget.style.color = '#52525b'}>
                                        <Plus style={{ width: 11, height: 11 }} /> New
                                    </button>
                                </div>
                            </div>
                            <div style={{ padding: '9px 14px', borderBottom: `1px solid ${BDR}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.045)', border: `1px solid ${BDR}`, borderRadius: 9, padding: '7px 9px' }}>
                                    <Search style={{ width: 13, height: 13, color: '#52525b', flexShrink: 0 }} />
                                    <input value={directSearch} onChange={e => setDirectSearch(e.target.value)} placeholder="Search Directs..." style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#e4e4e7', fontSize: 12 }} />
                                    {directSearch && <button onClick={() => setDirectSearch('')} style={{ border: 'none', background: 'transparent', color: '#52525b', cursor: 'pointer' }}><X style={{ width: 12, height: 12 }} /></button>}
                                </div>
                                {directSearch.trim() && (
                                    <div style={{ marginTop: 6, maxHeight: 150, overflowY: 'auto' }}>
                                        {directSearchResults.length ? directSearchResults.map(result => (
                                            <button key={result.direct.id} onClick={() => { setActiveDirect(normalizeDirect(result.direct)); setDirectSearch(''); }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'rgba(255,255,255,0.025)', borderRadius: 8, padding: '7px 9px', marginBottom: 4, cursor: 'pointer' }}>
                                                <div style={{ fontSize: 11, color: '#e4e4e7', fontWeight: 700 }}>{result.direct.title}</div>
                                                <div style={{ fontSize: 10, color: '#52525b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.matches?.[0]?.text || 'Name match'}</div>
                                            </button>
                                        )) : <div style={{ fontSize: 11, color: '#52525b', textAlign: 'center', padding: 6 }}>No Direct matches.</div>}
                                    </div>
                                )}
                            </div>
                            {visibleDirects.length === 0 ? (
                                <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                                    <button onClick={onStartDirect}
                                        style={{ fontSize: 12, color: '#6366f1', background: 'none', border: '1px dashed rgba(99,102,241,0.3)', borderRadius: 8, padding: '8px 18px', cursor: 'pointer' }}>
                                        Start your first direct →
                                    </button>
                                </div>
                            ) : (
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {visibleDirects.slice(0, 9).map((dm, i) => {
                                        const col    = AVATAR_HEX[dm.otherColor] || '#a78bfa';
                                        const isOpen = dmOpenId === dm.id;
                                        const sent   = dmSent[dm.id] || [];
                                        const pinned = pinnedDirects.includes(dm.id);
                                        const isLast = i === Math.min(visibleDirects.length, 9) - 1;
                                        return (
                                            <li key={dm.id} style={{ borderBottom: isLast && !isOpen ? 'none' : `1px solid ${BDR}` }}>
                                                <button
                                                    onClick={() => setActiveDirect(dm)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '10px 16px', background: isOpen ? 'rgba(99,102,241,0.05)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
                                                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'none'; }}>
                                                    <div style={{ width: 28, height: 28, borderRadius: 8, background: `${col}22`, border: `1.5px solid ${col}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                        <span style={{ fontSize: 11, fontWeight: 700, color: col }}>{(dm.name || '?')[0].toUpperCase()}</span>
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                                                            <span style={{ fontSize: 12.5, fontWeight: dm.unread ? 700 : 500, color: dm.unread ? '#e4e4e7' : '#a1a1aa' }}>{dm.name}</span>
                                                            <span style={{ fontSize: 9, color: '#3f3f46', fontFamily: MONO, flexShrink: 0 }}>{tAgo(dm.lastAt)}</span>
                                                        </div>
                                                        <div style={{ fontSize: 11, color: '#52525b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {sent.length > 0
                                                                ? <span style={{ color: '#6366f1' }}>You · just now</span>
                                                                : dm.lastContent || <span style={{ color: '#3f3f46' }}>No messages</span>}
                                                        </div>
                                                    </div>
                                                    <button onClick={(e) => { e.stopPropagation(); togglePinnedDirect(dm.id); }} title={pinned ? 'Unpin Direct' : 'Pin Direct'} style={{ border: 'none', background: 'transparent', color: pinned ? '#fbbf24' : '#3f3f46', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
                                                        <Star style={{ width: 13, height: 13, fill: pinned ? '#fbbf24' : 'none' }} />
                                                    </button>
                                                    {dm.unread > 0 && (
                                                        <span style={{ fontSize: 9, fontWeight: 700, background: '#6366f1', color: '#fff', borderRadius: 99, padding: '2px 6px', flexShrink: 0 }}>{dm.unread > 99 ? '99+' : dm.unread}</span>
                                                    )}
                                                </button>
                                                {isOpen && (
                                                    <div style={{ padding: '0 14px 12px', background: 'rgba(99,102,241,0.03)' }}>
                                                        {sent.map((s, si) => (
                                                            <div key={si} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', borderTop: si === 0 ? `1px solid ${BDR}` : 'none', marginTop: si === 0 ? 4 : 0 }}>
                                                                <span style={{ fontSize: 8.5, fontFamily: MONO, color: '#6366f1', letterSpacing: '0.06em', flexShrink: 0 }}>YOU · just now</span>
                                                                <span style={{ fontSize: 12, color: '#a1a1aa' }}>{s}</span>
                                                            </div>
                                                        ))}
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                                                            <input
                                                                autoFocus
                                                                value={dmInputs[dm.id] || ''}
                                                                onChange={e => setDmInputs(s => ({ ...s, [dm.id]: e.target.value }))}
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInlineDm(dm); }
                                                                    if (e.key === 'Escape') setDmOpenId(null);
                                                                }}
                                                                placeholder={`Quick reply to ${dm.name}…`}
                                                                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BDR}`, borderRadius: 8, color: '#e4e4e7', fontSize: 12, padding: '7px 11px', outline: 'none', fontFamily: 'inherit' }}
                                                            />
                                                            <button
                                                                onClick={() => sendInlineDm(dm)}
                                                                disabled={!(dmInputs[dm.id] || '').trim() || dmSending[dm.id]}
                                                                style={{ width: 30, height: 30, borderRadius: 7, border: 'none', background: (dmInputs[dm.id] || '').trim() ? '#6366f1' : 'rgba(255,255,255,0.07)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: (dmInputs[dm.id] || '').trim() ? 'pointer' : 'default', flexShrink: 0, transition: 'all 0.12s' }}>
                                                                <Send style={{ width: 12, height: 12 }} />
                                                            </button>
                                                        </div>
                                                        <div style={{ fontSize: 9, color: '#3f3f46', fontFamily: MONO, marginTop: 4 }}>↵ send · esc close</div>
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                    </div>

                    {/* Right column */}
                    <div>

                        {/* Spaces */}
                        <div style={CARD}>
                            <div style={HEAD}>
                                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.11em', margin: 0 }}>Spaces</h3>
                                <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO }}>{nonDirectsWs.length} total</span>
                            </div>
                            {nonDirectsWs.length === 0 ? (
                                <div style={{ padding: '16px', color: '#3f3f46', fontSize: 12, textAlign: 'center' }}>
                                    No rooms or workspaces yet.
                                </div>
                            ) : (
                                <div style={{ padding: '10px 12px 12px' }}>
                                    {[
                                        { label: 'Rooms', items: roomSpaces, icon: MessageCircle },
                                        { label: 'Workspaces', items: workSpaces, icon: Briefcase },
                                    ].filter(group => group.items.length).map(group => {
                                        const Icon = group.icon;
                                        return (
                                            <div key={group.label} style={{ marginBottom: 10 }}>
                                                <div style={{ fontSize: 9, color: '#3f3f46', fontFamily: MONO, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 2px 6px' }}>
                                                    {group.label}
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                                                    {group.items.map(ws => {
                                                        const unread = workspaceUnreadCounts[ws.id] || 0;
                                                        const active = activeWorkspaceId === ws.id;
                                                        return (
                                                            <button key={ws.id}
                                                                onClick={() => openSpace(ws)}
                                                                style={{
                                                                    minWidth: 0,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 8,
                                                                    padding: '8px 9px',
                                                                    borderRadius: 10,
                                                                    border: active ? '1px solid rgba(196,181,253,0.28)' : `1px solid ${BDR}`,
                                                                    background: active ? 'rgba(167,139,250,0.1)' : 'rgba(255,255,255,0.025)',
                                                                    cursor: 'pointer',
                                                                    textAlign: 'left',
                                                                }}
                                                                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.045)'; }}
                                                                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}>
                                                                <span style={{ width: 24, height: 24, borderRadius: 7, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                                    <Icon style={{ width: 13, height: 13, color: active ? '#c4b5fd' : '#52525b' }} />
                                                                </span>
                                                                <span style={{ flex: 1, minWidth: 0 }}>
                                                                    <span style={{ display: 'block', fontSize: 12, color: active ? '#e4e4e7' : '#a1a1aa', fontWeight: active ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</span>
                                                                    <span style={{ display: 'block', fontSize: 9, color: '#3f3f46', fontFamily: MONO }}>{ws.type || 'workspace'}</span>
                                                                </span>
                                                                {unread > 0 && (
                                                                    <span style={{ fontSize: 9, fontWeight: 700, background: '#6366f1', color: '#fff', borderRadius: 99, padding: '2px 6px', flexShrink: 0 }}>{unread > 99 ? '99+' : unread}</span>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
                                        <button onClick={onCreateRoom} style={{ flex: 1, border: '1px dashed rgba(167,139,250,0.22)', background: 'rgba(167,139,250,0.06)', color: '#a78bfa', borderRadius: 9, padding: '7px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                            <Plus style={{ width: 11, height: 11, display: 'inline', marginRight: 5 }} /> Room
                                        </button>
                                        <button onClick={onCreateWorkspace} style={{ flex: 1, border: '1px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: '#a1a1aa', borderRadius: 9, padding: '7px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                            <Plus style={{ width: 11, height: 11, display: 'inline', marginRight: 5 }} /> Workspace
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Channels */}
                        <div style={CARD}>
                            <div style={HEAD}>
                                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.11em', margin: 0 }}>Channels</h3>
                                <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO }}>unread first</span>
                            </div>
                            {homeData.recentChannels.length === 0 ? (
                                <div style={{ padding: '14px 16px', color: '#3f3f46', fontSize: 12, textAlign: 'center' }}>No channels yet</div>
                            ) : (
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {[...homeData.recentChannels].sort((a, b) => (b.unread || 0) - (a.unread || 0)).slice(0, 8).map((ch, i, arr) => {
                                        const hasUnread = (ch.unread || 0) > 0;
                                        const isHot     = (ch.unread || 0) > 10;
                                        return (
                                            <li key={ch.id}>
                                                <button
                                                    onClick={() => goTo(ch.workspace_id, ch.id)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 16px', background: 'none', border: 'none', borderBottom: i === arr.length - 1 ? 'none' : `1px solid rgba(255,255,255,0.04)`, cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}
                                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                                    <span style={{ fontSize: 12, fontFamily: MONO, color: '#3f3f46', flexShrink: 0 }}>#</span>
                                                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: hasUnread ? 600 : 400, color: hasUnread ? '#e4e4e7' : '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                                                    <span style={{ fontSize: 9.5, color: '#3f3f46', fontFamily: MONO, flexShrink: 0 }}>
                                                        {ch.last_sender ? `${ch.last_sender} · ${tAgo(ch.last_at)}` : ''}
                                                    </span>
                                                    {hasUnread ? (
                                                        <span style={{ fontSize: 9, fontWeight: 700, background: isHot ? 'rgba(216,88,122,0.25)' : 'rgba(255,255,255,0.1)', color: isHot ? '#d8587a' : '#e4e4e7', borderRadius: 99, padding: '2px 6px', flexShrink: 0, minWidth: 20, textAlign: 'center' }}>{ch.unread > 99 ? '99+' : ch.unread}</span>
                                                    ) : (
                                                        <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO }}>—</span>
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        {/* Recent activity */}
                        <div style={CARD}>
                            <div style={HEAD}>
                                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.11em', margin: 0 }}>Recent activity</h3>
                                <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO }}>react · go to channel</span>
                            </div>
                            {homeData.recentChannels.filter(ch => ch.last_content).length === 0 ? (
                                <div style={{ padding: '14px 16px', color: '#3f3f46', fontSize: 12, textAlign: 'center' }}>No recent activity</div>
                            ) : (
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {homeData.recentChannels.filter(ch => ch.last_content).slice(0, 5).map((ch, i, arr) => {
                                        const hs = actHearts[ch.id] || { hearted: false, hearts: 0 };
                                        return (
                                            <li key={ch.id} style={{ borderBottom: i === arr.length - 1 ? 'none' : `1px solid ${BDR}`, padding: '10px 16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#a1a1aa', fontFamily: MONO }}>{ch.last_sender}</span>
                                                    <span style={{ fontSize: 11, color: '#3f3f46' }}>in</span>
                                                    <span style={{ fontSize: 12, color: '#818cf8' }}>#{ch.name}</span>
                                                    <span style={{ fontSize: 9.5, color: '#3f3f46', fontFamily: MONO, marginLeft: 'auto', flexShrink: 0 }}>{tAgo(ch.last_at)}</span>
                                                </div>
                                                <div style={{ fontSize: 12, color: '#52525b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 7 }}>{ch.last_content}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <button
                                                        onClick={() => setActHearts(s => {
                                                            const cur = s[ch.id] || { hearted: false, hearts: 0 };
                                                            return { ...s, [ch.id]: { hearted: !cur.hearted, hearts: cur.hearted ? cur.hearts - 1 : cur.hearts + 1 } };
                                                        })}
                                                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontFamily: MONO, color: hs.hearted ? '#d8587a' : '#3f3f46', background: 'none', border: `1px solid ${hs.hearted ? 'rgba(216,88,122,0.3)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', transition: 'all 0.1s' }}>
                                                        <Heart style={{ width: 11, height: 11, fill: hs.hearted ? '#d8587a' : 'none', stroke: hs.hearted ? '#d8587a' : 'currentColor' }} />
                                                        {hs.hearts > 0 && <span>{hs.hearts}</span>}
                                                    </button>
                                                    <button
                                                        onClick={() => goTo(ch.workspace_id, ch.id)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontFamily: MONO, color: '#3f3f46', background: 'none', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', transition: 'all 0.1s' }}
                                                        onMouseEnter={e => { e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.color = '#3f3f46'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}>
                                                        ↗ view
                                                    </button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        {/* Projects */}
                        <div style={CARD}>
                            <div style={HEAD}>
                                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.11em', margin: 0 }}>Projects</h3>
                                <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO }}>{projects.length} active</span>
                            </div>
                            {projects.length === 0 ? (
                                <div style={{ padding: '16px', color: '#3f3f46', fontSize: 12, textAlign: 'center' }}>No projects yet</div>
                            ) : (
                                <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
                                    {projects.slice(0, 5).map((p, i) => {
                                        const sig = AVATAR_HEX[p.color] || '#6366f1';
                                        return (
                                            <li key={p.id}
                                                style={{ padding: '9px 16px', borderBottom: i === Math.min(projects.length, 5) - 1 ? 'none' : `1px solid rgba(255,255,255,0.04)`, transition: 'background 0.1s', cursor: 'default' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: sig, boxShadow: `0 0 8px ${sig}88`, flexShrink: 0 }} />
                                                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                                    {p.member_count > 0 && (
                                                        <span style={{ fontSize: 10, color: '#3f3f46', fontFamily: MONO, flexShrink: 0 }}>{p.member_count}p</span>
                                                    )}
                                                </div>
                                                {p.description && (
                                                    <div style={{ fontSize: 11, color: '#52525b', marginTop: 3, marginLeft: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                    </div>
                </div>

            </div>

            {taskProject && <TaskWindowModal project={taskProject} onClose={() => setTaskProject(null)} />}
        </div>
    );
}
