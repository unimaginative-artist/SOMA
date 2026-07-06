import express from 'express';
import axisStore from '../axis/AxisStore.js';
import axisProfileStore from '../axis/AxisProfileStore.js';
import { stableAvatar } from '../axis/stableAvatar.js';
import { reasonGrounded } from '../context/GroundedReasoning.js';

export default function createAxisRoutes(system) {
    const router = express.Router();

    const getUser = (req) => ({
        userId:    req.headers['x-axis-user-id']    || 'anon',
        userName:  req.headers['x-axis-user-name']  || 'Anonymous',
        userColor: req.headers['x-axis-user-color'] || 'blue',
    });

    const bcast = (type, payload) => system.broadcast?.(type, payload);

    const getDirectsWorkspace = (u, createIfMissing = false) => {
        let ws = axisStore.getWorkspaces().find(item => item.name === 'Directs');
        if (!ws && createIfMissing) {
            ws = axisStore.createWorkspace({ name: 'Directs', icon: 'mail', color: 'violet', createdBy: u.userId, type: 'workspace', description: 'Private direct message hub.' });
            bcast('axis.workspace_created', ws);
        }
        return ws;
    };

    const formatDirectChannel = (ch, u) => {
        const members = axisStore.getMembers(ch.id);
        const other = members.find(member => member.user_id !== u.userId) || members[0] || null;
        const last = axisStore.getMessages(ch.id, { limit: 1 })[0] || null;
        const unread = axisStore.getUnreadCounts(ch.workspace_id, u.userId)?.[ch.id] || 0;
        const title = (ch.description || '').replace(/^Direct with\s+/i, '').trim() || other?.user_name || ch.name;
        const image = axisStore.getContactImage(other?.user_id) || stableAvatar({
            id: other?.user_id || ch.id,
            name: title,
        });
        return {
            id: ch.id,
            axisId: ch.id,
            otherId: other?.user_id || '',
            workspaceId: ch.workspace_id,
            title,
            image,
            members: members.map(member => member.user_name).filter(Boolean).join(', '),
            messagesCount: unread > 0 ? `${unread} unread` : last ? `${last.sender_id === u.userId ? 'Sent' : 'Seen'} · ${new Date(last.created_at).toLocaleDateString()}` : 'No messages yet',
            status: 'active',
            unread,
            lastMessage: last?.content || '',
            updatedAt: last?.created_at || ch.created_at,
            online: false,
            axisSource: 'axis',
        };
    };

    const ensureDirectChannel = ({ targetUserId, targetUserName, targetUserColor, image }, u) => {
        const ws = getDirectsWorkspace(u, true);
        const safeTargetId = targetUserId || `direct-${String(targetUserName || 'contact').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const dmSlug = `dm-${[u.userId, safeTargetId].sort().join('-')}`;
        let ch = axisStore.getWorkspaces()
            .flatMap(workspace => axisStore.getChannels(workspace.id))
            .find(item => item.type === 'dm' && (item.name === dmSlug || item.name.includes(safeTargetId)));
        if (ch && ch.workspace_id !== ws.id) {
            axisStore.db.prepare('UPDATE channels SET workspace_id = ? WHERE id = ?').run(ws.id, ch.id);
            ch = axisStore.getChannel(ch.id);
        }
        if (!ch) {
            ch = axisStore.createChannel({
                workspaceId: ws.id,
                name: dmSlug,
                type: 'dm',
                description: `Direct with ${targetUserName || safeTargetId}`,
                isPrivate: true,
                createdBy: u.userId,
            });
            axisStore.addMember(ch.id, {
                userId: safeTargetId,
                userName: targetUserName || safeTargetId,
                userColor: targetUserColor,
            });
            bcast('axis.channel_created', ch);
        }
        if (image) axisStore.setContactImage(safeTargetId, image);
        return {
            ...formatDirectChannel(ch, u),
            image: stableAvatar({ id: safeTargetId, name: targetUserName || safeTargetId, image: image || axisStore.getContactImage(safeTargetId) }),
        };
    };

    const ensureDemoDirect = (u) => {
        const direct = ensureDirectChannel({
            targetUserId: 'demo-erin',
            targetUserName: 'Erin Demo',
            targetUserColor: 'emerald',
            image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
        }, u);
        if (axisStore.getMessages(direct.id, { limit: 1 }).length === 0) {
            axisStore.addMessage({
                channelId: direct.id,
                workspaceId: direct.workspaceId,
                senderId: 'demo-erin',
                senderName: 'Erin Demo',
                senderColor: 'emerald',
                content: 'Pipeline check: this is a real Axis Direct. Reply here and it will persist through the same message route.',
                mode: 'archive',
            });
            axisStore.addMessage({
                channelId: direct.id,
                workspaceId: direct.workspaceId,
                senderId: u.userId,
                senderName: u.userName,
                senderColor: u.userColor,
                content: 'Confirmed. Studio Directs are connected to Axis.',
                mode: 'archive',
            });
        }
        return direct;
    };

    const syncStudioDirectsToAxis = (u) => {
        try {
            const state = axisProfileStore.getState();
            const chats = Array.isArray(state.chats) ? state.chats : [];
            const messagesByChat = state.messages && typeof state.messages === 'object' ? state.messages : {};
            for (const chat of chats) {
                if (!chat?.id || !chat?.title) continue;
                const direct = ensureDirectChannel({
                    targetUserId: chat.id,
                    targetUserName: chat.title,
                    targetUserColor: chat.color || 'violet',
                    image: chat.image,
                }, u);
                if (axisStore.getMessages(direct.id, { limit: 1 }).length > 0) continue;
                const seeded = Array.isArray(messagesByChat[chat.id]) ? messagesByChat[chat.id] : [];
                for (const item of seeded) {
                    const isUser = item.sender === 'user';
                    const content = String(item.text || item.content || '').trim();
                    if (!content) continue;
                    axisStore.addMessage({
                        channelId: direct.id,
                        workspaceId: direct.workspaceId,
                        senderId: isUser ? u.userId : chat.id,
                        senderName: isUser ? u.userName : chat.title,
                        senderColor: isUser ? u.userColor : (chat.color || 'violet'),
                        content,
                        mode: 'archive',
                    });
                }
            }
        } catch (e) {
            console.warn('[Axis] Studio Direct sync skipped:', e.message);
        }
    };

    // ── Studio/Profile Bridge ────────────────────────────────────────────────
    router.get('/profile', (_req, res) => {
        try {
            res.json({ ok: true, axis: axisProfileStore.getState() });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.put('/profile', (req, res) => {
        try {
            const state = axisProfileStore.saveState(req.body?.axis || req.body || {});
            res.json({ ok: true, axis: state });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/profile/friends', (req, res) => {
        try {
            const result = axisProfileStore.addFriend(req.body || {});
            bcast('axis.profile_friend_added', result.friend);
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/profile/friends/:id', (req, res) => {
        try {
            const result = axisProfileStore.updateFriend(req.params.id, req.body || {});
            bcast('axis.profile_friend_updated', result.friend);
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/profile/friends/:id', (req, res) => {
        try {
            const result = axisProfileStore.removeFriend(req.params.id);
            bcast('axis.profile_friend_removed', result.friend);
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/profile/chats/:id', (req, res) => {
        try {
            const chat = axisProfileStore.updateChat(req.params.id, req.body || {});
            bcast('axis.profile_chat_updated', chat);
            res.json({ ok: true, chat, axis: axisProfileStore.getState() });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/profile/chats/:id/messages', (req, res) => {
        try {
            res.json({ ok: true, ...axisProfileStore.getMessages(req.params.id) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/profile/chats/:id/messages', (req, res) => {
        try {
            const result = axisProfileStore.addMessage(req.params.id, req.body || {});
            bcast('axis.profile_message', { chatId: req.params.id, message: result.message });
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Directs adapter: one real Axis-backed path for Studio + Axis ─────────
    router.get('/directs', (req, res) => {
        const u = getUser(req);
        syncStudioDirectsToAxis(u);
        let ws = getDirectsWorkspace(u, false);
        if (!ws) {
            ensureDemoDirect(u);
            ws = getDirectsWorkspace(u, false);
        }
        if (ws) {
            axisStore.db.prepare('UPDATE channels SET workspace_id = ? WHERE type = ? AND workspace_id != ?').run(ws.id, 'dm', ws.id);
        }
        const directs = axisStore.getWorkspaces()
            .flatMap(workspace => axisStore.getChannels(workspace.id))
            .filter(ch => ch.type === 'dm')
            .map(ch => formatDirectChannel(ch, u))
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        res.json({ ok: true, directs, workspace: ws });
    });

    router.post('/directs', (req, res) => {
        try {
            const direct = ensureDirectChannel(req.body || {}, getUser(req));
            res.json({ ok: true, direct });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/directs/:id/messages', (req, res) => {
        const u = getUser(req);
        const ch = axisStore.getChannel(req.params.id);
        if (!ch || ch.type !== 'dm') return res.status(404).json({ ok: false, error: 'direct not found' });
        const messages = axisStore.getMessages(ch.id, { limit: 100 }).map(msg => ({
            id: msg.id,
            sender: msg.sender_id === u.userId ? 'user' : 'other',
            text: msg.content,
            timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            avatar: '',
            createdAt: msg.created_at,
        }));
        axisStore.markRead(ch.id, u.userId);
        res.json({ ok: true, messages, direct: formatDirectChannel(ch, u) });
    });

    router.get('/directs-search', (req, res) => {
        const u = getUser(req);
        const q = String(req.query.q || '').trim().toLowerCase();
        if (!q) return res.json({ ok: true, results: [] });
        const rows = axisStore.getWorkspaces()
            .flatMap(workspace => axisStore.getChannels(workspace.id))
            .filter(ch => ch.type === 'dm');
        const results = [];
        for (const ch of rows) {
            const direct = formatDirectChannel(ch, u);
            const messages = axisStore.getMessages(ch.id, { limit: 80 });
            const nameHit = direct.title.toLowerCase().includes(q);
            const hits = messages.filter(msg =>
                String(msg.content || '').toLowerCase().includes(q) ||
                String(msg.sender_name || '').toLowerCase().includes(q)
            );
            if (nameHit || hits.length) {
                results.push({
                    direct,
                    matches: hits.slice(-3).map(msg => ({
                        id: msg.id,
                        text: msg.content,
                        sender: msg.sender_id === u.userId ? 'user' : 'other',
                        senderName: msg.sender_name,
                        timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        createdAt: msg.created_at,
                    })),
                    score: (nameHit ? 10 : 0) + hits.length,
                });
            }
        }
        results.sort((a, b) => b.score - a.score || (b.direct.updatedAt || 0) - (a.direct.updatedAt || 0));
        res.json({ ok: true, results: results.slice(0, 20) });
    });

    router.post('/directs/:id/messages', (req, res) => {
        const u = getUser(req);
        const ch = axisStore.getChannel(req.params.id);
        if (!ch || ch.type !== 'dm') return res.status(404).json({ ok: false, error: 'direct not found' });
        const text = String(req.body?.text || req.body?.content || '').trim();
        if (!text) return res.status(400).json({ ok: false, error: 'text required' });
        const msg = axisStore.addMessage({
            channelId: ch.id,
            workspaceId: ch.workspace_id,
            senderId: u.userId,
            senderName: u.userName,
            senderColor: u.userColor,
            content: text,
            mode: 'archive',
        });
        bcast('axis.message', { ...msg, isDirect: true });
        const members = axisStore.getMembers(ch.id);
        const hasDemo = members.some(member => member.user_id === 'demo-erin');
        if (hasDemo && u.userId !== 'demo-erin') {
            const demoText = text.length > 120
                ? 'Got it. That message persisted through the real Directs route. I am here to prove the pipeline, not pretend to be a full user yet.'
                : `Received: "${text}". This reply was generated by the demo Direct simulator and saved to Axis.`;
            const demoMsg = axisStore.addMessage({
                channelId: ch.id,
                workspaceId: ch.workspace_id,
                senderId: 'demo-erin',
                senderName: 'Erin Demo',
                senderColor: 'emerald',
                content: demoText,
                mode: 'archive',
            });
            bcast('axis.message', { ...demoMsg, isDirect: true });
        }
        const messages = axisStore.getMessages(ch.id, { limit: 100 }).map(item => ({
            id: item.id,
            sender: item.sender_id === u.userId ? 'user' : 'other',
            text: item.content,
            timestamp: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            avatar: '',
            createdAt: item.created_at,
        }));
        res.json({ ok: true, message: msg, messages, direct: formatDirectChannel(ch, u) });
    });

    router.get('/directs/:id/search', (req, res) => {
        const u = getUser(req);
        const ch = axisStore.getChannel(req.params.id);
        const q = String(req.query.q || '').trim();
        if (!ch || ch.type !== 'dm') return res.status(404).json({ ok: false, error: 'direct not found' });
        if (!q) return res.json({ ok: true, results: [] });
        const results = axisStore.searchMessages(q, { channelId: ch.id, limit: 30 }).map(item => ({
            id: item.id,
            sender: item.sender_id === u.userId ? 'user' : 'other',
            text: item.content,
            snippet: item.snippet || item.content,
            timestamp: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            createdAt: item.created_at,
            senderName: item.sender_name,
        }));
        res.json({ ok: true, results });
    });

    // ── Workspaces ───────────────────────────────────────────────────────────
    router.get('/workspaces', (_req, res) => {
        res.json({ ok: true, workspaces: axisStore.getWorkspaces() });
    });

    const ROOM_CHANNEL_TEMPLATES = {
        community: [
            ['introductions', 'text', 'Who is here and what are they building?'],
            ['announcements', 'text', 'Important room updates.'],
            ['help', 'text', 'Questions, requests, and quick support.'],
        ],
        research: [
            ['questions', 'text', 'Open questions and hypotheses.'],
            ['sources', 'text', 'Papers, links, references, and evidence.'],
            ['findings', 'text', 'Confirmed findings and synthesis notes.'],
        ],
        trading: [
            ['market-watch', 'text', 'Live watchlist, catalysts, and market context.'],
            ['thesis', 'text', 'Trade ideas, assumptions, invalidation, and evidence.'],
            ['risk-review', 'text', 'Risk checks, sizing notes, and post-trade review.'],
        ],
        creative: [
            ['ideas', 'text', 'Raw ideas, sparks, references, and prompts.'],
            ['drafts', 'text', 'Works in progress and iteration notes.'],
            ['critique', 'text', 'Feedback, refinement, and publishing decisions.'],
        ],
        support: [
            ['help-desk', 'text', 'Incoming questions and support requests.'],
            ['bugs', 'text', 'Bug reports, reproduction steps, and fixes.'],
            ['resolved', 'archive', 'Closed issues and useful answers.'],
        ],
    };

    router.post('/workspaces', (req, res) => {
        const { name, icon, color, type, description, community_id, roomTemplate } = req.body;
        if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
        try {
            const u = getUser(req);
            if (community_id) {
                const existing = axisStore.getWorkspaces().find(ws => ws.community_id === community_id || (ws.type === 'community' && ws.name === name.trim()));
                if (existing) return res.json({ ok: true, workspace: existing, existing: true });
            }
            const ws = axisStore.createWorkspace({ name: name.trim(), icon, color, createdBy: u.userId, type: type || 'workspace', description: description || '', community_id: community_id || null });
            if ((type || 'workspace') === 'room' || (type || 'workspace') === 'community') {
                const template = ROOM_CHANNEL_TEMPLATES[roomTemplate] || ROOM_CHANNEL_TEMPLATES.community;
                for (const [channelName, channelType, channelDescription] of template) {
                    const ch = axisStore.createChannel({
                        workspaceId: ws.id,
                        name: channelName,
                        type: channelType,
                        description: channelDescription,
                        isPrivate: false,
                        createdBy: u.userId,
                    });
                    bcast('axis.channel_created', ch);
                }
            }
            bcast('axis.workspace_created', ws);
            res.json({ ok: true, workspace: ws });
        } catch (e) {
            console.error('[Axis] createWorkspace error:', e);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.patch('/workspaces/:id', (req, res) => {
        try {
            const ws = axisStore.updateWorkspace(req.params.id, req.body || {});
            if (ws) bcast('axis.workspace_updated', ws);
            res.json({ ok: true, workspace: ws });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.delete('/workspaces/:id', (req, res) => {
        try {
            const deleted = axisStore.deleteWorkspace(req.params.id);
            if (deleted) bcast('axis.workspace_deleted', { id: req.params.id });
            res.json({ ok: true, deleted });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Channels ─────────────────────────────────────────────────────────────
    router.get('/channels', (req, res) => {
        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId required' });
        res.json({ ok: true, channels: axisStore.getChannels(workspaceId) });
    });

    router.post('/channels', (req, res) => {
        const { workspaceId, name, type, description, isPrivate, members = [] } = req.body;
        if (!workspaceId || !name?.trim()) return res.status(400).json({ ok: false, error: 'workspaceId + name required' });
        try {
            const u = getUser(req);
            const ch = axisStore.createChannel({ workspaceId, name: name.trim(), type, description, isPrivate, createdBy: u.userId });
            for (const member of members) {
                if (!member?.userId) continue;
                axisStore.addMember(ch.id, {
                    userId: member.userId,
                    userName: member.userName || member.name || member.userId,
                    userColor: member.userColor || member.color,
                    role: member.role || 'member',
                });
            }
            bcast('axis.channel_created', ch);
            res.json({ ok: true, channel: ch });
        } catch (e) {
            console.error('[Axis] createChannel error:', e);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.patch('/channels/:id', (req, res) => {
        try {
            const ch = axisStore.updateChannel(req.params.id, req.body || {});
            if (ch) bcast('axis.channel_updated', ch);
            res.json({ ok: true, channel: ch });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.delete('/channels/:id', (req, res) => {
        axisStore.deleteChannel(req.params.id);
        bcast('axis.channel_deleted', { id: req.params.id });
        res.json({ ok: true });
    });

    // ── Invite ────────────────────────────────────────────────────────────────
    router.get('/channels/:id/invite', (req, res) => {
        const ch = axisStore.getChannel(req.params.id);
        if (!ch) return res.status(404).json({ ok: false, error: 'not found' });
        res.json({ ok: true, inviteCode: ch.invite_code, channelName: ch.name });
    });

    router.post('/channels/:id/invite/refresh', (req, res) => {
        const code = axisStore.refreshInvite(req.params.id);
        res.json({ ok: true, inviteCode: code });
    });

    router.post('/join', (req, res) => {
        const { inviteCode } = req.body;
        if (!inviteCode) return res.status(400).json({ ok: false, error: 'inviteCode required' });
        const ch = axisStore.findByInvite(inviteCode);
        if (!ch) return res.status(404).json({ ok: false, error: 'invalid invite code' });
        const u = getUser(req);
        axisStore.addMember(ch.id, { userId: u.userId, userName: u.userName, userColor: u.userColor });
        bcast('axis.member_joined', { channelId: ch.id, workspaceId: ch.workspace_id, user: u });
        res.json({ ok: true, channel: ch });
    });

    // ── Members ───────────────────────────────────────────────────────────────
    router.get('/channels/:id/members', (req, res) => {
        res.json({ ok: true, members: axisStore.getMembers(req.params.id) });
    });

    router.delete('/channels/:channelId/members/:userId', (req, res) => {
        axisStore.removeMember(req.params.channelId, req.params.userId);
        bcast('axis.member_removed', { channelId: req.params.channelId, userId: req.params.userId });
        res.json({ ok: true });
    });

    // ── Messages ──────────────────────────────────────────────────────────────
    router.get('/messages', (req, res) => {
        const { channelId, limit, before } = req.query;
        if (!channelId) return res.status(400).json({ ok: false, error: 'channelId required' });
        const msgs = axisStore.getMessages(channelId, {
            limit:  parseInt(limit)  || 100,
            before: before ? parseInt(before) : null,
        });
        res.json({ ok: true, messages: msgs });
    });

    router.post('/messages', async (req, res) => {
        const { channelId, content, mode, replyTo, gossipMs } = req.body;
        if (!channelId || !content?.trim()) return res.status(400).json({ ok: false, error: 'channelId + content required' });

        const ch = axisStore.getChannel(channelId);
        if (!ch) return res.status(404).json({ ok: false, error: 'channel not found' });

        const u = getUser(req);
        let msg;

        if (mode === 'whisper') {
            // Whisper: broadcast only, never persisted
            msg = {
                id:          `wh-${Date.now()}`,
                channel_id:  channelId,
                workspace_id: ch.workspace_id,
                sender_id:   u.userId,
                sender_name: u.userName,
                sender_color: u.userColor,
                content:     content.trim(),
                mode:        'whisper',
                is_soma:     0,
                created_at:  Date.now(),
                reactions:   {},
            };
        } else {
            const expiresAt = mode === 'gossip' && gossipMs ? Date.now() + gossipMs : null;
            msg = axisStore.addMessage({
                channelId, workspaceId: ch.workspace_id,
                senderId: u.userId, senderName: u.userName, senderColor: u.userColor,
                content: content.trim(), mode: mode || 'archive', expiresAt, replyTo,
            });
        }

        bcast('axis.message', msg);
        res.json({ ok: true, message: msg });

        // SOMA response (async after res, non-blocking)
        const wantsSoma = /@soma/i.test(content) || ch.name === 'soma';
        if (wantsSoma && mode !== 'whisper') {
            setTimeout(async () => {
                try {
                    const brain = system.quadBrain || system.brain;
                    if (!brain?.reason) return;
                    const result   = await reasonGrounded(brain, content.trim(), {
                        system,
                        context: { quickResponse: false, context: `axis:${ch.name}`, source: 'axis' }
                    });
                    const text     = result?.text || result?.message || '';
                    if (!text) return;
                    const somaMsg  = axisStore.addMessage({ channelId, workspaceId: ch.workspace_id, senderId: 'soma', senderName: 'SOMA', senderColor: 'violet', content: text, mode: 'archive', isSoma: true });
                    bcast('axis.message', somaMsg);
                } catch (e) { console.warn('[Axis] SOMA response error:', e.message); }
            }, 0);
        }
    });

    router.delete('/messages/:id', (req, res) => {
        axisStore.deleteMessage(req.params.id);
        bcast('axis.message_deleted', { id: req.params.id });
        res.json({ ok: true });
    });

    router.post('/messages/:id/react', (req, res) => {
        const { emoji, remove } = req.body;
        const u = getUser(req);
        const reactions = remove
            ? axisStore.removeReaction(req.params.id, emoji, u.userId)
            : axisStore.addReaction(req.params.id, emoji, u.userId);
        bcast('axis.reaction', { messageId: req.params.id, reactions });
        res.json({ ok: true, reactions });
    });

    // ── Message editing ───────────────────────────────────────────────────────
    router.put('/messages/:id', (req, res) => {
        const { content } = req.body;
        if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
        const u   = getUser(req);
        const msg = axisStore.editMessage(req.params.id, content.trim(), u.userId);
        if (!msg) return res.status(403).json({ ok: false, error: 'not found or not your message' });
        bcast('axis.message_edited', msg);
        res.json({ ok: true, message: msg });
    });

    // ── Unread tracking ───────────────────────────────────────────────────────
    router.post('/read/:channelId', (req, res) => {
        const u = getUser(req);
        axisStore.markRead(req.params.channelId, u.userId);
        res.json({ ok: true });
    });

    router.get('/unread/:workspaceId', (req, res) => {
        const u      = getUser(req);
        const counts = axisStore.getUnreadCounts(req.params.workspaceId, u.userId);
        res.json({ ok: true, counts });
    });

    // ── Search ────────────────────────────────────────────────────────────────
    router.get('/search', (req, res) => {
        const { q, workspaceId, channelId, limit } = req.query;
        if (!q?.trim()) return res.status(400).json({ ok: false, error: 'q required' });
        const results = axisStore.searchMessages(q.trim(), {
            workspaceId, channelId, limit: parseInt(limit) || 40,
        });
        res.json({ ok: true, results });
    });

    router.get('/stats', (_req, res) => res.json({ ok: true, ...axisStore.stats() }));

    // ── Ephemeral presence + typing (broadcast only, never stored) ───────────
    router.post('/channels/:id/typing', (req, res) => {
        const u = getUser(req);
        bcast('axis.typing', { channelId: req.params.id, userId: u.userId, userName: u.userName, userColor: u.userColor });
        res.json({ ok: true });
    });

    router.post('/presence', (req, res) => {
        const u = getUser(req);
        const { status = 'online' } = req.body || {};
        bcast('axis.presence', { userId: u.userId, userName: u.userName, status });
        res.json({ ok: true });
    });

    // ── Home feed ─────────────────────────────────────────────────────────────
    router.get('/home', (req, res) => {
        try {
            const u = getUser(req);
            syncStudioDirectsToAxis(u);
            const data = axisStore.getHomeData(u.userId, u.userName);
            // Annotate directs with online status from AxisProfileStore
            try {
                const profileState = axisProfileStore.getState();
                const chats = profileState.chats || [];
                const onlineNames = new Set(chats.filter(c => c.online).map(c => (c.title || '').toLowerCase()));
                data.directs = data.directs.map(d => ({ ...d, online: onlineNames.has(d.name.toLowerCase()) }));
            } catch {}
            res.json({ ok: true, ...data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── My Tasks ──────────────────────────────────────────────────────────────
    router.get('/my-tasks', (req, res) => {
        try {
            const u = getUser(req);
            const tasks = axisStore.getMyTasks(u.userId);
            res.json({ ok: true, tasks });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Contacts (all unique users known to this node + Studio friends) ──────
    router.get('/contacts', (req, res) => {
        try {
            const u = getUser(req);
            const rows = axisStore.db.prepare(
                'SELECT DISTINCT user_id, user_name, user_color FROM members WHERE user_id != ? ORDER BY user_name ASC'
            ).all(u.userId);
            const seen = new Set(rows.map(r => r.user_id));
            let studioContacts = [];
            try {
                const axisState = axisProfileStore.getState();
                studioContacts = (axisState.friends || [])
                    .filter(f => f.id && !seen.has(f.id))
                    .map(f => ({ id: f.id, name: f.username || f.id, color: 'blue', image: stableAvatar({ id: f.id, name: f.username || f.id, avatar: f.avatar }) }));
            } catch {}
            res.json({ ok: true, contacts: [
                ...rows.map(r => ({ id: r.user_id, name: r.user_name, color: r.user_color, image: stableAvatar({ id: r.user_id, name: r.user_name, image: axisStore.getContactImage(r.user_id) }) })),
                ...studioContacts,
            ]});
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Communities ───────────────────────────────────────────────────────────
    router.get('/communities', (req, res) => {
        try {
            const u = getUser(req);
            const communities = axisStore.getCommunities({ userId: u.userId });
            res.json({ ok: true, communities });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/communities', (req, res) => {
        try {
            const u = getUser(req);
            const { name, description, icon, coverImage, isPublic, category, tags, rules, links, moderationTone,
                color, handle, theme, joinPolicy, somaAssist, somaFeatures, channels, structure } = req.body || {};
            if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
            const community = axisStore.createCommunity({
                name: name.trim(), description, icon, coverImage, creatorId: u.userId, creatorName: u.userName,
                isPublic: isPublic !== false, category, tags, rules, links, moderationTone,
                color, handle, theme, joinPolicy, somaAssist, somaFeatures, channels, structure,
            });
            bcast('axis.community_created', community);
            res.json({ ok: true, community });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/communities/:id', (req, res) => {
        try {
            const u = getUser(req);
            const community = axisStore.getCommunity(req.params.id, { userId: u.userId });
            if (!community) return res.status(404).json({ ok: false, error: 'not found' });
            const workspace = axisStore.getWorkspaces().find(ws => ws.community_id === req.params.id || (ws.type === 'community' && ws.name === community.name)) || null;
            const members = axisStore.getCommunityMembers(req.params.id);
            res.json({ ok: true, community, members, workspace });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.patch('/communities/:id', (req, res) => {
        try {
            const u = getUser(req);
            if (!axisStore.canModerateCommunity(req.params.id, u.userId)) return res.status(403).json({ ok: false, error: 'owner or moderator required' });
            const community = axisStore.updateCommunity(req.params.id, req.body || {});
            const ws = axisStore.getWorkspaces().find(item => item.community_id === req.params.id);
            if (ws) axisStore.updateWorkspace(ws.id, {
                name: community.name,
                icon: community.icon,
                description: community.description,
                is_public: community.is_public,
                avatar_url: community.cover_image,
            });
            bcast('axis.community_updated', community);
            res.json({ ok: true, community });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/communities/:id', (req, res) => {
        try {
            const u = getUser(req);
            if (!axisStore.canModerateCommunity(req.params.id, u.userId)) return res.status(403).json({ ok: false, error: 'owner or moderator required' });
            axisStore.deleteCommunity(req.params.id);
            bcast('axis.community_deleted', { id: req.params.id });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/communities/:id/join', (req, res) => {
        try {
            const u = getUser(req);
            const joinResult = axisStore.joinCommunity(req.params.id, { userId: u.userId, userName: u.userName });
            const community = axisStore.getCommunity(req.params.id);
            let workspace = axisStore.getWorkspaces().find(ws => ws.community_id === req.params.id || (ws.type === 'community' && ws.name === community.name));
            if (!workspace) {
                workspace = axisStore.createWorkspace({ name: community.name, icon: community.icon, color: 'violet', createdBy: u.userId, type: 'community', description: community.description || '', community_id: community.id });
                for (const [channelName, channelType, channelDescription] of ROOM_CHANNEL_TEMPLATES.community) {
                    const ch = axisStore.createChannel({ workspaceId: workspace.id, name: channelName, type: channelType, description: channelDescription, isPrivate: false, createdBy: u.userId });
                    bcast('axis.channel_created', ch);
                }
                bcast('axis.workspace_created', workspace);
            }
            res.json({ ok: true, status: (joinResult && joinResult.status) || 'active', community: { ...community, my_role: axisStore.getCommunityRole(req.params.id, u.userId) }, workspace });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/communities/:id/leave', (req, res) => {
        try {
            const u = getUser(req);
            axisStore.leaveCommunity(req.params.id, u.userId);
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // Join requests (for 'request' join policy) — owner/mod approves
    router.get('/communities/:id/requests', (req, res) => {
        try {
            const u = getUser(req);
            if (!axisStore.canModerateCommunity(req.params.id, u.userId)) return res.status(403).json({ ok: false, error: 'owner or moderator required' });
            res.json({ ok: true, requests: axisStore.getCommunityJoinRequests(req.params.id) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/communities/:id/requests/:userId/approve', (req, res) => {
        try {
            const u = getUser(req);
            if (!axisStore.canModerateCommunity(req.params.id, u.userId)) return res.status(403).json({ ok: false, error: 'owner or moderator required' });
            const role = axisStore.approveCommunityMember(req.params.id, req.params.userId);
            bcast('axis.community_member_approved', { communityId: req.params.id, userId: req.params.userId });
            res.json({ ok: true, role });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Community Posts ───────────────────────────────────────────────────────
    router.get('/communities/:id/posts', (req, res) => {
        try {
            const u = getUser(req);
            const posts = axisStore.getCommunityPosts(req.params.id, { limit: 50 });
            const postsWithLike = posts.map(p => ({
                ...p,
                images: Array.isArray(p.images) ? p.images : (() => { try { return JSON.parse(p.images || '[]'); } catch { return []; } })(),
                hasLiked: axisStore.hasLikedPost(p.id, u.userId),
            }));
            res.json({ ok: true, posts: postsWithLike });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/communities/:id/posts', (req, res) => {
        try {
            const u = getUser(req);
            const { content, images = [] } = req.body || {};
            if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
            const post = axisStore.createCommunityPost({ communityId: req.params.id, authorId: u.userId, authorName: u.userName, authorAvatar: '', content: content.trim(), images });
            bcast('axis.community_post_created', post);
            res.json({ ok: true, post: { ...post, hasLiked: false } });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/communities/:id/posts/:postId/like', (req, res) => {
        try {
            const u = getUser(req);
            const count = axisStore.likeCommunityPost(req.params.postId, u.userId);
            res.json({ ok: true, likes_count: count });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/communities/:id/posts/:postId/like', (req, res) => {
        try {
            const u = getUser(req);
            const count = axisStore.unlikeCommunityPost(req.params.postId, u.userId);
            res.json({ ok: true, likes_count: count });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/communities/:id/posts/:postId/comments', (req, res) => {
        try {
            const comments = axisStore.getCommunityPostComments(req.params.postId);
            res.json({ ok: true, comments });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/communities/:id/posts/:postId/comments', (req, res) => {
        try {
            const u = getUser(req);
            const { content } = req.body || {};
            if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
            const comment = axisStore.createCommunityPostComment({ postId: req.params.postId, authorId: u.userId, authorName: u.userName, authorAvatar: '', content: content.trim() });
            res.json({ ok: true, comment });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Projects ──────────────────────────────────────────────────────────────
    router.get('/projects', (req, res) => {
        try {
            const { workspaceId } = req.query;
            if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId required' });
            const projects = axisStore.getProjects(workspaceId);
            res.json({ ok: true, projects });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/projects', (req, res) => {
        try {
            const u = getUser(req);
            const { workspaceId, name, description, icon, color } = req.body || {};
            if (!workspaceId || !name?.trim()) return res.status(400).json({ ok: false, error: 'workspaceId and name required' });
            const project = axisStore.createProject({ workspaceId, name: name.trim(), description, icon, color, createdBy: u.userId, createdByName: u.userName });
            bcast('axis.project_created', project);
            res.json({ ok: true, project });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/projects/:id', (req, res) => {
        try {
            const project = axisStore.getProject(req.params.id);
            if (!project) return res.status(404).json({ ok: false, error: 'not found' });
            res.json({ ok: true, project });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.patch('/projects/:id', (req, res) => {
        try {
            const project = axisStore.updateProject(req.params.id, req.body || {});
            bcast('axis.project_updated', project);
            res.json({ ok: true, project });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/projects/:id', (req, res) => {
        try {
            axisStore.deleteProject(req.params.id);
            bcast('axis.project_deleted', { id: req.params.id });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/projects/:id/members', (req, res) => {
        try {
            const u = getUser(req);
            const { userId = u.userId, userName = u.userName, userColor, role } = req.body || {};
            axisStore.addProjectMember(req.params.id, { userId, userName, userColor, role });
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Tasks ─────────────────────────────────────────────────────────────────
    router.get('/projects/:projectId/tasks', (req, res) => {
        try {
            const { status } = req.query;
            const tasks = axisStore.getTasks(req.params.projectId, { status });
            res.json({ ok: true, tasks });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/projects/:projectId/tasks', (req, res) => {
        try {
            const u = getUser(req);
            const { title, description, priority, assigneeId, assigneeName, dueDate, tags, workspaceId } = req.body || {};
            if (!title?.trim()) return res.status(400).json({ ok: false, error: 'title required' });
            const task = axisStore.createTask({ projectId: req.params.projectId, workspaceId, title: title.trim(), description, priority, assigneeId, assigneeName, dueDate, tags, createdBy: u.userId, createdByName: u.userName });
            bcast('axis.task_created', task);
            res.json({ ok: true, task });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/projects/:projectId/tasks/:taskId', (req, res) => {
        try {
            const task = axisStore.updateTask(req.params.taskId, req.body || {});
            bcast('axis.task_updated', task);
            res.json({ ok: true, task });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/projects/:projectId/tasks/:taskId', (req, res) => {
        try {
            axisStore.deleteTask(req.params.taskId);
            bcast('axis.task_deleted', { taskId: req.params.taskId, projectId: req.params.projectId });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/projects/:projectId/tasks/:taskId/comments', (req, res) => {
        try {
            const u = getUser(req);
            const { content } = req.body || {};
            if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content required' });
            const comment = axisStore.addTaskComment({ taskId: req.params.taskId, authorId: u.userId, authorName: u.userName, content: content.trim() });
            res.json({ ok: true, comment });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/link-preview', async (req, res) => {
        try {
            const { url } = req.query;
            if (!url) {
                return res.status(400).json({ error: 'URL parameter is required' });
            }

            let targetUrl;
            try {
                targetUrl = new URL(url);
            } catch (err) {
                return res.status(400).json({ error: 'Invalid URL' });
            }

            const response = await fetch(targetUrl.toString(), {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SOMA-AxisLinkPreview/1.0',
                },
                signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) {
                return res.status(response.status).json({ error: `Failed to fetch page: ${response.statusText}` });
            }

            const html = await response.text();

            const getMeta = (regex) => {
                const match = html.match(regex);
                return match ? match[1]?.trim() || match[2]?.trim() || '' : '';
            };

            const ogTitle = getMeta(/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']/i) ||
                            getMeta(/<meta\s+content=["']([\s\S]*?)["']\s+property=["']og:title["']/i);
            
            const title = ogTitle ||
                          (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '');

            const ogDesc = getMeta(/<meta\s+property=["']og:description["']\s+content=["']([\s\S]*?)["']/i) ||
                           getMeta(/<meta\s+content=["']([\s\S]*?)["']\s+property=["']og:description["']/i);
            
            const description = ogDesc ||
                                getMeta(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i) ||
                                getMeta(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["']/i);

            const image = getMeta(/<meta\s+property=["']og:image["']\s+content=["']([\s\S]*?)["']/i) ||
                          getMeta(/<meta\s+content=["']([\s\S]*?)["']\s+property=["']og:image["']/i);

            const siteName = getMeta(/<meta\s+property=["']og:site_name["']\s+content=["']([\s\S]*?)["']/i) ||
                             targetUrl.hostname;

            res.json({
                title,
                description,
                image,
                siteName,
                url: targetUrl.toString(),
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
}
