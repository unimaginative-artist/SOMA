// Studio post comments — a single shared store for comments across the Studio
// phone app AND the web "Stage" (Studio.dc.html embedded in Command Bridge).
// Keyed by a stable postId so the same content carries the same thread on both
// surfaces. Flat list with optional parentId for one level of replies.
import fs from 'fs';
import path from 'path';

const STORE_DIR = path.join(process.cwd(), 'SOMA');
const FILE = path.join(STORE_DIR, 'studio-comments.json');

const now = () => Date.now();

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

class StudioCommentsStore {
    _load() {
        const db = readJson(FILE, null);
        return db && typeof db === 'object' && db.posts ? db : { posts: {} };
    }
    _save(db) { writeJson(FILE, db); return db; }

    list(postId) {
        if (!postId) return [];
        const db = this._load();
        return db.posts[postId] || [];
    }

    add(postId, { who = 'nova', name = '', avatar = '', text, parentId = null } = {}) {
        if (!postId) throw new Error('postId is required');
        const body = String(text || '').trim();
        if (!body) throw new Error('Comment text is required');
        const db = this._load();
        const comment = {
            id: `c-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            postId,
            who: String(who || 'nova'),
            name: String(name || ''),
            avatar: String(avatar || ''),
            text: body.slice(0, 1000),
            parentId: parentId || null,
            likes: 0,
            createdAt: now(),
        };
        const list = db.posts[postId] || [];
        list.push(comment);
        db.posts[postId] = list.slice(-500); // cap per-post history
        this._save(db);
        return comment;
    }

    like(postId, commentId, delta = 1) {
        const db = this._load();
        const list = db.posts[postId] || [];
        const c = list.find(x => x.id === commentId);
        if (!c) return null;
        c.likes = Math.max(0, (c.likes || 0) + (Number(delta) || 0));
        this._save(db);
        return c;
    }

    // total comment count for a post (used by feed cards)
    count(postId) {
        return this.list(postId).length;
    }
}

export default new StudioCommentsStore();
