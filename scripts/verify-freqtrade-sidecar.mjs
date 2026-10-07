import fs from 'node:fs/promises';
import path from 'node:path';
import { FreqtradeResearchSidecar } from '../server/finance/TradingEngineSidecars.js';

const root = process.cwd();
const candidateManifest = path.join(root, 'data', 'trading', 'sidecars', 'freqtrade', 'candidate.json');
const stored = JSON.parse(await fs.readFile(candidateManifest, 'utf8'));
const candidate = stored.sourceCandidate || stored;
const timeframe = candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H';
const symbol = candidate.symbol || candidate.compiledStrategy?.symbol;
const historyPath = path.join(root, 'data', 'trading', 'historical-cache', `${symbol}_${timeframe}.json`);
const bars = JSON.parse(await fs.readFile(historyPath, 'utf8'));
const result = await new FreqtradeResearchSidecar().validateCandidate(candidate, { bars });

console.log(JSON.stringify({
    engine: result.engine,
    status: result.status,
    passed: result.passed,
    checks: result.checks,
    candidateId: result.candidateId,
    strategyId: result.strategyId,
    historicalBars: result.historicalBars,
    receiptSha256: result.receiptSha256,
    receiptPath: result.receiptPath,
    policy: { paperOnly: result.paperOnly, liveExecutionAllowed: result.liveExecutionAllowed }
}, null, 2));

if (!result.passed) process.exitCode = 1;

