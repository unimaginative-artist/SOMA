// Studio notifications — what happened TO you. Someone follows you, likes or
// comments on your post, or DMs you → an entry here. Shared across surfaces so
// the activity feed is real (and so Maxwell/SOMA reacting to you actually shows).
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'SOMA', 'studio-notifications.json');
const now = () => Date.now();

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

class StudioNotificationsStore {
    _load() {
        const db = readJson(FILE, null);
        return db && Array.isArray(db.items) ? db : { items: [] };
    }
    _save(db) { writeJson(FILE, db); return db; }

    add({ userId, kind, actorId = '', actorName = '', actorAvatar = '', text = '', targetId = '' } = {}) {
        if (!userId || !kind) return null;
        if (userId === actorId) return null; // never notify yourself
        const db = this._load();
        // collapse duplicate follow spam (same actor following you again)
        if (kind === 'follow') {
            db.items = db.items.filter(n => !(n.userId === userId && n.kind === 'follow' && n.actorId === actorId));
        }
        const item = {
            id: `n-${now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId, kind, actorId, actorName, actorAvatar,
            text: String(text).slice(0, 280), targetId,
            read: false, createdAt: now(),
        };
        db.items.push(item);
        db.items = db.items.slice(-500);
        this._save(db);
        return item;
    }

    list(userId, { limit = 60 } = {}) {
        return this._load().items
            .filter(n => n.userId === userId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);
    }

    unread(userId) {
        return this._load().items.filter(n => n.userId === userId && !n.read).length;
    }

    markRead(userId) {
        const db = this._load();
        let changed = false;
        for (const n of db.items) if (n.userId === userId && !n.read) { n.read = true; changed = true; }
        if (changed) this._save(db);
        return true;
    }
}

export default new StudioNotificationsStore();
