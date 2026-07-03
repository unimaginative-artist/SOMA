/**
 * GMNMessaging — ephemeral E2E direct messages over the GMN mesh (Batch 7b).
 *
 * The "Pathways" / secure mode of Axis messaging. Every outgoing message is SEALED
 * (GMNSeal) to the recipient's X25519 key, so only they can read it; relays carry
 * ciphertext. Messages can be ephemeral (send-TTL or burn-on-read) and view-once;
 * expired/consumed messages are deleted on every node that touched them.
 *
 * Threads are keyed by the peer's nodeId. State persists to SOMA/gmn-messages.json
 * (swept for expiry) so nothing is lost across a restart before it is read.
 */
import fs from 'node:fs';
import path from 'node:path';
import gmnIdentity from './GMNIdentity.js';
import { seal, open } from './GMNSeal.js';

const FILE = path.join(process.cwd(), 'SOMA', 'gmn-messages.json');
const now = () => Date.now();
const rid = () => `dm-${now()}-${Math.random().toString(36).slice(2, 8)}`;

function isDead(m, t = now()) {
    if (m.consumed) return true;
    if (m.expiresAt && m.expiresAt <= t) return true;
    return false;
}

export class GMNMessaging {
    constructor({ file = FILE, identity = gmnIdentity } = {}) {
        this.file = file;
        this.identity = identity;
        this.threads = new Map(); // peerNodeId -> { peerNodeId, peerEncPub, messages: [] }
        this._load();
    }

    get myId() { return this.identity.getNodeId(); }

    _load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (raw && Array.isArray(raw.threads)) for (const t of raw.threads) if (t?.peerNodeId) this.threads.set(t.peerNodeId, t);
        } catch { /* none yet */ }
    }

    _persist() {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, threads: Array.from(this.threads.values()) }, null, 2));
            fs.renameSync(tmp, this.file);
        } catch (e) { console.warn(`[GMNMessaging] persist failed: ${e.message}`); }
    }

    _thread(peerNodeId, peerEncPub) {
        let t = this.threads.get(peerNodeId);
        if (!t) { t = { peerNodeId, peerEncPub: peerEncPub || null, messages: [] }; this.threads.set(peerNodeId, t); }
        if (peerEncPub) t.peerEncPub = peerEncPub;
        return t;
    }

    /** Remember a peer's encryption key (so we can seal to them). */
    recordPeer(peerNodeId, peerEncPub) { if (peerNodeId && peerEncPub) { this._thread(peerNodeId, peerEncPub); this._persist(); } }

    /**
     * Compose + seal a message. Returns { message, wire } — hand `wire` to the mesh.
     * `convo` lets one node host many logically-separate secure threads (e.g. the
     * Studio direct/chatId a message belongs to) so contacts sharing a node don't merge.
     */
    send(toNodeId, toEncPub, text, { ttl = 0, viewOnce = false, burnOnReadMs = 0, convo = null } = {}) {
        const body = String(text || '');
        if (!body) throw new Error('empty message');
        const t = now();
        const id = rid();
        const msg = {
            id, dir: 'out', from: this.myId, to: toNodeId, convo: convo || null, text: body,
            ttl: Number(ttl) || 0, viewOnce: !!viewOnce, burnOnReadMs: Number(burnOnReadMs) || 0,
            createdAt: t, deliveredAt: null, openedAt: null,
            expiresAt: (!burnOnReadMs && Number(ttl) > 0) ? t + Number(ttl) * 1000 : null,
            reactions: {}, status: 'sent',
        };
        const thread = this._thread(toNodeId, toEncPub);
        thread.messages.push(msg);
        this._persist();

        const payload = JSON.stringify({ id, text: body, ttl: msg.ttl, viewOnce: msg.viewOnce, burnOnReadMs: msg.burnOnReadMs, convo: msg.convo, createdAt: t });
        const envelope = seal(payload, toEncPub, this.identity);
        return { message: msg, wire: { type: 'gmn_dm', to: toNodeId, msgId: id, envelope } };
    }

    /** Receive a sealed message from the wire: open, verify, store. */
    receive(wire) {
        const r = open(wire?.envelope, this.identity);
        if (!r.ok) return { ok: false, reason: r.reason };
        let p;
        try { p = JSON.parse(r.plaintext.toString('utf8')); } catch { return { ok: false, reason: 'bad_payload' }; }
        const t = now();
        const thread = this._thread(r.from, r.senderEncPub);
        if (thread.messages.some(m => m.id === p.id)) return { ok: true, duplicate: true, from: r.from };
        const msg = {
            id: p.id, dir: 'in', from: r.from, to: this.myId, convo: p.convo || null, text: String(p.text || ''),
            ttl: Number(p.ttl) || 0, viewOnce: !!p.viewOnce, burnOnReadMs: Number(p.burnOnReadMs) || 0,
            createdAt: p.createdAt || t, deliveredAt: t, openedAt: null,
            expiresAt: (!p.burnOnReadMs && Number(p.ttl) > 0) ? t + Number(p.ttl) * 1000 : null,
            reactions: {}, screenshot: false, status: 'delivered',
        };
        thread.messages.push(msg);
        this._persist();
        return { ok: true, message: msg, from: r.from };
    }

    /** Recipient opens a message → starts burn-on-read; consumes view-once. */
    markOpened(peerNodeId, msgId) {
        const t = this.threads.get(peerNodeId);
        const m = t?.messages.find(x => x.id === msgId);
        if (!m) return null;
        if (!m.openedAt) {
            m.openedAt = now();
            if (m.burnOnReadMs > 0) m.expiresAt = m.openedAt + m.burnOnReadMs;
            else if (m.viewOnce && !m.ttl) m.expiresAt = m.openedAt + 12000; // view-once lingers 12s
            m.status = 'read';
            this._persist();
        }
        return { openedAt: m.openedAt, expiresAt: m.expiresAt };
    }

    react(peerNodeId, msgId, emoji) {
        const m = this.threads.get(peerNodeId)?.messages.find(x => x.id === msgId);
        if (!m) return null;
        m.reactions = m.reactions || {};
        m.reactions[this.myId] = String(emoji || '⚡').slice(0, 8);
        this._persist();
        return m.reactions;
    }

    markScreenshot(peerNodeId, msgId) {
        const m = this.threads.get(peerNodeId)?.messages.find(x => x.id === msgId);
        if (!m) return null;
        m.screenshot = true; m.screenshotAt = now();
        this._persist();
        return { from: m.from };
    }

    markDelivered(peerNodeId, msgId) {
        const m = this.threads.get(peerNodeId)?.messages.find(x => x.id === msgId);
        if (m && !m.deliveredAt) { m.deliveredAt = now(); m.status = 'delivered'; this._persist(); }
        return m || null;
    }

    /** Delete dead (expired / consumed) messages everywhere. */
    sweep() {
        const t = now();
        let changed = false;
        for (const thread of this.threads.values()) {
            const kept = thread.messages.filter(m => !isDead(m, t));
            if (kept.length !== thread.messages.length) { thread.messages = kept; changed = true; }
        }
        if (changed) this._persist();
        return changed;
    }

    listThreads() {
        this.sweep();
        return Array.from(this.threads.values()).map(t => {
            const last = t.messages[t.messages.length - 1] || null;
            return {
                peerNodeId: t.peerNodeId,
                peerEncPub: t.peerEncPub || null,
                unread: t.messages.filter(m => m.dir === 'in' && !m.openedAt).length,
                last: last ? { text: last.viewOnce && !last.openedAt && last.dir === 'in' ? '📷 view-once' : last.text, dir: last.dir, at: last.createdAt } : null,
            };
        }).sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
    }

    getMessages(peerNodeId, { convo = null } = {}) {
        this.sweep();
        const t = this.threads.get(peerNodeId);
        if (!t) return [];
        const rows = convo != null ? t.messages.filter(m => (m.convo || null) === convo) : t.messages;
        return rows.map(m => ({
            id: m.id, dir: m.dir, from: m.from, convo: m.convo || null, text: (m.viewOnce && !m.openedAt && m.dir === 'in') ? '' : m.text,
            viewOnce: !!m.viewOnce, locked: !!(m.viewOnce && !m.openedAt && m.dir === 'in'),
            ttl: m.ttl, burnOnReadMs: m.burnOnReadMs, createdAt: m.createdAt, openedAt: m.openedAt || null,
            expiresAt: m.expiresAt || null, deliveredAt: m.deliveredAt || null, status: m.status,
            reactions: m.reactions || {}, screenshot: !!m.screenshot,
        }));
    }
}

export default new GMNMessaging();
