import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';

const label = String(process.argv[2] || 'snapshot').replace(/[^a-zA-Z0-9_-]/g, '-');
const directory = path.resolve('data/repair-verification', `${Date.now()}-${label}`);
await fs.mkdir(directory, { recursive: true });
const read = async url => { const res = await fetch(url, { signal: AbortSignal.timeout(15000) }); return res.json(); };
const [health, autonomy, paper, max, supervisor] = await Promise.all([
    read('http://127.0.0.1:3001/health'), read('http://127.0.0.1:3001/api/autonomy/health'),
    read('http://127.0.0.1:3001/api/autonomous/status'), read('http://127.0.0.1:3100/health'), read('http://127.0.0.1:9000/ping'),
]);
const db = new Database('data/trading/trades.db', { readonly: true });
const openTrades = db.prepare("SELECT id,symbol,side,qty,entry_price,status FROM trades WHERE lower(status) = 'open'").all();
await db.backup(path.join(directory, 'trades.db'));
db.close();
for (const file of ['data/goals.json', 'data/trading/trading-intent.json', 'data/trading/mission-control-runtime.json', 'server/.soma/asi_cycles.json',
    'data/self-evolution/research/ledger.json', 'data/self-evolution/experiments.json']) {
    try { const target = path.join(directory, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(file, target); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const report = { at: new Date().toISOString(), health: health.status,
    checks: autonomy.checks, selfModification: autonomy.selfModification,
    paper: paper.instances?.map(item => ({ symbol: item.symbol, paperMode: item.paperMode, isRunning: item.isRunning })),
    openTrades, max: { status: max.status, ready: max.ready, boundedRepairProtocol: max.boundedRepairProtocol || null }, supervisor };
await fs.writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ directory, health: report.health, paper: report.paper, openTrades, max: report.max, supervisor }, null, 2));
