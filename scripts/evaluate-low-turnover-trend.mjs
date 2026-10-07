import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateLowTurnoverTrend, LOW_TURNOVER_RESEARCH_VERSION, LOW_TURNOVER_SYMBOLS } from '../server/finance/LowTurnoverTrendResearch.js';

const results = [];
for (const symbol of LOW_TURNOVER_SYMBOLS) {
    try { results.push(await evaluateLowTurnoverTrend({ symbol })); }
    catch (error) { results.push({ symbol, passedExistingResearchGates: false, error: error.message }); }
}
const report = {
    schemaVersion: 1, version: LOW_TURNOVER_RESEARCH_VERSION,
    generatedAt: new Date().toISOString(), mode: 'research_only',
    candidateTrials: LOW_TURNOVER_SYMBOLS.length,
    allMarketsPassed: results.every(row => row.passedExistingResearchGates === true),
    paperExecutionAuthorized: false, liveExecutionAuthorized: false,
    results
};
const destination = path.join(process.cwd(), 'data', 'trading', 'low-turnover-research-latest.json');
await fs.mkdir(path.dirname(destination), { recursive: true });
const temporary = `${destination}.${process.pid}.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.rename(temporary, destination);
console.log(JSON.stringify({ report: destination, version: report.version,
    allMarketsPassed: report.allMarketsPassed,
    results: results.map(row => ({ symbol: row.symbol, bars: row.data?.bars,
        development: row.development, heldOut: row.heldOut && {
            trades: row.heldOut.trades, totalPnl: row.heldOut.totalPnl,
            profitFactor: row.heldOut.profitFactor, winRate: row.heldOut.winRate
        }, rejectionReasons: row.rejectionReasons, error: row.error })) }, null, 2));
