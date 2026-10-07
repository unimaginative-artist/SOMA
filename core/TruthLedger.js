import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const LEDGER_PATH = path.join(ROOT, 'data', 'truth-ledger.jsonl');

async function appendJsonl(filePath, entry) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

export async function recordTruth(claim, details = {}) {
    const entry = {
        id: details.id || `truth-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        claim: String(claim || '').slice(0, 500),
        status: details.status || 'observed',
        confidence: typeof details.confidence === 'number' ? details.confidence : null,
        proof: details.proof || null,
        source: details.source || 'soma',
        artifactPath: details.artifactPath || null,
        metadata: details.metadata || null
    };
    await appendJsonl(LEDGER_PATH, entry);
    return entry;
}

export async function recordCapabilityTruth(capability, details = {}) {
    return recordTruth(`Capability: ${capability}`, {
        status: details.verified ? 'verified' : details.status || 'unverified',
        confidence: details.verified ? 1 : details.confidence ?? 0.5,
        proof: details.proof || details.evidence || null,
        source: details.source || 'capability_contract',
        artifactPath: details.artifactPath || null,
        metadata: {
            capability,
            ...details.metadata
        }
    });
}

export async function readTruthLedger(limit = 100) {
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

export { LEDGER_PATH as TRUTH_LEDGER_PATH };
