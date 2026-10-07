import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const TRADING_RESEARCH_JOB_TYPE = 'trading.walk_forward_batch';
export const TRADING_RESEARCH_PROTOCOL_VERSION = 1;
export const TRADING_RESEARCH_ENGINE_VERSION = 'walk-forward-v1';

function specialNumberReplacer(_key, value) {
    if (typeof value !== 'number' || Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return { __somaNumber: 'NaN' };
    return { __somaNumber: value > 0 ? 'Infinity' : '-Infinity' };
}

function specialNumberReviver(_key, value) {
    if (!value || typeof value !== 'object' || !value.__somaNumber) return value;
    if (value.__somaNumber === 'Infinity') return Infinity;
    if (value.__somaNumber === '-Infinity') return -Infinity;
    if (value.__somaNumber === 'NaN') return NaN;
    return value;
}

export function stringifyResearchPayload(value) {
    return JSON.stringify(value, specialNumberReplacer);
}

export function parseResearchPayload(value) {
    return JSON.parse(value, specialNumberReviver);
}

function canonicalize(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return { __somaNumber: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

export function hashResearchValue(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function fingerprintResearchEvaluator(evaluator) {
    return hashResearchValue({
        engineVersion: TRADING_RESEARCH_ENGINE_VERSION,
        evaluatorSource: typeof evaluator === 'function' ? evaluator.toString() : null
    });
}

export function buildWalkForwardJob({ datasetKey, bars, candidates, folds, initialCapital, generation = 0, engineFingerprint } = {}) {
    if (!datasetKey || !Array.isArray(bars) || bars.length < 120 || !Array.isArray(candidates) || !candidates.length) {
        throw new Error('invalid_walk_forward_job_input');
    }
    const datasetHash = hashResearchValue(bars);
    const candidateHashes = candidates.map(candidate => hashResearchValue(candidate));
    const identity = {
        type: TRADING_RESEARCH_JOB_TYPE,
        version: TRADING_RESEARCH_PROTOCOL_VERSION,
        datasetKey,
        datasetHash,
        candidateHashes,
        folds: Math.max(2, Math.min(5, Number(folds) || 3)),
        initialCapital: Number(initialCapital) || 10000,
        generation: Math.max(0, Number(generation) || 0),
        engineFingerprint: String(engineFingerprint || TRADING_RESEARCH_ENGINE_VERSION)
    };
    return {
        ...identity,
        jobId: hashResearchValue(identity),
        bars,
        candidates
    };
}

export function validateWalkForwardJob(job = {}) {
    if (job.type !== TRADING_RESEARCH_JOB_TYPE) throw new Error('unregistered_job_type');
    if (job.version !== TRADING_RESEARCH_PROTOCOL_VERSION) throw new Error('unsupported_protocol_version');
    if (!job.jobId || !job.datasetKey || !Array.isArray(job.bars) || job.bars.length < 120) throw new Error('invalid_job_dataset');
    if (!Array.isArray(job.candidates) || !job.candidates.length || job.candidates.length > 128) throw new Error('invalid_job_candidates');
    const datasetHash = hashResearchValue(job.bars);
    if (datasetHash !== job.datasetHash) throw new Error('dataset_hash_mismatch');
    const candidateHashes = job.candidates.map(candidate => hashResearchValue(candidate));
    if (candidateHashes.some((value, index) => value !== job.candidateHashes?.[index])) throw new Error('candidate_hash_mismatch');
    const expectedId = hashResearchValue({
        type: job.type,
        version: job.version,
        datasetKey: job.datasetKey,
        datasetHash,
        candidateHashes,
        folds: job.folds,
        initialCapital: job.initialCapital,
        generation: job.generation,
        engineFingerprint: job.engineFingerprint
    });
    if (expectedId !== job.jobId) throw new Error('job_identity_mismatch');
    return { datasetHash, candidateHashes };
}

function secureTokenEqual(received, expected) {
    const left = Buffer.from(String(received || ''));
    const right = Buffer.from(String(expected || ''));
    return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

async function atomicWriteJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${stringifyResearchPayload(value)}\n`, 'utf8');
    await fs.rename(temporary, file);
}

async function readRequestBody(req, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) throw new Error('payload_too_large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function respond(res, status, payload) {
    const body = stringifyResearchPayload(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
    });
    res.end(body);
}

export class TradingResearchWorkerServer {
    constructor(options = {}) {
        this.host = options.host || '127.0.0.1';
        this.port = options.port === 0 ? 0 : (Number(options.port) || 7780);
        this.token = String(options.token || '');
        this.evaluator = options.evaluator;
        this.engineFingerprint = String(options.engineFingerprint || TRADING_RESEARCH_ENGINE_VERSION);
        this.workerId = options.workerId || `${os.hostname()}-${process.pid}`;
        this.cacheDir = options.cacheDir || path.join(process.cwd(), 'data', 'trading', 'worker-cache');
        this.maxPayloadBytes = Math.max(1_000_000, Number(options.maxPayloadBytes) || 64 * 1024 * 1024);
        this.server = null;
        this.inFlight = new Map();
        this.metrics = { received: 0, completed: 0, cacheHits: 0, failed: 0 };
    }

    async execute(job) {
        if (typeof this.evaluator !== 'function') throw new Error('worker_evaluator_not_configured');
        const { candidateHashes } = validateWalkForwardJob(job);
        if (job.engineFingerprint !== this.engineFingerprint) throw new Error('research_engine_mismatch');
        const cachePath = path.join(this.cacheDir, `${job.jobId}.json`);
        try {
            const cached = parseResearchPayload(await fs.readFile(cachePath, 'utf8'));
            if (cached.jobId === job.jobId && cached.datasetHash === job.datasetHash) {
                this.metrics.cacheHits++;
                return { ...cached, cached: true };
            }
        } catch {}
        if (this.inFlight.has(job.jobId)) return this.inFlight.get(job.jobId);
        const promise = (async () => {
            const started = Date.now();
            const evaluations = [];
            for (let index = 0; index < job.candidates.length; index++) {
                evaluations.push({
                    candidateHash: candidateHashes[index],
                    evaluation: await this.evaluator({
                        bars: job.bars,
                        candidate: job.candidates[index],
                        folds: job.folds,
                        initialCapital: job.initialCapital
                    })
                });
            }
            const receipt = {
                success: true,
                jobId: job.jobId,
                type: job.type,
                version: job.version,
                datasetKey: job.datasetKey,
                datasetHash: job.datasetHash,
                workerId: this.workerId,
                liveOrderAuthority: false,
                durationMs: Date.now() - started,
                evaluations
            };
            await atomicWriteJson(cachePath, receipt);
            this.metrics.completed++;
            return receipt;
        })().finally(() => this.inFlight.delete(job.jobId));
        this.inFlight.set(job.jobId, promise);
        return promise;
    }

    async start() {
        const exposed = !['127.0.0.1', 'localhost', '::1'].includes(this.host);
        if (exposed && this.token.length < 16) throw new Error('cluster_token_required_for_remote_binding');
        this.server = http.createServer(async (req, res) => {
            if (req.method === 'GET' && req.url === '/health') {
                return respond(res, 200, {
                    status: 'ok', workerId: this.workerId,
                    capabilities: [TRADING_RESEARCH_JOB_TYPE],
                    engineFingerprint: this.engineFingerprint,
                    liveOrderAuthority: false, metrics: this.metrics
                });
            }
            if (req.method !== 'POST' || req.url !== '/v1/trading-research/jobs') {
                return respond(res, 404, { success: false, error: 'not_found' });
            }
            if (this.token && !secureTokenEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ''), this.token)) {
                return respond(res, 401, { success: false, error: 'unauthorized' });
            }
            this.metrics.received++;
            try {
                const job = parseResearchPayload(await readRequestBody(req, this.maxPayloadBytes));
                return respond(res, 200, await this.execute(job));
            } catch (error) {
                this.metrics.failed++;
                const status = error.message === 'payload_too_large' ? 413 : 400;
                return respond(res, status, { success: false, error: error.message, workerId: this.workerId });
            }
        });
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.port, this.host, resolve);
        });
        const address = this.server.address();
        if (address && typeof address === 'object') this.port = address.port;
        return this.status();
    }

    status() {
        return {
            workerId: this.workerId,
            host: this.host,
            port: this.port,
            url: `http://${this.host}:${this.port}`,
            liveOrderAuthority: false,
            engineFingerprint: this.engineFingerprint,
            metrics: { ...this.metrics }
        };
    }

    async close() {
        if (!this.server) return;
        await new Promise(resolve => this.server.close(resolve));
        this.server = null;
    }
}

function normalizeWorkerUrls(input) {
    const values = Array.isArray(input) ? input : String(input || '').split(',');
    return [...new Set(values.map(value => String(value).trim().replace(/\/$/, '')).filter(Boolean))];
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
}

export class TradingResearchClusterCoordinator {
    constructor(options = {}) {
        this.workerUrls = normalizeWorkerUrls(options.workerUrls ?? process.env.SOMA_TRADING_RESEARCH_WORKERS);
        this.token = String(options.token ?? process.env.SOMA_TRADING_CLUSTER_TOKEN ?? '');
        this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 120000);
        this.retries = Math.max(0, Math.min(3, Number(options.retries ?? 1)));
        this.batchSize = Math.max(1, Math.min(128, Number(options.batchSize) || 24));
        this.receiptPath = options.receiptPath || path.join(process.cwd(), 'data', 'trading', 'distributed-research-receipts.jsonl');
        this.fetchImpl = options.fetchImpl || fetchWithTimeout;
        this.engineFingerprint = String(options.engineFingerprint || TRADING_RESEARCH_ENGINE_VERSION);
        this.datasetHashes = new WeakMap();
        this.metrics = { remoteJobs: 0, remoteEvaluations: 0, localEvaluations: 0, retries: 0, fallbacks: 0, failures: 0 };
        this.nextWorker = 0;
        this.healthyWorkerUrls = null;
    }

    get enabled() { return this.workerUrls.length > 0; }

    configurationStatus() {
        const remoteWorkers = this.workerUrls.filter(url => {
            try { return !['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname); }
            catch { return true; }
        });
        if (!this.workerUrls.length) return { configured: false, reason: 'worker_urls_not_configured', remoteWorkers: 0 };
        if (remoteWorkers.length && this.token.length < 16) {
            return { configured: false, reason: 'remote_workers_require_shared_token', remoteWorkers: remoteWorkers.length };
        }
        return { configured: true, reason: null, remoteWorkers: remoteWorkers.length };
    }

    async probe() {
        const configuration = this.configurationStatus();
        if (!configuration.configured) {
            this.healthyWorkerUrls = [];
            return { enabled: this.enabled, healthy: 0, workers: [], configuration };
        }
        const workers = await Promise.all(this.workerUrls.map(async url => {
            try {
                const response = await this.fetchImpl(`${url}/health`, { method: 'GET' }, Math.min(this.timeoutMs, 5000));
                const body = parseResearchPayload(await response.text());
                return {
                    url,
                    healthy: response.ok && body.liveOrderAuthority === false && body.engineFingerprint === this.engineFingerprint,
                    ...body
                };
            } catch (error) { return { url, healthy: false, error: error.message }; }
        }));
        this.healthyWorkerUrls = workers.filter(row => row.healthy).map(row => row.url);
        return { enabled: this.enabled, healthy: this.healthyWorkerUrls.length, workers, configuration };
    }

    async _appendReceipt(receipt) {
        await fs.mkdir(path.dirname(this.receiptPath), { recursive: true });
        await fs.appendFile(this.receiptPath, `${stringifyResearchPayload(receipt)}\n`, 'utf8');
    }

    async _dispatch(job, preferredIndex) {
        let lastError = null;
        const workerUrls = this.healthyWorkerUrls?.length ? this.healthyWorkerUrls : this.workerUrls;
        for (let attempt = 0; attempt <= this.retries; attempt++) {
            const url = workerUrls[(preferredIndex + attempt) % workerUrls.length];
            try {
                const response = await this.fetchImpl(`${url}/v1/trading-research/jobs`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
                    },
                    body: stringifyResearchPayload(job)
                }, this.timeoutMs);
                const payload = parseResearchPayload(await response.text());
                if (!response.ok || !payload.success) throw new Error(payload.error || `worker_http_${response.status}`);
                if (payload.jobId !== job.jobId || payload.datasetHash !== job.datasetHash || payload.liveOrderAuthority !== false) {
                    throw new Error('invalid_worker_receipt');
                }
                if (!Array.isArray(payload.evaluations) || payload.evaluations.length !== job.candidates.length) {
                    throw new Error('incomplete_worker_result');
                }
                for (let index = 0; index < payload.evaluations.length; index++) {
                    if (payload.evaluations[index].candidateHash !== job.candidateHashes[index]) throw new Error('worker_candidate_mismatch');
                }
                this.metrics.remoteJobs++;
                this.metrics.remoteEvaluations += payload.evaluations.length;
                await this._appendReceipt({
                    recordedAt: new Date().toISOString(), source: 'remote', url,
                    jobId: job.jobId, datasetHash: job.datasetHash,
                    workerId: payload.workerId, durationMs: payload.durationMs,
                    evaluations: payload.evaluations.length, cached: Boolean(payload.cached)
                });
                return payload.evaluations.map(row => row.evaluation);
            } catch (error) {
                lastError = error;
                if (attempt < this.retries) this.metrics.retries++;
            }
        }
        this.metrics.failures++;
        throw lastError || new Error('cluster_dispatch_failed');
    }

    async evaluateCandidates({ items = [], folds = 3, initialCapital = 10000, generation = 0, evaluator } = {}) {
        if (typeof evaluator !== 'function') throw new Error('local_fallback_evaluator_required');
        const output = new Array(items.length);
        const supported = [];
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            if (!Array.isArray(item?.bars) || item.bars.length < 120 || !item.candidate) {
                output[index] = await evaluator(item || {});
            } else supported.push({ ...item, outputIndex: index });
        }
        if (!this.enabled) {
            for (const item of supported) output[item.outputIndex] = await evaluator(item);
            this.metrics.localEvaluations += supported.length;
            return output;
        }
        const groups = new Map();
        for (const item of supported) {
            let datasetHash = this.datasetHashes.get(item.bars);
            if (!datasetHash) {
                datasetHash = hashResearchValue(item.bars);
                this.datasetHashes.set(item.bars, datasetHash);
            }
            const datasetKey = item.datasetKey || 'dataset';
            const groupKey = `${datasetKey}:${datasetHash}`;
            if (!groups.has(groupKey)) groups.set(groupKey, { datasetKey, items: [] });
            groups.get(groupKey).items.push(item);
        }
        const batches = [];
        for (const group of groups.values()) {
            for (let offset = 0; offset < group.items.length; offset += this.batchSize) {
                batches.push({ datasetKey: group.datasetKey, items: group.items.slice(offset, offset + this.batchSize) });
            }
        }
        let localFallbacks = 0;
        await Promise.all(batches.map(async (batch, batchIndex) => {
            const job = buildWalkForwardJob({
                datasetKey: batch.datasetKey,
                bars: batch.items[0].bars,
                candidates: batch.items.map(item => item.candidate),
                folds, initialCapital, generation,
                engineFingerprint: this.engineFingerprint
            });
            try {
                const evaluations = await this._dispatch(job, (this.nextWorker + batchIndex) % this.workerUrls.length);
                batch.items.forEach((item, index) => { output[item.outputIndex] = evaluations[index]; });
            } catch (error) {
                this.metrics.fallbacks += batch.items.length;
                localFallbacks += batch.items.length;
                for (const item of batch.items) output[item.outputIndex] = await evaluator(item);
                await this._appendReceipt({
                    recordedAt: new Date().toISOString(), source: 'local_fallback',
                    jobId: job.jobId, datasetHash: job.datasetHash,
                    evaluations: batch.items.length, error: error.message
                });
            }
        }));
        this.nextWorker = (this.nextWorker + batches.length) % this.workerUrls.length;
        this.metrics.localEvaluations += localFallbacks;
        return output;
    }

    status() {
        return {
            enabled: this.enabled,
            configuration: this.configurationStatus(),
            workers: [...this.workerUrls],
            healthyWorkers: [...(this.healthyWorkerUrls || [])],
            engineFingerprint: this.engineFingerprint,
            liveOrderAuthority: false,
            metrics: { ...this.metrics }
        };
    }
}

export default TradingResearchClusterCoordinator;
