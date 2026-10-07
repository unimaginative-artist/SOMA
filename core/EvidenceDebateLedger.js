import fs from 'fs/promises';
import path from 'path';
import { recordTruth } from './TruthLedger.js';

const ROOT = process.cwd();
const DEBATE_LEDGER_PATH = path.join(ROOT, 'data', 'evidence-debate-ledger.jsonl');

function hasText(value) {
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

export function validateEvidenceDebate(debate = {}) {
    const required = ['proposal', 'evidence', 'counterexample', 'testPlan', 'verdict'];
    const missing = required.filter(key => !hasText(debate[key]) && !(Array.isArray(debate[key]) && debate[key].length));
    const repeated = Array.isArray(debate.messages)
        ? new Set(debate.messages.map(m => JSON.stringify(m).slice(0, 240))).size < debate.messages.length
        : false;
    return {
        passed: missing.length === 0 && !repeated,
        missing,
        repeated,
        score: Math.max(0, 100 - missing.length * 20 - (repeated ? 25 : 0))
    };
}

export async function recordEvidenceDebate(debate = {}) {
    const validation = validateEvidenceDebate(debate);
    const entry = {
        id: debate.id || `debate-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        proposal: debate.proposal || null,
        evidence: debate.evidence || [],
        counterexample: debate.counterexample || null,
        testPlan: debate.testPlan || null,
        verdict: debate.verdict || null,
        artifactPath: debate.artifactPath || null,
        messages: debate.messages || [],
        validation
    };
    await fs.mkdir(path.dirname(DEBATE_LEDGER_PATH), { recursive: true });
    await fs.appendFile(DEBATE_LEDGER_PATH, JSON.stringify(entry) + '\n', 'utf8');
    await recordTruth(`Evidence debate ${validation.passed ? 'valid' : 'invalid'}: ${String(entry.proposal || '').slice(0, 120)}`, {
        status: validation.passed ? 'verified' : 'rejected',
        confidence: validation.score / 100,
        proof: validation,
        source: 'evidence_debate_ledger',
        artifactPath: entry.artifactPath,
        metadata: { debateId: entry.id }
    });
    return entry;
}

export { DEBATE_LEDGER_PATH };
