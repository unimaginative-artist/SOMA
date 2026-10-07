// Studio Pathways — real server-backed ephemeral P2P messaging (Snapchat × BitChat).
// Threads are keyed by the sorted participant pair so each pair has one channel.
// Messages support: send-TTL, burn-on-read (timer starts when opened), view-once
// media, reactions, and receipts (delivered / opened / screenshot). Expired or
// consumed messages are deleted server-side so burn applies to BOTH parties.
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'SOMA', 'studio-pathways.json');
const now = () => Date.now();
const rid = (p) => `${p}-${now()}-${Math.random().toString(36).slice(2, 7)}`;

function readJson() {
    try { const db = JSON.parse(fs.readFileSync(FILE, 'utf8')); return db && db.threads ? db : { threads: {} }; }
    catch { return { threads: {} }; }
}
function writeJson(db) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}
function threadId(a, b) { return [String(a), String(b)].sort().join('__'); }

// A message is dead once its burn window has passed, or a view-once was consumed.
function isExpired(m, t = now()) {
    if (m.consumed) return true;
    if (m.expiresAt && m.expiresAt <= t) return true;
    return false;
}

class StudioPathwaysStore {
    _load() { return readJson(); }
    _save(db) { writeJson(db); return db; }

    // Remove dead messages everywhere; returns the cleaned db.
    sweep(db = this._load()) {
        const t = now();
        let changed = false;
        for (const id of Object.keys(db.threads)) {
            const th = db.threads[id];
            const kept = (th.messages || []).filter(m => !isExpired(m, t));
            if (kept.length !== (th.messages || []).length) { th.messages = kept; changed = true; }
        }
        if (changed) this._save(db);
        return db;
    }

    ensureThread(a, b, meta = {}) {
        const db = this._load();
        const id = threadId(a, b);
        if (!db.threads[id]) {
            db.threads[id] = { id, participants: [String(a), String(b)], createdAt: now(), messages: [], meta };
            this._save(db);
        } else if (meta && Object.keys(meta).length) {
            db.threads[id].meta = { ...(db.threads[id].meta || {}), ...meta };
            this._save(db);
        }
        return db.threads[id];
    }

    // Threads involving userId, newest first, with last-message preview + unread.
    listThreads(userId) {
        const db = this.sweep();
        const uid = String(userId);
        return Object.values(db.threads)
            .filter(th => th.participants.includes(uid))
            .map(th => {
                const other = th.participants.find(p => p !== uid) || uid;
                const msgs = th.messages || [];
                const last = msgs[msgs.length - 1] || null;
                const unread = msgs.filter(m => m.to === uid && !m.openedAt).length;
                const peerMeta = (th.meta && th.meta[other]) || {};
                return {
                    threadId: th.id,
                    peerId: other,
                    peerName: peerMeta.name || '',
                    peerHandle: peerMeta.handle || '',
                    peerAvatar: peerMeta.avatar || '',
                    last: last ? (last.viewOnce && !last.openedAt && last.to === uid ? '📷 view-once' : (last.text || (last.mediaUrl ? '📷 media' : ''))) : '',
                    lastAt: last ? last.createdAt : th.createdAt,
                    unread,
                };
            })
            .sort((x, y) => y.lastAt - x.lastAt);
    }

    // Messages for a viewer. Marks the other party's messages delivered. View-once
    // media bodies are withheld until explicitly opened.
    getMessages(threadId_, userId) {
        const db = this.sweep();
        const th = db.threads[threadId_];
        if (!th) return [];
        const uid = String(userId);
        if (!th.participants.includes(uid)) throw Object.assign(new Error('Not a participant'), { status: 403 });
        let changed = false;
        const out = (th.messages || []).map(m => {
            if (m.to === uid && !m.deliveredAt) { m.deliveredAt = now(); changed = true; }
            const locked = m.viewOnce && m.to === uid && !m.openedAt;
            return {
                id: m.id, from: m.from, to: m.to,
                text: locked ? '' : (m.text || ''),
                mediaUrl: locked ? '' : (m.mediaUrl || ''),
                viewOnce: !!m.viewOnce, locked,
                ttl: m.ttl || 0, burnOnReadMs: m.burnOnReadMs || 0,
                createdAt: m.createdAt, openedAt: m.openedAt || null, expiresAt: m.expiresAt || null,
                deliveredAt: m.deliveredAt || null, screenshot: !!m.screenshot,
                reactions: m.reactions || {},
            };
        });
        if (changed) this._save(db);
        return out;
    }

    send(fromId, toId, { text = '', mediaUrl = '', viewOnce = false, ttl = 0, burnOnReadMs = 0, meta = {} } = {}) {
        const body = String(text || '').slice(0, 4000);
        if (!body && !mediaUrl) throw new Error('Pathway message needs text or media');
        const db = this._load();
        const id = threadId(fromId, toId);
        if (!db.threads[id]) db.threads[id] = { id, participants: [String(fromId), String(toId)], createdAt: now(), messages: [], meta: {} };
        const th = db.threads[id];
        if (meta && Object.keys(meta).length) th.meta = { ...(th.meta || {}), ...meta };
        const t = now();
        const msg = {
            id: rid('pm'), from: String(fromId), to: String(toId),
            text: body, mediaUrl: String(mediaUrl || ''),
            viewOnce: !!viewOnce,
            ttl: Number(ttl) || 0,
            burnOnReadMs: Number(burnOnReadMs) || 0,
            createdAt: t,
            // Send-based TTL expires from creation. Burn-on-read waits for open.
            expiresAt: (!burnOnReadMs && Number(ttl) > 0) ? t + Number(ttl) * 1000 : null,
            reactions: {},
        };
        th.messages.push(msg);
        if (th.messages.length > 500) th.messages = th.messages.slice(-500);
        this._save(db);
        return msg;
    }

    // Recipient opens a message → starts burn-on-read timer, consumes view-once.
    markOpened(messageId, userId) {
        const db = this._load();
        const uid = String(userId);
        for (const th of Object.values(db.threads)) {
            const m = (th.messages || []).find(x => x.id === messageId);
            if (!m) continue;
            if (m.to !== uid) return { ok: false };
            if (!m.openedAt) {
                m.openedAt = now();
                if (m.burnOnReadMs > 0) m.expiresAt = m.openedAt + m.burnOnReadMs;
                else if (m.viewOnce && !m.ttl) m.expiresAt = m.openedAt + 12000; // view-once lingers 12s then burns
            }
            if (m.viewOnce) m.consumed = m.consumed || false; // stays until expiry, then swept
            this._save(db);
            return { ok: true, expiresAt: m.expiresAt, text: m.text, mediaUrl: m.mediaUrl };
        }
        return { ok: false };
    }

    react(messageId, userId, emoji = '⚡') {
        const db = this._load();
        for (const th of Object.values(db.threads)) {
            const m = (th.messages || []).find(x => x.id === messageId);
            if (!m) continue;
            m.reactions = m.reactions || {};
            m.reactions[String(userId)] = String(emoji).slice(0, 8);
            this._save(db);
            return m.reactions;
        }
        return null;
    }

    // Recipient reports a screenshot → flags the message so the sender is notified.
    reportScreenshot(messageId, userId) {
        const db = this._load();
        for (const th of Object.values(db.threads)) {
            const m = (th.messages || []).find(x => x.id === messageId);
            if (!m) continue;
            if (m.to !== String(userId)) return null;
            m.screenshot = true; m.screenshotAt = now();
            this._save(db);
            return { from: m.from, threadId: th.id };
        }
        return null;
    }
}

export default new StudioPathwaysStore();
