import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateWalkForward } from '../server/finance/OfflineStrategyEvolutionLab.js';
import {
    buildWalkForwardJob,
    fingerprintResearchEvaluator,
    hashResearchValue,
    TradingResearchClusterCoordinator,
    TradingResearchWorkerServer,
    validateWalkForwardJob
} from '../server/finance/TradingResearchCluster.js';

function bars(count = 180) {
    let close = 100;
    return Array.from({ length: count }, (_, index) => {
        close *= 1 + (index % 30 < 20 ? 0.002 : -0.003);
        return {
            timestamp: 1700000000000 + index * 3600000,
            open: close * 0.999, high: close * 1.004, low: close * 0.996,
            close, volume: 1000 + index
        };
    });
}

function candidate(id = 'cluster-fixture') {
    return {
        id, strategyId: 'cluster_fixture', symbol: 'BTC-USD',
        compiledStrategy: {
            paperOnly: true,
            dsl: {
                entry: {
                    mode: 'trend', direction: 'long_only', allowedRegimes: ['ALL'],
                    fastWindow: 6, slowWindow: 18, minMomentum: 0.001,
                    minVolumeRatio: 0.5, minVolatilityPct: 0
                },
                exit: {
                    stopLossPct: 0.02, takeProfitPct: 0.05,
                    trailingStopPct: 0.015, maxPositionAgeMs: 48 * 3600000
                },
                sizing: { maxPositionPct: 0.03, maxPaperTradeValue: 250 },
                execution: { timeframe: '1H', style: 'taker_market' }
            }
        }
    };
}

test('trading research jobs are deterministic and reject mutated or arbitrary work', () => {
    const inputBars = bars();
    const fixture = candidate();
    const first = buildWalkForwardJob({
        datasetKey: 'BTC-USD:1H', bars: inputBars, candidates: [fixture], folds: 3, initialCapital: 10000, generation: 2
    });
    const repeated = buildWalkForwardJob({
        datasetKey: 'BTC-USD:1H', bars: inputBars, candidates: [fixture], folds: 3, initialCapital: 10000, generation: 2
    });
    assert.equal(first.jobId, repeated.jobId);
    assert.equal(first.datasetHash, hashResearchValue(inputBars));
    assert.doesNotThrow(() => validateWalkForwardJob(first));
    assert.throws(() => validateWalkForwardJob({ ...first, type: 'broker.place_order' }), /unregistered_job_type/);
    const tampered = structuredClone(first);
    tampered.bars[0].close += 1;
    assert.throws(() => validateWalkForwardJob(tampered), /dataset_hash_mismatch/);
});

test('authenticated worker is idempotent and distributed output equals local evaluation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-trading-cluster-'));
    const token = 'fixture-cluster-token-123456';
    let evaluations = 0;
    const worker = new TradingResearchWorkerServer({
        host: '127.0.0.1', port: 0, token,
        cacheDir: path.join(root, 'cache'),
        evaluator: input => { evaluations++; return evaluateWalkForward(input); },
        engineFingerprint: fingerprintResearchEvaluator(evaluateWalkForward)
    });
    try {
        await worker.start();
        const inputBars = bars();
        const fixture = candidate();
        const coordinator = new TradingResearchClusterCoordinator({
            workerUrls: [`http://127.0.0.1:${worker.port}`], token,
            receiptPath: path.join(root, 'receipts.jsonl'), timeoutMs: 10000, retries: 0,
            engineFingerprint: fingerprintResearchEvaluator(evaluateWalkForward)
        });
        const local = evaluateWalkForward({ bars: inputBars, candidate: fixture, folds: 3, initialCapital: 10000 });
        const run = () => coordinator.evaluateCandidates({
            items: [{ datasetKey: 'BTC-USD:1H', bars: inputBars, candidate: fixture }],
            folds: 3, initialCapital: 10000, generation: 1,
            evaluator: item => evaluateWalkForward({ bars: item.bars, candidate: item.candidate, folds: 3, initialCapital: 10000 })
        });
        assert.deepEqual((await run())[0], local);
        assert.deepEqual((await run())[0], local);
        assert.equal(evaluations, 1, 'the second identical job should use the worker cache');
        assert.equal(worker.metrics.cacheHits, 1);
        assert.equal(coordinator.status().liveOrderAuthority, false);
        assert.equal((await coordinator.probe()).healthy, 1);
        assert.equal((await fs.readFile(path.join(root, 'receipts.jsonl'), 'utf8')).trim().split(/\r?\n/).length, 2);
    } finally {
        await worker.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('worker authentication fails closed and coordinator recovers locally', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-trading-fallback-'));
    const worker = new TradingResearchWorkerServer({
        host: '127.0.0.1', port: 0, token: 'correct-token-123456789',
        cacheDir: path.join(root, 'cache'), evaluator: evaluateWalkForward,
        engineFingerprint: fingerprintResearchEvaluator(evaluateWalkForward)
    });
    try {
        await worker.start();
        const inputBars = bars();
        const fixture = candidate();
        let localCalls = 0;
        const coordinator = new TradingResearchClusterCoordinator({
            workerUrls: [`http://127.0.0.1:${worker.port}`], token: 'wrong-token-123456789',
            receiptPath: path.join(root, 'receipts.jsonl'), timeoutMs: 3000, retries: 1,
            engineFingerprint: fingerprintResearchEvaluator(evaluateWalkForward)
        });
        const result = await coordinator.evaluateCandidates({
            items: [{ datasetKey: 'BTC-USD:1H', bars: inputBars, candidate: fixture }],
            folds: 3, initialCapital: 10000,
            evaluator: item => {
                localCalls++;
                return evaluateWalkForward({ bars: item.bars, candidate: item.candidate, folds: 3, initialCapital: 10000 });
            }
        });
        assert.equal(result.length, 1);
        assert.equal(localCalls, 1);
        assert.equal(coordinator.metrics.retries, 1);
        assert.equal(coordinator.metrics.fallbacks, 1);
        assert.equal(coordinator.metrics.localEvaluations, 1);
    } finally {
        await worker.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('candidate shards are spread across healthy workers', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-trading-shards-'));
    const token = 'shard-token-1234567890';
    const evaluator = ({ candidate }) => ({
        supported: true, fitness: candidate.id === 'alpha' ? 2 : 1,
        candidateId: candidate.id
    });
    const engineFingerprint = fingerprintResearchEvaluator(evaluator);
    const workers = [0, 1].map(index => new TradingResearchWorkerServer({
        host: '127.0.0.1', port: 0, token, evaluator, engineFingerprint,
        cacheDir: path.join(root, `cache-${index}`), workerId: `worker-${index}`
    }));
    try {
        await Promise.all(workers.map(worker => worker.start()));
        const inputBars = bars();
        const coordinator = new TradingResearchClusterCoordinator({
            workerUrls: workers.map(worker => `http://127.0.0.1:${worker.port}`),
            token, engineFingerprint, batchSize: 1, retries: 0,
            receiptPath: path.join(root, 'receipts.jsonl')
        });
        assert.equal((await coordinator.probe()).healthy, 2);
        const results = await coordinator.evaluateCandidates({
            items: [candidate('alpha'), candidate('beta')].map(value => ({
                datasetKey: 'BTC-USD:1H', bars: inputBars, candidate: value
            })),
            evaluator: ({ candidate: value }) => evaluator({ candidate: value })
        });
        assert.deepEqual(results.map(result => result.candidateId), ['alpha', 'beta']);
        assert.deepEqual(workers.map(worker => worker.metrics.completed), [1, 1]);
        assert.equal(coordinator.metrics.remoteJobs, 2);
        assert.equal(coordinator.metrics.remoteEvaluations, 2);
    } finally {
        await Promise.all(workers.map(worker => worker.close()));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('remote-bound research workers require a shared secret and contain no order authority', async () => {
    const worker = new TradingResearchWorkerServer({ host: '0.0.0.0', port: 0, evaluator: evaluateWalkForward });
    await assert.rejects(() => worker.start(), /cluster_token_required/);
    const source = await fs.readFile(new URL('../server/finance/TradingResearchCluster.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /AlpacaService|placeOrder|submitOrder|autonomousTrader/);
});

test('coordinator reports missing configuration and never probes an insecure remote worker', async () => {
    let fetchCalls = 0;
    const coordinator = new TradingResearchClusterCoordinator({
        workerUrls: ['http://192.168.1.42:7788'],
        token: '',
        fetchImpl: async () => { fetchCalls++; throw new Error('must not be called'); }
    });
    assert.deepEqual(coordinator.configurationStatus(), {
        configured: false,
        reason: 'remote_workers_require_shared_token',
        remoteWorkers: 1
    });
    const probe = await coordinator.probe();
    assert.equal(probe.healthy, 0);
    assert.equal(probe.configuration.reason, 'remote_workers_require_shared_token');
    assert.equal(fetchCalls, 0);
    assert.equal(coordinator.status().configuration.configured, false);
});

test('coordinator truthfully reports when no research workers are configured', async () => {
    const coordinator = new TradingResearchClusterCoordinator({ workerUrls: [], token: '' });
    assert.equal(coordinator.configurationStatus().reason, 'worker_urls_not_configured');
    const probe = await coordinator.probe();
    assert.equal(probe.enabled, false);
    assert.equal(probe.configuration.configured, false);
});
