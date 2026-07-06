/**
 * server/BrainBridge.js
 *
 * Drop-in proxy for system.quadBrain that moves inference to a worker thread.
 *
 * Phase 1 (immediate): calls the real QuadBrain directly on the main thread.
 *   - Available from boot — no delay.
 *   - Falls back to this whenever the worker is unavailable.
 *
 * Phase 2 (after worker ready): routes reason() calls through BrainWorker.cjs.
 *   - Worker thread never blocks the HTTP event loop.
 *   - Main thread only sends/receives lightweight messages.
 *
 * Usage (SomaBootstrapV2.js):
 *   const bridge = new BrainBridge(system.quadBrain);
 *   system.quadBrain = bridge;
 *   bridge.startWorker().catch(err => console.warn('Worker failed:', err.message));
 */

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BrainBridge extends EventEmitter {
    constructor(directBrain) {
        super();

        // The real QuadBrain instance — always available as fallback
        this._direct = directBrain;

        // Worker state
        this._worker = null;
        this._pending = new Map();   // msgId → { resolve, reject, startTime }
        this._msgId = 0;
        this._useWorker = false;
        this._workerStarting = false;

        // Expose name for logging/status
        this.name = 'BrainBridge';
        this.version = directBrain?.version || '3.0.0-Bridge';

        // Stats
        this._stats = {
            totalCalls: 0,
            workerCalls: 0,
            directCalls: 0,
            errors: 0,
            avgLatencyMs: 0,
            byProvider: {},
            byLobe: {},
            byModel: {},
            routeMismatches: 0
        };
        this._localRollouts = Object.fromEntries(
            ['LOGOS', 'AURORA', 'PROMETHEUS', 'THALAMUS'].map(lobe => [
                lobe,
                Math.max(0, Math.min(100, Number(process.env[`SOMA_LOCAL_ROLLOUT_${lobe}`] || 0)))
            ])
        );

        console.log('[BrainBridge] Initialized — Phase 1 (direct) active');
    }

    // ── Start the worker thread ────────────────────────────────
    async startWorker(workerData = {}) {
        if (this._workerStarting || this._useWorker) return;
        this._workerStarting = true;

        return new Promise((resolve, reject) => {
            const workerPath = join(__dirname, 'workers', 'BrainWorker.cjs');

            console.log('[BrainBridge] Starting BrainWorker thread...');
            this._worker = new Worker(workerPath, { workerData });

            // Timeout: if worker doesn't become ready in 120s, give up
            const startupTimeout = setTimeout(() => {
                if (!this._useWorker) {
                    console.warn('[BrainBridge] Worker startup timed out — staying on direct brain');
                    this._workerStarting = false;
                    reject(new Error('BrainWorker startup timeout'));
                }
            }, 120_000);

            this._worker.on('message', async (msg) => {
                // ── Worker-ready signal ──
                if (msg.type === 'ready') {
                    clearTimeout(startupTimeout);
                    this._useWorker = true;
                    this._workerStarting = false;
                    console.log('[BrainBridge] ✅ Phase 2 active — inference is now non-blocking');
                    this.emit('worker_ready');
                    resolve();
                    return;
                }

                // ── Tool Execution Request from Worker ──
                if (msg.type === 'execute_tool') {
                    console.log(`[BrainBridge] 🛠️ Worker requested tool: ${msg.tool}`);
                    try {
                        const result = await this._direct.toolRegistry.execute(msg.tool, msg.args);
                        this._worker.postMessage({ type: 'tool_result', callId: msg.callId, result });
                    } catch (err) {
                        console.error(`[BrainBridge] Worker tool execution failed (${msg.tool}):`, err.message);
                        this._worker.postMessage({ type: 'tool_result', callId: msg.callId, error: err.message });
                    }
                    return;
                }

                if (msg.type === 'init_error') {
                    clearTimeout(startupTimeout);
                    this._workerStarting = false;
                    console.warn('[BrainBridge] Worker init failed:', msg.error);
                    reject(new Error(msg.error));
                    return;
                }

                // ── Response to pending call ──
                if (msg.id !== undefined) {
                    const pending = this._pending.get(msg.id);
                    if (!pending) return;
                    this._pending.delete(msg.id);

                    const latency = Date.now() - pending.startTime;
                    this._updateLatency(latency);

                    if (msg.type === 'error') {
                        this._stats.errors++;
                        pending.reject(new Error(msg.error));
                    } else {
                        pending.resolve(msg.result);
                    }
                }
            });

            this._worker.on('error', (err) => {
                console.error('[BrainBridge] Worker error:', err.message);
                this._stats.errors++;
                if (!this._useWorker) {
                    clearTimeout(startupTimeout);
                    this._workerStarting = false;
                    reject(err);
                }
            });

            this._worker.on('exit', (code) => {
                this._useWorker = false;
                this._workerStarting = false;
                clearTimeout(startupTimeout);
                console.warn(`[BrainBridge] Worker exited (code ${code}) — falling back to direct brain`);

                // Reject all in-flight requests so they fall back via caller retry
                for (const [id, pending] of this._pending) {
                    pending.reject(new Error('BrainWorker exited unexpectedly'));
                }
                this._pending.clear();

                this.emit('worker_exit', code);
            });
        });
    }

    // ── Main inference call ────────────────────────────────────
    async reason(query, context = {}) {
        this._stats.totalCalls++;
        const startTime = Date.now();
        const routedContext = await this._resolveRouting(query, context);

        let result;
        if (!this._useWorker) {
            // Phase 1: direct call on main thread
            this._stats.directCalls++;
            try {
                result = await this._direct.reason(query, routedContext);
            } catch (err) {
                this._stats.errors++;
                throw err;
            }
        } else {
            // Phase 2: route to worker thread
            this._stats.workerCalls++;
            const id = ++this._msgId;

            result = await new Promise((resolve, reject) => {
                // Safety: if pending map grows huge, fall back to direct
                if (this._pending.size > 50) {
                    console.warn('[BrainBridge] Worker queue full — falling back to direct for this call');
                    this._stats.directCalls++;
                    this._direct.reason(query, routedContext).then(resolve).catch(reject);
                    return;
                }

                this._pending.set(id, { resolve, reject, startTime });
                // Trim history before posting to worker — prevents unbounded message growth
                const workerContext = { ...routedContext };
                if (Array.isArray(workerContext.history) && workerContext.history.length > 20) {
                    workerContext.history = workerContext.history.slice(-20);
                }
                this._worker.postMessage({ id, type: 'reason', query, context: workerContext });
            });
        }

        // 🛠️ MAIN THREAD TOOL EXECUTION LOOP (Handles worker tool results)
        this._recordRouteResult(routedContext, result);

        if (result && result.toolCall && !routedContext.isAgenticTask && this._direct.toolRegistry) {
            const toolCall = result.toolCall;
            console.log(`[BrainBridge] 🛠️ Tool execution triggered: ${toolCall.tool} (ID: ${this._msgId})`);
            
            try {
                const toolOutput = await this._direct.toolRegistry.execute(toolCall.tool, toolCall.args);
                const outputStr = JSON.stringify(toolOutput);
                
                console.log(`[BrainBridge] ✅ Tool result for ${toolCall.tool}: ${outputStr.substring(0, 50)}...`);
                
                // Track usage
                result.toolsUsed = result.toolsUsed || [];
                result.toolsUsed.push({ tool: toolCall.tool, args: toolCall.args, output: toolOutput, timestamp: Date.now() });

                // Follow-up reasoning with tool result
                const followupContext = {
                    ...routedContext,
                    history: [...(routedContext.history || [])],
                    recentLearnings: (routedContext.recentLearnings || '') + `\n\nTOOL OUTPUT (${toolCall.tool}):\n${outputStr}`,
                    // FORCE natural language for the follow-up
                    systemOverride: "The requested tool has executed. Use the result provided in the history to answer the user's original question in natural language. DO NOT return any JSON."
                };
                
                // User-facing history injection
                followupContext.history.push({
                    role: 'user',
                    content: `System: Tool ${toolCall.tool} returned: ${outputStr}`
                });

                // RECURSIVE CALL: Re-run reasoning with result
                console.log(`[BrainBridge] 🔄 Re-reasoning with tool output...`);
                const followUp = await this.reason(query, followupContext);
                
                // Ensure the follow-up response text is clean
                if (followUp && followUp.text) {
                    followUp.text = followUp.text
                        .replace(/```json[\s\S]*?```/g, '')
                        .replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '')
                        .replace(/^\s*\}\s*$/, '')
                        .trim();
                }
                return followUp;

            } catch (err) {
                console.error(`[BrainBridge] Tool execution failed:`, err.message);
                result.text = (result.text || '') + `\n\n[Tool Error] I tried to use my ${toolCall.tool} tool, but hit a snag: ${err.message}`;
                return result;
            }
        }

        this._updateLatency(Date.now() - startTime);
        return result;
    }

    // ── Proxy other QuadBrain methods ──────────────────────────
    async initialize() {
        return this._direct?.initialize?.();
    }

    getStatus() {
        const direct = this._direct?.getStatus?.() ?? {};
        return {
            ...direct,
            name: this.name,
            bridge: {
                useWorker: this._useWorker,
                workerStarting: this._workerStarting,
                pendingCalls: this._pending.size,
                stats: this._stats
            },
            localRollouts: { ...this._localRollouts }
        };
    }

    // Delegate everything else to the direct brain
    setPersonality(p) { return this._direct?.setPersonality?.(p); }
    setLimbicState(s) { return this._direct?.setLimbicState?.(s); }
    async handleMessage(envelope) { return this._direct?.handleMessage?.(envelope); }

    async updateModels(models = {}) {
        if (models.baseModel) this._direct.ollamaModel = models.baseModel;
        if (models.lobeModels && this._direct?.lobeModels) {
            Object.assign(this._direct.lobeModels, models.lobeModels);
            this._direct._ollamaModelCache = { models: null, ts: 0 };
        }
        if (!this._useWorker) return { updated: true, worker: false };
        return this._requestWorker('update_models', models, 10000);
    }

    setLocalRollout(lobe, percent) {
        const key = String(lobe || '').toUpperCase();
        if (!(key in this._localRollouts)) throw new Error(`Unknown lobe: ${lobe}`);
        this._localRollouts[key] = Math.max(0, Math.min(100, Number(percent) || 0));
        return { lobe: key, percent: this._localRollouts[key] };
    }

    // ── Internal helpers ───────────────────────────────────────
    _updateLatency(ms) {
        const n = this._stats.totalCalls;
        this._stats.avgLatencyMs = Math.round(
            (this._stats.avgLatencyMs * (n - 1) + ms) / n
        );
    }

    async _resolveRouting(query, context = {}) {
        const valid = new Set(['LOGOS', 'AURORA', 'PROMETHEUS', 'THALAMUS']);
        const explicit = String(context.activeLobe || context.preferredBrain || context.brain || '').toUpperCase();
        if (valid.has(explicit)) {
            return this._applyLocalRollout(query, {
                ...context,
                activeLobe: explicit,
                routingDecision: context.routingDecision || { lobe: explicit, method: 'explicit_context', confidence: 1 }
            });
        }
        if (context.disableAdaptiveRouting || typeof this._direct?.router?.route !== 'function') return context;
        try {
            const decision = await this._direct.router.route(String(query || ''), context);
            const lobe = String(decision?.brain || '').toUpperCase();
            if (!valid.has(lobe)) return { ...context, routingDecision: decision || null };
            return this._applyLocalRollout(query, { ...context, activeLobe: lobe, routingDecision: { ...decision, lobe } });
        } catch (error) {
            return { ...context, routingDecision: { lobe: null, method: 'router_error', confidence: 0, error: error.message } };
        }
    }

    _applyLocalRollout(query, context) {
        if (context.forceLocal || context.disableLocalRollout) return context;
        const lobe = context.activeLobe;
        const percent = this._localRollouts[lobe] || 0;
        if (percent <= 0) return context;
        const key = `${context.sessionId || context.userId || ''}:${String(query || '')}`;
        let hash = 2166136261;
        for (let i = 0; i < key.length; i++) {
            hash ^= key.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        const bucket = (hash >>> 0) % 100;
        if (bucket >= percent) return context;
        return {
            ...context,
            forceLocal: true,
            routingDecision: { ...context.routingDecision, rollout: 'local_canary', rolloutPercent: percent, bucket }
        };
    }

    _recordRouteResult(context, result) {
        if (!result) return;
        const increment = (bucket, key) => {
            if (!key) return;
            bucket[key] = (bucket[key] || 0) + 1;
        };
        increment(this._stats.byProvider, result.provider || 'unknown');
        increment(this._stats.byLobe, result.brain || 'unknown');
        increment(this._stats.byModel, result.model || 'unknown');
        const requested = context?.routingDecision?.lobe || context?.activeLobe;
        if (requested && result.brain && requested !== result.brain) this._stats.routeMismatches++;
    }

    _requestWorker(type, payload = {}, timeoutMs = 10000) {
        const id = ++this._msgId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`BrainWorker ${type} timed out`));
            }, timeoutMs);
            this._pending.set(id, {
                startTime: Date.now(),
                resolve: value => { clearTimeout(timer); resolve(value); },
                reject: error => { clearTimeout(timer); reject(error); }
            });
            this._worker.postMessage({ id, type, ...payload });
        });
    }

    async shutdown() {
        if (this._worker) {
            await this._worker.terminate();
            this._worker = null;
        }
        this._useWorker = false;
    }
}

export default BrainBridge;
