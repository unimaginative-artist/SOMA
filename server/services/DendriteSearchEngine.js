import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import DendriteSafetyFilter from './DendriteSafetyFilter.js';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'aperture', 'dendrite-search.db');

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function searchTerms(value = '') {
    return [...new Set(String(value).toLowerCase().match(/[a-z0-9]{2,}/g) || [])].slice(0, 12);
}

function ftsQuery(value = '') {
    return searchTerms(value).map(term => `"${term.replace(/"/g, '""')}"*`).join(' OR ');
}

function fallbackSnippet(content = '', terms = []) {
    const text = normalizeText(content);
    const lower = text.toLowerCase();
    const location = terms.map(term => lower.indexOf(term)).find(index => index >= 0) ?? 0;
    const start = Math.max(0, location - 60);
    const snippet = text.slice(start, start + 280);
    return start > 0 ? `...${snippet}` : snippet;
}

// Canonicalize URL helper
function canonicalizeUrl(urlStr = '') {
    try {
        const url = new URL(urlStr.trim());
        url.hash = '';
        // Strip tracking params
        const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
        for (const p of stripParams) {
            url.searchParams.delete(p);
        }
        // Lowercase hostname
        url.hostname = url.hostname.toLowerCase();
        // Remove trailing slash if path is just /
        let res = url.toString();
        if (res.endsWith('/') && url.pathname === '/') {
            res = res.slice(0, -1);
        }
        return res;
    } catch {
        return urlStr.trim().toLowerCase();
    }
}

// 128-dimensional term frequency hashing vector helper for offline semantic simulation
function generateEmbedding(text = '') {
    const vector = new Array(128).fill(0);
    const words = String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [];
    for (const word of words) {
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = (hash * 31 + word.charCodeAt(i)) & 0xffffffff;
        }
        const index = Math.abs(hash) % 128;
        vector[index] += 1;
    }
    // Normalize vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
        for (let i = 0; i < 128; i++) {
            vector[i] /= magnitude;
        }
    }
    return vector;
}

function cosineSimilarity(v1, v2) {
    if (!v1 || !v2 || v1.length !== v2.length) return 0;
    let dotProduct = 0;
    for (let i = 0; i < v1.length; i++) {
        dotProduct += v1[i] * v2[i];
    }
    return dotProduct;
}

export class DendriteSearchEngine {
    constructor(options = {}) {
        this.dbPath = options.dbPath || DEFAULT_DB_PATH;
        this.legacyJsonPath = options.legacyJsonPath || null;
        ensureDir(this.dbPath);
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.ftsReady = false;
        this.init();
    }

    init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS dendrite_pages (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT DEFAULT 'unknown',
                hash TEXT DEFAULT '',
                metadata TEXT DEFAULT '{}',
                indexed_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_dendrite_pages_indexed_at ON dendrite_pages(indexed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_dendrite_pages_source ON dendrite_pages(source);
        `);

        // Dynamic schema upgrades
        const columns = this.db.prepare("PRAGMA table_info(dendrite_pages)").all().map(c => c.name);
        if (!columns.includes('canonical_url')) {
            try { this.db.exec("ALTER TABLE dendrite_pages ADD COLUMN canonical_url TEXT"); } catch (e) {}
        }
        if (!columns.includes('domain')) {
            try { this.db.exec("ALTER TABLE dendrite_pages ADD COLUMN domain TEXT"); } catch (e) {}
        }
        if (!columns.includes('captured_at')) {
            try { this.db.exec("ALTER TABLE dendrite_pages ADD COLUMN captured_at TEXT"); } catch (e) {}
        }
        if (!columns.includes('refreshed_at')) {
            try { this.db.exec("ALTER TABLE dendrite_pages ADD COLUMN refreshed_at TEXT"); } catch (e) {}
        }
        if (!columns.includes('status')) {
            try { this.db.exec("ALTER TABLE dendrite_pages ADD COLUMN status TEXT DEFAULT 'captured'"); } catch (e) {}
        }
        if (!columns.includes('content_hash')) {
            try { this.db.exec("ALTER TABLE dendrite_pages ADD COLUMN content_hash TEXT"); } catch (e) {}
        }
        if (!columns.includes('archive_status')) {
            try { this.db.exec("ALTER TABLE dendrite_pages ADD COLUMN archive_status TEXT DEFAULT 'active'"); } catch (e) {}
        }
        if (!columns.includes('semantic_embedding')) {
            try { this.db.exec("ALTER TABLE dendrite_pages ADD COLUMN semantic_embedding TEXT"); } catch (e) {}
        }

        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS dendrite_pages_fts USING fts5(
                    id UNINDEXED,
                    title,
                    url,
                    content,
                    source
                );
            `);
            this.ftsReady = true;
        } catch (error) {
            this.ftsReady = false;
            console.warn('[DendriteSearch] FTS5 unavailable, using LIKE search:', error.message);
        }

        if (this.legacyJsonPath) this.importLegacyJson(this.legacyJsonPath);
    }

    count() {
        return this.db.prepare("SELECT COUNT(*) AS n FROM dendrite_pages WHERE archive_status != 'deleted'").get().n;
    }

    stats() {
        const bySource = this.db.prepare(`
            SELECT source, COUNT(*) AS count
            FROM dendrite_pages
            WHERE archive_status != 'deleted'
            GROUP BY source
            ORDER BY count DESC
        `).all();
        const latest = this.db.prepare("SELECT MAX(indexed_at) AS latest FROM dendrite_pages WHERE archive_status != 'deleted'").get()?.latest || null;
        return { indexedPages: this.count(), latestIndexedAt: latest, bySource };
    }

    importLegacyJson(jsonPath) {
        if (!fs.existsSync(jsonPath)) return { imported: 0 };
        let value;
        try {
            value = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        } catch {
            return { imported: 0 };
        }
        const pages = Array.isArray(value.pages) ? value.pages : [];
        let imported = 0;
        const existing = this.db.prepare("SELECT id FROM dendrite_pages WHERE url = ?");
        const tx = this.db.transaction(() => {
            for (const page of pages) {
                if (!page?.url || !page?.content || existing.get(page.url)) continue;
                this.indexPage(page);
                imported++;
            }
        });
        tx();
        return { imported };
    }

    indexPage(page = {}) {
        const url = String(page.url || '').trim();
        if (!url) throw new Error('url is required');

        if (!DendriteSafetyFilter.isSafe(url, page.content)) {
            console.warn(`[DendriteSearchEngine] Blocked indexing of unsafe page: ${url}`);
            return null;
        }

        const canonicalUrl = canonicalizeUrl(url);
        const id = page.id || Buffer.from(canonicalUrl).toString('base64url').slice(0, 80);
        const title = normalizeText(page.title || url).slice(0, 250);
        const content = normalizeText(page.content).slice(0, 120000);
        
        let parsedDomain = '';
        try {
            parsedDomain = new URL(url).hostname;
        } catch {}

        const source = String(page.source || 'unknown').slice(0, 80);
        
        // Content hashing
        const hash = page.hash || crypto.createHash('sha256').update(content).digest('hex');
        
        const metadata = JSON.stringify(page.metadata || {});
        const nowStr = new Date().toISOString();
        const capturedAt = page.capturedAt || page.metadata?.capturedAt || nowStr;
        const refreshedAt = nowStr;
        const status = page.status || 'captured';
        const archiveStatus = page.archiveStatus || 'active';
        
        const embedding = generateEmbedding(content);
        const embeddingStr = JSON.stringify(embedding);

        this.db.prepare(`
            INSERT INTO dendrite_pages (
                id, url, title, content, source, hash, metadata, indexed_at,
                canonical_url, domain, captured_at, refreshed_at, status, content_hash, archive_status, semantic_embedding
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
                id = excluded.id,
                title = excluded.title,
                content = excluded.content,
                source = excluded.source,
                hash = excluded.hash,
                metadata = excluded.metadata,
                indexed_at = excluded.indexed_at,
                canonical_url = excluded.canonical_url,
                domain = excluded.domain,
                captured_at = excluded.captured_at,
                refreshed_at = excluded.refreshed_at,
                status = excluded.status,
                content_hash = excluded.content_hash,
                archive_status = excluded.archive_status,
                semantic_embedding = excluded.semantic_embedding
        `).run(
            id, url, title, content, source, hash, metadata, nowStr,
            canonicalUrl, parsedDomain, capturedAt, refreshedAt, status, hash, archiveStatus, embeddingStr
        );

        if (this.ftsReady) {
            this.db.prepare('DELETE FROM dendrite_pages_fts WHERE id = ?').run(id);
            this.db.prepare(`
                INSERT INTO dendrite_pages_fts (id, title, url, content, source)
                VALUES (?, ?, ?, ?, ?)
            `).run(id, title, url, content, source);
        }

        // Gossip this new local index page to the peer-to-peer Gray Matter Network
        if (source !== 'gmn:peer' && globalThis.__gmnMesh?.broadcastSearchGossip) {
            try {
                globalThis.__gmnMesh.broadcastSearchGossip({
                    url,
                    title,
                    contentSnippet: content.substring(0, 1000),
                    hash,
                    source
                });
            } catch (gossipErr) {
                // Ignore silent warnings to avoid logs spamming
            }
        }

        return this.getPage(id);
    }

    indexPages(pages = []) {
        let indexed = 0;
        const tx = this.db.transaction(() => {
            for (const page of pages) {
                this.indexPage(page);
                indexed++;
            }
        });
        tx();
        return indexed;
    }

    getPage(id) {
        const row = this.db.prepare('SELECT * FROM dendrite_pages WHERE id = ?').get(id);
        return row ? this.rowToPage(row, true) : null;
    }

    listPages(limit = 100) {
        return this.db.prepare(`
            SELECT id, url, title, source, hash, metadata, indexed_at, status, archive_status, length(content) AS content_length
            FROM dendrite_pages
            WHERE archive_status != 'deleted'
            ORDER BY indexed_at DESC
            LIMIT ?
        `).all(Math.min(Number(limit) || 100, 500)).map(row => ({
            id: row.id,
            url: row.url,
            title: row.title,
            source: row.source,
            hash: row.hash,
            status: row.status,
            archiveStatus: row.archive_status,
            metadata: this.parseMetadata(row.metadata),
            indexedAt: row.indexed_at,
            contentLength: row.content_length
        }));
    }

    deletePage(id) {
        const result = this.db.prepare("UPDATE dendrite_pages SET archive_status = 'deleted' WHERE id = ?").run(id);
        // Also remove from virtual table so it doesn't appear in FTS searches
        if (this.ftsReady) {
            this.db.prepare('DELETE FROM dendrite_pages_fts WHERE id = ?').run(id);
        }
        return result.changes > 0;
    }

    archivePage(id, archive = true) {
        const state = archive ? 'archived' : 'active';
        const result = this.db.prepare("UPDATE dendrite_pages SET archive_status = ? WHERE id = ?").run(state, id);
        return result.changes > 0;
    }

    updatePageStatus(id, status) {
        const result = this.db.prepare("UPDATE dendrite_pages SET status = ?, refreshed_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
        return result.changes > 0;
    }

    search(query, limit = 15) {
        const terms = searchTerms(query);
        if (!terms.length) return [];
        const max = Math.min(Number(limit) || 15, 50);
        const queryEmbedding = generateEmbedding(query);

        let candidates = [];

        if (this.ftsReady) {
            const match = ftsQuery(query);
            try {
                candidates = this.db.prepare(`
                    SELECT p.*,
                           bm25(dendrite_pages_fts, 8.0, 4.0, 1.0, 1.5) AS bm25_rank,
                           snippet(dendrite_pages_fts, 3, '', '', '...', 42) AS snippet
                    FROM dendrite_pages_fts
                    JOIN dendrite_pages p ON p.id = dendrite_pages_fts.id
                    WHERE dendrite_pages_fts MATCH ? AND p.archive_status != 'deleted'
                    LIMIT 100
                `).all(match);
            } catch (error) {
                console.warn('[DendriteSearch] FTS query failed, falling back:', error.message);
            }
        }

        if (candidates.length === 0) {
            // Fallback to query all active documents
            const rows = this.db.prepare("SELECT * FROM dendrite_pages WHERE archive_status != 'deleted' LIMIT 1000").all();
            candidates = rows.map(row => {
                const haystack = `${row.title} ${row.url} ${row.content}`.toLowerCase();
                let score = 0;
                for (const term of terms) {
                    if (String(row.title).toLowerCase().includes(term)) score += 8;
                    if (String(row.url).toLowerCase().includes(term)) score += 4;
                    score += Math.min(haystack.split(term).length - 1, 8);
                }
                return {
                    ...row,
                    bm25_rank: -score,
                    snippet: fallbackSnippet(row.content, terms)
                };
            }).filter(item => item.bm25_rank < 0);
        }

        // Apply blended ranking scoring logic
        return candidates.map(row => {
            // 1. Keyword Score
            const keywordScore = -row.bm25_rank;

            // 2. Semantic vector score (cosine similarity)
            let semanticSimilarity = 0;
            if (row.semantic_embedding) {
                try {
                    const docEmbedding = JSON.parse(row.semantic_embedding);
                    semanticSimilarity = cosineSimilarity(queryEmbedding, docEmbedding);
                } catch {}
            }

            // 3. Freshness boost
            const indexedAt = Date.parse(row.indexed_at) || 0;
            let freshnessScore = 0;
            if (indexedAt) {
                const daysOld = Math.max(0, (Date.now() - indexedAt) / 86400000);
                freshnessScore = Math.max(0, 10 - Math.min(daysOld, 30) * 0.33); // max 10 points boost for new pages
            }

            // 4. Source Quality boost
            let qualityScore = 0;
            const source = String(row.source).toLowerCase();
            const url = String(row.url).toLowerCase();
            if (url.startsWith('gmn://')) qualityScore += 12;
            if (source === 'gmn:site') qualityScore += 10;
            if (/bookmark|portal-reader|chromium-browser/.test(source)) qualityScore += 5;
            if (/crawler|dendrite/.test(source)) qualityScore += 2;

            // 5. Duplication Penalty
            // Check if there are other pages in DB with the exact same content hash
            let duplicationPenalty = 0;
            if (row.hash) {
                try {
                    const dupCount = this.db.prepare('SELECT COUNT(*) as n FROM dendrite_pages WHERE hash = ? AND id != ? AND archive_status != \'deleted\'').get(row.hash, row.id).n;
                    if (dupCount > 0) {
                        duplicationPenalty = Math.min(dupCount * 3.5, 15); // penalize duplicate content
                    }
                } catch {}
            }

            // Calculate blended final score
            const finalScore = keywordScore + (semanticSimilarity * 18) + freshnessScore + qualityScore - duplicationPenalty;

            return {
                id: row.id,
                url: row.url,
                title: row.title,
                source: row.source,
                hash: row.hash,
                status: row.status,
                archiveStatus: row.archive_status,
                metadata: this.parseMetadata(row.metadata),
                indexedAt: row.indexed_at,
                score: Number(finalScore.toFixed(4)),
                snippet: normalizeText(row.snippet || fallbackSnippet(row.content, terms)),
                // Show extract details for citations
                citationSource: {
                    domain: row.domain || '',
                    title: row.title,
                    url: row.url,
                    capturedAt: row.captured_at || row.indexed_at
                }
            };
        })
        .sort((a, b) => b.score - a.score || b.indexedAt.localeCompare(a.indexedAt))
        .slice(0, max);
    }

    rowToPage(row, includeContent = false) {
        return {
            id: row.id,
            url: row.url,
            title: row.title,
            source: row.source,
            hash: row.hash,
            status: row.status,
            archiveStatus: row.archive_status,
            canonicalUrl: row.canonical_url,
            domain: row.domain,
            capturedAt: row.captured_at,
            refreshedAt: row.refreshed_at,
            metadata: this.parseMetadata(row.metadata),
            indexedAt: row.indexed_at,
            ...(includeContent ? { content: row.content } : { contentLength: row.content?.length || row.content_length || 0 })
        };
    }

    ingestSearchGossip(packet = {}) {
        if (!packet || !packet.url || !packet.title) return null;
        const url = String(packet.url).trim();
        const title = String(packet.title).trim();
        const content = String(packet.contentSnippet || packet.content || title).trim();
        const originNode = String(packet.originNodeId || 'gmn-peer').trim();

        return this.indexPage({
            url,
            title,
            content,
            source: `gmn:peer:${originNode.slice(0, 16)}`,
            hash: packet.hash,
            metadata: {
                gossipedBy: originNode,
                gossipedAt: new Date().toISOString(),
                originalSource: packet.source || 'crawled'
            }
        });
    }

    getGossipFeed(limit = 20) {
        const rows = this.db.prepare(`
            SELECT id, url, title, source, hash, indexed_at, metadata, content
            FROM dendrite_pages
            WHERE archive_status != 'deleted'
            ORDER BY indexed_at DESC
            LIMIT ?
        `).all(limit);

        return rows.map(r => ({
            id: r.id,
            url: r.url,
            title: r.title,
            source: r.source,
            hash: r.hash,
            indexedAt: r.indexed_at,
            snippet: normalizeText(r.content).slice(0, 180),
            metadata: this.parseMetadata(r.metadata)
        }));
    }

    parseMetadata(value) {
        try {
            return JSON.parse(value || '{}');
        } catch {
            return {};
        }
    }
}

export default DendriteSearchEngine;
