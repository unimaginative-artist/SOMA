import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import axisStore from '../axis/AxisStore.js';
import DendriteSearchEngine from '../services/DendriteSearchEngine.js';
import portalDb from '../storage/portalDb.js';
import { requireEnterpriseAuth } from '../loaders/authMiddleware.js';
import { registerAperturePilotRoutes } from './aperturePilotRoutes.js';

const statePath = path.resolve(process.cwd(), 'data', 'aperture', 'state.json');
const portalIndexPath = path.resolve(process.cwd(), 'data', 'aperture', 'portal-index.json');
const reflectionsPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
const require = createRequire(import.meta.url);
const { WebCrawlerWorker } = require('../../workers/WebCrawlerWorker.cjs');

const defaultState = {
    settings: {
        theme: 'graphite',
        wallpaper: 'alpine',
        wallpaperUrl: '',
        activeWorkspaceId: null,
        autonomyLevel: 2,
        permissions: {
            fileRead: true,
            networkAccess: true,
            memoryWrite: true,
            somaReasoning: true
        },
        notificationsEnabled: true
    },
    calendar: []
};

async function readState() {
    try {
        const value = JSON.parse(await fs.readFile(statePath, 'utf8'));
        return {
            settings: {
                ...defaultState.settings,
                ...(value.settings || {}),
                permissions: {
                    ...defaultState.settings.permissions,
                    ...(value.settings?.permissions || {})
                }
            },
            calendar: Array.isArray(value.calendar) ? value.calendar : []
        };
    } catch {
        return structuredClone(defaultState);
    }
}

async function writeState(state) {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    return state;
}

async function readPortalIndex() {
    try {
        const value = JSON.parse(await fs.readFile(portalIndexPath, 'utf8'));
        return Array.isArray(value.pages) ? value.pages : [];
    } catch {
        return [];
    }
}

async function writePortalIndex(pages) {
    await fs.mkdir(path.dirname(portalIndexPath), { recursive: true });
    await fs.writeFile(portalIndexPath, JSON.stringify({ version: 1, pages }, null, 2), 'utf8');
    return pages;
}

function indexTerms(value = '') {
    return [...new Set(String(value).toLowerCase().match(/[a-z0-9]{2,}/g) || [])];
}

function portalSearchScore(page, queryTerms) {
    const title = String(page.title || '').toLowerCase();
    const url = String(page.url || '').toLowerCase();
    const content = String(page.content || '').toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
        if (title.includes(term)) score += 8;
        if (url.includes(term)) score += 4;
        const matches = content.split(term).length - 1;
        score += Math.min(matches, 8);
    }
    return score;
}

function snippetForPage(page, queryTerms) {
    const content = String(page.content || '').replace(/\s+/g, ' ').trim();
    const lower = content.toLowerCase();
    const location = queryTerms.map(term => lower.indexOf(term)).find(index => index >= 0) ?? 0;
    const start = Math.max(0, location - 45);
    const snippet = content.slice(start, start + 235);
    return start > 0 ? `...${snippet}` : snippet;
}

function contentHash(value = '') {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizePortalUrl(value = '') {
    try {
        const url = new URL(String(value).trim());
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function portalPageFromBody({ url, title, content, source = 'reader', metadata = {} }) {
    const normalizedUrl = normalizePortalUrl(url);
    const cleanContent = String(content || '').replace(/\s+/g, ' ').trim();
    if (!normalizedUrl || !cleanContent) return null;
    const hash = contentHash(`${normalizedUrl}\n${cleanContent}`);
    return {
        id: Buffer.from(normalizedUrl).toString('base64url').slice(0, 80),
        url: normalizedUrl,
        title: String(title || normalizedUrl).trim().slice(0, 250),
        content: cleanContent.slice(0, 120000),
        source: String(source).slice(0, 40),
        hash,
        metadata: {
            ...metadata,
            contentLength: cleanContent.length,
            capturedAt: new Date().toISOString()
        },
        indexedAt: new Date().toISOString()
    };
}

function portalPageFromCrawlerItem(item = {}) {
    const content = item.content || item.question || [item.description, ...(item.answers || [])].filter(Boolean).join('\n\n');
    return portalPageFromBody({
        url: item.url,
        title: item.title || item.topic || item.url,
        content,
        source: `crawler:${item.source || 'portal'}`,
        metadata: {
            crawlerType: item.type,
            crawledAt: item.crawledAt,
            tags: item.tags || []
        }
    });
}

function portalPageFromDendritePage(page = {}) {
    const content = page.text || page.content || page.excerpt || page.html || '';
    return portalPageFromBody({
        url: page.url,
        title: page.title || page.url,
        content,
        source: 'dendrite:objective',
        metadata: {
            status: page.status,
            screenshot: page.screenshot || null,
            extractedData: page.extractedData || null,
            acquisition: 'WebScraperDendrite'
        }
    });
}

function safeSettingsPatch(body = {}) {
    const allowedThemes = ['daylight', 'graphite', 'slate'];
    const allowedWallpapers = ['alpine', 'mist', 'graphite', 'custom'];
    const permissions = body.permissions || {};
    const patch = {};
    if (allowedThemes.includes(body.theme)) patch.theme = body.theme;
    if (allowedWallpapers.includes(body.wallpaper)) patch.wallpaper = body.wallpaper;
    if (typeof body.wallpaperUrl === 'string') patch.wallpaperUrl = body.wallpaperUrl.slice(0, 2000000);
    if (body.activeWorkspaceId === null || typeof body.activeWorkspaceId === 'string') patch.activeWorkspaceId = body.activeWorkspaceId;
    if (Number.isInteger(body.autonomyLevel)) patch.autonomyLevel = Math.max(1, Math.min(3, body.autonomyLevel));
    if (typeof body.notificationsEnabled === 'boolean') patch.notificationsEnabled = body.notificationsEnabled;
    patch.permissions = {};
    for (const key of Object.keys(defaultState.settings.permissions)) {
        if (typeof permissions[key] === 'boolean') patch.permissions[key] = permissions[key];
    }
    return patch;
}

async function searchReflections(query) {
    const q = query.toLowerCase();
    try {
        const files = (await fs.readdir(reflectionsPath)).filter(name => name.endsWith('.md')).slice(0, 350);
        const results = [];
        for (const name of files) {
            const content = await fs.readFile(path.join(reflectionsPath, name), 'utf8').catch(() => '');
            if (!content.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) continue;
            const title = content.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] || name.replace(/\.md$/, '');
            results.push({ id: name, type: 'reflection', appId: 'notes', title, detail: 'Reflections note' });
            if (results.length >= 8) break;
        }
        return results;
    } catch {
        return [];
    }
}

export default function createApertureRoutes(system = {}) {
    const router = express.Router();
    const dendriteSearch = new DendriteSearchEngine({ legacyJsonPath: portalIndexPath });

    registerAperturePilotRoutes(router, { system, readState });

    router.get('/settings', async (_req, res) => {
        const state = await readState();
        res.json({ success: true, settings: state.settings });
    });

    router.put('/settings', async (req, res) => {
        const state = await readState();
        const patch = safeSettingsPatch(req.body || {});
        state.settings = {
            ...state.settings,
            ...patch,
            permissions: { ...state.settings.permissions, ...patch.permissions }
        };
        await writeState(state);
        res.json({ success: true, settings: state.settings });
    });

    router.get('/calendar', async (req, res) => {
        const state = await readState();
        const workspaceId = String(req.query.workspaceId || '').trim();
        const events = workspaceId
            ? state.calendar.filter(event => event.workspaceId === workspaceId)
            : state.calendar;
        res.json({ success: true, events });
    });

    router.post('/calendar', async (req, res) => {
        const { title, startsAt, workspaceId = null, workspaceName = 'Personal', notes = '' } = req.body || {};
        if (!title?.trim() || !startsAt) return res.status(400).json({ success: false, error: 'title and startsAt required' });
        const state = await readState();
        const event = {
            id: `event-${Date.now()}`,
            title: title.trim(),
            startsAt: new Date(startsAt).toISOString(),
            workspaceId,
            workspaceName,
            notes: String(notes).slice(0, 1000),
            createdAt: new Date().toISOString()
        };
        state.calendar.push(event);
        await writeState(state);
        res.json({ success: true, event });
    });

    router.delete('/calendar/:id', async (req, res) => {
        const state = await readState();
        state.calendar = state.calendar.filter(event => event.id !== req.params.id);
        await writeState(state);
        res.json({ success: true });
    });

    router.get('/portal/index', async (_req, res) => {
        res.json({
            success: true,
            provider: 'dendrite-search',
            count: dendriteSearch.count(),
            pages: dendriteSearch.listPages(100)
        });
    });

    router.get('/portal/stats', async (_req, res) => {
        res.json({
            success: true,
            provider: 'dendrite-search',
            ...dendriteSearch.stats()
        });
    });

    router.post('/portal/index', async (req, res) => {
        if (req.body?.isPrivate) {
            return res.json({ success: true, message: 'Private session - page index skipped' });
        }
        const page = portalPageFromBody(req.body || {});
        if (!page) {
            return res.status(400).json({ success: false, error: 'A public URL and extracted content are required.' });
        }
        const indexed = dendriteSearch.indexPage(page);
        res.json({ success: true, provider: 'dendrite-search', page: { ...indexed, contentLength: page.content.length }, count: dendriteSearch.count() });
    });

    router.delete('/portal/index/:id', async (req, res) => {
        const removed = dendriteSearch.deletePage(req.params.id);
        res.json({ success: true, provider: 'dendrite-search', removed, count: dendriteSearch.count() });
    });

    router.get('/portal/search', async (req, res) => {
        const query = String(req.query.q || '').trim();
        if (query.length < 2) return res.json({ success: true, provider: 'dendrite-search', results: [], count: 0 });
        
        let results = [];
        try {
            results = dendriteSearch.search(query, 15);
        } catch (dbErr) {
            console.error('[ApertureRoutes] DB search failed:', dbErr.message);
        }

        // Blended web search if web=true is requested, or if local results are sparse
        const searchWeb = req.query.web === 'true' || (results.length === 0 && req.query.web !== 'false');
        
        if (searchWeb) {
            try {
                const cheerio = require('cheerio');
                const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                const response = await fetch(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SOMA/2.0'
                    }
                });
                if (response.ok) {
                    const html = await response.text();
                    const $ = cheerio.load(html);
                    const webResults = [];

                    $('.result').each((i, el) => {
                        if (webResults.length >= 10) return false;
                        const linkEl = $(el).find('a.result__a');
                        const snippetEl = $(el).find('.result__snippet');
                        
                        const title = linkEl.text().trim();
                        const href = linkEl.attr('href');
                        const snippet = snippetEl.text().trim();
                        
                        if (title && href) {
                            let finalUrl = href;
                            try {
                                const raw = href.startsWith('//') ? `https:${href}` : href;
                                const parsed = new URL(raw, 'https://duckduckgo.com');
                                const redirected = parsed.searchParams.get('uddg');
                                if (redirected) {
                                    finalUrl = redirected;
                                }
                            } catch {}

                            webResults.push({
                                id: `web-${Buffer.from(finalUrl).toString('base64url').slice(0, 80)}`,
                                url: finalUrl,
                                title,
                                snippet,
                                source: 'web_search_duckduckgo',
                                score: 1.0 - (i * 0.05),
                                citationSource: {
                                    domain: new URL(finalUrl).hostname,
                                    title,
                                    url: finalUrl,
                                    capturedAt: new Date().toISOString()
                                }
                            });

                            // Auto-index and gossip the web search result!
                            try {
                                dendriteSearch.indexPage({
                                    url: finalUrl,
                                    title,
                                    content: snippet,
                                    source: 'web_search_duckduckgo'
                                });
                            } catch (indexErr) {
                                // Silent fallback to prevent route block
                            }
                        }
                    });

                    const localUrls = new Set(results.map(r => r.url.toLowerCase()));
                    const filteredWeb = webResults.filter(w => !localUrls.has(w.url.toLowerCase()));
                    results = [...results, ...filteredWeb];
                }
            } catch (webErr) {
                console.error('[ApertureRoutes] Live DuckDuckGo search failed:', webErr.message);
            }
        }
        // Blended P2P Real-Time query if we have active peers on GMN
        if (globalThis.__gmnMesh?.peers?.size > 0) {
            try {
                // Wait up to 1200ms to collect peer search results
                const peerResults = await globalThis.__gmnMesh.queryPeersForSearch(query, 1200);
                if (peerResults && peerResults.length > 0) {
                    const localUrls = new Set(results.map(r => r.url.toLowerCase()));
                    for (const pr of peerResults) {
                        if (!localUrls.has(pr.url.toLowerCase())) {
                            results.push({
                                id: `peer-rt-${Buffer.from(pr.url).toString('base64url').slice(0, 80)}`,
                                url: pr.url,
                                title: pr.title,
                                snippet: pr.snippet || pr.contentSnippet || '',
                                source: 'gmn:peer_realtime',
                                score: 0.85
                            });
                            localUrls.add(pr.url.toLowerCase());
                        }
                    }
                }
            } catch (peerErr) {
                console.error('[ApertureRoutes] Real-time P2P search failed:', peerErr.message);
            }
        }

        res.json({
            success: true,
            provider: searchWeb ? 'blended-search' : 'dendrite-search',
            results,
            indexedPages: dendriteSearch.count(),
            count: results.length
        });
    });

    router.post('/portal/crawl', async (req, res) => {
        const query = String(req.body?.query || '').trim();
        const maxPages = Math.max(1, Math.min(parseInt(req.body?.maxPages || 5, 10), 12));
        if (query.length < 2) return res.status(400).json({ success: false, error: 'query required' });

        const webScraper = system?.webScraperDendrite;
        if (webScraper?.browseObjective) {
            try {
                const seedUrls = normalizePortalUrl(query) ? [normalizePortalUrl(query)] : [];
                const dendrite = await webScraper.browseObjective({
                    objective: query,
                    seedUrls,
                    maxPages,
                    timeoutMs: 30000,
                    extractors: {
                        mainContent: 'article, main, .content, .post-content, body',
                        headings: 'h1, h2, h3',
                        links: 'a'
                    }
                });
                const indexedPages = (dendrite.pages || [])
                    .filter(page => page && !page.error)
                    .map(portalPageFromDendritePage)
                    .filter(Boolean);

                if (indexedPages.length > 0) {
                    const indexed = dendriteSearch.indexPages(indexedPages);

                    return res.json({
                        success: true,
                        provider: 'web-scraper-dendrite',
                        query,
                        crawled: dendrite.count || indexedPages.length,
                        indexed,
                        pages: indexedPages.map(({ content, ...page }) => ({ ...page, contentLength: content.length })),
                        count: dendriteSearch.count(),
                        summary: dendrite.summary || ''
                    });
                }
            } catch (error) {
                console.warn(`[AperturePortal] Dendrite acquire failed, falling back to WebCrawlerWorker: ${error.message}`);
            }
        }

        const crawler = new WebCrawlerWorker({
            workerId: `portal-${Date.now()}`,
            maxPages,
            maxDepth: 1,
            timeout: 12000,
            requestDelay: 650
        });
        const crawl = await crawler.crawl({ target: 'portal', query, maxPages });
        const indexedPages = (crawl.data || []).map(portalPageFromCrawlerItem).filter(Boolean);
        const indexed = dendriteSearch.indexPages(indexedPages);

        res.json({
            success: crawl.success,
            provider: 'portal-crawler',
            query,
            crawled: crawl.itemsCollected || 0,
            indexed,
            pages: indexedPages.map(({ content, ...page }) => ({ ...page, contentLength: content.length })),
            count: dendriteSearch.count(),
            error: crawl.error
        });
    });

    // -- Acquisition Queue Routes --
    router.get('/portal/acquisition', async (req, res) => {
        try {
            const queue = portalDb.getAcquisitionQueue();
            res.json({ success: true, queue });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/acquisition', async (req, res) => {
        try {
            const { url, title = '', depth = 0 } = req.body || {};
            if (!url) return res.status(400).json({ success: false, error: 'url required' });
            const item = portalDb.enqueueAcquisition({ url, title, depth });
            res.json({ success: true, item });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/acquisition/:id', async (req, res) => {
        try {
            const removed = portalDb.deleteAcquisition(req.params.id);
            res.json({ success: true, removed });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/acquisition/process', async (req, res) => {
        try {
            const queue = portalDb.getAcquisitionQueue().filter(item => item.state === 'pending');
            if (queue.length === 0) {
                return res.json({ success: true, message: 'No pending items in queue' });
            }

            // Fire off background crawls (non-blocking)
            setImmediate(async () => {
                for (const item of queue) {
                    try {
                        portalDb.updateAcquisitionState(item.id, 'indexing');
                        
                        const crawler = new WebCrawlerWorker({
                            workerId: `process-queue-${item.id}`,
                            maxPages: 10,
                            maxDepth: item.depth || 1,
                            timeout: 15000,
                            requestDelay: 500
                        });
                        
                        const crawlResult = await crawler.crawl({ target: 'portal', query: item.url, maxPages: 10 });
                        
                        if (crawlResult.success && crawlResult.data.length > 0) {
                            const pages = crawlResult.data.map(portalPageFromCrawlerItem).filter(Boolean);
                            dendriteSearch.indexPages(pages);
                            portalDb.updateAcquisitionState(item.id, 'completed');
                        } else {
                            portalDb.updateAcquisitionState(item.id, 'failed', crawlResult.error || 'No pages collected');
                        }
                    } catch (err) {
                        portalDb.updateAcquisitionState(item.id, 'failed', err.message);
                    }
                }
            });

            res.json({ success: true, message: `Crawling started in background for ${queue.length} pending items` });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // -- Portal Browser V2: Server-backed tabs, history, and bookmarks --

    // Tabs
    router.get('/portal/tabs', async (req, res) => {
        try {
            const rows = axisStore.db.prepare('SELECT * FROM portal_tabs ORDER BY sort_order ASC, updated_at ASC').all();
            const tabs = rows.map(row => ({
                id: row.id,
                title: row.title,
                is_active: Boolean(row.is_active),
                sort_order: row.sort_order,
                ...JSON.parse(row.tab_state)
            }));
            res.json({ success: true, tabs });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/tabs', async (req, res) => {
        try {
            const { id, title, is_active = 0, sort_order = 0, page, stack, cursor, trail } = req.body || {};
            if (!id || !title) return res.status(400).json({ success: false, error: 'id and title required' });
            const tab_state = JSON.stringify({ page, stack, cursor, trail });
            axisStore.db.prepare(`
                INSERT INTO portal_tabs (id, title, is_active, sort_order, tab_state, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    is_active = excluded.is_active,
                    sort_order = excluded.sort_order,
                    tab_state = excluded.tab_state,
                    updated_at = excluded.updated_at
            `).run(id, title, is_active ? 1 : 0, sort_order, tab_state, Date.now());
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/tabs/sync', async (req, res) => {
        try {
            const { tabs } = req.body || {};
            if (!Array.isArray(tabs)) return res.status(400).json({ success: false, error: 'tabs array required' });
            
            const deleteStmt = axisStore.db.prepare('DELETE FROM portal_tabs');
            const insertStmt = axisStore.db.prepare(`
                INSERT INTO portal_tabs (id, title, is_active, sort_order, tab_state, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            
            axisStore.db.transaction(() => {
                deleteStmt.run();
                tabs.forEach((tab, index) => {
                    const tab_state = JSON.stringify({
                        page: tab.page,
                        stack: tab.stack,
                        cursor: tab.cursor,
                        trail: tab.trail
                    });
                    insertStmt.run(tab.id, tab.title, tab.is_active ? 1 : 0, tab.sort_order || index, tab_state, Date.now());
                });
            })();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/tabs/:id', async (req, res) => {
        try {
            const result = axisStore.db.prepare('DELETE FROM portal_tabs WHERE id = ?').run(req.params.id);
            res.json({ success: true, removed: result.changes > 0 });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Bookmarks
    router.get('/portal/bookmarks', async (req, res) => {
        try {
            const rows = axisStore.db.prepare('SELECT * FROM portal_bookmarks ORDER BY created_at DESC').all();
            const bookmarks = rows.map(row => ({
                id: row.id,
                title: row.title,
                address: row.address,
                kind: row.kind,
                query: row.query,
                createdAt: row.created_at
            }));
            res.json({ success: true, bookmarks });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/bookmarks', async (req, res) => {
        try {
            const { title, address, kind, query = '' } = req.body || {};
            if (!title || !address || !kind) return res.status(400).json({ success: false, error: 'title, address, and kind required' });
            const id = Buffer.from(address).toString('base64url').slice(0, 80);
            axisStore.db.prepare(`
                INSERT INTO portal_bookmarks (id, title, address, kind, query, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    kind = excluded.kind,
                    query = excluded.query
            `).run(id, title, address, kind, query, Date.now());
            res.json({ success: true, bookmark: { id, title, address, kind, query } });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/bookmarks/:id', async (req, res) => {
        try {
            const result = axisStore.db.prepare('DELETE FROM portal_bookmarks WHERE id = ?').run(req.params.id);
            res.json({ success: true, removed: result.changes > 0 });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/bookmarks', async (req, res) => {
        try {
            const address = req.query.address || req.body.address;
            if (!address) return res.status(400).json({ success: false, error: 'address is required' });
            const id = Buffer.from(address).toString('base64url').slice(0, 80);
            const result = axisStore.db.prepare('DELETE FROM portal_bookmarks WHERE id = ?').run(id);
            res.json({ success: true, removed: result.changes > 0 });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // History
    router.get('/portal/history', async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 100, 500);
            const rows = axisStore.db.prepare('SELECT * FROM portal_history ORDER BY created_at DESC LIMIT ?').all(limit);
            const history = rows.map(row => ({
                id: row.id,
                title: row.title,
                address: row.address,
                kind: row.kind,
                query: row.query,
                createdAt: row.created_at
            }));
            res.json({ success: true, history });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/history', async (req, res) => {
        try {
            if (req.body?.isPrivate) {
                return res.json({ success: true, message: 'Private session - history skipped' });
            }
            const { title, address, kind, query = '' } = req.body || {};
            if (!title || !address || !kind) return res.status(400).json({ success: false, error: 'title, address, and kind required' });
            const id = `hist-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            axisStore.db.prepare(`
                INSERT INTO portal_history (id, title, address, kind, query, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, title, address, kind, query, Date.now());
            res.json({ success: true, entry: { id, title, address, kind, query } });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/history/:id', async (req, res) => {
        try {
            const result = axisStore.db.prepare('DELETE FROM portal_history WHERE id = ?').run(req.params.id);
            res.json({ success: true, removed: result.changes > 0 });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/history', async (req, res) => {
        try {
            axisStore.db.prepare('DELETE FROM portal_history').run();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.get('/search', async (req, res) => {
        const query = String(req.query.q || '').trim();
        if (query.length < 2) return res.json({ success: true, results: [] });
        const q = query.toLowerCase();
        const workspaceId = String(req.query.workspaceId || '').trim();
        const results = await searchReflections(query);
        const workspaces = axisStore.getWorkspaces();
        for (const workspace of workspaces) {
            if (workspaceId && workspace.id !== workspaceId) continue;
            const projects = axisStore.getProjects(workspace.id);
            for (const project of projects) {
                if (`${project.name} ${project.description || ''}`.toLowerCase().includes(q)) {
                    results.push({ id: project.id, type: 'project', appId: 'tasks', title: project.name, detail: workspace.name });
                }
                for (const task of axisStore.getTasks(project.id)) {
                    if (`${task.title} ${task.description || ''}`.toLowerCase().includes(q)) {
                        results.push({ id: task.id, type: 'task', appId: 'tasks', title: task.title, detail: `${workspace.name} / ${project.name}` });
                    }
                }
            }
        }
        const state = await readState();
        for (const event of state.calendar) {
            if (workspaceId && event.workspaceId !== workspaceId) continue;
            if (`${event.title} ${event.notes}`.toLowerCase().includes(q)) {
                results.push({ id: event.id, type: 'event', appId: 'calendar', title: event.title, detail: event.workspaceName });
            }
        }
        res.json({ success: true, results: results.slice(0, 25) });
    });

    // -- Site Permissions --
    router.get('/portal/permissions', async (req, res) => {
        try {
            const permissions = portalDb.getAllPermissions();
            res.json({ success: true, permissions });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.get('/portal/permissions/origin', async (req, res) => {
        try {
            const origin = String(req.query.origin || '').trim();
            if (!origin) return res.status(400).json({ success: false, error: 'origin query parameter required' });
            const permissions = portalDb.getPermissions(origin);
            res.json({ success: true, permissions });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/permissions', async (req, res) => {
        try {
            const { origin, permission, value } = req.body || {};
            if (!origin || !permission || !value) {
                return res.status(400).json({ success: false, error: 'origin, permission, and value required' });
            }
            const updated = portalDb.setPermission(origin, permission, value);
            res.json({ success: true, permissions: updated });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/permissions', async (req, res) => {
        try {
            const origin = String(req.query.origin || req.body?.origin || '').trim();
            if (!origin) return res.status(400).json({ success: false, error: 'origin required' });
            const removed = portalDb.deletePermissions(origin);
            res.json({ success: true, removed });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // -- Downloads --
    router.get('/portal/downloads', async (req, res) => {
        try {
            const downloads = portalDb.getDownloads();
            res.json({ success: true, downloads });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/downloads', async (req, res) => {
        try {
            const { id, filename, url, savePath, totalBytes } = req.body || {};
            if (!id || !filename || !url || !savePath) {
                return res.status(400).json({ success: false, error: 'id, filename, url, and savePath required' });
            }
            const download = portalDb.createDownload({ id, filename, url, savePath, totalBytes });
            res.json({ success: true, download });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.put('/portal/downloads/:id', async (req, res) => {
        try {
            const { receivedBytes, state } = req.body || {};
            if (receivedBytes === undefined) {
                return res.status(400).json({ success: false, error: 'receivedBytes required' });
            }
            const download = portalDb.updateDownloadProgress(req.params.id, receivedBytes, state);
            res.json({ success: true, download });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/downloads/:id/complete', async (req, res) => {
        try {
            const { totalBytes } = req.body || {};
            const download = portalDb.completeDownload(req.params.id, totalBytes);
            res.json({ success: true, download });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/downloads/:id/fail', async (req, res) => {
        try {
            const { errorMessage } = req.body || {};
            const download = portalDb.failDownload(req.params.id, errorMessage);
            res.json({ success: true, download });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/downloads/:id', async (req, res) => {
        try {
            const removed = portalDb.deleteDownload(req.params.id);
            res.json({ success: true, removed });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // -- Credentials --
    router.get('/portal/credentials', requireEnterpriseAuth, async (req, res) => {
        try {
            const { origin } = req.query || {};
            if (origin) {
                const credentials = portalDb.getCredentials(origin);
                res.json({ success: true, credentials });
            } else {
                const credentials = portalDb.getAllCredentials();
                res.json({ success: true, credentials });
            }
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.post('/portal/credentials', requireEnterpriseAuth, async (req, res) => {
        try {
            const { origin, username, password } = req.body || {};
            if (!origin || !username || !password) {
                return res.status(400).json({ success: false, error: 'origin, username, and password required' });
            }
            const credential = portalDb.saveCredential(origin, username, password);
            res.json({ success: true, credential });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.delete('/portal/credentials/:id', requireEnterpriseAuth, async (req, res) => {
        try {
            const removed = portalDb.deleteCredential(req.params.id);
            res.json({ success: true, removed });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // -- Archive Endpoints --
    router.get('/archive/list', async (_req, res) => {
        try {
            const results = [];
            const cwd = process.cwd();
            const archiveDir = path.resolve(cwd, 'data', 'goal-archives');
            const dataDir = path.resolve(cwd, 'data');

            // Scan goal-archives subdirectory
            try {
                const gaFiles = await fs.readdir(archiveDir);
                for (const f of gaFiles) {
                    if (f.endsWith('.json') || f.endsWith('.jsonl') || f.endsWith('.txt') || f.endsWith('.log')) {
                        const st = await fs.stat(path.join(archiveDir, f));
                        results.push({
                            name: `goal-archives/${f}`,
                            category: 'goal-archive',
                            size: st.size,
                            modifiedAt: st.mtime.toISOString()
                        });
                    }
                }
            } catch {}

            // Scan relevant archive ledgers in data root
            try {
                const dataFiles = ['goals-archive.jsonl', 'cost-ledger.json', 'truth-ledger.jsonl', 'self_mod_ledger.jsonl', 'large-council-runs.json', 'gameTheoryStats.json'];
                for (const f of dataFiles) {
                    try {
                        const st = await fs.stat(path.join(dataDir, f));
                        results.push({
                            name: f,
                            category: 'ledger',
                            size: st.size,
                            modifiedAt: st.mtime.toISOString()
                        });
                    } catch {}
                }
            } catch {}

            results.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
            res.json({ success: true, files: results.map(r => r.name), entries: results });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    router.get('/archive/view/*name', async (req, res) => {
        try {
            const rawName = req.params.name || req.params[0];
            if (!rawName) return res.status(400).json({ success: false, error: 'Archive filename required' });
            
            // Prevent directory traversal
            const safeName = path.normalize(rawName).replace(/^(\.\.[\/\\])+/, '');
            const cwd = process.cwd();
            const filePath = path.resolve(cwd, 'data', safeName);

            // Ensure filePath stays within data directory
            if (!filePath.startsWith(path.resolve(cwd, 'data'))) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            const stat = await fs.stat(filePath);
            const MAX_READ = 64 * 1024; // 64 KB preview
            let content = '';
            let truncated = false;

            if (stat.size > MAX_READ) {
                const fh = await fs.open(filePath, 'r');
                const buf = Buffer.alloc(MAX_READ);
                const { bytesRead } = await fh.read(buf, 0, MAX_READ, 0);
                await fh.close();
                content = buf.slice(0, bytesRead).toString('utf8');
                truncated = true;
            } else {
                content = await fs.readFile(filePath, 'utf8');
            }

            res.json({
                success: true,
                name: safeName,
                size: stat.size,
                modifiedAt: stat.mtime.toISOString(),
                truncated,
                content
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    return router;
}
