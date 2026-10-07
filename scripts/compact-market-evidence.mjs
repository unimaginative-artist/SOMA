import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const ledger = path.join(process.cwd(), 'data', 'market-evidence', 'evidence-ledger.jsonl');
const limits = {
    market_data: 200, deep_scan: 250, simulation: 250, strategy_registry: 200,
    autonomous_decision: 500, paper_trade: 300, manual_broker_order: 200,
    performance: 200, promotion: 200, live_execution: 200, system: 100
};
const retained = new Map();
let inputRows = 0;
let invalidRows = 0;
const stream = fs.createReadStream(ledger, { encoding: 'utf8' });
const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
for await (const line of lines) {
    if (!line.trim()) continue;
    inputRows++;
    try {
        const row = JSON.parse(line);
        const type = String(row.type || 'system');
        const bucket = retained.get(type) || [];
        bucket.push(row);
        const limit = limits[type] || 100;
        if (bucket.length > limit) bucket.splice(0, bucket.length - limit);
        retained.set(type, bucket);
    } catch { invalidRows++; }
}
const rows = Array.from(retained.values()).flat()
    .sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
const temporary = `${ledger}.${process.pid}.compact`;
await fsp.writeFile(temporary, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
await fsp.rename(temporary, ledger);
console.log(JSON.stringify({ success: true, inputRows, invalidRows, retainedRows: rows.length }, null, 2));
