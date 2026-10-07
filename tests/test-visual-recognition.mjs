#!/usr/bin/env node

import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-vision-test-'));

process.chdir(tempRoot);

let generateSeen = false;
global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/api/tags')) {
        return {
            ok: true,
            json: async () => ({ models: [{ name: 'llava:latest', capabilities: ['vision'] }] })
        };
    }
    if (href.endsWith('/api/generate')) {
        const body = JSON.parse(options.body || '{}');
        generateSeen = Boolean(body.images?.[0]) && body.model === 'llava:latest';
        return {
            ok: true,
            json: async () => ({
                response: JSON.stringify({
                    summary: 'A small test image with a visible red pixel.',
                    objects: ['test image', 'red pixel'],
                    ocrText: null,
                    uncertain: false
                })
            })
        };
    }
    throw new Error(`Unexpected fetch URL: ${href}`);
};

const analyzerModule = await import(pathToFileURL(path.join(repoRoot, 'server/utils/LocalVisionFileAnalyzer.js')).href);
const auditModule = await import(pathToFileURL(path.join(repoRoot, 'server/utils/VisionTruthAudit.js')).href);

const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
);
const imagePath = path.join(tempRoot, 'pixel.png');
await fs.writeFile(imagePath, pngBytes);

const result = await analyzerModule.analyzeImageFile(imagePath, {
    auditType: 'test_visual_recognition',
    auditSource: 'unit-test'
});

assert.equal(generateSeen, true);
assert.equal(result.success, true);
assert.equal(result.model, 'llava:latest');
assert.equal(result.uncertain, false);
assert.match(result.summary, /red pixel/i);
assert.deepEqual(result.objects, ['test image', 'red pixel']);

let records = [];
for (let i = 0; i < 20; i += 1) {
    records = await auditModule.readVisionTruthAudit(5);
    if (records.length) break;
    await new Promise(resolve => setTimeout(resolve, 25));
}
assert.equal(records.length, 1);
assert.equal(records[0].type, 'test_visual_recognition');
assert.equal(records[0].engine, 'local-vlm');
assert.equal(records[0].semanticAnalysis, true);
assert.match(records[0].summary, /red pixel/i);

console.log('visual recognition test passed');
