/**
 * GMNPinStore — the replicas THIS node holds for other people's sites.
 *
 * A pin is a verified copy of a peer's site that we keep and will serve to the mesh,
 * so the site stays reachable even when its origin node is offline. This is the
 * mechanism that makes GMN sites "un-takedownable": as long as one pin is online,
 * the site lives. Pins are bounded (count + bytes) with LRU eviction.
 *
 * Backed by a sandboxed GMNSiteService rooted at data/gmn/cache — pinned content is
 * still re-rendered through the sandbox on read, so a malicious origin can't inject.
 */
import fs from 'node:fs';
import path from 'node:path';
import GMNSiteService from './GMNSiteService.js';

const CACHE_ROOT = path.resolve(process.cwd(), 'data', 'gmn', 'cache');
const INDEX_FILE = path.resolve(process.cwd(), 'data', 'gmn', 'pins.json');
const MAX_PINS = Number(process.env.GMN_MAX_PINS || 300);
const MAX_BYTES = Number(process.env.GMN_MAX_PIN_BYTES || 200 * 1024 * 1024); // 200 MB
const nowMs = () => Date.now();

function bundleBytes(bundle) {
    return (bundle.files || []).reduce((total, f) => total + Buffer.byteLength(f.data || '', 'base64'), 0);
}

export class GMNPinStore {
    constructor(options = {}) {
        this.cache = new GMNSiteService({ root: options.root || CACHE_ROOT, seed: false });
        this.indexFile = options.indexFile || INDEX_FILE;
        this.maxPins = options.maxPins || MAX_PINS;
        this.maxBytes = options.maxBytes || MAX_BYTES;
        this.pins = new Map(); // domain -> { domain, site, contentHash, bytes, pinnedAt, lastServedAt }
        this._load();
    }

    _load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
            if (Array.isArray(raw.pins)) for (const p of raw.pins) if (p?.domain) this.pins.set(p.domain, p);
        } catch { /* no pins yet */ }
    }

    _persist() {
        try {
            fs.mkdirSync(path.dirname(this.indexFile), { recursive: true });
            const tmp = `${this.indexFile}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), pins: Array.from(this.pins.values()) }, null, 2));
            fs.renameSync(tmp, this.indexFile);
        } catch (e) {
            console.warn(`[GMNPinStore] persist failed: ${e.message}`);
        }
    }

    has(domain, contentHash) {
        const p = this.pins.get(String(domain || '').toLowerCase());
        return !!p && (!contentHash || p.contentHash === contentHash);
    }
    get(domain) { return this.pins.get(String(domain || '').toLowerCase()) || null; }
    list() { return Array.from(this.pins.values()); }
    totalBytes() { return this.list().reduce((t, p) => t + (p.bytes || 0), 0); }
    verifyBundle(bundle) { return this.cache.verifyBundle(bundle); }
    exportBundle(site) { return this.cache.exportBundle(site); }

    /** Pin a VERIFIED bundle: install to the sandboxed cache + index it. Evicts LRU. */
    pin(bundle) {
        const verdict = this.cache.verifyBundle(bundle);
        if (!verdict.ok) throw new Error(`pin verify failed: ${verdict.reason}`);
        const domain = String(bundle.domain || `${bundle.site}.gmn`).toLowerCase();
        const bytes = bundleBytes(bundle);
        this._evictFor(bytes, domain);
        this.cache.installBundle(bundle);
        const prev = this.pins.get(domain);
        const pin = {
            domain,
            site: bundle.site || domain.replace(/\.gmn$/, ''),
            contentHash: bundle.contentHash,
            bytes,
            pinnedAt: prev?.pinnedAt || nowMs(),
            lastServedAt: nowMs(),
        };
        this.pins.set(domain, pin);
        this._persist();
        return pin;
    }

    /** Render a pinned site through the sandbox; updates LRU recency. */
    render(domain, relativePath) {
        const rendered = this.cache.render(domain, relativePath);
        if (rendered) {
            const pin = this.get(domain);
            if (pin) { pin.lastServedAt = nowMs(); this._persist(); }
        }
        return rendered;
    }

    unpin(domain) {
        const d = String(domain || '').toLowerCase();
        if (!this.pins.has(d)) return false;
        try { this.cache.deleteSite(d.replace(/\.gmn$/, '')); } catch { /* already gone */ }
        this.pins.delete(d);
        this._persist();
        return true;
    }

    _evictFor(incomingBytes, keepDomain) {
        while (this.pins.size >= this.maxPins) { if (!this._evictLRU(keepDomain)) break; }
        while (this.totalBytes() + incomingBytes > this.maxBytes && this.pins.size > 0) { if (!this._evictLRU(keepDomain)) break; }
    }

    _evictLRU(keepDomain) {
        let victim = null;
        for (const p of this.pins.values()) {
            if (p.domain === keepDomain) continue;
            if (!victim || (p.lastServedAt || 0) < (victim.lastServedAt || 0)) victim = p;
        }
        if (!victim) return false;
        this.unpin(victim.domain);
        return true;
    }

    stats() { return { pins: this.pins.size, bytes: this.totalBytes(), maxPins: this.maxPins, maxBytes: this.maxBytes }; }
}

// Shared singleton — routes and the mesh arbiter pin/serve from the same store.
export default new GMNPinStore();
