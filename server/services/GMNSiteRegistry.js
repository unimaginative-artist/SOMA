/**
 * GMNSiteRegistry — this node's index of every GMN site it knows about.
 *
 * One row per domain: where it came from (originNodeId), its content address
 * (contentHash), a searchable title/summary, and which nodes hold a copy
 * (replicas). Local sites are authoritative entries for THIS node; in later
 * batches, gossiped announces add `source: 'remote'` rows and replication grows
 * the `replicas` list — which is what lets a site outlive its origin going offline.
 *
 * Persistence is atomic (temp + rename) and the whole index is cached in memory.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_FILE = path.resolve(process.cwd(), 'data', 'gmn', 'registry.json');
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,62}\.gmn$/;
const nowIso = () => new Date().toISOString();

export class GMNSiteRegistry {
    constructor(options = {}) {
        this.file = options.file || DEFAULT_FILE;
        this.entries = new Map(); // domain -> entry
        this._load();
    }

    _load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (raw && Array.isArray(raw.entries)) {
                for (const entry of raw.entries) {
                    if (entry?.domain) this.entries.set(String(entry.domain).toLowerCase(), entry);
                }
            }
        } catch { /* no registry yet — first run */ }
    }

    _persist() {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.${process.pid}.tmp`;
            const payload = { version: 1, updatedAt: nowIso(), entries: Array.from(this.entries.values()) };
            fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
            fs.renameSync(tmp, this.file); // atomic swap
        } catch (e) {
            // Persistence is best-effort; the in-memory index stays correct.
            console.warn(`[GMNSiteRegistry] persist failed: ${e.message}`);
        }
    }

    get(domain) { return this.entries.get(String(domain || '').toLowerCase()) || null; }

    list() {
        return Array.from(this.entries.values())
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }

    has(domain) { return this.entries.has(String(domain || '').toLowerCase()); }

    remove(domain) {
        const key = String(domain || '').toLowerCase();
        const had = this.entries.delete(key);
        if (had) this._persist();
        return had;
    }

    /**
     * Insert or update a registry row. `contentHash` changing is what counts as a
     * real content change (and bumps updatedAt); everything else is metadata.
     */
    upsert(input = {}) {
        const domain = String(input.domain || '').toLowerCase();
        if (!DOMAIN_RE.test(domain)) throw new Error(`Invalid GMN domain for registry: "${input.domain}"`);
        const prev = this.entries.get(domain) || {};
        const replicas = Array.from(new Set([...(prev.replicas || []), ...(input.replicas || [])].filter(Boolean)));
        const contentChanged = input.contentHash != null && input.contentHash !== prev.contentHash;

        const entry = {
            domain,
            site: input.site || prev.site || domain.replace(/\.gmn$/, ''),
            originNodeId: input.originNodeId ?? prev.originNodeId ?? null,
            contentHash: input.contentHash ?? prev.contentHash ?? null,
            title: input.title ?? prev.title ?? domain,
            summary: input.summary ?? prev.summary ?? '',
            bytes: input.bytes ?? prev.bytes ?? 0,
            fileCount: input.fileCount ?? prev.fileCount ?? 0,
            replicas,
            source: input.source || prev.source || 'local',
            // Monotonic revision — the deterministic ordering signal for conflict
            // resolution (newer rev wins), independent of unreliable wall-clocks.
            rev: contentChanged ? (Number(prev.rev || 0) + 1) : (prev.rev || 1),
            firstSeen: prev.firstSeen || nowIso(),
            lastSeen: nowIso(),
            updatedAt: contentChanged ? nowIso() : (prev.updatedAt || nowIso()),
        };
        this.entries.set(domain, entry);
        this._persist();
        return entry;
    }

    touch(domain) {
        const entry = this.get(domain);
        if (entry) { entry.lastSeen = nowIso(); this._persist(); }
        return entry;
    }

    addReplica(domain, nodeId) {
        const entry = this.get(domain);
        if (!entry || !nodeId) return entry;
        if (!entry.replicas.includes(nodeId)) { entry.replicas.push(nodeId); this._persist(); }
        return entry;
    }

    removeReplica(domain, nodeId) {
        const entry = this.get(domain);
        if (!entry) return entry;
        const i = entry.replicas.indexOf(nodeId);
        if (i >= 0) { entry.replicas.splice(i, 1); this._persist(); }
        return entry;
    }

    /**
     * Make the registry agree with the sites actually on disk for THIS node:
     * every local site becomes an authoritative `source: 'local'` row whose
     * origin + first replica is this node. Safe to run on every boot.
     */
    reconcileLocal(siteService, nodeId) {
        let count = 0;
        for (const resolved of siteService.listSites()) {
            try {
                const site = resolved.manifest.site;
                const b = siteService.bundle(site);
                let summary = resolved.manifest.description || '';
                if (!summary) {
                    try { summary = (siteService.render(resolved.canonical)?.text || '').slice(0, 200); } catch { /* ignore */ }
                }
                this.upsert({
                    domain: resolved.canonical,
                    site,
                    originNodeId: nodeId,
                    contentHash: b.contentHash,
                    title: resolved.manifest.title || site,
                    summary: String(summary).slice(0, 200),
                    bytes: b.bytes,
                    fileCount: b.fileCount,
                    replicas: [nodeId],
                    source: 'local',
                });
                count += 1;
            } catch { /* skip unreadable site */ }
        }
        return count;
    }

    stats() {
        const all = this.list();
        return {
            total: all.length,
            local: all.filter(e => e.source === 'local').length,
            remote: all.filter(e => e.source !== 'local').length,
        };
    }
}

export default GMNSiteRegistry;
