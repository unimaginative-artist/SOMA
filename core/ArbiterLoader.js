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
// Manifest lives in SOMA's runtime data root: SOMA/arbiter-manifest.json
// ═══════════════════════════════════════════════════════════════════════════

import fs        from 'fs/promises';
import path      from 'path';
import { createRequire } from 'module';
import { fileURLToPath }  from 'url';

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const ARBITERS_DIR    = path.join(__dirname, '..', 'arbiters');
const MANIFEST_FILE   = path.join(__dirname, '..', 'SOMA', 'arbiter-manifest.json');

// Standard deps injected into every lazily-loaded arbiter
const STD_DEPS = ['quadBrain', 'mnemonicArbiter', 'messageBroker', 'rootPath', 'goalPlanner', 'system', 'learningPipeline', 'knowledgeGraph'];

export class ArbiterLoader {
    constructor({ system, messageBroker } = {}) {
        this.system        = system        || {};
        this.messageBroker = messageBroker || null;
        this._manifest     = {};           // capability → [{ file, cls, lobe, role, status, error }]
        this._loading      = new Map();    // file → Promise (dedupe concurrent loads)
        this._require      = createRequire(import.meta.url);
        this._isBuilding   = false;        // Re-entrancy guard
        
        // 🔱 Dependency Overrides: Maps specialist arbiters to their non-standard dependencies.
        // This allows ArbiterLoader to handle complex wiring that was previously hardcoded.
        this._dependencyMap = {
            'MultiTimeframeAnalyzer': ['regimeDetector'],
            'TradeLearningEngine': ['outcomeTracker'],
            'BacktestEngine': ['mtfAnalyzer', 'regimeDetector'],
            'HindsightReplayArbiter': ['experienceReplay', 'outcomeTracker'],
            'FragmentCommunicationHub': ['fragmentRegistry'],
            'PersonalityForgeArbiter': ['quadBrain', 'messageBroker'],
            'MnemonicIndexerArbiter': ['mnemonicArbiter', 'storageArbiter'],
            'IdeaCaptureArbiter': ['knowledgeGraph', 'messageBroker'],
            'ConversationHistoryArbiter': ['mnemonicArbiter', 'personalityForge'],
            'CuriosityEngine': ['knowledgeGraph', 'simulationArbiter', 'worldModel', 'fragmentRegistry'],
            'UniversalLearningPipeline': ['outcomeTracker', 'experienceBuffer']
        };
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    async initialize() {
        await this._loadManifest();
        const total = Object.keys(this._manifest).length;
        console.log(`[ArbiterLoader] 📚 Arbiter inventory: ${total} capabilities mapped.`);
        
        // If manifest is empty, build it immediately
        if (total === 0) {
            await this._buildManifest().catch(err =>
                console.warn('[ArbiterLoader] Initial manifest build error:', err.message)
            );
        } else {
            // Otherwise, defer the re-scan to avoid boot-time I/O spikes
            setTimeout(() => {
                this._buildManifest().catch(err =>
                    console.warn('[ArbiterLoader] Manifest rebuild error:', err.message)
                );
            }, 60_000);
        }
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
        // Prioritize 'verified' over null, skip 'failed'
        const entry   = entries.find(e => e.status === 'verified') || entries.find(e => !e.status);
        
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
        const baseName = filename.replace(/\.(js|cjs)$/, '');
        
        if (this.messageBroker) {
            const existing = this.messageBroker.getArbiter?.(baseName);
            if (existing?.instance) return existing.instance;
        }

        // Find any entry for this file
        for (const entries of Object.values(this._manifest)) {
            const entry = entries.find(e => e.file === filename || e.file === `${baseName}.js` || e.file === `${baseName}.cjs`);
            if (entry) return this._loadEntry(entry, extraDeps);
        }

        // File not in manifest yet — try to load directly
        const entry = await this._scanFile(filename.endsWith('.js') || filename.endsWith('.cjs') ? filename : `${baseName}.js`);
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
     * Load multiple arbiters in parallel (phased loading).
     */
    async batchLoad(filenames, extraDeps = {}) {
        console.log(`[ArbiterLoader] 📦 Batch loading ${filenames.length} arbiters...`);
        const results = await Promise.allSettled(
            filenames.map(f => this.loadByFile(f, extraDeps))
        );
        
        const succeeded = results.filter(r => r.status === 'fulfilled' && r.value).length;
        console.log(`[ArbiterLoader] ✅ Batch complete: ${succeeded}/${filenames.length} succeeded.`);
        return results.map(r => r.status === 'fulfilled' ? r.value : null);
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
                const mod = await import(`file://${filePath}?t=${Date.now()}`); // cache-bust + file:// for Windows
                Cls = mod[entry.cls] || mod.default;
            }

            if (!Cls || typeof Cls !== 'function') {
                throw new Error(`Could not find class "${entry.cls}" in ${entry.file}`);
            }

            // Build deps from system + extras + dependency overrides
            const deps = this._buildDeps(entry.cls, extraDeps);

            // Instantiate
            const instance = new Cls({ name: entry.cls, ...deps });

            // Initialize (try multiple patterns)
            if (typeof instance.initialize === 'function') {
                if (instance.initialize.length > 0) {
                    await instance.initialize(this.system);
                } else {
                    await instance.initialize();
                }
            } else if (typeof instance.onInitialize === 'function') {
                await instance.onInitialize();
            } else if (typeof instance.onActivate === 'function') {
                await instance.onActivate();
            }

            // Register with MessageBroker so future getArbitersByCapability() finds it
            if (this.messageBroker?.registerArbiter) {
                const allEntries = Object.values(this._manifest).flat();
                const myCaps = allEntries
                    .filter(e => e.file === entry.file)
                    .reduce((caps, e) => {
                        if (e.capabilities) caps.push(...e.capabilities);
                        return caps;
                    }, []);

                this.messageBroker.registerArbiter(instance.name || entry.cls, {
                    instance,
                    capabilities: [...new Set(myCaps)],
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

    _buildDeps(clsName, extras = {}) {
        const deps = {};
        
        // 1. Standard Dependencies from system
        for (const key of STD_DEPS) {
            if (this.system[key] !== undefined) deps[key] = this.system[key];
        }
        
        // 2. Specialized Dependency Overrides
        const overrides = this._dependencyMap[clsName] || [];
        for (const key of overrides) {
            if (this.system[key] !== undefined) {
                deps[key] = this.system[key];
            } else {
                const lowerKey = key.charAt(0).toLowerCase() + key.slice(1);
                if (this.system[lowerKey] !== undefined) {
                    deps[key] = this.system[lowerKey];
                }
            }
        }

        // 3. Infrastructure singletons (CRITICAL: ensure these are always present)
        deps.system        = this.system;
        deps.messageBroker = this.messageBroker || this.system.messageBroker;
        deps.rootPath      = this.system.rootPath || process.cwd();
        
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
        if (this._isBuilding) {
            console.log('[ArbiterLoader] 🛡️ Blocked recursive manifest build request.');
            return;
        }
        this._isBuilding = true;
        let files;
        try {
            const entries = await fs.readdir(ARBITERS_DIR);
            files = entries.filter(f => f.endsWith('.js') || f.endsWith('.cjs'));
        } catch (err) {
            console.warn('[ArbiterLoader] Could not read arbiters dir:', err.message);
            this._isBuilding = false;
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

        // Process in batches of 10 with an event-loop yield between batches.
        // Without this, scanning 169 files back-to-back saturates the I/O queue
        // and makes the HTTP event loop unresponsive during boot.
        const BATCH_SIZE = 10;
        const oldEntries = Object.values(this._manifest).flat();
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (file) => {
                const scanned = await this._scanFile(file);
                if (!scanned) return;
                const old = oldEntries.find(e => e.file === file);
                if (old?.status) {
                    scanned.status = old.status;
                    if (old.error) scanned.error = old.error;
                }
                for (const cap of scanned.capabilities || ['_uncategorized']) {
                    addEntry(cap, { ...scanned });
                }
            }));
            // Yield to event loop between batches so HTTP requests can be served
            await new Promise(resolve => setImmediate(resolve));
        }

        this._manifest = fresh;
        await this._saveManifest();
        this._isBuilding = false;
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

        // Extract class name — look for class matching baseName of filename first, fallback to first class
        const baseName = filename.replace(/\.(js|cjs)$/, '');
        const exactClassRegex = new RegExp(`(?:export\\s+(?:default\\s+)?)?class\\s+(${baseName})\\b`);
        let clsMatch = src.match(exactClassRegex);
        if (!clsMatch) {
            clsMatch = src.match(/(?:export\s+(?:default\s+)?)?class\s+(\w+)/);
        }
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
