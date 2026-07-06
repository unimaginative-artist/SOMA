import fs from 'fs';
import path from 'path';
import { stableAvatar } from './stableAvatar.js';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const AXIS_DIR = path.join(SOMA_DIR, 'axis');
const STATE_FILE = path.join(AXIS_DIR, 'axis-state.json');

const now = () => Date.now();

const DEFAULT_CHATS = [
    { id: 'axis-marcus',  title: 'Marcus Chen',    image: 'https://randomuser.me/api/portraits/men/32.jpg',    online: true,  messagesCount: 'Typing...',            status: 'active' },
    { id: 'axis-ava',     title: 'Ava Williams',   image: 'https://randomuser.me/api/portraits/women/44.jpg',  online: true,  messagesCount: '2 new messages · 1h',  status: 'active' },
    { id: 'axis-jordan',  title: 'Jordan Blake',   image: 'https://randomuser.me/api/portraits/men/71.jpg',    online: false, messagesCount: 'Seen · 3h',            status: 'active' },
    { id: 'axis-priya',   title: 'Priya Sharma',   image: 'https://randomuser.me/api/portraits/women/26.jpg',  online: true,  messagesCount: '4 new messages · 30m', status: 'active' },
    { id: 'axis-tyler',   title: 'Tyler Reed',     image: 'https://randomuser.me/api/portraits/men/55.jpg',    online: false, messagesCount: 'Sent · 2d',            status: 'active' },
    { id: 'axis-zoe',     title: 'Zoe Martinez',   image: 'https://randomuser.me/api/portraits/women/15.jpg',  online: true,  messagesCount: 'Sent · 5m',            status: 'active' },
    { id: 'axis-dex',     title: 'Dex Hammond',    image: 'https://randomuser.me/api/portraits/men/9.jpg',     online: false, messagesCount: 'Seen · 1d',            status: 'active' },
    { id: 'axis-nadia',   title: 'Nadia Okafor',   image: 'https://randomuser.me/api/portraits/women/62.jpg',  online: true,  messagesCount: 'New · 10m',            status: 'active' },
    { id: 'axis-sam',     title: 'Sam Kowalski',   image: 'https://randomuser.me/api/portraits/men/47.jpg',    online: false, messagesCount: 'Seen · 4h',            status: 'active' },
    { id: 'axis-riley',   title: 'Riley Park',     image: 'https://randomuser.me/api/portraits/women/33.jpg',  online: true,  messagesCount: '3 new messages · 45m', status: 'active' },
    { id: 'axis-finn',    title: 'Finn O\'Brien',  image: 'https://randomuser.me/api/portraits/men/22.jpg',    online: false, messagesCount: 'Sent · 3d',            status: 'active' },
    { id: 'axis-layla',   title: 'Layla Hassan',   image: 'https://randomuser.me/api/portraits/women/50.jpg',  online: false, messagesCount: 'Seen · 2h',            status: 'active' },
    { id: 'axis-cole',    title: 'Cole Nakamura',  image: 'https://randomuser.me/api/portraits/men/38.jpg',    online: true,  messagesCount: 'Typing...',            status: 'active' },
    { id: 'axis-eva',     title: 'Eva Reyes',      image: 'https://randomuser.me/api/portraits/women/7.jpg',   online: false, messagesCount: 'Sent · 1w',            status: 'active' },
    { id: 'axis-ben',     title: 'Ben Osei',       image: 'https://randomuser.me/api/portraits/men/64.jpg',    online: true,  messagesCount: '1 new message · 15m',  status: 'active' },
    { id: 'axis-mia',     title: 'Mia Thornton',   image: 'https://randomuser.me/api/portraits/women/88.jpg',  online: false, messagesCount: 'Seen · 5h',            status: 'active' },
    { id: 'axis-kai',     title: 'Kai Patel',      image: 'https://randomuser.me/api/portraits/men/17.jpg',    online: true,  messagesCount: 'Sent · 20m',           status: 'active' },
    { id: 'axis-jade',    title: 'Jade Moreau',    image: 'https://randomuser.me/api/portraits/women/41.jpg',  online: false, messagesCount: 'Seen · 2d',            status: 'active' },
    { id: 'axis-aaron',   title: 'Aaron Cruz',     image: 'https://randomuser.me/api/portraits/men/83.jpg',    online: true,  messagesCount: '2 new messages · 2h',  status: 'active' },
    { id: 'axis-luna',    title: 'Luna Vance',     image: 'https://randomuser.me/api/portraits/women/19.jpg',  online: false, messagesCount: 'Sent · 6h',            status: 'active' },
];

function ensureDir() {
    fs.mkdirSync(AXIS_DIR, { recursive: true });
}

function readJson(file, fallback) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
}

function writeJson(file, data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function safeHandle(value = '') {
    return String(value || 'axis_contact')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'axis_contact';
}

const SEED_CONVOS = {
    'axis-marcus':  [['other', 'Yo did you see the new DeepSeek update?'], ['user', 'Yeah running it locally now. Insane.'], ['other', 'bro']],
    'axis-ava':     [['user', 'Sending you the design files tonight'], ['other', 'Perfect, I\'ll review first thing tomorrow'], ['other', 'also love the new Studio layout btw']],
    'axis-jordan':  [['other', 'That system you built is wild'], ['user', 'Still a lot to wire up but getting there'], ['other', 'keep me posted']],
    'axis-priya':   [['other', 'Can we jump on a call later?'], ['other', 'have some ideas for the data pipeline'], ['user', 'Yeah 3pm works']],
    'axis-tyler':   [['user', 'How did the pitch go?'], ['other', 'Could\'ve been worse lol'], ['user', 'lmk what they said']],
    'axis-zoe':     [['other', 'Just pushed to staging'], ['user', 'Checking now'], ['user', 'looks good, nice work']],
    'axis-dex':     [['other', 'You using Ollama for local inference?'], ['user', 'Yeah gemma3 mostly. Decent for quick stuff'], ['other', 'nice gonna try that setup']],
    'axis-nadia':   [['other', 'Did you end up going with the agent architecture?'], ['user', 'Yep. Four sub-brains running in parallel now'], ['other', '🔥']],
    'axis-sam':     [['user', 'Any luck with the integration?'], ['other', 'Almost. OAuth is being a pain'], ['user', 'classic']],
    'axis-riley':   [['other', 'Okay I finally set up SOMA on my end'], ['other', 'this is genuinely impressive'], ['user', 'haha thanks, still a lot of rough edges']],
    'axis-finn':    [['user', 'Did you deploy yet?'], ['other', 'Tomorrow morning'], ['user', 'cool, I\'ll check the logs']],
    'axis-layla':   [['other', 'I wrote up some notes on the memory system if you want them'], ['user', 'Yes please, send them over'], ['other', 'will do']],
    'axis-cole':    [['other', 'working on something kinda related to what you\'re building'], ['other', 'can I show you next week?'], ['user', 'Yeah for sure']],
    'axis-eva':     [['user', 'Hey long time, how are you?'], ['other', 'Good! busy but good. You?'], ['user', 'Same, building constantly lol']],
    'axis-ben':     [['other', 'The social posting feature is live?'], ['user', 'Just launched it, Bluesky integration is working'], ['other', 'following you now']],
    'axis-mia':     [['user', 'Got your message, will respond properly tonight'], ['other', 'No rush, just wanted to flag it'], ['user', 'appreciate it']],
    'axis-kai':     [['other', 'Running 4 agents in parallel sounds expensive'], ['user', 'Local models so basically free'], ['other', 'okay I need this setup']],
    'axis-jade':    [['other', 'Paris was amazing btw'], ['user', 'I saw the photos, looks incredible'], ['other', 'next time you should come']],
    'axis-aaron':   [['other', 'quick question about your goal engine'], ['other', 'is it fully autonomous or does it need prompting?'], ['user', 'Both modes, I can show you']],
    'axis-luna':    [['user', 'Did you see that paper on constitutional AI?'], ['other', 'yes! loved the section on value alignment'], ['user', 'exactly what I\'m trying to build into SOMA']],
};

function seedMessages(chat, profile = {}) {
    const lines = SEED_CONVOS[chat.id] || [
        ['other', 'Hey, checking in through Axis.'],
        ['user', 'Studio is wired as the Axis hub now.'],
    ];
    const base = now() - lines.length * 120000;
    return lines.map(([sender, text], i) => ({
        id: `${chat.id}-m${i + 1}`,
        sender,
        text,
        timestamp: new Date(base + i * 120000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatar: sender === 'user' ? stableAvatar({ id: 'studio-user', name: profile.name || 'Barry', avatar: profile.avatar }) : stableAvatar({ id: chat.id, name: chat.title, image: chat.image }),
        createdAt: base + i * 120000,
    }));
}

function chatSummary(chat, messages = []) {
    const last = messages[messages.length - 1];
    return {
        ...chat,
        lastMessage: last?.text || chat.lastMessage || '',
        messagesCount: last?.text ? `${last.sender === 'user' ? 'Sent' : 'New'} - ${last.timestamp || ''}`.trim() : chat.messagesCount,
        updatedAt: last?.createdAt || chat.updatedAt || now(),
    };
}

class AxisProfileStore {
    getState(profile = {}) {
        ensureDir();
        const stored = readJson(STATE_FILE, null);
        const legacy = profile?.studio?.axis || {};
        const base = stored || legacy || {};
        const seededAt = now();
        const chats = Array.isArray(base.chats) && base.chats.length
            ? base.chats
            : DEFAULT_CHATS.map((chat, index) => ({ ...chat, axisId: chat.id, updatedAt: seededAt - index * 3600000 }));
        const messages = { ...(base.messages || {}) };
        for (const chat of chats) {
            if (!Array.isArray(messages[chat.id])) messages[chat.id] = seedMessages(chat, profile);
        }
        const friends = Array.isArray(base.friends) && base.friends.length
            ? base.friends
            : chats.map(chat => ({
                id: chat.id,
                username: safeHandle(chat.title),
                handle: safeHandle(chat.title),
                avatar: chat.image,
                online: Boolean(chat.online),
                chatId: chat.id,
                status: 'friend',
                favorite: DEFAULT_CHATS.some(defaultChat => defaultChat.id === chat.id),
                group: chat.id === 'demo-erin' ? 'soma' : 'creative',
            }));

        return {
            friends,
            chats: chats.map(chat => chatSummary(chat, messages[chat.id] || [])),
            messages,
            spaces: Array.isArray(base.spaces) ? base.spaces : [],
            activities: Array.isArray(base.activities) ? base.activities : [],
            updatedAt: base.updatedAt || seededAt,
            source: STATE_FILE,
        };
    }

    saveState(nextState, profile = {}) {
        const current = this.getState(profile);
        const state = {
            ...current,
            ...(nextState || {}),
            friends: Array.isArray(nextState?.friends) ? nextState.friends : current.friends,
            chats: Array.isArray(nextState?.chats) ? nextState.chats : current.chats,
            messages: nextState?.messages && typeof nextState.messages === 'object' ? nextState.messages : current.messages,
            spaces: Array.isArray(nextState?.spaces) ? nextState.spaces : current.spaces,
            activities: Array.isArray(nextState?.activities) ? nextState.activities : current.activities,
            updatedAt: now(),
        };
        writeJson(STATE_FILE, state);
        return state;
    }

    recordActivity(event = {}, profile = {}) {
        const state = this.getState(profile);
        const activity = {
            id: event.id || `activity-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: event.type || 'studio_event',
            title: event.title || 'Studio activity',
            summary: event.summary || '',
            createdAt: event.createdAt || now(),
            source: event.source || 'studio',
            metadata: event.metadata || {},
        };
        return this.saveState({ ...state, activities: [activity, ...(state.activities || [])].slice(0, 250) }, profile);
    }

    addFriend(input = {}, profile = {}) {
        const state = this.getState(profile);
        const name = String(input.username || input.name || input.title || '').trim();
        if (!name) throw new Error('Friend name is required');
        const id = String(input.id || `axis-${safeHandle(name)}-${now()}`);
        const avatar = stableAvatar({ id, name, avatar: input.avatar, image: input.image });
        const friend = {
            id,
            username: name,
            handle: String(input.handle || safeHandle(name)),
            avatar,
            online: Boolean(input.online),
            chatId: id,
            status: input.status || 'friend',
            favorite: Boolean(input.favorite),
            group: input.group || 'creative',
        };
        const chat = {
            id,
            axisId: id,
            title: name,
            image: avatar,
            members: '',
            messagesCount: 'New connection',
            status: 'active',
            online: friend.online,
            updatedAt: now(),
        };
        const next = {
            ...state,
            friends: [friend, ...state.friends.filter(item => item.id !== id)],
            chats: [chat, ...state.chats.filter(item => item.id !== id)],
            messages: {
                ...state.messages,
                [id]: Array.isArray(state.messages[id]) ? state.messages[id] : seedMessages(chat, profile),
            },
        };
        const saved = this.saveState(next, profile);
        this.recordActivity({ type: 'axis_friend_added', title: 'Axis friend added', summary: `${name} was added to Studio/Axis.` }, profile);
        return { friend, chat, axis: saved };
    }

    updateFriend(friendId, updates = {}, profile = {}) {
        const state = this.getState(profile);
        const friends = state.friends.map(friend => friend.id === friendId
            ? {
                ...friend,
                ...updates,
                id: friend.id,
                username: updates.username || updates.name || friend.username,
                handle: updates.handle || friend.handle,
                avatar: updates.avatar || updates.image || friend.avatar,
                favorite: updates.favorite !== undefined ? Boolean(updates.favorite) : Boolean(friend.favorite),
                online: updates.online !== undefined ? Boolean(updates.online) : Boolean(friend.online),
            }
            : friend
        );
        const saved = this.saveState({ ...state, friends }, profile);
        this.recordActivity({ type: 'axis_friend_updated', title: 'Axis friend updated', summary: `${friendId} was updated.` }, profile);
        return { friend: saved.friends.find(friend => friend.id === friendId) || null, axis: saved };
    }

    removeFriend(friendId, profile = {}) {
        const state = this.getState(profile);
        const friend = state.friends.find(item => item.id === friendId);
        const chatId = friend?.chatId || friendId;
        const saved = this.saveState({
            ...state,
            friends: state.friends.filter(item => item.id !== friendId),
            chats: state.chats.filter(item => item.id !== chatId),
            messages: Object.fromEntries(Object.entries(state.messages || {}).filter(([id]) => id !== chatId)),
        }, profile);
        this.recordActivity({ type: 'axis_friend_removed', title: 'Axis friend removed', summary: `${friend?.username || friendId} was removed.` }, profile);
        return { friend, axis: saved };
    }

    updateChat(chatId, updates = {}, profile = {}) {
        const state = this.getState(profile);
        const chats = state.chats.map(chat => chat.id === chatId ? { ...chat, ...updates, updatedAt: now() } : chat);
        const saved = this.saveState({ ...state, chats }, profile);
        this.recordActivity({ type: 'axis_direct_updated', title: 'Direct updated', summary: `${chatId} changed state to ${updates.status || 'updated'}.` }, profile);
        return saved.chats.find(chat => chat.id === chatId) || null;
    }

    getMessages(chatId, profile = {}) {
        const state = this.getState(profile);
        return {
            chat: state.chats.find(chat => chat.id === chatId) || null,
            messages: state.messages[chatId] || [],
        };
    }

    addMessage(chatId, input = {}, profile = {}) {
        const state = this.getState(profile);
        const text = String(input.text || '').trim();
        if (!text) throw new Error('Message text is required');
        let chat = state.chats.find(item => item.id === chatId);
        let baseChats = state.chats;
        if (!chat) {
            // First message to a brand-new direct — create the thread on the fly
            // so a conversation started from Studio (or Command Bridge) persists.
            chat = {
                id: chatId,
                title: input.title || chatId,
                image: input.image || '',
                online: false,
                favorite: false,
                createdAt: now(),
                updatedAt: now(),
            };
            baseChats = [chat, ...state.chats];
        }
        const message = {
            id: `msg-${now()}`,
            threadId: input.threadId || chatId,
            conversationId: input.conversationId || chatId,
            participants: input.participants || ['barry', chatId],
            sender: input.sender === 'other' ? 'other' : 'user',
            text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            avatar: stableAvatar({ id: 'studio-user', name: profile.name || 'Barry', avatar: input.avatar || profile.avatar }),
            createdAt: now(),
            updatedAt: now(),
            readAt: null,
            archivedAt: null,
            security: input.security && typeof input.security === 'object' ? input.security : null,
        };
        const messages = { ...state.messages, [chatId]: [...(state.messages[chatId] || []), message].slice(-250) };
        const chats = baseChats.map(item => item.id === chatId ? chatSummary({ ...item, updatedAt: now() }, messages[chatId]) : item);
        const saved = this.saveState({ ...state, chats, messages }, profile);
        this.recordActivity({ type: 'axis_direct_sent', title: 'Direct sent', summary: `Direct sent to ${chat.title}.` }, profile);
        return { message, messages: saved.messages[chatId], axis: saved };
    }
}

export default new AxisProfileStore();
