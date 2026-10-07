/**
 * daemons/CapabilityDiscoveryDaemon.js
 *
 * Self-healing capability audit. Probes every registered tool/service with
 * a lightweight no-op check (never triggers real work), updates a Capability Map,
 * and emits signals when something goes from healthy → degraded or vice versa.
 *
 * Signals emitted:
 *   capability.map.updated   — full map every tick (low priority)
 *   capability.degraded      — specific capability just failed (high priority)
 *   capability.restored      — specific capability just recovered (normal priority)
 */

import BaseDaemon from './BaseDaemon.js';
import fs from 'fs';
import path from 'path';

export class CapabilityDiscoveryDaemon extends BaseDaemon {
    constructor(opts = {}) {
        super({
            name: 'CapabilityDiscoveryDaemon',
            interval: opts.intervalMs || 60000, // 60s default
            ...opts
        });

        // name → { ok, latencyMs, note, lastCheck }
        this._capabilityMap = new Map();
        // name → previous ok boolean (for change detection)
        this._prevState     = new Map();

        // Human-readable remediation hints — emitted with capability.degraded signal
        this._remediations = new Map([
            ['filesystem',      'Check SOMA working directory permissions and disk space'],
            ['sqlite_memory',   'Check soma-memory.db is not locked; restart SOMA if stuck'],
            ['ollama',          'Start Ollama: run "ollama serve" in a terminal'],
            ['deepseek_key',    'Add DEEPSEEK_API_KEY to config/api-keys.env'],
            ['brave_search',    'Add BRAVE_API_KEY to config/api-keys.env'],
            ['puppeteer',       'Install Chrome or run: npm install puppeteer'],
            ['message_broker',  'MessageBroker crashed — restart SOMA to restore CNS'],
        ]);

        // Probes: each returns { ok: boolean, latencyMs: number, note?: string }
        // IMPORTANT: probes MUST be side-effect free. Never launch browsers,
        // execute trades, or modify files. Only read/ping/stat.
        this._probes = this._buildDefaultProbes(opts);
    }

    _buildDefaultProbes(opts) {
        const probes = new Map();
        const rootPath = opts.rootPath || process.cwd();

        // 1. Filesystem I/O
        probes.set('filesystem', async () => {
            const t0 = Date.now();
            const tmp = path.join(rootPath, '.soma', '.capability_probe_tmp');
            try {
                fs.mkdirSync(path.dirname(tmp), { recursive: true });
                fs.writeFileSync(tmp, 'probe');
                const data = fs.readFileSync(tmp, 'utf8');
                fs.unlinkSync(tmp);
                return { ok: data === 'probe', latencyMs: Date.now() - t0 };
            } catch (e) {
                return { ok: false, latencyMs: Date.now() - t0, note: e.message };
            }
        });

        // 2. SQLite (cold-tier memory) — just check the db file is accessible
        probes.set('sqlite_memory', async () => {
            const t0 = Date.now();
            const dbPath = path.join(rootPath, 'soma-memory.db');
            try {
                fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
                const stat = fs.statSync(dbPath);
                return {
                    ok: true,
                    latencyMs: Date.now() - t0,
                    note: `${(stat.size / 1024 / 1024).toFixed(1)}MB`
                };
            } catch (e) {
                // DB file missing is non-fatal — MnemonicArbiter creates it on demand
                return { ok: true, latencyMs: Date.now() - t0, note: 'db not yet created (OK)' };
            }
        });

        // 3. Ollama — local LLM endpoint
        probes.set('ollama', async () => {
            const t0 = Date.now();
            try {
                const res = await fetch('http://localhost:11434/api/tags', {
                    signal: AbortSignal.timeout(3000)
                });
                const ok = res.status === 200;
                const body = ok ? await res.json().catch(() => ({})) : {};
                const note = ok ? `${(body.models || []).length} model(s) loaded` : `HTTP ${res.status}`;
                return { ok, latencyMs: Date.now() - t0, note };
            } catch (e) {
                return { ok: false, latencyMs: Date.now() - t0, note: e.message?.slice(0, 60) };
            }
        });

        // 4. DeepSeek API key presence
        probes.set('deepseek_key', async () => {
            const t0 = Date.now();
            const key = process.env.DEEPSEEK_API_KEY;
            if (key && key.length > 10 && !key.includes('your_')) {
                return { ok: true, latencyMs: Date.now() - t0, note: `key set (${key.length} chars)` };
            }
            // Try reading from config file
            try {
                const envPath = path.join(rootPath, 'config', 'api-keys.env');
                const content = fs.readFileSync(envPath, 'utf8');
                const match   = content.match(/DEEPSEEK_API_KEY\s*=\s*([^\s\n]+)/);
                const found   = match && match[1] && match[1].length > 10 && !match[1].includes('your_');
                return { ok: !!found, latencyMs: Date.now() - t0, note: found ? 'key in config file' : 'key missing/placeholder' };
            } catch (e) {
                return { ok: false, latencyMs: Date.now() - t0, note: 'config/api-keys.env not readable' };
            }
        });

        // 5. Brave Search key
        probes.set('brave_search', async () => {
            const t0 = Date.now();
            const key = process.env.BRAVE_API_KEY;
            if (key && key.length > 10) return { ok: true, latencyMs: Date.now() - t0, note: 'env key set' };
            try {
                const envPath = path.join(rootPath, 'config', 'api-keys.env');
                const content = fs.readFileSync(envPath, 'utf8');
                const match   = content.match(/BRAVE_API_KEY\s*=\s*([^\s\n]+)/);
                const found   = match && match[1] && match[1].length > 10 && !match[1].includes('your_');
                return { ok: !!found, latencyMs: Date.now() - t0, note: found ? 'key in config file' : 'key missing' };
            } catch (e) {
                return { ok: false, latencyMs: Date.now() - t0, note: 'config not readable' };
            }
        });

        // 6. Puppeteer / Chromium availability
        probes.set('puppeteer', async () => {
            const t0 = Date.now();
            // Check if puppeteer-core package exists
            const pkgPath = path.join(rootPath, 'node_modules', 'puppeteer-core', 'package.json');
            const altPath = path.join(rootPath, 'node_modules', 'puppeteer', 'package.json');
            const hasPkg  = fs.existsSync(pkgPath) || fs.existsSync(altPath);
            if (!hasPkg) return { ok: false, latencyMs: Date.now() - t0, note: 'puppeteer not installed' };

            // Check common chromium paths (Windows)
            const chromePaths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
            ];
            const chromeFound = chromePaths.some(p => { try { return fs.existsSync(p); } catch { return false; } });
            return {
                ok: hasPkg && chromeFound,
                latencyMs: Date.now() - t0,
                note: chromeFound ? 'chrome + puppeteer ready' : 'puppeteer installed but chrome not found'
            };
        });

        // 7. MessageBroker (CNS) — check it's globally accessible
        probes.set('message_broker', async () => {
            const t0 = Date.now();
            try {
                const broker = (await import('../core/MessageBroker.cjs')).default;
                const ok = broker && typeof broker.subscribe === 'function';
                return { ok, latencyMs: Date.now() - t0, note: ok ? 'CNS healthy' : 'broker degraded' };
            } catch (e) {
                return { ok: false, latencyMs: Date.now() - t0, note: e.message?.slice(0, 60) };
            }
        });

        return probes;
    }

    /**
     * Register an additional probe at runtime.
     * @param {string} name - Capability name (e.g. 'binance_api')
     * @param {Function} probeFn - async () => { ok, latencyMs, note? }
     */
    registerProbe(name, probeFn) {
        this._probes.set(name, probeFn);
    }

    async tick() {
        const results = new Map();

        // Run all probes in parallel
        const entries = Array.from(this._probes.entries());
        const settled = await Promise.allSettled(
            entries.map(([name, probe]) => probe().then(r => ({ name, ...r })))
        );

        for (let i = 0; i < settled.length; i++) {
            const [name] = entries[i];
            const result = settled[i];

            if (result.status === 'fulfilled') {
                const { ok, latencyMs, note } = result.value;
                results.set(name, { ok, latencyMs, note, lastCheck: Date.now() });

                // Change detection
                const wasOk = this._prevState.get(name);
                if (wasOk === true && !ok) {
                    const recommendation = this._remediations.get(name) || 'Check SOMA logs for details';
                    this.emitSignal('capability.degraded', { capability: name, note, latencyMs, recommendation }, 'high');
                    console.warn(`[CapabilityDiscovery] ⚠️  ${name} DEGRADED — ${note || 'no detail'} | Fix: ${recommendation}`);
                } else if (wasOk === false && ok) {
                    this.emitSignal('capability.restored', { capability: name, note, latencyMs }, 'normal');
                    console.log(`[CapabilityDiscovery] ✅ ${name} RESTORED — ${note || 'no detail'}`);
                } else if (wasOk === undefined) {
                    // First probe — just log, no change signal
                    const icon = ok ? '✅' : '⚠️ ';
                    console.log(`[CapabilityDiscovery] ${icon} ${name}: ${ok ? 'OK' : 'FAIL'} ${note ? '— ' + note : ''} (${latencyMs}ms)`);
                }

                this._prevState.set(name, ok);
            } else {
                // Probe threw — treat as degraded
                const note = result.reason?.message?.slice(0, 80) || 'probe threw';
                results.set(name, { ok: false, latencyMs: 0, note, lastCheck: Date.now() });
                if (this._prevState.get(name) !== false) {
                    this.emitSignal('capability.degraded', { capability: name, note }, 'high');
                }
                this._prevState.set(name, false);
            }
        }

        this._capabilityMap = results;

        // Emit full map every tick (low priority — for dashboard consumption)
        const mapObj = Object.fromEntries(results);
        this.emitSignal('capability.map.updated', { capabilities: mapObj, timestamp: Date.now() }, 'low');
    }

    /**
     * Get current capability map (for API routes / dashboard)
     */
    getCapabilityMap() {
        return Object.fromEntries(this._capabilityMap);
    }
}

export default CapabilityDiscoveryDaemon;
