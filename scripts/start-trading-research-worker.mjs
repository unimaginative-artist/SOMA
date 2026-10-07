import { evaluateWalkForward } from '../server/finance/OfflineStrategyEvolutionLab.js';
import { fingerprintResearchEvaluator, TradingResearchWorkerServer } from '../server/finance/TradingResearchCluster.js';

const worker = new TradingResearchWorkerServer({
    host: process.env.SOMA_TRADING_WORKER_HOST || '127.0.0.1',
    port: Number(process.env.SOMA_TRADING_WORKER_PORT) || 7780,
    token: process.env.SOMA_TRADING_CLUSTER_TOKEN || '',
    evaluator: evaluateWalkForward,
    engineFingerprint: fingerprintResearchEvaluator(evaluateWalkForward)
});

await worker.start();
console.log(JSON.stringify({
    message: 'SOMA trading research worker ready',
    ...worker.status(),
    jobTypes: ['trading.walk_forward_batch'],
    liveOrderAuthority: false
}, null, 2));

const shutdown = async () => {
    await worker.close();
    process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
