import fs from 'fs';
import path from 'path';
import studioLive from '../../studio/StudioLiveStore.js';
import studioAxisEvents from '../../studio/StudioAxisEventBus.js';
import studioLiveTransport from '../../studio/StudioLiveTransport.js';

export default function registerStudioLiveRoutes(router, dependencies = {}) {
    const { resolveActor, requireActor, notifyFollowers, publicLiveRoom } = dependencies;
    // ── Live rooms — Twitch/TikTok-style room state. Video ingest is separate;
    // this owns the real social state: active rooms, viewers, chat, reactions.
    router.get('/live', (req, res) => {
        try {
            const actor = resolveActor(req);
            const rooms = studioLive
                .list({ status: req.query.status || 'live', limit: req.query.limit, author: req.query.author })
                .map(room => publicLiveRoom(room, actor));
            res.json({ ok: true, rooms });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/live/rtc-config', (req, res) => {
        const actor = requireActor(req, res, { allowRestricted: true });
        if (!actor) return;
        const iceServers = [
            { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        ];
        if (process.env.STUDIO_TURN_URL) {
            iceServers.push({
                urls: String(process.env.STUDIO_TURN_URL).split(',').map(item => item.trim()).filter(Boolean),
                username: process.env.STUDIO_TURN_USERNAME || '',
                credential: process.env.STUDIO_TURN_CREDENTIAL || '',
            });
        }
        res.json({ ok: true, rtcConfig: { iceServers }, turnConfigured: Boolean(process.env.STUDIO_TURN_URL) });
    });

    router.get('/live/vendor/livekit-client.mjs', (_req, res) => {
        const file = path.join(process.cwd(), 'node_modules', 'livekit-client', 'dist', 'livekit-client.esm.mjs');
        if (!fs.existsSync(file)) return res.status(503).type('text/plain').send('LiveKit client is not installed.');
        res.type('text/javascript').sendFile(file);
    });

    router.get('/live/:id/transport', async (req, res) => {
        try {
            const actor = requireActor(req, res, { allowRestricted: true });
            if (!actor) return;
            const room = studioLive.get(req.params.id);
            if (!room || room.status !== 'live') return res.status(404).json({ ok: false, error: 'Live room not found' });
            const transport = await studioLiveTransport.join(room, actor);
            res.json({ ok: true, transport, capabilities: studioLiveTransport.describe() });
        } catch (e) {
            res.status(503).json({ ok: false, error: e.message, fallback: { provider: 'p2p' } });
        }
    });

    router.get('/live/events', (req, res) => {
        const actor = resolveActor(req);
        if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'Access-Control-Allow-Origin': '*',
        });
        const roomId = String(req.query.roomId || '').trim();
        const send = (busEvent) => {
            const event = busEvent.payload || {};
            const data = {
                ...event,
                room: event.room ? publicLiveRoom(event.room, actor) : null,
                busEventId: busEvent.id,
                busEventType: busEvent.type,
            };
            res.write(`event: live\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        res.write(`event: live\n`);
        res.write(`data: ${JSON.stringify({ type: 'connected', roomId, at: Date.now() })}\n\n`);
        const off = studioAxisEvents.subscribe(send, { typePrefix: 'studio.live.', targetId: roomId });
        const keepAlive = setInterval(() => {
            res.write(`event: ping\n`);
            res.write(`data: ${JSON.stringify({ at: Date.now() })}\n\n`);
        }, 25000);
        req.on('close', () => {
            clearInterval(keepAlive);
            off();
        });
    });

    router.post('/live', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.start({
                ...(req.body || {}),
                transport: studioLiveTransport.roomDescriptor(),
                authorId: actor.userId,
                authorName: actor.displayName || actor.name || actor.handle,
                authorAvatar: actor.avatar || '',
                authorTrustTier: actor.trustTier,
                authorAgeBand: actor.ageBand,
            });
            notifyFollowers(actor, 'live_started', `${actor.displayName || actor.name || actor.handle} is live: ${room.title}`, room.id, {
                targetType: 'live',
                targetTitle: room.title,
                deepLink: `/studio/live/${encodeURIComponent(room.id)}`,
            });
            res.status(201).json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/view', (req, res) => {
        try {
            const actor = resolveActor(req);
            const room = studioLive.view(req.params.id, actor?.userId || actor?.id || '');
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/leave', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.leave(req.params.id, actor.userId);
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/chat', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.chat(req.params.id, {
                userId: actor.userId,
                name: actor.displayName || actor.name || actor.handle,
                handle: actor.handle || actor.displayName || actor.name,
                text: req.body?.text,
            });
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/react', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.react(req.params.id, {
                userId: actor.userId,
                kind: req.body?.kind || 'bolt',
            });
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/webrtc/:kind', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const result = studioLive.signal(req.params.id, {
                kind: req.params.kind,
                actorId: actor.userId,
                peerId: req.body?.peerId,
                targetPeerId: req.body?.targetPeerId,
                targetRole: req.body?.targetRole,
                description: req.body?.description,
                candidate: req.body?.candidate,
            });
            if (!result) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(result.room, actor), signal: result.signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/end', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.end(req.params.id, actor.userId);
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(/^Only the host/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/chat/:messageId/delete', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.deleteChat(req.params.id, req.params.messageId, actor.userId);
            if (!room) return res.status(404).json({ ok: false, error: 'Live chat message not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(/^Only the host/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/chat/:messageId/pin', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.pinChat(req.params.id, req.params.messageId, actor.userId, req.body?.enabled !== false);
            if (!room) return res.status(404).json({ ok: false, error: 'Live chat message not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(/^Only the host/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/moderation/user', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.moderateUser(req.params.id, {
                hostId: actor.userId,
                targetUserId: req.body?.targetUserId,
                action: req.body?.action,
                reason: req.body?.reason || '',
                durationMs: req.body?.durationMs,
            });
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(/^Only the host/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/moderation/settings', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.updateModeration(req.params.id, actor.userId, req.body || {});
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(/^Only the host/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    router.get('/live/:id/moderation', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const actions = studioLive.moderationLog(req.params.id, actor.userId);
            if (!actions) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, actions });
        } catch (e) {
            res.status(/^Only the host/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    // ── Co-Host / Guest Streaming ───────────────────────────────────────────────
    router.post('/live/:id/guest/request', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.requestGuest(req.params.id, actor);
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/live/:id/guest/requests', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const room = studioLive.get(req.params.id);
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, requests: room.guestRequests || [] });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/guest/accept', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const guestUserId = req.body?.guestUserId || req.body?.userId;
            const room = studioLive.acceptGuest(req.params.id, actor.userId, guestUserId);
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(/^Only the host/.test(e.message) ? 403 : 400).json({ ok: false, error: e.message });
        }
    });

    router.post('/live/:id/guest/leave', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const targetUserId = req.body?.userId || actor.userId;
            const room = studioLive.leaveGuest(req.params.id, targetUserId);
            if (!room) return res.status(404).json({ ok: false, error: 'Live room not found' });
            res.json({ ok: true, room: publicLiveRoom(room, actor) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });
}
