import fs from 'fs/promises';
import path from 'path';
import { Poseidon } from '../../core/Poseidon.js';

const ROOT = process.cwd();
const LOOP_LEDGER_FILE = path.join(ROOT, 'SOMA', 'loop-ledger.jsonl');
const poseidon = new Poseidon({ threshold: 0.75 });

function clean(value = '', max = 1000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function rel(filePath = '') {
    if (!filePath) return null;
    try { return path.relative(ROOT, filePath).replace(/\\/g, '/'); }
    catch { return String(filePath); }
}

export async function recordLoopEvent(entry = {}) {
    const timestamp = Number(entry.timestamp || Date.now());
    const claim = clean(entry.claim || `${entry.loop || 'loop'}:${entry.phase || 'event'}`, 500);
    const poseidonResult = await poseidon.verify(claim, {
        falsificationTest: entry.falsificationTest || null,
        testResult: entry.testResult
    });
    const record = {
        id: entry.id || `loop-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp,
        isoTime: new Date(timestamp).toISOString(),
        loop: clean(entry.loop || 'unknown', 80),
        phase: clean(entry.phase || 'event', 80),
        actor: clean(entry.actor || 'SOMA', 80),
        target: clean(entry.target || '', 120) || null,
        channel: clean(entry.channel || '', 80) || null,
        claim,
        poseidon: {
            state: poseidonResult.state,
            prefix: poseidonResult.prefix,
            reason: poseidonResult.reason
        },
        falsificationTest: entry.falsificationTest || null,
        evidence: entry.evidence || null,
        result: entry.result || null,
        privacy: entry.privacy || null,
        framePath: rel(entry.framePath || entry.imagePath || null),
        requestId: entry.requestId || null,
        nextStep: entry.nextStep || null
    };

    await fs.mkdir(path.dirname(LOOP_LEDGER_FILE), { recursive: true });
    await fs.appendFile(LOOP_LEDGER_FILE, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
}

export async function readLoopLedger(limit = 100, filter = {}) {
    try {
        const raw = await fs.readFile(LOOP_LEDGER_FILE, 'utf8');
        return raw.trim()
            .split(/\n+/)
            .filter(Boolean)
            .map(line => JSON.parse(line))
            .reverse()
            .filter(record => !filter.loop || record.loop === filter.loop)
            .slice(0, Math.max(1, Math.min(500, Number(limit || 100))));
    } catch {
        return [];
    }
}

export function loopLedgerPath() {
    return LOOP_LEDGER_FILE;
}

export default {
    recordLoopEvent,
    readLoopLedger,
    loopLedgerPath
};
