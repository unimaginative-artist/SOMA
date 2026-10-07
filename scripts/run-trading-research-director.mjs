import fs from 'node:fs/promises';
import path from 'node:path';
import { TradingResearchDirector } from '../server/finance/TradingResearchDirector.js';

async function read(file) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

const root = process.cwd();
const offline = await read(path.join(root, 'data', 'market-lab', 'offline-evolution-latest.json'));
const sim = await read(path.join(root, 'data', 'trading', 'sim-to-live-report.json'));
const candidates = [
    ...(offline?.qualifiedCandidates || []).map(row => row.candidate),
    ...(offline?.topCandidates || []).map(row => row.candidate),
    ...(sim?.paperQueue || [])
].filter(Boolean);
const unique = Array.from(new Map(candidates.map(candidate => [
    candidate.id || candidate.key || `${candidate.strategyId}:${candidate.symbol}`,
    candidate
])).values());

if (!unique.length) throw new Error('No compiled candidates were found in current SOMA reports');
const report = await new TradingResearchDirector().run({ candidates: unique });
console.log(JSON.stringify({ summary: report.summary, probes: report.probes }, null, 2));
