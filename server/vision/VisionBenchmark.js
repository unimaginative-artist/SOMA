import fs from 'node:fs';
import path from 'node:path';
import { normalizePerception } from './VisionPerception.js';

export function scorePerception(actual = {}, expected = {}) {
    const actualLabels = new Set((actual.objects || []).map(o => o.label));
    const expectedLabels = new Set(expected.objects || []);
    const truePositive = [...expectedLabels].filter(label => actualLabels.has(label)).length;
    const precision = actualLabels.size ? truePositive / actualLabels.size : expectedLabels.size ? 0 : 1;
    const recall = expectedLabels.size ? truePositive / expectedLabels.size : 1;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const textExpected = String(expected.visibleText || '').toLowerCase();
    const textActual = String(actual.visibleText || '').toLowerCase();
    const ocr = textExpected ? (textActual.includes(textExpected) ? 1 : 0) : 1;
    const forbidden = (expected.forbiddenClaims || []).filter(term => JSON.stringify(actual).toLowerCase().includes(String(term).toLowerCase()));
    const grounding = forbidden.length ? 0 : 1;
    return { score: Number((f1 * 0.55 + ocr * 0.25 + grounding * 0.2).toFixed(4)), precision, recall, f1, ocr, grounding, forbidden };
}

export function runVisionBenchmark(cases = []) {
    const results = cases.map(item => {
        const actual = item.actual?.schemaVersion ? item.actual : normalizePerception(item.actual || {});
        return { id: item.id, ...scorePerception(actual, item.expected || {}) };
    });
    const score = results.length ? results.reduce((sum, item) => sum + item.score, 0) / results.length : 0;
    return { schemaVersion: 'soma.vision-benchmark.v1', score: Number(score.toFixed(4)), passed: score >= 0.8, cases: results, createdAt: Date.now() };
}

export function recordVisionBenchmark(report, filePath = 'data/vision/benchmark-ledger.jsonl') {
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, `${JSON.stringify(report)}\n`);
    return resolved;
}

export default { scorePerception, runVisionBenchmark, recordVisionBenchmark };
