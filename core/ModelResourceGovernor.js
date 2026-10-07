import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { acquireLargeModelLease, releaseLargeModelLease, withLargeModelLeaseAccess } from './LargeModelResourceGate.js';

const execFileAsync = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const DEFAULT_ENDPOINTS = ['http://127.0.0.1:11434', 'http://127.0.0.1:11435', 'http://127.0.0.1:11436'];

export function isExpectedOptionalGpuProcess(item) {
    const port = Number(item?.port);
    const command = String(item?.command || '');
    if (port === 8000) {
        return /python(?:\.exe)?["']?\s+.*-m\s+uvicorn\s+scripts\.local_backend:app\s+--port\s+8000(?:\s|$)/i.test(command);
    }
    if (port === 8080) {
        return /siren-bridge[\\/].*python(?:\.exe)?["']?\s+.*siren-bridge[\\/].*engine[\\/]tools[\\/]api\.py.*--listen\s+0\.0\.0\.0:8080(?:\s|$)/i.test(command);
    }
    return false;
}

export class ModelResourceGovernor {
    constructor({
        fetchImpl = globalThis.fetch,
        ollamaEndpoints = DEFAULT_ENDPOINTS,
        llamaExecutable = process.env.SOMA_LLAMA_SERVER_EXE || 'C:\\Users\\owner\\Documents\\Soma\\Runtimes\\llama.cpp\\b10734\\bin\\llama-server.exe',
        modelPath = process.env.SOMA_LARGE_MODEL_PATH || 'C:\\Users\\owner\\Documents\\Soma\\Models\\Qwen3.8-27B-Uncensored\\Qwen3.8-27B-Uncensored-noMTP-IQ4_XS.gguf',
        host = '127.0.0.1', port = Number(process.env.SOMA_LARGE_MODEL_PORT || 8084),
        minFreeVramMiB = Number(process.env.SOMA_LARGE_MODEL_MIN_FREE_VRAM_MIB || 5500),
        minFreeRamGiB = Number(process.env.SOMA_LARGE_MODEL_MIN_FREE_RAM_GIB || 5),
        // The large model cannot meet its measured VRAM gate while Fish-Speech
        // owns CUDA. Identity checks below make this safe: only the exact known
        // Siren/local-backend command lines may be paused and later restored.
        manageOptionalGpuServices = process.env.SOMA_LARGE_MODEL_MANAGE_OPTIONAL_GPU_SERVICES !== 'false',
        logger = console
    } = {}) {
        this.fetchImpl = fetchImpl;
        this.ollamaEndpoints = ollamaEndpoints;
        this.llamaExecutable = llamaExecutable;
        this.modelPath = modelPath;
        this.host = host;
        this.port = port;
        this.endpoint = `http://${host}:${port}`;
        this.minFreeVramMiB = minFreeVramMiB;
        this.minFreeRamGiB = minFreeRamGiB;
        this.manageOptionalGpuServices = manageOptionalGpuServices;
        this.logger = logger;
        this.runner = null;
        this.active = null;
    }

    async _inventory() {
        const rows = [];
        for (const endpoint of this.ollamaEndpoints) {
            try {
                const response = await this.fetchImpl(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(3000) });
                if (!response.ok) continue;
                const payload = await response.json();
                for (const model of payload.models || []) rows.push({ endpoint, model: model.name, keepAlive: '5m' });
            } catch {}
        }
        return rows;
    }

    async _evict(inventory) {
        for (const item of inventory) {
            const response = await this.fetchImpl(`${item.endpoint}/api/generate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: item.model, keep_alive: 0 }),
                signal: AbortSignal.timeout(30_000)
            });
            if (!response.ok) throw new Error(`Could not evict ${item.model} from ${item.endpoint}: HTTP ${response.status}`);
        }
    }

    async _restore(inventory) {
        const failures = [];
        for (const item of inventory) {
            try {
                const response = await this.fetchImpl(`${item.endpoint}/api/generate`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: item.model, prompt: 'Reply OK.', stream: false, keep_alive: item.keepAlive, options: { num_predict: 1, temperature: 0 } }),
                    signal: AbortSignal.timeout(180_000)
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
            } catch (error) { failures.push(`${item.endpoint}/${item.model}: ${error.message}`); }
        }
        if (failures.length) throw new Error(`Model restoration failed: ${failures.join('; ')}`);
    }

    async _telemetry() {
        let freeVramMiB = 0;
        try {
            const pyScript = path.join(process.cwd(), 'scripts', 'gpu_mem.py');
            const pyExe = path.join(process.cwd(), '.soma_venv', 'Scripts', 'python.exe');
            if (fs.existsSync(pyScript) && fs.existsSync(pyExe)) {
                const { stdout } = await execFileAsync(pyExe, [pyScript], { windowsHide: true, timeout: 3000 });
                const m = String(stdout).match(/CUDA Free:\s*(\d+)\s*MiB/);
                if (m) freeVramMiB = Number(m[1]);
            }
        } catch {}

        if (!freeVramMiB) {
            try {
                const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 });
                const parsed = Number(String(stdout).trim().split(/\s+/)[0]) || 0;
                // Guard against Blackwell / driver 581.80 underflow bug reporting millions of MiB
                freeVramMiB = (parsed > 24576 || parsed < 0) ? 8000 : parsed;
            } catch {}
        }
        return { freeVramMiB, freeRamGiB: os.freemem() / (1024 ** 3) };
    }

    async getStatus() {
        const telemetry = await this._telemetry();
        return {
            active: Boolean(this.active),
            runnerActive: Boolean(this.runner && this.runner.exitCode === null),
            endpoint: this.endpoint,
            model: path.basename(this.modelPath),
            modelPresent: fs.existsSync(this.modelPath),
            runtimePresent: fs.existsSync(this.llamaExecutable),
            manageOptionalGpuServices: this.manageOptionalGpuServices,
            thresholds: {
                minimumFreeVramMiB: this.minFreeVramMiB,
                minimumFreeRamGiB: this.minFreeRamGiB
            },
            telemetry
        };
    }

    async _optionalGpuProcesses() {
        if (!this.manageOptionalGpuServices || process.platform !== 'win32') return [];
        const script = [
            "$ports = 8000,8080",
            "$rows = @()",
            "foreach($port in $ports){ $c=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue|Select-Object -First 1; if($c){$p=Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\"; $rows += [pscustomobject]@{port=$port;pid=$p.ProcessId;command=$p.CommandLine}}}",
            "$rows|ConvertTo-Json -Compress"
        ].join('; ');
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 10_000 });
        if (!String(stdout).trim()) return [];
        const parsed = JSON.parse(stdout);
        return Array.isArray(parsed) ? parsed : [parsed];
    }

    async _stopOptionalGpuServices() {
        const stopped = [];
        for (const item of await this._optionalGpuProcesses()) {
            const command = String(item.command || '');
            if (!isExpectedOptionalGpuProcess(item)) throw new Error(`Refusing to stop unexpected process on optional GPU port ${item.port}`);
            process.kill(Number(item.pid));
            stopped.push({ port: Number(item.port), command });
        }
        await delay(2500);
        return stopped;
    }

    async _restoreOptionalGpuServices(stopped) {
        if (process.env.SOMA_ENABLE_SPEECH !== 'true') return;
        if (!stopped.some(item => item.port === 8080)) return;
        const somaRoot = process.cwd();
        const launcher = path.join(somaRoot, 'start_siren.ps1');
        if (!fs.existsSync(launcher)) return;
        // The canonical launcher supplies FFmpeg, performs readiness polling,
        // and restores both Fish-Speech and the Paula proxy. Starting the inner
        // Python bridge directly omits that environment and can die silently.
        const child = spawn('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher
        ], { cwd: somaRoot, detached: true, windowsHide: true, stdio: 'ignore' });
        child.unref();
    }

    async _waitForHealth(timeoutMs = Number(process.env.SOMA_LARGE_MODEL_STARTUP_TIMEOUT_MS || 180_000)) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const response = await this.fetchImpl(`${this.endpoint}/health`, { signal: AbortSignal.timeout(2000) });
                const body = response.ok ? await response.json().catch(() => ({})) : {};
                if (response.ok && ['ok', 'ready'].includes(body.status)) return body;
            } catch {}
            if (this.runner?.exitCode !== null) {
                const errDetail = (this.runnerStderr || []).join('').slice(-800);
                throw new Error(`llama-server exited during startup with code ${this.runner.exitCode}${errDetail ? `: ${errDetail}` : ''}`);
            }
            await delay(500);
        }
        throw new Error(`Qwen llama-server did not become healthy within ${Math.round(timeoutMs / 1000)} seconds`);
    }

    async _start() {
        if (!fs.existsSync(this.llamaExecutable)) throw new Error(`llama-server is missing: ${this.llamaExecutable}`);
        if (!fs.existsSync(this.modelPath)) throw new Error(`Qwen model is missing: ${this.modelPath}`);
        const threads = String(process.env.SOMA_LARGE_MODEL_THREADS || '8');
        const ngl = String(process.env.SOMA_LARGE_MODEL_NGL || '32');
        this.runnerStderr = [];
        this.runner = spawn(this.llamaExecutable, [
            '-m', this.modelPath, '--host', this.host, '--port', String(this.port),
            '-c', '4096', '-ngl', ngl, '--cache-type-k', 'q4_0', '--cache-type-v', 'q4_0',
            '--threads', threads, '--parallel', '1', '--no-webui'
        ], { cwd: path.dirname(this.llamaExecutable), windowsHide: true });
        this.runner.stderr?.on('data', chunk => {
            const line = String(chunk);
            this.runnerStderr.push(line);
            if (this.runnerStderr.length > 50) this.runnerStderr.shift();
        });
        await this._waitForHealth();
    }

    async _stop() {
        const runner = this.runner;
        this.runner = null;
        if (!runner || runner.exitCode !== null) return;
        runner.kill();
        await Promise.race([new Promise(resolve => runner.once('exit', resolve)), delay(10_000)]);
        if (runner.exitCode === null) runner.kill('SIGKILL');
    }

    async withLargeModel(operation) {
        if (this.active) return this.active.then(() => this.withLargeModel(operation));
        this.active = (async () => {
            const lease = await acquireLargeModelLease({ owner: 'SOMA ModelResourceGovernor' });
            const inventory = await this._inventory();
            let optional = [];
            let primaryError = null;
            try {
                optional = await this._stopOptionalGpuServices();
                await this._evict(inventory);
                await delay(1500);
                const telemetry = await this._telemetry();
                if (telemetry.freeVramMiB < this.minFreeVramMiB || telemetry.freeRamGiB < this.minFreeRamGiB) {
                    throw new Error(`Insufficient resources for Qwen: ${telemetry.freeVramMiB} MiB VRAM and ${telemetry.freeRamGiB.toFixed(1)} GiB RAM free`);
                }
                await this._start();
                return await operation();
            } catch (error) {
                primaryError = error;
                throw error;
            } finally {
                const restorationErrors = [];
                await this._stop().catch(error => restorationErrors.push(error.message));
                await this._restore(inventory).catch(error => restorationErrors.push(error.message));
                await this._restoreOptionalGpuServices(optional).catch(error => restorationErrors.push(error.message));
                await releaseLargeModelLease(lease).catch(error => restorationErrors.push(error.message));
                if (!primaryError && restorationErrors.length) throw new Error(`Large-model work completed but restoration failed: ${restorationErrors.join('; ')}`);
            }
        })();
        try { return await this.active; } finally { this.active = null; }
    }

    async withExclusiveCouncil(operation) {
        if (this.active) return this.active.then(() => this.withExclusiveCouncil(operation));
        this.active = (async () => {
            const lease = await acquireLargeModelLease({ owner: 'SOMA LargeReasoningCouncil' });
            const originalInventory = await this._inventory();
            let optional = [];
            let primaryError = null;
            try {
                optional = await this._stopOptionalGpuServices();
                await this._evict(originalInventory);
                await delay(1500);
                const phases = {
                    runStandard: task => withLargeModelLeaseAccess(lease, task),
                    runLarge: async task => {
                        // Remove the last specialist memo before loading Qwen.
                        await this._evict(await this._inventory());
                        await delay(1500);
                        const telemetry = await this._telemetry();
                        if (telemetry.freeVramMiB < this.minFreeVramMiB || telemetry.freeRamGiB < this.minFreeRamGiB) {
                            throw new Error(`Insufficient resources for Qwen: ${telemetry.freeVramMiB} MiB VRAM and ${telemetry.freeRamGiB.toFixed(1)} GiB RAM free`);
                        }
                        // A few legacy background components still call Ollama
                        // directly. Re-evict any model they wake while Qwen owns
                        // the lease so a late 7B load cannot starve the 27B cold
                        // start. Failures are best-effort here; the hard telemetry
                        // and Qwen health gates remain authoritative.
                        let suppressing = false;
                        let suppressionPromise = Promise.resolve();
                        const suppress = () => {
                            if (suppressing) return suppressionPromise;
                            suppressing = true;
                            suppressionPromise = (async () => {
                                try {
                                    const active = await this._inventory();
                                    if (active.length) await this._evict(active);
                                } catch {} finally { suppressing = false; }
                            })();
                            return suppressionPromise;
                        };
                        await suppress();
                        const suppressionTimer = setInterval(suppress, 5000);
                        suppressionTimer.unref?.();
                        try {
                            await this._start();
                            return await task();
                        } finally {
                            clearInterval(suppressionTimer);
                            await suppressionPromise;
                            await this._stop();
                        }
                    }
                };
                return await operation(phases);
            } catch (error) {
                primaryError = error;
                throw error;
            } finally {
                const restorationErrors = [];
                await this._stop().catch(error => restorationErrors.push(error.message));
                await this._restore(originalInventory).catch(error => restorationErrors.push(error.message));
                await this._restoreOptionalGpuServices(optional).catch(error => restorationErrors.push(error.message));
                await releaseLargeModelLease(lease).catch(error => restorationErrors.push(error.message));
                if (!primaryError && restorationErrors.length) throw new Error(`Large council completed but restoration failed: ${restorationErrors.join('; ')}`);
            }
        })();
        try { return await this.active; } finally { this.active = null; }
    }
}

export default ModelResourceGovernor;
