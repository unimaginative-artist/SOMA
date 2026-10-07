import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

const FILE = path.join(process.cwd(), 'SOMA', 'studio-live.json');
const now = () => Date.now();

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function cleanText(value, fallback, max = 180) {
    const text = String(value || '').trim();
    return (text || fallback || '').slice(0, max);
}

function cleanMode(value = '') {
    return cleanText(value, 'Building', 40).replace(/[^a-zA-Z0-9 &_-]+/g, '') || 'Building';
}

function cleanMediaState(value = {}) {
    return {
        cameraEnabled: Boolean(value.cameraEnabled),
        micEnabled: Boolean(value.micEnabled),
        cameraReady: Boolean(value.cameraReady),
        micReady: Boolean(value.micReady),
        previewSupported: Boolean(value.previewSupported),
        videoDeviceSelected: Boolean(value.videoDeviceSelected),
        audioDeviceSelected: Boolean(value.audioDeviceSelected),
        checkedAt: Number(value.checkedAt || now()),
    };
}

function cleanPreflight(value = {}) {
    const allowed = new Set(['ready', 'checking', 'unavailable', 'off']);
    const status = (v) => {
        const s = String(v || '').toLowerCase();
        return allowed.has(s) ? s : 'unavailable';
    };
    return {
        camera: status(value.camera),
        mic: status(value.mic),
        soma: status(value.soma),
        room: status(value.room || 'ready'),
        checkedAt: Number(value.checkedAt || now()),
    };
}

function cleanPeerId(value = '') {
    return String(value || '').trim().replace(/[^a-zA-Z0-9:_-]+/g, '').slice(0, 120);
}

function publicRoom(room = {}) {
    const {
        viewersList: _viewersList,
        reactors: _reactors,
        lastChatByUser: _lastChatByUser,
        ...safe
    } = room;
    const publicReactions = (Array.isArray(room.reactions) ? room.reactions : []).slice(-80).map(reaction => ({
        id: reaction.id,
        kind: reaction.kind,
        createdAt: reaction.createdAt,
    }));
    const chat = (Array.isArray(room.chat) ? room.chat : [])
        .filter(message => !message.deletedAt)
        .slice(-120);
    const pinnedChat = (Array.isArray(room.pinnedChat) ? room.pinnedChat : [])
        .filter(message => !message.deletedAt)
        .slice(-5);
    const moderation = room.moderation && typeof room.moderation === 'object' ? room.moderation : {};
    return {
        ...safe,
        viewers: Number(room.viewers || (Array.isArray(room.viewersList) ? room.viewersList.length : 0)),
        reactions: publicReactions,
        reactionCount: Number(room.reactionCount || (Array.isArray(room.reactions) ? room.reactions.length : 0)),
        chat,
        pinnedChat,
        moderation: {
            slowModeSeconds: Number(moderation.slowModeSeconds || 0),
            subchat: Boolean(moderation.subchat),
            mutedCount: Object.keys(moderation.mutedUntil || {}).length,
            blockedCount: Array.isArray(moderation.blockedUsers) ? moderation.blockedUsers.length : 0,
        },
        guests: Array.isArray(room.guests) ? room.guests : [],
        guestRequests: Array.isArray(room.guestRequests) ? room.guestRequests : [],
    };
}

class StudioLiveStore {
    constructor() {
        this.events = new EventEmitter();
        this.events.setMaxListeners(250);
    }

    subscribe(listener) {
        this.events.on('live', listener);
        return () => this.events.off('live', listener);
    }

    _emit(type, room, extra = {}) {
        const payload = { type, roomId: room?.id || extra.roomId || '', room: room ? publicRoom(room) : null, at: now(), ...extra };
        this.events.emit('live', payload);
        return payload;
    }

    _load() {
        const db = readJson(FILE, null);
        return db && Array.isArray(db.rooms) ? db : { rooms: [] };
    }

    _save(db) {
        writeJson(FILE, db);
        return db;
    }

    list({ status = 'live', limit = 50, author = null } = {}) {
        let rooms = this._load().rooms.slice();
        if (status && status !== 'all') rooms = rooms.filter(room => room.status === status);
        if (author) rooms = rooms.filter(room => room.authorId === author);
        return rooms
            .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
            .slice(0, Math.min(Number(limit) || 50, 200))
            .map(publicRoom);
    }

    get(id) {
        const room = this._load().rooms.find(item => item.id === id);
        return room ? publicRoom(room) : null;
    }

    start({
        authorId,
        authorName = '',
        authorAvatar = '',
        authorTrustTier = 'UNKNOWN',
        authorAgeBand = 'unknown',
        title,
        category = 'Building',
        mode = '',
        tag = '',
        options = {},
        mediaState = {},
        preflight = {},
        transport = {},
    } = {}) {
        const room = {
            id: `live-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            authorId: String(authorId || 'anon'),
            authorName: String(authorName || ''),
            authorAvatar: String(authorAvatar || ''),
            authorTrustTier,
            authorAgeBand,
            title: cleanText(title, 'Untitled live stream', 180),
            category: cleanMode(category),
            mode: cleanMode(mode || category),
            tag: cleanText(tag, 'Studio Live', 48),
            status: 'live',
            transport: {
                provider: ['p2p', 'livekit'].includes(String(transport.provider || '').toLowerCase()) ? String(transport.provider).toLowerCase() : 'p2p',
                scalable: Boolean(transport.scalable),
                createdAt: Number(transport.createdAt || now()),
            },
            options: {
                hd: options.hd !== false,
                restream: Boolean(options.restream),
                subchat: Boolean(options.subchat),
                guests: Boolean(options.guests),
            },
            mediaState: cleanMediaState(mediaState),
            preflight: cleanPreflight(preflight),
            viewers: 0,
            viewersList: [],
            chat: [],
            pinnedChat: [],
            reactions: [],
            reactionCount: 0,
            moderation: {
                slowModeSeconds: 0,
                subchat: Boolean(options.subchat),
                mutedUntil: {},
                blockedUsers: [],
                actions: [],
            },
            createdAt: now(),
            updatedAt: now(),
        };
        const db = this._load();
        db.rooms.push(room);
        db.rooms = db.rooms.slice(-1000);
        this._save(db);
        this._emit('room_started', room);
        return publicRoom(room);
    }

    view(id, userId = '') {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        room.viewersList = Array.isArray(room.viewersList) ? room.viewersList : [];
        if (userId && !room.viewersList.includes(userId)) room.viewersList.push(userId);
        room.viewers = Math.max(Number(room.viewers || 0), room.viewersList.length);
        room.lastViewedAt = now();
        room.updatedAt = now();
        this._save(db);
        this._emit('viewer_joined', room, { viewerId: userId || '' });
        return publicRoom(room);
    }

    leave(id, userId = '') {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        room.viewersList = (Array.isArray(room.viewersList) ? room.viewersList : [])
            .filter(viewerId => viewerId !== userId);
        room.viewers = room.viewersList.length;
        room.updatedAt = now();
        this._save(db);
        this._emit('viewer_left', room, { viewerId: userId || '' });
        return publicRoom(room);
    }

    chat(id, { userId, name = '', handle = '', text = '' } = {}) {
        const clean = cleanText(text, '', 500);
        if (!clean) throw new Error('Live chat message needs text');
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        if (room.status !== 'live') throw new Error('Live room is ended');
        this._assertCanChat(room, userId);
        room.chat = Array.isArray(room.chat) ? room.chat : [];
        const message = {
            id: `lmsg-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            userId: String(userId || 'anon'),
            name: cleanText(name || handle, 'Studio User', 80),
            handle: cleanText(handle || name, 'studio', 80),
            text: clean,
            createdAt: now(),
        };
        room.chat.push(message);
        room.chat = room.chat.slice(-500);
        room.lastChatByUser = room.lastChatByUser && typeof room.lastChatByUser === 'object' ? room.lastChatByUser : {};
        room.lastChatByUser[userId || 'anon'] = message.createdAt;
        room.updatedAt = now();
        this._save(db);
        this._emit('chat_created', room, { message });
        return publicRoom(room);
    }

    react(id, { userId, kind = 'bolt' } = {}) {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        if (room.status !== 'live') throw new Error('Live room is ended');
        room.reactions = Array.isArray(room.reactions) ? room.reactions : [];
        const reaction = {
            id: `lrx-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            userId: String(userId || 'anon'),
            kind: cleanText(kind, 'bolt', 24).toLowerCase().replace(/[^a-z0-9_-]+/g, '') || 'bolt',
            createdAt: now(),
        };
        room.reactions.push(reaction);
        room.reactions = room.reactions.slice(-500);
        room.reactionCount = Number(room.reactionCount || 0) + 1;
        room.updatedAt = now();
        this._save(db);
        this._emit('reaction_created', room, { reaction: { id: reaction.id, kind: reaction.kind, createdAt: reaction.createdAt } });
        return publicRoom(room);
    }

    signal(id, { kind = '', actorId = '', peerId = '', targetPeerId = '', targetRole = '', description = null, candidate = null } = {}) {
        const cleanKind = String(kind || '').toLowerCase();
        if (!['offer', 'answer', 'ice', 'leave'].includes(cleanKind)) throw new Error('Unsupported live signal type');
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        if (room.status !== 'live') throw new Error('Live room is ended');
        const signal = {
            id: `lsig-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            kind: cleanKind,
            actorId: String(actorId || ''),
            peerId: cleanPeerId(peerId),
            targetPeerId: cleanPeerId(targetPeerId),
            targetRole: cleanPeerId(targetRole),
            description: description && typeof description === 'object' ? description : null,
            candidate: candidate && typeof candidate === 'object' ? candidate : null,
            createdAt: now(),
        };
        this._emit(`webrtc_${cleanKind}`, room, {
            signal,
            peerId: signal.peerId,
            targetPeerId: signal.targetPeerId,
            targetRole: signal.targetRole,
            actorId: signal.actorId,
        });
        return { room: publicRoom(room), signal };
    }

    end(id, userId = '') {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        if (userId && room.authorId !== userId) throw new Error('Only the host can end this live room');
        room.status = 'ended';
        room.endedAt = now();
        room.updatedAt = now();
        this._save(db);
        this._emit('room_ended', room);
        return publicRoom(room);
    }

    _assertHost(room, userId = '') {
        if (userId && room.authorId === userId) return;
        throw new Error('Only the host can moderate this live room');
    }

    _moderation(room) {
        room.moderation = room.moderation && typeof room.moderation === 'object' ? room.moderation : {};
        room.moderation.mutedUntil = room.moderation.mutedUntil && typeof room.moderation.mutedUntil === 'object' ? room.moderation.mutedUntil : {};
        room.moderation.blockedUsers = Array.isArray(room.moderation.blockedUsers) ? room.moderation.blockedUsers : [];
        room.moderation.actions = Array.isArray(room.moderation.actions) ? room.moderation.actions : [];
        return room.moderation;
    }

    _appendModeration(room, action) {
        const mod = this._moderation(room);
        const entry = {
            id: `lmod-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt: now(),
            ...action,
        };
        mod.actions.push(entry);
        mod.actions = mod.actions.slice(-500);
        return entry;
    }

    _assertCanChat(room, userId = '') {
        const mod = this._moderation(room);
        if (userId && userId === room.authorId) return;
        if (userId && mod.blockedUsers.includes(userId)) throw new Error('You are blocked from this live room');
        if (mod.subchat) throw new Error('Live chat is locked to subscribers and the host');
        const mutedUntil = Number(mod.mutedUntil[userId] || 0);
        if (mutedUntil && mutedUntil > now()) throw new Error('You are timed out in this live room');
        const slowModeSeconds = Number(mod.slowModeSeconds || 0);
        const last = Number(room.lastChatByUser?.[userId || 'anon'] || 0);
        if (slowModeSeconds > 0 && last && now() - last < slowModeSeconds * 1000) {
            throw new Error(`Live chat is in ${slowModeSeconds}s slow mode`);
        }
    }

    deleteChat(id, messageId, hostId = '') {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        this._assertHost(room, hostId);
        const message = (room.chat || []).find(item => item.id === messageId);
        if (!message) return null;
        message.deletedAt = now();
        message.deletedBy = hostId;
        room.pinnedChat = (room.pinnedChat || []).filter(item => item.id !== messageId);
        const action = this._appendModeration(room, { action: 'delete_chat', hostId, messageId, targetUserId: message.userId || '' });
        room.updatedAt = now();
        this._save(db);
        this._emit('chat_deleted', room, { messageId, action });
        return publicRoom(room);
    }

    pinChat(id, messageId, hostId = '', enabled = true) {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        this._assertHost(room, hostId);
        const message = (room.chat || []).find(item => item.id === messageId && !item.deletedAt);
        if (!message) return null;
        room.pinnedChat = Array.isArray(room.pinnedChat) ? room.pinnedChat.filter(item => item.id !== messageId) : [];
        if (enabled) room.pinnedChat.unshift({ ...message, pinnedAt: now(), pinnedBy: hostId });
        room.pinnedChat = room.pinnedChat.slice(0, 5);
        const action = this._appendModeration(room, { action: enabled ? 'pin_chat' : 'unpin_chat', hostId, messageId, targetUserId: message.userId || '' });
        room.updatedAt = now();
        this._save(db);
        this._emit(enabled ? 'chat_pinned' : 'chat_unpinned', room, { messageId, action });
        return publicRoom(room);
    }

    moderateUser(id, { hostId = '', targetUserId = '', action = '', reason = '', durationMs = 5 * 60 * 1000 } = {}) {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        this._assertHost(room, hostId);
        const cleanTarget = String(targetUserId || '').trim();
        if (!cleanTarget) throw new Error('Moderation target required');
        if (cleanTarget === room.authorId) throw new Error('Host cannot moderate themselves');
        const mod = this._moderation(room);
        const kind = String(action || '').toLowerCase();
        if (kind === 'timeout') {
            mod.mutedUntil[cleanTarget] = now() + Math.max(1000, Math.min(Number(durationMs) || 300000, 24 * 60 * 60 * 1000));
        } else if (kind === 'block') {
            if (!mod.blockedUsers.includes(cleanTarget)) mod.blockedUsers.push(cleanTarget);
            mod.mutedUntil[cleanTarget] = now() + 365 * 24 * 60 * 60 * 1000;
        } else if (kind === 'unblock') {
            mod.blockedUsers = mod.blockedUsers.filter(user => user !== cleanTarget);
            delete mod.mutedUntil[cleanTarget];
        } else {
            throw new Error('Unsupported moderation action');
        }
        const entry = this._appendModeration(room, {
            action: kind,
            hostId,
            targetUserId: cleanTarget,
            reason: cleanText(reason, '', 300),
            durationMs: kind === 'timeout' ? Number(durationMs) || 300000 : 0,
        });
        room.updatedAt = now();
        this._save(db);
        this._emit('user_moderated', room, { action: entry });
        return publicRoom(room);
    }

    updateModeration(id, hostId = '', patch = {}) {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        this._assertHost(room, hostId);
        const mod = this._moderation(room);
        if (patch.slowModeSeconds != null) mod.slowModeSeconds = Math.max(0, Math.min(Number(patch.slowModeSeconds) || 0, 300));
        if (patch.subchat != null) mod.subchat = Boolean(patch.subchat);
        room.options = room.options && typeof room.options === 'object' ? room.options : {};
        room.options.subchat = Boolean(mod.subchat);
        const action = this._appendModeration(room, {
            action: 'update_settings',
            hostId,
            slowModeSeconds: Number(mod.slowModeSeconds || 0),
            subchat: Boolean(mod.subchat),
        });
        room.updatedAt = now();
        this._save(db);
        this._emit('moderation_updated', room, { action });
        return publicRoom(room);
    }

    moderationLog(id, hostId = '') {
        const room = this._load().rooms.find(item => item.id === id);
        if (!room) return null;
        this._assertHost(room, hostId);
        const mod = this._moderation(room);
        return mod.actions.slice(-200);
    }

    requestGuest(id, actor = {}) {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        if (room.status !== 'live') throw new Error('Live room is not active');
        const userId = actor.userId || actor.id;
        if (!userId) throw new Error('User identity required');
        if (userId === room.authorId) throw new Error('Host cannot be a guest of their own stream');

        room.guests = Array.isArray(room.guests) ? room.guests : [];
        room.guestRequests = Array.isArray(room.guestRequests) ? room.guestRequests : [];

        if (room.guests.some(g => g.userId === userId)) {
            return publicRoom(room);
        }
        if (!room.guestRequests.some(r => r.userId === userId)) {
            room.guestRequests.push({
                userId,
                name: actor.displayName || actor.name || actor.handle || 'Guest',
                avatar: actor.avatar || '',
                requestedAt: now(),
            });
            room.guestRequests = room.guestRequests.slice(-20);
        }
        room.updatedAt = now();
        this._save(db);
        this._emit('guest_requested', room, { userId, name: actor.displayName || actor.name || actor.handle });
        return publicRoom(room);
    }

    acceptGuest(id, hostId = '', guestUserId = '') {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        this._assertHost(room, hostId);
        room.guests = Array.isArray(room.guests) ? room.guests : [];
        room.guestRequests = Array.isArray(room.guestRequests) ? room.guestRequests : [];

        const reqIndex = room.guestRequests.findIndex(r => r.userId === guestUserId);
        const reqData = reqIndex >= 0 ? room.guestRequests[reqIndex] : null;
        if (reqIndex >= 0) room.guestRequests.splice(reqIndex, 1);

        if (!room.guests.some(g => g.userId === guestUserId)) {
            room.guests.push({
                userId: guestUserId,
                name: reqData?.name || 'Guest',
                avatar: reqData?.avatar || '',
                joinedAt: now(),
            });
            room.guests = room.guests.slice(-4);
        }
        room.updatedAt = now();
        this._save(db);
        this._emit('guest_accepted', room, { guestUserId });
        return publicRoom(room);
    }

    leaveGuest(id, userId = '') {
        const db = this._load();
        const room = db.rooms.find(item => item.id === id);
        if (!room) return null;
        room.guests = Array.isArray(room.guests) ? room.guests : [];
        room.guestRequests = Array.isArray(room.guestRequests) ? room.guestRequests : [];

        room.guests = room.guests.filter(g => g.userId !== userId);
        room.guestRequests = room.guestRequests.filter(r => r.userId !== userId);
        room.updatedAt = now();
        this._save(db);
        this._emit('guest_left', room, { userId });
        return publicRoom(room);
    }
}

export default new StudioLiveStore();
