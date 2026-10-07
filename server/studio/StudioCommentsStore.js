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

    like(postId, commentId, userId, enabled = true) {
        const db = this._load();
        const list = db.posts[postId] || [];
        const c = list.find(x => x.id === commentId);
        if (!c) return null;
        c.likers = Array.isArray(c.likers) ? c.likers : [];
        const has = c.likers.includes(userId);
        if (enabled && !has) c.likers.push(userId);
        if (!enabled && has) c.likers = c.likers.filter(id => id !== userId);
        c.likes = c.likers.length;
        this._save(db);
        return c;
    }

    update(postId, commentId, userId, text) {
        const db = this._load();
        const list = db.posts[postId] || [];
        const comment = list.find(item => item.id === commentId);
        if (!comment) return null;
        if (!userId || comment.who !== userId) throw new Error('Only the author can edit this comment');
        const body = String(text || '').trim();
        if (!body) throw new Error('Comment text is required');
        comment.text = body.slice(0, 1000);
        comment.updatedAt = now();
        this._save(db);
        return comment;
    }

    delete(postId, commentId, userId) {
        const db = this._load();
        const list = db.posts[postId] || [];
        const comment = list.find(item => item.id === commentId);
        if (!comment) return false;
        if (!userId || comment.who !== userId) throw new Error('Only the author can delete this comment');
        db.posts[postId] = list.filter(item => item.id !== commentId && item.parentId !== commentId);
        this._save(db);
        return true;
    }

    removePost(postId) {
        const db = this._load();
        if (!(postId in db.posts)) return false;
        delete db.posts[postId];
        this._save(db);
        return true;
    }

    // total comment count for a post (used by feed cards)
    count(postId) {
        return this.list(postId).length;
    }
}

export default new StudioCommentsStore();
