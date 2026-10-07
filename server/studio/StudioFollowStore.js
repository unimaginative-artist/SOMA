// Studio social graph — the real follow system behind STUDIO (mobile + web +
// Command Bridge). Directed edges (follower → followee). "Friends" are mutual
// follows. Shared by every surface so following someone on the phone shows them
// in your Following everywhere.
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'SOMA', 'studio-follows.json');
const now = () => Date.now();

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

class StudioFollowStore {
    _load() {
        const db = readJson(FILE, null);
        const base = db && Array.isArray(db.edges) ? db : { edges: [] };
        if (!Array.isArray(base.blocks)) base.blocks = [];
        return base;
    }
    _save(db) { writeJson(FILE, db); return db; }

    // ── Blocks ───────────────────────────────────────────────────────────────
    block(blocker, blockee) {
        blocker = String(blocker || '').trim();
        blockee = String(blockee || '').trim();
        if (!blocker || !blockee || blocker === blockee) throw new Error('Invalid block');
        const db = this._load();
        // a block severs the follow relationship in both directions
        db.edges = db.edges.filter(e => !(
            (e.follower === blocker && e.followee === blockee) ||
            (e.follower === blockee && e.followee === blocker)
        ));
        if (!db.blocks.some(b => b.blocker === blocker && b.blockee === blockee)) {
            db.blocks.push({ blocker, blockee, ts: now() });
        }
        this._save(db);
        return { blocked: true };
    }
    unblock(blocker, blockee) {
        const db = this._load();
        const before = db.blocks.length;
        db.blocks = db.blocks.filter(b => !(b.blocker === blocker && b.blockee === blockee));
        if (db.blocks.length !== before) this._save(db);
        return { blocked: false };
    }
    getBlocked(userId) {
        return this._load().blocks.filter(b => b.blocker === userId).sort((a, b) => b.ts - a.ts).map(b => b.blockee);
    }
    _blockedSet(userId, db) {
        const blocks = (db || this._load()).blocks;
        const s = new Set();
        for (const b of blocks) { if (b.blocker === userId) s.add(b.blockee); if (b.blockee === userId) s.add(b.blocker); }
        return s;
    }

    follow(follower, followee) {
        follower = String(follower || '').trim();
        followee = String(followee || '').trim();
        if (!follower || !followee || follower === followee) throw new Error('Invalid follow');
        const db = this._load();
        if (!db.edges.some(e => e.follower === follower && e.followee === followee)) {
            db.edges.push({ follower, followee, ts: now() });
            this._save(db);
        }
        return { following: true };
    }

    unfollow(follower, followee) {
        const db = this._load();
        const before = db.edges.length;
        db.edges = db.edges.filter(e => !(e.follower === follower && e.followee === followee));
        if (db.edges.length !== before) this._save(db);
        return { following: false };
    }

    isFollowing(follower, followee) {
        return this._load().edges.some(e => e.follower === follower && e.followee === followee);
    }

    getFollowing(userId) {
        return this._load().edges.filter(e => e.follower === userId).sort((a, b) => b.ts - a.ts).map(e => e.followee);
    }
    getFollowers(userId) {
        return this._load().edges.filter(e => e.followee === userId).sort((a, b) => b.ts - a.ts).map(e => e.follower);
    }
    getFriends(userId) {
        const following = new Set(this.getFollowing(userId));
        return this.getFollowers(userId).filter(id => following.has(id));
    }

    // Everything a profile/nav needs for a user in one call. Blocked relationships
    // (either direction) are hidden from the lists.
    graph(userId, viewerId = null) {
        const db = this._load();
        const blocked = this._blockedSet(userId, db);
        const following = this.getFollowing(userId).filter(id => !blocked.has(id));
        const followers = this.getFollowers(userId).filter(id => !blocked.has(id));
        const followingSet = new Set(following);
        const friends = followers.filter(id => followingSet.has(id));
        return {
            userId,
            following,
            followers,
            friends,
            blocked: viewerId === userId ? this.getBlocked(userId) : undefined,
            counts: { following: following.length, followers: followers.length, friends: friends.length },
            viewerFollows: viewerId ? this.isFollowing(viewerId, userId) : false,
            followsViewer: viewerId ? this.isFollowing(userId, viewerId) : false,
        };
    }
}

export default new StudioFollowStore();
