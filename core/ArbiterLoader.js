// ═══════════════════════════════════════════════════════════════════════════
// ArbiterLoader.js — On-Demand Arbiter Loading (Lazy Capability Expansion)
//
// SOMA has 169 arbiter files. ~75 load at boot. The other ~94 sit unused.
// This module gives SOMA the ability to load any of them on demand when she
// needs a capability that nothing currently loaded provides.
//
// Flow:
//   Something needs capability 'MODIFY_CODE'
//   → check MessageBroker: already loaded? → return it
//   → check manifest: which file has that capability?
//   → dynamic import() the file
//   → instantiate + initialize with standard deps
//   → register with MessageBroker
//   → mark manifest entry as verified
//   → return the live instance
//
// Failures are recorded permanently so SOMA doesn't retry broken arbiters.
// New .js files added to arbiters/ are auto-discovered on next manifest build.
//
// Manifest lives at: server/.soma/arbiter-manifest.json
// ═══════════════════════════════════════════════════════════════════════════

import fs        from 'fs/promises';
import path      from 'path';
import { createRequire } from 'module';
import { fileURLToPath }  from 'url';

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const ARBITERS_DIR    = path.join(__dirname, '..', 'arbiters');
const MANIFEST_FILE   = path.join(__dirname, '..', 'server', '.soma', 'arbiter-manifest.json');

// Standard deps injected into every lazily-loaded arbiter
const STD_DEPS = ['quadBrain', 'mnemonicArbiter', 'messageBroker', 'rootPath', 'goalPlanner', 'system'];

export class ArbiterLoader {
    constructor({ system, messageBroker } = {}) {
        this.system        = system        || {};
        this.messageBroker = messageBroker || null;
        this._manifest     = {};           // capability → [{ file, cls, lobe, role, status, error }]
        this._loading      = new Map();    // file → Promise (dedupe concurrent loads)
        this._require      = createRequire(import.meta.url);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    async initialize() {
        await this._loadManifest();
        // Rebuild in background — picks up new files, doesn't block boot
        this._buildManifest().catch(err =>
            console.warn('[ArbiterLoader] Manifest build error:', err.message)
        );
        const total = Object.keys(this._manifest).length;
        console.log(`[ArbiterLoader] 📚 Arbiter inventory: ${total} capabilities mapped`);
        return this;
    }

    // ── Public API ───────────────────────────────────────────────────────

    /**
     * Load an arbiter that provides the given capability.
     * Returns live instance or null if unavailable / failed.
     */
    async loadForCapability(capability, extraDeps = {}) {
        // 1. Already loaded in broker?
        if (this.messageBroker) {
            const loaded = this.messageBroker.getArbitersByCapability?.(capability) || [];
            // getArbitersByCapability returns arbiter metadata objects — find one with an instance
            for (const meta of loaded) {
                if (meta.instance) return meta.instance;
            }
        }

        // 2. Find manifest entry
        const entries = this._manifest[capability] || [];
        const entry   = entries.find(e => e.status !== 'failed');
        if (!entry) {
            console.warn(`[ArbiterLoader] No arbiter found for capability: ${capability}`);
            return null;
        }

        return this._loadEntry(entry, extraDeps);
    }

    /**
     * Load a specific arbiter by file name (e.g. 'KevinArbiter.js').
     * Useful when you know exactly what you want.
     */
    async loadByFile(filename, extraDeps = {}) {
        if (this.messageBroker) {
            const name = filename.replace(/\.(js|cjs)$/, '');
            const existing = this.messageBroker.getArbiter?.(name);
            if (existing?.instance) return existing.instance;
        }

        // Find any entry for this file
        for (const entries of Object.values(this._manifest)) {
            const entry = entries.find(e => e.file === filename);
            if (entry) return this._loadEntry(entry, extraDeps);
        }

        // File not in manifest yet — try to load directly
        const entry = await this._scanFile(filename);
        if (entry) return this._loadEntry(entry, extraDeps);

        return null;
    }

    /**
     * Return the full inventory: every capability and what can provide it.
     * Used by SOMA to know what she's capable of (loaded or loadable).
     */
    getInventory() {
        const result = {};
        for (const [cap, entries] of Object.entries(this._manifest)) {
            result[cap] = entries.map(e => ({
                file:   e.file,
                cls:    e.cls,
                status: e.status || 'available',
                error:  e.error  || null,
            }));
        }
        return result;
    }

    /**
     * Force a manifest rebuild — useful after adding new arbiter files.
     */
    async rebuildManifest() {
        await this._buildManifest();
        return Object.keys(this._manifest).length;
    }

    // ── Internal: Loading ────────────────────────────────────────────────

    async _loadEntry(entry, extraDeps = {}) {
        // Dedupe: if already in-flight, wait for that promise
        if (this._loading.has(entry.file)) {
            return this._loading.get(entry.file);
        }

        const promise = this._doLoad(entry, extraDeps);
        this._loading.set(entry.file, promise);
        promise.finally(() => this._loading.delete(entry.file));
        return promise;
    }

    async _doLoad(entry, extraDeps = {}) {
        const filePath = path.join(ARBITERS_DIR, entry.file);

        try {
            console.log(`[ArbiterLoader] 🔌 Lazy-loading ${entry.file} (${entry.cls})...`);

            // Dynamic import — works for .js ESM files
            let Cls;
            if (entry.file.endsWith('.cjs')) {
                const mod = this._require(filePath);
                Cls = mod[entry.cls] || mod.default || mod;
            } else {
                const mod = await import(filePath + `?t=${Date.now()}`); // cache-bust
                Cls = mod[entry.cls] || mod.default;
            }

            if (!Cls || typeof Cls !== 'function') {
                throw new Error(`Could not find class "${entry.cls}" in ${entry.file}`);
            }

            // Build deps from system + extras
            const deps = this._buildDeps(extraDeps);

            // Instantiate
            const instance = new Cls({ name: entry.cls, ...deps });

            // Initialize (try both patterns)
            if (typeof instance.initialize === 'function') {
                await instance.initialize();
            } else if (typeof instance.onInitialize === 'function') {
                await instance.onInitialize();
            }

            // Register with MessageBroker so future getArbitersByCapability() finds it
            if (this.messageBroker?.registerArbiter) {
                this.messageBroker.registerArbiter(instance.name || entry.cls, {
                    instance,
                    capabilities: Object.values(this._manifest)
                        .flat()
                        .filter(e => e.file === entry.file)
                        .reduce((caps, e) => {
                            if (e.capabilities) caps.push(...e.capabilities);
                            return caps;
                        }, []),
                    lobe: entry.lobe || null,
                    role: entry.role || null,
                    loadedBy: 'ArbiterLoader',
                });
            }

            // Mark as verified in manifest
            entry.status = 'verified';
            delete entry.error;
            this._saveManifest().catch(() => {});

            console.log(`[ArbiterLoader] ✅ ${entry.cls} loaded and registered`);
            return instance;

        } catch (err) {
            console.warn(`[ArbiterLoader] ❌ Failed to load ${entry.file}: ${err.message}`);
            entry.status = 'failed';
            entry.error  = err.message;
            this._saveManifest().catch(() => {});
            return null;
        }
    }

    _buildDeps(extras = {}) {
        const deps = {};
        for (const key of STD_DEPS) {
            if (this.system[key] !== undefined) deps[key] = this.system[key];
        }
        // system itself
        deps.system       = this.system;
        deps.messageBroker = this.messageBroker || this.system.messageBroker;
        deps.rootPath     = this.system.rootPath || process.cwd();
        return { ...deps, ...extras };
    }

    // ── Internal: Manifest ───────────────────────────────────────────────

    async _loadManifest() {
        try {
            const raw = await fs.readFile(MANIFEST_FILE, 'utf8').catch(() => '{}');
            this._manifest = JSON.parse(raw);
            if (typeof this._manifest !== 'object') this._manifest = {};
        } catch {
            this._manifest = {};
        }
    }

    async _saveManifest() {
        try {
            await fs.mkdir(path.dirname(MANIFEST_FILE), { recursive: true });
            await fs.writeFile(MANIFEST_FILE, JSON.stringify(this._manifest, null, 2));
        } catch { /* non-fatal */ }
    }

    /**
     * Scan all arbiter files and build capability → entry map.
     * Uses regex on source text — no importing, no execution.
     * Preserves verified/failed status from previous runs.
     */
    async _buildManifest() {
        let files;
        try {
            const entries = await fs.readdir(ARBITERS_DIR);
            files = entries.filter(f => f.endsWith('.js') || f.endsWith('.cjs'));
        } catch (err) {
            console.warn('[ArbiterLoader] Could not read arbiters dir:', err.message);
            return;
        }

        // Build a fresh map, but preserve status from existing entries
        const fresh = {};

        const addEntry = (capability, entry) => {
            if (!fresh[capability]) fresh[capability] = [];
            // Don't duplicate
            if (!fresh[capability].find(e => e.file === entry.file)) {
                fresh[capability].push(entry);
            }
        };

        for (const file of files) {
            const scanned = await this._scanFile(file);
            if (!scanned) continue;

            // Restore preserved status from old manifest
            const oldEntries = Object.values(this._manifest).flat();
            const old = oldEntries.find(e => e.file === file);
            if (old?.status) {
                scanned.status = old.status;
                if (old.error) scanned.error = old.error;
            }

            for (const cap of scanned.capabilities || ['_uncategorized']) {
                addEntry(cap, { ...scanned });
            }
        }

        this._manifest = fresh;
        await this._saveManifest();
        console.log(`[ArbiterLoader] 📋 Manifest rebuilt: ${files.length} files → ${Object.keys(fresh).length} capabilities`);
    }

    /**
     * Scan a single file with regex. Returns entry object or null.
     */
    async _scanFile(filename) {
        const filePath = path.join(ARBITERS_DIR, filename);
        let src;
        try {
            src = await fs.readFile(filePath, 'utf8');
        } catch {
            return null;
        }

        // Extract class name — `export class Foo` or `export default class Foo`
        const clsMatch = src.match(/export\s+(?:default\s+)?class\s+(\w+)/);
        if (!clsMatch) return null; // Not a class-based arbiter, skip
        const cls = clsMatch[1];

        // Extract capabilities — `ArbiterCapability.FOO` or string literals in capabilities array
        const capMatches = [...src.matchAll(/ArbiterCapability\.(\w+)/g)];
        const capabilities = [...new Set(capMatches.map(m => {
            // Convert SCREAMING_SNAKE to kebab-case to match CapabilityRegistry values
            return m[1].toLowerCase().replace(/_/g, '-');
        }))];

        // Extract role
        const roleMatch = src.match(/ArbiterRole\.(\w+)/);
        const role = roleMatch ? roleMatch[1].toLowerCase() : null;

        // Extract lobe
        const lobeMatch = src.match(/lobe:\s*['"](\w+)['"]/);
        const lobe = lobeMatch ? lobeMatch[1] : null;

        return { file: filename, cls, capabilities, role, lobe, status: null };
    }
}

export default ArbiterLoader;
