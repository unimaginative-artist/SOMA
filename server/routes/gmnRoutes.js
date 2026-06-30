import express from 'express';
import path from 'path';
import GMNSiteService from '../services/GMNSiteService.js';
import DendriteSearchEngine from '../services/DendriteSearchEngine.js';
import GMNSiteRegistry from '../services/GMNSiteRegistry.js';
import gmnIdentity from '../services/GMNIdentity.js';

const portalIndexPath = path.resolve(process.cwd(), 'data', 'aperture', 'portal-index.json');

const GMN_TEMPLATES = [
    { id: 'blank', label: 'Blank', description: 'Minimal secure GMN construct.' },
    { id: 'blog', label: 'Simple Blog', description: 'A clean local writing space.' },
    { id: 'docs', label: 'Docs', description: 'A structured local documentation site.' },
    { id: 'dashboard', label: 'Dashboard', description: 'A compact status page.' }
];

function pageForDendrite(rendered) {
    return {
        id: `gmn-${rendered.canonical}`,
        url: `gmn://${rendered.canonical}`,
        title: rendered.manifest.title || rendered.canonical,
        content: rendered.text || rendered.content?.toString('utf8') || '',
        source: 'gmn:site',
        hash: rendered.contentHash,
        metadata: {
            domain: rendered.domain,
            canonical: rendered.canonical,
            constructType: rendered.constructType,
            source: rendered.source,
            entry: rendered.entry
        },
        indexedAt: new Date().toISOString()
    };
}

export default function createGmnRoutes(_system = {}) {
    const router = express.Router();
    const gmn = new GMNSiteService();
    const dendriteSearch = new DendriteSearchEngine({ legacyJsonPath: portalIndexPath });
    const registry = new GMNSiteRegistry();
    const NODE_ID = gmnIdentity.getNodeId();

    // Update this node's content-addressed registry row for a local site.
    const registerDomain = (rendered) => {
        if (!rendered?.manifest?.site) return;
        try {
            const b = gmn.bundle(rendered.manifest.site);
            registry.upsert({
                domain: rendered.canonical,
                site: rendered.manifest.site,
                originNodeId: NODE_ID,
                contentHash: b.contentHash,
                title: rendered.manifest.title || rendered.manifest.site,
                summary: String(rendered.text || rendered.manifest.description || '').slice(0, 200),
                bytes: b.bytes,
                fileCount: b.fileCount,
                replicas: [NODE_ID],
                source: 'local',
            });
        } catch { /* registry update is best-effort */ }
    };

    const indexDomain = (domain) => {
        const rendered = gmn.render(domain);
        if (rendered?.mime?.startsWith('text/html')) {
            dendriteSearch.indexPage(pageForDendrite(rendered));
            registerDomain(rendered);
        }
        return rendered;
    };

    for (const site of gmn.listSites()) {
        try { indexDomain(site.canonical); } catch {}
    }
    // Reconcile the registry with sites actually on disk (authoritative local rows).
    try { registry.reconcileLocal(gmn, NODE_ID); } catch {}

    const reindexAllSites = () => {
        let indexed = 0;
        for (const site of gmn.listSites()) {
            try {
                if (indexDomain(site.canonical)) indexed += 1;
            } catch {}
        }
        return indexed;
    };

    if (!globalThis.__somaGmnReindexInterval) {
        globalThis.__somaGmnReindexInterval = setInterval(reindexAllSites, 15 * 60 * 1000);
        globalThis.__somaGmnReindexInterval.unref?.();
    }

    router.get('/sites', (_req, res) => {
        res.json({ success: true, sites: gmn.listSites() });
    });

    router.get('/templates', (_req, res) => {
        res.json({ success: true, templates: GMN_TEMPLATES, constructType: 'portal:construct:gmn-template' });
    });

    // This node's stable network identity.
    router.get('/node', (_req, res) => {
        res.json({ success: true, ...gmnIdentity.describe() });
    });

    // The content-addressed registry of every GMN site this node knows about.
    router.get('/registry', (_req, res) => {
        res.json({ success: true, nodeId: NODE_ID, stats: registry.stats(), entries: registry.list() });
    });

    router.get('/registry/:domain', (req, res) => {
        const entry = registry.get(req.params.domain.endsWith('.gmn') ? req.params.domain : `${req.params.domain}.gmn`);
        if (!entry) return res.status(404).json({ success: false, error: 'Not in registry' });
        res.json({ success: true, entry });
    });

    // The verifiable content address (bundle manifest) of a local site.
    router.get('/sites/:site/bundle', (req, res) => {
        try {
            res.json({ success: true, nodeId: NODE_ID, ...gmn.bundle(req.params.site) });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.post('/sites/reindex-all', (_req, res) => {
        const indexed = reindexAllSites();
        res.json({ success: true, indexed, intervalMs: 15 * 60 * 1000 });
    });

    router.get('/resolve/:domain', (req, res) => {
        const resolved = gmn.resolve(req.params.domain);
        if (!resolved) return res.status(404).json({ success: false, error: 'GMN site not found or invalid domain' });
        res.json({ success: true, ...resolved });
    });

    router.post('/sites/publish', (req, res) => {
        try {
            const { site, html, assets, title, description } = req.body || {};
            const resolved = gmn.publish({ site, html, assets, title, description });
            indexDomain(resolved.canonical);
            res.json({ success: true, ...resolved });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.get(/^\/site\/([^/]+)(?:\/(.*))?$/, (req, res) => {
        try {
            const domain = req.params[0];
            const requestedPath = req.params[1] ? `/${req.params[1]}` : '/index.html';
            const file = gmn.readFile(domain, requestedPath);
            if (!file) return res.status(404).send('GMN file not found');
            res.setHeader('X-GMN-Domain', file.canonical);
            res.setHeader('X-GMN-Source', file.source);
            res.type(file.mime);
            res.send(file.content);
        } catch (error) {
            res.status(400).send(error.message);
        }
    });

    router.get('/sites/:site/source', (req, res) => {
        try {
            const html = gmn.getSourceHtml(req.params.site);
            if (html === null) return res.status(404).json({ success: false, error: 'GMN site not found' });
            const resolved = gmn.resolve(`${req.params.site}.gmn`) || gmn.resolve(req.params.site);
            res.json({
                success: true,
                html,
                manifest: resolved?.manifest || null,
                files: gmn.listFiles(req.params.site),
                stats: gmn.packageStats(req.params.site),
                versions: gmn.listVersions(req.params.site)
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.get('/sites/:site/files', (req, res) => {
        try {
            const resolved = gmn.resolve(`${req.params.site}.gmn`) || gmn.resolve(req.params.site);
            if (!resolved) return res.status(404).json({ success: false, error: 'GMN site not found' });
            res.json({
                success: true,
                manifest: resolved.manifest,
                files: gmn.listFiles(req.params.site),
                stats: gmn.packageStats(req.params.site),
                versions: gmn.listVersions(req.params.site)
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.get('/sites/:site/file', (req, res) => {
        try {
            const file = gmn.readSourceFile(req.params.site, req.query.path || '/index.html');
            if (!file) return res.status(404).json({ success: false, error: 'GMN file not found' });
            res.json({ success: true, file });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.put('/sites/:site/file', (req, res) => {
        try {
            const { path: filePath = '/index.html', content = '' } = req.body || {};
            const file = gmn.writeSourceFile(req.params.site, filePath, content);
            const resolved = gmn.resolve(`${req.params.site}.gmn`) || gmn.resolve(req.params.site);
            indexDomain(resolved.canonical);
            res.json({
                success: true,
                file,
                manifest: resolved.manifest,
                files: gmn.listFiles(req.params.site),
                stats: gmn.packageStats(req.params.site),
                versions: gmn.listVersions(req.params.site)
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.delete('/sites/:site/file', (req, res) => {
        try {
            const result = gmn.deleteSourceFile(req.params.site, req.query.path || req.body?.path);
            const resolved = gmn.resolve(`${req.params.site}.gmn`) || gmn.resolve(req.params.site);
            indexDomain(resolved.canonical);
            res.json({
                success: true,
                ...result,
                manifest: resolved.manifest,
                files: gmn.listFiles(req.params.site),
                stats: gmn.packageStats(req.params.site),
                versions: gmn.listVersions(req.params.site)
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.patch('/sites/:site/metadata', (req, res) => {
        try {
            const resolved = gmn.updateMetadata(req.params.site, req.body || {});
            indexDomain(resolved.canonical);
            res.json({ success: true, ...resolved });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.post('/sites/:site/versions', (req, res) => {
        try {
            const version = gmn.createVersion(req.params.site, req.body?.label || 'manual');
            res.json({ success: true, version, versions: gmn.listVersions(req.params.site) });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.post('/sites/:site/versions/:version/restore', (req, res) => {
        try {
            const resolved = gmn.restoreVersion(req.params.site, req.params.version);
            indexDomain(resolved.canonical);
            res.json({ success: true, ...resolved, versions: gmn.listVersions(req.params.site) });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.get('/sites/:site/export', async (req, res) => {
        try {
            const cleanName = String(req.params.site || '').replace(/\.gmn$/i, '');
            const zip = await gmn.exportZip(req.params.site);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${cleanName}.gmn.zip"`);
            res.send(zip);
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.post('/sites/import', async (req, res) => {
        try {
            const { site, zipBase64 } = req.body || {};
            if (!zipBase64) return res.status(400).json({ success: false, error: 'zipBase64 required' });
            const resolved = await gmn.importZip(Buffer.from(zipBase64, 'base64'), site);
            indexDomain(resolved.canonical);
            res.json({ success: true, ...resolved });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.post('/sites/:site/reindex', (req, res) => {
        try {
            const rendered = indexDomain(`${req.params.site}.gmn`);
            if (!rendered) return res.status(404).json({ success: false, error: 'GMN site not found' });
            res.json({ success: true, indexed: rendered.canonical, hash: rendered.contentHash });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.post('/sites/:site/repair-security', (req, res) => {
        try {
            const resolved = gmn.repairSecurity(req.params.site);
            indexDomain(resolved.canonical);
            res.json({ success: true, ...resolved });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.delete('/sites/:site', (req, res) => {
        try {
            const result = gmn.deleteSite(req.params.site);
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.get(/^\/render\/([^/]+)(?:\/(.*))?$/, (req, res) => {
        try {
            const domain = req.params[0];
            const requestedPath = req.params[1] ? `/${req.params[1]}` : '/index.html';
            const rendered = gmn.render(domain, requestedPath);
            if (!rendered) return res.status(404).json({ success: false, error: 'GMN site not found' });
            if (!rendered.mime.startsWith('text/html')) return res.status(415).json({ success: false, error: 'GMN render only supports HTML entries' });
            dendriteSearch.indexPage(pageForDendrite(rendered));
            res.json({
                success: true,
                domain: rendered.domain,
                canonical: rendered.canonical,
                type: rendered.type,
                constructType: rendered.constructType,
                source: rendered.source,
                manifest: rendered.manifest,
                entry: rendered.entry,
                path: rendered.path,
                html: rendered.content.toString('utf8'),
                text: rendered.text,
                hash: rendered.contentHash
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.post('/generate-site', async (req, res) => {
        const { brief, name, siteName, type } = req.body || {};
        if (!brief && !name) return res.status(400).json({ success: false, error: 'brief or name required' });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const send = (stage, status, data = {}) => {
            try { res.write(`data: ${JSON.stringify({ stage, status, ...data, ts: Date.now() })}\n\n`); } catch {}
        };

        const cleanName = String(siteName || name || 'my-site')
            .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'my-site';

        const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        const fallback = (n, b) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(n)}</title><style>:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0b0f16;color:#eef2ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0%,rgba(139,92,246,.35),transparent 30%),#0b0f16}header{padding:64px min(8vw,96px);border-bottom:1px solid rgba(255,255,255,.08)}h1{margin:0 0 12px;font-size:clamp(36px,6vw,72px);line-height:1}p{color:#94a3b8;line-height:1.7;max-width:620px;font-size:16px}main{padding:40px min(8vw,96px) 80px}footer{padding:24px min(8vw,96px);border-top:1px solid rgba(255,255,255,.07);color:#64748b;font-size:12px}</style></head><body><header><div style="color:#a78bfa;font-size:11px;text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-bottom:12px">GMN ·  ${esc(cleanName)}.gmn</div><h1>${esc(n)}</h1><p>${esc((b || '').slice(0, 220) || 'A site on the Gray Matter Network.')}</p></header><main><p>This site is hosted on your personal SOMA instance. Open it in Portal to browse or edit.</p></main><footer>Hosted on the Gray Matter Network &middot; ${esc(cleanName)}.gmn</footer></body></html>`;

        send('generating', 'running', { message: 'Designing your GMN site…' });

        const brain = _system.quadBrain;
        if (!brain?.reason) {
            send('complete', 'done', { html: fallback(name || cleanName, brief), siteName: cleanName, fallback: true });
            res.end();
            return;
        }

        const prompt = `You are generating a complete, self-contained HTML website for the Gray Matter Network (GMN) — a local-first, peer-hosted personal web where each SOMA instance hosts sites for its owner.

Site name: ${name || cleanName}
Site address: ${cleanName}.gmn
Type: ${type || 'personal'}
Brief: ${brief}

CRITICAL GMN SANDBOX RULES — any violation causes the site to refuse to render:
- NO external scripts: no <script src="...">, no CDN URLs anywhere (no Google Fonts, no Bootstrap, no Vue, no React, no jQuery)
- NO external stylesheets: no <link rel="stylesheet" href="http...">
- NO network calls: no fetch(), no XMLHttpRequest, no WebSocket, no navigator.sendBeacon
- ALL CSS must be inside a single <style> tag in <head>
- ALL JavaScript must be inline <script> tags — no ES modules, no import, no require
- Images: use inline SVG, CSS shapes/gradients, or emoji — never <img src="http...">
- The file must be complete, valid HTML from <!doctype html> to </html>

Design requirements:
- Dark theme: background #0b0f16, primary text #eef2ff, muted #94a3b8
- Accent palette: purple #8b5cf6, teal #22d3ee, green #10b981
- Font: Inter, ui-sans-serif, system-ui, sans-serif (system fonts only — no Google Fonts)
- Fully responsive: CSS Grid/Flexbox, mobile-first, breakpoints for ≤768px
- Real, purposeful content that directly reflects the brief — no generic lorem ipsum
- Clear visual hierarchy: hero section → main content → footer at minimum
- Polished micro-details: hover states, smooth transitions, subtle shadows

Output ONLY the HTML. No explanation. No markdown code fences. Start with <!doctype html> and end with </html>.`;

        try {
            const result = await Promise.race([
                brain.reason(prompt, { sessionId: 'gmn-site-gen', quickResponse: false, temperature: 0.7 }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000))
            ]);

            let html = result?.text || result?.response || '';
            html = html.replace(/^```html?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

            if (!html.toLowerCase().startsWith('<!doctype') && !html.toLowerCase().startsWith('<html')) {
                const m = html.match(/(<!doctype[\s\S]*)/i);
                html = m ? m[1] : fallback(name || cleanName, brief);
            }

            send('complete', 'done', { html, siteName: cleanName });
        } catch (err) {
            send('complete', 'done', { html: fallback(name || cleanName, brief), siteName: cleanName, fallback: true, error: err.message });
        } finally {
            res.end();
        }
    });

    return router;
}
