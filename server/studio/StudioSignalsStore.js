// Studio Signals — persistent long-form video metadata for the YouTube-like
// surface. Media upload can attach real files later; this store makes the
// channel, watch, and ranking state real now.
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'SOMA', 'studio-signals.json');
const now = () => Date.now();
const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD

// Record one real per-day event (view/like/dislike) so Workshop trend charts are
// built from actual activity, never faked. Keeps ~120 days of history per Signal.
function bumpDaily(signal, field, n = 1) {
    signal.timeline = signal.timeline && typeof signal.timeline === 'object' ? signal.timeline : {};
    const k = dayKey();
    signal.timeline[k] = signal.timeline[k] || { views: 0, likes: 0, dislikes: 0 };
    signal.timeline[k][field] = (signal.timeline[k][field] || 0) + n;
    const keys = Object.keys(signal.timeline).sort();
    if (keys.length > 120) for (const old of keys.slice(0, keys.length - 120)) delete signal.timeline[old];
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function cleanCategory(value = '') {
    return String(value || 'General').trim().replace(/[^a-zA-Z0-9 &_-]+/g, '').slice(0, 40) || 'General';
}

function cleanVisibility(value = '') {
    const v = String(value || 'Public').trim().toLowerCase();
    if (v === 'unlisted') return 'Unlisted';
    if (v === 'subscribers') return 'Subscribers';
    return 'Public';
}

class StudioSignalsStore {
    _load() {
        const db = readJson(FILE, null);
        return db && Array.isArray(db.signals) ? db : { signals: [] };
    }

    _save(db) {
        writeJson(FILE, db);
        return db;
    }

    list({ limit = 50, before = null, author = null } = {}) {
        let signals = this._load().signals.slice().sort((a, b) => b.createdAt - a.createdAt);
        if (author) signals = signals.filter(item => item.authorId === author);
        if (before) signals = signals.filter(item => item.createdAt < Number(before));
        return signals.slice(0, Math.min(Number(limit) || 50, 200));
    }

    get(id) {
        return this._load().signals.find(item => item.id === id) || null;
    }

    add({
        authorId,
        authorName = '',
        authorAvatar = '',
        authorTrustTier = 'UNKNOWN',
        authorAgeBand = 'unknown',
        title,
        description = '',
        category = 'General',
        visibility = 'Public',
        media = [],
        duration = '0:00',
        aiLabeled = false,
    } = {}) {
        const cleanTitle = String(title || '').trim();
        if (!cleanTitle) throw new Error('A Signal needs a title');
        const mediaArr = Array.isArray(media) ? media.filter(Boolean) : [];
        const signal = {
            id: `sig-${now()}-${Math.random().toString(36).slice(2, 7)}`,
            authorId: String(authorId || 'anon'),
            authorName: String(authorName || ''),
            authorAvatar: String(authorAvatar || ''),
            authorTrustTier,
            authorAgeBand,
            title: cleanTitle.slice(0, 160),
            description: String(description || '').trim().slice(0, 5000),
            category: cleanCategory(category),
            visibility: cleanVisibility(visibility),
            media: mediaArr.slice(0, 4),
            duration: String(duration || '0:00').slice(0, 16),
            aiLabeled: Boolean(aiLabeled),
            views: 0,
            likes: 0,
            dislikes: 0,
            createdAt: now(),
        };
        const db = this._load();
        db.signals.push(signal);
        db.signals = db.signals.slice(-1000);
        this._save(db);
        return signal;
    }

    view(id, userId = '') {
        const db = this._load();
        const signal = db.signals.find(item => item.id === id);
        if (!signal) return null;
        signal.viewers = Array.isArray(signal.viewers) ? signal.viewers : [];
        const isNewViewer = userId && !signal.viewers.includes(userId);
        if (isNewViewer) signal.viewers.push(userId);
        signal.views = Math.max(Number(signal.views || 0), signal.viewers.length);
        signal.lastViewedAt = now();
        if (isNewViewer) bumpDaily(signal, 'views');
        this._save(db);
        return signal;
    }

    like(id, userId, delta = 1) {
        const db = this._load();
        const signal = db.signals.find(item => item.id === id);
        if (!signal) return null;
        signal.likers = signal.likers || [];
        signal.dislikers = signal.dislikers || [];
        const has = signal.likers.includes(userId);
        if (Number(delta) >= 0 && !has) { signal.likers.push(userId); bumpDaily(signal, 'likes'); }
        if (Number(delta) < 0 && has) signal.likers = signal.likers.filter(u => u !== userId);
        if (Number(delta) >= 0) signal.dislikers = signal.dislikers.filter(u => u !== userId);
        signal.likes = signal.likers.length;
        signal.dislikes = signal.dislikers.length;
        signal.feedbackUpdatedAt = now();
        this._save(db);
        return signal;
    }

    dislike(id, userId, enabled = true) {
        const db = this._load();
        const signal = db.signals.find(item => item.id === id);
        if (!signal) return null;
        signal.likers = signal.likers || [];
        signal.dislikers = signal.dislikers || [];
        const has = signal.dislikers.includes(userId);
        if (enabled && !has) { signal.dislikers.push(userId); bumpDaily(signal, 'dislikes'); }
        if (!enabled && has) signal.dislikers = signal.dislikers.filter(u => u !== userId);
        if (enabled) signal.likers = signal.likers.filter(u => u !== userId);
        signal.likes = signal.likers.length;
        signal.dislikes = signal.dislikers.length;
        signal.feedbackUpdatedAt = now();
        this._save(db);
        return signal;
    }

    bookmark(id, userId, enabled = true) {
        const db = this._load();
        const signal = db.signals.find(item => item.id === id);
        if (!signal) return null;
        signal.bookmarkers = signal.bookmarkers || [];
        const has = signal.bookmarkers.includes(userId);
        if (enabled && !has) signal.bookmarkers.push(userId);
        if (!enabled && has) signal.bookmarkers = signal.bookmarkers.filter(u => u !== userId);
        signal.bookmarks = signal.bookmarkers.length;
        this._save(db);
        return signal;
    }

    report(id, { userId, reason = 'other', note = '' } = {}) {
        const db = this._load();
        const signal = db.signals.find(item => item.id === id);
        if (!signal) return null;
        signal.reports = Array.isArray(signal.reports) ? signal.reports : [];
        const cleanReason = String(reason || 'other').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 40) || 'other';
        const existing = signal.reports.find(item => item.userId === userId && item.reason === cleanReason);
        if (existing) {
            existing.note = String(note || existing.note || '').slice(0, 500);
            existing.updatedAt = now();
        } else {
            signal.reports.push({
                id: `sr-${now()}-${Math.random().toString(36).slice(2, 7)}`,
                userId,
                reason: cleanReason,
                note: String(note || '').slice(0, 500),
                createdAt: now(),
            });
        }
        signal.reportCount = signal.reports.length;
        if (signal.reportCount >= 3) signal.visibilityLimited = true;
        this._save(db);
        return signal;
    }

    update(id, userId, patch = {}) {
        const db = this._load();
        const signal = db.signals.find(item => item.id === id);
        if (!signal) return null;
        if (userId && signal.authorId !== userId) throw new Error('Only the author can edit this Signal');
        if (patch.title != null) {
            const t = String(patch.title).trim();
            if (t) signal.title = t.slice(0, 160);
        }
        if (patch.description != null) signal.description = String(patch.description).trim().slice(0, 5000);
        if (patch.category != null) signal.category = cleanCategory(patch.category);
        if (patch.visibility != null) signal.visibility = cleanVisibility(patch.visibility);
        signal.updatedAt = now();
        this._save(db);
        return signal;
    }

    delete(id, userId) {
        const db = this._load();
        const signal = db.signals.find(item => item.id === id);
        if (!signal) return false;
        if (userId && signal.authorId !== userId) throw new Error('Only the author can delete this Signal');
        db.signals = db.signals.filter(item => item.id !== id);
        this._save(db);
        return true;
    }
}

export default new StudioSignalsStore();
