import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const LEDGER_PATH = path.join(ROOT, 'data', 'reality-ledger.jsonl');

async function appendJsonl(filePath, entry) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

export async function recordReality(claim, details = {}) {
    const entry = {
        id: details.id || `reality-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        claim: String(claim || '').slice(0, 500),
        status: details.status || 'VERIFIED_RESULT',
        proof: details.proof || null,
        source: details.source || 'epistemic_layer',
        artifactPath: details.artifactPath || null,
        metadata: details.metadata || null
    };
    await appendJsonl(LEDGER_PATH, entry);
    return entry;
}

export async function readRealityLedger(limit = 100) {
    try {
        const raw = await fs.readFile(LEDGER_PATH, 'utf8');
        return raw.trim().split(/\r?\n/)
            .filter(Boolean)
            .slice(-limit)
            .map(line => {
                try { return JSON.parse(line); }
                catch { return null; }
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

export { LEDGER_PATH as REALITY_LEDGER_PATH };
