import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VisualObjectMemory } from '../core/VisualObjectMemory.js';

test('nearby detections retain identity across frames and persist observations', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-vision-'));
    const memory = new VisualObjectMemory({ dbPath: path.join(dir, 'objects.db') }).initialize();
    const first = memory.ingest({ timestamp: 1000, channel: 'webcam', objects: [{ label: 'person', score: 0.95, bbox: [0.1, 0.1, 0.3, 0.5] }] });
    const second = memory.ingest({ timestamp: 1500, channel: 'webcam', objects: [{ label: 'person', score: 0.94, bbox: [0.12, 0.1, 0.3, 0.5] }] });
    assert.equal(second[0].trackId, first[0].trackId);
    const entity = memory.getEntity(first[0].trackId);
    assert.equal(entity.observation_count, 2);
    assert.equal(entity.identity_label, null);
    memory.close();
    await fs.rm(dir, { recursive: true, force: true });
});

test('separated same-label objects receive different track IDs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-vision-'));
    const memory = new VisualObjectMemory({ dbPath: path.join(dir, 'objects.db') }).initialize();
    const objects = memory.ingest({ timestamp: 1000, objects: [
        { label: 'cup', bbox: [0.05, 0.1, 0.1, 0.1] }, { label: 'cup', bbox: [0.8, 0.1, 0.1, 0.1] }
    ] });
    assert.notEqual(objects[0].trackId, objects[1].trackId);
    memory.close();
    await fs.rm(dir, { recursive: true, force: true });
});
