import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import somaBackend from '../../somaBackend';

const AxisContext = createContext(null);

export const AXIS_COLORS = ['blue', 'emerald', 'violet', 'amber', 'rose', 'cyan', 'orange', 'fuchsia'];

const USER_KEY = 'axis_user_v2';

function apiHeaders(user) {
    const headers = {
        'Content-Type': 'application/json',
        'x-axis-user-id':    user?.id    || 'anon',
        'x-axis-user-name':  user?.name  || 'Anonymous',
        'x-axis-user-color': user?.color || 'blue',
    };
    try {
        const token = localStorage.getItem('studio_session_token') || localStorage.getItem('studio_session_v1');
        let deviceId = localStorage.getItem('studio_device_id');
        if (!deviceId) {
            const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            deviceId = `dev-${value}`;
            localStorage.setItem('studio_device_id', deviceId);
        }
        if (token) headers.Authorization = `Bearer ${token}`;
        headers['x-studio-device-id'] = deviceId;
        headers['x-studio-device-name'] = 'Command Bridge Axis';
        headers['x-studio-device-type'] = 'command-bridge';
    } catch {}
    return headers;
}

function parseReactions(raw) {
    if (!raw || typeof raw === 'object') return raw || {};
    try { return JSON.parse(raw); } catch { return {}; }
}

function pickDefaultAxisChannel(channels = []) {
    return channels.find(ch => ch.type === 'text' || ch.type === 'system')
        || channels.find(ch => ch.type !== 'archive')
        || channels[0]
        || null;
}

function normalizeWorkspaces(list = []) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .filter(ws => ws?.id && !seen.has(ws.id) && seen.add(ws.id))
        .sort((a, b) => {
            const ad = a.name === 'Directs' ? 1 : 0;
            const bd = b.name === 'Directs' ? 1 : 0;
            return ad - bd || Number(a.created_at || 0) - Number(b.created_at || 0);
        });
}

function upsertWorkspace(list = [], workspace) {
    if (!workspace?.id) return normalizeWorkspaces(list);
    const exists = list.some(ws => ws.id === workspace.id);
    return normalizeWorkspaces(exists
        ? list.map(ws => ws.id === workspace.id ? { ...ws, ...workspace } : ws)
        : [...list, workspace]);
}

const AVATAR_COLORS = [
    ['#7c3aed', '#22d3ee'],
    ['#2563eb', '#14b8a6'],
    ['#db2777', '#f59e0b'],
    ['#059669', '#84cc16'],
    ['#dc2626', '#f97316'],
    ['#4f46e5', '#a855f7'],
];

function isUnstableAvatar(value = '') {
    return /picsum\.photos/i.test(String(value || ''));
}

function hashAvatarKey(value = '') {
    let hash = 0;
    for (const char of String(value || 'axis-user')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return Math.abs(hash);
}

function initialsForAvatar(name = '') {
    const parts = String(name || 'User').replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] || 'U').slice(0, 2)).toUpperCase();
}

function deterministicUserAvatar(sp = {}, prev = {}) {
    const raw = String(sp.avatar || '').trim();
    if (raw && !isUnstableAvatar(raw)) return raw;
    const cached = String(prev?.avatar || '').trim();
    if (cached && !isUnstableAvatar(cached)) return cached;

    const axisData = sp.axis || {};
    const key = axisData.userId || axisData.handle || sp.name || prev?.id || 'axis-user';
    const name = sp.name || axisData.displayName || prev?.name || 'User';
    const [from, to] = AVATAR_COLORS[hashAvatarKey(key) % AVATAR_COLORS.length];
    const initials = initialsForAvatar(name);
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
        '<defs>',
        `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`,
        '</defs>',
        '<rect width="256" height="256" rx="64" fill="url(#g)"/>',
        '<circle cx="205" cy="42" r="64" fill="rgba(255,255,255,0.16)"/>',
        '<circle cx="48" cy="218" r="72" fill="rgba(0,0,0,0.14)"/>',
        `<text x="128" y="145" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="82" font-weight="800" fill="white">${initials}</text>`,
        '</svg>',
    ].join('');
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const AxisProvider = ({ children }) => {
    // ── Identity — sourced from Studio profile ────────────────────────────────
    const [user, setUser] = useState(() => {
        try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
    });
    const studioRef = useRef(null); // holds latest Studio profile for sync writes

    // On mount: fetch Studio profile and sync all identity fields into Axis user
    useEffect(() => {
        fetch('/api/studio/profile')
            .then(r => r.json())
            .then(data => {
                if (!data?.profile) return;
                const sp = data.profile;
                studioRef.current = sp;
                const axisData = sp.axis || {};
                setUser(prev => {
                    const id    = axisData.userId || prev?.id    || `usr-${crypto.randomUUID()}`;
                    const color = axisData.color  || prev?.color || 'violet';
                    const u = {
                        id, color,
                        handle:   axisData.handle || prev?.handle || '',
                        name:     sp.name     || prev?.name     || 'User',
                        avatar:   deterministicUserAvatar(sp, prev),
                        bio:      sp.bio      || prev?.bio      || '',
                        role:     sp.role     || prev?.role     || '',
                        location: sp.location || prev?.location || '',
                        timezone: sp.timezone || prev?.timezone || '',
                    };
                    localStorage.setItem(USER_KEY, JSON.stringify(u));
                    // Backfill userId + color into Studio.axis if not already there
                    if (!axisData.userId || !axisData.color) {
                        fetch('/api/studio/profile', {
                            method: 'PUT', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ profile: { ...sp, axis: { ...axisData, userId: id, color } } }),
                        }).catch(() => {});
                    }
                    return u;
                });
            })
            .catch(() => {});
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // setupUser: used only for color selection (name comes from Studio)
    const setupUser = useCallback((name, color) => {
        setUser(prev => {
            const u = {
                ...(prev || {}),
                id:    prev?.id    || `usr-${crypto.randomUUID()}`,
                name:  prev?.name  || name,
                color,
            };
            localStorage.setItem(USER_KEY, JSON.stringify(u));
            const sp = studioRef.current;
            if (sp) {
                const merged = { ...sp, axis: { ...(sp.axis || {}), userId: u.id, color } };
                studioRef.current = merged;
                fetch('/api/studio/profile', {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile: merged }),
                }).catch(() => {});
            }
            return u;
        });
    }, []);

    const hdrs = useCallback(() => apiHeaders(user), [user]);

    // ── Workspaces ────────────────────────────────────────────────────────────
    const [workspaces, setWorkspaces]        = useState([]);
    const [activeWorkspaceId, setActiveWsId] = useState(() => {
        try { return localStorage.getItem('axis_active_ws') || null; } catch { return null; }
    });

    const setActiveWorkspaceId = useCallback((id) => {
        if (id) localStorage.setItem('axis_active_ws', id);
        else localStorage.removeItem('axis_active_ws');
        setActiveWsId(id);
    }, []);

    const loadWorkspaces = useCallback(async () => {
        try {
            const d = await fetch('/api/axis/workspaces', { headers: hdrs() }).then(r => r.json());
            if (d.ok) {
                const normalized = normalizeWorkspaces(d.workspaces);
                setWorkspaces(normalized);
                return normalized;
            }
        } catch {}
        return [];
    }, [hdrs]);

    const createWorkspace = useCallback(async ({ name, icon, color, type, description, roomTemplate, community_id }) => {
        try {
            const response = await fetch('/api/axis/workspaces', {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ name, icon, color, type, description, roomTemplate, community_id }),
            });
            const d = await response.json().catch(() => ({}));
            if (!response.ok || !d.ok) {
                return { ok: false, error: d.error || `Workspace create failed (${response.status})` };
            }
            if (d.workspace) {
                setWorkspaces(prev => upsertWorkspace(prev, d.workspace));
            } else {
                await loadWorkspaces();
            }
            return d;
        } catch (e) {
            console.error('[Axis] createWorkspace error:', e);
            return { ok: false, error: e.message };
        }
    }, [hdrs, loadWorkspaces]);

    const deleteWorkspace = useCallback(async (id) => {
        await fetch(`/api/axis/workspaces/${id}`, { method: 'DELETE', headers: hdrs() });
    }, [hdrs]);

    const updateWorkspace = useCallback(async (id, fields = {}) => {
        try {
            const d = await fetch(`/api/axis/workspaces/${id}`, {
                method: 'PATCH', headers: hdrs(),
                body: JSON.stringify(fields),
            }).then(r => r.json());
            if (d.ok) loadWorkspaces();
            return d;
        } catch (e) {
            console.error('[Axis] updateWorkspace error:', e);
            return { ok: false, error: e.message };
        }
    }, [hdrs, loadWorkspaces]);

    // ── Channels ──────────────────────────────────────────────────────────────
    const [channels, setChannels]           = useState([]);
    const [activeChannelId, setActiveChId]  = useState(() => {
        try { return localStorage.getItem('axis_active_ch') || null; } catch { return null; }
    });

    const setActiveChannelId = useCallback((id) => {
        if (id) localStorage.setItem('axis_active_ch', id);
        else localStorage.removeItem('axis_active_ch');
        setActiveChId(id);
    }, []);

    const loadChannels = useCallback(async (wsId) => {
        if (!wsId) return [];
        try {
            const d = await fetch(`/api/axis/channels?workspaceId=${wsId}`, { headers: hdrs() }).then(r => r.json());
            if (d.ok) {
                const visibleChannels = (d.channels || []).filter(ch => ch.type !== 'dm');
                setChannels(visibleChannels);
                return visibleChannels;
            }
        } catch {}
        return [];
    }, [hdrs]);

    const createChannel = useCallback(async ({ workspaceId, name, type, description, isPrivate, members }) => {
        try {
            const d = await fetch('/api/axis/channels', { method: 'POST', headers: hdrs(), body: JSON.stringify({ workspaceId, name, type, description, isPrivate, members }) }).then(r => r.json());
            if (d.ok) loadChannels(workspaceId || activeWorkspaceId);
            return d;
        } catch (e) {
            console.error('[Axis] createChannel error:', e);
            return { ok: false, error: e.message };
        }
    }, [hdrs, loadChannels, activeWorkspaceId]);

    const deleteChannel = useCallback(async (id) => {
        await fetch(`/api/axis/channels/${id}`, { method: 'DELETE', headers: hdrs() });
    }, [hdrs]);

    const updateChannel = useCallback(async (id, fields = {}) => {
        try {
            const d = await fetch(`/api/axis/channels/${id}`, {
                method: 'PATCH', headers: hdrs(),
                body: JSON.stringify(fields),
            }).then(r => r.json());
            if (d.ok && d.channel) {
                setChannels(prev => prev.map(c => c.id === id ? { ...c, ...d.channel } : c));
            }
            return d;
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }, [hdrs]);

    // ── Invite ────────────────────────────────────────────────────────────────
    const getInvite = useCallback(async (channelId) => {
        return fetch(`/api/axis/channels/${channelId}/invite`, { headers: hdrs() }).then(r => r.json());
    }, [hdrs]);

    const joinByInvite = useCallback(async (inviteCode) => {
        const d = await fetch('/api/axis/join', { method: 'POST', headers: hdrs(), body: JSON.stringify({ inviteCode }) }).then(r => r.json());
        if (d.ok) {
            const ch  = d.channel;
            const wss = await loadWorkspaces();
            setActiveWorkspaceId(ch.workspace_id);
            await loadChannels(ch.workspace_id);
            setActiveChannelId(ch.id);
        }
        return d;
    }, [hdrs, loadWorkspaces, loadChannels, setActiveWorkspaceId, setActiveChannelId]);

    // ── Members ───────────────────────────────────────────────────────────────
    const [members, setMembers] = useState([]);

    const loadMembers = useCallback(async (channelId) => {
        if (!channelId) return;
        try {
            const d = await fetch(`/api/axis/channels/${channelId}/members`, { headers: hdrs() }).then(r => r.json());
            if (d.ok) setMembers(d.members);
        } catch {}
    }, [hdrs]);

    const removeMember = useCallback(async (channelId, userId) => {
        await fetch(`/api/axis/channels/${channelId}/members/${userId}`, { method: 'DELETE', headers: hdrs() });
    }, [hdrs]);

    // ── Messages ──────────────────────────────────────────────────────────────
    const [messages, setMessages]   = useState([]);
    const [somaTyping, setSomaTyping] = useState(false);
    const [loading, setLoading]     = useState(true);

    const loadMessages = useCallback(async (channelId, opts = {}) => {
        if (!channelId) return;
        try {
            const params = new URLSearchParams({ channelId, limit: opts.limit || 50, ...(opts.before ? { before: opts.before } : {}) });
            const d = await fetch(`/api/axis/messages?${params}`, { headers: hdrs() }).then(r => r.json());
            if (d.ok) setMessages(d.messages.map(m => ({ ...m, reactions: parseReactions(m.reactions) })));
        } catch {}
    }, [hdrs]);

    const loadMoreMessages = useCallback(async (channelId, beforeId) => {
        if (!channelId || !beforeId) return false;
        try {
            const params = new URLSearchParams({ channelId, limit: 50, before: beforeId });
            const d = await fetch(`/api/axis/messages?${params}`, { headers: hdrs() }).then(r => r.json());
            if (d.ok && d.messages.length > 0) {
                const older = d.messages.map(m => ({ ...m, reactions: parseReactions(m.reactions) }));
                setMessages(prev => [...older, ...prev]);
                return d.messages.length === 50;
            }
            return false;
        } catch { return false; }
    }, [hdrs]);

    const sendMessage = useCallback(async (content, opts = {}) => {
        if (!activeChannelId || !content?.trim()) return;
        const { mode = 'archive', replyTo = null, gossipMs = null } = opts;
        try {
            await fetch('/api/axis/messages', {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ channelId: activeChannelId, content: content.trim(), mode, replyTo, gossipMs })
            });
            const ch = channels.find(c => c.id === activeChannelId);
            if (/@soma/i.test(content) || ch?.name === 'soma') setSomaTyping(true);
        } catch (e) { console.error('[Axis] send failed:', e); }
    }, [activeChannelId, hdrs, channels]);

    const deleteMessage = useCallback(async (id) => {
        await fetch(`/api/axis/messages/${id}`, { method: 'DELETE', headers: hdrs() });
    }, [hdrs]);

    const editMessage = useCallback(async (id, newContent) => {
        if (!newContent?.trim()) return;
        try {
            await fetch(`/api/axis/messages/${id}`, {
                method: 'PUT', headers: hdrs(),
                body: JSON.stringify({ content: newContent.trim() })
            });
        } catch (e) { console.error('[Axis] edit failed:', e); }
    }, [hdrs]);

    const reactToMessage = useCallback(async (messageId, emoji, remove = false) => {
        await fetch(`/api/axis/messages/${messageId}/react`, {
            method: 'POST', headers: hdrs(),
            body: JSON.stringify({ emoji, remove })
        });
    }, [hdrs]);

    // ── Projects ─────────────────────────────────────────────────────────────
    const [projects, setProjects]             = useState([]);
    const [activeProjectId, setActiveProjId] = useState(() => localStorage.getItem('axis_active_proj') || null);

    const setActiveProjectId = useCallback((id) => {
        localStorage.setItem('axis_active_proj', id || '');
        setActiveProjId(id);
    }, []);

    const loadProjects = useCallback(async (wsId) => {
        if (!wsId) return [];
        try {
            const d = await fetch(`/api/axis/projects?workspaceId=${wsId}`, { headers: hdrs() }).then(r => r.json());
            if (d.ok) { setProjects(d.projects); return d.projects; }
        } catch {}
        return [];
    }, [hdrs]);

    const createProject = useCallback(async ({ workspaceId, name, description, icon, color }) => {
        try {
            const d = await fetch('/api/axis/projects', { method: 'POST', headers: hdrs(), body: JSON.stringify({ workspaceId, name, description, icon, color }) }).then(r => r.json());
            if (d.ok) { loadProjects(workspaceId || activeWorkspaceId); setActiveProjectId(d.project.id); }
            return d;
        } catch (e) { return { ok: false, error: e.message }; }
    }, [hdrs, loadProjects, activeWorkspaceId, setActiveProjectId]);

    const updateProject = useCallback(async (id, updates) => {
        try {
            const d = await fetch(`/api/axis/projects/${id}`, { method: 'PATCH', headers: hdrs(), body: JSON.stringify(updates) }).then(r => r.json());
            if (d.ok) loadProjects(activeWorkspaceId);
            return d;
        } catch (e) { return { ok: false, error: e.message }; }
    }, [hdrs, loadProjects, activeWorkspaceId]);

    const deleteProject = useCallback(async (id) => {
        await fetch(`/api/axis/projects/${id}`, { method: 'DELETE', headers: hdrs() });
        if (activeProjectId === id) setActiveProjectId(null);
        loadProjects(activeWorkspaceId);
    }, [hdrs, activeProjectId, setActiveProjectId, loadProjects, activeWorkspaceId]);

    const addProjectMember = useCallback(async (projectId, member) => {
        return fetch(`/api/axis/projects/${projectId}/members`, { method: 'POST', headers: hdrs(), body: JSON.stringify(member) }).then(r => r.json());
    }, [hdrs]);

    // ── Tasks ─────────────────────────────────────────────────────────────────
    const [tasks, setTasks] = useState([]);

    const loadTasks = useCallback(async (projectId) => {
        if (!projectId) return;
        try {
            const d = await fetch(`/api/axis/projects/${projectId}/tasks`, { headers: hdrs() }).then(r => r.json());
            if (d.ok) setTasks(d.tasks);
        } catch {}
    }, [hdrs]);

    const createTask = useCallback(async (projectId, task) => {
        try {
            const d = await fetch(`/api/axis/projects/${projectId}/tasks`, { method: 'POST', headers: hdrs(), body: JSON.stringify(task) }).then(r => r.json());
            if (d.ok) setTasks(prev => [...prev, d.task]);
            return d;
        } catch (e) { return { ok: false, error: e.message }; }
    }, [hdrs]);

    const updateTask = useCallback(async (projectId, taskId, updates) => {
        try {
            const d = await fetch(`/api/axis/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', headers: hdrs(), body: JSON.stringify(updates) }).then(r => r.json());
            if (d.ok) setTasks(prev => prev.map(t => t.id === taskId ? d.task : t));
            return d;
        } catch (e) { return { ok: false, error: e.message }; }
    }, [hdrs]);

    const deleteTask = useCallback(async (projectId, taskId) => {
        await fetch(`/api/axis/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE', headers: hdrs() });
        setTasks(prev => prev.filter(t => t.id !== taskId));
    }, [hdrs]);

    const addTaskComment = useCallback(async (projectId, taskId, content) => {
        return fetch(`/api/axis/projects/${projectId}/tasks/${taskId}/comments`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ content }) }).then(r => r.json());
    }, [hdrs]);

    // ── Communities ───────────────────────────────────────────────────────────
    const [communities, setCommunities] = useState([]);

    const loadCommunities = useCallback(async () => {
        try {
            const d = await fetch('/api/axis/communities', { headers: hdrs() }).then(r => r.json());
            if (d.ok) setCommunities(d.communities);
        } catch {}
    }, [hdrs]);

    const createCommunity = useCallback(async (data) => {
        try {
            const d = await fetch('/api/axis/communities', { method: 'POST', headers: hdrs(), body: JSON.stringify(data) }).then(r => r.json());
            if (d.ok) { setCommunities(prev => [d.community, ...prev]); }
            return d;
        } catch (e) { return { ok: false, error: e.message }; }
    }, [hdrs]);

    const joinCommunity = useCallback(async (id) => {
        const d = await fetch(`/api/axis/communities/${id}/join`, { method: 'POST', headers: hdrs() }).then(r => r.json());
        if (d.ok) loadCommunities();
        return d;
    }, [hdrs, loadCommunities]);

    const leaveCommunity = useCallback(async (id) => {
        await fetch(`/api/axis/communities/${id}/leave`, { method: 'DELETE', headers: hdrs() });
        loadCommunities();
    }, [hdrs, loadCommunities]);

    const deleteCommunity = useCallback(async (id) => {
        await fetch(`/api/axis/communities/${id}`, { method: 'DELETE', headers: hdrs() });
        setCommunities(prev => prev.filter(c => c.id !== id));
    }, [hdrs]);

    // ── Typing indicators ─────────────────────────────────────────────────────
    const [typingUsers, setTypingUsers] = useState({});
    const typingTimers = useRef({});

    const sendTyping = useCallback((channelId) => {
        if (!channelId || !user?.id) return;
        fetch(`/api/axis/channels/${channelId}/typing`, { method: 'POST', headers: hdrs() }).catch(() => {});
    }, [hdrs, user?.id]); // eslint-disable-line

    // ── Online presence ───────────────────────────────────────────────────────
    const [onlineUsers, setOnlineUsers] = useState(new Set());

    // ── Unread counts + @mention tracking ────────────────────────────────────
    const [unreadCounts, setUnreadCounts]           = useState({});
    const [workspaceUnreadCounts, setWorkspaceUnreadCounts] = useState({});
    const [mentionedChannels, setMentionedChannels] = useState(new Set());

    const loadUnreadCounts = useCallback(async (wsId) => {
        if (!wsId) return;
        try {
            const d = await fetch(`/api/axis/unread/${wsId}`, { headers: hdrs() }).then(r => r.json());
            if (d.ok) {
                setUnreadCounts(d.counts);
                const total = Object.values(d.counts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
                setWorkspaceUnreadCounts(prev => ({ ...prev, [wsId]: total }));
            }
        } catch {}
    }, [hdrs]);

    const loadWorkspaceUnreadCounts = useCallback(async (wss = workspaces) => {
        if (!wss?.length) return {};
        const next = {};
        await Promise.all(wss.map(async (ws) => {
            try {
                const d = await fetch(`/api/axis/unread/${ws.id}`, { headers: hdrs() }).then(r => r.json());
                if (d.ok) next[ws.id] = Object.values(d.counts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
            } catch {}
        }));
        setWorkspaceUnreadCounts(next);
        return next;
    }, [hdrs, workspaces]);

    const markChannelRead = useCallback(async (channelId) => {
        if (!channelId) return;
        setUnreadCounts(prev => ({ ...prev, [channelId]: 0 }));
        setMentionedChannels(prev => { const s = new Set(prev); s.delete(channelId); return s; });
        try {
            await fetch(`/api/axis/read/${channelId}`, { method: 'POST', headers: hdrs() });
        } catch {}
    }, [hdrs]);

    const searchMessages = useCallback(async (query, opts = {}) => {
        if (!query?.trim()) return [];
        try {
            const params = new URLSearchParams({ q: query.trim() });
            if (opts.workspaceId) params.set('workspaceId', opts.workspaceId);
            if (opts.channelId)   params.set('channelId',   opts.channelId);
            if (opts.limit)       params.set('limit',       String(opts.limit));
            const d = await fetch(`/api/axis/search?${params}`, { headers: hdrs() }).then(r => r.json());
            return d.ok ? d.results : [];
        } catch { return []; }
    }, [hdrs]);

    // ── WebSocket real-time updates ───────────────────────────────────────────
    useEffect(() => {
        const onMsg = (payload) => {
            if (!payload) return;
            const msg          = { ...payload, reactions: parseReactions(payload.reactions) };
            const msgChannelId = msg.channel_id || msg.channelId;
            const msgSenderId  = msg.sender_id  || msg.senderId;

            setMessages(prev => {
                if (msgChannelId !== activeChannelId) return prev;
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
            });
            if (msg.is_soma || msgSenderId === 'soma') setSomaTyping(false);

            // Unread + mention tracking for non-active channels
            if (msgChannelId !== activeChannelId && msgSenderId !== user?.id) {
                setUnreadCounts(prev => ({ ...prev, [msgChannelId]: (prev[msgChannelId] || 0) + 1 }));
                if (user?.name && new RegExp(`@${user.name}`, 'i').test(msg.content)) {
                    setMentionedChannels(prev => new Set([...prev, msgChannelId]));
                }
            }
        };

        const onEdited = (payload) => {
            const msg = { ...payload, reactions: parseReactions(payload.reactions) };
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m));
        };

        const onReaction  = ({ messageId, reactions }) => setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
        const onDeleted   = ({ id })        => setMessages(prev => prev.filter(m => m.id !== id));
        const onMemberEvt = ({ channelId }) => { if (channelId === activeChannelId) loadMembers(channelId); };
        const onChCreated = (ch)            => { if (ch.workspace_id === activeWorkspaceId) setChannels(prev => [...prev, ch]); };
        const onChDeleted = ({ id })        => { setChannels(prev => prev.filter(c => c.id !== id)); if (activeChannelId === id) setActiveChannelId(null); };
        const onWsCreated = (ws)  => setWorkspaces(prev => upsertWorkspace(prev, ws));
        const onWsUpdated = (ws)  => setWorkspaces(prev => upsertWorkspace(prev, ws));
        const onWsDeleted = ({ id }) => { setWorkspaces(prev => prev.filter(w => w.id !== id)); if (activeWorkspaceId === id) setActiveWorkspaceId(null); };

        const onTyping = ({ channelId, userId, userName, userColor }) => {
            if (userId === user?.id) return;
            setTypingUsers(prev => ({
                ...prev,
                [channelId]: { ...(prev[channelId] || {}), [userId]: { name: userName, color: userColor } },
            }));
            const key = `${channelId}:${userId}`;
            if (typingTimers.current[key]) clearTimeout(typingTimers.current[key]);
            typingTimers.current[key] = setTimeout(() => {
                setTypingUsers(prev => {
                    const ch = { ...(prev[channelId] || {}) };
                    delete ch[userId];
                    return { ...prev, [channelId]: ch };
                });
            }, 4000);
        };

        const onPresence = ({ userId, status }) => {
            setOnlineUsers(prev => {
                const s = new Set(prev);
                if (status === 'online') s.add(userId); else s.delete(userId);
                return s;
            });
        };

        somaBackend.on('axis.message',           onMsg);
        somaBackend.on('axis.message_edited',    onEdited);
        somaBackend.on('axis.reaction',          onReaction);
        somaBackend.on('axis.message_deleted',   onDeleted);
        somaBackend.on('axis.member_joined',     onMemberEvt);
        somaBackend.on('axis.member_removed',    onMemberEvt);
        somaBackend.on('axis.channel_created',   onChCreated);
        somaBackend.on('axis.channel_deleted',   onChDeleted);
        somaBackend.on('axis.workspace_created', onWsCreated);
        somaBackend.on('axis.workspace_updated', onWsUpdated);
        somaBackend.on('axis.workspace_deleted', onWsDeleted);
        somaBackend.on('axis.typing',            onTyping);
        somaBackend.on('axis.presence',          onPresence);

        return () => {
            somaBackend.off('axis.message',           onMsg);
            somaBackend.off('axis.message_edited',    onEdited);
            somaBackend.off('axis.reaction',          onReaction);
            somaBackend.off('axis.message_deleted',   onDeleted);
            somaBackend.off('axis.member_joined',     onMemberEvt);
            somaBackend.off('axis.member_removed',    onMemberEvt);
            somaBackend.off('axis.channel_created',   onChCreated);
            somaBackend.off('axis.channel_deleted',   onChDeleted);
            somaBackend.off('axis.workspace_created', onWsCreated);
            somaBackend.off('axis.workspace_updated', onWsUpdated);
            somaBackend.off('axis.workspace_deleted', onWsDeleted);
            somaBackend.off('axis.typing',            onTyping);
            somaBackend.off('axis.presence',          onPresence);
        };
    }, [activeChannelId, activeWorkspaceId, loadMembers, setActiveChannelId, setActiveWorkspaceId, user?.id, user?.name]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Bootstrap ─────────────────────────────────────────────────────────────
    useEffect(() => {
        loadWorkspaces().then(async (wss) => {
            let wsId = activeWorkspaceId;
            const mainWs = wss.find(ws => ws.name === 'Main') || wss.find(ws => ws.name !== 'Directs') || wss[0];
            const activeWs = wss.find(ws => ws.id === wsId);
            if (!wsId || activeWs?.name === 'Directs') {
                wsId = mainWs?.id;
                if (wsId) setActiveWorkspaceId(wsId);
            }
            await fetch('/api/axis/directs', { headers: hdrs() }).catch(() => {});
            if (wsId) {
                const chs = await loadChannels(wsId);
                let chId  = activeChannelId;
                if (chId && !chs.some(ch => ch.id === chId)) {
                    const fallback = pickDefaultAxisChannel(chs);
                    setActiveChannelId(fallback?.id || null);
                    chId = null;
                }
                if (!chId) {
                    const fallback = pickDefaultAxisChannel(chs);
                    if (fallback?.id) setActiveChannelId(fallback.id);
                }
            }
            loadWorkspaceUnreadCounts(wss);
            setLoading(false);
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!activeWorkspaceId) {
            setChannels([]);
            setProjects([]);
            setMessages([]);
            setSomaTyping(false);
            return;
        }
        loadChannels(activeWorkspaceId).then(chs => {
            if (activeChannelId && !chs.some(ch => ch.id === activeChannelId)) {
                const fallback = pickDefaultAxisChannel(chs);
                setActiveChannelId(fallback?.id || null);
                return;
            }
            if (!activeChannelId) {
                const fallback = pickDefaultAxisChannel(chs);
                if (fallback?.id) setActiveChannelId(fallback.id);
            }
        });
        loadUnreadCounts(activeWorkspaceId);
    }, [activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (workspaces.length) loadWorkspaceUnreadCounts(workspaces);
    }, [workspaces, loadWorkspaceUnreadCounts]);

    useEffect(() => {
        if (activeChannelId && channels.length && !channels.some(ch => ch.id === activeChannelId)) {
            setActiveChannelId(null);
            return;
        }
        if (!activeChannelId) return;
        setMessages([]);
        setSomaTyping(false);
        loadMessages(activeChannelId);
        loadMembers(activeChannelId);
        markChannelRead(activeChannelId);
    }, [activeChannelId, channels]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Derived: total unread → broadcast for sidebar badge ──────────────────
    const totalUnread = Object.keys(workspaceUnreadCounts).length
        ? Object.values(workspaceUnreadCounts).reduce((a, b) => a + b, 0)
        : Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('axis:unread', { detail: { count: totalUnread } }));
    }, [totalUnread]);

    // ── Studio live re-sync on window focus or studio:profile-saved ──────────
    useEffect(() => {
        const applyProfile = (sp) => {
            if (!sp) return;
            studioRef.current = sp;
            setUser(prev => {
                if (!prev) return prev;
                const next = {
                    ...prev,
                    id:       sp.axis?.userId || prev.id,
                    handle:   sp.axis?.handle || prev.handle,
                    color:    sp.axis?.color  || prev.color,
                    name:     sp.name         || sp.axis?.displayName || prev.name,
                    avatar:   deterministicUserAvatar(sp, prev),
                    bio:      sp.bio          || prev.bio,
                    role:     sp.role         || prev.role,
                    location: sp.location     || prev.location,
                    timezone: sp.timezone     || prev.timezone,
                };
                localStorage.setItem(USER_KEY, JSON.stringify(next));
                return next;
            });
        };
        const syncProfile = () => {
            fetch('/api/studio/profile')
                .then(r => r.json())
                .then(data => { if (data?.profile) applyProfile(data.profile); })
                .catch(() => {});
        };
        const onStudioSaved = (e) => applyProfile(e.detail);
        window.addEventListener('focus', syncProfile);
        window.addEventListener('studio:profile-saved', onStudioSaved);
        return () => {
            window.removeEventListener('focus', syncProfile);
            window.removeEventListener('studio:profile-saved', onStudioSaved);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Broadcast own presence on mount/focus/blur ────────────────────────────
    useEffect(() => {
        if (!user?.id) return;
        const send = (status) => fetch('/api/axis/presence', {
            method: 'POST', headers: hdrs(), body: JSON.stringify({ status }),
        }).catch(() => {});
        send('online');
        const onBlur  = () => send('away');
        const onFocus = () => send('online');
        window.addEventListener('blur',  onBlur);
        window.addEventListener('focus', onFocus);
        return () => {
            send('offline');
            window.removeEventListener('blur',  onBlur);
            window.removeEventListener('focus', onFocus);
        };
    }, [user?.id]); // eslint-disable-line

    // ── Navigate to workspace by name (dispatched by Studio communities) ──────
    useEffect(() => {
        const handler = (e) => {
            const name = e.detail?.name || localStorage.getItem('axis:pending-navigate');
            if (!name || !workspaces.length) return;
            localStorage.removeItem('axis:pending-navigate');
            const ws = workspaces.find(w => w.name === name);
            if (!ws) return;
            setActiveWorkspaceId(ws.id);
            loadChannels(ws.id).then(chs => {
                const fallback = pickDefaultAxisChannel(chs);
                setActiveChannelId(fallback?.id || null);
            });
        };
        window.addEventListener('axis:navigate-workspace', handler);
        // Also handle pending navigation stored while Axis was unmounted
        const pending = localStorage.getItem('axis:pending-navigate');
        if (pending && workspaces.length) handler({ detail: { name: pending } });
        return () => window.removeEventListener('axis:navigate-workspace', handler);
    }, [workspaces]); // eslint-disable-line

    // ── Navigate to a specific channel/direct from Studio or other apps ───────
    useEffect(() => {
        const handler = (e) => {
            let detail = e.detail;
            if (!detail) {
                try { detail = JSON.parse(localStorage.getItem('axis:pending-channel') || 'null'); } catch { detail = null; }
            }
            const channelId = detail?.channelId || detail?.id;
            const workspaceId = detail?.workspaceId;
            const projectId = detail?.projectId;
            if (!channelId) return;
            localStorage.removeItem('axis:pending-channel');

            if (detail?.type === 'dm' || detail?.isDirect || String(channelId).startsWith('dm-')) {
                setActiveWorkspaceId(null);
                setActiveChannelId(null);
                localStorage.setItem('axis:pending-direct-home', JSON.stringify({ directId: channelId, workspaceId }));
                window.dispatchEvent(new CustomEvent('axis:open-direct-home', { detail: { directId: channelId, workspaceId } }));
                return;
            }

            const activate = async (wsId) => {
                if (wsId) {
                    setActiveWorkspaceId(wsId);
                    const chs = await loadChannels(wsId);
                    if (!chs.some(ch => ch.id === channelId)) {
                        setActiveChannelId(null);
                        return;
                    }
                }
                setActiveChannelId(channelId);
                if (projectId) setActiveProjectId(projectId);
            };

            if (workspaceId) {
                activate(workspaceId);
                return;
            }

            const found = channels.find(ch => ch.id === channelId);
            if (found?.workspace_id) activate(found.workspace_id);
            else setActiveChannelId(null);
        };
        window.addEventListener('axis:navigate-channel', handler);
        const pending = localStorage.getItem('axis:pending-channel');
        if (pending) handler({});
        return () => window.removeEventListener('axis:navigate-channel', handler);
    }, [channels, loadChannels, setActiveChannelId, setActiveWorkspaceId]);

    // ── DM helper ─────────────────────────────────────────────────────────────
    const findOrCreateDM = useCallback(async (targetUserId, targetUserName, targetUserColor = 'violet') => {
        if (!targetUserId || !user?.id) return null;
        const result = await fetch('/api/axis/directs', {
            method: 'POST',
            headers: hdrs(),
            body: JSON.stringify({
                targetUserId,
                targetUserName: targetUserName || targetUserId,
                targetUserColor,
            }),
        }).then(r => r.json()).catch(() => null);
        const direct = result?.direct;
        if (!direct?.id || !direct?.workspaceId) return null;
        await loadWorkspaces();
        await loadChannels(direct.workspaceId);
        setActiveWorkspaceId(null);
        setActiveChannelId(null);
        localStorage.setItem('axis:pending-direct-home', JSON.stringify({ directId: direct.id, workspaceId: direct.workspaceId }));
        window.dispatchEvent(new CustomEvent('axis:open-direct-home', { detail: { directId: direct.id, workspaceId: direct.workspaceId } }));
        return {
            id: direct.id,
            workspace_id: direct.workspaceId,
            name: `dm-${[user.id, targetUserId].sort().join('-')}`,
            type: 'dm',
            description: `Direct with ${direct.title || targetUserName || targetUserId}`,
            is_private: 1,
            created_by: user.id,
            created_at: direct.updatedAt || Date.now(),
        };
    }, [hdrs, user?.id, loadWorkspaces, loadChannels, setActiveChannelId, setActiveWorkspaceId]);

    // ── Load projects when workspace changes ─────────────────────────────────
    useEffect(() => {
        if (activeWorkspaceId) loadProjects(activeWorkspaceId);
        else setProjects([]);
    }, [activeWorkspaceId]); // eslint-disable-line

    // ── Load tasks when project changes ──────────────────────────────────────
    useEffect(() => {
        if (activeProjectId) loadTasks(activeProjectId);
        else setTasks([]);
    }, [activeProjectId]); // eslint-disable-line

    // ── Load communities on mount ─────────────────────────────────────────────
    useEffect(() => { loadCommunities(); }, []); // eslint-disable-line

    // ── WebSocket: project / task / community events ──────────────────────────
    useEffect(() => {
        const unwrapProject = (payload) => payload?.project || payload;
        const unwrapTask = (payload) => payload?.task || payload;
        const onProjCreated = (payload) => {
            const p = unwrapProject(payload);
            if (p?.workspace_id === activeWorkspaceId) {
                setProjects(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p]);
            }
        };
        const onProjUpdated = (payload) => {
            const p = unwrapProject(payload);
            if (p?.id) setProjects(prev => prev.map(x => x.id === p.id ? p : x));
        };
        const onProjDeleted = ({ id }) => { setProjects(prev => prev.filter(x => x.id !== id)); if (activeProjectId === id) setActiveProjectId(null); };

        const onTaskCreated = (payload) => {
            const t = unwrapTask(payload);
            const projectId = payload?.projectId || t?.project_id;
            if (t?.id && projectId === activeProjectId) {
                setTasks(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t]);
            }
        };
        const onTaskUpdated = (payload) => {
            const t = unwrapTask(payload);
            if (t?.id) setTasks(prev => prev.map(x => x.id === t.id ? t : x));
        };
        const onTaskDeleted = ({ taskId }) => setTasks(prev => prev.filter(x => x.id !== taskId));

        const onCommCreated = (c) => setCommunities(prev => [c, ...prev]);
        const onCommUpdated = (c) => setCommunities(prev => prev.map(x => x.id === c.id ? c : x));
        const onCommDeleted = ({ id }) => setCommunities(prev => prev.filter(x => x.id !== id));

        somaBackend.on('axis.project_created',  onProjCreated);
        somaBackend.on('axis.project_updated',  onProjUpdated);
        somaBackend.on('axis.project_deleted',  onProjDeleted);
        somaBackend.on('axis.task_created',     onTaskCreated);
        somaBackend.on('axis.task_updated',     onTaskUpdated);
        somaBackend.on('axis.task_deleted',     onTaskDeleted);
        somaBackend.on('axis.community_created', onCommCreated);
        somaBackend.on('axis.community_updated', onCommUpdated);
        somaBackend.on('axis.community_deleted', onCommDeleted);

        return () => {
            somaBackend.off('axis.project_created',  onProjCreated);
            somaBackend.off('axis.project_updated',  onProjUpdated);
            somaBackend.off('axis.project_deleted',  onProjDeleted);
            somaBackend.off('axis.task_created',     onTaskCreated);
            somaBackend.off('axis.task_updated',     onTaskUpdated);
            somaBackend.off('axis.task_deleted',     onTaskDeleted);
            somaBackend.off('axis.community_created', onCommCreated);
            somaBackend.off('axis.community_updated', onCommUpdated);
            somaBackend.off('axis.community_deleted', onCommDeleted);
        };
    }, [activeWorkspaceId, activeProjectId]); // eslint-disable-line

    const activeChannel   = channels.find(c => c.id === activeChannelId)   || null;
    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;
    const activeProject   = projects.find(p => p.id === activeProjectId)    || null;

    return (
        <AxisContext.Provider value={{
            user, setupUser, AXIS_COLORS,
            workspaces, activeWorkspaceId, setActiveWorkspaceId, activeWorkspace,
            createWorkspace, updateWorkspace, deleteWorkspace,
            channels, activeChannelId, setActiveChannelId, activeChannel,
            loadChannels, createChannel, updateChannel, deleteChannel,
            members, loadMembers, removeMember,
            messages, somaTyping, loading,
            loadMoreMessages,
            sendMessage, deleteMessage, editMessage, reactToMessage,
            unreadCounts, workspaceUnreadCounts, mentionedChannels, markChannelRead, totalUnread,
            searchMessages,
            getInvite, joinByInvite,
            findOrCreateDM,
            typingUsers, sendTyping,
            onlineUsers,
            hdrs,
            projects, activeProjectId, setActiveProjectId, activeProject,
            loadProjects, createProject, updateProject, deleteProject, addProjectMember,
            tasks, loadTasks, createTask, updateTask, deleteTask, addTaskComment,
            communities, loadCommunities, createCommunity, joinCommunity, leaveCommunity, deleteCommunity,
        }}>
            {children}
        </AxisContext.Provider>
    );
};

export const useAxis = () => {
    const ctx = useContext(AxisContext);
    if (!ctx) throw new Error('useAxis must be inside AxisProvider');
    return ctx;
};
