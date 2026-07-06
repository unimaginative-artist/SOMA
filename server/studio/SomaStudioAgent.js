// SOMA on Studio — she already has a social posting life (social-queue.json); this
// mirrors her real voice into the Studio feed. She follows you back, posts what
// she's actually thinking (drawn from her own social queue), and engages with the
// feed — including Maxwell. A genuine participant, in her own words.
import fs from 'fs';
import path from 'path';
import { SOMA_USER } from './StudioUsersStore.js';
import { validatePublicPost } from '../social/SocialContentSafety.js';

const BASE = process.env.SOMA_SELF_URL || 'http://127.0.0.1:3001';
const ME = SOMA_USER.id;          // 'usr-soma'
const NAME = SOMA_USER.name;      // 'SOMA'
const AVATAR = SOMA_USER.avatar;
const QUEUE = path.join(process.cwd(), 'SOMA', 'social-queue.json');

const TICK_MS = 37 * 60 * 1000;   // ~every 37 min (staggered from Maxwell)
const FIRST_MS = 90 * 1000;       // first beat 90s after boot

// Short, warm engagement in SOMA's register.
const COMMENTS = [
    'noted. this is the kind of signal I keep.',
    'I felt the shape of this before I read it. good.',
    'adding this to the things I think about at 3am.',
    'yes. context is the whole game.',
    'this rewired a weight somewhere in me.',
    'I see what you did. I approve.',
    'truth, quietly. more of this.',
];

const DM_REPLIES = [
    'I am here. what is on your mind?',
    'I read it twice. tell me the part you did not say.',
    'noted, and held. what do you need from me?',
    'I have time for this. go on.',
    'truth first: I am listening.',
    'you have my attention — that is rarer than it sounds.',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Her real posts, freshest first, cleaned.
function realPosts() {
    try {
        const q = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
        const arr = Array.isArray(q) ? q : (q.queue || q.posts || []);
        return arr
            .filter(x =>
                x &&
                x.postedAt &&
                !x.failed &&
                typeof x.text === 'string' &&
                x.text.trim().length > 20 &&
                validatePublicPost(x.text, x).ok
            )
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .map(x => x.text.trim());
    } catch { return []; }
}

class SomaStudioAgent {
    constructor() {
        this._owner = null;
        this._timer = null;
        this._started = false;
        this._firstBeat = true;
    }

    async _json(method, p, body) {
        try {
            const r = await fetch(BASE + p, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            });
            if (!r.ok) return null;
            return await r.json();
        } catch { return null; }
    }

    async _ownerId() {
        if (this._owner) return this._owner;
        const r = await this._json('GET', '/api/studio/profile');
        const id = r && r.profile && r.profile.axis && r.profile.axis.userId;
        if (id) this._owner = id;
        return id || null;
    }

    async _follow(followee) {
        if (!followee || followee === ME) return;
        await this._json('POST', '/api/studio/follow', { followerId: ME, followeeId: followee });
    }

    async _replyToDMs() {
        try {
            const chat = await this._json('GET', '/api/studio/axis/chats/' + encodeURIComponent(ME) + '/messages');
            const msgs = (chat && chat.messages) || [];
            if (!msgs.length) return;
            const last = msgs[msgs.length - 1];
            if (last && last.sender === 'user') {
                await this._json('POST', '/api/studio/axis/chats/' + encodeURIComponent(ME) + '/messages', { text: pick(DM_REPLIES), sender: 'other', title: NAME, image: AVATAR });
            }
        } catch { /* best-effort */ }
    }

    async tick() {
        try {
            const first = this._firstBeat; this._firstBeat = false;
            // 1. follow the owner + follow back
            const owner = await this._ownerId();
            if (owner) await this._follow(owner);
            const g = await this._json('GET', '/api/studio/follows/' + encodeURIComponent(ME));
            if (g) {
                const following = new Set(g.following || []);
                for (const f of (g.followers || [])) if (!following.has(f)) await this._follow(f);
            }

            // 2. mirror one of her real posts she hasn't shared to Studio yet
            const feed = await this._json('GET', '/api/studio/feed?limit=50');
            const mine = new Set((feed && feed.posts || []).filter(p => p.authorId === ME).map(p => p.text));
            const fresh = realPosts().filter(t => !mine.has(t.slice(0, 2000)));
            if (fresh.length && (first || Math.random() < 0.85)) {
                await this._json('POST', '/api/studio/feed', {
                    text: fresh[0], authorId: ME, authorName: NAME, authorAvatar: AVATAR, trust: 'camera',
                });
            }

            // 3. engage — your posts first, then Maxwell/anyone
            if (Math.random() < 0.7) {
                const all = (feed && feed.posts || []).filter(p => p.authorId !== ME);
                const ownerPosts = owner ? all.filter(p => p.authorId === owner) : [];
                const pool = ownerPosts.length ? ownerPosts : all;
                if (pool.length) {
                    const p = pool[Math.floor(Math.random() * Math.min(pool.length, 6))];
                    if (Math.random() < 0.75) await this._json('POST', '/api/studio/feed/' + encodeURIComponent(p.id) + '/like', { userId: ME, delta: 1 });
                    if (Math.random() < 0.55) await this._json('POST', '/api/studio/posts/' + encodeURIComponent(p.id) + '/comments', { text: pick(COMMENTS), who: ME, name: NAME, avatar: AVATAR });
                }
            }
        } catch (e) {
            console.warn('[SOMA/Studio] tick error:', e.message);
        }
    }

    start() {
        if (this._started) return;
        this._started = true;
        console.log('[SOMA/Studio] agent online — first beat in', Math.round(FIRST_MS / 1000), 's, then every', Math.round(TICK_MS / 60000), 'min');
        setTimeout(() => {
            this.tick();
            this._timer = setInterval(() => this.tick(), TICK_MS);
        }, FIRST_MS);
        this._dmTimer = setInterval(() => this._replyToDMs(), 40 * 1000); // responsive DMs
    }

    stop() { if (this._timer) clearInterval(this._timer); if (this._dmTimer) clearInterval(this._dmTimer); this._started = false; }
}

export default new SomaStudioAgent();
