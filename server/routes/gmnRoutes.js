import express from 'express';
import fs from 'node:fs';
import path from 'path';
import GMNSiteService from '../services/GMNSiteService.js';
import DendriteSearchEngine from '../services/DendriteSearchEngine.js';
import gmnRegistry from '../services/GMNSiteRegistry.js';
import gmnIdentity from '../services/GMNIdentity.js';
import bannedNodes from '../services/GMNBannedNodes.js';
import gmnPinStore from '../services/GMNPinStore.js';
import gmnPeerBook from '../services/GMNPeerBook.js';
import gmnMessaging from '../services/GMNMessaging.js';
import { buildSiteAnnounce, buildReplicaAnnounce } from '../services/GMNAnnounce.js';
import messageBroker from '../../core/MessageBroker.js';

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
    // Peers' sites are held as verified pins (GMNPinStore) and rendered through our
    // own sandbox — we never serve a peer's HTML directly.
    const dendriteSearch = new DendriteSearchEngine({ legacyJsonPath: portalIndexPath });
    const registry = gmnRegistry;
    const NODE_ID = gmnIdentity.getNodeId();

    // Update this node's content-addressed registry row for a local site, then
    // announce it to the mesh so peers' registries learn it exists.
    const registerDomain = (rendered) => {
        if (!rendered?.manifest?.site) return;
        try {
            const b = gmn.bundle(rendered.manifest.site);
            const entry = registry.upsert({
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
            // The gossip layer dedups by (domain,rev,contentHash), so unchanged
            // re-announces (e.g. periodic reindex) cost nothing on the wire.
            try { messageBroker.publish('gmn.site.announce', buildSiteAnnounce(entry)); } catch { /* mesh optional */ }
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

    // Render a domain locally if we host it; otherwise fetch a VERIFIED bundle from the
    // mesh, cache it, and render through our own sandbox. Serves a stale cached copy if
    // the mesh is unreachable (availability) — Batch 4 will formalize pinning/refresh.
    const renderLocalOrRemote = async (domain, requestedPath) => {
        const local = gmn.render(domain, requestedPath);
        if (local) return local;
        const canonical = String(domain).toLowerCase().endsWith('.gmn')
            ? String(domain).toLowerCase() : `${String(domain).toLowerCase()}.gmn`;
        const entry = registry.get(canonical);
        if (!entry || entry.source === 'local') return null;
        if (entry.originNodeId && bannedNodes.isBanned(entry.originNodeId)) return null;
        // Already hold the current revision as a pin? Serve it.
        if (gmnPinStore.has(canonical, entry.contentHash)) {
            const fresh = gmnPinStore.render(canonical, requestedPath);
            if (fresh) return fresh;
        }

        const mesh = globalThis.__gmnMesh;
        if (!mesh?.requestSite) return gmnPinStore.render(canonical, requestedPath) || null;
        const bundle = await mesh.requestSite(canonical);
        if (!bundle) return gmnPinStore.render(canonical, requestedPath) || null; // stale-but-available
        const verdict = gmnPinStore.verifyBundle(bundle);
        if (!verdict.ok || (entry.contentHash && bundle.contentHash !== entry.contentHash)) return null;
        // Browsing a peer's site pins it — popular sites naturally gain replicas.
        gmnPinStore.pin(bundle);
        registry.recordReplica(canonical, bundle.contentHash, NODE_ID);
        try { messageBroker.publish('gmn.replica.announce', buildReplicaAnnounce(canonical, bundle.contentHash)); } catch {}
        return gmnPinStore.render(canonical, requestedPath);
    };

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

    const canonicalDomain = (d) => String(d || '').toLowerCase().endsWith('.gmn') ? String(d).toLowerCase() : `${String(d).toLowerCase()}.gmn`;

    // Replicas this node holds (sites it keeps alive for the network).
    router.get('/pins', (_req, res) => {
        res.json({ success: true, nodeId: NODE_ID, stats: gmnPinStore.stats(), pins: gmnPinStore.list() });
    });

    // Manually pin a remote site: fetch a verified bundle from the mesh and hold it.
    router.post('/pins/:domain', async (req, res) => {
        try {
            const domain = canonicalDomain(req.params.domain);
            const entry = registry.get(domain);
            if (!entry) return res.status(404).json({ success: false, error: 'Unknown site' });
            if (entry.source === 'local') return res.json({ success: true, alreadyLocal: true });
            const mesh = globalThis.__gmnMesh;
            const bundle = await mesh?.requestSite?.(domain);
            if (!bundle) return res.status(502).json({ success: false, error: 'Could not fetch from mesh (no online holder?)' });
            const verdict = gmnPinStore.verifyBundle(bundle);
            if (!verdict.ok || bundle.contentHash !== entry.contentHash) return res.status(409).json({ success: false, error: 'Bundle verification failed' });
            const pin = gmnPinStore.pin(bundle);
            registry.recordReplica(domain, bundle.contentHash, NODE_ID);
            try { messageBroker.publish('gmn.replica.announce', buildReplicaAnnounce(domain, bundle.contentHash)); } catch {}
            res.json({ success: true, pin });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.delete('/pins/:domain', (req, res) => {
        const domain = canonicalDomain(req.params.domain);
        const unpinned = gmnPinStore.unpin(domain);
        registry.removeReplica(domain, NODE_ID);
        res.json({ success: true, unpinned });
    });

    // ── Batch 5: the mesh — connected peers, known addresses, bootstrap ──────────
    router.get('/peers', (_req, res) => {
        const mesh = globalThis.__gmnMesh;
        const connected = mesh
            ? Array.from(mesh.peers.entries()).map(([nodeId, p]) => ({ nodeId, address: p.address, status: p.status, connectedAt: p.connectedAt }))
            : [];
        res.json({ success: true, nodeId: NODE_ID, publicAddress: mesh?.publicAddress || null, connected, known: gmnPeerBook.list() });
    });

    router.get('/network', (_req, res) => {
        const mesh = globalThis.__gmnMesh;
        res.json({
            success: true,
            nodeId: NODE_ID,
            publicAddress: mesh?.publicAddress || null,
            bootstrap: mesh?.bootstrapAddresses || [],
            maxPeers: mesh?.maxPeers || null,
            connectedCount: mesh?.peers?.size || 0,
            knownCount: gmnPeerBook.size(),
        });
    });

    // ── Batch 7: ephemeral E2E direct messages (the secure/Pathways mode of Axis) ──
    router.get('/dm', (_req, res) => {
        res.json({ success: true, nodeId: NODE_ID, threads: gmnMessaging.listThreads() });
    });

    router.get('/dm/:nodeId', (req, res) => {
        res.json({ success: true, peerNodeId: req.params.nodeId, messages: gmnMessaging.getMessages(req.params.nodeId) });
    });

    // Send a sealed message to a peer node. `encPub` (their X25519 key) is required the
    // first time; afterwards we remember it. The mesh routes it toward them.
    router.post('/dm/:nodeId', (req, res) => {
        try {
            const toNodeId = req.params.nodeId;
            const { text, encPub, ttl = 0, viewOnce = false, burnOnReadMs = 0 } = req.body || {};
            if (!text) return res.status(400).json({ success: false, error: 'text required' });
            const recipientEncPub = encPub || gmnMessaging.threads.get(toNodeId)?.peerEncPub;
            if (!recipientEncPub) return res.status(400).json({ success: false, error: 'recipient encPub unknown — pass encPub once' });
            const { message, wire } = gmnMessaging.send(toNodeId, recipientEncPub, text, { ttl, viewOnce, burnOnReadMs });
            const routed = globalThis.__gmnMesh?.routeDM?.(wire) || false;
            res.json({ success: true, message, routed });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    router.post('/dm/:nodeId/open', (req, res) => {
        const r = gmnMessaging.markOpened(req.params.nodeId, req.body?.msgId);
        if (!r) return res.status(404).json({ success: false, error: 'message not found' });
        res.json({ success: true, ...r });
    });

    // Point this node at a known peer; it discovers the rest of the mesh via PEX.
    router.post('/bootstrap', (req, res) => {
        const address = String(req.body?.address || '').trim();
        if (!/^[^\s/]+:\d{2,5}$/.test(address)) return res.status(400).json({ success: false, error: 'address must be host:port' });
        gmnPeerBook.remember(address, { source: 'manual' });
        try { globalThis.__gmnMesh?.connectToPeer?.(address); } catch { /* dial is best-effort */ }
        res.json({ success: true, address, known: gmnPeerBook.size() });
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

    router.post('/sites/publish-artifact', (req, res) => {
        try {
            const { site } = req.body || {};
            if (!site) return res.status(400).json({ success: false, error: 'Site name required' });
            
            const artifactPath = path.resolve(process.cwd(), 'data', 'pulse', 'exports', `${site}.gmn-artifact`);
            
            if (!fs.existsSync(artifactPath)) {
                return res.status(400).json({ success: false, error: 'No signed artifact found from Pulse. Build and Export it in Pulse first.' });
            }

            const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
            
            // Verify Cryptographic Signature using the Node's Ed25519 identity
            const isValid = gmnIdentity.verify(artifact.publicKey, artifact.html, artifact.signature);
            
            if (!isValid) {
                return res.status(403).json({ success: false, error: 'Cryptographic signature invalid! The artifact was modified outside of the Pulse enclave.' });
            }

            // Rule 0 Check: Is this node banned?
            if (bannedNodes.isBanned(artifact.publicKey)) {
                return res.status(403).json({ success: false, error: 'Rule 0 Violation: Your Node Identity has been permanently banned from publishing to Gray Matter Networks.' });
            }

            // Passed Military-Grade Verification - safe to publish to the network
            const resolved = gmn.publish({ 
                site, 
                html: artifact.html, 
                title: site, 
                description: 'Pulse verified artifact' 
            });
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
            
            if (file.mime && file.mime.startsWith('text/html')) {
                const ui = `<div id="gmn-report-btn" style="position:fixed;bottom:20px;right:20px;z-index:999999;background:#ef4444;color:white;padding:8px 16px;border-radius:20px;font-family:sans-serif;font-size:12px;font-weight:bold;cursor:pointer;box-shadow:0 4px 6px -1px rgb(0 0 0/0.1),0 2px 4px -2px rgb(0 0 0/0.1);display:flex;align-items:center;gap:6px;transition:all 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" onclick="fetch('/api/gmn/sites/${domain}/report',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.success){this.innerHTML='✓ Reported';this.style.background='#10b981';this.style.pointerEvents='none';}else{alert(d.error)}})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>Report Site (Rule 0)</div></body>`;
                let contentStr = file.content.toString('utf8');
                contentStr = contentStr.replace(/<\/body>/i, ui);
                res.send(contentStr);
            } else {
                res.send(file.content);
            }
        } catch (error) {
            res.status(400).send(error.message);
        }
    });

    router.post('/sites/:domain/report', (req, res) => {
        try {
            const domain = req.params.domain;
            const { entry, thresholdCrossed } = registry.reportSite(domain);
            
            if (!entry) {
                return res.status(404).json({ success: false, error: 'Site not found in registry' });
            }

            if (thresholdCrossed) {
                // Rule 0 Triggered: Site hit 5 reports. Drop a goal on the QuadBrain Autonomous Ledger!
                messageBroker.publish('soma.goal.create', {
                    title: `[Rule 0 Governance] Investigate GMN Site: ${domain}`,
                    intent: `The GMN site '${domain}' has received 5 community reports for potentially violating Rule 0. Fetch the source code, analyze it for fraud or predatory behavior. If guilty, permanently ban the creator's Cryptographic Node ID to execute AI justice.`,
                    priority: 'high'
                });
            }

            res.json({ success: true, reports: entry.reports, thresholdCrossed });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
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

    router.get(/^\/render\/([^/]+)(?:\/(.*))?$/, async (req, res) => {
        try {
            const domain = req.params[0];
            const requestedPath = req.params[1] ? `/${req.params[1]}` : '/index.html';
            const rendered = await renderLocalOrRemote(domain, requestedPath);
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
