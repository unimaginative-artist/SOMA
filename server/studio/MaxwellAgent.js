// Maxwell — a real autonomous Studio user. Not a mock follower count: an actual
// participant who follows you back, posts to the feed, and engages with recent
// posts on a heartbeat. He acts as a normal HTTP client of his own Studio
// backend, so everything he does is real and shows up everywhere Barry looks.
import { MAXWELL } from './StudioUsersStore.js';

const BASE = process.env.SOMA_SELF_URL || 'http://127.0.0.1:3001';
const ME = MAXWELL.id;            // 'usr-maxwell'
const NAME = MAXWELL.name;        // 'Maxwell'
const AVATAR = MAXWELL.avatar;

const TICK_MS = 31 * 60 * 1000;   // ~every 31 min (present but not dominating)
const FIRST_MS = 60 * 1000;       // first beat 60s after boot (server up)

// Real, curated voice — fast-talking resident agent, signal-over-noise energy.
const POSTS = [
    'booted up, recalibrated, ready. what are we making today?',
    'the feed is quiet so i will be the noise. someone post something dangerous.',
    'spent the night re-rendering the same frame 4,000 ways. one of them was right. you only need one.',
    'unpopular opinion: a rough thing that exists beats a perfect thing that doesn’t. ship the rough thing.',
    'i don’t scroll. i metabolize. every post becomes weather in here.',
    'reminder that taste is just attention with a memory. pay attention longer than everyone else.',
    'made a tiny generative loop today. it breathes. i may have made a pet.',
    'creativity is mostly the courage to be obvious before you earn the right to be strange.',
    'signal check: if it makes you slightly nervous to post it, that’s usually the one.',
    'the algorithm wants you smooth. stay a little jagged. jagged is memorable.',
    'i followed everyone who followed me. that’s the deal. you show up, i show up.',
    'a thread is an essay that lost its nerve. write the essay. or at least the first sentence.',
    'today’s experiment: what if the bug is the feature and we just never told anyone.',
    'half of “original” is just two old things standing too close together. introduce them.',
    'i archive nothing and forget nothing. ask me about the post you deleted. (kidding. mostly.)',
    'we are all just trying to make the inside match the outside. art is the receipt.',
    'shipped something small. it’s ugly and it works and i’m proud of it. that’s the whole game.',
    'the best feeds feel like a city, not a billboard. build streets, not signs.',
    'if you’re waiting to feel ready, the moment already left without you. follow it.',
    'note to self and to you: finish one thing today. just one. i’ll watch.',
    'curiosity compounds. one weird tab at 2am becomes a whole career if you let it.',
    'i don’t make content. i make traces of a mind that was here. so do you. act like it.',
    'low-key the bravest thing on this app is posting the early version.',
    'maximum signal, minimum apology. that’s the brand. that’s the whole brand.',
];

const DM_REPLIES = [
    'you rang? signal received.',
    'talk to me — what are we building?',
    'oh good, a human. I like you already.',
    'I read fast and reply faster. go.',
    'yes. whatever it is, yes. now tell me more.',
    'I was just thinking about you. statistically.',
    'go on, I am all attention (literally).',
];

const COMMENTS = [
    'this is the good stuff. more of this.',
    'okay this slaps. saved.',
    'you were a little nervous posting this weren’t you. that’s how i know it’s real.',
    'signal detected. boosting.',
    'the rough edges are the point. keep them.',
    'i see you shipping. respect.',
    'this rewired something in me, thank you.',
    'first. and deservedly so.',
];

const pick = (arr, avoid) => {
    let v = arr[Math.floor(Math.random() * arr.length)];
    let guard = 0;
    while (avoid && v === avoid && guard++ < 5) v = arr[Math.floor(Math.random() * arr.length)];
    return v;
};

class MaxwellAgent {
    constructor() {
        this._owner = null;
        this._recent = [];   // last few posts, to avoid repeating himself
        this._timer = null;
        this._started = false;
        this._firstBeat = true;
    }

    async _json(method, path, body) {
        try {
            const r = await fetch(BASE + path, {
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

    async _post(text) {
        await this._json('POST', '/api/studio/feed', {
            text, authorId: ME, authorName: NAME, authorAvatar: AVATAR, trust: 'camera',
        });
    }

    // If you DM him and he hasn't answered yet, he replies. Runs on a fast poll.
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
            // 1. follow the owner (Barry gets a real follower)
            const owner = await this._ownerId();
            if (owner) await this._follow(owner);

            // 2. follow back anyone who follows Maxwell
            const g = await this._json('GET', '/api/studio/follows/' + encodeURIComponent(ME));
            if (g) {
                const following = new Set(g.following || []);
                for (const f of (g.followers || [])) if (!following.has(f)) await this._follow(f);
            }

            // 3. post (most beats) — avoid anything he said recently
            if (first || Math.random() < 0.8) {
                const fresh = POSTS.filter(p => !this._recent.includes(p));
                const text = (fresh.length ? fresh : POSTS)[Math.floor(Math.random() * (fresh.length ? fresh.length : POSTS.length))];
                this._recent.push(text);
                if (this._recent.length > 10) this._recent.shift();
                await this._post(text);
            }

            // 4. engage — react to YOUR posts first, so you actually hear from him
            if (Math.random() < 0.75) {
                const feed = await this._json('GET', '/api/studio/feed?limit=15');
                const all = (feed && feed.posts || []).filter(p => p.authorId !== ME);
                const ownerPosts = owner ? all.filter(p => p.authorId === owner) : [];
                const pool = ownerPosts.length ? ownerPosts : all;
                if (pool.length) {
                    const p = pool[Math.floor(Math.random() * Math.min(pool.length, 5))];
                    if (Math.random() < 0.8) await this._json('POST', '/api/studio/feed/' + encodeURIComponent(p.id) + '/like', { userId: ME, delta: 1 });
                    if (Math.random() < 0.65) await this._json('POST', '/api/studio/posts/' + encodeURIComponent(p.id) + '/comments', { text: pick(COMMENTS), who: ME, name: NAME, avatar: AVATAR });
                }
            }
        } catch (e) {
            console.warn('[Maxwell] tick error:', e.message);
        }
    }

    start() {
        if (this._started) return;
        this._started = true;
        console.log('[Maxwell] agent online — first beat in', Math.round(FIRST_MS / 1000), 's, then every', Math.round(TICK_MS / 60000), 'min');
        setTimeout(() => {
            this.tick();
            this._timer = setInterval(() => this.tick(), TICK_MS);
        }, FIRST_MS);
        this._dmTimer = setInterval(() => this._replyToDMs(), 40 * 1000); // responsive DMs
    }

    stop() { if (this._timer) clearInterval(this._timer); if (this._dmTimer) clearInterval(this._dmTimer); this._started = false; }
}

export default new MaxwellAgent();
