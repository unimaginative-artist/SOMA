import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import JSZip from 'jszip';

const DEFAULT_ROOT = path.resolve(process.cwd(), 'data', 'gmn', 'sites');
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;

function safeSecurityDefaults() {
    return {
        externalScripts: false,
        inlineEval: false,
        sandboxIframe: true,
        sameSiteAssetsOnly: true,
        allowForms: false,
        allowCookies: false,
        allowLocalStorage: false,
        maxPackageBytes: MAX_PACKAGE_BYTES
    };
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function hash(value = '') {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Deterministic JSON with sorted keys — so the same logical object always serializes
// byte-for-byte identically, on any node. The backbone of stable content addressing.
function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

const PORTAL_BRIDGE_BODY = `(function(){document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h)return;var g=/(?:^gmn:\\/\\/|\\b[a-z0-9][a-z0-9-]*\\.gmn(?:\\/|$))/.test(h);if(g){e.preventDefault();window.top.postMessage({type:'gmn-navigate',href:h},'*');}else if(/^https?:\\/\\//.test(h)){e.preventDefault();window.top.postMessage({type:'portal-navigate',href:h},'*');}},true);})();`;

function injectPortalBridge(html, nonce) {
    const tag = `<script nonce="${nonce}">${PORTAL_BRIDGE_BODY}</script>`;
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`);
    return `${html}${tag}`;
}

function siteFromDomain(domain = '') {
    const value = String(domain || '').trim().toLowerCase();
    const match = value.match(/^(?:portal\.)?([a-z0-9][a-z0-9-]{1,62})\.gmn$/);
    return match?.[1] || null;
}

function siteFromName(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    return siteFromDomain(raw) || siteFromDomain(`${raw}.gmn`);
}

function safeRelativePath(value = '/index.html') {
    const normalized = `/${String(value || '/index.html').replace(/\\/g, '/')}`.replace(/\/+/g, '/');
    const clean = path.posix.normalize(normalized);
    if (clean.includes('..')) return null;
    if (clean === '/') return '/index.html';
    return clean;
}

function textFromHtml(html = '') {
    return String(html)
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isEditableFile(filePath = '') {
    const ext = path.extname(filePath).toLowerCase();
    return ['.html', '.css', '.js', '.json', '.md', '.txt', '.svg'].includes(ext);
}

function mimeForPath(filePath = '') {
    const ext = path.extname(filePath).toLowerCase();
    return {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.md': 'text/markdown; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8'
    }[ext] || 'application/octet-stream';
}

function versionStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function sanitizeHtml(html = '', manifest = {}, nonce = null) {
    let safe = String(html || '');
    const allowForms = manifest.security?.allowForms === true;

    safe = safe.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    safe = safe.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
    safe = safe.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
    safe = safe.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
    safe = safe.replace(/\b(eval|Function|setTimeout|setInterval)\s*\(/gi, 'blocked_$1(');

    if (!allowForms) {
        safe = safe.replace(/<form\b[^>]*>/gi, '<div data-gmn-blocked-form="true">');
        safe = safe.replace(/<\/form>/gi, '</div>');
        safe = safe.replace(/<(input|textarea|select|button)\b[^>]*>/gi, '');
    }

    const scriptSrc = nonce ? ` script-src 'nonce-${nonce}';` : '';
    const cspContent = `default-src 'none';${scriptSrc} img-src data: blob:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';`;
    const cspTag = `<meta http-equiv="Content-Security-Policy" content="${cspContent}">`;
    const existingCsp = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i;
    if (existingCsp.test(safe)) {
        safe = safe.replace(existingCsp, cspTag);
    } else {
        safe = safe.replace(/<head\b[^>]*>/i, match => `${match}\n${cspTag}`);
    }

    return safe;
}

export class GMNSiteService {
    constructor(options = {}) {
        this.root = options.root || DEFAULT_ROOT;
        ensureDir(this.root);
        this.seedDefaultSite();
    }

    validateDomain(domain) {
        const site = siteFromDomain(domain);
        if (!site) return null;
        return { site, canonical: `${site}.gmn`, portal: `portal.${site}.gmn` };
    }

    siteDir(site) {
        return path.join(this.root, site);
    }

    resolvePath(site, relativePath = '/index.html') {
        const safePath = safeRelativePath(relativePath);
        if (!safePath) throw new Error('Invalid GMN path');
        const root = path.resolve(this.siteDir(site));
        const target = path.resolve(root, `.${safePath}`);
        if (!target.startsWith(root + path.sep) && target !== root) throw new Error('Path traversal blocked');
        return { safePath, target };
    }

    manifestPath(site) {
        return path.join(this.siteDir(site), 'manifest.gmn.json');
    }

    constructPath(site) {
        return path.join(this.siteDir(site), 'construct.manifest.json');
    }

    readManifest(site) {
        const manifestFile = this.manifestPath(site);
        if (!fs.existsSync(manifestFile)) return null;
        return JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    }

    resolve(domain) {
        const parsed = this.validateDomain(domain);
        if (!parsed) return null;
        const manifest = this.readManifest(parsed.site);
        if (!manifest) return null;
        return {
            domain: String(domain).toLowerCase(),
            canonical: parsed.canonical,
            aliases: [parsed.portal],
            type: 'gmn:site',
            constructType: 'portal:construct:gmn-site',
            source: 'local',
            manifest,
            entry: manifest.entry || '/index.html'
        };
    }

    listSites() {
        if (!fs.existsSync(this.root)) return [];
        return fs.readdirSync(this.root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => this.resolve(`${entry.name}.gmn`))
            .filter(Boolean);
    }

    readFile(domain, relativePath = '/index.html') {
        const resolved = this.resolve(domain);
        if (!resolved) return null;
        const { safePath, target } = this.resolvePath(resolved.manifest.site, relativePath || resolved.entry);
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return null;
        const stat = fs.statSync(target);
        if (stat.size > MAX_PACKAGE_BYTES) throw new Error('GMN file exceeds package size limit');
        const content = fs.readFileSync(target);
        const mime = mimeForPath(target);

        return { ...resolved, path: safePath, filePath: target, content, mime, size: stat.size };
    }

    render(domain, relativePath = '/index.html') {
        const file = this.readFile(domain, relativePath);
        if (!file) return null;
        if (!file.mime.startsWith('text/html')) return file;
        const rawHtml = file.content.toString('utf8');
        const html = this.inlineSameSiteAssets(rawHtml, file.manifest.site);
        const nonce = crypto.randomBytes(16).toString('base64');
        const sanitizedHtml = sanitizeHtml(html, file.manifest, nonce);
        const bridgedHtml = injectPortalBridge(sanitizedHtml, nonce);
        return {
            ...file,
            content: Buffer.from(bridgedHtml, 'utf8'),
            text: textFromHtml(bridgedHtml),
            contentHash: hash(bridgedHtml)
        };
    }

    /**
     * Content-address a whole site as a verifiable bundle.
     *
     * The hash is a Merkle-style root over (a) every content file's sha256 and
     * (b) a NORMALIZED metadata core — deliberately excluding volatile fields like
     * `updatedAt` and the raw manifest files, so two nodes holding byte-identical
     * site content compute the SAME contentHash regardless of timestamps. That hash
     * is the site's true network address and the basis for replication + verification.
     */
    bundle(site) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const manifest = this.readManifest(cleanSite);
        if (!manifest) throw new Error('GMN site not found');

        const PROTECTED = new Set(['/manifest.gmn.json', '/construct.manifest.json']);
        const files = this.listFiles(cleanSite) // already excludes versions/
            .filter(file => !PROTECTED.has(file.path))
            .map(file => {
                const { target } = this.resolvePath(cleanSite, file.path);
                const buffer = fs.readFileSync(target);
                return { path: file.path, size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
            })
            .sort((a, b) => a.path.localeCompare(b.path));

        // Only the meaningful, stable metadata participates in the content address.
        const meta = {
            site: cleanSite,
            entry: manifest.entry || '/index.html',
            title: manifest.title || cleanSite,
            description: manifest.description || '',
            security: manifest.security || safeSecurityDefaults(),
        };

        const bundleManifest = { v: 1, meta, files };
        const root = crypto.createHash('sha256').update(stableStringify(bundleManifest)).digest('hex');
        return {
            site: cleanSite,
            // Tag the algorithm version so the scheme can evolve without ambiguity.
            contentHash: `b1:${root}`,
            files,
            meta,
            bytes: files.reduce((total, file) => total + file.size, 0),
            fileCount: files.length,
        };
    }

    repairSecurity(site) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const manifest = this.readManifest(cleanSite);
        if (!manifest) throw new Error('GMN site not found');
        const before = manifest.security || {};
        manifest.security = safeSecurityDefaults();
        manifest.updatedAt = new Date().toISOString();
        fs.writeFileSync(this.manifestPath(cleanSite), JSON.stringify(manifest, null, 2), 'utf8');
        return {
            ...this.resolve(`${cleanSite}.gmn`),
            repaired: Object.fromEntries(Object.entries(manifest.security).map(([key, value]) => [key, { before: before[key], after: value }]))
        };
    }

    inlineSameSiteAssets(html, site) {
        return String(html || '').replace(/<(link|img)\b([^>]*?)\s(?:href|src)=["']([^"']+)["']([^>]*)>/gi, (match, tag, before, assetPath, after) => {
            if (/^(https?:|data:|blob:|\/\/)/i.test(assetPath)) return tag.toLowerCase() === 'img' ? '' : '';
            const safe = safeRelativePath(assetPath);
            if (!safe) return '';
            try {
                const { target } = this.resolvePath(site, safe);
                if (!fs.existsSync(target)) return match;
                const ext = path.extname(target).toLowerCase();
                if (tag.toLowerCase() === 'link' && ext === '.css') {
                    const css = fs.readFileSync(target, 'utf8');
                    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
                }
                if (tag.toLowerCase() === 'img' && ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
                    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[ext];
                    const data = fs.readFileSync(target).toString('base64');
                    return `<img ${before} src="data:${mime};base64,${data}" ${after}>`;
                }
            } catch {
                return '';
            }
            return match;
        });
    }

    publish({ site, html, assets = {}, title = '', description = '' }) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const siteRoot = this.siteDir(cleanSite);
        ensureDir(siteRoot);
        const existingManifest = this.readManifest(cleanSite);
        if (existingManifest) this.createVersion(cleanSite, 'pre-publish');

        const manifest = {
            version: 1,
            site: cleanSite,
            canonical: `${cleanSite}.gmn`,
            aliases: [`portal.${cleanSite}.gmn`],
            type: 'gmn:site',
            constructType: 'portal:construct:gmn-site',
            title: title || cleanSite,
            description,
            entry: '/index.html',
            security: existingManifest?.security || safeSecurityDefaults(),
            updatedAt: new Date().toISOString()
        };
        const construct = {
            version: 1,
            kind: 'portal:construct',
            subtype: 'gmn:site',
            site: cleanSite,
            entry: '/index.html',
            createdAt: manifest.updatedAt,
            updatedAt: manifest.updatedAt
        };

        const sanitized = sanitizeHtml(html || this.defaultHtml(cleanSite), manifest);
        fs.writeFileSync(this.manifestPath(cleanSite), JSON.stringify(manifest, null, 2), 'utf8');
        fs.writeFileSync(this.constructPath(cleanSite), JSON.stringify(construct, null, 2), 'utf8');
        fs.writeFileSync(path.join(siteRoot, 'index.html'), sanitized, 'utf8');

        for (const [assetPath, value] of Object.entries(assets || {})) {
            const safe = safeRelativePath(assetPath);
            if (!safe) continue;
            const { target } = this.resolvePath(cleanSite, safe);
            ensureDir(path.dirname(target));
            fs.writeFileSync(target, String(value), 'utf8');
        }

        return this.resolve(`${cleanSite}.gmn`);
    }

    updateMetadata(site, { title = '', description = '' } = {}) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const manifest = this.readManifest(cleanSite);
        if (!manifest) throw new Error('GMN site not found');
        manifest.title = String(title || manifest.title || cleanSite).slice(0, 160);
        manifest.description = String(description || '').slice(0, 400);
        manifest.updatedAt = new Date().toISOString();
        fs.writeFileSync(this.manifestPath(cleanSite), JSON.stringify(manifest, null, 2), 'utf8');
        const construct = fs.existsSync(this.constructPath(cleanSite))
            ? JSON.parse(fs.readFileSync(this.constructPath(cleanSite), 'utf8'))
            : { version: 1, kind: 'portal:construct', subtype: 'gmn:site', site: cleanSite, entry: '/index.html' };
        construct.updatedAt = manifest.updatedAt;
        fs.writeFileSync(this.constructPath(cleanSite), JSON.stringify(construct, null, 2), 'utf8');
        return this.resolve(`${cleanSite}.gmn`);
    }

    deleteSite(site) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const siteRoot = this.siteDir(cleanSite);
        if (!fs.existsSync(siteRoot)) throw new Error('GMN site not found');
        fs.rmSync(siteRoot, { recursive: true, force: true });
        return { deleted: `${cleanSite}.gmn` };
    }

    getSourceHtml(site) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) return null;
        const indexPath = path.join(this.siteDir(cleanSite), 'index.html');
        if (!fs.existsSync(indexPath)) return null;
        return fs.readFileSync(indexPath, 'utf8');
    }

    packageStats(site) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const siteRoot = this.siteDir(cleanSite);
        if (!fs.existsSync(siteRoot)) throw new Error('GMN site not found');
        let bytes = 0;
        let files = 0;
        const walk = dir => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'versions') continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else {
                    bytes += fs.statSync(full).size;
                    files += 1;
                }
            }
        };
        walk(siteRoot);
        return { bytes, files, maxPackageBytes: MAX_PACKAGE_BYTES };
    }

    listFiles(site) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const siteRoot = this.siteDir(cleanSite);
        if (!fs.existsSync(siteRoot)) throw new Error('GMN site not found');
        const files = [];
        const walk = dir => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'versions') continue;
                const full = path.join(dir, entry.name);
                const rel = `/${path.relative(siteRoot, full).replace(/\\/g, '/')}`;
                if (entry.isDirectory()) {
                    walk(full);
                } else {
                    const stat = fs.statSync(full);
                    files.push({
                        path: rel,
                        size: stat.size,
                        mime: mimeForPath(full),
                        editable: isEditableFile(full),
                        updatedAt: stat.mtime.toISOString(),
                        protected: ['manifest.gmn.json', 'construct.manifest.json'].includes(entry.name)
                    });
                }
            }
        };
        walk(siteRoot);
        return files.sort((a, b) => a.path.localeCompare(b.path));
    }

    readSourceFile(site, relativePath = '/index.html') {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const { safePath, target } = this.resolvePath(cleanSite, relativePath);
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return null;
        if (!isEditableFile(target)) throw new Error('File is not text-editable');
        const stat = fs.statSync(target);
        if (stat.size > MAX_PACKAGE_BYTES) throw new Error('GMN file exceeds package size limit');
        return { path: safePath, content: fs.readFileSync(target, 'utf8'), size: stat.size, mime: mimeForPath(target) };
    }

    writeSourceFile(site, relativePath = '/index.html', content = '') {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const safePath = safeRelativePath(relativePath);
        if (!safePath) throw new Error('Invalid GMN path');
        if (safePath === '/manifest.gmn.json' || safePath === '/construct.manifest.json') throw new Error('Protected manifest files cannot be edited here');
        const { target } = this.resolvePath(cleanSite, safePath);
        if (!isEditableFile(target)) throw new Error('Only text GMN files can be edited here');
        const siteRoot = this.siteDir(cleanSite);
        ensureDir(siteRoot);
        const projectedBytes = this.packageStats(cleanSite).bytes - (fs.existsSync(target) ? fs.statSync(target).size : 0) + Buffer.byteLength(String(content), 'utf8');
        if (projectedBytes > MAX_PACKAGE_BYTES) throw new Error('GMN package size limit exceeded');
        ensureDir(path.dirname(target));
        fs.writeFileSync(target, String(content), 'utf8');
        this.touchManifests(cleanSite);
        return this.readSourceFile(cleanSite, safePath);
    }

    deleteSourceFile(site, relativePath) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const safePath = safeRelativePath(relativePath);
        if (!safePath || safePath === '/index.html') throw new Error('index.html cannot be deleted');
        if (safePath === '/manifest.gmn.json' || safePath === '/construct.manifest.json') throw new Error('Protected manifest files cannot be deleted');
        const { target } = this.resolvePath(cleanSite, safePath);
        if (!fs.existsSync(target)) return { deleted: false };
        fs.rmSync(target, { force: true });
        this.touchManifests(cleanSite);
        return { deleted: true };
    }

    touchManifests(site) {
        const manifest = this.readManifest(site);
        if (!manifest) return;
        manifest.updatedAt = new Date().toISOString();
        fs.writeFileSync(this.manifestPath(site), JSON.stringify(manifest, null, 2), 'utf8');
        if (fs.existsSync(this.constructPath(site))) {
            const construct = JSON.parse(fs.readFileSync(this.constructPath(site), 'utf8'));
            construct.updatedAt = manifest.updatedAt;
            fs.writeFileSync(this.constructPath(site), JSON.stringify(construct, null, 2), 'utf8');
        }
    }

    createVersion(site, label = 'snapshot') {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const siteRoot = this.siteDir(cleanSite);
        if (!fs.existsSync(siteRoot)) return null;
        const id = `${versionStamp()}-${String(label || 'snapshot').replace(/[^a-z0-9-]+/gi, '-').toLowerCase().slice(0, 36)}`;
        const versionRoot = path.join(siteRoot, 'versions', id);
        ensureDir(versionRoot);
        for (const file of this.listFiles(cleanSite)) {
            const { target } = this.resolvePath(cleanSite, file.path);
            const dest = path.join(versionRoot, `.${file.path}`);
            ensureDir(path.dirname(dest));
            fs.copyFileSync(target, dest);
        }
        return { id, createdAt: new Date().toISOString(), label };
    }

    listVersions(site) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const versionsRoot = path.join(this.siteDir(cleanSite), 'versions');
        if (!fs.existsSync(versionsRoot)) return [];
        return fs.readdirSync(versionsRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => {
                const full = path.join(versionsRoot, entry.name);
                return { id: entry.name, createdAt: fs.statSync(full).mtime.toISOString() };
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    restoreVersion(site, versionId) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const safeId = String(versionId || '').replace(/[^a-z0-9T.-]/gi, '');
        const versionRoot = path.resolve(this.siteDir(cleanSite), 'versions', safeId);
        const versionsBase = path.resolve(this.siteDir(cleanSite), 'versions');
        if (!versionRoot.startsWith(versionsBase + path.sep) || !fs.existsSync(versionRoot)) throw new Error('GMN version not found');
        this.createVersion(cleanSite, 'pre-restore');
        const copyBack = dir => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                const rel = path.relative(versionRoot, full);
                const dest = path.join(this.siteDir(cleanSite), rel);
                if (entry.isDirectory()) {
                    ensureDir(dest);
                    copyBack(full);
                } else {
                    ensureDir(path.dirname(dest));
                    fs.copyFileSync(full, dest);
                }
            }
        };
        copyBack(versionRoot);
        this.touchManifests(cleanSite);
        return this.resolve(`${cleanSite}.gmn`);
    }

    async exportZip(site) {
        const cleanSite = siteFromName(site);
        if (!cleanSite) throw new Error('Invalid GMN site name');
        const zip = new JSZip();
        for (const file of this.listFiles(cleanSite)) {
            const { target } = this.resolvePath(cleanSite, file.path);
            zip.file(file.path.replace(/^\//, ''), fs.readFileSync(target));
        }
        return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    }

    async importZip(buffer, siteOverride = '') {
        const zip = await JSZip.loadAsync(buffer);
        const manifestText = zip.file('manifest.gmn.json') ? await zip.file('manifest.gmn.json').async('string') : null;
        const manifest = manifestText ? JSON.parse(manifestText) : {};
        const cleanSite = siteFromName(siteOverride || manifest.site || manifest.canonical || '');
        if (!cleanSite) throw new Error('Imported package needs a valid site name');
        const siteRoot = this.siteDir(cleanSite);
        ensureDir(siteRoot);
        let totalBytes = 0;
        const entries = Object.values(zip.files).filter(file => !file.dir);
        for (const entry of entries) {
            const safe = safeRelativePath(entry.name);
            if (!safe || safe.includes('/versions/')) continue;
            let data = await entry.async('nodebuffer');
            if (safe === '/manifest.gmn.json') {
                const importedManifest = JSON.parse(data.toString('utf8'));
                data = Buffer.from(JSON.stringify({
                    ...importedManifest,
                    site: cleanSite,
                    canonical: `${cleanSite}.gmn`,
                    aliases: [`portal.${cleanSite}.gmn`],
                    security: safeSecurityDefaults(),
                    updatedAt: new Date().toISOString()
                }, null, 2), 'utf8');
            }
            if (safe === '/construct.manifest.json') {
                const importedConstruct = JSON.parse(data.toString('utf8'));
                data = Buffer.from(JSON.stringify({
                    ...importedConstruct,
                    site: cleanSite,
                    entry: importedConstruct.entry || '/index.html',
                    updatedAt: new Date().toISOString()
                }, null, 2), 'utf8');
            }
            totalBytes += data.length;
            if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('Imported GMN package exceeds size limit');
            const { target } = this.resolvePath(cleanSite, safe);
            ensureDir(path.dirname(target));
            fs.writeFileSync(target, data);
        }
        const resolved = this.readManifest(cleanSite)
            ? this.updateMetadata(cleanSite, { title: manifest.title || cleanSite, description: manifest.description || '' })
            : this.publish({ site: cleanSite, html: this.getSourceHtml(cleanSite) || this.defaultHtml(cleanSite), title: manifest.title || cleanSite, description: manifest.description || '' });
        return resolved;
    }

    seedDefaultSite() {
        const site = 'barry';
        if (this.readManifest(site)) return;
        this.publish({
            site,
            title: 'Barry GMN',
            description: 'Local proof site for the SOMA Gray Matter Network.',
            html: this.defaultHtml(site)
        });
    }

    defaultHtml(site) {
        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${site}.gmn</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% 20%, rgba(147, 51, 234, .34), transparent 34%), #0d1015; color: #eef2ff; }
    main { width: min(760px, calc(100% - 48px)); border: 1px solid rgba(255,255,255,.12); border-radius: 18px; padding: 42px; background: rgba(12,16,24,.72); box-shadow: 0 24px 80px rgba(0,0,0,.38); }
    .neuron { width: 74px; height: 74px; border-radius: 50%; background: radial-gradient(circle, #f0abfc, #7c3aed 58%, #312e81); box-shadow: 0 0 34px rgba(168,85,247,.55); margin-bottom: 22px; }
    h1 { margin: 0 0 12px; font-size: 34px; font-weight: 650; letter-spacing: 0; }
    p { color: #cbd5e1; line-height: 1.7; font-size: 15px; }
    code { color: #d8b4fe; }
  </style>
</head>
<body>
  <main>
    <div class="neuron"></div>
    <h1>${site}.gmn</h1>
    <p>This is a local Gray Matter Network site rendered by Portal. It is a <code>portal:construct:gmn-site</code>, sandboxed, searchable by Dendrite Search, and resolved outside public DNS.</p>
  </main>
</body>
</html>`;
    }
}

export default GMNSiteService;
