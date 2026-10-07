import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import microstructurePipeline from './TradingMicrostructurePipeline.js';
import { DEFAULT_LIQUID_CRYPTO_MARKETS } from './TradingHistoricalDataPipeline.js';

const STATE_PATH = path.join(process.cwd(), 'data', 'trading', 'research-daemon-state.json');

export function researchMemoryGate({ freeBytes, totalBytes }, { minFreeGiB = 2.5, maxUsedRatio = 0.94 } = {}) {
    const free = Number(freeBytes);
    const total = Number(totalBytes);
    if (!(total > 0) || !(free >= 0)) return { allowed: false, reason: 'system_memory_unavailable' };
    const freeGiB = free / 1024 ** 3;
    const usedRatio = 1 - free / total;
    return { allowed: freeGiB >= minFreeGiB && usedRatio <= maxUsedRatio,
        reason: freeGiB >= minFreeGiB && usedRatio <= maxUsedRatio ? null
            : `system_ram_pressure:${(usedRatio * 100).toFixed(1)}%_used,${freeGiB.toFixed(2)}GiB_free`,
        freeGiB, usedRatio };
}

export class TradingResearchDaemon {
    constructor({
        intervalMs = 6 * 60 * 60_000,
        initialDelayMs = 10 * 60_000,
        microstructureIntervalMs = 5 * 60_000,
        microstructure = microstructurePipeline,
        researchMarkets = DEFAULT_LIQUID_CRYPTO_MARKETS,
        statePath = STATE_PATH,
        fileSystem = fs,
        resourceSnapshot = () => ({ freeBytes: os.freemem(), totalBytes: os.totalmem() }),
        minFreeRamGiB = 2.5,
        maxSystemRamUsedRatio = 0.94,
        resourceRetryMs = 15 * 60_000
    } = {}) {
        this.intervalMs = Math.max(60 * 60_000, intervalMs);
        this.initialDelayMs = Math.max(60_000, initialDelayMs);
        this.microstructureIntervalMs = Math.max(60_000, microstructureIntervalMs);
        this.timer = null;
        this.initialTimer = null;
        this.microstructureTimer = null;
        this.microstructureInFlight = false;
        this.microstructure = microstructure;
        this.researchMarkets = researchMarkets;
        this.statePath = statePath;
        this.fileSystem = fileSystem;
        this.resourceSnapshot = resourceSnapshot;
        this.minFreeRamGiB = minFreeRamGiB;
        this.maxSystemRamUsedRatio = maxSystemRamUsedRatio;
        this.resourceRetryMs = resourceRetryMs;
        this.resourceRetryTimer = null;
        this._lastPersistenceWarningAt = 0;
        this.child = null;
        this.state = { running: false, lastRunAt: null, lastExitCode: null, lastError: null };
        try { this.state = { ...this.state, ...JSON.parse(this.fileSystem.readFileSync(this.statePath, 'utf8')) }; } catch {}
    }

    start() {
        if (this.timer) return this.getStatus();
        this.timer = setInterval(() => this.runNow(), this.intervalMs);
        this.timer.unref?.();
        this.initialTimer = setTimeout(() => this.runNow(), this.initialDelayMs);
        this.initialTimer.unref?.();
        this.microstructureTimer = setInterval(() => this.sampleMicrostructure(), this.microstructureIntervalMs);
        this.microstructureTimer.unref?.();
        setTimeout(() => this.sampleMicrostructure(), 30_000).unref?.();
        return this.getStatus();
    }

    async sampleMicrostructure() {
        if (this.microstructureInFlight) return { skipped: true, reason: 'microstructure_sample_in_flight' };
        this._syncNewerExternalState();
        this.microstructureInFlight = true;
        try {
            const result = await this.microstructure.sample(this.researchMarkets.map(row => row.symbol));
            this.state.lastMicrostructureAt = new Date().toISOString();
            this.state.lastMicrostructureCount = result.sampled;
            this.state.lastMicrostructureError = null;
            this._save();
            return result;
        } catch (error) {
            this.state.lastMicrostructureError = error.message;
            this._save();
            return { sampled: 0, error: error.message };
        } finally {
            this.microstructureInFlight = false;
        }
    }

    runNow() {
        if (this.child) return { skipped: true, reason: 'research_cycle_already_running' };
        this._syncNewerExternalState();
        const gate = researchMemoryGate(this.resourceSnapshot(), {
            minFreeGiB: this.minFreeRamGiB, maxUsedRatio: this.maxSystemRamUsedRatio
        });
        if (!gate.allowed) {
            this.state.lastDeferredAt = new Date().toISOString();
            this.state.lastDeferredReason = gate.reason;
            this._save();
            if (!this.resourceRetryTimer) {
                this.resourceRetryTimer = setTimeout(() => {
                    this.resourceRetryTimer = null;
                    this.runNow();
                }, this.resourceRetryMs);
                this.resourceRetryTimer.unref?.();
            }
            return { deferred: true, reason: gate.reason };
        }
        if (this.resourceRetryTimer) clearTimeout(this.resourceRetryTimer);
        this.resourceRetryTimer = null;
        this.state.lastDeferredReason = null;
        const script = path.join(process.cwd(), 'scripts', 'run-active-trading-research.mjs');
        const child = spawn(process.execPath, [script], {
            cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
            env: { ...process.env, SOMA_TRADING_RESEARCH_CHILD: 'true' }
        });
        this.child = child;
        this.state.running = true;
        this.state.lastRunAt = new Date().toISOString();
        let errorOutput = '';
        child.stderr.on('data', chunk => { errorOutput += chunk.toString(); });
        child.once('error', error => {
            this.state.lastError = error.message;
            this.state.running = false;
            this.child = null;
            this._save();
        });
        child.once('close', code => {
            this.state.lastExitCode = code;
            this.state.lastError = code === 0 ? null : errorOutput.trim().slice(-2000);
            this.state.running = false;
            try {
                const progress = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'trading', 'research-progress.json'), 'utf8'));
                this.state.lastMeaningfulOutcome = progress.lastMeaningfulOutcome || null;
                this.state.experimentIndex = progress.experimentIndex || null;
                this.state.consecutiveNoQualified = progress.consecutiveNoQualified || 0;
            } catch {}
            this.child = null;
            this._save();
        });
        this._save();
        return { started: true, pid: child.pid, paperOnly: true };
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        if (this.initialTimer) clearTimeout(this.initialTimer);
        if (this.microstructureTimer) clearInterval(this.microstructureTimer);
        if (this.resourceRetryTimer) clearTimeout(this.resourceRetryTimer);
        this.timer = null;
        this.initialTimer = null;
        this.microstructureTimer = null;
        this.resourceRetryTimer = null;
    }

    _save() {
        const tempPath = `${this.statePath}.${process.pid}.tmp`;
        try {
            this.fileSystem.mkdirSync(path.dirname(this.statePath), { recursive: true });
            this.fileSystem.writeFileSync(tempPath, JSON.stringify(this.state, null, 2));
            this.fileSystem.renameSync(tempPath, this.statePath);
            if (this.state.lastPersistenceError) {
                this.state.lastPersistenceError = null;
                this.state.persistenceRecoveredAt = new Date().toISOString();
            }
            return true;
        } catch (error) {
            this.state.lastPersistenceError = `${error.code || 'WRITE_ERROR'}: ${error.message}`;
            this.state.lastPersistenceFailureAt = new Date().toISOString();
            try { this.fileSystem.rmSync?.(tempPath, { force: true }); } catch {}
            const now = Date.now();
            if (now - this._lastPersistenceWarningAt >= 5 * 60_000) {
                this._lastPersistenceWarningAt = now;
                console.warn('[TradingResearchDaemon] State persistence unavailable; research remains fail-safe:', this.state.lastPersistenceError);
            }
            return false;
        }
    }

    _syncNewerExternalState() {
        if (this.child) return false;
        try {
            const persisted = JSON.parse(this.fileSystem.readFileSync(this.statePath, 'utf8'));
            const persistedRun = Date.parse(persisted?.lastRunAt || '') || 0;
            const memoryRun = Date.parse(this.state?.lastRunAt || '') || 0;
            if (persistedRun <= memoryRun) return false;
            this.state = { ...this.state, ...persisted };
            return true;
        } catch {
            return false;
        }
    }

    getStatus() {
        this._syncNewerExternalState();
        return {
            active: Boolean(this.timer), intervalMs: this.intervalMs, initialDelayMs: this.initialDelayMs,
            microstructureActive: Boolean(this.microstructureTimer), microstructureIntervalMs: this.microstructureIntervalMs,
            ...this.state
        };
    }
}

export default new TradingResearchDaemon();
