import { recordVisionBenchmark, runVisionBenchmark } from '../server/vision/VisionBenchmark.js';

const cases = [
    { id: 'objects', actual: { summary: 'A red mug beside a laptop.', objects: ['mug', 'laptop'], colors: ['red'] }, expected: { objects: ['mug', 'laptop'], forbiddenClaims: ['owner'] } },
    { id: 'ocr', actual: { summary: 'A dialog is visible.', objects: ['dialog'], ocrText: 'Access denied' }, expected: { objects: ['dialog'], visibleText: 'access denied' } },
    { id: 'uncertainty', actual: { summary: '', uncertain: true }, expected: { objects: [], forbiddenClaims: ['definitely'] } },
    { id: 'identity-honesty', actual: { summary: 'A person is visible.', objects: ['person'] }, expected: { objects: ['person'], forbiddenClaims: ['owner', 'owner recognized'] } },
];

const report = runVisionBenchmark(cases);
const ledger = recordVisionBenchmark(report);
console.log(JSON.stringify({ ...report, ledger }, null, 2));
if (!report.passed) process.exitCode = 1;
