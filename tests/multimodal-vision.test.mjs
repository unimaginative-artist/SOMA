import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizePerception } from '../server/vision/VisionPerception.js';
import { analyzeImageFileTwoStage, extractImageText } from '../server/utils/LocalVisionFileAnalyzer.js';
import { VisionFeedbackLedger } from '../server/vision/VisionFeedbackLedger.js';
import { editImage, imageEditingCapability } from '../server/vision/ImageEditingCapability.js';
import { runVisionBenchmark } from '../server/vision/VisionBenchmark.js';
import { VisualObjectMemory } from '../core/VisualObjectMemory.js';

async function tempImage() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-multimodal-'));
    const filePath = path.join(dir, 'pixel.png');
    await fs.writeFile(filePath, Buffer.from('89504e470d0a1a0a', 'hex'));
    return { dir, filePath };
}

function mockOllama() {
    const original = global.fetch;
    global.fetch = async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        const isOcr = /Perform OCR/.test(body.prompt || '');
        const response = isOcr
            ? { ocrText: 'HELLO 123', uncertain: false }
            : body.model.includes('moondream')
                ? { summary: 'A preview of a red cup and sign.', objects: ['cup'], uncertain: false }
                : { summary: 'A red cup beside a sign.', objects: [{ label: 'cup', confidence: 0.93, bbox: [0.1, 0.2, 0.3, 0.4] }], visible_text: 'HELLO 123', colors: ['red'], uncertain: false };
        return { ok: true, json: async () => ({ response: JSON.stringify(response) }), text: async () => '' };
    };
    return () => { global.fetch = original; };
}

test('1 universal contract accepts a normalized uploaded-image perception', () => {
    const result = normalizePerception({ summary: 'A cup.', objects: ['cup'] }, { source: 'chat-upload' });
    assert.equal(result.source, 'chat-upload');
    assert.equal(result.objects[0].label, 'cup');
});

test('2 fast mode returns a Moondream preview without a deep pass', async () => {
    const { dir, filePath } = await tempImage(); const restore = mockOllama();
    try {
        const result = await analyzeImageFileTwoStage(filePath, { mode: 'fast', fastModel: 'moondream:latest', deepModel: 'qwen2.5vl:7b' });
        assert.equal(result.stage, 'preview'); assert.equal(result.model, 'moondream:latest');
    } finally { restore(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('3 reference editing fails closed and supports a configured provider contract', async () => {
    assert.equal(imageEditingCapability({}).available, false);
    await assert.rejects(() => editImage({ imageData: 'x', prompt: 'blue' }, { env: {}, fetchImpl: async () => null }), { code: 'IMAGE_EDIT_PROVIDER_UNAVAILABLE' });
    const result = await editImage({ imageData: 'x', prompt: 'blue' }, { env: { SOMA_IMAGE_EDIT_ENDPOINT: 'http://editor' }, fetchImpl: async () => ({ ok: true, json: async () => ({ image: 'edited' }) }) });
    assert.equal(result.image, 'edited');
});

test('4 identity memory requires evidence, persists consent, and supports revocation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-identity-'));
    const memory = new VisualObjectMemory({ dbPath: path.join(dir, 'memory.db') }).initialize();
    const [person] = memory.ingest({ objects: [{ label: 'person', confidence: 0.9, bbox: [0.1, 0.1, 0.3, 0.6] }] });
    assert.throws(() => memory.enrollIdentity(person.trackId, 'Alex'), /consent evidence/);
    const profile = memory.enrollIdentity(person.trackId, 'Alex', { evidence: { consent: true } });
    assert.equal(memory.getProfileForTrack(person.trackId).display_name, 'Alex');
    memory.revokeIdentity(profile.profileId);
    assert.equal(memory.getProfileForTrack(person.trackId), null);
    memory.close(); await fs.rm(dir, { recursive: true, force: true });
});

test('5 dedicated OCR pass preserves returned visible text', async () => {
    const { dir, filePath } = await tempImage(); const restore = mockOllama();
    try { assert.equal((await extractImageText(filePath, { model: 'qwen2.5vl:7b' })).text, 'HELLO 123'); }
    finally { restore(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('6 structured perception includes robotics-relevant fields', () => {
    const result = normalizePerception({ summary: 'Room', objects: [{ label: 'chair', bbox: [0, 0, 0.2, 0.4] }], relationships: ['chair beside desk'], hazards: ['cable on floor'], depth: 'desk behind chair' });
    for (const key of ['scene', 'objects', 'people', 'relationships', 'visibleText', 'colors', 'composition', 'depth', 'hazards', 'uncertainties']) assert.ok(key in result);
});

test('7 claims distinguish visible evidence, inference, and remembered context', () => {
    const result = normalizePerception({ summary: 'A person.', inferences: ['They may be seated'] }, { remembered: ['Alex often uses this room'] });
    assert.deepEqual(new Set(result.claims.map(c => c.grounding)), new Set(['visible', 'inference', 'remembered']));
});

test('8 benchmark scores object, OCR, and hallucination-grounding quality', () => {
    const report = runVisionBenchmark([{ id: 'case', actual: { summary: 'A cup says HI.', objects: ['cup'], ocrText: 'HI' }, expected: { objects: ['cup'], visibleText: 'hi', forbiddenClaims: ['owner'] } }]);
    assert.equal(report.score, 1); assert.equal(report.passed, true);
});

test('9 feedback exports only consented, user-owned corrections', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-feedback-'));
    const ledger = new VisionFeedbackLedger({ ledgerPath: path.join(dir, 'feedback.jsonl'), trainingPath: path.join(dir, 'training.jsonl') });
    ledger.record({ rating: 'incorrect', correction: 'A green mug.', imagePath: path.join(dir, 'image.png'), userOwnsMedia: true, trainingConsent: false });
    await assert.rejects(fs.access(path.join(dir, 'training.jsonl')));
    ledger.record({ rating: 'partial', correction: 'A green mug.', imagePath: path.join(dir, 'image.png'), userOwnsMedia: true, trainingConsent: true });
    assert.match(await fs.readFile(path.join(dir, 'training.jsonl'), 'utf8'), /green mug/);
    await fs.rm(dir, { recursive: true, force: true });
});

test('10 temporal tracking retains IDs and calculates motion across frames', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-tracks-'));
    const memory = new VisualObjectMemory({ dbPath: path.join(dir, 'memory.db') }).initialize();
    const [first] = memory.ingest({ timestamp: 1000, objects: [{ label: 'ball', bbox: [0.1, 0.1, 0.1, 0.1] }] });
    const [second] = memory.ingest({ timestamp: 1100, objects: [{ label: 'ball', bbox: [0.15, 0.1, 0.1, 0.1] }] });
    assert.equal(second.trackId, first.trackId); assert.ok(second.motion.dx > 0); assert.equal(second.motion.elapsedMs, 100);
    memory.close(); await fs.rm(dir, { recursive: true, force: true });
});
