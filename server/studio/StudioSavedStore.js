import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'SOMA', 'studio-saved.json');
const now = () => Date.now();

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function cleanType(value) {
    const v = String(value || 'item').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 32);
    return v || 'item';
}

function cleanId(value) {
    return String(value || '').trim().slice(0, 180);
}

function publicItem(item = {}) {
    const { userId: _userId, ...safe } = item;
    return safe;
}

class StudioSavedStore {
    _load() {
        const db = readJson(FILE, null);
        return db && Array.isArray(db.items) ? db : { items: [] };
    }

    _save(db) {
        writeJson(FILE, db);
        return db;
    }

    list(userId, { limit = 100, type = '' } = {}) {
        const max = Math.min(Number(limit) || 100, 250);
        let items = this._load().items.filter(item => item.userId === userId);
        if (type) items = items.filter(item => item.itemType === cleanType(type));
        return items.sort((a, b) => b.savedAt - a.savedAt).slice(0, max).map(publicItem);
    }

    isSaved(userId, itemType, itemId) {
        const type = cleanType(itemType);
        const id = cleanId(itemId);
        return this._load().items.some(item => item.userId === userId && item.itemType === type && item.itemId === id);
    }

    save(userId, input = {}) {
        const itemType = cleanType(input.itemType || input.type);
        const itemId = cleanId(input.itemId || input.id);
        if (!itemId) throw new Error('Saved item needs an itemId');
        const db = this._load();
        const existing = db.items.find(item => item.userId === userId && item.itemType === itemType && item.itemId === itemId);
        const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
        const next = {
            userId,
            itemType,
            itemId,
            title: String(input.title || payload.title || payload.caption || itemId).slice(0, 180),
            description: String(input.description || payload.desc || payload.text || payload.caption || '').slice(0, 500),
            authorId: String(input.authorId || payload.who || payload.authorId || '').slice(0, 120),
            mediaUrl: String(input.mediaUrl || payload.mediaUrl || '').slice(0, 500),
            thumbnailSeed: String(input.thumbnailSeed || payload.thumbnailSeed || payload.who || itemId).slice(0, 180),
            payload,
            savedAt: now(),
        };
        if (existing) Object.assign(existing, next, { createdAt: existing.createdAt || now() });
        else db.items.push({ ...next, createdAt: now() });
        db.items = db.items.slice(-5000);
        this._save(db);
        return publicItem(existing || db.items[db.items.length - 1]);
    }

    remove(userId, itemType, itemId) {
        const type = cleanType(itemType);
        const id = cleanId(itemId);
        const db = this._load();
        const before = db.items.length;
        db.items = db.items.filter(item => !(item.userId === userId && item.itemType === type && item.itemId === id));
        this._save(db);
        return before !== db.items.length;
    }

    set(userId, input = {}, enabled = true) {
        if (enabled) return this.save(userId, input);
        const itemType = input.itemType || input.type;
        const itemId = input.itemId || input.id;
        this.remove(userId, itemType, itemId);
        return { itemType: cleanType(itemType), itemId: cleanId(itemId), removed: true };
    }
}

export default new StudioSavedStore();
