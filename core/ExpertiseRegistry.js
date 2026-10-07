import path from 'path';
import fs from 'fs/promises';
import { pathToFileURL } from 'url';
import { ExpertiseBase } from './ExpertiseBase.js';

class ManifestExpertisePack extends ExpertiseBase {
    constructor(config = {}) {
        const manifest = config.manifest || {};
        super({
            system: config.system,
            name: manifest.name || manifest.id || 'ManifestExpertise',
            category: manifest.category || manifest.parent || 'General',
            version: manifest.version || '0.1.0'
        });
        this.manifest = manifest;
        this.description = manifest.description || '';
        this.capabilities = manifest.capabilities || [];
        this.standards = manifest.standards || [];
    }

    async getPhases() {
        return this.manifest.workflows?.default || [
            { name: 'context_load', description: 'Load domain context and declared capabilities.' },
            { name: 'answer_or_delegate', description: 'Answer with available context or delegate to a runtime module.' }
        ];
    }

    getStatus() {
        return {
            ...super.getStatus(),
            id: this.manifest.id,
            parent: this.manifest.parent || null,
            specialty: this.manifest.specialty || null,
            manifestOnly: true,
            capabilities: this.capabilities,
            standards: this.standards
        };
    }
}

export class ExpertiseRegistry {
    constructor(options = {}) {
        this.system = options.system || {};
        this.rootPath = options.rootPath || process.cwd();
        this.expertisePath = options.expertisePath || path.join(this.rootPath, 'expertises');
        this.logger = options.logger || console;
        this.manifests = new Map();
        this.loaded = new Map();
        this.issues = [];
        this.initialized = false;
    }

    async initialize() {
        await this.scan();
        this.initialized = true;
        if (this.system) this.system.expertiseRegistry = this;
        return this;
    }

    async scan() {
        this.manifests.clear();
        this.issues = [];

        try {
            await fs.access(this.expertisePath);
            this._realExpertisePath = await fs.realpath(this.expertisePath);
        } catch {
            this.issues.push({
                level: 'warn',
                message: `Expertise directory not found: ${this.expertisePath}`
            });
            return [];
        }

        const manifestPaths = await this._findManifestFiles(this.expertisePath);
        for (const manifestPath of manifestPaths) {
            try {
                const raw = await fs.readFile(manifestPath, 'utf8');
                const manifest = this._normalize(JSON.parse(raw), manifestPath);
                this.manifests.set(manifest.id, manifest);
            } catch (error) {
                this.issues.push({
                    level: 'error',
                    file: manifestPath,
                    message: error.message
                });
            }
        }

        return this.list();
    }

    list(options = {}) {
        const includeLoaded = options.includeLoaded !== false;
        return Array.from(this.manifests.values())
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(manifest => includeLoaded ? this._publicManifest(manifest) : { ...manifest });
    }

    get(id) {
        const manifest = this.manifests.get(id);
        return manifest ? this._publicManifest(manifest) : null;
    }

    status() {
        return {
            ready: this.initialized,
            expertisePath: this.expertisePath,
            manifests: this.manifests.size,
            loaded: this.loaded.size,
            loadedIds: Array.from(this.loaded.keys()).sort(),
            issues: this.issues
        };
    }

    match(query, options = {}) {
        const text = String(query || '').toLowerCase().trim();
        const limit = Math.min(Math.max(parseInt(options.limit || 5, 10), 1), 25);
        if (!text) return [];

        const tokens = Array.from(new Set(text.split(/[^a-z0-9_./-]+/).filter(Boolean)));
        return Array.from(this.manifests.values())
            .map(manifest => ({
                ...this._publicManifest(manifest),
                score: this._score(manifest, text, tokens),
                reasons: this._matchReasons(manifest, text, tokens)
            }))
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
            .slice(0, limit);
    }

    async load(id, options = {}) {
        const manifest = this.manifests.get(id);
        if (!manifest) {
            const error = new Error(`Expertise not found: ${id}`);
            error.code = 'EXPERTISE_NOT_FOUND';
            throw error;
        }

        if (this.loaded.has(id)) {
            const entry = this.loaded.get(id);
            entry.lastUsedAt = new Date().toISOString();
            return this._publicLoaded(entry);
        }

        const instance = await this._instantiate(manifest, options);
        const entry = {
            id,
            manifest,
            instance,
            level: options.level || manifest.loadPolicy?.defaultLevel || 'warm',
            loadedAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString()
        };

        this.loaded.set(id, entry);
        return this._publicLoaded(entry);
    }

    async unload(id) {
        const entry = this.loaded.get(id);
        if (!entry) return { success: false, id, unloaded: false };

        const instance = entry.instance;
        if (instance) {
            for (const method of ['shutdown', 'stop', 'dispose', 'close']) {
                if (typeof instance[method] === 'function') {
                    await instance[method]();
                    break;
                }
            }
        }

        this.loaded.delete(id);
        return { success: true, id, unloaded: true };
    }

    getLoaded(id) {
        return this.loaded.get(id)?.instance || null;
    }

    async run(id, target, options = {}) {
        const loaded = await this.load(id, options);
        const instance = this.getLoaded(id);
        if (!instance || typeof instance.runMission !== 'function') {
            throw new Error(`Expertise ${id} does not expose runMission(target)`);
        }
        const result = await instance.runMission(target);
        return { ...loaded, result };
    }

    async _findManifestFiles(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this._findManifestFiles(entryPath));
            } else if (entry.name === 'expertise.json' && (entry.isFile() || entry.isSymbolicLink())) {
                // OneDrive Files On-Demand exposes hydrated files as reparse
                // points on Windows. Follow only the exact manifest filename,
                // and only when its real target remains inside the expertise
                // root, so cloud hydration cannot become a traversal escape.
                try {
                    const realPath = await fs.realpath(entryPath);
                    const relative = path.relative(this._realExpertisePath || this.expertisePath, realPath);
                    const insideRoot = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
                    if (insideRoot && (await fs.stat(realPath)).isFile()) files.push(entryPath);
                } catch (error) {
                    this.issues.push({ level: 'warn', file: entryPath, message: `Manifest link unavailable: ${error.message}` });
                }
            }
        }
        return files;
    }

    _normalize(input, manifestPath) {
        const manifest = {
            ...input,
            id: input.id || this._idFromPath(manifestPath),
            version: input.version || '0.1.0',
            domains: input.domains || [],
            aliases: input.aliases || [],
            triggers: input.triggers || [],
            keywords: input.keywords || [],
            capabilities: input.capabilities || [],
            standards: input.standards || [],
            loadPolicy: input.loadPolicy || { mode: 'lazy', defaultLevel: 'warm' },
            runtime: input.runtime || null,
            manifestPath,
            directory: path.dirname(manifestPath),
            relativePath: path.relative(this.rootPath, manifestPath)
        };

        manifest.depth = manifest.id.split('/').length;
        manifest.category = manifest.category || manifest.parent || manifest.id.split('/')[0];
        return manifest;
    }

    _idFromPath(manifestPath) {
        const relativeDir = path.relative(this.expertisePath, path.dirname(manifestPath));
        return relativeDir.split(path.sep).filter(Boolean).join('/');
    }

    async _instantiate(manifest, options = {}) {
        if (manifest.runtime?.module) {
            const modulePath = path.resolve(manifest.directory, manifest.runtime.module);
            const runtimeModule = await import(pathToFileURL(modulePath).href);
            const exportName = manifest.runtime.export || 'default';
            const RuntimeClass = runtimeModule[exportName] || runtimeModule.default;
            if (typeof RuntimeClass !== 'function') {
                throw new Error(`Runtime export ${exportName} is not a class/function in ${modulePath}`);
            }
            return new RuntimeClass({
                system: this.system,
                expertiseManifest: manifest,
                manifest,
                loadLevel: options.level || manifest.loadPolicy?.defaultLevel
            });
        }

        return new ManifestExpertisePack({ system: this.system, manifest });
    }

    _score(manifest, text, tokens) {
        let score = 0;
        const weightedFields = [
            [manifest.id, 10],
            [manifest.name, 8],
            [manifest.specialty, 8],
            [manifest.parent, 5],
            [manifest.description, 3],
            [manifest.domains, 6],
            [manifest.aliases, 7],
            [manifest.triggers, 9],
            [manifest.keywords, 5],
            [manifest.capabilities, 4],
            [manifest.standards, 4]
        ];

        for (const [value, weight] of weightedFields) {
            const values = Array.isArray(value) ? value : [value];
            for (const item of values.filter(Boolean)) {
                const candidate = String(item).toLowerCase();
                if (candidate && text.includes(candidate)) score += weight;
                for (const token of tokens) {
                    if (token.length > 2 && candidate.includes(token)) score += Math.max(1, Math.floor(weight / 2));
                }
            }
        }

        return score;
    }

    _matchReasons(manifest, text, tokens) {
        const reasons = [];
        const fields = ['domains', 'aliases', 'triggers', 'keywords', 'capabilities', 'standards'];
        for (const field of fields) {
            for (const item of manifest[field] || []) {
                const candidate = String(item).toLowerCase();
                if (text.includes(candidate) || tokens.some(token => token.length > 2 && candidate.includes(token))) {
                    reasons.push(`${field}:${item}`);
                }
            }
        }
        return reasons.slice(0, 8);
    }

    _publicManifest(manifest) {
        const { manifestPath, directory, ...publicManifest } = manifest;
        return {
            ...publicManifest,
            loaded: this.loaded.has(manifest.id)
        };
    }

    _publicLoaded(entry) {
        return {
            success: true,
            id: entry.id,
            level: entry.level,
            loadedAt: entry.loadedAt,
            lastUsedAt: entry.lastUsedAt,
            manifest: this._publicManifest(entry.manifest),
            status: typeof entry.instance?.getStatus === 'function'
                ? entry.instance.getStatus()
                : { name: entry.instance?.name || entry.id }
        };
    }
}

export default ExpertiseRegistry;
