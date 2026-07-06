import fs from 'node:fs';
import path from 'node:path';

const RECEIPT_DIR = path.join(process.cwd(), 'data', 'goal-receipts');
const SIMULATION_LEDGER = path.join(process.cwd(), 'data', 'simulation', 'autonomy-ledger.json');
const STOPWORDS = new Set(['about', 'after', 'again', 'against', 'before', 'being', 'could', 'from', 'have', 'into', 'just', 'need', 'that', 'their', 'then', 'there', 'these', 'this', 'through', 'with', 'would', 'your']);
let receiptCache = { signature: null, values: [] };
let simulationCache = { signature: null, values: [] };

function tokens(value = '') {
    return new Set(String(value).toLowerCase().match(/[a-z0-9]{4,}/g)?.filter(token => !STOPWORDS.has(token)) || []);
}

function overlap(left, right) {
    const a = tokens(left);
    const b = tokens(right);
    let count = 0;
    for (const token of a) if (b.has(token)) count++;
    return count;
}

function recent(timestamp, maxAgeMs, now) {
    const value = Date.parse(timestamp || '');
    return Number.isFinite(value) && now - value >= 0 && now - value <= maxAgeMs;
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function loadReceipts() {
    if (!fs.existsSync(RECEIPT_DIR)) return [];
    const signature = fs.statSync(RECEIPT_DIR).mtimeMs;
    if (receiptCache.signature === signature) return receiptCache.values;
    const values = fs.readdirSync(RECEIPT_DIR, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => {
            const file = path.join(RECEIPT_DIR, entry.name);
            return { name: entry.name, file, mtimeMs: fs.statSync(file).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 250);
    receiptCache = { signature, values };
    return values;
}

function loadSimulations() {
    if (!fs.existsSync(SIMULATION_LEDGER)) return [];
    const signature = fs.statSync(SIMULATION_LEDGER).mtimeMs;
    if (simulationCache.signature === signature) return simulationCache.values;
    const parsed = readJson(SIMULATION_LEDGER, []);
    const values = Array.isArray(parsed) ? parsed.slice(0, 250) : [];
    simulationCache = { signature, values };
    return values;
}

export function findActionEvidence({ text = '', query = '', now = Date.now(), maxAgeMs = 24 * 60 * 60_000 } = {}) {
    const needle = tokens(text).size >= 2 ? text : query;
    const evidence = [];

    if (fs.existsSync(RECEIPT_DIR)) {
        for (const item of loadReceipts()) {
            const receipt = readJson(item.file, null);
            if (!receipt || !recent(receipt.createdAt, maxAgeMs, now)) continue;
            const haystack = `${receipt.goalTitle || ''} ${receipt.result || ''} ${(receipt.toolsUsed || []).join(' ')}`;
            if (overlap(needle, haystack) < 2) continue;
            evidence.push({
                kind: 'goal_receipt',
                id: receipt.receiptId,
                goalId: receipt.goalId,
                title: receipt.goalTitle,
                status: receipt.lifecycleState,
                complete: receipt.done === true,
                tools: Array.isArray(receipt.toolsUsed) ? receipt.toolsUsed : [],
                createdAt: receipt.createdAt,
                path: path.relative(process.cwd(), item.file).replace(/\\/g, '/')
            });
        }
    }

    for (const run of loadSimulations()) {
        if (!recent(run.updatedAt || run.createdAt, maxAgeMs, now)) continue;
        const haystack = `${run.module || ''} ${run.kind || ''} ${run.summary || ''} ${(run.evidence || []).join(' ')}`;
        if (overlap(needle, haystack) < 2) continue;
        evidence.push({
            kind: 'simulation_run',
            id: run.id,
            title: run.summary || run.module,
            status: run.status,
            complete: ['completed', 'observed', 'passed'].includes(String(run.status).toLowerCase()),
            createdAt: run.updatedAt || run.createdAt,
            path: path.relative(process.cwd(), SIMULATION_LEDGER).replace(/\\/g, '/')
        });
    }
    return evidence.slice(0, 8);
}

export default { findActionEvidence };
