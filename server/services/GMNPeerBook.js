/**
 * GMNPeerBook — the addresses of GMN nodes this node knows how to dial.
 *
 * Bootstrap seeds, manually-added peers, and addresses learned via Peer Exchange
 * (PEX) all land here. The arbiter dials from this book to grow the mesh, so a node
 * pointed at a single bootstrap discovers and connects to the whole reachable
 * network hands-free. Only nodes that advertise a reachable address are dialable;
 * NAT'd nodes (no public address) connect outward and aren't stored as dial targets.
 *
 * Persisted to config/gmn-peerbook.json. Dial decisions are pure + testable.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_FILE = path.resolve(process.cwd(), 'config', 'gmn-peerbook.json');
const nowMs = () => Date.now();
const MAX_BOOK = 500;

export class GMNPeerBook {
    constructor({ file = DEFAULT_FILE, maxPeers = 16 } = {}) {
        this.file = file;
        this.maxPeers = maxPeers;            // soft cap on simultaneous mesh connections
        this.peers = new Map();              // address -> { address, nodeId, source, lastSeen }
        this._load();
    }

    _load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (Array.isArray(raw.peers)) for (const p of raw.peers) if (p?.address) this.peers.set(p.address, p);
        } catch { /* no peerbook yet */ }
    }

    _persist() {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), peers: Array.from(this.peers.values()) }, null, 2));
            fs.renameSync(tmp, this.file);
        } catch (e) {
            console.warn(`[GMNPeerBook] persist failed: ${e.message}`);
        }
    }

    /** Record a dialable address (from bootstrap, manual add, or PEX). */
    remember(address, { nodeId = null, source = 'pex' } = {}) {
        const addr = String(address || '').trim();
        if (!addr || !/^[^\s/]+:\d{2,5}$/.test(addr)) return null; // host:port shape
        const prev = this.peers.get(addr) || {};
        const entry = {
            address: addr,
            nodeId: nodeId || prev.nodeId || null,
            source: prev.source || source,
            firstSeen: prev.firstSeen || nowMs(),
            lastSeen: nowMs(),
        };
        this.peers.set(addr, entry);
        if (this.peers.size > MAX_BOOK) {
            // Evict the least-recently-seen non-bootstrap entry.
            let victim = null;
            for (const p of this.peers.values()) {
                if (p.source === 'bootstrap') continue;
                if (!victim || (p.lastSeen || 0) < (victim.lastSeen || 0)) victim = p;
            }
            if (victim) this.peers.delete(victim.address);
        }
        this._persist();
        return entry;
    }

    forget(address) {
        const had = this.peers.delete(String(address || '').trim());
        if (had) this._persist();
        return had;
    }

    list() { return Array.from(this.peers.values()); }
    addresses() { return Array.from(this.peers.keys()); }
    size() { return this.peers.size; }

    /**
     * Which known addresses should we dial right now? Excludes our own addresses,
     * anything we're already connected to (by address or nodeId), and respects the
     * connection cap. Most-recently-seen first.
     */
    dialTargets({ connectedNodeIds = new Set(), connectedAddresses = new Set(), selfAddresses = new Set() } = {}) {
        const slots = this.maxPeers - connectedNodeIds.size;
        if (slots <= 0) return [];
        return this.list()
            .filter(p => !selfAddresses.has(p.address))
            .filter(p => !connectedAddresses.has(p.address))
            .filter(p => !(p.nodeId && connectedNodeIds.has(p.nodeId)))
            .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
            .slice(0, slots)
            .map(p => p.address);
    }
}

// Shared singleton — the arbiter dials from one book.
export default new GMNPeerBook();
