import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import crypto from 'node:crypto';

/**
 * Dynamic Plugin Loader
 * Allows extending SOMA without modifying the core Bootstrap file.
 */
export class PluginLoader {
    constructor(system) {
        this.system = system;
        this.pluginsDir = path.resolve(process.cwd(), 'plugins');
        this.plugins = new Map();
    }

    async _record(sessionId, type, data = {}) {
        const ledger = this.system?.executionEventLedger || this.system?.toolRegistry?.executionLedger;
        if (!ledger) return;
        try { await ledger.append(sessionId, type, data); }
        catch (error) { console.warn(`[PluginLoader] Could not record ${type}: ${error.message}`); }
    }

    async loadPlugins() {
        console.log('\n🔌 Scanning for plugins...');
        try {
            await fs.access(this.pluginsDir);
        } catch {
            console.log('   (No plugins directory found, creating one...)');
            await fs.mkdir(this.pluginsDir, { recursive: true });
            return [];
        }

        const files = await fs.readdir(this.pluginsDir);
        const pluginFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.mjs'));

        if (pluginFiles.length === 0) {
            console.log('   (No plugins found)');
            return [];
        }

        const loaded = [];
        for (const file of pluginFiles) {
            const plugin = await this.loadPlugin(file);
            if (plugin) loaded.push(plugin);
        }
        return loaded;
    }

    async loadPlugin(filename) {
        const sessionId = `plugin-load-${crypto.randomUUID()}`;
        const ledger = this.system?.executionEventLedger || this.system?.toolRegistry?.executionLedger;
        try {
            await ledger?.startSession(sessionId, {
                kind: 'plugin-lifecycle',
                actor: 'PluginLoader',
                profileId: 'default',
                plugin: filename,
                observationalOnly: true
            }).catch(() => {});
            await this._record(sessionId, 'plugin/load-start', { filename });
            const filePath = path.join(this.pluginsDir, filename);
            const fileUrl = pathToFileURL(filePath).href;

            console.log(`   - Loading plugin: ${filename}...`);
            const module = await import(fileUrl);

            // Assume default export is the Arbiter class, or the first named export
            const ArbiterClass = module.default || Object.values(module).find(exp => typeof exp === 'function' && exp.name.includes('Arbiter'));

            if (typeof ArbiterClass !== 'function') {
                console.warn(`   ⚠️ ${filename} does not export a valid Arbiter class.`);
                await this._record(sessionId, 'plugin/load-rejected', { filename, reason: 'No valid Arbiter class export' });
                await ledger?.endSession(sessionId, { ok: false, state: 'rejected' }).catch(() => {});
                return null;
            }

            const name = ArbiterClass.name || filename.replace(/\.(m)?js$/, '');

            // Instantiate
            const instance = new ArbiterClass({ name });

            // Initialize with System context (Dependency Injection)
            // We pass { system: this.system } so plugins can access messageBroker, quadBrain, etc.
            if (instance.initialize) {
                await instance.initialize({
                    system: this.system
                });
            }

            // Register with Message Broker
            if (this.system.messageBroker) {
                this.system.messageBroker.registerArbiter(name, { instance });
            }

            // Attach to system object (camelCase)
            // e.g. MyCoolArbiter -> system.myCoolArbiter
            const propName = name.charAt(0).toLowerCase() + name.slice(1);
            if (!this.system[propName]) {
                this.system[propName] = instance;
            }

            const record = Object.freeze({ name, filename, filePath, propName, instance, loadedAt: Date.now() });
            this.plugins.set(name, record);
            await this._record(sessionId, 'plugin/loaded', {
                name,
                filename,
                propName,
                registeredWithBroker: Boolean(this.system.messageBroker)
            });
            await ledger?.endSession(sessionId, { ok: true, state: 'loaded', plugin: name }).catch(() => {});

            console.log(`   ✅ Plugin ${name} loaded and active.`);
            return record;

        } catch (err) {
            await this._record(sessionId, 'plugin/load-error', {
                filename,
                error: { name: err.name, message: err.message, code: err.code || null }
            });
            await ledger?.endSession(sessionId, { ok: false, state: 'error', error: err.message }).catch(() => {});
            console.error(`   ❌ Failed to load plugin ${filename}:`, err);
            return null;
        }
    }

    async unloadPlugin(identifier) {
        const key = String(identifier || '');
        const record = this.plugins.get(key) || [...this.plugins.values()].find(plugin => plugin.filename === key);
        if (!record) return { unloaded: false, reason: `Plugin not loaded: ${identifier}` };
        const sessionId = `plugin-unload-${crypto.randomUUID()}`;
        const ledger = this.system?.executionEventLedger || this.system?.toolRegistry?.executionLedger;
        await ledger?.startSession(sessionId, {
            kind: 'plugin-lifecycle', actor: 'PluginLoader', plugin: record.name, observationalOnly: true
        }).catch(() => {});
        await this._record(sessionId, 'plugin/unload-start', { name: record.name, filename: record.filename });
        try {
            const lifecycle = ['dispose', 'shutdown', 'stop'].find(method => typeof record.instance?.[method] === 'function');
            if (lifecycle) await record.instance[lifecycle]();
            this.system.messageBroker?.unregisterArbiter?.(record.name);
            if (this.system[record.propName] === record.instance) delete this.system[record.propName];
            this.plugins.delete(record.name);
            await this._record(sessionId, 'plugin/unloaded', { name: record.name, lifecycle: lifecycle || null });
            await ledger?.endSession(sessionId, { ok: true, state: 'unloaded', plugin: record.name }).catch(() => {});
            return { unloaded: true, name: record.name, lifecycle: lifecycle || null };
        } catch (error) {
            await this._record(sessionId, 'plugin/unload-error', { name: record.name, error: error.message });
            await ledger?.endSession(sessionId, { ok: false, state: 'error', error: error.message }).catch(() => {});
            return { unloaded: false, name: record.name, reason: error.message };
        }
    }

    listPlugins() {
        return [...this.plugins.values()].map(({ name, filename, filePath, propName, loadedAt }) => ({
            name, filename, filePath, propName, loadedAt
        }));
    }
}
